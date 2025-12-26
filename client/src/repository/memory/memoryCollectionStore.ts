import type { CollectionStore } from '../index';
import { ObjectId } from 'bson';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex } from '../collectionIndex';
import { MongoClientClosedError } from '../../errors.js';
import { FindCursor, WithId } from '../../types';

export class MemoryCollectionIndex extends BaseCollectionIndex implements CollectionIndex {
  private entries: Map<string, any> = new Map(); // Map from index key to IndexEntry

  // Override fetch to return from memory
  protected async fetch(key: string): Promise<any> {
    const entry = this.entries.get(key);
    if (entry) {
      return entry;
    }
    // Return new entry if not found
    const newEntry = this.createEntry();
    this.entries.set(key, newEntry);
    return newEntry;
  }

  async findIdsForKey(key: string, options?: Record<string, any>): Promise<string[]> {
    let entry = await this.fetch(key);
    // logger is not available here; consider injecting if needed for debug
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
   */
  private findBestIndex(query: Record<string, any>): MemoryCollectionIndex | undefined {
    let bestIndex: MemoryCollectionIndex | undefined;
    let bestScore = 0;
    for (const index of this.indexes.values()) {
      const score = index.scoreForQuery(query);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  async findCandidates(query: Record<string, any>): Promise<WithId<T>[]> {
    this.checkClosure();
    
    // Try to use an index if available
    const index = this.findBestIndex(query);
    if (index) {
      const indexKeys = index.findKeysForQuery(query);
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
        for (const key of indexKeys) {
          const ids = await index.findIdsForKey(key, indexOptions);
          ids.forEach(id => idsSet.add(id));
        }
        
        // Return documents with matching IDs
        return this.documents.filter(doc => 
          doc._id && idsSet.has(doc._id.toString())
        ) as WithId<T>[];
      }
    }
    
    // No index available, return all documents for filtering
    return Promise.resolve(this.documents.map(a=>a) as WithId<T>[]);
  }

  updateOne(filter: Record<string, any>, doc: Record<string, any>) {
    this.checkClosure();
    // Only support update by _id for now
    const idx = this.documents.findIndex(d => d._id?.toString() === filter._id?.toString());
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    this.documents[idx] = { ...doc } as WithId<T> & { [key: string]: any };
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async replaceOne(filter: Record<string, any>, doc: Record<string, any>) {
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
