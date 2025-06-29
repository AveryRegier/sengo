import readline from 'node:readline';
import { SengoClient } from 'sengo-client';
import { EJSON } from 'bson';

interface ShellCommand {
  name: string;
  description: string;
  run(args: string[], shell: SengoShell): Promise<void> | void;
}

class ConnectCommand implements ShellCommand {
  name = 'connect';
  description = 'Connect to a repository. Usage: connect <repositoryType>';
  async run(args: string[], shell: SengoShell) {
    const [repoType] = args;
    if (shell.client) {
      console.log('Already connected. Please close the current client first.');
    } else {
      shell.client = new SengoClient(repoType || 'memory');
      shell.currentCollection = null;
      console.log(`Connected to repository: ${repoType || 'memory'}`);
    }
  }
}

class CloseCommand implements ShellCommand {
  name = 'close';
  description = 'Close the current client connection.';
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

class UseCommand implements ShellCommand {
  name = 'use';
  description = 'Select a collection. Usage: use <collectionName>';
  async run(args: string[], shell: SengoShell) {
    const [collectionName] = args;
    if (!shell.client) {
      console.log('Not connected. Use connect <repositoryType> first.');
    } else if (!collectionName) {
      console.log('Usage: use <collectionName>');
    } else {
      shell.currentCollection = shell.client.db().collection(collectionName);
      console.log(`Using collection: ${collectionName}`);
    }
  }
}

class ExitCommand implements ShellCommand {
  name = 'exit';
  description = 'Exit the Sengo shell.';
  async run(_args: string[], shell: SengoShell) {
    if (shell.client) await shell.client.close();
    console.log('Goodbye!');
    shell.rl.close();
    process.exit(0);
  }
}

class HelpCommand implements ShellCommand {
  name = 'help';
  description = 'Show help for all commands.';
  async run(_args: string[], shell: SengoShell) {
    console.log('Available commands:');
    for (const cmdName of Object.keys(shell.commands)) {
      const cmd = shell.commands[cmdName];
      if (cmd && cmd.description) {
        console.log(`  ${cmdName.padEnd(8)} - ${cmd.description}`);
      }
    }
  }
}

class SengoShell {
  client: SengoClient | null = null;
  currentCollection: any = null;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sengo> '
  });
  commands: Record<string, ShellCommand>;

  constructor() {
    const exitCommand = new ExitCommand();
    this.commands = {
      connect: new ConnectCommand(),
      close: new CloseCommand(),
      use: new UseCommand(),
      help: new HelpCommand(),
      exit: exitCommand,
      quit: exitCommand,
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
    const [command, ...rest] = input.split(/\s+/);
    // Always check for shell commands first (exit/quit/etc)
    if (command === 'exit' || command === 'quit') {
      try {
        await this.commands[command].run(rest, this);
      } catch (err: any) {
        console.error('Error:', err.message);
      }
      return;
    }
    if (this.commands[command]) {
      try {
        await this.commands[command].run(rest, this);
      } catch (err: any) {
        console.error('Error:', err.message);
      }
      this.rl.prompt();
      return;
    }
    // Only call defaultCommand for non-shell commands
    try {
      await this.defaultCommand.run([command, ...rest], this);
    } catch (err: any) {
      console.error('Error:', err.message);
    }
    this.rl.prompt();
  }

  async handleClose() {
    // Only call exit if not already exiting
    if (process.exitCode == null) {
      await this.commands.exit.run([], this);
    }
  }

  parseArgsWithJson(input: string[]): any[] {
    const args: any[] = [];
    let i = 0;
    while (i < input.length) {
      if (input[i].startsWith('{') || input[i].startsWith('[')) {
        const joined = input.slice(i).join(' ');
        try {
          args.push(EJSON.parse(joined));
          break;
        } catch (err) {
          console.error('Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.');
          return [];
        }
      } else {
        args.push(input[i]);
      }
      i++;
    }
    return args;
  }

  defaultCommand: ShellCommand = {
    name: 'default',
    description: 'Default command handler for collection methods.',
    run: async (args, shell) => {
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
      const fn = shell.currentCollection[command];
      if (typeof fn === 'function') {
        const parsedArgs = shell.parseArgsWithJson(rest);
        const result = await fn.apply(shell.currentCollection, parsedArgs);
        if (result !== undefined) {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log(`Unknown command or method: ${command}`);
      }
    }
  };
}

new SengoShell();
