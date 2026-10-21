// Technically Not tools · account-lows-test.js — The Lows of the 2026-10-07 audit's app-2 report
// that live in the CLI accounts and sign-in helpers: one account change at a time (#7), no removal
// while an agent runs on the account and a clear message when a delete stops half way (#6), a
// malformed accounts file or a built-in object name as an id (#12), and the response size cap of
// the sign-in fetch (#10). Plain Node, a throwaway folder, no window. Run: node
// tools/account-lows-test.js
'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-account-lows-'));
const userData = path.join(scratch, 'userData');
fs.mkdirSync(userData, { recursive: true });

// Codex's default home is a scratch folder, so nothing touches the real CLI folders.
process.env.CODEX_HOME = path.join(scratch, 'codex-home');

// Electron stand-in: the user folder and an "encryption" that only marks the text.
const electronStub = {
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: text => Buffer.from('enc:' + text),
    decryptString: buffer => String(buffer).replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
Module._load = (request, ...rest) =>
  request === 'electron' ? electronStub : originalLoad(request, ...rest);
const accounts = require('../desktop/account-service');
const apiKeys = require('../desktop/api-keys');
const jwt = require('../desktop/auth-jwt');
Module._load = originalLoad;

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const accountsFile = path.join(userData, 'accounts.json');
const codexAccounts = async () =>
  (await accounts.list()).find(c => c.agentId === 'Codex').accounts.filter(a => !a.isDefault);

async function attempt(work) {
  try {
    return { value: await work() };
  } catch (error) {
    return { error };
  }
}

// A fetch stand-in whose body arrives in 64 KB pieces; `read` counts the pieces taken.
function fakeResponse({ pieces, statedLength }) {
  const piece = new Uint8Array(64 * 1024).fill(32);
  const counter = { read: 0, cancelled: false };
  let index = 0;
  const reader = {
    async read() {
      if (index >= pieces) return { done: true, value: undefined };
      index++;
      counter.read++;
      return { done: false, value: piece };
    },
    async cancel() {
      counter.cancelled = true;
    },
  };
  const response = {
    status: 200,
    ok: true,
    headers: new Map(statedLength ? [['content-length', String(statedLength)]] : []),
    body: { getReader: () => reader },
    async text() {
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += Buffer.from(value).toString('utf8');
      }
    },
  };
  return { response, counter };
}

async function main() {
  // ---- #12: a malformed file and built-in names never throw ----
  // written as text: a `__proto__` key in an object literal would set its prototype instead
  fs.writeFileSync(
    accountsFile,
    '{"Codex": {"active": ""}, "__proto__": {"accounts": "not a list"}, "constructor": 5}'
  );
  const shape = await attempt(() => [
    accounts.isKey('Codex', 'acct-1'),
    accounts.dirFor('Codex', 'acct-1'),
    accounts.isKey('__proto__', 'acct-1'),
    accounts.dirFor('constructor', 'acct-1'),
  ]);
  check('#12 an entry without an accounts list does not throw', !shape.error, String(shape.error));
  check(
    '#12 nothing is found for it',
    shape.value && shape.value.join('|') === 'false||false|',
    shape.value
  );
  check('#12 no key for "__proto__" (no key file)', apiKeys.info('__proto__') === null);
  apiKeys.set('acct-real', 'Codex', 'sk-' + 'x'.repeat(30));
  check('#12 no key for "__proto__" (with a key file)', apiKeys.info('__proto__') === null);
  check('#12 no key for "constructor"', apiKeys.info('constructor') === null);
  check('#12 a real key is still found', apiKeys.info('acct-real')?.last4 === 'xxxx');
  apiKeys.remove('acct-real');

  // ---- #7: changes at the same moment all land ----
  fs.rmSync(accountsFile, { force: true });
  const [first, second, third] = await Promise.all([
    accounts.add('Codex', 'One'),
    accounts.add('Codex', 'Two'),
    accounts.add('Codex', 'Three'),
  ]);
  let listed = await codexAccounts();
  check(
    '#7 three adds at once: all three are listed',
    listed.length === 3 && [first, second, third].every(a => listed.some(x => x.id === a.id)),
    listed.map(a => a.label)
  );
  await Promise.all([
    accounts.rename('Codex', first.id, 'Renamed'),
    accounts.setActive('Codex', second.id),
    accounts.add('Codex', 'Four'),
  ]);
  listed = await codexAccounts();
  const state = JSON.parse(fs.readFileSync(accountsFile, 'utf8')).Codex;
  check(
    '#7 rename, switch and add at once: every change kept',
    listed.length === 4 &&
      listed.find(a => a.id === first.id)?.label === 'Renamed' &&
      state.active === second.id,
    { labels: listed.map(a => a.label), active: state.active }
  );

  // ---- #6: no removal while an agent runs on the account ----
  const busy = await attempt(() =>
    accounts.remove('Codex', third.id, { inUse: (agentId, id) => id === third.id })
  );
  check(
    '#6 removal refused while an agent runs on it',
    /agent is running/i.test(busy.error?.message)
  );
  check(
    '#6 the refused account is still listed with its folder',
    (await codexAccounts()).some(a => a.id === third.id) && fs.existsSync(third.dir)
  );

  // A delete that stops half way: the account stays listed, its conversations are shared again and
  // the message says what is left.
  const fsPromises = require('fs/promises');
  const realRm = fsPromises.rm;
  fsPromises.rm = async () => {
    const error = new Error('busy');
    error.code = 'EBUSY';
    throw error;
  };
  const half = await attempt(() => accounts.remove('Codex', third.id, { inUse: () => false }));
  fsPromises.rm = realRm;
  check(
    '#6 a failed delete says so',
    /still listed/i.test(half.error?.message),
    half.error?.message
  );
  check(
    '#6 the account stays listed after a failed delete',
    (await codexAccounts()).some(a => a.id === third.id)
  );
  check(
    '#6 its conversations are shared again',
    fs.lstatSync(path.join(third.dir, 'sessions')).isSymbolicLink()
  );
  const done = await attempt(() => accounts.remove('Codex', third.id, { inUse: () => false }));
  check('#6 removing again works', done.value?.removed === true, done.error?.message);

  // ---- #10: the sign-in fetch stops at its cap ----
  const small = await jwt.fetchJson('https://example.test/x', {}, async () => {
    const body = Buffer.from(JSON.stringify({ ok: 1 }));
    return {
      status: 200,
      ok: true,
      headers: new Map([['content-length', String(body.length)]]),
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () =>
              sent ? { done: true } : ((sent = true), { done: false, value: body }),
            cancel: async () => {},
          };
        },
      },
      text: async () => body.toString(),
    };
  });
  check('#10 a small answer is read', small.body?.ok === 1, small.body);
  const stated = fakeResponse({ pieces: 2, statedLength: 600 * 1024 });
  const statedResult = await attempt(() =>
    jwt.fetchJson('https://example.test/x', {}, async () => stated.response)
  );
  check(
    '#10 a stated length over the cap is refused before reading',
    /too large/i.test(statedResult.error?.message) && stated.counter.read === 0,
    { error: statedResult.error?.message, read: stated.counter.read }
  );
  const endless = fakeResponse({ pieces: 200 });
  const endlessResult = await attempt(() =>
    jwt.fetchJson('https://example.test/x', {}, async () => endless.response)
  );
  check(
    '#10 a long answer stops at the cap (9 pieces of 64 KB at most)',
    /too large/i.test(endlessResult.error?.message) && endless.counter.read <= 9,
    { error: endlessResult.error?.message, read: endless.counter.read }
  );
  check(
    '#10 the unused verifier, key cache and signer are gone',
    !('verifyIdToken' in jwt) && !('jwksCache' in jwt) && !('signEs256' in jwt)
  );
}

main()
  .catch(error => {
    failed++;
    console.log('FAIL crashed: ' + (error?.stack || error));
  })
  .finally(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
