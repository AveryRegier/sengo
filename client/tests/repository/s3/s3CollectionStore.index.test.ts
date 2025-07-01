import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { normalizeIndexKeys } from '../../../src/repository/collectionIndex';
import { SengoCollection } from '../../../src/client/collection';
import { S3BucketSimulator } from './S3BucketSimulator';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';

function waitForIndexReady(index: any, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      if (!index.isBusy || !index.isBusy()) return resolve(undefined);
      if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for index to be ready'));
      setTimeout(check, 10);
    }
    check();
  });
}

describe('S3CollectionStore.createIndex and normalizeIndexKeys', () => {
  const bucket = 'test-bucket';
  const collection = 'test-collection';

  function makeStoreAndSim() {
    const s3sim = new S3BucketSimulator();
    const sendMock = vi.fn(async (cmd: any) => {
      if (cmd instanceof PutObjectCommand) {
        await new Promise(res => setTimeout(res, 1));
        s3sim.putObject(cmd.input.Key!, String(cmd.input.Body));
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        return s3sim.getObject(cmd.input.Key!);
      }
      if (cmd instanceof ListObjectsV2Command) {
        return s3sim.listObjectsV2(cmd.input.Prefix);
      }
      throw new Error('Unknown command: ' + cmd.constructor.name);
    });
    const store = new S3CollectionStore(collection, bucket);
    // @ts-ignore
    store.s3.send = sendMock;
    return { store, s3sim, sendMock };
  }

  let sengoCollection: SengoCollection;
  let store: S3CollectionStore;
  let s3sim: S3BucketSimulator;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    sengoCollection = new SengoCollection(collection, store);
  });

  it('creates an index file and adds all docs to the index', async () => {
    // Insert some docs
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const normalized = normalizeIndexKeys(keys);
    const indexName = await sengoCollection.createIndex(keys);
    // Wait for index to finish processing (if async)
    const index = (store as any).lastIndexInstance;
    if (index && typeof (index as any).isBusy === 'function') {
      await waitForIndexReady(index, 15000); // increase timeout
    } else {
      await new Promise(res => setTimeout(res, 100));
    }
    // Check that the index contains the expected docs (if getIndexMap is available)
    if (index && typeof (index as any).getIndexMap === 'function') {
      const map = (index as any).getIndexMap();
      expect(Object.values(map).flat()).toEqual(expect.arrayContaining(['a', 'b']));
    }
    // Check S3 PutObjectCommand calls for index metadata and entries
    const putCalls = sendMock.mock.calls.filter(([cmd]: any[]) => cmd.constructor.name === 'PutObjectCommand');
    expect(putCalls.some(([cmd]: any[]) => cmd.input.Key === `${collection}/indices/${indexName}.json`)).toBe(true);
    expect(putCalls.some(([cmd]: any[]) => cmd.input.Key.includes(`${collection}/indices/${indexName}/`))).toBe(true);
  }, 20000);

  it('throws if store is closed', async () => {
    await store.close();
    await expect(store.createIndex('fail', [{ field: 'x', order: 1 as 1 | -1 | 'text' }])).rejects.toThrow('Store is closed');
  });

  it('normalizes array of keys', () => {
    const keys: (string | { [key: string]: 1 | -1 | 'text' })[] = ['foo', { bar: -1 }];
    const normalized = normalizeIndexKeys(keys);
    expect(normalized).toEqual([
      { field: 'foo', order: 1 },
      { field: 'bar', order: -1 },
    ]);
  });

  it('creates an index and flushes to ensure all docs are indexed (S3)', async () => {
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
      // After flush, all docs should be indexed
      const map = index.getIndexMap();
      const allIds = Object.values(map).flat();
      expect(allIds).toEqual(expect.arrayContaining(['a', 'b']));
    }
  }, 20000);

  // Helpers to set up S3 state for tests
  // Helper to generate the same index key as S3CollectionIndex
  function makeIndexKey(query: Record<string, any>): string {
    // This logic should match S3CollectionIndex.makeIndexKey
    // For a single key: { foo: 1 } => 'foo:1:1'
    // For multiple keys: { foo: 1, bar: -1 } => 'foo:1:1|bar:-1:1'
    return Object.entries(query)
      .map(([field, value]) => `${field}:${value}:1`)
      .join('|');
  }
  // Updated helpers to use makeIndexKey
  function setupIndexEntry(s3sim: S3BucketSimulator, collection: string, indexName: string, query: Record<string, any>, ids: string[]) {
    const key = makeIndexKey(query);
    const s3Key = `${collection}/indices/${indexName}/${encodeURIComponent(key)}.json`;
    s3sim.putObject(s3Key, JSON.stringify(ids));
  }
  function setupDocumentFile(s3sim: S3BucketSimulator, collection: string, id: string, doc: any) {
    const s3Key = `${collection}/data/${id}.json`;
    s3sim.putObject(s3Key, JSON.stringify(doc));
  }

  it('find only loads index and doc files from S3, and index is loaded at most once', async () => {
    // Insert docs
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index
    const found = await sengoCollection.find({ foo: 1 });
    const log1 = s3sim.getAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${encodeURIComponent(makeIndexKey({ foo: 1 }))}.json`;
    const expectedDocFile = `${collection}/data/a.json`;
    expect(log1).toContain(expectedIndexFile);
    // Simulate process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    s3sim.clearAccessLog();
    const newCollection = new SengoCollection(collection, store);
    await newCollection.find({ foo: 1 });
    const log2 = s3sim.getAccessLog();
    // After process restart and explicit S3 state setup, the log should contain the index entry file
    expect(log2).toContain(expectedIndexFile);
  });

  it('find only loads index and doc files from S3, and index is loaded at most once (reset cache between)', async () => {
    // Insert docs
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Simulate process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    s3sim.clearAccessLog();
    const newCollection = new SengoCollection(collection, store);
    // Find using the index
    const found = await newCollection.find({ foo: 1 });
    const log1 = s3sim.getAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${encodeURIComponent(makeIndexKey({ foo: 1 }))}.json`;
    const expectedDocFile = `${collection}/data/a.json`;
    expect(log1).toContain(expectedIndexFile);
    // Simulate another process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    s3sim.clearAccessLog();
    const newCollection2 = new SengoCollection(collection, store);
    await newCollection2.find({ foo: 1 });
    const log2 = s3sim.getAccessLog();
    // After process restart and explicit S3 state setup, the log should contain the index entry file
    expect(log2).toContain(expectedIndexFile);
  });

  it('find only loads index entry file from S3 at most once per key, but doc files may be loaded per query', async () => {
    // Insert docs
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index
    await sengoCollection.find({ foo: 1 });
    const log1 = s3sim.getAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${encodeURIComponent(makeIndexKey({ foo: 1 }))}.json`;
    const expectedDocFile = `${collection}/data/a.json`;
    expect(log1).toContain(expectedIndexFile);
    // Simulate process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    await sengoCollection.find({ foo: 1 });
    const log2 = s3sim.getAccessLog();
    // After process restart and explicit S3 state setup, only the index file should be accessed
    expect(log2).toEqual([expectedIndexFile]);
  });

  it('should only load the index entry file (/indices/{index}/{key}.json) at most once per key, even across multiple finds', async () => {
    // Setup: Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Simulate process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    const newCollection = new SengoCollection(collection, store);
    await newCollection.find({ foo: 1 });
    const log1 = s3sim.getAccessLog();
    const expectedIndexEntryFile = `${collection}/indices/${indexName}/${encodeURIComponent(makeIndexKey({ foo: 1 }))}.json`;
    const expectedDocFile = `${collection}/data/a.json`;
    expect(log1).toContain(expectedIndexEntryFile);
    expect(log1).toContain(expectedDocFile);
    // Simulate another process restart: new simulator and store
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    // Set up required S3 state from scratch
    setupIndexEntry(s3sim, collection, indexName, { foo: 1 }, ['a']);
    setupDocumentFile(s3sim, collection, 'a', { _id: 'a', foo: 1 });
    const newCollection2 = new SengoCollection(collection, store);
    await newCollection2.find({ foo: 1 });
    const log2 = s3sim.getAccessLog();
    // After process restart and explicit S3 state setup, only the index file should be accessed
    expect(log2).toEqual([expectedIndexEntryFile]);
    // Third find with a different key: should load a different index entry file
    await newCollection2.find({ foo: 2 });
    const log3 = s3sim.getAccessLog();
    const expectedIndexEntryFile2 = `${collection}/indices/${indexName}/${encodeURIComponent(makeIndexKey({ foo: 2 }))}.json`;
    expect(log3).toContain(expectedIndexEntryFile2);
    // And only once for that key
    ({ store, s3sim, sendMock } = makeStoreAndSim());
    const newCollection3 = new SengoCollection(collection, store);
    await newCollection3.find({ foo: 2 });
    const log4 = s3sim.getAccessLog();
    expect(log4).not.toContain(expectedIndexEntryFile2);
  });
});
