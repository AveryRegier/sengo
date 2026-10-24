---
description: 'Implement new MongoDB-compatible syntax in Sengo: define behavior from MongoDB docs, write end-to-end tests with S3Simulator, implement cleanly with proper OO design, and integrate with explain mode.'
applyTo: '**/*.{ts,md}'
---

# MongoDB Syntax Implementation Guide for Sengo

This guide walks you through implementing new MongoDB-compatible features in Sengo. Follow these rules to maintain clean architecture, performance, and compatibility.

## Pre-Implementation: Design Phase

Before writing code, complete these steps:

1. **Consult MongoDB Documentation**
   - Read the official MongoDB documentation for the feature you're implementing.
   - Note exact behavior, parameter names, return types, and error conditions.
   - Document edge cases and interactions with other features.

2. **Design Using OO Principles**
   - Prefer composition and objects with methods (actions) over switch/if chains.
   - Consider command/strategy patterns for operator handling.
   - Avoid adding parameters to existing method signatures; use options objects instead.
   - Create new files for distinct features—don't pile logic into existing files unless:
     - You're adding a method to an existing class/object.
     - The logic naturally belongs there (e.g., adding to an operator registry).

3. **Plan for S3/Memory Duality**
   - Identify whether logic should live in shared code or backend-specific code.
   - S3 and Memory implementations should share data-structure logic; backend-specific code handles storage/retrieval only.
   - Use inheritance/strategy pattern for backend-specific behaviors if needed.

## Step 1: Rewrite MongoDB Examples for Your Feature

Use MongoDB documentation examples as templates but **create original examples** following these rules:

### Example Rewriting Template

MongoDB Docs Example:
```javascript
// Official MongoDB example (reference only)
// Find posts where category is "technology" or "sports"
db.posts.find({ $or: [ { category: "technology" }, { category: "sports" } ] })
```

Sengo Test Example (rewrite with different nouns/verbs):
```javascript
// Use different, related nouns/verbs but same syntax structure
// Find recipes where cuisine is "Italian" or "Mediterranean"
collection.find({ $or: [ { cuisine: "Italian" }, { cuisine: "Mediterranean" } ] })
```

### Rules for Rewriting Examples

- **Same syntax structure**, different domain:
  - If MongoDB example queries posts by category, rewrite querying recipes by cuisine.
  - If MongoDB example filters by status, rewrite filtering by priority.
  - If MongoDB example updates a count, rewrite updating a price.
  
- **Maintain logical relationships**:
  - Use nouns that make sense together (e.g., recipe + cuisine, task + priority, user + role).
  - Preserve the semantic meaning of comparisons (a price comparison should still be numeric).

- **Multiple test scenarios**: Create 2–3 variations testing different aspects:
  1. Basic positive case (feature works as documented).
  2. Edge case (boundary conditions, empty results).
  3. Integration case (feature works with other parts of Sengo, like indexes or sorting).

## Step 2: Build End-to-End Tests Using S3BucketSimulator

### Test Structure

Use **Vitest** with **Arrange-Act-Assert** pattern. Each test must:

1. **Arrange**: Set up collection and S3BucketSimulator
2. **Act**: Perform the operation
3. **Assert**: Verify results and S3 usage patterns

### Test Template

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { WithId } from '../../src/types';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

type TestDoc = {
  // Define test document structure
  fieldName: string;
  numericField: number;
};

describe('SengoCollection new feature', () => {
  let client: SengoClient;
  let collection: SengoCollection<TestDoc>;
  let s3sim: S3BucketSimulator;
  let s3Client: { send: (cmd: any) => any };
  let testDocs: WithId<TestDoc>[];

  beforeEach(async () => {
    // Initialize S3 simulator
    s3sim = new S3BucketSimulator();
    s3Client = { send: s3sim.handleCommand.bind(s3sim) };
    
    // Initialize Sengo client with simulated S3
    client = new SengoClient();
    collection = client.db('test').collection<TestDoc>('testCollection');
    (collection.store as any).s3 = s3Client;

    // Insert test documents
    testDocs = [];
    const dataSet = [
      { fieldName: 'alpha', numericField: 10 },
      { fieldName: 'beta', numericField: 20 },
      { fieldName: 'gamma', numericField: 30 },
      { fieldName: 'alpha', numericField: 40 },
    ];
    
    for (const doc of dataSet) {
      const result = await collection.insertOne(doc);
      testDocs.push({ ...doc, _id: result.insertedId });
    }

    // Create indexes if testing with indexes
    await collection.createIndex({ fieldName: 1 });
    
    // Clear logs to measure only the operation under test
    s3sim.clearLogs();
  });

  it('performs feature as documented in MongoDB', async () => {
    // Act: Execute the operation under test
    const result = await collection.find({ fieldName: 'alpha' }).toArray();

    // Assert: Verify result correctness
    expect(result.length).toBe(2);
    expect(result.every(doc => doc.fieldName === 'alpha')).toBe(true);

    // Verify efficient S3 usage
    const logs = s3sim.getLogs();
    const documentFetches = logs.filter(log => 
      log.command === 'getObject' && log.key.includes('/data/')
    );
    
    // Should load only 2 documents (index optimization)
    expect(documentFetches.length).toBe(2);
  });

  it('handles edge case: empty result set', async () => {
    const result = await collection.find({ fieldName: 'nonexistent' }).toArray();
    
    expect(result.length).toBe(0);
    expect(result).toEqual([]);
  });

  it('integrates with index ordering and limit', async () => {
    // Create a more sophisticated index if the feature supports it
    await collection.createIndex({ numericField: 1 });
    s3sim.clearLogs();

    const result = await collection
      .find({ fieldName: 'alpha' })
      .sort({ numericField: 1 })
      .limit(1)
      .toArray();

    // Should get exactly 1 document (the lowest numericField)
    expect(result.length).toBe(1);
    expect(result[0].numericField).toBe(10);

    // Verify index was used efficiently
    const logs = s3sim.getLogs();
    const documentFetches = logs.filter(log => 
      log.command === 'getObject' && log.key.includes('/data/')
    );
    expect(documentFetches.length).toBe(1);
  });
});
```

### S3BucketSimulator Usage

- **Purpose**: Mock S3 without external dependencies; track all S3 operations.
- **Setup**: Create a new instance per test.
- **Inspection**: Use `s3sim.getLogs()` to verify:
  - Minimal document fetches (performance optimization)
  - Index usage patterns
  - Which S3 keys were accessed
  - Number of head/get/put operations

### Key Testing Goals

1. **Correctness**: Results match MongoDB behavior.
2. **Performance**: Smart use of indexes minimizes document loads.
3. **Integration**: Feature works with sort, limit, and other operators.
4. **Edge cases**: Empty results, single results, boundary conditions.

## Step 3: Implement the Feature

### File Organization

- **New operator/feature**: Create a new file `client/src/client/expr/<featureName>.ts`
- **Operator registry**: Update `client/src/client/expr/index.ts` to register the new operator
- **Query/update logic**: Add methods to `client/src/client/collection.ts` if public API is needed
- **Repository layer**: If feature affects indexing or storage, add to `client/src/repository/`
- **Tests**: Create corresponding `client/tests/client/expr/<featureName>.test.ts` or `client/tests/sengo-test/<featureName>.test.ts`

### Implementation Strategy: OO Design

**Pattern 1: Operator Registry (Recommended for Query Operators)**

```typescript
// client/src/client/expr/myOperator.ts
export interface MyOperatorHandler {
  name: string;
  canApplyAt: 'index' | 'postLoad' | 'never';
  evaluate: (fieldValue: any, operatorValue: any) => boolean;
  appliesTo?: (indexField: string) => boolean;
}

export const myOperatorHandler: MyOperatorHandler = {
  name: '$myOp',
  canApplyAt: 'postLoad', // or 'index' if smart index handling
  evaluate: (fieldValue, operatorValue) => {
    // Implement MongoDB-compatible logic
    return fieldValue === operatorValue;
  },
};
```

Register in `client/src/client/expr/index.ts`:
```typescript
import { myOperatorHandler } from './myOperator';

export const operatorHandlers = {
  // ... existing handlers
  '$myOp': myOperatorHandler,
};
```

**Pattern 2: Command/Strategy Pattern (For Complex Features)**

```typescript
// client/src/client/expr/complexFeature.ts
interface QueryStep {
  execute(docs: WithId<T>[]): WithId<T>[];
  toString(): string; // For logging/explain
}

class FilterStep implements QueryStep {
  constructor(private predicate: (doc: WithId<T>) => boolean) {}
  
  execute(docs: WithId<T>[]): WithId<T>[] {
    return docs.filter(this.predicate);
  }

  toString(): string {
    return 'FilterStep';
  }
}

class SortStep implements QueryStep {
  // ... implementation
}
```

### Shared vs. Backend-Specific Code

- **Shared**: Query parsing, operator evaluation, filter logic, sorting
- **S3-specific**: Index key generation, S3 path construction, batch fetch optimization
- **Memory-specific**: In-memory index representation, sorting strategies

Use inheritance or composition to separate concerns:

```typescript
// Shared base class
abstract class CollectionIndex {
  abstract findKeysForQuery(query: QueryExpression): string[];
  abstract persistEntry(key: string, ids: string[]): Promise<void>;
}

// S3 implementation
class S3CollectionIndex extends CollectionIndex {
  async findKeysForQuery(query: QueryExpression): Promise<string[]> {
    // S3-specific logic
  }
}

// Memory implementation
class MemoryCollectionIndex extends CollectionIndex {
  async findKeysForQuery(query: QueryExpression): Promise<string[]> {
    // In-memory logic
  }
}
```

### Parameter Passing: Use Options Objects

**Don't do this:**
```typescript
// Avoid: method signature bloat
query(filter, includeExplain, sortOrder, limitCount, skipCount, useIndex) { }
```

**Do this:**
```typescript
interface QueryOptions {
  explain?: ExplainVerbosity;
  sort?: SortSpec;
  limit?: number;
  skip?: number;
  useIndex?: boolean;
}

query(filter, options?: QueryOptions) { }
```

## Step 4: Integrate with Explain Mode

Explain mode exposes query planning and execution costs. Your feature must report:

1. **If the operator is supported**
2. **Where it's applied** (`index`, `postLoad`, or `notApplied`)
3. **Performance impact** (documents loaded, index entries scanned)

### Explain Integration Points

Add instrumentation to report feature behavior:

```typescript
// In your feature implementation
const explainSteps: ExplainStep[] = [];

explainSteps.push({
  type: 'expression',
  field: 'myField',
  operator: '$myOp',
  implemented: true,
  appliedAt: 'postLoad', // or 'index'
});

// If using index optimization:
explainSteps.push({
  type: 'indexEntryFetch',
  indexName: 'myField_1',
  entriesLoaded: 3,
  reason: 'Query qualified for index scan',
});

// Pass steps to explain sink
explainSink.recordExpressionEvaluation({
  field: 'myField',
  operator: '$myOp',
  implemented: true,
  appliedAt: 'postLoad',
});
```

See [.github/instructions/sengo-explain-mode.instructions.md](./sengo-explain-mode.instructions.md) for full explain mode requirements.

### Test Explain Mode

Add test cases verifying explain output includes your feature:

```typescript
it('reports feature in explain mode', async () => {
  const explain = await collection.find(
    { myField: { $myOp: 'value' } },
    { explain: 'executionStats' }
  );

  // Verify feature is marked as implemented
  const expressionStep = explain.executionStats.executionStages.expressions
    .find(e => e.operator === '$myOp');
  
  expect(expressionStep).toBeDefined();
  expect(expressionStep.implemented).toBe(true);
  expect(expressionStep.appliedAt).toBe('postLoad');
});
```

## Step 5: Update Documentation

### README / SUPPORTED-COMMANDS-OPERATORS.md

Add an entry describing the new feature:

```markdown
- SengoCollection.<newFeature>(args)
  - Supported options/args: [list specific arguments]
  - Implementation: [link to implementation file and line]
  - Test: [link to test file and line]
  - Example:
    ```typescript
    const result = await collection.find({ status: { $newOp: 'value' } });
    ```
```

### SUPPORTED-INDEX-FEATURES.md

If your feature interacts with indexes, document:
- Whether indexes can optimize queries using this operator
- Any new index types or structures needed
- Performance characteristics

## Step 6: Verify with /sengo-shell Skill

Test your feature interactively:

```bash
# Start the Sengo shell
npx sengo-shell

# Test the feature
db.myCollection.insertOne({ name: 'test', value: 42 })
db.myCollection.find({ value: { $newOp: 42 } })
db.myCollection.find({ value: { $newOp: 42 } }, { explain: 'executionStats' })
```

Update `/sengo-shell` skill documentation if the feature introduces new patterns.

## Step 7: Verify with /sengo Skill

Update the `/sengo` skill to include code generation examples using the new operator:

```markdown
**Example: Using $newOp**

\`\`\`typescript
const docs = await collection.find({
  fieldName: { $newOp: value }
}).toArray();
\`\`\`

**Supported with**:
- indexes: Yes, if the feature supports index optimization
- sort: Yes/No (document clearly)
- limit: Yes/No (document clearly)
```

## Critical Rules (Non-Negotiable)

1. **MongoDB Compatibility First**: If a test is provided by a client, MongoDB compatibility takes highest priority over any alternative implementation approach (Rule 6).

2. **Clean Room**: Never copy MongoDB source code. Implement based on behavior documentation and create original implementations.

3. **Performance**: Smart use of indexes is mandatory (Rule 8). Document why document fetches are minimized or explain any unavoidable scans.

4. **Test First**: Write tests before (or alongside) implementation. Tests serve as your specification.

5. **No Infrastructure Changes**: Do not touch build pipelines, linters, test runners, or development tooling (Rule 13).

6. **Shared Code Principle**: Implement logic in shared code when possible; keep backend-specific code in `s3/` or `memory/` subdirectories.

7. **Explain Mode Continuity**: Ensure explain mode produces meaningful output for your feature (Rule 10).

## Common Pitfalls

- **Premature optimization**: Get it working first, then optimize with indexes.
- **Over-parameterization**: Use options objects instead of adding method parameters.
- **Mixing concerns**: Keep query logic, index logic, and storage logic separate.
- **Forgetting edge cases**: Empty results, null values, type mismatches.
- **Skipping explain mode**: Tests won't catch explain bugs; add explain test cases early.
- **Not testing the shell**: The shell validates real-world usability.

## Validation Checklist

Before considering your feature complete:

- [ ] MongoDB examples are rewritten with original content
- [ ] All end-to-end tests pass with S3BucketSimulator
- [ ] Implementation uses OO design and avoids switch/if chains
- [ ] Index optimizations reduce document fetches (verify with `s3sim.getLogs()`)
- [ ] Explain mode reports feature correctly
- [ ] /sengo-shell tests pass
- [ ] Documentation updated (SUPPORTED-COMMANDS-OPERATORS.md)
- [ ] /sengo skill updated with examples
- [ ] Both S3 and Memory backends work (or documented limitation)
- [ ] No changes to build/test infrastructure
- [ ] Code follows project style (minimal comments, clean naming)

## Example Workflow

For implementing a hypothetical `$between` operator:

1. **Design**: Read MongoDB `$between` docs (if it existed); design as `BetweenOperatorHandler`.
2. **Write tests**: Create `client/tests/client/expr/between.test.ts` with 3–4 test cases.
3. **Implement**: Create `client/src/client/expr/between.ts` with operator logic.
4. **Register**: Add to `client/src/client/expr/index.ts` operator registry.
5. **Explain**: Add explain instrumentation for between queries.
6. **Test explain**: Verify explain output includes between operator details.
7. **Document**: Update SUPPORTED-COMMANDS-OPERATORS.md.
8. **Shell test**: Test in /sengo-shell interactively.
9. **Skill update**: Document in /sengo skill.
10. **Validate**: Run full test suite; verify no performance regressions.

---

**Remember**: Use the `/caveman` skill to keep output tokens low during development. Focus on getting tests green first, then optimize with indexes and explain mode.
