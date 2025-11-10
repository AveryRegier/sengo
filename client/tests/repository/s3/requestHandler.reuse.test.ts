import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import type { S3CollectionStoreOptions } from '../../../src/repository/s3/s3CollectionStore';
import { describe, it, expect } from 'vitest';

describe('S3CollectionStore requestHandler reuse', () => {
  it('uses the same provided requestHandler for multiple stores', () => {
    const sharedHandler = { __testSharedHandler: true } as any;
    const opts: S3CollectionStoreOptions = { region: 'us-east-1', requestHandler: sharedHandler };

    const s1 = new S3CollectionStore('colA', 'bucket', opts);
    const s2 = new S3CollectionStore('colB', 'bucket', opts);

    // The store exposes the handler used so callers/tests can verify reuse
    expect((s1 as any).requestHandler).toBe(sharedHandler);
    expect((s2 as any).requestHandler).toBe(sharedHandler);
  });

  it('creates a different handler when one is not provided', () => {
    const sharedHandler = { __testSharedHandler: true } as any;
    const sWith = new S3CollectionStore('colA', 'bucket', { region: 'us-east-1', requestHandler: sharedHandler });
    const sWithout = new S3CollectionStore('colB', 'bucket', { region: 'us-east-1' });

    expect((sWith as any).requestHandler).toBe(sharedHandler);
    // When not provided, the constructor will lazily create a handler; it should not be === the shared one
    expect((sWithout as any).requestHandler).not.toBe(sharedHandler);
  });
});
