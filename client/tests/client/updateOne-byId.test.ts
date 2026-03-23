import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src';
import Chance from 'chance';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';

const chance = new Chance();

describe('SengoClient updateOne API (memory backend)', () => {
  it('should update a document by _id', async () => {
    const client = new SengoClient();  
    const collection = client.db('memory').collection<{ _id: string; name: string; kind: string }>('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    const { insertedId } = await collection.insertOne(animal);
    const updateResult = await collection.updateOne({ _id: insertedId }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: insertedId }).toArray();
    expect(found[0].name).toBe('UpdatedName');
  });
});

describe('SengoClient updateOne API (s3 backend)', () => {
  let bucketSim: S3BucketSimulator;
  let s3Mock: ReturnType<typeof mockClient>;
  beforeEach(() => {
    bucketSim = new S3BucketSimulator();
    s3Mock = mockClient(S3Client);
    s3Mock.reset();
    // Route mocked S3 commands to the S3BucketSimulator so it handles extraction
    // of Key/Body/Prefix consistently (the mock library passes the Command
    // instance, not the raw input object).
    s3Mock.on(PutObjectCommand).callsFake((cmd) => {
      return bucketSim.putObject(cmd as any);
    });
    s3Mock.on(GetObjectCommand).callsFake((cmd) => {
      return bucketSim.getObject(cmd as any);
    });
    s3Mock.on(ListObjectsV2Command).callsFake((cmd) => {
      return bucketSim.listObjectsV2(cmd as any);
    });
    s3Mock.on(HeadObjectCommand).callsFake((cmd) => {
      return bucketSim.headObject(cmd as any);
    });
  });
  it('should update a document by _id', async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{ _id: string; name: string; kind: string }>('animals');
    const animal = { name: chance.first(), kind: chance.animal() };
    // Use a fixed _id for mock matching
    const { insertedId } = await collection.insertOne({ ...animal, _id: 'mockid' });
    const updateResult = await collection.updateOne({ _id: 'mockid' }, { $set: { name: 'UpdatedName' } });
    expect(updateResult).toHaveProperty('matchedCount', 1);
    expect(updateResult).toHaveProperty('modifiedCount', 1);
    const found = await collection.find({ _id: 'mockid' }).toArray();
    expect(found[0].name).toBe('UpdatedName');
  });
  it("should find a document by an indexed field after update of another field", async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{ _id: string; name: string; kind: string }>('animals');
    await collection.createIndex('name');
    const animal = { name: 'OriginalName', kind: chance.animal() };
    const { insertedId } = await collection.insertOne({ ...animal });
    bucketSim.clearAccessLog();
    await collection.updateOne({ _id: insertedId }, { $set: { kind: "something else" } });
    const cursor = collection.find({ name: 'OriginalName' });
    const found = await cursor.toArray();
    expect(found.length).toBe(1);
    expect(JSON.stringify(found[0]._id)).to.equal(JSON.stringify(insertedId));
    expect(found[0].kind).toBe("something else");
    expect(bucketSim.getIndexAccessLogDetailed()
      .filter(entry => entry.command === 'putObject').length).toBe(0);
  });

  it('keeps indexed array $in query results after updating a non-indexed field', async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{
      _id: string;
      memberId: string[];
      deaconId: string[];
      contactType: string;
      summary: string;
      contactDate: string;
      followUpRequired: boolean;
      createdAt: string;
    }>('contacts_regression_memberid_index_update');

    await collection.createIndex({ memberId: 1 });

    const targetMemberId = 'member-target';
    const inserted = await collection.insertOne({
      _id: 'contact-1',
      memberId: ['member-a', targetMemberId],
      deaconId: ['deacon-1'],
      contactType: 'visit',
      summary: 'before update',
      contactDate: '2026-03-01T00:00:00.000Z',
      followUpRequired: false,
      createdAt: '2026-03-01T00:00:00.000Z'
    });

    const before = await collection.find({ memberId: { $in: [targetMemberId] } }).toArray();
    expect(before.length).toBe(1);
    expect(before[0]._id).toBe(inserted.insertedId);

    for (let i = 0; i < 50; i++) {
      await collection.updateOne(
        { _id: inserted.insertedId },
        {
          $set: {
            // Re-send equal-valued arrays as a fresh payload, like actsix edit flow.
            memberId: ['member-a', targetMemberId],
            deaconId: ['deacon-1'],
            contactDate: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T17:00:00.000Z`,
            summary: `after date edit #${i}`
          }
        }
      );

      const afterEachUpdate = await collection.find({ memberId: { $in: [targetMemberId] } }).toArray();
      expect(afterEachUpdate.length).toBe(1);
      expect(afterEachUpdate[0]._id).toBe(inserted.insertedId);
    }

    const after = await collection.find({ memberId: { $in: [targetMemberId] } }).toArray();
    expect(after.length).toBe(1);
    expect(after[0]._id).toBe(inserted.insertedId);
  });

  it('repro: can temporarily lose indexed array membership after update when add-back persist hits repeated conflicts', async () => {
    const client = new SengoClient();
    const collection = client.db('s3').collection<{
      _id: string;
      memberId: string[];
      deaconId: string[];
      contactType: string;
      summary: string;
      contactDate: string;
      followUpRequired: boolean;
      createdAt: string;
    }>('contacts_regression_memberid_conflict_window');

    await collection.createIndex({ memberId: 1 });

    const targetMemberId = 'member-target';
    const inserted = await collection.insertOne({
      _id: 'contact-1',
      memberId: ['member-a', targetMemberId],
      deaconId: ['deacon-1'],
      contactType: 'visit',
      summary: 'before update',
      contactDate: '2026-03-01T00:00:00.000Z',
      followUpRequired: false,
      createdAt: '2026-03-01T00:00:00.000Z'
    });

    const originalPutObject = bucketSim.putObject.bind(bucketSim);
    let conflictCount = 0;
    bucketSim.putObject = ((keyOrCmd: any, body?: string) => {
      const key = typeof keyOrCmd === 'string' ? keyOrCmd : S3BucketSimulator.extractKey(keyOrCmd);
      const resolvedBody = body !== undefined
        ? body
        : (typeof keyOrCmd === 'string' ? undefined : S3BucketSimulator.extractBody(keyOrCmd));

      const isTargetIndex = !!key && key.includes('/indices/memberId_1/member-target.json');
      const isAddBackWrite = resolvedBody === '["contact-1"]';
      if (isTargetIndex && isAddBackWrite && conflictCount < 3) {
        conflictCount += 1;
        const err: any = new Error('ConditionalRequestConflict');
        err.Code = 'ConditionalRequestConflict';
        err.$metadata = { httpStatusCode: 409 };
        throw err;
      }

      return originalPutObject(keyOrCmd, body as any);
    }) as any;

    await collection.updateOne(
      { _id: inserted.insertedId },
      {
        $set: {
          memberId: ['member-a', targetMemberId],
          deaconId: ['deacon-1'],
          contactDate: '2026-03-10T17:00:00.000Z',
          summary: 'after date edit'
        }
      }
    );

    // Repro assertion: immediately after update the document should not disappear.
    const immediate = await collection.find({ memberId: { $in: [targetMemberId] } }).toArray();
    expect(immediate.length).toBe(1);
  });
});
