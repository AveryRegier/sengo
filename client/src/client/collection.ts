import type { CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';

export class SengoCollection {
  name: string;
  store: CollectionStore;
  static collections: Record<string, SengoCollection> = {};

  constructor(name: string, store: CollectionStore) {
    this.name = name;
    this.store = store;
  }

  async insertOne(doc: Record<string, any>) {
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.store.insertOne(docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  async find(query: Record<string, any>) {
    return this.store.find(query);
  }
}
