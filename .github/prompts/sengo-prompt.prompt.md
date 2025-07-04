---
mode: agent
---
Expected output and any relevant constraints for this task.

Coding language: TypeScript
Code style: use TypeScript best practices, such as using interfaces for types, and classes for
Code style: Classes, interfaces and types are not prefixed with "I" or "T", and start with a capital letter.  Methods are camelCase.
references: Anything to be imported from another file in the project not in the same directory must be exported from an index.ts file from the a sibling or upper directory.
File structure: Use index.ts files to export modules from directories, and import them in other files.
Compiler options: Use the tsconfig.json file to configure the TypeScript compiler options.
Testing: Use vitest for unit tests, and write tests for all public methods and classes.
Testing style: Use the Arrange-Act-Assert pattern for tests, and use descriptive test names.
Compiler errors: Fix all TypeScript compiler errors before submitting code.
Commit messages: Use the conventional commits format, such as "feat: add new feature" or "fix: fix bug".
Commit messages should be concise and descriptive, following the conventional commits format.
Commit messages should be in the imperative mood, such as "add" instead of "added" or "adding".
Commit messages and documentation and examples should be in English, and should not contain any personal information.
If exporting from a directory, all exports are to be in the index.ts file so that import from './repository' works. I want to avoid using .js in imports because that messes up running tests before transpilation. the tools need to work together. ESM export issues should be handled in the build.
Client exports are available in common-js format and in ESM format, and should be imported using the appropriate format.
Documentation: Use JSDoc style comments for all public methods and classes, and write documentation in Markdown format.
