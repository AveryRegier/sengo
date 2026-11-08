import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { BaseCollectionIndex, IndexEntry, IndexEntryMutation, IndexOptions } from '../collectionIndex';
import { MongoNetworkError, MongoServerError } from '../../errors.js';
import { ExplainSink, getLogger } from '../../index';

/**
 * S3-backed CollectionIndex that persists index entries per key to S3.
 */
export class S3CollectionIndex extends BaseCollectionIndex {
  private s3: S3Client;
  private collectionName: string;
  private bucket: string;
  private entryStates: Map<string, { exists: boolean; etag?: string }> = new Map();
  private persistenceByKey: Map<string, Promise<void>> = new Map();
  private pendingPersists: Set<Promise<void>> = new Set();
  private persistenceFailures: unknown[] = [];
  private persistDurations: number[] = [];
  private persistDurationAvg = 0;
  private readonly persistDurationWindow = 20;
  private indexEntryCache: Map<string, IndexEntry> = new Map();
  private readonly maxConflictRetries = 3;

  constructor(
    name: string,
    keys: { field: string; order: 1 | -1 | 'text' }[],
    opts: { s3: S3Client; collectionName: string; bucket: string; unique?: boolean }
  ) {
    super(name, keys, opts.unique === true);
    this.s3 = opts.s3;
    this.collectionName = opts.collectionName;
    this.bucket = opts.bucket;
  }

  public getIndexMap(): Map<string, IndexEntry> {
    return this.indexEntryCache;
  }

  protected async fetch(key: string, sink?: ExplainSink): Promise<IndexEntry> {
    const fetchStartedAtMs = Date.now();
    const s3Key = this.getS3Key(key);
    let cachedEntry = this.indexEntryCache.get(key);
    const cachedState = this.entryStates.get(key);

    try {
      if (cachedEntry && cachedState) {
        try {
          const args = { Bucket: this.bucket, Key: s3Key };
          getLogger().debug('Checking cached index entry in S3', { command: 'headObject', args });
          const result = await this.s3.send(new HeadObjectCommand(args));
          if (cachedState.exists && result?.ETag === cachedState.etag) {
            sink?.onCacheEvent('index', this.collectionName, this.name, 'file', 'hit');
            sink?.onTimingPart('cache', Date.now() - fetchStartedAtMs, 1);
            return cachedEntry;
          }
          sink?.onCacheEvent('index', this.collectionName, this.name, 'file', 'stale');
        } catch (err) {
          if (!this.isMissingObjectError(err)) {
            throw err;
          }
          this.entryStates.set(key, { exists: false });
          cachedEntry.update('[]');
          sink?.onCacheEvent('index', this.collectionName, this.name, 'file', 'stale');
        }
      } else {
        sink?.onCacheEvent('index', this.collectionName, this.name, 'file', 'miss');
      }

      const current = await this.loadFromS3(key);
      cachedEntry = this.indexEntryCache.get(key);
      if (cachedEntry) {
        cachedEntry.update(current.data);
        this.entryStates.set(key, { exists: current.exists, etag: current.etag });
        return cachedEntry;
      }

      const entry = this.createEntry(current.data);
      this.indexEntryCache.set(key, entry);
      this.entryStates.set(key, { exists: current.exists, etag: current.etag });
      sink?.onTimingPart('cache', Date.now() - fetchStartedAtMs, 1);
      return entry;
    } catch (err) {
      sink?.onTimingPart('cache', Date.now() - fetchStartedAtMs, 1);
      throw err;
    }
  }

  private getS3Key(key: string): string {
    const encodedKey = key.split('|').map(value => encodeURIComponent(value)).join('|');
    return `${this.collectionName}/indices/${this.name}/${encodedKey}.json`;
  }

  private isMissingObjectError(err: any): boolean {
    return err?.name === 'NoSuchKey' || err?.name === 'NotFound' ||
      err?.Code === 'NoSuchKey' || err?.Code === 'NotFound';
  }

  private isConditionalWriteError(err: any): boolean {
    return err?.$metadata?.httpStatusCode === 409 || err?.$metadata?.httpStatusCode === 412 ||
      err?.name === 'PreconditionFailed' || err?.name === 'ConditionalRequestConflict' ||
      err?.Code === 'PreconditionFailed' || err?.Code === 'ConditionalRequestConflict';
  }

  private async readBody(result: any): Promise<string> {
    const stream = result.Body as Readable;
    return await new Promise<string>((resolve, reject) => {
      let data = '';
      stream.on('data', chunk => (data += chunk));
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
  }

  private async loadFromS3(key: string): Promise<{ data: string; exists: boolean; etag?: string }> {
    const args = { Bucket: this.bucket, Key: this.getS3Key(key) };
    getLogger().debug('Loading index entry from S3', { command: 'getObject', args });
    try {
      const result = await this.s3.send(new GetObjectCommand(args));
      return { data: await this.readBody(result), exists: true, etag: result.ETag };
    } catch (err) {
      if (this.isMissingObjectError(err)) {
        return { data: '[]', exists: false };
      }
      throw err;
    }
  }

  protected async persistEntry(
    key: string,
    entry: IndexEntry,
    mutations: IndexEntryMutation[] = entry.getPendingMutations()
  ): Promise<void> {
    const s3Key = this.getS3Key(key);
    const acknowledgedThrough = mutations.reduce((max, mutation) => Math.max(max, mutation.sequence), 0);

    const maxAttempts = this.maxConflictRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const current = await this.loadFromS3(key);
      if (current.exists && !current.etag) {
        throw new MongoServerError(`S3 did not return an ETag for existing index entry ${s3Key}`);
      }
      const fresh = this.createEntry(current.data);
      for (const mutation of mutations) {
        if (mutation.kind === 'add') {
          fresh.add(mutation.id, mutation.sortValue);
        } else if (mutation.kind === 'remove') {
          fresh.remove(mutation.id);
        } else {
          fresh.removeMembership(mutation.id, mutation.sortValue);
        }
      }

      const body = mutations.length === 0 ? entry.serialize() : fresh.serialize();
      const args = {
        Bucket: this.bucket,
        Key: s3Key,
        Body: body,
        ContentType: 'application/json',
        ...(current.exists ? { IfMatch: current.etag } : { IfNoneMatch: '*' }),
      };

      try {
        getLogger().debug('Persisting index entry to S3', { command: 'putObject', args });
        const results = await this.s3.send(new PutObjectCommand(args));
        this.entryStates.set(key, { exists: true, etag: results.ETag });
        entry.replaceCommitted(body, acknowledgedThrough);
        return;
      } catch (err) {
        if (!this.isConditionalWriteError(err)) {
          getLogger().error(err, `Failed to persist index entry to S3 for ${s3Key}`);
          throw err;
        }

        getLogger().warn(`ETag conflict detected for ${s3Key}; reloading and replaying (attempt ${attempt}/${maxAttempts})`);
        if (attempt === maxAttempts) {
          throw new MongoServerError(
            `Could not persist index entry ${s3Key} after ${this.maxConflictRetries} conditional-write retries`,
            { cause: err instanceof Error ? err : new Error(String(err)) }
          );
        }
      }
    }
  }

  protected async persist(key: string, entry: IndexEntry): Promise<void> {
    this.indexEntryCache.set(key, entry);
    const previous = this.persistenceByKey.get(key);
    const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      const mutations = entry.getPendingMutations();
      if (mutations.length === 0 && !entry.dirty) {
        return;
      }
      const startedAt = Date.now();
      await this.persistEntry(key, entry, mutations);
      this.recordPersistDuration(Date.now() - startedAt);
    });

    this.persistenceByKey.set(key, task);
    this.pendingPersists.add(task);
    task.then(
      () => this.completePersist(key, task),
      error => {
        this.persistenceFailures.push(error);
        this.completePersist(key, task);
      }
    );
    await task;
  }

  private completePersist(key: string, task: Promise<void>): void {
    this.pendingPersists.delete(task);
    if (this.persistenceByKey.get(key) === task) {
      this.persistenceByKey.delete(key);
    }
  }

  private recordPersistDuration(ms: number): void {
    this.persistDurations.push(ms);
    if (this.persistDurations.length > this.persistDurationWindow) {
      this.persistDurations.shift();
    }
    this.persistDurationAvg = this.persistDurations.reduce((a, b) => a + b, 0) / this.persistDurations.length;
  }

  isBusy(): boolean {
    return this.pendingPersists.size > 0;
  }

  getStatus(): { pendingInserts: number; runningTasks: number; avgPersistMs: number; estTimeToClearMs: number } {
    const pending = this.pendingPersists.size;
    const avg = this.persistDurationAvg || 0;
    return {
      pendingInserts: pending,
      runningTasks: pending,
      avgPersistMs: Math.round(avg),
      estTimeToClearMs: Math.round(pending * avg),
    };
  }

  async findIdsForKey(key: string, options?: IndexOptions, sink?: ExplainSink): Promise<string[]> {
    try {
      const entry = await this.fetch(key, sink);
      return entry.toArray(options);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey') {
        return [];
      }
      if (err?.name === 'TimeoutError' || err?.name === 'NetworkingError' ||
        /network|timeout|etimedout|econnrefused/i.test(err?.message ?? '')) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
      if (typeof err === 'string') {
        throw new MongoNetworkError(err);
      }
      throw err;
    }
  }

  clearIndexEntryCache(): void {
    this.indexEntryCache.clear();
    this.entryStates.clear();
  }

  async flush(): Promise<void> {
    while (this.pendingPersists.size > 0) {
      await Promise.allSettled([...this.pendingPersists]);
    }
    if (this.persistenceFailures.length > 0) {
      const failures = this.persistenceFailures.splice(0);
      throw failures[0];
    }
  }
}
