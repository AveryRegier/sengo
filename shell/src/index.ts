import { SengoClient, SengoCollection, SengoDb, getLogger, setLogLevel } from 'sengo';
import * as readline from 'node:readline';
import { EJSON } from 'bson';

export class ShellContext {
  client: SengoClient | null = null;
  db: SengoDb | null = null;
  currentCollection: SengoCollection<any> | null = null;
}

class ConnectCommand {
  name: string;
  description: string;
  
  constructor() {
    this.name = 'connect';
    this.description = 'Connect to a repository. Usage: connect <repositoryType>';
  }
  async run(args: any[], shell: ShellContext) {
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

class CloseCommand {
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

class UseCommand {
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

class ExitCommand {
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

class HelpCommand {
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

class DebugCommand {
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

class SengoShell {
  client: SengoClient | null;
  db: SengoDb | null;
  public currentCollection: SengoCollection<any> | null;
  rl: readline.Interface;
  commands: Record<string, any>;
  exiting: boolean;
  debugMode: boolean;
  
  constructor() {
    this.client = null;
    this.db = null;
    this.currentCollection = null;
    this.exiting = false; // Prevent duplicate exit
    this.debugMode = false;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'sengo> '
    });
    this.commands = {
      connect: new ConnectCommand(),
      close: new CloseCommand(),
      use: new UseCommand(),
      help: new HelpCommand(),
      debug: new DebugCommand(),
      exit: new ExitCommand(),
      quit: new ExitCommand(),
    };
    console.log('Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.');
    this.rl.prompt();
    this.rl.on('line', this.handleLine.bind(this)).on('close', this.handleClose.bind(this));
  }

  async handleLine(line: string) {
    const input = line.trim();
    if (!input) {
      this.rl.prompt();
      return;
    }
    
    // Parse command and args more intelligently to preserve JSON
    const { command, rest } = this.parseCommandLine(input);
    
    // Always check for shell commands first (exit/quit/etc)
    if (command === 'exit' || command === 'quit') {
      try {
        await this.commands[command].run(rest, this);
      } catch (err) {
        getLogger().error(err, 'unable to run exit/quit command',   { command, line });
      }
      return;
    }
    if (this.commands[command]) {
      try {
        await this.commands[command].run(rest, this);
      } catch (err) {
        getLogger().error(err, 'unable to run shell command', { command, line });
      }
      this.rl.prompt();
      return;
    }
    // Only call defaultCommand for non-shell commands
    try {
      await this.defaultCommand.run([command, ...rest], this);
    } catch (err) {
      getLogger().error(err, 'unable to run non-shell command', { command, line });
    }
    this.rl.prompt();
  }

  parseCommandLine(line: string): { command: string; rest: string[] } {
    // Extract command (first word) and keep the rest as a single string
    const match = line.match(/^(\S+)\s*(.*)$/);
    if (!match) {
      return { command: '', rest: [] };
    }
    const command = match[1];
    const argsString = match[2].trim();
    
    if (!argsString) {
      return { command, rest: [] };
    }
    
    // Split arguments intelligently, preserving JSON structures
    const args: string[] = [];
    let current = '';
    let inJson = false;
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      
      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        current += char;
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        current += char;
        continue;
      }
      
      if (!inString) {
        if (char === '{' || char === '[') {
          if (!inJson) {
            inJson = true;
            braceCount = 0;
          }
          braceCount++;
          current += char;
          continue;
        }
        
        if (char === '}' || char === ']') {
          braceCount--;
          current += char;
          if (braceCount === 0) {
            inJson = false;
          }
          continue;
        }
        
        if (!inJson && /\s/.test(char)) {
          if (current) {
            args.push(current);
            current = '';
          }
          continue;
        }
      }
      
      current += char;
    }
    
    if (current) {
      args.push(current);
    }
    
    return { command, rest: args };
  }

  async handleClose() {
    // Only call exit if not already exiting
    if (!this.exiting) {
      this.exiting = true;
      await this.commands.exit.run([], this);
    }
  }

  parseArgsWithJson(input: string[]) {
    // Improved: parse multiple JSON objects from input, even if separated by spaces
    const args: any[] = [];
    let buffer = '';
    let inJson = false;
    let braceCount = 0;
    for (let i = 0; i < input.length; i++) {
      const token = input[i];
      if (!inJson && (token.startsWith('{') || token.startsWith('['))) {
        inJson = true;
        braceCount = 0;
        buffer = '';
      }
      if (inJson) {
        buffer += (buffer ? ' ' : '') + token;
        for (const char of token) {
          if (char === '{' || char === '[') braceCount++;
          if (char === '}' || char === ']') braceCount--;
        }
        if (braceCount === 0) {
          // End of JSON object/array
          try {
            args.push(EJSON.parse(buffer));
          } catch (err) {
            const tmp = 'Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.';
            console.error(tmp);
            getLogger().error(err, tmp);
            return [];
          }
          inJson = false;
          buffer = '';
        }
      } else {
        args.push(token);
      }
    }
    // If buffer is not empty, try to parse last JSON
    if (buffer) {
      try {
        args.push(EJSON.parse(buffer));
      } catch (err) {
        const tmp = 'Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.';
        console.error(tmp);
        getLogger().error(err, tmp);
        return [];
      }
    }
    return args;
  }

  defaultCommand = {
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
          const parsedArgs = shell.parseArgsWithJson(rest);
          getLogger().info('Executing command', { command, args: parsedArgs });
          if (shell.debugMode) {
            console.log('[DEBUG] Arguments:', JSON.stringify(parsedArgs, null, 2));
          }
          const result = await fn.apply(shell.currentCollection, parsedArgs);
          if(result?.toArray && typeof result.toArray === 'function') {
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
}

new SengoShell();

// Example usage of setLogLevel
setLogLevel('error');
setLogLevel('debug');

// Export any shell-specific functions or classes
export {
  SengoClient,
  SengoCollection,
  SengoDb,
  SengoShell,
  getLogger,
  setLogLevel,
};
