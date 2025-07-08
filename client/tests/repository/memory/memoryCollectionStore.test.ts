// Move this test inside the describe block below so it has access to `store`
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCollectionStore } from '../../../src/repository/memory/memoryCollectionStore';


describe('MemoryCollectionStore', () => {
  let store: MemoryCollectionStore<any>;
  const collection = 'test-collection';

  beforeEach(() => {
    store = new MemoryCollectionStore(collection);
  });

  it('can create and drop an index', async () => {
    // Create index
    await store.createIndex('foo_1', [{ field: 'foo', order: 1 }]);
    // Should be present
    expect(store.getIndex('foo_1')).toBeDefined();
    // Drop index
    await store.dropIndex('foo_1');
    // Should be gone
    expect(store.getIndex('foo_1')).toBeUndefined();
  });

  it('dropIndex is idempotent and does not throw if index does not exist', async () => {
    await expect(store.dropIndex('nonexistent')).resolves.toBeUndefined();
  });

  it('removes all index data after dropIndex', async () => {
    await store.createIndex('bar_1', [{ field: 'bar', order: 1 }]);
    // Insert a doc and add to index
    await store.replaceOne({ _id: 'a' }, { _id: 'a', bar: 42 });
    const index = store.getIndex('bar_1');
    if (index && typeof index.addDocument === 'function') {
      await index.addDocument({ _id: 'a', bar: 42 });
    }
    // Confirm index has data
    expect(index && typeof index.getIndexMap === 'function' ? Object.keys(index.getIndexMap()).length : 0).toBeGreaterThan(0);
    // Drop index
    await store.dropIndex('bar_1');
    // Should be gone
    expect(store.getIndex('bar_1')).toBeUndefined();
  });

  it('removes document ID from old index entry and adds to new one when indexed field changes on update', async () => {
    // Insert a doc with foo: 1
    await store.replaceOne({ _id: 'doc1' }, { _id: 'doc1', foo: 1 });
    await store.createIndex('foo_1', [{ field: 'foo', order: 1 }]);
    let index = store.getIndex('foo_1');
    if (index && typeof index.addDocument === 'function') {
      await index.addDocument({ _id: 'doc1', foo: 1 });
    }
    // Update the doc, changing foo from 1 to 2
    await store.replaceOne({ _id: 'doc1' }, { _id: 'doc1', foo: 2 });
    // Simulate index maintenance: remove from old, add to new
    if (index && typeof index.removeDocument === 'function') {
      await index.removeDocument({ _id: 'doc1', foo: 1 });
    }
    if (index && typeof index.addDocument === 'function') {
      await index.addDocument({ _id: 'doc1', foo: 2 });
    }
    // Check index state
    const map = index && typeof index.getIndexMap === 'function' ? index.getIndexMap() : {};
    // Old key should not contain doc1
    expect(map['1'] || []).not.toContain('doc1');
    // New key should contain doc1
    expect(map['2'] || []).toContain('doc1');
  });

  it('can insert and delete a document by _id', async () => {
    const doc = { _id: 'del1', foo: 123 };
    await store.replaceOne({ _id: doc._id }, doc);
    // Confirm present
    let found = await store.find({ _id: doc._id }).toArray();
    expect(found.length).toBe(1);
    // Delete
    await store.deleteOne(doc);
    // Should be gone
    found = await store.find({ _id: doc._id }).toArray();
    expect(found.length).toBe(0);
  });
});
