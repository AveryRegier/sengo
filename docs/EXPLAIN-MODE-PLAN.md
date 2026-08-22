# Explain Mode Plan for Sengo

## Purpose

Define an explain mode that gives practical visibility into query and write cost for Sengo's S3-backed storage engine, with rough compatibility to MongoDB explain output styles.

Compatibility principle:

- Sengo is a subset of the MongoDB Node.js client.
- New feature behavior must move toward MongoDB compatibility.
- If an incompatibility is identified, fix the incompatibility first or explicitly gate the feature until parity is restored.

This plan targets the following outcomes:

1. Show index choices, index-entry reads, document loads, and sort/limit optimization impact.
2. Show when a scan happens.
3. Show why indexes were chosen or skipped.
4. Show expressions skipped because they are not implemented.
5. Show whether each expression is applied in index space or after document load.
6. Show write cost, including how many and which index entry files were updated.
7. Show cache usage, including file-cache hit/miss statistics per collection and per index.

## Current Behavior Snapshot

- Query candidate selection happens in `S3CollectionStore.findCandidates` and falls back to `scan`.
- Index suitability/scoring is in `BaseCollectionIndex.canSatisfyQuery` and `scoreForQuery`.
- Index key generation is in `findKeysForQuery` and only supports direct equality, `$eq`, and `$in` for index-path fields.
- Final-field filtering and sort/limit optimization happen in `IndexEntry.toArray`.
- Post-load filtering happens in `SengoCollection._findFilterSort` via `match` and `evaluateComparison`.
- Unknown operators currently do not fail matching and are effectively treated as no-op in expression evaluation.

## Proposed Public API

### Query Explain

Primary API (Mongo-style):

- `collection.find(query, { sort, limit, explain: 'queryPlanner' | 'executionStats' | 'allPlansExecution' })`
- `collection.findOne(query, { sort, explain: 'queryPlanner' | 'executionStats' | 'allPlansExecution' })`

Verbosity options:

- `queryPlanner`: plan only, no execution counters.
- `executionStats`: plan plus execution counters.
- `allPlansExecution`: include rejected candidate plans with reasons and estimated costs.

Return behavior:

- When `explain` is present, return explain output instead of normal document results.
- When `explain` is absent, behavior remains unchanged.

### Write Explain

Primary API:

- `collection.insertOne(doc, { explain?: ExplainVerbosity })`
- `collection.updateOne(filter, update, { explain?: ExplainVerbosity })`
- `collection.deleteOne(filter, { explain?: ExplainVerbosity })`

Behavior:

- By default, executes the write.
- If `explain` is present, return write explain output (including normal operation result payload under `result`).
- Optional `dryRun` can be added in a later phase (more complex for exact index impact).

## Explain Encapsulation Contract

Explain design must be encapsulated in a single file:

- `client/src/client/explain.ts`

This file owns:

- explain interfaces and types used by callers
- step/event collection API
- explain result serializer (Mongo-like shape adapted for Sengo)

The rest of the codebase must not assemble explain payloads directly.
Runtime components only emit step events through the interface.

### Interface-Driven Flow

Always create an `ExplainSink` from `explain.ts`:

- when `options.explain` is set: use collecting sink implementation
- when `options.explain` is not set: use `NullExplainSink` implementation

Runtime modules should call explain hooks unconditionally through the sink.
This avoids repeated conditional checks across query/write/index code paths.

Behavior:

- collecting sink records events for index access, key expansion, entry reads, document loads, scan fallback, expression evaluation location, and write index-file updates
- null sink methods are no-op and allocate no step buffers
- existing behavior/perf remains unchanged when explain is disabled
- serializer in `explain.ts` is used only when final response requires explain output

Design note:

- The interface + null implementation pattern is the preferred baseline because it keeps call sites clean and keeps explain disabled overhead minimal.

Illustrative shape:

```ts
export interface ExplainSink {
  onStep(step: ExplainStep): void;
  toResult<T>(args: SerializeExplainArgs<T>): ExplainResult<T>;
}

export class NullExplainSink implements ExplainSink {
  onStep(_step: ExplainStep): void {}
  toResult<T>(_args: SerializeExplainArgs<T>): ExplainResult<T> {
    throw new Error('NullExplainSink does not serialize explain output');
  }
}
```

## Explain Result Shape (Draft)

```ts
type ExplainVerbosity = 'queryPlanner' | 'executionStats' | 'allPlansExecution';

type ExplainResult<T = unknown> = {
  ok: 1;
  namespace: string;
  command: {
    type: 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'deleteOne';
    query?: Record<string, unknown>;
    options?: Record<string, unknown>;
  };
  queryPlanner?: {
    winningPlan: PlanSummary;
    rejectedPlans?: PlanSummary[];
    plannerWarnings: string[];
  };
  executionStats?: {
    stage: 'INDEX_LOOKUP' | 'COLLECTION_SCAN' | 'ID_LOOKUP';
    indexName?: string;
    indexKeysExamined: number;
    indexEntriesLoaded: number;
    candidateIds: number;
    uniqueCandidateIds: number;
    documentsLoaded: number;
    documentsMatchedAfterLoad: number;
    sortAppliedAfterLoad: boolean;
    limitAppliedAfterLoad: boolean;
    indexSortLimitOptimization: {
      used: boolean;
      reason?: string;
    };
    scanReason?: string;
    expressionStats: Array<{
      field: string;
      operator: string;
      implemented: boolean;
      appliedAt: 'index' | 'postLoad' | 'notApplied';
      note?: string;
    }>;
    cacheStats?: {
      collection: {
        name: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheHitRate: number;
      };
      indexes: Array<{
        indexName: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheHitRate: number;
      }>;
    };
  };
  writeStats?: {
    documentWrites: number;
    indexMetadataWrites: number;
    indexEntryFilesUpdated: string[];
    indexEntryUpdatesCount: number;
    flushWaitMs?: number;
  };
  result?: T;
};
```

## Efficient Explain Collection Schema

The collector schema should optimize for low overhead and deterministic aggregation.

### Design Constraints

- Emit compact, typed step events with minimal payload.
- Prefer aggregated counters over per-document events.
- Use operation-scoped IDs so nested operations (for example update -> find) can be merged safely.
- Keep all event types and serializers in explain.ts.

### Step Event Types

```ts
type ExplainOperationType = 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'deleteOne';

type ExplainStage = 'ID_LOOKUP' | 'INDEX_LOOKUP' | 'COLLECTION_SCAN';

type ExplainReasonCode =
  | 'missingLeadingField'
  | 'missingNonFinalField'
  | 'unsupportedLookupOperator'
  | 'sortFieldMismatch'
  | 'scoreLowerThanWinner'
  | 'noUsableIndexKeysFromQuery'
  | 'forcedIdLookup'
  | 'scanFallback';

type ExplainStep =
  | {
      kind: 'op.start';
      opId: string;
      opType: ExplainOperationType;
      namespace: string;
      verbosity: ExplainVerbosity;
      hasSort: boolean;
      hasLimit: boolean;
    }
  | {
      kind: 'plan.candidate';
      opId: string;
      indexName: string;
      score: number;
      accepted: boolean;
      reason?: ExplainReasonCode;
      note?: string;
    }
  | {
      kind: 'plan.winner';
      opId: string;
      stage: ExplainStage;
      indexName?: string;
      scanReason?: string;
    }
  | {
      kind: 'index.keys';
      opId: string;
      indexName: string;
      keyCount: number;
    }
  | {
      kind: 'index.entries.read';
      opId: string;
      indexName: string;
      entryFilesRead: number;
      candidateIds: number;
      uniqueCandidateIds: number;
    }
  | {
      kind: 'docs.loaded';
      opId: string;
      collection: string;
      count: number;
      source: 'idLookup' | 'indexLookup' | 'scan';
    }
  | {
      kind: 'docs.matched';
      opId: string;
      matchedAfterLoad: number;
    }
  | {
      kind: 'sort.limit';
      opId: string;
      sortAppliedAfterLoad: boolean;
      limitAppliedAfterLoad: boolean;
      indexOptimizationUsed: boolean;
      indexOptimizationReason?: string;
    }
  | {
      kind: 'expr.stat';
      opId: string;
      field: string;
      operator: string;
      implemented: boolean;
      appliedAt: 'index' | 'postLoad' | 'notApplied';
      note?: string;
    }
  | {
      kind: 'cache.event';
      opId: string;
      scope: 'collection' | 'index';
      collection: string;
      indexName?: string;
      cacheType: 'file';
      event: 'hit' | 'miss' | 'stale';
    }
  | {
      kind: 'write.cost';
      opId: string;
      documentWrites: number;
      indexMetadataWrites: number;
      indexEntryUpdatesCount: number;
      indexEntryFilesUpdated: string[];
      flushWaitMs?: number;
    }
  | {
      kind: 'op.end';
      opId: string;
      ok: boolean;
      durationMs: number;
    };
```

### Aggregation State Schema

```ts
type ExplainAggregationState = {
  opId: string;
  opType: ExplainOperationType;
  namespace: string;
  verbosity: ExplainVerbosity;

  stage?: ExplainStage;
  winningIndexName?: string;
  scanReason?: string;

  planner: {
    winningPlan?: {
      indexName?: string;
      stage: ExplainStage;
    };
    rejectedPlans: Array<{
      indexName: string;
      score: number;
      reason?: ExplainReasonCode;
      note?: string;
    }>;
    plannerWarnings: string[];
  };

  counters: {
    indexKeysExamined: number;
    indexEntriesLoaded: number;
    candidateIds: number;
    uniqueCandidateIds: number;
    documentsLoaded: number;
    documentsMatchedAfterLoad: number;
  };

  flags: {
    sortAppliedAfterLoad: boolean;
    limitAppliedAfterLoad: boolean;
    indexSortLimitOptimizationUsed: boolean;
    indexSortLimitOptimizationReason?: string;
  };

  expressionStats: Array<{
    field: string;
    operator: string;
    implemented: boolean;
    appliedAt: 'index' | 'postLoad' | 'notApplied';
    note?: string;
  }>;

  cache: {
    collection: {
      name: string;
      fileCacheHits: number;
      fileCacheMisses: number;
      fileCacheStale: number;
    };
    indexes: Record<
      string,
      {
        indexName: string;
        fileCacheHits: number;
        fileCacheMisses: number;
        fileCacheStale: number;
      }
    >;
  };

  write?: {
    documentWrites: number;
    indexMetadataWrites: number;
    indexEntryUpdatesCount: number;
    indexEntryFilesUpdated: Set<string>;
    flushWaitMs?: number;
  };

  startedAtMs: number;
  endedAtMs?: number;
};
```

### Efficiency Rules

- Emit count-based events (for example docs.loaded count) instead of one event per document.
- Deduplicate `indexEntryFilesUpdated` using a Set in aggregation state and serialize as sorted array.
- Do not attach full query documents on every event; only include opId and local context.
- Keep event objects flat and small to reduce GC churn.
- Gate verbose-only fields at serializer time based on verbosity level.

### Serializer Mapping Rules

- `queryPlanner` uses planner state only.
- `executionStats` uses counters, flags, expression stats, and cache stats.
- `cacheStats.fileCacheHitRate` = hits / (hits + misses), with 0 when denominator is 0.
- `allPlansExecution` includes rejected planner candidates and warnings.
- Write explain includes `writeStats` and `result` from underlying operation.

### Required API in explain.ts

```ts
interface ExplainSink {
  onStep(step: ExplainStep): void;
  fork(opType: ExplainOperationType): ExplainSink;
  finalize<T>(result?: T, error?: Error): ExplainResult<T> | undefined;
}
```

- `finalize` returns `undefined` for NullExplainSink and a concrete explain result for collecting sink.
- This avoids throwing in null sink and keeps final return shaping explicit and safe.

## Instrumentation Strategy

### 1) Add an Explain Trace Collector

Add lightweight internal types and a collector object used only when explain is requested.

Encapsulation rule:

- keep collector types, event types, and serializer in `client/src/client/explain.ts`
- avoid spreading explain-shaping logic into repository/client modules

Collector responsibilities:

- Record candidate plan scoring and skip reasons.
- Record index keys looked up and entry-file reads.
- Record number of candidate IDs and dedupe outcome.
- Record loaded documents count.
- Record scan fallback and exact reason.
- Record expression classification: implemented/unimplemented and evaluation location.
- Record write-time index entry file updates and counts.
- Record cache usage stats for file-level cache access.
- Aggregate cache hit/miss counters per collection and per index.

### 2) Query Path Hooks

Hook points and what to capture:

- `SengoCollection._findFilterSort`
  - post-load filter count before/after.
  - whether sort and limit are applied after load.
  - always create and pass an `ExplainSink` (`NullExplainSink` when explain is disabled).
- `S3CollectionStore.findCandidates`
  - all candidate indexes and scores.
  - winning index and rejected reasons.
  - index key list generated and key count.
  - loaded IDs per key and deduped total.
  - fallback to scan reason.
  - record collection-level cache events for any collection file cache in use (or emit explicit zero stats when none exists).
- `S3CollectionStore.scan`
  - list operation count and total document keys discovered.
- `BaseCollectionIndex.canSatisfyQuery`
  - specific missing non-final field or unsupported lookup operator per field.
- `BaseCollectionIndex.scoreForQuery`
  - score details and sort-bonus contribution.
- `IndexEntry.toArray`
  - whether final-field filtering happened in index.
  - whether reverse/sort/limit optimization happened in index.
  - note when sort/limit cannot be satisfied in index.
- `S3CollectionIndex.fetch`
  - emit cache probe events for index-entry file access.
  - emit cache hit/miss/stale result before remote fetch.
  - include `collection`, `indexName`, and `indexKey` metadata on events for aggregation.

Pass-through rule:

- each hook emits structured step events only
- no hook should construct final explain document fields directly
- step emission should not be guarded by per-hook `if (options.explain)` checks

Cache stats rule:

- cache metrics must be event-derived inside `explain.ts` serializer/aggregator
- do not compute cache summary objects directly in storage/index modules

### 3) Expression Capability Reporting

Add operator introspection to classify expressions before evaluation:

- Implement helper to walk query expressions and emit per-field operator rows.
- Mark operator as implemented if it exists in operator registry.
- Mark unknown operators as `implemented: false` and `appliedAt: notApplied`.

Important behavior choice:

- Keep current runtime semantics initially (unknown operators do not fail matches) but always emit warning in explain output.
- Later hardening phase can convert unknown operators into explicit query errors if desired.

### 4) Write Path Hooks

Hook points:

- `SengoCollection.insertOne`
  - document write count.
  - each index maintenance call.
- `SengoCollection.updateOne`
  - find phase explain (optional nested).
  - replace write count.
  - index update calls and which index keys changed.
- `SengoCollection.deleteOne`
  - find phase explain (optional nested).
  - delete write count.
  - index removal calls.
- `S3CollectionIndex.persistEntry`
  - exact S3 index entry object key written.
  - retries/conflicts for cost and diagnostics.

Result requirement for write explain:

- Include explicit list of updated index entry file paths and total count.

## Why Index Was Chosen or Skipped

Standardize reason codes to keep tests stable:

- `missingLeadingField`
- `missingNonFinalField`
- `unsupportedLookupOperator`
- `sortFieldMismatch`
- `scoreLowerThanWinner`
- `noUsableIndexKeysFromQuery`
- `forcedIdLookup`
- `scanFallback`

Each rejected plan row should include:

- index name
- index keys
- score
- reason code
- human-readable note

## Scan Reporting

When scan is used, always report one concrete reason:

- no indexes loaded
- no index can satisfy required non-final fields
- query operators unsupported for index key generation
- index key generation produced empty key list

## Cache Reporting

Explain output must include cache statistics when explain verbosity includes execution details:

- collection-level cache stats
  - fileCacheHits
  - fileCacheMisses
  - fileCacheHitRate
- index-level cache stats for each index touched
  - indexName
  - fileCacheHits
  - fileCacheMisses
  - fileCacheHitRate

If a cache type does not exist yet in current implementation, output explicit zeros instead of omitting fields.

## Index vs Post-Load Expression Reporting

For each predicate/operator:

- `appliedAt: index` when evaluated in `IndexEntry.toArray`.
- `appliedAt: postLoad` when only `match/evaluateComparison` handles it.
- `appliedAt: notApplied` when unimplemented operator is encountered.

This directly answers whether expression filtering happened before or after document fetch.

## Compatibility Notes vs MongoDB

Explain mode should be presented as rough compatibility, not full parity.

Document these differences in output:

- stage names are Sengo-specific (`INDEX_LOOKUP`, `COLLECTION_SCAN`, `ID_LOOKUP`).
- plan cache details are omitted.
- cost model is S3-focused (index entry files and document loads).

## Prerequisite Compatibility Gaps to Address First

Before implementing full explain output, address or explicitly scope these gaps:

1. Explain invocation compatibility surface
  - Validate and match MongoDB-compatible invocation patterns used by Node.js clients in this project context.
  - If current option-based invocation diverges, add compatibility layer first.

2. Unsupported operator semantics
  - Current behavior allows unknown operators to act as no-op during matching.
  - For compatibility and correctness, implement explicit unsupported-operator failure behavior (or strict mode) before relying on explain diagnostics.

3. Planner reason introspection API
  - Existing index suitability APIs are mostly boolean/score oriented.
  - Add reason-returning planner helpers so rejected-plan reasons are first-class and deterministic.

4. Deterministic execution counters
  - Explain depends on stable counts (index entries read, documents loaded, files written).
  - Provide counter capture via internal instrumentation contracts instead of ad-hoc log inference.

5. Deterministic cache counters
  - Explain cache stats require stable, deterministic cache event accounting.
  - Ensure counters are emitted from cache decision points (hit/miss/stale) and aggregated centrally.

6. Write cost lifecycle semantics
  - Define whether write explain reports pre-flush, post-flush, or both.
  - Keep semantics stable to avoid flaky tests and ambiguous behavior.

## Recommended Implementation Order

1. Compatibility guardrail updates
  - unsupported-operator handling
  - explain invocation compatibility validation

2. Planner introspection primitives
  - reason codes emitted by planning functions

3. Cache counter primitives
  - deterministic cache hit/miss event emission at collection/index cache points

4. explain.ts foundation
  - sink interface, null sink, collector sink, serializer

5. Query explain
  - planner and execution stats

6. Write explain
  - index entry file update accounting with defined flush semantics

## Testing Plan

Use Vitest with Arrange-Act-Assert style.

Suggested test files:

- `client/tests/client/explain-find.test.ts`
- `client/tests/client/explain-findOne.test.ts`
- `client/tests/client/explain-write.test.ts`
- `client/tests/repository/explain-planner-reasons.test.ts`

Key assertions:

- winning index name and rejected plans contain stable reason codes.
- `documentsLoaded` decreases when sort/limit optimization applies.
- scan reason is present when no index is usable.
- unimplemented operators are listed in `expressionStats`.
- write explain lists exact index entry files touched.

Use `S3BucketSimulator.getLogs()` to validate document fetch count and index object writes.

## Rollout Plan

Phase 1:

- Add `client/src/client/explain.ts` with interfaces, collector, and serializer.
- Add query planner and execution stats for find/findOne.

Phase 2:

- Add write explain for insertOne/updateOne/deleteOne.
- Add index file touch reporting from S3 index persistence.

Phase 3:

- Add optional command-level explain wrapper parity if needed, while keeping option-based explain as the primary API.
- Add stricter unsupported-operator behavior toggle.

## Documentation Deliverables

- Add user-facing docs section in `README.md` with examples.
- Add advanced detail in `docs/SUPPORTED-COMMANDS-OPERATORS.md` for explain warnings on unsupported operators.
- Add examples of index-optimized vs scan plans with expected fields.

## Implementation Risks

- Over-instrumentation can slow hot paths. Keep collector no-op when explain is not requested.
- Null sink misuse risk: never call serializer path when explain is disabled; branch only at final return-shaping boundary.
- Async index persistence may complete after write call boundaries; include both immediate and post-flush metrics when possible.
- Query normalization for `$or` can obscure original conditions; preserve both original and normalized query in explain output.

## Acceptance Criteria

- Explain output clearly identifies index choice, scan fallback, and reasons for rejected indexes.
- Explain output distinguishes index-time filtering from post-load filtering.
- Explain output lists unimplemented operators encountered in the query.
- Write explain includes count and exact paths of index entry files updated.
- Existing non-explain behavior remains unchanged.
