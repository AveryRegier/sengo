import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex, IndexEntry } from '../collectionIndex';

/**
 * S3-backed CollectionIndex that persists index entries per key to S3.
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

  constructor(name: string, keys: { field: string, order: 1 | -1 | 'text' }[], opts: { s3: S3Client, collectionName: string, bucket: string }) {
    super(name, keys);
    this.s3 = opts.s3;
    this.collectionName = opts.collectionName;
    this.bucket = opts.bucket;
  }

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

  protected async persistEntry(key: string, entry: IndexEntry): Promise<void> {
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
        return;
      } catch (err: any) {
        if (err.$metadata && err.$metadata.httpStatusCode === 412) {
          // ETag mismatch, refetch and retry
          const fresh = await this.fetch(key);
          // Merge all unique IDs from both the old entry and the fresh one
          entry.ids = new Set([...entry.ids, ...fresh.ids]);
          entry.etag = fresh.etag;
          entry.dirty = true;
          // Use the fresh entry for the next persist attempt
          // (entry reference is updated in-place)
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
   */
  async persist(key: string, entry: IndexEntry): Promise<void> {
    this.indexMap.set(key, entry);
    const wasEmpty = this.persistQueue.size === 0;
    this.persistQueue.add(key);
    if (wasEmpty) {
      this._triggerPersist();
    }
  }

  private _triggerPersist() {
    // If we're behind by more than 1 minute, try to start more tasks up to maxTasks
    const avg = this.persistDurationAvg || 0;
    const pending = this.persistQueue.size;
    const est = pending * avg / (this.maxTasks || 1);
    let desiredTasks = this.runningTasks;
    if (est > 60000) {
      desiredTasks = this.maxTasks;
    }
    while (this.runningTasks < desiredTasks && this.runningTasks < this.maxTasks && this.persistQueue.size > 0) {
      const key = this.persistQueue.values().next().value as string;
      if (typeof key !== 'string') continue;
      const deleted = this.persistQueue.delete(key);
      if (!deleted) continue; // Already being processed by another task
      this.runningTasks++;
      this._backgroundPersistTask(key).finally(() => {
        this.runningTasks--;
        if (this.persistQueue.size > 0) {
          this._triggerPersist();
        }
      });
    }
  }

  private recordPersistDuration(ms: number) {
    this.persistDurations.push(ms);
    if (this.persistDurations.length > this.persistDurationWindow) {
      this.persistDurations.shift();
    }
    this.persistDurationAvg = this.persistDurations.reduce((a, b) => a + b, 0) / this.persistDurations.length;
  }

  private async _backgroundPersistTask(key: string) {
    const entry = this.indexMap.get(key);
    if (!entry) return;
    const start = Date.now();
    await this.persistEntry(key, entry);
    const duration = Date.now() - start;
    this.recordPersistDuration(duration);
  }

  isBusy(): boolean {
    return this.persistQueue.size > 0 || this.runningTasks > 0;
  }

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
}
