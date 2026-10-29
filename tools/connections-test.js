// Technically Not tools · connections-test.js — Connections (desktop/connections.js): adding a
// suggested or own connection, the checks on what may be added, keys kept apart and never shown,
// every session or chosen threads, each tool's settings form (Claude Code and Cursor Agent MCP
// file entries, Codex `-c` arguments, OpenCode `mcp`, GitHub Copilot's `--additional-mcp-config`
// entries), and the tools' own setup read without writing it. Run: node tools/connections-test.js
// (what the real Copilot does with its form: tools/copilot-connections-check.js)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const connections = require('../desktop/connections.js');
const { serverName, codexOwn, copilotServers } = connections.pure;

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-connections-'));
const home = path.join(folder, 'home');
const project = path.join(folder, 'project');
fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
fs.mkdirSync(project, { recursive: true });

// the tools' own setup: Claude Code has "memory" and "shared", Cursor has "shared", Codex "docs"
fs.writeFileSync(
  path.join(home, '.claude.json'),
  JSON.stringify({
    mcpServers: {
      memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
      shared: { url: 'https://example.com/mcp' },
      tnai: { url: 'http://127.0.0.1:1/mcp/x' },
    },
  })
);
fs.writeFileSync(
  path.join(home, '.cursor', 'mcp.json'),
  JSON.stringify({ mcpServers: { shared: { url: 'https://example.com/mcp' } } })
);
fs.writeFileSync(
  path.join(home, '.codex', 'config.toml'),
  'model = "x"\n\n[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp"]\n\n[other]\nkey = 1\n'
);

// Copilot has "tickets" (its own form: type local, tools) and "shared"
fs.writeFileSync(
  path.join(home, '.copilot', 'mcp-config.json'),
  JSON.stringify({
    mcpServers: {
      tickets: { type: 'local', command: 'npx', args: ['-y', 'tickets-mcp'], tools: ['*'] },
      shared: { type: 'http', url: 'https://example.com/mcp', tools: ['*'] },
    },
  })
);
const before = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
const copilotBefore = fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf8');

// a stand-in for the OS's encryption: reversible, and never the plain text on disk
const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: text =>
    Buffer.from(Buffer.from(text).toString('base64').split('').reverse().join('')),
  decryptString: buffer =>
    Buffer.from(String(buffer).split('').reverse().join(''), 'base64').toString(),
};
let changed = 0;
const instances = { p1: 'inst-lead', p2: 'inst-sable' };
connections.init({
  dir: () => path.join(folder, 'settings'),
  instanceOf: paneId => instances[paneId] || '',
  safeStorage,
  home: () => home,
  project: () => project,
  changed: () => changed++,
});

// 1. names every tool accepts
check(serverName('Playwright browser') === 'playwright-browser', 'a server name');
check(serverName('tnai') === 'connection', 'the app’s own name is not taken');

// 2. suggested and adding
let state = connections.state();
check(
  state.suggested.some(item => item.id === 'github'),
  'GitHub is suggested'
);
check(state.connections.length === 0, 'nothing added yet');
const github = connections.add({ catalogId: 'github', every: true });
check(github.ok, 'GitHub added');
check(!connections.add({ catalogId: 'github' }).ok, 'not twice');
check(!connections.add({ catalogId: 'nope' }).ok, 'an unknown suggestion is refused');
const browser = connections.add({ catalogId: 'playwright' });
check(browser.ok && changed >= 2, 'the browser added, the window told');
state = connections.state();
check(!state.suggested.some(item => item.id === 'github'), 'an added one leaves Suggested');
check(state.connections[0].reaches['GitHub Copilot'] === 'yes', 'Copilot is reached');
check(
  Object.values(state.connections[0].reaches).every(value => value === 'yes'),
  'every tool is reached'
);

// 3. own connections: plain commands and web addresses only
check(!connections.add({ name: 'bad', command: 'npx && del' }).ok, 'no shell signs');
check(!connections.add({ name: 'bad', url: 'ftp://x' }).ok, 'only http(s) addresses');
check(!connections.add({ name: '', command: 'npx' }).ok, 'a name is needed');
const own = connections.add({ name: 'My DB', command: 'node', args: ['db-mcp.js'] });
check(own.ok, 'an own command connection');
check(!connections.add({ name: 'my db', command: 'node' }).ok, 'no two with one server name');

// 4. keys: kept encrypted, never shown, only in the environment of a thread that has it on
check(!connections.setKey(github.id, 'OTHER', 'x').ok, 'only the keys it takes');
check(connections.setKey(github.id, 'GITHUB_TOKEN', 'ghp_secret123').ok, 'a key saved');
const sealed = fs.readFileSync(path.join(folder, 'settings', 'connection-keys.bin'), 'utf8');
check(!sealed.includes('ghp_secret123'), 'the key is not plain on disk');
state = connections.state();
const shown = JSON.stringify(state);
check(!shown.includes('ghp_secret123'), 'the window never gets the key');
check(state.connections.find(item => item.id === github.id).keys[0].set === true, 'key set');
check(connections.envFor('p1').GITHUB_TOKEN === 'ghp_secret123', 'in the environment');

// 5. every session or chosen threads
check(Object.keys(connections.jsonFor('p1', 'Claude Code')).join() === 'github', 'only GitHub on');
check(connections.setThread(browser.id, 'inst-lead', true).ok, 'the browser on for Lead');
check('playwright-browser' in connections.jsonFor('p1', 'Claude Code'), 'Lead has it');
check(!('playwright-browser' in connections.jsonFor('p2', 'Claude Code')), 'Sable does not');
const details = connections.forThread('p2');
check(details.instanceId === 'inst-sable' && details.list.length === 3, 'Details of a thread');
check(details.list.find(item => item.id === github.id).on === true, 'every session is on');
check(details.list.find(item => item.id === browser.id).on === false, 'chosen threads only');
connections.setEvery(github.id, false);
check(!connections.envFor('p1').GITHUB_TOKEN, 'a connection that is off gives no key');
connections.setEvery(github.id, true);

// 6. each tool's form
const claude = connections.jsonFor('p1', 'Claude Code');
check(
  claude.github.type === 'http' && claude.github.headers.Authorization === 'Bearer ${GITHUB_TOKEN}',
  'Claude Code: the variable, not the key'
);
check(
  claude['playwright-browser'].type === 'stdio' && claude['playwright-browser'].command === 'npx',
  'Claude Code: a program'
);
const cursor = connections.jsonFor('p1', 'Cursor Agent');
check(
  cursor.github.headers.Authorization === 'Bearer ${env:GITHUB_TOKEN}' && !cursor.github.type,
  'Cursor form'
);
const codex = connections.codexFor('p1');
check(
  codex.includes('mcp_servers.github.url=https://api.githubcopilot.com/mcp/'),
  'Codex: the address'
);
check(
  codex.includes('mcp_servers.github.bearer_token_env_var=GITHUB_TOKEN'),
  'Codex: the key by name'
);
check(
  codex.includes("mcp_servers.playwright-browser.args=['-y','@playwright/mcp@latest']"),
  'Codex: args in single quotes'
);
check(
  codex.length % 2 === 0 &&
    codex.filter((arg, index) => index % 2 === 0).every(arg => arg === '-c'),
  'Codex: -c pairs'
);
const opencode = connections.openCodeFor('p1');
check(
  opencode.github.type === 'remote' &&
    opencode.github.headers.Authorization === 'Bearer {env:GITHUB_TOKEN}',
  'OpenCode remote'
);
check(
  opencode['playwright-browser'].command.join(' ') === 'npx -y @playwright/mcp@latest',
  'OpenCode local'
);
const copilot = connections.jsonFor('p1', 'GitHub Copilot');
check(
  copilot.github.type === 'http' &&
    copilot.github.url === 'https://api.githubcopilot.com/mcp/' &&
    copilot.github.headers.Authorization === 'Bearer ${GITHUB_TOKEN}',
  'Copilot remote: the variable, not the key'
);
check(
  copilot['playwright-browser'].type === 'local' &&
    copilot['playwright-browser'].command === 'npx' &&
    copilot['playwright-browser'].args.join(' ') === '-y @playwright/mcp@latest',
  'Copilot local'
);
check(
  Object.values(copilot).every(entry => entry.tools?.join() === '*'),
  'Copilot: every tool of each server'
);
check(!('tnai' in copilot), 'Copilot: the app’s own server is added by agent-hooks.js, not here');
check(!('playwright-browser' in connections.jsonFor('p2', 'GitHub Copilot')), 'Copilot per thread');

// a program that takes a key names it in its env, by variable
const keyed = copilotServers([
  { name: 'Keyed', kind: 'command', command: 'node', args: ['s.js'], keys: ['API_KEY'] },
]);
check(keyed.keyed.env.API_KEY === '${API_KEY}', 'Copilot local: the key by variable in env');
check(!('env' in copilot['playwright-browser']), 'Copilot local: no env without keys');
check(
  !JSON.stringify([claude, cursor, codex, opencode, copilot]).includes('ghp_secret123'),
  'no key in any setting'
);

// 7. the tools' own setup: read, never written
check(
  codexOwn('[mcp_servers.a]\ncommand = "x"\n[b]\ncommand = "y"\n').length === 1,
  'Codex tables read'
);
const oneTool = connections.state().oneTool;
check(
  oneTool.some(item => item.name === 'memory' && item.tool === 'Claude Code'),
  'Claude Code’s own server'
);
check(
  oneTool.some(item => item.name === 'docs' && item.tool === 'Codex'),
  'Codex’s own server'
);
check(
  oneTool.some(
    item => item.name === 'shared' && /Claude Code/.test(item.tool) && /Cursor/.test(item.tool)
  ),
  'one row for a server in two tools'
);
check(
  oneTool.some(item => item.name === 'tickets' && item.tool === 'GitHub Copilot'),
  'Copilot’s own server'
);
check(
  oneTool.some(item => item.name === 'shared' && /GitHub Copilot/.test(item.tool)),
  'a server in three tools, Copilot among them'
);
check(!oneTool.some(item => item.name === 'tnai'), 'the app’s own server is left out');
const adopted = connections.adopt('Claude Code', 'memory');
check(adopted.ok, 'adopted for every agent');
check(!connections.state().oneTool.some(item => item.name === 'memory'), 'and it leaves that list');
check(
  fs.readFileSync(path.join(home, '.claude.json'), 'utf8') === before,
  'the tool’s file is unchanged'
);
check(connections.adopt('GitHub Copilot', 'tickets').ok, 'adopted from Copilot');
check(
  fs.readFileSync(path.join(home, '.copilot', 'mcp-config.json'), 'utf8') === copilotBefore,
  'Copilot’s own file is unchanged'
);

// 8. removing takes its keys too
check(connections.remove(github.id).ok, 'removed');
check(!connections.envFor('p1').GITHUB_TOKEN, 'its key is gone');
check(
  connections.state().suggested.some(item => item.id === 'github'),
  'suggested again'
);

// 9. a broken list file never stops a session
fs.writeFileSync(path.join(folder, 'settings', 'connections.json'), '{ not json');
connections.init({ dir: () => path.join(folder, 'settings') });
check(
  JSON.stringify(connections.jsonFor('p1', 'Claude Code')) === '{}',
  'a broken file gives nothing'
);

// 10. the real launch (agent-hooks.js launchOptions) gives Copilot one file with its connections
// beside `tnai`, and Codex none in its file. Electron is stood in, as in cursor-steps-check.js.
async function launchFiles() {
  connections.init({
    dir: () => path.join(folder, 'settings-launch'),
    instanceOf: paneId => instances[paneId] || '',
    safeStorage,
    home: () => home,
    project: () => project,
    changed: () => {},
  });
  const context = connections.add({ catalogId: 'context7', every: true });
  const browserOn = connections.add({ catalogId: 'playwright' });
  connections.setThread(browserOn.id, 'inst-lead', true);
  check(context.ok && browserOn.ok, 'launch: two connections added');

  // a check builds its environment: the panel this runs in sets TNAI_* variables
  for (const name of Object.keys(process.env))
    if (name.startsWith('TNAI_')) delete process.env[name];
  const Module = require('module');
  const load = Module._load;
  fs.mkdirSync(path.join(folder, 'user'), { recursive: true });
  Module._load = (request, ...rest) =>
    request === 'electron'
      ? {
          app: {
            getPath: () => path.join(folder, 'user'),
            whenReady: () => new Promise(() => {}),
            on: () => {},
            getVersion: () => '0.0.0',
          },
          shell: { openPath: async () => '' },
          dialog: {},
        }
      : load(request, ...rest);
  const hooks = require('../desktop/agent-hooks');
  hooks.init(() => {});
  const readServers = file => JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;

  const lead = await hooks.launchOptions('p1', 'GitHub Copilot');
  const leadServers = readServers(lead.mcpConfig);
  check(
    Object.keys(leadServers).sort().join() === 'context7,playwright-browser,tnai',
    'launch: Copilot’s file holds its thread’s connections and tnai'
  );
  check(
    leadServers.context7.type === 'http' && leadServers.context7.tools.join() === '*',
    'launch: in Copilot’s form'
  );
  check(leadServers.tnai.url.includes('/mcp/'), 'launch: tnai keeps its own address');

  const other = await hooks.launchOptions('p2', 'GitHub Copilot');
  check(
    Object.keys(readServers(other.mcpConfig)).sort().join() === 'context7,tnai',
    'launch: another thread gets only what is on for it'
  );

  const codexStart = await hooks.launchOptions('p3', 'Codex');
  check(
    Object.keys(readServers(codexStart.mcpConfig)).join() === 'tnai',
    'launch: Codex’s file stays tnai only (its connections go in -c)'
  );
}

launchFiles()
  .catch(error => check(false, 'launch: ' + (error?.message || error)))
  .finally(() => {
    try {
      fs.rmSync(folder, { recursive: true, force: true });
    } catch {}
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
