import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import Chance from 'chance';
import { WithId } from '../../src/types';
import { S3 } from '@aws-sdk/client-s3';
import { S3CollectionStore } from '../../src/repository';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type TestDoc = {
  name: string;
  age: number;
  city: string;
};

describe('SengoCollection $in operator support', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;
  let docs: WithId<TestDoc>[];
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    client = new SengoClient();
    collection = client.db('s3').collection<TestDoc>('people');
    (collection.store as any).s3 = s3Client;
      // Mock S3 send method to simulate S3 behavior
    // Insert random documents
    docs = [];
    for (let i = 0; i < 10; i++) {
      const doc = {
        name: chance.name(),
        age: chance.age(),
        city: chance.city(),
      };
      const result = await collection.insertOne(doc);
      docs.push({ ...doc, _id: result.insertedId });
    }
  });

  it('finds documents using $in operator', async () => {
    // Pick 3 random names from inserted docs
    const names = docs.slice(0, 3).map(d => d.name);
    const found = await collection.find({ name: { $in: names } }).toArray();
    expect(found.length).toBe(3);
    expect(found.map(d => d.name).sort()).toEqual(names.sort());
  });
});