# Sengo Index Feature Support Analysis

This document captures index features that are actually implemented and tested, focused on Sengo's S3-backed usage.

## Supported Index API Surface

- Create index
  - API: SengoCollection.createIndex in [client/src/client/collection.ts](../client/src/client/collection.ts#L155)
  - Store implementation (S3): createIndex in [client/src/repository/s3/s3CollectionStore.ts](../client/src/repository/s3/s3CollectionStore.ts#L281)
  - Test: create index usage in [client/tests/repository/collectionIndex.test.ts](../client/tests/repository/collectionIndex.test.ts#L48)
- Drop index
  - API: SengoCollection.dropIndex in [client/src/client/collection.ts](../client/src/client/collection.ts#L27)
  - Store implementation (S3): dropIndex in [client/src/repository/s3/s3CollectionStore.ts](../client/src/repository/s3/s3CollectionStore.ts#L69)
  - Test: dropIndex behavior in [client/tests/repository/s3/s3CollectionStore.index.test.ts](../client/tests/repository/s3/s3CollectionStore.index.test.ts#L37)
- List indexes
  - API: SengoCollection.listIndexes in [client/src/client/collection.ts](../client/src/client/collection.ts#L180)
  - Includes default _id index in [client/src/client/collection.ts](../client/src/client/collection.ts#L184)
  - Test: listIndexes output in [client/tests/client/listIndexes.test.ts](../client/tests/client/listIndexes.test.ts#L21)

## Supported Index Definition Forms

- String key: `createIndex('field')`
  - Normalization: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L535)
  - Test: string key normalization in [client/tests/repository/normalizeIndexKeys.test.ts](../client/tests/repository/normalizeIndexKeys.test.ts#L5)
- Object key: `createIndex({ field: 1 })`
  - Normalization: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L537)
  - Test: object key normalization in [client/tests/repository/normalizeIndexKeys.test.ts](../client/tests/repository/normalizeIndexKeys.test.ts#L16)
- Array keys / compound shape: `createIndex([{ a: 1 }, { b: -1 }])`
  - Normalization: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L529)
  - Test: array key normalization in [client/tests/repository/normalizeIndexKeys.test.ts](../client/tests/repository/normalizeIndexKeys.test.ts#L22)

Accepted order values in index definitions include `1`, `-1`, and `text` by type/normalization:

- Order type: [client/src/types.ts](../client/src/types.ts#L3)
- `text` normalization test: [client/tests/repository/normalizeIndexKeys.test.ts](../client/tests/repository/normalizeIndexKeys.test.ts#L19)

## Compound Index Behavior (Implemented)

- Non-final fields are required to satisfy compound index lookup
  - canSatisfyQuery: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L303)
- Non-final fields build the index storage key; final field is used for ordering/filtering within the entry
  - findKeysForQuery: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L418)
  - mapKeyValuesToIndexFormat: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L474)
- Final field sort preference in index scoring
  - scoreForQuery: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L329)
- Test coverage of compound usage and prefix matching
  - compound query test: [client/tests/client/compound-index.test.ts](../client/tests/client/compound-index.test.ts#L43)
  - prefix query test (first field only): [client/tests/client/compound-index.test.ts](../client/tests/client/compound-index.test.ts#L121)
  - sort-on-final-field preference test: [client/tests/client/compound-index.test.ts](../client/tests/client/compound-index.test.ts#L156)

## Index-Aware Sort and Limit Optimization

- find path uses index candidates and index-specific options before document loads
  - findCandidates: [client/src/repository/s3/s3CollectionStore.ts](../client/src/repository/s3/s3CollectionStore.ts#L173)
  - buildIndexOptions: [client/src/repository/s3/s3CollectionStore.ts](../client/src/repository/s3/s3CollectionStore.ts#L213)
- IndexEntry applies filters/sort/limit in index space
  - toArray optimization entrypoint: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L170)
  - _id sort + limit optimization: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L177)
  - compound final-field sort optimization: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L197)
  - limit application: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L236)
- Tests
  - find limit minimizing document gets: [client/tests/client/find-with-limit.test.ts](../client/tests/client/find-with-limit.test.ts#L49)
  - operator + sort + limit optimization: [client/tests/client/index-optimization-operators.test.ts](../client/tests/client/index-optimization-operators.test.ts#L55)
  - index-entry-level limit/sort cases: [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L5)

## Index-Related Operator Support in Indexed Retrieval

- `$in` support in index key expansion for non-final fields
  - findKeysForQuery handles `$in`: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L432)
  - Test: indexed `$in` query behavior in [client/tests/client/find-in.test.ts](../client/tests/client/find-in.test.ts#L86)
- Final-field filtering in index entries uses comparison operator functions
  - comparison dispatch in toArray: [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L224)
  - comparison function source: [client/src/client/expression.ts](../client/src/client/expression.ts#L39)
  - operator behavior tests: [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L77)

## Practical Index Recommendation Rules (Safe)

- Recommend single-field indexes for repeated equality or `$in` filters on one field.
- Recommend compound indexes where:
  - leading fields are equality/prefix filters.
  - final field is the sort/range field.
- Prefer recommendations that pair with `find(..., { sort, limit })` to reduce S3 document fetches.
- Validate recommendations against the actual supported query operators in [docs/SUPPORTED-COMMANDS-OPERATORS.md](SUPPORTED-COMMANDS-OPERATORS.md).

## Scope Notes

- This document describes implemented and tested behavior in this repo's current codebase.
- Keep recommendations inside this tested surface to avoid suggesting indexes that do not provide real gains.