# Sengo Monorepo

This repository contains:

- **client/**: The Sengo MongoDB-like client library (TypeScript, Node.js) ([client/README.md](client/README.md))
- **shell/**: An interactive shell for using the Sengo client ([shell/README.md](shell/README.md))

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
