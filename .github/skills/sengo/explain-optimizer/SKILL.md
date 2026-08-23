---
name: sengo-explain-optimizer
description: 'Use Sengo explain output to validate whether a query (find/findOne/countDocuments) is supported and well optimized, and suggest only safe indexes that match Sengo-supported query shapes. Includes countDocuments index-only optimization guidance.'
argument-hint: 'Paste a query, explain result, or collection operation and optional sort/limit details. I will decide whether it is supported, whether it is index-optimized, and what index to consider.'
---

# Sengo Explain Optimizer

Use this subskill when you need to evaluate whether a query is valid in Sengo, whether it is using an index effectively, and what index might need to be created.

This skill reads Sengo explain output and turns it into a practical recommendation for both correctness and performance.

## Use this when
- a query is failing or behaving unexpectedly
- a query is slow and you want to know whether an index is helping
- you want to know if a query is fully supported by Sengo's current feature set
- you want a safe, Sengo-compatible index recommendation based on filters and sort order

## Source of truth
Use these as the hard boundaries for what is valid in Sengo:
- [docs/SUPPORTED-COMMANDS-OPERATORS.md](../../../docs/SUPPORTED-COMMANDS-OPERATORS.md)
- [docs/SUPPORTED-INDEX-FEATURES.md](../../../docs/SUPPORTED-INDEX-FEATURES.md)
- [.github/instructions/sengo-unsupported-mongo-operators.instructions.md](../../instructions/sengo-unsupported-mongo-operators.instructions.md)
- [.github/skills/sengo/SKILL.md](../SKILL.md)

## Core workflow

### 1) Validate that the query is supported in Sengo
Check the query shape before trusting the explain result.

Do these checks first:
- Confirm the command exists in Sengo: `find`, `findOne`, `countDocuments`, `insertOne`, `updateOne`, `deleteOne`, `createIndex`, etc.
- Confirm each operator is in the supported list:
  - allowed query operators: `$or`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
  - direct equality such as `{ status: 'active' }`
  - update operator: `$set`
- Reject unsupported MongoDB features early, such as:
  - aggregation pipelines
  - `$regex`, `$and`, `$nor`, `$not`, `$elemMatch`, `$all`, `$size`, `$type`, `$expr`
  - replacement-style updates without `$set`
  - bulk writes and transactions
- If the explain output contains `expressionStats`, inspect each entry for:
  - `implemented: false`
  - `appliedAt: 'notApplied'`
  - unsupported operator notes

Decision rule:
- If unsupported syntax or unsupported operators are present, mark the query as `supported: false`.
- If the query is valid but not optimized, mark it as `supported: true` but `optimized: false`.

### 2) Read the explain result with the right lens
Read the explain payload in this order:

1. Query planner summary
   - `queryPlanner.winningPlan.stage`
   - `queryPlanner.winningPlan.indexName`
   - `queryPlanner.rejectedPlans`
   - `queryPlanner.plannerWarnings`

2. Execution stats
   - `executionStats.stage`
   - `executionStats.indexName`
   - `executionStats.scanReason`
   - `executionStats.documentsLoaded`
   - `executionStats.documentsMatchedAfterLoad`
   - `executionStats.sortAppliedAfterLoad`
   - `executionStats.limitAppliedAfterLoad`
   - `executionStats.indexSortLimitOptimization`
   - `executionStats.expressionStats`
   - `executionStats.cacheStats`

3. Write stats if relevant
   - `writeStats.indexEntryFilesUpdated`
   - `writeStats.indexWriteDetails`

Interpretation rules:
- `COLLECTION_SCAN` with no usable index means the query is scan-bound.
- `INDEX_LOOKUP` with a matching `indexName` means the query used an index for lookup.
- `sortAppliedAfterLoad: true` means sorting happened after load; this is a performance red flag if the query also wants efficient ordering.
- `limitAppliedAfterLoad: true` means the limit was applied after load rather than in index order.
- `indexSortLimitOptimization.used: true` means Sengo recognized the index could help satisfy the `sort`/`limit` pattern.
- `scanReason` or `noUsableIndexKeysFromQuery` is a strong hint that the query would benefit from a new index.

### 3) Determine whether the query is well optimized
Use the following scoring model.

Good signs:
- `executionStats.stage === 'INDEX_LOOKUP'`
- `indexName` is present and relevant
- `documentsLoaded` is low relative to collection size
- `sortAppliedAfterLoad === false`
- `limitAppliedAfterLoad === false`
- `indexSortLimitOptimization.used === true`
- `expressionStats` show supported operators applied at `index` or during index-eligible filtering

Warning signs:
- `COLLECTION_SCAN`
- `scanReason` is present
- `documentsLoaded` is high
- `sortAppliedAfterLoad === true` even though there is a sort option
- `limitAppliedAfterLoad === true` without index optimization
- unsupported operators appear in `expressionStats`
- cache miss rates are high for repeated query shapes

CountDocuments-specific interpretation:
- For `countDocuments`, `documentsLoaded: 0` in `executionStats` indicates an index-only count path.
- For `countDocuments`, `documentsLoaded > 0` means count required candidate document loads (for example, filter fields not fully covered by the chosen index).
- If count queries are common, treat repeated non-zero `documentsLoaded` as a signal to revisit index coverage of count filter fields.

Decision result:
- `optimized: true` if index lookup was used and the query is reduced by the index
- `optimized: false` if a scan or post-load sort/limit dominated
- `optimized: unclear` if the query was supported but the explain signal is incomplete

### 4) Suggest a candidate index only when it matches Sengo-supported behavior
Only suggest indexes that fit the tested Sengo model.

Recommended patterns:
- Single-field equality or `$in` index for repeated filter fields:
  - `createIndex({ status: 1 })`
  - `createIndex({ userId: 1 })`
- Compound index where leading fields are equality or prefix filters and the final field is the sort or range field:
  - `createIndex({ status: 1, priority: 1 })`
  - `createIndex({ tenantId: 1, createdAt: -1 })`
  - `createIndex({ category: 1, state: 1, updatedAt: -1 })`

Use these rules:
1. Put equality/prefix fields first.
2. Use the final field as the sort or range target when the query sorts by it.
3. Prefer recommendations that reduce S3 document fetches under `find(..., { sort, limit })` patterns.
4. Do not suggest unsupported operator-dependent indexes, text-search indexes, or Mongo-only features.

CountDocuments index rule of thumb:
- For frequently used count filters, ensure the filter fields are indexed so count can often be satisfied from index lookup.
- When possible, keep count filters limited to indexed fields to reduce or avoid S3 document loads.

### 5) Produce a decision summary
Return a compact result with these sections:

- `supported`: `true | false`
- `supportedReason`: summary of operator and command validation
- `optimized`: `true | false | unclear`
- `optimizationNotes`: concise explain-based findings
- `suggestedIndex`: either a safe `createIndex(...)` recommendation or `null`
- `suggestedIndexReason`: why that index is expected to help
- `warnings`: unsupported operators, scan fallback, sort mismatch, etc.

## Example output format

```ts
{
  supported: true,
  supportedReason: 'Query uses supported operators ($eq, $in) and Sengo supports find with sort/limit.',
  optimized: false,
  optimizationNotes: 'Collection scan used because no usable index matched the leading equality field; sort was applied after load.',
  suggestedIndex: "createIndex({ status: 1, priority: 1 })",
  suggestedIndexReason: 'status is an equality filter and priority is the final field used for sorting and range filtering.',
  warnings: ['scanFallback', 'sortAppliedAfterLoad']
}
```

## Anti-patterns to avoid
- Do not suggest indexes for unsupported MongoDB operators.
- Do not recommend `$regex`-based search indexes or aggregation pipeline workarounds.
- Do not claim an index is useful if explain shows a full collection scan and no relevant key coverage.
- Do not produce a suggestion that does not match Sengo's supported index model.

## Quality gate before finalizing
Before returning a result, ensure all of the following are true:
- the query command is allowed in Sengo
- every operator used is in the supported set
- the explain result was interpreted against the actual Sengo behavior
- the recommendation is representable by `createIndex(...)`
- the suggested index matches either equality-leading or sort-supporting patterns
- you did not recommend Mongo-only features outside the Sengo subset

## Example prompts this skill can handle
- "Is this query valid in Sengo and is it using the index efficiently?"
- "The explain result shows a collection scan; what index should I add?"
- "This query sorts by priority but filters by status; is the current index good enough?"
- "Does this explain output show unsupported operators or a bad plan?"
- "What index would make this `find(..., { sort, limit })` query efficient in Sengo?"
