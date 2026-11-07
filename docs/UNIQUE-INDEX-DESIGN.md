# Unique Index Design

## Scope

This design covers unique indexes only. Upsert and `$setOnInsert` are separate features and are not covered here.

**Unique-index implementation depends on reliable cross-process S3 index-entry persistence.** Document writes use conditional-write behavior; shared S3 index-entry writes also require conditional compare-and-swap, reload/reapply, and reliable error propagation.

See [S3-INDEX-PERSISTENCE-DESIGN.md](./S3-INDEX-PERSISTENCE-DESIGN.md) for the related persistence design, internal type separation, independent-Lambda Given/When/Then tests, simulator design, and exit criteria.

## Index semantics relevant to uniqueness

The index key definition is ordered, and every declared field participates in the logical key. Current Sengo storage groups compound entries by all leading (non-final) fields and stores the final field value beside each `_id`.

For `{ category: 1, priority: 1 }`, the entry object for `category: "work"` can contain:

```json
[["task-a", 1], ["task-b", 2]]
```

Both IDs share one S3 object because the object path is grouped by `category`; their complete tuples differ. The final field is not omitted from the index. It remains in the tuple and can be used to filter/order IDs before document fetch.

For a unique compound index, reject a second ID only when the **complete tuple** matches. An ETag conflict alone is not a duplicate: another process may have added a distinct final-field value to the same grouped entry. Exact lookup of the full unique tuple needs no sort to establish uniqueness; final-field sort data remains useful for prefix queries such as `find({ category: "work" }).sort({ priority: 1 }).limit(2)`.

The existing grouped index entry is the intended coordination point. Conditional persistence must make updates to that object safe across processes. Unique-index build/backfill remains a separate race and needs an explicit protocol to prevent concurrent writes bypassing validation/publication.

See [INDEX-DESIGN.md](./INDEX-DESIGN.md) for shared, non-unique, and unique storage/query behavior.

## Proposed API and metadata types

```ts
export type CreateIndexOptions = {
  unique?: boolean;
};

export type IndexSpecification = {
  v: number;
  key: Record<string, number>;
  name: string;
  unique?: true;
};

createIndex(
  keys: IndexDefinition | IndexDefinition[],
  options?: CreateIndexOptions,
): Promise<string>;
```

Persist `unique: true` in index metadata and expose it in `listIndexes()`. Metadata without `unique` remains non-unique. Add a generic uniqueness property to the index contracts only if implementation needs it. Keep S3 ETags and conditional-write details out of those contracts. Memory must enforce the same uniqueness semantics within its single process; only S3 tests can prove cross-process coordination.

## Given / When / Then requirements

- **Given** a unique single-field index, **when** a second document uses the same value, **then** insertion fails with `DuplicateKeyError` and stored data remains unchanged.
- **Given** a unique compound index `{ calendarId: 1, memberId: 1 }`, **when** two documents use the same pair, **then** only one is stored; **when** either field differs, **then** both are allowed.
- **Given** an existing grouped entry for the same `calendarId`, **when** documents use different `memberId` values, **then** they share the S3 entry object but remain distinct unique tuples.
- **Given** two independent clients/Lambda-like stores sharing S3, **when** both insert the same unique tuple concurrently, **then** exactly one succeeds; the loser reloads S3 state and receives `DuplicateKeyError`.
- **Given** two clients with stale copies of a grouped entry, **when** they add different complete tuples sharing leading fields, **then** conditional conflict/reload preserves both IDs and neither reports a duplicate.
- **Given** two clients inserting different tuples stored in different entry objects, **when** both operations complete, **then** both succeed without shared process memory.
- **Given** two documents and separate clients, **when** both updates attempt to claim the same new tuple, **then** at most one update commits; the loser gets `DuplicateKeyError` and document/index state remains correct.
- **Given** an update with an unchanged or newly available tuple, **when** it commits, **then** the previous tuple becomes reusable only after the new document state is committed.
- **Given** a document owning a unique tuple, **when** it is deleted, **then** that tuple becomes reusable; cleanup never removes a tuple now owned by another document.
- **Given** duplicate existing documents, **when** unique index creation/backfill runs, **then** it fails with `DuplicateKeyError`, preserves documents, and leaves no active invalid unique index.
- **Given** unique-index backfill racing a write from another Lambda, **when** both overlap, **then** the build protocol prevents a duplicate from slipping past validation/publication.
- **Given** a known document-write failure after index changes begin, **when** the operation fails, **then** compensation/recovery leaves no false unique ownership. For an ambiguous S3 response, reread authoritative state before cleanup.
- **Given** a non-unique index, **when** duplicate values are inserted across processes, **then** all IDs remain in the index entry.
- **Given** a unique compound index and a query matching leading and final fields, **when** `find` executes, **then** final-field data filters candidates before document fetch.
- **Given** a unique compound index and a prefix query sorted by the final field, **when** a limited find executes, **then** existing sort/limit optimization remains available.
- Define and test missing/null and array-valued field behavior before claiming MongoDB compatibility. Sparse and partial unique indexes are out of scope unless explicitly added.

## Implementation sequence and gates

1. Finish shared index-entry conditional persistence and independent-instance tests.
2. Run full `npm test` for a fresh baseline. Correct stale `/documents/` references in the quarantined unique tests to the actual `/data/` paths. Activate only unique-index tests; keep upsert tests excluded.
3. Add API/options and persisted metadata; test `listIndexes()`, metadata reload, and unchanged non-unique behavior.
4. Enforce complete-tuple uniqueness within existing grouped entries. Add shared-S3 independent-client tests for same-tuple and different-final-value races.
5. Integrate insert, update, delete, backfill, and failure recovery. Define and test coordination of unique-index creation with concurrent writes.
6. Add explain assertions for index selection, index-entry/document loads, and write paths. Update supported-feature documentation and relevant skill references.
7. Run focused unique-index tests, build/type checks, and **full `npm test`**. Compare to baseline: no regressions, all unique-index tests pass, and upsert tests remain excluded.

## Test fixtures

The quarantined `unique-index.test.ts` contains 12 existing scenarios. Its injected document-write failure and document-fetch assertions currently look for `/documents/`; the implementation stores documents under `/data/`, so correct those paths before relying on those scenarios. Add the separate-process race cases above; a single client with `Promise.all` is not sufficient to validate Lambda isolation.

The quarantined `upsert.test.ts` must remain excluded from unique-index work; it covers update upsert behavior and `$setOnInsert`, which are separate features.
