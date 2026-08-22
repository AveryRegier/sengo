---
description: 'Guide implementation of Sengo explain mode for query/write cost visibility with index-selection reasons, scan reporting, and unsupported-operator reporting.'
applyTo: '**/*.{ts,md}'
---

# Sengo Explain Mode Implementation Guide

Use this guide when implementing or modifying explain behavior for Sengo query and write operations.

## Objectives

Explain output must communicate:

1. Index choices made, index-entry loads, document loads, and sort/limit optimization impact.
2. When and why a scan happened.
3. Why each index was chosen or skipped.
4. Any skipped expressions/operators because they are not implemented.
5. Whether each expression was applied in index space or after document load.
6. Write cost, including how many and which index entry files were updated.
7. Cache usage details, including file-cache hit/miss statistics per collection and per index.

## Compatibility-First Rule (Mandatory)

Sengo is a subset of MongoDB's Node.js client behavior.

- Implement explain in a way that trends toward MongoDB compatibility.
- If you identify an incompatibility, fix compatibility first or explicitly scope/defer explain behavior behind a documented limitation.
- Do not introduce new permanent API differences if a compatible path is feasible.

## Required Scope

- Query explain for `find` and `findOne`.
- Write explain for `insertOne`, `updateOne`, and `deleteOne`.
- Verbosity model compatible in spirit with MongoDB (`queryPlanner`, `executionStats`, `allPlansExecution`).

## Encapsulation Requirement (Mandatory)

Explain implementation must be centered in one file:

- `client/src/client/explain.ts`

This file must encapsulate:

- explain interfaces/types
- step collection contracts
- Mongo-like explain serialization adapted for Sengo

Do not build final explain result fragments inside repository/store/index modules.
Those modules should only emit step events to the explain interface when explain is enabled.

Expected pattern:

- always create/pass an explain sink object
- when `options.explain` is absent: use `NullExplainSink` (no-op)
- when `options.explain` is present: use collecting sink implementation and emit steps
- final explain output must be produced by serializer in `explain.ts`

Null object rule:

- avoid repeated `if (options.explain)` checks in low-level hooks
- call sink methods unconditionally
- only branch at the final API return boundary to choose normal result vs explain result

## Source of Truth for Supported Operators

Allowed query operators:

- `$or`
- `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
- direct field equality

Allowed update operators:

- `$set`

Unsupported operators/features must never be presented as supported. Explain should report them explicitly as unimplemented.

Compatibility prerequisite:

- Prefer explicit unsupported-operator behavior over silent no-op matching semantics before relying on explain warnings alone.

## Instrumentation Points

- `client/src/client/collection.ts`
  - always create explain sink from `client/src/client/explain.ts` (`NullExplainSink` if explain is disabled).
  - `_findFilterSort`: post-load filter count, post-load sort/limit usage.
  - `insertOne`, `updateOne`, `deleteOne`: write and index-maintenance cost accounting.
- `client/src/repository/s3/s3CollectionStore.ts`
  - `findCandidates`: winning/rejected plans, key generation, candidate IDs, dedupe, scan fallback reason.
  - `scan`: full scan marker and scan reason.
  - emit collection-level cache events when collection file caching is used.
- `client/src/repository/collectionIndex.ts`
  - `canSatisfyQuery`, `scoreForQuery`, `findKeysForQuery`: index eligibility and reason capture.
  - `IndexEntry.toArray`: index-time filter/sort/limit optimization usage.
- `client/src/repository/s3/s3CollectionIndex.ts`
  - `persistEntry`: exact index entry file paths written and retry diagnostics.
  - `fetch`: emit index cache probe/hit/miss/stale events with collection + index metadata.
- `client/src/client/expression.ts` and operator registry under `client/src/client/expr/`
  - classify each operator as implemented or unimplemented for explain output.

All these points must report raw explain steps through the sink interface; serialization stays in `explain.ts`.

Cache aggregation rule:

- serializer in `explain.ts` must aggregate cache stats from step events.
- report cache stats per collection and per index.
- if a cache type does not exist yet, serialize explicit zero values for that scope.

## Reason Codes (Stable)

Use stable reason codes in explain output and tests:

- `missingLeadingField`
- `missingNonFinalField`
- `unsupportedLookupOperator`
- `sortFieldMismatch`
- `scoreLowerThanWinner`
- `noUsableIndexKeysFromQuery`
- `forcedIdLookup`
- `scanFallback`

## Output Expectations

Explain output should include:

- winning plan summary
- rejected plan summaries with reason code and note
- scan reason if scan used
- index entries loaded and documents loaded counts
- per-expression reporting with:
  - field
  - operator
  - implemented boolean
  - appliedAt (`index`, `postLoad`, `notApplied`)
- cache stats with:
  - collection fileCacheHits/fileCacheMisses/fileCacheHitRate
  - per-index fileCacheHits/fileCacheMisses/fileCacheHitRate
- write cost stats:
  - document write count
  - index metadata write count
  - index entry files updated list
  - total index entry updates count

## Performance Guardrail

- Explain instrumentation must be no-op when explain is not requested.
- Do not add measurable overhead to normal find/write paths.

Null object guidance:

- interface + null implementation pattern is preferred for clean call sites and low overhead.

## Testing Requirements

Use Vitest and Arrange-Act-Assert style.

Minimum tests:

- winning/rejected plan reason validation
- scan fallback reason validation
- sort/limit optimization reflected in `documentsLoaded`
- unsupported operator surfaced in explain output
- write explain includes exact index entry file paths touched

Prefer `S3BucketSimulator.getLogs()` assertions for S3 request-level behavior.

Add prerequisite-focused tests before full explain assertions when needed:

- compatibility behavior tests for explain invocation shape
- unsupported-operator behavior tests (explicit failure or clearly scoped mode)
- deterministic counter semantics tests (pre/post flush where applicable)
- deterministic cache counter tests (hit/miss and hit rate per collection/index)

## Compatibility and Messaging

- Describe explain as rough MongoDB compatibility, not full parity.
- Keep stage names and metrics Sengo-specific where needed.
- Keep unsupported operators clearly flagged.
