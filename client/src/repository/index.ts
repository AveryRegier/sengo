import { MemoryStore } from './memory/index';
import { S3Store } from './s3/s3Store';
import type { CollectionIndex } from './collectionIndex';

export type Order = 1 | -1 | 'text';
export type IndexKeyRecord = Record<string, Order>;
export type IndexDefinition = string | IndexKeyRecord;
export type NormalizedIndexKeyRecord = { field: string, order: Order };

export interface CollectionStore {
  replaceOne(filter: Record<string, any>, doc: Record<string, any>): Promise<void>;
  find(query: Record<string, any>): Promise<Record<string, any>[]> | Record<string, any>[];
  createIndex(name: string, keys: NormalizedIndexKeyRecord[]): Promise<CollectionIndex>;
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

export * from './collectionIndex';

