import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { normalizeIndexKeys } from '../../../src/repository/collectionIndex';

describe('S3CollectionStore.createIndex and normalizeIndexKeys', () => {
  const bucket = 'test-bucket';
  const collection = 'test-collection';
  let store: S3CollectionStore;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new S3CollectionStore(collection, bucket);
    sendMock = vi.fn().mockResolvedValue({});
    // @ts-ignore
    store.s3.send = sendMock;
  });

  it('creates an index file with normalized keys (string)', async () => {
    const keys = 'foo';
    const normalized = normalizeIndexKeys(keys);
    const index = await store.createIndex('fooIndex', normalized);
    const call = sendMock.mock.calls[0][0];
    expect(call.constructor.name).toBe('PutObjectCommand');
    expect(call.input).toMatchObject({
      Bucket: bucket,
      Key: `${collection}/indices/fooIndex.json`,
      Body: JSON.stringify(index),
      ContentType: 'application/json',
    });
    expect(index).toEqual({ name: 'fooIndex', keys: [{ field: 'foo', order: 1 }] });
  });

  it('creates an index file with normalized keys (object)', async () => {
    const keys: { [key: string]: import('../../../src/repository/collectionIndex').Order } = { bar: -1, baz: 'text' };
    const normalized = normalizeIndexKeys(keys);
    const index = await store.createIndex('barBazIndex', normalized);
    expect(index.keys).toEqual([
      { field: 'bar', order: -1 },
      { field: 'baz', order: 'text' },
    ]);
    const call = sendMock.mock.calls[0][0];
    expect(call.constructor.name).toBe('PutObjectCommand');
    expect(call.input).toMatchObject({
      Key: `${collection}/indices/barBazIndex.json`,
    });
  });

  it('throws if store is closed', async () => {
    await store.close();
    await expect(store.createIndex('fail', [{ field: 'x', order: 1 }])).rejects.toThrow('Store is closed');
  });

  it('normalizes array of keys', () => {
    const keys: (string | { [key: string]: import('../../../src/repository/collectionIndex').Order })[] = ['foo', { bar: -1 }];
    const normalized = normalizeIndexKeys(keys);
    expect(normalized).toEqual([
      { field: 'foo', order: 1 },
      { field: 'bar', order: -1 },
    ]);
  });
});
