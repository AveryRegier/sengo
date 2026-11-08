import { describe, expect, it } from 'vitest';
import { expandFieldPathArrays, getFieldPathValues, hasFieldPath, resolveFieldPath } from '../../src/util/fieldPath';

describe('field path resolution', () => {
  const document = {
    profile: { city: 'Oslo', region: null },
    stops: [{ code: 'A' }, { code: 'B' }, { code: 'A' }],
    empty: [],
    tags: ['red', 'blue'],
  };

  it('resolves nested object values', () => {
    expect(getFieldPathValues(document, 'profile.city')).toEqual([
      { value: 'Oslo', arrayAncestry: [] },
    ]);
  });

  it('distinguishes a missing path from an explicit null', () => {
    expect(resolveFieldPath(document, 'profile.region')).toMatchObject({
      exists: true,
      values: [{ value: null }],
    });
    expect(resolveFieldPath(document, 'profile.country')).toMatchObject({
      exists: false,
      values: [],
    });
    expect(hasFieldPath(document, 'profile.region')).toBe(true);
    expect(hasFieldPath(document, 'profile.country')).toBe(false);
  });

  it('traverses arrays of embedded documents and retains element ancestry', () => {
    expect(getFieldPathValues(document, 'stops.code')).toEqual([
      { value: 'A', arrayAncestry: [{ path: 'stops', index: 0 }] },
      { value: 'B', arrayAncestry: [{ path: 'stops', index: 1 }] },
      { value: 'A', arrayAncestry: [{ path: 'stops', index: 2 }] },
    ]);
  });

  it('retains missing values for individual array elements without marking the whole path missing', () => {
    expect(resolveFieldPath({ items: [{ code: 'A' }, {}] }, 'items.code')).toEqual({
      path: 'items.code',
      exists: true,
      values: [
        { value: 'A', arrayAncestry: [{ path: 'items', index: 0 }] },
        { value: undefined, arrayAncestry: [{ path: 'items', index: 1 }] },
      ],
    });
    expect(resolveFieldPath({ items: [{}] }, 'items.code')).toMatchObject({
      exists: false,
      values: [{ value: undefined }],
    });
  });

  it('keeps terminal arrays and present empty arrays distinct from missing paths', () => {
    expect(resolveFieldPath(document, 'tags')).toMatchObject({
      exists: true,
      values: [{ value: ['red', 'blue'] }],
    });
    expect(resolveFieldPath(document, 'empty')).toMatchObject({
      exists: true,
      values: [{ value: [] }],
    });
  });

  it('expands terminal arrays while retaining shared field-path ancestry', () => {
    const resolution = resolveFieldPath({ items: [{ tags: ['red', 'blue'] }] }, 'items.tags');
    expect(expandFieldPathArrays(resolution)).toEqual([
      { value: 'red', arrayAncestry: [{ path: 'items', index: 0 }, { path: 'items.tags', index: 0 }] },
      { value: 'blue', arrayAncestry: [{ path: 'items', index: 0 }, { path: 'items.tags', index: 1 }] },
    ]);
  });

  it('represents an empty terminal array as a null-like index value', () => {
    const resolution = resolveFieldPath({ tags: [] }, 'tags');
    expect(expandFieldPathArrays(resolution)).toEqual([
      { value: null, arrayAncestry: [] },
    ]);
  });

  it('rejects empty or malformed paths as missing', () => {
    expect(hasFieldPath(document, '')).toBe(false);
    expect(hasFieldPath(document, 'profile..city')).toBe(false);
  });
});
