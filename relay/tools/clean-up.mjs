// Technically Not relay · clean-up.mjs — removes old devices from your deployed relay's list:
//   npm run clean-up -- https://your-relay.example.workers.dev
//   npm run clean-up -- https://your-relay.example.workers.dev a79da3b0
// Without more words it removes the made-up devices older checks left behind (ids that begin
// "check-"). Each extra word removes the devices whose id begins with it (the 8 characters the
// Devices page shows). A device that is connected right now is never removed. It reads the secret
// from the file `npm run setup-secret` saved and never prints it. The app does the same for one
// computer with Remove on its card in Devices.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const address = (process.argv[2] || '').replace(/\/+$/, '');
const starts = process.argv.slice(3);
if (!/^https:\/\/[^/]+$/.test(address)) {
  console.log(
    'Give the relay address, for example: npm run clean-up -- https://my-relay.example.com'
  );
  process.exit(1);
}
const host = new URL(address).host.toLowerCase();

// The same two places setup-secret.mjs writes to.
const files = [
  join(homedir(), '.tnai-keys', 'own-relay-secret.txt'),
  join(homedir(), 'technically-not-relay-secret.txt'),
];
const secretFile = files.find(file => existsSync(file));
if (!secretFile) {
  console.log('No saved secret found. Run "npm run setup-secret" first.');
  process.exit(1);
}
const secret = readFileSync(secretFile, 'utf8').trim();

// The three headers that prove this computer holds the secret, for one call.
let lastTime = 0;

function proof(what, device) {
  lastTime = Math.max(Date.now(), lastTime + 1);
  const text = `proof:${what}:${host}:${device}:${lastTime}`;
  return {
    'X-Relay-Device': device,
    'X-Relay-Time': String(lastTime),
    'X-Relay-Proof': createHmac('sha256', secret).update(text).digest('hex'),
  };
}

// Each device removes its own record: no other id is needed, and none is left behind.
async function remove(device) {
  const answer = await fetch(address + '/remote/forget?d=' + encodeURIComponent(device), {
    method: 'POST',
    headers: proof('forget:' + device, device),
  });
  return { status: answer.status, body: await answer.json().catch(() => ({})) };
}

// The list is read under a made-up id, which is removed again at the end.
const reader = 'clean-up-' + randomBytes(6).toString('hex');
const listed = await fetch(address + '/remote/presence', { headers: proof('presence', reader) });
if (listed.status !== 200) {
  console.log('The relay did not give its list (' + listed.status + '). Check the address.');
  process.exit(1);
}
const devices = (await listed.json()).devices || [];
const wanted = id =>
  id !== reader && (starts.length ? starts.some(s => id.startsWith(s)) : id.startsWith('check-'));

let removed = 0;
let kept = 0;
for (const device of devices.filter(d => wanted(d.id))) {
  if (device.online) {
    console.log('kept    ' + device.id + '  (connected right now)');
    kept++;
    continue;
  }
  const r = await remove(device.id);
  if (r.status === 404) {
    console.log('Your relay is older than this tool. Run "npm run deploy" here first.');
    process.exit(1);
  }
  console.log((r.status === 200 ? 'removed ' : 'FAILED  ') + device.id);
  if (r.status === 200) removed++;
  else kept++;
}
await remove(reader);
console.log(`\n${removed} removed, ${kept} kept, ${devices.length - removed} left on the relay`);
