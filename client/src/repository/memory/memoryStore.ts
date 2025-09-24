import type { CollectionStore, DbStore } from '../index';
import { MemoryCollectionStore } from './memoryCollectionStore';
import { MongoClientClosedError } from '../../errors.js';

export class MemoryStore implements DbStore {
  readonly name: string = 'memory';
  private stores: Record<string, MemoryCollectionStore<any>> = {};
  private closed = false;

  collection<T>(name: string): CollectionStore<T> {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
    if (!this.stores[name]) {
      this.stores[name] = new MemoryCollectionStore(name);
    }
    return this.stores[name];
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close() {
    this.closed = true;
    for (const store of Object.values(this.stores)) {
      if (typeof (store as any).close === 'function') {
        await (store as any).close();
      }
    }
    this.stores = {}; // Remove all store objects to start fresh
  }
}
