import { describe, it, expect } from 'vitest';
import { EqOperator } from '../../../src/client/expr/eq';

describe('EqOperator', () => {
  const op = new EqOperator();

  it('matches arrays by value', () => {
    expect(op.match(['a', 'b'], 'b')).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(5, 5)).toBe(true);
  });

  it('evaluates expression equality', () => {
    expect(op.expression('x', 'x')).toBe(true);
  });
});
