import { CollectionStore } from '../index';
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

  async insertOne(doc: Record<string, any>) {
    if (this.closed) throw new Error('Store is closed');
    const _id = doc._id || Math.random().toString(36).slice(2);
    const key = `${this.collection}/data/${_id}.json`;
    const body = JSON.stringify({ ...doc, _id });
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }));
    return { acknowledged: true, insertedId: _id };
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
      if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
        throw new Error('MongoNetworkError: failed to connect to server');
      }
      throw err;
    }
    const results: any[] = [];
    if (listed.Contents) {
      for (const obj of listed.Contents) {
        if (!obj.Key) continue;
        let getObj;
        try {
          getObj = await this.s3.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: obj.Key,
          }));
        } catch (err: any) {
          if (err.name === 'NoSuchKey') continue;
          if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
            throw new Error('MongoNetworkError: failed to connect to server');
          }
          throw err;
        }
        const stream = getObj.Body as Readable;
        const data = await new Promise<string>((resolve, reject) => {
          let str = '';
          stream.on('data', chunk => (str += chunk));
          stream.on('end', () => resolve(str));
          stream.on('error', reject);
        });
        const parsed = JSON.parse(data);
        let match = true;
        for (const [k, v] of Object.entries(query)) {
          if (parsed[k] !== v) match = false;
        }
        if (match) results.push(parsed);
      }
    }
    return results;
  }

  async close() {
    this.closed = true;
  }
}
