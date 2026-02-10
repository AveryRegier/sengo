import { setLogLevel } from 'sengo';
import type { SengoShell } from '../index.js';

export class DebugCommand {
  name: string;
  description: string;

  constructor() {
    this.name = 'debug';
    this.description = 'Enable or disable debug mode. Usage: debug [on|off]';
  }

  run(args: string[], shell: SengoShell) {
    const arg = args[0]?.toLowerCase();
    if (arg === 'off') {
      shell.debugMode = false;
      setLogLevel('error');
      console.log('Debug mode OFF');
    } else {
      shell.debugMode = true;
      setLogLevel('debug');
      console.log('Debug mode ON');
    }
  }
}
