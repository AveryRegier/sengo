// Common utility for MongoDB-compatible NotImplemented error

export function notImplementedMongo(method: string): never {
  const err = new Error(`${method} is not implemented in Sengo (MongoDB compatibility)`);
  (err as any).code = 10101; // Custom code for NotImplemented
  (err as any).name = 'MongoNotImplementedError';
  throw err;
}
