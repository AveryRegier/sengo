import type { CollectionStore, DbStore } from '../index';
import { S3CollectionStore } from './s3CollectionStore';
import { MongoClientClosedError } from '../../errors.js';

export class S3Store implements DbStore {
  readonly name: string;
  private bucket: string;
  private stores: Record<string, S3CollectionStore<any>> = {};
  // Default request handler shared across collections (optional)
  private defaultRequestHandler?: any;
  private closed = false;

  constructor(bucket: string = 'sengo-db') {
    this.bucket = bucket;
    this.name = bucket;
    // Try to lazily create a NodeHttpHandler with keep-alive enabled. This
    // is optional — if the package isn't installed we simply won't set a
    // shared handler and the SDK will use its default.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { NodeHttpHandler } = require('@aws-sdk/node-http-handler');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Agent } = require('https');
      this.defaultRequestHandler = new NodeHttpHandler({ httpsAgent: new Agent({ keepAlive: true }) });
    } catch (err) {
      // Optional package not available; leave defaultRequestHandler undefined
    }
  }

  collection<T>(name: string): CollectionStore<T> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (!this.stores[name]) {
      this.stores[name] = new S3CollectionStore(name, this.bucket, { requestHandler: this.defaultRequestHandler });
    }
    return this.stores[name] as CollectionStore<T>;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close() {
    this.closed = true;
    for (const store of Object.values(this.stores)) {
      await store.close();
    }
    this.stores = {};
  }
}
