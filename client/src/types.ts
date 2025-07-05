export type Order = 1 | -1 | 'text';
export type IndexKeyRecord = Record<string, Order>;
export type IndexDefinition = string | IndexKeyRecord;
export type WithId<T> = T & { _id: string | number };
export type Filter<T> = Partial<Record<keyof T, any>>; // not right yet