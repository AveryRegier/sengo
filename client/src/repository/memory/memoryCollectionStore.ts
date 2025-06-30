import type { CollectionStore } from '../index';
import { ObjectId } from 'bson';
import type { CollectionIndex } from '../collectionIndex';
import { BaseCollectionIndex } from '../collectionIndex';

export class MemoryCollectionIndex extends BaseCollectionIndex implements CollectionIndex {
  // In-memory index implementation
}

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  name: string;
  private closed = false;
  constructor(name?: string) {
    this.name = name || '';
  }

  async insertOne(doc: Record<string, any>) {
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.replaceOne({ _id: docWithId._id }, docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  private checkClosure() {
    if (this.closed) throw new Error('Store is closed');
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

  async close() {
    this.closed = true;
  }

  isClosed() {
    return this.closed;
  }

  async createIndex(name: string, keys: { field: string, order: 1 | -1 | 'text' }[]): Promise<CollectionIndex> {
    // For demo, just return a new MemoryCollectionIndex
    return new MemoryCollectionIndex(name, keys);
  }
}
