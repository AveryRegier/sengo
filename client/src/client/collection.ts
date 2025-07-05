import { MongoClientClosedError, MongoServerError } from '../errors.js';
import { CollectionIndex, normalizeIndexKeys, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';
import { IndexDefinition, WithId } from '../types';
import { FindCursor } from './findCursor.js';

export class SengoCollection<T> {
  name: string;
  store: CollectionStore<T>;
  private _indexes: Record<string, CollectionIndex> = {};

  constructor(name: string, store: CollectionStore<T>) {
    this.name = name;
    this.store = store;
  }

  /**
   * Drop an index by name (MongoDB compatible: dropIndex)
   */
  async dropIndex(name: string): Promise<void> {
    return this.store.dropIndex(name).then(() => {
      delete this._indexes[name];
    });
  }

  async insertOne(doc: Record<string, any>) {
    // Check for closed store (if supported)
    if (this.store.isClosed()) {
      throw new MongoClientClosedError('Store is closed');
    }
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    console.log('[SengoCollection.insertOne] Inserting:', JSON.stringify(docWithId));
    await this.store.replaceOne({ _id: docWithId._id }, docWithId);
    // Index maintenance: update all indexes
    for (const indexName in this._indexes) {
      const index = this._indexes[indexName];
      // Only call updateIndexOnDocumentUpdate, which is the public API
      console.log(`[SengoCollection.insertOne] Adding doc to index '${indexName}':`, JSON.stringify(docWithId));
      // For insert, treat as oldDoc = {} (no-op) and newDoc = docWithId
      await index.addDocument(docWithId);
    }
    return { acknowledged: true, insertedId: docWithId._id };
  }

  find(query: Record<string, any>): FindCursor<WithId<T>> {
    const result = this.store.find(query);
    //console.log('[SengoCollection.find] Query:', JSON.stringify(query), 'Result:', JSON.stringify(result.toArray));
    return result;
  }

  async updateOne(filter: Record<string, any>, update: Record<string, any>) {
    // Find the first matching document
    const docs = await this.find(filter).toArray();
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
      const err = new MongoServerError('Update document must contain update operators (e.g. $set). Full document replacement is not yet supported.');
      err.code = 9; // MongoDB's FailedToParse
      throw err;
    }
    // Save the updated doc
    await this.store.replaceOne({ _id: updatedDoc._id }, updatedDoc);

    // Index maintenance: let each index handle the update logic
    for (const indexName in this._indexes) {
      const index = this._indexes[indexName];
      await index.updateIndexOnDocumentUpdate(doc, updatedDoc);
    }
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  /**
   * Delete a single document matching the filter (MongoDB compatible: deleteOne)
   */
  async deleteOne(filter: Record<string, any>) {
    // Find the first matching document
    const found = await this.find(filter).next();
    if (!found) {
      return { deletedCount: 0 };
    }
    const docId = found._id;
    // Call the store to delete by _id
    await this.store.deleteOneById(docId);
    // Remove from indexes if needed (index maintenance handled in store or here as needed)
    return { deletedCount: 1 };
  }

  async createIndex(keys: IndexDefinition | IndexDefinition[]): Promise<string> {
    const normalizedKeys = normalizeIndexKeys(keys);
    // MongoDB-like index name: e.g. { name: 1, age: -1 } => 'name_1_age_-1'
    const fields = normalizedKeys.map(({ field, order }) => `${field}_${order}`).join('_');
    // Actually create the index in the store
    const index = await this.store.createIndex(fields || 'default_index', normalizedKeys);
    // Build the index here (assume contract is always fulfilled)
    console.log(`[SengoCollection] Calling this.store.find({}) after index creation for index '${fields || 'default_index'}'`);
    const allDocs = await this.store.find({});
    if(await allDocs.hasNext()) { 
      do  {
        const doc = await allDocs.next();
        if(doc) await index.addDocument(doc);
      } while(await allDocs.hasNext());
      // If this is the last document, flush
      await index.flush();
    }
    // Track the index for future maintenance
    this._indexes[fields || 'default_index'] = index;
    return fields || 'default_index';
  }
}
