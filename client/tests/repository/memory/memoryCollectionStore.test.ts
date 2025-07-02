import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCollectionStore } from '../../../src/repository/memory/memoryCollectionStore';


describe('MemoryCollectionStore', () => {
  let store: MemoryCollectionStore;
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
});
