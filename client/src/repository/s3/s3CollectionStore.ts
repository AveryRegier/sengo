import type { CollectionIndex } from '../collectionIndex';
import { S3CollectionIndex } from './s3CollectionIndex';
import type { CollectionStore } from '../';
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
    return s3Index;
  }

  async close() {
    this.closed = true;
  }
}
