import type { CandidateLoadDocuments, CollectionStore } from '../index';
import { ObjectId } from 'bson';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex } from '../collectionIndex';
import { MongoClientClosedError } from '../../errors.js';
import { FindCursor, WithId } from '../../types';
import { ExplainSink } from '../../client/explain';

export class MemoryCollectionIndex extends BaseCollectionIndex implements CollectionIndex {
  private entries: Map<string, any> = new Map(); // Map from index key to IndexEntry

  // Override fetch to return from memory
  protected async fetch(key: string, sink?: ExplainSink): Promise<any> {
    const entry = this.entries.get(key);
    if (entry) {
      sink?.onCacheEvent('index', this.name, this.name, 'file', 'hit');
      return entry;
    }
    sink?.onCacheEvent('index', this.name, this.name, 'file', 'miss');
    const newEntry = this.createEntry();
    this.entries.set(key, newEntry);
    return newEntry;
  }

  async findIdsForKey(key: string, options?: Record<string, any>, sink?: ExplainSink): Promise<string[]> {
    let entry = await this.fetch(key, sink);
    return entry.toArray(options);
  }
}

export class MemoryCollectionStore<T> implements CollectionStore<T> {
  // Expose last created index for testing
  public lastIndexInstance?: MemoryCollectionIndex;
  private documents: (WithId<T> & { [key: string]: any })[] = [];
  name: string;
  private closed = false;
  private indexes: Map<string, MemoryCollectionIndex> = new Map();

  constructor(name?: string) {
    this.name = name || '';
  }

  async getIndexes(): Promise<Map<string, CollectionIndex>> {
      return Promise.resolve(this.indexes as Map<string, CollectionIndex>) ;
  }

  async insertOne(doc: Record<string, any>) {
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.replaceOne({ _id: docWithId._id }, docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  private checkClosure() {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
  }

  /**
   * Find the best matching index for the query.
   * Uses the index scoring logic from the base class.
   * Prefers indexes that match both query fields and sort fields.
   */
  private findBestIndex(query: Record<string, any>, options?: any, sink?: ExplainSink): MemoryCollectionIndex | undefined {
    let bestIndex: MemoryCollectionIndex | undefined;
    let bestScore = 0;
    for (const index of this.indexes.values()) {
      const score = index.scoreForQuery(query, options, sink);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  async findCandidates(query: Record<string, any>, options?: any, sink?: ExplainSink, _loadDocuments?: CandidateLoadDocuments<T>): Promise<WithId<T>[]> {
    this.checkClosure();
    const loadDocuments = _loadDocuments;
    
    // Try to use an index if available
    const index = this.findBestIndex(query, options, sink);
    if (index) {
      const indexKeys = index.findKeysForQuery(query, sink);
      // If findKeysForQuery returns empty array, index can't be used (missing required fields)
      if (indexKeys.length > 0) {
        // Build index options including filters for the final indexed field if present in query
        const indexOptions: any = {};
        if (index.keys.length > 1) {
          const finalField = index.keys[index.keys.length - 1].field;
          if (query[finalField] !== undefined) {
            // Add the final field filter to options so IndexEntry.toArray can filter
            indexOptions[finalField] = typeof query[finalField] === 'object'
              ? query[finalField]
              : { $eq: query[finalField] };
          }
        }
        
        const idsSet = new Set<string>();
        
        // Collect all matching IDs from index
        let entryFilesRead = 0;
        let candidateIds = 0;
        const keyLookupStartMs = Date.now();
        for (const key of indexKeys) {
          entryFilesRead += 1;
          const ids = await index.findIdsForKey(key, indexOptions, sink);
          candidateIds += ids.length;
          ids.forEach(id => idsSet.add(id));
        }
        sink?.onTimingPart('indexEntryRead', Date.now() - keyLookupStartMs, entryFilesRead);

        sink?.onIndexEntriesRead(index.name, entryFilesRead, candidateIds, idsSet.size);
        sink?.onPlanWinner('INDEX_LOOKUP', index.name);
        const keys = Array.from(idsSet);
        const loadDefault = async () => this.documents.filter(doc => 
          doc._id && idsSet.has(doc._id.toString())
        ) as WithId<T>[];

        if (loadDocuments) {
          return loadDocuments({
            keys,
            mode: 'indexLookup',
            canUseKeysAsResult: false,
            indexName: index.name,
            loadDefault,
          });
        }

        return loadDefault();
      }
    }

    sink?.onPlanWinner('COLLECTION_SCAN', undefined, 'No usable index for query');
    const scanStartedAtMs = Date.now();
    const scanDocs = this.documents.map(a => a) as WithId<T>[];
    const scanKeys = scanDocs.map(doc => `${doc._id}`);
    const docs = loadDocuments
      ? await loadDocuments({
        keys: scanKeys,
        mode: 'scan',
        canUseKeysAsResult: false,
        loadDefault: async () => scanDocs,
      })
      : scanDocs;
    sink?.onTimingPart('scan', Date.now() - scanStartedAtMs, docs.length);
    return Promise.resolve(docs);
  }

  updateOne(filter: Record<string, any>, doc: Record<string, any>) {
    this.checkClosure();
    // Only support update by _id for now
    const idx = this.documents.findIndex(d => d._id?.toString() === filter._id?.toString());
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    this.documents[idx] = { ...doc } as WithId<T> & { [key: string]: any };
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async replaceOne(filter: Record<string, any>, doc: Record<string, any>, options?: { ifMatch?: string; ifNoneMatch?: string }) {
    const idx = this.documents.findIndex(d => d._id === (filter._id ?? doc._id));
    if (idx !== -1) {
      this.documents[idx] = { ...doc } as WithId<T> & { [key: string]: any };
    } else {
      this.documents.push({ ...doc } as WithId<T> & { [key: string]: any });
    }
    return Promise.resolve();
  }

  /**
   * Deletes a document by _id.
   * @param id Document _id
   */
  async deleteOne(doc: WithId<T>): Promise<void> {
    this.checkClosure();
    const idx = this.documents.findIndex(d => d._id?.toString() === doc._id?.toString());
    if (idx === -1) return;
    const [removed] = this.documents.splice(idx, 1);
  }

  /**
   * Loads a document by _id with an ETag for conditional writes.
   * For memory backend, we generate a stable ETag from the document content hash.
   * @param id Document _id
   * @returns { doc, etag } or null if not found
   */
  async loadRecordWithETag(id: any): Promise<{ doc: WithId<T>; etag: string } | null> {
    this.checkClosure();
    const doc = this.documents.find(d => d._id?.toString() === id?.toString());
    if (!doc) {
      return null;
    }
    // For memory store, generate a stable ETag based on JSON hash
    const etag = Buffer.from(JSON.stringify(doc)).toString('base64').substring(0, 32);
    return { doc: { ...doc }, etag };
  }

  async close() {
    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }


  async createIndex(name: string, keys: { field: string, order: 1 | -1 | 'text' }[]): Promise<CollectionIndex> {
    this.checkClosure();
    const index = new MemoryCollectionIndex(name, keys);
    // Add all current documents to the index
    for (const doc of this.documents) {
      await index.addDocument(doc);
    }
    this.indexes.set(name, index);
    this.lastIndexInstance = index;
    return index;
  }

  /**
   * Get an index by name (for testing only)
   */
  getIndex(name: string): MemoryCollectionIndex | undefined {
    return this.indexes.get(name);
  }

  async dropIndex(name: string): Promise<void> {
    this.checkClosure();
    this.indexes.delete(name);
  }
}

class ConsumingArrayCursor<T> implements FindCursor<T> {
  private _docs: T[];
  private _index: number;
  private _closed: boolean;

  constructor(docs: T[]) {
    this._docs = docs;
    this._index = 0;
    this._closed = false;
  }

  /**
   * Returns the next document in the cursor, or null if exhausted.
   */
  async next(): Promise<T | null> {
    if (this._closed) throw new Error('Cursor is closed');
    if (this._index < this._docs.length) {
      return this._docs[this._index++];
    }
    return null;
  }

  /**
   * Returns all remaining documents as an array.
   */
  async toArray(): Promise<T[]> {
    if (this._closed) throw new Error('Cursor is closed');
    const remaining = this._docs.slice(this._index);
    this._index = this._docs.length;
    return remaining;
  }

  /**
   * Closes the cursor.
   */
  async close(): Promise<void> {
    this._closed = true;
  }

  /**
   * Returns true if there are more documents.
   */
  async hasNext(): Promise<boolean> {
    return !this._closed && this._index < this._docs.length;
  }

  /**
   * For async iteration: for await (const doc of cursor) { ... }
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<any, void, unknown> {
    let doc;
    while ((doc = await this.next()) !== null) {
      yield doc;
    }
  }
}
