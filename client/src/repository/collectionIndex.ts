  async findIdsForKey(key: string): Promise<string[]> {
    let entry = this.indexMap.get(key);
    if (!entry) {
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
    }
    // Debug log for index search
    // @ts-ignore: Only subclasses may want to log
    if (typeof this.name === 'string' && this.name.includes('Memory')) {
      console.log(`[MemoryCollectionIndex.findIdsForKey] key='${key}', ids=[${entry.toArray().join(',')}]`);
    }
    return entry.toArray();
  }
import { IndexDefinition, IndexKeyRecord, NormalizedIndexKeyRecord, Order } from ".";

export interface CollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
  isBusy?(): boolean;
  getStatus?(): { pendingInserts: number; runningTasks: number; avgPersistMs: number; estTimeToClearMs: number };
}

export class IndexEntry {
  ids: Set<string>;
  etag?: string;
  loadedAt: number;
  dirty: boolean = false;

  constructor(ids: string[] = [], etag?: string) {
    this.ids = new Set(ids);
    this.etag = etag;
    this.loadedAt = Date.now();
  }

  add(id: string): boolean {
    if (!this.ids.has(id)) {
      this.ids.add(id);
      this.dirty = true;
      return true;
    }
    return false;
  }

  toArray(): string[] {
    return Array.from(this.ids);
  }
}

export abstract class BaseCollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
  protected indexMap: Map<string, IndexEntry> = new Map();

  constructor(name: string, keys: NormalizedIndexKeyRecord[]) {
    this.name = name;
    this.keys = keys;
  }

  protected async fetch(key: string): Promise<IndexEntry> {
    // In-memory: always return empty
    return new IndexEntry();
  }

  async addDocument(doc: Record<string, any>): Promise<void> {
    if (!doc._id) throw new Error('Document must have an _id');
    const key = this.makeIndexKey(doc);
    let entry = this.indexMap.get(key);
    if (!entry) {
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
    }
    entry.add(doc._id);
  }

  protected makeIndexKey(doc: Record<string, any>): string {
    // Only use the field values, not the order or field name, for the key
    // For a single key: { foo: 1 } => '1'
    // For multiple keys: { foo: 1, bar: -1 } => '1|-1'
    return this.keys.map(k => `${doc[k.field] ?? ''}`).join('|');
  }

  getIndexMap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of this.indexMap.entries()) {
      out[k] = v.toArray();
    }
    return out;
  }

  /**
   * Returns all index entries as [key, entry] pairs.
   */
  public getAllEntries(): [string, IndexEntry][] {
    return Array.from(this.indexMap.entries());
  }

  /**
   * Wait until all pending persistence is complete. For in-memory, this is immediate.
   */
  async flush(): Promise<void> {
    // No async persistence in memory, so just resolve immediately
    return;
  }
}

export function normalizeIndexKeys(keys: IndexDefinition | IndexDefinition[]): NormalizedIndexKeyRecord[] {
    if (!keys) {
      throw new Error('Keys must be defined for creating an index');
    }
    let keysArray: IndexDefinition[];
    if (!Array.isArray(keys)) {
      keysArray = [keys];
    } else {
      keysArray = keys;
    }
    const normalizedKeys = keysArray.map((key) => {
      if (typeof key === 'string') {
        return [{ field: key, order: 1 as Order }];
      } else if (typeof key === 'object') {
        return Object.entries(key as IndexKeyRecord).map(([field, order]) => ({ field, order }));
      } else {
        throw new Error('Invalid index key format');
      }
    }).flat();
    return normalizedKeys;
  }
