import { beforeEach, describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import type { SengoCollection } from '../../src/client/collection';

type Place = {
  profile?: { city?: string; region?: string | null };
  stops?: Array<{ code: string; city: string }>;
  tags?: string[];
};

describe('dotted field paths in queries', () => {
  let collection: SengoCollection<Place>;

  beforeEach(async () => {
    collection = new SengoClient().db('memory').collection<Place>('places');
    await collection.insertOne({
      _id: 'north',
      profile: { city: 'Oslo', region: null },
      stops: [{ code: 'A', city: 'Oslo' }, { code: 'B', city: 'Riga' }],
      tags: ['coastal', 'historic'],
    });
    await collection.insertOne({
      _id: 'south',
      profile: { city: 'Lisbon', region: 'west' },
      stops: [{ code: 'C', city: 'Lisbon' }],
      tags: [],
    });
    await collection.insertOne({ _id: 'missing' });
  });

  it('matches nested scalar paths and paths through arrays of embedded documents', async () => {
    await expect(collection.find({ 'profile.city': 'Oslo' }).toArray()).resolves.toMatchObject([
      { _id: 'north' },
    ]);
    await expect(collection.find({ 'stops.city': 'Riga' }).toArray()).resolves.toMatchObject([
      { _id: 'north' },
    ]);
    await expect(collection.find({ 'stops.code': { $in: ['B', 'C'] } }).toArray()).resolves.toHaveLength(2);
  });

  it('uses field presence rather than nullness for $exists', async () => {
    await expect(collection.find({ 'profile.region': { $exists: true } }).toArray()).resolves.toMatchObject([
      { _id: 'north' },
      { _id: 'south' },
    ]);
    await expect(collection.find({ 'profile.region': { $exists: false } }).toArray()).resolves.toMatchObject([
      { _id: 'missing' },
    ]);
  });

  it('reuses field-path matching when validating update filters', async () => {
    const result = await collection.updateOne(
      { 'profile.city': 'Oslo' },
      { $set: { verified: true } },
    );

    expect(result.matchedCount).toBe(1);
    await expect(collection.findOne({ _id: 'north' })).resolves.toMatchObject({ verified: true });
  });
});
