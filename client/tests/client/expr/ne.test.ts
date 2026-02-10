import { describe, it, expect } from 'vitest';
import { NeOperator } from '../../../src/client/expr/ne';

describe('NeOperator', () => {
  const op = new NeOperator();

  it('matches inequality', () => {
    expect(op.match(1, 2)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare('a', 'b')).toBe(true);
  });

  it('evaluates expression inequality', () => {
    expect(op.expression('x', 'y')).toBe(true);
  });
});
