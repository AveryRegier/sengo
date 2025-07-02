# TODO

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
