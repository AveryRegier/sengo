# Supported Index Features (Skill Reference)

Use this file to keep index recommendations within real Sengo behavior.

## Supported Index APIs

- `createIndex(keys)`
- `createIndex(keys, { unique: true })` for unique single-field or compound keys
- `dropIndex(name)`
- `listIndexes()`

## Supported Index Definitions

- Single string key: `createIndex('field')`
- Single object key: `createIndex({ field: 1 })`
- Compound keys: `createIndex([{ a: 1 }, { b: -1 }])`

Accepted key order values: `1`, `-1`, `text`.

## Unique Index Semantics

- Duplicate complete keys are rejected on insert and update.
- Missing and explicit `null` values share one unique key; compound indexes
  compare the full tuple.
- Array values create deduplicated memberships and dotted paths through the
  same embedded-document array remain correlated.
- Independent array expansion in a compound index is rejected.
- Independent clients sharing S3 enforce uniqueness for writes against an
  index whose metadata they have loaded.
- On a document PUT timeout, Sengo checks only that document's S3 key. If the
  document is present or the check is inconclusive, the insert throws
  `MongoWriteOutcomeUnknownError` and retains its unique claim. Claims are
  durable S3 objects; they do not expire when a Lambda ends and are not
  automatically rebuilt. Do not treat this error as a confirmed failure or
  blindly retry the same unique value under a new `_id`; a stale claim can
  block the value until manually repaired.
- Unique-index creation over existing data is not online-safe. Pause writes
  during the build and restart/recreate application clients afterward because
  each store caches index metadata and does not refresh it automatically. A
  separate admin client alone does not coordinate active writers.

## Compound Index Guidance

- Non-final fields should be equality/prefix filter fields.
- Final field should be sort/range target.
- Prefer query patterns that pair with `sort` + `limit` for S3 request reduction.

## Safe Recommendation Patterns

- Single-field index for repeated equality/`$in` filtering on one field.
- Compound index where leading fields are equality filters and trailing field is sort/range.
- Recommend indexes only when they match the user's recurring query shape.

## Avoid Overpromising

- Do not recommend index strategies requiring unsupported query/update operators.
- Do not treat text index as full-text search feature support in this skill.