/*
 * Technically Not tools · stage-auth-config.js — Runs before `npm run dist` (predist): writes
 * build-resources/auth-config.json (git-ignored), which electron-builder ships as
 * resources\auth-config.json, and build-resources/build-info.json { release: true } (the release
 * flag, desktop/build-info.js).
 *
 * What auth-config.json holds depends on package.json `tnaiAccountsUrl`:
 * - empty (accounts switched off, the free app): {} and nothing else. No sign-in client value is
 *   read from this computer or shipped, because the app has nothing to sign in to.
 * - an address: the Google and GitHub sign-in client settings (env vars, else
 *   %APPDATA%\TechnicallyNot.ai\auth-config.json, the same order user-auth.js reads), so installed
 *   copies can sign in. Only the keys user-auth.js reads are copied.
 *
 * The file is always written, so the build never fails on it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KEYS = {
  googleClientId: ['TNAI_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID'],
  googleClientSecret: ['TNAI_GOOGLE_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'],
  githubClientId: ['TNAI_GITHUB_CLIENT_ID'],
};

// Pure: the sign-in settings a build ships. accountsUrl is package.json `tnaiAccountsUrl`, env the
// environment variables, user the settings file of this computer (already read).
function signInSettings(accountsUrl, env, user) {
  const config = {};
  if (!String(accountsUrl || '').trim()) return config;
  for (const [key, names] of Object.entries(KEYS)) {
    const name = names.find(n => env[n]);
    const value = String(name ? env[name] : (user[key] ?? '')).trim();
    if (value) config[key] = value;
  }
  return config;
}

function main() {
  const accountsUrl = require('../package.json').tnaiAccountsUrl;
  const accountsOff = !String(accountsUrl || '').trim();
  const source = path.join(process.env.APPDATA || '', 'TechnicallyNot.ai', 'auth-config.json');
  const out = path.join(__dirname, '..', 'build-resources', 'auth-config.json');

  // Accounts switched off: this computer's sign-in settings are not even read.
  let user = {};
  if (!accountsOff)
    try {
      user = JSON.parse(fs.readFileSync(source, 'utf8')) || {};
    } catch {}
  const config = signInSettings(accountsUrl, process.env, user);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n');

  // The release flag (desktop/build-info.js), shipped as resources/build-info.json: the installed
  // app ignores TNAI_* developer overrides and keeps DevTools closed even if its exe is renamed
  // (app.isPackaged false). Runs from source never read it.
  fs.writeFileSync(
    path.join(path.dirname(out), 'build-info.json'),
    JSON.stringify({ release: true }) + '\n'
  );
  console.log('build-info: release flag → build-resources/build-info.json');
  if (accountsOff)
    console.log(
      'auth-config: accounts are switched off (package.json tnaiAccountsUrl is empty), no sign-in settings shipped → build-resources/auth-config.json'
    );
  else {
    console.log(
      'auth-config: ' +
        (Object.keys(config).length ? Object.keys(config).join(', ') : 'nothing set') +
        ' → build-resources/auth-config.json'
    );
    if (!(config.googleClientId && config.googleClientSecret))
      console.warn(
        'auth-config: WARNING — no Google client ID + secret found (env vars or ' +
          source +
          '); installed copies will have Google sign-in disabled.'
      );
    if (!config.githubClientId)
      console.warn(
        'auth-config: WARNING — no GitHub client ID found (TNAI_GITHUB_CLIENT_ID or ' +
          source +
          '); installed copies will have GitHub sign-in disabled.'
      );
  }

  // Open-source notices shipped as resources/THIRD-PARTY-NOTICES.txt (Settings → Updates opens
  // it).
  require('./third-party-notices');
}

if (require.main === module) main();

module.exports = { signInSettings };
