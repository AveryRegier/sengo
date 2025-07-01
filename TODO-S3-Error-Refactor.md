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
