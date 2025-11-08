import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { BaseCollectionIndex, IndexEntry } from '../collectionIndex';
import { MongoNetworkError } from './s3CollectionStore';
import { getLogger } from '../../index';


/**
 * S3-backed CollectionIndex that persists index entries per key to S3.
 *
 * ## S3 Index File Structure
 * - Each index entry is stored as a separate S3 object:
 *   - Path: `collection/indices/indexName/key.json` (where key is the encoded value(s) of the indexed field(s))
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

  public getIndexMap(): Map<string, IndexEntry> {
    return this.indexEntryCache;
  }

  /**
   * Fetch an index entry from S3 for the given key.
   * If not found, returns an empty IndexEntry.
   * @param key Index key
   */
  protected async fetch(key: string): Promise<IndexEntry> {

    try {
      // key is now just the value(s) of the indexed field(s), already encoded by makeIndexKey
      // Do NOT re-encode here; just use as-is to match file naming in tests and production  
      const encodedKey = key.split('|').map(v => encodeURIComponent(v)).join('|');
      const s3Key = `${this.collectionName}/indices/${this.name}/${encodedKey}.json`;
      
      let cachedEntry = this.indexEntryCache.get(key);
      if (cachedEntry?.etag) {
        const args = {
          Bucket: this.bucket,
          Key: s3Key,
        };
        getLogger().debug(`Fetching index entry from S3 with If-None-Match`, { command: "head", args });
        const result = await this.s3.send(new HeadObjectCommand(args));
        if( result?.ETag == cachedEntry.etag) {
          return cachedEntry; // Return cached entry if available
        }
      }

      const args = {
        Bucket: this.bucket,
        Key: s3Key,
      };
      getLogger().debug(`Fetching index entry from S3`, { command: "getObject", args });
      const result = await this.s3.send(new GetObjectCommand(args));
      const stream = result.Body as Readable;
      const data = await new Promise<string>((resolve, reject) => {
        let str = '';
        stream.on('data', chunk => (str += chunk));
        stream.on('end', () => resolve(str));
        stream.on('error', reject);
      });
      const ids = JSON.parse(data);
      const etag = result.ETag;
      cachedEntry = this.indexEntryCache.get(key); // allow for late changes
      if(cachedEntry) {
        cachedEntry.update(Array.isArray(ids) ? ids : [], etag);
        return cachedEntry;
      }
      const entry = new IndexEntry(Array.isArray(ids) ? ids : [], etag);
      this.indexEntryCache.set(key, entry); // Cache the entry for future use
      return entry;
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
    const encodedKey = key.split('|').map(v => encodeURIComponent(v)).join('|');
    const s3Key = `${this.collectionName}/indices/${this.name}/${encodedKey}.json`;
    let tryCount = 0;

    while (tryCount < 3) {
      try {
        const args = {
          Bucket: this.bucket,
          Key: s3Key,
          Body: JSON.stringify(entry.toArray()),
          ContentType: 'application/json',
          ...(entry.etag ? { IfMatch: entry.etag } : {}),
        };
        getLogger().debug(`Persisting index entry to S3`, { command: "putObject", args });
        const results = await this.s3.send(new PutObjectCommand(args));
        entry.etag = results.ETag; // Update etag on success
        entry.dirty = false;
        return;
      } catch (err: any) {
        if (err.$metadata?.httpStatusCode === 412) {
          // ETag mismatch, refetch and retry
          const fresh = await this.fetch(key);
          entry.update(fresh.toArray(), fresh.etag);
          tryCount++;
          continue;
        }
        throw err;
      }
    }

    // Re-queue the key for another attempt after a delay
    setTimeout(() => {
      this.persistQueue.add(key);
      this._triggerPersist();
    }, 1000);
  }

  /**
   * Enqueue an index entry for persistence. If the queue was empty, trigger the background process.
   * @param key Index key
   * @param entry IndexEntry to persist
   */
  protected async persist(key: string, entry: IndexEntry): Promise<void> {
    // logger not available here; consider injecting if needed for debug
    this.indexEntryCache.set(key, entry);
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
    // logger not available here; consider injecting if needed for debug
    // Always try to start up to maxTasks if there is work
    const desiredTasks = this.maxTasks;
    while (this.runningTasks < desiredTasks && this.persistQueue.size > 0) {
      const key = this.persistQueue.values().next().value as string;
      if (typeof key !== 'string') continue;
      const deleted = this.persistQueue.delete(key);
      if (!deleted) continue; // Already being processed by another task
      this.runningTasks++;
      // logger not available here; consider injecting if needed for debug
      this._backgroundPersistTask(key).finally(() => {
        this.runningTasks--;
        // logger not available here; consider injecting if needed for debug
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
    const entry = this.indexEntryCache.get(key);
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
   * Find document IDs for a given index key (loads index entry file at most once per key).
   * @param key Index key
   */
  async findIdsForKey(key: string): Promise<string[]> {
    try {
      const entry = await this.fetch(key);
      // logger not available here; consider injecting if needed for debug
      return entry.toArray();
    } catch (err: any) {
      if( err.name === 'NoSuchKey') {
        return []; // No such key, return empty array
      }
      if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
      if (typeof err === 'string') {
        throw new MongoNetworkError(err);
      }
      throw err;
    }
  }

  /**
   * For test/debug: clear the index entry cache.
   */
  clearIndexEntryCache() {
    this.indexEntryCache.clear();
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
}
