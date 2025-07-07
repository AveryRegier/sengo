import { describe, it, expect } from 'vitest';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { SengoCollection } from '../../../src/client/collection';
import { S3BucketSimulator } from './S3BucketSimulator';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { vi } from 'vitest';

describe('S3CollectionStore index cleanup on delete', () => {
  function makeStoreWithSim(s3sim: S3BucketSimulator) {
    const sendMock = vi.fn(async (cmd: any) => {
      if (cmd instanceof PutObjectCommand) {
        s3sim.putObject(cmd.input.Key!, String(cmd.input.Body));
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        return s3sim.getObject(cmd.input.Key!);
      }
      if (cmd instanceof ListObjectsV2Command) {
        return s3sim.listObjectsV2(cmd.input.Prefix);
      }
      if (cmd.constructor && cmd.constructor.name === 'DeleteObjectCommand') {
        return s3sim.deleteObject(cmd.input.Key!);
      }
      throw new Error('Unknown command: ' + cmd.constructor.name);
    });
    const store = new S3CollectionStore('test-coll', 'test-bucket');
    // @ts-ignore
    store.s3.send = sendMock;
    return { store, sendMock };
  }

  it('removes deleted document _id from all index entries in S3', async () => {
    const s3sim = new S3BucketSimulator();
    const { store } = makeStoreWithSim(s3sim);
    const collection = new SengoCollection('test-coll', store);
    // Insert two docs with the same indexed field
    const docA = { _id: 'a', name: 'Clancy' };
    const docB = { _id: 'b', name: 'Clancy', role: 'pet' };
    await collection.insertOne(docA);
    await collection.insertOne(docB);
    // Create an index on 'name'
    const indexName = await collection.createIndex({ name: 1 });
    // Confirm both IDs are in the index entry file
    const entryKey = `test-coll/indices/${indexName}/Clancy.json`;
    let entry = s3sim.getFile(entryKey);
    expect(entry).toBeDefined();
    let ids = JSON.parse(entry!);
    expect(ids.sort()).toEqual(['a', 'b']);
    // Delete one doc
    await collection.deleteOne({ _id: 'a' });
    // Confirm only the remaining doc is in the index entry file
    entry = s3sim.getFile(entryKey);
    expect(entry).toBeDefined();
    ids = JSON.parse(entry!);
    expect(ids).toEqual(['b']);
    // Confirm find does not return the deleted doc
    const found = await collection.find({ name: 'Clancy' }).toArray();
    expect(found.map(d => d._id)).toEqual(['b']);
  });
});
