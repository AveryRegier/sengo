import { IndexDefinition, IndexKeyRecord, Order } from "../types";
import { MongoInvalidArgumentError } from '../errors.js';
import { NormalizedIndexKeyRecord } from ".";

export interface CollectionIndex {
  name: string;
  keys: NormalizedIndexKeyRecord[];
  
  addDocument(doc: Record<string, any>): Promise<void>;
  removeDocument(doc: Record<string, any>): Promise<void>
  /**
   * Update the index for a document update. Receives the old and new document.
   * The index implementation should decide if any index maintenance is needed.
   * This method should be idempotent and safe to call for any update.
   */
  updateIndexOnDocumentUpdate(oldDoc: Record<string, any>, newDoc: Record<string, any>): Promise<void>;
  isBusy?(): boolean;
  getStatus?(): { pendingInserts: number; runningTasks: number; avgPersistMs: number; estTimeToClearMs: number };
  flush(): Promise<void>;
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

  constructor(name: string, keys: NormalizedIndexKeyRecord[]) {
    this.name = name;
    this.keys = keys;
  }

  // --- Public API ---
  public getIndexMap(): Map<string, IndexEntry> {
    return new Map<string, IndexEntry>();
  }

  /**
   * Default implementation for index update on document update.
   * Removes the old doc from the old key if the key changes, then adds the new doc to the new key.
   */
  public async updateIndexOnDocumentUpdate(oldDoc: Record<string, any>, newDoc: Record<string, any>): Promise<void> {
    // Only call removeDocument if oldDoc has an _id
    if (oldDoc && oldDoc._id) {
      await this.removeDocument(oldDoc);
    }
    await this.addDocument(newDoc).finally(() => {
      // Ensure the index is flushed after adding the new document
      return this.flush();
    });
  }

  public async addDocument(doc: Record<string, any>): Promise<void> {
    if (!doc._id) throw new MongoInvalidArgumentError('Document must have an _id');
    if (this.hasFirstKey(doc)) {
      const key = this.makeIndexKey(doc);
      let entry = await this.fetch(key);
      if (entry.add(doc._id)) {
        await this.persist(key, entry);
      }
    }
  }

  public makeIndexKey(doc: Record<string, any>): string {
    // Only use the field values, not the order or field name, for the key
    // For a single key: { foo: 1 } => '1'
    // For multiple keys: { foo: 1, bar: -1 } => '1|-1'
    return this.keys.map(k => `${doc[k.field] ?? ''}`).join('|');
  }

  public findKeysForQuery(query: Record<string, any>): string[] {
    // Find keys that match the query
    return this.keys.reduce((acc, key) => {
        const valueToFind = query[key.field];
      if (valueToFind !== undefined) {
        if (valueToFind.$in) {
          valueToFind.$in.forEach((v: string) => acc.push(`${v}`));
        } else {
          acc.push(`${valueToFind}`);
        }
      }
      return acc;
    }, [] as string[]);
  }

  protected async persist(key: string, entry: IndexEntry): Promise<void> {
    // Default implementation does nothing, subclasses should override
    // to add persistence logic (e.g. to a database or file)
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
    if (!doc._id) throw new MongoInvalidArgumentError('Document must have an _id');
    const key = this.makeIndexKey(doc);
    let entry = await this.fetch(key);
    const idStr = doc._id.toString();
    if (entry.ids.has(idStr)) {
      entry.ids.delete(idStr);
      entry.dirty = true;
    }

    if (entry && entry.dirty) {
      await this.persist(key, entry);
    }
  }
  abstract findIdsForKey(key: string): Promise<string[]>;

  // --- Protected methods ---
  protected async fetch(key: string): Promise<IndexEntry> {
    // In-memory: always return empty
    return new IndexEntry();
  }

  protected hasFirstKey(doc: Record<string, any>): boolean {
    const value = doc[this.keys[0]?.field];
    return value !== undefined && value !== null && value !== '';
  }

  removeIdFromAllKeys<U>(id: string, doc: Record<string, any>): unknown {
    return Promise.resolve();
  }
}

export function normalizeIndexKeys(keys: IndexDefinition | IndexDefinition[]): NormalizedIndexKeyRecord[] {
  if (!keys) {
    throw new MongoInvalidArgumentError('Keys must be defined for creating an index');
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
      throw new MongoInvalidArgumentError('Invalid index key format');
    }
  }).flat();
  return normalizedKeys;
}


