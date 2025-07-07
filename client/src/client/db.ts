import { DbStore, createRepository } from "../repository/index";
import { SengoCollection } from "./collection";
import { getLogger } from "./logger";

export class SengoDb {
  private dbStore: DbStore;

  constructor(dbName: string = 'memory') {
    this.dbStore = createRepository(dbName);
  }

  collection<T>(name: string): SengoCollection<T> {
    if(this.dbStore.isClosed()) {
      throw new Error('Store is closed');
    }
    return new SengoCollection<T>(
        name, 
        this.dbStore.collection<T>(name), 
        getLogger().child({ collection: name })
    );
  }

  async close() {
    await this.dbStore.close();
  }
}
