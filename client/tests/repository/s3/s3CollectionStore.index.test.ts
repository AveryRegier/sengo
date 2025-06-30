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
  let store: S3CollectionStore;
  let s3sim: S3BucketSimulator;
  let sendMock: ReturnType<typeof vi.fn>;
  let sengoCollection: SengoCollection;

  beforeEach(() => {
    store = new S3CollectionStore(collection, bucket);
    s3sim = new S3BucketSimulator();
    sendMock = vi.fn(async (cmd: any) => {
      if (cmd instanceof PutObjectCommand) {
        await new Promise(res => setTimeout(res, 1)); // async tick
        s3sim.putObject(cmd.input.Key!, String(cmd.input.Body));
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        return s3sim.getObject(cmd.input.Key!);
      }
      if (cmd instanceof ListObjectsV2Command) {
        const keys = s3sim.listObjects(cmd.input.Prefix);
        return { Contents: keys.map(Key => ({ Key })) };
      }
      throw new Error('Unknown command: ' + cmd.constructor.name);
    });
    // @ts-ignore
    store.s3.send = sendMock;
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
});
