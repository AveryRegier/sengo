import type { CollectionStore, IndexDefinition, IndexKeyRecord, NormalizedIndexKeyRecord, Order } from '../repository/index';
import { ObjectId } from 'bson';

type Index = {
  key: string;
  values: ObjectId[];
};

export class SengoCollection {
  name: string;
  store: CollectionStore;
  static collections: Record<string, SengoCollection> = {};

  constructor(name: string, store: CollectionStore) {
    this.name = name;
    this.store = store;
  }

  async insertOne(doc: Record<string, any>) {
    const docWithId = doc._id ? doc : { ...doc, _id: new ObjectId() };
    await this.store.insertOne(docWithId);
    return { acknowledged: true, insertedId: docWithId._id };
  }

  async find(query: Record<string, any>) {
    return this.store.find(query);
  }

  async createIndex(keys: IndexDefinition | IndexDefinition[], options?: Record<string, any>) {
    const normalizedKeys = this.normalizeIndexKeys(keys);

    // MongoDB returns the index name as a string
    // We'll mimic that: e.g. 'field1_1_field2_-1'
    const name = options?.name || Object.entries(keys)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    
    // Forward to store, but for now just a noop
    const indexCollection = await this.store.createIndex(name, normalizedKeys);



    this.find({}).then((records) => {
      records.forEach(record => {
        // Insert the index document into the index collection
        // add each existing record to an index document
        {FileSystemDirectoryHandle, o}normalizedKeys[0].field;

        const keys = keysArray.length > 0 ? keysArray : Object.keys(record).filter(k => k !== '_id');
        // Create an index document for each record
        keys.reduce((acc: { key: string, index: string[] }, key: string) => {
          acc.key = record[key];
          const index = acc['index'] || [];
          index.push(record._id);
          acc['index'] = index;
          return acc;
        }, { key : record, index: [] });
        indexCollection.insertOne({
          _id: record._id,
          keys: keys,
          collection: this.name
        });
      });
      // Ensure the index is created in the collection})
      keys
    });
    return name;
  }

  private normalizeIndexKeys(keys: IndexDefinition | IndexDefinition[]): NormalizedIndexKeyRecord[] {
    if (!keys) {
      throw new Error('Keys must be defined for creating an index');
    }

    // if it isn't an array, convert it to an array
    let keysArray: IndexDefinition[];
    if (!Array.isArray(keys)) {
      keysArray = [keys];
    } else {
      keysArray = keys;
    }

    const normalizedKeys = keysArray.map((key) => {
      if (typeof key === 'string') {
        return [{ field: key, order: 1 as Order }]; // Default to ascending order
      } else if (typeof key === 'object') {
        return Object.entries(keys as IndexKeyRecord).map(([field, order]) => ({ field, order }));
      } else {
        throw new Error('Invalid index key format');
      }
    }).flat();
    return normalizedKeys;
  }
}
