import { followClass } from "clox";
import { DbStore, S3Store, createRepository } from "../repository/index";
import { SengoCollection } from "./collection";
import logger from "./logger";

export class SengoDb {
  private dbStore: DbStore;

  constructor(dbName: string = 'memory') {
    this.dbStore = createRepository(dbName);
  }

  collection<T>(name: string): SengoCollection<T> {
    if(this.dbStore.isClosed()) {
      throw new Error('Store is closed');
    }
    const proxy = followClass(SengoCollection<T>, (logger) => logger.addContexts({ db: this.dbStore.name, collection: name }  ));
    return new proxy(
        name,
        this.dbStore.collection<T>(name)
    ) as SengoCollection<T>;
  }

  async close() {
    await this.dbStore.close();
  }
}
