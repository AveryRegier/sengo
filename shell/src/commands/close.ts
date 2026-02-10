import type { SengoShell } from '../index.js';

export class CloseCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'close';
    this.description = 'Close the current client connection.';
  }

  async run(_args: string[], shell: SengoShell) {
    if (shell.client) {
      await shell.client.close();
      shell.client = null;
      shell.currentCollection = null;
      console.log('Client closed.');
    } else {
      console.log('No client to close.');
    }
  }
}
