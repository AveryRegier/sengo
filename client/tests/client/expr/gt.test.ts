import { describe, it, expect } from 'vitest';
import { GtOperator } from '../../../src/client/expr/gt';

describe('GtOperator', () => {
  const op = new GtOperator();

  it('matches greater-than', () => {
    expect(op.match(5, 3)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(10, 2)).toBe(true);
  });

  it('evaluates expression greater-than', () => {
    expect(op.expression(4, 1)).toBe(true);
  });
});
