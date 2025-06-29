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

## Usage

- To use the shell interactively:

  ```sh
  cd shell
  npm start
  ```

- To use the client library, see `client/README.md` for details.

---

For more information, see the individual [client/README.md](client/README.md) and [shell/README.md](shell/README.md) files in each package.
