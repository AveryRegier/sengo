import { describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import type { SengoCollection } from '../../src/client/collection';

type Account = {
  tenant: string;
  handle: string;
  email: string;
};

function makeCollection(): SengoCollection<Account> {
  return new SengoClient().db('memory').collection<Account>('accounts');
}

describe('unique indexes', () => {
  it('rejects duplicate single-field values without storing the rejected document', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    await collection.insertOne({ _id: 'first', tenant: 'north', handle: 'one', email: 'same@example.test' });

    await expect(
      collection.insertOne({ _id: 'second', tenant: 'south', handle: 'two', email: 'same@example.test' }),
    ).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });

    await expect(collection.countDocuments({})).resolves.toBe(1);
    await expect(collection.findOne({ _id: 'first' })).resolves.toMatchObject({ handle: 'one' });
    await expect(collection.findOne({ _id: 'second' })).resolves.toBeNull();
  });

  it('enforces a complete compound tuple, not only its leading field', async () => {
    const collection = makeCollection();
    await collection.createIndex({ tenant: 1, handle: 1 }, { unique: true });

    await collection.insertOne({ _id: 'one', tenant: 'north', handle: 'alpha', email: 'a' });
    await collection.insertOne({ _id: 'two', tenant: 'north', handle: 'beta', email: 'b' });

    await expect(
      collection.insertOne({ _id: 'duplicate', tenant: 'north', handle: 'alpha', email: 'c' }),
    ).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });

    await expect(collection.countDocuments({})).resolves.toBe(2);
    await expect(collection.find({ tenant: 'north' }).toArray()).resolves.toHaveLength(2);
  });

  it('keeps duplicate values allowed on non-unique indexes', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 });

    await collection.insertOne({ _id: 'one', tenant: 'north', handle: 'one', email: 'shared@example.test' });
    await collection.insertOne({ _id: 'two', tenant: 'south', handle: 'two', email: 'shared@example.test' });

    await expect(collection.find({ email: 'shared@example.test' }).toArray()).resolves.toHaveLength(2);
  });
});
