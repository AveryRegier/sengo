import { describe, it, expect } from 'vitest';
import { MemoryCollectionStore } from '../../../src/repository/memory/memoryCollectionStore';
import { SengoCollection } from '../../../src/client/collection';

describe('MemoryCollectionStore index cleanup on delete', () => {
  it('removes deleted document from query results after delete, regardless of index', async () => {
    const store = new MemoryCollectionStore('test-coll');
    const collection = new SengoCollection('test-coll', store);
    // Insert two docs with the same indexed field
    const docA = { _id: 'a', name: 'Clancy' };
    const docB = { _id: 'b', name: 'Clancy', role: 'pet' };
    await collection.insertOne(docA);
    await collection.insertOne(docB);
    // Create an index on 'name'
    const indexName = await collection.createIndex({ name: 1 });
    // Delete one doc
    await collection.deleteOne({ _id: 'a' });
    // Confirm find does not return the deleted doc
    const found = await collection.find({ name: 'Clancy' }).toArray();
    expect(found.map(d => d._id)).toEqual(['b']);

    // Drop the index and verify it is removed from the store
    await collection.dropIndex(indexName);
    expect(store.getIndex(indexName)).toBeUndefined();
  });
});
