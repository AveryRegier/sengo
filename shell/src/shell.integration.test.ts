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
