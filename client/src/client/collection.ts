import { MongoClientClosedError, MongoServerError } from '../errors.js';
import { normalizeIndexKeys, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';
import { FindCursor, IndexDefinition, WithId } from '../types';
import { getLogger } from './logger';

export class SengoCollection<T> {
  name: string;
  store: CollectionStore<T>;
  private logger: ReturnType<typeof getLogger>;

  constructor(name: string, store: CollectionStore<T>, logger?: ReturnType<typeof getLogger>) {
    this.name = name;
    this.store = store;
    this.logger = logger || getLogger({ collection: name });
  }

  /**
   * Drop an index by name (MongoDB compatible: dropIndex)
   */
  async dropIndex(name: string): Promise<void> {
    return this.store.dropIndex(name);
  }

  async insertOne(doc: Record<string, any>) {
    // Check for closed store (if supported)
    if (this.store.isClosed()) {
      throw new MongoClientClosedError('Store is closed');
    }
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    this.logger.debug({ doc: docWithId }, 'Inserting document');
    await this.store.replaceOne({ _id: docWithId._id }, docWithId);
    // Index maintenance: update all indexes
    for (const [name, index] of await this.store.getIndexes()) {
      // Only call updateIndexOnDocumentUpdate, which is the public API
      this.logger.debug({ name, doc: docWithId }, 'Adding doc to index');
      // For insert, treat as oldDoc = {} (no-op) and newDoc = docWithId
      await index.addDocument(docWithId);
    }
    return { acknowledged: true, insertedId: docWithId._id };
  }

  find(query: Record<string, any>): FindCursor<WithId<T>> {
    // Return a FindCursor that will fetch the results lazily
    return new LoadCursor<WithId<T>>(() => this._findFilterSort(query));
  }

  private async _findFilterSort(query: Record<string, any>): Promise<WithId<T>[]> {
    return this.store.findCandidates(query).then(async results => {
      return results.filter((parsed: Record<string, any>) => {
        if (parsed && typeof parsed === 'object' && (parsed)._id !== undefined) {
          if (Object.entries(query).every(([k, v]) => match(parsed, k, v))) {
            return true;
          }
        }
        return false;
      });
    });
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
    for (const [name, index] of await this.store.getIndexes()) {
      this.logger.debug({ name, doc: updatedDoc }, 'Updating doc in index');
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
    await this.store.deleteOne(found).then(async () => {
      // Index maintenance: let each index handle the update logic
      for (const [name, index] of await this.store.getIndexes()) {
        this.logger.debug({ name, doc: found }, 'Removing doc in index');
        await index.removeDocument(found);
      }
    }).catch(err => {
      if (err.name === 'NoSuchKey') {
        return { deletedCount: 0 }; // Document not found, no action needed
      } else {
        this.logger.error({ err }, 'Error deleting document');
        throw new MongoServerError('Failed to delete document', { cause: err });
      }
    });
    return { deletedCount: 1 };
  }

  async createIndex(keys: IndexDefinition | IndexDefinition[]): Promise<string> {
    const normalizedKeys = normalizeIndexKeys(keys);
    // MongoDB-like index name: e.g. { name: 1, age: -1 } => 'name_1_age_-1'
    const fields = normalizedKeys.map(({ field, order }) => `${field}_${order}`).join('_');
    // Actually create the index in the store
    const index = await this.store.createIndex(fields || 'default_index', normalizedKeys);
    // Build the index here (assume contract is always fulfilled)
    this.logger.debug({ index: fields || 'default_index' }, 'Calling this.store.find({}) after index creation');
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
      if(Array.isArray(foundValue)) {
        return v.$in.some((item: unknown) => foundValue.includes(item));
      }
      return v.$in.includes(foundValue);
    }
  }
  return foundValue?.toString() === v?.toString();
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
      this._docs = await this._loader();
      this._index = 0;
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
