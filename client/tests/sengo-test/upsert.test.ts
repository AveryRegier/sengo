import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, createSignupUniqueIndex, NOW, Signup, TestContext } from './setup';

const upsertAvailable = (ctx: TestContext, calendarId: string, memberId: string, at = NOW) =>
  ctx.signups.updateOne(
    { calendarId, memberId } as any,
    {
      $set: { isAvailable: true, updatedAt: at },
      $setOnInsert: { createdAt: at, assignedPositionId: null }
    } as any,
    { upsert: true } as any
  ) as Promise<any>;

describe('updateOne upsert and $setOnInsert', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it('inserts one doc from filter equality fields, $set and $setOnInsert when nothing matches', async () => {
    const result = await upsertAvailable(ctx, 'c1', 'm1');

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
    expect(typeof result.upsertedId).toBe('string');

    const docs = await ctx.signups.find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      _id: result.upsertedId,
      calendarId: 'c1',
      memberId: 'm1',
      isAvailable: true,
      updatedAt: NOW,
      createdAt: NOW,
      assignedPositionId: null
    });
  });

  it('updates a matching doc, applies $set, and does not apply $setOnInsert', async () => {
    await ctx.signups.insertOne({
      calendarId: 'c1', memberId: 'm1', isAvailable: false, createdAt: 'original', assignedPositionId: 'p7'
    } as any);

    const result = await upsertAvailable(ctx, 'c1', 'm1', '2026-11-01T00:00:00.000Z');

    expect(result).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
    expect(result.upsertedId).toBeUndefined();
    const doc = (await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm1' })) as Signup;
    expect(doc).toMatchObject({
      isAvailable: true,
      updatedAt: '2026-11-01T00:00:00.000Z',
      createdAt: 'original',
      assignedPositionId: 'p7'
    });
    expect(await ctx.signups.countDocuments({})).toBe(1);
  });

  it('returns matchedCount 0 and inserts nothing without upsert', async () => {
    const result = await ctx.signups.updateOne({ calendarId: 'c1', memberId: 'm1' } as any, { $set: { isAvailable: true } });

    expect(result).toMatchObject({ matchedCount: 0, modifiedCount: 0 });
    expect((result as any).upsertedId).toBeUndefined();
    expect(await ctx.signups.countDocuments({})).toBe(0);
  });

  it('applies $setOnInsert alone on insert and ignores it on match', async () => {
    const insert = (await ctx.signups.updateOne(
      { calendarId: 'c1', memberId: 'm1' } as any,
      { $setOnInsert: { createdAt: NOW } } as any,
      { upsert: true } as any
    )) as any;
    expect(insert.upsertedId).toBeDefined();
    expect(await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm1' })).toMatchObject({ createdAt: NOW });

    const again = (await ctx.signups.updateOne(
      { calendarId: 'c1', memberId: 'm1' } as any,
      { $setOnInsert: { createdAt: 'changed' } } as any,
      { upsert: true } as any
    )) as any;
    expect(again.matchedCount).toBe(1);
    expect(await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm1' })).toMatchObject({ createdAt: NOW });
  });

  it('does not copy operator expressions from the filter into the inserted doc', async () => {
    const result = (await ctx.signups.updateOne(
      { calendarId: 'c1', memberId: 'm1', score: { $gt: 5 } } as any,
      { $set: { isAvailable: true } },
      { upsert: true } as any
    )) as any;

    const doc = (await ctx.signups.findOne({ _id: result.upsertedId } as any)) as any;
    expect(doc).toMatchObject({ calendarId: 'c1', memberId: 'm1', isAvailable: true });
    expect('score' in doc).toBe(false);
  });

  it('uses _id from the filter when upserting', async () => {
    const result = (await ctx.signups.updateOne(
      { _id: 'fixed-id' } as any,
      { $set: { calendarId: 'c1', memberId: 'm1', isAvailable: true } },
      { upsert: true } as any
    )) as any;

    expect(result.upsertedId).toBe('fixed-id');
    expect(await ctx.signups.findOne({ _id: 'fixed-id' } as any)).toMatchObject({ memberId: 'm1' });
  });

  it('is idempotent when the same upsert runs twice in sequence', async () => {
    const first = await upsertAvailable(ctx, 'c1', 'm1');
    const second = await upsertAvailable(ctx, 'c1', 'm1');

    expect(first.upsertedId).toBeDefined();
    expect(second).toMatchObject({ matchedCount: 1 });
    expect(second.upsertedId).toBeUndefined();
    expect(await ctx.signups.countDocuments({ calendarId: 'c1', memberId: 'm1' })).toBe(1);
  });

  it('throws an error listing the supported operators for unsupported update operators', async () => {
    await ctx.signups.insertOne({ _id: 'a', calendarId: 'c1', memberId: 'm1', isAvailable: true } as any);

    await expect(ctx.signups.updateOne({ _id: 'a' } as any, { $inc: { n: 1 } } as any)).rejects.toThrow(/\$set.*\$setOnInsert/);
    await expect(ctx.signups.updateOne({ _id: 'a' } as any, { $unset: { isAvailable: '' } } as any)).rejects.toThrow(/\$set.*\$setOnInsert/);
  });
});

describe('upsert with a unique index (concurrency)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createContext();
    await createSignupUniqueIndex(ctx.signups);
  });

  it('creates exactly one doc from 20 parallel upserts for the same member and event', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => upsertAvailable(ctx, 'c1', 'm1')));

    expect(await ctx.signups.countDocuments({ calendarId: 'c1', memberId: 'm1' })).toBe(1);
    expect(results.filter(r => r.upsertedId !== undefined)).toHaveLength(1);
    expect(results.filter(r => r.matchedCount === 1)).toHaveLength(19);
    const doc = (await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm1' })) as Signup;
    expect(doc.createdAt).toBe(NOW);
  });

  it('creates one doc per member when different members upsert in parallel', async () => {
    await Promise.all(['m1', 'm2', 'm3'].map(m => upsertAvailable(ctx, 'c1', m)));

    expect(await ctx.signups.countDocuments({ calendarId: 'c1' })).toBe(3);
  });

  it('maintains the unique and any other index on both the insert and update paths', async () => {
    await ctx.signups.createIndex({ memberId: 1 });

    await upsertAvailable(ctx, 'c1', 'm1');
    await ctx.signups.updateOne(
      { calendarId: 'c1', memberId: 'm1' } as any,
      { $set: { isAvailable: false } } as any,
      { upsert: true } as any
    );

    expect(await ctx.signups.find({ memberId: 'm1' }).toArray()).toHaveLength(1);
    expect(await ctx.signups.find({ calendarId: 'c1', memberId: 'm1' }).toArray()).toHaveLength(1);
  });
});

describe('idempotent signup flow: unique index, upsert, conditional claim', () => {
  let ctx: TestContext;

  const claim = (memberId: string, positionId: string) =>
    ctx.signups.updateOne(
      {
        calendarId: 'c1',
        memberId,
        $or: [{ assignedPositionId: null }, { assignedPositionId: { $exists: false } }]
      } as any,
      { $set: { assignedPositionId: positionId } }
    );

  beforeEach(async () => {
    ctx = createContext();
    await createSignupUniqueIndex(ctx.signups);
  });

  it('leaves a member with one doc and one position when the whole flow races', async () => {
    const attempt = async (positionId: string) => {
      await upsertAvailable(ctx, 'c1', 'm1');
      return claim('m1', positionId);
    };

    await Promise.all(['p1', 'p2', 'p3', 'p4'].map(attempt));

    const docs = await ctx.signups.find({ calendarId: 'c1', memberId: 'm1' }).toArray();
    expect(docs).toHaveLength(1);
    expect(['p1', 'p2', 'p3', 'p4']).toContain(docs[0].assignedPositionId);
  });

  it('does not change the position when the member is already assigned', async () => {
    await upsertAvailable(ctx, 'c1', 'm1');
    const first = await claim('m1', 'p1');
    const second = await claim('m1', 'p2');

    expect(first.matchedCount).toBe(1);
    expect(second.matchedCount).toBe(0);
    expect(await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm1' })).toMatchObject({ assignedPositionId: 'p1' });
  });

  it('claims a position for a legacy doc whose assignedPositionId field is missing', async () => {
    await ctx.signups.insertOne({ calendarId: 'c1', memberId: 'm5', isAvailable: true } as any);

    const result = await claim('m5', 'p9');

    expect(result.matchedCount).toBe(1);
    expect(await ctx.signups.findOne({ calendarId: 'c1', memberId: 'm5' })).toMatchObject({ assignedPositionId: 'p9' });
  });

  it('matches {assignedPositionId: null} alone against a doc where the field is missing', async () => {
    await ctx.signups.insertOne({ calendarId: 'c1', memberId: 'm6', isAvailable: true } as any);

    const result = await ctx.signups.updateOne(
      { calendarId: 'c1', memberId: 'm6', assignedPositionId: null } as any,
      { $set: { assignedPositionId: 'p3' } }
    );

    expect(result.matchedCount).toBe(1);
  });
});
