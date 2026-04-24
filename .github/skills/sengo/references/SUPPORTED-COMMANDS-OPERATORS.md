# Supported Commands and Operators (Skill Reference)

This reference is scoped to code generation for Sengo client users.

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
- Direct equality is supported (for example `{ status: 'active' }`).

## Supported Update Operators

- `$set`

## Supported Options

- `find(query, options?)`
  - `options.sort`
  - `options.limit`
- `findOne(query, options?)`
  - `options.sort`
  - `options.limit` accepted, but effective limit is always 1.

## Important Notes

- `$limit` is an option, not a query operator.
- Replacement-style update documents are not supported; use `$set`.
- If requested syntax is outside this surface, rewrite to the nearest supported Sengo form.