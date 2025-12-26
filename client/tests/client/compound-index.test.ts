import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';
import type { WithId } from '../../src/types';

interface Task extends WithId<{}> {
  name: string;
  category: string;
  priority: number;
  status: string;
}

describe('SengoCollection with compound index', () => {
  let client: SengoClient;
  let collection: SengoCollection<Task>;
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    client = new SengoClient();
    collection = client.db('s3').collection<Task>('tasks');
    (collection.store as any).s3 = s3Client;

    // Insert test documents
    await collection.insertOne({ name: 'Task 1', category: 'work', priority: 1, status: 'active' });
    await collection.insertOne({ name: 'Task 2', category: 'work', priority: 2, status: 'active' });
    await collection.insertOne({ name: 'Task 3', category: 'work', priority: 3, status: 'completed' });
    await collection.insertOne({ name: 'Task 4', category: 'personal', priority: 1, status: 'active' });
    await collection.insertOne({ name: 'Task 5', category: 'personal', priority: 2, status: 'active' });
    await collection.insertOne({ name: 'Task 6', category: 'personal', priority: 3, status: 'pending' });
    await collection.insertOne({ name: 'Task 7', category: 'shopping', priority: 1, status: 'active' });
    await collection.insertOne({ name: 'Task 8', category: 'shopping', priority: 2, status: 'completed' });

    // Create compound index: category (string) + priority (number)
    await collection.createIndex({ category: 1, priority: 1 });
    // await collection.createIndex({ category: 1 });
    // await collection.createIndex({ priority: 1 });
    
    s3sim.clearLogs();
  });

  it('finds documents using compound index and only loads matching documents', async () => {
    // Query for work tasks with priority 2
    const results = await collection.find({ category: 'work', priority: 2 }).toArray();

    // Validate correct result
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Task 2');
    expect(results[0].category).toBe('work');
    expect(results[0].priority).toBe(2);

    // Validate only necessary documents were loaded
    const logs = s3sim.getLogs();
    const indexAccesses = logs.filter(log => log.command === 'headObject' && log.key.includes('/indices/'));
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should use the compound index
    expect(indexAccesses.length).toBeGreaterThan(0);
    expect(indexAccesses.some(log => log.key.includes('category_1_priority_1'))).toBe(true);

    // Should only load 1 document from S3
    expect(documentGets.length).toBe(1);
  });

  it('finds multiple documents using compound index with same category', async () => {
    // Query for all personal tasks (multiple priorities)
    const results = await collection.find({ category: 'personal' }).toArray();

    // Validate correct results
    expect(results).toHaveLength(3);
    expect(results.every(doc => doc.category === 'personal')).toBe(true);
    expect(results.map(doc => doc.name).sort()).toEqual(['Task 4', 'Task 5', 'Task 6']);

    // Validate only necessary documents were loaded
    const logs = s3sim.getLogs();
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should only load 3 documents from S3 (the matching ones)
    expect(documentGets.length).toBe(3);
  });

  it('findOne uses compound index and only loads one document', async () => {
    // Query for specific work task with priority 1
    const result = await collection.findOne({ category: 'work', priority: 1 });

    // Validate correct result
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Task 1');
    expect(result!.category).toBe('work');
    expect(result!.priority).toBe(1);

    // Validate only one document was loaded
    const logs = s3sim.getLogs();
    const indexAccesses = logs.filter(log => log.command === 'headObject' && log.key.includes('/indices/'));
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should use the compound index
    expect(indexAccesses.length).toBeGreaterThan(0);
    expect(indexAccesses.some(log => log.key.includes('category_1_priority_1'))).toBe(true);

    // Should only load 1 document from S3
    expect(documentGets.length).toBe(1);
  });

  it('findOne returns null when no document matches compound index query', async () => {
    // Query for non-existent combination
    const result = await collection.findOne({ category: 'work', priority: 99 });

    // Validate null result
    expect(result).toBeNull();

    // Validate no documents were loaded (only index was checked)
    const logs = s3sim.getLogs();
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should not load any documents from S3
    expect(documentGets.length).toBe(0);
  });

  it('finds documents with compound index using only first field', async () => {
    // Query using only category (prefix of compound index)
    const results = await collection.find({ category: 'shopping' }).toArray();

    // Validate correct results
    expect(results).toHaveLength(2);
    expect(results.every(doc => doc.category === 'shopping')).toBe(true);
    expect(results.map(doc => doc.name).sort()).toEqual(['Task 7', 'Task 8']);

    // Validate only necessary documents were loaded
    const logs = s3sim.getLogs();
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should only load 2 documents from S3
    expect(documentGets.length).toBe(2);
  });

  it('finds documents with compound index and exact match on both fields', async () => {
    // Query for exact match on both fields
    const results = await collection.find({ category: 'personal', priority: 3 }).toArray();

    // Validate correct result
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Task 6');
    expect(results[0].category).toBe('personal');
    expect(results[0].priority).toBe(3);

    // Validate only one document was loaded
    const logs = s3sim.getLogs();
    const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));

    // Should only load 1 document from S3
    expect(documentGets.length).toBe(1);
  });
});
