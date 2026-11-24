import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import Chance from 'chance';
import { WithId } from '../../src/types';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type TestDoc = {
  name: string;
  age: number;
  city: string;
  tags: string[];
  createdAt: string;
};

describe('findOne', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;
  let docs: WithId<TestDoc>[];
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    openClient();
      // Mock S3 send method to simulate S3 behavior
    // Insert random documents
    docs = [];
    for (let i = 0; i < 10; i++) {
      await addDocument();
    }
  });
  
  function openClient() {
    client = new SengoClient();
    collection = client.db('s3').collection<TestDoc>('people');
    (collection.store as any).s3 = s3Client;
  }

  it('finds documents using $in and sorts by field', async () => {
    // Pick 3 random names from inserted docs
    const names = docs.slice(0, 3).map(d => d.name);
    const found = await collection.findOne({ name: { $in: names } }, { sort: { name: 1 } });
    expect(found).toBeDefined();
    expect(found?.name).toEqual(names.sort()[0]);
  });

  it('finds most recently created document using sort by most recent ObjectId', async () => {
    // Pick 3 random names from inserted docs
    const found = await collection.findOne({}, { sort: { _id: -1 } });
    expect(found).toBeDefined();
    const expected = docs[docs.length - 1];
    expect(found?._id?.toString()).toMatchObject(expected?._id?.toString() as any); // Last inserted doc should be most recent
  });

  it('finds most recently created document using sort by iso date', async () => {
    // Pick 3 random names from inserted docs
    const found = await collection.findOne({}, { sort: { createdAt: -1 } });
    expect(found).toBeDefined();
    const expected = docs[docs.length - 1];
    expect(found?._id?.toString()).toMatchObject(expected?._id?.toString() as any); // Last inserted doc should be most recent
  });

  it('finds most recently created document from an index using sort by most recent ObjectId', async () => {
    // Pick any random docuument
    const notFound = chance.pickone(docs);
    // _id is not indexed and tags is diffucult to test with, so pick another indexed field
    const key = chance.pickone(Object.keys(notFound).filter(k => k !== '_id' && k !== 'tags') as (keyof TestDoc)[]);
    const value = notFound[key];
    // Find most recent document matching that indexed field
    const expected = await addDocument({[key]: value} as Partial<TestDoc>); // Add another document with same indexed field to ensure multiple matches
    await collection.createIndex({ [key]: 1 });
    s3sim.clearAccessLog();
    client.close();
    openClient();
    const found = await collection.findOne({ [key]: value }, { sort: { _id: -1 } });
    expect(found).toBeDefined();
    expect(found?.[key]).toEqual(value);
    expect(found?._id?.toString()).toMatchObject(expected?._id?.toString() as any); // Last inserted doc should be most recent

    // the hard part. Be smart about the index usage and load only the one correct document file
    expect(s3sim.getDocumentAccessLog()).toContain(`people/data/${expected._id.toString()}.json`);
    expect(s3sim.getDocumentAccessLog().length).toBe(1);
  });

  it('applies residual filters before limiting indexed results', async () => {
    await collection.insertOne({ _id: 'a', name: 'indexed-group', age: 10, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'indexed-group', age: 20, city: 'Oslo', tags: [], createdAt: '' });
    await collection.createIndex({ name: 1 });

    const filter = { name: 'indexed-group', age: { $gte: 20 } };
    const sort = { _id: 1 } as const;
    expect(await collection.find(filter, { sort }).toArray()).toMatchObject([{ _id: 'b' }]);
    expect(await collection.find(filter, { sort, limit: 1 }).toArray()).toMatchObject([{ _id: 'b' }]);
    expect(await collection.findOne(filter, { sort })).toMatchObject({ _id: 'b' });
    const explain = await collection.findOne(filter, { sort, explain: 'executionStats' });
    expect(explain.result).toMatchObject({ _id: 'b' });
    expect(explain.executionStats?.indexSortLimitOptimization.used).toBe(false);
    expect(explain.executionStats?.documentsLoaded).toBe(2);
    const explainMany = await collection.find(filter, { sort, limit: 1, explain: 'executionStats' });
    expect(explainMany.result).toMatchObject([{ _id: 'b' }]);
    expect(explainMany.executionStats?.indexSortLimitOptimization.used).toBe(false);
    expect(explainMany.executionStats?.documentsLoaded).toBe(2);
  });

  it('stops loading indexed candidates after finding an unsorted residual match', async () => {
    await collection.insertOne({ _id: 'a', name: 'incremental-group', age: 10, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'incremental-group', age: 20, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'c', name: 'incremental-group', age: 30, city: 'Oslo', tags: [], createdAt: '' });
    await collection.createIndex({ name: 1 });
    const filter = { name: 'incremental-group', age: { $gte: 20 } };

    s3sim.clearLogs();
    expect(await collection.findOne({ name: 'incremental-group', age: { $gte: 10 } })).toMatchObject({ _id: 'a' });
    expect(s3sim.getDocumentAccessLog()).toHaveLength(1);

    s3sim.clearLogs();
    const one = await collection.findOne(filter, { explain: 'executionStats' });
    expect(one.result).toMatchObject({ _id: 'b' });
    expect(one.executionStats?.documentsLoaded).toBe(2);
    expect(one.executionStats?.indexSortLimitOptimization.reason).toBe('limit served after incremental filtering');
    expect(s3sim.getDocumentAccessLog()).toHaveLength(2);

    s3sim.clearLogs();
    const many = await collection.find(filter, { limit: 1, explain: 'executionStats' });
    expect(many.result).toMatchObject([{ _id: 'b' }]);
    expect(many.executionStats?.documentsLoaded).toBe(2);
    expect(many.executionStats?.indexSortLimitOptimization.reason).toBe('limit served after incremental filtering');
    expect(s3sim.getDocumentAccessLog()).toHaveLength(2);

    s3sim.clearLogs();
    expect(await collection.find(filter, { limit: 2 }).toArray()).toMatchObject([{ _id: 'b' }, { _id: 'c' }]);
    expect(s3sim.getDocumentAccessLog()).toHaveLength(3);

    s3sim.clearLogs();
    expect(await collection.findOne({ name: 'incremental-group', age: { $gte: 100 } })).toBeNull();
    expect(s3sim.getDocumentAccessLog()).toHaveLength(3);
  });

  it('applies a compound index final-field filter before an _id sort limit', async () => {
    await collection.insertOne({ _id: 'a', name: 'compound-group', age: 10, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'compound-group', age: 20, city: 'Oslo', tags: [], createdAt: '' });
    await collection.createIndex({ name: 1, age: 1 });

    const filter = { name: 'compound-group', age: { $gte: 20 } };
    const sort = { _id: 1 } as const;
    expect(await collection.find(filter, { sort, limit: 1 }).toArray()).toMatchObject([{ _id: 'b' }]);
    expect(await collection.findOne(filter, { sort })).toMatchObject({ _id: 'b' });
  });

  it('applies additional operators on an indexed field before limiting', async () => {
    await collection.insertOne({ _id: 'a', name: 'first', age: 10, city: 'Oslo', tags: ['red', 'blue'], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'second', age: 20, city: 'Oslo', tags: ['red'], createdAt: '' });
    await collection.createIndex({ tags: 1 });

    const filter = { tags: { $in: ['red'], $nin: ['blue'] } };
    const sort = { _id: 1 } as const;
    expect(await collection.find(filter, { sort, limit: 1 }).toArray()).toMatchObject([{ _id: 'b' }]);
    expect(await collection.findOne(filter, { sort })).toMatchObject({ _id: 'b' });
  });

  it('applies every sort field before limiting indexed results', async () => {
    await collection.insertOne({ _id: 'a', name: 'sorted-group', age: 10, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'sorted-group', age: 20, city: 'Oslo', tags: [], createdAt: '' });
    await collection.createIndex({ name: 1 });

    const filter = { name: 'sorted-group' };
    const sort = { name: 1, _id: -1 } as const;
    expect(await collection.find(filter, { sort, limit: 1 }).toArray()).toMatchObject([{ _id: 'b' }]);
    expect(await collection.findOne(filter, { sort })).toMatchObject({ _id: 'b' });
  });

  it('reports indexed limit optimization for both read methods when safe', async () => {
    await collection.insertOne({ _id: 'a', name: 'explain-group', age: 10, city: 'Oslo', tags: [], createdAt: '' });
    await collection.insertOne({ _id: 'b', name: 'explain-group', age: 20, city: 'Oslo', tags: [], createdAt: '' });
    await collection.createIndex({ name: 1 });
    const filter = { name: 'explain-group' };
    const sort = { _id: 1 } as const;

    s3sim.clearLogs();
    const one = await collection.findOne(filter, { sort, explain: 'executionStats' });
    expect(one.result).toMatchObject({ _id: 'a' });
    expect(one.executionStats?.indexSortLimitOptimization.used).toBe(true);
    expect(s3sim.getDocumentAccessLog()).toHaveLength(1);

    const many = await collection.find(filter, { sort, limit: 1, explain: 'executionStats' });
    expect(many.result).toMatchObject([{ _id: 'a' }]);
    expect(many.executionStats?.indexSortLimitOptimization.used).toBe(true);
  });

  async function addDocument(fields: Partial<TestDoc> = {}) {
    const doc = {
      name: fields.name ?? chance.name(),
      age: fields.age ?? chance.age(),
      city: fields.city ?? chance.city(),
      tags: fields.tags ?? chance.unique(chance.word, 3), // Ensure unique tags
      createdAt: fields.createdAt ?? new Date().toISOString(),
    };
    const result = await collection.insertOne(doc);
    const docWithId = { ...doc, _id: result.insertedId };
    docs.push(docWithId);
    return docWithId;
  }
});