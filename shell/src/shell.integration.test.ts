import { jest } from '@jest/globals';

jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error('process.exit: ' + code); }) as any);

import { spawn } from 'child_process';
import path from 'path';
import Chance from 'chance';

describe('Sengo Shell Integration (Memory)', () => {
  const chance = new Chance();
  // Use the built shell entrypoint
  const shellPath = path.resolve(__dirname, '../dist/index.js');
  const collectionName = 'col_' + chance.hash({ length: 8 });
  const doc = {
    name: chance.name(),
    age: chance.age(),
    email: chance.email(),
    random: chance.string({ length: 10 })
  };

  function runShell(commands: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [shellPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { output += data.toString(); });
      child.on('error', reject);
      child.on('close', () => resolve(output));
      for (const cmd of commands) child.stdin.write(cmd + '\n');
      child.stdin.end();
    });
  }

  it('should connect, use a collection, insert, find, and close', async () => {
    const commands = [
      `connect memory`,
      `use ${collectionName}`,
      `insertOne ${JSON.stringify(doc)}`,
      `find {\"name\":\"${doc.name}\"}`,
      `close`
    ];
    const output = await runShell(commands);
    expect(output).toMatch(/Connected to repository: memory/);
    expect(output).toMatch(new RegExp(`Using collection: ${collectionName}`));
    expect(output).toMatch(/acknowledged/);
    expect(output).toMatch(new RegExp(doc.name));
    expect(output).toMatch(/Client closed/);
  });
});

describe('Sengo Shell exit/quit commands', () => {
  const shellPath = path.resolve(__dirname, '../dist/index.js');
  const runShell = (inputs: string[]) => {
    return new Promise<{ output: string, code: number | null }>((resolve) => {
      const proc = spawn('node', [shellPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { output += data.toString(); });
      let exited = false;
      const timeout = setTimeout(() => { if (!exited) proc.kill(); }, 2000);
      proc.on('exit', (code) => {
        exited = true;
        clearTimeout(timeout);
        resolve({ output, code });
      });
      // Write all inputs, then end stdin
      for (const line of inputs) proc.stdin.write(line + '\n');
      proc.stdin.end();
    });
  };

  const scenarios = [
    { name: 'quit before connect', cmds: ['quit'], expect: /Goodbye!/, exit: true },
    { name: 'exit before connect', cmds: ['exit'], expect: /Goodbye!/, exit: true },
    { name: 'quit after connect', cmds: ['connect', 'quit'], expect: /Connected to repository: memory[\s\S]*Goodbye!/, exit: true },
    { name: 'exit after connect', cmds: ['connect', 'exit'], expect: /Connected to repository: memory[\s\S]*Goodbye!/, exit: true },
    { name: 'quit after use', cmds: ['connect', 'use test', 'quit'], expect: /Using collection: test[\s\S]*Goodbye!/, exit: true },
    { name: 'exit after use', cmds: ['connect', 'use test', 'exit'], expect: /Using collection: test[\s\S]*Goodbye!/, exit: true },
  ];

  for (const { name, cmds, expect: expected } of scenarios) {
    it(name, async () => {
      const { output, code } = await runShell(cmds);
      expect(output).toMatch(expected);
      expect(code).toBe(0);
      expect(output).not.toMatch(/No collection selected/);
      expect(output).not.toMatch(/Unknown command or method/);
    });
  }
});
