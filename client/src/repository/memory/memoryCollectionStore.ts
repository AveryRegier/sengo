import type { CollectionStore, NormalizedIndexKeyRecord } from '../index';

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  private indexes: Record<string, NormalizedIndexKeyRecord[]> = {};
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

  updateOne(query: { key: any }, update: { index: any[] }) {
    this.checkClosure();
    const doc = this.documents.find(d => d._id === query.key);
    if (doc) {
      doc.index = update.index;
      return doc; // Return the updated document
    }
    return null; // If no document matches the query
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

  async createIndex(name: string, keys: NormalizedIndexKeyRecord[]) {
    this.indexes[name] = keys;
    // Noop for now
    return new MemoryCollectionStore(this.name + '/indices/' + name);
  }
}
