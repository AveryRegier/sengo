import { describe, it, expect, beforeEach } from 'vitest';
import { createContext, createSignupUniqueIndex, Signup, TestContext } from './setup';

const signup = (calendarId: string, memberId: string, extra: Partial<Signup> = {}) =>
  ({ calendarId, memberId, isAvailable: true, ...extra }) as any;

describe('unique index: createIndex(keys, { unique: true })', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it('creates a unique compound index and reports unique: true in listIndexes', async () => {
    const name = await createSignupUniqueIndex(ctx.signups);
    expect(typeof name).toBe('string');

    const indexes = await ctx.signups.listIndexes();
    expect(indexes).toEqual(expect.arrayContaining([expect.objectContaining({ name, unique: true })]));
  });

  it('rejects a second doc with the same (calendarId, memberId) and keeps only one doc', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1'));

    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).rejects.toMatchObject({ name: 'DuplicateKeyError' });
    expect(await ctx.signups.countDocuments({ calendarId: 'c1', memberId: 'm1' })).toBe(1);
  });

  it('allows the same member on different events and different members on the same event', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1'));
    await ctx.signups.insertOne(signup('c2', 'm1'));
    await ctx.signups.insertOne(signup('c1', 'm2'));

    expect(await ctx.signups.countDocuments({})).toBe(3);
  });

  it('lets exactly one of many parallel inserts for the same key win', async () => {
    await createSignupUniqueIndex(ctx.signups);

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => ctx.signups.insertOne(signup('c1', 'm1')))
    );

    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter(a => a.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(9);
    rejected.forEach(r => expect(r.reason).toMatchObject({ name: 'DuplicateKeyError' }));
    expect(await ctx.signups.countDocuments({ calendarId: 'c1', memberId: 'm1' })).toBe(1);
  });

  it('rejects an update that would make a doc collide with another and leaves both unchanged', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1', { _id: 'a' } as any));
    await ctx.signups.insertOne(signup('c1', 'm2', { _id: 'b' } as any));

    await expect(
      ctx.signups.updateOne({ _id: 'b' } as any, { $set: { memberId: 'm1' } })
    ).rejects.toMatchObject({ name: 'DuplicateKeyError' });

    expect(await ctx.signups.findOne({ _id: 'a' } as any)).toMatchObject({ memberId: 'm1' });
    expect(await ctx.signups.findOne({ _id: 'b' } as any)).toMatchObject({ memberId: 'm2' });
    expect(await ctx.signups.find({ calendarId: 'c1', memberId: 'm2' }).toArray()).toHaveLength(1);
  });

  it('allows updates that do not change indexed fields, and releases the old key when the key changes', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1', { _id: 'a' } as any));

    await ctx.signups.updateOne({ _id: 'a' } as any, { $set: { isAvailable: false } });
    expect(await ctx.signups.findOne({ _id: 'a' } as any)).toMatchObject({ isAvailable: false });

    await ctx.signups.updateOne({ _id: 'a' } as any, { $set: { memberId: 'm9' } });
    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).resolves.toMatchObject({ acknowledged: true });
  });

  it('releases the unique key on deleteOne', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1', { _id: 'a' } as any));

    await ctx.signups.deleteOne({ _id: 'a' } as any);

    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).resolves.toMatchObject({ acknowledged: true });
  });

  it('fails to create a unique index over existing duplicates and leaves no index behind', async () => {
    await ctx.signups.insertOne(signup('c1', 'm1'));
    await ctx.signups.insertOne(signup('c1', 'm1'));

    await expect(createSignupUniqueIndex(ctx.signups)).rejects.toMatchObject({ name: 'DuplicateKeyError' });

    expect(await ctx.signups.listIndexes()).toHaveLength(0);
    expect(await ctx.signups.countDocuments({})).toBe(2);
  });

  it('builds a unique index over existing legacy docs with random _ids and then enforces it', async () => {
    await ctx.signups.insertOne(signup('c1', 'm1'));
    await ctx.signups.insertOne(signup('c1', 'm2'));

    await createSignupUniqueIndex(ctx.signups);

    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).rejects.toMatchObject({ name: 'DuplicateKeyError' });
    await expect(ctx.signups.insertOne(signup('c1', 'm3'))).resolves.toMatchObject({ acknowledged: true });
  });

  it('leaves non-unique indexes behaving exactly as before', async () => {
    await ctx.signups.createIndex({ calendarId: 1, memberId: 1 });
    await ctx.signups.insertOne(signup('c1', 'm1'));
    await ctx.signups.insertOne(signup('c1', 'm1'));

    const indexes = await ctx.signups.listIndexes();
    expect(indexes.every((i: any) => !i.unique)).toBe(true);
    expect(await ctx.signups.find({ calendarId: 'c1', memberId: 'm1' }).toArray()).toHaveLength(2);
  });

  it('releases the index claim when the document write fails after the claim succeeds', async () => {
    await createSignupUniqueIndex(ctx.signups);
    const store = ctx.signups.store as any;
    const realSend = store.s3.send;
    let failNextDocumentPut = true;
    store.s3.send = (cmd: any) => {
      const key: string = cmd?.input?.Key ?? '';
      if (failNextDocumentPut && cmd?.input?.Body !== undefined && key.includes('/documents/')) {
        failNextDocumentPut = false;
        throw new Error('simulated S3 outage');
      }
      return realSend(cmd);
    };

    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).rejects.toThrow(/simulated S3 outage/);

    await expect(ctx.signups.insertOne(signup('c1', 'm1'))).resolves.toMatchObject({ acknowledged: true });
    expect(await ctx.signups.countDocuments({ calendarId: 'c1', memberId: 'm1' })).toBe(1);
  });

  it('serves find({ calendarId, memberId }) through the unique index', async () => {
    await createSignupUniqueIndex(ctx.signups);
    await ctx.signups.insertOne(signup('c1', 'm1'));
    await ctx.signups.insertOne(signup('c1', 'm2'));
    ctx.s3sim.clearLogs();

    const found = await ctx.signups.find({ calendarId: 'c1', memberId: 'm1' }).toArray();

    expect(found).toHaveLength(1);
    const logs = ctx.s3sim.getLogs();
    expect(logs.some(l => l.key.includes('/indices/'))).toBe(true);
    expect(logs.filter(l => l.command === 'getObject' && l.key.includes('/documents/'))).toHaveLength(1);
  });
});
