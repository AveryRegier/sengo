# Sango Indexing Design (Draft)

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

## Index Loading and Querying Design
- **Index Definitions:** When a collection is first used, all index definitions (metadata) are loaded into memory. This allows the collection to know which indexes are available and their key structure.
- **Index Selection:** On each `find()` operation, the collection inspects all loaded index definitions and selects the best matching index based on the query and the index’s `NormalizedIndexKeyRecord` (the set of fields and orderings the index covers).
- **IndexEntry Loading:** The actual index entry file (mapping from key to document IDs) is loaded lazily and at most once per key, via the index instance, when a query uses that index and key. This ensures efficient S3 usage and avoids redundant loads.
- **CollectionIndex Abstraction:** The `CollectionIndex` abstraction is responsible for both index maintenance (generation, updates) and for providing the mapping from query to document IDs during `find()`. It is designed to be extended for different backends (e.g., in-memory, S3-backed).

## Performance and Use Case
- Designed for apps with infrequent use (e.g., volunteer orgs, occasional data entry).
- Split-second response is not required, but user experience must remain natural.
- Suitable for Lambda/event-driven architectures.

## Current Index Design Limitations
- **Partial Key Matching:** Currently, an index is only used if the query matches the first key in the index. Additional keys in the index are only used if they are also present in the query, and only consecutive keys from the start are considered. This means queries that do not include the first key of an index cannot benefit from that index.
- **No Full Index Scans:** There is no support for scanning the entire index or for range queries. Only exact matches on the leading key(s) are supported.
- **No Sorting or Range Support:** The current design does not support using indexes for sorting or for range queries (e.g., `$gt`, `$lt`).
- **No Compound Index Optimization:** While compound indexes are supported, only the leading prefix of the index is used for lookups. There is no optimization for queries that match non-leading keys.
- **No Index Intersection:** Queries that could benefit from multiple indexes (index intersection) are not optimized; only a single best index is chosen per query.
- **No Index Statistics or Cost-Based Selection:** Index selection is based on the number of consecutive leading keys matched, not on query statistics or cost estimation.
- **No Automatic Index Rebuilding:** Indexes are only updated when documents are inserted or updated; there is no background or scheduled re-indexing.

## Future Goals
- **Full Index Utilization:** Support for using indexes even when only non-leading keys are present in the query.
- **Range and Sort Support:** Enable range queries and sorting using indexes.
- **Index Intersection:** Combine results from multiple indexes for more efficient queries.
- **Cost-Based Index Selection:** Use query statistics and cost estimation to select the most efficient index.
- **Automatic and Background Index Rebuilding:** Support for automatic index maintenance and rebuilding as data changes.
- **Advanced Index Types:** Add support for text, geospatial, and other advanced index types.

## Error Handling and MongoDB Compatibility

- **Error Types:** Sengo aims to throw error types that are compatible with the MongoDB Node.js driver, such as `MongoNetworkError`, for network and S3-related failures. This allows client code to catch and handle errors using the same patterns as with the official MongoDB client.
- **Error Messages:** Error messages are preserved from the underlying S3 or network error whenever possible. This ensures that users and developers see the real cause of the failure, rather than a generic message, aiding in debugging and transparency.
- **Design Goal:** Sengo will not mask or overwrite the actual error message from S3/network errors, but will always wrap them in the appropriate MongoDB-compatible error type. This provides both compatibility and clarity.
- **Test Expectations:** Tests should assert that the error type matches the expected MongoDB-compatible error (e.g., `MongoNetworkError`), and that the error message contains the real error from S3 or the network, not a generic string.
- **Other Errors:** For non-network errors (e.g., not found, validation), Sengo will throw standard JavaScript errors or custom error types as appropriate, but will not misrepresent the underlying cause.

---
This document is a living draft and will evolve as Sango's indexing feature is implemented and tested.
