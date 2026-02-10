import { describe, it, expect } from 'vitest';
import { LteOperator } from '../../../src/client/expr/lte';

describe('LteOperator', () => {
  const op = new LteOperator();

  it('matches less-than-or-equal', () => {
    expect(op.match(2, 2)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(2, 2)).toBe(true);
  });

  it('evaluates expression less-than-or-equal', () => {
    expect(op.expression(1, 1)).toBe(true);
  });
});
