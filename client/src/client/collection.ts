import { normalizeIndexKeys, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';

export class SengoCollection {
  name: string;
  store: CollectionStore;
  static collections: Record<string, SengoCollection> = {};
  private _indexes: Record<string, any> = {};

  constructor(name: string, store: CollectionStore) {
    this.name = name;
    this.store = store;
  }

  /**
   * Drop an index by name (MongoDB compatible: dropIndex)
   */
  async dropIndex(name: string): Promise<void> {
    await this.store.dropIndex(name);
    delete this._indexes[name];
  }

  async insertOne(doc: Record<string, any>) {
    // Check for closed store (if supported)
    if (typeof (this.store as any).isClosed === 'function' && (this.store as any).isClosed()) {
      throw new Error('Store is closed');
    }
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    console.log('[SengoCollection.insertOne] Inserting:', JSON.stringify(docWithId));
    await this.store.replaceOne({ _id: docWithId._id }, docWithId);
    // Index maintenance: update all indexes
    for (const indexName in this._indexes) {
      const index = this._indexes[indexName];
      if (typeof index.addDocument === 'function') {
        console.log(`[SengoCollection.insertOne] Adding doc to index '${indexName}':`, JSON.stringify(docWithId));
        await index.addDocument(docWithId);
        if (typeof index.flush === 'function') {
          await index.flush();
        }
      }
    }
    return { acknowledged: true, insertedId: docWithId._id };
  }

  async find(query: Record<string, any>) {
    const result = this.store.find(query);
    console.log('[SengoCollection.find] Query:', JSON.stringify(query), 'Result:', JSON.stringify(result));
    return result;
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

    // Index maintenance: update all indexes (remove from old key, add to new key if indexed fields changed)
    for (const indexName in this._indexes) {
      const index = this._indexes[indexName];
      if (typeof index.addDocument === 'function' && typeof index.makeIndexKey === 'function') {
        // Compute old and new index keys
        const oldKey = index.makeIndexKey(doc);
        const newKey = index.makeIndexKey(updatedDoc);
        if (oldKey !== newKey && typeof index.removeDocument === 'function') {
          console.log(`[SengoCollection.updateOne] Removing doc from old index key '${oldKey}' in index '${indexName}':`, JSON.stringify(doc));
          await index.removeDocument(doc);
        }
        // Always add to new key (covers both changed and unchanged)
        console.log(`[SengoCollection.updateOne] Adding doc to new index key '${newKey}' in index '${indexName}':`, JSON.stringify(updatedDoc));
        await index.addDocument(updatedDoc);
        if (typeof index.flush === 'function') {
          await index.flush();
        }
      }
    }
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  async createIndex(keys: Record<string, 1 | -1 | 'text'>): Promise<string> {
    const normalizedKeys = normalizeIndexKeys(keys);
    // MongoDB-like index name: e.g. { name: 1, age: -1 } => 'name_1_age_-1'
    const fields = normalizedKeys.map(({ field, order }) => `${field}_${order}`).join('_');
    // Actually create the index in the store
    const index = await this.store.createIndex(fields || 'default_index', normalizedKeys);
    // Build the index here (assume contract is always fulfilled)
    console.log(`[SengoCollection] Calling this.store.find({}) after index creation for index '${fields || 'default_index'}'`);
    const allDocs = await this.store.find({});
    console.log(`[SengoCollection] this.store.find({}) returned ${allDocs.length} documents`);
    for (let i = 0; i < allDocs.length; i++) {
      const doc = allDocs[i];
      // If this is the last document and the index has a flush method, call flush after addDocument
      if (i === allDocs.length - 1 && typeof (index as any).flush === 'function') {
        await (index as any).addDocument(doc);
        await (index as any).flush();
      } else {
        await (index as any).addDocument(doc);
      }
    }
    // Track the index for future maintenance
    this._indexes[fields || 'default_index'] = index;
    return fields || 'default_index';
  }
}
