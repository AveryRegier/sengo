import { describe, expect, it, vi } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { S3CollectionStore } from '../../src/repository/s3/s3CollectionStore';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type Account = {
  tenant: string;
  handle: string;
  email: string;
};

function makeCollection(): SengoCollection<Account> {
  return new SengoClient().db('memory').collection<Account>('accounts');
}

function makeS3Collection(name: string) {
  const simulator = new S3BucketSimulator();
  const store = new S3CollectionStore<Account>(name, 'unique-index-test-bucket');
  const send = vi.fn(async (command: any) => simulator.handleCommand(command));
  store['s3'].send = send as any;
  return {
    collection: new SengoCollection<Account>(name, store),
    simulator,
    send,
  };
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

  it('rejects a conflicting update and retains the original document and index key', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    await collection.insertOne({ _id: 'first', tenant: 'north', handle: 'one', email: 'one@example.test' });
    await collection.insertOne({ _id: 'second', tenant: 'south', handle: 'two', email: 'two@example.test' });

    await expect(
      collection.updateOne({ _id: 'second' }, { $set: { email: 'one@example.test' } }),
    ).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });

    await expect(collection.findOne({ _id: 'second' })).resolves.toMatchObject({ email: 'two@example.test' });
    await expect(collection.find({ email: 'one@example.test' }).toArray()).resolves.toHaveLength(1);
  });

  it('releases the previous key after a successful update and delete', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    await collection.insertOne({ _id: 'first', tenant: 'north', handle: 'one', email: 'one@example.test' });
    await collection.updateOne({ _id: 'first' }, { $set: { email: 'updated@example.test' } });
    await collection.insertOne({ _id: 'second', tenant: 'south', handle: 'two', email: 'one@example.test' });

    await collection.deleteOne({ _id: 'second' });
    await expect(collection.insertOne({
      _id: 'third',
      tenant: 'west',
      handle: 'three',
      email: 'one@example.test',
    })).resolves.toMatchObject({ insertedId: 'third' });
  });

  it('serializes competing writes to one unique value in a process', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    const writes = await Promise.allSettled([
      collection.insertOne({ _id: 'first', tenant: 'north', handle: 'one', email: 'same@example.test' }),
      collection.insertOne({ _id: 'second', tenant: 'south', handle: 'two', email: 'same@example.test' }),
    ]);

    expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1);
    await expect(collection.countDocuments({})).resolves.toBe(1);
  });

  it('treats a missing value and explicit null as the same unique key', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    await collection.insertOne({ _id: 'missing', tenant: 'north', handle: 'one' });
    await expect(collection.insertOne({
      _id: 'null',
      tenant: 'south',
      handle: 'two',
      email: null,
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
    await expect(collection.findOne({ email: null })).resolves.toMatchObject({ _id: 'missing' });
  });

  it('uses the full compound tuple when fields are missing', async () => {
    const collection = makeCollection();
    await collection.createIndex({ tenant: 1, email: 1 }, { unique: true });

    await collection.insertOne({ _id: 'north', tenant: 'north', handle: 'one' });
    await collection.insertOne({ _id: 'south', tenant: 'south', handle: 'two' });
    await expect(collection.insertOne({
      _id: 'north-null',
      tenant: 'north',
      handle: 'three',
      email: null,
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
  });

  it('keeps values of different BSON-like types distinct in unique keys', async () => {
    const collection = makeCollection();
    await collection.createIndex({ tenant: 1 }, { unique: true });

    await collection.insertOne({ _id: 'number', tenant: 1, handle: 'one', email: 'a' });
    await collection.insertOne({ _id: 'string', tenant: '1', handle: 'two', email: 'b' });
    await collection.insertOne({ _id: 'object-a', tenant: { region: 'north', zone: 1 }, handle: 'three', email: 'c' });
    await collection.insertOne({ _id: 'object-b', tenant: { zone: 1, region: 'north' }, handle: 'four', email: 'd' });

    await expect(collection.countDocuments({})).resolves.toBe(4);
  });

  it('enforces every distinct key generated by a multikey unique index', async () => {
    const collection = makeCollection();
    await collection.createIndex({ email: 1 }, { unique: true });

    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      email: ['shared@example.test', 'shared@example.test', 'first@example.test'],
    });
    await expect(collection.insertOne({
      _id: 'second',
      tenant: 'south',
      handle: 'two',
      email: ['second@example.test', 'shared@example.test'],
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
    await expect(collection.countDocuments({})).resolves.toBe(1);
  });

  it('correlates compound multikey values from the same embedded array', async () => {
    const collection = makeCollection();
    await collection.createIndex({ 'items.code': 1, 'items.zone': 1 }, { unique: true });

    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      items: [{ code: 'A', zone: 'east' }, { code: 'B', zone: 'west' }],
    });
    await expect(collection.insertOne({
      _id: 'other-pair',
      tenant: 'south',
      handle: 'two',
      items: [{ code: 'A', zone: 'west' }],
    })).resolves.toMatchObject({ insertedId: 'other-pair' });
    await expect(collection.insertOne({
      _id: 'duplicate-pair',
      tenant: 'south',
      handle: 'three',
      items: [{ code: 'A', zone: 'east' }],
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
  });

  it('rejects parallel array expansion for a compound unique index without inserting', async () => {
    const collection = makeCollection();
    await collection.createIndex({ tenant: 1, handle: 1 }, { unique: true });

    await expect(collection.insertOne({
      _id: 'parallel',
      tenant: ['north', 'south'],
      handle: ['one', 'two'],
      email: 'unused',
    })).rejects.toMatchObject({ name: 'MongoInvalidArgumentError' });
    await expect(collection.countDocuments({})).resolves.toBe(0);
  });

  it('checks only the related unique index entry and never scans documents on insert', async () => {
    const { collection, simulator, send } = makeS3Collection('unique-write-accounts');
    const indexName = await collection.createIndex({ email: 1 }, { unique: true });
    const indexEntryPrefix = `unique-write-accounts/indices/${indexName}/`;
    send.mockClear();
    simulator.clearLogs();

    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      email: 'same@example.test',
    });

    const firstWriteCommands = send.mock.calls.map(([command]) => command.constructor.name);
    expect(firstWriteCommands).not.toContain('ListObjectsV2Command');
    expect(simulator.getLogs().some(log => log.key.includes('/data/') && log.command === 'getObject')).toBe(false);
    expect(simulator.getLogs().some(log => log.key.startsWith(indexEntryPrefix))).toBe(true);

    send.mockClear();
    simulator.clearLogs();
    await expect(collection.insertOne({
      _id: 'duplicate',
      tenant: 'south',
      handle: 'two',
      email: 'same@example.test',
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });

    const duplicateCommands = send.mock.calls.map(([command]) => command.constructor.name);
    expect(duplicateCommands).not.toContain('ListObjectsV2Command');
    expect(duplicateCommands).not.toContain('PutObjectCommand');
    expect(simulator.getLogs()).toEqual([
      expect.objectContaining({ command: 'headObject', key: expect.stringContaining(indexEntryPrefix) }),
    ]);
  });

  it('does not increase S3 lookup counts for reads through a unique index', async () => {
    const unique = makeS3Collection('unique-read-accounts');
    const nonUnique = makeS3Collection('non-unique-read-accounts');
    await unique.collection.createIndex({ email: 1 }, { unique: true });
    await nonUnique.collection.createIndex({ email: 1 });
    await unique.collection.insertOne({
      _id: 'target',
      tenant: 'north',
      handle: 'one',
      email: 'target@example.test',
    });
    await nonUnique.collection.insertOne({
      _id: 'target',
      tenant: 'north',
      handle: 'one',
      email: 'target@example.test',
    });
    unique.simulator.clearLogs();
    nonUnique.simulator.clearLogs();
    unique.send.mockClear();
    nonUnique.send.mockClear();

    await expect(unique.collection.find({ email: 'target@example.test' }).toArray()).resolves.toHaveLength(1);
    await expect(nonUnique.collection.find({ email: 'target@example.test' }).toArray()).resolves.toHaveLength(1);

    const lookupCount = (send: typeof unique.send) =>
      send.mock.calls.filter(([command]) =>
        ['GetObjectCommand', 'HeadObjectCommand', 'ListObjectsV2Command'].includes(command.constructor.name),
      ).length;
    expect(lookupCount(unique.send)).toBe(lookupCount(nonUnique.send));
    expect(unique.send.mock.calls.map(([command]) => command.constructor.name)).not.toContain('ListObjectsV2Command');
  });

  it('uses a unique compound index for sort and limit 1 without scanning the collection', async () => {
    const { collection, simulator, send } = makeS3Collection('unique-sort-limit-accounts');
    await collection.createIndex({ tenant: 1, handle: 1 }, { unique: true });
    await collection.insertOne({
      _id: 'last',
      tenant: 'north',
      handle: 'zulu',
      email: 'last@example.test',
    });
    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'alpha',
      email: 'first@example.test',
    });
    await collection.insertOne({
      _id: 'other-tenant',
      tenant: 'south',
      handle: 'aardvark',
      email: 'other@example.test',
    });
    send.mockClear();
    simulator.clearLogs();

    await expect(
      collection.find({ tenant: 'north' }, { sort: { handle: 1 }, limit: 1 }).toArray(),
    ).resolves.toMatchObject([{ _id: 'first', handle: 'alpha' }]);

    const commands = send.mock.calls.map(([command]) => command.constructor.name);
    expect(commands).not.toContain('ListObjectsV2Command');
    expect(simulator.getLogs().some(log => log.command === 'listObjectsV2')).toBe(false);
    expect(simulator.getLogs().filter(log =>
      log.command === 'getObject' && log.key.includes('/data/'),
    )).toHaveLength(1);
    expect(simulator.getLogs().filter(log =>
      log.key.startsWith('unique-sort-limit-accounts/indices/tenant_1_handle_1/'),
    )).toHaveLength(1);
  });

  it('does not publish unique index metadata when backfill detects duplicates', async () => {
    const { collection, simulator } = makeS3Collection('unique-build-accounts');
    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      email: 'duplicate@example.test',
    });
    await collection.insertOne({
      _id: 'second',
      tenant: 'south',
      handle: 'two',
      email: 'duplicate@example.test',
    });

    await expect(collection.createIndex({ email: 1 }, { unique: true })).rejects.toMatchObject({
      name: 'DuplicateKeyError',
      code: 11000,
    });
    expect(simulator.getFile('unique-build-accounts/indices/email_1.json')).toBeUndefined();
    expect(simulator.listObjects('unique-build-accounts/indices/email_1/')).toEqual([]);
  });

  it('reloads compound multikey memberships before enforcing unique tuples', async () => {
    const initial = makeS3Collection('unique-reload-accounts');
    await initial.collection.createIndex({ tenant: 1, email: 1 }, { unique: true });
    await initial.collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      email: ['one@example.test', 'shared@example.test'],
    });

    const reopenedStore = new S3CollectionStore<Account>('unique-reload-accounts', 'unique-index-test-bucket');
    reopenedStore['s3'].send = vi.fn(async (command: any) => initial.simulator.handleCommand(command)) as any;
    const reopened = new SengoCollection<Account>('unique-reload-accounts', reopenedStore);
    await reopened.listIndexes();

    await expect(reopened.insertOne({
      _id: 'second',
      tenant: 'north',
      handle: 'two',
      email: ['shared@example.test', 'two@example.test'],
    })).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
    await expect(reopened.find({ tenant: 'north', email: 'shared@example.test' }).toArray()).resolves.toHaveLength(1);
    await reopenedStore.close();
  });

  it('enforces unique keys on S3 updates before replacing the document', async () => {
    const { collection, simulator } = makeS3Collection('unique-update-accounts');
    await collection.createIndex({ email: 1 }, { unique: true });
    await collection.insertOne({
      _id: 'first',
      tenant: 'north',
      handle: 'one',
      email: 'one@example.test',
    });
    await collection.insertOne({
      _id: 'second',
      tenant: 'south',
      handle: 'two',
      email: 'two@example.test',
    });

    await expect(
      collection.updateOne({ _id: 'second' }, { $set: { email: 'one@example.test' } }),
    ).rejects.toMatchObject({ name: 'DuplicateKeyError', code: 11000 });
    await expect(collection.findOne({ _id: 'second' })).resolves.toMatchObject({
      email: 'two@example.test',
    });
    expect(simulator.getFile('unique-update-accounts/data/second.json')).toContain('two@example.test');
  });

  it.skip('probes uniqueness across independent clients sharing one S3 bucket', async () => {
    const simulator = new S3BucketSimulator();
    const bucket = 'unique-cross-client-test-bucket';
    const firstStore = new S3CollectionStore<Account>('shared-accounts', bucket);
    const secondStore = new S3CollectionStore<Account>('shared-accounts', bucket);
    const firstSend = vi.fn(async (command: any) => simulator.handleCommand(command));
    const secondSend = vi.fn(async (command: any) => simulator.handleCommand(command));
    firstStore['s3'].send = firstSend as any;
    secondStore['s3'].send = secondSend as any;
    const firstClient = new SengoCollection<Account>('shared-accounts', firstStore);
    const secondClient = new SengoCollection<Account>('shared-accounts', secondStore);
    await firstClient.createIndex({ email: 1 }, { unique: true });
    await secondClient.listIndexes();
    simulator.clearLogs();

    const results = await Promise.allSettled([
      firstClient.insertOne({
        _id: 'first',
        tenant: 'north',
        handle: 'one',
        email: 'same@example.test',
      }),
      secondClient.insertOne({
        _id: 'second',
        tenant: 'south',
        handle: 'two',
        email: 'same@example.test',
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const commands = [...firstSend.mock.calls, ...secondSend.mock.calls].map(
      ([command]) => command.constructor.name,
    );
    expect(commands).not.toContain('ListObjectsV2Command');
    await firstStore.close();
    await secondStore.close();
  });
});
