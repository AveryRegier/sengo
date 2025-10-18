import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import Chance from 'chance';
import { WithId } from '../../src/types';
import { S3 } from '@aws-sdk/client-s3';
import { S3CollectionStore } from '../../src/repository';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

const chance = new Chance();

type TestDoc = {
  name: string;
  age: number;
  email: string;
};

describe('SengoCollection $or operator support', () => {
  // Similar setup as in find-in.test.ts
  // Use Chance to generate random data and S3BucketSimulator for S3 interactions
  // Insert documents into the collection
   let client: SengoClient;
   let collection: SengoCollection<TestDoc>;
   let docs: WithId<TestDoc>[];
   let s3sim: S3BucketSimulator;
   let s3Client: { send: (cmd: any) => any };
 
   beforeEach(async () => {
     s3sim = new S3BucketSimulator();
     s3Client = { send: s3sim.handleCommand.bind(s3sim) };
     client = new SengoClient();
     collection = client.db('s3').collection<TestDoc>('people');
     (collection.store as any).s3 = s3Client;
       // Mock S3 send method to simulate S3 behavior
     // Insert random documents
     docs = [];
     for (let i = 0; i < 10; i++) {
       const doc = {
         name: chance.name(),
         age: chance.age(),
         email: chance.email(),
       };
       const result = await collection.insertOne(doc);
       docs.push({ ...doc, _id: result.insertedId });
     }
   });
 
   it('finds documents using $or operator', async () => {
        const conditions = docs.slice(0, 3).map(d => ({ name: d.name }));
        const found = await collection.find({ $or: conditions }).toArray();
        expect(found.length).toBe(3);
        expect(found.map(d => d.name).sort()).toEqual(conditions.map(c => c.name).sort());
    });

    it('finds documents using $or operator after creating an index', async () => {
        const indexName = await collection.createIndex({ name: 1 });
        s3sim.clearAccessLog();
        const conditions = docs.slice(0, 3).map(d => ({ name: d.name }));
        const found = await collection.find({ $or: conditions }).toArray();
        expect(found.length).toBe(3);
        expect(found.map(d => d.name).sort()).toEqual(conditions.map(c => c.name).sort());
        expect(s3sim.getIndexAccessLog().filter(log => log.indexOf(indexName) !== -1).length).toBe(3);
    });

});