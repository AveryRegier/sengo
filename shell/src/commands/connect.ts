import { SengoClient } from 'sengo';
import type { SengoShell } from '../index.js';

export class ConnectCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'connect';
    this.description = 'Connect to a repository. Usage: connect <repositoryType>';
  }

  async run(args: any[], shell: SengoShell) {
    const [repoType] = args;
    if (shell.client) {
      console.log('Already connected. Please close the current client first.');
    } else {
      shell.client = new SengoClient();
      shell.db = shell.client.db(repoType);
      shell.currentCollection = null;
      console.log(`Connected to repository: ${repoType || 'memory'}`);
    }
  }
}
