import { S3BucketSimulator } from './S3BucketSimulator';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { SengoCollection } from '../../../src/client/collection';
import { ObjectId } from 'bson';
import { describe, it, expect } from 'vitest';
import { S3CollectionIndex } from '../../../src/repository/s3/s3CollectionIndex';

type TestDoc = {
    commonKey: string;
    data: string;
};

describe('Concurrent Index Updates', () => {
  function makeSharedS3Client(s3sim: S3BucketSimulator) {
    let readBarrier: (() => Promise<void>) | undefined;
    const conditionalPuts: { ifMatch?: string; ifNoneMatch?: string }[] = [];

    return {
      conditionalPuts,
      setReadBarrierForGets(expectedReads: number) {
        let gatedReads = expectedReads;
        let arrivals = 0;
        let release!: () => void;
        let barrier = new Promise<void>(resolve => {
          release = resolve;
        });
        readBarrier = async () => {
          if (gatedReads === 0) {
            return;
          }
          gatedReads--;
          arrivals++;
          if (arrivals === 2) {
            release();
          }
          await barrier;
          if (arrivals === 2 && gatedReads > 0) {
            arrivals = 0;
            barrier = new Promise<void>(resolve => {
              release = resolve;
            });
          }
        };
        return () => {
          readBarrier = undefined;
        };
      },
      client: {
        send: async (cmd: any) => {
          if (cmd.constructor.name === 'GetObjectCommand' && readBarrier) {
            try {
              const result = await s3sim.handleCommand(cmd);
              await readBarrier();
              return result;
            } catch (err) {
              await readBarrier();
              throw err;
            }
          }
          if (cmd.constructor.name === 'PutObjectCommand' && cmd.input.Key.includes('/indices/')) {
            conditionalPuts.push({
              ifMatch: cmd.input.IfMatch,
              ifNoneMatch: cmd.input.IfNoneMatch,
            });
          }
          return s3sim.handleCommand(cmd);
        },
      },
    };
  }

  function makeIndex(s3: any) {
    return new S3CollectionIndex('commonKey_1', [{ field: 'commonKey', order: 1 }], {
      s3,
      collectionName: 'test-collection',
      bucket: 'test-bucket',
    });
  }

  it('should merge index entries from two clients and find both documents', async () => {
    const bucketName = 'test-bucket';
    const collectionName = 'test-collection';

    const s3sim: S3BucketSimulator = new S3BucketSimulator(); 
    const s3Client: { send: (cmd: any) => any } = { send: s3sim.handleCommand.bind(s3sim) };
    // Create two S3CollectionStore instances using the same simulator
    const store1 = new S3CollectionStore(collectionName, bucketName);
    const store2 = new S3CollectionStore(collectionName, bucketName);
    (store1 as any).s3 = s3Client;
    (store2 as any).s3 = s3Client;

    // Create two SengoCollection clients using the stores
    const client1 = new SengoCollection(collectionName, store1);
    const client2 = new SengoCollection(collectionName, store2);

    // Create an index
    const indexName1 = await client1.createIndex('commonKey');

    // force client2 to load the index
    await expect(client2.find({ commonKey: 'sharedValue' }).toArray()).resolves.toEqual([]); ;

    // Insert documents with the same key value but different IDs
    const doc1 = { _id: new ObjectId(), commonKey: 'sharedValue', data: 'client1-doc' };
    const doc2 = { _id: new ObjectId(), commonKey: 'sharedValue', data: 'client2-doc' };

    await expect(client1.insertOne(doc1)).resolves.toEqual({ acknowledged: true, insertedId: doc1._id });
    await expect(client2.insertOne(doc2)).resolves.toEqual({ acknowledged: true, insertedId: doc2._id });

    // Ensure both clients can find both documents by the shared key
    const results1 = await client1.find({ commonKey: 'sharedValue' }).toArray();
    const results2 = await client2.find({ commonKey: 'sharedValue' }).toArray();

    expect(results2).toHaveLength(2);
    expect(results1).toHaveLength(2);

    const ids1 = results1.map(doc => doc._id.toString());
    const ids2 = results2.map(doc => doc._id.toString());

    expect(ids1).toContain(doc1._id.toString());
    expect(ids1).toContain(doc2._id.toString());
    expect(ids2).toContain(doc1._id.toString());
    expect(ids2).toContain(doc2._id.toString());
  });

  it('conditionally creates a missing entry and merges concurrent additions', async () => {
    const s3sim = new S3BucketSimulator();
    const shared = makeSharedS3Client(s3sim);
    const first = makeIndex(shared.client);
    const second = makeIndex(shared.client);

    await Promise.all([
      first.findIdsForKey('sharedValue'),
      second.findIdsForKey('sharedValue'),
    ]);
    const releaseReads = shared.setReadBarrierForGets(4);

    await Promise.all([
      first.addDocument({ _id: 'first', commonKey: 'sharedValue' }),
      second.addDocument({ _id: 'second', commonKey: 'sharedValue' }),
    ]);
    releaseReads();

    await expect(first.findIdsForKey('sharedValue')).resolves.toEqual(
      expect.arrayContaining(['first', 'second'])
    );
    expect(shared.conditionalPuts.some(put => put.ifNoneMatch === '*')).toBe(true);
    expect(shared.conditionalPuts.some(put => put.ifMatch !== undefined)).toBe(true);
    expect(shared.conditionalPuts).toHaveLength(3);
  });

  it('reloads and replays concurrent additions to an existing entry', async () => {
    const s3sim = new S3BucketSimulator();
    const shared = makeSharedS3Client(s3sim);
    const seed = makeIndex(shared.client);
    await seed.addDocument({ _id: 'seed', commonKey: 'sharedValue' });
    shared.conditionalPuts.length = 0;

    const first = makeIndex(shared.client);
    const second = makeIndex(shared.client);
    await Promise.all([
      first.findIdsForKey('sharedValue'),
      second.findIdsForKey('sharedValue'),
    ]);
    const releaseReads = shared.setReadBarrierForGets(2);

    await Promise.all([
      first.addDocument({ _id: 'first', commonKey: 'sharedValue' }),
      second.addDocument({ _id: 'second', commonKey: 'sharedValue' }),
    ]);
    releaseReads();

    await expect(first.findIdsForKey('sharedValue')).resolves.toEqual(
      expect.arrayContaining(['seed', 'first', 'second'])
    );
    expect(shared.conditionalPuts.every(put => put.ifMatch !== undefined)).toBe(true);
    expect(shared.conditionalPuts).toHaveLength(3);
  });

  it('preserves a concurrent removal and addition to an existing entry', async () => {
    const s3sim = new S3BucketSimulator();
    const shared = makeSharedS3Client(s3sim);
    const seed = makeIndex(shared.client);
    await seed.addDocument({ _id: 'remove-me', commonKey: 'sharedValue' });
    shared.conditionalPuts.length = 0;

    const first = makeIndex(shared.client);
    const second = makeIndex(shared.client);
    await Promise.all([
      first.findIdsForKey('sharedValue'),
      second.findIdsForKey('sharedValue'),
    ]);
    const releaseReads = shared.setReadBarrierForGets(2);

    await Promise.all([
      first.removeDocument({ _id: 'remove-me', commonKey: 'sharedValue' }),
      second.addDocument({ _id: 'keep-me', commonKey: 'sharedValue' }),
    ]);
    releaseReads();

    await expect(first.findIdsForKey('sharedValue')).resolves.toEqual(['keep-me']);
    expect(shared.conditionalPuts.every(put => put.ifMatch !== undefined)).toBe(true);
    expect(shared.conditionalPuts).toHaveLength(3);
  });
});
