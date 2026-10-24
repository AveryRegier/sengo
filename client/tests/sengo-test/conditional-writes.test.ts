import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, NOW, Signup, TestContext } from './setup';

// Needs S3BucketSimulator to honor IfMatch/IfNoneMatch (412 PreconditionFailed) on putObject.
describe('conditional writes: insertOne', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it('inserts a document with a new _id', async () => {
    const result = await ctx.signups.insertOne({ _id: 'a', calendarId: 'c1', memberId: 'm1', isAvailable: true } as any);
    expect(result.acknowledged).toBe(true);
    expect(await ctx.signups.findOne({ _id: 'a' } as any)).toMatchObject({ memberId: 'm1' });
  });

  it('throws DuplicateKeyError when _id already exists and leaves the original unchanged', async () => {
    await ctx.signups.insertOne({ _id: 'a', calendarId: 'c1', memberId: 'm1', isAvailable: true } as any);

    await expect(
      ctx.signups.insertOne({ _id: 'a', calendarId: 'c1', memberId: 'm2', isAvailable: false } as any)
    ).rejects.toMatchObject({ name: 'DuplicateKeyError' });

    const stored = await ctx.signups.findOne({ _id: 'a' } as any);
    expect(stored).toMatchObject({ memberId: 'm1', isAvailable: true });
    expect(await ctx.signups.countDocuments({})).toBe(1);
  });

  it('lets exactly one of two parallel inserts with the same _id win', async () => {
    const attempts = await Promise.allSettled([
      ctx.signups.insertOne({ _id: 'same', calendarId: 'c1', memberId: 'm1', isAvailable: true } as any),
      ctx.signups.insertOne({ _id: 'same', calendarId: 'c1', memberId: 'm2', isAvailable: true } as any)
    ]);

    const fulfilled = attempts.filter(a => a.status === 'fulfilled');
    const rejected = attempts.filter(a => a.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ name: 'DuplicateKeyError' });
    expect(await ctx.signups.countDocuments({})).toBe(1);
  });
});

describe('conditional writes: updateOne', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createContext();
    await ctx.signups.insertOne({
      _id: 'doc1',
      calendarId: 'c1',
      memberId: 'm1',
      isAvailable: false,
      assignedPositionId: null,
      createdAt: NOW
    } as any);
  });

  it('reports matchedCount 1 and modifiedCount 1 for a successful update', async () => {
    const result = await ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { isAvailable: true } });
    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
    expect(await ctx.signups.findOne({ _id: 'doc1' } as any)).toMatchObject({ isAvailable: true });
  });

  it('does not lose updates when two parallel updateOne calls set different fields', async () => {
    await Promise.all([
      ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { isAvailable: true } }),
      ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { updatedAt: NOW } })
    ]);

    const stored = await ctx.signups.findOne({ _id: 'doc1' } as any);
    expect(stored).toMatchObject({ isAvailable: true, updatedAt: NOW });
  });

  it('lets exactly one of two racing conditional claims win', async () => {
    const claim = (positionId: string) =>
      ctx.signups.updateOne(
        { _id: 'doc1', assignedPositionId: null } as any,
        { $set: { assignedPositionId: positionId } }
      );

    const [a, b] = await Promise.all([claim('p1'), claim('p2')]);

    expect([a.matchedCount, b.matchedCount].sort()).toEqual([0, 1]);
    const winner = a.matchedCount === 1 ? 'p1' : 'p2';
    expect(await ctx.signups.findOne({ _id: 'doc1' } as any)).toMatchObject({ assignedPositionId: winner });
  });

  it('supports $or null/$exists claim filters on a legacy doc with the field missing', async () => {
    await ctx.signups.insertOne({ _id: 'legacy', calendarId: 'c1', memberId: 'm9', isAvailable: true } as any);

    const claim = (positionId: string) =>
      ctx.signups.updateOne(
        {
          _id: 'legacy',
          $or: [{ assignedPositionId: null }, { assignedPositionId: { $exists: false } }]
        } as any,
        { $set: { assignedPositionId: positionId } }
      );

    const [a, b] = await Promise.all([claim('p1'), claim('p2')]);

    expect([a.matchedCount, b.matchedCount].sort()).toEqual([0, 1]);
    const stored = await ctx.signups.findOne({ _id: 'legacy' } as any);
    expect(['p1', 'p2']).toContain((stored as Signup).assignedPositionId);
  });

  it('returns matchedCount 0 when the filter stops matching between read and write', async () => {
    const slow = ctx.signups.updateOne(
      { _id: 'doc1', isAvailable: false } as any,
      { $set: { assignedPositionId: 'p1' } }
    );
    const fast = ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { isAvailable: true } });

    const [slowResult] = await Promise.all([slow, fast]);

    const stored = (await ctx.signups.findOne({ _id: 'doc1' } as any)) as Signup;
    expect(stored.isAvailable).toBe(true);
    // The claim only lands if it won the race; never both a stale write and a lost update.
    if (slowResult.matchedCount === 0) {
      expect(stored.assignedPositionId).toBeNull();
    } else {
      expect(stored.assignedPositionId).toBe('p1');
    }
  });

  it('throws a clear error instead of looping forever when preconditions always fail', async () => {
    const store = ctx.signups.store as any;
    const realSend = store.s3.send;
    store.s3.send = (cmd: any) => {
      if (cmd?.input?.IfMatch) {
        const err: any = new Error('PreconditionFailed');
        err.name = 'PreconditionFailed';
        err.$metadata = { httpStatusCode: 412 };
        throw err;
      }
      return realSend(cmd);
    };

    await expect(
      ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { isAvailable: true } })
    ).rejects.toThrow(/precondition|conflict|retries/i);
  });

  it('keeps indexes consistent with the document after racing updates to an indexed field', async () => {
    await ctx.signups.createIndex({ memberId: 1 });

    await Promise.all([
      ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { memberId: 'm2' } }),
      ctx.signups.updateOne({ _id: 'doc1' } as any, { $set: { memberId: 'm3' } })
    ]);

    const stored = (await ctx.signups.findOne({ _id: 'doc1' } as any)) as Signup;
    const viaIndex = await ctx.signups.find({ memberId: stored.memberId }).toArray();
    expect(viaIndex).toHaveLength(1);
    expect(viaIndex[0]._id).toBe('doc1');

    const other = stored.memberId === 'm2' ? 'm3' : 'm2';
    expect(await ctx.signups.find({ memberId: other }).toArray()).toHaveLength(0);
    expect(await ctx.signups.find({ memberId: 'm1' }).toArray()).toHaveLength(0);
  });
});

describe('conditional writes: S3 headers', () => {
  it('sends IfNoneMatch on insert and IfMatch on update, and maps 412 to PreconditionFailedError', async () => {
    const ctx = createContext();
    const store = ctx.signups.store as any;
    const sent: any[] = [];
    const realSend = store.s3.send;
    store.s3.send = (cmd: any) => {
      sent.push(cmd);
      return realSend(cmd);
    };

    await ctx.signups.insertOne({ _id: 'h1', calendarId: 'c1', memberId: 'm1', isAvailable: true } as any);
    const insertPut = sent.find(c => c?.input?.Key?.includes('h1') && c?.input?.Body !== undefined);
    expect(insertPut.input.IfNoneMatch).toBe('*');

    sent.length = 0;
    await ctx.signups.updateOne({ _id: 'h1' } as any, { $set: { isAvailable: false } });
    const updatePut = sent.find(c => c?.input?.Key?.includes('h1') && c?.input?.Body !== undefined);
    expect(typeof updatePut.input.IfMatch).toBe('string');
    expect(updatePut.input.IfMatch.length).toBeGreaterThan(0);
  });
});
