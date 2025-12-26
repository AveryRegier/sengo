<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This project is a TypeScript Node.js library called 'sengo'. It is an open source clean room implementation of a useful subset of the MongoDB client for Node.js, using AWS S3 as a backend for document storage.

## General Guidelines
- Focus on MongoDB-like API design for document operations.
- Use AWS SDK v3 (@aws-sdk/client-s3) for S3 interactions.
- Ensure all code is original and does not copy MongoDB source.
- Prioritize clean, readable, and well-documented TypeScript code.

## Testing
- Test framework: **Vitest** (NOT Jest - use describe/it/expect from 'vitest')
- S3 testing: Use `S3BucketSimulator` from `tests/repository/s3/S3BucketSimulator.ts` to mock S3 operations
- Each test creates its own S3BucketSimulator instance - no shared state between tests
- Tests can inspect S3 operations via `s3sim.getLogs()` to verify minimal document fetches

## Index Design Principles (CRITICAL)
**Primary Goal:** Minimize expensive S3 document fetches during queries.

### Document Storage
- Path: `collection/data/<_id>.json`
- `_id` is naturally indexed via S3 path - no separate index needed for `_id` lookups

### Single-Key Indexes
- Example: `{ name: 1 }` 
- Index key = field value (e.g., `Milo`)
- Index file: `collection/indices/name_1/Milo.json`
- Contents: JSON array of `_id` strings: `["id1", "id2", "id3"]`

### Compound Indexes (IMPORTANT)
- Example: `{ category: 1, priority: 1 }`
- **Index key = ALL NON-FINAL fields only** (e.g., `work`)
- Index file: `collection/indices/category_1_priority_1/work.json`
- Contents: `_id` array **sorted by the FINAL field** (priority in this case)
- For 3-field index `{ category: 1, status: 1, priority: 1 }`:
  - Key = `work|active` (non-final fields joined by `|`)
  - File contains IDs sorted by priority

### Key Implementation Rules
1. **Index key building:** Use only non-final indexed fields to create S3 key
2. **Sort order:** Final indexed field determines sort order WITHIN the index entry array
3. **Query optimization:** Index entries + sort order enable `$limit` queries to fetch minimal documents
4. **No final field in key:** Never include the final indexed field in the S3 object key name unless it's the only field

## Code Structure
- Main client code: `client/src/`
- Repository layer: `client/src/repository/` (handles S3 storage & indexing)
- Collection indexes: `client/src/repository/collectionIndex.ts` (base), `s3/s3CollectionIndex.ts` (S3 impl)
- Tests: `client/tests/` with parallel structure to `src/`

## Type System
- Use `NormalizedIndexKeyRecord[]` for index definitions (type from `repository/index.ts`)
- Use `WithId<T>` for documents with `_id` field
- MongoDB error classes: `MongoInvalidArgumentError`, `MongoServerError`, `MongoNetworkError`
