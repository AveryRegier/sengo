import { SengoClient, SengoCollection, SengoDb, getLogger, setLogLevel } from 'sengo';
import * as readline from 'node:readline';
import { parseCommandLine } from './parser.js';
import {
  ConnectCommand,
  CloseCommand,
  UseCommand,
  ExitCommand,
  HelpCommand,
  DebugCommand,
  defaultCommand
} from './commands/index.js';

export class ShellContext {
  client: SengoClient | null = null;
  db: SengoDb | null = null;
  currentCollection: SengoCollection<any> | null = null;
}

export class SengoShell {
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
    this.rl.on('line', this.handleLine.bind(this)).on('close', this.handleClose.bind(this));
    void this.initializeShell();
  }

  private async initializeShell() {
    console.log('Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.');
    const bucket = process.env.S3_BUCKET?.trim();
    if (bucket) {
      try {
        await this.commands.connect.run([bucket], this);
      } catch (err) {
        getLogger().error(err, 'unable to auto-connect to S3 bucket', { bucket });
      }
    }
    this.rl.prompt();
  }

  async handleLine(line: string) {
    const input = line.trim();
    if (!input) {
      this.rl.prompt();
      return;
    }
    
    // Parse command and args more intelligently to preserve JSON
    const { command, rest } = parseCommandLine(input);
    
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

  async handleClose() {
    // Only call exit if not already exiting
    if (!this.exiting) {
      this.exiting = true;
      await this.commands.exit.run([], this);
    }
  }

  defaultCommand = defaultCommand;
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
  getLogger,
  setLogLevel,
};
