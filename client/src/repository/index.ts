import { Order } from '../types';
import { CollectionIndex } from './collectionIndex';
import { MemoryStore } from './memory/index';
import { S3Store } from './s3/index';

// Export memory and S3 stores
export { MemoryStore, MemoryCollectionStore } from './memory/index';
export { S3Store, S3CollectionStore, S3CollectionIndex } from './s3/index';
export type { CollectionIndex } from './collectionIndex';
export * from './collectionIndex';


export type NormalizedIndexKeyRecord = { field: string, order: Order };

export interface CollectionStore {
  replaceOne(filter: Record<string, any>, doc: Record<string, any>): Promise<void>;
  find(query: Record<string, any>): Promise<Record<string, any>[]> | Record<string, any>[];
  createIndex(name: string, keys: NormalizedIndexKeyRecord[]): Promise<CollectionIndex>;
  dropIndex(name: string): Promise<void>;
  /**
   * Delete a document by _id. Must be implemented by all stores.
   */
  deleteOneById(id: any): Promise<void>;
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
