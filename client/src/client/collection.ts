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

  async createIndex(keys: Record<string, 1 | -1 | 'text'>, options?: Record<string, any>) {
    // Forward to store, but for now just a noop
    await this.store.createIndex?.(keys, options);
    // MongoDB returns the index name as a string
    // We'll mimic that: e.g. 'field1_1_field2_-1'
    const name = Object.entries(keys)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    return name;
  }
}
