# Sengo Index Design

Sengo stores documents and index data as separate JSON objects in S3. Indexes have two jobs:

1. Find candidate document IDs without scanning every document.
2. For compound indexes, preserve ordering/filter values for the final index field so supported sort, range, and limit queries can fetch fewer documents.

The index key definition is ordered. Every declared field participates in the logical index key. Sengo's current S3 layout groups entries by the leading fields and stores the final field's value beside each document ID. This is a storage/query optimization, not a change to which fields define the index.

## Shared behavior and layout

### Documents

- Path: `collection/data/<_id>.json`
- Contents: The full document, including `_id`.
- `_id` lookups use this path directly.

### Index metadata

- Path: `collection/indices/<indexName>.json`
- Contents: index name, ordered key fields, and index options such as `unique`.
- Metadata without a `unique` property is a non-unique index.

Example:

```json
{
  "name": "category_1_priority_1",
  "keys": [
    { "field": "category", "order": 1 },
    { "field": "priority", "order": 1 }
  ]
}
```

### Index entry objects

- Path: `collection/indices/<indexName>/<entryKey>.json`
- A single-field index uses the field value as `entryKey`.
- A compound index uses the values of all leading (non-final) fields, joined by `|` after URI encoding.
- The final declared field is stored with each ID in the entry data. It remains part of the logical compound key and provides ordering/filter data.

For example, index `{ category: 1, priority: 1 }` puts all documents with `category: "work"` in:

`tasks/indices/category_1_priority_1/work.json`

Its serialized entries retain `priority`:

```json
[["task-a", 1], ["task-b", 2], ["task-c", 4]]
```

The file is grouped by `category`; the tuples represented inside it are `(category, priority)`. The final field is not omitted from the index. It is omitted only from the S3 object path.

For `{ category: 1, status: 1, priority: 1 }`, the entry path is grouped by `category` and `status`, for example `work|active.json`; each ID in that entry carries its `priority`.

### Queries and sorting

For `{ category: 1, priority: 1 }`:

- `find({ category: "work" })` can read the grouped entry and return all its IDs.
- `find({ category: "work", priority: 2 })` can read the same entry and filter by the stored final-field value before loading documents.
- `find({ category: "work" }).sort({ priority: 1 }).limit(2)` can use the entry's ordering to fetch only the first two matching documents.

The final field is therefore useful even when it is also part of a unique index. Sorting is not needed to establish uniqueness. An exact lookup by all compound fields identifies at most one matching tuple under a unique constraint; the stored final-field value simply lets that lookup distinguish tuples sharing a leading-field entry.

Index ordering matters for sort optimization: the final field determines the order within a grouped entry. It does not mean that only the leading fields are indexed logically.

## Non-unique indexes

Non-unique indexes preserve the existing one-to-many behavior:

- Multiple documents may have the same single-field value.
- Multiple documents may have the same complete compound tuple.
- Each entry stores every matching `_id`. Compound entries also store the final field value per ID to support ordering and filtering.

Example, non-unique `{ category: 1, priority: 1 }`:

```json
[["task-a", 2], ["task-b", 2]]
```

Both documents have the same full tuple `("work", 2)` and both IDs remain in the grouped `work.json` entry. Ordinary index maintenance must not reject duplicate values.

## Unique indexes

A unique index constrains the complete logical key:

- Unique `{ email: 1 }`: no two documents may have the same `email`.
- Unique `{ category: 1, priority: 1 }`: no two documents may have the same `(category, priority)` pair.

For a unique compound index, the S3 entry file is still grouped by leading fields and may contain several IDs with different final-field values. It must not contain two different IDs with the same complete tuple.

Example, unique `{ category: 1, priority: 1 }`:

```json
[["task-a", 1], ["task-b", 2]]
```

Both entries share `category: "work"` but have distinct complete keys. A second document with `("work", 2)` must be rejected, while one with `("work", 3)` is allowed. The final field is part of the uniqueness comparison, not an extra value outside the index definition.

For a unique single-field index, the indexed value identifies the entry, and at most one document ID may own that value.

### Concurrent writers

Sengo clients may run in separate Lambda processes with separate memory and caches. S3 is the shared authority; local cached index entries cannot decide uniqueness.

Updating a shared entry must use conditional S3 writes:

1. Load the entry and its ETag (or observe that the object does not exist).
2. Apply the local addition/removal to the loaded entry.
3. Write with `IfMatch` for an existing ETag, or `IfNoneMatch: '*'` when creating a missing entry.
4. On a conditional-write conflict, reload the current entry and reapply the local delta.
5. After reload, report a duplicate only if another `_id` owns the same complete logical key. An ETag conflict by itself is not a duplicate: a concurrent writer may have added a different final-field value to the same grouped entry.

This prevents two processes from silently overwriting each other's changes to one index-entry object. S3 does not provide a transaction spanning an index entry and its document object. Failure recovery for partial document/index updates must therefore be specified separately.

Unique-index creation over existing data is also a separate operation: the implementation must prevent concurrent writes from bypassing the index while it is being validated and built. Per-entry conditional writes protect competing entry updates but alone do not make index backfill atomic.

The exact missing/null behavior and array-valued index-field behavior must be documented and tested before claiming MongoDB compatibility. Sparse and partial unique indexes are out of scope unless explicitly added.

## Query performance

The primary performance goal is minimizing document fetches from S3:

1. Select an index that can provide candidate IDs.
2. Load relevant index entries.
3. Apply available final-field filtering/order and limit within entry data.
4. Fetch candidate documents and apply remaining query semantics.

For example, `{ category: 1, priority: 1 }` can support `find({ category: "work" }).sort({ priority: 1 }).limit(2)` because the entry is ordered by `priority`. Exact unique tuple lookup does not need sorting, but benefits from final-field filtering before document fetch.

Explain output and tests should distinguish index entries read from document objects fetched. S3 simulator assertions should verify both correctness and the number of document fetches.

## Compatibility and operational limits

- Non-unique indexes remain one-to-many.
- Unique constraints apply to complete index keys, not only S3 path prefixes.
- S3 object writes are conditional per object; no multi-object transaction is implied.
- Cross-process correctness must be tested with independent store/client instances sharing one S3 simulator.
- Index metadata and index entries are separate objects. Publishing a unique index while other clients write requires an explicit build/write-coordination protocol.
