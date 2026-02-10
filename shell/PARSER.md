# Shell Parser

The Sengo shell parser (`shell/src/parser.ts`) enables MongoDB-style query syntax with unquoted property names, making the shell experience more natural and matching MongoDB's shell behavior.

## Features

### Unquoted Property Names
You can now write queries without quoting property names:

```javascript
// Instead of:
find {"_id": "123"}

// You can write:
find {_id: "123"}
```

### MongoDB Operators
All MongoDB operators work with unquoted syntax:

```javascript
// $exists operator
find {email: {$exists: true}}

// Comparison operators
find {age: {$gte: 18}}
find {status: {$ne: "deleted"}}

// $in operator
find {status: {$in: ["active", "pending"]}}

// $or operator
find {$or: [{age: {$lt: 18}}, {age: {$gt: 65}}]}
```

### Mixed Quoted/Unquoted
You can mix quoted and unquoted property names:

```javascript
find {"_id": "123", name: "John"}
```

### Single-Quoted Strings
Single-quoted strings are automatically converted to double quotes:

```javascript
find {name: 'John Doe'}
// Converted to: {"name": "John Doe"}
```

### Boolean and Null Values
Boolean and null literals are preserved:

```javascript
insertOne {_id: "test", active: true, deleted: false, deletedAt: null}
```

## Implementation

The parser (`parser.ts`) exports three main functions:

### `convertToValidJson(input: string): string`
Converts MongoDB-style syntax to valid JSON:
- Quotes unquoted property names
- Converts single quotes to double quotes
- Preserves boolean/null values
- Handles nested objects and arrays

### `parseArgsWithJson(input: string[]): any[]`
Parses command arguments, handling JSON objects:
- Reconstructs JSON objects split across multiple tokens
- Converts MongoDB syntax to valid JSON before parsing
- Returns array of parsed values (strings, objects, arrays)

### `parseCommandLine(line: string): { command: string; rest: string[] }`
Splits command line into command and arguments:
- Preserves JSON structure (doesn't split on spaces within braces)
- Handles quoted strings
- Returns command name and array of argument tokens

## Testing

Comprehensive tests are in:
- `tests/parser.test.ts` - Unit tests for parser functions
- `tests/commands.test.ts` - Integration tests with actual collection operations

Tests cover:
- Unquoted property names
- MongoDB operators ($exists, $gte, $in, $or, $ne, etc.)
- Mixed quoted/unquoted syntax
- Nested objects and arrays
- Boolean and null values
- Single-quoted strings
