export type Order = 1 | -1 | 'text';
export type IndexKeyRecord = Record<string, Order>;
export type IndexDefinition = string | IndexKeyRecord;
