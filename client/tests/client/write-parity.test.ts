import { describe, expect, it, vi } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type Item = { group?: string; count?: number; tags?: unknown[]; details?: Record<string, unknown> };

function collectionFor(backend: 'memory' | 's3') {
  const simulator = new S3BucketSimulator();
  const collection = new SengoClient().db(backend).collection<Item>('write_parity');
  if (backend === 's3') {
    (collection.store as any).s3 = { send: simulator.handleCommand.bind(simulator) };
  }
  return { collection, simulator };
}

for (const backend of ['memory', 's3'] as const) {
  describe(`write compatibility (${backend})`, () => {
    for (const method of ['updateOne', 'updateMany'] as const) {
      it(`${method} reports unchanged matches and no upsert`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', group: 'ready' });
        const result = await collection[method]({ group: 'ready' }, { $set: { group: 'ready' } });
        expect(result).toMatchObject({
          matchedCount: 1, modifiedCount: 0, upsertedCount: 0, upsertedId: null,
        });
      });

      it(`${method} supports $inc on existing and missing nested fields, including upserts`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', group: 'ready', count: 2, details: { score: 3 } });
        await collection[method]({ group: 'ready' }, { $inc: { count: -1, 'details.score': 2, 'details.new': 4 } });
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({
          count: 1, details: { score: 5, new: 4 },
        });
        const result = await collection[method](
          { _id: 'upsert', group: 'new' },
          { $inc: { count: 3 }, $setOnInsert: { 'details.created': true } },
          { upsert: true },
        );
        expect(result).toMatchObject({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: 'upsert' });
        expect(await collection.findOne({ _id: 'upsert' })).toMatchObject({ count: 3, details: { created: true } });
      });

      it(`${method} rejects $inc on nonnumeric values without changing the document`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', count: null });
        await expect(collection[method]({ _id: 'one' }, { $inc: { count: 1 } })).rejects.toThrow();
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ count: null });
      });

      it(`${method} rejects updates through scalar or date-valued parent fields`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', details: { created: new Date('2024-01-01') } });
        await expect(collection[method]({ _id: 'one' }, { $inc: { 'details.created.count': 1 } })).rejects.toThrow();
        expect((await collection.findOne({ _id: 'one' }))?.details).not.toHaveProperty('count');
      });

      it(`${method} supports $unset on nested and absent fields`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', details: { keep: 1, remove: 2 } });
        const result = await collection[method]({ _id: 'one' }, { $unset: { 'details.remove': '', missing: '' } });
        expect(result).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ details: { keep: 1 } });
        expect((await collection.findOne({ _id: 'one' }))?.details).not.toHaveProperty('remove');
        expect(await collection[method]({ _id: 'one' }, { $unset: { 'details.remove': '' } }))
          .toMatchObject({ matchedCount: 1, modifiedCount: 0 });
      });

      it(`${method} supports $push, including array values and absent fields`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', tags: ['old'] });
        await collection[method]({ _id: 'one' }, { $push: { tags: ['new', 'other'], 'details.notes': 'first' } });
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({
          tags: ['old', ['new', 'other']], details: { notes: ['first'] },
        });
      });

      it(`${method} applies $push and $unset during an upsert`, async () => {
        const { collection } = collectionFor(backend);
        const result = await collection[method](
          { _id: 'upsert', 'details.category': 'recipe', group: 'planned' },
          { $push: { tags: 'fresh' }, $unset: { group: '' } },
          { upsert: true },
        );
        expect(result).toMatchObject({ upsertedCount: 1, upsertedId: 'upsert' });
        const doc = await collection.findOne({ _id: 'upsert' });
        expect(doc).toMatchObject({ details: { category: 'recipe' }, tags: ['fresh'] });
        expect(doc).not.toHaveProperty('group');
      });

      it(`${method} rejects conflicting paths and changes to _id`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', count: 1 });
        await expect(collection[method]({ _id: 'one' }, { $set: { count: 2 }, $inc: { count: 1 } })).rejects.toThrow();
        await expect(collection[method]({ _id: 'one' }, { $set: { _id: 'other' } })).rejects.toThrow();
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ count: 1 });
      });

      it(`${method} handles numeric array paths without mutating unrelated elements`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', tags: [{ score: 2 }, { score: 5 }] });
        await collection[method]({ _id: 'one' }, { $inc: { 'tags.0.score': 2 }, $unset: { 'tags.1': '' } });
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ tags: [{ score: 4 }, null] });
      });

      it(`${method} rejects $push to a non-array and unsupported modifiers`, async () => {
        const { collection } = collectionFor(backend);
        await collection.insertOne({ _id: 'one', group: 'ready' });
        await expect(collection[method]({ _id: 'one' }, { $push: { group: 'new' } })).rejects.toThrow();
        await expect(collection[method]({ _id: 'one' }, { $push: { tags: { $each: ['new'] } } })).rejects.toThrow();
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ group: 'ready' });
      });

      for (const [operator, update] of [
        ['$inc', { $inc: { count: 1 } }],
        ['$unset', { $unset: { group: '' } }],
        ['$push', { $push: { tags: 'fresh' } }],
      ] as const) {
        it(`${method} reports ${operator} write costs in explain mode`, async () => {
          const { collection } = collectionFor(backend);
          await collection.insertOne({ _id: 'one', count: 1, group: 'ready' });
          const explain = await collection[method]({ _id: 'one' }, update, { explain: 'executionStats' });
          expect(explain).toMatchObject({
            result: { matchedCount: 1, modifiedCount: 1 },
            writeStats: { documentWrites: 1 },
          });
        });
      }
    }

    it('updates indexed values and reports write costs for updateMany', async () => {
      const { collection, simulator } = collectionFor(backend);
      await collection.createIndex({ count: 1 });
      await collection.insertMany([{ _id: 'one', count: 1 }, { _id: 'two', count: 1 }]);
      simulator.clearLogs();
      const explain = await collection.updateMany({ count: 1 }, { $inc: { count: 1 } }, { explain: 'executionStats' });
      expect(explain).toMatchObject({ result: { matchedCount: 2, modifiedCount: 2 }, writeStats: { documentWrites: 2 } });
      expect(await collection.find({ count: 2 }).toArray()).toHaveLength(2);
      if (backend === 's3') {
        expect(simulator.getLogs().some(log => log.command === 'putObject' && log.key.includes('/indices/'))).toBe(true);
      }
    });

    it('applies new operators to every matching document and maintains indexes', async () => {
      const { collection } = collectionFor(backend);
      await collection.createIndex({ tags: 1 });
      await collection.insertMany([{ _id: 'one', group: 'ready' }, { _id: 'two', group: 'ready' }]);
      expect(await collection.updateMany({ group: 'ready' }, { $push: { tags: 'fresh' } }))
        .toMatchObject({ matchedCount: 2, modifiedCount: 2 });
      expect(await collection.find({ tags: 'fresh' }).toArray()).toHaveLength(2);
      expect(await collection.updateMany({ group: 'ready' }, { $unset: { tags: '' } }))
        .toMatchObject({ matchedCount: 2, modifiedCount: 2 });
      expect(await collection.find({ tags: 'fresh' }).toArray()).toHaveLength(0);
    });

    for (const method of ['updateOne', 'updateMany'] as const) {
      it(`${method} rolls back earlier unique claims when a later unique index rejects an update`, async () => {
        const { collection } = collectionFor(backend);
        await collection.createIndex({ group: 1 }, { unique: true });
        await collection.createIndex({ count: 1 }, { unique: true });
        await collection.insertMany([{ _id: 'one', group: 'a', count: 1 }, { _id: 'two', group: 'b', count: 2 }]);
        await expect(collection[method]({ _id: 'one' }, { $set: { group: 'c', count: 2 } })).rejects.toThrow();
        await expect(collection.insertOne({ _id: 'three', group: 'c', count: 3 })).resolves.toMatchObject({ insertedId: 'three' });
        expect(await collection.findOne({ _id: 'one' })).toMatchObject({ group: 'a', count: 1 });
      });
    }

    it('retries a changed snapshot before updating indexed values', async () => {
      const { collection } = collectionFor(backend);
      await collection.createIndex({ count: 1 });
      await collection.insertOne({ _id: 'one', group: 'old', count: 1 });
      const originalUpdate = collection.store.updateOne.bind(collection.store);
      let first = true;
      vi.spyOn(collection.store, 'updateOne').mockImplementation(async (id, apply, validate) => {
        if (first) {
          first = false;
          await originalUpdate(id, current => ({ ...current, group: 'new' }));
        }
        return originalUpdate(id, apply, validate);
      });
      expect(await collection.updateOne({ _id: 'one' }, { $inc: { count: 1 } }))
        .toMatchObject({ matchedCount: 1, modifiedCount: 1 });
      expect(await collection.find({ count: 2 }).toArray()).toMatchObject([{ group: 'new', count: 2 }]);
      expect(await collection.find({ count: 1 }).toArray()).toHaveLength(0);
    });

    it('rechecks all filter clauses when a document changes before writing', async () => {
      const { collection } = collectionFor(backend);
      await collection.insertOne({ _id: 'one', group: 'old', count: 1 });
      const originalUpdate = collection.store.updateOne.bind(collection.store);
      vi.spyOn(collection.store, 'updateOne').mockImplementationOnce(async (id, apply, validate) => {
        await originalUpdate(id, current => ({ ...current, group: 'new' }));
        return originalUpdate(id, apply, validate);
      });
      expect(await collection.updateOne(
        { group: 'old', $or: [{ count: 1 }, { count: 2 }] },
        { $inc: { count: 1 } },
      )).toMatchObject({ matchedCount: 0, modifiedCount: 0 });
      expect(await collection.findOne({ _id: 'one' })).toMatchObject({ group: 'new', count: 1 });
    });

    if (backend === 's3') {
      it('does not restore a stale unique key after a concurrent update', async () => {
        const { collection, simulator } = collectionFor(backend);
        await collection.createIndex({ group: 1 }, { unique: true });
        await collection.insertOne({ _id: 'one', group: 'old' });
        const other = new SengoClient().db('s3').collection<Item>('write_parity');
        (other.store as any).s3 = { send: simulator.handleCommand.bind(simulator) };
        await other.listIndexes();
        const originalUpdate = collection.store.updateOne.bind(collection.store);
        let first = true;
        vi.spyOn(collection.store, 'updateOne').mockImplementation(async (id, apply, validate) => {
          if (first) {
            first = false;
            await other.updateOne({ _id: 'one' }, { $set: { group: 'concurrent' } });
          }
          return originalUpdate(id, apply, validate);
        });
        await collection.updateOne({ _id: 'one' }, { $set: { group: 'final' } });
        expect(await collection.find({ group: 'old' }).toArray()).toHaveLength(0);
        expect(await collection.find({ group: 'concurrent' }).toArray()).toHaveLength(0);
        expect(await collection.find({ group: 'final' }).toArray()).toHaveLength(1);
        await expect(collection.insertOne({ _id: 'two', group: 'old' })).resolves.toMatchObject({ insertedId: 'two' });
      });
    }

    it('preserves explicit falsy IDs for both insertion methods', async () => {
      const { collection } = collectionFor(backend);
      await collection.createIndex({ group: 1 });
      expect(await collection.insertOne({ _id: 0, group: 'zero' })).toMatchObject({ insertedId: 0 });
      expect(await collection.insertMany([{ _id: '', group: 'empty' }, { _id: null, group: 'null' }]))
        .toMatchObject({ insertedIds: { 0: '', 1: null } });
      expect(await collection.findOne({ group: 'zero' })).toMatchObject({ _id: 0 });
      expect(await collection.findOne({ group: 'empty' })).toMatchObject({ _id: '' });
      expect(await collection.findOne({ group: 'null' })).toMatchObject({ _id: null });
      await collection.updateOne({ _id: 0 }, { $set: { group: 'changed' } });
      expect(await collection.find({ group: 'zero' }).toArray()).toHaveLength(0);
      expect(await collection.findOne({ group: 'changed' })).toMatchObject({ _id: 0 });
      expect(await collection.deleteOne({ _id: '' })).toMatchObject({ deletedCount: 1 });
      expect(await collection.deleteOne({ _id: null })).toMatchObject({ deletedCount: 1 });
    });

    it('reports insert write costs and keeps single and bulk duplicate errors distinct', async () => {
      const { collection } = collectionFor(backend);
      const single = await collection.insertOne({ _id: 'one' }, { explain: 'executionStats' });
      const bulk = await collection.insertMany([{ _id: 'two' }], { explain: 'executionStats' });
      expect(single).toMatchObject({ writeStats: { documentWrites: 1 } });
      expect(bulk).toMatchObject({ writeStats: { documentWrites: 1 } });
      await expect(collection.insertOne({ _id: 'one' })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
      await expect(collection.insertMany([{ _id: 'two' }])).rejects.toMatchObject({
        name: 'MongoBulkWriteError', writeErrors: [{ index: 0, code: 11000 }],
      });
    });
  });
}
