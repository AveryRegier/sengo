import type { CollectionStore } from '../index.js';

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  name: string;
  private closed = false;
  constructor(name?: string) {
    this.name = name || '';
  }

  insertOne(doc: Record<string, any>) {
    this.checkClosure();
    const _id = Math.random().toString(36).slice(2);
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
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
  }

  async close() {
    this.closed = true;
  }
}
