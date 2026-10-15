// Technically Not relay · check.mjs — tries your deployed relay from this computer:
//   npm run check -- https://your-relay.example.workers.dev
// It reads the secret from the file `npm run setup-secret` saved (never from the command line and
// never printed), connects two made-up devices, passes one message between them and prints what
// worked. At its end it removes the two made-up devices again, so nothing is left on the relay.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const address = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+$/.test(address)) {
  console.log('Give the relay address, for example: npm run check -- https://my-relay.example.com');
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

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok || !detail ? '' : '  (' + detail + ')'));
}

// The three headers that prove this computer holds the secret, for one call.
let lastTime = 0;

function proof(what, device, withSecret = secret) {
  lastTime = Math.max(Date.now(), lastTime + 1);
  const text = `proof:${what}:${host}:${device}:${lastTime}`;
  return {
    'X-Relay-Device': device,
    'X-Relay-Time': String(lastTime),
    'X-Relay-Proof': createHmac('sha256', withSecret).update(text).digest('hex'),
  };
}

async function ticketFor(device, withSecret) {
  const answer = await fetch(address + '/remote/ticket', {
    method: 'POST',
    headers: proof('ticket', device, withSecret),
  });
  return { status: answer.status, body: await answer.json() };
}

// Opens a WebSocket with a ticket and collects what arrives.
function connect(ticket) {
  return new Promise(resolve => {
    const socket = new WebSocket(
      address.replace(/^http/, 'ws') + '/remote/connect?ticket=' + encodeURIComponent(ticket)
    );
    const got = [];
    const timer = setTimeout(() => resolve({ socket, got, open: false }), 10000);
    socket.onmessage = event => got.push(String(event.data));
    socket.onopen = () => {
      clearTimeout(timer);
      resolve({ socket, got, open: true });
    };
    socket.onerror = () => {
      clearTimeout(timer);
      resolve({ socket, got, open: false });
    };
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deviceA = 'check-' + randomBytes(6).toString('hex');
const deviceB = 'check-' + randomBytes(6).toString('hex');

try {
  const front = await (await fetch(address + '/')).json();
  check('the address answers as a Technically Not relay', front.relay === 'technically-not');

  const wrong = await ticketFor(deviceA, 'x'.repeat(20) + randomBytes(16).toString('hex'));
  check('a wrong secret is refused', wrong.status === 401, JSON.stringify(wrong.body));

  const first = await ticketFor(deviceA);
  check(
    'the saved secret gets a ticket (the secret, this address and the clock all match)',
    first.status === 200 && typeof first.body.ticket === 'string',
    JSON.stringify(first.body)
  );
  if (first.status !== 200) throw new Error('no ticket');

  const a = await connect(first.body.ticket);
  check('the ticket opens a connection', a.open);
  const again = await connect(first.body.ticket);
  check('the same ticket does not open a second one', !again.open);

  const b = await connect((await ticketFor(deviceB)).body.ticket);
  check('a second device connects', b.open);
  await wait(500);
  check(
    'the first device is told the second came online',
    a.got.some(text => text.includes('"presence"') && text.includes(deviceB))
  );

  const envelope = JSON.stringify({ v: 1, kind: 'msg', from: deviceA, to: deviceB, body: 'hi' });
  a.socket.send(envelope);
  await wait(800);
  check('a message from the first reaches the second, unchanged', b.got.includes(envelope));

  a.socket.send('ping');
  await wait(500);
  check('a ping is answered', a.got.includes('pong'));

  const list = await fetch(address + '/remote/presence', { headers: proof('presence', deviceA) });
  const devices = (await list.json()).devices || [];
  check(
    'the relay lists both devices as connected',
    devices.filter(device => device.online).length >= 2,
    'listed ' + devices.length
  );

  a.socket.close();
  b.socket.close();
  await wait(1500);

  // Clean up: each made-up device removes its own record, so the Devices page of the user's
  // computers does not list "Computer · check-…" afterwards.
  for (const device of [deviceA, deviceB]) {
    const removed = await fetch(address + '/remote/forget?d=' + device, {
      method: 'POST',
      headers: proof('forget:' + device, device),
    });
    check('the made-up device ' + device + ' is removed again', removed.status === 200);
  }
} catch (error) {
  check('the check ran to its end', false, error.message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
