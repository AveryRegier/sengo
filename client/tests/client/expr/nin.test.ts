import { describe, it, expect } from 'vitest';
import { NinOperator } from '../../../src/client/expr/nin';

describe('NinOperator', () => {
  const op = new NinOperator();

  it('matches values not in array', () => {
    expect(op.match('d', ['a', 'b', 'c'])).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(4, [1, 2, 3])).toBe(true);
  });

  it('throws for expression context', () => {
    expect(() => op.expression('x', ['x'])).toThrowError(/not implemented/i);
  });
});
