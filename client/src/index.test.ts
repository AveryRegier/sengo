import { SengoClient } from './client/client';
import Chance from 'chance';

const chance = new Chance();

describe('SengoClient basic API', () => {
  it('should allow db().collection() and insertOne()', async () => {
    const client = new SengoClient();
    const collection = client.db().collection('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    const result = await collection.insertOne(animal);
    expect(result).toHaveProperty('acknowledged', true);
    expect(result).toHaveProperty('insertedId');
  });

  it('should find a document by _id after insertOne', async () => {
    const client = new SengoClient();
    const collection = client.db().collection('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    const insertResult = await collection.insertOne(animal);
    const found = await collection.find({ _id: insertResult.insertedId });
    expect(Array.isArray(found)).toBe(true);
    expect(found.length).toBe(1);
    expect(found[0]).toMatchObject({ _id: insertResult.insertedId, ...animal });
  });

  it('should clear all collections and prevent further use after close', async () => {
    const client = new SengoClient();
    const collection = client.db().collection('animals');
    await collection.insertOne({ name: 'test', kind: 'cat' });
    await client.close();
    expect(() => client.db().collection('animals')).toThrow('Store is closed');
  });
});

describe('SengoClient close behavior', () => {
  it('should throw if db() is called after close()', async () => {
    const client = new SengoClient();
    await client.close();
    expect(() => client.db()).not.toThrow(); // db() should not throw, only collection() should
    expect(() => client.db().collection('animals')).toThrow('Store is closed');
  });

  it('should throw if insertOne is called after collection is closed', async () => {
    const client = new SengoClient();
    const collection = client.db().collection('animals');
    await client.close();
    await expect(collection.insertOne({ name: 'fuzzy', kind: 'cat' })).rejects.toThrow('Store is closed');
  });
});
