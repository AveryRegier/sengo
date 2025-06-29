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

## Performance and Use Case
- Designed for apps with infrequent use (e.g., volunteer orgs, occasional data entry).
- Split-second response is not required, but user experience must remain natural.
- Suitable for Lambda/event-driven architectures.

## Future Considerations
- Support for sorting and filtering index results (e.g., by date).
- Efficient index update algorithms for growing datasets.
- Text search and more complex index types.

---
This document is a living draft and will evolve as Sango's indexing feature is implemented and tested.
