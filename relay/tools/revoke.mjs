// Technically Not relay · revoke.mjs — throws one device out of your deployed relay without a new
// secret (a computer that was lost or stolen), or lets it in again:
//   npm run revoke -- https://your-relay.example.workers.dev DEVICE-ID
//   npm run revoke -- https://your-relay.example.workers.dev DEVICE-ID undo
// The device id is the whole id; the Devices page shows its first 8 characters, and
// `npm run clean-up` lists every id. A phone id throws out that phone, and ends the shared phone
// key of older phone pages (the lost phone may hold it).
// It does not stop anyone holding the secret itself; the tool says so each time (README,
// "When you still need a new secret"). Only the secret itself can do this: the key a computer keeps
// cannot, so a stolen computer cannot throw out the others. It reads the secret from the file
// `npm run setup-secret` saved and never prints it.
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const address = (process.argv[2] || '').replace(/\/+$/, '');
const device = process.argv[3] || '';
const undo = process.argv[4] === 'undo';
if (!/^https:\/\/[^/]+$/.test(address) || !/^[A-Za-z0-9_-]{8,64}$/.test(device)) {
  console.log(
    'Give the relay address and the device id, for example: npm run revoke -- https://my-relay.example.com 3f2a9c1e-...'
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

// The proof names what it does and the device it does it to, so it does nothing else. The id in
// the headers is this tool's own; the relay keeps no record of it.
const what = (undo ? 'unrevoke:' : 'revoke:') + device;
const asker = 'relay-owner';

async function send(time) {
  const answer = await fetch(
    address + '/remote/revoke?d=' + encodeURIComponent(device) + (undo ? '&undo=1' : ''),
    {
      method: 'POST',
      headers: {
        'X-Relay-Device': asker,
        'X-Relay-Time': String(time),
        'X-Relay-Proof': createHmac('sha256', secret)
          .update(`proof:${what}:${host}:${asker}:${time}`)
          .digest('hex'),
      },
    }
  );
  return { answer, body: await answer.json().catch(() => ({})) };
}

// The relay keeps the time of the newest revoke for all devices together, so one sent from a
// clock that was ahead blocks the next for up to two minutes. It says that time: try once more
// just after it (as the app does for its own proofs).
let { answer, body } = await send(Date.now());
if (answer.status === 401 && body.error === 'proof_used' && Number.isSafeInteger(body.after))
  ({ answer, body } = await send(Math.max(Date.now(), body.after + 1)));

// What a revoke does not cover, said every time, so nobody takes "thrown out" for more than it is.
const STILL_IN =
  'A revoke stops the key that device keeps. It does not stop anyone who has the secret itself: ' +
  'the computer you set the relay up from (it keeps the secret in a file), a computer still on an ' +
  'app older than per-device keys, and one whose Devices page said its id was good for this run ' +
  'only. If the lost device is one of those, set a new secret (npm run setup-secret, then enter it ' +
  'on your computers).';
const phone = device.startsWith('ph-');
if (answer.status === 200 && undo)
  console.log(
    'Let in again: ' +
      device +
      (phone ? ' (the shared phone key of older phone pages stays ended)' : '')
  );
else if (answer.status === 200 && phone) {
  // each phone keeps its own key now, so one phone goes alone; the shared key of older phone
  // pages ends with it, since the lost phone may hold that one (relay/src/hub.js revoke)
  console.log('Thrown out: ' + device + ' (it is disconnected now)');
  console.log(
    'The shared phone key of older phone pages no longer works either, as the lost phone may ' +
      'hold it. A phone that still used it shows "Your relay refused the secret": open its relay ' +
      'card, press Change and type the secret again. Your computers stay, and so do phones that ' +
      'already keep their own key.'
  );
} else if (answer.status === 200) {
  console.log('Thrown out: ' + device + ' (it is disconnected now)');
  console.log(STILL_IN);
} else if (answer.status === 404)
  console.log('This relay does not know revoke yet. Deploy it again first: npm run deploy');
else console.log('The relay said no: ' + answer.status + ' ' + (body.error || ''));
process.exit(answer.status === 200 ? 0 : 1);
