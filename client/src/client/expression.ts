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
  switch (op) {
    case '$lt':
      return (a, b) => a < b;
    case '$lte':
      return (a, b) => a <= b;
    case '$gt':
      return (a, b) => a > b;
    case '$gte':
      return (a, b) => a >= b;
    case '$eq':
      return (a, b) => a === b;
    case '$ne':
      return (a, b) => a !== b;
    case '$exists':
      return (a, b) => a === undefined || a === null || a === '' ? !b : b;
    case '$in':
      return (a, b) => Array.isArray(b) ? b.includes(a) : false;
    case '$nin':
      return (a, b) => Array.isArray(b) ? !b.includes(a) : true;
    default:
      return () => true;
  }
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

  // Handle $in operator
  if (queryValue.$in !== undefined) {
    let inValues = queryValue.$in;
    // Special handling for _id field - convert to strings
    if (fieldKey === '_id') {
      inValues = inValues.map((id: any) => id.toString());
    }
    if (Array.isArray(foundValue)) {
      return inValues.some((item: unknown) => foundValue.includes(item));
    }
    return inValues.includes(foundValue);
  }

  // Handle $nin operator
  if (queryValue.$nin !== undefined) {
    let ninValues = queryValue.$nin;
    // Special handling for _id field - convert to strings
    if (fieldKey === '_id') {
      ninValues = ninValues.map((id: any) => id.toString());
    }
    if (Array.isArray(foundValue)) {
      return !ninValues.some((item: unknown) => foundValue.includes(item));
    }
    return !ninValues.includes(foundValue);
  }

  // Handle $eq operator - fall through to equality check
  let compareValue = queryValue;
  if (queryValue.$eq !== undefined) {
    compareValue = queryValue.$eq;
  }

  // Handle $ne operator
  if (queryValue.$ne !== undefined) {
    return foundValue !== queryValue.$ne;
  }

  // Handle $gt operator
  if (queryValue.$gt !== undefined) {
    return foundValue > queryValue.$gt;
  }

  // Handle $gte operator
  if (queryValue.$gte !== undefined) {
    return foundValue >= queryValue.$gte;
  }

  // Handle $lt operator
  if (queryValue.$lt !== undefined) {
    return foundValue < queryValue.$lt;
  }

  // Handle $lte operator
  if (queryValue.$lte !== undefined) {
    return foundValue <= queryValue.$lte;
  }

  // Handle $exists operator
  if (queryValue.$exists !== undefined) {
    const exists = foundValue !== undefined && foundValue !== null && foundValue !== '';
    return queryValue.$exists ? exists : !exists;
  }

  // Default equality check (handles arrays and primitives)
  if (Array.isArray(foundValue)) {
    return foundValue.includes(compareValue) || 
           foundValue.map(fv => fv?.toString()).includes(compareValue?.toString());
  }
  return foundValue?.toString() === compareValue?.toString();
}
