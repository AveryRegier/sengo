import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';

type TestDoc = {
  name: string;
  age: number;
  email: string;
};

describe('SengoCollection listIndexes', () => {
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;

  beforeEach(async () => {
    client = new SengoClient();
    collection = client.db('memory').collection<TestDoc>('users');
  });

  it('should return _id index by default', async () => {
    const indexes = await collection.listIndexes();
    
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toEqual({
      v: 2,
      key: { _id: 1 },
      name: '_id_'
    });
  });

  it('should return all indexes including user-created ones', async () => {
    // Create some indexes
    await collection.createIndex({ name: 1 });
    await collection.createIndex({ age: -1 });
    
    const indexes = await collection.listIndexes();
    
    expect(indexes).toHaveLength(3);
    
    // Check _id index
    expect(indexes[0]).toEqual({
      v: 2,
      key: { _id: 1 },
      name: '_id_'
    });
    
    // Check name index
    const nameIndex = indexes.find(idx => idx.name === 'name_1');
    expect(nameIndex).toBeDefined();
    expect(nameIndex?.key).toEqual({ name: 1 });
    expect(nameIndex?.v).toBe(2);
    
    // Check age index
    const ageIndex = indexes.find(idx => idx.name === 'age_-1');
    expect(ageIndex).toBeDefined();
    expect(ageIndex?.key).toEqual({ age: -1 });
    expect(ageIndex?.v).toBe(2);
  });

  it('should return compound index correctly', async () => {
    await collection.createIndex([{ name: 1 }, { age: -1 }]);
    
    const indexes = await collection.listIndexes();
    
    expect(indexes).toHaveLength(2);
    
    const compoundIndex = indexes.find(idx => idx.name === 'name_1_age_-1');
    expect(compoundIndex).toBeDefined();
    expect(compoundIndex?.key).toEqual({ name: 1, age: -1 });
    expect(compoundIndex?.v).toBe(2);
  });

  it('should match MongoDB output format', async () => {
    await collection.createIndex({ email: 1 });
    
    const indexes = await collection.listIndexes();
    
    // Verify structure matches MongoDB format
    for (const index of indexes) {
      expect(index).toHaveProperty('v');
      expect(index).toHaveProperty('key');
      expect(index).toHaveProperty('name');
      expect(typeof index.v).toBe('number');
      expect(typeof index.key).toBe('object');
      expect(typeof index.name).toBe('string');
    }
  });
});
