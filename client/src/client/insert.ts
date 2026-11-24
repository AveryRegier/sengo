import { ObjectId } from 'bson';
import { DuplicateKeyError, MongoInvalidArgumentError, MongoServerError, MongoWriteOutcomeUnknownError, type MongoBulkWriteErrorEntry } from '../errors';
import type { CollectionIndex, CollectionStore } from '../repository/index';
import type { WithId } from '../types';
import type { InsertManyResult } from './collection';
import { getLogger } from './logger';
import { serializeStoreWrite } from './write';

type InsertBatchOutcome = {
  result: InsertManyResult;
  writeErrors: MongoBulkWriteErrorEntry[];
  indexEntryUpdatesCount: number;
  indexNames: string[];
};

export function normalizeInsertDocument<T>(doc: Record<string, any>, label: string): WithId<T> {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new MongoInvalidArgumentError(`${label} must be a document`);
  }
  return (doc._id === undefined ? { ...doc, _id: new ObjectId() } : doc) as WithId<T>;
}

export async function insertDocument<T>(store: CollectionStore<T>, docWithId: WithId<T>): Promise<string[]> {
  const logger = getLogger();
  const indexes = await store.getIndexes();
  const indexNames: string[] = [];
  const claimedUniqueIndexes: CollectionIndex[] = [];

  try {
    for (const [name, index] of indexes) {
      indexNames.push(name);
      if (index.unique) {
        await index.addDocument(docWithId);
        claimedUniqueIndexes.push(index);
      }
    }

    await store.insertOne(docWithId._id, docWithId);

    for (const [name, index] of indexes) {
      if (!index.unique) {
        logger.debug('Adding doc to index', { name, doc: docWithId });
        await index.addDocument(docWithId);
      }
    }
  } catch (error) {
    if (error instanceof MongoWriteOutcomeUnknownError) {
      throw error;
    }
    const cleanupErrors: unknown[] = [];
    for (const index of claimedUniqueIndexes.reverse()) {
      try {
        await index.removeDocument(docWithId);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new MongoServerError(
        `Insert failed and ${cleanupErrors.length} unique index claim(s) could not be rolled back`,
        { cause: error instanceof Error ? error : new Error(String(error)) },
      );
    }
    throw error;
  }

  return indexNames;
}

export async function insertBatch<T>(
  store: CollectionStore<T>,
  documents: WithId<T>[],
  ordered: boolean,
): Promise<InsertBatchOutcome> {
  const result: InsertManyResult = { acknowledged: true, insertedCount: 0, insertedIds: {} };
  const writeErrors: MongoBulkWriteErrorEntry[] = [];
  const indexNames = new Set<string>();
  let indexEntryUpdatesCount = 0;
  await serializeStoreWrite(store, async () => {
    for (const [index, doc] of documents.entries()) {
      try {
        const updatedIndexes = await insertDocument(store, doc);
        result.insertedIds[index] = doc._id;
        result.insertedCount += 1;
        indexEntryUpdatesCount += updatedIndexes.length;
        for (const name of updatedIndexes) indexNames.add(name);
      } catch (error) {
        if (!(error instanceof DuplicateKeyError)) throw error;
        writeErrors.push({ index, code: error.code, errmsg: error.message, error });
        if (ordered) break;
      }
    }
  });
  return { result, writeErrors, indexEntryUpdatesCount, indexNames: Array.from(indexNames) };
}
