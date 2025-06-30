import { SengoClient } from '../../src/client/client';
import Chance from 'chance';
import { SengoCollection } from '../../src/client/collection';

describe('SengoCollection createIndex and find (Memory)', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collection: SengoCollection;
  let docs: Record<string, any>[];

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
    collection = client.db().collection(collectionName);
    // Create some docs with random structure
    docs = Array.from({ length: 3 }, docCreator);
    // Insert initial docs
    for (const doc of docs) {
        await collection.insertOne(doc);
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
    const subsetFound = await collection.find({ [indexField]: subsetValue });
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
    const found = await collection.find({});
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
});
