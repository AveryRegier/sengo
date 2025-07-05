import type { CollectionStore, DbStore } from '../index';
import { S3CollectionStore } from './s3CollectionStore';
import { MongoClientClosedError } from '../../errors.js';

export class S3Store implements DbStore {
  private bucket: string;
  private stores: Record<string, S3CollectionStore<any>> = {};
  private closed = false;

  constructor(bucket: string = 'sengo-db') {
    this.bucket = bucket;
  }

  collection<T>(name: string): CollectionStore<T> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (!this.stores[name]) {
      this.stores[name] = new S3CollectionStore(name, this.bucket);
    }
    return this.stores[name] as CollectionStore<T>;
  }

  async close() {
    this.closed = true;
    for (const store of Object.values(this.stores)) {
      await store.close();
    }
    this.stores = {};
  }
}
