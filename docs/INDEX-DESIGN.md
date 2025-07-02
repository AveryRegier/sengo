# Sango Indexing Design (Consolidated)

## Motivation
Sango is designed for small, cost-sensitive applications that use AWS S3 for document storage. To enable efficient search and retrieval without incurring high costs or requiring persistent infrastructure, Sango will support a flexible, document-based indexing system.

## Indexing Requirements
- **Efficient Search:** Indexes must allow fast lookup by fields (e.g., name, date) without loading all documents from S3.
- **Low Cost:** Indexes are stored as documents in S3, minimizing storage and operational costs.
- **Incremental Updates:** Indexes must support adding new documents and incremental updates.
- **Re-indexing:** Full re-indexing from scratch must be possible for recovery or schema changes.
- **Future Growth:** Index format must allow for future features (sorting, text search, filtering, etc.).

## Index Document Structure
- Each index is a document (or set of documents) mapping indexed field values to arrays of document IDs.
- Indexes support single-field and compound keys, with ascending (1) or descending (-1) order.
- Text indexes may use string keys; details to be explored.
- Indexes are stored in a dedicated S3 prefix (e.g., `collection/indices/`).

## S3 Index File Structure
- Each index entry is stored as a separate S3 object:
  - Path: `collection/indices/indexName/key.json`
  - Contents: JSON array of document IDs for that key
  - ETag is used for optimistic concurrency control

## Index Entry Cache
- In-memory cache per process for index entries
- Cleared on process restart; S3 is always the source of truth
- Cache is not shared between tests or processes

## S3 Simulation and Test Isolation
- Tests use `S3BucketSimulator` to simulate S3 state and log all accesses
- Each test creates its own simulator instance and sets up its own S3 state
- No S3 state or logs are shared between tests
- Helpers are provided for setting up S3 state for index entries and document files

## Index Loading and Querying Design
- **Index Definitions:** When a collection is first used, all index definitions (metadata) are loaded into memory. This allows the collection to know which indexes are available and their key structure.
- **Index Selection:** On each `find()` operation, the collection inspects all loaded index definitions and selects the best matching index based on the query and the index’s `NormalizedIndexKeyRecord` (the set of fields and orderings the index covers).
- **IndexEntry Loading:** The actual index entry file (mapping from key to document IDs) is loaded lazily and at most once per key, via the index instance, when a query uses that index and key. This ensures efficient S3 usage and avoids redundant loads.
- **CollectionIndex Abstraction:** The `CollectionIndex` abstraction is responsible for both index maintenance (generation, updates) and for providing the mapping from query to document IDs during `find()`. It is designed to be extended for different backends (e.g., in-memory, S3-backed).

## Performance and Use Case
- Designed for apps with infrequent use (e.g., volunteer orgs, occasional data entry).
- Split-second response is not required, but user experience must remain natural.
- Suitable for Lambda/event-driven architectures.

## Key Design Decisions (2025-07-01)
- **Robust Index Maintenance:** On update, if an indexed field changes, the document ID is removed from the old index key and added to the new key. This ensures MongoDB-compatible index behavior and correct query results.
- **Debug Logging:** Debug logs are present for all index maintenance operations (`insertOne`, `updateOne`, index add/remove) and now also for index-backed queries (`findIdsForKey` in both S3 and memory backends). This enables full traceability of document and index activity.
- **Test Isolation:** All S3 simulation and index/document tests use isolated state and logs per test. Index entry caches are cleared between simulated process restarts to ensure no cross-test contamination.
- **Test Robustness:** Helpers and patterns are in place to ensure S3 state, logs, and caches are set up and cleared per test, matching production access patterns as closely as possible.
- **No Source Copying:** All code is original and does not copy MongoDB source; API is MongoDB-like but implemented from scratch.
- **Clean, Readable TypeScript:** Code is written to be clean, readable, and well-documented, prioritizing maintainability and clarity.

## Current Index Design Limitations
- **Partial Key Matching:** Currently, an index is only used if the query matches the first key in the index. Additional keys in the index are only used if they are also present in the query, and only consecutive keys from the start are considered. This means queries that do not include the first key of an index cannot benefit from that index.
- **No Full Index Scans:** There is no support for scanning the entire index or for range queries. Only exact matches on the leading key(s) are supported.
- **No Sorting or Range Support:** The current design does not support using indexes for sorting or for range queries (e.g., `$gt`, `$lt`).
- **No Compound Index Optimization:** While compound indexes are supported, only the leading prefix of the index is used for lookups. There is no optimization for queries that match non-leading keys.
- **No Index Intersection:** Queries that could benefit from multiple indexes (index intersection) are not optimized; only a single best index is chosen per query.
- **No Index Statistics or Cost-Based Selection:** Index selection is based on the number of consecutive leading keys matched, not on query statistics or cost estimation.
- **No Automatic Index Rebuilding:** Indexes are only updated when documents are inserted or updated; there is no background or scheduled re-indexing.

## Lessons Learned
- Test isolation is critical for robust S3-backed index/document testing
- S3 simulation must match production key logic and access patterns
- Index entry cache must be cleared between process restarts
- Test helpers are essential for robust, independent test setup
- S3 state and access logs must be per-test; no sharing between tests

## Future Goals
- **Full Index Utilization:** Support for using indexes even when only non-leading keys are present in the query.
- **Range and Sort Support:** Add support for range queries and sorting using indexes.
- **Index Intersection:** Optimize queries using multiple indexes.
- **Cost-Based Index Selection:** Use statistics to select the most efficient index for a query.
- **Automatic Index Rebuilding:** Support background or scheduled re-indexing.
