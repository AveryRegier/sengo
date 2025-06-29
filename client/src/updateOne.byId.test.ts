import { SengoClient } from './client/client';
import Chance from 'chance';
import { S3BucketSimulator } from './testutils/S3BucketSimulator';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const chance = new Chance();

describe('SengoClient updateOne API (memory backend)', () => {
  it('should update a document by _id', async () => {
    const client = new SengoClient('memory');
    const collection = client.db().collection('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    const { insertedId } = await collection.insertOne(animal);
    const updateResult = await collection.updateOne({ _id: insertedId }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: insertedId });
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
    // Mock PutObjectCommand
    s3Mock.on(PutObjectCommand).callsFake((input) => {
      bucketSim.putObject(input.Key, input.Body);
      return {};
    });
    // Mock GetObjectCommand
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      return bucketSim.getObject(input.Key);
    });
  });
  it('should update a document by _id', async () => {
    const client = new SengoClient('s3');
    const collection = client.db().collection('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    // Use a fixed _id for mock matching
    const { insertedId } = await collection.insertOne({ ...animal, _id: 'mockid' });
    const updateResult = await collection.updateOne({ _id: 'mockid' }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: 'mockid' });
    expect(found[0].name).toBe('UpdatedName');
  });
});
