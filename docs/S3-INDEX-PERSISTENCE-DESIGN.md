# S3 Index-Entry Persistence Design

## Goal and scope

Extend conditional-write correctness from document objects to S3 index-entry objects. Multiple Sengo clients may run in independent Lambda processes with separate memory, caches, and `S3CollectionIndex` instances. S3 is the only shared coordination mechanism.

This is shared storage behavior for all S3 indexes and a prerequisite for correct unique-index enforcement. It must preserve current non-unique index behavior: adds/removes from independent writers must not overwrite each other.

In scope:

- Conditional S3 writes for existing and missing index-entry objects.
- Reload-and-reapply of local index changes after ETag conflicts.
- Correct S3 error propagation and observable persistence completion.
- Deterministic independent-instance concurrency tests.
- Keep S3 ETag and conditional request details private to the S3 implementation.

Out of scope:

- Unique-key validation or metadata/API changes.
- A transaction spanning document writes and multiple index-entry objects.
- Guaranteeing all index entries remain consistent after process termination between separate S3 writes. Persistence failures must be exposed; any recovery/repair protocol beyond safe retries must be specified separately.

## Current behavior and defects to address

1. `S3CollectionIndex.persistEntry()` sends an unconditional `PutObject`. Its 409/412 branch is therefore not backed by conditional request headers.
2. On conflict, current retry logic reloads a mutable cached `IndexEntry`. It does not clearly preserve and replay an immutable per-operation delta against authoritative state.
3. `fetch()` catches broad errors and returns an empty entry. Network, permissions, stream, or parse failures can therefore be mistaken for a missing object and lead to overwrite.
4. After three conflicts, persistence is scheduled with `setTimeout` and the current task returns as though persistence finished. A caller can observe success before the write commits.
5. `_backgroundPersistTask()` rejection is not retained/observed by `_triggerPersist()`. `flush()` can wait for queue counters without surfacing a failed task.
6. `IndexEntry` is shared generic index data but currently contains `etag` and methods that accept ETags. This leaks S3 storage metadata into the shared index model.
7. Pending `added`/`removed` state is not visibly finalized/reset after successful persistence. Retained deltas can be replayed on later refreshes and must be examined as part of the change.
8. The existing `ConcurrentIndexUpdate.test.ts` uses two stores sharing one simulator but performs writes sequentially. It does not force both writers to read stale state or prove conditional conflict/replay.

## Proposed design

### Separate logical entry changes from S3 state

Represent intended local changes as immutable logical operations, independent of S3:

```ts
export type IndexEntryMutation =
  | { kind: 'add'; id: string; sortValue?: unknown }
  | { kind: 'remove'; id: string };
```

This is a design sketch, not a required final exported API. Keep the mutation type in shared index code only if both backends need it. Keep ETag, object-exists state, and request headers in `S3CollectionIndex`, for example:

```ts
type S3IndexEntryState = {
  entry: IndexEntry;
  etag?: string;
  exists: boolean;
};
```

The shared `IndexEntry` should model IDs, sort values, serialization, and logical add/remove behavior. It should not own an S3 ETag. S3-specific cache state should pair that data with its ETag and existence state.

### Conditional compare-and-swap loop

For each persisted entry mutation:

1. Read the current object body and ETag from S3. Use an empty entry only when S3 explicitly reports the object does not exist.
2. Apply the operation's captured mutations to that entry.
3. If the object existed, `PutObject` with `IfMatch: <loaded ETag>`. If it was confirmed missing, use `IfNoneMatch: '*'`.
4. On 409/412, reload S3 and replay the same logical mutations against the new entry. Do not write a stale serialized snapshot.
5. On successful write, update the local S3-specific ETag state and acknowledge the operation.
6. Bound retries. If the bound is reached, throw a clear concurrency error to the waiting caller. Do not schedule a delayed retry and return success.
7. Propagate non-conditional S3 errors. Do not reinterpret them as an empty entry.

Concurrent writers to the same entry in one process should also be serialized or isolated by immutable mutation snapshots. Otherwise one caller could clear or accidentally include another caller's pending delta. The simplest design should be selected after examining existing batching/performance expectations; per-key serialization is the default recommendation.

### Persistence completion and errors

`addDocument`, `removeDocument`, `updateIndexOnDocumentUpdate`, and `flush` must have a clear await contract. A caller that awaits the operation responsible for a mutation must not receive success before that mutation is durably persisted, or before an explicitly documented enqueue contract. Prefer awaiting persistence for each changed entry; retain parallelism across distinct keys if safe.

If existing background persistence is retained instead:

- Associate each queued mutation with a completion promise.
- Record every task failure and reject the corresponding operation/`flush()`.
- Prevent unhandled background rejections.
- Ensure queue state, pending mutation state, and ETag state only advance after confirmed success.

Do not silently treat bounded retry exhaustion as success.

### Missing object vs. other failures

`fetch()` may create an empty entry only for an explicit S3 missing-object result (`NoSuchKey`/documented equivalent). Network timeouts, access-denied responses, malformed JSON, and stream failures must propagate. A stale cache entry must be replaced or invalidated when S3 confirms that the object is missing.

### Consistency boundary

S3 conditional writes serialize modifications to one entry object. They do not make a document write and index-entry write atomic, nor do they make updates across multiple index-entry files transactional. Index persistence failure must be surfaced. The caller may already have written the document when index maintenance fails; this partial-operation behavior must be explicit and must not be reported as a successful fully indexed write. Unique-index enforcement may require additional compensation/reconciliation.

## Type and file impact

Likely implementation/test surfaces:

- `client/src/repository/collectionIndex.ts`
  - Separate logical entry mutations from persistence metadata.
  - Remove ETag from the generic `IndexEntry` model if no backend-neutral use exists.
  - Ensure successful persistence finalizes pending deltas without losing later concurrent changes.
- `client/src/repository/s3/s3CollectionIndex.ts`
  - Store ETag/existence in S3-private state.
  - Use `IfMatch`/`IfNoneMatch`, authoritative reload, replay, bounded surfaced errors, and reliable flush/error tracking.
- `client/tests/repository/s3/S3BucketSimulator.ts`
  - Preserve atomic conditional PutObject behavior; expose enough write-condition details to assert headers.
  - Add deterministic hooks/barriers for stale reads and controlled S3 failures.
- `client/tests/repository/s3/ConcurrentIndexUpdate.test.ts`
  - Add separate-client races against one shared simulator, forced to read the same initial state.
- `client/tests/repository/s3/s3CollectionIndex.test.ts`
  - Assert create-vs-update conditions, retries, missing-object semantics, and failure propagation.
- `client/tests/repository/s3/s3CollectionStore.index.test.ts`
  - Verify public index mutations and `flush()` do not report success before persistence completes.
- Existing `IndexEntry` tests
  - Verify ordering, serialization compatibility, add/remove replay, and delta finalization.

Do not add ETag, conditional-write, or retry parameters to `CollectionStore`, `CollectionIndex`, or public client APIs.

## Given / When / Then requirements

### Independent writers, same existing entry

- **Given** two independent S3 index instances read the same entry and ETag, **when** both add different IDs, **then** one conditional write wins, the other receives an ETag conflict, reloads and reapplies its own addition, and the final S3 entry contains both IDs.
- **Given** two independent instances read the same entry, **when** one removes ID A while another adds ID B, **then** conflict/reload preserves the removal of A and addition of B.
- **Given** two non-unique writers add different IDs for the same indexed value, **when** they race, **then** both IDs remain in the final entry.

### Independent writers, missing entry

- **Given** the same entry object is absent and two independent instances read it as absent, **when** both attempt their first write, **then** one `IfNoneMatch: '*'` succeeds and the other reloads and merges its own mutation; neither overwrites the other's ID.

### Correct conflict classification and retries

- **Given** a stale ETag, **when** the conditional write fails, **then** the code reloads and replays the operation; the conflict alone is not treated as an application-level duplicate or silently ignored.
- **Given** conflicts persist beyond the configured bound, **when** the operation completes, **then** its awaiting caller receives an explicit concurrency error and no delayed background retry is represented as success.
- **Given** a conditional conflict followed by a successful reload/retry, **when** persistence completes, **then** the returned/cached ETag corresponds to the committed version and that operation's pending delta is finalized exactly once.

### Errors and completion

- **Given** S3 confirms an entry is missing, **when** it is fetched, **then** an empty entry with no ETag is used.
- **Given** S3 returns a network, authorization, stream, or malformed-data error, **when** an entry is fetched, **then** the error propagates and no empty entry is written over the existing object.
- **Given** index persistence fails, **when** the mutation or `flush()` is awaited, **then** the failure is surfaced and no unhandled background rejection occurs.
- **Given** an index mutation is queued, **when** the public operation resolves successfully, **then** the documented completion contract has been met (preferably, the mutation is persisted).
- **Given** document persistence succeeds but subsequent index persistence fails, **when** the client operation returns, **then** it reports failure rather than full success; documentation/tests acknowledge that S3 offers no cross-object transaction and the document may require reconciliation.

### Compatibility

- **Given** existing serialized entry formats (`["id1", "id2"]` and `[["id1", sortValue], ...]`), **when** loaded and updated, **then** they remain readable and sort order remains unchanged.
- **Given** normal single-process Memory index operations, **when** entries are added/removed, **then** current behavior remains unchanged without introducing S3-specific types.
- **Given** query/sort/limit operations on S3 indexes, **when** persistence is made conditional, **then** index selection, final-field ordering, and document-fetch optimization remain unchanged.

## Test harness design

Use two independent `S3CollectionStore` / `S3CollectionIndex` instances with private caches and one shared `S3BucketSimulator`. A single store with `Promise.all` is insufficient because it does not exercise separate in-memory state.

Use deterministic read coordination, not timing sleeps:

- Pause two reads after both have returned the same body/ETag, then release them together.
- Capture conditional headers for each PutObject.
- Ensure simulator conditional checks and writes execute atomically.
- Exercise missing-object creation and injected conflict/failure paths.

Tests must assert both final stored JSON and request conditions. `ConcurrentIndexUpdate.test.ts` uses a gated S3 client over the shared simulator to force stale-read races.

## Implemented behavior

- `IndexEntry` records ordered, sequence-numbered add/remove operations and can replay unacknowledged operations onto refreshed serialized data. The shared entry has no ETag state.
- `S3CollectionIndex` stores object existence and ETags privately, reloads the authoritative entry before each write, and uses `IfNoneMatch: '*'` for creation or `IfMatch` for replacement.
- Conditional conflicts trigger an initial attempt plus up to three load/replay retries. Exhaustion and other S3 failures reject the mutation; no delayed retry is reported as success.
- Mutations to the same entry key are serialized within one process. Mutations to distinct keys remain parallel. A successful awaited mutation is persisted before it resolves.
- `flush()` waits for outstanding writes and reports persistence failures. It also reports failures retained from mutations that completed unsuccessfully before `flush()` was called.
- Fresh reads before writes add an S3 read to index-entry mutations. This is intentional: it supplies the authoritative body and ETag needed to merge independent processes safely.
- Deterministic two-instance tests gate reads after both responses are captured, then verify conditional conflicts and replay for create, add/add, and add/remove races.

## Implementation sequence

1. Run full `npm test` and record exact baseline test-file/test counts. Inspect focused S3 index tests and current index-entry serialization tests.
2. Specify the logical mutation/replay contract and remove S3 ETag ownership from shared entry types, preserving old serialized formats.
3. Add deterministic simulator support and focused tests first: conditional create, conditional update, simultaneous stale reads, add/add, add/remove, and error propagation.
4. Implement S3-private ETag state, conditional writes, fresh reload/replay, and bounded surfaced retries.
5. Make completion/error semantics reliable through `addDocument`, `updateIndexOnDocumentUpdate`, and `flush`; retain per-key serialization or another proven mechanism for same-process races.
6. Run focused S3 index tests and relevant collection/index tests; fix behavior changes or regression risks.
7. Run the full `npm test` suite and compare against baseline. Verify previous explain-mode, index optimization, and conditional-write tests remain passing.
8. Update [INDEX-DESIGN.md](./INDEX-DESIGN.md) and this phase plan only if behavior or accepted limitations differ from this design.

## Exit criteria

This design is implemented only when:

- Every changed existing entry is persisted with the loaded ETag; every new entry uses conditional create.
- Cross-process stale reads deterministically demonstrate no lost additions/removals.
- Conflict retry reloads and reapplies the original logical delta.
- Missing-object handling is distinct from other S3 failures.
- Awaited operations/flush surface final persistence failures and retry exhaustion.
- Existing serialization, query, sort/limit, Memory behavior, and full test suite show no regressions.
- No S3-specific metadata leaks into generic collection/store/index contracts.
