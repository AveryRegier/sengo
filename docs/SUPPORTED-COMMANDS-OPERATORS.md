# Sengo Client MongoDB Support Analysis

This analysis is intentionally scoped to client API support (not shell command UX). Every support claim is backed by both implementation references and at least one test reference.

## Client API Commands

### Command Options Matrix

This section lists options supported by each client command, including commands with no options.

- SengoClient.db(dbName?)
  - Supported options/args: optional dbName (string), default memory
  - Implementation: default arg in [client/src/client/client.ts](../client/src/client/client.ts#L13)
  - Test: db().collection() usage in [client/tests/index.test.ts](../client/tests/index.test.ts#L10)
- SengoClient.close()
  - Supported options/args: none
  - Implementation: [client/src/client/client.ts](../client/src/client/client.ts#L20)
  - Test: close behavior in [client/tests/index.test.ts](../client/tests/index.test.ts#L32)
- SengoDb.collection(name)
  - Supported options/args: required name only
  - Implementation: [client/src/client/db.ts](../client/src/client/db.ts#L13)
  - Test: collection retrieval in [client/tests/index.test.ts](../client/tests/index.test.ts#L10)
- SengoDb.close()
  - Supported options/args: none
  - Implementation: [client/src/client/db.ts](../client/src/client/db.ts#L24)
  - Test: closed-store behavior after close in [client/tests/index.test.ts](../client/tests/index.test.ts#L33)
- SengoCollection.insertOne(doc)
  - Supported options/args: required doc only
  - Implementation: [client/src/client/collection.ts](../client/src/client/collection.ts#L31)
  - Test: insertOne API in [client/tests/index.test.ts](../client/tests/index.test.ts#L12)
- SengoCollection.find(query, options?)
  - Supported options/args:
    - query required
    - options.sort supported
    - options.limit supported
  - Implementation:
    - FindOptions type in [client/src/client/collection.ts](../client/src/client/collection.ts#L10)
    - sort handling in [client/src/client/collection.ts](../client/src/client/collection.ts#L71)
    - limit handling in [client/src/client/collection.ts](../client/src/client/collection.ts#L76)
  - Tests:
    - sort usage in [client/tests/client/compound-index.test.ts](../client/tests/client/compound-index.test.ts#L163)
    - limit usage in [client/tests/client/find-with-limit.test.ts](../client/tests/client/find-with-limit.test.ts#L53)
- SengoCollection.findOne(query, options?)
  - Supported options/args:
    - query required
    - options.sort supported
    - options.limit accepted but internally forced to 1
  - Implementation:
    - signature in [client/src/client/collection.ts](../client/src/client/collection.ts#L82)
    - forced limit=1 merge in [client/src/client/collection.ts](../client/src/client/collection.ts#L87)
  - Test: findOne with sort in [client/tests/client/findOne.test.ts](../client/tests/client/findOne.test.ts#L45)
- SengoCollection.updateOne(filter, update)
  - Supported options/args:
    - filter required
    - update required
    - supported update operator: $set
  - Implementation:
    - method in [client/src/client/collection.ts](../client/src/client/collection.ts#L95)
    - $set branch in [client/src/client/collection.ts](../client/src/client/collection.ts#L106)
  - Test: updateOne by _id in [client/tests/client/updateOne-byId.test.ts](../client/tests/client/updateOne-byId.test.ts#L16)
- SengoCollection.deleteOne(filter)
  - Supported options/args: required filter only
  - Implementation: [client/src/client/collection.ts](../client/src/client/collection.ts#L129)
  - Test: deleteOne by _id in [client/tests/repository/collectionIndex.test.ts](../client/tests/repository/collectionIndex.test.ts#L125)
- SengoCollection.createIndex(keys)
  - Supported options/args:
    - single key string
    - single key object
    - array of strings/objects
  - Implementation:
    - method signature in [client/src/client/collection.ts](../client/src/client/collection.ts#L155)
    - normalization in [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L524)
    - string key normalization in [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L535)
    - object key normalization in [client/src/repository/collectionIndex.ts](../client/src/repository/collectionIndex.ts#L537)
  - Tests:
    - createIndex object key in [client/tests/repository/collectionIndex.test.ts](../client/tests/repository/collectionIndex.test.ts#L48)
    - compound/index-array key usage in [client/tests/client/listIndexes.test.ts](../client/tests/client/listIndexes.test.ts#L61)
- SengoCollection.dropIndex(name)
  - Supported options/args: required name only
  - Implementation: [client/src/client/collection.ts](../client/src/client/collection.ts#L27)
  - Test: dropIndex behavior in [client/tests/repository/s3/s3CollectionStore.index.test.ts](../client/tests/repository/s3/s3CollectionStore.index.test.ts#L37)
- SengoCollection.listIndexes()
  - Supported options/args: none
  - Implementation: [client/src/client/collection.ts](../client/src/client/collection.ts#L180)
  - Test: listIndexes output in [client/tests/client/listIndexes.test.ts](../client/tests/client/listIndexes.test.ts#L21)

## Query Expressions and Operators

Important:

- $limit is supported as a find/findOne option, not as a query expression operator.
  - option type: [client/src/client/collection.ts](../client/src/client/collection.ts#L12)
  - find option handling: [client/src/client/collection.ts](../client/src/client/collection.ts#L76)
  - findOne forced single-result behavior: [client/src/client/collection.ts](../client/src/client/collection.ts#L87)
  - tests: [client/tests/client/find-with-limit.test.ts](../client/tests/client/find-with-limit.test.ts#L53), [client/tests/client/index-optimization-operators.test.ts](../client/tests/client/index-optimization-operators.test.ts#L56)

### Expression evaluation path

- Query match entrypoint: match in [client/src/client/collection.ts](../client/src/client/collection.ts#L208)
- Comparison evaluator: evaluateComparison in [client/src/client/expression.ts](../client/src/client/expression.ts#L54)
- Operator registry: operatorRegistry in [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L25)

### Logical expression

- $or
  - Implementation: $or handling in match in [client/src/client/collection.ts](../client/src/client/collection.ts#L215)
  - Helper: matchesOrArray in [client/src/client/collection.ts](../client/src/client/collection.ts#L223)
  - Test: $or query in [client/tests/client/find-or.test.ts](../client/tests/client/find-or.test.ts#L50)

### Comparison and membership operators

- $eq
  - Implementation: EqOperator in [client/src/client/expr/eq.ts](../client/src/client/expr/eq.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L26)
  - Test: $eq query in [client/tests/client/find-in.test.ts](../client/tests/client/find-in.test.ts#L57)
- $ne
  - Implementation: NeOperator in [client/src/client/expr/ne.ts](../client/src/client/expr/ne.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L27)
  - Test: $ne query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L200)
- $gt
  - Implementation: GtOperator in [client/src/client/expr/gt.ts](../client/src/client/expr/gt.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L28)
  - Test: $gt query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L110)
- $gte
  - Implementation: GteOperator in [client/src/client/expr/gte.ts](../client/src/client/expr/gte.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L29)
  - Test: $gte query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L126)
- $lt
  - Implementation: LtOperator in [client/src/client/expr/lt.ts](../client/src/client/expr/lt.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L30)
  - Test: $lt query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L78)
- $lte
  - Implementation: LteOperator in [client/src/client/expr/lte.ts](../client/src/client/expr/lte.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L31)
  - Test: $lte query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L94)
- $in
  - Implementation: InOperator in [client/src/client/expr/in.ts](../client/src/client/expr/in.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L32)
  - Test: $in query in [client/tests/client/find-in.test.ts](../client/tests/client/find-in.test.ts#L49)
- $nin
  - Implementation: NinOperator in [client/src/client/expr/nin.ts](../client/src/client/expr/nin.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L33)
  - Test: $nin query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L254)
- $exists
  - Implementation: ExistsOperator in [client/src/client/expr/exists.ts](../client/src/client/expr/exists.ts#L3)
  - Registry: [client/src/client/expr/index.ts](../client/src/client/expr/index.ts#L34)
  - Test: $exists query in [client/tests/repository/indexEntry-optimization.test.ts](../client/tests/repository/indexEntry-optimization.test.ts#L305)

### Direct field equality expression (no operator object)

- Primitive equality matching
  - Implementation: evaluateComparison fallback in [client/src/client/expression.ts](../client/src/client/expression.ts#L71)
  - Test: direct equality query in [client/tests/client/find-in.test.ts](../client/tests/client/find-in.test.ts#L65)
- Array membership via direct equality
  - Implementation: array branch in [client/src/client/expression.ts](../client/src/client/expression.ts#L72)
  - Test: direct equality against array field in [client/tests/client/find-in.test.ts](../client/tests/client/find-in.test.ts#L81)

## Update Operators

- $set
  - Implementation: update.$set branch in [client/src/client/collection.ts](../client/src/client/collection.ts#L106)
  - Test: $set update in [client/tests/client/updateOne-byId.test.ts](../client/tests/client/updateOne-byId.test.ts#L16)

Current limitation:

- Non-operator update documents are rejected
  - Implementation: explicit rejection message in [client/src/client/collection.ts](../client/src/client/collection.ts#L110)

## Query Options

- sort
  - Implementation: sort application in _findFilterSort in [client/src/client/collection.ts](../client/src/client/collection.ts#L72)
  - Test: sorted find in [client/tests/client/compound-index.test.ts](../client/tests/client/compound-index.test.ts#L163)
- limit
  - Implementation: limit slicing in _findFilterSort in [client/src/client/collection.ts](../client/src/client/collection.ts#L77)
  - Test: find with limit in [client/tests/client/find-with-limit.test.ts](../client/tests/client/find-with-limit.test.ts#L53)
  - Additional test: limit with comparison predicates in [client/tests/client/index-optimization-operators.test.ts](../client/tests/client/index-optimization-operators.test.ts#L56)