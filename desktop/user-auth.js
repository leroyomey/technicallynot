/*
 * Technically Not desktop · user-auth.js — The Technically Not account (accounts server,
 * package.json `tnaiAccountsUrl`). Sign-in: "Continue with Google" (OAuth code + PKCE S256 + state
 * + nonce in the system browser, 127.0.0.1 loopback redirect; the Google ID token goes to POST
 * /auth/exchange, which verifies it), "Continue with GitHub" (OAuth App code + PKCE S256 + state,
 * same loopback; the code and verifier go to POST /auth/exchange, which swaps them with GitHub's
 * client secret on the server) or email + password (POST /auth/login). Each returns an app token
 * (180 days, rotated through /auth/refresh), kept encrypted with Electron safeStorage in
 * userData/tnai-account.bin together with the last valid signed plan pass (plan-pass.js). The pass
 * is fetched at start, every 12 h, on window focus after 1 h, and on a check; its exp is read on a
 * clock that only moves forward. Nothing locks: the app has no plan lock. Tokens never leave the
 * main process; the renderer gets public state over IPC `auth:*`. Computers: every app sign-in
 * sends `device_id` (random, made once, userData/tnai-device.json, kept across sign-out) and
 * `device_name` ("<host> · Windows"). Over the account's computer limit the server answers 409
 * device_limit with the list and a one-time ticket (kept here, never sent to the renderer); the
 * user picks one to sign out and POST /auth/device-replace finishes the sign-in.
 *
 * Accounts switched off: a build whose package.json `tnaiAccountsUrl` is empty (the free app) has
 * no accounts server. Then nothing here contacts a server, public state carries `off: true` (the
 * window hides its sign-in control), and a sign-in saved by an earlier version is removed at start
 * without being read. Test: node tools/free-app-test.js.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, shell, safeStorage, clipboard } = require('electron');
const jwt = require('./auth-jwt');
const loopback = require('./auth-loopback');
const planPass = require('./plan-pass');
const buildInfo = require('./build-info');
const pkg = require('../package.json');

// Release build (build-info.js: code loaded from an app.asar, package.json tnaiRelease, or
// resources/build-info.json): every TNAI_* developer override is ignored, even when app.isPackaged
// is false (a renamed exe). The self-test hooks exist only in a copy run from source.
let release = buildInfo.release;
const SELFTEST = !!process.env.TNAI_SELFTEST && !buildInfo.release;
const devCopy = () => !app.isPackaged && !release;
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;
const HOUR = 3600e3,
  DAY = 24 * HOUR;
const CHECK_EVERY_MS = 12 * HOUR,
  FOCUS_AFTER_MS = HOUR,
  ROTATE_AFTER_MS = 7 * DAY,
  VERSION_EVERY_MS = 20e3;
const SITE = 'https://technicallynot.ai';
const SITE_PAGES = {
  pricing: '/pricing',
  subscribe: '/pricing',
  account: '/account',
  signup: '/signin',
};
const SETUP = 'see docs/AUTH_SETUP.md';

let send = () => {},
  getWindow = () => null;

// Windows: start the default browser's own program (https UserChoice ProgId → its
// shell\open\command) with the URL as one argument, no shell. Opening an https URL through the
// shell (shell.openExternal) can report success without starting any browser; on the developer's PC
// (default Edge) nothing opened and sign-in sat on "Waiting for Google…" until it timed out
// (2026-09-26). Fallback: shell.openExternal.
function windowsBrowserCommand() {
  const { execFileSync } = require('child_process');
  const query = (key, value) => {
    try {
      return execFileSync('reg', ['query', key, ...(value ? ['/v', value] : ['/ve'])], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
    } catch {
      return '';
    }
  };
  const progId = /ProgId\s+REG_SZ\s+(\S+)/.exec(
    query(
      'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
      'ProgId'
    )
  )?.[1];
  const command =
    progId &&
    /REG_(?:EXPAND_)?SZ\s+(.+)/
      .exec(query('HKCR\\' + progId + '\\shell\\open\\command'))?.[1]
      ?.trim();
  const parts = command && command.match(/"[^"]*"|\S+/g)?.map(x => x.replace(/^"|"$/g, ''));
  if (
    !parts ||
    !/\.exe$/i.test(parts[0]) ||
    !parts.slice(1).includes('%1') ||
    !fs.existsSync(parts[0])
  )
    return null;
  return { exe: parts[0], args: parts.slice(1) };
}

// Windows: the browsers registered under StartMenuInternet (HKCU and HKLM), for "Open sign-in in".
// id = the registry subkey name, which the renderer sends back; only an id found here again is ever
// started, so the renderer never names a program path. Read without blocking the main process (a
// sync reg query stalled the sign-in loopback), cached for a minute.
let browserList = null;

function windowsBrowsers() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (browserList && browserList.at > Date.now() - 60e3) return browserList.list;
  const { execFile } = require('child_process');
  const query = root =>
    new Promise(resolve =>
      execFile(
        'reg',
        ['query', root + '\\Software\\Clients\\StartMenuInternet', '/s'],
        { encoding: 'utf8', windowsHide: true, timeout: 3000 },
        (error, out) => resolve(error ? '' : out)
      )
    );
  const list = Promise.all([query('HKCU'), query('HKLM')]).then(parseBrowsers);
  browserList = { at: Date.now(), list };
  return list;
}

function parseBrowsers(outs) {
  const found = new Map();
  for (const out of outs) {
    let key = '';
    for (const line of out.split(/\r?\n/)) {
      if (/^HKEY_/.test(line)) {
        key = line.trim();
        continue;
      }

      // the default value; its label is localized
      const value = /^\s+\([^)]*\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line)?.[1]?.trim();
      const m = /\\StartMenuInternet\\([^\\]+)(\\shell\\open\\command)?$/i.exec(key);
      if (!value || !m) continue;
      const id = m[1],
        entry = found.get(id.toLowerCase()) || { id, name: id, exe: '' };
      if (m[2]) entry.exe = value.match(/"[^"]*"|\S+/)?.[0]?.replace(/^"|"$/g, '') || '';
      else entry.name = value;
      found.set(id.toLowerCase(), entry);
    }
  }
  return [...found.values()]
    .filter(b => /\.exe$/i.test(b.exe) && fs.existsSync(b.exe))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function startBrowser(exe, url) {
  const child = require('child_process').spawn(exe, [url], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}

// Sign-in links go to the browser the user picked in the sign-in dialog (id from
// windowsBrowsers()), else the default browser.
async function signInBrowser(url, browserId) {
  const pick =
    browserId && process.platform === 'win32' && /^https:\/\//.test(url)
      ? (await windowsBrowsers()).find(b => b.id.toLowerCase() === String(browserId).toLowerCase())
      : null;
  if (pick) {
    try {
      return await startBrowser(pick.exe, url);
    } catch {
      /* fall back to the default browser */
    }
  }
  return openBrowser(url);
}

async function defaultOpenBrowser(url) {
  const command =
    process.platform === 'win32' && /^https:\/\//.test(url) ? windowsBrowserCommand() : null;
  if (command) {
    try {
      const child = require('child_process').spawn(
        command.exe,
        command.args.map(a => (a === '%1' ? url : a)),
        { detached: true, stdio: 'ignore' }
      );
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      return;
    } catch {
      /* fall back to the shell */
    }
  }
  await shell.openExternal(url);
}
let openBrowser = defaultOpenBrowser;
const discoveryCache = new Map();
let flow = null; // { provider: 'google'|'github'|'email'|'device', cancel }

// over the computer limit: { ticket, ids } until a computer is picked, the sign-in is cancelled or
// another one starts
let pendingDevice = null;
let device = null; // { id, name } of this install

// undefined = not read yet, null = signed out, else { token, rotatedAt, user, pass, checkedAt }
let account;
let checking = null,
  busy = false,
  lastCheck = 0,
  problem = null; // problem: { code, message } from the last check
let checkTimer = null,
  expiryTimer = null,
  clockTimer = null,
  writing = Promise.resolve();
let versionAt = 0; // last GET /entitlements/version (focus probe, VERSION_EVERY_MS apart)

const fail = (code, message) => Object.assign(new Error(message), { code, tnai: true });

// ---------- Configuration ----------
// Accounts URL: package.json (build time). From source (npm start, self-tests) TNAI_ACCOUNTS_URL
// overrides it, and TNAI_PASS_TEST_KEY (SPKI base64) verifies passes from a local server's
// throwaway key; an installed or release build ignores both. Google client: env >
// userData/auth-config.json > resources/auth-config.json.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

function config() {
  const dev = devCopy();
  const env = name =>
    dev && process.env[name] !== undefined ? String(process.env[name]).trim() : undefined;
  const shipped = !dev ? readJson(path.join(process.resourcesPath, 'auth-config.json')) : {};
  const user = readJson(path.join(app.getPath('userData'), 'auth-config.json'));
  const pick = (envNames, key) => {
    for (const name of envNames) if (process.env[name]) return String(process.env[name]).trim();
    return String(user[key] ?? shipped[key] ?? '').trim();
  };
  const c = {
    apiUrl: (env('TNAI_ACCOUNTS_URL') ?? String(pkg.tnaiAccountsUrl || '')).replace(/\/+$/, ''),
    googleClientId: pick(['TNAI_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID'], 'googleClientId'),
    googleClientSecret: pick(
      ['TNAI_GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'],
      'googleClientSecret'
    ),
    githubClientId: pick(['TNAI_GITHUB_CLIENT_ID'], 'githubClientId'),
    githubAuthorize: GITHUB_AUTHORIZE,
    googleIssuer: GOOGLE_ISSUER,
    googleIssuers: [GOOGLE_ISSUER, 'accounts.google.com'],
    timeoutMs: FLOW_TIMEOUT_MS,
    insecureOk: false,
    publicKey: (dev && process.env.TNAI_PASS_TEST_KEY) || planPass.PUBLIC_KEY,
  };

  // Test-only endpoints and key (tools/desktop-check), honored only in a self-test run; never in
  // normal use.
  if (SELFTEST && !release) {
    if (process.env.TNAI_AUTH_TEST_ISSUER) {
      c.googleIssuer = process.env.TNAI_AUTH_TEST_ISSUER;
      c.googleIssuers = [c.googleIssuer];
      c.insecureOk = true;
    }
    if (process.env.TNAI_AUTH_TEST_GITHUB) {
      c.githubAuthorize = process.env.TNAI_AUTH_TEST_GITHUB + '/login/oauth/authorize';
      c.insecureOk = true;
    }
    if (Number(process.env.TNAI_AUTH_TEST_TIMEOUT_MS) > 0)
      c.timeoutMs = Number(process.env.TNAI_AUTH_TEST_TIMEOUT_MS);
  }
  return c;
}
const isLoopbackHost = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);

// HTTPS everywhere; plain http only for localhost while developing from source (or in a self-test).
function urlProblem(url, what, c) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return what + ' isn’t a valid URL — ' + SETUP + '.';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname) && (devCopy() || c.insecureOk))
    return null;
  return (
    what + ' must use HTTPS (http is allowed only for localhost while developing) — ' + SETUP + '.'
  );
}
const apiProblem = c =>
  !c.apiUrl
    ? 'This build has no Technically Not accounts server set up — ' + SETUP + '.'
    : urlProblem(c.apiUrl, 'The accounts server URL', c);
const googleProblem = c =>
  !c.googleClientId
    ? 'Google sign-in isn’t set up in this build: add a Google OAuth client ID — ' + SETUP + '.'
    : !c.googleClientSecret
      ? 'Google sign-in isn’t set up in this build: add the client secret of the Google “Desktop app” client — ' +
        SETUP +
        '.'
      : null;
const githubProblem = c =>
  !c.githubClientId
    ? 'GitHub sign-in isn’t set up in this build: add the GitHub OAuth App client ID — ' +
      SETUP +
      '.'
    : urlProblem(c.githubAuthorize, 'GitHub’s sign-in page', c);

// ---------- Account on disk (encrypted, one write in flight) ----------
const accountFile = () => path.join(app.getPath('userData'), 'tnai-account.bin');

// Accounts are switched off when the build names no accounts server (package.json
// `tnaiAccountsUrl` is empty). Then nobody can be signed in: the saved sign-in is never read, and
// init() removes its file.
const accountsOff = (c = config()) => !c.apiUrl;

function load() {
  if (accountsOff()) return null;
  if (account !== undefined) return account;
  account = null;
  try {
    const a = JSON.parse(
      safeStorage.decryptString(Buffer.from(fs.readFileSync(accountFile(), 'utf8'), 'base64'))
    );
    if (typeof a?.token === 'string' && a.token && a.user?.id) account = a;
  } catch {}
  return account;
}

function save() {
  const snapshot = account ? JSON.stringify(account) : null;
  writing = writing.then(async () => {
    const file = accountFile();
    if (!snapshot) {
      await fs.promises.rm(file, { force: true }).catch(() => {});
      return;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw fail(
        'storage',
        process.platform === 'win32'
          ? 'Windows secure storage isn’t available, so Technically Not can’t keep a sign-in safely on this PC.'
          : process.platform === 'darwin'
            ? 'The macOS keychain isn’t available, so Technically Not can’t keep a sign-in safely on this Mac.'
            : 'No system keyring (GNOME Keyring or KWallet) is available, so Technically Not can’t keep a sign-in safely on this computer.'
      );
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(tmp, safeStorage.encryptString(snapshot).toString('base64'), {
      mode: 0o600,
    });
    await fs.promises.rename(tmp, file);
  });
  return writing;
}

// Quitting can't wait for the async write above, so the last high-water mark is written
// synchronously (best effort).
function saveSync() {
  try {
    if (!account || !safeStorage.isEncryptionAvailable()) return;
    const file = accountFile(),
      tmp = file + '.' + process.pid + '.quit.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(account)).toString('base64'), {
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
  } catch {}
}

// Linux without GNOME Keyring or KWallet: Electron selects the 'basic_text' backend and reports
// encryption as unavailable, which would make sign-in impossible there. Accept it (the file is then
// encrypted with Chromium's built-in key, as Chromium itself does on such systems). The pass is
// signed by the server either way, so it can't be forged. Windows (DPAPI) and macOS (Keychain) are
// unchanged.
let weakStorage = false;

function linuxStorage() {
  if (process.platform !== 'linux' || safeStorage.isEncryptionAvailable()) return;
  const backend =
    typeof safeStorage.getSelectedStorageBackend === 'function'
      ? safeStorage.getSelectedStorageBackend()
      : '';
  if (backend !== 'basic_text' || typeof safeStorage.setUsePlainTextEncryption !== 'function')
    return;
  safeStorage.setUsePlainTextEncryption(true);
  weakStorage = true; // shown as a one-line notice in the account menu (34)
  console.log(
    '[tnai auth] No system keyring (GNOME Keyring or KWallet) found: the sign-in is kept with basic_text encryption on this computer.'
  );
}
const publicUser = u => ({
  id: String(u?.id || ''),
  name: typeof u?.name === 'string' ? u.name.slice(0, 200) : '',
  email: typeof u?.email === 'string' ? u.email.slice(0, 254) : '',
  providers: Array.isArray(u?.providers)
    ? u.providers.filter(p => typeof p === 'string').slice(0, 5)
    : [],
});

// ---------- This computer (not secret; outside the encrypted account file, so signing out keeps
// it) ----------
const deviceFile = () => path.join(app.getPath('userData'), 'tnai-device.json');

function thisDevice() {
  if (device) return device;
  let id = readJson(deviceFile()).id;
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    id = crypto.randomUUID();
    try {
      fs.mkdirSync(path.dirname(deviceFile()), { recursive: true });
      fs.writeFileSync(deviceFile(), JSON.stringify({ id }) + '\n');
    } catch {} // unwritable: this run still uses it
  }
  const suffix =
    ' · ' +
    ({ win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[process.platform] || process.platform);
  let host = '';
  try {
    host = os.hostname().trim();
  } catch {}
  device = { id, name: (host || 'Computer').slice(0, 100 - suffix.length) + suffix };
  return device;
}
const deviceBody = () => ({ device_id: thisDevice().id, device_name: thisDevice().name });

// ---------- Clock that only moves forward ----------
// account.highWater (ms): the highest time seen (now, the signed pass's iat, the server's time),
// kept encrypted with the pass and raised on every check, every hour and on quit. The pass exp is
// checked against max(now, highWater), so setting the clock back never revives an old pass. A
// fresh pass from the server (newer iat) may lower it again, so a clock that was once set ahead
// recovers.
const clockNow = a => Math.max(Date.now(), a?.highWater || 0);

function raiseClock(a, ...times) {
  const hw = Math.max(
    a.highWater || 0,
    Date.now(),
    ...times.filter(t => Number.isFinite(t) && t > 0)
  );
  if (hw === a.highWater) return false;
  a.highWater = hw;
  return true;
}

// The server's time: `serverTime` in the body if it sends one (seconds or ms), else the HTTP Date
// header of the response.
function serverTimeOf(r) {
  const t = Number(r.body?.serverTime);
  return Math.max(t > 0 ? (t < 1e12 ? t * 1000 : t) : 0, r.date || 0);
}

function tickClock() {
  const a = load();
  if (!a) return;
  if (raiseClock(a)) save().catch(() => {});
}

// ---------- Plan pass ----------
function passState(c = config()) {
  const a = load();
  return a
    ? planPass.verify(a.pass, { publicKey: c.publicKey, sub: a.user.id, now: clockNow(a) / 1000 })
    : { ok: false, reason: 'signed-out' };
}

function publicState() {
  const c = config(),
    a = load(),
    v = passState(c),
    claims = v.claims || null,
    api = apiProblem(c),
    google = googleProblem(c),
    github = githubProblem(c);
  scheduleExpiry(v);
  return {
    // off: accounts are switched off in this build, so the window hides its sign-in control
    off: accountsOff(c),
    available: !api,
    reason: api || '',
    google: { available: !api && !google, reason: api || google || '' },
    github: { available: !api && !github, reason: api || github || '' },
    signedIn: !!a,
    user: a ? publicUser(a.user) : null,
    plan: claims
      ? {
          plan: claims.plan,
          status: claims.status,
          subscribed: claims.subscribed,
          founder: claims.founder === true,
          graceEnds: claims.graceEnds || null,
          expires: claims.exp,
          current: !!v.ok,
        }
      : null,
    checkedAt: a?.checkedAt || null,
    checking: busy,
    problem: problem?.message || '',
    flow: flow ? { provider: flow.provider } : null,
    weakStorage,
  };
}
const changed = () => send('auth:changed', publicState());

// When the pass reaches its exp the state changes by itself: one timer for
// that moment, no polling.
function scheduleExpiry(v) {
  clearTimeout(expiryTimer);
  expiryTimer = null;
  if (!v.ok) return;
  const ms = v.claims.exp * 1000 - clockNow(load()) + 500;
  if (ms > 0 && ms < 2 ** 31 - 1) expiryTimer = setTimeout(changed, ms);
}

// ---------- Accounts server ----------
async function api(method, route, { token, body, bare = false } = {}) {
  const c = config(),
    bad = apiProblem(c);
  if (bad) throw fail('not-configured', bad);
  let r;
  try {
    // The app's version rides on every call (header, and app_version on sign-ins): the server's
    // MIN_APP_VERSION refuses builds that are too old.
    r = await fetch(c.apiUrl + route, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: 'application/json',
        'X-TNAI-Version': app.getVersion(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body
        ? JSON.stringify(bare ? body : { ...body, app_version: app.getVersion() })
        : undefined,
    }); // bare: exactly the caller's body (the version still rides in the header)
  } catch {
    throw fail(
      'offline',
      'Couldn’t reach the Technically Not accounts server. Check your internet connection and try again.'
    );
  }
  let data = null;
  try {
    data = await r.json();
  } catch {}
  return {
    ok: r.ok,
    status: r.status,
    body: data && typeof data === 'object' ? data : {},
    date: Date.parse(r.headers.get('date') || '') || 0,
  };
}
const SERVER_MESSAGES = {
  invalid_credentials: 'That email and password don’t match a Technically Not account.',
  email_unverified:
    'Confirm your email first: open the link in the email Technically Not sent you, then sign in.',
  totp_required: 'Enter the 6-digit code from your authenticator app.',
  invalid_totp:
    'That code isn’t right. Enter the current 6-digit code from your authenticator app.',
  turnstile_required:
    'Too many tries from here. Sign in on technicallynot.ai once, then try again in the app.',
  turnstile_failed:
    'Too many tries from here. Sign in on technicallynot.ai once, then try again in the app.',
  apple_not_configured: 'Apple sign-in isn’t available yet.',
  github_not_configured:
    'GitHub sign-in isn’t set up on the Technically Not accounts server yet. Use Google or your email and password.',
  github_unreachable: 'The accounts server couldn’t reach GitHub. Try again in a minute.',
  github_code_invalid:
    'GitHub’s sign-in code expired or was already used. Start the sign-in again.',
  github_misconfigured:
    'GitHub sign-in is set up wrong on the accounts server (client ID, secret or callback don’t match). Nothing was changed.',
  github_failed: 'GitHub didn’t finish the sign-in. Try again.',
  invalid_ticket: 'That took too long. Sign in again.',
  unknown_device: 'That computer isn’t signed in to this account any more. Sign in again.',
  update_required:
    'This version of Technically Not is no longer supported. Install the latest update (or download it from technicallynot.ai) to keep building.',
  device_limit:
    'This account is signed in on too many computers. Sign out one on technicallynot.ai/account, then try again.',
};
const ERROR_CODES = {
  totp_required: 'totp-required',
  invalid_ticket: 'invalid-ticket',
  unknown_device: 'unknown-device',
};
const NOTICES = {
  github_no_verified_email:
    'Signed in with GitHub. Your GitHub account has no verified primary email, so it wasn’t joined to another Technically Not account with the same email.',
};

function serverError(r, what) {
  const code = String(r.body?.error || r.status)
    .replace(/[^\w.-]/g, '')
    .slice(0, 40);
  if (code === 'rate_limited') {
    const min = Math.max(1, Math.ceil(Number(r.body.retryAfter) / 60) || 15);
    return fail(
      'rate-limited',
      'Too many tries. Wait ' + min + ' minute' + (min === 1 ? '' : 's') + ' and try again.'
    );
  }
  return fail(
    ERROR_CODES[code] || 'server',
    SERVER_MESSAGES[code] || 'The accounts server refused the ' + what + ' (' + code + ').'
  );
}

// Fetch the plan pass (rotating the app token once a week) and keep it only when its signature
// checks out.
function check() {
  if (!load()) return Promise.resolve(publicState());
  if (checking) return checking.then(() => publicState());
  busy = true;
  changed();
  checking = (async () => {
    const a = account,
      c = config();
    try {
      const rotate = Date.now() - (a.rotatedAt || 0) > ROTATE_AFTER_MS;
      const r = rotate
        ? await api('POST', '/auth/refresh', { token: a.token })
        : await api('GET', '/entitlements', { token: a.token });
      if (account !== a) return;
      if (r.status === 401) {
        account = null;
        problem = null;
        await save();
        send('auth:notice', {
          message:
            'Your Technically Not sign-in ended (signed out elsewhere or expired). Sign in again.',
        });
        return;
      }

      // Below the server's MIN_APP_VERSION: the account names an update as required (the server's
      // switch for old builds).
      if (r.status === 426 && r.body?.error === 'update_required') {
        problem = { code: 'update-required', message: SERVER_MESSAGES.update_required };
        return;
      }
      if (!r.ok) {
        problem = {
          code: 'server',
          message:
            'The accounts server had a problem (' +
            String(r.body?.error || r.status)
              .replace(/[^\w.-]/g, '')
              .slice(0, 40) +
            '). Your last confirmed plan still counts until it expires.',
        };
        return;
      }
      if (rotate && typeof r.body.token === 'string' && r.body.token) {
        a.token = r.body.token;
        a.rotatedAt = Date.now();
      }

      // entitlement_version (item 6): the focus probe compares against it
      if (Number.isSafeInteger(r.body.version)) a.version = r.body.version;
      const server = serverTimeOf(r);
      const v = planPass.verify(r.body.pass, {
        publicKey: c.publicKey,
        sub: a.user.id,
        now: Math.max(clockNow(a), server) / 1000,
      });
      if (v.ok) {
        // A newer signed pass proves fresh contact with the server: the high-water mark restarts
        // from the server's time (never below it).
        const fresh =
          v.claims.iat >
          (planPass.verify(a.pass, { publicKey: c.publicKey, now: Infinity }).claims?.iat || 0);
        a.highWater = Math.max(
          fresh ? 0 : a.highWater || 0,
          Date.now(),
          server,
          v.claims.iat * 1000
        );
        a.pass = r.body.pass;
        a.checkedAt = Date.now();
        problem = null;
      } else
        problem = {
          code: 'invalid-pass',
          message:
            'Technically Not couldn’t verify the plan the server sent (' +
            v.reason +
            '), so it wasn’t used.',
        };
      await save();
    } catch (error) {
      problem =
        error.code === 'offline'
          ? { code: 'offline', message: 'Offline: couldn’t reach the accounts server.' }
          : {
              code: error.code || 'failed',
              message: error.tnai ? error.message : 'Checking your plan failed.',
            };
    } finally {
      if (account === a && raiseClock(a)) save().catch(() => {});
      lastCheck = Date.now();
      busy = false;
      checking = null;
      clearTimeout(checkTimer);
      checkTimer = account ? setTimeout(check, CHECK_EVERY_MS) : null;
      changed();
    }
  })();
  return checking.then(() => publicState());
}

function onFocus() {
  if (!load() || busy) return;
  if (Date.now() - lastCheck > FOCUS_AFTER_MS) check();
  else probeVersion();
}

// Faster lapse (subscription-enforcement.md item 6): a Stripe webhook that changes the plan bumps
// the account's entitlement_version on the server. On focus between full checks the app asks only
// for that number (at most every 20 s) and fetches a new pass when it moved, so a lapse or a
// renewal shows on the next focus instead of up to 12 h later. A server without the route (404) or
// offline changes nothing.
async function probeVersion() {
  const a = load();
  if (!a || !Number.isSafeInteger(a.version) || Date.now() - versionAt < VERSION_EVERY_MS) return;
  versionAt = Date.now();
  try {
    const r = await api('GET', '/entitlements/version', { token: a.token });
    if (
      account === a &&
      r.ok &&
      Number.isSafeInteger(r.body.version) &&
      r.body.version !== a.version &&
      !busy
    )
      check();
  } catch {}
}

// ---------- Sign-in ----------
async function discovery(c) {
  const hit = discoveryCache.get(c.googleIssuer);
  if (hit && hit.expires > Date.now()) return hit.doc;
  let r;
  try {
    r = await jwt.fetchJson(c.googleIssuer + '/.well-known/openid-configuration');
  } catch {
    throw fail('offline', 'Couldn’t reach Google. Check your internet connection and try again.');
  }
  const doc = r.body;
  if (!r.ok || !doc || !c.googleIssuers.includes(doc.issuer))
    throw fail('provider', 'Google’s sign-in configuration couldn’t be loaded.');
  for (const key of ['authorization_endpoint', 'token_endpoint'])
    if (typeof doc[key] !== 'string' || urlProblem(doc[key], 'Google endpoint', c))
      throw fail('provider', 'Google’s sign-in configuration is invalid.');
  discoveryCache.set(c.googleIssuer, { doc, expires: Date.now() + DAY });
  return doc;
}

// Google: Authorization Code + PKCE through the system browser and a loopback redirect → an ID
// token for the accounts server (which verifies it).
async function googleIdToken(c, active) {
  const doc = await discovery(c);
  const { verifier, challenge } = jwt.pkce(),
    state = jwt.random(),
    nonce = jwt.random();
  const receiver = await loopback.listen({ state, timeoutMs: c.timeoutMs });
  active.cancel = () => receiver.cancel();
  const url = new URL(doc.authorization_endpoint);
  Object.entries({
    client_id: c.googleClientId,
    redirect_uri: receiver.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).forEach(([k, v]) => url.searchParams.set(k, v));

  // "Copy sign-in link": the same link, for a browser other than the one that opened
  active.url = url.toString();
  try {
    await signInBrowser(active.url, active.browser);
  } catch {
    receiver.cancel();
    throw fail('browser', 'Technically Not couldn’t open your web browser.');
  }
  const query = await receiver.result;
  if (query.error)
    throw query.error === 'access_denied'
      ? fail('denied', 'Google sign-in was cancelled. Nothing was changed.')
      : fail(
          'provider',
          'Google reported a sign-in error (' +
            String(query.error)
              .replace(/[^\w.-]/g, '')
              .slice(0, 40) +
            ').'
        );
  if (!query.code) throw fail('provider', 'Google didn’t return a sign-in code.');
  let r;
  try {
    r = await jwt.fetchJson(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        client_id: c.googleClientId,
        client_secret: c.googleClientSecret,
        redirect_uri: receiver.redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
  } catch {
    throw fail('offline', 'Couldn’t reach Google. Check your internet connection and try again.');
  }
  if (!r.ok || typeof r.body?.id_token !== 'string')
    throw fail(
      'provider',
      'Google didn’t finish the sign-in (' +
        String(r.body?.error || r.status)
          .replace(/[^\w.-]/g, '')
          .slice(0, 40) +
        ').'
    );
  return { idToken: r.body.id_token, nonce };
}

// Over the computer limit (409 device_limit): no session yet. The ticket stays here; the renderer
// gets the list and picks one (replaceDevice).
function deviceLimit(r) {
  if (
    r.status !== 409 ||
    r.body?.error !== 'device_limit' ||
    typeof r.body.device_ticket !== 'string' ||
    !r.body.device_ticket ||
    !Array.isArray(r.body.devices)
  )
    return null;
  const devices = r.body.devices
    .slice(0, 50)
    .filter(d => d && (typeof d.id === 'string' || typeof d.id === 'number'))
    .map(d => ({
      id: String(d.id).slice(0, 200),
      name:
        typeof d.name === 'string' && d.name.trim()
          ? d.name.trim().slice(0, 100)
          : 'Unnamed computer',
      lastSeen: Number(d.last_seen) > 0 ? Number(d.last_seen) : 0,
    }));
  if (!devices.length) return null;
  pendingDevice = { ticket: r.body.device_ticket, ids: new Set(devices.map(d => d.id)) };
  return {
    status: 'device-limit',
    limit: Number(r.body.limit) > 0 ? Math.floor(Number(r.body.limit)) : devices.length,
    devices,
  };
}

// Google/GitHub on an account with an authenticator app (401 totp_required + ticket): no session
// yet. The ticket stays here; the renderer asks for the code and sends it with verifyCode.
let pendingTotp = null;

async function finishSignIn(r, what) {
  const limited = deviceLimit(r);
  if (limited) return limited;
  if (
    r.status === 401 &&
    r.body.error === 'totp_required' &&
    typeof r.body.totp_ticket === 'string' &&
    r.body.totp_ticket
  ) {
    pendingTotp = { ticket: r.body.totp_ticket, notice: r.body.notice };
    return { status: 'totp-required' };
  }
  if (!r.ok || typeof r.body.token !== 'string' || !r.body.token || !r.body.user?.id)
    throw serverError(r, what);
  pendingDevice = null;

  account = {
    token: r.body.token,
    rotatedAt: Date.now(),
    user: publicUser(r.body.user),
    pass: '',
    checkedAt: 0,
  };
  problem = null;
  lastCheck = 0;
  await save();
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
    win.setAlwaysOnTop(false);
  }
  await check();
  const notice = NOTICES[r.body.notice];
  return notice ? { status: 'signed-in', notice } : { status: 'signed-in' };
}

async function withFlow(provider, run, browser = '') {
  const c = config(),
    bad = apiProblem(c);
  if (bad) throw fail('not-configured', bad);
  if (flow) throw fail('busy', 'A sign-in is already running. Finish it or cancel it first.');
  const active = (flow = {
    provider,
    cancel: null,
    browser: typeof browser === 'string' ? browser.slice(0, 200) : '',
    url: '',
  });

  // a new sign-in drops an unused computer-limit ticket
  if (provider !== 'device') pendingDevice = null;
  if (provider !== 'totp') pendingTotp = null; // … and an unused authenticator-code ticket
  changed();
  try {
    return await run(c, active);
  } catch (error) {
    if (['cancelled', 'timeout', 'denied'].includes(error.code))
      return { status: 'cancelled', reason: error.code, message: error.message };
    throw error;
  } finally {
    if (flow === active) flow = null;
    changed();
  }
}
const signInGoogle = browser =>
  withFlow(
    'google',
    async (c, active) => {
      const bad = googleProblem(c);
      if (bad) throw fail('not-configured', bad);
      const { idToken, nonce } = await googleIdToken(c, active);
      if (flow !== active) throw fail('cancelled', 'Sign-in cancelled.');
      return finishSignIn(
        await api('POST', '/auth/exchange', {
          body: { provider: 'google', id_token: idToken, nonce, client: 'app', ...deviceBody() },
        }),
        'Google sign-in'
      );
    },
    browser
  );

// GitHub: code + PKCE through the system browser and the loopback redirect. GitHub's client secret
// is confidential, so the accounts server does the swap.
const signInGithub = browser =>
  withFlow(
    'github',
    async (c, active) => {
      const bad = githubProblem(c);
      if (bad) throw fail('not-configured', bad);
      const { verifier, challenge } = jwt.pkce(),
        state = jwt.random();
      const receiver = await loopback.listen({ state, timeoutMs: c.timeoutMs });
      active.cancel = () => receiver.cancel();
      const url = new URL(c.githubAuthorize);
      Object.entries({
        client_id: c.githubClientId,
        redirect_uri: receiver.redirectUri,
        scope: 'read:user user:email',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        allow_signup: 'true',
      }).forEach(([k, v]) => url.searchParams.set(k, v));
      active.url = url.toString();
      try {
        await signInBrowser(active.url, active.browser);
      } catch {
        receiver.cancel();
        throw fail('browser', 'Technically Not couldn’t open your web browser.');
      }
      const query = await receiver.result;
      if (query.error)
        throw query.error === 'access_denied'
          ? fail('denied', 'GitHub sign-in was cancelled. Nothing was changed.')
          : fail(
              'provider',
              'GitHub reported a sign-in error (' +
                String(query.error)
                  .replace(/[^\w.-]/g, '')
                  .slice(0, 40) +
                ').'
            );
      if (!query.code) throw fail('provider', 'GitHub didn’t return a sign-in code.');
      if (flow !== active) throw fail('cancelled', 'Sign-in cancelled.');
      return finishSignIn(
        await api('POST', '/auth/exchange', {
          body: {
            provider: 'github',
            code: query.code,
            code_verifier: verifier,
            redirect_uri: receiver.redirectUri,
            client: 'app',
            ...deviceBody(),
          },
        }),
        'GitHub sign-in'
      );
    },
    browser
  );

function signInEmail(input) {
  const email = typeof input?.email === 'string' ? input.email.trim() : '',
    password = typeof input?.password === 'string' ? input.password : '';
  const totp = typeof input?.totp === 'string' ? input.totp.replace(/\s+/g, '') : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email))
    throw fail('invalid', 'Enter the email of your Technically Not account.');
  if (!password || password.length > 256) throw fail('invalid', 'Enter your password.');
  if (totp && !/^\d{6}$/.test(totp))
    throw fail('invalid', 'The code is the 6 digits from your authenticator app.');
  return withFlow('email', async () =>
    finishSignIn(
      await api('POST', '/auth/login', {
        body: { email, password, ...(totp ? { totp } : {}), client: 'app', ...deviceBody() },
      }),
      'sign-in'
    )
  );
}

// Finish a Google/GitHub sign-in with the authenticator code (6 digits) or a recovery code. A wrong
// code keeps the ticket for another try.
function verifyCode(input) {
  const pick = pendingTotp;
  if (!pick) throw fail('invalid-ticket', SERVER_MESSAGES.invalid_ticket);
  const code = typeof input === 'string' ? input.trim() : '';
  const digits = code.replace(/\s+/g, '');
  if (!code || code.length > 64)
    throw fail(
      'invalid',
      'Enter the 6-digit code from your authenticator app, or a recovery code.'
    );
  const factor = /^\d{6}$/.test(digits) ? { totp: digits } : { recoveryCode: code };
  return withFlow('totp', async () => {
    const r = await api('POST', '/auth/totp/verify', {
      body: { totp_ticket: pick.ticket, ...factor, client: 'app', ...deviceBody() },
    });
    if (pendingTotp === pick && (r.ok || r.body?.error === 'invalid_ticket' || r.status === 409))
      pendingTotp = null; // used or expired
    const result = await finishSignIn(r, 'sign-in');
    const notice = NOTICES[pick.notice];
    return result?.status === 'signed-in' && notice && !result.notice
      ? { ...result, notice }
      : result;
  });
}

// Over the computer limit: sign out the picked computer and finish this sign-in (same answer as a
// normal app sign-in).
function replaceDevice(deviceId) {
  const pick = pendingDevice;
  if (!pick) throw fail('invalid-ticket', SERVER_MESSAGES.invalid_ticket);
  if (typeof deviceId !== 'string' || !pick.ids.has(deviceId))
    throw fail('invalid', 'Pick one of the computers in the list.');
  return withFlow('device', async () => {
    const r = await api('POST', '/auth/device-replace', {
      body: { device_ticket: pick.ticket, replace_device: deviceId, ...deviceBody() },
    });
    if (pendingDevice === pick && (r.ok || r.status === 400 || r.status === 401))
      pendingDevice = null; // used, expired or refused: a new sign-in is needed
    return finishSignIn(r, 'sign-in');
  });
}

async function signOut() {
  const a = load();
  account = null;
  problem = null;
  lastCheck = 0;

  clearTimeout(checkTimer);
  checkTimer = null;
  await save();
  changed();
  let revoked = !a;
  if (a)
    revoked = await api('POST', '/auth/logout', { token: a.token }).then(
      r => r.ok,
      () => false
    );
  return { status: 'signed-out', revoked };
}

// ---------- Website (Subscribe / Manage / Create account) ----------
function siteUrlOk(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (
    u.protocol === 'https:' &&
    (u.hostname === 'technicallynot.ai' || u.hostname.endsWith('.technicallynot.ai'))
  )
    return true;
  return (
    ((SELFTEST && !release) || devCopy()) && u.protocol === 'http:' && isLoopbackHost(u.hostname)
  ); // a local website while developing from source
}

async function openSite(which) {
  const a = load();

  // Signed in: a one-time 60 s link so the website opens already signed in (POST /app/login-link →
  // account page, or checkout for Subscribe).
  if (a && (which === 'subscribe' || which === 'account')) {
    const r = await api('POST', '/app/login-link', {
      token: a.token,
      body: { next: which === 'subscribe' ? 'upgrade' : 'account' },
    }).catch(() => null);
    if (r?.ok && siteUrlOk(r.body.url)) {
      await openBrowser(r.body.url);
      return { opened: 'signed-in' };
    }
  }
  await openBrowser(SITE + SITE_PAGES[which]);
  return { opened: 'page' };
}

// ---------- IPC (validated) ----------
function init(ipcMain, sendToWindow, windowGetter) {
  send = sendToWindow;
  getWindow = windowGetter;
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error.tnai ? error.code : 'failed',
            message: error.tnai ? error.message : 'That didn’t work. Please try again.',
          },
        };
      }
    });
  handle('auth:state', () => publicState());
  handle('auth:signIn', (provider, browser) => {
    if (provider === 'github') return signInGithub(browser);
    if (provider !== 'google') throw fail('invalid', 'Unknown sign-in provider.');
    return signInGoogle(browser);
  });
  handle('auth:browsers', async () =>
    (await windowsBrowsers()).map(({ id, name }) => ({ id, name }))
  );

  // The running Google/GitHub sign-in link, for pasting into another browser. The loopback only
  // accepts it once, with its own state.
  handle('auth:copyLink', () => {
    if (!flow?.url) throw fail('no-link', 'There is no sign-in link yet. Start signing in first.');
    clipboard.writeText(flow.url);
    return true;
  });
  handle('auth:signInEmail', input => signInEmail(input));
  handle('auth:cancel', () => {
    flow?.cancel?.();
    if (!flow) {
      pendingDevice = null;
      pendingTotp = null;
    }
    return true;
  });
  handle('auth:replaceDevice', deviceId => replaceDevice(deviceId));
  handle('auth:verifyCode', code => verifyCode(code));
  handle('auth:signOut', () => signOut());
  handle('auth:check', () => check());
  handle('auth:open', which => {
    if (!Object.hasOwn(SITE_PAGES, which)) throw fail('invalid', 'Unknown page.');
    return openSite(which);
  });
  app
    .whenReady()
    .then(() => {
      // The earlier local-only sign-in (accounts kept on this PC, never on the server) is replaced
      // by the server account: its files go.
      // The community total is gone from the app; its file held the choice and a random id.
      const leftovers = ['tnai-users.json', 'tnai-session.bin', 'tnai-community.json'];

      // Accounts switched off: the sign-in an earlier version saved is of no use any more. It is
      // removed without a word and without being read.
      if (accountsOff()) leftovers.push(path.basename(accountFile()));
      for (const name of leftovers)
        fs.promises.rm(path.join(app.getPath('userData'), name), { force: true }).catch(() => {});
      linuxStorage();
      app.on('browser-window-focus', onFocus);
      clockTimer = setInterval(tickClock, HOUR);
      app.on('before-quit', event => {
        // the user cancelled the macOS quit question: the clock keeps running
        if (require('./quit-guard').cancelled(event)) return;
        clearInterval(clockTimer);
        const a = load();
        if (a && raiseClock(a)) saveSync();
      });
      if (load()) check();
      else changed();
    })
    .catch(() => {});
}

// A signed-in call to the accounts server for other main-process modules (own-relay-wiring.js),
// with the same token + headers as GET /entitlements; the token stays in this file. null (nothing
// sent) when the build has no accounts URL or nobody is signed in. Throws { code: 'offline' } when
// the server can't be reached; otherwise { ok, status, body }.
async function accountCall(method, route, body) {
  const c = config(),
    a = load();
  if (apiProblem(c) || !a) return null;
  const r = await api(method, route, { token: a.token, body, bare: true });
  return { ok: r.ok, status: r.status, body: r.body };
}

// For remote-service.js (several computers): this computer's id and default name, and the accounts
// server address ('' when this build has none).
const apiBase = () => {
  const c = config();
  return apiProblem(c) ? '' : c.apiUrl;
};
module.exports = {
  init,
  publicState,
  accountCall,
  thisDevice,
  apiBase,
};

// Self-test hooks (tools/desktop-check/tests/account-signin.main.js): swap the browser, simulate an
// app restart. Absent in normal use.
if (SELFTEST)
  module.exports._test = {
    setBrowser: fn => {
      openBrowser = fn || defaultOpenBrowser;
    },
    windowsBrowserCommand,
    restart: () => {
      versionAt = 0;
      account = undefined;
      device = null;
      pendingDevice = null;
      problem = null;
      lastCheck = 0;
      busy = false;
      checking = null;
      clearTimeout(checkTimer);
      discoveryCache.clear();
      return publicState();
    },
    accountFile,
    deviceFile,
    check,
    config,
    // Pretend this copy is a release build (resources/build-info.json), or move the high-water mark
    // (a PC clock set back = highWater ahead of now).
    setRelease: on => {
      release = !!on;
      return publicState();
    },
    setHighWater: async ms => {
      const a = load();
      if (a) {
        a.highWater = ms;
        await save();
      }
      return publicState();
    },
    highWater: () => load()?.highWater || 0,
    focus: () => {
      versionAt = 0;
      onFocus();
    },
    version: () => load()?.version ?? null, // focus: a window focus past the 20 s probe spacing
  };
