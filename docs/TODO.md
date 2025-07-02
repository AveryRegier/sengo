# TODO (Consolidated)

## Index Maintenance
- [x] Update all indexes after insert and update (add new/updated doc to index)
- [ ] Remove document IDs from old index keys when indexed fields change on update
  - On update, if an indexed field changes, remove the doc ID from the old key and add it to the new key
  - This is required for full MongoDB compatibility and correct query results

## S3 Access Log Test Failures
- [ ] Investigate and fix S3 access log expectation failures in `s3CollectionStore.index.test.ts`
  - Some tests expect certain S3 index/doc file accesses after process restarts or cache resets
  - Possible causes:
    - S3BucketSimulator state/log not set up or cleared as expected
    - Index cache not cleared or not reloaded as expected
    - Test setup may not match production S3 access patterns
  - Action:
    - Review test setup and S3BucketSimulator usage
    - Ensure S3 state and logs are set up and cleared per test and per simulated process restart
    - Ensure index cache is cleared between process restarts
    - Ensure test assertions match actual S3 access patterns

## Other
- [x] Add tests for index entry removal on update (when indexed fields change)
- [ ] Document index maintenance and test isolation in README and design docs

---

# TODO: S3 Error Refactor and Test Robustness

## Completed
- Refactored S3 mocks in tests to use a single s3MockSend function, forwarding all S3 commands to S3BucketSimulator
- Added normalization helpers and overloads to S3BucketSimulator
- Implemented handleCommand in S3BucketSimulator
- Mocked AWS SDK v3 command constructors in tests
- Removed strict single-call check in S3BucketSimulator.getObject
- Updated S3BucketSimulator to log all index file accesses (read, write, delete)
- Refactored S3 index/document tests to use a new S3BucketSimulator instance for each test and for each simulated process restart
- Added helpers to set up S3 state from scratch in each test
- Updated tests to clear the S3 access log after setup and before assertions
- Updated test assertions to use correct key logic and to use `toContain` for required S3 keys

## Remaining
- Some S3 index/document tests may still fail if S3 access log does not contain expected keys after process restarts
- Further review and adjustment of test setup and assertions may be needed to ensure all tests pass independently

## Lessons Learned
- S3 state and access logs must be per-test; no sharing between tests
- Index entry cache must be cleared between process restarts
- Test helpers are essential for robust, independent test setup
- S3 simulation must match production key logic and access patterns
