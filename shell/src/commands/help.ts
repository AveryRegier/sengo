import type { SengoCollection } from 'sengo';
import type { SengoShell } from '../index.js';

type Collection = SengoCollection<unknown>;
type CollectionMethod = {
  [K in keyof Collection]: Collection[K] extends (...args: never[]) => unknown ? K : never
}[keyof Collection];

const collectionMethods: Record<CollectionMethod, true> = {
  countDocuments: true,
  createIndex: true,
  deleteOne: true,
  dropIndex: true,
  find: true,
  findOne: true,
  insertMany: true,
  insertOne: true,
  listIndexes: true,
  updateMany: true,
  updateOne: true,
};

function rightPad(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return value + ' '.repeat(width - value.length);
}

export class HelpCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'help';
    this.description = 'Show help for all commands.';
  }

  async run(_args: string[], shell: SengoShell) {
    console.log('Available commands:');
    for (const cmdName of Object.keys(shell.commands)) {
      const cmd = shell.commands[cmdName];
      if (cmd && cmd.description) {
        console.log(`  ${rightPad(cmdName, 8)} - ${cmd.description}`);
      }
    }
    if (shell.currentCollection) {
      const methodNames = Object.keys(collectionMethods)
        .filter(name => typeof shell.currentCollection?.[name as CollectionMethod] === 'function')
        .sort((a, b) => a.localeCompare(b));
      if (methodNames.length) {
        console.log('\nCollection methods:');
        for (const name of methodNames) {
          console.log(`  ${name}`);
        }
      }
    }
  }
}
