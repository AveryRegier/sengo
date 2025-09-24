import { SengoDb } from './db';
import logger from './logger';

export type SengoClientOptions = {
  logger?: { level: "debug" | "info" | "warn" | "error" };
}

export class SengoClient {
  private databases: Record<string, SengoDb> = {};
  constructor(options: SengoClientOptions = {}) {
    // Initialize logger based on options
    logger.level = options?.logger?.level || logger.level;
  }

  db(dbName: string = 'memory'): SengoDb {
    if (!this.databases[dbName]) {
      this.databases[dbName] = new SengoDb(dbName);
    }
    return this.databases[dbName];
  }

  async close() {
    for (const dbName in this.databases) {
      await this.databases[dbName].close();
      delete this.databases[dbName]; // Clean up after closing
    }
    logger.info('All databases closed');
  }
}
