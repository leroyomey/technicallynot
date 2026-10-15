// Technically Not relay · tools/smoke.mjs — the relay on the real Workers runtime, on this
// computer: node relay/tools/smoke.mjs (about half a minute, opens no window).
//
// test/run.mjs runs the relay's code on a stand-in for Cloudflare. This starts the same code with
// `wrangler dev` (the real runtime, local, nothing deployed, no Cloudflare sign-in) and talks to
// it the way the app does: the app's own desktop/own-relay.js makes the proofs and takes the
// tickets, and two real WebSockets connect with them.
//
// Nothing is written in the project: the relay's files are copied to the system's temp folder,
// and the test secret (.dev.vars) is written into that copy only. The Worker is stopped at the
// end, whatever happened, and the copy is removed.
//
// Wrangler: WRANGLER_JS=<path to wrangler's bin/wrangler.js>, else `npx wrangler`.
// Port: RELAY_SMOKE_PORT, else 8797.
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const relayFolder = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// the app's side, the real file
const { createOwnRelay } = require('../../desktop/own-relay.js');

const PORT = Number(process.env.RELAY_SMOKE_PORT) || 8797;
const SECRET = crypto.randomBytes(32).toString('base64url');
const WRONG_SECRET = crypto.randomBytes(32).toString('base64url');
const DEVICE_A = 'smoke-a-' + crypto.randomUUID();
const DEVICE_B = 'smoke-b-' + crypto.randomUUID();

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else failed++;
  console.log(
    (ok ? 'ok   ' : 'FAIL ') +
      name +
      (ok || got === undefined ? '' : '  got ' + JSON.stringify(got))
  );
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(what, fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out: ' + what);
    await sleep(50);
  }
}

// ---- the local Worker ----

// A copy of the relay outside the project, with a test secret of its own.
function scratchCopy() {
  const folder = mkdtempSync(join(os.tmpdir(), 'tnai-relay-smoke-'));
  cpSync(join(relayFolder, 'src'), join(folder, 'src'), { recursive: true });
  for (const file of ['wrangler.toml', 'package.json'])
    cpSync(join(relayFolder, file), join(folder, file));
  writeFileSync(
    join(folder, '.dev.vars'),
    '# Test-only value for `wrangler dev` (relay/tools/smoke.mjs). Never a real secret.\n' +
      'RELAY_SECRET=' +
      SECRET +
      '\n'
  );
  return folder;
}

function startWorker(folder) {
  const wranglerJs = process.env.WRANGLER_JS;
  const args = ['dev', '--port', String(PORT), '--ip', '127.0.0.1'];
  const [command, commandArgs] = wranglerJs
    ? [process.execPath, [wranglerJs, ...args]]
    : ['npx', ['wrangler', ...args]];

  // CI=1: wrangler asks nothing and opens no browser
  const child = spawn(command, commandArgs, {
    cwd: folder,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    shell: !wranglerJs,
  });
  const worker = { child, log: '' };
  child.stdout.on('data', text => {
    worker.log += text;
  });
  child.stderr.on('data', text => {
    worker.log += text;
  });
  return worker;
}

// The whole process tree: wrangler starts the runtime as a child of its own.
function stopWorker(worker) {
  if (!worker || worker.child.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(worker.child.pid), '/T', '/F']);
  else worker.child.kill('SIGTERM');
}

// The address wrangler printed ("Ready on http://127.0.0.1:8797"), which is the one the app is
// given; null until it was printed.
function printedAddress(log) {
  const found = /Ready on (https?:\/\/[^\s]+)/.exec(log.replace(/\u001b\[[0-9;]*m/g, ''));
  return found ? found[1].replace(/\/+$/, '') : null;
}

// ---- the app's side ----

// own-relay.js with a file that lives in memory: nothing is stored on this computer.
function appSide(address, secret, fetchWith = fetch) {
  let text = null;
  const relay = createOwnRelay({
    backend: {
      available: () => true,
      encrypt: buffer => buffer,
      decrypt: buffer => buffer,
      read: () => text,
      write(value) {
        text = value;
      },
    },
    fetch: fetchWith,
  });
  const saved = relay.set(address, secret);
  if (!saved.ok) throw new Error('own-relay.js refused the local address: ' + saved.error);
  return relay;
}

// What a promise rejected with, or null.
async function refusal(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// A real WebSocket and everything it received, in order.
function connect(socketAddress, ticket) {
  const socket = new WebSocket(
    socketAddress + '/remote/connect?ticket=' + encodeURIComponent(ticket)
  );
  const link = { socket, got: [], opened: false, closed: null };
  socket.addEventListener('open', () => {
    link.opened = true;
  });
  socket.addEventListener('message', event => {
    link.got.push(String(event.data));
  });
  socket.addEventListener('close', event => {
    link.closed = { code: event.code, reason: event.reason };
  });
  socket.addEventListener('error', () => {
    link.closed = link.closed || { code: 0, reason: 'error' };
  });

  // the first received message that parses and passes `test`
  link.find = test =>
    link.got
      .map(text => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })
      .find(message => message && test(message));
  return link;
}

// A connect call with a ticket, as a plain HTTP upgrade request, so a refusal's status and code
// can be read (a WebSocket only says "failed").
function connectRefusal(address, ticket) {
  return new Promise(resolve => {
    const request = http.request(address + '/remote/connect?ticket=' + encodeURIComponent(ticket), {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      },
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve({ status: 101, error: '' });
    });
    request.on('response', response => {
      let body = '';
      response.on('data', text => {
        body += text;
      });
      response.on('end', () => {
        let error = '';
        try {
          error = JSON.parse(body).error;
        } catch {
          /* no relay answer */
        }
        resolve({ status: response.statusCode, error });
      });
    });
    request.on('error', () => resolve({ status: 0, error: 'network' }));
    request.end();
  });
}

// ---- the run ----

async function run(worker) {
  const address = await until(
    'wrangler dev prints its address',
    () => printedAddress(worker.log),
    90000
  );
  await until(
    'the Worker answers',
    async () => {
      try {
        return (await fetch(address + '/')).ok;
      } catch {
        return false;
      }
    },
    30000
  );
  console.log('The local Worker runs at ' + address + ' (the address wrangler dev printed).');
  const socketAddress = address.replace(/^http/, 'ws');
  const host = new URL(address).host;

  const front = await (await fetch(address + '/')).json();
  check(
    'the front door says only that it is a relay',
    front.relay === 'technically-not' && front.v === 1,
    front
  );

  // tickets for two devices, by the app's own module
  const app = appSide(address, SECRET);
  check('the app would connect to the printed address', app.wsUrl() === socketAddress, app.wsUrl());
  const ticketA = await app.ticket(DEVICE_A);
  const ticketB = await app.ticket(DEVICE_B);
  check(
    'the app gets a ticket for two device ids, so the host in the proof matches on the real runtime (' +
      host +
      ')',
    typeof ticketA === 'string' && typeof ticketB === 'string' && ticketA !== ticketB
  );

  // The same proof text with another host in it is refused: the calls go to the same Worker, but
  // the app believes the relay is at another port, so the host it hashes differs from the one the
  // runtime sees.
  const elsewhere = 'http://127.0.0.1:' + (PORT + 1);
  const misled = appSide(elsewhere, SECRET, (target, options) =>
    fetch(String(target).replace(elsewhere, address), options)
  );
  const wrongHost = await refusal(misled.ticket(DEVICE_A));
  check(
    'a proof made for another host is refused as invalid_proof (the host is really in the hash)',
    wrongHost?.status === 401 && wrongHost?.code === 'invalid_proof',
    wrongHost
  );

  // a wrong secret
  const stranger = appSide(address, WRONG_SECRET);
  const wrongSecret = await refusal(stranger.ticket(DEVICE_A));
  check(
    'a wrong secret gets no ticket: 401 invalid_proof',
    wrongSecret?.status === 401 && wrongSecret?.code === 'invalid_proof',
    wrongSecret
  );
  check(
    'a wrong secret reads no device list (the app shows an empty one)',
    (await stranger.devices(DEVICE_A)).length === 0
  );

  // two real sockets
  const linkA = connect(socketAddress, ticketA);
  await until('A is greeted', () => linkA.find(m => m.kind === 'hello'));
  const helloA = linkA.find(m => m.kind === 'hello');
  check(
    'A connects with its ticket and is greeted with nobody online',
    linkA.opened && helloA.device === DEVICE_A && helloA.online.length === 0,
    helloA
  );
  const linkB = connect(socketAddress, ticketB);
  await until('B is greeted', () => linkB.find(m => m.kind === 'hello'));
  const helloB = linkB.find(m => m.kind === 'hello');
  check(
    'B connects and is told A is online',
    helloB.device === DEVICE_B && helloB.online.length === 1 && helloB.online[0] === DEVICE_A,
    helloB
  );
  const seenB = await until('A is told B came online', () =>
    linkA.find(m => m.kind === 'presence' && m.device === DEVICE_B)
  );
  check('A is told that B came online', seenB.online === true, seenB);

  // one envelope from A to B, passed as sent
  const envelope = JSON.stringify({
    v: 1,
    kind: 'msg',
    from: DEVICE_A,
    to: DEVICE_B,
    body: 'sealed-' + crypto.randomUUID(),
  });
  linkA.socket.send(envelope);
  await until('B receives the envelope', () => linkB.got.includes(envelope));
  check('an envelope from A reaches B unchanged', linkB.got.includes(envelope));
  check('the envelope is not sent back to A', !linkA.got.includes(envelope));

  // a sender that names another device as itself
  linkB.socket.send(
    JSON.stringify({ v: 1, kind: 'msg', from: DEVICE_A, to: DEVICE_A, body: 'forged' })
  );
  const forged = await until('B is told its envelope is invalid', () =>
    linkB.find(m => m.kind === 'err' && m.code === 'invalid')
  );
  check(
    "an envelope under another device's id is refused and passed to nobody",
    !!forged && !linkA.got.some(t => t.includes('forged'))
  );

  // the automatic answer that costs no wake-up of the meeting point
  linkA.socket.send('ping');
  await until('"ping" is answered', () => linkA.got.includes('pong'));
  check(
    '"ping" is answered "pong" by the runtime, and B hears nothing of it',
    linkA.got.includes('pong') && !linkB.got.includes('pong') && !linkB.got.includes('ping')
  );

  // presence, read by the app's module
  const listed = await app.devices(DEVICE_A);
  const ids = listed.map(device => device.id).sort();
  check(
    'the device list the app reads names both devices and nothing else',
    ids.length === 2 && ids.includes(DEVICE_A) && ids.includes(DEVICE_B),
    ids
  );

  // a ticket works once
  const again = await connectRefusal(address, ticketA);
  check(
    'a second use of a ticket is refused: 401 ticket_used',
    again.status === 401 && again.error === 'ticket_used',
    again
  );
  const secondSocket = connect(socketAddress, ticketA);
  await until('the second socket with a used ticket ends', () => secondSocket.closed, 8000);
  check(
    'a WebSocket with a used ticket does not open, and A stays connected',
    !secondSocket.opened && linkA.socket.readyState === 1,
    {
      opened: secondSocket.opened,
      stateOfA: linkA.socket.readyState,
    }
  );
  const madeUp = await connectRefusal(address, 'not-a-ticket');
  check(
    'a made-up ticket is refused: 401 invalid_ticket',
    madeUp.status === 401 && madeUp.error === 'invalid_ticket',
    madeUp
  );

  // leaving
  linkB.socket.close(1000, 'done');
  const leftB = await until('A is told B left', () =>
    linkA.find(m => m.kind === 'presence' && m.device === DEVICE_B && m.online === false)
  );
  check(
    'A is told that B went offline, with when it was last seen',
    Number.isFinite(leftB.last_seen),
    leftB
  );

  // Remove (the Devices page's button on an unpaired computer), through the app's module: a
  // connected device stays, one that left is removed from the list
  const stays = await app.forget(DEVICE_B, DEVICE_A);
  check('a connected device is not removed: online', stays.error === 'online', stays);
  const removed = await app.forget(DEVICE_A, DEVICE_B);
  const after = (await app.devices(DEVICE_A)).map(device => device.id);
  check(
    'a device that left is removed and the list no longer names it',
    removed.ok === true && !after.includes(DEVICE_B) && after.includes(DEVICE_A),
    { removed, after }
  );
  linkA.socket.close(1000, 'done');
  await until('both sockets are closed', () => linkA.closed && linkB.closed);
}

let worker = null;
let folder = null;
let error = null;
try {
  folder = scratchCopy();
  worker = startWorker(folder);

  // also when this program is ended from outside
  process.on('exit', () => stopWorker(worker));
  await run(worker);
} catch (e) {
  error = e;
  failed++;
  console.log('ERROR ' + (e?.stack || e));
  if (worker)
    console.log(
      '--- last lines of wrangler dev ---\n' + worker.log.split('\n').slice(-25).join('\n')
    );
} finally {
  stopWorker(worker);

  // gone when nothing answers at the port any more
  let stopped = false;
  try {
    stopped = await until(
      'the Worker is gone',
      async () => {
        try {
          await fetch('http://127.0.0.1:' + PORT + '/', { signal: AbortSignal.timeout(1000) });
          return false;
        } catch {
          return true;
        }
      },
      10000
    );
  } catch {
    stopped = false;
  }
  check('the Worker is stopped: nothing answers at port ' + PORT + ' any more', stopped);

  // the copy holds the test secret and the runtime's local storage; the runtime can hold a file a
  // moment longer on Windows
  for (let attempt = 0; folder && attempt < 20; attempt++) {
    try {
      rmSync(folder, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }
}
console.log(`${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed || error ? 1 : 0);
