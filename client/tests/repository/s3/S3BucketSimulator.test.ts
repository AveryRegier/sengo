import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3BucketSimulator } from './S3BucketSimulator';

describe('S3BucketSimulator conditional operations', () => {
  it('can model content-derived ETags that repeat after A to B to A', async () => {
    const sim = new S3BucketSimulator({ etagMode: 'content' });
    const put = (body: string) => sim.handleCommand(new PutObjectCommand({ Bucket: 'bucket', Key: 'key', Body: body }));
    const first = await put('A');
    const second = await put('B');
    const third = await put('A');

    expect(first.ETag).not.toBe(second.ETag);
    expect(third.ETag).toBe(first.ETag);
    await expect(sim.handleCommand(new PutObjectCommand({
      Bucket: 'bucket', Key: 'key', Body: 'stale', IfMatch: first.ETag,
    }))).resolves.toBeDefined();
    expect(sim.getFile('key')).toBe('stale');
  });

  it('rejects a stale conditional delete without deleting the current owner', async () => {
    const sim = new S3BucketSimulator({ etagMode: 'content' });
    const first = sim.putObject('claims/a', 'first owner');
    sim.putObject('claims/a', 'second owner');

    await expect(Promise.resolve().then(() => sim.handleCommand(new DeleteObjectCommand({
      Bucket: 'bucket', Key: 'claims/a', IfMatch: first.ETag,
    })))).rejects.toMatchObject({ name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
    expect(sim.getFile('claims/a')).toBe('second owner');
  });

  it('deletes only when a conditional delete matches the current ETag', async () => {
    const sim = new S3BucketSimulator({ etagMode: 'content' });
    const current = sim.putObject('claims/a', 'owner');
    await sim.handleCommand(new DeleteObjectCommand({ Bucket: 'bucket', Key: 'claims/a', IfMatch: current.ETag }));
    expect(sim.getFile('claims/a')).toBeUndefined();
  });

  it('supports existence-conditional delete and rejects an absent key', async () => {
    const sim = new S3BucketSimulator();
    sim.putObject('claims/a', 'owner');
    const command = new DeleteObjectCommand({ Bucket: 'bucket', Key: 'claims/a', IfMatch: '*' });
    await sim.handleCommand(command);
    await expect(Promise.resolve().then(() => sim.handleCommand(command))).rejects.toMatchObject({ name: 'PreconditionFailed' });
  });

  it('preserves unconditional delete behavior for a missing key', () => {
    const sim = new S3BucketSimulator();
    expect(sim.deleteObject('missing')).toEqual({ DeleteMarker: false });
  });
});
