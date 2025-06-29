# Sengo

Sengo is an open source clean room implementation of a useful subset of the MongoDB client for Node.js, using AWS S3 as a backend for document storage.

## Motivation
Sengo is designed for small, cost-sensitive applications that use AWS S3 for document storage. It is ideal for apps with infrequent use (e.g., volunteer orgs, occasional data entry) and aims for near-zero storage costs when idle. Sengo supports efficient search and retrieval via a flexible, document-based indexing system. See [doc/INDEX-DESIGN.md](./doc/INDEX-DESIGN.md) for details on the indexing feature design and future plans.

## Features
- MongoDB-like API for document operations
- AWS S3 as the storage backend
- Written in TypeScript for Node.js

## Getting Started
1. Install dependencies:
   ```sh
   npm install
   ```
2. Build the project:
   ```sh
   npx tsc
   ```
3. Start developing your library in the `src` directory.

## Usage Example

```typescript
import { SengoClient } from 'sengo';

const client = new SengoClient();
const collection = client.db().collection('animals');

// Insert a document
const insertResult = await collection.insertOne({ name: 'fuzzy', kind: 'cat' });
console.log('Inserted ID:', insertResult.insertedId);

// Find a document by _id
const found = await collection.find({ _id: insertResult.insertedId });
console.log('Found:', found);
```

## License
Apache 2.0
