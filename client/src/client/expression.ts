import { getOperator } from './expr/index';

/**
 * MongoDB-like query expression operators and evaluation functions.
 * This module centralizes all comparison operator definitions and logic.
 */

/**
 * Comparison operators supported in queries and indexes.
 */
export type ComparisonOperators = {
  /** Greater than */
  $gt?: number | Date | string;
  /** Less than */
  $lt?: number | Date | string;
  /** Greater than or equal to */
  $gte?: number | Date | string;
  /** Less than or equal to */
  $lte?: number | Date | string;
  /** Equal to */
  $eq?: number | Date | string | null;
  /** Not equal to */
  $ne?: number | Date | string | null;
  /** In array */
  $in?: Array<number | Date | string | null>;
  /** Not in array */
  $nin?: Array<number | Date | string | null>;
  /** Field exists */
  $exists?: boolean;
};

/**
 * Get a comparison function for the specified operator.
 * Used for evaluating comparison operators in index entries.
 * 
 * @param op - The operator string (e.g., '$lt', '$gte', '$in')
 * @returns A function that takes (actualValue, queryValue) and returns boolean
 */
export function getComparisonFn(op: string): (a: any, b: any) => boolean {
  const operator = getOperator(op);
  if (!operator) return () => true;
  return (a, b) => operator.compare(a, b);
}

/**
 * Evaluate a comparison operator against a document field value.
 * Used for in-memory document filtering.
 * 
 * @param foundValue - The actual value from the document
 * @param queryValue - The query value (can be a primitive or an operator object)
 * @param fieldKey - The field name (used for special handling like _id)
 * @returns true if the value matches the query
 */
export function evaluateComparison(foundValue: any, queryValue: any, fieldKey?: string): boolean {
  if (queryValue === undefined || queryValue === null) {
    // Direct comparison for null/undefined
    return foundValue?.toString() === queryValue?.toString();
  }

  if (isOperatorObject(queryValue)) {
    return Object.entries(queryValue)
      .filter(([key]) => key.startsWith('$'))
      .every(([op, val]) => {
        const operator = getOperator(op);
        if (!operator) return true;
        return operator.match(foundValue, val, fieldKey);
      });
  }

  // Default equality check (handles arrays and primitives)
  if (Array.isArray(foundValue)) {
    return (
      foundValue.includes(queryValue) ||
      foundValue.map((fv) => fv?.toString()).includes(queryValue?.toString())
    );
  }
  return foundValue?.toString() === queryValue?.toString();
}

function isOperatorObject(value: any): value is Record<string, any> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key.startsWith('$'))
  );
}
