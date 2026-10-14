// Technically Not tools · desktop-check/own-relay-check.js — the two-copies proof for "Use my own
// relay": two real copies of the app on this PC, signed out of any
// Technically Not account, meet through a relay that runs on this PC and pair with the six digits.
//
//   node tools/desktop-check/own-relay-check.js        (about 3 minutes, opens two app windows)
//
// What runs: the public relay (relay/) on `wrangler dev`, from a copy in the system's temp folder
// with a test secret made here (nothing is deployed, no Cloudflare sign-in, the user's real relay
// and its secret are never touched), and two copies of the app from source with throwaway
// profiles. The copies are driven through tests/remote-two.main.js: the window's own remote:*
// calls, and the Devices page read and pressed as its user would.
//
// The eight points it proves, one or more ok/FAIL lines each:
//   1. the relay runs locally and answers as a relay
//   2. two copies run, both signed out, the plan lock off
//   3. each copy connects through its own relay and says so; the two have different device ids
//   4. each sees the other as an unpaired computer; paired with the six digits, both say paired
//   5. real traffic: a "needs you" item crosses and clears; full control is off by default; once
//      switched on, one prompt reaches the other copy's agent once; a copy that is quit and
//      started again comes back with the same id, relay and pairing
//   6. a new secret on the relay and in both copies keeps the pairing; removing the relay in one
//      copy asks first with the count, and on yes the pairing there is gone
//   7. a wrong secret in one copy: the card says so and the link stops; the right one reconnects
//   8. both copies and the relay are stopped, no process and no folder is left
// (7 runs before 6, because 6 ends with one copy off the relay.)
//
// WHAT IS A STAND-IN: the agent CLI. The agent panel in copy B runs a plain Node script put first
// on PATH as `claude` (tests/remote-two.main.js, STAND_IN), so no real CLI is started and none of
// the user's usage is spent. The "needs you" item is told to the app the way the real CLI's hook
// tells it. Everything else is the two real apps and the real relay code on the real runtime.
//
// Wrangler: WRANGLER_JS=<path to wrangler's bin/wrangler.js>, else `npx wrangler`.
// It waits in the same line as check.js (one desktop check at a time on this PC).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  root,
  sleep,
  until,
  alive,
  takeLock,
  dropLock,
  freePort,
  createCopies,
  call,
  remoteCall,
  peerOf,
} = require('./two-copies.js');

// The sentences the Devices page says (src/scripts/111-devices-page.js). Written out here, so a
// changed sentence fails this check and is looked at.
const SAYS = {
  connected: 'Connected to your other computers.',
  noRelay: 'No relay is set. Choose "Use my own relay" on this computer below.',
  wrongSecret: 'Your relay refused the secret. Check the address and the secret under Change.',
  through: 'Through your own relay: ',
  removeTitle: 'Remove your own relay?',
  removesOne: 'This removes your 1 pairing made through your own relay. Pair again afterwards.',
};

// A secret the app and the relay both accept: 64 characters (48 and more need no mix of kinds).
const newSecret = () => crypto.randomBytes(48).toString('base64url');

// ---- results ----

let failed = 0;
let passed = 0;

function check(point, ok, label, detail) {
  if (ok) passed++;
  else failed++;
  const line =
    (ok ? 'ok   ' : 'FAIL ') + point + '. ' + label + (detail ? '  [' + detail + ']' : '');
  console.log(line);
}

const info = text => console.log('     ' + text);

// ---- the relay on this PC ----

const relay = { folder: '', port: 0, address: '', child: null, log: '', pids: [] };

// A copy of the relay outside the project; the test secret is written into that copy only.
function scratchRelay() {
  relay.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-own-relay-check-relay-'));
  const from = path.join(root, 'relay');
  fs.cpSync(path.join(from, 'src'), path.join(relay.folder, 'src'), { recursive: true });
  for (const file of ['wrangler.toml', 'package.json'])
    fs.cpSync(path.join(from, file), path.join(relay.folder, file));
}

function writeRelaySecret(secret) {
  fs.writeFileSync(
    path.join(relay.folder, '.dev.vars'),
    '# Test-only value for `wrangler dev` (tools/desktop-check/own-relay-check.js). Never a real secret.\n' +
      'RELAY_SECRET=' +
      secret +
      '\n'
  );
}

// Does anything answer at the relay's port?
async function relayAnswers() {
  try {
    const response = await fetch(relay.address + '/', { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

// Starts `wrangler dev` in the scratch copy and waits until the relay answers.
async function startRelay() {
  const wranglerJs = process.env.WRANGLER_JS;
  const args = ['dev', '--port', String(relay.port), '--ip', '127.0.0.1'];
  const command = wranglerJs ? process.execPath : 'npx';
  const commandArgs = wranglerJs ? [wranglerJs, ...args] : ['wrangler', ...args];

  // CI=1: wrangler asks nothing and opens no browser
  relay.child = spawn(command, commandArgs, {
    cwd: relay.folder,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    shell: !wranglerJs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  relay.pids.push(relay.child.pid);
  relay.log = '';
  const keep = text => {
    relay.log = (relay.log + text).slice(-8000);
  };
  relay.child.stdout.on('data', keep);
  relay.child.stderr.on('data', keep);
  const child = relay.child;
  await until(
    'the local relay answers',
    async () => {
      if (child.exitCode !== null)
        throw new Error('wrangler dev ended while starting (code ' + child.exitCode + ')');
      return relayAnswers();
    },
    90000,
    500
  );
}

// Ends wrangler and the runtime it started, and waits until the port is silent.
async function stopRelay() {
  const child = relay.child;
  if (child && child.exitCode === null) {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  try {
    await until('the relay is gone', async () => !(await relayAnswers()), 10000, 300);
    return true;
  } catch {
    return false;
  }
}

// ---- the processes this check may leave behind ----

// The ids of every running electron.exe and workerd.exe (Windows only; elsewhere an empty list).
function runtimePids() {
  if (process.platform !== 'win32') return [];
  const found = [];
  for (const image of ['electron.exe', 'workerd.exe']) {
    const listed = spawnSync('tasklist', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq ' + image], {
      encoding: 'utf8',
      windowsHide: true,
    });
    for (const line of String(listed.stdout || '').split(/\r?\n/)) {
      const cells = line.split('","');
      if (cells.length > 1 && cells[0].toLowerCase().includes(image)) found.push(Number(cells[1]));
    }
  }
  return found;
}

// ---- small helpers for the proofs ----

const copies = createCopies('tnai-own-relay-check-');
const { makeApp, startApp, quitApp } = copies;

const state = app => remoteCall(app, 'state');
const page = (app, args) => call(app, 'devices', args);
const userData = app => path.join(app.profile, 'user-data');

// A file in that copy's settings folder as text, or '' when it is not there.
function settingsFile(app, name) {
  try {
    return fs.readFileSync(path.join(userData(app), name), 'latin1');
  } catch {
    return '';
  }
}

// The relay's address and a secret typed into that copy's "Use my own relay" dialog, and Save
// pressed. `opener` is the button that opens the dialog: "Use my own relay" the first time,
// "Change" after that.
async function typeRelay(app, opener, secret) {
  // the row is drawn a moment after the page opens (it asks the main process first)
  await until(
    app.label + ' has a "' + opener + '" button on the Devices page',
    () => page(app, { what: 'press', text: opener }),
    10000,
    500
  );
  await until(app.label + ' shows the relay dialog', async () => {
    const shown = await page(app);
    return shown.dialog?.title === 'Use my own relay';
  });
  const fields = { 'Relay address': relay.address, 'Relay secret': secret };
  if (!(await page(app, { what: 'save', scope: 'dialog', text: 'Save', fields })))
    throw new Error(app.label + ': the relay dialog has no such fields or no Save');
}

// Waits until both copies list the other with a live session. → both states.
async function bothInSession(A, B, ms = 60000) {
  let stateA, stateB;
  await until(
    'both list the other with a live session',
    async () => {
      stateA = await state(A);
      stateB = await state(B);
      return peerOf(stateA, B.id)?.session && peerOf(stateB, A.id)?.session;
    },
    ms
  );
  return { stateA, stateB };
}

// A "needs you" item raised on `from` (as the real CLI's permission hook does), seen on `to`,
// cleared on `from`, seen cleared on `to`. → what was seen.
async function needsYouCrosses(from, to, paneId, agent) {
  await call(from, 'names', { list: [{ paneId, name: agent, agent: 'Claude Code' }] });
  const raised = await call(from, 'raise', { paneId, command: 'git push origin master' });
  const shown = await until(
    to.label + ' sees the item',
    async () => peerOf(await state(to), from.id)?.items.find(item => item.kind === 'permission'),
    20000
  );
  const left = await call(from, 'clear', { paneId });
  const cleared = await until(
    to.label + ' sees it cleared',
    async () => {
      const computer = peerOf(await state(to), from.id);
      return computer && computer.items.length === 0 ? computer : null;
    },
    20000
  );
  const ok =
    raised.length === 1 &&
    raised[0].kind === 'permission' &&
    shown.agent === agent &&
    left.length === 0 &&
    cleared.session === true;
  return { ok, shown, cleared };
}

function git(dir, ...args) {
  const ran = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'Check',
        GIT_AUTHOR_EMAIL: 'check@example.invalid',
        GIT_COMMITTER_NAME: 'Check',
        GIT_COMMITTER_EMAIL: 'check@example.invalid',
      },
    }
  );
  if (ran.status !== 0) {
    const why = String(ran.stderr || ran.error?.message || '').trim();
    throw new Error('git ' + args[0] + ' failed: ' + why.slice(0, 200));
  }
  return ran.stdout.trim();
}

// ---- the proofs ----

// 1: the relay
async function proveRelay(secret) {
  scratchRelay();
  writeRelaySecret(secret);
  relay.port = await freePort();
  relay.address = 'http://127.0.0.1:' + relay.port;
  await startRelay();
  const front = await (await fetch(relay.address + '/')).json();
  check(
    1,
    front.relay === 'technically-not' && !relay.folder.startsWith(root),
    'the public relay runs on this PC on wrangler dev, from a copy outside the project, with a test secret',
    `${relay.address} answers ${JSON.stringify(front)}`
  );
}

// 2: two copies, signed out
async function proveSignedOut(A, B) {
  // No account server is given: the copies are pointed at a port nothing listens on, so nothing
  // this check does can reach the real accounts server.
  const appEnv = { TNAI_ACCOUNTS_URL: 'http://127.0.0.1:1' };
  await startApp(A, appEnv);
  await startApp(B, appEnv);
  const authA = await call(A, 'auth');
  const authB = await call(B, 'auth');
  check(
    2,
    !authA.signedIn && !authB.signedIn && !authA.locked && !authB.locked,
    'two copies of the app run from source with throwaway profiles, both signed out, the plan lock off',
    `A: signed in ${authA.signedIn}, locked ${authA.locked}; B: signed in ${authB.signedIn}, locked ${authB.locked}`
  );
  return appEnv;
}

// 3: each copy on the relay, each with an id of its own
async function proveConnected(A, B, secret) {
  for (const app of [A, B]) {
    await remoteCall(app, 'setOn', true);
    await call(app, 'page', { view: 'devices' });
    await until(app.label + ' shows the Devices page', async () => (await page(app)).onPage);
  }
  await sleep(1500);
  const before = await page(A);
  const stateBefore = await state(A);
  check(
    3,
    stateBefore.connection === 'stopped' &&
      before.lines.includes(SAYS.noRelay) &&
      before.buttons.includes('Use my own relay'),
    'connecting on, signed out, no relay yet: the card says no relay is set and offers "Use my own relay"',
    `A: ${stateBefore.connection} (${stateBefore.reason}); lines ${JSON.stringify(before.lines.slice(0, 2))}`
  );

  for (const app of [A, B]) {
    await typeRelay(app, 'Use my own relay', secret);
    await until(
      app.label + ' is connected',
      async () => (await state(app)).connection === 'online',
      45000
    );
    app.id = (await state(app)).self.id;
  }
  const shownA = await until('A says it is connected', async () => {
    const shown = await page(A);
    return shown.lines.includes(SAYS.connected) ? shown : null;
  });
  const shownB = await until('B says it is connected', async () => {
    const shown = await page(B);
    return shown.lines.includes(SAYS.connected) ? shown : null;
  });
  const row = SAYS.through + relay.address;
  check(
    3,
    shownA.relay === row && shownB.relay === row && !shownA.dialog && !shownB.dialog,
    'each card says "Connected to your other computers." and "Through your own relay:" with the address',
    `A: "${shownA.relay}"; B: "${shownB.relay}"`
  );

  const fileIds = [A, B].map(app => {
    try {
      return JSON.parse(settingsFile(app, 'tnai-own-relay-device.json')).id;
    } catch {
      return '';
    }
  });
  check(
    3,
    A.id !== B.id && fileIds[0] === A.id && fileIds[1] === B.id && A.id.length >= 8,
    'the two copies have different device ids, each the one in its own tnai-own-relay-device.json',
    `A ${A.id.slice(0, 8)}…, B ${B.id.slice(0, 8)}…`
  );

  // the secret is stored protected: it is in neither settings folder as plain text
  const relayFiles = [A, B].map(app => settingsFile(app, 'tnai-own-relay.bin'));
  check(
    3,
    relayFiles.every(text => text.length > 0 && !text.includes(secret)),
    'each profile holds tnai-own-relay.bin, and the secret is not in it as plain text',
    `sizes ${relayFiles.map(text => text.length).join(' and ')} bytes`
  );
}

// 4: each sees the other unpaired, then the six digits
async function provePairing(A, B) {
  const want = other => 'Computer · ' + other.id.slice(0, 8);
  const seen = {};
  for (const [app, other] of [
    [A, B],
    [B, A],
  ]) {
    // The page asks the relay who else is there when it is opened, not when a relay is saved (told
    // below, not judged). So the page is left and opened again, as a user would.
    const withoutLeaving = (await page(app)).cards.some(c => c.id === other.id);
    info(
      app.label +
        ', right after its relay was saved, lists the other copy without the page being opened again: ' +
        withoutLeaving
    );
    await call(app, 'page', { view: 'overview' });
    await sleep(500);
    await call(app, 'page', { view: 'devices' });
    seen[app.label] = await until(
      app.label + ' shows the other copy as an unpaired computer',
      async () => (await page(app)).cards.find(c => c.id === other.id) || null,
      30000,
      500
    );
  }
  check(
    4,
    seen.A.name === want(B) && seen.B.name === want(A) && !seen.A.paired && !seen.B.paired,
    'each copy shows the other as an unpaired computer, "Computer · <8 characters of its id>"',
    `A shows "${seen.A.name}" (${seen.A.state}); B shows "${seen.B.name}" (${seen.B.state})`
  );
  info('the unpaired card on A says: "' + seen.A.says + '"');

  // The flow of remote-check.js: B waits for any computer, A asks B, the two codes are typed both
  // ways (never printed).
  await remoteCall(B, 'pairAny');
  await remoteCall(A, 'pair', B.id);
  const first = await until('A shows a code', async () => (await state(A)).pairing?.shows, 20000);
  await until(
    'B asks for the code',
    async () => (await state(B)).pairing?.state === 'enter',
    20000
  );
  const typedOnB = await remoteCall(B, 'enterCode', first);
  const second = await until(
    'B shows the second code',
    async () => (await state(B)).pairing?.shows,
    20000
  );
  const typedOnA = await remoteCall(A, 'enterCode', second);
  const { stateA, stateB } = await bothInSession(A, B, 30000);
  const cardOnA = (await page(A)).cards.find(c => c.id === B.id);
  const cardOnB = (await page(B)).cards.find(c => c.id === A.id);
  check(
    4,
    /^\d{6}$/.test(first) &&
      /^\d{6}$/.test(second) &&
      typedOnB.ok &&
      typedOnA.ok &&
      stateA.computers.length === 1 &&
      stateB.computers.length === 1 &&
      cardOnA?.paired === true &&
      cardOnB?.paired === true,
    'paired with the two six-digit codes: both list the other as paired, with a live session',
    `A lists "${peerOf(stateA, B.id).name}" ${peerOf(stateA, B.id).state}; B lists "${peerOf(stateB, A.id).name}" ${peerOf(stateB, A.id).state}`
  );
}

// 5a to 5c: a "needs you" item, full control off by default, one prompt once it is on
async function proveTraffic(A, B) {
  const item = await needsYouCrosses(A, B, 'own-relay-check-panel', 'Moss');
  check(
    5,
    item.ok,
    'a "needs you" item on A shows on B with the agent\'s name, and clears on B when it is cleared on A',
    `on B: ${JSON.stringify(item.shown)}; after clearing: ${item.cleared.items.length} items`
  );

  // One small git project, the same in both (B's is a clone in another folder), and a stand-in
  // agent in a real terminal panel of B.
  const projectA = path.join(copies.base, 'shop on A');
  const projectB = path.join(copies.base, 'shop on B');
  fs.mkdirSync(projectA);
  git(projectA, 'init', '-q');
  fs.writeFileSync(path.join(projectA, 'one.txt'), 'one\n');
  git(projectA, 'add', '--', 'one.txt');
  git(projectA, 'commit', '-q', '-m', 'one');
  git(copies.base, 'clone', '-q', projectA, projectB);
  await call(A, 'project', { dir: projectA });
  await call(B, 'project', { dir: projectB });
  const AGENT = 'own-relay-agent';
  const started = await call(B, 'standIn', { paneId: AGENT, name: 'Moss' });
  const bOnA = async () => peerOf(await state(A), B.id);
  const rowOf = computer => (computer?.agents || []).find(agent => agent.id === AGENT);
  const listed = await until(
    "A lists B's agent",
    async () => {
      const computer = await bOnA();
      return rowOf(computer) ? computer : null;
    },
    30000
  );

  // off by default: nothing to press on A, and A's own call sends nothing
  const keysBefore = await call(B, 'keys');
  const pressedOff = (await remoteCall(A, 'prompt', B.id, AGENT, 'Hello from the other computer'))
    .sent;
  await sleep(2000);
  const stateB = await state(B);
  check(
    5,
    peerOf(stateB, A.id).control === false &&
      listed.canControl === false &&
      rowOf(listed).can === false &&
      pressedOff === 'not_sent' &&
      (await call(B, 'keys')) === keysBefore &&
      stateB.controlTotal === 0,
    'full control is off by default: A may not control the agent, a prompt from A is not sent and nothing is written on B',
    `B's agent panel runs the stand-in (pid ${started.pid}); A: can control ${listed.canControl}; A's own call: ${pressedOff}; lines on B ${stateB.controlTotal}`
  );

  // switched on on B: one prompt, end to end
  await remoteCall(B, 'setControl', A.id, true);
  const allowed = await until(
    'A is told it may control the agent',
    async () => {
      const computer = await bOnA();
      return computer?.canControl && rowOf(computer)?.can ? computer : null;
    },
    30000
  );
  const text = 'Say hello through the own relay';
  const sent = await remoteCall(A, 'prompt', B.id, AGENT, text, rowOf(allowed).mark);
  const ended = await until(
    'A reads how the prompt ended',
    async () => {
      const op = (await bOnA())?.ops.find(o => o.n === sent.n);
      return op && !['asked', 'queued'].includes(op.state) ? op : null;
    },
    30000
  );

  // B writes the text behind its own mark for the sender: A as B names it, with the end of its id.
  const nameOfA = peerOf(await state(B), A.id).name.replace(/ \(…[0-9a-f]{4}\)$/, '');
  const mark = '[Sent from ' + nameOfA + ' (…' + A.id.slice(-4) + ')] ';
  const hex = words => Buffer.from(words, 'utf8').toString('hex');
  const got = (await call(B, 'keys')).slice(keysBefore.length);
  const want = hex('\x1b[200~' + mark + text + '\x1b[201~') + '0d';
  const line = (await state(B)).controlLog[0] || {};
  check(
    5,
    sent.sent === 'asked' &&
      ['sent', 'unconfirmed'].includes(ended.state) &&
      got === want &&
      line.op === 'prompt' &&
      line.head === text,
    "full control switched on on B: a prompt from A reaches the agent's terminal on B once, with B's mark, and B lists it",
    `A: "${sent.sent}", then "${ended.state}"; the stand-in got ${got === want ? 'exactly one paste of "' + mark + '" and the text, and one Enter' : 'OTHER BYTES: ' + got.slice(0, 160)}`
  );
}

// 5d: a copy that is quit and started again
async function proveRestart(A, B, appEnv) {
  const how = await quitApp(A);
  const offline = await until(
    'B shows A offline',
    async () => {
      const computer = peerOf(await state(B), A.id);
      return computer && !computer.session && !computer.online ? computer : null;
    },
    45000
  );
  await startApp(A, appEnv);
  const idAfter = (await state(A)).self.id;
  let back = null;
  try {
    await bothInSession(A, B, 60000);
    back = (Date.now() - A.upAt) / 1000;
  } catch {
    /* said below */
  }
  const own = await call(A, 'remote', { fn: 'ownRelay', args: [] });
  check(
    5,
    offline.state === 'offline' && idAfter === A.id && own.set === true && back !== null,
    'A quits: B shows it offline; A starts again with the same profile: same id, same relay, the session is back',
    `A left by ${how}; B then: ${offline.state}; session back ` +
      (back === null ? 'NOT within 60 s' : back.toFixed(1) + " s after A's window was up")
  );
}

// 7: a wrong secret in one copy
async function proveWrongSecret(A, B, secret) {
  await call(B, 'page', { view: 'devices' });
  await typeRelay(B, 'Change', newSecret());
  const stopped = await until(
    'B stops with the sentence for a refused secret',
    async () => {
      const now = await state(B);
      const shown = await page(B);
      return now.connection === 'stopped' && shown.lines.includes(SAYS.wrongSecret)
        ? { now, shown }
        : null;
    },
    45000
  );
  const aSeesGone = await until(
    'A shows B without a session',
    async () => {
      const computer = peerOf(await state(A), B.id);
      return computer && !computer.session ? computer : null;
    },
    45000
  );
  check(
    7,
    stopped.now.reason === 'invalid_proof' &&
      stopped.now.computers.length === 1 &&
      aSeesGone.session === false,
    'a wrong secret in B: its card says the relay refused the secret, the link stops, the pairing is kept',
    `B: ${stopped.now.connection} (${stopped.now.reason}), says "${SAYS.wrongSecret}"; A shows B ${aSeesGone.state}`
  );

  await typeRelay(B, 'Change', secret);
  let back = true;
  try {
    await bothInSession(A, B, 60000);
  } catch {
    back = false;
  }
  const after = await state(B);
  const shown = await page(B);
  check(
    7,
    back && after.connection === 'online' && shown.lines.includes(SAYS.connected),
    'the right secret typed again: B reconnects and the session with A is back',
    `B: ${after.connection}; session back: ${back}`
  );
}

// 6a: a new secret on the relay and in both copies
async function proveNewSecret(A, B) {
  const secret = newSecret();
  const stoppedCleanly = await stopRelay();
  writeRelaySecret(secret);
  await startRelay();
  info('the relay was stopped and started again with a new secret: ' + stoppedCleanly);

  // What a copy with the old secret says meanwhile (told, not judged: point 7 judges that
  // sentence; how soon a copy asks the relay again is the link's own waiting).
  await sleep(4000);
  const meanwhile = await state(A);
  info(`A, still holding the old secret: ${meanwhile.connection} (${meanwhile.reason})`);

  for (const app of [A, B]) {
    await call(app, 'page', { view: 'devices' });
    await typeRelay(app, 'Change', secret);
  }
  let back = true;
  try {
    await bothInSession(A, B, 90000);
  } catch {
    back = false;
  }
  const stateA = await state(A);
  const stateB = await state(B);
  let crossed = { ok: false, shown: null };
  if (back) crossed = await needsYouCrosses(A, B, 'own-relay-check-panel', 'Moss');
  check(
    6,
    back &&
      stateA.computers.length === 1 &&
      stateB.computers.length === 1 &&
      !stateA.pairing &&
      !stateB.pairing &&
      crossed.ok,
    'a new secret on the relay and in both copies: the pairing is kept without pairing again, and a "needs you" item crosses as before',
    `session back: ${back}; paired: A ${stateA.computers.length}, B ${stateB.computers.length}; the item on B: ${crossed.ok ? 'seen and cleared' : 'NOT seen'}`
  );
}

// 6b: the relay removed in one copy
async function proveRemove(A, B) {
  await call(A, 'page', { view: 'devices' });
  await until(
    'A has a "Remove" button on its relay row',
    () => page(A, { what: 'press', text: 'Remove' }),
    10000,
    500
  );
  await until('A asks "Remove your own relay?"', async () => {
    const shown = await page(A);
    return shown.dialog?.title === SAYS.removeTitle;
  });
  await page(A, { what: 'press', scope: 'dialog', text: 'Remove' });
  const asked = await until('A asks again with the count', async () => {
    const shown = await page(A);
    return shown.dialog?.text.includes(SAYS.removesOne) ? shown : null;
  });
  const untouched = await state(A);
  const stillSet = await call(A, 'remote', { fn: 'ownRelay', args: [] });
  check(
    6,
    asked.dialog.title === SAYS.removeTitle &&
      untouched.computers.length === 1 &&
      stillSet.set === true,
    'removing the relay in A asks first with the count, and nothing is changed before the answer',
    `the dialog says "${SAYS.removesOne}"; meanwhile A: paired ${untouched.computers.length}, relay set ${stillSet.set}`
  );

  await page(A, { what: 'press', scope: 'dialog', text: 'Remove' });
  const gone = await until(
    'A has no relay and no pairing',
    async () => {
      const now = await state(A);
      const own = await call(A, 'remote', { fn: 'ownRelay', args: [] });
      return !own.set && now.computers.length === 0 ? { now, own } : null;
    },
    20000
  );

  // The page repaints a moment after the answer: looked at for up to ten seconds. Removing the
  // relay while signed out also turns connecting off, so the page is back at its first screen;
  // either way it must show no relay, no paired computer, and a button that leads back.
  const waysBack = ['Connect my computers', 'Use my own relay'];
  const wayBack = shown => waysBack.find(words => shown.pageButtons.includes(words)) || '';
  const settled = shown =>
    shown.relay === '' &&
    !shown.dialog &&
    !shown.cards.some(card => card.paired) &&
    wayBack(shown) !== '';
  let shown = await page(A);
  for (let attempt = 0; attempt < 20 && !settled(shown); attempt++) {
    await sleep(500);
    shown = await page(A);
  }
  const onB = await until(
    'B shows A without a session',
    async () => {
      const computer = peerOf(await state(B), A.id);
      return computer && !computer.session ? computer : null;
    },
    45000
  );
  check(
    6,
    gone.own.url === '' && settled(shown),
    'on yes: A has no relay and no pairing; its page shows no relay row and no paired computer, and offers a way back',
    `A: ${gone.now.connection} (${gone.now.reason}), connecting on: ${gone.now.on}, paired ${gone.now.computers.length}; its page offers "${wayBack(shown)}", relay row "${shown.relay}", paired cards ${shown.cards.filter(card => card.paired).length}; B still lists A, ${onB.state}`
  );
}

// 8: everything stopped and removed
async function proveCleanUp(runningBefore) {
  const pids = [...copies.apps.flatMap(app => app.pids), ...relay.pids];
  await cleanup();
  await sleep(1500);
  const left = pids.filter(alive);

  // A copy's helper processes (its window and graphics processes) end a moment after the copy
  // itself: looked at for up to fifteen seconds before any is called left over.
  let newRuntimes = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    newRuntimes = runtimePids().filter(pid => !runningBefore.includes(pid));
    if (!newRuntimes.length) break;
    await sleep(500);
  }
  const folders = [copies.base, relay.folder].filter(folder => folder && fs.existsSync(folder));
  check(
    8,
    left.length === 0 &&
      newRuntimes.length === 0 &&
      folders.length === 0 &&
      !(await relayAnswers()),
    'both copies and the relay are stopped: no process this check started still runs, no electron.exe or workerd.exe is left that was not there before, and both temp folders are gone',
    `started pids still running: ${left.join(' ') || 'none'}; new electron.exe or workerd.exe: ${newRuntimes.join(' ') || 'none'}; folders left: ${folders.join(' ') || 'none'}`
  );
}

// ---- stopping, whatever happened ----

let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const app of copies.apps) await quitApp(app, 8000);
  await stopRelay();
  await sleep(800);
  await copies.removeBase();

  // the relay's copy holds the test secret and the runtime's local storage
  for (let attempt = 0; relay.folder && attempt < 20; attempt++) {
    try {
      fs.rmSync(relay.folder, { recursive: true, force: true });
    } catch {
      /* tried again */
    }
    if (!fs.existsSync(relay.folder)) break;
    await sleep(250);
  }
  dropLock();
}

// Also when this program is ended from outside or by its own time limit: nothing may be waited
// for here, so the processes are ended by force and the folders removed at once.
process.on('exit', () => {
  for (const app of copies.apps) {
    const child = app.child;
    if (child && child.exitCode === null && process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else if (child && child.exitCode === null) child.kill('SIGKILL');
  }
  const worker = relay.child;
  if (worker && worker.exitCode === null && process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { stdio: 'ignore' });
  else if (worker && worker.exitCode === null) worker.kill('SIGKILL');
  if (!cleaned) {
    for (const folder of [copies.base, relay.folder]) {
      try {
        if (folder) fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        /* held by a process that is still ending */
      }
    }
  }
  dropLock();
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(signal, () => process.exit(130));
  } catch {
    /* not a signal on this system */
  }
}

// ---- the run ----

async function main() {
  await takeLock('own-relay-check');

  // the whole run is capped: the exit handler stops everything
  const limit = setTimeout(() => {
    console.log('FAIL the whole check took more than 9 minutes: stopped');
    process.exit(1);
  }, 9 * 60e3);
  const runningBefore = runtimePids();
  const A = makeApp('A');
  const B = makeApp('B');
  const secret = newSecret();
  let doing = 'starting the relay';
  try {
    await proveRelay(secret);
    doing = 'starting the two copies';
    const appEnv = await proveSignedOut(A, B);
    doing = 'point 3, connecting through the own relay';
    await proveConnected(A, B, secret);
    doing = 'point 4, pairing';
    await provePairing(A, B);
    doing = 'point 5, traffic';
    await proveTraffic(A, B);
    doing = 'point 5, quitting and starting A again';
    await proveRestart(A, B, appEnv);
    doing = 'point 7, a wrong secret';
    await proveWrongSecret(A, B, secret);
    doing = 'point 6, a new secret';
    await proveNewSecret(A, B);
    doing = 'point 6, removing the relay';
    await proveRemove(A, B);
  } catch (e) {
    failed++;
    console.log('FAIL stopped while ' + doing + ': ' + String(e?.message || e));
    for (const app of copies.apps)
      if (app.out.trim())
        console.log('--- ' + app.label + ' output (end):\n' + copies.lastOutput(app));
    if (/relay/.test(doing))
      console.log('--- wrangler dev (end):\n' + relay.log.split('\n').slice(-15).join('\n'));
  }
  await proveCleanUp(runningBefore);
  clearTimeout(limit);
  console.log(`${passed} passed, ${failed} failed`);
  console.log(failed ? 'OWN RELAY CHECK: FAIL' : 'OWN RELAY CHECK: PASS');
  process.exit(failed ? 1 : 0);
}

main();
