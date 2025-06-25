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
});
