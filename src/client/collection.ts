import { Storage } from '../repository/memory';

export class SengoCollection {
  static collections: Record<string, SengoCollection> = {};
  private store = new Storage();
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  async insertOne(doc: Record<string, any>) {
    return this.store.insertOne(doc);
  }

  async find(query: Record<string, any>) {
    return this.store.find(query);
  }
}
