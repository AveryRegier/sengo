import { describe, it, expect } from 'vitest';
import { LtOperator } from '../../../src/client/expr/lt';

describe('LtOperator', () => {
  const op = new LtOperator();

  it('matches less-than', () => {
    expect(op.match(1, 3)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(2, 5)).toBe(true);
  });

  it('evaluates expression less-than', () => {
    expect(op.expression(1, 2)).toBe(true);
  });
});
