import { MemoryStore } from './memory';

export interface CollectionStore {
  insertOne(doc: Record<string, any>): Promise<{ acknowledged: boolean; insertedId: string }> | { acknowledged: boolean; insertedId: string };
  find(query: Record<string, any>): Promise<Record<string, any>[]> | Record<string, any>[];
}

export interface DbStore {
  collection(name: string): CollectionStore;
}

const memoryStore = new MemoryStore();

export function getRepository(type: string = 'memory'): DbStore {
  switch (type) {
    case 'memory':
    default:
      return memoryStore;
  }
}
