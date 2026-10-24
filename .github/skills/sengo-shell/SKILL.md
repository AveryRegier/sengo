---
name: sengo-shell
description: 'Use the Sengo interactive shell for research, analysis, and query optimization. Includes startup, CRUD commands, explain mode for cost visibility, and research workflows. For client library code generation, use the sengo skill.'
argument-hint: 'What research or analysis task do you need (test queries, check explain output, diagnose performance)?'
---

# Sengo Shell for Research and Analysis

Use the sengo shell for interactive research, testing queries, and diagnosing performance issues with explain mode. The shell provides direct access to collections without writing client code.

## When to Use

- **Research:** Test queries interactively before building client code
- **Diagnosis:** Run queries with explain to understand index selection and cost
- **Analysis:** Inspect write costs, scan behavior, and optimization opportunities
- **Prototyping:** Quickly iterate on query patterns and index design
- **Testing:** Validate data state and query results during development

For production client code generation, use the [Sengo Client Skill](../sengo/SKILL.md).

## Starting the Shell

### Installation
From the repository root:
```bash
npm run install-shell-command
```

This builds the workspace and links the shell binary.

### Launch the Shell
```bash
sengo
```

Or:
```bash
npx sengo
```

You should see:
```
Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.
sengo>
```

### Auto-Connect with S3_BUCKET
Set the environment variable to connect automatically at startup:
```bash
export S3_BUCKET=my-bucket
sengo
```

## Connection and Setup

### Connect to a Repository
```
sengo> connect <bucket-or-repository-type>
```

Examples:
- S3 backend: `connect my-sengo-bucket`
- Memory backend: `connect memory`

### Select a Collection
```
sengo> use <collection-name>
```

Example:
```
sengo> use products
```

After `use`, you can run collection methods directly without prefixing.

### View Help
```
sengo> help
```

Lists available shell commands and their usage.

## Collection Operations

Once you select a collection with `use <collection>`, run these operations:

### Insert Documents

```
sengo> insertOne {"name": "Alice", "age": 30, "status": "active"}
```

Returns:
```json
{
  "acknowledged": true,
  "insertedId": "..."
}
```

### Find Documents

Basic query (all documents):
```
sengo> find {}
```

With filter:
```
sengo> find {"status": "active", "age": {"$gte": 25}}
```

With sort and limit:
```
sengo> find {"status": "active"} {"sort": {"age": -1}, "limit": 5}
```

Returns an array of matching documents.

### Find One Document

Get a single document:
```
sengo> findOne {"_id": "12345"}
```

With sort (useful for "newest" or "highest-priority" queries):
```
sengo> findOne {"status": "pending"} {"sort": {"createdAt": -1}}
```

### Count Documents

Count matching documents:
```
sengo> countDocuments {"status": "active"}
```

With skip and limit for windowed counts:
```
sengo> countDocuments {"status": "active"} {"skip": 10, "limit": 25}
```

Returns a number.

### Update Documents

Update one document using `$set`:
```
sengo> updateOne {"_id": "12345"} {"$set": {"status": "completed", "updatedAt": "2026-10-24T15:00:00Z"}}
```

Returns:
```json
{
  "acknowledged": true,
  "modifiedCount": 1
}
```

### Delete Documents

Delete one document:
```
sengo> deleteOne {"_id": "12345"}
```

Returns:
```json
{
  "acknowledged": true,
  "deletedCount": 1
}
```

### Index Management

Create a single-field index:
```
sengo> createIndex {"status": 1}
```

Create a compound index (equality filter then sort field):
```
sengo> createIndex {"category": 1, "priority": -1}
```

List all indexes on the collection:
```
sengo> listIndexes
```

Drop an index by name:
```
sengo> dropIndex "status_1"
```

## Query Operators

Supported operators in filters and queries:

- **Comparison:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- **Membership:** `$in`, `$nin`
- **Logical:** `$or`
- **Existence:** `$exists`
- **Direct equality** (no operator): `{"field": value}`

## Explain Mode for Query Optimization

Use `explain` to inspect query planning, index selection, document loads, and performance characteristics.

### Explain Syntax

Add `{"explain": "<verbosity>"}` as the options argument to any query or write operation.

Supported verbosity levels:

- `queryPlanner` — shows plan and index choice
- `executionStats` — shows plan, index choice, and execution statistics (document loads, timing)
- `allPlansExecution` — shows multiple plans considered and statistics for each

### Example: Find with Explain

```
sengo> find {"status": "active", "priority": {"$gte": 10}} {"explain": "queryPlanner"}
```

Abbreviated output:
```json
{
  "queryPlanner": {
    "stage": "COLLSCAN",
    "comment": "No suitable index found; scanning all documents"
  },
  "msg": "This is a scan."
}
```

With an index, you might see:
```json
{
  "queryPlanner": {
    "stage": "IXSCAN",
    "index": "status_1",
    "plan": {
      "stage": "IXSCAN",
      "index": "status_1",
      "keysExamined": 42,
      "docs": [...]
    }
  }
}
```

### Example: Find with Execution Stats

```
sengo> find {"status": "pending"} {"sort": {"priority": -1}, "limit": 5, "explain": "executionStats"}
```

Output includes:
- `keysExamined` — how many index entries were read
- `docsExamined` — how many documents were loaded from S3
- `docsReturned` — how many documents matched the query
- `sortAppliedInIndexOrder` — whether sort was satisfied by index order
- `executionTimeMillis` — wall-clock time for the operation

### What Explain Reveals

**Index Selection**
- If stage is `IXSCAN`, an index was used; if `COLLSCAN`, a full scan was needed.
- `index` field shows which index was chosen.

**Filter Evaluation Location**
- Index-satisfied filters reduce document loads.
- Filters evaluated after document load appear in `executionStats` with higher `docsExamined` than `docsReturned`.

**Sort and Limit Optimization**
- `sortAppliedInIndexOrder` is true when the index order satisfies the sort without re-sorting.
- Compound indexes with sort as the final field enable this optimization with `limit` for efficient top-N queries.

**Document Load Cost**
- `docsExamined` vs. `docsReturned` shows filtering efficiency.
- Queries with `docsExamined >> docsReturned` benefit from better indexes or tighter filters.

**Write Cost** (for insertOne, updateOne, deleteOne with explain)
- `writeStats` shows how many index entry files were updated.
- More indexes = higher write cost; balance against read benefits.

### Research Workflow: Optimize a Query

1. **Run the query with explain:**
   ```
   sengo> find {"category": "work", "status": "active"} {"explain": "executionStats"}
   ```

2. **Examine the explain output:**
   - Is it a `COLLSCAN` (full scan)? → Consider creating an index.
   - Is `docsExamined >> docsReturned`? → Add a filter or adjust index.
   - Is `sortAppliedInIndexOrder` false? → Compound index could help.

3. **Create a candidate index:**
   ```
   sengo> createIndex {"category": 1, "status": 1}
   ```

4. **Re-run with explain to measure improvement:**
   ```
   sengo> find {"category": "work", "status": "active"} {"explain": "executionStats"}
   ```

5. **Check write cost:**
   ```
   sengo> insertOne {"category": "work", "status": "active", "title": "Task"} {"explain": "executionStats"}
   ```

6. **Iterate:**
   - If write cost is high, drop the index.
   - If read performance is still poor, try a different index shape.
   - If optimization is good, keep the index and document the reasoning.

## Research Examples

### Example 1: Test a Simple Query

```
sengo> use orders
sengo> find {}
```

See all documents in the collection.

### Example 2: Filter and Sort

```
sengo> find {"status": "shipped", "priority": {"$gte": 5}} {"sort": {"createdAt": -1}, "limit": 10}
```

Get the 10 most recent high-priority shipped orders.

### Example 3: Check Index Effectiveness

Without index:
```
sengo> find {"category": "electronics", "inStock": true} {"explain": "executionStats"}
```

Note `keysExamined` and `docsExamined`.

Create index:
```
sengo> createIndex {"category": 1, "inStock": 1}
```

Run again with explain:
```
sengo> find {"category": "electronics", "inStock": true} {"explain": "executionStats"}
```

Compare metrics. Index should reduce `docsExamined`.

### Example 4: Diagnose Why a Query is Slow

```
sengo> countDocuments {"region": "US", "age": {"$gte": 21}} {"explain": "executionStats"}
```

If `docsExamined` is much higher than expected:
- Check if an index exists: `listIndexes`
- If not, create one: `createIndex {"region": 1, "age": 1}`
- Re-run the countDocuments with explain

### Example 5: Write Cost Analysis

Insert before creating an index:
```
sengo> insertOne {"item": "Widget", "qty": 100} {"explain": "executionStats"}
```

Note `writeStats`. Now create an index:
```
sengo> createIndex {"item": 1}
```

Insert again and observe write cost increase. Decide if the index is worth the write overhead for your query patterns.

## Debug Mode

Enable debug output to see detailed argument parsing:
```
sengo> debug
```

This prints arguments parsed from each command, helpful for validating JSON or complex filters.

Disable:
```
sengo> debug
```

## Exit the Shell

```
sengo> exit
```

Or:
```
sengo> quit
```

## Related Documentation

- [Sengo Client Skill](../sengo/SKILL.md) — For generating production client code
- [Sengo Explain Optimizer Skill](../sengo/explain-optimizer/SKILL.md) — For deep optimization diagnosis
- [Shell README](../../shell/README.md) — Setup and installation guide
- [Supported Commands and Operators](../../docs/SUPPORTED-COMMANDS-OPERATORS.md) — Canonical API reference
- [Explain Mode Implementation Guide](../../docs/EXPLAIN-MODE-IMPLEMENTATION-GUIDE.md) — Technical details on explain output structure

## Tips

- Use `explain: 'executionStats'` for real performance data; `queryPlanner` is lighter but less detailed.
- Compound indexes are most effective when the final field is used in sort or range filtering.
- Test index changes with explain before committing to them in production code.
- Use `debug` mode to verify JSON parsing if commands fail silently.
- Always check write cost when adding indexes; not every index is worth the write overhead.
