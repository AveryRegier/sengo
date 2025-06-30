import { normalizeIndexKeys } from '../../src/repository/collectionIndex';
import { describe, it, expect } from 'vitest';

describe('normalizeIndexKeys', () => {
  it('should normalize a single string key', () => {
    expect(normalizeIndexKeys('foo')).toEqual([{ field: 'foo', order: 1 }]);
  });

  it('should normalize an array of string keys', () => {
    expect(normalizeIndexKeys(['foo', 'bar'])).toEqual([
      { field: 'foo', order: 1 },
      { field: 'bar', order: 1 }
    ]);
  });

  it('should normalize a single object key', () => {
    expect(normalizeIndexKeys({ foo: 1 })).toEqual([{ field: 'foo', order: 1 }]);
    expect(normalizeIndexKeys({ bar: -1 })).toEqual([{ field: 'bar', order: -1 }]);
    expect(normalizeIndexKeys({ baz: 'text' })).toEqual([{ field: 'baz', order: 'text' }]);
  });

  it('should normalize an array of object keys', () => {
    expect(normalizeIndexKeys([{ foo: 1 }, { bar: -1 }])).toEqual([
      { field: 'foo', order: 1 },
      { field: 'bar', order: -1 }
    ]);
  });

  it('should throw if keys is undefined', () => {
    expect(() => normalizeIndexKeys(undefined as any)).toThrow('Keys must be defined for creating an index');
  });

  it('should throw for invalid key format', () => {
    expect(() => normalizeIndexKeys(123 as any)).toThrow('Invalid index key format');
  });
});
