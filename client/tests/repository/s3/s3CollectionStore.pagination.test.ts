import { describe, expect, it } from 'vitest';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3CollectionStore } from '../../../src/repository/s3/s3CollectionStore';
import { S3BucketSimulator } from './S3BucketSimulator';

function setup(pageSize: number) {
  const simulator = new S3BucketSimulator();
  const store = new S3CollectionStore<{ value: string }>('items', 'bucket');
  const requests: { prefix?: string; token?: string; delimiter?: string }[] = [];
  (store as any).s3 = {
    send: async (command: any) => {
      if (!(command instanceof ListObjectsV2Command)) return simulator.handleCommand(command);
      const { Prefix: prefix, ContinuationToken: token, Delimiter: delimiter } = command.input;
      requests.push({ prefix, token, delimiter });
      const keys = simulator.listObjects(prefix).sort();
      const offset = token ? Number(token) : 0;
      const contents = keys.slice(offset, offset + pageSize).map(Key => ({ Key }));
      const next = offset + pageSize;
      return {
        Contents: contents,
        IsTruncated: next < keys.length,
        NextContinuationToken: next < keys.length ? String(next) : undefined,
      };
    },
  };
  return { simulator, store, requests };
}

describe('S3 collection listing pagination', () => {
  it('enumerates more than 1000 documents in a collection scan', async () => {
    const { simulator, store, requests } = setup(1000);
    for (let i = 0; i < 1001; i++) {
      const id = String(i).padStart(4, '0');
      simulator.putObject(`items/data/${id}.json`, JSON.stringify({ _id: id, value: 'x' }));
    }
    let listedKeys: string[] = [];
    const docs = await store.findCandidates({}, undefined, undefined, async request => {
      listedKeys = request.keys;
      return request.loadDefault();
    });
    expect(docs).toHaveLength(1001);
    expect(listedKeys).toContain('items/data/1000.json');
    expect(requests.filter(request => request.prefix === 'items/data/').map(request => request.token))
      .toEqual([undefined, '1000']);
  });

  it('builds an index using documents from every page', async () => {
    const { simulator, store } = setup(2);
    for (const id of ['a', 'b', 'c']) {
      simulator.putObject(`items/data/${id}.json`, JSON.stringify({ _id: id, value: id }));
    }
    await store.createIndex('value_1', [{ field: 'value', order: 1 }]);
    expect(JSON.parse(simulator.getFile('items/indices/value_1/c.json')!)).toEqual(['c']);
    expect(await store.findCandidates({ value: 'c' })).toMatchObject([{ _id: 'c' }]);
  });

  it('loads index metadata from every page', async () => {
    const { simulator, store, requests } = setup(2);
    for (const name of ['a_1', 'b_1', 'c_1']) {
      simulator.putObject(`items/indices/${name}.json`, JSON.stringify({ name, keys: [{ field: name[0], order: 1 }] }));
    }
    expect([...await store.getIndexes()].map(([name]) => name)).toEqual(['a_1', 'b_1', 'c_1']);
    expect(requests.filter(request => request.prefix === 'items/indices/').map(request => request.token))
      .toEqual([undefined, '2']);
  });

  it('collects all entry pages before deleting a dropped index', async () => {
    const { simulator, store, requests } = setup(2);
    simulator.putObject('items/indices/value_1.json', JSON.stringify({
      name: 'value_1', keys: [{ field: 'value', order: 1 }],
    }));
    for (const id of ['a', 'b', 'c']) simulator.putObject(`items/indices/value_1/${id}.json`, '[]');
    await store.dropIndex('value_1');
    expect(simulator.listObjects('items/indices/value_1/')).toEqual([]);
    expect(requests.filter(request => request.prefix === 'items/indices/value_1/').map(request => request.token))
      .toEqual([undefined, '2']);
  });

  it('rejects a truncated page without a continuation token', async () => {
    const { store } = setup(2);
    (store as any).s3.send = async (command: any) => {
      if (command instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: true };
      throw new Error('unexpected command');
    };
    await expect(store.findCandidates({})).rejects.toThrow(/continuation token/i);
  });

  it('rejects a repeated continuation token instead of looping forever', async () => {
    const { store } = setup(2);
    (store as any).s3.send = async () => ({
      Contents: [], IsTruncated: true, NextContinuationToken: 'same',
    });
    await expect(store.getIndexes()).rejects.toThrow(/continuation token/i);
  });

  it('rejects a listing entry without a key', async () => {
    const { store } = setup(2);
    (store as any).s3.send = async () => ({ Contents: [{}], IsTruncated: false });
    await expect(store.getIndexes()).rejects.toThrow(/without a key/i);
  });

  it('propagates failure on a later page rather than returning a partial scan', async () => {
    const { store } = setup(2);
    (store as any).s3.send = async (command: any) => {
      if (!(command instanceof ListObjectsV2Command)) throw new Error('unexpected command');
      if (command.input.Prefix === 'items/indices/') return { Contents: [], IsTruncated: false };
      if (!command.input.ContinuationToken) return { Contents: [{ Key: 'items/data/a.json' }], IsTruncated: true, NextContinuationToken: 'next' };
      throw new Error('listing failed');
    };
    await expect(store.findCandidates({})).rejects.toThrow('listing failed');
  });

  it('does not treat a bucket disappearing on a later page as an empty collection', async () => {
    const { store } = setup(2);
    (store as any).s3.send = async (command: any) => {
      if (command.input.Prefix === 'items/indices/') return { Contents: [], IsTruncated: false };
      if (!command.input.ContinuationToken) return { Contents: [], IsTruncated: true, NextContinuationToken: 'next' };
      throw Object.assign(new Error('missing bucket'), { name: 'NoSuchBucket' });
    };
    await expect(store.findCandidates({})).rejects.toThrow(/disappeared during a paginated listing/i);
  });

  it('does not delete index metadata if listing later entry pages fails', async () => {
    const { simulator, store } = setup(2);
    simulator.putObject('items/indices/value_1.json', JSON.stringify({
      name: 'value_1', keys: [{ field: 'value', order: 1 }],
    }));
    const send = (store as any).s3.send;
    (store as any).s3.send = async (command: any) => {
      if (command instanceof ListObjectsV2Command && command.input.Prefix === 'items/indices/value_1/') {
        if (!command.input.ContinuationToken) return { Contents: [], IsTruncated: true, NextContinuationToken: 'next' };
        throw new Error('listing failed');
      }
      return send(command);
    };
    await expect(store.dropIndex('value_1')).rejects.toThrow('listing failed');
    expect(simulator.getFile('items/indices/value_1.json')).toBeDefined();
  });
});
