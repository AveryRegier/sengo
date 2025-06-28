import type { CollectionStore } from '../repository/index';

export class SengoCollection {
  name: string;
  store: CollectionStore;
  static collections: Record<string, SengoCollection> = {};

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
