import { describe, it, expect } from 'vitest';
import { convertToValidJson, parseArgsWithJson, parseCommandLine } from '../dist/parser.js';

describe('convertToValidJson', () => {
  describe('unquoted property names', () => {
    it('converts simple unquoted properties', () => {
      expect(convertToValidJson('{_id: "123"}')).toBe('{"_id": "123"}');
      expect(convertToValidJson('{name: "John"}')).toBe('{"name": "John"}');
      expect(convertToValidJson('{age: 25}')).toBe('{"age": 25}');
    });

    it('converts multiple unquoted properties', () => {
      const input = '{name: "John", age: 30, active: true}';
      const expected = '{"name": "John", "age": 30, "active": true}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles property names with underscores and dollars', () => {
      expect(convertToValidJson('{_id: "123"}')).toBe('{"_id": "123"}');
      expect(convertToValidJson('{$type: "test"}')).toBe('{"$type": "test"}');
      expect(convertToValidJson('{user_name: "test"}')).toBe('{"user_name": "test"}');
    });
  });

  describe('MongoDB operators', () => {
    it('handles $exists operator', () => {
      const input = '{email: {$exists: true}}';
      const expected = '{"email": {"$exists": true}}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles $gte operator', () => {
      const input = '{age: {$gte: 18}}';
      const expected = '{"age": {"$gte": 18}}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles $in operator with array', () => {
      const input = '{status: {$in: ["active", "pending"]}}';
      const expected = '{"status": {"$in": ["active", "pending"]}}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles $or operator', () => {
      const input = '{$or: [{age: {$lt: 18}}, {age: {$gt: 65}}]}';
      const expected = '{"$or": [{"age": {"$lt": 18}}, {"age": {"$gt": 65}}]}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles $ne operator', () => {
      const input = '{status: {$ne: "deleted"}}';
      const expected = '{"status": {"$ne": "deleted"}}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles $regex operator', () => {
      const input = '{name: {$regex: "^John"}}';
      const expected = '{"name": {"$regex": "^John"}}';
      expect(convertToValidJson(input)).toBe(expected);
    });
  });

  describe('mixed quoted and unquoted', () => {
    it('handles already quoted property names', () => {
      const input = '{"name": "John", age: 30}';
      const expected = '{"name": "John", "age": 30}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles single-quoted strings', () => {
      const input = "{name: 'John', age: 30}";
      const expected = '{"name": "John", "age": 30}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('preserves double quotes in property values', () => {
      const input = '{name: "John Doe"}';
      const expected = '{"name": "John Doe"}';
      expect(convertToValidJson(input)).toBe(expected);
    });
  });

  describe('nested objects', () => {
    it('handles nested unquoted properties', () => {
      const input = '{user: {name: "John", age: 30}}';
      const expected = '{"user": {"name": "John", "age": 30}}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles deeply nested structures', () => {
      const input = '{filter: {user: {profile: {age: {$gte: 18}}}}}';
      const expected = '{"filter": {"user": {"profile": {"age": {"$gte": 18}}}}}';
      expect(convertToValidJson(input)).toBe(expected);
    });
  });

  describe('boolean and null values', () => {
    it('preserves boolean values', () => {
      expect(convertToValidJson('{active: true}')).toBe('{"active": true}');
      expect(convertToValidJson('{deleted: false}')).toBe('{"deleted": false}');
    });

    it('preserves null values', () => {
      expect(convertToValidJson('{deletedAt: null}')).toBe('{"deletedAt": null}');
    });
  });

  describe('arrays', () => {
    it('handles arrays with unquoted property names', () => {
      const input = '{tags: ["javascript", "typescript"]}';
      const expected = '{"tags": ["javascript", "typescript"]}';
      expect(convertToValidJson(input)).toBe(expected);
    });

    it('handles array of objects with unquoted properties', () => {
      const input = '{items: [{name: "item1"}, {name: "item2"}]}';
      const expected = '{"items": [{"name": "item1"}, {"name": "item2"}]}';
      expect(convertToValidJson(input)).toBe(expected);
    });
  });

  describe('numbers', () => {
    it('handles integer numbers', () => {
      expect(convertToValidJson('{count: 42}')).toBe('{"count": 42}');
      expect(convertToValidJson('{negative: -10}')).toBe('{"negative": -10}');
    });

    it('handles decimal numbers', () => {
      expect(convertToValidJson('{price: 19.99}')).toBe('{"price": 19.99}');
      expect(convertToValidJson('{rate: 0.5}')).toBe('{"rate": 0.5}');
    });

    it('handles scientific notation', () => {
      expect(convertToValidJson('{big: 1e10}')).toBe('{"big": 1e10}');
      expect(convertToValidJson('{small: 1.5e-5}')).toBe('{"small": 1.5e-5}');
    });
  });
});

describe('parseArgsWithJson', () => {
  it('parses single JSON object with unquoted properties', () => {
    const input = ['{_id:', '"123"}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual([{ _id: '123' }]);
  });

  it('parses JSON with $exists operator', () => {
    const input = ['{email:', '{$exists:', 'true}}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual([{ email: { $exists: true } }]);
  });

  it('parses multiple JSON arguments', () => {
    const input = ['{name:', '"John"}', '{age:', '30}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual([{ name: 'John' }, { age: 30 }]);
  });

  it('parses mixed non-JSON and JSON arguments', () => {
    const input = ['find', '{status:', '"active"}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual(['find', { status: 'active' }]);
  });

  it('handles complex MongoDB queries with operators', () => {
    const input = ['{$or:', '[{age:', '{$lt:', '18}},', '{age:', '{$gt:', '65}}]}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual([{
      $or: [
        { age: { $lt: 18 } },
        { age: { $gt: 65 } }
      ]
    }]);
  });

  it('handles already-quoted JSON', () => {
    const input = ['{"name":', '"John",', '"age":', '30}'];
    const result = parseArgsWithJson(input);
    expect(result).toEqual([{ name: 'John', age: 30 }]);
  });
});

describe('parseCommandLine', () => {
  it('parses simple command', () => {
    const result = parseCommandLine('connect');
    expect(result).toEqual({ command: 'connect', rest: [] });
  });

  it('parses command with simple arguments', () => {
    const result = parseCommandLine('use myCollection');
    expect(result).toEqual({ command: 'use', rest: ['myCollection'] });
  });

  it('preserves JSON structures in arguments', () => {
    const result = parseCommandLine('find {_id: "123"}');
    expect(result).toEqual({ command: 'find', rest: ['{_id: "123"}'] });
  });

  it('handles multiple JSON arguments', () => {
    const result = parseCommandLine('updateOne {_id: "123"} {$set: {name: "John"}}');
    expect(result).toEqual({
      command: 'updateOne',
      rest: ['{_id: "123"}', '{$set: {name: "John"}}']
    });
  });

  it('handles nested JSON structures', () => {
    const result = parseCommandLine('find {user: {age: {$gte: 18}}}');
    expect(result).toEqual({
      command: 'find',
      rest: ['{user: {age: {$gte: 18}}}']
    });
  });

  it('handles quoted strings', () => {
    const result = parseCommandLine('find {name: "John Doe"}');
    expect(result).toEqual({
      command: 'find',
      rest: ['{name: "John Doe"}']
    });
  });

  it('handles single-quoted strings', () => {
    const result = parseCommandLine("find {name: 'John Doe'}");
    expect(result).toEqual({
      command: 'find',
      rest: ["{name: 'John Doe'}"]
    });
  });

  it('handles arrays', () => {
    const result = parseCommandLine('find {tags: ["js", "ts"]}');
    expect(result).toEqual({
      command: 'find',
      rest: ['{tags: ["js", "ts"]}']
    });
  });

  it('handles empty string', () => {
    const result = parseCommandLine('');
    expect(result).toEqual({ command: '', rest: [] });
  });

  it('handles command with extra whitespace', () => {
    const result = parseCommandLine('  find   {_id: "123"}  ');
    expect(result).toEqual({ command: 'find', rest: ['{_id: "123"}'] });
  });
});
