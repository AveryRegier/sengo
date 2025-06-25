// Entry point for the Sengo library

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

class SengoCollection {
  static collections: Record<string, SengoCollection> = {};
  private documents: Record<string, any>[] = [];
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  async insertOne(doc: Record<string, any>) {
    const _id = Math.random().toString(36).slice(2);
    const document = { ...doc, _id };
    this.documents.push(document);
    return { acknowledged: true, insertedId: _id };
  }

  async find(query: Record<string, any>) {
    // Very basic query: only supports exact match on top-level fields
    return this.documents.filter(doc => {
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
  }
}

