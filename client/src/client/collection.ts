import { MongoClientClosedError, MongoServerError } from '../errors.js';
import { normalizeIndexKeys, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';
import { FindCursor, IndexDefinition, WithId } from '../types';
import { getLogger } from './logger';
import logger, { Follower } from 'clox';
import { sort, Sort } from '../util/sort.js';

export type FindOptions = {
  sort?: Sort;
  limit?: number;
};

export class SengoCollection<T> {
  name: string;
  store: CollectionStore<T>;

  constructor(name: string, store: CollectionStore<T>) {
    this.name = name;
    this.store = store;
  }

  /**
   * Drop an index by name (MongoDB compatible: dropIndex)
   */
  async dropIndex(name: string): Promise<void> {
    return this.store.dropIndex(name);
  }

  async insertOne(doc: Record<string, any>) {
    const logger = getLogger();
    // Check for closed store (if supported)
    if (this.store.isClosed()) {
      throw new MongoClientClosedError('Store is closed');
    }
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    logger.debug('Inserting document', { doc: docWithId });
    await this.store.replaceOne({ _id: docWithId._id }, docWithId);
    // Index maintenance: update all indexes
    for (const [name, index] of await this.store.getIndexes()) {
      // Only call updateIndexOnDocumentUpdate, which is the public API
      logger.debug('Adding doc to index', { name, doc: docWithId });
      // For insert, treat as oldDoc = {} (no-op) and newDoc = docWithId
      await index.addDocument(docWithId);
    }
    return { acknowledged: true, insertedId: docWithId._id };
  }

  find(query: Record<string, any>, options?: FindOptions): FindCursor<WithId<T>> {
    const logger = getLogger();
    const follower = new Follower(logger);
    const loader = async () => await follower.follow(
      () => this._findFilterSort(query, options), 
      logger => logger.addContexts({cn: "SengoCollection", fn: 'find', collection: this.name }));
    // Return a FindCursor that will fetch the results lazily
    return new LoadCursor<WithId<T>>(loader);
  }

  private async _findFilterSort(query: Record<string, any>, options?: FindOptions): Promise<WithId<T>[]> {
    let promise = this.store.findCandidates(query, options).then(async (results) => {
      return results.filter((parsed: Record<string, any>) => {
        if (parsed && typeof parsed === 'object' && (parsed)._id !== undefined) {
          if (Object.entries(query).every(([k, v]) => match(parsed, k, v))) {
            return true;
          }
        }
        return false;
      });
    });
    if(options?.sort) {
      promise = promise.then(docs => {
        return sort<WithId<T>>(options.sort!)(docs);
      });
    }
    if(options?.limit !== undefined && options.limit > 0) {
      promise = promise.then(docs => docs.slice(0, options.limit));
    }
    return promise;
  }

  findOne(query: Record<string, any>, options?: FindOptions): Promise<WithId<T> | null> {
    const logger = getLogger();
    const follower = new Follower(logger);
    const loader = async () => {
      const docs = await follower.follow(
        () => this._findFilterSort(query, { ...options, limit: 1 }), 
        logger => logger.addContexts({cn: "SengoCollection", fn: 'findOne', collection: this.name }));
      
      return docs.length > 0 ? docs[0] : null;
    };
    return loader();
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

    const logger = getLogger();
    // Index maintenance: let each index handle the update logic
    for (const [name, index] of await this.store.getIndexes()) {
      logger.debug('Updating doc in index', { name, doc: updatedDoc });
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
    const logger = getLogger();
    const docId = found._id;
    // Call the store to delete by _id
    await this.store.deleteOne(found).then(async () => {
      // Index maintenance: let each index handle the update logic
      for (const [name, index] of await this.store.getIndexes()) {
        logger.debug('Removing doc in index', { name, doc: found });
        await index.removeDocument(found);
      }
    }).catch(err => {
      if (err.name === 'NoSuchKey') {
        return { deletedCount: 0 }; // Document not found, no action needed
      } else {
        logger.error('Error deleting document', err);
        throw new MongoServerError('Failed to delete document', { cause: err });
      }
    });
    return { deletedCount: 1 };
  }

  async createIndex(keys: IndexDefinition | IndexDefinition[]): Promise<string> {
    const logger = getLogger();
    const normalizedKeys = normalizeIndexKeys(keys);
    // MongoDB-like index name: e.g. { name: 1, age: -1 } => 'name_1_age_-1'
    const fields = normalizedKeys.map(({ field, order }) => `${field}_${order}`).join('_');
    // Actually create the index in the store
    const index = await this.store.createIndex(fields || 'default_index', normalizedKeys);
    // Build the index here (assume contract is always fulfilled)
    logger.debug('Calling this.store.find({}) after index creation', { index: fields || 'default_index' });
    const allDocs = this.find({});
    if(await allDocs.hasNext()) {
      do {
        const doc = await allDocs.next();
        if(doc) await index.addDocument(doc);
      } while(await allDocs.hasNext());
      // If this is the last document, flush
      await index.flush();
    }
    return fields || 'default_index';
  }
}

function match(parsed: Record<string, any>, k: string, v: any): unknown {
  const foundValue = parsed[k];
  if(v !== undefined && v !== null) {
    if(v.$in) {
      if(k === "_id") {
        v.$in = v.$in.map((id: any) => id.toString());
      }
      if(Array.isArray(foundValue)) { 
        return v.$in.some((item: unknown) => foundValue.includes(item));
      }
      return v.$in.includes(foundValue);
    }
    if(v.$nin) {
      if(k === "_id") {
        v.$nin = v.$nin.map((id: any) => id.toString());
      }
      if(Array.isArray(foundValue)) {
        return !v.$nin.some((item: unknown) => foundValue.includes(item));
      }
      return !v.$nin.includes(foundValue);
    }
    if(v.$or) {
      return matchesOrArray(parsed, v.$or);
    }
    if(k === '$or') {
      return matchesOrArray(parsed, v);
    }
    if(v.$eq != undefined) {
      v = v.$eq;
      // fall through to equality check
    }
    if(v.$ne != undefined) {
      return foundValue !== v.$ne;
    }
    if(v.$gt != undefined) {
      return foundValue > v.$gt;
    }
    if(v.$gte != undefined) {
      return foundValue >= v.$gte;
    }
    if(v.$lt != undefined) {
      return foundValue < v.$lt;
    }
    if(v.$lte != undefined) {
      return foundValue <= v.$lte;
    }
    if(v.$exists != undefined) {
      const exists = foundValue !== undefined && foundValue !== null && foundValue !== '';
      return v.$exists ? exists : !exists;
    }
  }
  if(Array.isArray(foundValue)) { 
    return foundValue.includes(v) || foundValue.map(fv => fv?.toString()).includes(v?.toString());
  }
  return foundValue?.toString() === v?.toString();
}

function matchesOrArray(parsed: Record<string, any>, arr: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some((orCondition: Record<string, any>) =>
    Object.entries(orCondition).every(([orKey, orValue]) => match(parsed, orKey, orValue))
  );
}

class LoadCursor<T> implements FindCursor<T> {
  private _docs: WithId<T>[] | undefined;
  private _index: number = 0;
  private _closed: boolean = false;
  private _loader: () => Promise<WithId<T>[]>;

  constructor(loader: () => Promise<WithId<T>[]>) {
    this._loader = loader;
  }

  private async ensureLoaded() {
    if (!this._docs) {
      const currentDocs = await this._loader();
      if(!this._docs) {
        this._docs = currentDocs;
        this._index = 0;
      } else if (this._docs !== currentDocs) {
        logger.warn('LoadCursor: Detected concurrent searching resulting in different document sets.');
      }
    }
  }

  public async next(): Promise<WithId<T> | null> {
    await this.ensureLoaded();
    if (this._docs && this._index < this._docs.length) {
      return this._docs[this._index++];
    }
    return null;
  }

  public async toArray(): Promise<WithId<T>[]> {
    await this.ensureLoaded();
    if (!this._docs) return [];
    const remaining = this._docs.slice(this._index);
    this._index = this._docs.length;
    return remaining;
  }

  public async close(): Promise<void> {
    this._closed = true;
  }

  public async hasNext(): Promise<boolean> {
    await this.ensureLoaded();
    return !this._closed && !!this._docs && this._index < this._docs.length;
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<WithId<T>, void, unknown> {
    let doc;
    while ((doc = await this.next()) !== null) {
      yield doc;
    }
  }
}
