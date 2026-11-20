import { describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { createContext } from '../sengo-test/setup';

describe('SengoCollection.updateMany', () => {
  it('updates every matching document and leaves non-matching documents unchanged', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<{
      name: string;
      state: string;
      archived?: boolean;
    }>('tasks');

    await collection.insertOne({ _id: 'task-1', name: 'Draft', state: 'queued' });
    await collection.insertOne({ _id: 'task-2', name: 'Review', state: 'queued' });
    await collection.insertOne({ _id: 'task-3', name: 'Publish', state: 'done' });

    const result = await collection.updateMany(
      { state: 'queued' },
      { $set: { state: 'ready', archived: true } },
    );

    expect(result).toMatchObject({
      acknowledged: true,
      matchedCount: 2,
      modifiedCount: 2,
      upsertedCount: 0,
      upsertedId: null,
    });
    expect(await collection.find({ state: 'ready' }).toArray()).toHaveLength(2);
    expect(await collection.findOne({ _id: 'task-3' })).toMatchObject({ state: 'done' });
  });

  it('updates index entries for all changed documents in S3', async () => {
    const { signups } = createContext('update_many_indexed');
    await signups.createIndex({ state: 1 });
    await signups.insertOne({ _id: 'signup-1', calendarId: 'c1', memberId: 'm1', isAvailable: false, state: 'queued' } as any);
    await signups.insertOne({ _id: 'signup-2', calendarId: 'c1', memberId: 'm2', isAvailable: false, state: 'queued' } as any);
    await signups.insertOne({ _id: 'signup-3', calendarId: 'c1', memberId: 'm3', isAvailable: false, state: 'done' } as any);

    const result = await signups.updateMany(
      { state: 'queued' },
      { $set: { state: 'ready', isAvailable: true } },
    );

    expect(result).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
    expect(await signups.find({ state: 'queued' }).toArray()).toHaveLength(0);
    expect(await signups.find({ state: 'ready' }).toArray()).toHaveLength(2);
    expect(await signups.findOne({ _id: 'signup-3' } as any)).toMatchObject({ state: 'done', isAvailable: false });
  });

  it('returns zero counts when no documents match', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<{ state: string }>('tasks');

    const result = await collection.updateMany({ state: 'missing' }, { $set: { state: 'ready' } });

    expect(result).toMatchObject({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    });
  });

  it('counts matches without reporting unchanged documents as modified', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<{ state: string }>('tasks');
    await collection.insertOne({ _id: 'task-1', state: 'ready' });
    await collection.insertOne({ _id: 'task-2', state: 'ready' });

    const result = await collection.updateMany({ state: 'ready' }, { $set: { state: 'ready' } });

    expect(result).toMatchObject({ matchedCount: 2, modifiedCount: 0 });
  });

  it('upserts one document from equality filter fields and applies $setOnInsert', async () => {
    const client = new SengoClient();
    const collection = client.db('memory').collection<{
      category: string;
      state: string;
      status: string;
      createdAt?: string;
    }>('recipes');

    const result = await collection.updateMany(
      { category: 'soup', state: { $eq: 'planned' } },
      { $set: { status: 'ready' }, $setOnInsert: { createdAt: 'today' } },
      { upsert: true },
    );

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 });
    expect((result as any).upsertedId).toBeDefined();
    expect(await collection.findOne({ _id: (result as any).upsertedId })).toMatchObject({
      category: 'soup',
      state: 'planned',
      status: 'ready',
      createdAt: 'today',
    });
  });
});
