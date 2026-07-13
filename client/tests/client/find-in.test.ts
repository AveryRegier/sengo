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
  tags: string[];
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
        tags: chance.unique(chance.word, 3) // Ensure unique tags
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

  it('finds documents using $eq operator', async () => {
    // Pick 3 random names from inserted docs
    const name = docs.slice(2, 3).map(d => d.name).pop() as string;
    const found = await collection.find({ name: { $eq: name } }).toArray();
    expect(found.length).toBe(1);
    expect(found.map(d => d.name)).toEqual([name]);
  });

  it('finds documents using default equality operator', async () => {
    // Pick 3 random names from inserted docs
    const name = docs.slice(2, 3).map(d => d.name).pop() as string;
    const found = await collection.find({ name: name }).toArray();
    expect(found.length).toBe(1);
    expect(found.map(d => d.name)).toEqual([name]);
  });

  it('finds documents using $eq operator in array', async () => {
    // Pick 3 random tags from inserted docs
    const tag = docs.slice(2, 3).map(d => chance.pickone(d.tags)).pop() as string;
    const found = await collection.find({ tags: { $eq: tag } }).toArray();
    expect(found.length).toBe(1);
    expect(found[0].tags).toContain(tag);
  });

  it('finds documents using default equality operator in array', async () => {
    // Pick 3 random tags from inserted docs
    const tag = docs.slice(2, 3).map(d => chance.pickone(d.tags)).pop() as string;
    const found = await collection.find({ tags: tag }).toArray();
    expect(found.length).toBe(1);
    expect(found[0].tags).toContain(tag);
  });

  it('finds documents using $in operator after creating an index', async () => {
    // Pick 3 random names from inserted docs
    const indexName = await collection.createIndex({ name: 1 });
    const names = docs.slice(0, 3).map(d => d.name);
    const found = await collection.find({ name: { $in: names } }).toArray();
    expect(found.length).toBe(3);
    expect(found.map(d => d.name).sort()).toEqual(names.sort());
  });

  it('finds documents using $in operator in array after creating an index', async () => {
    // Pick 3 random tags from inserted docs
    const indexName = await collection.createIndex({ tags: 1 });
    const tags = docs.slice(0, 3).map(d => chance.pickone(d.tags));
    const found = await collection.find({ tags: { $in: tags } }).toArray();
    expect(found.length).toBe(3);
  });

  it('finds documents using $gte on a single-field index without building an object lookup key', async () => {
    const events = client.db('s3').collection<{
      name: string;
      eventDate: string;
    }>('events');
    (events.store as any).s3 = s3Client;

    await events.insertOne({ _id: '1', name: 'Past Event', eventDate: '2026-01-15' });
    await events.insertOne({ _id: '2', name: 'Today Event', eventDate: '2026-07-12' });
    await events.insertOne({ _id: '3', name: 'Future Event 1', eventDate: '2026-08-01' });
    await events.insertOne({ _id: '4', name: 'Future Event 2', eventDate: '2026-09-20' });
    await events.createIndex({ eventDate: 1 });

    s3sim.clearLogs();

    const found = await events.find({ eventDate: { $gte: '2026-07-12' } }).toArray();

    expect(found.map(doc => doc._id).sort()).toEqual(['2', '3', '4']);

    const attemptedObjectKeyLookup = s3sim.getLogs().some(log =>
      log.command === 'getObject' &&
      typeof log.key === 'string' &&
      log.key.includes('/indices/eventDate_1/%5Bobject%20Object%5D.json')
    );
    expect(attemptedObjectKeyLookup).toBe(false);
  });

  it("find documents by _id using $in operator", async () => {
    // Pick 3 random _ids from inserted docs
    const ids = docs.slice(0, 3).map(d => d._id);
    const found = await collection.find({ _id: { $in: ids } }).toArray();
    expect(found.length).toBe(3);
    expect(found.map(d => d._id.toString()).sort()).toEqual(ids.map(id => id.toString()).sort());
  })
});