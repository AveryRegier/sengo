import { beforeEach, describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';

describe('explain mode', () => {
  let client: SengoClient;
  let collection: SengoCollection<{ status: string; priority: number }>;

  beforeEach(async () => {
    client = new SengoClient();
    collection = client.db('memory').collection<{ status: string; priority: number }>('tasks');

    await collection.insertOne({ status: 'active', priority: 2 });
    await collection.insertOne({ status: 'active', priority: 5 });
    await collection.insertOne({ status: 'pending', priority: 1 });
    await collection.createIndex({ status: 1 });
  });

  it('captures explain stats for indexed find', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.command.type).toBe('find');
    expect(result.queryPlanner).toBeDefined();
    expect(result.executionStats).toBeDefined();
    expect(result.executionStats.stage).toBe('INDEX_LOOKUP');
    expect(result.executionStats.indexName).toBe('status_1');
    expect(result.executionStats.documentsLoaded).toBeGreaterThan(0);
    expect(Array.isArray(result.executionStats.expressionStats)).toBe(true);
  });

  it('captures explain stats for findOne', async () => {
    const result = await collection.findOne({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.command.type).toBe('findOne');
    expect(result.queryPlanner).toBeDefined();
    expect(result.executionStats).toBeDefined();
    expect(result.executionStats.stage).toBe('INDEX_LOOKUP');
    expect(result.executionStats.indexName).toBe('status_1');
    expect(result.result).toBeTruthy();
  });

  it('records index entry reads for indexed queries', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.indexEntriesLoaded).toBeGreaterThan(0);
    expect(result.executionStats.candidateIds).toBeGreaterThan(0);
    expect(result.executionStats.uniqueCandidateIds).toBeGreaterThan(0);
  });

  it('records cache activity for index file reads', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.cacheStats.indexes.length).toBeGreaterThan(0);
    const indexStats = result.executionStats.cacheStats.indexes[0];
    expect(indexStats.fileCacheHits + indexStats.fileCacheMisses).toBeGreaterThan(0);
  });

  it('records timing parts for query work', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.timing.parts.length).toBeGreaterThan(0);
    expect(result.executionStats.timing.parts.some((part: any) => part.part === 'cache' || part.part === 'documentLoad' || part.part === 'indexEntryRead')).toBe(true);
  });

  it('captures explain stats for insertOne', async () => {
    const result = await collection.insertOne({ status: 'queued', priority: 3 }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.command.type).toBe('insertOne');
    expect(result.writeStats).toBeDefined();
    expect(result.result).toMatchObject({ acknowledged: true });
    expect(result.writeStats.documentWrites).toBeGreaterThanOrEqual(1);
  });
});
