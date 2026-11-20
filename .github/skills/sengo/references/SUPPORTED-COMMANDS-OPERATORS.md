# Supported Commands and Operators (Skill Reference)

This reference is scoped to code generation for Sengo client users.

## Supported Commands

- `client.db(dbName?)`
- `db.collection(name)`
- `collection.insertOne(doc)`
- `collection.find(query, options?)`
- `collection.findOne(query, options?)`
- `collection.updateOne(filter, update, options?)`
- `collection.updateMany(filter, update, options?)`
- `collection.deleteOne(filter)`
- `collection.createIndex(keys)`
- `collection.dropIndex(name)`
- `collection.listIndexes()`
- `client.close()`

## Supported Query Operators

- Logical: `$or`
- Comparison/membership: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
- Direct equality is supported (for example `{ status: 'active' }`).

## Supported Update Operators

- `$set`
- `$setOnInsert` (applied only when `options.upsert` inserts a document)

## Supported Options

- `find(query, options?)`
  - `options.sort`
  - `options.limit`
- `findOne(query, options?)`
  - `options.sort`
  - `options.limit` accepted, but effective limit is always 1.
- `updateOne(filter, update, options?)`
  - `options.upsert: true` inserts a document when no document matches; omitted/false does not insert.
  - `options.explain`
- `updateMany(filter, update, options?)`
  - Updates every matching document with `$set`.
  - `options.upsert: true` inserts one document when no document matches; `$setOnInsert` applies only to that insert.
  - `options.explain`

Upsert syntax:

```ts
await collection.updateOne(
  { email: 'person@example.com' },
  {
    $set: { status: 'active' },
    $setOnInsert: { createdAt: new Date().toISOString() }
  },
  { upsert: true }
);
```

`$setOnInsert` applies only when the upsert creates a document.

`updateMany` returns `matchedCount`, `modifiedCount`, `upsertedCount`, and
`upsertedId`:

```ts
await collection.updateMany(
  { status: 'pending' },
  { $set: { status: 'active' } }
);
```

## Important Notes

- `$limit` is an option, not a query operator.
- Replacement-style update documents are not supported; use `$set`.
- If requested syntax is outside this surface, rewrite to the nearest supported Sengo form.