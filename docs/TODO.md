# TODO



## Cleanup
- [ ] Remove test and code cruft that accumulated while fixing S3 access log expectation failures

## Index Maintenance Gaps / Future Work
- [x] Ensure index maintenance is handled for document deletion (deleteOne/remove)
- [ ] Extend index maintenance for full document replacement (not just $set)
- [ ] Add index maintenance for bulk operations (bulk insert/update/delete)
- [ ] Consider transactional consistency: handle partial failures between index and document persistence
