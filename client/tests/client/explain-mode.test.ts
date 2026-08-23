import { beforeEach, describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { createExplainSink } from '../../src/client/explain';

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

  it('reports exact per-index read costs for the winning index', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.indexReadStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexName: 'status_1',
          entryFilesRead: expect.any(Number),
          candidateIds: expect.any(Number),
          uniqueCandidateIds: expect.any(Number),
        }),
      ]),
    );
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

  it('reports the winning plan for indexed queries', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'queryPlanner' }) as any;

    expect(result.ok).toBe(1);
    expect(result.queryPlanner).toBeDefined();
    expect(result.queryPlanner.winningPlan.stage).toBe('INDEX_LOOKUP');
    expect(result.queryPlanner.winningPlan.indexName).toBe('status_1');
  });

  it('records rejected index reason codes in allPlansExecution explain output', async () => {
    const result = await collection.find({ priority: 7 }, { explain: 'allPlansExecution' }) as any;

    expect(result.ok).toBe(1);
    expect(result.queryPlanner).toBeDefined();
    expect(result.queryPlanner.winningPlan.stage).toBe('COLLECTION_SCAN');
    expect(result.queryPlanner.rejectedPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexName: 'status_1',
          reason: 'noUsableIndexKeysFromQuery',
          note: 'index cannot satisfy query',
        }),
      ]),
    );
  });

  it('reports unsupported operators explicitly in expressionStats', async () => {
    const result = await collection.find({ status: { $regex: '^a' } }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.expressionStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'status',
          operator: '$regex',
          implemented: false,
          appliedAt: 'notApplied',
        }),
      ]),
    );
  });

  it('reports unsupported operators alongside implemented predicates in the same query', async () => {
    await collection.createIndex({ priority: 1 });

    const result = await collection.find({
      status: { $regex: '^a' },
      priority: { $gt: 1 },
    }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.expressionStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'status',
          operator: '$regex',
          implemented: false,
          appliedAt: 'notApplied',
        }),
        expect.objectContaining({
          field: 'priority',
          operator: '$gt',
          implemented: true,
          appliedAt: expect.stringMatching(/^(index|postLoad)$/),
        }),
      ]),
    );
  });

  it('marks expression placement as index when the predicate is served by an index', async () => {
    const result = await collection.find({ status: 'active' }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.expressionStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'status',
          operator: '$eq',
          implemented: true,
          appliedAt: 'index',
        }),
      ]),
    );
  });

  it('marks expression placement as postLoad when no matching index exists', async () => {
    const result = await collection.find({ priority: 7 }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.expressionStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'priority',
          operator: '$eq',
          implemented: true,
          appliedAt: 'postLoad',
        }),
      ]),
    );
  });

  it('reports sort/limit optimization effect when the index can satisfy ordering', async () => {
    const result = await collection.find({ status: 'active' }, { sort: { status: 1 }, limit: 1, explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.stage).toBe('INDEX_LOOKUP');
    expect(result.executionStats.sortAppliedAfterLoad).toBe(true);
    expect(result.executionStats.limitAppliedAfterLoad).toBe(true);
    expect(result.executionStats.indexSortLimitOptimization.used).toBe(true);
    expect(result.executionStats.indexSortLimitOptimization.reason).toBe('limit served by index ordering');
    expect(result.executionStats.documentsLoaded).toBeGreaterThan(0);
    expect(result.executionStats.documentsLoaded).toBeLessThanOrEqual(2);
  });

  it('reports a collection scan when no usable index exists', async () => {
    const result = await collection.find({ priority: 7 }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.executionStats.stage).toBe('COLLECTION_SCAN');
    expect(result.executionStats.indexName).toBeUndefined();
    expect(result.executionStats.scanReason).toBe('No usable index for query');
  });

  it('captures explain stats for insertOne', async () => {
    const result = await collection.insertOne({ status: 'queued', priority: 3 }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.command.type).toBe('insertOne');
    expect(result.writeStats).toBeDefined();
    expect(result.result).toMatchObject({ acknowledged: true });
    expect(result.writeStats.documentWrites).toBeGreaterThanOrEqual(1);
  });

  it('records write cost per updated index file', async () => {
    await collection.createIndex({ priority: 1 });

    const result = await collection.insertOne({ status: 'queued', priority: 3 }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.writeStats.documentWrites).toBe(1);
    expect(result.writeStats.indexEntryUpdatesCount).toBe(2);
    expect(result.writeStats.indexEntryFilesUpdated).toEqual(expect.arrayContaining(['status_1', 'priority_1']));
  });

  it('tracks exact per-index file updates across multiple indexes', async () => {
    await collection.createIndex({ priority: 1 });

    const result = await collection.updateOne({ status: 'active' }, { $set: { priority: 9 } }, { explain: 'executionStats' }) as any;

    expect(result.ok).toBe(1);
    expect(result.writeStats.indexEntryFilesUpdated).toEqual(expect.arrayContaining(['status_1', 'priority_1']));
    expect(result.writeStats.indexEntryUpdatesCount).toBeGreaterThanOrEqual(2);
  });

  it('aggregates cache hit, miss, and stale events for collection and index scopes', () => {
    const sink = createExplainSink({
      opType: 'find',
      namespace: 'tasks',
      verbosity: 'executionStats',
      hasSort: false,
      hasLimit: false,
      collectionName: 'tasks',
    });

    sink.onCacheEvent('collection', 'tasks', undefined, 'file', 'miss');
    sink.onCacheEvent('collection', 'tasks', undefined, 'file', 'hit');
    sink.onCacheEvent('collection', 'tasks', undefined, 'file', 'stale');
    sink.onCacheEvent('index', 'tasks', 'status_1', 'file', 'miss');
    sink.onCacheEvent('index', 'tasks', 'status_1', 'file', 'hit');
    sink.onCacheEvent('index', 'tasks', 'status_1', 'file', 'stale');
    sink.onOpEnd(true, 10);

    const result = sink.finalize({ ok: 1 }) as any;

    expect(result.executionStats.cacheStats.collection).toMatchObject({
      name: 'tasks',
      fileCacheHits: 1,
      fileCacheMisses: 1,
      fileCacheHitRate: 0.5,
    });
    expect(result.executionStats.cacheStats.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexName: 'status_1',
          fileCacheHits: 1,
          fileCacheMisses: 1,
          fileCacheHitRate: 0.5,
        }),
      ]),
    );
  });
});
