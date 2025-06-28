import { MemoryStore } from './memory/index.js';
import { S3Store } from './s3/s3Store.js';

export interface CollectionStore {
  insertOne(doc: Record<string, any>): Promise<{ acknowledged: boolean; insertedId: string }> | { acknowledged: boolean; insertedId: string };
  find(query: Record<string, any>): Promise<Record<string, any>[]> | Record<string, any>[];
}

export interface DbStore {
  collection(name: string): CollectionStore;
  close(): Promise<void>;
}

export function createRepository(name: string): DbStore {
  if (name !== 'memory') {
    return new S3Store(name);
  } else {  
    return new MemoryStore();
  }
}
