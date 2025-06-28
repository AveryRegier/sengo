import readline from 'readline';
import { SengoClient } from 'sengo-client/src/client/client';

let client: SengoClient | null = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'sengo> '
});

console.log('Welcome to the Sengo shell! Type "connect <repositoryType>" to begin.');
rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  const [command, ...args] = input.split(/\s+/);
  try {
    if (command === 'connect') {
      if (client) {
        console.log('Already connected. Please close the current client first.');
      } else {
        const repoType = args[0] || 'memory';
        client = new SengoClient(repoType);
        console.log(`Connected to repository: ${repoType}`);
      }
    } else if (command === 'close') {
      if (client) {
        await client.close();
        client = null;
        console.log('Client closed.');
      } else {
        console.log('No client to close.');
      }
    } else {
      console.log('Unknown command:', command);
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
