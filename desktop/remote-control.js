// Technically Not · remote-control.js — the checks for the control operations one paired computer
// may ask of another: a prompt for an agent, an interrupt, a stop, a start
// ("change n" below names a numbered change of their design), and the text rules for a longer
// command to answer
// (changes 7 and 8). Nothing in the app loads this file yet. Pure Node, no Electron, no file or
// process access: the clock, the timers, random bytes, the rights, the agent as it is now, every
// delivery and the sending are handed in. It decides whether another computer may make an agent on
// THIS computer do something, so each rule is one check below:
// - The wiring never calls `receive` for a computer whose control switch is off; called anyway, it
// does nothing and answers nothing (change 10). Rights are read as one thing: rights(peerId) → the
// pairing id the switch is on for, or ''.
// - The per-computer count comes first, before anything is looked at, a message of the wrong shape
// counts, and past a limit nothing is done and nothing is sent back (change 10, 16): 10 prompts, 4
// interrupts or stops and 3 starts a minute, starts also 6 in 10 minutes.
// - Every message carries a one-time number `n` (16 hex characters) that is remembered for 10
// minutes per computer once it was taken.
// - A message that was held back is refused (change 13): it echoes the newest number this computer
// stamped on a message for that computer (`stamp`) and the milliseconds since that arrived; more
// than 60 s beyond that by this computer's clock is too late.
// - Which agent: the row id must be clean and unchanged by cleaning (so it names one panel), the
// agent is asked from agentNow(panelId) at this moment and must be a process the app itself started
// as an agent (change 3), and the message's ticket must equal the one made now (change 5): an HMAC
// under a key made once per start that never leaves this file.
// - A prompt starts with a word (change 1) and the whole message fits one sealed message (change
// 7): refused, never repaired, shortened or split.
// - Take before deliver: `n` is marked taken and the log entry written, then the delivery is
// called; a delivery that fails is never tried again from here.
// - What was checked on arrival is checked again at the write (change 4): every delivery gets a
// `guard` to call in the same turn as each of its writes. A taken prompt that has not ended is
// counted (3 per panel, 10 per computer) and dropped after 10 minutes.
// - A reply is one of a few fixed words (change 10): nothing of a delivery's result or error text
// can cross.
//
// Messages read (anything else is not this file's; fields not named here are never looked at):
// { t: 'prompt', n, c, ms, id, to, text } id: the agent row's id (its panel id), to: the ticket
// from that row { t: 'act', n, c, ms, id, to, do: 'interrupt' | 'stop' } { t: 'start', n, c, ms,
// cli: 'claude' | 'codex' | 'opencode' | 'cursor', project: the first-commit key (section 6e),
// text? } Replies sent through send(peerId, obj), each built by shapeReply: { t: 'prompted', n, ok,
// state } sent · queued (held on this computer; one more `prompted` follows for the same n) ·
// unconfirmed (it was written and Enter pressed once, and this CLI gives no sign that it started:
// neither "sent", which is not known, nor "failed", which would invite a second send) · refused ·
// failed { t: 'acted', n, ok, state } done · unsent (interrupted, and the task's prompt is back in
// its input: change 12) · refused · failed { t: 'started', n, ok, why? } ok, or why: refused ·
// failed
//
// What createControl is handed. Every one is called inside try/catch, and a missing or throwing one
// reads as the refusing answer. now() → ms (a clock that does not jump) · timers { set(fn, ms) →
// handle, clear(handle) } · random(n) → Buffer of n bytes rights(peerId) → the pairing id the
// control switch is on for now, or '' live(peerId) → true while its session is live
// peerName(peerId) → the computer's name as this computer shows it send(peerId, obj) → the link's
// send (trust.send) agentNow(panelId) → null, or what that panel runs at this moment, read from
// ptys.list() and the mesh and never from a kept list: { name, cli, mode, running, hand, instance,
// pid, startedAt } (cli: ptys' `agent`, 'Terminal' for a shell; hand: a CLI typed by hand, must be
// exactly false; instance: lifecycle.instanceOf) clis() → the lead CLIs installed and signed in
// here now, by name (['Claude Code', 'Codex']) openKey() → the key of the project open here now, ''
// while none is open or its key is not known yet remoteStarted() → how many panels started from
// other computers this computer's user has not closed yet (stopped ones count) startsToday(peerId)
// → how many starts that computer was given in the last 24 hours, and startTaken(peerId, ms) → one
// more now: optional, for an app that keeps the count of a day across its own restart; without them
// the count lasts as long as this object log(entry) → entry = { peerId, from, agent, op, head,
// length, more }: op 'prompt' | 'interrupt' | 'stop' | 'start', once per taken operation and before
// its delivery; op 'dropped' when a taken prompt was removed unwritten. head: the first 100
// characters as one clean line, length: all of them, more: those not in head. The deliveries. Each
// returns a word or a promise of one; anything else, a throw and a rejection all read as 'failed':
// prompt({ key, peerId, panelId, text, guard, from, done }) → 'sent' | 'queued' | 'unconfirmed' |
// 'refused' | 'failed'. text is cleaned as a paste and goes in unchanged. guard() → true while it
// may still be written; false means drop it (this file has then told the other computer and logged
// it). 'queued': the delivery holds it and later calls done('sent' | 'unconfirmed' | 'failed')
// once. from: the computer's name (change 15). interrupt(panelId, guard) → 'done' | 'unsent' |
// 'refused' | 'failed' stop(panelId, guard) → 'done' | 'refused' | 'failed' start({ peerId, cli,
// text, guard, from }) → 'started' | 'refused' | 'failed'. cli is a name from the fixed list below,
// text '' or a first prompt. guard(panelKey) → true while the opened panel may be used and `text`
// may go in: panelKey is that panel's own project key. cancel(key, panelId) → remove that held
// prompt unwritten (the switch went off, or its 10 minutes passed).
//
// The waits, and what is asked again after each (change 4: "synchronous from the rights check to
// finish" cannot hold here): prompt from the count to the call of `prompt` nothing waits. Held, the
// paste, each Enter: guard() again, in the turn of the write. interrupt, stop from the count to the
// call nothing waits. A delivery that waits before its write calls guard() again. start from the
// count to the call of `start` nothing waits. The panel opening (up to 90 s), its own start
// questions, `text`: guard(the opened panel's key) before the panel is used and again before `text`
// goes in; false: stop the panel, 'failed'.
const crypto = require('crypto');
const { clean } = require('./remote-keys.js');
const { fields, MAX_PLAIN } = require('./remote-noise.js');
const { projectKey, wholeShell } = require('./remote-api.js');
const { bindingOf } = require('./phone-answer.js');

// choose (6i): "option N of the question that was shown", one message a choice
const PER_MINUTE = { prompt: 10, act: 4, start: 3, choose: 6, file: 3, sync: 2 };

// a choice the relay held for longer than this is refused
const CHOOSE_FRESH_MS = 5000;
const START_10MIN = 6,
  START_DAY = 20,
  START_OPEN = 3; // change 6: a start's own bounds, whatever the user's sub-agent settings are
const MINUTE = 60 * 1000,
  DAY_MS = 24 * 60 * MINUTE;
const N_MS = 10 * MINUTE; // a taken `n` is remembered this long

// a taken prompt that has not ended is dropped after this (change 4: the time `n` is remembered)
const HELD_MS = 10 * MINUTE;
const HELD_PANEL = 3,
  HELD_PEER = 10;
const FRESH_MS = MINUTE; // change 13

// stamps remembered per computer: the agent list goes at most every 3 s, so more than the 60 s that
// count
const STAMPS = 32;
const FULL_MAX = 1200; // a longer command: what this computer's own card shows

// The CLI words that may cross for a start, looked up with Object.hasOwn: `tnai new`'s own lookup
// takes "constructor".
const CLIS = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor Agent',
};

// A file with a prompt (remote-files.js holds its rules): `file`
// is the offer of one file, answered `filed` (go, or a refusal); `promptf` is a prompt that names
// finished files, counted and answered as a prompt.
const TYPES = {
  prompt: 'prompted',
  act: 'acted',
  start: 'started',
  choose: 'chosen',
  file: 'filed',
  promptf: 'prompted',
  sync: 'synced',
};

// The git hand-over: `sync` names one commit, `synced` answers
// with one word. SYNC_NO: the words that say why nothing was done; like every reply, never git's
// own text. 6 a day for one computer.
const SYNC_NO = ['absent', 'offline', 'signin', 'remote', 'kept', 'project', 'busy', 'large'];
const SYNC_DAY = 6;
const commitId = v => (typeof v === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v) ? v : '');
const GOOD = {
  prompted: ['sent', 'queued', 'unconfirmed'],
  acted: ['done', 'unsent'],
  started: ['started'],
  chosen: ['done'],
  filed: ['go'],
  synced: ['done', 'same'],
};

// An agent's message for an agent here:
// `say`, answered `said` with a prompt's words. Its own counts: 4 a minute
// (PER_MINUTE.say) and SAY_DAY in 24 hours for one computer.
TYPES.say = 'said';
GOOD.said = GOOD.prompted;
PER_MINUTE.say = 4;
const SAY_DAY = 10;
const WORDS = {
  prompt: ['sent', 'queued', 'unconfirmed', 'refused', 'failed'],
  interrupt: ['done', 'unsent', 'refused', 'failed'],
  stop: ['done', 'refused', 'failed'],
  start: ['started', 'refused', 'failed'],
  choose: ['done', 'refused', 'failed'],
};

// ---- Thread controls and Resume (plan item 44; the values are remote-thread.js) ----
// `thread`: rename, close, model or effort of one agent's thread, with the row's ticket, answered
// `threaded` (done, busy, refused, failed); 6 a minute for one computer. `resume`: start a past
// conversation of this computer again, named by the handle of the list this computer sent
// (remote-thread.js createPastAnswerer), answered `resumed`. A resume is a start: it is counted
// with the starts and has their bounds (3 a minute, 6 in 10 minutes, 20 a day, 3 open).
const { threadValue, threadCan, THREAD_WORDS } = require('./remote-thread.js');
TYPES.thread = 'threaded';
TYPES.resume = 'resumed';
GOOD.threaded = ['done'];
GOOD.resumed = ['started'];
PER_MINUTE.thread = 6;
WORDS.thread = THREAD_WORDS;
WORDS.resume = ['started', 'refused', 'failed'];

// A choice. The other
// computer never sends a key: it sends "option N of the question I was shown". These three are the
// item's side of it, as withFull / readFull / bindingOf2 are for `full`. A label is one clean line
// of at most 80 characters; a question takes a choice only with 1 to 9 labels that are all
// different.
const pickLabels = v =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 9 &&
  v.every(l => typeof l === 'string' && l !== '' && clean(l, 80) === l) &&
  new Set(v).size === v.length
    ? [...v]
    : null;

// The binding of such a question: every field the user was shown and the agent row it belongs to,
// under its own label, so it is never an answer's binding (`bindingOf`, `bindingOf2`).
const bindingPick = it =>
  crypto
    .createHash('sha256')
    .update(
      fields(
        'tnai-key-v1',
        it.id,
        it.kind,
        it.agent,
        it.detail || '',
        String(it.since),
        String(it.row || ''),
        String((it.opts || []).length),
        ...(it.opts || [])
      )
    )
    .digest()
    .subarray(0, 12)
    .toString('base64');

// The sender's side: s as remote-api's shape() made it, it the app's own item ({ paneId, opts }).
// The labels and the agent row's id are added only to a question the CLI itself reported, with its
// text, and only when the item still fits one message with them.
function withPick(s, it) {
  const opts = it && typeof it === 'object' ? pickLabels(it.opts) : null,
    row =
      it && typeof it.paneId === 'string' && it.paneId !== '' && clean(it.paneId, 80) === it.paneId
        ? it.paneId
        : '';
  if (!s || typeof s !== 'object' || s.kind !== 'menu' || s.inferred || !s.detail || !opts || !row)
    return s;
  const out = { ...s, opts, row };
  return fitsOne({ t: 'needs', g: Number.MAX_SAFE_INTEGER, i: 99, n: 99, items: [out] }) ? out : s;
}

// The receiver's side: raw as it arrived, s as shape() read it. The same rule on untrusted text;
// `kof` is the binding to send back.
function readPick(s, raw) {
  const opts = raw && typeof raw === 'object' ? pickLabels(raw.opts) : null,
    row =
      raw && typeof raw.row === 'string' && raw.row !== '' && clean(raw.row, 80) === raw.row
        ? raw.row
        : '';
  if (!s || typeof s !== 'object' || s.kind !== 'menu' || s.inferred || !s.detail || !opts || !row)
    return s;
  const out = { ...s, opts, row };
  out.kof = bindingPick(out);
  return out;
}
const HEX16 = /^[0-9a-f]{16}$/;
const hex16 = v => (typeof v === 'string' && HEX16.test(v) ? v : '');

// ---- the text rules (pure; the sending computer uses the same ones before it sends) ----

// A prompt from another computer (operation 1, change 1). Cleaned exactly as prompt-submit.js
// cleans a paste (line ends to \n, control characters but tab and line feed removed), then refused,
// never repaired, unless it has a first visible character and that is a letter or a digit of any
// script: a first "!" is a CLI's shell mode, a first "/" one of its own commands, and what is
// dangerous first differs per CLI, so this is an allow rule. "Visible" is `clean`'s rule, so a
// zero-width or filler character before the "!" does not hide it. → the text to deliver, or ''
// (refused).
function promptText(v) {
  if (typeof v !== 'string') return '';
  const body = v.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
  return /^[\p{L}\p{N}]/u.test(clean(body, Infinity)) ? body : '';
}

// The limit is bytes (change 7): the whole message as JSON must fit one sealed message. Never
// shortened, never split.
const bytesOf = m => {
  try {
    return Buffer.byteLength(JSON.stringify(m));
  } catch {
    return Infinity;
  }
};
const fitsOne = m => bytesOf(m) <= MAX_PLAIN;

// for the composer of the sending computer: the bytes still free in this message
const roomLeft = m => MAX_PLAIN - bytesOf(m);

// A longer command to answer (change 8), tested against the raw command and never against the
// card's clipped text: split at \n only; no \r, tab or other control character, no U+0085, U+2028
// or U+2029; each line passes `clean`'s invisible and direction-character rule and has no white
// space at its end (so the command does not end in a line break either); leading and inner spaces
// are kept. Counted in UTF-16 units, which is never fewer than characters. Each line is tested with
// its spaces stood in for: `clean` joins runs of spaces, which is right for one shown line and
// wrong for a command.
function fullText(command) {
  if (
    typeof command !== 'string' ||
    !command ||
    command.length > FULL_MAX ||
    /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/.test(command)
  )
    return false;
  return command.split('\n').every((l, i, all) => {
    const p = l.replace(/ /g, '_');
    return !l.endsWith(' ') && (l !== '' || i < all.length - 1) && clean(p, Infinity) === p;
  });
}
const fullShell = (tool, command) =>
  typeof tool === 'string' && tool !== '' && clean(tool, 40) === tool && fullText(command);

// How a held shell request may be answered from another device: 'whole' (6c: its short text is all
// of it, hint `can`, binding v1), 'full' (the whole command travels as `full`, hint `can2`, binding
// v2), or '' (not at all). Never both. As with wholeShell, that the tool is a shell tool is the
// caller's check (agent-hooks.js SHELL_TOOLS).
const answerWay = (tool, command) =>
  wholeShell(tool, command) ? 'whole' : fullShell(tool, command) ? 'full' : '';

// The sender's side of `full`: s is the item as remote-api's shape() made it. It gets `full` and
// `can2` only when it is a permission request this computer did not guess, is not already
// answerable as `can`, and still fits one part alone with them (change 7: an item that fits no part
// took the whole list with it); otherwise it goes as it was and is not answerable through `full`.
function withFull(s, tool, command) {
  if (
    !s ||
    typeof s !== 'object' ||
    s.kind !== 'permission' ||
    s.inferred ||
    !s.detail ||
    s.can === true ||
    !fullShell(tool, command)
  )
    return s;
  const out = { ...s, full: command, can2: true };
  return fitsOne({ t: 'needs', g: Number.MAX_SAFE_INTEGER, i: 99, n: 99, items: [out] }) ? out : s;
}

// The receiver's side: raw as it arrived, s as shape() read it. The same rule again, on untrusted
// text.
function readFull(s, raw) {
  if (
    !s ||
    typeof s !== 'object' ||
    !raw ||
    typeof raw !== 'object' ||
    raw.can2 !== true ||
    raw.can === true ||
    s.kind !== 'permission' ||
    s.inferred ||
    !s.detail ||
    !fullText(raw.full)
  )
    return s;
  return { ...s, full: raw.full, can2: true };
}

// The v2 binding: the fields of `bindingOf` (phone-answer.js) and `full`, under its own label, so a
// v1 answer can never be read as one for a `full` item nor a v2 answer as one for a `whole` item.
// phone/src/needs.mjs must carry the same bytes.
const bindingOf2 = it =>
  crypto
    .createHash('sha256')
    .update(
      fields(
        'tnai-answer-v2',
        it.id,
        it.kind,
        it.agent,
        it.detail || '',
        String(it.since),
        it.inferred ? '1' : '0',
        it.full || ''
      )
    )
    .digest()
    .subarray(0, 12)
    .toString('base64');

// The one binding an answer for this item must carry.
const bindingFor = it => (it && it.can2 === true && it.full ? bindingOf2(it) : bindingOf(it));

// A reply, built field by field: the sender sends only this and the receiver reads only this, so
// nothing but the fixed words crosses (change 10). An unknown word reads as the harmless one,
// "refused". → null for anything that is no reply.
function shapeReply(obj) {
  if (
    !obj ||
    typeof obj !== 'object' ||
    typeof obj.t !== 'string' ||
    !Object.hasOwn(GOOD, obj.t) ||
    !hex16(obj.n)
  )
    return null;
  const { t, n } = obj,
    bad = v => (v === 'failed' ? 'failed' : 'refused');
  if (t === 'started')
    return obj.ok === true ? { t, n, ok: true } : { t, n, ok: false, why: bad(obj.why) };
  if (t === 'synced' && obj.ok !== true && SYNC_NO.includes(obj.state))
    // why a hand-over was not done: one of eight fixed words
    return { t, n, ok: false, state: obj.state };

  // a thread operation not done because the agent was working: its own word
  if (t === 'threaded' && obj.ok !== true && obj.state === 'busy')
    return { t, n, ok: false, state: 'busy' };
  return obj.ok === true && GOOD[t].includes(obj.state)
    ? { t, n, ok: true, state: obj.state }
    : { t, n, ok: false, state: bad(obj.state) };
}

// ---- which agent ----

// A row id names one panel only when cleaning leaves it unchanged: two ids that clean to the same
// text could not be told apart.
const rowId = v => (typeof v === 'string' && v !== '' && clean(v, 80) === v ? v : '');

// Only a panel whose process the app itself started as an agent (change 3): running, not a
// Terminal, in run mode, not typed by hand. A PowerShell panel with a CLI typed into it is in the
// agent list too; Stop there would end the user's shell.
const appStarted = a =>
  !!a &&
  typeof a === 'object' &&
  a.running === true &&
  a.mode === 'run' &&
  a.hand === false &&
  typeof a.cli === 'string' &&
  a.cli !== '' &&
  a.cli !== 'Terminal' &&
  typeof a.name === 'string' &&
  Number.isInteger(a.pid) &&
  a.pid > 0 &&
  Number.isFinite(a.startedAt) &&
  a.startedAt > 0;

// A start is for a project named by its first commit only, never by a folder's name: two unrelated
// folders called "app" share a name key.
const firmKey = v => {
  const k = projectKey(v);
  return k && k[0] !== 'n' ? k : '';
};

// Same time whether the tickets match or not.
const sameTicket = (a, b) =>
  !!hex16(a) && !!hex16(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function createControl({
  rights = () => '',
  live = () => false,
  peerName = () => '',
  agentNow = () => null,
  clis = () => [],
  openKey = () => '',
  remoteStarted = () => Infinity,
  startsToday = null,
  startTaken = null,
  send = () => false,
  log = () => {},
  cancel = () => {},
  prompt = () => 'failed',
  interrupt = () => 'failed',
  stop = () => 'failed',
  start = () => 'failed',
  // A choice (6i). choose({ peerId, panelId, of, pick, guard, from }) → 'done' | 'refused' |
  // 'failed': the delivery finds that panel's open question itself, compares `of` with its own
  // binding of it at that moment, and answers it; this file never sees a question. busy() → false
  // only while this computer's link has room (fewer messages in the last minute than the frames'
  // own line): anything else, a throw included, reads as busy, and a choice then gets silence.
  choose = () => 'failed',
  busy = () => true,
  // Files with a prompt (remote-files.js createTaker, plus the app's own saving): files.offer(o) →
  // 'go' | 'refused'; files.take(o) → the finished files a prompt names, or null; files.save(list)
  // → { tail, files: [{ name, kind, bytes }], undo() } once they are written under this computer's
  // own names, or null. Without `files` an offer and a prompt with files are refused.
  files = null,
  // The git hand-over. sync({ peerId, commit, guard, from }) → 'done' |
  // 'same' | a word of SYNC_NO | 'refused' | 'failed': the delivery fetches that commit from this
  // copy's own git remote and puts it into one branch of this computer's naming. From the message
  // only the commit's id reaches it. guard() → true while it may still be done.
  sync = () => 'failed',
  // An agent's message. say.right(peerId) → the pairing id that
  // computer's "agents may message" mark was given for, '' when it has none; say.target(panelId) →
  // true while that panel may take one (remote-say.js: "Ask first", proven); say.deliver({ key,
  // peerId, panelId, text, kind, by, n, guard, from, done }) → a word of a prompt. Without `say`
  // every one is refused.
  say = null,
  // Thread controls (item 44). thread({ peerId, panelId, what, value, guard, from }) → a word of
  // THREAD_WORDS. past.find(peerId, h) → { cli, id } of a past conversation in the list this
  // computer sent that computer, or null. resume({ peerId, cli, id, guard, from }) → 'started' |
  // 'refused' | 'failed', with the start's guard.
  thread = () => 'failed',
  past = null,
  resume = () => 'failed',
  now = Date.now,
  random = crypto.randomBytes,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
} = {}) {
  // The ticket key: made once per start and kept in this closure only. This computer's own restart
  // ends every ticket (change 5).
  const secret = Buffer.from(random(32));
  if (secret.length !== 32) throw new Error('remote-control: no random key');

  // peer id → { prompt, act, start: times of its last messages of that kind; day: times of its
  // taken starts; ns: Map n → when taken; stamps: Map number → when stamped; c }
  const peers = new Map();

  // key → a taken prompt that has not ended: { key, peerId, panelId, n, pairing, ticket, at, state:
  // 'going' | 'queued', timer, entry }
  const held = new Map();
  let serial = 0,
    starting = 0,
    stopped = false;
  const ask = (fn, ...a) => {
    try {
      return fn(...a);
    } catch {
      return undefined;
    }
  };
  const peer = id => {
    let p = peers.get(id);
    if (!p)
      peers.set(
        id,
        (p = {
          prompt: [],
          act: [],
          start: [],
          choose: [],
          file: [],
          sync: [],
          syncDay: [],
          say: [],
          sayDay: [],
          thread: [],
          choosing: false,
          noAt: 0,
          day: [],
          ns: new Map(),
          stamps: new Map(),
          c: 0,
        })
      );
    return p;
  };
  const pairingOf = peerId => {
    const v = ask(rights, peerId);
    return typeof v === 'string' ? v : '';
  };
  const nameOf = peerId => clean(ask(peerName, peerId), 60);
  const agentOf = panelId => {
    const a = ask(agentNow, panelId);
    return appStarted(a) ? a : null;
  };

  // Change 5: over the pairing id, the computer, the panel, the conversation (required: without one
  // the rest is known to the other computer), the name, the CLI and the process the panel runs now.
  // A rename, a new conversation, a restart, another connection and a new pairing each end it, and
  // nothing in it can be worked out on the other computer.
  const sign = (pairing, peerId, panelId, a) => {
    if (!pairing || typeof a.instance !== 'string' || !a.instance) return '';
    try {
      return crypto
        .createHmac('sha256', secret)
        .update(
          fields(
            'tnai-agent-v1',
            pairing,
            peerId,
            panelId,
            a.instance,
            a.name,
            a.cli,
            String(a.pid),
            String(a.startedAt)
          )
        )
        .digest('hex')
        .slice(0, 16);
    } catch {
      return '';
    }
  };
  const tell = (peerId, type, n, word) => {
    const ok = GOOD[type].includes(word);
    try {
      send(
        peerId,
        shapeReply(
          type === 'started' ? { t: type, n, ok, why: word } : { t: type, n, ok, state: word }
        )
      );
    } catch {
      /* no session: nothing queues */
    }
  };

  // One entry per taken operation, written when it is taken, whatever its delivery returns (change
  // 11).
  // came: the files that arrived with a prompt, under the names this computer gave them
  const record = (peerId, from, agent, op, text, came) => {
    const chars = Array.from(text),
      entry = {
        peerId,
        from,
        agent: clean(agent, 60),
        op,
        head: clean(chars.slice(0, 100).join(''), 100),
        length: chars.length,
        more: Math.max(0, chars.length - 100),
        ...(Array.isArray(came) && came.length
          ? {
              files: came.map(x => ({
                name: String(x.name),
                kind: String(x.kind),
                bytes: Number(x.bytes) || 0,
              })),
            }
          : null),
      };
    try {
      log({ ...entry });
    } catch {
      /* the record's error is not the sender's to hear */
    }
    return entry;
  };

  // Counted first. The message that goes past a limit is not kept, so a flood cannot hold the count
  // up for longer than its window.
  function counted(p, kind, t) {
    const list = (p[kind] = p[kind].filter(x => t - x < (kind === 'start' ? 10 * MINUTE : MINUTE)));
    list.push(t);
    const over =
      list.filter(x => t - x < MINUTE).length > PER_MINUTE[kind] ||
      (kind === 'start' && list.length > START_10MIN);
    if (over) list.pop();
    return !over;
  }

  // Change 13. The relay cannot replay or reorder, but it can hold the newest message and hand it
  // over minutes later.
  const fresh = (p, msg, t, limit = FRESH_MS) => {
    const at = Number.isInteger(msg.c) ? p.stamps.get(msg.c) : undefined;
    return at !== undefined && Number.isInteger(msg.ms) && msg.ms >= 0 && t - at - msg.ms <= limit;
  };

  // Change 4: is what was true on arrival still true. Asked in the turn of each write.
  const holds = h => {
    if (
      stopped ||
      now() - h.at >= HELD_MS ||
      pairingOf(h.peerId) !== h.pairing ||
      ask(live, h.peerId) !== true
    )
      return false;
    const a = agentOf(h.panelId);
    return !!a && sameTicket(sign(h.pairing, h.peerId, h.panelId, a), h.ticket);
  };

  // h.reply: 'said' for an agent's message
  const end = (h, word) => {
    held.delete(h.key);
    if (h.timer) {
      timers.clear(h.timer);
      h.timer = null;
    }
    h.state = word;
    if (h.undo && word !== 'sent' && word !== 'unconfirmed') {
      const undo = h.undo;
      h.undo = null;
      ask(undo);
    }

    /* a prompt that did not go in takes its files with it */
    tell(h.peerId, h.reply || 'prompted', h.n, word);
  };

  // Removed unwritten. From the guard the delivery already knows (it asked); from anywhere else it
  // is told through `cancel`.
  const drop = (h, tellDelivery) => {
    if (held.get(h.key) !== h) return;
    end(h, 'failed');
    if (tellDelivery) ask(cancel, h.key, h.panelId);
    try {
      log({ ...h.entry, op: 'dropped' });
    } catch {
      /* as above */
    }
  };

  function doPrompt(peerId, p, pairing, msg, n, t, refuse) {
    const panelId = rowId(msg.id),
      text = promptText(msg.text);
    if (!panelId || !text) return refuse();
    const a = agentOf(panelId),
      ticket = a ? sign(pairing, peerId, panelId, a) : '';
    if (!ticket || !sameTicket(msg.to, ticket)) return refuse();
    let onPanel = 0,
      mine = 0;
    for (const x of held.values()) {
      if (x.panelId === panelId) onPanel++;
      if (x.peerId === peerId) mine++;
    }
    if (onPanel >= HELD_PANEL || mine >= HELD_PEER) return refuse();

    // A prompt that names files (`promptf`): every one of them finished, from this computer and
    // pairing, offered for this panel and ticket, not used before; else the whole prompt is refused
    // and nothing is written. They are written to disk only now, after every check above and after
    // `n` is taken, under names this computer makes.
    let got = null;
    if (msg.t === 'promptf') {
      got = files ? ask(files.take, { peerId, pairing, panelId, ticket, ids: msg.files }) : null;
      if (!Array.isArray(got) || !got.length) return refuse();
    }
    p.ns.set(n, t); // taken, before the delivery and for good: at most once
    const saved = got ? ask(files.save, got) : null,
      came =
        saved && Array.isArray(saved.files) && typeof saved.tail === 'string' && saved.tail
          ? saved
          : null;
    const from = nameOf(peerId),
      h = {
        key: 'rc' + ++serial,
        peerId,
        panelId,
        n,
        pairing,
        ticket,
        at: t,
        state: 'going',
        timer: null,
        entry: null,
        undo: came && typeof came.undo === 'function' ? came.undo : null,
      };
    held.set(h.key, h);
    h.timer = timers.set(() => {
      h.timer = null;
      drop(h, true);
    }, HELD_MS);
    h.entry = record(peerId, from, a.name, 'prompt', text, came ? came.files : null);
    if (got && !came) {
      if (saved && typeof saved.undo === 'function') ask(saved.undo);
      end(h, 'failed');
      return { taken: true, state: 'failed' };
    } // the files could not be written: the prompt does not go in without them
    const guard = () => {
      if (held.get(h.key) !== h) return false;
      if (holds(h)) return true;
      drop(h, false);
      return false;
    };
    const done = word => {
      if (held.get(h.key) === h)
        end(h, word === 'sent' || word === 'unconfirmed' ? word : 'failed');
    };
    let r;
    try {
      r = prompt({
        key: h.key,
        peerId,
        panelId,
        text,
        guard,
        from,
        done,
        tail: came ? came.tail : '',
      });
    } catch {
      r = 'failed';

      // tail: this computer's own words that name the saved files, put after the prompt where it is
      // written
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        // it ended meanwhile: done(), a guard that said no, dropAll or the clock
        if (held.get(h.key) !== h) return { taken: true, state: h.state };
        if (word === 'queued') {
          if (h.state !== 'queued') {
            h.state = 'queued';
            tell(peerId, 'prompted', n, 'queued');
          }
          return { taken: true, state: 'queued' };
        }
        end(h, WORDS.prompt.includes(word) ? word : 'failed');
        return { taken: true, state: h.state };
      });
  }

  // A message from an agent on that computer for an agent here.
  // Everything a prompt is held to (the row, the agent as it is now, the keyed
  // ticket, the held limits, the one-time number, and all of it again in the turn of the write),
  // and on top of it: the mark for this right is on for that pairing; the panel may take one at
  // this moment (say.target: an agent this app started at "Ask first" whose mode was not raised);
  // 10 in 24 hours. Past a count: silence or "refused", as for a prompt. The delivery is the remote
  // prompt's own (held on this computer, one at a time for a panel, no Enter over a question), with
  // the mark and the fixed line this computer makes.
  function doSay(peerId, p, pairing, msg, n, t, refuse) {
    const panelId = rowId(msg.id),
      text = promptText(msg.text),
      kind = msg.kind === 'ask' ? 'ask' : msg.kind === 'send' ? 'send' : ''; // two literals
    if (!say || !panelId || !text || !kind || ask(say.right, peerId) !== pairing) return refuse();
    const a = agentOf(panelId),
      ticket = a ? sign(pairing, peerId, panelId, a) : '';
    if (!ticket || !sameTicket(msg.to, ticket) || ask(say.target, panelId) !== true)
      return refuse();
    let onPanel = 0,
      mine = 0;
    for (const x of held.values()) {
      if (x.panelId === panelId) onPanel++;
      if (x.peerId === peerId) mine++;
    }
    if (onPanel >= HELD_PANEL || mine >= HELD_PEER) return refuse();
    p.sayDay = p.sayDay.filter(x => t - x < DAY_MS);
    if (p.sayDay.length >= SAY_DAY) return refuse();
    p.ns.set(n, t);
    p.sayDay.push(t); // taken, before the delivery and for good: at most once
    const by = { name: clean(msg.by && msg.by.name, 32), cli: clean(msg.by && msg.by.cli, 40) },
      computer = nameOf(peerId),
      from = (by.name || 'An agent') + ' on ' + computer;
    const h = {
      key: 'rc' + ++serial,
      peerId,
      panelId,
      n,
      pairing,
      ticket,
      at: t,
      state: 'going',
      timer: null,
      entry: null,
      undo: null,
      reply: 'said',
    };
    held.set(h.key, h);
    h.timer = timers.set(() => {
      h.timer = null;
      drop(h, true);
    }, HELD_MS);
    h.entry = record(peerId, from, a.name, 'say', text);
    const guard = () => {
      if (held.get(h.key) !== h) return false;
      if (holds(h) && ask(say.right, peerId) === pairing && ask(say.target, panelId) === true)
        return true;
      drop(h, false);
      return false;
    };
    const done = word => {
      if (held.get(h.key) === h)
        end(h, word === 'sent' || word === 'unconfirmed' ? word : 'failed');
    };
    let r;
    try {
      r = say.deliver({
        key: h.key,
        peerId,
        panelId,
        text,
        kind,
        by,
        n,
        guard,
        from,
        computer,
        done,
      });
    } catch {
      r = 'failed';
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        if (held.get(h.key) !== h) return { taken: true, state: h.state };
        if (word === 'queued') {
          if (h.state !== 'queued') {
            h.state = 'queued';
            tell(peerId, 'said', n, 'queued');
          }
          return { taken: true, state: 'queued' };
        }
        end(h, WORDS.prompt.includes(word) ? word : 'failed');
        return { taken: true, state: h.state };
      });
  }

  // The offer of one file (remote-files.js). Checked as an operation: the row, the agent as it is
  // now, the ticket. Its own rules (the caps, one open file, the day's allowance) are the taker's;
  // a refusal is told before a byte flows. The guard it is handed is asked again at every piece.
  function doFile(peerId, p, pairing, msg, n, t, refuse) {
    const panelId = rowId(msg.id),
      a = panelId ? agentOf(panelId) : null,
      ticket = a ? sign(pairing, peerId, panelId, a) : '';
    if (!files || !ticket || !sameTicket(msg.to, ticket)) return refuse();
    const h = { peerId, panelId, pairing, ticket, at: t },
      guard = () => holds(h);
    if (ask(files.offer, { peerId, pairing, panelId, ticket, msg, guard }) !== 'go')
      return refuse();
    p.ns.set(n, t);
    record(
      peerId,
      nameOf(peerId),
      a.name,
      'file',
      (msg.kind === 'txt' ? 'a text file' : 'a picture') +
        ', ' +
        (msg.bytes >= 1024 ? Math.round(msg.bytes / 1024) + ' KB' : msg.bytes + ' bytes')
    );
    tell(peerId, 'filed', n, 'go');
    return { taken: true, state: 'go' };
  }

  function doAct(peerId, p, pairing, msg, n, t, refuse) {
    const what = msg.do === 'interrupt' ? 'interrupt' : msg.do === 'stop' ? 'stop' : '',
      panelId = rowId(msg.id); // two literals (change 16)
    if (!what || !panelId) return refuse();
    const a = agentOf(panelId),
      ticket = a ? sign(pairing, peerId, panelId, a) : '';
    if (!ticket || !sameTicket(msg.to, ticket)) return refuse();
    p.ns.set(n, t);
    record(peerId, nameOf(peerId), a.name, what, '');
    const h = { peerId, panelId, pairing, ticket, at: t },
      guard = () => holds(h);
    let r;
    try {
      r = (what === 'stop' ? stop : interrupt)(panelId, guard);
    } catch {
      r = 'failed';
    } // in the turn of the checks above
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        const state = WORDS[what].includes(word) ? word : 'failed';
        tell(peerId, 'acted', n, state);
        return { taken: true, state };
      });
  }

  function doStart(peerId, p, pairing, msg, n, t, refuse) {
    const cli = typeof msg.cli === 'string' && Object.hasOwn(CLIS, msg.cli) ? CLIS[msg.cli] : '',
      key = firmKey(msg.project),
      text = msg.text === undefined ? '' : promptText(msg.text);
    if (!cli || !key || (msg.text !== undefined && !text)) return refuse();

    // Change 6: a folder is open here, its key is known, of the first-commit form and equal (an
    // empty key never equals an empty key); the CLI is installed and signed in here now; and fewer
    // than 3 panels started from other computers are still open, those being started at this moment
    // included (a panel takes up to 90 s to open, so the app's own count lags).
    const here = ask(clis),
      open = ask(remoteStarted);
    if (
      !Array.isArray(here) ||
      !here.includes(cli) ||
      firmKey(ask(openKey)) !== key ||
      !Number.isInteger(open) ||
      open < 0 ||
      open + starting >= START_OPEN
    )
      return refuse();
    p.day = p.day.filter(x => t - x < DAY_MS);

    // 20 a day: by the app's own count when it keeps one (it survives the app's restart), and never
    // fewer than this object counted. A count that cannot be read refuses.
    const kept = typeof startsToday === 'function' ? ask(startsToday, peerId) : p.day.length;
    if (!Number.isInteger(kept) || kept < 0 || Math.max(kept, p.day.length) >= START_DAY)
      return refuse();
    p.ns.set(n, t);
    p.day.push(t);
    starting++;
    if (typeof startTaken === 'function') ask(startTaken, peerId, t);
    const from = nameOf(peerId);
    record(peerId, from, cli, 'start', text);

    // The same guard as a prompt's, for a panel that has no ticket yet: its own project key instead
    // (change 6).
    const guard = panelKey =>
      !stopped &&
      now() - t < HELD_MS &&
      pairingOf(peerId) === pairing &&
      ask(live, peerId) === true &&
      firmKey(panelKey) === key;
    let r;
    try {
      r = start({ peerId, cli, text, guard, from });
    } catch {
      r = 'failed';
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        starting--;
        const state = WORDS.start.includes(word) ? word : 'failed';
        tell(peerId, 'started', n, state);
        return { taken: true, state };
      });
  }

  // "Choose option N of the question that was shown" (6i). Not a key: this file
  // checks who asks and for which agent, and the delivery checks the question. OpenCode only, where
  // the answer is given to OpenCode's own server by the question's id and no byte is written; for
  // Claude Code the app cannot yet be sure that a choice question is open and unchanged, so it is
  // refused here whatever the delivery would say ("Claude Code"). One at
  // a time for one computer. A try that is not taken is written down, at most once a minute for one
  // computer, so trying all day does not go unseen. A try at a choice that was not taken, written
  // down at most once a minute for one computer: also one that is no choice at all (a number that
  // is not 1 to 9, a held message), which never reaches doChoose (found in the test round of
  // 2026-10-10: those left no line).
  const tried = (p, peerId, agent, t) => {
    if (t - p.noAt >= MINUTE) {
      p.noAt = t;
      record(peerId, nameOf(peerId), agent || '', 'choose_no', '');
    }
  };

  function doChoose(peerId, p, pairing, msg, n, t, refuse) {
    const panelId = rowId(msg.id),
      pick = Number.isInteger(msg.pick) && msg.pick >= 1 && msg.pick <= 9 ? msg.pick : 0,
      of = typeof msg.of === 'string' && /^[A-Za-z0-9+/]{16}$/.test(msg.of) ? msg.of : '';
    const a = panelId ? agentOf(panelId) : null,
      ticket = a ? sign(pairing, peerId, panelId, a) : '',
      from = nameOf(peerId);
    const no = () => tried(p, peerId, a ? a.name : '', t);
    if (
      !panelId ||
      !pick ||
      !of ||
      p.choosing ||
      !ticket ||
      !sameTicket(msg.to, ticket) ||
      a.cli !== 'OpenCode'
    ) {
      no();
      return refuse();
    }
    p.ns.set(n, t);
    p.choosing = true;
    record(peerId, from, a.name, 'choose', String(pick));
    const h = { peerId, panelId, pairing, ticket, at: t },
      guard = () => holds(h);
    let r;
    try {
      r = choose({ peerId, panelId, of, pick, guard, from });
    } catch {
      r = 'failed';
    } // in the turn of the checks above; never held
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        p.choosing = false;
        const state = WORDS.choose.includes(word) ? word : 'failed';
        tell(peerId, 'chosen', n, state);
        return { taken: true, state };
      });
  }

  // The git hand-over. "Fetch this
  // commit of the project we both have open into your branch for me." It names no agent, so it has
  // no ticket: what it is held to is the project that is open here (its first commit's id, as a
  // start is) and a commit id of 40 or 64 hex characters, the one thing of the message that reaches
  // git. One at a time on this computer, for all computers; 2 a minute (counted before this is
  // called) and 6 in 24 hours for one computer.
  let syncing = false;

  function doSync(peerId, p, pairing, msg, n, t, refuse) {
    for (const [k, at] of p.ns) if (t - at >= N_MS) p.ns.delete(k);
    if (p.ns.has(n) || !fresh(p, msg, t) || !fitsOne(msg)) return refuse();
    const commit = commitId(msg.commit),
      key = firmKey(msg.project);
    if (!commit || !key || firmKey(ask(openKey)) !== key) return refuse();
    p.syncDay = p.syncDay.filter(x => t - x < DAY_MS);
    if (p.syncDay.length >= SYNC_DAY) return refuse();
    const say = word => {
      const state =
        GOOD.synced.includes(word) || SYNC_NO.includes(word) || word === 'refused'
          ? word
          : 'failed';
      tell(peerId, 'synced', n, state);
      return { taken: true, state };
    };
    p.ns.set(n, t); // taken, before anything runs and for good: at most once
    const from = nameOf(peerId);
    if (syncing) {
      record(peerId, from, '', 'sync_end', 'busy');
      return say('busy');
    }
    p.syncDay.push(t);
    syncing = true;
    record(peerId, from, '', 'sync', commit.slice(0, 10));

    // Asked again before every fetch and before the branch is written: the right, the pairing, the
    // session, the open project.
    const guard = () =>
      !stopped &&
      now() - t < HELD_MS &&
      pairingOf(peerId) === pairing &&
      ask(live, peerId) === true &&
      firmKey(ask(openKey)) === key;
    let r;
    try {
      r = sync({ peerId, commit, guard, from });
    } catch {
      r = 'failed';
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        syncing = false;
        const out = say(word);
        record(peerId, from, '', 'sync_end', out.state);
        return out;
      }); // two lines in this computer's list: asked, and how it ended (one fixed word)
  }

  // ---- Thread controls (item 44) ----
  // A rename, close, model or effort for one agent's thread. Checked as an act is: the row, the
  // agent as it is now, the ticket; then the value for its word and whether that CLI takes the word
  // from another computer at all (remote-thread.js). Taken before the delivery, and the guard is
  // asked again in the turn of the write.
  function doThread(peerId, p, pairing, msg, n, t, refuse) {
    const panelId = rowId(msg.id),
      what = typeof msg.do === 'string' ? msg.do : '',
      value = threadValue(what, msg.v);
    if (!panelId || value === null) return refuse();
    const a = agentOf(panelId),
      ticket = a ? sign(pairing, peerId, panelId, a) : '';
    if (!ticket || !sameTicket(msg.to, ticket) || !threadCan(a.cli, what)) return refuse();
    p.ns.set(n, t);
    const from = nameOf(peerId);
    record(peerId, from, a.name, what, value);
    const h = { peerId, panelId, pairing, ticket, at: t },
      guard = () => holds(h);
    let r;
    try {
      r = thread({ peerId, panelId, what, value, guard, from });
    } catch {
      r = 'failed';
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        const state = WORDS.thread.includes(word) ? word : 'failed';
        tell(peerId, 'threaded', n, state);
        return { taken: true, state };
      });
  }

  // A resume of a past conversation of this computer: the same checks and bounds as a start (the
  // project open here, the CLI ready here, 3 open, 20 a day), and the conversation is the one the
  // handle names in the list this computer sent that computer (never an id or a path from the
  // message). The CLI and the conversation come from this computer's own record.
  function doResume(peerId, p, pairing, msg, n, t, refuse) {
    const h = typeof msg.h === 'string' && HEX16.test(msg.h) ? msg.h : '',
      key = firmKey(msg.project);
    if (!h || !key || !past) return refuse();
    const found = ask(past.find, peerId, h);
    const cli = found && typeof found.cli === 'string' ? found.cli : '';
    const id = found && typeof found.id === 'string' ? found.id : '';
    const here = ask(clis),
      open = ask(remoteStarted);
    if (
      !cli ||
      !id ||
      !Array.isArray(here) ||
      !here.includes(cli) ||
      firmKey(ask(openKey)) !== key ||
      !Number.isInteger(open) ||
      open < 0 ||
      open + starting >= START_OPEN
    )
      return refuse();
    p.day = p.day.filter(x => t - x < DAY_MS);
    const kept = typeof startsToday === 'function' ? ask(startsToday, peerId) : p.day.length;
    if (!Number.isInteger(kept) || kept < 0 || Math.max(kept, p.day.length) >= START_DAY)
      return refuse();
    p.ns.set(n, t);
    p.day.push(t);
    starting++;
    if (typeof startTaken === 'function') ask(startTaken, peerId, t);
    const from = nameOf(peerId);
    record(peerId, from, cli, 'resume', typeof found.title === 'string' ? found.title : '');
    const guard = panelKey =>
      !stopped &&
      now() - t < HELD_MS &&
      pairingOf(peerId) === pairing &&
      ask(live, peerId) === true &&
      firmKey(panelKey) === key;
    let r;
    try {
      r = resume({ peerId, cli, id, guard, from });
    } catch {
      r = 'failed';
    }
    return Promise.resolve(r)
      .then(
        w => w,
        () => 'failed'
      )
      .then(word => {
        starting--;
        const state = WORDS.resume.includes(word) ? word : 'failed';
        tell(peerId, 'resumed', n, state);
        return { taken: true, state };
      });
  }

  // → { ignored: true } (not one of the three types) · { silent: 'limit' | 'off' | 'shape' }
  // (nothing done, nothing sent) · { refused: true } (the other computer was told "refused") · a
  // promise of { taken: true, state } once the delivery gave its word.
  function receive(peerId, msg) {
    const kind =
      msg && typeof msg === 'object' && typeof msg.t === 'string' && Object.hasOwn(TYPES, msg.t)
        ? msg.t
        : '';
    if (!kind || typeof peerId !== 'string' || !peerId || stopped) return { ignored: true };
    const t = now(),
      p = peer(peerId);

    // a prompt with files is a prompt: one count; a resume is a start (item 44)
    const countAs = kind === 'promptf' ? 'prompt' : kind === 'resume' ? 'start' : kind;
    if (!counted(p, countAs, t)) return { silent: 'limit' };

    // A choice is answered only while this computer's link has room, the line pictures stop at:
    // past it, silence, never "refused" (a refusal is a message too).
    if (kind === 'choose' && ask(busy) !== false) return { silent: 'busy' };
    const pairing = pairingOf(peerId);
    if (!pairing) return { silent: 'off' };
    const n = hex16(msg.n);

    // a reply is read only for an `n` its computer sent: without one there is nobody to tell
    if (!n) return { silent: 'shape' };
    const refuse = () => {
      if (kind === 'choose') tried(p, peerId, '', t);
      tell(peerId, TYPES[kind], n, 'refused');
      return { refused: true };
    };

    // the git hand-over: its own checks, the same ones in the same order
    if (kind === 'sync') return doSync(peerId, p, pairing, msg, n, t, refuse);
    for (const [k, at] of p.ns) if (t - at >= N_MS) p.ns.delete(k);
    if (
      p.ns.has(n) ||
      !fresh(p, msg, t, kind === 'choose' ? CHOOSE_FRESH_MS : FRESH_MS) ||
      !fitsOne(msg)
    )
      return refuse();
    if (kind === 'say') return doSay(peerId, p, pairing, msg, n, t, refuse);

    // thread controls (item 44)
    if (kind === 'thread') return doThread(peerId, p, pairing, msg, n, t, refuse);
    if (kind === 'resume') return doResume(peerId, p, pairing, msg, n, t, refuse);
    return (
      kind === 'prompt' || kind === 'promptf'
        ? doPrompt
        : kind === 'file'
          ? doFile
          : kind === 'act'
            ? doAct
            : kind === 'choose'
              ? doChoose
              : doStart
    )(peerId, p, pairing, msg, n, t, refuse);
  }

  return {
    receive,
    // The ticket for an agent row sent to that computer now (`to`), or '': no control switch, not a
    // panel the app started as an agent, no conversation id. It asks agentNow itself, so a ticket
    // is never made from a kept list. A hint for the other computer's buttons and never a right:
    // every operation computes it again.
    ticketFor(peerId, panelId) {
      const id = rowId(panelId),
        pairing = typeof peerId === 'string' && peerId && id ? pairingOf(peerId) : '',
        a = pairing ? agentOf(id) : null;
      return a ? sign(pairing, peerId, id, a) : '';
    },
    // A number to put on a message for that computer (each agent list; change 13). An operation
    // echoes the newest one it has as `c`.
    stamp(peerId) {
      if (typeof peerId !== 'string' || !peerId) return 0;
      const p = peer(peerId);
      p.c = p.c >= 0x7fffffff ? 1 : p.c + 1;
      p.stamps.set(p.c, now());
      while (p.stamps.size > STAMPS) p.stamps.delete(p.stamps.keys().next().value);
      return p.c;
    },
    // Is this message of that computer one the relay did not hold back (change 13)? The same
    // question the operations above ask, for the live view's `view` and `keep` (remote-view.js),
    // which echo the same counter.
    // limit: a shorter time than the operations' 60 s, for typing (remote-type.js asks 5 s); a
    // longer one is never taken.
    fresh(peerId, msg, limit) {
      const ms = Number.isFinite(limit) && limit > 0 && limit < FRESH_MS ? limit : FRESH_MS;
      return (
        typeof peerId === 'string' &&
        !!peerId &&
        !!msg &&
        typeof msg === 'object' &&
        peers.has(peerId) &&
        fresh(peers.get(peerId), msg, now(), ms)
      );
    },
    // The control switch went off for that computer, by any path: its taken prompts that have not
    // ended are removed at once, the delivery is told through `cancel`, the computer hears "failed"
    // if it can still be reached. → how many.
    dropAll(peerId) {
      const mine = [...held.values()].filter(h => h.peerId === peerId);
      for (const h of mine) drop(h, true);
      return mine.length;
    },
    // The taken prompts that have not ended, for the wiring's own lists.
    held: () =>
      [...held.values()].map(h => ({
        key: h.key,
        peerId: h.peerId,
        panelId: h.panelId,
        state: h.state,
        at: h.at,
      })),
    // The app is closing: no timer stays, nothing more is taken, every guard says no.
    stop() {
      stopped = true;
      for (const h of [...held.values()]) {
        if (h.timer) timers.clear(h.timer);
        h.timer = null;
        held.delete(h.key);
        if (h.undo) {
          ask(h.undo);
          h.undo = null;
        }
        ask(cancel, h.key, h.panelId);
      }
    },
  };
}

module.exports = {
  createControl,
  promptText,
  fitsOne,
  roomLeft,
  fullText,
  fullShell,
  answerWay,
  withFull,
  readFull,
  bindingOf2,
  bindingFor,
  withPick,
  readPick,
  bindingPick,
  shapeReply,
  appStarted,
  firmKey,
  sameTicket,
  CLIS,
  PER_MINUTE,
  START_10MIN,
  START_DAY,
  START_OPEN,
  N_MS,
  HELD_MS,
  HELD_PANEL,
  HELD_PEER,
  FRESH_MS,
  FULL_MAX,
};
