---
description: 'Warn when generating Sengo client code that uses unsupported MongoDB operators/features; rewrite to supported Sengo syntax. Use when prompts involve queries, updates, filters, sorting, limits, or index recommendations.'
applyTo: '**/*.{ts,js,md}'
---

# Sengo Unsupported Mongo Operator Guard

For generated Sengo client code, validate operator and command support before finalizing output.

## Allowed Query Operators
- `$or`
- `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
- direct field equality (for example `{ status: 'active' }`)

## Allowed Update Operators
- `$set`

## Allowed Query Options
- `find(..., { sort, limit })`
- `findOne(..., { sort })` and note that Sengo forces `limit: 1` internally

## Guard Behavior
1. If a prompt/code sample uses unsupported Mongo operators or features, emit a clear warning and provide a working Sengo rewrite.
2. Never present unsupported syntax as valid Sengo code.
3. Treat `$limit` as a query option, not as a query operator.
4. For updates, reject replacement-style update docs and rewrite with `$set` when possible.
5. Keep index recommendations within tested Sengo capabilities.

## Common Unsupported Features to Flag
- Aggregation pipeline stages (`$match`, `$group`, `$project`, `$lookup`, etc.)
- Unsupported logical/query operators (`$and`, `$nor`, `$not`, `$regex`, `$elemMatch`, `$all`, `$size`, `$type`, `$expr`, etc.)
- Unsupported update operators (`$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, etc.)
- Bulk write APIs and transactions

## Source References
- Query/command support: [docs/SUPPORTED-COMMANDS-OPERATORS.md](../../docs/SUPPORTED-COMMANDS-OPERATORS.md)
- Index recommendation constraints: [docs/SUPPORTED-INDEX-FEATURES.md](../../docs/SUPPORTED-INDEX-FEATURES.md)