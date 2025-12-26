import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import Chance from 'chance';
import { WithId } from '../../src/types';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type TestDoc = {
  name: string;
  status: string;
  priority: number;
};

describe('SengoCollection with limit', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;
  let docs: WithId<TestDoc>[];
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    client = new SengoClient();
    collection = client.db('s3').collection<TestDoc>('tasks');
    (collection.store as any).s3 = s3Client;

    // Insert documents with predictable statuses
    docs = [];
    const statuses = ['active', 'active', 'active', 'active', 'active', 'pending', 'pending', 'completed', 'completed', 'completed'];
    for (let i = 0; i < 10; i++) {
      const doc = {
        name: `Task ${i + 1}`,
        status: statuses[i],
        priority: chance.integer({ min: 1, max: 10 })
      };
      const result = await collection.insertOne(doc);
      docs.push({ ...doc, _id: result.insertedId });
    }

    // Create index on status field
    await collection.createIndex({ status: 1 });
    
    // Clear S3 simulator logs to track only the find operation
    s3sim.clearLogs();
  });

  it('finds documents with limit and only loads necessary documents', async () => {
    const limit = 3;
    
    // Find active tasks with limit
    const found = await collection.find({ status: 'active' }, { limit }).toArray();
    
    // Validate result count
    expect(found.length).toBe(limit);
    
    // Validate all results have correct status
    expect(found.every(doc => doc.status === 'active')).toBe(true);
    
    // Get S3 logs to verify what was loaded
    const logs = s3sim.getLogs();
    
    // Count getObject calls for documents (not index files)
    const documentGets = logs.filter(log => 
      log.command === 'getObject' && 
      log.key.includes('/data/') &&
      !log.key.includes('/indices/')
    );
    
    // Should only load exactly 'limit' documents, not all 5 active documents
    expect(documentGets.length).toBe(limit);
    
    // Count head calls for index lookup
    const indexHeadCalls = logs.filter(log => 
      log.command === 'headObject' && 
      log.key.includes('/indices/status_1/active.json')
    );
    
    // Should have checked the index
    expect(indexHeadCalls.length).toBeGreaterThan(0);
  });

  it('finds documents with limit larger than result set', async () => {
    const limit = 10;
    
    // Find pending tasks (only 2 exist)
    const found = await collection.find({ status: 'pending' }, { limit }).toArray();
    
    // Should return all matching documents (2), not the limit (10)
    expect(found.length).toBe(2);
    expect(found.every(doc => doc.status === 'pending')).toBe(true);
    
    // Get S3 logs
    const logs = s3sim.getLogs();
    
    // Should only load the 2 documents that match
    const documentGets = logs.filter(log => 
      log.command === 'getObject' && 
      log.key.includes('/data/')
    );
    expect(documentGets.length).toBe(2);
  });

  it('finds documents with limit = 1', async () => {
    const limit = 1;
    
    // Find completed tasks with limit 1
    const found = await collection.find({ status: 'completed' }, { limit }).toArray();
    
    // Should return exactly 1 document
    expect(found.length).toBe(limit);
    expect(found[0].status).toBe('completed');
    
    // Get S3 logs
    const logs = s3sim.getLogs();
    
    // Should only load 1 document
    const documentGets = logs.filter(log => 
      log.command === 'getObject' && 
      log.key.includes('/data/')
    );
    expect(documentGets.length).toBe(1);
  });

  it('uses index efficiently with limit on query with multiple matches', async () => {
    const limit = 2;
    
    // Clear logs before the query
    s3sim.clearLogs();
    
    // Find active tasks (5 exist) with limit 2
    const found = await collection.find({ status: 'active' }, { limit }).toArray();
    
    expect(found.length).toBe(limit);
    
    const logs = s3sim.getLogs();
    
    // Verify index was used (head or getObject for index file)
    const indexAccess = logs.filter(log => 
      log.key.includes('/indices/status_1/')
    );
    expect(indexAccess.length).toBeGreaterThan(0);
    
    // Verify only 2 documents were loaded, not all 5
    const documentGets = logs.filter(log => 
      log.command === 'getObject' && 
      log.key.includes('/data/')
    );
    expect(documentGets.length).toBe(limit);
  });
});
