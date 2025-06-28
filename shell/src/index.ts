import readline from 'readline';
import { SengoClient } from 'sengo-client/src/client/client';
import { EJSON } from 'bson';

let client: SengoClient | null = null;
let currentCollection: any = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'sengo> '
});

console.log('Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.');
rl.prompt();

function parseArgsWithJson(input: string[]): any[] {
  const args: any[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i].startsWith('{') || input[i].startsWith('[')) {
      // Join the rest of the input and try to parse as EJSON
      const joined = input.slice(i).join(' ');
      try {
        args.push(EJSON.parse(joined));
        break; // All remaining input is part of the JSON argument
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

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  const [command, ...rest] = input.split(/\s+/);
  try {
    if (command === 'connect') {
      if (client) {
        console.log('Already connected. Please close the current client first.');
      } else {
        const repoType = rest[0] || 'memory';
        client = new SengoClient(repoType);
        currentCollection = null;
        console.log(`Connected to repository: ${repoType}`);
      }
    } else if (command === 'close') {
      if (client) {
        await client.close();
        client = null;
        currentCollection = null;
        console.log('Client closed.');
      } else {
        console.log('No client to close.');
      }
    } else if (command === 'use') {
      if (!client) {
        console.log('Not connected. Use connect <repositoryType> first.');
      } else if (!rest[0]) {
        console.log('Usage: use <collectionName>');
      } else {
        currentCollection = client.db().collection(rest[0]);
        console.log(`Using collection: ${rest[0]}`);
      }
    } else if (currentCollection) {
      // Dynamically call method on current collection
      const fn = (currentCollection as any)[command];
      if (typeof fn === 'function') {
        const parsedArgs = parseArgsWithJson(rest);
        const result = await fn.apply(currentCollection, parsedArgs);
        if (result !== undefined) {
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log(`Unknown command or method: ${command}`);
      }
    } else {
      console.log('No collection selected. Use the use <collectionName> command.');
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
  rl.prompt();
}).on('close', () => {
  if (client) client.close();
  console.log('Goodbye!');
  process.exit(0);
});
