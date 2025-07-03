# Sengo S3 Index Design

## Use Case and Motivation
Sengo is designed for small, cost-sensitive applications—such as volunteer organizations or event-driven apps—that use AWS S3 for document storage. These applications require a simple, reliable way to store and retrieve documents without the cost or operational complexity of running a database server. However, as collections grow, searching by loading every document from S3 becomes impractical and expensive.

## Technology Choices: MongoDB Compatibility and S3
Sengo provides a MongoDB-like API for document operations, making it familiar to developers. Instead of using a database server, Sengo stores each document as a separate JSON file in S3. To support efficient queries, Sengo implements its own indexing system, inspired by MongoDB, but tailored for S3’s object storage model.

## The Need for Indexes
Without indexes, every query would require listing and loading all documents in a collection from S3—a slow and costly operation. Indexes allow Sengo to quickly find the IDs of documents matching a query, so only the relevant documents are loaded from S3.

## S3 Index and Document File Layout
Sengo stores both documents and index entries as individual JSON files in S3, organized by collection:

### Document Storage
- **Path:** `collection/data/<_id>.json`
- **Contents:** The full JSON document, including its `_id` field.

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
- Path: `pets/indices/compound_1/Milo|dog.json` (for a compound index on `{ name: 1, type: 1 }`)
- Contents:
```json
["64a1f2c3e4b5d6789a0b1c2d"]
```

### How Indexes Are Used for Efficient Query Lookup

When a query is issued (e.g., `find({ name: "Milo" })`), Sengo inspects all loaded index definitions for the collection and selects the best matching index. If an index exists on the queried field(s), the following process is used:

1. **Index Key Generation:**
   - The query values for the indexed fields are encoded to form the index key (e.g., for `{ name: "Milo" }`, the key is `Milo`).
2. **Index Entry Lookup:**
   - Sengo loads the corresponding index entry file from S3 (e.g., `pets/indices/name_1/Milo.json`).
   - This file contains a flat array of document IDs (`_id`s) for all documents with that indexed value.
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

### Notes
- All index entry files are stored as flat arrays of string IDs.
- Index entry files are created, updated, and deleted as documents are inserted, updated, or deleted.
- The S3 layout is designed for efficient lookup and minimal cost, with each index entry and document as a separate S3 object.

---
