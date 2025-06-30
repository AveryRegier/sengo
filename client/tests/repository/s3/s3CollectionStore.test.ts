import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import type { S3CollectionStoreOptions } from '../../../src/repository/s3/s3CollectionStore';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-s3');

const mockSend = vi.fn();
(S3Client as unknown as { mockImplementation: (fn: () => any) => void }).mockImplementation(() => ({ send: mockSend }));

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
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should replace (upsert) a document successfully', async () => {
    mockSend.mockResolvedValueOnce({});
    const store = new S3CollectionStore(collection, bucket, opts);
    const doc = { _id: 'testid', name: 'fuzzy', kind: 'cat' };
    await store.replaceOne({ _id: doc._id }, doc);
    expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  it('should find a document by _id successfully', async () => {
    const doc = { _id: 'abc123', name: 'fuzzy', kind: 'cat' };
    const body = JSON.stringify(doc);
    mockSend.mockResolvedValueOnce({
      Body: require('stream').Readable.from([body])
    });
    const store = new S3CollectionStore(collection, bucket, opts);
    const found = await store.find({ _id: 'abc123' });
    expect(found).toEqual([doc]);
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });

  it('should return [] if document not found by _id', async () => {
    const error = new Error('Not found');
    (error as any).name = 'NoSuchKey';
    mockSend.mockRejectedValueOnce(error);
    const store = new S3CollectionStore(collection, bucket, opts);
    const found = await store.find({ _id: 'notfound' });
    expect(found).toEqual([]);
  });

  it('should throw a MongoDB compatible error on S3 command/network failure', async () => {
    // Simulate a real AWS SDK v3 network error
    const error = new Error('connect ETIMEDOUT');
    (error as any).name = 'TimeoutError';
    mockSend.mockRejectedValueOnce(error);
    const store = new S3CollectionStore(collection, bucket, opts);
    await expect(store.find({ _id: 'fail' })).rejects.toThrow(/MongoNetworkError|failed to connect|network error/i);
  });

  it('should throw Store is closed after close()', async () => {
    const store = new S3CollectionStore(collection, bucket, opts);
    await store.close();
    await expect(store.replaceOne({ _id: 'fuzzy' }, { _id: 'fuzzy', name: 'fuzzy' })).rejects.toThrow('Store is closed');
    await expect(store.find({ _id: 'abc' })).rejects.toThrow('Store is closed');
  });
});
