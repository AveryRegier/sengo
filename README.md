# Sengo Monorepo

This repository contains:

- **client/**: The Sengo MongoDB-like client library (TypeScript, Node.js) ([client/README.md](client/README.md))
- **shell/**: An interactive shell for using the Sengo client ([shell/README.md](shell/README.md))

## Motivation & Design Considerations

Sengo is designed for small, cost-sensitive applications that use AWS S3 for document storage. It is ideal for apps with infrequent use (e.g., volunteer orgs, occasional data entry) and aims for near-zero storage costs when idle. Sengo supports efficient search and retrieval via a flexible, document-based indexing system. See [client/INDEX-DESIGN.md](client/INDEX-DESIGN.md) for details on the indexing feature design and future plans.

## Getting Started

1. **Install dependencies for all packages:**

   ```sh
   npm install
   ```

2. **Build all packages:**

   ```sh
   npm run build
   ```

3. **Clean all build outputs:**

   ```sh
   npm run clean
   ```

4. **Start the interactive shell:**

   ```sh
   npm start
   ```

   This will launch the shell in the `shell` package.

## Running the Sengo Shell CLI

After installing dependencies, you can launch the interactive Sengo shell directly using:

```sh
npx sengo
```

Or, if installed globally:

```sh
sengo
```

This will start the shell and allow you to connect to a memory or S3-backed repository, run commands, and interact with your data.

For more details, see [shell/README.md](shell/README.md).

## Usage

- To use the shell interactively:

  ```sh
  cd shell
  npm start
  ```

- To use the client library, see `client/README.md` for details.

## Supported Client Features (Plain Language)

Sengo gives you a MongoDB-like programming model for common application workflows, with data stored in S3.

What you can do today:

- Insert a single document with `insertOne`
- Query documents with `find` and `findOne`
- Update a single document with `updateOne` using `$set`
- Delete a single document with `deleteOne`
- Create, list, and drop indexes with `createIndex`, `listIndexes`, and `dropIndex`
- Sort and limit query results using query options

Supported query operators:

- Logical: `$or`
- Comparison/membership: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
- Direct field equality: for example `{ status: 'active' }`

Important behavior notes:

- `limit` is supported as a query option, not as a query operator.
- `findOne` always returns at most one document.
- `updateOne` currently supports `$set` style updates.

### Generic Query Examples

```ts
import { SengoClient } from 'sengo';

type Order = {
   customerId: string;
   status: 'new' | 'processing' | 'shipped';
   total: number;
   createdAt: string;
};

const client = new SengoClient();
const orders = client.db('s3').collection<Order>('orders');

// Insert
await orders.insertOne({
   customerId: 'cust-123',
   status: 'new',
   total: 149.99,
   createdAt: new Date().toISOString(),
});

// Find with operators + sort + limit
const recentHighValue = await orders.find(
   {
      status: { $in: ['new', 'processing'] },
      total: { $gte: 100 },
   },
   {
      sort: { createdAt: -1 },
      limit: 20,
   }
).toArray();

// Find one
const oneOrder = await orders.findOne({ customerId: 'cust-123' }, { sort: { createdAt: -1 } });

// Update one with $set
await orders.updateOne(
   { customerId: 'cust-123', status: 'new' },
   { $set: { status: 'processing' } }
);

// Delete one
await orders.deleteOne({ customerId: 'cust-123', status: 'shipped' });

await client.close();
```

## How Indexes Work (And Why They Matter)

In S3-backed systems, the expensive part of a query is usually loading full document files. Indexes help reduce those reads.

### Indexes you can create

- Single-field index, for frequent filters on one field:
   - `createIndex({ status: 1 })`
- Compound index, for filter + sort patterns:
   - `createIndex({ customerId: 1, createdAt: -1 })`

### Practical rule for compound indexes

- Put equality/filter fields first.
- Put the main sort or range field last.

This lets Sengo use index ordering more effectively, especially for top-N queries (`sort` + `limit`).

### Generic Index Example

```ts
import { SengoClient } from 'sengo';

type Event = {
   accountId: string;
   severity: 'info' | 'warn' | 'error';
   timestamp: number;
   message: string;
};

const client = new SengoClient();
const events = client.db('s3').collection<Event>('events');

// Index for account-scoped timelines
await events.createIndex({ accountId: 1, timestamp: -1 });

// Query pattern aligned with that index
const latest = await events.find(
   { accountId: 'acct-42', severity: { $in: ['warn', 'error'] } },
   { sort: { timestamp: -1 }, limit: 50 }
).toArray();

await client.close();
```

For deeper technical details and test-backed support matrices, see:

- [docs/SUPPORTED-COMMANDS-OPERATORS.md](docs/SUPPORTED-COMMANDS-OPERATORS.md)
- [docs/SUPPORTED-INDEX-FEATURES.md](docs/SUPPORTED-INDEX-FEATURES.md)

## Copilot Skill for Client Users

The `sengo` skill is intended for projects that consume Sengo, not just this monorepo.

### Install into a consumer project

From this repository, run:

```sh
npm run install-client-skill -- <path-to-consumer-project>
```

This copies the skill to:

`<consumer-project>/.github/skills/sengo/`

If you run the command without a path, it installs to the current working directory.

### What gets installed

- `SKILL.md`
- `references/SUPPORTED-COMMANDS-OPERATORS.md`
- `references/SUPPORTED-INDEX-FEATURES.md`
- `VERSION.md`

### Updating skill versions in consumer projects

1. Re-run the install command against the consumer project.
2. Review `VERSION.md` in the target project to confirm the installed version.
3. Re-test a few prompts in the consumer project:
   - insert
   - find/findOne with sort/limit
   - updateOne with `$set`
   - index recommendations

---

For more information, see the individual [client/README.md](client/README.md) and [shell/README.md](shell/README.md) files in each package.
