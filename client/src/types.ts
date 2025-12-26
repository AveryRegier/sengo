import { SortDirection } from "./util/sort";

export type Order = SortDirection | 'text';
export type IndexKeyRecord = Record<string, Order>;
export type IndexDefinition = string | IndexKeyRecord;
export type WithId<T> = T & { _id: string | number };
export type Filter<T> = Partial<Record<keyof T, any>>; // not right yet
export type Cursor<T> = {
  next(): Promise<T | null>;
  toArray(): Promise<T[]>;
  close(): Promise<void>;
  hasNext(): Promise<boolean>;
  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown>;
}

export type FindCursor<T> = Cursor<T>;

