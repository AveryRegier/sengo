import type { WithId } from '../types';
import { evaluateFieldPathComparison } from './expression';

export function matchesDocument(doc: Record<string, any>, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, value]) => match(doc, key, value));
}

export function filterMatchingDocuments<T>(docs: WithId<T>[], query: Record<string, any>): WithId<T>[] {
  return docs.filter((parsed: Record<string, any>) => {
    if (parsed && typeof parsed === 'object' && parsed._id !== undefined) {
      return matchesDocument(parsed, query);
    }
    return false;
  });
}

function match(parsed: Record<string, any>, key: string, value: any): unknown {
  if (value?.$or) {
    return matchesOrArray(parsed, value.$or);
  }
  if (key === '$or') {
    return matchesOrArray(parsed, value);
  }
  return evaluateFieldPathComparison(parsed, key, value);
}

function matchesOrArray(parsed: Record<string, any>, arr: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some((condition: Record<string, any>) => matchesDocument(parsed, condition));
}
