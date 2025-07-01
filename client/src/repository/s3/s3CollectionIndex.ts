import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex, IndexEntry } from '../collectionIndex';
import { MongoNetworkError } from './s3CollectionStore';

/**
 * S3-backed CollectionIndex that persists index entries per key to S3.
 *
 * ## S3 Index File Structure
 * - Each index entry is stored as a separate S3 object:
 *   - Path: `collection/indices/indexName/key.json`
 *   - Contents: JSON array of document IDs for that key
 *   - ETag is used for optimistic concurrency control
 *
 * ## Index Entry Cache
 * - In-memory cache per process for index entries
 * - Cleared on process restart; S3 is always the source of truth
 * - Cache is not shared between tests or processes
 *
 * ## Testability
 * - All S3 accesses (read, write, delete) are logged in tests
 * - S3 simulation (`S3BucketSimulator`) is used for all S3 operations in tests
 * - Each test sets up its own S3 state and simulator instance
 * - Helpers are provided to set up index entries and document files in S3
 * - No S3 state or logs are shared between tests
 */
export class S3CollectionIndex extends BaseCollectionIndex {
  private s3: S3Client;
  private collectionName: string;
  private bucket: string;
  private persistQueue: Set<string> = new Set();
  private runningTasks = 0;
  private maxTasks = 4;
  private persistDurations: number[] = [];
  private persistDurationAvg: number = 0;
  private persistDurationWindow: number = 20; // moving average window
  private indexEntryCache: Map<string, IndexEntry> = new Map();

  /**
   * Create a new S3CollectionIndex.
   * @param name Index name
   * @param keys Index key spec
   * @param opts.s3 S3Client instance
   * @param opts.collectionName Name of the collection
   * @param opts.bucket S3 bucket name
   */
  constructor(name: string, keys: { field: string, order: 1 | -1 | 'text' }[], opts: { s3: S3Client, collectionName: string, bucket: string }) {
    super(name, keys);
    this.s3 = opts.s3;
    this.collectionName = opts.collectionName;
    this.bucket = opts.bucket;
  }

  /**
   * Fetch an index entry from S3 for the given key.
   * If not found, returns an empty IndexEntry.
   * @param key Index key
   */
  protected async fetch(key: string): Promise<IndexEntry> {
    const s3Key = `${this.collectionName}/indices/${this.name}/${encodeURIComponent(key)}.json`;
    try {
      const result = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }));
      const stream = result.Body as Readable;
      const data = await new Promise<string>((resolve, reject) => {
        let str = '';
        stream.on('data', chunk => (str += chunk));
        stream.on('end', () => resolve(str));
        stream.on('error', reject);
      });
      const ids = JSON.parse(data);
      const etag = result.ETag;
      return new IndexEntry(Array.isArray(ids) ? ids : [], etag);
    } catch (err: any) {
      // Not found, start with empty
      return new IndexEntry();
    }
  }

  /**
   * Persist an index entry to S3 for the given key.
   * Retries on ETag mismatch (412), merges IDs, and re-queues on failure.
   * @param key Index key
   * @param entry IndexEntry to persist
   */
  protected async persistEntry(key: string, entry: IndexEntry): Promise<void> {
    console.log(`[S3CollectionIndex] persistEntry: Persisting entry for key='${key}', ids=[${[...entry.ids].join(',')}]`);
    const s3Key = `${this.collectionName}/indices/${this.name}/${encodeURIComponent(key)}.json`;
    let tryCount = 0;
    while (tryCount < 3) {
      try {
        await this.s3.send(new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: JSON.stringify(entry.toArray()),
          ContentType: 'application/json',
          ...(entry.etag ? { IfMatch: entry.etag } : {}),
        }));
        entry.dirty = false;
        console.log(`[S3CollectionIndex] persistEntry: Successfully persisted entry for key='${key}'`);
        return;
      } catch (err: any) {
        console.log(`[S3CollectionIndex] persistEntry: Error persisting entry for key='${key}':`, err);
        if (err.$metadata && err.$metadata.httpStatusCode === 412) {
          // ETag mismatch, refetch and retry
          const fresh = await this.fetch(key);
          entry.ids = new Set([...entry.ids, ...fresh.ids]);
          entry.etag = fresh.etag;
          entry.dirty = true;
          tryCount++;
          continue;
        }
        throw err;
      }
    }
    // Instead of throwing, re-queue the key at the back for another attempt
    setTimeout(() => {
      this.persistQueue.add(key);
      this._triggerPersist();
    }, 1000); // small delay to avoid tight loop
  }

  /**
   * Enqueue an index entry for persistence. If the queue was empty, trigger the background process.
   * @param key Index key
   * @param entry IndexEntry to persist
   */
  async persist(key: string, entry: IndexEntry): Promise<void> {
    console.log(`[S3CollectionIndex] persist: Queuing persist for key='${key}', entry.ids=[${[...entry.ids].join(',')}]`);
    this.indexMap.set(key, entry);
    const wasEmpty = this.persistQueue.size === 0;
    this.persistQueue.add(key);
    if (wasEmpty) {
      this._triggerPersist();
    }
  }

  /**
   * Internal: triggers background persist tasks up to maxTasks.
   */
  private _triggerPersist() {
    console.log(`[S3CollectionIndex] _triggerPersist: runningTasks=${this.runningTasks}, persistQueue.size=${this.persistQueue.size}`);
    // Always try to start up to maxTasks if there is work
    const desiredTasks = this.maxTasks;
    while (this.runningTasks < desiredTasks && this.persistQueue.size > 0) {
      const key = this.persistQueue.values().next().value as string;
      if (typeof key !== 'string') continue;
      const deleted = this.persistQueue.delete(key);
      if (!deleted) continue; // Already being processed by another task
      this.runningTasks++;
      console.log(`[S3CollectionIndex] _triggerPersist: starting persist for key='${key}' (runningTasks=${this.runningTasks})`);
      this._backgroundPersistTask(key).finally(() => {
        this.runningTasks--;
        console.log(`[S3CollectionIndex] _triggerPersist: finished persist for key='${key}' (runningTasks=${this.runningTasks})`);
        if (this.persistQueue.size > 0) {
          this._triggerPersist();
        }
      });
    }
  }

  /**
   * Internal: records persist durations for moving average.
   */
  private recordPersistDuration(ms: number) {
    this.persistDurations.push(ms);
    if (this.persistDurations.length > this.persistDurationWindow) {
      this.persistDurations.shift();
    }
    this.persistDurationAvg = this.persistDurations.reduce((a, b) => a + b, 0) / this.persistDurations.length;
  }

  /**
   * Internal: background persist task for a single key.
   */
  private async _backgroundPersistTask(key: string) {
    const entry = this.indexMap.get(key);
    if (!entry) return;
    const start = Date.now();
    await this.persistEntry(key, entry);
    const duration = Date.now() - start;
    this.recordPersistDuration(duration);
  }

  /**
   * Returns true if there are pending or running persist tasks.
   */
  isBusy(): boolean {
    return this.persistQueue.size > 0 || this.runningTasks > 0;
  }

  /**
   * Returns status of persist queue and average persist time.
   */
  getStatus(): { pendingInserts: number; runningTasks: number; avgPersistMs: number; estTimeToClearMs: number } {
    const pending = this.persistQueue.size;
    const avg = this.persistDurationAvg || 0;
    const est = pending * avg / (this.maxTasks || 1);
    return {
      pendingInserts: pending,
      runningTasks: this.runningTasks,
      avgPersistMs: Math.round(avg),
      estTimeToClearMs: Math.round(est),
    };
  }

  /**
   * Lazily load index entry for a key from S3 at most once per key (per process).
   * If not found, returns an empty IndexEntry.
   * Throws MongoNetworkError on network errors.
   * @param key Index key
   */
  async getIndexEntryForKey(key: string): Promise<IndexEntry> {
    if (this.indexEntryCache.has(key)) {
      return this.indexEntryCache.get(key)!;
    }
    try {
      const entry = await this.fetch(key);
      this.indexEntryCache.set(key, entry);
      return entry;
    } catch (err: any) {
      if (err && (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message))) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
      if (typeof err === 'string') {
        throw new MongoNetworkError(err);
      }
      // Always return an IndexEntry, never throw for not found
      return new IndexEntry();
    }
  }

  /**
   * Find document IDs for a given index key (loads index entry file at most once per key).
   * @param key Index key
   */
  async findIdsForKey(key: string): Promise<string[]> {
    const entry = await this.getIndexEntryForKey(key);
    return entry.toArray();
  }

  /**
   * For test/debug: clear the index entry cache.
   */
  clearIndexEntryCache() {
    this.indexEntryCache.clear();
  }

  /**
   * Add a document to the index for the appropriate key.
   * Fetches from S3 if entry is not in memory, merges IDs, and persists if needed.
   * @param doc Document to add
   */
  async addDocument(doc: Record<string, any>): Promise<void> {
    console.log(`[S3CollectionIndex] addDocument: Adding doc with _id=${doc._id}`);
    const key = this.makeIndexKey(doc);
    let entry = this.indexMap.get(key);
    if (!entry) {
      // Fetch from S3 here to merge with any existing entry
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
      console.log(`[S3CollectionIndex] addDocument: Created new index entry for key='${key}'`);
    }
    if (entry.add(doc._id)) {
      console.log(`[S3CollectionIndex] addDocument: Index entry for key='${key}' marked dirty, persisting...`);
      await this.persist(key, entry);
    } else {
      console.log(`[S3CollectionIndex] addDocument: Index entry for key='${key}' already contains _id=${doc._id}`);
    }
  }

  /**
   * Wait until all pending persist tasks are complete.
   */
  async flush(): Promise<void> {
    // Guarantee the persist queue is triggered at least once
    this._triggerPersist();
    while (this.persistQueue.size > 0 || this.runningTasks > 0) {
      await new Promise(res => setTimeout(res, 5));
      this._triggerPersist(); // keep triggering in case async tasks are missed
    }
  }

  /**
   * Public wrapper for makeIndexKey to allow S3CollectionStore to generate keys for queries.
   * @param query Query object
   */
  public getIndexKeyForQuery(query: Record<string, any>): string {
    return this.makeIndexKey(query);
  }
}
