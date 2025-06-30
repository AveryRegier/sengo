
export type Order = 1 | -1 | 'text';
export type IndexKeyRecord = Record<string, Order>;
export type IndexDefinition = string | IndexKeyRecord;
export type NormalizedIndexKeyRecord = { field: string, order: Order };

export interface CollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
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

export abstract class CollectionIndex {
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
    return this.keys.map(k => `${k.field}:${doc[k.field] ?? ''}:${k.order}`).join('|');
  }

  getIndexMap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of this.indexMap.entries()) {
      out[k] = v.toArray();
    }
    return out;
  }
}
