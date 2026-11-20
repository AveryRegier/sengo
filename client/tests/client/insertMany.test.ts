import { describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { MongoInvalidArgumentError } from '../../src/errors';
import { createContext } from '../sengo-test/setup';

type Recipe = {
  name: string;
  status: string;
};

describe('SengoCollection.insertMany', () => {
  it('inserts all documents and returns inserted IDs by input index', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<Recipe>('recipes');

    const result = await collection.insertMany([
      { _id: 'recipe-1', name: 'Lentil soup', status: 'planned' },
      { name: 'Garden salad', status: 'ready' },
    ]);

    expect(result.acknowledged).toBe(true);
    expect(result.insertedCount).toBe(2);
    expect(result.insertedIds[0]).toBe('recipe-1');
    expect(result.insertedIds[1]).toBeDefined();
    expect(await collection.countDocuments({})).toBe(2);
    expect(await collection.findOne({ _id: result.insertedIds[1] })).toMatchObject({
      name: 'Garden salad',
      status: 'ready',
    });
  });

  it('updates S3 indexes for each inserted document', async () => {
    const { signups, s3sim } = createContext('insert_many_indexed');
    await signups.createIndex({ memberId: 1 });

    const result = await signups.insertMany([
      { _id: 'signup-1', calendarId: 'c1', memberId: 'm1', isAvailable: true },
      { _id: 'signup-2', calendarId: 'c1', memberId: 'm2', isAvailable: true },
    ]);

    expect(result.insertedCount).toBe(2);
    expect(s3sim.getLogs().some(log =>
      log.command === 'putObject' && log.key.includes('/indices/memberId_1/'),
    )).toBe(true);
    expect(await signups.find({ memberId: { $in: ['m1', 'm2'] } }).toArray()).toHaveLength(2);
  });

  it('stops at first duplicate when ordered and exposes partial result', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<Recipe>('recipes');
    await collection.insertOne({ _id: 'recipe-duplicate', name: 'Existing soup', status: 'ready' });

    await expect(collection.insertMany([
      { _id: 'recipe-first', name: 'First soup', status: 'planned' },
      { _id: 'recipe-duplicate', name: 'Duplicate soup', status: 'planned' },
      { _id: 'recipe-last', name: 'Last soup', status: 'planned' },
    ])).rejects.toMatchObject({
      name: 'MongoBulkWriteError',
      writeErrors: [{ index: 1, code: 11000 }],
      result: { acknowledged: true, insertedCount: 1, insertedIds: { 0: 'recipe-first' } },
    });

    expect(await collection.findOne({ _id: 'recipe-last' })).toBeNull();
  });

  it('continues past duplicate documents when ordered is false', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<Recipe>('recipes');
    await collection.insertOne({ _id: 'recipe-duplicate', name: 'Existing soup', status: 'ready' });

    await expect(collection.insertMany([
      { _id: 'recipe-first', name: 'First soup', status: 'planned' },
      { _id: 'recipe-duplicate', name: 'Duplicate soup', status: 'planned' },
      { _id: 'recipe-last', name: 'Last soup', status: 'planned' },
    ], { ordered: false })).rejects.toMatchObject({
      name: 'MongoBulkWriteError',
      writeErrors: [{ index: 1, code: 11000 }],
      result: { acknowledged: true, insertedCount: 2 },
    });

    expect(await collection.findOne({ _id: 'recipe-first' })).not.toBeNull();
    expect(await collection.findOne({ _id: 'recipe-last' })).not.toBeNull();
  });

  it('rejects empty document arrays', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<Recipe>('recipes');

    await expect(collection.insertMany([])).rejects.toBeInstanceOf(MongoInvalidArgumentError);
  });
});
