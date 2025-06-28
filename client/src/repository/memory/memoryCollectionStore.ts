import type { CollectionStore } from '../index';

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  name: string;
  private closed = false;
  constructor(name?: string) {
    this.name = name || '';
  }

  insertOne(doc: Record<string, any>) {
    this.checkClosure();
    this.documents.push(doc);
    // No MongoDB-style response here; just return void
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

  async createIndex(keys: Record<string, any>, options?: Record<string, any>) {
    // Noop for now
    return;
  }
}
