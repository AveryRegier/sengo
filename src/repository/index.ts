import { Storage } from './memory';

export interface CollectionStore {
  insertOne(doc: Record<string, any>): Promise<{ acknowledged: boolean; insertedId: string }> | { acknowledged: boolean; insertedId: string };
  find(query: Record<string, any>): Promise<Record<string, any>[]> | Record<string, any>[];
}

export function getRepository(type: string = 'memory'): CollectionStore {
  switch (type) {
    case 'memory':
    default:
      return new Storage();
  }
}
