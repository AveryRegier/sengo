import readline from 'node:readline';
import { SengoClient } from 'sengo-client';
import { EJSON } from 'bson';

interface ShellCommand {
  (args: string[], shell: SengoShell): Promise<void> | void;
}

class SengoShell {
  client: SengoClient | null = null;
  currentCollection: any = null;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sengo> '
  });

  constructor() {
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
    const cmd = this.commands[command] || this.defaultCommand;
    try {
      await cmd(rest, this);
    } catch (err: any) {
      console.error('Error:', err.message);
    }
    this.rl.prompt();
  }

  async handleClose() {
    if (this.client) await this.client.close();
    console.log('Goodbye!');
    process.exit(0);
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

  commands: Record<string, ShellCommand> = {
    connect: async ([repoType], shell) => {
      if (shell.client) {
        console.log('Already connected. Please close the current client first.');
      } else {
        shell.client = new SengoClient(repoType || 'memory');
        shell.currentCollection = null;
        console.log(`Connected to repository: ${repoType || 'memory'}`);
      }
    },
    close: async (_, shell) => {
      if (shell.client) {
        await shell.client.close();
        shell.client = null;
        shell.currentCollection = null;
        console.log('Client closed.');
      } else {
        console.log('No client to close.');
      }
    },
    use: async ([collectionName], shell) => {
      if (!shell.client) {
        console.log('Not connected. Use connect <repositoryType> first.');
      } else if (!collectionName) {
        console.log('Usage: use <collectionName>');
      } else {
        shell.currentCollection = shell.client.db().collection(collectionName);
        console.log(`Using collection: ${collectionName}`);
      }
    }
  };

  defaultCommand: ShellCommand = async (args, shell) => {
    const [command, ...rest] = args;
    if (shell.currentCollection) {
      const fn = shell.currentCollection[command];
      if (typeof fn === 'function') {
        const parsedArgs = shell.parseArgsWithJson(rest);
        const result = await fn.apply(shell.currentCollection, parsedArgs);
        if (result !== undefined) {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log(`Command "${command}" is not a function of the current collection.`);
      }
    } else {
      console.log('No collection selected. Use "use <collectionName>" to select a collection.');
    }
  };
}

new SengoShell();
