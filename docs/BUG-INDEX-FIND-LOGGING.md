# Bug Report: Index-Backed Find Logging and Query Issues

## Summary

There is a bug in the Sengo project where debug logging for index-backed queries (specifically, searching indexes to find the list of documents) was missing or incomplete. This made it difficult to trace and debug issues where inserted documents were not returned by queries using indexes, even though index entries appeared correct.

## Details
- Debug logs were present for `insertOne`, `updateOne`, and index update operations, but not for the actual index lookup during `find` operations.
- This gap made it hard to diagnose whether the index was being searched correctly or if the mapping from index key to document IDs was functioning as intended.
- The issue was discovered while investigating why new documents were not returned by indexed queries, despite correct index entry updates.

## Possible Root Cause (to investigate first)
- The index update logic may not use the same in-memory object for the index entry as is used for searching. If the update and search paths operate on different objects or caches, index changes may not be visible to queries until a reload or process restart. This should be the first area to investigate when researching this bug.

## Steps to Reproduce
1. Insert a document with an indexed field.
2. Query using that field (with an index present).
3. Observe that the new document is not returned, and there is no debug log showing the index lookup or the list of document IDs found.

## Impact
- Makes debugging index-backed queries difficult.
- Can mask underlying issues in index maintenance or lookup logic.

## Resolution
- Add debug logging to the `findIdsForKey` method in both S3 and memory index backends to trace index lookups and the resulting document ID lists.
- Ensure that all index-backed query operations are logged for easier diagnosis.

---

*Created: 2025-07-01*
