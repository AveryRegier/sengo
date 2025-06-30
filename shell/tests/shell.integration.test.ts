import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

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
    { name: 'help before connect', cmds: ['help'], expect: /Available commands:[\s\S]*connect[\s\S]*close[\s\S]*use[\s\S]*help[\s\S]*exit[\s\S]*quit/, exit: false },
    { name: 'help after connect', cmds: ['connect', 'help'], expect: /Available commands:[\s\S]*connect[\s\S]*close[\s\S]*use[\s\S]*help[\s\S]*exit[\s\S]*quit/, exit: false },
    { name: 'help after use', cmds: ['connect', 'use test', 'help'], expect: /Available commands:[\s\S]*connect[\s\S]*close[\s\S]*use[\s\S]*help[\s\S]*exit[\s\S]*quit/, exit: false }
  ];

  for (const { name, cmds, expect: expected, exit } of scenarios) {
    it(name, async () => {
      const { output, code } = await runShell(cmds);
      expect(output).toMatch(expected);
      if (exit) {
        expect(code).toBe(0);
      }
      expect(output).not.toMatch(/No collection selected/);
      expect(output).not.toMatch(/Unknown command or method/);
    });
  }
});
