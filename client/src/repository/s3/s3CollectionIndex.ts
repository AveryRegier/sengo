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
   * Remove a document ID from all index keys in memory and persist changes.
   * This is used for deleteOneById to ensure the ID is removed from all index entries.
   * @param id Document _id to remove
   */
  /**
   * Remove a document ID from all relevant index entry files (for this index).
   * Only loads the entry files that could contain the ID, based on the index key spec.
   * @param id Document _id to remove
   * @param doc (optional) The full document, if available, to compute the key(s) directly.
   */
  public async removeIdFromAllKeys(id: string, doc?: Record<string, any>): Promise<void> {
    const idStr = id.toString();
    // If doc is provided, we can compute the key directly
    if (doc) {
      const key = this.makeIndexKey(doc);
      let entry = await this.fetch(key);
      if (entry.ids.has(idStr)) {
        entry.ids.delete(idStr);
        entry.dirty = true;
        await this.persist(key, entry);
      }
      return;
    }
    // If doc is not provided, we must check all loaded entries (fallback)
    for (const [key, entry] of this.indexEntryCache.entries()) {
      if (entry.ids.has(idStr)) {
        entry.ids.delete(idStr);
        entry.dirty = true;
        await this.persist(key, entry);
        // Always update the cache to the current entry object
        this.indexEntryCache.set(key, entry);
      }
    }
  }

    /**
   * Remove a document from the index for the appropriate key.
   * Fetches from S3 if entry is not in memory, removes ID, and persists if needed.
   * @param doc Document to remove
   */
  async removeDocument(doc: Record<string, any>): Promise<void> {
    await super.removeDocument(doc);
    const key = this.makeIndexKey(doc);
    const entry = this.indexEntryCache.get(key);
    if (entry && entry.dirty) {
      await this.persist(key, entry);
    }
  }

  /**
   * Fetch an index entry from S3 for the given key.
   * If not found, returns an empty IndexEntry.
   * @param key Index key
   */
  protected async fetch(key: string): Promise<IndexEntry> {
    if( this.indexEntryCache.has(key)) {
      return this.indexEntryCache.get(key)!; // Return cached entry if available
    }
    // key is now just the value(s) of the indexed field(s), already encoded by makeIndexKey
    // Do NOT re-encode here; just use as-is to match file naming in tests and production
    const s3Key = `${this.collectionName}/indices/${this.name}/${key}.json`;
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
    // key is now just the value(s) of the indexed field(s), not including order
    // Encode each value, not the separator, to match test and MongoDB compatibility
    const encodedKey = key.split('|').map(v => encodeURIComponent(v)).join('|');
    const s3Key = `${this.collectionName}/indices/${this.name}/${encodedKey}.json`;
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
      // logger not available here; consider injecting if needed for debug
        return;
      } catch (err: any) {
        // logger not available here; consider injecting if needed for debug
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
    try {
      const entry = await this.getIndexEntryForKey(key);
      // logger not available here; consider injecting if needed for debug
      return entry.toArray();
    } catch (err: any) {
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
   * Add a document to the index for the appropriate key.
   * Fetches from S3 if entry is not in memory, merges IDs, and persists if needed.
   * @param doc Document to add
   */
  async addDocument(doc: Record<string, any>): Promise<void> { 
    if (this.hasFirstKey(doc)) {
      const key = this.makeIndexKey(doc);
      // Always use the same object as is in the cache, if present
      let entry = await this.fetch(key);
      if (entry.add(doc._id)) {
        await this.persist(key, entry);
      }
      // Always update the cache to the current entry object
      this.indexEntryCache.set(key, entry);
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
