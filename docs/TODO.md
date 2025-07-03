# TODO

## Index Maintenance
- [ ] Remove document IDs from old index keys when indexed fields change on update
  - On update, if an indexed field changes, remove the doc ID from the old key and add it to the new key
  - This is required for full MongoDB compatibility and correct query results

## Cleanup
- [ ] Remove test and code cruft that accumulated while fixing S3 access log expectation failures
