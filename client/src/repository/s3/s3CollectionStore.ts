import type { CollectionIndex } from '../collectionIndex';
import type { CollectionStore, IndexDefinition, IndexKeyRecord, NormalizedIndexKeyRecord, Order } from '../';
import { ObjectId } from 'bson';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
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

  constructor(collection: string, bucket: string, opts?: S3CollectionStoreOptions) {
    this.bucket = bucket;
    this.collection = collection;
    this.s3 = new S3Client({
      ...(opts?.region ? { region: opts.region } : {}),
      ...(opts?.credentials ? { credentials: opts.credentials } : {}),
    });
  }

  isClosed() {
    return this.closed;
  }

  async replaceOne(filter: Record<string, any>, doc: Record<string, any>) {
    if (this.closed) throw new Error('Store is closed');
    const _id = filter._id ?? doc._id;
    if (!_id) throw new Error('replaceOne requires _id');
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

  async find(query: Record<string, any>) {
    if (this.closed) throw new Error('Store is closed');
    // Only supports find by _id for now
    if (query._id) {
      const key = `${this.collection}/data/${query._id}.json`;
      try {
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
        return [JSON.parse(data)];
      } catch (err: any) {
        if (err.name === 'NoSuchKey') return [];
        if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
          throw new Error('MongoNetworkError: failed to connect to server');
        }
        throw err;
      }
    }
    // For other queries, list all objects (inefficient, for demo only)
    const prefix = `${this.collection}/data/`;
    let listed;
    try {
      listed = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }));
    } catch (err: any) {
      if (err.name === 'NoSuchBucket') return [];
      throw err;
    }
    if (!listed.Contents) return [];
    const results: any[] = [];
    for (const obj of listed.Contents) {
      const key = obj.Key!;
      try {
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

  private normalizeIndexKeys(keys: IndexDefinition | IndexDefinition[]): NormalizedIndexKeyRecord[] {
    if (!keys) {
      throw new Error('Keys must be defined for creating an index');
    }
    let keysArray: IndexDefinition[];
    if (!Array.isArray(keys)) {
      keysArray = [keys];
    } else {
      keysArray = keys;
    }
    const normalizedKeys = keysArray.map((key) => {
      if (typeof key === 'string') {
        return [{ field: key, order: 1 as Order }];
      } else if (typeof key === 'object') {
        return Object.entries(key as IndexKeyRecord).map(([field, order]) => ({ field, order }));
      } else {
        throw new Error('Invalid index key format');
      }
    }).flat();
    return normalizedKeys;
  }

  async createIndex(name: string, keys: NormalizedIndexKeyRecord[]): Promise<CollectionIndex> {
    if (this.closed) throw new Error('Store is closed');
    // Use a plain object for legacy index file, not the CollectionIndex class
    const index = { name, keys };
    const key = `${this.collection}/indices/${name}.json`;
    const body = JSON.stringify(index);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }));
    // Return the plain object, not typed as CollectionIndex
    return index as any;
  }

  async close() {
    this.closed = true;
  }
}
