// Common utility for MongoDB-compatible NotImplemented error

import { MongoNotImplementedError } from './errors';

export function notImplementedMongo(method: string): never {
  throw new MongoNotImplementedError(`${method} is not implemented in Sengo (MongoDB compatibility)`);
}
