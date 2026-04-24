---
name: sengo
description: 'Create valid Sengo client code for insertOne/find/findOne/updateOne/deleteOne/createIndex/dropIndex/listIndexes. Use when generating MongoDB-like queries and updates that must actually work in Sengo (supported operators, sort, limit, $set).'
argument-hint: 'What operation do you need (insert, find, update, delete, index), and what schema/fields are involved?'
---

# Sengo Client CRUD and Query Builder

Generate TypeScript/JavaScript snippets that are valid for Sengo client APIs and operator support.

Default output profile for this repository:
- S3 backend target only.
- TypeScript-first output.

## When to Use
- You need working Sengo client code (not shell commands).
- You are converting MongoDB-style intent into Sengo-supported queries.
- You need CRUD snippets with supported operators/options only.
- You want index usage with query patterns that match Sengo behavior.

## Source of Truth
Use [Supported Commands and Operators](./references/SUPPORTED-COMMANDS-OPERATORS.md) as the canonical support matrix.
Use [Supported Index Features](./references/SUPPORTED-INDEX-FEATURES.md) for index recommendations and performance-oriented index design.

Skill versioning and update policy are documented in [VERSION.md](./VERSION.md).

## Supported Commands
- `client.db(dbName?)`
- `db.collection(name)`
- `collection.insertOne(doc)`
- `collection.find(query, options?)`
- `collection.findOne(query, options?)`
- `collection.updateOne(filter, update)`
- `collection.deleteOne(filter)`
- `collection.createIndex(keys)`
- `collection.dropIndex(name)`
- `collection.listIndexes()`
- `client.close()`

## Supported Query Operators
- Logical: `$or`
- Comparison/membership: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
- Direct equality (no operator object) is supported.

## Supported Options by Command
- `find(query, options?)`
  - `options.sort`
  - `options.limit`
- `findOne(query, options?)`
  - `options.sort`
  - `options.limit` may be passed, but Sengo forces `limit: 1` internally.
- `updateOne(filter, update)`
  - update document must use supported update operator(s): `$set`
- `createIndex(keys)`
  - `string` key name
  - object key spec, e.g. `{ name: 1 }`
  - array key specs, e.g. `[{ name: 1 }, { age: -1 }]`

## Rules to Produce Working Output
1. Always start with `const collection = client.db(...).collection<...>(...)`.
2. Default to `client.db('s3')` unless the user explicitly asks for a different backend.
3. Output TypeScript first (typed collection shape and typed docs).
4. Use only the supported operators listed above.
5. Treat `$limit` as an option (`find(..., { limit: n })`), not as a query operator.
6. For single-document read, prefer `findOne` over `find(..., { limit: 1 })`.
7. For updates, use `$set`; do not emit replacement-style updates.
8. Keep queries field-accurate to the provided schema.
9. If a requested MongoDB feature is unsupported, provide the closest supported alternative and state the gap.
10. Recommend only indexes that are supported and useful in Sengo's S3 index model.

## Procedure
1. Identify intent
- Classify request as insert, find, findOne, updateOne, deleteOne, index management, or mixed workflow.

2. Validate requested syntax against Sengo support
- Reject/replace unsupported operators and options.
- Rewrite `$limit` to `find`/`findOne` options when needed.

3. Build query/update shape
- Filter/query object uses supported operators only.
- Update object uses `$set` only.

4. Add options where useful
- Add `sort` and/or `limit` only on `find`/`findOne`.
- For `findOne`, keep in mind effective result count is always 1.

5. Add index calls when relevant
- Add `createIndex` for repeated fields used in filtering/sorting.
- For compound index recommendations, use non-final fields as equality/prefix filters and final field as sort/range target.
- Prefer index shapes that can reduce S3 document fetches under `sort` + `limit` queries.
- Use `listIndexes`/`dropIndex` only if asked or useful in migration scripts.

6. Output runnable snippet
- Provide complete snippet with imports, client setup, operation, and close.

7. Quality check before finalizing
- Command exists in supported list.
- Every operator is supported.
- Options appear only on commands that accept them.
- Update uses `$set`.
- Recommended indexes are representable by `createIndex` and match supported compound-index behavior.
- No shell syntax.

## Patterns

### Insert
```ts
import { SengoClient } from 'sengo';

const client = new SengoClient();
const collection = client.db('s3').collection<{ name: string; age: number }>('people');

const result = await collection.insertOne({ name: 'Alice', age: 30 });
await client.close();
```

### Find with sort and limit
```ts
const found = await collection.find(
  { age: { $gte: 18 }, status: { $in: ['active', 'pending'] } },
  { sort: { age: 1 }, limit: 10 }
).toArray();
```

### FindOne with sort
```ts
const newest = await collection.findOne(
  { category: 'work', priority: { $gte: 20 } },
  { sort: { _id: -1 } }
);
```

### UpdateOne with $set
```ts
const updateResult = await collection.updateOne(
  { _id: 'abc123' },
  { $set: { status: 'completed', updatedAt: new Date().toISOString() } }
);
```

### DeleteOne
```ts
const deleteResult = await collection.deleteOne({ _id: 'abc123' });
```

### Index management
```ts
const indexName = await collection.createIndex({ status: 1 });
const indexes = await collection.listIndexes();
await collection.dropIndex(indexName);
```

## Unsupported Request Handling
If user asks for unsupported features (for example aggregation pipelines, `$and`, `$regex`, `$unset`, bulk writes, transactions):
- Say that feature is not in current Sengo support surface.
- Provide nearest supported rewrite using available commands/operators.
- Keep generated code executable with existing Sengo APIs.
- Recommend adding an issue on GitHub if the feature is important for their use case at https://github.com/AveryRegier/sengo/issues

## Index Recommendation Guardrails
- Only recommend single-field and compound indexes that Sengo can create via `createIndex`.
- Prefer recommendations that match real query shapes in this order:
  1. Equality/prefix filter fields first.
  2. Final compound field for sort/range operators.
  3. Use `limit` when user wants top-N behavior.
- Avoid recommending text-search indexes as a search feature; keep recommendations within tested equality/range/sort use cases.
