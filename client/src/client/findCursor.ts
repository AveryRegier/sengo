export type Cursor<T> = {
  next(): Promise<T | null>;
  toArray(): Promise<T[]>;
  close(): Promise<void>;
  hasNext(): Promise<boolean>;
  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown>;
}

export type FindCursor<T> = Cursor<T>;

export class ConsumingArrayCursor<T> implements Cursor<T> {
  private _docs: T[];
  private _index: number;
  private _closed: boolean;

  constructor(docs: T[]) {
    this._docs = docs;
    this._index = 0;
    this._closed = false;
  }

  /**
   * Returns the next document in the cursor, or null if exhausted.
   */
  async next(): Promise<T | null> {
    if (this._closed) throw new Error('Cursor is closed');
    if (this._index < this._docs.length) {
      return this._docs[this._index++];
    }
    return null;
  }

  /**
   * Returns all remaining documents as an array.
   */
  async toArray(): Promise<T[]> {
    if (this._closed) throw new Error('Cursor is closed');
    const remaining = this._docs.slice(this._index);
    this._index = this._docs.length;
    return remaining;
  }

  /**
   * Closes the cursor.
   */
  async close(): Promise<void> {
    this._closed = true;
  }

  /**
   * Returns true if there are more documents.
   */
  async hasNext(): Promise<boolean> {
    return !this._closed && this._index < this._docs.length;
  }

  /**
   * For async iteration: for await (const doc of cursor) { ... }
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<any, void, unknown> {
    let doc;
    while ((doc = await this.next()) !== null) {
      yield doc;
    }
  }
}
