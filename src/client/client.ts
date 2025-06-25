import { SengoCollection } from './collection';

export class SengoClient {
  db(dbName?: string) {
    return {
      collection: (name: string) => {
        if (!SengoCollection.collections[name]) {
          SengoCollection.collections[name] = new SengoCollection(name);
        }
        return SengoCollection.collections[name];
      }
    };
  }
}
