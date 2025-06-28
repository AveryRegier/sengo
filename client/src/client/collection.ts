import { CollectionStore } from '../repository';

export class SengoCollection {
  static collections: Record<string, SengoCollection> = {};
  private store: CollectionStore;
  name: string;
  constructor(name: string, store: CollectionStore) {
    this.name = name;
    this.store = store;
  }

  async insertOne(doc: Record<string, any>) {
    return this.store.insertOne(doc);
  }

  async find(query: Record<string, any>) {
    return this.store.find(query);
  }
}
