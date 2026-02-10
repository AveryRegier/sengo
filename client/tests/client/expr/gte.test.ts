import { describe, it, expect } from 'vitest';
import { GteOperator } from '../../../src/client/expr/gte';

describe('GteOperator', () => {
  const op = new GteOperator();

  it('matches greater-than-or-equal', () => {
    expect(op.match(5, 5)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(10, 10)).toBe(true);
  });

  it('evaluates expression greater-than-or-equal', () => {
    expect(op.expression(4, 4)).toBe(true);
  });
});
