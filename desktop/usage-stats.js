/*
 * Technically Not desktop · usage-stats.js — Settings › Usage: aggregates REAL token usage
 * from the agent CLIs' own local session logs (never from a network call). Claude Code:
 * ~/.claude/projects/<project>/<session>.jsonl, and the transcripts of that session's helpers
 * (sub-agents) in <project>/<session>/subagents/. Assistant lines carry message.id,
 * message.usage, model, timestamp, sessionId, cwd; the same message is written several times
 * while streaming, so lines are deduped by message id + requestId — last write wins, same
 * shape agent-turns.js reads. A resumed session copies earlier messages into its new file, so
 * that key is also kept once over all files. Codex:
 * ~/.codex/sessions/<y>/<m>/<d>/rollout-<id>.jsonl (session_meta gives sessionId/cwd,
 * turn_context gives the model, token_count gives cumulative totals; one "turn" record per
 * task_started..task_complete/turn_aborted span, same reading agent-turns.js does for its live
 * turn). OpenCode: its own database (opencode-store.js usage(): one record per answer, with
 * its cost; read-only, kept in memory only, and left out when test roots name no "opencode").
 * Roots can be overridden with TNAI_USAGE_ROOTS (JSON {"claude":"<dir>","codex":"<dir>"}) for
 * tests; read fresh on every call. The result also carries plan-limits.js limits (Settings ›
 * Usage "Plan limits"). Files are streamed line by line (never loaded whole), skipped past 95
 * days old, and cached per path+size+mtime so repeat calls are cheap; only one computation
 * runs at a time, shared by concurrent callers. The per-file cache is also kept on disk
 * (userData/usage-cache.jsonl: per-message token counts, model, session id and folder, never
 * message text), so an app start does not read every transcript again, and a transcript that
 * only grew is read from where the last reading stopped.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { limits } = require('./plan-limits');

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_MAX_AGE_MS = 95 * DAY_MS;

// ---------- file discovery ----------
async function listClaudeFiles(root) {
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return { found: false, files: [] };
  }
  const files = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    let inner;
    try {
      inner = await fsp.readdir(path.join(root, d.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of inner) {
      const full = path.join(root, d.name, f.name);

      // A session's helpers (sub-agents) write their own transcripts in
      // <session>/subagents/agent-*.jsonl; their tokens are the session's too.
      if (f.isDirectory()) await listSubagentFiles(path.join(full, 'subagents'), files);
      else if (f.name.toLowerCase().endsWith('.jsonl')) files.push(full);
    }
  }
  return { found: true, files };
}

async function listSubagentFiles(dir, files) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const name of names)
    if (name.toLowerCase().endsWith('.jsonl')) files.push(path.join(dir, name));
}

// The same message can be in several transcripts (a resumed or forked session copies the earlier
// conversation into its new file), so Claude Code records are kept once per message id +
// requestId over all files, not only within one. The first file that has it keeps it.
function uniqueClaudeRecords(files, recordLists) {
  const seen = new Set();
  const out = [];
  files.forEach((filePath, i) => {
    const records = recordLists[i];
    const entry = fileCache.get(filePath);
    if (!entry || entry.records !== records || !entry.keys) {
      out.push(...records);
      return;
    }
    for (const [key, index] of entry.keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(records[index]);
    }
  });
  return out;
}

async function listCodexFiles(root) {
  let st;
  try {
    st = await fsp.stat(root);
  } catch {
    return { found: false, files: [] };
  }
  if (!st.isDirectory()) return { found: false, files: [] };
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && /^rollout-.*\.jsonl$/i.test(e.name)) files.push(p);
    }
  }
  await walk(root);
  return { found: true, files };
}

// ---------- reading a transcript by bytes, so a later reading can go on where this one stopped
// ---------- Calls onLine(buffer) for every line in bytes [start, end) that ends with a newline and
// returns how many bytes those lines took. A last line without its newline is still being written:
// it is left for the next reading, never counted half.
async function readLines(filePath, start, end, onLine) {
  let consumed = 0,
    // rest: chunks of a line that has not ended yet (a list, so a very long line is joined once)
    rest = null;
  if (end <= start) return 0;
  for await (const chunk of fs.createReadStream(filePath, { start, end: end - 1 })) {
    let from = 0,
      nl;
    while ((nl = chunk.indexOf(10, from)) !== -1) {
      let buf = chunk.subarray(from, nl);
      if (rest) {
        rest.push(buf);
        buf = Buffer.concat(rest);
        rest = null;
      }
      consumed += buf.length + 1;
      onLine(buf);
      from = nl + 1;
    }
    if (from < chunk.length) (rest || (rest = [])).push(chunk.subarray(from));
  }
  return consumed;
}

// One newline-ended line as text, without a Windows \r at its end. Only \n ends a line: JSON may
// hold U+2028 and U+2029 unescaped inside a string, and splitting there (as readline did) dropped
// that message's usage.
function textLines(buf, fn) {
  let line = buf.toString('utf8');
  if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
  fn(line);
}

// ---------- Claude Code transcript → per-message usage records ----------
// e.keys: `${message.id}:${requestId}` -> index in e.records (last write wins: a streaming message
// is re-written several times)
function claudeLine(e, line) {
  if (!line || !line.includes('"usage"')) return;
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (j?.type !== 'assistant') return;
  const m = j.message,
    u = m?.usage;
  if (!u || !m.id) return;
  const key = `${m.id}:${j.requestId || ''}`;
  const record = {
    ts: Date.parse(j.timestamp) || Date.now(),
    model: m.model || '',
    cli: 'claude-code',
    sessionId: j.sessionId || '',
    cwd: j.cwd || '',
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
  };
  const at = e.keys.get(key);
  if (at === undefined) {
    e.keys.set(key, e.records.length);
    e.records.push(record);
  } else e.records[at] = record;
}
const USAGE_BYTES = Buffer.from('"usage"');

// ---------- Codex rollout → one record per turn (task_started .. task_complete/turn_aborted)
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const codexTokens = u => ({
  input: Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)),
  output: u.output_tokens || 0,
  cacheRead: u.cached_input_tokens || 0,
  cacheWrite: u.cache_write_input_tokens || 0,
});

// e.state carries what the reading knows at the end of the bytes read so far (the open turn, the
// running totals), so appended lines continue it.
const codexState = () => ({
  model: '',
  sessionId: '',
  cwd: '',
  total: zero(),
  base: zero(),
  turnStart: 0,
  inTurn: false,
});

function codexLine(e, line) {
  if (!line) return;
  const s = e.state;
  let j;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  const ts = Date.parse(j.timestamp) || 0;
  if (j.type === 'session_meta') {
    s.sessionId = j.payload?.session_id || s.sessionId;
    s.cwd = j.payload?.cwd || s.cwd;
    return;
  }
  if (j.type === 'turn_context') {
    if (j.payload?.model) s.model = j.payload.model;
    return;
  }
  if (j.type !== 'event_msg' || !j.payload) return;
  const p = j.payload;
  if (p.type === 'task_started') {
    s.base = s.total;
    s.turnStart = ts;
    s.inTurn = true;
    return;
  }
  if (p.type === 'token_count' && p.info?.total_token_usage) {
    s.total = codexTokens(p.info.total_token_usage);
    return;
  }
  if ((p.type === 'task_complete' || p.type === 'turn_aborted') && s.inTurn) {
    e.records.push({
      ts: ts || s.turnStart || Date.now(),
      model: s.model,
      cli: 'codex',
      sessionId: s.sessionId,
      cwd: s.cwd,
      input: Math.max(0, s.total.input - s.base.input),
      output: Math.max(0, s.total.output - s.base.output),
      cacheRead: Math.max(0, s.total.cacheRead - s.base.cacheRead),
      cacheWrite: Math.max(0, s.total.cacheWrite - s.base.cacheWrite),
    });
    s.inTurn = false;
  }
}

// ---------- OpenCode: one record per answer (assistant message) from its database ----------
// Kept by message id for this run: the first reading takes every answer of the last 95 days, later
// ones only what changed since (time_updated), so an answer still being written is replaced by its
// final numbers. An answer without tokens (an interrupted one) is not a record. A session deleted
// in OpenCode stays counted until the app restarts.
const openCode = { file: '', since: 0, byId: new Map() };

function openCodeRecords(file) {
  const store = require('./opencode-store');
  if (!fs.existsSync(file)) {
    openCode.byId.clear();
    openCode.since = 0;
    return { found: false, records: [] };
  }
  if (openCode.file !== file) {
    openCode.file = file;
    openCode.since = 0;
    openCode.byId.clear();
  }
  const rows = store.usage(openCode.since || Date.now() - FILE_MAX_AGE_MS, file);
  for (const r of rows || []) {
    const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    if (n(r.updated) > openCode.since) openCode.since = r.updated;
    const record = {
      ts: n(r.ts),
      model: r.model ? (r.provider ? r.provider + '/' : '') + r.model : '',
      cli: 'opencode',
      sessionId: String(r.sessionId || ''),
      cwd: String(r.cwd || ''),
      input: n(r.input),
      output: n(r.output) + n(r.reasoning),
      cacheRead: n(r.cacheRead),
      cacheWrite: n(r.cacheWrite),
      cost: n(r.cost),
    };
    if (record.input + record.output + record.cacheRead + record.cacheWrite > 0)
      openCode.byId.set(r.id, record);
    else openCode.byId.delete(r.id);
  }
  const oldest = Date.now() - FILE_MAX_AGE_MS;
  for (const [id, r] of openCode.byId) if (r.ts < oldest) openCode.byId.delete(id);
  return { found: rows !== null, records: [...openCode.byId.values()] };
}

// ---------- per-file cache; files older than 95 days are skipped, not parsed ----------
// path -> { kind: 'claude'|'codex', size, mtimeMs (the file when it was read), offset (bytes read,
// always just after a newline), head + headLen (hash of the file's first bytes: the same file is
// still there), records, keys (claude) | state (codex) }
const fileCache = new Map();
const HEAD_BYTES = 1024;
let dirty = false; // the cache differs from the file on disk

// how the last collect() got each file (tools/desktop-check/usage-cache-check.js)
let scan = { full: 0, appended: 0, cached: 0, fromDisk: 0 };
const newEntry = kind => ({
  kind,
  size: 0,
  mtimeMs: 0,
  offset: 0,
  head: '',
  headLen: 0,
  records: [],
  ...(kind === 'claude' ? { keys: new Map() } : { state: codexState() }),
});
const sha1 = data => crypto.createHash('sha1').update(data).digest('hex');

async function readHead(filePath, len) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len),
      { bytesRead } = await fh.read(buf, 0, len, 0);
    return bytesRead === len ? sha1(buf) : '';
  } finally {
    await fh.close();
  }
}

// True when the bytes already read are still what the file starts with (transcripts are only ever
// added to), so only the new bytes need reading.
async function sameStart(filePath, e) {
  try {
    if ((await readHead(filePath, e.headLen)) !== e.head) return false;
    if (!e.offset) return true;
    const fh = await fsp.open(filePath, 'r');
    try {
      const b = Buffer.alloc(1);
      return (await fh.read(b, 0, 1, e.offset - 1)).bytesRead === 1 && b[0] === 10;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

async function getFileRecords(filePath, kind) {
  let st;
  const drop = () => {
    if (fileCache.delete(filePath)) dirty = true;
    return [];
  };
  try {
    st = await fsp.stat(filePath);
  } catch {
    return drop();
  }
  if (Date.now() - st.mtimeMs > FILE_MAX_AGE_MS) return drop();
  const cached = fileCache.get(filePath);
  if (cached && cached.kind === kind && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
    scan.cached++;
    return cached.records;
  }

  // A changed transcript was read whole again (the largest here is 109 MB): one that only grew is
  // read from where the last reading stopped. Smaller, older, or a different start: read whole.
  const grew =
    !!cached &&
    cached.kind === kind &&
    st.size > cached.size &&
    st.mtimeMs >= cached.mtimeMs &&
    (await sameStart(filePath, cached));
  const e = grew ? cached : newEntry(kind);
  try {
    if (!grew) {
      e.headLen = Math.min(st.size, HEAD_BYTES);
      e.head = await readHead(filePath, e.headLen);
    }
    e.offset += await readLines(
      filePath,
      e.offset,
      st.size,
      kind === 'claude'
        ? buf => {
            if (buf.indexOf(USAGE_BYTES) !== -1) textLines(buf, line => claudeLine(e, line));
          }
        : buf => {
            if (buf.length) textLines(buf, line => codexLine(e, line));
          }
    );
  } catch (err) {
    drop();
    throw err;
  } // half-read: nothing of it is kept, the next call reads the file whole
  e.size = st.size;
  e.mtimeMs = st.mtimeMs;
  fileCache.set(filePath, e);
  dirty = true;
  if (grew) scan.appended++;
  else scan.full++;
  return e.records;
}

// ---------- the cache on disk: userData/usage-cache.jsonl ----------
// Line 1 names the format; a different one is not read. Then one line per transcript, "<hash of the
// text> <JSON>": a line that fails its hash or its shape is skipped, and that transcript is read
// whole again. Read once, at the first collect(); written after a collect() that changed it.
const CACHE_HEAD = '{"tnaiUsageCache":1}';

function cacheFile() {
  if (process.env.TNAI_USAGE_CACHE) return process.env.TNAI_USAGE_CACHE; // tests
  try {
    return path.join(require('electron').app.getPath('userData'), 'usage-cache.jsonl');
  } catch {
    return '';
  } // plain Node: memory only
}

// the main process handles input between slices of a long loop
const breathe = () => new Promise(setImmediate);

function packEntry(filePath, e) {
  const str = [],
    seen = new Map(),
    id = s => {
      let i = seen.get(s);
      if (i === undefined) {
        i = str.length;
        str.push(s);
        seen.set(s, i);
      }
      return i;
    };
  const r = [];
  for (const x of e.records)
    r.push(
      x.ts,
      id(x.model),
      id(x.sessionId),
      id(x.cwd),
      x.input,
      x.output,
      x.cacheRead,
      x.cacheWrite
    );
  const text = JSON.stringify({
    p: filePath,
    k: e.kind,
    s: e.size,
    m: e.mtimeMs,
    o: e.offset,
    h: e.head,
    hl: e.headLen,
    str,
    r,
    x: e.kind === 'claude' ? [...e.keys.keys()] : e.state,
  });
  return sha1(text).slice(0, 16) + ' ' + text;
}

function unpackEntry(line) {
  const text = line.slice(17);
  if (line[16] !== ' ' || sha1(text).slice(0, 16) !== line.slice(0, 16)) return null;
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    s = v => typeof v === 'string';
  const cli = j.k === 'claude' ? 'claude-code' : j.k === 'codex' ? 'codex' : '';
  if (
    !cli ||
    !s(j.p) ||
    !s(j.h) ||
    ![j.s, j.m, j.o, j.hl].every(num) ||
    j.o > j.s ||
    !Array.isArray(j.str) ||
    !j.str.every(s) ||
    !Array.isArray(j.r) ||
    j.r.length % 8 ||
    !j.r.every(num)
  )
    return null;
  const e = {
      kind: j.k,
      size: j.s,
      mtimeMs: j.m,
      offset: j.o,
      head: j.h,
      headLen: j.hl,
      records: [],
    },
    r = j.r;
  for (let i = 0; i < r.length; i += 8) {
    const model = j.str[r[i + 1]],
      sessionId = j.str[r[i + 2]],
      cwd = j.str[r[i + 3]];
    if (!s(model) || !s(sessionId) || !s(cwd)) return null;
    e.records.push({
      ts: r[i],
      model,
      cli,
      sessionId,
      cwd,
      input: r[i + 4],
      output: r[i + 5],
      cacheRead: r[i + 6],
      cacheWrite: r[i + 7],
    });
  }
  if (j.k === 'claude') {
    if (!Array.isArray(j.x) || j.x.length !== e.records.length || !j.x.every(s)) return null;
    e.keys = new Map(j.x.map((k, i) => [k, i]));
    if (e.keys.size !== j.x.length) return null;
  } else {
    const t = v => !!v && [v.input, v.output, v.cacheRead, v.cacheWrite].every(num),
      x = j.x;
    if (
      !x ||
      !s(x.model) ||
      !s(x.sessionId) ||
      !s(x.cwd) ||
      !t(x.total) ||
      !t(x.base) ||
      !num(x.turnStart) ||
      typeof x.inTurn !== 'boolean'
    )
      return null;
    e.state = x;
  }
  return { filePath: j.p, e };
}
let loaded = false;

async function loadCache() {
  loaded = true;
  const file = cacheFile();
  let text;
  try {
    text = file ? await fsp.readFile(file, 'utf8') : '';
  } catch {
    text = '';
  }
  const lines = text.split('\n');
  if (lines[0] !== CACHE_HEAD) return;
  let t = Date.now();
  for (let i = 1; i < lines.length; i++) {
    const got = lines[i] && unpackEntry(lines[i]);
    if (got && !fileCache.has(got.filePath)) {
      fileCache.set(got.filePath, got.e);
      scan.fromDisk++;
    }
    if (Date.now() - t > 8) {
      await breathe();
      t = Date.now();
    }
  }
}

// Temp file + rename, off the main thread, one write at a time; a failed write leaves the old file
// and is tried again after the next collect().
let saving = null;

function saveCache() {
  const file = cacheFile();
  if (!file || saving || !dirty) return;
  dirty = false;
  saving = (async () => {
    const temp = file + '.tmp',
      out = [CACHE_HEAD];
    try {
      let t = Date.now();
      for (const [filePath, e] of [...fileCache]) {
        out.push(packEntry(filePath, e));
        if (Date.now() - t > 8) {
          await breathe();
          t = Date.now();
        }
      }
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(temp, out.join('\n') + '\n');
      await fsp.rename(temp, file);
    } catch {
      dirty = true;
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  })().finally(() => {
    saving = null;
  });
}

// A modest concurrency cap keeps this from opening hundreds of file handles at once on a big
// history.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- local-time day helpers ----------
function localMidnight(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- aggregation ----------
function aggregate(allRecords, sources) {
  const now = Date.now();
  const day90Start = new Date(localMidnight(now));
  day90Start.setDate(day90Start.getDate() - 89);
  const day30Start = new Date(localMidnight(now));
  day30Start.setDate(day30Start.getDate() - 29);
  const day90StartMs = day90Start.getTime(),
    day30StartMs = day30Start.getTime();

  const dayMap = new Map();
  for (let i = 0; i < 90; i++) {
    const d = new Date(day90Start);
    d.setDate(day90Start.getDate() + i);
    dayMap.set(localDateStr(d), {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      turns: 0,
      sessions: new Set(),
    });
  }
  const modelMap = new Map();
  const hours = new Array(24).fill(0);

  // Overview Token flow "hour"/"day" (94): tokens per minute for the last 24 h, oldest first,
  // ending at the minute of `now`. Fixed size (1440 numbers, ~10 KB) however much history there is;
  // 94 adds only live samples newer than generatedAt, so nothing counts twice.
  const MIN_MS = 60e3,
    minuteEnd = Math.floor(now / MIN_MS) * MIN_MS + MIN_MS,
    minuteStart = minuteEnd - 1440 * MIN_MS;
  const minutes = new Array(1440).fill(0);
  const projectMap = new Map();
  const sessionMap30 = new Map(); // sessionId -> { turns, records: [] }, last 30 days
  let cacheRead30 = 0,
    cacheWrite30 = 0,
    input30 = 0;

  for (const r of allRecords) {
    // "tokens" everywhere below excludes cache reads
    const tokens = r.input + r.output + r.cacheWrite;
    if (r.ts >= minuteStart && r.ts < minuteEnd)
      minutes[Math.floor((r.ts - minuteStart) / MIN_MS)] += tokens;

    if (r.ts >= day90StartMs) {
      const bucket = dayMap.get(localDateStr(new Date(r.ts)));
      if (bucket) {
        bucket.input += r.input;
        bucket.output += r.output;
        bucket.cacheWrite += r.cacheWrite;
        bucket.cacheRead += r.cacheRead;
        bucket.turns += 1;
        if (r.sessionId) bucket.sessions.add(r.sessionId);
      }
    }
    if (r.model && r.model !== '<synthetic>') {
      const mkey = r.model + '|' + r.cli;
      let e = modelMap.get(mkey);
      if (!e) {
        e = { model: r.model, cli: r.cli, tokens: 0, turns: 0 };
        modelMap.set(mkey, e);
      }
      e.tokens += tokens;
      e.turns += 1;
    }
    if (r.ts >= day30StartMs) {
      hours[new Date(r.ts).getHours()] += tokens;
      if (r.cwd) {
        const name = path.basename(r.cwd) || r.cwd;
        projectMap.set(name, (projectMap.get(name) || 0) + tokens);
      }
      cacheRead30 += r.cacheRead;
      cacheWrite30 += r.cacheWrite;
      input30 += r.input;
      if (r.sessionId) {
        let s = sessionMap30.get(r.sessionId);
        if (!s) {
          s = { turns: 0, records: [] };
          sessionMap30.set(r.sessionId, s);
        }
        s.turns += 1;
        s.records.push(r);
      }
    }
  }

  const days = [...dayMap.entries()].map(([date, b]) => ({
    date,
    input: b.input,
    output: b.output,
    cacheWrite: b.cacheWrite,
    cacheRead: b.cacheRead,
    turns: b.turns,
    sessions: b.sessions.size,
  }));
  const models = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens);

  // allProjects (up to 100) lets Overview's Token flow fold every project into "Other" and total
  // the full 30 days; projects stays the top 8 (59).
  const allProjects = [...projectMap.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 100);
  const projects = allProjects.slice(0, 8);

  let totalTurns30 = 0,
    longest = { turns: 0, peakContext: 0 };
  for (const s of sessionMap30.values()) {
    totalTurns30 += s.turns;
    if (s.turns > longest.turns) {
      let peak = 0;
      for (const r of s.records) peak = Math.max(peak, r.input + r.cacheRead + r.cacheWrite);
      longest = { turns: s.turns, peakContext: peak };
    }
  }
  const sessionCount = sessionMap30.size;
  const avgTurns = sessionCount ? totalTurns30 / sessionCount : 0;
  const cacheHitRate =
    cacheRead30 + cacheWrite30 + input30 > 0
      ? cacheRead30 / (cacheRead30 + cacheWrite30 + input30)
      : 0;

  return {
    generatedAt: now,
    sources,
    days,
    models,
    hours,
    recent: { start: minuteStart, stepMs: MIN_MS, tokens: minutes },
    projects,
    allProjects,
    sessions: { count: sessionCount, avgTurns, longest },
    cache: { read: cacheRead30, write: cacheWrite30, hitRate: cacheHitRate },
  };
}

// ---------- one computation at a time; concurrent callers share it ----------
let inFlight = null;

function stats() {
  if (!inFlight)
    inFlight = compute().finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function compute() {
  // Plan limits (plan-limits.js) run alongside the log reading
  const planLimits = limits().catch(() => []);
  const { allRecords, sources } = await collect();
  return { ...aggregate(allRecords, sources), limits: await planLimits };
}

// Every per-message/per-turn record ({ ts, cli, input, output, cacheRead, cacheWrite, ... }) from
// the same cached file reading. One reading at a time (stats() and records() share it): a file is
// continued from its saved place, and two readings would both add its new lines.
let collecting = null;

function collect() {
  return (
    collecting ||
    (collecting = collectNow().finally(() => {
      collecting = null;
    }))
  );
}

async function collectNow() {
  scan = { full: 0, appended: 0, cached: 0, fromDisk: 0 };

  // The cache lived only in memory, so the first call after every app start read every transcript
  // again (measured 2026-10-05: 1,236 files, 2,357 MB).
  if (!loaded) await loadCache();
  if (saving) await saving; // a save still writing must not see a file half continued
  let roots = {};
  try {
    roots = JSON.parse(process.env.TNAI_USAGE_ROOTS || '{}') || {};
  } catch {
    roots = {};
  }
  const claudeRoot = roots.claude || path.join(os.homedir(), '.claude', 'projects');
  const codexRoot = roots.codex || path.join(os.homedir(), '.codex', 'sessions');

  const [claudeList, codexList] = await Promise.all([
    listClaudeFiles(claudeRoot),
    listCodexFiles(codexRoot),
  ]);
  const [claudeRecords, codexRecords] = await Promise.all([
    mapLimit(claudeList.files, 12, f => getFileRecords(f, 'claude')),
    mapLimit(codexList.files, 12, f => getFileRecords(f, 'codex')),
  ]);
  const seen = new Set([...claudeList.files, ...codexList.files]);
  for (const k of [...fileCache.keys()])
    if (!seen.has(k)) {
      fileCache.delete(k);
      dirty = true;
    } // transcripts deleted since the last scan

  // OpenCode: the user's own database, or the one the test roots name; test roots without one read
  // none (a check must not count this PC's real work).
  const openCodeFile =
    roots.opencode || (process.env.TNAI_USAGE_ROOTS ? '' : require('./opencode-store').dbFile());
  let oc = { found: false, records: [] };
  if (openCodeFile)
    try {
      oc = openCodeRecords(openCodeFile);
    } catch {}
  const allRecords = [].concat(
    uniqueClaudeRecords(claudeList.files, claudeRecords),
    ...codexRecords,
    oc.records
  );
  saveCache();

  const sources = [
    {
      cli: 'claude-code',
      root: claudeRoot,
      found: claudeList.found,
      files: claudeList.files.length,
    },
    { cli: 'codex', root: codexRoot, found: codexList.found, files: codexList.files.length },
    ...(openCodeFile
      ? [{ cli: 'opencode', root: openCodeFile, found: oc.found, files: oc.found ? 1 : 0 }]
      : []),
  ];
  return { allRecords, sources };
}

// The records of Claude Code and Codex only, without OpenCode's (tools/desktop-check/usage-check.js
// reads them).
const records = async () => (await collect()).allRecords.filter(r => r.cli !== 'opencode');

module.exports = {
  stats,
  records,
  lastScan: () => ({ ...scan }),
  cacheSaved: () => saving || Promise.resolve(),
}; // the last two: usage-cache-check.js
