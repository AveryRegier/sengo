# Sengo Skills Ecosystem - MongoDB Syntax Implementation Skill

This document shows how the new `mongodb-syntax-implementation` skill integrates into the Sengo development workflow.

## Skills Ecosystem Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Sengo Development Workflow                               │
└─────────────────────────────────────────────────────────────────────────────┘

                          ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                          ┃  /mongodb-syntax-impl    ┃  ← NEW SKILL
                          ┃  IMPLEMENT NEW FEATURE   ┃
                          ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                                      ↓
                    ┌──────────────────────────────────┐
                    │   7-Phase Implementation Guide   │
                    │  1. Design from MongoDB docs     │
                    │  2. Rewrite test examples        │
                    │  3. Build S3BucketSimulator tests│
                    │  4. OO implementation            │
                    │  5. Explain mode integration     │
                    │  6. Documentation updates        │
                    │  7. Shell validation             │
                    └──────────────────────────────────┘
                                      ↓
          ┌─────────────────────────────────────────────────────────┐
          │  SKILL INTEGRATION POINTS                               │
          │─────────────────────────────────────────────────────────│
          │                                                          │
          │  Phase 2: /caveman (low-token coding)                   │
          │  Phase 4: /rubber-duck (design review)                  │
          │  Phase 5: Refer to /sengo-explain-optimizer             │
          │  Phase 6: Update /sengo skill documentation             │
          │  Phase 7: Test with /sengo-shell                        │
          │                                                          │
          └─────────────────────────────────────────────────────────┘
                                      ↓
          ┌─────────────────────────────────────────────────────────┐
          │  GENERATED ARTIFACTS                                    │
          │─────────────────────────────────────────────────────────│
          │                                                          │
          │  • New operator file (e.g., client/src/client/expr/)   │
          │  • Test file with S3BucketSimulator                     │
          │  • Updated docs/SUPPORTED-COMMANDS-OPERATORS.md         │
          │  • Updated /sengo skill examples                        │
          │  • Explain mode instrumentation                         │
          │                                                          │
          └─────────────────────────────────────────────────────────┘
                                      ↓
          ┌─────────────────────────────────────────────────────────┐
          │  FINAL VALIDATION                                       │
          │─────────────────────────────────────────────────────────│
          │                                                          │
          │  Run: npm test (all tests pass)                         │
          │  Run: /sengo-shell (interactive test)                   │
          │  Check: Explain mode working                            │
          │  Verify: Index optimization with s3sim.getLogs()        │
          │  Review: /code-review skill (final check)               │
          │                                                          │
          └─────────────────────────────────────────────────────────┘
```

## Skill Responsibilities

### `/mongodb-syntax-implementation` (NEW)
**Purpose**: Guide implementation of new MongoDB-compatible features

**Handles**:
- Design phase (MongoDB docs → OO structure)
- Test structure (S3BucketSimulator patterns)
- Implementation patterns (operator registry, strategy pattern)
- Explain mode integration
- Documentation checklist
- Validation workflow

**Workflow**:
1. Interactive 7-phase guided implementation
2. Design patterns with examples
3. Test templates and validation
4. Integration checklist

**References**:
- Detailed instructions: `.github/instructions/mongodb-syntax-implementation.instructions.md`
- Test patterns: Existing tests in `client/tests/`
- Explain mode: `.github/instructions/sengo-explain-mode.instructions.md`

---

### `/sengo` (Existing, Enhanced)
**Purpose**: Generate valid Sengo client code

**When to use**:
- After implementing a new operator with this skill
- Generate example code for new feature
- Code snippets for SUPPORTED-COMMANDS-OPERATORS.md

**Enhanced by this skill**:
- New operator examples added
- Validation rules for new operators
- Index usage patterns for new features

---

### `/sengo-shell` (Existing, Enhanced)
**Purpose**: Interactive Sengo shell for testing

**When to use**:
- Phase 7 of implementation: Validate shell behavior
- Test new operator interactively
- Verify explain mode output

**Example usage after implementing `$between`**:
```javascript
db.employees.insertOne({ name: 'Alice', salary: 75000 })
db.employees.find({ salary: { $between: [50000, 100000] } })
db.employees.find({ salary: { $between: [50000, 100000] } }, 
                   { explain: 'executionStats' })
```

---

### `/caveman` (Existing, Enhanced)
**Purpose**: Ultra-compressed communication to save tokens

**When to use**:
- Phase 2: Writing test examples (rewriting MongoDB docs)
- Phase 4: Implementing OO design
- Phase 5: Adding explain instrumentation
- Reduces output by ~65% while preserving technical accuracy

**Usage**: `/caveman full` for full mode during implementation

---

### `/rubber-duck` (Existing, Enhanced)
**Purpose**: Design review for meaningful bugs and logic errors

**When to use**:
- Phase 1: Review OO design before implementation
- Phase 4: Review implementation design
- Check for pattern violations (switch statements, parameter bloat)

**Asks the agent to**:
- Find meaningful bugs in design
- Identify design flaws
- Validate OO principles

---

### `/code-review` (Existing, Enhanced)
**Purpose**: High-confidence bug detection in code

**When to use**:
- After Phase 4: Review implementation for bugs
- Before submitting: Final correctness check
- Performance review: Index optimization validation

**Verifies**:
- Logic errors
- Type safety
- Index efficiency via S3 patterns

---

### `/sengo-explain-optimizer` (Existing)
**Purpose**: Explain mode diagnosis and optimization

**When to use**:
- During Phase 5: Validate explain instrumentation
- Debug explain output format
- Understand cost breakdown

---

## Implementation Example Workflow

### Scenario: Add `$between` operator

```
1. Start skill
   /mongodb-syntax-implementation: Implement $between for range queries

2. Skill guides Phase 1: Design
   → Read MongoDB range query docs
   → Plan BetweenOperatorHandler class

3. Skill guides Phase 2: Rewrite Examples
   → MongoDB: "Find posts with views between 100-1000"
   → Your test: "Find recipes with prep time between 15-30 minutes"
   
4. Switch to /caveman for low tokens
   /caveman full
   
5. Skill guides Phase 3: Build Tests
   → S3BucketSimulator test template
   → Verify index optimization
   
6. Request /rubber-duck review of design
   /rubber-duck: Review my $between OO design
   
7. Implement Phase 4: Code
   → Create between.ts operator handler
   → Register in expr/index.ts
   
8. Skill guides Phase 5: Explain Mode
   → Add instrumentation
   → Test explain output
   
9. Skill guides Phase 6: Documentation
   → Update SUPPORTED-COMMANDS-OPERATORS.md
   → Update /sengo skill with examples
   
10. Skill guides Phase 7: Validation
    → Test in /sengo-shell
    → Verify index optimization
    
11. Request /code-review for final check
    /code-review: Review $between implementation
    
12. Done: New operator ready for use
    /sengo: Generate code using new $between operator
```

## Integration Points

### With Test Infrastructure
- **No new dependencies**: Uses existing Vitest + S3BucketSimulator
- **Test patterns**: Reusable templates from `client/tests/`
- **Performance validation**: `s3sim.getLogs()` for index verification

### With Explain Mode
- **Instrumentation**: `explainSink` interface
- **Required steps**: Recording expression evaluation, index access
- **Testing**: Explain output validation in feature tests

### With Documentation
- **Support matrix**: `docs/SUPPORTED-COMMANDS-OPERATORS.md`
- **Index features**: `docs/SUPPORTED-INDEX-FEATURES.md`
- **Operator guard**: `.github/instructions/sengo-unsupported-mongo-operators.instructions.md`

### With Shell
- **Validation**: Interactive testing of new operators
- **Error handling**: User-friendly error messages
- **Explain integration**: Shell supports `{ explain: '...' }` option

---

## Key Design Decisions

### Why This Skill Structure?

1. **Separated from General Coding**
   - MongoDB feature implementation has unique requirements
   - Specific workflow (design → test → implement → explain → validate)
   - Enforces 16 non-negotiable rules consistently

2. **Comprehensive Guidance**
   - 17KB detailed instructions + 11KB skill file
   - Covers all phases: design, testing, implementation, integration
   - Templates and patterns prevent mistakes

3. **Integration with Existing Skills**
   - Leverages `/caveman` for efficiency
   - Leverages `/rubber-duck` for design review
   - Leverages `/code-review` for correctness
   - Enhances `/sengo` and `/sengo-shell` as features are added

4. **No Infrastructure Changes**
   - Uses existing Vitest framework
   - Uses existing S3BucketSimulator
   - Uses existing explain mode infrastructure
   - Clean room design patterns only

---

## Checklist: Before Using the Skill

✅ You have MongoDB documentation for the feature  
✅ Feature is not already implemented in Sengo  
✅ You understand test-driven development  
✅ You have time to follow all 7 phases  
✅ You're ready for comprehensive implementation (not just stub)

---

## Files You'll Touch

When implementing with this skill, expect to create/modify:

**Always**:
- `client/src/client/expr/<feature>.ts` (new operator)
- `client/src/client/expr/index.ts` (register operator)
- `client/tests/client/expr/<feature>.test.ts` (tests)
- `docs/SUPPORTED-COMMANDS-OPERATORS.md` (document)

**Often**:
- `.github/skills/sengo/SKILL.md` (examples)
- `client/src/client/collection.ts` (if new public API)
- `client/src/repository/index.ts` (if index changes)

**Sometimes**:
- `client/src/repository/s3/` (backend-specific)
- `client/src/repository/memory/` (backend-specific)
- Tests in `client/tests/repository/` (index behavior)

**Never**:
- Build configuration
- Test infrastructure
- Linter/formatter config
- CI/CD pipelines

---

## Support and References

**When stuck**:
1. Re-read the detailed instructions: `.github/instructions/mongodb-syntax-implementation.instructions.md`
2. Review existing tests for patterns: `client/tests/client/expr/`
3. Ask the skill directly with your specific question
4. Use `/rubber-duck` for design issues
5. Use `/code-review` for implementation issues

**Key References**:
- MongoDB Official Docs: https://docs.mongodb.com
- Sengo INDEX-DESIGN: `docs/INDEX-DESIGN.md`
- Explain Mode Guide: `.github/instructions/sengo-explain-mode.instructions.md`
- Unsupported Operators: `.github/instructions/sengo-unsupported-mongo-operators.instructions.md`

---

**Ready to implement a MongoDB feature? Use this skill:**
```
/mongodb-syntax-implementation: What operator or feature do you want to add?
```
