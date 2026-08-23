import { beforeEach, describe, expect, it } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';

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
