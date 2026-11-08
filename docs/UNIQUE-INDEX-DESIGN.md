# Unique Index Design

## Scope

This design covers unique indexes only. Upsert and `$setOnInsert` are separate features and are not covered here.

Writes against an existing unique index use conditional S3 compare-and-swap
and revalidate conflicts against the latest entry across independent clients.
Unique-index creation over existing data is not an online operation: its scan,
backfill, and metadata publication are not atomic with writes from other
stores/processes.

See [S3-INDEX-PERSISTENCE-DESIGN.md](./S3-INDEX-PERSISTENCE-DESIGN.md) for the related persistence design, internal type separation, independent-Lambda Given/When/Then tests, simulator design, and exit criteria.

## Index semantics relevant to uniqueness

Behavior reference: [MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/) and [MongoDB multikey indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/). Sengo remains a compatible subset; unsupported index options are not implied by these references.

The index key definition is ordered, and every declared field participates in the logical key. Current Sengo storage groups compound entries by all leading (non-final) fields and stores the final field value beside each `_id`.

For `{ category: 1, priority: 1 }`, the entry object for `category: "work"` can contain:

```json
[["task-a", 1], ["task-b", 2]]
```

Both IDs share one S3 object because the object path is grouped by `category`; their complete tuples differ. The final field is not omitted from the index. It remains in the tuple and can be used to filter/order IDs before document fetch.

For a unique compound index, reject a second ID only when the **complete tuple** matches. An ETag conflict alone is not a duplicate: another process may have added a distinct final-field value to the same grouped entry. Exact lookup of the full unique tuple needs no sort to establish uniqueness; final-field sort data remains useful for prefix queries such as `find({ category: "work" }).sort({ priority: 1 }).limit(2)`.

The existing grouped index entry is the intended coordination point.
Conditional persistence makes updates to that object safe across processes
once those clients have loaded the index definition. Index definitions are
cached per store and loaded only once. A client that loaded metadata before a
unique index was created will not automatically discover that index and can
continue writing without maintaining it.

Unique-index creation must be done while collection writes are paused. After
the build completes, restart or recreate every application store/client so
each loads the new metadata before writes resume. A separate admin client is a
reasonable way to run index maintenance, but it does not by itself coordinate
with active application clients. Creating the index through the same
`SengoCollection`/store is serialized with writes made through that store; it
does not coordinate separate stores or processes. Online unique-index builds
and automatic metadata refresh are not supported.

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

## Detailed implementation design

### Compatibility and explicit boundaries

Use the MongoDB unique-index rules as the behavior source:

- A unique index rejects equal complete keys owned by different documents.
- A unique compound index compares the whole tuple, not just the leading
  fields used to group an S3 entry object.
- Missing and explicit `null` values generate the same null-like index value.
  A unique single-field index therefore allows at most one document whose
  field is missing or null. For a compound index, uniqueness applies to the
  complete tuple, so the other fields can distinguish those documents.
- A multikey index emits one membership per distinct generated key for a
  document. Repeated values in one document are deduplicated and do not
  conflict with that same document; the same key owned by another document
  is a duplicate.
- A compound multikey index cannot expand independent indexed fields that are
  both arrays for one document. Reject that document/index build with an
  explicit argument/server error rather than silently omitting tuples.
- Dotted paths traverse embedded objects and arrays of embedded objects.
  Values discovered through a single array path expand into memberships.
  Empty arrays produce the null-like index value; repeated extracted values
  are deduplicated before writes.
- Sparse and partial indexes, hashed/text unique indexes, and upsert behavior
  are not part of this feature.

Do not use JavaScript string coercion as the unique-key equality rule:
`1`, `"1"`, `null`, missing, dates, and BSON values must not accidentally
collapse to the same tuple. Define one shared, deterministic canonical
representation for tuple equality and typed S3 path components. Use the same
normalization in index build, write checks, and query key generation.

### General field-path behavior (shared foundation)

Dotted paths are document/query behavior, not an index feature. Implement them
once in a shared utility under `client/src/util/` (for example
`fieldPath.ts`), without dependencies on repository/index classes. Unique
index extraction must consume this utility; it must not include its own path
parser, object walker, array traversal, or missing-value interpretation.

The shared read API should accept a document and a dot-separated path and
return a structured result rather than a single ambiguous `any` value. The
result must distinguish:

- The path being missing from an explicitly present `null`.
- One scalar value from multiple values discovered by traversing arrays.
- Array element ancestry/position, so compound paths through the same
  embedded-document array can be correlated and do not form false
  cross-element tuples.
- An empty array from a missing terminal field until the caller applies the
  operator-specific semantics.

Provide small shared operations such as `getFieldPathValues` and
`hasFieldPath`, backed by one parser/traversal implementation. Keep the
representation of traversal provenance private to the utility's exported
types. Consumers should request the semantic result they need rather than
reimplementing segment-by-segment traversal.

Use the common path utility across these surfaces as their dotted-path
behavior is added:

- Document matching in `filterMatchingDocuments` and
  `SengoCollection.docMatchesFilter`, including retry-time filter validation.
- Query comparison and `$exists` evaluation, while preserving the operator's
  existing comparison semantics outside of field lookup.
- Index key extraction, index query-key construction, and final-field
  filtering in S3 and Memory paths.
- Sort-key resolution for dotted scalar paths. Multikey sorting must have a
  separately specified value-selection rule before being claimed compatible.
- Explain expression field identification should report the original dotted
  path while instrumentation uses the resolved values only internally.

Do not silently expand this to unsupported path syntax such as positional
update operators, array filters, or escaped/literal dots in field names.
Nested-object `$set` may be added as a separate consumer of a shared setter
when its behavior is specified; array positional `$set` remains out of scope.
If nested `$set` is not part of unique-index implementation, document it as
deferred rather than implementing a second, index-specific path walker.

Test the utility itself independently from indexing, then add integration
tests showing the same path yields consistent results in regular filters,
`$exists`, index lookup, compound tuple extraction, and update filter
revalidation. This prevents a future query-only implementation from diverging
from index behavior.

### Index key extraction

Add a shared extractor that accepts a normalized ordered index definition and
a document and returns:

1. The distinct complete logical tuples for that document.
2. The corresponding entry-group key(s) used by the current layout.
3. For each membership, the final-field value needed for compound filtering
   and sort ordering.

The extractor must consume the shared field-path result and apply only
index-specific tuple rules. It must distinguish “no value” from an empty
result until MongoDB's null-like key rule is applied. For array-valued paths,
de-duplicate complete tuples within the document before mutating entries. In
a compound index, form tuples using shared traversal provenance and reject
parallel independent array expansions.

When two indexed dotted paths descend through the same embedded-document
array, use the provenance from the shared resolver to preserve element
association and avoid cross-element tuples. Do not copy or fork traversal
logic in the index extractor. Cover correlated and parallel-array cases in
both utility and index integration tests.

For `{ category: 1, priority: 1 }`, the logical memberships are
`(category, priority)` tuples. The physical entry key remains based on the
leading `category`; the entry retains each final `priority` per membership.
An identical tuple is a duplicate only if its owner `_id` differs.

The current `IndexEntry` model assumes one sort value per `_id`. Generalize it
to store memberships (document ID plus final value/tuple identity), allowing
one document ID to occur more than once in one grouped entry when it owns
different multikey tuples. Query materialization must return each document ID
once, including after final-field filtering, and sorting/limit must operate on
the membership values before ID de-duplication without changing existing
scalar-index behavior. Decode existing `["id"]` and `[["id", value]]` entries;
preserve their current serialization when they represent scalar memberships.
Add an explicit version or unambiguous membership encoding for entries that
need multiple values per ID.

For unique indexes, encode leading components with type information and
unambiguous boundaries before URI escaping, rather than interpolating raw
values. The final field remains in the entry membership and is compared using
the shared canonical tuple function. This prevents path collisions between
different BSON types without introducing another S3 lookup.

### Ownership and mutation operations

Represent index membership operations explicitly as `claim`, `release`, or
`replace` for a document's old/new extracted tuples. `CollectionIndex` exposes
whether it is unique and provides a check/claim operation that receives the
document ID and tuple membership; backend-specific persistence remains inside
Memory/S3 index implementations. A duplicate error should include the
collection, index name, and offending key and use `DuplicateKeyError` (code
11000).

Do not implement uniqueness as a collection query followed by a write. That
would scan/fetch documents, add S3 costs, and leave a check-then-write race.
The index entry object is the authority for ownership:

- A single-field scalar value maps directly to its unique entry object.
- A compound tuple maps to its grouped entry object, where the final value
  distinguishes complete tuples.
- A multikey document claims each distinct generated tuple in only the entry
  object(s) that encode those tuples.
- Releasing an entry removes only memberships owned by the requested `_id`;
  it never removes or overwrites another owner.

All document/index writes and index builds for one `CollectionStore` go
through one shared per-collection write queue, rather than being split between
`SengoCollection` and backend implementations. A single queue is preferred to
multi-key locks for the initial single-process scope: it avoids deadlocks
between a document's old and new multikey memberships and makes local
concurrency deterministic. Do not mistake this in-process queue for a
distributed lock: separate store instances have separate queues.

Operation order:

1. **Insert:** derive tuples; claim unique memberships; write the document
   conditionally; then maintain non-unique indexes. If document insertion or
   later maintenance fails, release only this operation's newly claimed
   memberships and report the original error (plus cleanup failure if cleanup
   also fails). Duplicate detection happens before the document object is
   written.
2. **Update:** load the authoritative old document using the existing `_id`
   conditional-write path and apply the update to that record. Derive old and
   new memberships. Keep unchanged memberships; claim all new unique
   memberships before changing the document; conditionally write the document;
   then release old unique memberships and update non-unique indexes. On
   document-write failure, release only newly claimed memberships. Do not
   release old ownership before the new document write succeeds.
3. **Delete:** conditionally delete the document first; only after confirmed
   deletion release its index memberships. If index cleanup fails, propagate
   the failure and retain enough ownership/recovery information to retry
   cleanup; never release an entry before the document delete succeeds.
4. **Create/backfill:** build a private, unpublished index from existing
   documents, validating each membership and reporting duplicate owners.
   Publish metadata and add the index to the store's active map only after a
   complete successful build. On duplicate/build failure, delete partial
   entry objects and leave no active unique metadata. Backfill is the one
   explicitly allowed collection scan.

Where one operation touches several unique indexes or several multikey
entries, make the action order deterministic. If a later claim fails, release
earlier claims made by that operation. Since S3 offers no transaction across
entry objects and the document object, compensation is best-effort and errors
must remain explicit; do not convert cleanup failure into apparent success.
For ambiguous S3 responses, re-read only the specific affected entry/document
objects before compensating. Never list or scan the collection to recover a
write.

For a failed compensation or post-delete release, track the specific owner and
entry as suspect in the store. A normal duplicate check trusts the exact index
entry and must not fetch the owner document. Only if the requested tuple
collides with a membership explicitly marked suspect by a failed operation
may repair read that one `/data/<id>.json` document, recompute its tuple
membership, and remove that stale membership with a conditional entry write.
The per-store write queue ensures this repair cannot remove a local in-flight
claim. This targeted recovery is exceptional and must never become a routine
duplicate check or collection scan.

If compensation itself fails, report both the operation and cleanup failures
and keep the affected entry marked unusable/suspect until targeted repair
succeeds. After process loss, an unmarked stale membership may remain and
conservatively block a future key; eliminating that crash window without a
durable intent protocol is a known limitation. Do not silently claim full
crash-atomicity across S3 objects. A cross-process reservation protocol must
also distinguish a live pending claim from a stale one; it is not part of the
supported write protocol and remains a separate recovery gap covered by an
expected-failure probe.

The collection/store boundary should own this sequencing. `SengoCollection`
continues to validate the public call and produce the MongoDB-style result;
`CollectionStore` owns document persistence and its index-maintenance protocol.
This avoids the current “write document, then update indexes” path from
reporting a duplicate after the document is already stored.

### Metadata, index build, and reopen

Extend `CreateIndexOptions` and the store/index creation contracts with
`unique?: boolean`. Normalize absent/false to non-unique. Persist `unique:
true` only for unique indexes; old metadata without the field reloads as
non-unique. `listIndexes()` adds `unique: true` only for those indexes,
including on an S3 store reopened from metadata.

An index name already present with the same keys/options should follow a
documented idempotent or conflict behavior; do not silently overwrite an
existing non-unique index with a unique one. Validate option and key forms
before writing metadata. The `_id` index remains unique by definition and
does not need a second user-created index to enable `_id` duplicate checking.

Move index backfill ownership to one layer (preferably the store's
`createIndex`) so the current store scan plus `SengoCollection.createIndex`
second pass cannot duplicate work. Do not publish unique metadata before
validation/build completes. Within one store, pause writes to that collection
while building/publishing to prevent a local write from slipping between the
scan and activation. Independent-process build/write coordination remains
unsupported; the required operational procedure is to pause writers during the
build and recreate application stores before resuming them.

### Query/read path and S3 request budget

Unique indexes use the same read path, planner, entry grouping, and
candidate materialization as non-unique indexes. Uniqueness is write-time
metadata/validation and must add no read-time S3 request:

- Do not read a second “unique ownership” object or perform a separate
  uniqueness lookup during `find`.
- Keep final-field tuple filtering in the existing index-entry read for exact
  compound queries.
- Keep prefix sort/limit optimization and candidate document fetch counts
  unchanged.
- Support query evaluation for dotted indexed paths and scalar equality
  against a multikey path using the shared field-path utility. Query matching,
  explain expression identity, and index candidate selection must agree on
  the same path semantics.

Tests compare a unique index and an otherwise identical non-unique index,
after identical setup and cache warm-up, for:

1. Single-field equality lookup.
2. Exact compound tuple lookup, proving the final field filters in the entry.
3. Compound-prefix sort/limit lookup.
4. Dotted/multikey indexed-field lookup.

Compare all `HeadObject`, `GetObject`, and document operations by key and
command. Unique-index execution must have no greater request count than the
non-unique equivalent and must not fetch extra documents. Keep metadata
initialization outside the measured operation or include equivalent metadata
work in both sides.

### Write lookup budget and scan prohibition

Uniqueness checks must read/write only the exact unique index entry object(s)
produced from the document's extracted keys. Normal insert/update/delete may
read the target document where required by existing conditional-write
semantics, and must write that document on success; they must not fetch other
documents to check uniqueness.

For S3 mutation, use one authoritative `GetObject` of each affected entry to
obtain both its contents and ETag, validate ownership, and submit the
conditional `PutObject` from that same snapshot. Do not first call the
cache-validating `fetch` path and then independently reload the object in
`persistEntry`; that doubles the index-entry reads. On `IfMatch` /
`IfNoneMatch` conflict only, reload that same entry, replay the operation,
recheck for duplicate ownership, and retry. A no-conflict single-entry claim
therefore has one index-entry read and one conditional write; each retry adds
only a read/write against that same key. A missing object is read once and
created with `IfNoneMatch: '*'`. Keep this mutation path separate from the
query cache path so it never relies on a stale in-process entry.

Add request-recorder assertions that reject:

- `ListObjectsV2` over the collection's `/data/` prefix during ordinary
  insert/update/delete or unique constraint validation.
- `GetObject` on any unrelated `/data/<id>.json`.
- Reads or writes of an index entry not belonging to the operation's old,
  new, or claimed tuple keys.
- Additional reads of the same unique entry beyond the established index
  persistence protocol.

The current simulator `getLogs()` reports index/document `GetObject` and
`PutObject`, but not every S3 command or `ListObjectsV2`. Wrap the simulator
client in a test recorder (or extend its existing test-only log) that records
command name, key, prefix, and conditional headers. Do not infer “no scan”
from an empty document-fetch list alone.

### Explain behavior

Keep explain serialization centralized in `client/src/client/explain.ts`.
Report the existing write-cost fields for the index entries actually read or
updated; uniqueness must not fabricate a query scan or add reads to query
explain. On a duplicate write, explain must report failure and the attempted
index name/key entry without counting a document write that did not occur.
If cleanup is attempted after a failure, include the actual entry writes in
the write-cost/error instrumentation.

### Focused test matrix

**Supported tests (must pass):**

- Unique single/compound index positive and duplicate cases in Memory and S3.
- Compound tuples sharing leading values but differing in final value both
  succeed; identical full tuple fails.
- Missing/null equivalence, one missing/null value in unique single-field
  index, and distinct compound tuples where one component is missing/null.
- Dotted object paths, arrays of scalar values, and dotted paths through arrays
  of embedded documents; duplicate keys inside one document are deduplicated.
- Standalone field-path utility tests for missing versus null, nested object
  reads, array traversal, empty arrays, and correlated array ancestry; verify
  query matching and index extraction consume the shared utility.
- Parallel arrays rejection, duplicate data during index backfill, drop and
  recreate behavior, metadata reload, update tuple swap/claim/release, delete
  then reuse, and failed document-write compensation.
- Non-unique duplicate behavior is unchanged.
- Read request budgets and explicit no-scan assertions described above.

**Cross-process probes and known build limitation:**

- Independent S3 clients racing to insert the same single-field tuple: exactly
  one winner and one `DuplicateKeyError`.
- Independent clients racing to insert the same compound tuple, plus distinct
  final values sharing the same grouped entry: the former conflicts, the
  latter both survive.
- Stale independent clients adding different tuples to the same group: CAS
  reload/replay preserves both without a false duplicate.
- Independent clients claiming the same tuple via update: at most one commits.
- Independent clients writing distinct entry keys concurrently: both commit.
- Unique index backfill racing a write: this remains an expected-failure
  recovery-gap probe; callers must pause writes during index creation.

The runtime write probes use independent stores/index caches over one shared
simulator. The build-race probe demonstrates the unsupported online-build case;
it does not weaken the guarantee for writes made after clients have loaded an
already-built index.

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
- **Given** unique-index reads compared with equivalent non-unique indexed reads, **when** each executes after equivalent setup/cache warm-up, **then** unique reads issue no additional S3 requests and fetch no extra documents.
- **Given** an ordinary insert, update, or delete, **when** unique constraints are checked, **then** only exact relevant index-entry objects are touched and no collection data listing or unrelated document fetch occurs.
- Missing/null and array-valued field behavior follows the decisions in “Compatibility and explicit boundaries”. Sparse and partial unique indexes remain out of scope.

## Implementation sequence and gates

1. Run full `npm test` for a fresh baseline. Any reused document-path
   assertions must target `/data/`. Keep upsert and `$setOnInsert` out of
   scope.
2. Add API/options and persisted metadata; test `listIndexes()`, S3 metadata
   reload, and unchanged non-unique behavior.
3. Implement and independently test a shared document field-path utility;
   integrate it into query matching and filter validation before consuming it
   from index extraction. Keep the utility free of index-specific policy.
4. Implement shared typed tuple extraction and membership-aware entry
   storage; keep the existing scalar entry format readable.
5. Integrate unique claim/release sequencing into Memory/S3 store writes and
   backfill, with explicit compensation and no collection scans for ordinary
   writes.
6. Add deterministic request-budget tests for indexed reads and explicit scan
   rejection for writes; verify explain counters describe actual requests.
7. Test cross-process writes to already-loaded unique indexes, and keep the
   unsupported online-build race as an explicit expected-gap probe.
8. Update supported-feature documentation and `/sengo` references; run
   focused tests, build/type checks, and full `npm test`. Compare against
   baseline and report passed, failed, and skipped counts.

## Test fixtures

No unique-index test file is currently present in the active `client/tests`
tree. Add the supported cases as a new Vitest suite using the existing S3
simulator, and target the actual `/data/` document prefix. Do not include
`createIndex` backfill in ordinary-write request-budget tests: building a new
index must enumerate existing documents, but subsequent ordinary writes must
not scan the collection. Cross-process probes must use separate stores over a
shared simulator; a single client with `Promise.all` is not sufficient to
validate process isolation.

Upsert and `$setOnInsert` tests remain outside this feature; they cover
separate behavior.
