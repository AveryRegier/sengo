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
    // Check for closed store (if supported)
    if (typeof (this.store as any).isClosed === 'function' && (this.store as any).isClosed()) {
      throw new Error('Store is closed');
    }
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.store.replaceOne({ _id: docWithId._id }, docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  async find(query: Record<string, any>) {
    return this.store.find(query);
  }

  async updateOne(filter: Record<string, any>, update: Record<string, any>) {
    // Find the first matching document
    const docs = await this.find(filter);
    if (!docs.length) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }
    // Only update the first match (MongoDB semantics)
    const doc = docs[0];
    // Create a new object for the updated doc
    let updatedDoc = { ...doc };
    // Apply $set only (for now)
    if (update.$set) {
      updatedDoc = { ...updatedDoc, ...update.$set };
    } else {
      // If no supported update operator, throw MongoDB-like error
      throw Object.assign(new Error('Update document must contain update operators (e.g. $set). Full document replacement is not yet supported.'), {
        code: 9, // MongoDB's FailedToParse
        name: 'MongoServerError',
      });
    }
    // Save the updated doc
    await this.store.replaceOne({ _id: updatedDoc._id }, updatedDoc);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  async createIndex(keys: Record<string, 1 | -1 | 'text'>): Promise<string> {
    // Simulate MongoDB's createIndex: return a string index name
    const fields = Object.keys(keys).map(k => `${k}_${keys[k]}`).join('_');
    return Promise.resolve(fields || 'default_index');
  }
}
