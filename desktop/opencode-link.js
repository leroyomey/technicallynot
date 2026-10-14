/*
 * Technically Not desktop · opencode-link.js — The link to the server each OpenCode terminal panel
 * already runs: its TUI is started with a loopback port and a per-panel password (pty-service.js),
 * and this module reads that server's event stream and calls it. No extra process. Exact status,
 * permission requests, questions, child sessions and step cost come from OpenCode itself instead of
 * the screen.
 *
 * Version gate, per panel, at connect: the panel's own server names its version (/global/health). A
 * version already known good (the shipped opencode-link-tested.json, or one that passed before on
 * this PC) is used at once; any other version must first pass the contract test against that
 * server's own API description (/doc): the routes, event types and answers named in CONTRACT below.
 * Pass: the link is on and the version is remembered. Fail: the link is off for that version
 * (remembered too) and the panel runs as it does without the link. So an OpenCode update needs no
 * app release. tools/opencode-contract-check.js runs the same test against the real binary.
 *
 * Privacy: the password is made here, goes only into the panel's own process environment, is never
 * logged, never put in an event or in state(), and never sent to the renderer. Loopback only; never
 * --mdns (it would bind every network interface). Push only: one long-lived GET /event per panel;
 * pending permissions and status are read again after every reconnect, never polled.
 */
'use strict';
const net = require('net');
const crypto = require('crypto');

// What the link needs from OpenCode's HTTP API (checked against /doc by
// tools/opencode-contract-check.js; shapes seen in 1.18.35).
const CONTRACT = {
  routes: [
    ['GET', '/event'],
    ['GET', '/global/health'],
    ['GET', '/session/status'],
    ['GET', '/permission'],
    ['GET', '/question'],
    ['POST', '/permission/{requestID}/reply'],
    ['POST', '/question/{requestID}/reply'],
    ['POST', '/question/{requestID}/reject'],
    ['GET', '/session/{sessionID}'],
    ['GET', '/session/{sessionID}/children'],
    ['POST', '/session/{sessionID}/abort'],
    ['POST', '/session/{sessionID}/summarize'],
    ['POST', '/tui/append-prompt'],
    ['POST', '/tui/submit-prompt'],
    ['POST', '/tui/clear-prompt'],
  ],
  events: [
    'server.connected',
    'session.status',
    'session.idle',
    'session.error',
    'session.created',
    'session.compacted',
    'permission.asked',
    'permission.replied',
    'question.asked',
    'question.replied',
    'question.rejected',
    'message.updated',
    'message.part.updated',
  ],
  replies: ['once', 'always', 'reject'],
};
const WANTED = new Set(CONTRACT.events);

// Timings (ms). A check may shorten them through tune().
const T = {
  effortPoll: 150,
  first: 400,
  doc: 8000,
  early: 20000,
  retryMin: 300,
  retryMax: 15000,
  call: 4000,
  connect: 5000,
  version: 1500,
  neverUp: 90000,
  lostFor: 120000,
  versionAge: 600000,
};

let tested = [];
try {
  tested = require('./opencode-link-tested.json').versions || [];
} catch {}

// What this PC learned (userData/opencode-link.json): versions whose contract test passed or failed
// here. badNow: versions whose panel ended with an error before its server ever answered (a start
// flag it no longer takes?): no link for them until the app restarts.
let knownFile = '',
  known = { good: [], bad: [] };
const badNow = new Set();
const uniq = list => list.filter((x, i, a) => a.indexOf(x) === i).slice(-20);

function remember(v, good) {
  if (!v || (good ? known.good : known.bad).includes(v)) return;
  known = good
    ? { good: uniq([...known.good, v]), bad: known.bad.filter(x => x !== v) }
    : { good: known.good.filter(x => x !== v), bad: uniq([...known.bad, v]) };
  if (knownFile)
    require('fs')
      .promises.writeFile(knownFile, JSON.stringify(known, null, 1))
      .catch(() => {});
}
const isGood = v => tested.includes(v) || known.good.includes(v);
const isBad = v => !tested.includes(v) && (known.bad.includes(v) || badNow.has(v));

// The contract test: what of CONTRACT an API description (/doc) lacks; [] = everything is there.
function contractMissing(doc) {
  if (!doc || typeof doc !== 'object' || !doc.paths) return ['an API description'];
  const missing = [];
  for (const [method, route] of CONTRACT.routes)
    if (!doc.paths[route]?.[method.toLowerCase()]) missing.push('route ' + method + ' ' + route);
  const schemas = doc.components?.schemas || {},
    types = new Set();
  for (const s of Object.values(schemas)) {
    const t = s?.properties?.type?.enum;
    if (Array.isArray(t) && s.properties.properties) for (const name of t) types.add(name);
  }
  for (const name of CONTRACT.events) if (!types.has(name)) missing.push('event ' + name);
  const reply =
    doc.paths['/permission/{requestID}/reply']?.post?.requestBody?.content?.['application/json']
      ?.schema?.properties?.reply?.enum || [];
  for (const word of CONTRACT.replies)
    if (!reply.includes(word)) missing.push('permission answer "' + word + '"');
  const status = JSON.stringify(schemas.SessionStatus || {});
  for (const word of ['idle', 'busy', 'retry'])
    if (!status.includes('"' + word + '"')) missing.push('session status "' + word + '"');
  if (!schemas.StepFinishPart?.properties?.tokens || !schemas.StepFinishPart?.properties?.cost)
    missing.push('step-finish part with tokens and cost');
  return missing;
}
let readVersion = null,
  version = '',
  versionAt = 0,
  reading = null;
const links = new Map(); // paneId -> link
const listeners = new Set();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function emit(l, type, more) {
  const event = { paneId: l.paneId, type, ...more };
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {}
  }
}

// The installed OpenCode version (`opencode --version`), read when the first OpenCode panel starts
// and again in the background when it is older than ten minutes. A panel start waits for it at most
// T.version ms; not known by then = that panel starts without the link.
function refreshVersion() {
  if (!readVersion || reading) return reading;
  reading = Promise.resolve()
    .then(readVersion)
    .then(
      v => {
        version = String(v || '').trim();
        versionAt = Date.now();
      },
      () => {}
    )
    .finally(() => {
      reading = null;
    });
  return reading;
}
const forcedOff = () => /^(off|0|false)$/i.test(process.env.TNAI_OPENCODE_LINK || '');

// May a panel be started with the link's flags? Yes unless it is switched off or the installed
// version is known not to work with it. (Whether the link is then used is decided at connect, from
// the server's own version and API description.)
function available() {
  if (forcedOff()) return false;

  // OpenCode updates itself: the next start sees the new version
  if (Date.now() - versionAt > T.versionAge) refreshVersion();
  return !!version && !isBad(version);
}

// A free loopback port: asked from the system, then released for OpenCode to take (a few ms apart;
// if another program takes it in between, the password check below keeps us from talking to it and
// the panel runs on as it does without the link).
function freePort() {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function make(paneId, port, password) {
  return {
    paneId,
    id: crypto.randomUUID(),
    port,
    password,
    base: 'http://127.0.0.1:' + port,
    auth: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'),
    closed: false,
    connected: false,
    ever: false,
    since: 0,
    ac: null,
    // sessionID -> { parent: '' | id | null (not known yet), status: 'idle' | 'busy' | 'retry',
    // model: { providerID, modelID } | null }
    sessions: new Map(),
    permissions: new Map(),
    questions: new Map(),
    current: '',
  };
}

// For pty-service.js, before it starts an OpenCode panel: null (start as before), or { id, port,
// env }. Never throws, never waits on OpenCode.
async function launch(paneId) {
  try {
    if (forcedOff()) return null;
    if (!version) await Promise.race([refreshVersion(), sleep(T.version)]);
    if (!available()) return null;
    const port = await freePort();
    if (!port) return null;
    forget(links.get(paneId));
    const l = make(paneId, port, crypto.randomBytes(24).toString('hex'));
    l.installed = version;
    links.set(paneId, l);

    // The user name is set too: a user's own OPENCODE_SERVER_USERNAME would change what the server
    // expects.
    return {
      id: l.id,
      port,
      env: { OPENCODE_SERVER_PASSWORD: l.password, OPENCODE_SERVER_USERNAME: 'opencode' },
    };
  } catch {
    return null;
  }
}

// The panel's process is running: start reading its events.
function started(paneId, id) {
  const l = links.get(paneId);
  if (!l || l.id !== id || l.running) return;
  l.running = true;
  l.since = Date.now();
  run(l);
}

// The panel's process ended (or the panel was closed): stop and forget. `id` keeps a late exit of
// an older process from closing a newer link. exitCode: an error exit soon after the start, before
// the server ever answered, switches the link off for that version until the app restarts.
function close(paneId, id, exitCode) {
  const l = links.get(paneId);
  if (!l || (id && l.id !== id)) return;
  if (exitCode && l.running && !l.ever && l.installed && Date.now() - l.since < T.early)
    badNow.add(l.installed);
  forget(l);
}

function forget(l, why) {
  if (!l || l.closed) return;
  l.closed = true;
  try {
    l.ac?.abort();
  } catch {}
  if (links.get(l.paneId) === l) links.delete(l.paneId);
  if (l.running) emit(l, 'off', { reason: why || 'closed' });
}

async function request(l, method, path, body, ms = T.call) {
  if (!l || l.closed) return { ok: false, status: 0, error: 'no link' };
  try {
    const r = await fetch(l.base + path, {
      method,
      headers: {
        authorization: l.auth,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ms),
    });
    const text = await r.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return {
      ok: r.ok,
      status: r.status,
      data,
      ...(r.ok ? {} : { error: 'OpenCode answered ' + r.status }),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error:
        e?.name === 'TimeoutError'
          ? 'OpenCode did not answer in time'
          : 'OpenCode could not be reached',
    };
  }
}

async function run(l) {
  let wait = T.retryMin;
  await sleep(T.first); // the TUI needs a moment before its server listens
  while (!l.closed) {
    let refused = false;
    try {
      const ac = (l.ac = new AbortController());

      // until the answer's headers arrive; the stream itself has no time limit
      const timer = setTimeout(() => ac.abort(), T.connect);
      let r;
      try {
        r = await fetch(l.base + '/event', {
          headers: { authorization: l.auth, accept: 'text/event-stream' },
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (r.status === 401 || r.status === 403) {
        refused = true;
        try {
          ac.abort();
        } catch {}
      } else if (r.ok && r.body)
        await read(l, r, () => {
          wait = T.retryMin;
        });
    } catch {}
    if (l.closed) return;

    // Our password was refused: whatever listens on this port is not this panel's OpenCode. Stop
    // for good.
    if (refused) {
      emit(l, 'error', {
        name: 'LinkRefused',
        message: 'The server on this panel’s port did not accept the panel’s password',
      });
      return forget(l, 'refused');
    }

    // this OpenCode version lacks something the link uses: off, the panel runs on without it
    if (l.refuse) return forget(l, l.refuse);
    if (l.connected) {
      l.connected = false;
      l.lostAt = Date.now();
      emit(l, 'disconnected', {});
    }
    if (!l.ever && Date.now() - l.since > T.neverUp) return forget(l, 'never answered');
    if (l.ever && Date.now() - l.lostAt > T.lostFor) return forget(l, 'lost');
    await sleep(wait);
    wait = Math.min(wait * 2, T.retryMax);
  }
}

// The gate: '' when this server's version may be used, else why not. One /doc read per new version
// per PC.
async function verify(l) {
  const health = await request(l, 'GET', '/global/health');
  const v = health.ok && health.data?.healthy ? String(health.data.version || '') : '';
  if (!v) return 'OpenCode did not name its version';
  l.version = v;
  if (isGood(v)) return '';
  if (known.bad.includes(v))
    return 'OpenCode ' + v + ' lacks parts the link uses (checked earlier)';
  const r = await request(l, 'GET', '/doc', undefined, T.doc);
  if (!r.ok || !r.data || typeof r.data !== 'object')
    // not remembered: asked again at the next connect
    return 'OpenCode ' + v + ' gave no API description';
  const missing = contractMissing(r.data);
  remember(v, !missing.length);
  return missing.length
    ? 'OpenCode ' +
        v +
        ' lacks: ' +
        missing.slice(0, 6).join(', ') +
        (missing.length > 6 ? ', …' : '')
    : '';
}

// Reads the event stream until it ends. The first event must be OpenCode's own greeting.
async function read(l, r, up) {
  const dec = new TextDecoder();
  let buf = '',
    greeted = false;
  for await (const chunk of r.body) {
    if (l.closed) return;
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      if (!greeted) {
        if (!data.includes('"server.connected"')) throw new Error('not OpenCode');
        greeted = true;
        l.ever = true;
        up();
        const why = await verify(l); // events that arrive meanwhile wait in the stream
        if (l.closed) return;
        if (why) {
          emit(l, 'error', { name: 'LinkContract', message: why });
          l.refuse = 'contract';
          return;
        }
        l.connected = true;
        emit(l, 'connected', { version: l.version });
        resync(l);
        applyEffort(l); // an effort picked for this panel (agent-registry.js), not awaited
        continue;
      }

      // text as it streams: not ours, and by far the most frequent
      if (data.includes('"message.part.delta"')) continue;
      let e;
      try {
        e = JSON.parse(data);
      } catch {
        continue;
      }
      if (e && WANTED.has(e.type)) {
        try {
          handle(l, e.type, e.properties || {});
        } catch {}
      }
    }
    if (buf.length > 4e6) buf = ''; // a block that never ends: drop it instead of growing
  }
}

function session(l, id) {
  let s = l.sessions.get(id);
  if (!s) {
    s = { parent: null, status: 'idle', model: null };
    l.sessions.set(id, s);

    // A session first seen in the middle (a resumed panel, a reconnect): ask once whether it is a
    // child.
    request(l, 'GET', '/session/' + encodeURIComponent(id)).then(r => {
      if (s.parent === null) s.parent = r.ok && r.data?.parentID ? String(r.data.parentID) : '';
      if (s.parent === '' && s.status !== 'idle') l.current = id;
    });
  }
  return s;
}
const isChild = s => !!s.parent;

function setStatus(l, id, st) {
  const s = session(l, id),
    type = st?.type === 'busy' || st?.type === 'retry' ? st.type : 'idle';

  // only a session known to be the panel's own (not a child)
  if (type === 'busy' && s.parent === '') l.current = id;
  if (s.status === type && type !== 'retry') return;
  s.status = type;
  emit(l, 'status', {
    sessionId: id,
    child: isChild(s),
    status: type,
    ...(type === 'retry'
      ? { attempt: st.attempt | 0, message: String(st.message || ''), next: Number(st.next) || 0 }
      : {}),
  });
}
const permissionOf = p => ({
  id: String(p.id),
  sessionId: String(p.sessionID || ''),
  permission: String(p.permission || ''),
  patterns: Array.isArray(p.patterns) ? p.patterns.map(String) : [],
  always: Array.isArray(p.always) ? p.always.map(String) : [],
  metadata: p.metadata && typeof p.metadata === 'object' ? p.metadata : {},
  callId: String(p.tool?.callID || ''),
  at: Date.now(),
});
const questionOf = q => ({
  id: String(q.id),
  sessionId: String(q.sessionID || ''),
  at: Date.now(),
  questions: Array.isArray(q.questions)
    ? q.questions.map(x => ({
        question: String(x.question || ''),
        header: String(x.header || ''),
        options: Array.isArray(x.options)
          ? x.options.map(o => ({
              label: String(o.label || ''),
              description: String(o.description || ''),
            }))
          : [],
        multiple: !!x.multiple,
        custom: !!x.custom,
      }))
    : [],
});

function asked(l, p) {
  if (!p?.id || l.permissions.has(String(p.id))) return;
  const item = permissionOf(p);
  l.permissions.set(item.id, item);
  emit(l, 'permission', { ...item, child: isChild(session(l, item.sessionId)) });
}

function askedQuestion(l, q) {
  if (!q?.id || l.questions.has(String(q.id))) return;
  const item = questionOf(q);
  l.questions.set(item.id, item);
  emit(l, 'question', { ...item, child: isChild(session(l, item.sessionId)) });
}

function handle(l, type, p) {
  if (type === 'session.status') return setStatus(l, String(p.sessionID), p.status);
  if (type === 'session.idle') return setStatus(l, String(p.sessionID), { type: 'idle' });
  if (type === 'session.error') {
    const err = p.error || {};
    return emit(l, 'error', {
      sessionId: String(p.sessionID || ''),
      name: String(err.name || 'Error'),
      message: String(err.data?.message || err.message || '').slice(0, 2000),
    });
  }
  if (type === 'session.created') {
    const info = p.info || {},
      id = String(p.sessionID || info.id || '');
    if (!id) return;
    const s = session(l, id);
    s.parent = info.parentID ? String(info.parentID) : '';
    if (!s.parent && s.status !== 'idle') l.current = id;
    if (s.parent)
      emit(l, 'child', { sessionId: id, parentId: s.parent, title: String(info.title || '') });
    return;
  }

  // A compaction ended. Its size comes from the summary answer's own last step (seen just before on
  // the stream): the number OpenCode's footer shows afterwards (real run 2026-10-06: 591, footer
  // "591 (0%)"). Left out when that step was not seen (never guessed).
  if (type === 'session.compacted') {
    const id = String(p.sessionID || ''),
      s = session(l, id),
      step = s.lastStep;
    return emit(l, 'compacted', {
      sessionId: id,
      ...(step && step.messageId && step.messageId === s.summaryMessage
        ? { context: { total: step.total, ...step.tokens, at: step.at } }
        : {}),
    });
  }
  if (type === 'permission.asked') return asked(l, p);
  if (type === 'permission.replied') {
    const id = String(p.requestID || '');
    l.permissions.delete(id);
    return emit(l, 'permission-replied', {
      id,
      sessionId: String(p.sessionID || ''),
      reply: String(p.reply || ''),
    });
  }
  if (type === 'question.asked') return askedQuestion(l, p);
  if (type === 'question.replied' || type === 'question.rejected') {
    const id = String(p.requestID || '');
    l.questions.delete(id);
    return emit(l, 'question-done', {
      id,
      sessionId: String(p.sessionID || ''),
      rejected: type === 'question.rejected',
    });
  }
  if (type === 'message.updated') {
    // which model a session runs on (summarize needs it), and which answer is a compaction's
    // summary
    const info = p.info || {};
    if (
      info.role === 'assistant' &&
      (info.summary === true || info.mode === 'compaction') &&
      info.id
    )
      session(l, String(info.sessionID || p.sessionID)).summaryMessage = String(info.id);
    if (info.role === 'assistant' && info.providerID && info.modelID)
      session(l, String(info.sessionID || p.sessionID)).model = {
        providerID: String(info.providerID),
        modelID: String(info.modelID),
      };
    return;
  }
  if (type === 'message.part.updated') {
    const part = p.part || {};
    if (part.type !== 'step-finish') return;
    const t = part.tokens || {},
      id = String(part.sessionID || p.sessionID || '');
    const tokens = {
      input: t.input | 0,
      output: t.output | 0,
      reasoning: t.reasoning | 0,
      cacheRead: t.cache?.read | 0,
      cacheWrite: t.cache?.write | 0,
    };
    session(l, id).lastStep = {
      messageId: String(part.messageID || ''),
      tokens,
      total:
        Number(t.total) ||
        tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite,
      at: Date.now(),
    };
    return emit(l, 'step', {
      sessionId: id,
      child: isChild(session(l, id)),
      messageId: String(part.messageID || ''),
      reason: String(part.reason || ''),
      cost: Number(part.cost) || 0,
      tokens,
    });
  }
}

// After every (re)connect: what is waiting and what is busy now, since events sent while we were
// away are gone.
async function resync(l) {
  const [perms, quests, status] = await Promise.all([
    request(l, 'GET', '/permission'),
    request(l, 'GET', '/question'),
    request(l, 'GET', '/session/status'),
  ]);
  if (l.closed) return;
  if (perms.ok && Array.isArray(perms.data)) {
    const now = new Set(perms.data.map(p => String(p.id)));
    for (const [id, item] of [...l.permissions])
      if (!now.has(id)) {
        l.permissions.delete(id);
        emit(l, 'permission-replied', { id, sessionId: item.sessionId, reply: '' });
      } // answered while we were away
    for (const p of perms.data) asked(l, p);
  }
  if (quests.ok && Array.isArray(quests.data)) {
    const now = new Set(quests.data.map(q => String(q.id)));
    for (const [id, item] of [...l.questions])
      if (!now.has(id)) {
        l.questions.delete(id);
        emit(l, 'question-done', { id, sessionId: item.sessionId, rejected: false });
      }
    for (const q of quests.data) askedQuestion(l, q);
  }
  if (status.ok && status.data && typeof status.data === 'object') {
    for (const [id, st] of Object.entries(status.data)) setStatus(l, id, st);
    for (const [id, s] of l.sessions)
      // a session not listed is idle
      if (s.status !== 'idle' && !(id in status.data)) setStatus(l, id, { type: 'idle' });
  }
}

const linkOf = paneId => {
  const l = links.get(paneId);
  return l && !l.closed ? l : null;
};
const result = r =>
  r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error, status: r.status };

// Effort (a model's "variant"), added by the models work 2026-10-06. Seen with the real 1.18.35
// binary: the TUI sends its own variant with every prompt and keeps it per model in its state file
// (<state>/opencode/model.json, `variant`); a variant in the session config or on the session (POST
// /session, POST /api/session/{id}/model) is not taken by the TUI, and POST /tui/execute-command
// answers true and does nothing for it. What works is the TUI's own "variant.cycle" command,
// published as a TUI event: it steps none → first level → … → last → none and writes each step to
// that file. So the wanted level is reached by stepping and reading the file after each step (read
// only, never written here), at most a little over two rounds. Side effect, as when the user
// presses the key: OpenCode keeps that level for the model. Not in CONTRACT: a server without
// /tui/publish only leaves the effort as it was.
const variantFile = () =>
  require('path').join(
    process.env.XDG_STATE_HOME || require('path').join(require('os').homedir(), '.local', 'state'),
    'opencode',
    'model.json'
  );
const storedVariant = model => {
  try {
    const v = JSON.parse(require('fs').readFileSync(variantFile(), 'utf8')).variant?.[model];
    return typeof v === 'string' && v !== 'default' ? v : '';
  } catch {
    return '';
  }
};

async function applyEffort(l) {
  const e = l.effort;

  // done once: a level the user picks later in the TUI is theirs
  if (!e || e.busy || e.done || l.closed || !l.connected) return;
  e.busy = true;
  try {
    let silent = 0;
    for (let steps = 0; steps < e.variants.length * 2 + 3 && !l.closed && l.effort === e;) {
      const now = storedVariant(e.model);
      if (now === e.want) {
        e.done = true;
        e.steps = steps;
        e.settle?.();
        return;
      }
      const r = await request(l, 'POST', '/tui/publish', {
        type: 'tui.command.execute',
        properties: { command: 'variant.cycle' },
      });
      if (!r.ok && r.status) break; // this server has no such route: leave the effort as it is
      let moved = false;
      for (let i = 0; i < 12 && !moved; i++) {
        await sleep(T.effortPoll);
        moved = storedVariant(e.model) !== now;
      }
      if (moved) {
        steps++;
        silent = 0;
      } else if (++silent > 6) break; // the TUI is not drawn yet for the first tries; then give up
    }
    e.failed = true;
    e.settle?.(); // left as it was; nothing is reported as set
  } finally {
    e.busy = false;
  }
}
const seg = encodeURIComponent;

// The panel's own (top) session: the one last seen busy, else the only one known that is not a
// child.
function currentSession(l) {
  if (l.current) return l.current;
  const tops = [...l.sessions].filter(([, s]) => s.parent === '').map(([id]) => id);
  return tops.length === 1 ? tops[0] : '';
}

module.exports = {
  CONTRACT,
  contractMissing,
  // { version: async () => 'the installed OpenCode version', dir: the app's own settings folder }.
  // One line in main.js; nothing here reaches the renderer.
  init(deps = {}) {
    readVersion = deps.version || null;
    version = '';
    versionAt = 0;
    if (deps.dir) {
      knownFile = require('path').join(deps.dir, 'opencode-link.json');
      try {
        const k = JSON.parse(require('fs').readFileSync(knownFile, 'utf8'));
        known = { good: (k.good || []).map(String), bad: (k.bad || []).map(String) };
      } catch {}
    }
  },
  available,
  launch,
  started,
  close,
  // available(), once the installed version was read for the first time (at most 5 s): the model
  // list is asked for at app start, before any OpenCode panel made the link read it, and an early
  // "not available" would hide OpenCode's effort levels until the list is read again.
  async ready() {
    if (!version && !forcedOff()) await Promise.race([refreshVersion(), sleep(5000)]);
    return available();
  },
  // Events, one object each: { paneId, type, ... }. Types: connected { version } (only after the
  // version gate passed), disconnected, off { reason }, status { sessionId, child, status:
  // busy|idle|retry, attempt, message, next }, error { sessionId, name, message }, permission { id,
  // sessionId, child, permission, patterns, always, metadata, callId }, permission-replied { id,
  // sessionId, reply: once|always|reject|'' (gone while we were away) }, question { id, sessionId,
  // child, questions }, question-done { id, sessionId, rejected }, child { sessionId, parentId,
  // title }, step { sessionId, child, messageId, reason, cost, tokens }, compacted { sessionId,
  // context?: { total, input, output, reasoning, cacheRead, cacheWrite, at } } (context = the size
  // after it, when seen). Returns the function that stops listening.
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // What is known about a panel now (no port, no password): null when it has no link.
  state(paneId) {
    const l = linkOf(paneId);
    if (!l) return null;
    const id = currentSession(l);
    return {
      connected: l.connected,
      sessionId: id,
      status: id ? l.sessions.get(id)?.status || 'idle' : 'idle',
      permissions: [...l.permissions.values()],
      questions: [...l.questions.values()],
      children: [...l.sessions]
        .filter(([, s]) => isChild(s))
        .map(([sid, s]) => ({ sessionId: sid, parentId: s.parent, status: s.status })),
    };
  },
  // Every panel's open questions (attention-service.js): [{ paneId, id, sessionId, at, questions
  // }]. child: asked by a sub-session, or by a session this link does not know (read as "not the
  // main one": a choice from another computer is only for a question of the panel's own session,
  // remote-protocol.md 6i).
  questions: () =>
    [...links.values()].flatMap(l =>
      l.closed
        ? []
        : [...l.questions.values()].map(q => ({
            paneId: l.paneId,
            ...q,
            // '' is the one value that says "the main session"; an id, null (not known yet) and
            // no record are not
            child: l.sessions.get(q.sessionId)?.parent !== '',
          }))
    ),
  // Calls. Each resolves to { ok: true, data } or { ok: false, error, status } and never throws;
  // each has its own short time limit.
  async reply(paneId, permissionId, answer, message) {
    if (!CONTRACT.replies.includes(answer))
      return { ok: false, error: 'The answer must be once, always or reject', status: 0 };
    return result(
      await request(linkOf(paneId), 'POST', '/permission/' + seg(permissionId) + '/reply', {
        reply: answer,
        ...(message ? { message: String(message) } : {}),
      })
    );
  },
  // answers: one array of chosen labels per question, in the question's order.
  async answer(paneId, questionId, answers) {
    const list = (Array.isArray(answers) ? answers : [answers]).map(a =>
      Array.isArray(a) ? a.map(String) : [String(a)]
    );
    return result(
      await request(linkOf(paneId), 'POST', '/question/' + seg(questionId) + '/reply', {
        answers: list,
      })
    );
  },
  async rejectQuestion(paneId, questionId) {
    return result(
      await request(linkOf(paneId), 'POST', '/question/' + seg(questionId) + '/reject')
    );
  },
  async abort(paneId, sessionId) {
    const l = linkOf(paneId),
      id = sessionId || (l && currentSession(l));
    if (!id) return { ok: false, error: 'No session is known for this panel yet', status: 0 };
    return result(await request(l, 'POST', '/session/' + seg(id) + '/abort'));
  },
  // model: 'provider/model' or { providerID, modelID }; left out = the model the session last
  // answered with (seen on the stream).
  async summarize(paneId, sessionId, model) {
    const l = linkOf(paneId),
      id = sessionId || (l && currentSession(l));
    if (!id) return { ok: false, error: 'No session is known for this panel yet', status: 0 };
    let m = model || l.sessions.get(id)?.model;
    if (typeof m === 'string') {
      const cut = m.indexOf('/');
      m = cut > 0 ? { providerID: m.slice(0, cut), modelID: m.slice(cut + 1) } : null;
    }
    if (!m?.providerID || !m?.modelID)
      return { ok: false, error: 'The session’s model is not known yet', status: 0 };
    return result(
      await request(
        l,
        'POST',
        '/session/' + seg(id) + '/summarize',
        { providerID: m.providerID, modelID: m.modelID },
        600000
      )
    ); // answers when the compaction is done
  },
  // The effort a panel should run its model at (agent-registry.js spec(), which knows the panel
  // only by its port): applied once the link is connected, see applyEffort. variants: that model's
  // levels in OpenCode's own order. False when no link has that port.
  effort(port, model, want, variants) {
    const l = [...links.values()].find(x => x.port === port && !x.closed),
      list = (Array.isArray(variants) ? variants : []).map(String);
    if (!l || !model || !list.includes(want)) return false;
    const e = (l.effort = {
      model: String(model),
      want: String(want),
      variants: list,
      at: Date.now(),
    });
    e.settled = new Promise(resolve => {
      e.settle = resolve;
    });
    applyEffort(l);
    return true;
  },
  // For prompt-submit.js: null when no effort is being set for this panel (the usual case), else a
  // promise that ends when it was set or given up, and in any case 15 s after it was asked for (a
  // link that never connects must not hold a prompt).
  effortSettled(paneId) {
    const e = linkOf(paneId)?.effort;
    if (!e || e.done || e.failed) return null;
    const left = 15000 - (Date.now() - e.at);
    if (left <= 0) return null;
    return Promise.race([e.settled, sleep(left)]);
  },
  // For the composer's Effort control (main.js agents:effortState): { linked: this panel has a
  // connected link, and when an effort was asked for it: model, want, set: true | false | null
  // (still trying), now: the level OpenCode has saved for that model ('' = its default) }.
  effortState(paneId) {
    const l = linkOf(paneId),
      e = l?.effort;
    return {
      linked: !!l?.connected,
      ...(e
        ? {
            model: e.model,
            want: e.want,
            set: e.done ? true : e.failed ? false : null,
            now: storedVariant(e.model),
          }
        : {}),
    };
  },
  async appendPrompt(paneId, text) {
    return result(
      await request(linkOf(paneId), 'POST', '/tui/append-prompt', { text: String(text ?? '') })
    );
  },
  async submitPrompt(paneId) {
    return result(await request(linkOf(paneId), 'POST', '/tui/submit-prompt'));
  },
  async clearPrompt(paneId) {
    return result(await request(linkOf(paneId), 'POST', '/tui/clear-prompt'));
  },
  async children(paneId, sessionId) {
    const l = linkOf(paneId),
      id = sessionId || (l && currentSession(l));
    if (!id) return { ok: false, error: 'No session is known for this panel yet', status: 0 };
    const r = await request(l, 'GET', '/session/' + seg(id) + '/children');
    return r.ok && Array.isArray(r.data)
      ? {
          ok: true,
          data: r.data.map(c => ({
            sessionId: String(c.id),
            parentId: String(c.parentID || id),
            title: String(c.title || ''),
          })),
        }
      : result({ ...r, ok: false, error: r.error || 'Unexpected answer' });
  },
  // Checks only (tools/desktop-check/opencode-link-check.js and the real run): a link to a server
  // already running, shorter timings, a version list.
  attach(paneId, port, password) {
    forget(links.get(paneId));
    const l = make(paneId, port, password);
    links.set(paneId, l);
    started(paneId, l.id);
    return l.id;
  },
  tune(times, versions) {
    Object.assign(T, times || {});
    if (versions) tested = versions;
  },
  known: () => ({ good: [...known.good], bad: [...known.bad], badNow: [...badNow] }),
};
