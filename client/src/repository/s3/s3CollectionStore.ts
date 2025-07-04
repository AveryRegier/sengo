import { MongoClientClosedError, MongoInvalidArgumentError, MongoServerError } from '../../errors.js'; // Import MongoDB error classes
// (stray dropIndex removed, now only in class body)
import type { CollectionIndex } from '../collectionIndex';
import { S3CollectionIndex } from './s3CollectionIndex';
import type { CollectionStore } from '../';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export interface S3CollectionStoreOptions {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export class S3CollectionStore implements CollectionStore {
  private s3: S3Client;
  private bucket: string;
  private collection: string;
  private closed = false;
  private loadedIndexes: Map<string, S3CollectionIndex> = new Map();
  private indexesLoaded: boolean = false;

  constructor(collection: string, bucket: string, opts?: S3CollectionStoreOptions) {
    this.bucket = bucket;
    this.collection = collection;
    this.s3 = new S3Client({
      ...(opts?.region ? { region: opts.region } : {}),
      ...(opts?.credentials ? { credentials: opts.credentials } : {}),
    });
  }

  async dropIndex(name: string): Promise<void> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    await this.ensureIndexesLoaded();
    // Delete index metadata file
    const metaKey = `${this.collection}/indices/${name}.json`;
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: metaKey,
    }));
    // List and delete all entry files under the index prefix
    const prefix = `${this.collection}/indices/${name}/`;
    const listed = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    }));
    if (listed.Contents) {
      for (const obj of listed.Contents) {
        await this.s3.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: obj.Key,
        }));
      }
    }
    // Remove from loadedIndexes
    this.loadedIndexes.delete(name);
  }

  isClosed() {
    return this.closed;
  }

  private async ensureIndexesLoaded() {
    if (!this.indexesLoaded) {
      await this.loadIndexes();
      this.indexesLoaded = true;
    }
  }

  async replaceOne(filter: Record<string, any>, doc: Record<string, any>) {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    const _id = filter._id ?? doc._id;
    if (!_id) throw new MongoInvalidArgumentError('replaceOne requires _id');
    const key = `${this.collection}/data/${_id}.json`;
    const body = JSON.stringify(doc);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }));
    // No MongoDB-style response here; just return void
  }

  /**
   * Deletes a document by _id from S3.
   * @param id Document _id
   */
  async deleteOneById(id: any): Promise<void> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (!id) throw new MongoInvalidArgumentError('deleteOneById requires id');
    const key = `${this.collection}/data/${id}.json`;
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    // Remove from all indexes
    await this.ensureIndexesLoaded();
    for (const index of this.loadedIndexes.values()) {
      await index.removeIdFromAllKeys(id);
    }
  }

  /**
   * Find the best matching index for the query based on NormalizedIndexKeyRecord.
   * Only the first key in the index must be present in the query to use the index.
   */
  private findBestIndex(query: Record<string, any>): S3CollectionIndex | undefined {
    let bestIndex: S3CollectionIndex | undefined;
    let bestScore = 0;
    for (const index of this.loadedIndexes.values()) {
      // Only consider indexes where the first key is present in the query
      if (index.keys.length > 0 && query.hasOwnProperty(index.keys[0].field)) {
        // Score: number of consecutive keys matched from the start
        let score = 1;
        for (let i = 1; i < index.keys.length; i++) {
          if (query.hasOwnProperty(index.keys[i].field)) {
            score++;
          } else {
            break;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
    }
    return bestIndex;
  }

  async find(query: Record<string, any>) {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    await this.ensureIndexesLoaded();
    // Select the best matching index (first key must match)
    const index = this.findBestIndex(query);
    if (index) {
      // Use the index's key generation to build the correct key for the query
      const key = (typeof (index as any).getIndexKeyForQuery === 'function')
        ? (index as any).getIndexKeyForQuery(query)
        : (index as any).makeIndexKey(query);
      let ids: string[] = [];
      try {
        ids = await index.findIdsForKey(key);
      } catch (err: any) {
        if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
          throw new MongoNetworkError(err.message || 'Network error');
        }
        if (typeof err === 'string') {
          throw new MongoNetworkError(err);
        }
        throw err;
      }
      const docs: any[] = [];
      for (const id of ids) {
        const docKey = `${this.collection}/data/${id}.json`;
        try {
          const result = await this.s3.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: docKey,
          }));
          if (!result || !result.Body) throw Object.assign(new MongoServerError('Not found'), { name: 'NoSuchKey' });
          const stream = result.Body as Readable;
          const data = await new Promise<string>((resolve, reject) => {
            let str = '';
            stream.on('data', chunk => (str += chunk));
            stream.on('end', () => resolve(str));
            stream.on('error', reject);
          });
          docs.push(JSON.parse(data));
        } catch (err: any) {
          if (err.name === 'NoSuchKey') continue;
          if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
            throw new MongoNetworkError(err.message || 'Network error');
          }
          // If the error is a string (e.g., 'connect ETIMEDOUT'), wrap it as an Error object
          if (typeof err === 'string') {
            throw new MongoNetworkError(err);
          }
          if (err && typeof err.message === 'string' && /etimedout|network|timeout|econnrefused/i.test(err.message)) {
            throw new MongoNetworkError(err.message || 'Network error');
          }
          if (err && typeof err.toString === 'function' && /etimedout|network|timeout|econnrefused/i.test(err.toString())) {
            throw new MongoNetworkError(err.message || 'Network error');
          }
          throw err;
        }
      }
      return docs;
    }
    // Fallback: Only supports find by _id for now
    if (query._id) {
      const key = `${this.collection}/data/${query._id}.json`;
      try {
        const result = await this.s3.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }));
        if (!result || !result.Body) throw Object.assign(new MongoServerError('Not found'), { name: 'NoSuchKey' });
        const stream = result.Body as Readable;
        const data = await new Promise<string>((resolve, reject) => {
          let str = '';
          stream.on('data', chunk => (str += chunk));
          stream.on('end', () => resolve(str));
          stream.on('error', reject);
        });
        return [JSON.parse(data)];
      } catch (err: any) {
        // Debug logging for test failure analysis
        // eslint-disable-next-line no-console
        console.error('[S3CollectionStore.find] Caught error for _id query:', err, 'name:', err?.name, 'message:', err?.message, 'stack:', err?.stack);
        if (err.name === 'NoSuchKey') return [];
        if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
          throw new MongoNetworkError(err.message || 'Network error');
        }
        // If the error is a string (e.g., 'connect ETIMEDOUT'), wrap it as an Error object
        if (typeof err === 'string') {
          throw new MongoNetworkError(err);
        }
        if (err && typeof err.message === 'string' && /etimedout|network|timeout|econnrefused/i.test(err.message)) {
          throw new MongoNetworkError(err.message || 'Network error');
        }
        if (err && typeof err.toString === 'function' && /etimedout|network|timeout|econnrefused/i.test(err.toString())) {
          throw new MongoNetworkError(err.message || 'Network error');
        }
        throw err;
      }
    }
    // Fallback: list all objects (inefficient, for demo only)
    const prefix = `${this.collection}/data/`;
    let listed;
    try {
      listed = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }));
      if (!listed || !listed.Contents) return [];
    } catch (err: any) {
      if (err.name === 'NoSuchBucket') return [];
      if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
      throw err;
    }
    const results: any[] = [];
    for (const obj of listed.Contents) {
      const key = obj.Key!;
      try {
        const result = await this.s3.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }));
        if (!result || !result.Body) throw Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
        const stream = result.Body as Readable;
        const data = await new Promise<string>((resolve, reject) => {
          let str = '';
          stream.on('data', chunk => (str += chunk));
          stream.on('end', () => resolve(str));
          stream.on('error', reject);
        });
        const parsed = JSON.parse(data);
        // Only push if parsed is an object and has _id
        if (parsed && typeof parsed === 'object' && parsed._id !== undefined) {
          if (Object.entries(query).every(([k, v]) => parsed[k]?.toString() === v?.toString())) {
            results.push(parsed);
          }
        }
      } catch (err) {
        // Skip this document if any error occurs (missing, invalid JSON, etc)
        continue;
      }
    }
    return results;
  }

  /**
   * Helper to build an index by adding all current documents to it.
   */
  private async buildIndex(index: { addDocument: (doc: Record<string, any>) => Promise<void> }) {
    const allDocs = await this.find({});
    for (const doc of allDocs) {
      await index.addDocument(doc);
    }
  }

  async createIndex(name: string, keys: { field: string, order: 1 | -1 | 'text' }[]): Promise<CollectionIndex> {
    if (this.closed) throw new Error('Store is closed');
    // 1. Create and persist the index metadata file
    const index = { name, keys };
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${this.collection}/indices/${name}.json`,
      Body: JSON.stringify(index),
      ContentType: 'application/json',
    }));
    // 2. Build the index by finding all records and adding them
    const s3Index = new S3CollectionIndex(name, keys, {
      s3: this.s3,
      collectionName: this.collection,
      bucket: this.bucket,
    });
    await this.buildIndex(s3Index);
    // Expose last created index instance for test synchronization
    (this as any).lastIndexInstance = s3Index;
    // Do not manually persist all index entries here
    this.loadedIndexes.set(name, s3Index);
    return s3Index;
  }

  /**
   * List all index metadata files for this collection and load index definitions.
   */
  async loadIndexes(): Promise<void> {
    const prefix = `${this.collection}/indices/`;
    const listed = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    }));
    if (!listed.Contents) return;
    for (const obj of listed.Contents) {
      const key = obj.Key!;
      // Only load index metadata files, not entry files
      // Metadata files are of the form: {collection}/indices/{indexName}.json (no further slashes after /indices/)
      const rel = key.slice((`${this.collection}/indices/`).length);
      if (key.endsWith('.json') && !rel.includes('/')) {
        const result = await this.s3.send(new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }));
        const stream = result.Body as Readable;
        const data = await new Promise<string>((resolve, reject) => {
          let str = '';
          stream.on('data', chunk => (str += chunk));
          stream.on('end', () => resolve(str));
          stream.on('error', reject);
        });
        const meta = JSON.parse(data);
        const indexName = meta.name;
        const keys = meta.keys;
        if (!this.loadedIndexes.has(indexName)) {
          this.loadedIndexes.set(indexName, new S3CollectionIndex(indexName, keys, {
            s3: this.s3,
            collectionName: this.collection,
            bucket: this.bucket,
          }));
        }
      }
    }
  }

  /**
   * Get or load an S3CollectionIndex for a given index name.
   */
  getIndex(name: string): S3CollectionIndex | undefined {
    return this.loadedIndexes.get(name);
  }

  async close() {
    this.closed = true;
  }
}

// Simulate a MongoDB network error
export class MongoNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MongoNetworkError';
  }
}
