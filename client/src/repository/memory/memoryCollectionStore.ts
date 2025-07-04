import type { CollectionStore } from '../index';
import { notImplementedMongo } from '../../utils';
import { ObjectId } from 'bson';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex } from '../collectionIndex';
import { MongoClientClosedError } from '../../errors.js';
export class MemoryCollectionIndex extends BaseCollectionIndex implements CollectionIndex {
  // Inherits removeDocument from BaseCollectionIndex

  async findIdsForKey(key: string): Promise<string[]> {
    let entry = this.indexMap.get(key);
    if (!entry) {
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
    }
    console.log(`[MemoryCollectionIndex.findIdsForKey] key='${key}', ids=[${entry.toArray().join(',')}]`);
    return entry.toArray();
  }
}

export class MemoryCollectionStore implements CollectionStore {

  // Expose last created index for testing
  public lastIndexInstance?: MemoryCollectionIndex;
  private documents: Record<string, any>[] = [];
  name: string;
  private closed = false;
  private indexes: Map<string, MemoryCollectionIndex> = new Map();
  constructor(name?: string) {
    this.name = name || '';
  }

  async insertOne(doc: Record<string, any>) {
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.replaceOne({ _id: docWithId._id }, docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  private checkClosure() {
    if (this.closed) throw new MongoClientClosedError('Store is closed');
  }

  find(query: Record<string, any>) {
    this.checkClosure();
    return this.documents.filter(doc => {
      return Object.entries(query).every(([k, v]) => doc[k]?.toString() === v?.toString());
    });
  }

  updateOne(filter: Record<string, any>, doc: Record<string, any>) {
    this.checkClosure();
    // Only support update by _id for now
    const idx = this.documents.findIndex(d => d._id?.toString() === filter._id?.toString());
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    this.documents[idx] = { ...doc };
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async replaceOne(filter: Record<string, any>, doc: Record<string, any>) {
    const idx = this.documents.findIndex(d => d._id === (filter._id ?? doc._id));
    if (idx !== -1) {
      this.documents[idx] = { ...doc };
    } else {
      this.documents.push({ ...doc });
    }
    return Promise.resolve();
  }

  /**
   * Deletes a document by _id.
   * @param id Document _id
   */
  async deleteOneById(id: any): Promise<void> {
    this.checkClosure();
    const idx = this.documents.findIndex(d => d._id?.toString() === id?.toString());
    if (idx === -1) return;
    const [removed] = this.documents.splice(idx, 1);
    // Remove from all indexes
    for (const index of this.indexes.values()) {
      if (typeof index.removeDocument === 'function') {
        await index.removeDocument(removed);
      }
    }
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
