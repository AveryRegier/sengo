import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../src';
import Chance from 'chance';
import { S3BucketSimulator } from './repository/s3/S3BucketSimulator';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';

const chance = new Chance();

describe('SengoClient updateOne API (memory backend)', () => {
  it('should update a document by _id', async () => {
    const client = new SengoClient();  
    const collection = client.db('memory').collection<{ _id: string; name: string; kind: string }>('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    const { insertedId } = await collection.insertOne(animal);
    const updateResult = await collection.updateOne({ _id: insertedId }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: insertedId }).toArray();
    expect(found[0].name).toBe('UpdatedName');
  });
});

describe('SengoClient updateOne API (s3 backend)', () => {
  let bucketSim: S3BucketSimulator;
  let s3Mock: ReturnType<typeof mockClient>;
  beforeEach(() => {
    bucketSim = new S3BucketSimulator();
    s3Mock = mockClient(S3Client);
    s3Mock.reset();
    // Route mocked S3 commands to the S3BucketSimulator so it handles extraction
    // of Key/Body/Prefix consistently (the mock library passes the Command
    // instance, not the raw input object).
    s3Mock.on(PutObjectCommand).callsFake((cmd) => {
      return bucketSim.putObject(cmd as any);
    });
    s3Mock.on(GetObjectCommand).callsFake((cmd) => {
      return bucketSim.getObject(cmd as any);
    });
    s3Mock.on(ListObjectsV2Command).callsFake((cmd) => {
      return bucketSim.listObjectsV2(cmd as any);
    });
    s3Mock.on(HeadObjectCommand).callsFake((cmd) => {
      return bucketSim.headObject(cmd as any);
    });
  });
  it('should update a document by _id', async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{ _id: string; name: string; kind: string }>('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    // Use a fixed _id for mock matching
    const { insertedId } = await collection.insertOne({ ...animal, _id: 'mockid' });
    const updateResult = await collection.updateOne({ _id: 'mockid' }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: 'mockid' }).toArray();
    expect(found[0].name).toBe('UpdatedName');
  });
  it("should find a document by an indexed field after update of another field", async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{ _id: string; name: string; kind: string }>('animals');
    await collection.createIndex('name');
    const animal = { name: 'OriginalName', kind: chance.animal() };
    const { insertedId } = await collection.insertOne({ ...animal });
    bucketSim.clearAccessLog();
    await collection.updateOne({ _id: insertedId }, { $set: { kind: "something else" } });
    const cursor = collection.find({ name: 'OriginalName' });
    const found = await cursor.toArray();
    expect(found.length).toBe(1);
    expect(JSON.stringify(found[0]._id)).to.equal(JSON.stringify(insertedId));
    expect(found[0].kind).toBe("something else");
    expect(bucketSim.getIndexAccessLogDetailed()
      .filter(entry => entry.command === 'putObject').length).toBe(0);
  });
});
