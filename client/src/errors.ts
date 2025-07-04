// Sengo MongoDB-compatible error types (clean room, based only on public API docs)
// See: https://mongodb.github.io/node-mongodb-native/6.17/

/**
 * Base MongoDB error class for Sengo. All MongoDB errors inherit from this.
 */
export class MongoError extends Error {
  code?: string | number
  constructor(message?: string) {
    super(message);
    this.name = 'MongoError';
  }
}

/**
 * Error thrown for network-related issues.
 */
export class MongoNetworkError extends MongoError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoNetworkError';
  }
}

/**
 * Error thrown when a timeout occurs.
 */
export class MongoTimeoutError extends MongoNetworkError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoTimeoutError';
  }
}

/**
 * Error thrown when a command or feature is not implemented.
 */
export class MongoNotImplementedError extends MongoError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoNotImplementedError';
  }
}

/**
 * Error thrown for errors related to MongoDB server responses.
 * Parent for e.g. MongoBulkWriteError.
 */
export class MongoServerError extends MongoError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoServerError';
  }
}

/**
 * Error thrown for bulk write operations (e.g., when one or more writes fail in a bulk operation).
 */
export class MongoBulkWriteError extends MongoServerError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoBulkWriteError';
  }
}

/**
 * Error thrown for client-side errors (invalid arguments, parse errors, etc).
 * Parent for MongoInvalidArgumentError, MongoParseError, MongoClientClosedError.
 */
export class MongoClientError extends MongoError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoClientError';
  }
}

/**
 * Error thrown when an operation is attempted on a closed client.
 */
export class MongoClientClosedError extends MongoClientError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoClientClosedError';
  }
}

/**
 * Error thrown when an invalid argument is provided to a MongoDB method.
 */
export class MongoInvalidArgumentError extends MongoClientError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoInvalidArgumentError';
  }
}

/**
 * Error thrown when a parsing error occurs (e.g., invalid connection string).
 */
export class MongoParseError extends MongoClientError {
  constructor(message?: string) {
    super(message);
    this.name = 'MongoParseError';
  }
}

// Add more error types as needed, based only on the public API documentation.
