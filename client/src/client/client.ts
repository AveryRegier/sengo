import { SengoDb } from './db';
import { getLogger } from './logger';

export type SengoClientOptions = {
  logger?: { level: string };
}

export class SengoClient {
  private databases: Record<string, SengoDb> = {};
  constructor(options: SengoClientOptions = {}) {
    // Initialize logger based on options
    getLogger().level = options?.logger?.level || 'info';
  }

  db(dbName: string = 'memory') {
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
    getLogger().info('All databases closed');
  }
}
