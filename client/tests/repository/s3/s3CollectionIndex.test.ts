import { describe, it, expect, beforeEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { S3CollectionIndex } from '../../../src/repository/s3/s3CollectionIndex';
import { IndexEntry } from '../../../src/repository/collectionIndex';

class MockS3Client {
  public sent: any[] = [];
  async send(cmd: any) {
    this.sent.push(cmd);
    if (cmd.constructor.name === 'GetObjectCommand') {
      // Simulate not found
      const err: any = new Error('NotFound');
      err.name = 'NoSuchKey';
      throw err;
    }
    if (cmd.constructor.name === 'PutObjectCommand') {
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
    const entry = new IndexEntry(['id1', 'id2'], 'etag123');
    await (index as any).persistEntry('bar', entry);
    expect(s3.sent.some(cmd => cmd.constructor.name === 'PutObjectCommand')).toBe(true);
  });
});
