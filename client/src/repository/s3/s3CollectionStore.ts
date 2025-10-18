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
  DeleteObjectCommand,
  GetObjectCommandOutput
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { WithId } from '../../types.js';
import { getLogger } from '../../client/logger.js';
import { get } from 'http';

export interface S3CollectionStoreOptions {
  region?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export class S3CollectionStore<T> implements CollectionStore<T> {
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

  async getIndexes(): Promise<Map<string, CollectionIndex>> {
    await this.ensureIndexesLoaded();
    return Promise.resolve(this.loadedIndexes) as Promise<Map<string, CollectionIndex>>;
  }

  async dropIndex(name: string): Promise<void> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    await this.ensureIndexesLoaded();
    // Delete index metadata file
    const metaKey = `${this.collection}/indices/${name}.json`;
    const args1 = {
      Bucket: this.bucket,
      Key: metaKey,
    };
    getLogger().debug(`Deleting index metadata from S3`, { command: "deleteObject", args: args1 });
    await this.s3.send(new DeleteObjectCommand(args1));
    // List and delete all entry files under the index prefix
    const prefix = `${this.collection}/indices/${name}/`;
    const args = {
      Bucket: this.bucket,
      Prefix: prefix,
    };
    getLogger().debug(`Listing objects from S3`, { command: "listObjectsV2", args });
    const listed = await this.s3.send(new ListObjectsV2Command(args));
    if (listed.Contents) {
      for (const obj of listed.Contents) {
        const args = {
          Bucket: this.bucket,
          Key: obj.Key,
        };
        getLogger().debug(`Deleting index entry from S3`, { command: "deleteObject", args });
        await this.s3.send(new DeleteObjectCommand(args));
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
    this.ensureIndexesLoaded();
    const _id = filter._id ?? doc._id;
    if (!_id) throw new MongoInvalidArgumentError('replaceOne requires _id');
    const key = this.id2key(_id);
    const body = JSON.stringify(doc);
    const args = {
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    };
    getLogger().debug(`Replacing document in S3`, { command: "putObject", args });
    await this.s3.send(new PutObjectCommand(args));
    // No MongoDB-style response here; just return void
  }

  /**
   * Deletes a document by _id from S3.
   * @param id Document _id
   */
  async deleteOne(doc: WithId<T>): Promise<void> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (!doc._id) throw new MongoInvalidArgumentError('deleteOne requires _id');
    const key = this.id2key(doc._id);
    const args = {
      Bucket: this.bucket,
      Key: key,
    };
    getLogger().debug(`Deleting document from S3`, { command: "deleteObject", args });
    await this.s3.send(new DeleteObjectCommand(args)).catch(err => {
      if (err.name === 'NoSuchKey') {
        // Document not found, no action needed
      } else {
        throw err;
      }
    });
  }

  private id2key(id: any) {
    return `${this.collection}/data/${id}.json`;
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

  public async findCandidates(query: Record<string, any>): Promise<WithId<T>[]> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (query._id) {
      const ids: string[] = [];
      if (query._id.$in) {
        query._id.$in.forEach((v: string) => ids.push(v));
      } else {
        ids.push(query._id);
      }
      return await this.loadTheseDocuments<T>(ids.map(this.id2key.bind(this)));
    }
    await this.ensureIndexesLoaded();
    let queryForIndex = combineOrConditions(query);
    const index = this.findBestIndex(queryForIndex);
    if (index) {
      const docsArrays = await Promise.all(
        index.findKeysForQuery(queryForIndex).map(async key => {
          const ids = (await index.findIdsForKey(key)).map(this.id2key.bind(this));
          return await this.loadTheseDocuments<T>(ids);
        })
      );
      return docsArrays.flat();

    }
    return this.scan();
  }

  private async loadRecordByKey(key: string): Promise<WithId<T> | null> {
    try {
      const args = {
        Bucket: this.bucket,
        Key: key,
      };
      getLogger().debug(`Fetching document from S3`, { command: "getObject", args });
      const result = await this.s3.send(new GetObjectCommand(args));
      if (!result || !result.Body) return null; //throw Object.assign(new MongoServerError('Not found'), { name: 'NoSuchKey' });
      const data = await getBodyAsString(result);
      return JSON.parse(data);
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
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

  /**
   * Scan the S3 bucket for all objects in the collection and filter by query.
   * This is a fallback if no index is available or the query cannot be satisfied by an index.
   */
  private async scan(): Promise<WithId<T>[]> {
    const prefix = `${this.collection}/data/`;
    let listed;
    try {
      const args = {
        Bucket: this.bucket,
        Prefix: prefix,
      };
      getLogger().debug(`Listing objects from S3`, { command: "listObjectsV2", args });
      listed = await this.s3.send(new ListObjectsV2Command(args));
      if (!listed || !listed.Contents) return [];
    } catch (err: any) {
      if (err.name === 'NoSuchBucket') return [];
      if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
        throw new MongoNetworkError(err.message || 'Network error');
      }
      throw err;
    }

    const keys = listed.Contents.map(obj => obj.Key!);

    return await this.loadTheseDocuments<T>(keys);
  }

  async createIndex(name: string, keys: { field: string, order: 1 | -1 | 'text' }[]): Promise<CollectionIndex> {
    if (this.closed) throw new Error('Store is closed');
    this.ensureIndexesLoaded();
    // 1. Create and persist the index metadata file
    const index = { name, keys };
    const args = {
      Bucket: this.bucket,
      Key: `${this.collection}/indices/${name}.json`,
      Body: JSON.stringify(index),
      ContentType: 'application/json',
    };
    getLogger().debug(`Creating index metadata in S3`, { command: "putObject", args });
    await this.s3.send(new PutObjectCommand(args));
    // 2. Build the index by finding all records and adding them
    const s3Index = new S3CollectionIndex(name, keys, {
      s3: this.s3,
      collectionName: this.collection,
      bucket: this.bucket,
    });
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
    const args = {
      Bucket: this.bucket,
      Prefix: prefix,
      Delimiter: '/'
    };
    getLogger().debug(`Listing objects from S3`, { command: "listObjectsV2", args });
    const listed = await this.s3.send(new ListObjectsV2Command(args));
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
        const data = await getBodyAsString(result);
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

  private async loadTheseDocuments<T>(keys: string[]): Promise<WithId<T>[]> {
    const docs = await Promise.all(keys.map(async key => {
      try {
        return await this.loadRecordByKey(key);
      } catch (err: any) {
        if (err.name === 'NoSuchKey') return null; // Not found
        throw err; // Re-throw other errors
      }
    }))
    // Filter out nulls (not found)
    return docs.filter(doc => doc !== null) as WithId<T>[];
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

function combineOrConditions(query: Record<string, any>) {
  let queryForIndex = query;
  if (queryForIndex.$or) {
    if (Array.isArray(queryForIndex.$or)) {
      // replace with reduce so we can handle combining property values
      queryForIndex = queryForIndex.$or.reduce((acc, curr) => {
        Object.keys(curr).forEach(key => {
          if (acc[key] === undefined) {
            acc[key] = curr[key];
          } else if (acc[key].$in) {
            acc[key].$in.push(curr[key]);
          } else {
            acc[key] = { $in: [acc[key], curr[key]] };
          }
        });
        return acc;
      }, { ...queryForIndex });
    }
  }
  return queryForIndex;
}

async function getBodyAsString(result: GetObjectCommandOutput): Promise<string> {
  const stream = result.Body as Readable;
  const data = await new Promise<string>((resolve, reject) => {
    let str = '';
    stream.on('data', chunk => (str += chunk));
    stream.on('end', () => resolve(str));
    stream.on('error', reject);
  });
  return data;
}
