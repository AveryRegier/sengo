import { IndexDefinition, IndexKeyRecord, NormalizedIndexKeyRecord, Order } from ".";

export interface CollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
  /**
   * Update the index for a document update. Receives the old and new document.
   * The index implementation should decide if any index maintenance is needed.
   * This method should be idempotent and safe to call for any update.
   */
  updateIndexOnDocumentUpdate(oldDoc: Record<string, any>, newDoc: Record<string, any>): Promise<void>;
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

  public add(id: string): boolean {
    if (!this.ids.has(id)) {
      this.ids.add(id);
      this.dirty = true;
      return true;
    }
    return false;
  }

  public toArray(): string[] {
    return Array.from(this.ids);
  }
}

export abstract class BaseCollectionIndex implements CollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
  protected indexMap: Map<string, IndexEntry> = new Map();

  constructor(name: string, keys: NormalizedIndexKeyRecord[]) {
    this.name = name;
    this.keys = keys;
  }

  // --- Public API ---

  /**
   * Default implementation for index update on document update.
   * Removes the old doc from the old key if the key changes, then adds the new doc to the new key.
   */
  public async updateIndexOnDocumentUpdate(oldDoc: Record<string, any>, newDoc: Record<string, any>): Promise<void> {
    // Only call removeDocument if oldDoc has an _id
    const oldKey = this.makeIndexKey(oldDoc);
    const newKey = this.makeIndexKey(newDoc);
    if (oldDoc && oldDoc._id && oldKey !== newKey && typeof (this.removeDocument) === 'function') {
      await this.removeDocument(oldDoc);
    }
    await this.addDocument(newDoc);
    if (typeof (this.flush) === 'function') {
      await this.flush();
    }
  }

  /**
   * Returns all index entries as [key, entry] pairs.
   */
  public getAllEntries(): [string, IndexEntry][] {
    return Array.from(this.indexMap.entries());
  }

  public getIndexMap(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of this.indexMap.entries()) {
      out[k] = v.toArray();
    }
    return out;
  }

  public async addDocument(doc: Record<string, any>): Promise<void> {
    if (!doc._id) throw new Error('Document must have an _id');
    const key = this.makeIndexKey(doc);
    let entry = this.indexMap.get(key);
    if (!entry) {
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
    }
    entry.add(doc._id.toString());
  }

  public makeIndexKey(doc: Record<string, any>): string {
    // Only use the field values, not the order or field name, for the key
    // For a single key: { foo: 1 } => '1'
    // For multiple keys: { foo: 1, bar: -1 } => '1|-1'
    return this.keys.map(k => `${doc[k.field] ?? ''}`).join('|');
  }

  public async flush(): Promise<void> {
    // No async persistence in memory, so just resolve immediately
    return;
  }

  // --- Abstract methods (must be implemented by subclass) ---
  /**
   * Remove a document from the index for the appropriate key.
   * Subclasses may override to add persistence or other side effects.
   */
  public async removeDocument(doc: Record<string, any>): Promise<void> {
    if (!doc._id) throw new Error('Document must have an _id');
    const key = this.makeIndexKey(doc);
    let entry = this.indexMap.get(key);
    if (!entry) {
      entry = await this.fetch(key);
      this.indexMap.set(key, entry);
    }
    const idStr = doc._id.toString();
    if (entry.ids.has(idStr)) {
      entry.ids.delete(idStr);
      entry.dirty = true;
    }
  }
  abstract findIdsForKey(key: string): Promise<string[]>;

  // --- Protected methods ---
  protected async fetch(key: string): Promise<IndexEntry> {
    // In-memory: always return empty
    return new IndexEntry();
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
