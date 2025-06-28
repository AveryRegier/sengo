import type { CollectionStore } from '../index';
import { ObjectId } from 'bson';

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  name: string;
  private closed = false;
  constructor(name?: string) {
    this.name = name || '';
  }

  insertOne(doc: Record<string, any>) {
    this.checkClosure();
    const _id = doc._id || new ObjectId();
    const document = { ...doc, _id };
    this.documents.push(document);
    return { acknowledged: true, insertedId: _id };
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

  async close() {
    this.closed = true;
  }
}
