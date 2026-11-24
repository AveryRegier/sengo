import { isDeepStrictEqual } from 'node:util';
import { MongoServerError } from '../errors';

type Document = Record<string, any>;
type UpdateOperator = {
  apply(current: unknown, operand: unknown, exists: boolean): { value: unknown; remove?: boolean };
  insertOnly?: boolean;
};

const operators: Record<string, UpdateOperator> = {
  $set: { apply: (_current, operand) => ({ value: operand }) },
  $setOnInsert: { insertOnly: true, apply: (_current, operand) => ({ value: operand }) },
  $inc: {
    apply: (current, operand, exists) => {
      if (typeof operand !== 'number' || (exists && typeof current !== 'number')) {
        throw new MongoServerError('$inc requires numeric values');
      }
      return { value: exists ? (current as number) + operand : operand };
    },
  },
  $unset: { apply: () => ({ value: undefined, remove: true }) },
  $push: {
    apply: (current, operand, exists) => {
      if (exists && !Array.isArray(current)) {
        throw new MongoServerError('$push requires an array field');
      }
      if (operand !== null && typeof operand === 'object' && !Array.isArray(operand)
          && Object.keys(operand).some(key => key.startsWith('$'))) {
        throw new MongoServerError('$push modifiers are not supported');
      }
      return { value: [...(exists ? current as unknown[] : []), operand] };
    },
  },
};

export function validateUpdate(update: Document): void {
  const supported = Object.keys(operators);
  if (!update || typeof update !== 'object' || Array.isArray(update)
      || Object.keys(update).length === 0
      || Object.keys(update).some(key => !Object.prototype.hasOwnProperty.call(operators, key))) {
    const error = new MongoServerError(
      `Update document must contain supported update operators (${supported.join(', ')}). Full document replacement is not yet supported.`,
    );
    error.code = 9;
    throw error;
  }
  const paths: string[] = [];
  for (const [operator, fields] of Object.entries(update)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new MongoServerError(`${operator} requires an object`);
    }
    for (const [path, operand] of Object.entries(fields)) {
      const segments = path.split('.');
      if (segments.some(segment => !segment || segment.startsWith('$')
          || segment === '__proto__' || segment === 'constructor' || segment === 'prototype')) {
        throw new MongoServerError(`Unsupported update path: ${path}`);
      }
      if (paths.some(other => other === path || other.startsWith(`${path}.`) || path.startsWith(`${other}.`))) {
        throw new MongoServerError(`Conflicting update path: ${path}`);
      }
      paths.push(path);
      if (operator === '$inc' && typeof operand !== 'number') {
        throw new MongoServerError('$inc requires numeric values');
      }
      if (operator === '$push' && operand !== null && typeof operand === 'object'
          && !Array.isArray(operand) && Object.keys(operand).some(key => key.startsWith('$'))) {
        throw new MongoServerError('$push modifiers are not supported');
      }
    }
  }
}

function updatePath(document: Document, path: string, operator: UpdateOperator, operand: unknown): Document {
  const segments = path.split('.');
  function visit(current: any, depth: number): any {
    const segment = segments[depth];
    if (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(segment)) {
      throw new MongoServerError(`Cannot update array path ${path}`);
    }
    const exists = Object.prototype.hasOwnProperty.call(current, segment);
    if (depth === segments.length - 1) {
      const change = operator.apply(current[segment], operand, exists);
      if (change.remove && !exists) return current;
      const copy = Array.isArray(current) ? current.slice() : { ...current };
      if (change.remove) {
        if (Array.isArray(copy)) copy[Number(segment)] = null;
        else delete copy[segment];
      } else {
        if (Array.isArray(copy)) {
          while (copy.length < Number(segment)) copy.push(null);
        }
        copy[segment] = change.value;
      }
      return copy;
    }
    const child = exists ? current[segment] : undefined;
    if (child === undefined && operator === operators.$unset) return current;
    if (child !== undefined && (child === null || typeof child !== 'object'
        || (!Array.isArray(child) && Object.getPrototypeOf(child) !== Object.prototype
          && Object.getPrototypeOf(child) !== null))) {
      if (operator === operators.$unset) return current;
      throw new MongoServerError(`Cannot create field at ${path}`);
    }
    const next = visit(child === undefined ? {} : child, depth + 1);
    if (next === child) return current;
    const copy = Array.isArray(current) ? current.slice() : { ...current };
    if (Array.isArray(copy)) {
      while (copy.length < Number(segment)) copy.push(null);
    }
    copy[segment] = next;
    return copy;
  }
  return visit(document, 0);
}

export function applyUpdate<T extends Document>(document: T, update: Document, inserting = false): T {
  let result: Document = document;
  for (const [name, fields] of Object.entries(update)) {
    const operator = operators[name];
    if (operator.insertOnly && !inserting) continue;
    for (const [path, operand] of Object.entries(fields)) {
      result = updatePath(result, path, operator, operand);
    }
  }
  if (!inserting && !isDeepStrictEqual(result._id, document._id)) {
    throw new MongoServerError('The _id field is immutable');
  }
  return result as T;
}
