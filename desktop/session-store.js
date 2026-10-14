// Technically Not desktop · session-store.js — Keeps each pane's session record and scrollback on
// disk so progress survives crashes, closing, and reloading; finds resumable conversations.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const SCROLLBACK = 256 * 1024; // same cap as pty-service
let dir = '',
  // paneId -> { paneId, agent, accountId, customAgentId, sessionId, cwd, startedAt, running,
  // lastOutputAt, exitCode }
  records = new Map();

const safeId = paneId => String(paneId).replace(/[^\w.-]/g, '_');
const scrollbackFile = paneId => path.join(dir, 'scrollback', safeId(paneId) + '.log');

// Temp file + rename, so a crash mid-write never leaves a half-written file.
// Sync form: quitting (the process may end right after). Async form: everything else; one write per
// file at a time, the latest text wins, and a write that a newer sync write / forget overtook drops
// its temp file instead of renaming it over the newer one.
const gen = new Map(); // file -> generation of its latest write
const writing = new Map(); // file -> { text } async write in progress
const bump = file => {
  const g = (gen.get(file) || 0) + 1;
  gen.set(file, g);
  return g;
};

function writeAtomic(file, text) {
  bump(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

function writeAtomicLater(file, text) {
  const job = writing.get(file);
  if (job) {
    job.text = text;
    return;
  }
  const me = { text };
  writing.set(file, me);
  (async () => {
    while (me.text != null) {
      const t = me.text,
        g = bump(file),
        temp = file + '.' + process.pid + '.a.tmp';
      me.text = null;
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(temp, t);
        if (gen.get(file) === g) await fs.promises.rename(temp, file);
        else await fs.promises.rm(temp, { force: true });
      } catch {}
    }
    writing.delete(file);
  })();
}

// Scrollback saves, one queue per file so appends and full rewrites land in order: a full rewrite
// drops the appends queued before it (its text already holds them), and any op queued before a sync
// write or forget (both bump) is dropped. Full rewrites here don't bump, so the appends queued
// after one still apply.
const scrollJobs = new Map(); // file -> { ops: [{ full, g } | { append, g }], running }

function queueScrollback(file, op) {
  let job = scrollJobs.get(file);
  if (!job) {
    job = { ops: [] };
    scrollJobs.set(file, job);
  }
  op.g = gen.get(file) || 0;
  const last = job.ops[job.ops.length - 1];
  if (op.full != null) job.ops = [op];
  else if (last && last.append != null && last.g === op.g) last.append += op.append;
  else job.ops.push(op);
  if (job.running) return;
  job.running = true;
  (async () => {
    while (job.ops.length) {
      const o = job.ops.shift(),
        current = () => (gen.get(file) || 0) === o.g;
      if (!current()) continue;
      try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        if (o.full != null) {
          const temp = file + '.' + process.pid + '.a.tmp';
          await fs.promises.writeFile(temp, o.full);
          if (current()) await fs.promises.rename(temp, file);
          else await fs.promises.rm(temp, { force: true });
        } else {
          // never creates the file: a pane that was forgotten mid-append stays gone
          const fh = await fs.promises.open(file, fs.constants.O_WRONLY | fs.constants.O_APPEND);
          try {
            await fh.write(o.append);
          } finally {
            await fh.close();
          }
        }
      } catch {}
    }
    job.running = false;
    scrollJobs.delete(file);
  })();
}

// Resumable-conversation lookups (pty-service.js tick): a miss is remembered for MISS_MS so a pane
// does not rescan every 2 s.
const MISS_MS = 10000,
  SCAN_CONC = 16;
const claudeSeen = new Map(); // sessionId -> { ok, at }
const codexMiss = new Map(); // since|cwd|home|taken -> time of the last miss

async function someAsync(items, test) {
  let i = 0,
    hit = false;
  const worker = async () => {
    while (!hit && i < items.length) if (await test(items[i++])) hit = true;
  };
  await Promise.all(Array.from({ length: Math.min(SCAN_CONC, items.length) }, worker));
  return hit;
}
const existsAsync = f =>
  fs.promises.access(f).then(
    () => true,
    () => false
  );
const claudeHomes = accountDir =>
  [accountDir, process.env.CLAUDE_CONFIG_DIR, path.join(os.homedir(), '.claude')].filter(Boolean);
const codexDays = (since, accountDir) => {
  const home = accountDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return [
    ...new Set(
      [new Date(since), new Date()].map(d =>
        path.join(
          home,
          'sessions',
          String(d.getFullYear()),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')
        )
      )
    ),
  ];
};
const remember = (sessionId, ok, watched = false) => {
  if (claudeSeen.size > 500) claudeSeen.clear();
  claudeSeen.set(sessionId, { ok, at: Date.now(), watched });
  return ok;
};

// A remembered answer still good: a find is kept for good; a miss for MISS_MS, or WATCHED_MISS_MS
// while a folder watch reports new transcripts.
const WATCHED_MISS_MS = 60000,
  WATCH_IDLE_MS = 90000;
const fresh = seen =>
  !!seen && (seen.ok || Date.now() - seen.at < (seen.watched ? WATCHED_MISS_MS : MISS_MS));

// Instead of rescanning every projects/<folder> until a new session's transcript appears, one
// recursive watch per projects folder marks the session found the moment <id>.jsonl is written. It
// closes once nothing is pending or no lookup renewed it for WATCH_IDLE_MS (the pane ended).
// Returns false when the folder can't be watched (then the scan above keeps its MISS_MS rhythm).
const transcriptWatch = new Map(); // projects folder -> { w, ids, timer }

function watchTranscripts(projects, sessionId) {
  let t = transcriptWatch.get(projects);
  if (!t) {
    let w;
    try {
      w = fs.watch(projects, { recursive: true });
    } catch {
      return false;
    }
    t = { w, ids: new Set(), timer: null };
    const close = () => {
      clearTimeout(t.timer);
      try {
        w.close();
      } catch {}
      if (transcriptWatch.get(projects) === t) transcriptWatch.delete(projects);
    };
    t.close = close;
    w.on('error', () => {
      close();
      for (const id of t.ids) {
        const s = claudeSeen.get(id);
        if (s && !s.ok) s.watched = false;
      }
    });
    w.on('change', (_, name) => {
      if (!name) {
        for (const id of t.ids) {
          const s = claudeSeen.get(id);
          if (s && !s.ok) s.at = 0;
        }
        return;
      } // unknown file: rescan next time
      const base = path.basename(String(name));
      if (!base.endsWith('.jsonl')) return;
      const id = base.slice(0, -6);
      if (!t.ids.has(id) || !fs.existsSync(path.join(projects, String(name)))) return;
      t.ids.delete(id);
      remember(id, true);
      if (!t.ids.size) close();
    });
    transcriptWatch.set(projects, t);
  }
  t.ids.add(sessionId);
  clearTimeout(t.timer);
  t.timer = setTimeout(t.close, WATCH_IDLE_MS);
  t.timer.unref?.();
  return true;
}

// The first line is session_meta. Codex 0.155+ puts its whole base_instructions in it (~19 KB),
// longer than the read: then id and cwd, which come before it, are taken from the line's start.
const metaField = (line, key) => {
  const m = line.match(new RegExp('"' + key + '":("(?:[^"\\\\]|\\\\.)*")'));
  try {
    return m ? JSON.parse(m[1]) : '';
  } catch {
    return '';
  }
};
const codexMeta = (buf, n, cwd, taken) => {
  const line = buf.toString('utf8', 0, n).split('\n')[0];
  let meta;
  try {
    meta = JSON.parse(line).payload || {};
  } catch {
    meta = { id: metaField(line, 'id'), cwd: metaField(line, 'cwd') };
  }
  return meta.id &&
    !taken.has(meta.id) &&
    path.resolve(meta.cwd || '').toLowerCase() === path.resolve(cwd || '').toLowerCase()
    ? meta.id
    : '';
};

function init() {
  dir = app.getPath('userData');
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'));
    records = new Map(
      (Array.isArray(list) ? list : []).filter(r => r && r.paneId).map(r => [r.paneId, r])
    );
  } catch {
    records = new Map();
  }
  sweepTemps();
}

// A write cut off by a crash leaves its temp file for good (found 2026-10-05: 3 in scrollback/,
// 0.93 MB). Those older than a day go, in the scrollback folder only and off the main thread; a day
// is far longer than any write in progress. Logs are never removed here.
function sweepTemps() {
  const folder = path.join(dir, 'scrollback'),
    old = Date.now() - 24 * 60 * 60 * 1000;
  (async () => {
    let names = [];
    try {
      names = await fs.promises.readdir(folder);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.tmp')) continue;
      const f = path.join(folder, name);
      try {
        const st = await fs.promises.stat(f);
        if (st.isFile() && st.mtimeMs < old) await fs.promises.rm(f, { force: true });
      } catch {}
    }
  })();
}

function persist(sync) {
  if (!dir) return;
  const file = path.join(dir, 'sessions.json'),
    text = JSON.stringify([...records.values()]);
  try {
    if (sync) writeAtomic(file, text);
    else writeAtomicLater(file, text);
  } catch {}
}

module.exports = {
  init,
  // temp file + rename: a crash mid-write never leaves a truncated file (also used by
  // agent-lifecycle/-graph/-context)
  writeAtomic,
  // the same off the main thread (their debounced saves; quitting uses writeAtomic)
  writeAtomicLater,
  get: paneId => records.get(paneId) || null,
  // Merges fields into the pane's record and writes the file (sync: Technically Not is quitting).
  update(paneId, fields, sync = false) {
    records.set(paneId, { ...(records.get(paneId) || { paneId }), ...fields, paneId });
    persist(sync);
  },
  saveScrollback(paneId, buffer, sync = false) {
    try {
      const f = scrollbackFile(paneId),
        t = String(buffer).slice(-SCROLLBACK);
      if (sync) writeAtomic(f, t);
      else queueScrollback(f, { full: t });
    } catch {}
  },
  // New output only, added to the end of the file (pty-service.js tick): a busy pane no longer
  // rewrites its whole file every 2 s.
  appendScrollback(paneId, text) {
    try {
      queueScrollback(scrollbackFile(paneId), { append: String(text) });
    } catch {}
  },
  readScrollback(paneId) {
    try {
      return fs.readFileSync(scrollbackFile(paneId), 'utf8');
    } catch {
      return '';
    }
  },
  readScrollbackAsync: paneId =>
    fs.promises.readFile(scrollbackFile(paneId), 'utf8').catch(() => ''),
  // The pane was closed: its record and output are no longer needed.
  forget(paneId) {
    records.delete(paneId);
    persist();
    const f = scrollbackFile(paneId);
    bump(f); // an async save still in flight must not bring it back
    try {
      fs.rmSync(f, { force: true });
    } catch {}
  },

  // Claude Code saves a conversation as projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl
  // once it has a message. Sync (pane start / stop / restore): uses a remembered answer when there
  // is one. A found transcript is remembered for good.
  claudeTranscriptExists(sessionId, cwd, accountDir) {
    if (!sessionId) return false;
    const seen = claudeSeen.get(sessionId);
    if (seen && (seen.ok || Date.now() - seen.at < MISS_MS)) return seen.ok;
    const slug = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
    let ok = false;
    for (const home of claudeHomes(accountDir)) {
      const projects = path.join(home, 'projects');
      if (slug && fs.existsSync(path.join(projects, slug, sessionId + '.jsonl'))) {
        ok = true;
        break;
      }
      try {
        if (
          fs
            .readdirSync(projects)
            .some(d => fs.existsSync(path.join(projects, d, sessionId + '.jsonl')))
        ) {
          ok = true;
          break;
        }
      } catch {}
    }
    return remember(sessionId, ok);
  },
  // Async form for the 2 s tick. After a full miss, the projects folders are watched
  // (watchTranscripts) and each tick checks only the project's own folder (one stat) until the
  // watch reports the transcript; a full rescan runs every WATCHED_MISS_MS as a safety net.
  async claudeTranscriptExistsAsync(sessionId, cwd, accountDir) {
    if (!sessionId) return false;
    const seen = claudeSeen.get(sessionId);
    const slug = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
    if (fresh(seen) && seen.watched && !seen.ok && slug) {
      for (const home of claudeHomes(accountDir))
        if (await existsAsync(path.join(home, 'projects', slug, sessionId + '.jsonl')))
          return remember(sessionId, true);
      return claudeSeen.get(sessionId)?.ok || false;
    }
    if (fresh(seen)) return seen.ok;
    let ok = false,
      watched = true;
    for (const home of claudeHomes(accountDir)) {
      const projects = path.join(home, 'projects');
      if (slug && (await existsAsync(path.join(projects, slug, sessionId + '.jsonl')))) {
        ok = true;
        break;
      }
      let dirs = [];
      try {
        dirs = await fs.promises.readdir(projects);
      } catch {
        watched = false;
        continue;
      }
      if (await someAsync(dirs, d => existsAsync(path.join(projects, d, sessionId + '.jsonl')))) {
        ok = true;
        break;
      }
      if (!watchTranscripts(projects, sessionId)) watched = false;
    }
    if (ok) return remember(sessionId, true);
    if (claudeSeen.get(sessionId)?.ok) return true; // the watch saw it while the scan ran
    return remember(sessionId, false, watched);
  },

  // Gemini CLI 0.61 saves a conversation as <GEMINI_CLI_HOME or
  // ~>/.gemini/tmp/<project>/chats/session-<time>-<first 8 of the id>.jsonl as soon as it starts,
  // with only its own <session_context> message; `--resume <id>` refuses it ("No previous sessions
  // found for this project") until the file holds a message of the user's or a model reply (its
  // isResumableMessageRecord). Async, for the 2 s tick; a found one is remembered like Claude's.
  async geminiSessionExists(sessionId) {
    if (!sessionId) return false;
    const seen = claudeSeen.get(sessionId);
    if (seen && (seen.ok || Date.now() - seen.at < MISS_MS)) return seen.ok;
    const tmp = path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini', 'tmp'),
      end = '-' + String(sessionId).slice(0, 8) + '.jsonl';
    const text = c =>
      typeof c === 'string'
        ? c
        : Array.isArray(c)
          ? c.map(text).join('')
          : c && typeof c === 'object'
            ? String(c.text || '')
            : '';
    const real = m =>
      m &&
      (m.type === 'user'
        ? !/^<(session|hook)_context>/.test(text(m.content).trim())
        : m.type === 'gemini' &&
          (!!text(m.content).trim() || !!m.toolCalls?.length || !!m.thoughts?.length));
    const resumable = async file => {
      let lines = [];
      try {
        lines = (await fs.promises.readFile(file, 'utf8')).split('\n');
      } catch {
        return false;
      }
      return lines.some(line => {
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          return false;
        }
        return (
          real(o) ||
          [o?.messages, o?.$set?.messages, o?.$push?.messages].some(list =>
            Array.isArray(list) ? list.some(real) : real(list)
          )
        );
      });
    };
    let dirs = [];
    try {
      dirs = await fs.promises.readdir(tmp);
    } catch {}
    const ok = await someAsync(dirs, async d => {
      const chats = path.join(tmp, d, 'chats');
      try {
        return await someAsync(
          (await fs.promises.readdir(chats)).filter(
            f => f.startsWith('session-') && f.endsWith(end)
          ),
          f => resumable(path.join(chats, f))
        );
      } catch {
        return false;
      }
    });
    return remember(sessionId, ok);
  },
  // GitHub Copilot 1.0.88 makes <COPILOT_HOME or ~/.copilot>/session-state/<id>/ as soon as
  // `--session-id` starts it, but `--resume <id>` refuses that until the session has a message ("No
  // session, task, or name matched"). Its event log (events.jsonl there) is the sign it has one:
  // INFERRED, not seen on a real conversation (the checked PC's account has no Copilot chat
  // access).
  async copilotSessionExists(sessionId, accountDir) {
    if (!sessionId) return false;
    const seen = claudeSeen.get(sessionId);
    if (seen && (seen.ok || Date.now() - seen.at < MISS_MS)) return seen.ok;
    const home = accountDir || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
    let ok = false;
    try {
      ok =
        (
          await fs.promises.stat(
            path.join(home, 'session-state', String(sessionId), 'events.jsonl')
          )
        ).size > 0;
    } catch {}
    return remember(sessionId, ok);
  },

  // Codex writes sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl whose first line is session_meta
  // with id and cwd. Returns the id of the newest rollout created since `since` for `cwd`, skipping
  // ids other panes already own. Async; a miss for the same pane (since, cwd, account, ids taken)
  // is remembered for MISS_MS.
  async findCodexSession(since, cwd, accountDir, taken = new Set()) {
    const key = [since, cwd, accountDir, [...taken].sort().join(',')].join('|');
    if (Date.now() - (codexMiss.get(key) || 0) < MISS_MS) return '';
    const found = [];
    for (const day of codexDays(since, accountDir)) {
      let names = [];
      try {
        names = (await fs.promises.readdir(day)).filter(n => /^rollout-.*\.jsonl$/.test(n));
      } catch {
        continue;
      }
      await someAsync(names, async name => {
        const file = path.join(day, name);
        let fh;
        try {
          const st = await fs.promises.stat(file);
          if (st.birthtimeMs < since - 2000 && st.mtimeMs < since) return false;
          fh = await fs.promises.open(file, 'r');
          const buf = Buffer.alloc(4096),
            { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          const id = codexMeta(buf, bytesRead, cwd, taken);
          if (id) found.push({ id, at: st.birthtimeMs });
        } catch {
        } finally {
          await fh?.close().catch(() => {});
        }
        return false; // every candidate is read: the newest one wins
      });
    }
    const id = found.sort((a, b) => b.at - a.at)[0]?.id || '';
    if (id) codexMiss.delete(key);
    else codexMiss.set(key, Date.now());
    if (codexMiss.size > 200) codexMiss.clear();
    return id;
  },
};
