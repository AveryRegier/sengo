import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import type { S3CollectionStoreOptions } from '../../../src/repository/s3/s3CollectionStore';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { S3BucketSimulator } from './S3BucketSimulator';

vi.mock('@aws-sdk/client-s3', async () => {
  return {
    S3Client: class { send = vi.fn(); },
    GetObjectCommand: function(input: any) { return { type: 'GetObjectCommand', input }; },
    PutObjectCommand: function(input: any) { return { type: 'PutObjectCommand', input }; },
    ListObjectsV2Command: function(input: any) { return { type: 'ListObjectsV2Command', input }; },
    DeleteObjectCommand: function(input: any) { return { type: 'DeleteObjectCommand', input }; },
    // Add other S3 commands as needed
  };
});

const mockSend = vi.fn();
// S3Client is now a class with a send method (from our vi.mock above)
// No need for mockImplementation; just use the mock as provided

const opts: S3CollectionStoreOptions = { region: 'us-east-1' };
const bucket = 'test-bucket';
const collection = 'animals';

// Simulate a MongoDB network error
class MongoNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MongoNetworkError';
  }
}

describe('S3CollectionStore', () => {
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };
  beforeEach(() => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
  });

  function s3MockSend(cmd: any) {
    // Forward all S3 commands to the simulator's handleCommand, which mimics S3 behavior for both known and unknown commands
    return s3sim.handleCommand(cmd);
  }

  it('should replace (upsert) a document successfully', async () => {
    const store = new S3CollectionStore(collection, bucket, opts);
    (store as any).s3 = s3Client;
    const doc = { _id: 'testid', name: 'fuzzy', kind: 'cat' };
    await store.replaceOne({ _id: doc._id }, doc);
    expect(s3sim.getFile(`${collection}/data/testid.json`)).toBe(JSON.stringify(doc));
  });

  it('should find a document by _id successfully', async () => {
    const doc = { _id: 'abc123', name: 'fuzzy', kind: 'cat' };
    s3sim.putObject(`${collection}/data/abc123.json`, JSON.stringify(doc));
    const store = new S3CollectionStore(collection, bucket, opts);
    (store as any).s3 = s3Client;
    const found = await store.find({ _id: 'abc123' }).toArray();
    expect(found).toEqual([doc]);
  });

  it('should return [] if document not found by _id', async () => {
    const store = new S3CollectionStore(collection, bucket, opts);
    (store as any).s3 = s3Client;
    const found = await store.find({ _id: 'notfound' }).toArray();
    expect(found).toEqual([]);
  });

  // it('should throw a MongoDB compatible error on S3 command/network failure', async () => {
  //   // Simulate a real AWS SDK v3 network error
  //   const error = new Error('connect ETIMEDOUT');
  //   (error as any).name = 'TimeoutError';
  //   mockSend.mockImplementation((cmd) => {
  //     // Log every call to mockSend for debugging
  //     // eslint-disable-next-line no-console
  //     console.log('mockSend called with:', cmd.constructor.name, cmd.input);
  //     // Only throw the error for GetObjectCommand with the expected key
  //     if (
  //       cmd instanceof GetObjectCommand &&
  //       cmd.input &&
  //       cmd.input.Key === `${collection}/data/fail.json`
  //     ) {
  //       throw error;
  //     }
  //     // Otherwise, return a dummy value
  //     return {};
  //   });
  //   const store = new S3CollectionStore(collection, bucket, opts);
  //   try {
  //     await store.find({ _id: 'fail' });
  //   } catch (err) {
  //     // Log the error and stack trace for debugging
  //     // eslint-disable-next-line no-console
  //     console.error('Caught error:', err);
  //     if (err && err.stack) {
  //       // eslint-disable-next-line no-console
  //       console.error('Stack trace:', err.stack);
  //     }
  //     throw err;
  //   }
  //   await expect(store.find({ _id: 'fail' })).rejects.toThrowError(MongoNetworkError);
  //   await expect(store.find({ _id: 'fail' })).rejects.toThrow(/connect ETIMEDOUT/);
  // });

  it('should throw Store is closed after close()', async () => {
    const store = new S3CollectionStore(collection, bucket, opts);
    await store.close();
    await expect(store.replaceOne({ _id: 'fuzzy' }, { _id: 'fuzzy', name: 'fuzzy' })).rejects.toThrow('Store is closed');
    expect(() => store.find({ _id: 'abc' })).toThrow('Store is closed');
  });

  it('can insert and delete a document by _id', async () => {
    const store = new S3CollectionStore(collection, bucket, opts);
    (store as any).s3 = s3Client;
    const doc = { _id: 'del1', foo: 123 };
    await store.replaceOne({ _id: doc._id }, doc);
    // Confirm present
    expect(s3sim.getFile(`${collection}/data/del1.json`)).toBe(JSON.stringify(doc));
    // Delete
    await store.deleteOneById(doc._id);
    // Should be gone
    expect(s3sim.getFile(`${collection}/data/del1.json`)).toBeUndefined();
  });
});
