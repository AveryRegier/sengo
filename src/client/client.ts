import { getRepository, CollectionStore, DbStore } from '../repository';
import { SengoCollection } from './collection';

export class SengoClient {
  private dbStore: DbStore;
  constructor(repositoryType: string = 'memory') {
    this.dbStore = getRepository(repositoryType);
  }

  db(dbName?: string) {
    return {
      collection: (name: string) => new SengoCollection(name, this.dbStore.collection(name))
    };
  }
}
