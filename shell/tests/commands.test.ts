import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SengoClient } from '../../client/build-cjs/index.js';
import { parseArgsWithJson } from '../dist/parser.js';

describe('Shell Command Integration Tests', () => {
  let client: any;
  let db: any;
  let collection: any;

  beforeEach(async () => {
    client = new SengoClient();
    db = client.db('memory');
    collection = db.collection('testCollection');
  });

  afterEach(async () => {
    await client.close();
  });

  describe('find with unquoted properties', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: 'Alice', age: 25, active: true, email: 'alice@test.com' });
      await collection.insertOne({ _id: '2', name: 'Bob', age: 30, active: false, email: 'bob@test.com' });
      await collection.insertOne({ _id: '3', name: 'Charlie', age: 35, active: true });
      await collection.insertOne({ _id: '4', name: 'David', age: 20, active: true, email: 'david@test.com' });
    });

    it('finds documents with unquoted _id property', async () => {
      const args = parseArgsWithJson(['{_id:', '"1"}']);
      const result = await collection.findOne(...args);
      expect(result).toEqual({
        _id: '1',
        name: 'Alice',
        age: 25,
        active: true,
        email: 'alice@test.com'
      });
    });

    it('finds documents with unquoted name property', async () => {
      const args = parseArgsWithJson(['{name:', '"Bob"}']);
      const result = await collection.findOne(...args);
      expect(result?.name).toBe('Bob');
    });

    it('finds documents with multiple unquoted properties', async () => {
      const args = parseArgsWithJson(['{name:', '"Alice",', 'age:', '25}']);
      const result = await collection.findOne(...args);
      expect(result).toMatchObject({ name: 'Alice', age: 25 });
    });
  });

  describe('find with $exists operator', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: 'Alice', email: 'alice@test.com' });
      await collection.insertOne({ _id: '2', name: 'Bob' });
      await collection.insertOne({ _id: '3', name: 'Charlie', email: 'charlie@test.com' });
    });

    it('finds documents where email exists', async () => {
      const args = parseArgsWithJson(['{email:', '{$exists:', 'true}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(2);
      expect(docs.every((d: any) => 'email' in d)).toBe(true);
    });

    it('finds documents where email does not exist', async () => {
      const args = parseArgsWithJson(['{email:', '{$exists:', 'false}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('Bob');
    });
  });

  describe('find with comparison operators', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: 'Alice', age: 25 });
      await collection.insertOne({ _id: '2', name: 'Bob', age: 30 });
      await collection.insertOne({ _id: '3', name: 'Charlie', age: 35 });
      await collection.insertOne({ _id: '4', name: 'David', age: 20 });
    });

    it('finds documents with $gte operator', async () => {
      const args = parseArgsWithJson(['{age:', '{$gte:', '30}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(2);
      expect(docs.every((d: any) => d.age >= 30)).toBe(true);
    });

    it('finds documents with $lt operator', async () => {
      const args = parseArgsWithJson(['{age:', '{$lt:', '25}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(1);
      expect(docs[0].age).toBe(20);
    });

    it('finds documents with $ne operator', async () => {
      const args = parseArgsWithJson(['{name:', '{$ne:', '"Bob"}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(3);
      expect(docs.every((d: any) => d.name !== 'Bob')).toBe(true);
    });
  });

  describe('find with $in operator', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', status: 'active' });
      await collection.insertOne({ _id: '2', status: 'pending' });
      await collection.insertOne({ _id: '3', status: 'deleted' });
      await collection.insertOne({ _id: '4', status: 'active' });
    });

    it('finds documents with $in operator', async () => {
      const args = parseArgsWithJson(['{status:', '{$in:', '["active",', '"pending"]}}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(3);
      expect(docs.every((d: any) => ['active', 'pending'].includes(d.status))).toBe(true);
    });
  });

  describe('find with $or operator', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', age: 15 });
      await collection.insertOne({ _id: '2', age: 25 });
      await collection.insertOne({ _id: '3', age: 70 });
      await collection.insertOne({ _id: '4', age: 50 });
    });

    it('finds documents with $or operator', async () => {
      const args = parseArgsWithJson(['{$or:', '[{age:', '{$lt:', '18}},', '{age:', '{$gt:', '65}}]}']);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(2);
      expect(docs.some((d: any) => d.age === 15)).toBe(true);
      expect(docs.some((d: any) => d.age === 70)).toBe(true);
    });
  });

  describe('updateOne with unquoted properties', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: 'Alice', age: 25 });
    });

    it('updates document with unquoted filter and $set', async () => {
      const args = parseArgsWithJson(['{_id:', '"1"}', '{$set:', '{age:', '26}}']);
      const result = await collection.updateOne(...args);
      expect(result.modifiedCount).toBe(1);
      
      const doc = await collection.findOne({ _id: '1' });
      expect(doc.age).toBe(26);
    });

    it('updates with multiple fields in $set', async () => {
      const args = parseArgsWithJson([
        '{_id:', '"1"}',
        '{$set:', '{name:', '"Alicia",', 'age:', '27}}'
      ]);
      const result = await collection.updateOne(...args);
      expect(result.modifiedCount).toBe(1);
      
      const doc = await collection.findOne({ _id: '1' });
      expect(doc.name).toBe('Alicia');
      expect(doc.age).toBe(27);
    });
  });

  describe('insertOne with unquoted properties', () => {
    it('inserts document with unquoted properties', async () => {
      const args = parseArgsWithJson(['{_id:', '"test1",', 'name:', '"Alice",', 'age:', '25}']);
      const result = await collection.insertOne(...args);
      expect(result.insertedId).toBe('test1');
      
      const doc = await collection.findOne({ _id: 'test1' });
      expect(doc).toMatchObject({ name: 'Alice', age: 25 });
    });

    it('inserts document with boolean and null values', async () => {
      const args = parseArgsWithJson([
        '{_id:', '"test2",',
        'active:', 'true,',
        'deleted:', 'false,',
        'deletedAt:', 'null}'
      ]);
      await collection.insertOne(...args);
      
      const doc = await collection.findOne({ _id: 'test2' });
      expect(doc.active).toBe(true);
      expect(doc.deleted).toBe(false);
      expect(doc.deletedAt).toBe(null);
    });
  });

  describe('complex nested queries', () => {
    beforeEach(async () => {
      await collection.insertOne({
        _id: '1',
        verified: true,
        user: { name: 'Alice', age: 25 }
      });
      await collection.insertOne({
        _id: '2',
        verified: false,
        user: { name: 'Bob', age: 30 }
      });
      await collection.insertOne({
        _id: '3',
        verified: true,
        user: { name: 'Charlie', age: 35 }
      });
    });

    it('queries nested properties with unquoted names', async () => {
      const args = parseArgsWithJson([
        '{verified:', 'true}'
      ]);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(2);
      expect(docs.every((d: any) => d.verified === true)).toBe(true);
    });

    it('queries with operators and unquoted properties', async () => {
      const args = parseArgsWithJson([
        '{verified:', '{$ne:', 'false}}'
      ]);
      const result = await collection.find(...args);
      const docs = await result.toArray();
      expect(docs).toHaveLength(2);
      expect(docs.every((d: any) => d.verified !== false)).toBe(true);
    });
  });

  describe('mixed quoted and unquoted properties', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: 'Alice', age: 25 });
    });

    it('handles mix of quoted and unquoted properties', async () => {
      const args = parseArgsWithJson(['{"_id":', '"1",', 'name:', '"Alice"}']);
      const result = await collection.findOne(...args);
      expect(result).toMatchObject({ _id: '1', name: 'Alice' });
    });
  });

  describe('single-quoted strings', () => {
    beforeEach(async () => {
      await collection.insertOne({ _id: '1', name: "John Doe", description: 'User with "quotes"' });
    });

    it('handles single-quoted property values', async () => {
      const args = parseArgsWithJson(["{name:", "'John Doe'}"]);
      const result = await collection.findOne(...args);
      expect(result?.name).toBe('John Doe');
    });
  });
});
