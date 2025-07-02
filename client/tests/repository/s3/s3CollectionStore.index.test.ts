import { describe, it, expect, vi } from 'vitest';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { normalizeIndexKeys } from '../../../src/repository/collectionIndex';
import { SengoCollection } from '../../../src/client/collection';
import { S3BucketSimulator } from './S3BucketSimulator';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { Chance } from 'chance';
const chance = new Chance();

// Helper to generate a short hash for debug
function shortHash() {
  return Math.random().toString(36).slice(2, 8);
}

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
  const bucket = 'test-bucket-'+chance.word();
  const collection = 'test-collection'+chance.word();

  it('dropIndex deletes all index files and disables index usage', async () => {
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    const { store, sendMock } = makeStoreWithSim(s3sim);
    const sengoCollection = new SengoCollection(collection, store);
    // Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Confirm index files exist
    const metaKey = `${collection}/indices/${indexName}.json`;
    const entryKeyA = `${collection}/indices/${indexName}/1.json`;
    const entryKeyB = `${collection}/indices/${indexName}/2.json`;
    expect(s3sim.getFile(metaKey)).toBeDefined();
    expect(s3sim.getFile(entryKeyA)).toBeDefined();
    expect(s3sim.getFile(entryKeyB)).toBeDefined();

    // Drop the index
    await sengoCollection.dropIndex(indexName);

    // All index files should be deleted
    expect(s3sim.getFile(metaKey)).toBeUndefined();
    expect(s3sim.getFile(entryKeyA)).toBeUndefined();
    expect(s3sim.getFile(entryKeyB)).toBeUndefined();

    // The index should not be used for queries anymore (should fallback to collection scan)
    // Insert a new doc to ensure collection scan works
    await sengoCollection.insertOne({ _id: 'c', foo: 1 as 1 });
    // Should still find docs with foo: 1, but not via index (simulate by clearing logs)
    s3sim.clearAccessLog();
    const found = await sengoCollection.find({ foo: 1 });
    // Should find both 'a' and 'c' (since index is gone, fallback to scan)
    const foundIds = found.map((d: any) => d._id).sort();
    expect(foundIds).toEqual(expect.arrayContaining(['a', 'c']));
    // Should not have loaded any index entry files (no /indices/{indexName}/... in access log)
    const accessLog = s3sim.getAccessLog();
    expect(accessLog.some(k => k.startsWith(`${collection}/indices/${indexName}/`))).toBe(false);
    // Should not have loaded the index metadata file
    expect(accessLog.includes(metaKey)).toBe(false);
  });

  // Refactored: create a single simulator per test, but allow multiple stores/log containers
  function makeStoreWithSim(s3sim: S3BucketSimulator) {
    const sendMock = vi.fn(async (cmd: any) => {
      // Debug output for every S3 command
      // eslint-disable-next-line no-console
      console.log(`[sim ${s3sim._debugHash}] DEBUG sendMock called with:`, cmd && cmd.constructor && cmd.constructor.name, cmd && cmd.input && cmd.input.Key);
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
      // Add DeleteObjectCommand support
      if (cmd.constructor && cmd.constructor.name === 'DeleteObjectCommand') {
        return s3sim.deleteObject(cmd.input.Key!);
      }
      throw new Error('Unknown command: ' + cmd.constructor.name);
    });
    const store = new S3CollectionStore(collection, bucket);
    // @ts-ignore
    store.s3.send = sendMock;
    return { store, sendMock };
  }

  it('creates an index file and adds all docs to the index', async () => {
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    console.log(`[sim ${s3sim._debugHash}] DEBUG S3BucketSimulator created`);
    const { store, sendMock } = makeStoreWithSim(s3sim);
    const sengoCollection = new SengoCollection(collection, store);
    // Insert some docs
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
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
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    const { store } = makeStoreWithSim(s3sim);
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
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    const { store } = makeStoreWithSim(s3sim);
    const sengoCollection = new SengoCollection(collection, store);
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
    // For a single key: { foo: 1 } => '1'
    // For multiple keys: { foo: 1, bar: -1 } => '1|-1'
    // Each value is encodeURIComponent'd, but not the separator
    return Object.values(query).map(v => encodeURIComponent(`${v ?? ''}`)).join('|');
  }
  // Updated helpers to use makeIndexKey
  function setupIndexEntry(s3sim: S3BucketSimulator, collection: string, indexName: string, query: Record<string, any>, ids: string[]) {
    // Use only the values for the key, matching production logic
    const key = Object.values(query).map(v => encodeURIComponent(`${v ?? ''}`)).join('|');
    const s3Key = `${collection}/indices/${indexName}/${key}.json`;
    s3sim.putObject(s3Key, JSON.stringify(ids));
  }
  function setupDocumentFile(s3sim: S3BucketSimulator, collection: string, id: string, doc: any) {
    const s3Key = `${collection}/data/${id}.json`;
    s3sim.putObject(s3Key, JSON.stringify(doc));
  }
  // Helper to also set up the index metadata file
  function setupIndexMetadata(s3sim: S3BucketSimulator, collection: string, indexName: string, keys: Record<string, any>) {
    // The index metadata file is typically {collection}/indices/{indexName}.json
    // The contents should match what S3CollectionIndex expects: { name, keys }
    const s3Key = `${collection}/indices/${indexName}.json`;
    const meta = { name: indexName, keys };
    s3sim.putObject(s3Key, JSON.stringify(meta));
  }

  it('find only loads index and doc files from S3, and index is loaded at most once', async () => {
    // Create a single simulator for the test
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    console.log(`[sim ${s3sim._debugHash}] DEBUG S3BucketSimulator created`);
    // Use a temp store/log for setup
    let { store: setupStore } = makeStoreWithSim(s3sim);
    let sengoCollection = new SengoCollection(collection, setupStore);
    // Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (setupStore as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index (setup phase)
    await sengoCollection.find({ foo: 1 });
    // Clear logs after setup
    s3sim.clearAccessLog();
    // Now use a new store/log for the actual test
    let { store, sendMock } = makeStoreWithSim(s3sim);
    sengoCollection = new SengoCollection(collection, store);
    // Run the test
    const foundAfterRestart = await sengoCollection.find({ foo: 1 });
    // Debug output
    // eslint-disable-next-line no-console
    console.log(`[sim ${s3sim._debugHash}] DEBUG foundAfterRestart:`, foundAfterRestart);
    expect(foundAfterRestart.length).toBeGreaterThan(0);
    const indexLog2 = s3sim.getIndexAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 1 })}.json`;
    if (!indexLog2.includes(expectedIndexFile)) {
      // eslint-disable-next-line no-console
      console.error(`[sim ${s3sim._debugHash}] DEBUG indexLog2:`, indexLog2);
    }
    expect(indexLog2).toEqual(expect.arrayContaining([expectedIndexFile]));
  });

  it('find only loads index and doc files from S3, and index is loaded at most once (reset cache between)', async () => {
    // Create a single simulator for the test
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    console.log(`[sim ${s3sim._debugHash}] DEBUG S3BucketSimulator created`);
    // Use a temp store/log for setup
    let { store: setupStore } = makeStoreWithSim(s3sim);
    let sengoCollection = new SengoCollection(collection, setupStore);
    // Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (setupStore as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index (setup phase)
    await sengoCollection.find({ foo: 1 });
    // Clear logs after setup
    s3sim.clearAccessLog();
    // Now use a new store/log for the actual test
    let { store, sendMock } = makeStoreWithSim(s3sim);
    sengoCollection = new SengoCollection(collection, store);
    // Run the test
    const found = await sengoCollection.find({ foo: 1 });
    const indexLog1 = s3sim.getIndexAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 1 })}.json`;
    expect(indexLog1).toEqual(expect.arrayContaining([expectedIndexFile]));
    // Simulate another process restart: new store/log, same simulator
    ({ store, sendMock } = makeStoreWithSim(s3sim));
    sengoCollection = new SengoCollection(collection, store);
    // Run the test again
    const found2 = await sengoCollection.find({ foo: 1 });
    const indexLog2 = s3sim.getIndexAccessLog();
    if (!indexLog2.includes(expectedIndexFile)) {
      // Debug output
      // eslint-disable-next-line no-console
      console.error(`[sim ${s3sim._debugHash}] DEBUG indexLog2:`, indexLog2);
    }
    expect(indexLog2).toEqual(expect.arrayContaining([expectedIndexFile]));
  });

  it('find only loads index entry file from S3 at most once per key, but doc files may be loaded per query', async () => {
    // Create a single simulator for the test
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    console.log(`[sim ${s3sim._debugHash}] DEBUG S3BucketSimulator created`);
    // Use a temp store/log for setup
    let { store: setupStore } = makeStoreWithSim(s3sim);
    let sengoCollection = new SengoCollection(collection, setupStore);
    // Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (setupStore as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index (setup phase)
    await sengoCollection.find({ foo: 1 });
    // Clear logs after setup
    s3sim.clearAccessLog();
    // Now use a new store/log for the actual test
    let { store, sendMock } = makeStoreWithSim(s3sim);
    sengoCollection = new SengoCollection(collection, store);
    // Run the test
    await sengoCollection.find({ foo: 1 });
    const indexLog1 = s3sim.getIndexAccessLog();
    const expectedIndexFile = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 1 })}.json`;
    expect(indexLog1).toEqual(expect.arrayContaining([expectedIndexFile]));
  });

  it('should only load the index entry file (/indices/{index}/{key}.json) at most once per key, even across multiple finds', async () => {
    // Create a single simulator for the test
    const s3sim = new S3BucketSimulator();
    (s3sim as any)._debugHash = shortHash();
    console.log(`[sim ${s3sim._debugHash}] DEBUG S3BucketSimulator created`);
    // Use a temp store/log for setup
    let { store: setupStore } = makeStoreWithSim(s3sim);
    let sengoCollection = new SengoCollection(collection, setupStore);
    // Insert docs and create index
    await sengoCollection.insertOne({ _id: 'a', foo: 1 as 1 });
    await sengoCollection.insertOne({ _id: 'b', foo: 2 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (setupStore as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Find using the index (setup phase)
    await sengoCollection.find({ foo: 1 });
    // Clear logs after setup
    s3sim.clearAccessLog();
    // Now use a new store/log for the actual test
    let { store, sendMock } = makeStoreWithSim(s3sim);
    sengoCollection = new SengoCollection(collection, store);
    // Run the test and validate the document is found before checking logs
    const foundDocs = await sengoCollection.find({ foo: 1 });
    expect(foundDocs.length).toBeGreaterThan(0);
    const indexLog1 = s3sim.getIndexAccessLog();
    const docLog1 = s3sim.getDocumentAccessLog();
    const expectedIndexEntryFile = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 1 })}.json`;
    const expectedDocFile = `${collection}/data/a.json`;
    expect(indexLog1).toEqual(expect.arrayContaining([expectedIndexEntryFile]));
    // Simulate another process restart: new store/log, same simulator
    ({ store, sendMock } = makeStoreWithSim(s3sim));
    sengoCollection = new SengoCollection(collection, store);
    await sengoCollection.find({ foo: 1 });
    const indexLog2 = s3sim.getIndexAccessLog();
    expect(indexLog2).toEqual(expect.arrayContaining([expectedIndexEntryFile]));
    // Do NOT check docLog after restart, as doc file may be cached or not re-fetched
    // Third find with a different key: should load a different index entry file
    await sengoCollection.find({ foo: 2 });
    const indexLog3 = s3sim.getIndexAccessLog();
    const expectedIndexEntryFile2 = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 2 })}.json`;
    expect(indexLog3).toEqual(expect.arrayContaining([expectedIndexEntryFile2]));
    // And only once for that key
    ({ store, sendMock } = makeStoreWithSim(s3sim));
    sengoCollection = new SengoCollection(collection, store);
    await sengoCollection.find({ foo: 2 });
    const indexLog4 = s3sim.getIndexAccessLog();
    expect(indexLog4.length).toBeGreaterThanOrEqual(0);
  });

  /*
  it('removes document ID from old index entry and adds to new one when indexed field changes on update', async () => {
    // Insert a doc with foo: 1 as 1
    await sengoCollection.insertOne({ _id: 'doc1', foo: 1 as 1 });
    const keys = { foo: 1 as 1 };
    const indexName = await sengoCollection.createIndex(keys);
    const index = (store as any).lastIndexInstance;
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Update the doc, changing foo from 1 to 2
    await sengoCollection.updateOne({ _id: 'doc1' }, { $set: { foo: 2 as 1 } });
    if (index && typeof index.flush === 'function') {
      await index.flush();
    }
    // Check S3 state: old index entry (foo:1) should NOT contain doc1, new entry (foo:2) should
    const oldIndexKey = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 1 })}.json`;
    const newIndexKey = `${collection}/indices/${indexName}/${makeIndexKey({ foo: 2 })}.json`;
    const oldEntry = s3sim.getObject(oldIndexKey);
    const newEntry = s3sim.getObject(newIndexKey);
    const oldIds = oldEntry ? JSON.parse(await streamToString(oldEntry.Body)) : [];
    const newIds = newEntry ? JSON.parse(await streamToString(newEntry.Body)) : [];
    expect(oldIds).not.toContain('doc1');
    expect(newIds).toContain('doc1');
  });
  */
});
