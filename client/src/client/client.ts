import type { DbStore } from '../repository/index';
import { createRepository } from '../repository/index';
import { SengoCollection } from './collection';

export class SengoClient {
  private dbStore: DbStore;
  constructor(repositoryType: string = 'memory') {
    this.dbStore = createRepository(repositoryType);
  }

  db(dbName?: string) {
    const self = this;
    return {
      collection<T>(name: string): SengoCollection<T> {
        return new SengoCollection<T>(name, self.dbStore.collection<T>(name));
      }
    };
  }

  async close() {
    await this.dbStore.close();
  }
}
