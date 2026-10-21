// Technically Not desktop · account-service.js — Several accounts per agent CLI: each extra account
// is its own CLI config folder (see agent-registry `home`). Technically Not creates the folder; the
// CLI's own sign-in writes into it. Technically Not never reads or stores tokens.
'use strict';
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const registry = require('./agent-registry');
const apiKeys = require('./api-keys');

const statePath = () => path.join(app.getPath('userData'), 'accounts.json');
const accountsRoot = () => path.join(app.getPath('userData'), 'agent-accounts');
const slug = id =>
  String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// The folder a CLI uses when Technically Not does not redirect it (the default account).
const DEFAULT_HOMES = {
  'Claude Code': () => path.join(os.homedir(), '.claude'),
  Codex: () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  // GEMINI_CLI_HOME stands in for the user folder (its config is <home>/.gemini), so its default
  // home is the user folder itself.
  'Gemini CLI': () => process.env.GEMINI_CLI_HOME || os.homedir(),
  'GitHub Copilot': () => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'),
};
const capability = agentId =>
  registry.capabilities().find(c => c.id === agentId && c.accounts && DEFAULT_HOMES[c.id]);

// State: { [agentId]: { active: accountId, accounts: [{ id, label, dir, createdAt }] } }. Read from
// disk on use so it always reflects what is saved. Only well-formed entries are kept, in an object
// with no prototype, so a hand-edited file or an id such as `__proto__` never throws on a panel
// start (audit 2026-10-07, app-2 #12).
function load() {
  const state = Object.create(null);
  let data = null;
  try {
    data = JSON.parse(fsSync.readFileSync(statePath(), 'utf8'));
  } catch {
    return state;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return state;
  for (const agentId of Object.keys(data)) {
    const value = data[agentId];
    if (!value || typeof value !== 'object' || !Array.isArray(value.accounts)) continue;
    state[agentId] = {
      ...value,
      active: typeof value.active === 'string' ? value.active : '',
      accounts: value.accounts.filter(
        account => account && typeof account === 'object' && typeof account.id === 'string'
      ),
    };
  }
  return state;
}

// Every change to accounts.json runs one at a time (app-2 #7): each reads the file, waits on
// folders and the CLI's config, then writes its whole copy back, so two at once lost one change and
// could leave an API key with no account.
let queue = Promise.resolve();

function serial(work) {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

// True while an agent panel runs on this account (pty-service.js knows each panel's account). Read
// when asked, as pty-service.js itself loads this file.
function accountInUse(agentId, accountId) {
  try {
    return require('./pty-service')
      .list()
      .some(s => s.running && s.agent === agentId && s.accountId === accountId);
  } catch {
    return false;
  }
}

async function save(state) {
  const file = statePath(),
    temp = file + '.' + process.pid + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(state, null, 1));
  await fs.rename(temp, file);
}
const entry = (state, agentId) => (state[agentId] ||= { active: '', accounts: [] });

// Shared subfolders (conversation transcripts) are junctions to the default home, so a session
// started on one account resumes on another.
async function linkShared(agentId, dir) {
  const cap = capability(agentId),
    home = DEFAULT_HOMES[agentId](),
    notes = [];
  for (const name of cap.shared) {
    const target = path.join(home, name),
      link = path.join(dir, name);
    try {
      await fs.mkdir(target, { recursive: true });

      // a nested shared folder (Gemini CLI's .gemini/tmp)
      await fs.mkdir(path.dirname(link), { recursive: true });
      await fs.symlink(target, link, 'junction');
    } catch (error) {
      notes.push(
        'Could not share ' +
          name +
          ' with the default account (' +
          error.code +
          '); conversations started here will not resume on other accounts.'
      );
    }
  }
  return notes.join(' ');
}

async function sharedState(agentId, dir) {
  const cap = capability(agentId),
    home = DEFAULT_HOMES[agentId]();
  return Promise.all(
    cap.shared.map(async name => {
      const link = path.join(dir, name);
      try {
        const st = await fs.lstat(link);
        const target = st.isSymbolicLink() ? await fs.readlink(link) : '';
        return {
          name,
          linked:
            !!target && path.resolve(target).toLowerCase() === path.join(home, name).toLowerCase(),
        };
      } catch {
        return { name, linked: false };
      }
    })
  );
}

// Title-case a plan id for display (max -> Max, chatgpt_plus -> Chatgpt Plus). Unknown strings
// still get title-cased.
const titleCase = value =>
  String(value || '')
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

// Decodes only the payload of a JWT (never the signature); returns null on anything malformed.
function jwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(
      Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    );
  } catch {
    return null;
  }
}

// The account's subscription plan, read straight from the CLI's own credential file (main process
// only; the token itself never leaves this function).
async function planFor(agentId, dir) {
  try {
    if (agentId === 'Claude Code') {
      const file = path.join(dir || DEFAULT_HOMES['Claude Code'](), '.credentials.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const value = data?.claudeAiOauth?.subscriptionType,
        tier = /max_?(5|20)x/i.exec(String(data?.claudeAiOauth?.rateLimitTier || ''));
      return typeof value === 'string' && value
        ? titleCase(value) + (tier && /max/i.test(value) ? ' ' + tier[1] + 'x' : '')
        : '';
    }
    if (agentId === 'Codex') {
      const file = path.join(dir || DEFAULT_HOMES.Codex(), 'auth.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      const value = jwtPayload(data?.tokens?.id_token)?.['https://api.openai.com/auth']
        ?.chatgpt_plan_type;
      return typeof value === 'string' && value ? titleCase(value) : '';
    }
  } catch {}
  return '';
}

// API-key accounts: { kind: 'api-key' } in accounts.json, the key itself
// in api-keys.js. The account's own folder is set up so the CLI runs on the key at once: Claude
// Code skips its first-run screens and its "use this API key?" question (it keeps the approved
// keys' last 20 characters in .claude.json, claude 2.1.283); Codex gets a provider whose env_key is
// the variable the key goes in (config.toml). one printable token: no spaces, line breaks or quotes
// that could leak into another variable
const KEY_SHAPE = /^[\x21-\x7e]{20,400}$/;

function checkKey(agentId, key) {
  const spec = registry.capabilities().find(c => c.id === agentId)?.apiKey;
  if (!spec) throw new Error(agentId + ' can’t run on an API key in Technically Not yet.');
  key = String(key || '').trim();
  if (!KEY_SHAPE.test(key))
    throw new Error('That doesn’t look like an API key. Paste the whole key, with no spaces.');
  if (spec.prefix && !key.startsWith(spec.prefix))
    throw new Error(
      spec.provider + ' API keys start with ' + spec.prefix + '. Check you copied the right key.'
    );
  return key;
}

async function prepareKeyHome(agentId, dir, key) {
  if (agentId === 'Claude Code') {
    const file = path.join(dir, '.claude.json');
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8')) || {};
    } catch {}
    const approved = new Set(data.customApiKeyResponses?.approved || []);
    approved.add(key.slice(-20));
    data.hasCompletedOnboarding = true;
    data.customApiKeyResponses = {
      approved: [...approved],
      rejected: (data.customApiKeyResponses?.rejected || []).filter(k => k !== key.slice(-20)),
    };
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
  if (agentId === 'Codex') {
    const env = registry.apiKeyEnv('Codex');
    await fs.writeFile(
      path.join(dir, 'config.toml'),
      [
        '# Technically Not API-key account: Codex reads the key from ' +
          env +
          ', set only for this account’s agent panels.',
        'model_provider = "tnai-openai"',
        '',
        '[model_providers.tnai-openai]',
        'name = "OpenAI"',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "' + env + '"',
        'wire_api = "responses"',
        '',
      ].join('\n')
    );
  }

  // Gemini CLI 0.61: the Gemini API key method picked ahead in the account's own settings.json, so
  // it starts on the key without its auth dialog.
  if (agentId === 'Gemini CLI') {
    const file = path.join(dir, '.gemini', 'settings.json');
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8')) || {};
    } catch {}
    data.security = {
      ...data.security,
      auth: { ...data.security?.auth, selectedType: 'gemini-api-key' },
    };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
}

const statusCache = new Map(); // agentId|dir -> detect result

async function status(agentId, dir, force, keyAccountId) {
  // An API-key account is ready when its key can be read; the CLI's own status command would only
  // say "not logged in".
  if (keyAccountId) {
    const key = apiKeys.info(keyAccountId),
      cli = await registry.detectAccount(agentId, null).catch(() => null);
    return {
      installed: cli ? cli.installed : true,
      loggedIn: !!key?.ok,
      email: '',
      method: 'API key',
      note: key?.ok ? '' : 'Key needs to be re-entered',
      plan: 'API key',
      apiKey: key?.ok ? { last4: key.last4, addedAt: key.addedAt } : null,
    };
  }
  const key = agentId + '|' + dir;
  if (!force && statusCache.has(key)) return statusCache.get(key);
  const [result, plan] = await Promise.all([
    registry.detectAccount(agentId, dir || null),
    planFor(agentId, dir),
  ]);
  const value = result
    ? {
        installed: result.installed,
        loggedIn: result.loggedIn,
        email: result.account || '',
        method: result.method || '',
        note: result.note || '',
        plan,
      }
    : null;
  statusCache.set(key, value);
  return value;
}

const accountService = {
  // accountId '' (or unknown) = the CLI's default home, i.e. the account it is signed in with
  // normally.
  isKey(agentId, accountId) {
    return (
      !!accountId &&
      entry(load(), agentId).accounts.some(a => a.id === accountId && a.kind === 'api-key')
    );
  },
  dirFor(agentId, accountId) {
    if (!accountId) return '';
    return entry(load(), agentId).accounts.find(a => a.id === accountId)?.dir || '';
  },
  // Every CLI with its accounts. `withStatus`: include sign-in state per account (runs each CLI's
  // status command; `force` skips the cache).
  async list({ withStatus = false, force = false } = {}) {
    const state = load();
    return Promise.all(
      registry.capabilities().map(async cap => {
        const supported = !!capability(cap.id),
          e = state[cap.id] || { active: '', accounts: [] };
        const accounts = [
          { id: '', label: 'Default account', dir: '', isDefault: true, createdAt: 0 },
          ...(supported ? e.accounts : []),
        ];
        await Promise.all(
          accounts.map(async a => {
            if (withStatus && supported)
              a.status = await status(cap.id, a.dir, force, a.kind === 'api-key' ? a.id : '');
            if (!a.isDefault) a.shared = await sharedState(cap.id, a.dir);
          })
        );
        return {
          agentId: cap.id,
          supported,
          home: cap.home,
          signIn: cap.signIn,
          apiKey:
            supported && cap.apiKey ? { ...cap.apiKey, unavailable: apiKeys.unavailable() } : null,
          active: supported && accounts.some(a => a.id === e.active) ? e.active : '',
          accounts,
        };
      })
    );
  },
  async add(agentId, label, key) {
    if (!capability(agentId))
      throw new Error(
        agentId +
          ' keeps one sign-in per PC, so Technically Not cannot add separate accounts for it.'
      );
    if (key !== undefined) {
      key = checkKey(agentId, key);
      const why = apiKeys.unavailable();
      if (why) throw new Error(why);
    }
    const state = load(),
      id = 'acct-' + crypto.randomUUID().slice(0, 8),
      dir = path.join(accountsRoot(), slug(agentId), id);
    await fs.mkdir(dir, { recursive: true });
    const note = await linkShared(agentId, dir);
    if (key !== undefined) {
      try {
        await prepareKeyHome(agentId, dir, key);
        apiKeys.set(id, agentId, key);
      } catch (error) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    const account = {
      id,
      label:
        String(label || '')
          .trim()
          .slice(0, 60) ||
        (key !== undefined ? 'API key' : 'Account ' + (entry(state, agentId).accounts.length + 2)),
      dir,
      createdAt: Date.now(),
      note,
      ...(key !== undefined ? { kind: 'api-key' } : {}),
    };
    entry(state, agentId).accounts.push(account);
    await save(state);
    return account;
  },
  // Removes Technically Not's folder for an added account. Junctions are unlinked first so the
  // shared default-home folders are never touched.
  // inUse(agentId, accountId) → true while an agent panel runs on the account (tests pass their
  // own).
  async remove(agentId, accountId, { inUse = accountInUse } = {}) {
    const state = load(),
      e = entry(state, agentId),
      account = e.accounts.find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');

    // The CLI holds files of a running panel open, so a delete would stop half way (app-2 #6).
    if (inUse(agentId, accountId))
      throw new Error(
        'An agent is running on this account. Stop or close its threads, then remove the account.'
      );
    const root = accountsRoot(),
      dir = path.resolve(account.dir);
    if (!dir.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep))
      throw new Error('Refusing to remove a folder outside Technically Not’s account folders.');
    for (const name of capability(agentId)?.shared || []) {
      const link = path.join(dir, name);
      try {
        if ((await fs.lstat(link)).isSymbolicLink()) {
          try {
            await fs.unlink(link);
          } catch {
            await fs.rmdir(link);
          }
        }
      } catch {}
      try {
        if ((await fs.lstat(link)).isSymbolicLink())
          throw new Error('Could not unlink the shared ' + name + ' folder; nothing was removed.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      // Part of the folder may be gone: share the conversations again and say what is left, so the
      // account stays listed and can be removed again.
      await linkShared(agentId, dir).catch(() => '');
      throw new Error(
        'Could not delete all of this account’s folder (' +
          (error.code || error.message) +
          '). The account is still listed and its sign-in may be partly removed; close every program using it and remove it again.'
      );
    }
    if (account.kind === 'api-key') apiKeys.remove(accountId);
    e.accounts = e.accounts.filter(a => a.id !== accountId);
    if (e.active === accountId) e.active = '';
    await save(state);
    const home = DEFAULT_HOMES[agentId]();
    return {
      removed: !fsSync.existsSync(dir),
      sharedIntact: (capability(agentId)?.shared || []).every(name =>
        fsSync.existsSync(path.join(home, name))
      ),
    };
  },
  // Replace the key of an API-key account (also the fix for "Key needs to be re-entered").
  async setKey(agentId, accountId, key) {
    const account = entry(load(), agentId).accounts.find(
      a => a.id === accountId && a.kind === 'api-key'
    );
    if (!account) throw new Error('API-key account not found.');
    key = checkKey(agentId, key);
    await prepareKeyHome(agentId, account.dir, key);
    apiKeys.set(accountId, agentId, key);
    return { last4: key.slice(-4) };
  },
  // Main process only (pty-service.js): { VAR: key } for an API-key account's agent process, {} for
  // any other account.
  keyEnv(agentId, accountId) {
    if (!this.isKey(agentId, accountId)) return {};
    const name = registry.apiKeyEnv(agentId),
      key = apiKeys.keyFor(accountId, agentId);
    return name && key ? { [name]: key } : {};
  },
  async setActive(agentId, accountId) {
    const state = load(),
      e = entry(state, agentId);
    if (accountId && !e.accounts.some(a => a.id === accountId))
      throw new Error('Account not found.');
    e.active = accountId || '';
    await save(state);
    return e.active;
  },
  async rename(agentId, accountId, label) {
    const state = load(),
      account = entry(state, agentId).accounts.find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    account.label =
      String(label || '')
        .trim()
        .slice(0, 60) || account.label;
    await save(state);
    return account.label;
  },
};

// The calls that change accounts.json or a key run one at a time (see serial above).
for (const name of ['add', 'remove', 'setKey', 'setActive', 'rename']) {
  const change = accountService[name];
  accountService[name] = (...args) => serial(() => change.apply(accountService, args));
}

module.exports = accountService;
