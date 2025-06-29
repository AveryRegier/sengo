import { SengoShell } from './index';
import { vi } from 'vitest';
describe('SengoShell.parseArgsWithJson', () => {
    let shell;
    beforeEach(() => {
        shell = new SengoShell();
    });
    afterEach(() => {
        shell.rl.close();
    });
    it('parses a single JSON argument', () => {
        const input = ['{"foo":1}'];
        expect(shell.parseArgsWithJson(input)).toEqual([{ foo: 1 }]);
    });
    it('parses two JSON arguments separated by space', () => {
        const input = ['{"foo":1}', '{"bar":2}'];
        expect(shell.parseArgsWithJson(input)).toEqual([{ foo: 1 }, { bar: 2 }]);
    });
    it('parses two JSON arguments split by spaces', () => {
        const input = ['{"foo":', '1}', '{"bar":', '2}'];
        expect(shell.parseArgsWithJson(input)).toEqual([{ foo: 1 }, { bar: 2 }]);
    });
    it('parses mixed non-JSON and JSON arguments', () => {
        const input = ['find', '{"foo":1}'];
        expect(shell.parseArgsWithJson(input)).toEqual(['find', { foo: 1 }]);
    });
    it('returns [] and logs error for invalid JSON', () => {
        const input = ['{"foo":1', '{"bar":2}'];
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        expect(shell.parseArgsWithJson(input)).toEqual([]);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});
