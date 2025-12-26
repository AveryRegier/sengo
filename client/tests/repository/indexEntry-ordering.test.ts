import { describe, it, expect } from 'vitest';
import { IndexEntry } from '../../src/repository/collectionIndex';

describe('IndexEntry ordering by secondary key', () => {
  it('should maintain insertion order when no secondary key order is specified', () => {
    const entry = new IndexEntry([]);
    entry.add('id1');
    entry.add('id2');
    entry.add('id3');
    
    const result = entry.toArray();
    expect(result).toEqual(['id1', 'id2', 'id3']);
  });

  it('should sort ids by secondary key value in ascending order (order: 1)', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 30);
    entry.add('id2', 10);
    entry.add('id3', 20);
    
    const result = entry.toArray();
    expect(result).toEqual(['id2', 'id3', 'id1']); // sorted by values: 10, 20, 30
  });

  it('should sort ids by secondary key value in descending order (order: -1)', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: -1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 30);
    entry.add('id2', 10);
    entry.add('id3', 20);
    
    const result = entry.toArray();
    expect(result).toEqual(['id1', 'id3', 'id2']); // sorted by values: 30, 20, 10
  });

  it('should handle string sort values', () => {
    const keys = [{ field: 'status', order: 1 as 1 | -1 }, { field: 'name', order: 1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 'charlie');
    entry.add('id2', 'alice');
    entry.add('id3', 'bob');
    
    const result = entry.toArray();
    expect(result).toEqual(['id2', 'id3', 'id1']); // sorted: alice, bob, charlie
  });

  it('should handle string sort values in descending order', () => {
    const keys = [{ field: 'status', order: 1 as 1 | -1 }, { field: 'name', order: -1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 'charlie');
    entry.add('id2', 'alice');
    entry.add('id3', 'bob');
    
    const result = entry.toArray();
    expect(result).toEqual(['id1', 'id3', 'id2']); // sorted: charlie, bob, alice
  });

  it('should place ids with undefined sort values at the end', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 20);
    entry.add('id2'); // no sort value
    entry.add('id3', 10);
    
    const result = entry.toArray();
    expect(result).toEqual(['id3', 'id1', 'id2']); // 10, 20, undefined
  });

  it('should serialize and deserialize with sort values', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: -1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 30);
    entry.add('id2', 10);
    entry.add('id3', 20);
    
    const serialized = entry.serialize();
    const deserialized = new IndexEntry(keys, serialized);
    
    expect(deserialized.toArray()).toEqual(['id1', 'id3', 'id2']); // sorted: 30, 20, 10
  });

  it('should handle old format (array of strings) when deserializing', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
    const oldFormat = JSON.stringify(['id1', 'id2', 'id3']);
    const entry = new IndexEntry(keys, oldFormat);
    
    const result = entry.toArray();
    expect(result).toEqual(['id1', 'id2', 'id3']);
  });

  it('should handle new format (array of tuples) when deserializing', () => {
    // When deserializing, we trust the order from storage (already sorted)
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
    const newFormat = JSON.stringify([['id2', 10], ['id3', 20], ['id1', 30]]);
    const entry = new IndexEntry(keys, newFormat);
    
    const result = entry.toArray();
    expect(result).toEqual(['id2', 'id3', 'id1']); // order from storage (already sorted by values: 10, 20, 30)
  });

  it('should remove ids and their sort values correctly', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 30);
    entry.add('id2', 10);
    entry.add('id3', 20);
    
    entry.remove('id2');
    
    const result = entry.toArray();
    expect(result).toEqual(['id3', 'id1']); // sorted: 20, 30 (id2 removed)
  });

  it('should update with new data while preserving added/removed changes', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: -1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 10);
    entry.add('id2', 20);
    
    // Simulate fetching fresh data from server (already sorted in descending order)
    const freshData = JSON.stringify([['id4', 40], ['id3', 30]]);
    entry.update(freshData);
    
    // Should have id1, id2 (local adds inserted in sorted position) + id3, id4 (from fresh data)
    const result = entry.toArray();
    expect(result).toEqual(['id4', 'id3', 'id2', 'id1']); // sorted: 40, 30, 20, 10
  });

  it('should handle removed ids during update', () => {
    const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: -1 as 1 | -1 }];
    const entry = new IndexEntry(keys);
    entry.add('id1', 10);
    entry.add('id2', 20);
    entry.remove('id1');
    
    // Simulate fetching fresh data from server (already sorted in descending order)
    const freshData = JSON.stringify([['id4', 40], ['id3', 30]]);
    entry.update(freshData);
    
    // Should have id2 (local add inserted in sorted position) + id3, id4 (from fresh data), but NOT id1 (removed)
    const result = entry.toArray();
    expect(result).toEqual(['id4', 'id3', 'id2']); // sorted: 40, 30, 20 (id1 removed)
  });
});
