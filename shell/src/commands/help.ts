import type { SengoShell } from '../index.js';

function getPublicMethodNames(instance: unknown): string[] {
  if (!instance || (typeof instance !== 'object' && typeof instance !== 'function')) {
    return [];
  }

  const names = new Set<string>();
  let proto = Object.getPrototypeOf(instance);

  // Walk the full prototype chain to support wrapped/proxied class instances.
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name.startsWith('_')) {
        continue;
      }
      if (typeof (instance as Record<string, unknown>)[name] === 'function') {
        names.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

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
    // Show dynamic collection methods if a collection is selected
    if (shell.currentCollection) {
      const methodNames = getPublicMethodNames(shell.currentCollection);
      if (methodNames.length) {
        console.log('\nCollection methods:');
        for (const name of methodNames) {
          console.log(`  ${name}`);
        }
      }
    }
  }
}
