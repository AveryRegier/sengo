import { describe, it, expect, beforeEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { S3CollectionIndex } from '../../../src/repository/s3/s3CollectionIndex';
import { IndexEntry } from '../../../src/repository/collectionIndex';
import { Readable } from 'stream';

class MockS3Client {
  public sent: any[] = [];
  public getError: any;
  public putError: any;
  public body?: string;
  public etag = 'etag123';

  async send(cmd: any) {
    this.sent.push(cmd);
    if (cmd.constructor.name === 'GetObjectCommand') {
      if (this.getError) {
        throw this.getError;
      }
      if (this.body !== undefined) {
        return { Body: Readable.from([this.body]), ETag: this.etag };
      }
      // Simulate not found
      const err: any = new Error('NotFound');
      err.name = 'NoSuchKey';
      throw err;
    }
    if (cmd.constructor.name === 'PutObjectCommand') {
      if (this.putError) {
        throw this.putError;
      }
      this.body = cmd.input.Body;
      this.etag = `etag-${this.sent.length}`;
      return { ETag: 'etag123' };
    }
    return {};
  }
}

describe('S3CollectionIndex', () => {
  let s3: MockS3Client;
  let index: S3CollectionIndex;
  beforeEach(() => {
    s3 = new MockS3Client();
    index = new S3CollectionIndex('testIdx', [{ field: 'foo', order: 1 }], {
      s3: s3 as any as S3Client,
      collectionName: 'col',
      bucket: 'bucket',
    });
  });

  it('fetch returns empty IndexEntry if not found', async () => {
    const entry = await (index as any).fetch('bar');
    expect(entry).toBeInstanceOf(IndexEntry);
    expect(entry.toArray()).toEqual([]);
  });

  it('persistEntry sends PutObjectCommand', async () => {
    const entry = new IndexEntry([{ field: 'foo', order: 1 }], JSON.stringify(['id1', 'id2']));
    await (index as any).persistEntry('bar', entry);
    const put = s3.sent.find(cmd => cmd.constructor.name === 'PutObjectCommand');
    expect(put).toBeDefined();
    expect(put.input.IfNoneMatch).toBe('*');
    expect(put.input.IfMatch).toBeUndefined();
    expect(entry).not.toHaveProperty('etag');
  });

  it('uses IfMatch when replacing an existing entry', async () => {
    s3.body = JSON.stringify(['existing']);
    const entry = new IndexEntry([{ field: 'foo', order: 1 }], JSON.stringify(['existing', 'new']));

    await (index as any).persistEntry('bar', entry);

    const put = s3.sent.find(cmd => cmd.constructor.name === 'PutObjectCommand');
    expect(put.input.IfMatch).toBe('etag123');
    expect(put.input.IfNoneMatch).toBeUndefined();
  });

  it('propagates non-missing read failures instead of treating them as empty entries', async () => {
    const accessDenied: any = new Error('Access denied');
    accessDenied.name = 'AccessDenied';
    s3.getError = accessDenied;

    await expect(index.findIdsForKey('bar')).rejects.toBe(accessDenied);
    expect(s3.sent.some(cmd => cmd.constructor.name === 'PutObjectCommand')).toBe(false);
  });

  it('surfaces persistence failures to the mutation caller', async () => {
    const writeFailure: any = new Error('S3 unavailable');
    s3.putError = writeFailure;

    await expect(index.addDocument({ _id: 'id1', foo: 'bar' })).rejects.toThrow('S3 unavailable');
    await expect(index.flush()).rejects.toBe(writeFailure);
  });

  it('surfaces conditional retry exhaustion', async () => {
    const conflict: any = new Error('PreconditionFailed');
    conflict.name = 'PreconditionFailed';
    conflict.$metadata = { httpStatusCode: 412 };
    s3.putError = conflict;

    await expect(index.addDocument({ _id: 'id1', foo: 'bar' })).rejects.toThrow(
      'after 3 conditional-write retries'
    );
    expect(s3.sent.filter(cmd => cmd.constructor.name === 'PutObjectCommand')).toHaveLength(4);
  });
});
