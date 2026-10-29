/*
 * Technically Not desktop · connections.js — Connections: the tools (MCP servers) the user's agents
 * can use, in one list that reaches Claude Code, Codex, OpenCode, Cursor Agent and GitHub Copilot
 * alike (user
 * 2026-10-28: "Yes, build it as shown", mock docs/plans/design-concepts/connections-page.html;
 * plan docs/plans/plugin-mcp-manager.md, the contract with the window in its section 7.1).
 *
 * Two layers, never mixed (plan 3.1):
 * - The tools' own setup is only READ here (`oneTool`): what the user installed in one tool's own
 *   settings, so the page can offer "Add for every agent". Nothing in those files is written.
 * - The app's own list lives in the settings folder (connections.json) and is passed per session,
 *   the way the app's own `tnai` connection already is: agent-hooks.js puts the servers into the
 *   pane's MCP file (Claude Code, and Copilot's `--additional-mcp-config` file) and Cursor plugin,
 *   agent-registry.js into Codex's `-c` settings and OpenCode's config. A change reaches a thread
 *   at its next session start.
 *
 * Keys (a token, a password) are kept encrypted by the OS (Electron safeStorage, as api-keys.js
 * does) in connection-keys.bin, and reach a server only as an environment variable of that
 * thread's own agent process (pty-service.js `envFor`); a config names the variable, never its
 * value. The window only ever learns whether a key is set. Only the user adds a connection: no
 * agent tool calls in here. Test: tools/connections-test.js.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// The tools a connection reaches, and how far each is built.
const TOOLS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent', 'GitHub Copilot'];
const REACHES = {
  'Claude Code': 'yes',
  Codex: 'yes',
  OpenCode: 'yes',
  'Cursor Agent': 'yes',
  'GitHub Copilot': 'yes',
};

// Suggested connections: well-known servers, each added for every agent with one press. A key
// is named `{NAME}` in a header; each tool gets the form it reads (headersFor).
const CATALOG = [
  {
    id: 'playwright',
    name: 'Playwright browser',
    desc: 'Open pages, click, type and take pictures in a browser on this PC. Good for checking a site an agent built.',
    kind: 'command',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    note: 'Page pictures cost tokens on every step, so it starts off; switch it on in the threads that need it.',
  },
  {
    id: 'github',
    name: 'GitHub',
    desc: 'Issues, pull requests and review comments in your repositories.',
    kind: 'url',
    url: 'https://api.githubcopilot.com/mcp/',
    keys: ['GITHUB_TOKEN'],
    headers: { Authorization: 'Bearer {GITHUB_TOKEN}' },
  },
  {
    id: 'context7',
    name: 'Context7',
    desc: 'Up-to-date docs and examples for libraries, so an agent does not guess an old API.',
    kind: 'url',
    url: 'https://mcp.context7.com/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    desc: 'Read and update issues.',
    kind: 'url',
    url: 'https://mcp.linear.app/mcp',
    signIn: true,
  },
  {
    id: 'sentry',
    name: 'Sentry',
    desc: 'Read the errors your app reports.',
    kind: 'url',
    url: 'https://mcp.sentry.dev/mcp',
    signIn: true,
  },
  {
    id: 'figma',
    name: 'Figma',
    desc: 'Read frames and styles from a design file.',
    kind: 'url',
    url: 'https://mcp.figma.com/mcp',
    signIn: true,
  },
];

// A key name: letters, digits and _ only (it becomes an environment variable).
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

let deps = {
  dir: () => '',
  instanceOf: () => '',
  safeStorage: null,
  home: () => os.homedir(),
  project: () => '',
  changed: () => {},
};

// ---------- the pure part ----------

// A connection's name as a server name every tool accepts: lower case, a to z, 0 to 9, _ and -.
function serverName(name) {
  const plain = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return plain && plain !== 'tnai' ? plain : 'connection';
}

// `{KEY}` in a header, in the form one tool reads.
function headersFor(headers, tool) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    out[name] = String(value).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, key) =>
      tool === 'OpenCode'
        ? '{env:' + key + '}'
        : tool === 'Cursor Agent'
          ? '${env:' + key + '}'
          : '${' + key + '}'
    );
  }
  return out;
}

// The connections on for one thread: every session, or this thread's instance among its threads.
function onFor(list, instanceId) {
  return (list || []).filter(
    item => item.every || (instanceId && (item.threads || []).includes(instanceId))
  );
}

// Claude Code's and Cursor Agent's MCP file entries ({ name: entry }).
function jsonServers(list, tool) {
  const out = {};
  for (const item of list) {
    const name = serverName(item.name);
    if (item.kind === 'url') {
      out[name] = {
        ...(tool === 'Claude Code' ? { type: 'http' } : {}),
        url: item.url,
        ...(item.headers ? { headers: headersFor(item.headers, tool) } : {}),
      };
    } else {
      out[name] = {
        ...(tool === 'Claude Code' ? { type: 'stdio' } : {}),
        command: item.command,
        args: item.args || [],
      };
    }
  }
  return out;
}

// GitHub Copilot's entries, for its `--additional-mcp-config` file (the format of its own
// ~/.copilot/mcp-config.json: type local or http, and `tools: ['*']` for every tool the server
// has). Checked against Copilot CLI 1.0.105 with stand-in servers and no prompt
// (tools/copilot-connections-check.js): `${KEY}` in a header and in a local server's `env` is
// filled from the session's environment. Its docs say a local server inherits only PATH, so each
// key is named in `env` even though 1.0.105 passed the whole environment.
function copilotServers(list) {
  const out = {};
  for (const item of list) {
    const name = serverName(item.name);
    out[name] =
      item.kind === 'url'
        ? {
            type: 'http',
            url: item.url,
            ...(item.headers ? { headers: headersFor(item.headers, 'GitHub Copilot') } : {}),
            tools: ['*'],
          }
        : {
            type: 'local',
            command: item.command,
            args: item.args || [],
            ...((item.keys || []).length
              ? { env: Object.fromEntries(item.keys.map(key => [key, '${' + key + '}'])) }
              : {}),
            tools: ['*'],
          };
  }
  return out;
}

// OpenCode's `mcp` entries.
function openCodeServers(list) {
  const out = {};
  for (const item of list) {
    const name = serverName(item.name);
    out[name] =
      item.kind === 'url'
        ? {
            type: 'remote',
            url: item.url,
            enabled: true,
            ...(item.headers ? { headers: headersFor(item.headers, 'OpenCode') } : {}),
          }
        : {
            type: 'local',
            command: [item.command, ...(item.args || [])],
            enabled: true,
            ...((item.keys || []).length
              ? {
                  environment: Object.fromEntries(item.keys.map(key => [key, '{env:' + key + '}'])),
                }
              : {}),
          };
  }
  return out;
}

// A TOML string in single quotes (a literal string): cmd.exe leaves single quotes alone, so it
// survives the .cmd shims Codex starts through. A value with a quote or a space is skipped.
const tomlLiteral = value => (/['\s]/.test(String(value)) ? null : "'" + value + "'");

// Codex's `-c` settings, one pair of arguments each.
function codexArgs(list) {
  const args = [];
  for (const item of list) {
    const name = serverName(item.name);
    const set = (key, value) => args.push('-c', 'mcp_servers.' + name + '.' + key + '=' + value);
    if (item.kind === 'url') {
      set('url', item.url);
      const bearer = /^Bearer \{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(
        item.headers?.Authorization || ''
      );
      if (bearer) set('bearer_token_env_var', bearer[1]);
    } else {
      const parts = [item.command, ...(item.args || [])].map(tomlLiteral);
      if (parts.some(part => part == null)) continue;
      set('command', parts[0]);
      set('args', '[' + parts.slice(1).join(',') + ']');
      if ((item.keys || []).length)
        set('env_vars', '[' + item.keys.map(tomlLiteral).join(',') + ']');
    }
  }
  return args;
}

// ---------- the list, kept in the settings folder ----------

const listFile = () => path.join(deps.dir(), 'connections.json');
const keyFile = () => path.join(deps.dir(), 'connection-keys.bin');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(listFile(), 'utf8'));
    cache = Array.isArray(parsed) ? parsed.filter(item => item && item.id) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(list) {
  cache = list;
  fs.mkdirSync(deps.dir(), { recursive: true });
  fs.writeFileSync(listFile(), JSON.stringify(list, null, 2));
  try {
    deps.changed();
  } catch {}
}

// ---------- keys (encrypted by the OS) ----------

function keysUnavailable() {
  const store = deps.safeStorage;
  if (!store) return 'Keys can’t be kept on this computer.';
  if (process.platform === 'darwin') return '';
  try {
    const backend = process.platform === 'linux' ? store.getSelectedStorageBackend?.() : '';
    if (store.isEncryptionAvailable() && backend !== 'basic_text') return '';
  } catch {}
  return 'This computer has no secure keyring, so Technically Not can’t keep a key safely.';
}

function readKeys() {
  try {
    const sealed = fs.readFileSync(keyFile());
    return JSON.parse(deps.safeStorage.decryptString(sealed)) || {};
  } catch {
    return {};
  }
}

function writeKeys(keys) {
  fs.mkdirSync(deps.dir(), { recursive: true });
  fs.writeFileSync(keyFile(), deps.safeStorage.encryptString(JSON.stringify(keys)));
}

// ---------- the tools' own setup (read only) ----------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Codex's config.toml: each [mcp_servers.NAME] table's command, args and url (a simple read of
// the common shapes; anything else is left out rather than guessed).
function codexOwn(text) {
  const out = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const table = /^\[mcp_servers\.("?)([^\]"]+)\1\]$/.exec(line);
    if (table) {
      current = { name: table[2] };
      out.push(current);
      continue;
    }
    if (/^\[/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const pair = /^(command|url)\s*=\s*["']([^"']*)["']/.exec(line);
    if (pair) current[pair[1]] = pair[2];
    const list = /^args\s*=\s*\[(.*)\]/.exec(line);
    if (list) current.args = [...list[1].matchAll(/["']([^"']*)["']/g)].map(match => match[1]);
  }
  return out.filter(item => item.command || item.url);
}

const shapeOf = (tool, name, entry) => {
  const command = Array.isArray(entry?.command) ? entry.command[0] : entry?.command;
  const args = Array.isArray(entry?.command) ? entry.command.slice(1) : entry?.args || [];
  const url = entry?.url || entry?.httpUrl || '';
  if (!command && !url) return null;
  return url
    ? { tool, name, kind: 'url', url }
    : { tool, name, kind: 'command', command: String(command), args: args.map(String) };
};

// Every server the tools' own settings name, as [{ tool, name, kind, command, args, url }].
function ownSetup() {
  const home = deps.home();
  const project = deps.project();
  const found = [];
  const add = (tool, servers) => {
    for (const [name, entry] of Object.entries(servers || {})) {
      if (name === 'tnai') continue;
      const shaped = shapeOf(tool, name, entry);
      if (shaped) found.push(shaped);
    }
  };
  const claude = readJson(path.join(home, '.claude.json'));
  add('Claude Code', claude?.mcpServers);
  if (project) {
    const key = Object.keys(claude?.projects || {}).find(
      folder => path.resolve(folder).toLowerCase() === path.resolve(project).toLowerCase()
    );
    if (key) add('Claude Code', claude.projects[key].mcpServers);
    add('Claude Code', readJson(path.join(project, '.mcp.json'))?.mcpServers);
  }
  add('Cursor Agent', readJson(path.join(home, '.cursor', 'mcp.json'))?.mcpServers);

  // Copilot's default folder only: an account folder of its own (COPILOT_HOME) is not read
  add('GitHub Copilot', readJson(path.join(home, '.copilot', 'mcp-config.json'))?.mcpServers);
  for (const file of ['opencode.json', 'opencode.jsonc'])
    add('OpenCode', readJson(path.join(home, '.config', 'opencode', file))?.mcp);
  try {
    const text = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    for (const item of codexOwn(text)) add('Codex', { [item.name]: item });
  } catch {}
  return found;
}

// Servers in some tools' own setup but not in the app's list, one row per name with the tools
// that have it.
function oneTool(list) {
  const mine = new Set(list.map(item => serverName(item.name)));
  const byName = new Map();
  for (const item of ownSetup()) {
    const key = serverName(item.name);
    if (mine.has(key)) continue;
    if (!byName.has(key)) byName.set(key, { ...item, tools: new Set() });
    byName.get(key).tools.add(item.tool);
  }
  return (
    [...byName.values()]

      // a server every tool already has needs nothing from the app (all five setups are read)
      .filter(item => item.tools.size < TOOLS.length)
      .map(({ tools, ...item }) => ({ ...item, tool: [...tools].join(', ') }))
  );
}

// ---------- what the window asks ----------

const publicEntry = (item, keys) => ({
  id: item.id,
  name: item.name,
  desc: item.desc || '',
  kind: item.kind,
  command: item.command || '',
  args: item.args || [],
  url: item.url || '',
  signIn: !!item.signIn,
  note: item.note || '',
  keys: (item.keys || []).map(name => ({ name, set: !!keys[item.id]?.[name] })),
  every: !!item.every,
  threads: item.threads || [],
  reaches: { ...REACHES },
});

function state() {
  const list = load();
  const keys = keysUnavailable() ? {} : readKeys();
  const added = new Set(list.map(item => item.catalogId).filter(Boolean));
  return {
    connections: list.map(item => publicEntry(item, keys)),
    suggested: CATALOG.filter(item => !added.has(item.id)).map(item => ({
      id: item.id,
      name: item.name,
      desc: item.desc,
      kind: item.kind,
      command: item.command || '',
      args: item.args || [],
      url: item.url || '',
      keys: item.keys || [],
      signIn: !!item.signIn,
      note: item.note || '',
    })),
    oneTool: oneTool(list),
    keysAvailable: keysUnavailable(),
  };
}

const fail = error => ({ ok: false, error });
const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// A command and its arguments: plain words only, no shell (it is started directly by each tool).
function checkCommand(command, args) {
  if (!/^[\w.@\/\\:-]{1,200}$/.test(String(command || '')))
    return 'The command must be one program name or path, without spaces or shell signs.';
  if (!Array.isArray(args) || args.length > 30) return 'Too many arguments.';
  if (args.some(arg => typeof arg !== 'string' || arg.length > 300 || /[\r\n]/.test(arg)))
    return 'An argument is not plain text.';
  return '';
}

function add(request) {
  const list = load();
  const item = request?.catalogId ? CATALOG.find(entry => entry.id === request.catalogId) : null;
  if (request?.catalogId && !item) return fail('No suggested connection by that name.');
  if (item && list.some(entry => entry.catalogId === item.id)) return fail('Already added.');
  const entry = item
    ? { ...item, id: newId(), catalogId: item.id, every: !!request.every, threads: [] }
    : null;
  let own = null;
  if (!entry) {
    const name = String(request?.name || '').trim();
    if (!name || name.length > 60) return fail('Give it a name of up to 60 characters.');
    const url = String(request?.url || '').trim();
    if (url) {
      if (!/^https?:\/\/[^\s]+$/.test(url)) return fail('The web address must start with https://');
      own = { name, kind: 'url', url };
    } else {
      const command = String(request?.command || '').trim();
      const args = (request?.args || []).map(String);
      const wrong = checkCommand(command, args);
      if (wrong) return fail(wrong);
      own = { name, kind: 'command', command, args };
    }
    own = {
      ...own,
      id: newId(),
      desc: String(request?.desc || '').slice(0, 200),
      every: !!request?.every,
      threads: [],
    };
  }
  const next = entry || own;
  if (list.some(other => serverName(other.name) === serverName(next.name)))
    return fail('A connection with that name exists.');
  save([...list, next]);
  return { ok: true, id: next.id };
}

// A server from one tool's own setup becomes the app's, for every agent.
function adopt(tool, name) {
  const found = ownSetup().find(item => item.tool === tool && item.name === name);
  if (!found) return fail('That server is not in ' + tool + '’s setup any more.');
  return add({
    name: found.name,
    command: found.command,
    args: found.args,
    url: found.url,
    desc: 'From ' + tool + '’s own setup.',
    every: true,
  });
}

function change(id, edit) {
  const list = load();
  const index = list.findIndex(item => item.id === id);
  if (index < 0) return fail('No connection by that id.');
  const next = [...list];
  next[index] = edit({ ...list[index] });
  save(next);
  return { ok: true };
}

function remove(id) {
  const list = load();
  if (!list.some(item => item.id === id)) return fail('No connection by that id.');
  save(list.filter(item => item.id !== id));
  if (!keysUnavailable()) {
    const keys = readKeys();
    if (keys[id]) {
      delete keys[id];
      writeKeys(keys);
    }
  }
  return { ok: true };
}

const setEvery = (id, on) => change(id, item => ({ ...item, every: !!on }));

function setThread(id, instanceId, on) {
  if (!instanceId) return fail('No thread.');
  return change(id, item => {
    const threads = new Set(item.threads || []);
    if (on) threads.add(String(instanceId));
    else threads.delete(String(instanceId));
    return { ...item, threads: [...threads] };
  });
}

function setKey(id, name, value) {
  const why = keysUnavailable();
  if (why) return fail(why);
  const item = load().find(entry => entry.id === id);
  if (!item) return fail('No connection by that id.');
  if (!KEY_NAME.test(String(name || '')) || !(item.keys || []).includes(name))
    return fail('That connection takes no key by that name.');
  const keys = readKeys();
  const text = String(value ?? '').trim();
  keys[id] = { ...(keys[id] || {}) };
  if (text) keys[id][name] = text;
  else delete keys[id][name];
  writeKeys(keys);
  try {
    deps.changed();
  } catch {}
  return { ok: true };
}

// The Details section of one thread.
function forThread(paneId) {
  const instanceId = deps.instanceOf(paneId) || '';
  const keys = keysUnavailable() ? {} : readKeys();
  return {
    instanceId,
    list: load().map(item => ({
      id: item.id,
      name: item.name,
      every: !!item.every,
      on: !!item.every || (!!instanceId && (item.threads || []).includes(instanceId)),
      keysMissing: (item.keys || []).filter(name => !keys[item.id]?.[name]),
    })),
  };
}

// ---------- what a session gets ----------

// The connections on for this pane's thread.
const onForPane = paneId => onFor(load(), deps.instanceOf(paneId) || '');

// For agent-hooks.js: the entries to put beside `tnai` in the pane's MCP file (Claude Code,
// Cursor Agent's plugin, GitHub Copilot's `--additional-mcp-config` file).
const jsonFor = (paneId, tool) =>
  tool === 'GitHub Copilot'
    ? copilotServers(onForPane(paneId))
    : jsonServers(onForPane(paneId), tool);

// For agent-registry.js: Codex's `-c` arguments and OpenCode's `mcp` entries.
const codexFor = paneId => codexArgs(onForPane(paneId));
const openCodeFor = paneId => openCodeServers(onForPane(paneId));

// For pty-service.js: the keys of this thread's connections, as environment variables.
function envFor(paneId) {
  if (keysUnavailable()) return {};
  const keys = readKeys();
  const env = {};
  for (const item of onForPane(paneId))
    for (const name of item.keys || []) if (keys[item.id]?.[name]) env[name] = keys[item.id][name];
  return env;
}

// Every call from outside is guarded: a broken file never stops a session from starting.
const guard =
  (fn, fallback) =>
  (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      console.warn('[tnai] connections:', error?.message || error);
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }
  };

module.exports = {
  // { dir: () => settings folder, instanceOf: paneId → thread instance id, safeStorage,
  //   project: () => the open project folder, changed: () => tell the window, home (tests) }
  init(options) {
    deps = { ...deps, ...options };
    cache = null;
  },
  state: guard(state, error => ({
    connections: [],
    suggested: [],
    oneTool: [],
    keysAvailable: String(error?.message || error),
  })),
  add: guard(add, error => fail(String(error?.message || error))),
  adopt: guard(adopt, error => fail(String(error?.message || error))),
  remove: guard(remove, error => fail(String(error?.message || error))),
  setEvery: guard(setEvery, error => fail(String(error?.message || error))),
  setThread: guard(setThread, error => fail(String(error?.message || error))),
  setKey: guard(setKey, error => fail('The key could not be saved.')),
  forThread: guard(forThread, { instanceId: '', list: [] }),
  jsonFor: guard(jsonFor, {}),
  codexFor: guard(codexFor, []),
  openCodeFor: guard(openCodeFor, {}),
  envFor: guard(envFor, {}),
  pure: {
    serverName,
    headersFor,
    onFor,
    jsonServers,
    copilotServers,
    openCodeServers,
    codexArgs,
    codexOwn,
  },
  CATALOG,
};
