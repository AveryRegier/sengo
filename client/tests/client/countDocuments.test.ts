import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type TaskDoc = {
  status: string;
  priority: number;
};

describe('countDocuments', () => {
  let client: SengoClient;
  let collection: SengoCollection<TaskDoc>;

  beforeEach(async () => {
    client = new SengoClient();
    collection = client.db('memory').collection<TaskDoc>('tasks');

    await collection.insertOne({ status: 'active', priority: 2 });
    await collection.insertOne({ status: 'active', priority: 5 });
    await collection.insertOne({ status: 'pending', priority: 1 });
  });

  it('counts only documents matching the filter', async () => {
    // Arrange
    const filter = { status: 'active' };

    // Act
    const count = await collection.countDocuments(filter);

    // Assert
    expect(count).toBe(2);
  });

  it('returns total count for an empty filter', async () => {
    // Act
    const count = await collection.countDocuments({});

    // Assert
    expect(count).toBe(3);
  });

  it('returns total count when called without a filter', async () => {
    // Act
    const count = await collection.countDocuments();

    // Assert
    expect(count).toBe(3);
  });

  it('returns zero when no documents match the filter', async () => {
    // Arrange
    const filter = { status: 'done' };

    // Act
    const count = await collection.countDocuments(filter);

    // Assert
    expect(count).toBe(0);
  });

  it('applies skip before counting', async () => {
    // Arrange
    const filter = { status: 'active' };

    // Act
    const count = await collection.countDocuments(filter, { skip: 1 });

    // Assert
    expect(count).toBe(1);
  });

  it('applies limit after skip when both are set', async () => {
    // Arrange
    const filter = { status: { $in: ['active', 'pending'] } };

    // Act
    const count = await collection.countDocuments(filter, { skip: 1, limit: 1 });

    // Assert
    expect(count).toBe(1);
  });

  it('returns explain output when explain is requested', async () => {
    // Arrange
    await collection.createIndex({ status: 1 });

    // Act
    const explain = await collection.countDocuments(
      { status: 'active' },
      { explain: 'executionStats' },
    ) as any;

    // Assert
    expect(explain.ok).toBe(1);
    expect(explain.command.type).toBe('countDocuments');
    expect(explain.queryPlanner).toBeDefined();
    expect(explain.executionStats).toBeDefined();
    expect(explain.result).toBe(2);
  });
});

describe('countDocuments S3 optimization', () => {
  let client: SengoClient;
  let collection: SengoCollection<TaskDoc>;
  let s3sim: S3BucketSimulator;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    sendMock = vi.fn(async (cmd: any) => {
      return s3sim.handleCommand(cmd);
    });

    client = new SengoClient();
    collection = client.db('s3').collection<TaskDoc>('tasks');
    (collection.store as any).s3 = { send: sendMock };

    await collection.insertOne({ status: 'active', priority: 2 });
    await collection.insertOne({ status: 'active', priority: 5 });
    await collection.insertOne({ status: 'pending', priority: 1 });
    await collection.createIndex({ status: 1 });

    s3sim.clearLogs();
    sendMock.mockClear();
  });

  it('counts from index keys without loading documents when filter is fully index-resolvable', async () => {
    // Act
    const count = await collection.countDocuments({ status: 'active' });

    // Assert
    expect(count).toBe(2);

    const logs = s3sim.getLogs();
    const dataFileReads = logs.filter(log => log.key.includes('/data/'));
    expect(dataFileReads.length).toBe(0);

    const indexReads = logs.filter(log => log.key.includes('/indices/status_1/active.json'));
    expect(indexReads.length).toBeGreaterThan(0);

    const dataPrefixLists = sendMock.mock.calls.filter(([cmd]: any[]) => {
      return cmd?.constructor?.name === 'ListObjectsV2Command' && cmd?.input?.Prefix === 'tasks/data/';
    });
    expect(dataPrefixLists.length).toBe(0);
  });

  it('reports documentsLoaded: 0 in executionStats for index-only count explain', async () => {
    // Act
    const explain = await collection.countDocuments(
      { status: 'active' },
      { explain: 'executionStats' },
    ) as any;

    // Assert
    expect(explain.ok).toBe(1);
    expect(explain.command.type).toBe('countDocuments');
    expect(explain.executionStats).toBeDefined();
    expect(explain.executionStats.stage).toBe('INDEX_LOOKUP');
    expect(explain.executionStats.documentsLoaded).toBe(0);
    expect(explain.result).toBe(2);
  });

  it('falls back to loading candidate documents when query includes fields outside the selected index', async () => {
    // Act
    const count = await collection.countDocuments({
      status: 'active',
      priority: { $gt: 2 },
    });

    // Assert
    expect(count).toBe(1);

    const logs = s3sim.getLogs();
    const dataFileReads = logs.filter(log => log.key.includes('/data/'));
    expect(dataFileReads.length).toBeGreaterThan(0);
  });
});
