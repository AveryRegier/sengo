import { MongoBulkWriteError, MongoClientClosedError, MongoInvalidArgumentError, MongoServerError, PreconditionFailedError } from '../errors.js';
import { CandidateLoadDocuments, normalizeIndexKeys, type CollectionIndex, type CollectionStore } from '../repository/index';
import { ObjectId } from 'bson';
import { isDeepStrictEqual } from 'node:util';
import { CreateIndexOptions, FindCursor, IndexDefinition, WithId } from '../types';
import { getLogger } from './logger';
import logger, { Follower } from 'clox';
import { sort, Sort } from '../util/sort.js';
import { getOperator } from './expr/index';
import { createExplainSink, ExplainResult, ExplainSink, ExplainVerbosity } from './explain';
import { applyUpdate, createUpsertDocument, validateUpdate } from './update';
import { insertBatch, insertDocument, normalizeInsertDocument } from './insert';
import { filterMatchingDocuments, matchesDocument } from './queryFilter';
import { rollbackUniqueIndexes, serializeStoreWrite } from './write';

export type FindOptions = {
  sort?: Sort;
  limit?: number;
  explain?: ExplainVerbosity;
};

export type CountDocumentsOptions = {
  skip?: number;
  limit?: number;
  explain?: ExplainVerbosity;
};

export type UpdateOptions = {
  upsert?: boolean;
  explain?: ExplainVerbosity;
};

export type UpdateResult = {
  acknowledged: true;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: unknown | null;
};

export type InsertManyOptions = {
  ordered?: boolean;
  explain?: ExplainVerbosity;
};

export type InsertOneResult = {
  acknowledged: true;
  insertedId: string | number | ObjectId | null;
};

export type InsertManyResult = {
  acknowledged: true;
  insertedCount: number;
  insertedIds: Record<number, unknown>;
};

class StaleUpdateSnapshotError extends Error {}

export class SengoCollection<T> {
  name: string;
  store: CollectionStore<T>;

  constructor(name: string, store: CollectionStore<T>) {
    this.name = name;
    this.store = store;
  }

  private async getMatchingIndex(
    query: Record<string, any>,
  ): Promise<CollectionIndex | undefined> {
    const indexes = await this.store.getIndexes();
    return Array.from(indexes.values()).find(index => index.canSatisfyQuery(query));
  }

  private async recordReadExplain(
    sink: ExplainSink,
    query: Record<string, any>,
    stats: {
      docsLoaded: number;
      docsMatched: number;
      hasSort: boolean;
      hasLimit: boolean;
      limitServedByIndex: boolean;
      limitNote?: string;
      loadMode: 'indexLookup' | 'scan';
      matchingIndex?: CollectionIndex;
    },
  ): Promise<void> {
    const matchingIndex = stats.matchingIndex ?? await this.getMatchingIndex(query);
    const stage = matchingIndex ? 'INDEX_LOOKUP' : 'COLLECTION_SCAN';

    sink.onPlanWinner(
      stage,
      matchingIndex?.name,
      !matchingIndex ? 'No usable index for query' : undefined,
    );
    sink.onDocsLoaded(this.name, stats.docsLoaded, stats.loadMode);
    sink.onDocsMatched(stats.docsMatched);
    sink.onSortLimit(
      stats.hasSort,
      stats.hasLimit,
      stats.limitServedByIndex,
      stats.limitNote,
    );

    for (const [field, value] of Object.entries(query)) {
      for (const expr of describeQueryExpressions(field, value, matchingIndex)) {
        sink.onExprStat(
          expr.field,
          expr.operator,
          expr.implemented,
          expr.appliedAt,
          expr.note,
        );
      }
    }
  }

  /**
   * Drop an index by name (MongoDB compatible: dropIndex)
   */
  async dropIndex(name: string): Promise<void> {
    return this.store.dropIndex(name);
  }

  insertOne(doc: Record<string, any>, options: { explain: ExplainVerbosity }): Promise<ExplainResult<InsertOneResult>>;
  insertOne(doc: Record<string, any>, options?: { explain?: ExplainVerbosity }): Promise<InsertOneResult>;
  async insertOne(doc: Record<string, any>, options?: { explain?: ExplainVerbosity }): Promise<InsertOneResult | ExplainResult<InsertOneResult>> {
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
      const docWithId = normalizeInsertDocument<T>(doc, 'document');
      logger.debug('Inserting document', { doc: docWithId });
      
      const outcome = await insertBatch(this.store, [docWithId], true);
      if (outcome.writeErrors.length > 0) throw outcome.writeErrors[0].error;
      const result: InsertOneResult = { acknowledged: true, insertedId: docWithId._id };
      sink.onWriteCost(1, 0, outcome.indexEntryUpdatesCount, outcome.indexNames, 0);
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(result) ?? result;
    } catch (error) {
      sink.onOpEnd(false, Date.now() - startMs);
      throw error;
    }
  }

  insertMany(
    documents: Record<string, any>[],
    options: InsertManyOptions & { explain: ExplainVerbosity },
  ): Promise<ExplainResult<InsertManyResult>>;
  insertMany(documents: Record<string, any>[], options?: InsertManyOptions): Promise<InsertManyResult>;
  async insertMany(
    documents: Record<string, any>[],
    options?: InsertManyOptions,
  ): Promise<InsertManyResult | ExplainResult<InsertManyResult>> {
    const sink = createExplainSink({
      opType: 'insertMany',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: false,
      collectionName: this.name,
    });
    const startMs = Date.now();

    try {
      if (this.store.isClosed()) {
        throw new MongoClientClosedError('Store is closed');
      }
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new MongoInvalidArgumentError('documents must be a non-empty array');
      }

      const docsWithIds = documents.map((doc, index) => normalizeInsertDocument<T>(doc, `documents[${index}]`));

      const { result, writeErrors, indexEntryUpdatesCount, indexNames } =
        await insertBatch(this.store, docsWithIds, options?.ordered !== false);
      sink.onWriteCost(
        result.insertedCount,
        0,
        indexEntryUpdatesCount,
        indexNames,
        0,
      );
      if (writeErrors.length > 0) {
        throw new MongoBulkWriteError(
          `${writeErrors.length} document(s) failed to insert`,
          { cause: writeErrors[0].error },
          { writeErrors, result },
        );
      }

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

      const matchingIndex = await this.getMatchingIndex(query);
      await this.recordReadExplain(sink, query, {
        docsLoaded: docs.length,
        docsMatched: docs.length,
        hasSort: !!options?.sort,
        hasLimit: options?.limit !== undefined,
        limitServedByIndex: !!matchingIndex && options?.limit !== undefined,
        limitNote: matchingIndex && options?.limit !== undefined
          ? 'limit served by index ordering'
          : undefined,
        loadMode: matchingIndex ? 'indexLookup' : 'scan',
        matchingIndex,
      });

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

  private async _findFilterSort(
    query: Record<string, any>,
    options?: FindOptions,
    sink?: ExplainSink,
    loadDocuments?: CandidateLoadDocuments<T>,
    candidatesAlreadyFiltered: boolean = false,
  ): Promise<WithId<T>[]> {
    let promise = this.store.findCandidates(query, options, sink, loadDocuments).then(async (results) => {
      if (candidatesAlreadyFiltered) {
        return results;
      }
      return filterMatchingDocuments(results, query);
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

      const matchingIndex = await this.getMatchingIndex(query);
      await this.recordReadExplain(sink, query, {
        docsLoaded: docs.length,
        docsMatched: docs.length,
        hasSort: !!options?.sort,
        hasLimit: true,
        limitServedByIndex: !!matchingIndex && !!options?.limit,
        limitNote: matchingIndex && options?.limit
          ? 'limit served by index ordering'
          : undefined,
        loadMode: matchingIndex ? 'indexLookup' : 'scan',
        matchingIndex,
      });

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

  countDocuments(filter: Record<string, any>, options: CountDocumentsOptions & { explain: ExplainVerbosity }): Promise<ExplainResult<number>>;
  countDocuments(filter?: Record<string, any>, options?: CountDocumentsOptions): Promise<number>;
  countDocuments(filter: Record<string, any> = {}, options?: CountDocumentsOptions): any {
    const sink = createExplainSink({
      opType: 'countDocuments',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: options?.limit !== undefined,
      collectionName: this.name,
    });

    const logger = getLogger();
    const follower = new Follower(logger);
    const loader = async () => {
      const loadStartMs = Date.now();
      let usedIndexOnly = false;
      let loadedDocsCount = 0;

      const docs = await follower.follow(
        () => this._findFilterSort(
          filter,
          undefined,
          sink,
          async request => {
            if (request.mode === 'indexLookup' && request.canUseKeysAsResult) {
              usedIndexOnly = true;
              return request.keys.map(key => ({ _id: key } as WithId<T>));
            }

            const loaded = await request.loadDefault();
            loadedDocsCount += loaded.length;
            return filterMatchingDocuments(loaded, filter);
          },
          true,
        ),
        logger => logger.addContexts({ cn: 'SengoCollection', fn: 'countDocuments', collection: this.name }),
      );
      sink.onTimingPart('documentLoad', Date.now() - loadStartMs, loadedDocsCount);

      const skip = normalizeCountOption(options?.skip);
      const limit = normalizeCountOption(options?.limit);
      const sliced = applyCountWindow(docs, skip, limit);
      const matchingIndex = await this.getMatchingIndex(filter);
      await this.recordReadExplain(sink, filter, {
        docsLoaded: usedIndexOnly ? 0 : loadedDocsCount,
        docsMatched: sliced.length,
        hasSort: false,
        hasLimit: options?.skip !== undefined || options?.limit !== undefined,
        limitServedByIndex: usedIndexOnly,
        limitNote: usedIndexOnly ? 'count satisfied by index lookup only' : undefined,
        loadMode: matchingIndex ? 'indexLookup' : 'scan',
        matchingIndex,
      });

      return sliced.length;
    };

    if (options?.explain) {
      const startMs = Date.now();
      return loader()
        .then((count): ExplainResult<number> => {
          sink.onOpEnd(true, Date.now() - startMs);
          return sink.finalize(count) ?? ({ ok: 1, namespace: this.name, command: { type: 'countDocuments', query: filter, options }, result: count } as ExplainResult<number>);
        })
        .catch((error) => {
          sink.onOpEnd(false, Date.now() - startMs);
          throw error;
        });
    }

    return loader();
  }

  private async updateDocument(
    doc: WithId<T>,
    filter: Record<string, any>,
    update: Record<string, any>,
    indexes: Map<string, CollectionIndex>,
    attempt = 0,
  ): Promise<'modified' | 'unchanged' | 'stale'> {
    const updatedDoc = applyUpdate(doc, update);
    if (isDeepStrictEqual(doc, updatedDoc)) return 'unchanged';

    const claimed: CollectionIndex[] = [];
    try {
      for (const index of indexes.values()) {
        if (index.unique && !index.hasSameUniqueKey(doc, updatedDoc)) {
          await index.addDocument(updatedDoc);
          claimed.push(index);
        }
      }
      await this.store.updateOne(
        doc._id,
        current => {
          if (!isDeepStrictEqual(current, doc)) {
            throw new StaleUpdateSnapshotError();
          }
          return applyUpdate(current, update);
        },
        current => matchesDocument(current, filter),
      );
    } catch (error) {
      const filterChanged = error instanceof Error && error.message.includes('does not match filter after reload');
      const snapshotChanged = error instanceof StaleUpdateSnapshotError;
      const current = filterChanged || snapshotChanged
        ? await this.findOne({ _id: doc._id })
        : doc;
      const cleanupErrors = await rollbackUniqueIndexes(claimed, current, updatedDoc);
      if (cleanupErrors.length > 0) {
        throw new MongoServerError(
          `Update failed and ${cleanupErrors.length} unique index claim(s) could not be rolled back`,
          { cause: error instanceof Error ? error : new Error(String(error)) },
        );
      }
      if (filterChanged) return 'stale';
      if (snapshotChanged) {
        if (attempt >= 2) throw new PreconditionFailedError('Document changed repeatedly during update');
        if (!current || !matchesDocument(current, filter)) return 'stale';
        return this.updateDocument(current, filter, update, indexes, attempt + 1);
      }
      throw error;
    }

    for (const [name, index] of indexes) {
      getLogger().debug('Updating doc in index', { name, doc: updatedDoc });
      await index.updateIndexOnDocumentUpdate(doc, updatedDoc);
    }
    return 'modified';
  }

  updateOne(filter: Record<string, any>, update: Record<string, any>, options: UpdateOptions & { explain: ExplainVerbosity }): Promise<ExplainResult<UpdateResult>>;
  updateOne(filter: Record<string, any>, update: Record<string, any>, options?: UpdateOptions): Promise<UpdateResult>;
  updateOne(filter: Record<string, any>, update: Record<string, any>, options?: UpdateOptions): Promise<UpdateResult | ExplainResult<UpdateResult>> {
    return this.updateDocuments(filter, update, options, false);
  }

  updateMany(filter: Record<string, any>, update: Record<string, any>, options: UpdateOptions & { explain: ExplainVerbosity }): Promise<ExplainResult<UpdateResult>>;
  updateMany(filter: Record<string, any>, update: Record<string, any>, options?: UpdateOptions): Promise<UpdateResult>;
  updateMany(filter: Record<string, any>, update: Record<string, any>, options?: UpdateOptions): Promise<UpdateResult | ExplainResult<UpdateResult>> {
    return this.updateDocuments(filter, update, options, true);
  }

  private async updateDocuments(filter: Record<string, any>, update: Record<string, any>, options: UpdateOptions | undefined, many: boolean): Promise<UpdateResult | ExplainResult<UpdateResult>> {
    const sink = createExplainSink({
      opType: many ? 'updateMany' : 'updateOne',
      namespace: this.name,
      verbosity: options?.explain,
      hasSort: false,
      hasLimit: false,
      collectionName: this.name,
    });
    const startMs = Date.now();

    try {
      validateUpdate(update);
      const outcome = await serializeStoreWrite(this.store, async () => {
        const docs = await this.find(filter).toArray();
        const result: UpdateResult = {
          acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null,
        };
        if (docs.length === 0) {
          if (!options?.upsert) {
            return { result, documentWrites: 0, indexNames: [], indexEntryUpdatesCount: 0 };
          }

          const upsertDocument = createUpsertDocument(filter, update);
          const indexNames = await insertDocument(this.store, upsertDocument as WithId<T>);
          result.upsertedId = upsertDocument._id;
          result.upsertedCount = 1;
          return {
            result,
            documentWrites: 1,
            indexNames,
            indexEntryUpdatesCount: indexNames.length,
          };
        }

        const indexes = await this.store.getIndexes();
        let indexEntryUpdatesCount = 0;
        const updatedIndexNames = new Set<string>();

        for (const doc of many ? docs : docs.slice(0, 1)) {
          const status = await this.updateDocument(doc, filter, update, indexes);
          if (status === 'stale') continue;
          result.matchedCount += 1;
          if (status === 'unchanged') continue;
          result.modifiedCount += 1;
          for (const name of indexes.keys()) {
            updatedIndexNames.add(name);
            indexEntryUpdatesCount += 1;
          }
        }

        return {
          result,
          documentWrites: result.modifiedCount,
          indexNames: Array.from(updatedIndexNames),
          indexEntryUpdatesCount,
        };
      });

      sink.onWriteCost(
        outcome.documentWrites,
        0,
        outcome.indexEntryUpdatesCount,
        outcome.indexNames,
        0,
      );
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(outcome.result) ?? outcome.result;
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
      const logger = getLogger();
      let outcome: string[] | null;
      try {
        outcome = await serializeStoreWrite(this.store, async () => {
          const found = await this.find(filter).next();
          if (!found) return null;

          const indexNames: string[] = [];
          await this.store.deleteOne(found);
          for (const [name, index] of await this.store.getIndexes()) {
            indexNames.push(name);
            logger.debug('Removing doc in index', { name, doc: found });
            await index.removeDocument(found);
          }
          return indexNames;
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') {
          outcome = null;
        } else {
          logger.error(error instanceof Error ? error : new Error(String(error)), 'Error deleting document');
          throw new MongoServerError('Failed to delete document', {
            cause: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
      if (!outcome) {
        const result = { deletedCount: 0 };
        sink.onWriteCost(0, 0, 0, [], 0);
        sink.onOpEnd(true, Date.now() - startMs);
        return sink.finalize(result) ?? result;
      }
      const result = { deletedCount: 1 };
      sink.onWriteCost(1, 0, outcome.length, outcome, 0);
      sink.onOpEnd(true, Date.now() - startMs);
      return sink.finalize(result) ?? result;
    } catch (error) {
      sink.onOpEnd(false, Date.now() - startMs);
      throw error;
    }
  }

  async createIndex(keys: IndexDefinition | IndexDefinition[], options?: CreateIndexOptions): Promise<string> {
    const normalizedKeys = normalizeIndexKeys(keys);
    // MongoDB-like index name: e.g. { name: 1, age: -1 } => 'name_1_age_-1'
    const fields = normalizedKeys.map(({ field, order }) => `${field}_${order}`).join('_');
    return serializeStoreWrite(this.store, async () => {
      await this.store.createIndex(fields || 'default_index', normalizedKeys, options);
      return fields || 'default_index';
    });
  }

  /**
   * List all indexes on the collection (MongoDB compatible: listIndexes / getIndexes)
   * Returns an array of index specifications including the default _id index.
   */
  async listIndexes(): Promise<Array<{ v: number; key: Record<string, number>; name: string; unique?: true }>> {
    const indexes: Array<{ v: number; key: Record<string, number>; name: string; unique?: true }> = [];
    
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
        name,
        ...(index.unique ? { unique: true as const } : {}),
      });
    }

    return indexes;
  }
}

function describeQueryExpressions(field: string, value: any, matchingIndex?: { name: string; keys?: Array<{ field: string }> }): Array<{
  field: string;
  operator: string;
  implemented: boolean;
  appliedAt: 'index' | 'postLoad' | 'notApplied';
  note?: string;
}> {
  const fieldIsIndexed = matchingIndex?.keys?.some(indexField => indexField.field === field) ?? false;

  if (field === '$or') {
    return [{
      field: '$or',
      operator: '$or',
      implemented: true,
      appliedAt: 'postLoad',
      note: 'top-level $or evaluated after load',
    }];
  }

  if (value === undefined || value === null) {
    return [{
      field,
      operator: '$eq',
      implemented: true,
      appliedAt: fieldIsIndexed ? 'index' : 'postLoad',
      note: fieldIsIndexed ? 'field matched index key' : 'field filtered after load',
    }];
  }

  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    const operatorEntries = Object.entries(value).filter(([op]) => op.startsWith('$'));

    if (operatorEntries.length === 0) {
      return [{
        field,
        operator: '$eq',
        implemented: true,
        appliedAt: fieldIsIndexed ? 'index' : 'postLoad',
        note: fieldIsIndexed ? 'field matched index key' : 'field filtered after load',
      }];
    }

    return operatorEntries.map(([operator, operatorValue]) => {
      const isSupported = operator === '$eq' || !!getOperator(operator) || operator === '$or';
      return {
        field,
        operator,
        implemented: isSupported,
        appliedAt: isSupported ? (fieldIsIndexed ? 'index' : 'postLoad') : 'notApplied',
        note: isSupported
          ? (fieldIsIndexed ? 'field matched index key' : 'field filtered after load')
          : `unsupported operator ${operator} in Sengo${operatorValue !== undefined ? `: ${JSON.stringify(operatorValue)}` : ''}`,
      };
    });
  }

  return [{
    field,
    operator: '$eq',
    implemented: true,
    appliedAt: fieldIsIndexed ? 'index' : 'postLoad',
    note: fieldIsIndexed ? 'field matched index key' : 'field filtered after load',
  }];
}

function normalizeCountOption(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function applyCountWindow<T>(docs: T[], skip?: number, limit?: number): T[] {
  const start = skip ?? 0;
  const afterSkip = start > 0 ? docs.slice(start) : docs;
  if (limit !== undefined) {
    return afterSkip.slice(0, limit);
  }
  return afterSkip;
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
