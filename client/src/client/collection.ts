import { MongoClientClosedError, MongoServerError } from '../errors.js';
import { normalizeIndexKeys, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';
import { FindCursor, IndexDefinition, WithId } from '../types';
import { getLogger } from './logger';
import logger, { Follower } from 'clox';
import { sort, Sort } from '../util/sort.js';
import { evaluateComparison } from './expression.js';
import { createExplainSink, ExplainResult, ExplainSink, ExplainVerbosity } from './explain';

export type FindOptions = {
  sort?: Sort;
  limit?: number;
  explain?: ExplainVerbosity;
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

  async insertOne(doc: Record<string, any>, options?: { explain?: ExplainVerbosity }) {
    const sink = createExplainSink({
      opType: 'insertOne',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: false,
      collectionName: this.name,
    });
    const startMs = Date.now();
    const logger = getLogger();
    try {
      // Check for closed store (if supported)
      if (this.store.isClosed()) {
        throw new MongoClientClosedError('Store is closed');
      }
      const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
      logger.debug('Inserting document', { doc: docWithId });
      await this.store.replaceOne({ _id: docWithId._id }, docWithId);
      const indexes = await this.store.getIndexes();
      const indexNames: string[] = [];
      // Index maintenance: update all indexes
      for (const [name, index] of indexes) {
        indexNames.push(name);
        // Only call updateIndexOnDocumentUpdate, which is the public API
        logger.debug('Adding doc to index', { name, doc: docWithId });
        // For insert, treat as oldDoc = {} (no-op) and newDoc = docWithId
        await index.addDocument(docWithId);
      }
      const result = { acknowledged: true, insertedId: docWithId._id };
      sink.onWriteCost(1, 0, indexNames.length, indexNames, 0);
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(result) ?? result;
    } catch (error) {
      sink.onOpEnd(false, Date.now() - startMs);
      throw error;
    }
  }

  find(query: Record<string, any>, options: FindOptions & { explain: ExplainVerbosity }): Promise<ExplainResult<WithId<T>[]>>;
  find(query: Record<string, any>, options?: FindOptions): FindCursor<WithId<T>>;
  find(query: Record<string, any>, options?: FindOptions): any {
    const sink = createExplainSink({
      opType: 'find',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: !!options?.sort,
      hasLimit: options?.limit !== undefined,
      collectionName: this.name,
    });

    const logger = getLogger();
    const follower = new Follower(logger);
    const loader = async () => {
      const loadStartMs = Date.now();
      const docs = await follower.follow(
        () => this._findFilterSort(query, options, sink),
        logger => logger.addContexts({cn: 'SengoCollection', fn: 'find', collection: this.name }),
      );
      sink.onTimingPart('documentLoad', Date.now() - loadStartMs, docs.length);

      const indexes = await this.store.getIndexes();
      const matchingIndex = Array.from(indexes.values()).find(index => index.canSatisfyQuery(query));
      const stage = matchingIndex ? 'INDEX_LOOKUP' : 'COLLECTION_SCAN';

      sink.onPlanWinner(stage, matchingIndex?.name, !matchingIndex ? 'No usable index for query' : undefined);
      sink.onDocsLoaded(this.name, docs.length, matchingIndex ? 'indexLookup' : 'scan');
      sink.onDocsMatched(docs.length);
      sink.onSortLimit(
        !!options?.sort,
        options?.limit !== undefined,
        !!matchingIndex && options?.limit !== undefined,
        matchingIndex && options?.limit !== undefined ? 'limit served by index ordering' : undefined,
      );

      for (const [field, value] of Object.entries(query)) {
        const operator = typeof value === 'object' && value && !Array.isArray(value) && Object.keys(value).length > 0 ? Object.keys(value)[0] : '$eq';
        sink.onExprStat(
          field,
          operator,
          true,
          matchingIndex ? 'index' : 'postLoad',
          matchingIndex ? 'field matched index key' : 'field filtered after load',
        );
      }

      return docs;
    };

    if (options?.explain) {
      const startMs = Date.now();
      return loader()
        .then((docs): ExplainResult<WithId<T>[]> => {
          sink.onOpEnd(true, Date.now() - startMs);
          return sink.finalize(docs) ?? ({ ok: 1, namespace: this.name, command: { type: 'find', query, options }, result: docs } as ExplainResult<WithId<T>[]>);
        })
        .catch((error) => {
          sink.onOpEnd(false, Date.now() - startMs);
          throw error;
        });
    }

    return new LoadCursor<WithId<T>>(loader);
  }

  private async _findFilterSort(query: Record<string, any>, options?: FindOptions, sink?: ExplainSink): Promise<WithId<T>[]> {
    let promise = this.store.findCandidates(query, options, sink).then(async (results) => {
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

  findOne(query: Record<string, any>, options: FindOptions & { explain: ExplainVerbosity }): Promise<ExplainResult<WithId<T> | null>>;
  findOne(query: Record<string, any>, options?: FindOptions): Promise<WithId<T> | null>;
  findOne(query: Record<string, any>, options?: FindOptions): any {
    const sink = createExplainSink({
      opType: 'findOne',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: !!options?.sort,
      hasLimit: options?.limit !== undefined || true,
      collectionName: this.name,
    });
    const logger = getLogger();
    const follower = new Follower(logger);
    const loader = async () => {
      const loadStartMs = Date.now();
      const docs = await follower.follow(
        () => this._findFilterSort(query, { ...options, limit: 1 }, sink),
        logger => logger.addContexts({cn: "SengoCollection", fn: 'findOne', collection: this.name }));
      sink.onTimingPart('documentLoad', Date.now() - loadStartMs, docs.length);

      const indexes = await this.store.getIndexes();
      const matchingIndex = Array.from(indexes.values()).find(index => index.canSatisfyQuery(query));
      const stage = matchingIndex ? 'INDEX_LOOKUP' : 'COLLECTION_SCAN';

      sink.onPlanWinner(stage, matchingIndex?.name, !matchingIndex ? 'No usable index for query' : undefined);
      sink.onDocsLoaded(this.name, docs.length, matchingIndex ? 'indexLookup' : 'scan');
      sink.onDocsMatched(docs.length);
      sink.onSortLimit(
        !!options?.sort,
        true,
        !!matchingIndex && !!options?.limit,
        matchingIndex && !!options?.limit ? 'limit served by index ordering' : undefined,
      );

      for (const [field, value] of Object.entries(query)) {
        const operator = typeof value === 'object' && value && !Array.isArray(value) && Object.keys(value).length > 0 ? Object.keys(value)[0] : '$eq';
        sink.onExprStat(
          field,
          operator,
          true,
          matchingIndex ? 'index' : 'postLoad',
          matchingIndex ? 'field matched index key' : 'field filtered after load',
        );
      }

      return docs.length > 0 ? docs[0] : null;
    };

    if (options?.explain) {
      const startMs = Date.now();
      return loader()
        .then((doc): ExplainResult<WithId<T> | null> => {
          sink.onOpEnd(true, Date.now() - startMs);
          return sink.finalize(doc) ?? ({ ok: 1, namespace: this.name, command: { type: 'findOne', query, options }, result: doc } as ExplainResult<WithId<T> | null>);
        })
        .catch((error) => {
          sink.onOpEnd(false, Date.now() - startMs);
          throw error;
        });
    }

    return loader();
  } 

  async updateOne(filter: Record<string, any>, update: Record<string, any>, options?: { explain?: ExplainVerbosity }) {
    const sink = createExplainSink({
      opType: 'updateOne',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: false,
      collectionName: this.name,
    });
    const startMs = Date.now();
    try {
      // Find the first matching document
      const docs = await this.find(filter).toArray();
      if (!docs.length) {
        const result = { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        sink.onWriteCost(0, 0, 0, [], 0);
        sink.onOpEnd(true, Date.now() - startMs);
        return sink.finalize(result) ?? result;
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
      const indexNames: string[] = [];
      // Index maintenance: let each index handle the update logic
      for (const [name, index] of await this.store.getIndexes()) {
        indexNames.push(name);
        logger.debug('Updating doc in index', { name, doc: updatedDoc });
        await index.updateIndexOnDocumentUpdate(doc, updatedDoc);
      }
      const result = { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      sink.onWriteCost(1, 0, indexNames.length, indexNames, 0);
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(result) ?? result;
    } catch (error) {
      sink.onOpEnd(false, Date.now() - startMs);
      throw error;
    }
  }

  /**
   * Delete a single document matching the filter (MongoDB compatible: deleteOne)
   */
  async deleteOne(filter: Record<string, any>, options?: { explain?: ExplainVerbosity }) {
    const sink = createExplainSink({
      opType: 'deleteOne',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: false,
      collectionName: this.name,
    });
    const startMs = Date.now();
    try {
      // Find the first matching document
      const found = await this.find(filter).next();
      if (!found) {
        const result = { deletedCount: 0 };
        sink.onWriteCost(0, 0, 0, [], 0);
        sink.onOpEnd(true, Date.now() - startMs);
        return sink.finalize(result) ?? result;
      }
      const logger = getLogger();
      const docId = found._id;
      const indexNames: string[] = [];
      // Call the store to delete by _id
      await this.store.deleteOne(found).then(async () => {
        // Index maintenance: let each index handle the update logic
        for (const [name, index] of await this.store.getIndexes()) {
          indexNames.push(name);
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
      const result = { deletedCount: 1 };
      sink.onWriteCost(1, 0, indexNames.length, indexNames, 0);
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(result) ?? result;
    } catch (error) {
      sink.onOpEnd(false, Date.now() - startMs);
      throw error;
    }
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

  /**
   * List all indexes on the collection (MongoDB compatible: listIndexes / getIndexes)
   * Returns an array of index specifications including the default _id index.
   */
  async listIndexes(): Promise<Array<{ v: number; key: Record<string, number>; name: string }>> {
    const indexes: Array<{ v: number; key: Record<string, number>; name: string }> = [];
    
    // MongoDB always has an _id index
    indexes.push({
      v: 2,
      key: { _id: 1 },
      name: '_id_'
    });

    // Add all user-created indexes
    const storeIndexes = await this.store.getIndexes();
    for (const [name, index] of storeIndexes) {
      const key: Record<string, number> = {};
      for (const { field, order } of index.keys) {
        key[field] = order as number;  // Order is 1 | -1 | 'text', cast to number for MongoDB format
      }
      indexes.push({
        v: 2,
        key,
        name
      });
    }

    return indexes;
  }
}

function match(parsed: Record<string, any>, k: string, v: any): unknown {
  const foundValue = parsed[k];
  
  // Handle special $or operator
  if (v?.$or) {
    return matchesOrArray(parsed, v.$or);
  }
  if (k === '$or') {
    return matchesOrArray(parsed, v);
  }
  
  // Use centralized comparison evaluation
  return evaluateComparison(foundValue, v, k);
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
