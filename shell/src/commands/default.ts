import { getLogger } from 'sengo';
import { parseArgsWithJson } from '../parser.js';
import type { SengoShell } from '../index.js';

export const defaultCommand = {
  name: 'default',
  description: 'Default command handler for collection methods.',
  run: async (args: string[], shell: SengoShell) => {
    const [command, ...rest] = args;
    if (command === 'exit' || command === 'quit') {
      await shell.commands[command].run(rest, shell);
      return;
    }
    if (shell.commands[command]) {
      await shell.commands[command].run(rest, shell);
      return;
    }
    if (!shell.currentCollection) {
      console.log(`Unknown command or method: ${command}`);
      return;
    }
    const fn = (shell.currentCollection as any)[command];
    if (typeof fn === 'function') {
      try {
        const parsedArgs = parseArgsWithJson(rest);
        getLogger().info('Executing command', { command, args: parsedArgs });
        if (shell.debugMode) {
          console.log('[DEBUG] Arguments:', JSON.stringify(parsedArgs, null, 2));
        }
        const result = await fn.apply(shell.currentCollection, parsedArgs);
        if (result?.toArray && typeof result.toArray === 'function') {
          const docs = await result.toArray();
          console.log(JSON.stringify(docs, null, 2));
        } else if (result !== undefined) {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (err: any) {
        console.error(`Error executing ${command}:`, err.message || err);
        getLogger().error(err, `Error executing ${command}`, { command, args: rest });
      }
    } else {
      console.log(`Unknown command or method: ${command}`);
    }
  }
};
