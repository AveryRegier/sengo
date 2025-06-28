import type { DbStore } from '../repository/index.js';
import { createRepository } from '../repository/index.js';
import { SengoCollection } from './collection.js';

export class SengoClient {
  private dbStore: DbStore;
  constructor(repositoryType: string = 'memory') {
    this.dbStore = createRepository(repositoryType);
  }

  db(dbName?: string) {
    return {
      collection: (name: string) => new SengoCollection(name, this.dbStore.collection(name))
    };
  }

  async close() {
    if (typeof (this.dbStore as any).close === 'function') {
      await (this.dbStore as any).close();
    }
  }
}
