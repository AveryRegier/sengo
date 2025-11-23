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
    client = new SengoClient();
    collection = client.db('s3').collection<TestDoc>('people');
    (collection.store as any).s3 = s3Client;
      // Mock S3 send method to simulate S3 behavior
    // Insert random documents
    docs = [];
    for (let i = 0; i < 10; i++) {
      await addDocument();
    }
  });

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

  it('finds most recently created document from an index using sort by most recent ObjectId', async () => {
    // Pick any random docuument
    const notFound = chance.pickone(docs);
    // _id is not indexed and tags is diffucult to test with, so pick another indexed field
    const key = chance.pickone(Object.keys(notFound).filter(k => k !== '_id' && k !== 'tags') as (keyof TestDoc)[]);
    const value = notFound[key];
    // Find most recent document matching that indexed field
    const expected = await addDocument({[key]: value} as Partial<TestDoc>); // Add another document with same indexed field to ensure multiple matches
    await collection.createIndex({ [key]: 1 });

    const found = await collection.findOne({ [key]: value }, { sort: { _id: -1 } });
    expect(found).toBeDefined();
    expect(found?.[key]).toEqual(value);
    expect(found?._id?.toString()).toMatchObject(expected?._id?.toString() as any); // Last inserted doc should be most recent

    // the hard part. Be smart about the index usage and load only the one correct document file
    // expect(s3sim.getDocumentAccessLog()).toMatchObject([`/people/data/${expected._id}.json`]);
  });

  async function addDocument(fields: Partial<TestDoc> = {}) {
    const doc = {
      name: fields.name ?? chance.name(),
      age: fields.age ?? chance.age(),
      city: fields.city ?? chance.city(),
      tags: fields.tags ?? chance.unique(chance.word, 3) // Ensure unique tags
    };
    const result = await collection.insertOne(doc);
    const docWithId = { ...doc, _id: result.insertedId };
    docs.push(docWithId);
    return docWithId;
  }
});