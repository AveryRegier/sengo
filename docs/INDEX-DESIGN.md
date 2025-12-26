# Sengo S3 Index Design

## Use Case and Motivation
Sengo is designed for small, cost-sensitive applications—such as volunteer organizations or event-driven apps—that use AWS S3 for document storage. These applications require a simple, reliable way to store and retrieve documents without the cost or operational complexity of running a database server. However, as collections grow, searching by loading every document from S3 becomes impractical and expensive.

## Technology Choices: MongoDB Compatibility and S3
Sengo provides a MongoDB-like API for document operations, making it familiar to developers. Instead of using a database server, Sengo stores each document as a separate JSON file in S3. To support efficient queries, Sengo implements its own indexing system, inspired by MongoDB, but tailored for S3’s object storage model.

## The Need for Indexes
Without indexes, every query would require listing and loading all documents in a collection from S3—a slow and costly operation. **The primary goal of indexes is to avoid document fetches during query time, which is the most expensive part of any query.** Indexes allow Sengo to quickly find the IDs of documents matching a query, so only the relevant documents are loaded from S3.

## S3 Index and Document File Layout
Sengo stores both documents and index entries as individual JSON files in S3, organized by collection:

### Document Storage
- **Path:** `collection/data/<_id>.json`
- **Contents:** The full JSON document, including its `_id` field.
- **Note:** The `_id` field is naturally indexed in S3 through the file path itself, so no separate index is needed for `_id` lookups.

**Example:**
- Path: `pets/data/64a1f2c3e4b5d6789a0b1c2d.json`
- Contents:
```json
{
  "_id": "64a1f2c3e4b5d6789a0b1c2d",
  "name": "Milo"
}
```

### Index Metadata
- **Path:** `collection/indices/<indexName>.json`
- **Contents:** JSON describing the index definition (fields, order, etc).

**Example:**
- Path: `pets/indices/name_1.json`
- Contents:
```json
{
  "name": "name_1",
  "keys": [{ "field": "name", "order": 1 }]
}
```

### Index Entry Files
- **Path:** `collection/indices/<indexName>/<key>.json`
  - `<key>` is the encoded value(s) of the indexed field(s). For single-field indexes, this is the field value. For compound indexes, values are joined by `|` and each value is URI-encoded.
- **Contents:** JSON array of document IDs (`_id`s) that have the indexed value(s).
- **Purpose:** Index documents are simply lists of `_id` values. This allows queries to identify matching documents without fetching them from S3, significantly reducing query costs.

**Examples:**
- Path: `pets/indices/name_1/Milo.json`
- Contents:
```json
["64a1f2c3e4b5d6789a0b1c2d", "64a1f2c3e4b5d6789a0b1c2e"]
```
- Path: `pets/indices/name_1/Bella.json`
- Contents:
```json
["64a1f2c3e4b5d6789a0b1c2f", "64a1f2c3e4b5d6789a0b1c30"]
```
- Path: `tasks/indices/category_1_priority_1/work.json` (for a compound index on `{ category: 1, priority: 1 }`)
- Contents (IDs sorted by priority):
```json
["task1_id", "task2_id", "task3_id"]
```

## Index Design: Single-Key vs Compound Indexes

### Single-Key Indexes
For single-key indexes (e.g., `{ name: 1 }`), the index structure is straightforward:
- **Index Key:** The value of the indexed field (e.g., `Milo`)
- **Index Entry:** A JSON array containing all `_id` values for documents with that field value
- The index entry is simply a flat list of document IDs, allowing quick lookup without fetching documents

### Compound Indexes
For compound indexes (e.g., `{ category: 1, priority: 1 }`), the design is more sophisticated:
- **Index Key:** All but the last indexed field values become part of the S3 key, joined by `|` (e.g., `work` for category="work" in a 2-field index)
- **Index Entry:** A JSON array of `_id` values, **ordered by the final indexed field's value**
- The final field in the index determines the **sort order** of the IDs within the index entry, but is NOT part of the S3 key
- This structure enables efficient range queries and sorting on the final field without loading documents

**Example 1:** For 2-field index `{ category: 1, priority: 1 }`:
- Index key: `work` (only category, the non-final field)
- Index entry file: `collection/indices/category_1_priority_1/work.json`
- Index entry contents: `["id3", "id1", "id2"]` (IDs sorted by priority: 1, 2, 3)
- This single file contains ALL documents with category="work", sorted by priority
- Enables efficient `find({ category: "work" }).sort({ priority: 1 }).limit(5)` by reading just the index file and fetching only 5 documents

**Example 2:** For 3-field index `{ category: 1, status: 1, priority: 1 }`:
- Index key: `work|active` (category and status, joined by `|`)
- Index entry file: `collection/indices/category_1_status_1_priority_1/work|active.json`
- Index entry contents: IDs for category="work" AND status="active", sorted by priority
- The pattern: all non-final fields form the key, final field determines internal sort order

### How Indexes Are Used for Efficient Query Lookup

When a query is issued (e.g., `find({ name: "Milo" })`), Sengo inspects all loaded index definitions for the collection and selects the best matching index. If an index exists on the queried field(s), the following process is used:

1. **Index Key Generation:**
   - The query values for the indexed fields are encoded to form the index key (e.g., for `{ name: "Milo" }`, the key is `Milo`).
2. **Index Entry Lookup:**
   - Sengo loads the corresponding index entry file from S3 (e.g., `pets/indices/name_1/Milo.json`).
   - This file contains a flat array of document IDs (`_id`s) for all documents with that indexed value.
   - **This is where the performance optimization happens: we get a list of matching document IDs without fetching any documents.**
3. **Document Fetch:**
   - For each ID in the array, Sengo loads the document from S3 (e.g., `pets/data/<_id>.json`).
   - Only the documents matching the query are returned (if the index is compound, all indexed fields must match).

**Example:**
- Query: `find({ name: "Milo" })`
- Index used: `name_1` (on `{ name: 1 }`)
- Sengo loads `pets/indices/name_1/Milo.json` → `["64a1f2c3e4b5d6789a0b1c2d", "64a1f2c3e4b5d6789a0b1c2e"]`
- Loads `pets/data/64a1f2c3e4b5d6789a0b1c2d.json` and `pets/data/64a1f2c3e4b5d6789a0b1c2e.json`
- Returns all documents with `name: "Milo"`

This approach avoids scanning all documents in the collection, making lookups by indexed fields efficient even for large datasets. For compound indexes, the key is constructed from all indexed fields present in the query, and only exact matches on the leading fields are supported.

### Using Indexes to Optimize $limit and $sort

Indexes enable efficient `$limit` and `$sort` operations by limiting the number of document fetches:

**With $limit:**
- When the index's sort order matches the query's `$sort` direction, only the first N documents need to be fetched
- Example: `find({ category: "work" }).sort({ priority: 1 }).limit(5)` with index `{ category: 1, priority: 1 }` only fetches 5 documents
- The index entry already contains IDs in priority order, so Sengo can fetch exactly 5 documents and stop

**With $sort:**
- For compound indexes, if the query's sort field matches the final indexed field, documents can be returned in sorted order
- This eliminates the need to fetch all documents, sort them in memory, and then apply the limit
- The sort order is determined by the final field in the compound index

**Key Benefit:** By avoiding unnecessary document fetches (the most expensive operation), indexes with proper sort ordering dramatically reduce S3 API calls and query costs.

### Notes
- All index entry files are stored as flat arrays of string IDs.
- Index entry files are created, updated, and deleted as documents are inserted, updated, or deleted.
- The S3 layout is designed for efficient lookup and minimal cost, with each index entry and document as a separate S3 object.

---
