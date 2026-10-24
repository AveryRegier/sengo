---
name: mongodb-syntax-implementation
description: Implement new MongoDB-compatible syntax in Sengo. Guide through MongoDB docs → test examples → OO design → implementation → explain mode → documentation.
argument-hint: What MongoDB operator or feature do you want to implement, and what is your target API signature?
---

# MongoDB Syntax Implementation Guide

Use this skill when implementing a new MongoDB-compatible feature in Sengo, such as:
- New query operators (e.g., `$between`, `$regex`)
- New update operators (e.g., `$inc`, `$push`)
- New command options (e.g., `projection`, `collation`)
- New commands (e.g., `bulkWrite`)

## When to Use This Skill

✅ **Use this skill when:**
- Implementing a MongoDB feature not yet in Sengo
- You have MongoDB docs for the feature and want to start with a design phase
- You want guidance on test structure (S3BucketSimulator, end-to-end)
- You need OO design patterns to avoid parameter bloat and switch statements
- You're integrating with explain mode and index optimization
- You need to validate shell behavior and documentation updates

❌ **Don't use this skill for:**
- Fixing bugs in existing features (use direct debugging)
- Reviewing or refactoring existing code (use code-review or rubber-duck skills)
- Documenting existing features (update docs directly)

## Workflow Phases

### Phase 1: Design from MongoDB Documentation

1. **Read MongoDB docs** for the exact feature specification
2. **Note**: parameter names, return types, error conditions, edge cases
3. **Design using OO principles**:
   - Operators as objects/strategies, not switch cases
   - Options objects, never growing method signatures
   - Separate files per feature; don't pile into existing files
   - Inheritance/composition for S3-specific vs. Memory-specific code

**Example Design Decision:**
- For `$between` operator: Create `BetweenOperatorHandler` interface with `.evaluate()`, `.canApplyAt()` methods
- Register in operator registry, not inline in query parser

### Phase 2: Write Original Test Examples

Rewrite MongoDB documentation examples with **different domain nouns** but **identical syntax**:

**MongoDB Docs:**
```javascript
// Find posts where category is "technology" or "sports"
db.posts.find({ $or: [ { category: "technology" }, { category: "sports" } ] })
```

**Your Test:**
```typescript
// Find recipes where cuisine is "Italian" or "Mediterranean"
collection.find({ $or: [ { cuisine: "Italian" }, { cuisine: "Mediterranean" } ] })
```

Rules:
- Same syntax structure, different domain (posts → recipes, category → cuisine)
- Maintain logical relationships (comparisons stay numeric/string-appropriate)
- Write 3–4 test scenarios: basic positive, edge case (empty results), integration (with index/sort/limit)

### Phase 3: Build End-to-End Tests with S3BucketSimulator

Use Vitest with Arrange-Act-Assert pattern:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SengoClient } from '../../src/client/client';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';

describe('New Feature', () => {
  let s3sim: S3BucketSimulator;
  let collection: SengoCollection<TestDoc>;

  beforeEach(async () => {
    s3sim = new S3BucketSimulator();
    // Setup collection with S3 simulator
    // Insert test data
    // Create indexes
    s3sim.clearLogs(); // Track only the operation under test
  });

  it('basic positive case', async () => {
    const result = await collection.find({ field: { $newOp: value } }).toArray();
    expect(result.length).toBe(expected);
    
    // Verify efficient S3 usage
    const logs = s3sim.getLogs();
    const documentFetches = logs.filter(log => 
      log.command === 'getObject' && log.key.includes('/data/')
    );
    expect(documentFetches.length).toBe(expectedDocumentsLoaded);
  });

  it('edge case: empty result', async () => {
    const result = await collection.find({ field: { $newOp: impossible } }).toArray();
    expect(result.length).toBe(0);
  });

  it('integrates with index, sort, limit', async () => {
    await collection.createIndex({ field: 1 });
    const result = await collection
      .find({ field: { $newOp: value } })
      .sort({ otherField: 1 })
      .limit(1)
      .toArray();
    
    expect(result.length).toBe(1);
    // Verify minimal document loads via s3sim.getLogs()
  });
});
```

**Key Testing Principles:**
- Track S3 operations to verify index optimization reduces document fetches
- Test integration with sort, limit, and compound indexes
- Validate MongoDB compatibility (use rewritten examples)
- Test edge cases (empty, single, boundary conditions)

### Phase 4: Implement with OO Design

**File Organization:**
- New operator: `client/src/client/expr/<operatorName>.ts`
- Registry update: `client/src/client/expr/index.ts`
- Backend-specific: `client/src/repository/s3/` or `memory/`
- Test: `client/tests/client/expr/<operatorName>.test.ts`

**Pattern: Operator Registry (Recommended)**

```typescript
// client/src/client/expr/myOp.ts
export interface OperatorHandler {
  name: string;
  canApplyAt: 'index' | 'postLoad' | 'never';
  evaluate: (fieldValue: any, operatorValue: any) => boolean;
  appliesTo?: (indexField: string) => boolean;
}

export const myOpHandler: OperatorHandler = {
  name: '$myOp',
  canApplyAt: 'postLoad',
  evaluate: (fieldValue, operatorValue) => {
    return fieldValue === operatorValue; // MongoDB-compatible logic
  },
};
```

Register in `client/src/client/expr/index.ts`:
```typescript
import { myOpHandler } from './myOp';
export const operatorHandlers = { '$myOp': myOpHandler, /* ... */ };
```

**Pattern: Strategy/Command for Complex Logic**

```typescript
// client/src/repository/queryPlanner.ts
interface QueryStep {
  execute<T>(docs: WithId<T>[]): WithId<T>[];
}

class FilterStep implements QueryStep {
  constructor(private predicate: (doc: any) => boolean) {}
  execute<T>(docs: WithId<T>[]): WithId<T>[] {
    return docs.filter(this.predicate);
  }
}

// Compose: new FilterStep() | new SortStep() | new LimitStep()
```

**Key OO Rules:**
- No switch/if chains; use handlers/strategies instead
- No parameter bloat; use options objects
- S3-specific logic in `s3/` subdirectory; shared logic in parent
- Separate file per feature; merge only when it clearly belongs together

### Phase 5: Integrate with Explain Mode

Explain mode must report:
1. **If the operator is supported** (`implemented: true`)
2. **Where it's applied** (`appliedAt: 'index' | 'postLoad' | 'notApplied'`)
3. **Performance impact** (documents loaded, index entries scanned)

Add explain instrumentation:

```typescript
// In feature implementation
explainSink.recordExpressionEvaluation({
  field: 'myField',
  operator: '$myOp',
  implemented: true,
  appliedAt: 'postLoad',
});

// If using index:
explainSink.recordIndexEntryFetch({
  indexName: 'myField_1',
  entriesLoaded: 3,
  reason: 'Query qualified for index scan',
});
```

**Test Explain Mode:**
```typescript
it('reports in explain mode', async () => {
  const explain = await collection.find(
    { field: { $myOp: value } },
    { explain: 'executionStats' }
  );

  const exprStep = explain.executionStats.executionStages.expressions
    .find(e => e.operator === '$myOp');
  
  expect(exprStep).toBeDefined();
  expect(exprStep.implemented).toBe(true);
  expect(exprStep.appliedAt).toBe('postLoad');
});
```

See [.github/instructions/sengo-explain-mode.instructions.md](../instructions/sengo-explain-mode.instructions.md) for full requirements.

### Phase 6: Update Documentation

**SUPPORTED-COMMANDS-OPERATORS.md:**
```markdown
- SengoCollection.find(query) with $myOp operator
  - Supported in filters: `{ field: { $myOp: value } }`
  - Supported options: `sort`, `limit`
  - Implementation: [client/src/client/expr/myOp.ts](../../client/src/client/expr/myOp.ts#L10)
  - Test: [client/tests/client/expr/myOp.test.ts](../../client/tests/client/expr/myOp.test.ts#L20)
  - Example:
    ```typescript
    collection.find({ priority: { $myOp: 5 } })
    ```
```

**Update /sengo Skill:**
Add examples using the new operator to [.github/skills/sengo/SKILL.md](.github/skills/sengo/SKILL.md).

### Phase 7: Validate Shell and Explain

**Test in /sengo-shell:**
```bash
# Start Sengo shell
npx sengo-shell

# Insert test data
db.myCollection.insertOne({ name: 'test', value: 42 })

# Test the feature
db.myCollection.find({ value: { $myOp: 42 } })

# Test explain mode
db.myCollection.find({ value: { $myOp: 42 } }, { explain: 'executionStats' })
```

**Verify:**
- Feature works interactively in shell
- Explain mode output is clear and correct
- Error messages are helpful if operator is used incorrectly

## Non-Negotiable Rules

1. **MongoDB Compatibility First**: Tests provided by clients take highest priority over alternative approaches
2. **Clean Room**: Never copy MongoDB source; implement based on behavior docs and original examples
3. **Performance**: Smart index usage is mandatory; document any unavoidable scans
4. **Test-Driven**: Write tests before implementation
5. **No Infrastructure Changes**: Don't touch build, test runners, linters, or CI/CD
6. **Explain Mode**: Must work with your feature; add tests early
7. **Both Backends**: Support S3 and Memory (or document limitation clearly)

## Validation Checklist

Before considering the feature complete:

- [ ] MongoDB examples rewritten with original domain
- [ ] All end-to-end tests pass with S3BucketSimulator
- [ ] OO design: no switch/if chains, options objects used
- [ ] Index optimization reduces document fetches (verify via `s3sim.getLogs()`)
- [ ] Explain mode reports feature correctly
- [ ] /sengo-shell tests pass
- [ ] SUPPORTED-COMMANDS-OPERATORS.md updated
- [ ] /sengo skill updated with examples
- [ ] Both S3 and Memory backends work (or limitation documented)
- [ ] No build/test infrastructure changes
- [ ] Code clean (minimal comments, clear naming)

## Related References

- [.github/instructions/sengo-explain-mode.instructions.md](../instructions/sengo-explain-mode.instructions.md) — Full explain mode requirements
- [.github/instructions/sengo-unsupported-mongo-operators.instructions.md](../instructions/sengo-unsupported-mongo-operators.instructions.md) — Guard against unsupported operators
- [docs/INDEX-DESIGN.md](../../docs/INDEX-DESIGN.md) — Index structure and optimization
- [.github/skills/sengo/references/SUPPORTED-COMMANDS-OPERATORS.md](../sengo/references/SUPPORTED-COMMANDS-OPERATORS.md) — Current support matrix

## Quick Checklist: Start Your Implementation

1. ✅ Read MongoDB docs for the feature
2. ✅ Write rewritten test examples
3. ✅ Build tests with S3BucketSimulator
4. ✅ Implement with OO design
5. ✅ Add explain mode instrumentation
6. ✅ Test in /sengo-shell
7. ✅ Update documentation
8. ✅ Validate checklist above

Use `/caveman` skill to keep output tokens low during implementation.
