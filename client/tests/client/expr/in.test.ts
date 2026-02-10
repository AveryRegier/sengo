import { describe, it, expect } from 'vitest';
import { InOperator } from '../../../src/client/expr/in';

describe('InOperator', () => {
  const op = new InOperator();

  it('matches values in array', () => {
    expect(op.match('b', ['a', 'b', 'c'])).toBe(true);
  });

  it('matches _id values by string conversion of query', () => {
    const id = { toString: () => 'abc' };
    expect(op.match('abc', [id], '_id')).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(2, [1, 2, 3])).toBe(true);
  });

  it('evaluates expression in-array', () => {
    expect(op.expression('x', ['x', 'y'])).toBe(true);
  });
});
