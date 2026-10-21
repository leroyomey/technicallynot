// Technically Not · remote-browse.js — another computer's project files, seen and edited from this
// one (plan item 42, docs/plans/multi-computer.md list J). The computer whose files are read is
// "the target", the one that reads them "the watcher".
//
// Messages, each a new type of its own (a new thing to send is a new shaped message):
// - watcher → target { t: 'fsask', n, p, op: 'list' | 'read', path }
//   n: a one-time number (16 hex), p: the key of the project the watcher has open (40 hex: the
//   target answers only while it has the same project open, rule 12), path: a project-relative
//   path written with "/" ('' is the project folder itself).
// - watcher → target { t: 'fssave', n, i: 0, parts, p, path, base, size, hash } and then
//   { t: 'fssave', n, i, data } for i = 1 .. parts - 1: a new text for one file, in order.
//   base: the hash of the version the user edited (the save is refused when the file changed
//   meanwhile), size and hash: of the new bytes, data: base64 of a piece of them.
// - target → watcher { t: 'fs', n, state } alone (refused, busy, project, missing, hidden, large,
//   binary, changed, locked + holder, saved, failed), or an answer in parts:
//   { t: 'fs', n, i: 0, parts, op, path, ... } then { t: 'fs', n, i, data | entries }.
//
// The rules on the target, in the order they run (each is one check below):
// - The service hands a message over only for a computer whose one "full control" switch is on
//   here (rule 13); `may` is asked again here and before every read and write.
// - Counted on arrival, before anything is looked at: 20 asks and 4 saves a minute per computer,
//   40 save pieces a minute per computer. Past a limit: silence.
// - One job at a time for all computers; a computer's newest ask takes the place of its waiting
//   one; a job whose turn comes late is checked again before it reads (lesson P2).
// - Paths: relative, "/" only, no "." or ".." parts, no drive, colon, backslash, control
//   character, Windows device name or part that ends in a dot or space, at most 400 characters
//   (`safePath`). The real file must still be inside the project after links are followed (the
//   app's own fs-service `resolve`, handed in as `list`/`read`/`write`).
// - Hidden, never listed, read or written (`isSecret`): .git, .env and every .env.* file, key and
//   credential files (id_rsa, *.pem, *.key, .npmrc, credentials …), folders such as .ssh and
//   .aws, and the app's own .tnai folder. The list says how many entries were left out.
// - Text only: a file whose kind is a picture, sound, video, PDF, archive, font or program
//   (`kindOf`), or whose first bytes are not text (`looksBinary`), is listed with its kind and
//   never sent. At most 40 KB of a text file is sent; a longer one is marked cut and cannot be
//   saved from the watcher.
// - A save: only an existing text file, only when its hash is still `base`, never while another
//   agent holds the file's lock (refused with the holder's name), never with more invisible
//   direction or tag characters than the file had, and written through the app's own atomic
//   save (temp file and rename). `onSaved` tells this computer, where it lands.
// - An answer starts only when all of its parts fit in the link's room now (one budget).
//
// Pure Node: the clock, the timers, the right, the file access and the sending are handed in by
// desktop/remote-service.js. Nothing here touches the disk itself.
'use strict';
const crypto = require('crypto');
const { MAX_PLAIN } = require('./remote-noise.js');
const { clean: line } = require('./remote-keys.js');

// ---------- the numbers (to be confirmed by the security review, item 47) ----------
const FILE_MAX = 40 * 1024;
const LIST_MAX = 300;
const LIST_PARTS = 4;
const PATH_MAX = 400;
const NAME_MAX = 120;
const MINUTE = 60 * 1000;

// per computer, on the target
const ASKS_MIN = 20;
const SAVES_MIN = 4;
const SAVE_MSGS_MIN = 40;

// answers of all computers together: with the live view's frames and the conversation parts this
// stays under the link's stream line
const FS_MSGS_MIN = 36;

// a save's pieces must all arrive this soon after its first; an answer this soon on the watcher
const ASSEMBLY_MS = 20 * 1000;
const ANSWER_MS = 30 * 1000;
const SEEN_NS = 64;
const SEEN_MS = 10 * MINUTE;

// The raw bytes one piece carries: base64 of them plus the fixed fields of a piece fit one sealed
// message.
const PIECE_HEAD = Buffer.byteLength(
  JSON.stringify({ t: 'fssave', n: 'f'.repeat(16), i: 99, data: '' })
);
const PIECE_BYTES = Math.floor((MAX_PLAIN - PIECE_HEAD - 8) / 4) * 3;
const PIECES_MAX = Math.ceil(FILE_MAX / PIECE_BYTES) + 1;

const hex16 = value => (typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : '');
const hex40 = value => (typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : '');
const hex64 = value => (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : '');
const count = value =>
  Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : -1;
const hashOf = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// ---------- paths ----------
const DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// A project-relative path as another computer may name it, or null. '' is the project folder.
// Nothing is repaired: a path that would change by cleaning is refused.
function safePath(raw) {
  if (raw === '') return '';
  if (typeof raw !== 'string' || raw.length > PATH_MAX) return null;
  if (line(raw, PATH_MAX) !== raw) return null;
  if (/[\\:*?"<>|]/.test(raw) || raw.startsWith('/') || raw.endsWith('/')) return null;
  for (let at = 0; at < raw.length; at++) if (raw.charCodeAt(at) < 32) return null;
  const parts = raw.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.length > NAME_MAX) return null;
    if (/[. ]$/.test(part) || DEVICE_NAMES.test(part)) return null;

    // A Windows short name (GIT~1 for .git) would pass the rules below: never taken
    if (/~[0-9]/.test(part)) return null;
  }
  return raw;
}

// ---------- what is never shown or sent ----------
const SECRET_DIRS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.tnai',
  '.secrets',
  'secrets',
]);
const SECRET_FILES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'credentials',
  'credentials.json',
  'known_hosts',
  'authorized_keys',
  '.dev.vars',
]);
const SECRET_SHAPES = [
  /^\.env(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|kdbx|tfstate|ppk|asc|gpg)$/i,
  /^secrets?\./i,
  /^service-account.*\.json$/i,
  /\.tfvars(\.json)?$/i,

  // Review 23, L4: tax notices named the IRS way (CP575, CP_575_G.pdf) hold tax ids
  /^cp[ _-]?\d{3,4}/i,
];

// True when any part of the path names a secret: hidden from the list, refused when asked.
function isSecret(path) {
  if (typeof path !== 'string' || !path) return false;

  // Review 23, L4: the project rule keeps every root CP* file untouched (as .gitignore's /CP*)
  if (/^CP[^/]*$/.test(path)) return true;
  for (const part of path.split('/')) {
    const lower = part.toLowerCase();
    if (SECRET_DIRS.has(lower) || SECRET_FILES.has(lower)) return true;
    if (SECRET_SHAPES.some(shape => shape.test(part))) return true;
  }
  return false;
}

// ---------- what is read but never saved from another computer ----------
// Files that make a CLI, an editor or git run a command by itself (hooks, tasks, MCP servers,
// direnv): a save there would let another computer run commands on this one, which is the typing
// right's job, not the files' (security review of item 47, H1). Read-only from another computer.
const RUNS_DIRS = new Set([
  '.claude',
  '.codex',
  '.cursor',
  '.opencode',
  '.vscode',
  '.idea',
  '.husky',
  '.githooks',
]);
const RUNS_FILES = new Set([
  'opencode.json',
  'opencode.jsonc',
  '.mcp.json',
  '.envrc',
  '.pre-commit-config.yaml',
]);
const RUNS_SHAPES = [/^\.?lefthook/i];

// True when a save to this path could make this computer run a command by itself.
function runsCommands(path) {
  if (typeof path !== 'string' || !path) return false;
  const parts = path.split('/').map(part => part.toLowerCase());
  if (parts.length >= 2 && parts[0] === '.github' && parts[1] === 'workflows') return true;
  for (const part of parts) {
    if (RUNS_DIRS.has(part) || RUNS_FILES.has(part)) return true;
    if (RUNS_SHAPES.some(shape => shape.test(part))) return true;
  }
  return false;
}

// The real path of a file (links followed, long names: realpathSync.native) relative to the
// project's real folder, written with '/', or null when it is not inside. pathApi: path.win32 or
// path.posix. The secret and save rules run on this too, so a short name, a link or a junction
// inside the project cannot reach a secret by another name (review of item 47, M1).
function realRelative(realRoot, realFull, pathApi) {
  if (typeof realRoot !== 'string' || typeof realFull !== 'string' || !realRoot) return null;
  const rel = pathApi.relative(realRoot, realFull);
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith('..' + pathApi.sep) || pathApi.isAbsolute(rel)) return null;
  return rel.split(pathApi.sep).join('/');
}

// ---------- kinds ----------
const KINDS = {
  picture: [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'tif',
    'tiff',
    'psd',
    'avif',
    'heic',
  ],
  sound: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'm4v'],
  PDF: ['pdf'],
  archive: ['zip', '7z', 'rar', 'gz', 'tgz', 'tar', 'bz2', 'xz', 'asar', 'nupkg'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  program: ['exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'node', 'wasm', 'class', 'pyc', 'o', 'obj'],
  document: [
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'odt',
    'blend',
    'fbx',
    'glb',
    'unitypackage',
  ],
  database: ['db', 'sqlite', 'sqlite3', 'mdb'],
};
const KIND_OF_EXTENSION = new Map();
for (const [kind, list] of Object.entries(KINDS))
  for (const extension of list) KIND_OF_EXTENSION.set(extension, kind);

// 'text', or the kind of a file that is never sent, by its name
function kindOf(name) {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  if (dot < 0) return 'text';
  return KIND_OF_EXTENSION.get(name.slice(dot + 1).toLowerCase()) || 'text';
}

// True when the bytes are not UTF-8 text (a zero byte, or a sequence no text has). A cut in the
// middle of a character at the end is allowed: the last 3 bytes may be an unfinished one.
function looksBinary(bytes) {
  if (!Buffer.isBuffer(bytes)) return true;
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return false;
  } catch {
    for (let cut = 1; cut <= 3 && cut < bytes.length; cut++) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - cut));
        return false;
      } catch {
        /* try a shorter cut */
      }
    }
    return true;
  }
}

// Characters that change how text reads without being seen: the direction overrides and isolates,
// and the tag characters. Built from their numbers at run time (lesson: an escape written through a
// file tool can arrive as the character itself).
const HIDDEN_CODES = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];

function hiddenCount(text) {
  if (typeof text !== 'string') return 0;
  let found = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (HIDDEN_CODES.includes(code) || (code >= 0xe0000 && code <= 0xe007f)) found++;
  }
  return found;
}

// The name of the agent that holds this file's lock, or ''. locks: file-locks.js list() of the
// open project; caseBlind on Windows.
function holderOf(locks, path, caseBlind) {
  if (!Array.isArray(locks) || typeof path !== 'string' || !path) return '';
  const fold = text => (caseBlind ? String(text).toLowerCase() : String(text));
  const want = fold(path);
  for (const held of locks) {
    if (!held || typeof held.file !== 'string') continue;
    if (fold(held.file.split('\\').join('/')) === want)
      return line(String(held.name || 'another agent'), 60) || 'another agent';
  }
  return '';
}

// ---------- packing ----------
// Bytes as base64 pieces that each fit one message.
function pieces(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length; at += PIECE_BYTES)
    out.push(bytes.subarray(at, at + PIECE_BYTES).toString('base64'));
  return out;
}

// A folder's entries as parts of at most the room of one message each.
// The first part also carries the folder's path (up to 400 characters of 3 bytes each) and the
// counts, so every part leaves room for that head at its widest.
const LIST_HEAD_WORST = Buffer.byteLength(
  JSON.stringify({
    t: 'fs',
    n: 'f'.repeat(16),
    i: 0,
    parts: 9,
    op: 'list',
    path: '一'.repeat(PATH_MAX),
    hidden: 99999,
    more: 99999,
    entries: [],
  })
);
const ENTRY_ROOM = MAX_PLAIN - LIST_HEAD_WORST;

function packEntries(entries) {
  const parts = [];
  let part = [];
  let used = 2;
  for (const entry of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (used + size > ENTRY_ROOM) {
      if (parts.length + 1 >= LIST_PARTS) break;
      parts.push(part);
      part = [];
      used = 2;
    }
    part.push(entry);
    used += size;
  }
  parts.push(part);
  const sent = parts.reduce((sum, list) => sum + list.length, 0);
  return { parts, more: entries.length - sent };
}

// An entry as it crosses: [name, 'd' | 'f', size or -1, kind]. Read the same way on both sides.
function shapeEntry(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [name, type, size, kind] = raw;
  if (typeof name !== 'string' || !name || name.length > NAME_MAX || line(name, NAME_MAX) !== name)
    return null;
  if (name.includes('/') || name === '.' || name === '..') return null;
  if (type !== 'd' && type !== 'f') return null;
  const known = kind === 'text' || Object.hasOwn(KINDS, kind);
  return [name, type, count(size), type === 'd' ? '' : known ? kind : 'binary'];
}

// ---------- the target ----------
// may(peerId) → true while that computer's full-control switch is on here. openKey() → the key of
// the project open here ('' none). caseBlind: Windows. list(path) → [{ name, kind: 'directory' |
// 'file' }]. stat(path) → { size }. read(path, max) → Buffer of at most max bytes. write(path,
// Buffer) → true (atomic). locks() → file-locks.js list() of the open project. send(peerId, obj) →
// true when it left. room() → messages the link may still send this minute. onSaved(peerId, path)
// and onRead(peerId, path): for this computer's activity list and its notice.
function createBrowseAnswerer({
  now = Date.now,
  may = () => false,
  openKey = () => '',
  caseBlind = process.platform === 'win32',
  list = async () => [],
  stat = async () => ({ size: 0 }),
  read = async () => Buffer.alloc(0),
  write = async () => false,
  locks = () => [],
  send = () => false,
  room = () => 0,
  onSaved = () => {},
  onRead = () => {},
  // real(path) → Promise of the real path relative to the project's real folder (realRelative),
  // or null. Without it nothing is answered.
  real = async () => null,
}) {
  const asks = new Map();
  const saves = new Map();
  const saveMsgs = new Map();
  const seen = new Map();
  const jobs = new Map();
  const assemblies = new Map();
  const epochs = new Map();
  const sentTimes = [];
  let busy = false;
  let stopped = false;

  const ask = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  };
  const allowed = peerId => ask(may, peerId) === true;
  const epochOf = peerId => epochs.get(peerId) || 0;
  const recent = () => {
    const t = now();
    while (sentTimes.length && t - sentTimes[0] >= MINUTE) sentTimes.shift();
    return sentTimes.length;
  };
  const sendOne = (peerId, obj) => {
    let ok = false;
    try {
      ok = send(peerId, obj) === true;
    } catch {
      ok = false;
    }
    if (ok) sentTimes.push(now());
    return ok;
  };

  // A short answer: one message, also past the file budget's count when the link has room for it
  // (a refusal must reach the user, or the press looks dead).
  const tell = (peerId, n, state, extra) => {
    if ((Number(ask(room)) || 0) < 1) return false;
    return sendOne(peerId, { t: 'fs', n, state, ...(extra || {}) });
  };

  // true when it is still within the limit; counts this one
  const counted = (map, peerId, limit) => {
    const t = now();
    const times = (map.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= limit) {
      map.set(peerId, times);
      return false;
    }
    times.push(t);
    map.set(peerId, times);
    return true;
  };

  // the same number twice is taken once
  const fresh = (peerId, n) => {
    const t = now();
    const list = (seen.get(peerId) || []).filter(item => t - item.at < SEEN_MS);
    if (list.some(item => item.n === n)) {
      seen.set(peerId, list);
      return false;
    }
    list.push({ n, at: t });
    while (list.length > SEEN_NS) list.shift();
    seen.set(peerId, list);
    return true;
  };

  // Counted when it arrives, before anything is looked up. Never throws. → true when taken.
  function receive(peerId, obj) {
    if (stopped || !obj || typeof obj !== 'object' || typeof peerId !== 'string' || !peerId)
      return false;
    if (obj.t === 'fsask') return receiveAsk(peerId, obj);
    if (obj.t === 'fssave') return receivePiece(peerId, obj);
    return false;
  }

  function receiveAsk(peerId, obj) {
    if (!counted(asks, peerId, ASKS_MIN)) return false;
    const n = hex16(obj.n);
    if (!n || !fresh(peerId, n) || !allowed(peerId)) return false;
    const op = obj.op === 'list' || obj.op === 'read' ? obj.op : '';
    const path = safePath(obj.path);
    if (!op || path === null || (op === 'read' && !path)) {
      tell(peerId, n, 'refused');
      return true;
    }
    queue({ peerId, n, op, path, p: hex40(obj.p), epoch: epochOf(peerId) });
    return true;
  }

  // A save arrives in pieces: the first names the file, the rest carry its bytes, in order.
  function receivePiece(peerId, obj) {
    if (!counted(saveMsgs, peerId, SAVE_MSGS_MIN)) return false;
    const n = hex16(obj.n);
    if (!n || !allowed(peerId)) return false;
    const t = now();
    if (obj.i === 0) {
      if (!counted(saves, peerId, SAVES_MIN) || !fresh(peerId, n)) return false;
      const path = safePath(obj.path);
      const parts = count(obj.parts);
      const size = count(obj.size);
      const hash = hex64(obj.hash);
      const base = hex64(obj.base);
      if (
        !path ||
        parts < 1 ||
        parts > PIECES_MAX ||
        size < 0 ||
        size > FILE_MAX ||
        !hash ||
        !base
      ) {
        assemblies.delete(peerId);
        tell(peerId, n, 'refused');
        return true;
      }
      const job = { peerId, n, op: 'save', path, p: hex40(obj.p), parts, size, hash, base };
      job.epoch = epochOf(peerId);
      job.at = t;
      job.got = [];
      assemblies.set(peerId, job);
      if (parts === 1) finishSave(peerId, job);
      return true;
    }
    const job = assemblies.get(peerId);
    if (!job || job.n !== n) return false;
    const fail = () => {
      assemblies.delete(peerId);
      tell(peerId, n, 'failed');
      return true;
    };
    if (t - job.at > ASSEMBLY_MS || obj.i !== job.got.length + 1) return fail();
    if (typeof obj.data !== 'string' || obj.data.length > (PIECE_BYTES / 3) * 4 + 4) return fail();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(obj.data)) return fail();
    job.got.push(Buffer.from(obj.data, 'base64'));
    if (job.got.length === job.parts - 1) finishSave(peerId, job);
    return true;
  }

  function finishSave(peerId, job) {
    assemblies.delete(peerId);
    const bytes = Buffer.concat(job.got);
    job.got = null;
    if (bytes.length !== job.size || hashOf(bytes) !== job.hash) {
      tell(peerId, job.n, 'failed');
      return;
    }
    job.bytes = bytes;
    queue(job);
  }

  // the newest job of a computer takes the place of one still waiting
  function queue(job) {
    jobs.delete(job.peerId);
    jobs.set(job.peerId, job);
    pump();
  }

  function pump() {
    if (busy || stopped || !jobs.size) return;
    const [peerId, job] = jobs.entries().next().value;
    jobs.delete(peerId);
    busy = true;
    Promise.resolve()
      .then(() => run(job))
      .catch(() => {
        if (stillGood(job)) tell(job.peerId, job.n, 'failed');
      })
      .then(() => {
        busy = false;
        pump();
      });
  }

  // checked when the job's turn comes, and again after every wait
  const stillGood = job => !stopped && epochOf(job.peerId) === job.epoch && allowed(job.peerId);

  const sameProject = job => {
    const mine = hex40(ask(openKey));
    return !!mine && mine === job.p;
  };

  const realOf = async path => {
    try {
      const value = await real(path);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  };

  async function run(job) {
    if (!stillGood(job)) return;
    if (!sameProject(job)) return void tell(job.peerId, job.n, 'project');
    if (isSecret(job.path)) return void tell(job.peerId, job.n, 'hidden');
    job.realPath = await realOf(job.path);
    if (!stillGood(job)) return;
    if (job.realPath === null) return void tell(job.peerId, job.n, 'missing');
    if (isSecret(job.realPath)) return void tell(job.peerId, job.n, 'hidden');
    if (job.op === 'list') return runList(job);
    if (job.op === 'read') return runRead(job);
    return runSave(job);
  }

  async function runList(job) {
    let raw;
    try {
      raw = await list(job.path);
    } catch {
      raw = null;
    }
    if (!stillGood(job)) return;
    if (!Array.isArray(raw)) return void tell(job.peerId, job.n, 'missing');
    let hidden = 0;
    const entries = [];
    for (const item of raw) {
      if (!item || typeof item.name !== 'string') continue;
      const childPath = job.path ? job.path + '/' + item.name : item.name;
      if (safePath(childPath) === null || isSecret(childPath)) {
        hidden++;
        continue;
      }
      const folder = item.kind === 'directory';
      const size = !folder && Number.isInteger(item.size) && item.size >= 0 ? item.size : -1;
      entries.push([item.name, folder ? 'd' : 'f', size, folder ? '' : kindOf(item.name)]);
    }

    // folders first, then by name, as the file rail shows them
    entries.sort((a, b) =>
      a[1] !== b[1]
        ? a[1] === 'd'
          ? -1
          : 1
        : a[0].localeCompare(b[0], undefined, { numeric: true })
    );
    const capped = entries.slice(0, LIST_MAX);
    const packed = packEntries(capped);
    const more = packed.more + (entries.length - capped.length);
    const head = {
      t: 'fs',
      n: job.n,
      i: 0,
      parts: packed.parts.length,
      op: 'list',
      path: job.path,
    };
    if (hidden) head.hidden = hidden;
    if (more) head.more = more;
    head.entries = packed.parts[0];
    const rest = packed.parts.slice(1).map((entriesOfPart, at) => ({
      t: 'fs',
      n: job.n,
      i: at + 1,
      entries: entriesOfPart,
    }));
    sendAll(job, [head, ...rest]);
  }

  async function runRead(job) {
    if (kindOf(job.path) !== 'text')
      return void tell(job.peerId, job.n, 'binary', { kind: kindOf(job.path) });
    let size = -1;
    let bytes = null;
    try {
      const info = await stat(job.path);
      size = count(info && info.size);
      bytes = size >= 0 ? await read(job.path, FILE_MAX) : null;
    } catch {
      bytes = null;
    }
    if (!stillGood(job)) return;
    if (!Buffer.isBuffer(bytes) || size < 0) return void tell(job.peerId, job.n, 'missing');
    if (looksBinary(bytes)) return void tell(job.peerId, job.n, 'binary', { kind: 'binary' });
    const cut = size > bytes.length;
    const list = pieces(bytes);
    const head = {
      t: 'fs',
      n: job.n,
      i: 0,
      parts: list.length + 1,
      op: 'read',
      path: job.path,
      size,
      sent: bytes.length,
      hash: hashOf(bytes),
    };
    if (cut) head.cut = true;
    const ok = sendAll(job, [
      head,
      ...list.map((data, at) => ({ t: 'fs', n: job.n, i: at + 1, data })),
    ]);
    if (ok) ask(onRead, job.peerId, job.path);
  }

  async function runSave(job) {
    if (runsCommands(job.path) || runsCommands(job.realPath))
      return void tell(job.peerId, job.n, 'guarded');
    if (kindOf(job.path) !== 'text') return void tell(job.peerId, job.n, 'binary');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(job.bytes);
    } catch {
      return void tell(job.peerId, job.n, 'refused');
    }
    let current = null;
    let size = -1;
    try {
      const info = await stat(job.path);
      size = count(info && info.size);
      current = size >= 0 && size <= FILE_MAX ? await read(job.path, FILE_MAX) : null;
    } catch {
      current = null;
    }
    if (!stillGood(job) || !sameProject(job)) return;
    if (size > FILE_MAX) return void tell(job.peerId, job.n, 'large');
    if (!Buffer.isBuffer(current)) return void tell(job.peerId, job.n, 'missing');
    if (looksBinary(current)) return void tell(job.peerId, job.n, 'binary');
    if (hashOf(current) !== job.base) return void tell(job.peerId, job.n, 'changed');
    if (hiddenCount(text) > hiddenCount(current.toString('utf8')))
      return void tell(job.peerId, job.n, 'refused');

    // The lock is asked last, in the same turn as the write's call: nothing waits between.
    // the real path again, as late as possible: a link put in its place meanwhile is refused
    const realNow = await realOf(job.path);
    if (!stillGood(job)) return;
    if (realNow !== job.realPath || isSecret(realNow) || runsCommands(realNow))
      return void tell(job.peerId, job.n, 'refused');
    const heldLocks = ask(locks);
    const holder =
      holderOf(heldLocks, job.realPath, caseBlind) || holderOf(heldLocks, job.path, caseBlind);
    if (holder) return void tell(job.peerId, job.n, 'locked', { holder });
    let done = false;
    try {
      done = (await write(job.path, job.bytes)) === true;
    } catch {
      done = false;
    }
    if (!done) return void tell(job.peerId, job.n, 'failed');
    ask(onSaved, job.peerId, job.path);
    tell(job.peerId, job.n, 'saved', { hash: job.hash });
  }

  // An answer starts only when it can finish: room on the link and in the file count for all of
  // its parts. Otherwise one small "busy".
  function sendAll(job, messages) {
    const roomNow = Number(ask(room)) || 0;
    if (recent() + messages.length > FS_MSGS_MIN || roomNow < messages.length) {
      tell(job.peerId, job.n, 'busy');
      return false;
    }
    for (const message of messages) {
      if (!stillGood(job)) return false;
      if (!sendOne(job.peerId, message)) return false;
    }
    return true;
  }

  // A session ended, the switch went off, the pairing was paused or forgotten: what that computer
  // asked is dropped, and a job already running sends nothing more.
  function endFor(peerId) {
    epochs.set(peerId, epochOf(peerId) + 1);
    jobs.delete(peerId);
    assemblies.delete(peerId);
  }

  function stop() {
    stopped = true;
    jobs.clear();
    assemblies.clear();
  }

  return { receive, endFor, stop, busy: () => busy };
}

// ---------- the watcher ----------
// send(peerId, obj) → true when it left. key() → the key of the project open here. random(n) →
// bytes. timers { set(fn, ms), clear(handle) }. on.changed(peerId): what is held of that computer
// changed. What is held lives in memory only and is read with `get`.
function createBrowseAsker({
  now = Date.now,
  send = () => false,
  key = () => '',
  random = size => crypto.randomBytes(size),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) },
  on = {},
}) {
  // peer id → { list, file, save }: each { n, state, ... }
  const held = new Map();
  const changed = peerId => {
    try {
      on.changed?.(peerId);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const slot = peerId => {
    if (!held.has(peerId)) held.set(peerId, { list: null, file: null, save: null });
    return held.get(peerId);
  };
  const newN = () => random(8).toString('hex');
  const projectKey = () => {
    try {
      return hex40(key());
    } catch {
      return '';
    }
  };

  // An ask that gets no answer reads "no answer" after ANSWER_MS.
  const waitFor = (peerId, which, entry) => {
    entry.timer = timers.set(() => {
      const now2 = held.get(peerId);
      if (!now2 || now2[which] !== entry || entry.state !== 'asked') return;
      entry.state = 'no_answer';
      entry.parts = null;
      changed(peerId);
    }, ANSWER_MS);
  };
  const clearWait = entry => {
    if (entry && entry.timer) timers.clear(entry.timer);
    if (entry) entry.timer = null;
  };

  // which: 'list' | 'file'. → { state: 'asked' | 'not_sent' | 'bad_path' | 'no_project' }
  function askFor(peerId, which, op, rawPath) {
    const path = safePath(rawPath);
    if (path === null || (op === 'read' && !path)) return { state: 'bad_path' };
    const p = projectKey();
    if (!p) return { state: 'no_project' };
    const n = newN();
    let ok = false;
    try {
      ok = send(peerId, { t: 'fsask', n, p, op, path }) === true;
    } catch {
      ok = false;
    }
    if (!ok) return { state: 'not_sent' };
    const place = slot(peerId);
    clearWait(place[which]);
    place[which] = { n, path, state: 'asked', at: now(), parts: null };
    waitFor(peerId, which, place[which]);
    changed(peerId);
    return { state: 'asked' };
  }

  const listFolder = (peerId, path) => askFor(peerId, 'list', 'list', path);
  const readFile = (peerId, path) => askFor(peerId, 'file', 'read', path);

  // A new text for the file that is held, read whole (never a cut one). → { state }
  function save(peerId, path, text) {
    const place = held.get(peerId);
    const file = place && place.file;
    if (!file || file.path !== path || file.state !== 'shown' || file.cut)
      return { state: 'not_read' };
    if (typeof text !== 'string') return { state: 'not_sent' };
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > FILE_MAX) return { state: 'large' };
    const p = projectKey();
    if (!p) return { state: 'no_project' };
    const n = newN();
    const list = pieces(bytes);
    const hash = hashOf(bytes);
    const messages = [
      {
        t: 'fssave',
        n,
        i: 0,
        parts: list.length + 1,
        p,
        path,
        base: file.hash,
        size: bytes.length,
        hash,
      },
      ...list.map((data, at) => ({ t: 'fssave', n, i: at + 1, data })),
    ];
    for (const message of messages) {
      let ok = false;
      try {
        ok = send(peerId, message) === true;
      } catch {
        ok = false;
      }
      if (!ok) return { state: 'not_sent' };
    }
    clearWait(place.save);
    place.save = { n, path, state: 'asked', at: now(), text, hash };
    waitFor(peerId, 'save', place.save);
    changed(peerId);
    return { state: 'asked' };
  }

  // An answer of the target: read only for a number this computer asked with.
  function receive(peerId, obj) {
    if (!obj || typeof obj !== 'object' || obj.t !== 'fs') return false;
    const place = held.get(peerId);
    const n = hex16(obj.n);
    if (!place || !n) return false;
    const which = ['list', 'file', 'save'].find(name => place[name] && place[name].n === n);
    if (!which) return false;
    const entry = place[which];
    if (entry.state !== 'asked') return false;
    if (typeof obj.state === 'string') return short(peerId, which, entry, obj);
    if (which === 'save' || !Number.isInteger(obj.i)) return false;
    return partOf(peerId, which, entry, obj);
  }

  const STATES = [
    'refused',
    'busy',
    'project',
    'missing',
    'hidden',
    'large',
    'binary',
    'changed',
    'locked',
    'saved',
    'failed',
    'guarded',
  ];

  function short(peerId, which, entry, obj) {
    const state = STATES.includes(obj.state) ? obj.state : 'failed';
    if (state === 'saved' && which !== 'save') return false;
    clearWait(entry);
    entry.state = state;
    entry.parts = null;
    if (state === 'locked') entry.holder = line(String(obj.holder || ''), 60) || 'another agent';
    if (state === 'binary') entry.kind = Object.hasOwn(KINDS, obj.kind) ? obj.kind : 'binary';

    // a save that landed: the held file is the new text now, so the next edit starts from it
    if (state === 'saved') {
      const place = held.get(peerId);
      const file = place && place.file;
      if (file && file.path === entry.path && hex64(obj.hash) === entry.hash) {
        file.text = entry.text;
        file.hash = entry.hash;
        file.size = Buffer.byteLength(entry.text);
      }
      entry.text = null;
    }
    changed(peerId);
    return true;
  }

  function partOf(peerId, which, entry, obj) {
    if (obj.i === 0) {
      const parts = count(obj.parts);
      const wantOp = which === 'list' ? 'list' : 'read';
      if (obj.op !== wantOp || obj.path !== entry.path || parts < 1) return fail(peerId, entry);
      if (parts > (which === 'list' ? LIST_PARTS : PIECES_MAX)) return fail(peerId, entry);
      entry.parts = { total: parts, got: [], head: obj };
      if (which === 'list') entry.parts.got.push(obj.entries);
    } else {
      if (!entry.parts || obj.i !== entry.parts.got.length + (which === 'list' ? 0 : 1))
        return fail(peerId, entry);
      entry.parts.got.push(which === 'list' ? obj.entries : obj.data);
    }
    const done = entry.parts.got.length === entry.parts.total - (which === 'list' ? 0 : 1);
    if (!done) return true;
    return which === 'list' ? finishList(peerId, entry) : finishFile(peerId, entry);
  }

  function fail(peerId, entry) {
    clearWait(entry);
    entry.state = 'failed';
    entry.parts = null;
    changed(peerId);
    return true;
  }

  function finishList(peerId, entry) {
    const { head, got } = entry.parts;
    const entries = [];
    for (const part of got) {
      if (!Array.isArray(part)) return fail(peerId, entry);
      for (const raw of part) {
        const shaped = shapeEntry(raw);
        if (shaped && entries.length < LIST_MAX) entries.push(shaped);
      }
    }
    clearWait(entry);
    entry.state = 'shown';
    entry.entries = entries;
    entry.hidden = Math.min(Math.max(count(head.hidden), 0), 100000);
    entry.more = Math.min(Math.max(count(head.more), 0), 100000);
    entry.parts = null;
    changed(peerId);
    return true;
  }

  function finishFile(peerId, entry) {
    const { head, got } = entry.parts;
    if (got.some(data => typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)))
      return fail(peerId, entry);
    const bytes = Buffer.concat(got.map(data => Buffer.from(data, 'base64')));
    if (bytes.length > FILE_MAX || bytes.length !== count(head.sent)) return fail(peerId, entry);
    if (hashOf(bytes) !== hex64(head.hash) || looksBinary(bytes)) return fail(peerId, entry);
    clearWait(entry);
    entry.state = 'shown';
    entry.text = bytes.toString('utf8');
    entry.hash = head.hash;
    entry.size = Math.max(count(head.size), bytes.length);
    entry.cut = head.cut === true;

    // a file that makes a tool run commands is read-only from here: that computer refuses its save
    entry.readOnly = runsCommands(entry.path);
    entry.parts = null;
    changed(peerId);
    return true;
  }

  // What is held of that computer, for the window: plain data, no timers.
  function get(peerId) {
    const place = held.get(peerId);
    if (!place) return { list: null, file: null, save: null };
    const plain = entry => {
      if (!entry) return null;
      const out = { path: entry.path, state: entry.state };
      for (const name of [
        'entries',
        'hidden',
        'more',
        'text',
        'size',
        'cut',
        'readOnly',
        'holder',
        'kind',
      ])
        if (entry[name] !== undefined) out[name] = entry[name];
      return out;
    };
    return { list: plain(place.list), file: plain(place.file), save: plain(place.save) };
  }

  // that computer's session ended, or this computer left it: everything held of it goes
  function drop(peerId) {
    const ids = peerId ? [peerId] : [...held.keys()];
    for (const id of ids) {
      const place = held.get(id);
      if (!place) continue;
      clearWait(place.list);
      clearWait(place.file);
      clearWait(place.save);
      held.delete(id);
      changed(id);
    }
  }

  return { listFolder, readFile, save, receive, get, drop };
}

module.exports = {
  createBrowseAnswerer,
  createBrowseAsker,
  safePath,
  isSecret,
  runsCommands,
  realRelative,
  kindOf,
  looksBinary,
  hiddenCount,
  holderOf,
  pieces,
  packEntries,
  shapeEntry,
  hashOf,
  FILE_MAX,
  LIST_MAX,
  LIST_PARTS,
  PIECE_BYTES,
  PIECES_MAX,
  ASKS_MIN,
  SAVES_MIN,
  SAVE_MSGS_MIN,
  FS_MSGS_MIN,
  ASSEMBLY_MS,
  ANSWER_MS,
};
