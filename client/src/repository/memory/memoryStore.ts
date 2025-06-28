import { CollectionStore, DbStore } from '../index';
import { MemoryCollectionStore } from './memoryCollectionStore';

export class MemoryStore implements DbStore {
  private stores: Record<string, MemoryCollectionStore> = {};
  private closed = false;

  collection(name: string): CollectionStore {
    if (this.closed) throw new Error('Store is closed');
    if (!this.stores[name]) {
      this.stores[name] = new MemoryCollectionStore(name);
    }
    return this.stores[name];
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
