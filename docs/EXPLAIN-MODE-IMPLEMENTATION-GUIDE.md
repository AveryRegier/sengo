# Explain Mode Implementation Guide

## Goal check

The original explain-mode goals were:

1. Show index choice, index-entry reads, document loads, and whether sort/limit optimization helped.
2. Show when a scan happens.
3. Show why an index was skipped or chosen.
4. Show expressions skipped because they are not implemented.
5. Show whether a filter was evaluated in index space or after document load.
6. Show write cost, including how many and which index files were updated.
7. Show cache usage per collection and per index.

## Current status

### Achieved

The current implementation in [client/src/client/explain.ts](../client/src/client/explain.ts), [client/src/client/collection.ts](../client/src/client/collection.ts), [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts), [client/src/repository/s3/s3CollectionStore.ts](../client/src/repository/s3/s3CollectionStore.ts), and [client/src/repository/memory/memoryCollectionStore.ts](../client/src/repository/memory/memoryCollectionStore.ts) covers the main lifecycle and aggregation flow.

It provides:

- `ExplainSink` and `NullExplainSink` / `CollectingExplainSink`
- plan winner and rejected-plan tracking
- index key and entry read accounting
- document load accounting
- scan fallback reporting
- cache hit/miss stats per collection and index
- timing aggregation (`onTimingPart`)
- write cost stats (`onWriteCost`)
- explain serialization via `finalize()`

This is a strong match for the intended architecture: runtime code emits direct sink calls rather than branching explain-only logic.

### Partially achieved

The current implementation is solid for basic read-query explain output, but it still does not fully satisfy all original goals in a Mongo-like, deep-inspection sense.

#### 1) Index choice, docs loaded, and optimization impact

Achieved in a basic form:

- `onPlanWinner` records the winning stage and index
- `onIndexEntriesRead` records entry files and candidate counts
- `onDocsLoaded` records document count
- `onSortLimit` records whether sort/limit were applied after load
- `onTimingPart` records timing buckets for index- and scan-related work

Still incomplete:

- There is no explicit per-index breakdown showing how many documents each index loaded in the final aggregated output.
- The current result is aggregate-only rather than a full per-index cost report.
- The final `executionStats` does not include a rich “how much the limit/sort optimized the load” narrative beyond a boolean/reason pair.

#### 2) When there is a scan

This is implemented:

- `onPlanWinner('COLLECTION_SCAN', undefined, 'No usable index for query')`
- `scanReason` is persisted and serialized

This satisfies the basic requirement.

#### 3) Why an index was skipped or chosen

Partially implemented:

- `onPlanCandidate` records rejected candidate plans with a reason when the index cannot satisfy the query
- `scoreForQuery` emits a positive candidate record

Missing or weak areas:

- Rejection reasons are not yet exhaustive across all operator patterns
- There is no thorough “why this candidate lost” ranking explanation for multi-index queries
- The design supports reason codes, but several code paths still do not emit them consistently

#### 4) Expressions skipped because they are not implemented

Partially implemented:

- `onExprStat` exists and is emitted in query paths
- The result includes `expressionStats` in `executionStats`

Missing or weak areas:

- Unsupported operators are not yet surfaced in a precise, exhaustive, per-operator report
- The current implementation mostly records a generic truthy `implemented` signal in the query loop, rather than deeper unsupported-op detection from the expression engine
- There is no dedicated unsupported-operator collector for all query operators in the same way the plan describes

#### 5) Expression executed in index vs after load

Implemented at a high level:

- `onExprStat` includes `appliedAt: 'index' | 'postLoad' | 'notApplied'`
- The query layer currently sets this based on whether a matching index exists

Missing or weak areas:

- This is a coarse approximation, not a full expression-by-expression execution trace
- The implementation does not yet walk the full expression tree and attribute each subexpression to index or post-load evaluation with the same granularity the plan implies

#### 6) Write cost, including index files updated

Implemented in core form:

- `onWriteCost` records document writes, index metadata writes, and update counts
- `writeStats` is included in the final result
- index file names are tracked in the set of updated index names

Missing or weak areas:

- This is not yet a full per-index-file write plan with exact file paths and per-file mutation counts
- The current aggregation is effective but still more summary-oriented than fully operationally detailed

#### 7) Cache usage per collection and index

Implemented well:

- `onCacheEvent` tracks hit / miss / stale
- cache stats are serialized in `executionStats.cacheStats`

This is one of the strongest parts of the current implementation.

## Implementation guidance for later work

### Priority order

1. Add exact per-index read cost reporting
2. Add robust unsupported-operator detection
3. Add precise expression-placement attribution
4. Add richer per-index write-file detail
5. Expand reason codes for rejected query plans
6. Harden serialization shape for Mongo-parity

### Recommended design rules

#### 1. Keep all explain events sink-based

Every runtime component should emit events directly via `ExplainSink` methods.

Do not add explain-only branches or custom explain command implementations.
The sink remains the single source of final aggregation and serialization.

#### 2. Aggregate at the sink, not at call sites

Do not build nested explain objects in collection / repo classes. Let the sink reduce counters and decide final output.

#### 3. Emit exact facts, not opinions

Use `onPlanCandidate`, `onCacheEvent`, `onTimingPart`, `onExprStat`, and `onWriteCost` to record raw facts. The serializer should convert those facts into the final output shape.

#### 4. Keep the event contract stable

When new explain detail is added, prefer extending the sink method contract over creating a separate side channel.
This keeps the runtime architecture clean.

### Recommended next implementation targets

#### A. Query planner detail

Add richer plan reasoning in `BaseCollectionIndex.scoreForQuery` and `S3CollectionStore.findCandidates`:

- emit reason codes for each candidate loss reason
- record score deltas between best and rejected plans
- include plan warnings for scan fallback and unsupported operators

#### B. Unsupported operator reporting

In the expression-evaluation layer, record:

- operator name
- field name
- whether it was implemented
- where it was applied (`index`, `postLoad`, or `notApplied`)
- a reason note when unsupported

This should be centralized in `onExprStat`.

#### C. Per-index cost breakdown

Track:

- index name
- entry files read
- unique candidate IDs
- approximate row count after filtering
- whether sort/limit reduced the document load

This should surface as part of `executionStats` without changing the public API shape.

#### D. Write-file detail

For writes, track the exact index entry files updated and the number of IDs mutated per file. This improves the write cost report beyond the current summary counters.

## Acceptance checklist

A requirement is considered complete only when:

- the runtime emits the fact through the sink
- the sink aggregates it correctly
- the serializer exposes it in `executionStats` or `writeStats`
- a regression test exists verifying it

## Test priorities

Add tests for:

1. plan winner with scan fallback
2. rejected index reason codes
3. unsupported operator reporting
4. expression placement (`index` vs `postLoad`)
5. sort/limit optimization effect
6. write cost per updated index file
7. cache event hit/miss/stale accounting

## Final assessment

The current implementation is a strong architectural match for the plan and already satisfies the main explain-mode shape and lifecycle. It is not yet a complete Mongo-parity explain engine, but it does provide a clean foundation for the remaining feature work.

The remaining work is mostly about deeper reporting fidelity, not reworking the design itself.
