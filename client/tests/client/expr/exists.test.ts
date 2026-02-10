import { describe, it, expect } from 'vitest';
import { ExistsOperator } from '../../../src/client/expr/exists';

describe('ExistsOperator', () => {
  const op = new ExistsOperator();

  it('matches existing fields when true', () => {
    expect(op.match('value', true)).toBe(true);
  });

  it('matches missing fields when false', () => {
    expect(op.match(undefined, false)).toBe(true);
  });

  it('compares for index usage', () => {
    expect(op.compare(null, false)).toBe(true);
  });

  it('throws for expression context', () => {
    expect(() => op.expression('x', true)).toThrowError(/not implemented/i);
  });
});
