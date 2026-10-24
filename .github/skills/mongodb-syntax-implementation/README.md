# MongoDB Syntax Implementation Skill

This skill guides developers through implementing new MongoDB-compatible features in Sengo. It combines best practices from the project with a comprehensive workflow that ensures clean, performant, well-tested implementations.

## Files in This Skill

- **SKILL.md** — Main skill file. This is what the agent loads when you invoke `/mongodb-syntax-implementation`
- **README.md** — This file. Overview and reference.

## Related Documentation

- **.github/instructions/mongodb-syntax-implementation.instructions.md** — Detailed implementation guide (17KB) with:
  - 16 rules for successful MongoDB feature implementation
  - Pre-implementation design phase guidance
  - Example rewriting template for MongoDB examples
  - Comprehensive test structure and patterns
  - OO design patterns (command, strategy, registry)
  - Explain mode integration requirements
  - Documentation update checklist
  - Validation checklist

## Quick Start

### If You're Implementing a New MongoDB Operator

1. Invoke the skill: `/mongodb-syntax-implementation: I want to add $between operator for numeric range queries`
2. The skill guides you through 7 phases:
   - **Design Phase**: Read MongoDB docs, plan OO structure
   - **Test Examples**: Rewrite MongoDB examples with your own domain
   - **Build Tests**: End-to-end tests with S3BucketSimulator
   - **Implement**: OO design avoiding parameter bloat
   - **Explain Mode**: Integrate with cost/plan reporting
   - **Documentation**: Update SUPPORTED-COMMANDS-OPERATORS.md
   - **Validation**: Shell testing, performance checks

### Typical Workflow

```
1. Ask agent to help implement a MongoDB feature
2. Agent loads this skill (/mongodb-syntax-implementation)
3. Agent guides you through design + testing + implementation
4. Agent ensures explain mode works and indexes are optimized
5. Agent updates documentation and validates in shell
```

## Key Principles Embedded in This Skill

1. **MongoDB Compatibility First** — Feature behavior must match MongoDB docs, not user preference
2. **Test-Driven** — Tests written before implementation; tests define the contract
3. **Performance Through Design** — Index optimization is mandatory, not optional
4. **Clean OO Code** — Operators as objects/strategies, not switch statements
5. **Explain Mode Integration** — Cost/plan visibility required from day one
6. **Clean Room** — No MongoDB source copying; original implementations only

## Files Modified When Using This Skill

A typical feature implementation touches:

```
client/src/client/expr/<feature>.ts          # New operator logic
client/src/client/expr/index.ts              # Register operator
client/tests/client/expr/<feature>.test.ts   # End-to-end tests
docs/SUPPORTED-COMMANDS-OPERATORS.md         # Update support matrix
.github/skills/sengo/SKILL.md                # Example code in /sengo skill
```

Optional backend-specific files:
```
client/src/repository/s3/<feature>.ts        # S3-specific optimization (if needed)
client/src/repository/memory/<feature>.ts    # Memory-specific impl (if needed)
```

## Example: Implementing $between

Request:
```
/mongodb-syntax-implementation: I need to add $between operator 
for range queries like { age: { $between: [18, 65] } }
```

Skill workflow:
1. **Phase 1**: Read MongoDB range query docs → plan `BetweenOperatorHandler` class
2. **Phase 2**: Rewrite MongoDB examples → "Find employees between salary 50k-100k"
3. **Phase 3**: Write tests → `$between.test.ts` with positive/edge/integration cases
4. **Phase 4**: Implement → `between.ts` with operator handler, register in index.ts
5. **Phase 5**: Add explain instrumentation → report `appliedAt: 'postLoad'`
6. **Phase 6**: Update SUPPORTED-COMMANDS-OPERATORS.md with example
7. **Phase 7**: Test in /sengo-shell → verify interactive behavior

## Integration with Other Skills

This skill works alongside:

- **`/sengo` skill** — Generate code using newly implemented features
- **`/sengo-shell` skill** — Test features interactively in Sengo shell
- **`/sengo-explain-optimizer` skill** — Diagnose explain mode output
- **`/caveman` skill** — Keep implementation chat tokens low
- **`/rubber-duck` skill** — Review OO design before implementation
- **`/code-review` skill** — Review final implementation for correctness

## Tests and Validation

The skill emphasizes:

- **S3BucketSimulator Testing** — End-to-end tests with S3 mock backend
- **Performance Validation** — `s3sim.getLogs()` proves index optimization works
- **MongoDB Compatibility** — Tests based on rewritten MongoDB examples
- **Integration Testing** — Features work with sort, limit, compound indexes, explain mode

All tests use **Vitest** (not Jest), no new dependencies added.

## Design Patterns Introduced

The skill teaches:

- **Operator Registry Pattern** — Handlers registered in a map, not inline logic
- **Strategy Pattern** — Query steps as interchangeable objects
- **Command Pattern** — Complex operations as command objects
- **Options Objects** — Avoid method parameter bloat
- **Null Object Pattern** — Optional features with no-op implementations

## Performance Requirements

Every implementation must:

1. **Smart Index Design** — Index keys minimize S3 document fetches
2. **Compound Index Support** — Work efficiently with multi-field indexes
3. **Sort/Limit Optimization** — Leverage index sort order
4. **No Unnecessary Scans** — Document any full-collection scans in explain output

## Documentation Links in the Skill

The skill references:

- [MongoDB Official Docs](https://docs.mongodb.com) — Source of truth for behavior
- [Sengo Explain Mode Guide](../instructions/sengo-explain-mode.instructions.md) — How to instrument explain
- [Index Design Principles](../../docs/INDEX-DESIGN.md) — How S3/Memory indexes work
- [Unsupported Operators Guard](../instructions/sengo-unsupported-mongo-operators.instructions.md) — What not to implement

## Validation Checklist

The skill includes a final checklist:

- ✅ MongoDB examples rewritten with original domain
- ✅ All tests pass with S3BucketSimulator
- ✅ OO design: no switch/if chains
- ✅ Index optimization verified via `s3sim.getLogs()`
- ✅ Explain mode reports feature correctly
- ✅ /sengo-shell tests pass
- ✅ Documentation updated
- ✅ /sengo skill updated
- ✅ Both S3 and Memory backends supported
- ✅ No build/test infrastructure changes
- ✅ Code clean (minimal comments, clear naming)

## Invoking the Skill

```bash
# From VS Code Copilot Chat:
/mongodb-syntax-implementation: What MongoDB operator do you want to add?

# Or for a specific feature:
/mongodb-syntax-implementation: Implement $startsWith operator for text pattern matching
```

The agent loads SKILL.md and guides you interactively through each phase.

---

**Next Steps:**
- Use this skill when you have a MongoDB feature to implement
- Reference `.github/instructions/mongodb-syntax-implementation.instructions.md` for detailed examples
- Test your implementation in `/sengo-shell` to validate end-to-end behavior
