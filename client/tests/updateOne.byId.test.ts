import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../src';
import Chance from 'chance';
import { S3BucketSimulator } from './repository/s3/S3BucketSimulator';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

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
    // Mock PutObjectCommand
    s3Mock.on(PutObjectCommand).callsFake((input) => {
      bucketSim.putObject(input.Key, input.Body);
      return {};
    });
    // Mock GetObjectCommand
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      return bucketSim.getObject(input.Key);
    });
    // Mock ListObjectsV2Command
    s3Mock.on(ListObjectsV2Command).callsFake((input) => {
      return bucketSim.listObjectsV2(input.Prefix);
    });
  });
  it('should update a document by _id', async () => {
    const client = new SengoClient('s3');
    const collection = client.db().collection<{ _id: string; name: string; kind: string }>('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    // Use a fixed _id for mock matching
    const { insertedId } = await collection.insertOne({ ...animal, _id: 'mockid' });
    const updateResult = await collection.updateOne({ _id: 'mockid' }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: 'mockid' }).toArray();
    expect(found[0].name).toBe('UpdatedName');
  });
});
