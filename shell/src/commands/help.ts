import type { SengoShell } from '../index.js';

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
        console.log(`  ${cmdName.padEnd(8)} - ${cmd.description}`);
      }
    }
    // Show dynamic collection methods if a collection is selected
    if (shell.currentCollection) {
      const proto = Object.getPrototypeOf(shell.currentCollection);
      const methodNames = Object.getOwnPropertyNames(proto)
        .filter(
          name =>
            typeof (shell.currentCollection as any)[name] === 'function' &&
            name !== 'constructor' &&
            !name.startsWith('_') // Only public methods
        );
      if (methodNames.length) {
        console.log('\nCollection methods:');
        for (const name of methodNames) {
          console.log(`  ${name}`);
        }
      }
    }
  }
}
