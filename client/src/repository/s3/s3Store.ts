import type { CollectionStore } from '../index';
import { S3CollectionStore } from './s3CollectionStore';

export class S3Store {
  private bucket: string;
  private stores: Record<string, S3CollectionStore> = {};
  private closed = false;

  constructor(bucket: string = 'sengo-default-bucket') {
    this.bucket = bucket;
  }

  collection(name: string): CollectionStore {
    if (this.closed) throw new Error('Store is closed');
    if (!this.stores[name]) {
      this.stores[name] = new S3CollectionStore(name, this.bucket);
    }
    return this.stores[name] as CollectionStore;
  }

  async close() {
    this.closed = true;
    for (const store of Object.values(this.stores)) {
      if (typeof (store as any).close === 'function') {
        await (store as any).close();
      }
    }
  }
}
