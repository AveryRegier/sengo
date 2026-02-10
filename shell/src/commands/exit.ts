import type { SengoShell } from '../index.js';

export class ExitCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'exit';
    this.description = 'Exit the Sengo shell.';
  }

  async run(_args: string[], shell: SengoShell) {
    if (shell.exiting) return;
    shell.exiting = true;
    if (shell.client) await shell.client.close();
    console.log('Goodbye!');
    shell.rl.close();
    process.exit(0);
  }
}
