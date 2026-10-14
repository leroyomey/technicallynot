/*
 * Technically Not tools · opencode-contract-check.js — Does the installed OpenCode still offer what
 * desktop/opencode-link.js uses? Starts the real binary's `serve` on a loopback port with a
 * password for a few seconds, reads its own API description (/doc), and checks every route, event
 * type and permission answer named in the link's CONTRACT. No model prompt, no cost; the process
 * tree is ended and checked gone. Run it after every OpenCode update.
 * Run: node tools/opencode-contract-check.js prints PASS or the missing parts (exit 1) node
 * tools/opencode-contract-check.js --mark-tested on PASS, records the version in
 * desktop/opencode-link-tested.json (versions the app uses without reading /doc first; any other
 * version is tested by the app itself at connect)
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  net = require('net'),
  crypto = require('crypto');
const { CONTRACT, contractMissing } = require('../desktop/opencode-link');
const TESTED_FILE = path.join(__dirname, '..', 'desktop', 'opencode-link-tested.json');
const win = process.platform === 'win32';

// The real binary, not the `opencode` shim of a Technically Not terminal panel (that one adds a
// session config).
function binary() {
  const direct =
    win && process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
      : '';
  if (direct && fs.existsSync(direct)) return { file: direct, shell: false };
  return { file: 'opencode', shell: win };
}
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

(async () => {
  const bin = binary(),
    port = await freePort(),
    password = crypto.randomBytes(16).toString('hex');
  const env = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: 'opencode',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  };
  for (const key of Object.keys(env))
    if (/^OPENCODE_CONFIG|^OPENCODE_TUI_CONFIG|^TNAI_/.test(key)) delete env[key];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-oc-contract-'));
  const child = spawn(
    bin.file,
    ['serve', '--port', String(port), '--hostname', '127.0.0.1', '--pure'],
    { cwd, env, shell: bin.shell, stdio: 'ignore', windowsHide: true }
  );
  let spawnError = '';
  child.on('error', e => {
    spawnError = e.message;
  });
  const end = () => {
    try {
      if (win)
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch {}
  };
  const limit = setTimeout(() => {
    console.log('FAIL OpenCode did not answer within 60 s');
    end();
    process.exit(1);
  }, 60000);
  const base = 'http://127.0.0.1:' + port,
    auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  const get = async (p, withAuth = true) => {
    const r = await fetch(base + p, {
      headers: withAuth ? { authorization: auth } : {},
      signal: AbortSignal.timeout(8000),
    });
    return { status: r.status, text: await r.text() };
  };

  const missing = [];
  let version = '',
    doc = null;
  try {
    let health = null;
    for (let i = 0; i < 80 && !health && !spawnError; i++) {
      try {
        const r = await get('/global/health');
        if (r.status === 200) health = JSON.parse(r.text);
      } catch {}
      if (!health) await sleep(500);
    }
    if (!health)
      throw new Error(
        spawnError
          ? 'OpenCode could not be started: ' + spawnError
          : 'OpenCode’s server did not answer /global/health'
      );
    version = String(health.version || '');
    if ((await get('/session/status', false)).status !== 401)
      missing.push('a request without the password is not refused with 401');
    doc = JSON.parse((await get('/doc')).text);
  } catch (e) {
    missing.push(e.message);
  }
  clearTimeout(limit);
  end();
  for (let i = 0; i < 20 && alive(child.pid); i++) await sleep(250);
  try {
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch {}

  // the same test the app runs at connect (desktop/opencode-link.js)
  if (doc) missing.push(...contractMissing(doc));
  const left = alive(child.pid);
  if (left) missing.push('the server process ' + child.pid + ' is still running');

  let tested = { versions: [], checked: '' };
  try {
    tested = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  } catch {}
  console.log(
    'OpenCode ' +
      (version || '(version not read)') +
      ' · ' +
      CONTRACT.routes.length +
      ' routes, ' +
      CONTRACT.events.length +
      ' event types'
  );
  if (missing.length) {
    for (const m of missing) console.log('MISSING ' + m);
    console.log('FAIL: the link must stay off on this version');
    process.exit(1);
  }
  if (process.argv.includes('--mark-tested')) {
    if (!tested.versions.includes(version)) tested.versions.push(version);
    const d = new Date();
    tested.checked =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0'); // the local date
    fs.writeFileSync(TESTED_FILE, JSON.stringify(tested, null, 2) + '\n');
    console.log('PASS, recorded ' + version + ' in desktop/opencode-link-tested.json');
  } else
    console.log(
      'PASS' +
        (tested.versions.includes(version)
          ? ' (version already recorded as tested)'
          : ' (not recorded: run with --mark-tested after the real-panel run also passed)')
    );
  process.exit(0);
})().catch(e => {
  console.log('FAIL ' + e.message);
  process.exit(1);
});
