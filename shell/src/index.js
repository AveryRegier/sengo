var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import readline from 'node:readline';
import { SengoClient } from 'sengo-client';
import { EJSON } from 'bson';
class ConnectCommand {
    constructor() {
        this.name = 'connect';
        this.description = 'Connect to a repository. Usage: connect <repositoryType>';
    }
    run(args, shell) {
        return __awaiter(this, void 0, void 0, function* () {
            const [repoType] = args;
            if (shell.client) {
                console.log('Already connected. Please close the current client first.');
            }
            else {
                shell.client = new SengoClient(repoType || 'memory');
                shell.currentCollection = null;
                console.log(`Connected to repository: ${repoType || 'memory'}`);
            }
        });
    }
}
class CloseCommand {
    constructor() {
        this.name = 'close';
        this.description = 'Close the current client connection.';
    }
    run(_args, shell) {
        return __awaiter(this, void 0, void 0, function* () {
            if (shell.client) {
                yield shell.client.close();
                shell.client = null;
                shell.currentCollection = null;
                console.log('Client closed.');
            }
            else {
                console.log('No client to close.');
            }
        });
    }
}
class UseCommand {
    constructor() {
        this.name = 'use';
        this.description = 'Select a collection. Usage: use <collectionName>';
    }
    run(args, shell) {
        return __awaiter(this, void 0, void 0, function* () {
            const [collectionName] = args;
            if (!shell.client) {
                console.log('Not connected. Use connect <repositoryType> first.');
            }
            else if (!collectionName) {
                console.log('Usage: use <collectionName>');
            }
            else {
                shell.currentCollection = shell.client.db().collection(collectionName);
                console.log(`Using collection: ${collectionName}`);
            }
        });
    }
}
class ExitCommand {
    constructor() {
        this.name = 'exit';
        this.description = 'Exit the Sengo shell.';
    }
    run(_args, shell) {
        return __awaiter(this, void 0, void 0, function* () {
            if (shell.exiting)
                return;
            shell.exiting = true;
            if (shell.client)
                yield shell.client.close();
            console.log('Goodbye!');
            shell.rl.close();
            process.exit(0);
        });
    }
}
class HelpCommand {
    constructor() {
        this.name = 'help';
        this.description = 'Show help for all commands.';
    }
    run(_args, shell) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Available commands:');
            for (const cmdName of Object.keys(shell.commands)) {
                const cmd = shell.commands[cmdName];
                if (cmd && cmd.description) {
                    console.log(`  ${cmdName.padEnd(8)} - ${cmd.description}`);
                }
            }
        });
    }
}
class DebugCommand {
    constructor() {
        this.name = 'debug';
        this.description = 'Enable or disable debug mode. Usage: debug [on|off]';
    }
    run(args, shell) {
        var _a;
        const arg = (_a = args[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        if (arg === 'off') {
            shell.debugMode = false;
            console.log('Debug mode OFF');
        }
        else {
            shell.debugMode = true;
            console.log('Debug mode ON');
        }
    }
}
export class SengoShell {
    constructor() {
        this.client = null;
        this.currentCollection = null;
        this.exiting = false; // Prevent duplicate exit
        this.debugMode = false;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'sengo> '
        });
        this.defaultCommand = {
            name: 'default',
            description: 'Default command handler for collection methods.',
            run: (args, shell) => __awaiter(this, void 0, void 0, function* () {
                const [command, ...rest] = args;
                if (command === 'exit' || command === 'quit') {
                    yield shell.commands[command].run(rest, shell);
                    return;
                }
                if (shell.commands[command]) {
                    yield shell.commands[command].run(rest, shell);
                    return;
                }
                if (!shell.currentCollection) {
                    console.log(`Unknown command or method: ${command}`);
                    return;
                }
                const fn = shell.currentCollection[command];
                if (typeof fn === 'function') {
                    const parsedArgs = shell.parseArgsWithJson(rest);
                    if (shell.debugMode) {
                        console.log('[DEBUG] Arguments:', JSON.stringify(parsedArgs, null, 2));
                    }
                    const result = yield fn.apply(shell.currentCollection, parsedArgs);
                    if (result !== undefined) {
                        console.log(JSON.stringify(result, null, 2));
                    }
                }
                else {
                    console.log(`Unknown command or method: ${command}`);
                }
            })
        };
        const exitCommand = new ExitCommand();
        this.commands = {
            connect: new ConnectCommand(),
            close: new CloseCommand(),
            use: new UseCommand(),
            help: new HelpCommand(),
            debug: new DebugCommand(),
            exit: exitCommand,
            quit: exitCommand,
        };
        console.log('Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.');
        this.rl.prompt();
        this.rl.on('line', this.handleLine.bind(this)).on('close', this.handleClose.bind(this));
    }
    handleLine(line) {
        return __awaiter(this, void 0, void 0, function* () {
            const input = line.trim();
            if (!input) {
                this.rl.prompt();
                return;
            }
            const [command, ...rest] = input.split(/\s+/);
            // Always check for shell commands first (exit/quit/etc)
            if (command === 'exit' || command === 'quit') {
                try {
                    yield this.commands[command].run(rest, this);
                }
                catch (err) {
                    console.error('Error:', err.message);
                }
                return;
            }
            if (this.commands[command]) {
                try {
                    yield this.commands[command].run(rest, this);
                }
                catch (err) {
                    console.error('Error:', err.message);
                }
                this.rl.prompt();
                return;
            }
            // Only call defaultCommand for non-shell commands
            try {
                yield this.defaultCommand.run([command, ...rest], this);
            }
            catch (err) {
                console.error('Error:', err.message);
            }
            this.rl.prompt();
        });
    }
    handleClose() {
        return __awaiter(this, void 0, void 0, function* () {
            // Only call exit if not already exiting
            if (!this.exiting) {
                this.exiting = true;
                yield this.commands.exit.run([], this);
            }
        });
    }
    parseArgsWithJson(input) {
        // Improved: parse multiple JSON objects from input, even if separated by spaces
        const args = [];
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
                    if (char === '{' || char === '[')
                        braceCount++;
                    if (char === '}' || char === ']')
                        braceCount--;
                }
                if (braceCount === 0) {
                    // End of JSON object/array
                    try {
                        args.push(EJSON.parse(buffer));
                    }
                    catch (err) {
                        console.error('Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.');
                        return [];
                    }
                    inJson = false;
                    buffer = '';
                }
            }
            else {
                args.push(token);
            }
        }
        // If buffer is not empty, try to parse last JSON
        if (buffer) {
            try {
                args.push(EJSON.parse(buffer));
            }
            catch (err) {
                console.error('Error: Parsing error: Only valid JSON or MongoDB Extended JSON is accepted.');
                return [];
            }
        }
        return args;
    }
}
new SengoShell();
