import { IndexDefinition, IndexKeyRecord, Order } from "../types";
import { MongoInvalidArgumentError, MongoServerError } from '../errors.js';
import type { NormalizedIndexKeyRecord } from "./index.js";
import { SortDirection } from "../util/sort";

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

export type IndexOptions = {
  [key: string]: {
    $gt?: number | Date, 
    $lt?: number | Date, 
    $gte?: number | Date, 
    $lte?: number | Date,
    $eq?: number | Date | string | null,
    $ne?:  number | Date | string | null,
    $exists?: boolean
  }
} & {
  sort?: {
    [key: string]: SortDirection
  },
  limit? : number
};

export class IndexEntry {
  private ids: string[] = [];  // Maintain sorted order
  etag?: string;
  loadedAt: number;
  dirty: boolean = false;
  added: Set<string> | undefined = undefined;
  removed: Set<string> | undefined = undefined;
  private keys: NormalizedIndexKeyRecord[];  // Index definition
  private sortValues: Map<string, any> = new Map();  // Maps id -> secondary key value for sorting

  constructor(keys: NormalizedIndexKeyRecord[], data: string = '[]', etag?: string) {
    this.keys = keys;
    this.deserialize(data);
    this.etag = etag;
    this.loadedAt = Date.now();
  }

  public add(id: string, sortValue?: any): boolean {
    const existingIndex = this.ids.indexOf(id);
    if (existingIndex !== -1) {
      return false; // Already exists
    }

    const hasSortKey = this.keys.length > 1;
    // Store sort value if provided and we have multiple keys (final key is for sorting)
    if (sortValue !== undefined && hasSortKey) {
      this.sortValues.set(id, sortValue);
    }

    // Insert in sorted position if we have a sort key with sort values, otherwise append
    if (hasSortKey && this.sortValues.size > 0) {
      // Find insertion point using binary search
      let left = 0;
      let right = this.ids.length;
      const newSortValue = this.sortValues.get(id);
      
      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        const midId = this.ids[mid];
        const midSortValue = this.sortValues.get(midId);
        
        const comparison = this.compareValues(newSortValue, midSortValue);
        if (comparison < 0) {
          right = mid;
        } else {
          left = mid + 1;
        }
      }
      
      this.ids.splice(left, 0, id);
    } else {
      this.ids.push(id);
    }

    if (!this.added) {
      this.added = new Set();
    }
    this.added.add(id);
    this.dirty = true;
    return true;
  }

  private compareValues(a: any, b: any): number {
    // Handle undefined values (put at end)
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    
    // Compare values
    let comparison = 0;
    if (a < b) comparison = -1;
    else if (a > b) comparison = 1;
    
    // Apply sort order from the last key (the sorting key in compound indexes)
    const sortKeyOrder = this.keys.length > 1 ? this.keys[this.keys.length - 1].order : 1;
    return sortKeyOrder === -1 ? -comparison : comparison;
  }

  public remove(id: string): boolean {
    const index = this.ids.indexOf(id);
    if (index !== -1) {
      this.ids.splice(index, 1);
      this.sortValues.delete(id);
      if (!this.removed) {
        this.removed = new Set();
      }
      this.removed.add(id);
      this.dirty = true;
      return true;
    }
    return false;
  }

  public update(newData: string, etag?: string): void {
    // Preserve added/removed items and their sort values
    const preservedSortValues = new Map<string, any>();
    this.added?.forEach(id => {
      const sortValue = this.sortValues.get(id);
      if (sortValue !== undefined) {
        preservedSortValues.set(id, sortValue);
      }
    });
    
    this.deserialize(newData);
    this.etag = etag || this.etag;
    this.loadedAt = Date.now();

    // Re-add items that were added locally
    this.added?.forEach(id => {
      if (!this.ids.includes(id)) {
        const preservedValue = preservedSortValues.get(id);
        this.add(id, preservedValue);
      }
    });
    
    // Remove items that were removed locally
    this.removed?.forEach(id => {
      const index = this.ids.indexOf(id);
      if (index !== -1) {
        this.ids.splice(index, 1);
        this.sortValues.delete(id);
      }
    });
  }

  // used by searches
  public toArray(options: IndexOptions = {}): string[] {
    // Return copy of ids array (already maintained in sorted order)
    if(options && Object.keys(options).length > 0) {
      
      // Apply in-memory filtering based on options (e.g., sort and limit)
      // There is a specific optimization where sorting only _id with a limit can reduce the number of documents to load
      if(options.sort?._id && Object.keys(options.sort).length === 1 && options.limit) {
        // Sort by _id only
        return this.ids.sort((a, b) => {
          if (a < b) return options.sort!._id === 1 ? -1 : 1;
          if (a > b) return options.sort!._id === 1 ? 1 : -1;
          return 0;
        }).slice(0, options.limit);
      }
      
      // The whole point of all this code is to avoid loading documents if we can
      // eliminate them based on information we have in the index entry.
      let requestedSortKeys = Object.keys(options)
        .filter(k => k !== 'limit')
        .filter(k => options.sort?.[k] !== undefined);
      if(requestedSortKeys[0] === this.keys[0].field) {
        requestedSortKeys.shift(); // remove primary key
      }
      for (let idx = 0; requestedSortKeys.length > 0 && idx < this.keys.length; idx++) {
        const key = this.keys[idx];
        // The sort of the primary key is irrelevant.
        // The sort of the index must match the sort of the query
        const currentKey = requestedSortKeys.shift();
        if(key.field === currentKey) {
          // validate the sort direction is the same
          if(options.sort?.[key.field] === key.order) {
            continue; // same order, no change needed
          }
        } else {
          break; // no more relevant sort keys
        }
      }
      if(requestedSortKeys.length === 0) {
        // all sort keys matched, we can apply limit/filters
        let results = Object.entries(options)
          // we can only apply limits here for keys that exist in this index
          .filter(([k])=>this.keys.find(key=>key.field === k))
          .reduce((res, [k, opts]) => {
            return res.filter(id => {
              const sortValue = this.sortValues.get(id);
              return Object.entries(opts).every(([op, val]) => {
                const compareFn = IndexEntry.getComparisonFn(op);
                return compareFn(sortValue, val);
              }); 
            });
          }, this.ids);
        if(options.limit !== undefined && options.limit > 0)
          results = results.slice(0, options.limit);

        return results;
      }
    }
    return [...this.ids];
  }

  private static getComparisonFn(op: string): (a: any, b: any) => boolean {
    let fn: (a: any, b: any) => boolean;
    switch (op) {
      case '$lt':
        fn = (a, b) => a < b;
        break;
      case '$lte':
        fn = (a, b) => a <= b;
        break;
      case '$gt':
        fn = (a, b) => a > b;
        break;
      case '$gte':
        fn = (a, b) => a >= b;
        break;
      case '$eq':
        fn = (a, b) => a === b;
        break;
      case '$ne':
        fn = (a, b) => a !== b;
        break;
      case '$exists':
        fn = (a, b) => a === undefined || a === null || a === '' ? !b : b;
        break;
      case "$in":
        fn = (a, b) => Array.isArray(b) ? b.includes(a) : false;
        break;
      case "$nin":
        fn = (a, b) => Array.isArray(b) ? !b.includes(a) : true;
        break;
      default:
        fn = (a, b) => true;
        break;
    }
    return fn;
  }

  private deserialize(serialized: string) {
    const parsed = JSON.parse(serialized);
    
    this.ids = [];
    this.sortValues.clear();
    
    const hasSecondaryKey = this.keys.length > 1;
    // Handle both formats: old format ["id1", "id2"] and new format [["id1", sortVal1], ["id2", sortVal2]]
    if (parsed.length > 0 && Array.isArray(parsed[0])) {
      // New format with sort values - trust the order from storage
      for (const [id, sortValue] of parsed) {
        this.ids.push(id);
        if (sortValue !== undefined && hasSecondaryKey) {
          this.sortValues.set(id, sortValue);
        }
      }
    } else {
      // Old format - trust the order from storage
      this.ids = [...parsed];
    }
  }

  public serialize(): string {
    // If we have sort values, serialize as tuples: [[id, sortValue], ...]
    // Otherwise, use simple array format: [id, ...]
    // Order is already maintained in this.ids
    if (this.keys.length > 1 && this.sortValues.size > 0) {
      const entries = this.ids.map(id => [id, this.sortValues.get(id)]);
      return JSON.stringify(entries);
    }
    return JSON.stringify(this.ids);
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
   * Check if this index can satisfy the given query.
   * For compound indexes with the new design, ALL non-final fields must be present
   * in the query (since they form the index key).
   */
  public canSatisfyQuery(query: Record<string, any>): boolean {
    // First key must be present
    if (this.keys.length === 0 || !query.hasOwnProperty(this.keys[0].field)) {
      return false;
    }
    
    // For compound indexes: ALL non-final fields must be present in query
    // (they form the storage key). Final field is optional (used for sorting).
    const nonFinalKeys = this.keys.length > 1 ? this.keys.slice(0, -1) : this.keys;
    for (const key of nonFinalKeys) {
      if (!query.hasOwnProperty(key.field)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get a score for how well this index matches the query.
   * Higher score = more specific index = better match.
   * Score is the number of non-final keys (fields that form the storage key).
   */
  public scoreForQuery(query: Record<string, any>): number {
    if (!this.canSatisfyQuery(query)) {
      return 0;
    }
    // Score is based on number of non-final keys (more specific = better)
    const nonFinalKeys = this.keys.length > 1 ? this.keys.slice(0, -1) : this.keys;
    return nonFinalKeys.length;
  }

  /**
   * Factory method to create IndexEntry instances with proper keys configuration.
   */
  protected createEntry(data: string = '[]', etag?: string): IndexEntry {
    return new IndexEntry(this.keys, data, etag);
  }

  /**
   * Default implementation for index update on document update.
   * Removes the old doc from the old key if the key changes, then adds the new doc to the new key.
   */
  public async updateIndexOnDocumentUpdate(oldDoc: Record<string, any>, newDoc: Record<string, any>): Promise<void> {
    // Only call removeDocument if oldDoc has an _id
    if (oldDoc && oldDoc._id) {
      await this.changeIndex(oldDoc, (entry, id, keys) => {
        for (const cur of keys) {
          if (oldDoc[cur.field] !== newDoc[cur.field]) {
            return entry.remove(id);
          }
        }
        return false;
      });
    }
    await this.addDocument(newDoc).finally(() => {
      // Ensure the index is flushed after adding the new document
      return this.flush();
    });
  }

  public async addDocument(doc: Record<string, any>): Promise<void> {
    return await this.changeIndex(doc,  (entry, id, keys) => {
      // If there are multiple keys, extract the final key's value for sorting
      const sortValue = keys.length > 1 ? doc[keys[keys.length - 1].field] : undefined;
      return entry.add(id, sortValue);
    });
  }
  
  /**
   * Remove a document from the index for the appropriate key.
   * Subclasses may override to add persistence or other side effects.
   */
  public async removeDocument(doc: Record<string, any>): Promise<void> {
    return await this.changeIndex(doc, (entry, id) => entry.remove(id));
  }

  private async changeIndex(doc: Record<string, any>, fn: (entry: IndexEntry, id: string, keys: NormalizedIndexKeyRecord[]) => boolean) {
    if (!doc._id) throw new MongoInvalidArgumentError('Document must have an _id');
    const id = doc._id.toString();
    if (!this.hasFirstKey(doc)) {
      // If the first key is not set, we don't index this document
      return;
    }
    const allTheKeys = this.makeAllIndexEntryKeys(doc);
    const results = await Promise.allSettled(
      allTheKeys.map(key => this.changeSpecifiIndexEntry(key, id, fn))
    );
    // Handle results if needed
    const errors = results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason);
    if (errors.length) {
      throw new MongoServerError(`Failed to update index for keys: ${errors.map(e => e.message).join(', ')}`,  { cause: errors[0] });
    }
    return void 0;
  }

  private async changeSpecifiIndexEntry(key: string, id: string, fn: (entry: IndexEntry, id: string, keys: NormalizedIndexKeyRecord[]) => boolean) {
    let entry = await this.fetch(key);
    if (entry) {
      fn(entry, id, this.keys);
    }

    if (entry && entry.dirty) {
      await this.persist(key, entry);
    }
  }

  public findKeysForQuery(query: Record<string, any>): string[] {
    // For compound indexes, only use non-final fields to build the index key
    // The final field is used for sorting within the index entry
    const keysForIndexPath = this.keys.length > 1 ? this.keys.slice(0, -1) : this.keys;
    
    // Build index keys by combining non-final field values from the query
    return keysForIndexPath.reduce((acc, key, idx) => {
      const valueToFind = query[key.field];
      if (valueToFind === undefined || valueToFind === null) {
        // If any non-final field is missing, we can't build a complete key
        // Stop here and return what we have so far
        return acc;
      }
      
      let newKeys: string[] = [];
      if (valueToFind.$in) {
        // Handle $in operator for this field
        newKeys = valueToFind.$in.map((v: any) => `${v}`);
      } else {
        newKeys = [`${valueToFind}`];
      }
      
      if (acc.length === 0) {
        return newKeys;
      }
      
      // Combine with previous keys using | separator
      return newKeys.flatMap((v: string) => 
        acc.map((current: string) => `${current}|${v}`)
      );
    }, [] as string[]);
  }

  public makeAllIndexEntryKeys(doc: Record<string, any>): string[] {
    const validKeys: NormalizedIndexKeyRecord[] = this.filterValidKeysForRecord(doc);
    return this.mapKeyValuesToIndexFormat(validKeys, doc);
  }

  private filterValidKeysForRecord(doc: Record<string, any>) {
    const validKeys: NormalizedIndexKeyRecord[] = [];
    // we have to stop the key generation once any field is not defined
    this.keys.forEach(key => {
      const valueToFind = doc[key.field];
      if (valueToFind !== undefined) {
        if (Array.isArray(valueToFind)) {
          if (valueToFind.length > 0) {
            validKeys.push(key);
          }
        } else {
          validKeys.push(key);
        }
      }
    });
    return validKeys;
  }

  private mapKeyValuesToIndexFormat(validKeys: NormalizedIndexKeyRecord[], doc: Record<string, any>): string[] {
    // For compound indexes, only use non-final fields in the S3 key
    // The final field is used for sorting within the index entry
    const keysForIndexPath = validKeys.length > 1 ? validKeys.slice(0, -1) : validKeys;
    
    return keysForIndexPath.reduce((acc, key) => {
      const valueToFind = doc[key.field];
      let newKeys: string[] = [];
      if (Array.isArray(valueToFind)) {
        newKeys = valueToFind.map((v: string) => `${v}`);
      } else {
        newKeys = [`${valueToFind}`];
      }
      if (acc.length === 0) {
        return newKeys;
      }
      return newKeys.map((v: string) => acc.map((current: string) => `${current}|${v}`)).flat();
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

  abstract findIdsForKey(key: string): Promise<string[]>;

  // --- Protected methods ---
  protected async fetch(key: string): Promise<IndexEntry> {
    // In-memory: always return empty
    // Use factory method to create entry
    return this.createEntry();
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


