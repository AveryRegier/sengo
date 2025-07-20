import { S3BucketSimulator } from './S3BucketSimulator';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { SengoCollection } from '../../../src/client/collection';
import { ObjectId } from 'bson';
import { describe, it, expect } from 'vitest';
import { beforeEach } from 'node:test';

type TestDoc = {
    commonKey: string;
    data: string;
};

describe('Concurrent Index Updates', () => {

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
});
