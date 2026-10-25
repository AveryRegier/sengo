import { FindOptions } from '../client/collection';
import { ExplainSink } from '../client/explain';
import { FindCursor, Order, WithId } from '../types';
import { CollectionIndex } from './collectionIndex';
import { MemoryStore } from './memory/index';
import { S3Store } from './s3/index';

// Export memory and S3 stores
export { MemoryStore, MemoryCollectionStore } from './memory/index';
export { S3Store, S3CollectionStore, S3CollectionIndex } from './s3/index';
export type { CollectionIndex } from './collectionIndex';
export * from './collectionIndex';


export type NormalizedIndexKeyRecord = { field: string, order: Order };

export type CandidateLoadMode = 'idLookup' | 'indexLookup' | 'scan';

export type CandidateLoadRequest<T> = {
  keys: string[];
  mode: CandidateLoadMode;
  canUseKeysAsResult: boolean;
  indexName?: string;
  loadDefault: () => Promise<WithId<T>[]>;
};

export type CandidateLoadDocuments<T> = (request: CandidateLoadRequest<T>) => Promise<WithId<T>[]>;

export interface CollectionStore<T> {
  getIndexes(): Promise<Map<string, CollectionIndex>>;
  close(): Promise<void>;
  createIndex(name: string, keys: NormalizedIndexKeyRecord[]): Promise<CollectionIndex>;
  deleteOne(id: any): Promise<void>;
  dropIndex(name: string): Promise<void>;
  findCandidates(query: Record<string, any>, options?: FindOptions, sink?: ExplainSink, loadDocuments?: CandidateLoadDocuments<T>): Promise<WithId<T>[]>
  isClosed(): boolean;
  loadRecordWithETag(id: any): Promise<{ doc: WithId<T>; etag: string } | null>;
  replaceOne(filter: Record<string, any>, doc: Record<string, any>, options?: { ifMatch?: string; ifNoneMatch?: string }): Promise<void>;
  replaceOneWithRetry(id: any, applyUpdate: (current: WithId<T>) => WithId<T>, validateFilter?: (doc: WithId<T>) => boolean): Promise<void>;
}


export interface DbStore {
  readonly name: string;
  collection<T>(name: string): CollectionStore<T>;
  close(): Promise<void>;
  isClosed(): boolean;
}

export function createRepository(name: string): DbStore {
  if (name !== 'memory') {
    return new S3Store(name);
  } else {
    return new MemoryStore();
  }
}
