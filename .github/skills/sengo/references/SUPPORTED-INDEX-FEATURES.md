# Supported Index Features (Skill Reference)

Use this file to keep index recommendations within real Sengo behavior.

## Supported Index APIs

- `createIndex(keys)`
- `dropIndex(name)`
- `listIndexes()`

## Supported Index Definitions

- Single string key: `createIndex('field')`
- Single object key: `createIndex({ field: 1 })`
- Compound keys: `createIndex([{ a: 1 }, { b: -1 }])`

Accepted key order values: `1`, `-1`, `text`.

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