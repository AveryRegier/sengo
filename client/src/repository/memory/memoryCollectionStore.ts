import type { CollectionStore } from '../index';
import { ObjectId } from 'bson';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex } from '../collectionIndex';
import { MongoClientClosedError } from '../../errors.js';
import { FindCursor, WithId } from '../../types';

export class MemoryCollectionIndex extends BaseCollectionIndex implements CollectionIndex {
  // Inherits removeDocument from BaseCollectionIndex

  async findIdsForKey(key: string): Promise<string[]> {
    let entry = await this.fetch(key);
    // logger is not available here; consider injecting if needed for debug
    return entry.toArray();
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

  findCandidates(query: Record<string, any>): Promise<WithId<T>[]> {
    this.checkClosure();
    return Promise.resolve(this.documents.map(a=>a) as WithId<T>[]);
  }
  // find(query: Record<string, any>): FindCursor<WithId<T>> {
  //   this.checkClosure();
  //   const results = this.documents.filter(doc => {
  //     return Object.entries(query).every(([k, v]) => {
  //       if (typeof v === 'object' && v !== null && '$in' in v) {
  //         // $in operator support
  //         return v.$in.includes(doc[k]);
  //       } else {
  //         return doc[k]?.toString() === v?.toString();
  //       }
  //     });
  //   });
  //   return new ConsumingArrayCursor<WithId<T>>(results);
  // }

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
