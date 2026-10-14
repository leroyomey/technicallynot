/*
 * Technically Not desktop · api-keys.js — The user's own provider API keys.
 * Each key belongs to one API-key account (account-service.js) and is
 * kept encrypted by the OS through Electron safeStorage (Windows DPAPI, macOS Keychain, Linux
 * libsecret/KWallet) in userData/api-keys.bin. Saving is refused when the OS can't encrypt (Linux
 * with no keyring: backend basic_text). The key leaves this file only as an environment variable of
 * that account's own agent process (pty-service.js) and as the CLI's own approval of it (last 20
 * characters, Claude Code's customApiKeyResponses, account-service.js). The renderer only ever gets
 * { last4, addedAt, ok }. Never log a key.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'api-keys.bin');

// Why keys can't be kept on this computer, or '' when they can.
function unavailable() {
  try {
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : '';
    if (safeStorage.isEncryptionAvailable() && backend !== 'basic_text') return '';
  } catch {}
  return process.platform === 'linux'
    ? 'This computer has no secure keyring, so Technically Not can’t keep an API key safely. Install GNOME Keyring or KWallet, or set the key yourself as an environment variable before starting Technically Not.'
    : process.platform === 'darwin'
      ? 'The macOS Keychain isn’t available, so Technically Not can’t keep an API key safely.'
      : 'Windows secure storage isn’t available, so Technically Not can’t keep an API key safely on this PC.';
}

// { keys: { [accountId]: { agentId, key, addedAt } }, broken } — broken: the file exists but can't
// be decrypted (another Windows user, a password reset by an admin).
function load() {
  let raw;
  try {
    raw = fs.readFileSync(file(), 'utf8');
  } catch {
    return { keys: {}, broken: false };
  }
  try {
    const data = JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64')));
    return { keys: data && typeof data === 'object' ? data : {}, broken: false };
  } catch {
    return { keys: {}, broken: true };
  }
}

function save(keys) {
  const target = file(),
    tmp = target + '.' + process.pid + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(keys)).toString('base64'), {
    mode: 0o600,
  });
  fs.renameSync(tmp, target);
}

module.exports = {
  unavailable,
  // Masked facts about one account's key: null = no key saved for it; ok false = saved but
  // unreadable now (re-enter it).
  info(accountId) {
    const { keys, broken } = load(),
      k = keys[accountId];
    if (k) return { ok: true, last4: String(k.key).slice(-4), addedAt: k.addedAt || 0 };
    return broken ? { ok: false, last4: '', addedAt: 0 } : null;
  },
  set(accountId, agentId, key) {
    const why = unavailable();
    if (why) throw new Error(why);
    const { keys, broken } = load();

    // An unreadable file can't be merged; it only held keys this user can no longer use, so it is
    // replaced.
    save({ ...(broken ? {} : keys), [accountId]: { agentId, key, addedAt: Date.now() } });
  },
  remove(accountId) {
    const { keys, broken } = load();
    if (broken || !keys[accountId]) return;
    delete keys[accountId];
    if (Object.keys(keys).length) save(keys);
    else fs.rmSync(file(), { force: true });
  },
  // Main process only: the key itself, for the account's agent process environment. '' when none or
  // unreadable.
  keyFor(accountId, agentId) {
    const k = accountId && load().keys[accountId];
    return k && k.agentId === agentId ? k.key : '';
  },
};
