import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { WithId } from '../../src/types';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type Task = {
  name: string;
  category: string;
  priority: number;
  status: string;
  createdAt?: number;
};

describe('Index optimization: limit and comparison operators (S3)', () => {
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };
  let client: SengoClient;
  let collection: SengoCollection<Task>;
  let docs: WithId<Task>[];

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    client = new SengoClient();
    collection = client.db('s3').collection<Task>('tasks');
    (collection.store as any).s3 = s3Client;
    
    // Insert test documents
    const tasks = [
      { name: 'Task 1', category: 'work', priority: 10, status: 'active' },
      { name: 'Task 2', category: 'work', priority: 20, status: 'active' },
      { name: 'Task 3', category: 'work', priority: 30, status: 'completed' },
      { name: 'Task 4', category: 'work', priority: 40, status: 'active' },
      { name: 'Task 5', category: 'work', priority: 50, status: 'completed' },
      { name: 'Task 6', category: 'personal', priority: 15, status: 'active' },
      { name: 'Task 7', category: 'personal', priority: 25, status: 'pending' },
      { name: 'Task 8', category: 'personal', priority: 35, status: 'active' },
    ];
    
    docs = [];
    for (const task of tasks) {
      const result = await collection.insertOne(task);
      docs.push({ ...task, _id: result.insertedId });
    }
    
    // Create compound index on category and priority
    await collection.createIndex({ category: 1, priority: 1 });
  });

  afterEach(async () => {
    await client.close();
  });

  describe('$gt operator with limit optimization', () => {
    it('should load only limited documents when using $gt with matching sort', async () => {
      s3sim.clearLogs();
      
      // Query: Find work tasks with priority > 20, sorted by priority, limit 2
      const found = await collection.find({
        category: 'work',
        priority: { $gt: 20 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(30);
      expect(found[1].priority).toBe(40);
      expect(found[0].name).toBe('Task 3');
      expect(found[1].name).toBe('Task 4');
      
      // Verify only 2 documents were fetched (plus 1 index access)
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2); // Only loaded 2 documents
    });

    it('should handle $gt at boundary correctly', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $gt: 30 }
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found.map(d => d.priority).sort((a, b) => a - b)).toEqual([40, 50]);
    });
  });

  describe('$gte operator with limit optimization', () => {
    it('should load only limited documents when using $gte with matching sort', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $gte: 30 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(30);
      expect(found[1].priority).toBe(40);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });

    it('should include boundary value with $gte', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $gte: 30 }
      }).toArray();
      
      expect(found.length).toBe(3);
      expect(found.map(d => d.priority).sort((a, b) => a - b)).toEqual([30, 40, 50]);
    });
  });

  describe('$lt operator with limit optimization', () => {
    it('should load only limited documents when using $lt with matching sort', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $lt: 40 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(10);
      expect(found[1].priority).toBe(20);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });

    it('should exclude boundary value with $lt', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $lt: 30 }
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found.map(d => d.priority).sort((a, b) => a - b)).toEqual([10, 20]);
    });
  });

  describe('$lte operator with limit optimization', () => {
    it('should load only limited documents when using $lte with matching sort', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $lte: 30 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(10);
      expect(found[1].priority).toBe(20);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });

    it('should include boundary value with $lte', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $lte: 30 }
      }).toArray();
      
      expect(found.length).toBe(3);
      expect(found.map(d => d.priority).sort((a, b) => a - b)).toEqual([10, 20, 30]);
    });
  });

  describe('$eq operator optimization', () => {
    it('should filter by exact value with limit', async () => {
      s3sim.clearLogs();
      
      // Add more documents with priority 20
      await collection.insertOne({ name: 'Task 9', category: 'work', priority: 20, status: 'active' });
      await collection.insertOne({ name: 'Task 10', category: 'work', priority: 20, status: 'pending' });
      
      const found = await collection.find({
        category: 'work',
        priority: { $eq: 20 }
      }, {
        limit: 1
      }).toArray();
      
      expect(found.length).toBe(1);
      expect(found[0].priority).toBe(20);
      
      // Should load only 1 document due to limit
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(1);
    });
  });

  describe('$ne operator optimization', () => {
    it('should exclude specific value with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $ne: 20 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(10);
      expect(found[1].priority).toBe(30);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });
  });

  describe('$in operator optimization', () => {
    it('should filter by value array with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $in: [20, 40] }
      }, {
        sort: { priority: 1 },
        limit: 1
      }).toArray();
      
      expect(found.length).toBe(1);
      expect(found[0].priority).toBe(20);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(1);
    });

    it('should match multiple values with $in', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $in: [10, 30, 50] }
      }).toArray();
      
      expect(found.length).toBe(3);
      expect(found.map(d => d.priority).sort((a, b) => a - b)).toEqual([10, 30, 50]);
    });
  });

  describe('$nin operator optimization', () => {
    it('should exclude values in array with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $nin: [20, 30, 50] }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(10);
      expect(found[1].priority).toBe(40);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });
  });

  describe('Range queries with multiple operators', () => {
    it('should handle range query (gte + lte) with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $gte: 20, $lte: 40 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(20);
      expect(found[1].priority).toBe(30);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });

    it('should handle range query (gt + lt) with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work',
        priority: { $gt: 20, $lt: 50 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(30);
      expect(found[1].priority).toBe(40);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });
  });

  describe('Personal category queries', () => {
    it('should correctly filter personal category with $gte and limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'personal',
        priority: { $gte: 20 }
      }, {
        sort: { priority: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      expect(found[0].priority).toBe(25);
      expect(found[1].priority).toBe(35);
      expect(found[0].name).toBe('Task 7');
      expect(found[1].name).toBe('Task 8');
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });
  });

  describe('Sort by _id optimization', () => {
    it('should optimize sorting by _id with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work'
      }, {
        sort: { _id: 1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      // Should be sorted by _id
      expect(found[0]._id.toString() < found[1]._id.toString()).toBe(true);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });

    it('should optimize sorting by _id descending with limit', async () => {
      s3sim.clearLogs();
      
      const found = await collection.find({
        category: 'work'
      }, {
        sort: { _id: -1 },
        limit: 2
      }).toArray();
      
      expect(found.length).toBe(2);
      // Should be sorted by _id descending
      expect(found[0]._id.toString() > found[1]._id.toString()).toBe(true);
      
      const logs = s3sim.getLogs();
      const documentGets = logs.filter(log => log.command === 'getObject' && log.key.includes('/data/'));
      expect(documentGets.length).toBe(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty result set with operators', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $gt: 100 }
      }).toArray();
      
      expect(found.length).toBe(0);
    });

    it('should handle limit larger than result set', async () => {
      const found = await collection.find({
        category: 'work',
        priority: { $gte: 40 }
      }, {
        limit: 100
      }).toArray();
      
      expect(found.length).toBe(2); // Only 2 match the criteria
    });

    it('should handle limit of 0', async () => {
      const found = await collection.find({
        category: 'work'
      }, {
        limit: 0
      }).toArray();
      
      expect(found.length).toBe(5); // All work tasks (limit 0 means no limit)
    });
  });
});

describe('Most recent entry optimization (standalone)', () => {
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };
  let client: SengoClient;

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    client = new SengoClient();
  });

  afterEach(async () => {
    await client.close();
  });

  it('should fetch only the most recent document for a person using compound index', async () => {
    // Create a new collection for person activity logs
    const activityCollection = client.db('s3').collection<{
      personId: string;
      activity: string;
      timestamp: number;
    }>('activity_logs');
    (activityCollection.store as any).s3 = s3Client;

    // Insert multiple activities for the same person
    await activityCollection.insertOne({ personId: 'alice', activity: 'logged in', timestamp: 1000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'viewed profile', timestamp: 2000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'updated settings', timestamp: 3000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'logged out', timestamp: 4000 });
    await activityCollection.insertOne({ personId: 'bob', activity: 'logged in', timestamp: 1500 });
    await activityCollection.insertOne({ personId: 'bob', activity: 'sent message', timestamp: 2500 });

    // Create compound index: personId (key) + timestamp (sort within entry)
    await activityCollection.createIndex([{ personId: 1 }, { timestamp: -1 }]);

    s3sim.clearLogs();

    // Query: Find the most recent activity for Alice
    const found = await activityCollection.find({
      personId: 'alice'
    }, {
      sort: { timestamp: -1 },
      limit: 1
    }).toArray();

    // Verify we got the correct most recent entry
    expect(found.length).toBe(1);
    expect(found[0].personId).toBe('alice');
    expect(found[0].activity).toBe('logged out');
    expect(found[0].timestamp).toBe(4000);

    // Verify only 1 document was fetched from S3
    const logs = s3sim.getLogs();
    const documentFetches = logs.filter(log => 
      log.command === 'getObject' && log.key.includes('/data/')
    );
    
    expect(documentFetches.length).toBe(1);
  });

  it('should fetch only the most recent N documents efficiently with limit > 1', async () => {
    // Create a new collection for person activity logs
    const activityCollection = client.db('s3').collection<{
      personId: string;
      activity: string;
      timestamp: number;
    }>('activity_logs2');
    (activityCollection.store as any).s3 = s3Client;

    // Insert multiple activities for the same person
    await activityCollection.insertOne({ personId: 'alice', activity: 'login 1', timestamp: 1000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'action 1', timestamp: 2000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'action 2', timestamp: 3000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'action 3', timestamp: 4000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'action 4', timestamp: 5000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'action 5', timestamp: 6000 });
    await activityCollection.insertOne({ personId: 'alice', activity: 'logout 1', timestamp: 7000 });

    // Create compound index: personId (key) + timestamp (sort within entry)
    await activityCollection.createIndex([{ personId: 1 }, { timestamp: -1 }]);

    s3sim.clearLogs();

    // Query: Find the 3 most recent activities for Alice
    const found = await activityCollection.find({
      personId: 'alice'
    }, {
      sort: { timestamp: -1 },
      limit: 3
    }).toArray();

    // Verify we got the correct 3 most recent entries
    expect(found.length).toBe(3);
    expect(found[0].timestamp).toBe(7000);
    expect(found[1].timestamp).toBe(6000);
    expect(found[2].timestamp).toBe(5000);

    // Verify only 3 documents were fetched from S3 (not all 7)
    const logs = s3sim.getLogs();
    const documentFetches = logs.filter(log => 
      log.command === 'getObject' && log.key.includes('/data/')
    );
    
    expect(documentFetches.length).toBe(3);
  });
});
