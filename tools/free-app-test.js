// Test of the free app's account side: node tools/free-app-test.js (plain Node, no window).
// The app ships with accounts switched off (package.json `tnaiAccountsUrl` is empty). This runs
// the real desktop/user-auth.js and desktop/agent-registry.js with stand-ins for Electron and the
// network, and the real src/scripts/34-user-auth.js with a stand-in page, and checks:
//   1. the setting itself, and that nothing locks;
//   2. no call leaves for an accounts server, whatever is pressed;
//   3. a sign-in saved by an earlier version is removed at start and never read;
//   4. Claude Code's model list is the one built into the app, not one saved from the server;
//   5. the top-bar sign-in control is hidden in the desktop app, and only there;
//   6. the community total is gone: no sender, no bridge, no switch;
//   7. a build stages no sign-in client values.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- Stand-ins ----------

// A settings folder of its own, holding what an earlier version left behind.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-free-app-'));
const savedSignIn = path.join(userData, 'tnai-account.bin');
const savedCommunity = path.join(userData, 'tnai-community.json');
const savedModels = path.join(userData, 'claude-models.json');
const SAVED_ACCOUNT = { token: 'apptok-made-up', user: { id: 'user-1', email: 'a@example.com' } };
fs.writeFileSync(savedSignIn, Buffer.from(JSON.stringify(SAVED_ACCOUNT)).toString('base64'));
fs.writeFileSync(savedCommunity, JSON.stringify({ enabled: true, device: 'made-up-device-id' }));
fs.writeFileSync(
  savedModels,
  JSON.stringify({
    at: Date.now(),
    models: [{ id: 'claude-saved-from-server', label: 'Saved', group: 'Saved' }],
  })
);

// Electron: "encryption" that is easy to see through, with a count of every read of a saved file.
let decrypts = 0;
const opened = [];
const electron = {
  app: {
    isPackaged: false,
    getPath: () => userData,
    getVersion: () => '0.0.0',
    whenReady: () => Promise.resolve(),
    on: () => {},
  },
  shell: {
    openExternal: async url => {
      opened.push(String(url));
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: buffer => {
      decrypts++;
      return buffer.toString('utf8');
    },
    encryptString: text => Buffer.from(text),
  },
  clipboard: { writeText: () => {} },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? electron : realLoad.call(this, request, ...rest);
};

// The network: every call is written down and fails.
const calls = [];
global.fetch = async url => {
  calls.push(String(url));
  throw new Error('no network in this test');
};

// A copy run from source listens to these; the test must see what package.json alone gives.
for (const name of [
  'TNAI_ACCOUNTS_URL',
  'TNAI_ENFORCE_PLAN',
  'TNAI_DEV_UNLOCK',
  'TNAI_SELFTEST',
  'TNAI_GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
  'TNAI_GITHUB_CLIENT_ID',
])
  delete process.env[name];

// The window's side of the bridge: the handlers user-auth.js registers, called by channel name.
const handlers = new Map();
const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);

// ---------- A page for src/scripts/34-user-auth.js ----------

function element() {
  return {
    className: '',
    id: '',
    hidden: false,
    innerHTML: '',
    dataset: {},
    classList: { toggle: () => {} },
    append: () => {},
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    setAttribute: () => {},
    focus: () => {},
  };
}

// Runs the script in a page whose bridge answers `authState` (null: a browser, no bridge). Gives
// back the control it put in the top bar, as it was before the first answer and after it.
async function topBarControl(authState) {
  const appended = [];
  const top = element();
  top.append = child => appended.push(child);
  const auth = authState && {
    state: async () => ({ ok: true, value: authState }),
    onChange: () => {},
    onNotice: () => {},
    onLapse: () => {},
    onRefused: () => {},
  };
  const window = {
    tnaiNative: auth ? { auth } : undefined,
    TnaiIcon: () => '<svg></svg>',
    addEventListener: () => {},
    dispatchEvent: () => {},
    toast: () => {},
  };
  const document = {
    body: element(),
    activeElement: null,
    querySelector: selector => (selector === '.top-right' ? top : null),
    createElement: () => element(),
    addEventListener: () => {},
  };
  const context = {
    window,
    document,
    console,
    setTimeout,
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { reload: () => {} },
    CustomEvent: function () {},
    CSS: { escape: String },
  };
  vm.runInNewContext(read('src/scripts/34-user-auth.js'), context);
  const control = appended.find(child => child.id === 'tnaiUser');
  const before = { hidden: control.hidden, html: control.innerHTML };
  await window.TnaiAuth.ready();
  return { before, after: { hidden: control.hidden, html: control.innerHTML } };
}

const PAGE_STATE = {
  available: false,
  reason: '',
  google: { available: false, reason: '' },
  github: { available: false, reason: '' },
  signedIn: false,
  user: null,
  plan: null,
  lock: { enforced: false, locked: false },
  checking: false,
  problem: '',
  flow: null,
};

// ---------- The checks ----------

async function run() {
  // 1. The setting, and that nothing locks.
  const pkg = JSON.parse(read('package.json'));
  check('package.json names no accounts server', pkg.tnaiAccountsUrl === '', pkg.tnaiAccountsUrl);
  check('package.json does not enforce a plan', pkg.tnaiEnforcePlan === false, pkg.tnaiEnforcePlan);

  const userAuth = require('../desktop/user-auth.js');
  const sent = [];
  userAuth.init(
    ipcMain,
    (channel, payload) => sent.push([channel, payload]),
    () => null
  );
  await wait(100);

  const state = userAuth.publicState();
  check('the desktop process says accounts are off', state.off === true, state.off);
  check('nobody is signed in', state.signedIn === false && state.user === null, state.user);
  check('nothing locks', state.lock.locked === false && state.lock.enforced === false, state.lock);
  check('a new panel may start', userAuth.gate().ok === true, userAuth.gate());
  check('every bridge call is let through', userAuth.gateCached().ok === true);

  // 2. No call leaves for an accounts server.
  check('there is no accounts server address', userAuth.apiBase() === '', userAuth.apiBase());
  check('there is no app token', userAuth.appToken() === null);
  check(
    'a call for another module is not sent',
    (await userAuth.accountCall('POST', '/remote/ticket')) === null
  );
  const email = await invoke('auth:signInEmail', { email: 'a@example.com', password: 'made-up' });
  check(
    'sign-in with email is refused as not set up',
    email.ok === false && email.error.code === 'not-configured',
    email
  );
  const google = await invoke('auth:signIn', 'google', '');
  check('sign-in with Google is refused', google.ok === false, google);
  const github = await invoke('auth:signIn', 'github', '');
  check('sign-in with GitHub is refused', github.ok === false, github);
  const checked = await invoke('auth:check');
  check(
    'a plan check does nothing',
    checked.ok === true && checked.value.signedIn === false,
    checked
  );
  check('no browser was opened', opened.length === 0, opened);

  // 3. The saved sign-in.
  check('the saved sign-in file is removed at start', !fs.existsSync(savedSignIn));
  check('the saved sign-in is never read', decrypts === 0, decrypts);
  check('the community file is removed at start', !fs.existsSync(savedCommunity));

  // 4. Claude Code's model list.
  const registry = require('../desktop/agent-registry.js');
  const first = (await registry.models('Claude Code')).models.map(model => model.id);
  await wait(100);
  const later = (await registry.models('Claude Code')).models.map(model => model.id);
  check('the model list has the built-in models', first.includes('claude-opus-5-5'), first);
  check(
    'a list saved from the server is not used',
    !first.includes('claude-saved-from-server') && !later.includes('claude-saved-from-server'),
    later
  );

  check('no network call was made at all', calls.length === 0, calls);

  // 5. The top-bar control.
  const off = await topBarControl({ ...PAGE_STATE, off: true });
  check(
    'desktop, accounts off: the control is hidden before the first answer',
    off.before.hidden === true && off.before.html === '',
    off.before
  );
  check(
    'desktop, accounts off: the control stays hidden and empty',
    off.after.hidden === true && off.after.html === '',
    off.after
  );
  const on = await topBarControl({ ...PAGE_STATE, off: false, available: true });
  check(
    'desktop, accounts on: the sign-in button shows',
    on.after.hidden === false && on.after.html.includes('tnai-user-signin'),
    on.after
  );
  const browser = await topBarControl(null);
  check(
    'in a browser the control is as before',
    browser.after.hidden === false && browser.after.html.includes('tnai-user-signin'),
    browser.after
  );
  check(
    'the hidden control takes no room (its style says display: none)',
    /\.tnai-user\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(
      read('src/styles/14-settings-preview-purple.css')
    )
  );

  // 6. The community total.
  check(
    'the community sender is gone',
    !fs.existsSync(path.join(root, 'desktop', 'community-usage.js'))
  );
  for (const file of ['desktop/main.js', 'desktop/preload.js', 'src/scripts/59-usage-stats.js'])
    check(file + ' has nothing of the community total', !/community/i.test(read(file)));

  // 7. What a build stages.
  const { signInSettings } = require('./stage-auth-config.js');
  const env = { TNAI_GOOGLE_CLIENT_ID: 'made-up-id', TNAI_GOOGLE_CLIENT_SECRET: 'made-up-secret' };
  const user = { githubClientId: 'made-up-github-id' };
  check(
    'accounts off: a build stages no sign-in values',
    JSON.stringify(signInSettings('', env, user)) === '{}',
    signInSettings('', env, user)
  );
  check(
    'accounts on: a build stages the three values',
    Object.keys(signInSettings('https://accounts.example.com', env, user)).length === 3
  );

  fs.rmSync(userData, { recursive: true, force: true });
  console.log(failed ? 'FAILED ' + failed + ' of ' + (passed + failed) : 'PASS ' + passed);
  process.exit(failed ? 1 : 0);
}

run().catch(error => {
  console.log('FAIL the test stopped: ' + (error.stack || error));
  process.exit(1);
});
