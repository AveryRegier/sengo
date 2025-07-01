# Sengo Index Design (Documentation)

## S3 Index File Structure
- Each index entry is stored as a separate S3 object:
  - Path: `collection/indices/indexName/key.json`
  - Contents: JSON array of document IDs for that key
  - ETag is used for optimistic concurrency control

## Index Entry Cache
- In-memory cache per process for index entries
- Cleared on process restart; S3 is always the source of truth
- Cache is not shared between tests or processes

## S3 Simulation and Test Isolation
- Tests use `S3BucketSimulator` to simulate S3 state and log all accesses
- Each test creates its own simulator instance and sets up its own S3 state
- No S3 state or logs are shared between tests
- Helpers are provided for setting up S3 state for index entries and document files

## Lessons Learned
- Test isolation is critical for robust S3-backed index/document testing
- S3 simulation must match production key logic and access patterns
- Index entry cache must be cleared between process restarts
