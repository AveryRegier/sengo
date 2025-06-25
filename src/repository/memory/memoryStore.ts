import { CollectionStore, DbStore } from '../index';
import { MemoryCollectionStore } from './memoryCollectionStore';

export class MemoryStore implements DbStore {
  private stores: Record<string, MemoryCollectionStore> = {};

  collection(name: string): CollectionStore {
    if (!this.stores[name]) {
      this.stores[name] = new MemoryCollectionStore(name);
    }
    return this.stores[name];
  }
}
