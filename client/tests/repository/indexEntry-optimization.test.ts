import { describe, it, expect } from 'vitest';
import { IndexEntry } from '../../src/repository/collectionIndex';

describe('IndexEntry optimization with $limit and comparison operators', () => {
  describe('$limit with $sort on _id only', () => {
    it('should optimize sorting by _id ascending with limit', () => {
      const entry = new IndexEntry([{ field: 'status', order: 1 as 1 | -1 }]);
      entry.add('id3');
      entry.add('id1');
      entry.add('id2');
      entry.add('id5');
      entry.add('id4');
      
      const result = entry.toArray({ sort: { _id: 1 }, limit: 3 });
      expect(result).toEqual(['id1', 'id2', 'id3']); // sorted ascending, limited to 3
    });

    it('should optimize sorting by _id descending with limit', () => {
      const entry = new IndexEntry([{ field: 'status', order: 1 as 1 | -1 }]);
      entry.add('id3');
      entry.add('id1');
      entry.add('id2');
      entry.add('id5');
      entry.add('id4');
      
      const result = entry.toArray({ sort: { _id: -1 }, limit: 3 });
      expect(result).toEqual(['id5', 'id4', 'id3']); // sorted descending, limited to 3
    });

    it('should not optimize when sort includes other fields', () => {
      const keys = [{ field: 'category', order: 1 as 1 | -1 }, { field: 'priority', order: 1 as 1 | -1 }];
      const entry = new IndexEntry(keys);
      entry.add('id3', 30);
      entry.add('id1', 10);
      entry.add('id2', 20);
      
      // Should return sorted by priority (from index), not by _id
      const result = entry.toArray({ sort: { _id: 1, priority: 1 }, limit: 2 });
      expect(result).toEqual(['id1', 'id2']); // priority: 10, 20 (first 2)
    });
  });

  describe('$limit with matching sort keys', () => {
    it('should apply limit when sort matches compound index order', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ sort: { priority: 1 }, limit: 3 });
      expect(result).toEqual(['id1', 'id2', 'id3']); // First 3 by priority
    });

    it('should apply limit even when sort direction differs', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      
      // Query sorts descending, but index is ascending
      // The logic still applies limit after sort validation fails
      const result = entry.toArray({ sort: { priority: -1 }, limit: 2 });
      expect(result).toEqual(['id1', 'id2']); // First 2 after optimization fails
    });
  });

  describe('Comparison operators: $lt, $lte, $gt, $gte', () => {
    it('should filter with $lt operator', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $lt: 30 } });
      expect(result).toEqual(['id1', 'id2']); // 10 < 30, 20 < 30
    });

    it('should filter with $lte operator', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $lte: 30 } });
      expect(result).toEqual(['id1', 'id2', 'id3']); // 10 <= 30, 20 <= 30, 30 <= 30
    });

    it('should filter with $gt operator', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $gt: 30 } });
      expect(result).toEqual(['id4', 'id5']); // 40 > 30, 50 > 30
    });

    it('should filter with $gte operator', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $gte: 30 } });
      expect(result).toEqual(['id3', 'id4', 'id5']); // 30 >= 30, 40 >= 30, 50 >= 30
    });

    it('should combine $gte with $limit and matching sort', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ 
        priority: { $gte: 20 },
        sort: { priority: 1 },
        limit: 2
      });
      expect(result).toEqual(['id2', 'id3']); // First 2 where priority >= 20
    });

    it('should combine $lt with $limit and matching sort', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({
        priority: { $lt: 50 },
        sort: { priority: 1 },
        limit: 2
      });
      expect(result).toEqual(['id1', 'id2']); // First 2 where priority < 50
    });
  });

  describe('Comparison operators: $eq, $ne', () => {
    it('should filter with $eq operator', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 20);
      entry.add('id4', 30);
      entry.add('id5', 20);
      
      const result = entry.toArray({ priority: { $eq: 20 } });
      expect(result).toEqual(['id2', 'id3', 'id5']); // priority === 20
    });

    it('should filter with $ne operator', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 20);
      entry.add('id4', 30);
      entry.add('id5', 20);
      
      const result = entry.toArray({ priority: { $ne: 20 } });
      expect(result).toEqual(['id1', 'id4']); // priority !== 20
    });

    it('should combine $eq with $limit', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 20);
      entry.add('id4', 30);
      entry.add('id5', 20);
      
      const result = entry.toArray({
        priority: { $eq: 20 },
        sort: { priority: 1 },
        limit: 2
      });
      expect(result).toEqual(['id2', 'id3']); // First 2 with priority === 20
    });
  });

  describe('Comparison operators: $in, $nin', () => {
    it('should filter with $in operator', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $in: [20, 40] } });
      expect(result).toEqual(['id2', 'id4']); // priority in [20, 40]
    });

    it('should filter with $nin operator', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({ priority: { $nin: [20, 40] } });
      expect(result).toEqual(['id1', 'id3', 'id5']); // priority not in [20, 40]
    });

    it('should combine $in with $limit and matching sort', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({
        priority: { $in: [10, 20, 30, 40] },
        sort: { priority: 1 },
        limit: 2
      });
      expect(result).toEqual(['id1', 'id2']); // First 2 where priority in array
    });

    it('should handle $in with non-array value gracefully', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      
      const result = entry.toArray({ priority: { $in: 20 as any } });
      expect(result).toEqual([]); // Should return empty for invalid $in
    });
  });

  describe('Comparison operator: $exists', () => {
    it('should filter with $exists: true', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', undefined);
      entry.add('id3', null);
      entry.add('id4', 40);
      entry.add('id5', '');
      
      const result = entry.toArray({ priority: { $exists: true } });
      expect(result).toEqual(['id1', 'id4']); // Values that exist (not undefined/null/'')
    });

    it('should filter with $exists: false', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', undefined);
      entry.add('id3', null);
      entry.add('id4', 40);
      entry.add('id5', '');
      
      const result = entry.toArray({ priority: { $exists: false } });
      expect(result.sort()).toEqual(['id2', 'id3', 'id5']); // undefined, null, or ''
    });
  });

  describe('Combined operators and edge cases', () => {
    it('should handle multiple comparison operators on same field', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      // Range query: 20 <= priority < 40
      const result = entry.toArray({
        priority: { $gte: 20, $lt: 40 }
      });
      expect(result).toEqual(['id2', 'id3']); // 20, 30
    });

    it('should apply limit after filtering with multiple operators', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      entry.add('id4', 40);
      entry.add('id5', 50);
      
      const result = entry.toArray({
        priority: { $gte: 20, $lte: 50 },
        sort: { priority: 1 },
        limit: 2
      });
      expect(result).toEqual(['id2', 'id3']); // First 2 in range [20, 50]
    });

    it('should handle unknown comparison operator gracefully', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      
      // Unknown operator should default to true (include all)
      const result = entry.toArray({
        priority: { $unknownOp: 15 } as any
      });
      expect(result).toEqual(['id1', 'id2']); // All items included
    });

    it('should apply limit optimization even when field not in index', () => {
      const keys = [
        { field: 'category', order: 1 as 1 | -1 },
        { field: 'priority', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 10);
      entry.add('id2', 20);
      entry.add('id3', 30);
      
      // Trying to filter on 'age' which is not in index
      // Since age is not in the index, filtering is ignored but limit is applied
      const result = entry.toArray({
        age: { $gte: 25 } as any,
        sort: { priority: 1 },
        limit: 1
      });
      expect(result).toEqual(['id1']); // First item after applying limit
    });
  });

  describe('String value comparisons', () => {
    it('should filter strings with $lt', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'name', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 'alice');
      entry.add('id2', 'bob');
      entry.add('id3', 'charlie');
      entry.add('id4', 'david');
      entry.add('id5', 'eve');
      
      const result = entry.toArray({ name: { $lt: 'charlie' } });
      expect(result).toEqual(['id1', 'id2']); // alice, bob < charlie
    });

    it('should filter strings with $gte', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'name', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 'alice');
      entry.add('id2', 'bob');
      entry.add('id3', 'charlie');
      entry.add('id4', 'david');
      entry.add('id5', 'eve');
      
      const result = entry.toArray({ name: { $gte: 'charlie' } });
      expect(result).toEqual(['id3', 'id4', 'id5']); // charlie, david, eve >= charlie
    });

    it('should filter strings with $in', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'name', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 'alice');
      entry.add('id2', 'bob');
      entry.add('id3', 'charlie');
      entry.add('id4', 'david');
      entry.add('id5', 'eve');
      
      const result = entry.toArray({ name: { $in: ['alice', 'charlie', 'eve'] } });
      expect(result).toEqual(['id1', 'id3', 'id5']);
    });

    it('should combine string filters with limit', () => {
      const keys = [
        { field: 'status', order: 1 as 1 | -1 },
        { field: 'name', order: 1 as 1 | -1 }
      ];
      const entry = new IndexEntry(keys);
      entry.add('id1', 'alice');
      entry.add('id2', 'bob');
      entry.add('id3', 'charlie');
      entry.add('id4', 'david');
      entry.add('id5', 'eve');
      
      const result = entry.toArray({
        name: { $gte: 'bob' },
        sort: { name: 1 },
        limit: 3
      });
      expect(result).toEqual(['id2', 'id3', 'id4']); // bob, charlie, david
    });
  });
});
