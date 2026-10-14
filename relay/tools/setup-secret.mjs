// Technically Not relay · setup-secret.mjs — makes the relay's secret and gives it to the deployed
// relay in one step, without ever showing it on screen: `npm run setup-secret` in this folder.
//
// The secret is saved to a file so you can paste it into the app afterwards (Devices → Use my own
// relay). If a file is already there, that secret is used again and no new one is made.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayFolder = join(dirname(fileURLToPath(import.meta.url)), '..');

// Where the secret is kept: the key folder when this computer has one, else the home folder.
const keyFolder = join(homedir(), '.tnai-keys');
const secretFile = existsSync(keyFolder)
  ? join(keyFolder, 'own-relay-secret.txt')
  : join(homedir(), 'technically-not-relay-secret.txt');

let secret = '';
if (existsSync(secretFile)) {
  secret = readFileSync(secretFile, 'utf8').trim();
  console.log('Using the secret already saved in ' + secretFile);
} else {
  // 32 random bytes as text: 43 characters, which the relay and the app both accept
  secret = randomBytes(32).toString('base64url');
  mkdirSync(dirname(secretFile), { recursive: true });
  writeFileSync(secretFile, secret + '\n', { mode: 0o600 });
  console.log('A new secret was saved in ' + secretFile);
}

// Wrangler reads the secret from its input, so it is never part of a command line.
// One command line with nothing of the user's in it, run by the system's shell (npx is a .cmd
// file on Windows).
const result = spawnSync('npx wrangler secret put RELAY_SECRET', {
  cwd: relayFolder,
  input: secret,
  stdio: ['pipe', 'inherit', 'inherit'],
  shell: true,
});

if (result.status === 0) {
  console.log('\nDone. The relay now has its secret.');
  console.log('In the app: Devices → Use my own relay → paste the text from that file.');
} else {
  console.log('\nThe relay did not take the secret. Is this computer signed in to Cloudflare?');
  console.log('Run "npx wrangler login" in this folder, then run this again.');
  process.exit(1);
}
