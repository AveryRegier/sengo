import { CollectionStore } from '../index';

export class MemoryCollectionStore implements CollectionStore {
  private documents: Record<string, any>[] = [];
  name: string;
  constructor(name?: string) {
    this.name = name || '';
  }

  insertOne(doc: Record<string, any>) {
    const _id = Math.random().toString(36).slice(2);
    const document = { ...doc, _id };
    this.documents.push(document);
    return { acknowledged: true, insertedId: _id };
  }

  find(query: Record<string, any>) {
    return this.documents.filter(doc => {
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
  }
}
