import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import Chance from 'chance';
import { SengoCollection } from '../../src/client/collection';
import { WithId } from '../../src/types';

type TestDoc = {
  name: string;
  age: number;
  email: string;
  city: string;
  random: string;
};

describe('SengoCollection createIndex and find (Memory)', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;
  let docs: WithId<TestDoc>[];

  const docCreator = () => ({
    name: chance.name(),
    age: chance.age(),
    email: chance.email(),
    city: chance.city(),
    random: chance.string({ length: 10 })
  });

  beforeEach(async () => {
    client = new SengoClient('memory');
    const collectionName = 'col_' + chance.hash({ length: 8 });
    collection = client.db().collection<TestDoc>(collectionName);
    // Create and insert docs, capturing their _id
    docs = [];
    for (let i = 0; i < 3; i++) {
      const doc = docCreator();
      const result = await collection.insertOne(doc);
      docs.push({ ...doc, _id: result.insertedId });
    }
  });

  afterEach(async () => {
    await client.close();
  });

  it('should insert, create index, insert more, and find docs matching the index', async () => {
    const indexField = Object.keys(docs[0]).find(k => k !== '_id')!;
    const indexName = await collection.createIndex({ [indexField]: 1 });
    expect(typeof indexName).toBe('string');
    
    // Insert more docs
    const moreDocs = Array.from({ length: 3 }, docCreator);
    for (const doc of moreDocs) {
        await collection.insertOne(doc);
    }  

    // Find a subset using the indexed field
    const subsetValue = docs[0][indexField];
    const subsetFound = await collection.find({ [indexField]: subsetValue }).toArray();
    // Should find at least one (the doc with that value)
    expect(subsetFound.length).toBeGreaterThanOrEqual(1);
    expect(subsetFound.some(d => d.email === docs[0].email)).toBe(true);
  });

  it('should insert, create index, insert more, and find all docs', async () => {
    const indexField = Object.keys(docs[0]).find(k => k !== '_id')!;
    const indexName = await collection.createIndex({ [indexField]: 1 });
    expect(typeof indexName).toBe('string');
    
    // Insert more docs
    const moreDocs = Array.from({ length: 3 }, docCreator);
    for (const doc of moreDocs) {
        await collection.insertOne(doc);
    }  

    // Find all docs (should get all 8)
    const found = await collection.find({}).toArray();
    expect(found.length).toBe(6);
    // All docs should be present
    const allDocs = [...docs, ...moreDocs];
    for (const doc of allDocs) {
      // Find by a unique field (email)
      const match = found.find(f => f.email === doc.email);
      expect(match).toBeDefined();
      expect(match).toMatchObject(doc);
    }
  });

  it('should create index and allow queries to work as expected', async () => {
    // Only observable behavior is tested for memory store
    const indexField = Object.keys(docs[0]).find(k => k !== '_id')!;
    const indexName = await collection.createIndex({ [indexField]: 1 });
    expect(typeof indexName).toBe('string');
    // Query by the indexed field should return at least one doc
    const value = docs[0][indexField];
    const found = await collection.find({ [indexField]: value }).toArray();
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some(d => d.email === docs[0].email)).toBe(true);
  });

  it('updates to indexed fields allow correct query results', async () => {
    // Only observable behavior is tested for memory store
    const doc = { ...docCreator(), foo: 'A' };
    const insertResult = await collection.insertOne(doc);
    const docId = insertResult.insertedId.toString();
    const indexName = await collection.createIndex({ foo: 1 });
    await collection.updateOne({ _id: docId }, { $set: { foo: 'B' } });
    // Should not find doc by old value
    let found = await collection.find({ foo: 'A' }).toArray();
    expect(found.length).toBe(0);
    // Should find doc by new value
    found = await collection.find({ foo: 'B' }).toArray();
    expect(found.length).toBe(1);
    expect(found[0]._id.toString()).toBe(docId);
  });
  it('deleteOne removes a document so it cannot be found', async () => {
    const doc = { ...docCreator(), foo: 'Z' };
    const insertResult = await collection.insertOne(doc);
    const docId = insertResult.insertedId;
    // Should be found before deletion
    let found = await collection.find({ _id: docId }).toArray();
    expect(found.length).toBe(1);
    expect(found[0]._id.toString()).toBe(docId.toString());
    // Delete the document
    const result = await collection.deleteOne({ _id: docId });
    expect(result).toEqual({ deletedCount: 1 });
    // Should not be found after deletion
    found = await collection.find({ _id: docId }).toArray();
    expect(found.length).toBe(0);
  });

  it('deleteOne with non-_id filter deletes the first matching document', async () => {
    // Insert two docs with the same foo value
    const doc1 = { ...docCreator(), foo: 'X' };
    const doc2 = { ...docCreator(), foo: 'X' };
    const res1 = await collection.insertOne(doc1);
    const res2 = await collection.insertOne(doc2);
    // _id is assigned by insertOne, so use res1.insertedId and res2.insertedId for later checks if needed
    // Delete one by foo
    const result = await collection.deleteOne({ foo: 'X' });
    expect(result).toEqual({ deletedCount: 1 });
    // Only one should be deleted
    let found = await collection.find({ foo: 'X' }).toArray();
    expect(found.length).toBe(1);
    // The remaining doc should be one of the two
    expect([
      res1.insertedId.toString(),
      res2.insertedId.toString(),
    ]).toContain(found[0]._id.toString());
    // The deleted _id should not be found in any query (memory store: skip index assertions)
  });
  // ...existing code...

  it('deleteOne can delete by a non-_id field (e.g. email)', async () => {
    const doc = { ...docCreator(), foo: 'Y' };
    const insertResult = await collection.insertOne(doc);
    const docWithId = { ...doc, _id: insertResult.insertedId };
    // Should be found before deletion
    let found = await collection.find({ email: doc.email }).toArray();
    expect(found.length).toBe(1);
    expect(found[0]._id.toString()).toBe(docWithId._id.toString());
    // Delete by email
    const result = await collection.deleteOne({ email: doc.email });
    expect(result).toEqual({ deletedCount: 1 });
    // Should not be found after deletion
    found = await collection.find({ email: doc.email }).toArray();
    expect(found.length).toBe(0);
  });
});
