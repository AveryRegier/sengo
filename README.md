# Sengo Monorepo

This repository contains:

- **client/**: The Sengo MongoDB-like client library (TypeScript, Node.js) ([client/README.md](client/README.md))
- **shell/**: An interactive shell for using the Sengo client ([shell/README.md](shell/README.md))

## Motivation & Design Considerations

Sengo is designed for small, cost-sensitive applications that use AWS S3 for document storage. It is ideal for apps with infrequent use (e.g., volunteer orgs, occasional data entry) and aims for near-zero storage costs when idle. Sengo supports efficient search and retrieval via a flexible, document-based indexing system. See [client/INDEX-DESIGN.md](client/INDEX-DESIGN.md) for details on the indexing feature design and future plans.

## Getting Started

1. **Install dependencies for all packages:**

   ```sh
   npm install
   ```

2. **Build all packages:**

   ```sh
   npm run build
   ```

3. **Clean all build outputs:**

   ```sh
   npm run clean
   ```

4. **Start the interactive shell:**

   ```sh
   npm start
   ```

   This will launch the shell in the `shell` package.

## Running the Sengo Shell CLI

After installing dependencies, you can launch the interactive Sengo shell directly using:

```sh
npx sengo
```

Or, if installed globally:

```sh
sengo
```

This will start the shell and allow you to connect to a memory or S3-backed repository, run commands, and interact with your data.

For more details, see [shell/README.md](shell/README.md).

## Usage

- To use the shell interactively:

  ```sh
  cd shell
  npm start
  ```

- To use the client library, see `client/README.md` for details.

## S3-Backed Index and Document Design

- Each collection index is stored as a separate S3 object per key: `collection/indices/indexName/key.json`
- Index entries are cached in-memory per process for efficiency
- Index entry cache is cleared on process restart, ensuring S3 is the source of truth
- All S3 accesses (read, write, delete) are logged in tests for verification

## Testing and S3 Simulation

- Tests use a custom `S3BucketSimulator` to simulate S3 state and log all accesses
- Each test creates its own simulator instance and sets up its own S3 state from scratch
- No S3 state or logs are shared between tests; all test expectations are based on per-test setup
- Helpers are provided to set up S3 state for index entries and document files

## Design Choices and Lessons Learned

- Index entry cache must be cleared between process restarts to avoid stale data
- S3 simulation must be per-test and not share state or logs
- Tests must assert only on accesses relevant to their own setup

---

For more information, see the individual [client/README.md](client/README.md) and [shell/README.md](shell/README.md) files in each package.
