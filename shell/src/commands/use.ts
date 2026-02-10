import type { SengoShell } from '../index.js';

export class UseCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'use';
    this.description = 'Select a collection. Usage: use <collectionName>';
  }

  async run(args: string[], shell: SengoShell) {
    const [collectionName] = args;
    if (!shell.db) {
      console.log('Not connected. Use connect <repositoryType> first.');
    } else if (!collectionName) {
      console.log('Usage: use <collectionName>');
    } else {
      shell.currentCollection = shell.db.collection(collectionName);
      console.log(`Using collection: ${collectionName}`);
    }
  }
}
