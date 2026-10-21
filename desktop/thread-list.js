/*
 * Technically Not desktop · thread-list.js — The list of past conversations of the open project,
 * for the Agents page's "Past conversations" group (src/scripts/117-past-conversations.js).
 * This computer only: it reads files that are already on this PC and
 * what agent-lifecycle.js recorded; nothing is sent anywhere and nothing is written. Two sources:
 * 1. Claude Code's own saved conversations: <home>/projects/<the folder with every non-alphanumeric
 * as '-'>/<id>.jsonl (the place session-store.js already looks in), for the project folder and for
 * the folders this app ran that project's agents in (their worktrees), under the default home and
 * every added account's folder. One conversation found twice is listed once.
 * 2. What this app recorded about conversations it ran (agent-lifecycle.js `conversations`): the
 * agent's name, its account, whether it was started from another computer, its last task. For every
 * other CLI this is the only source: a closed agent that `tnai send` could still revive is listed,
 * read from no file of that CLI. Cheap by rule: it runs only when asked (the user opens the group,
 * or presses Resume), one run at a time; of a file only its size, its time and the first HEAD bytes
 * are read for the list, and the last TAIL bytes when one conversation is looked at; at most
 * MAX_FILES names per folder are looked at and MAX_LISTED rows are handed over, newest first. Text
 * is cleaned of control characters and clipped here; the window shows it as text. Handed in (so
 * tools can run this file in plain Node): root() → the open project folder; lifecycle {
 * conversations(project), remoteConversation(cli, id) }; accountDirs(cli) → Promise<the folders of
 * that CLI's added accounts>; home, env (defaults: the system's).
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  os = require('os');

const MAX_LISTED = 60,
  MAX_FILES = 2000,
  MAX_NAMES = 20000,
  MAX_HEADS = 300,
  HEAD = 64 * 1024,
  TAIL = 96 * 1024,
  TITLE = 120,
  EXCERPT = 900;
const CLAUDE = 'Claude Code';

// a conversation's file name; anything else in the folder is not one
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slug = folder => String(folder || '').replace(/[^a-zA-Z0-9]/g, '-');

// The characters nobody can see are named by number here: never typed, and never written as an
// escape, because an edit tool can turn an escape into the character itself, and the next edit of
// such a line breaks it without a sign. Control characters but tab and
// line feed; zero-width and direction marks; the direction overrides; the isolates.
const UNSEEN_RANGES = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const UNSEEN = new RegExp(
  '[' +
    UNSEEN_RANGES.map(
      ([a, b]) => String.fromCharCode(a) + (b > a ? '-' + String.fromCharCode(b) : '')
    ).join('') +
    ']',
  'g'
);
const plain = s => String(s || '').replace(UNSEEN, ' ');
const clip = (s, n) => {
  s = plain(s).trim();
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
};

// A prompt's own words: without the reminders a CLI adds, this app's marks in front of a task, and
// the attachment notes.
const words = s =>
  String(s || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<\/?(pasted_content|pasted_text|agent-message)\b[^<>]*>/g, '')
    .replace(/\s*\[Attached (image|file): [^\]]*\]/g, '')
    .replace(/^\s*\[(?:TN|TechnicallyNot)\.ai\]\s*/, '')
    .trim();

// Not something the user asked: a slash command's own record, its output, a hook's or the CLI's
// note.
const NOT_A_PROMPT =
  /^(<command-name>|<command-message>|<local-command-|<bash-(input|stdout|stderr)>|<task-notification>|<user-prompt-submit-hook>|Caveat: |\[Request interrupted)/;
const parse = line => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('\n')
      : '';

async function readPart(file, from, length) {
  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(length),
      { bytesRead } = await fh.read(buf, 0, length, Math.max(0, from));
    return buf.toString('utf8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// In batches, so a folder of many files never opens them all at once.
async function each(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// The first part of a Claude Code conversation file → { title, first, started, skip }. skip: not a
// conversation of the user's (a sub-agent's side file, or a run without a terminal, which Claude
// Code's own picker leaves out too; the second is INFERRED from the `entrypoint` field and not yet
// seen on a real file).
function claudeHead(text, whole) {
  const lines = text.split('\n');
  if (!whole) lines.pop(); // the last line was cut off by the read
  const out = { title: '', first: '', started: 0, skip: false };
  for (const line of lines) {
    if (!line) continue;
    const j = parse(line);
    if (!j || typeof j !== 'object') continue;
    if (
      j.isSidechain === true ||
      (typeof j.entrypoint === 'string' && /^sdk/i.test(j.entrypoint))
    ) {
      out.skip = true;
      return out;
    }
    if (!out.started && typeof j.timestamp === 'string') out.started = Date.parse(j.timestamp) || 0;
    if (j.type !== 'user' || j.isMeta === true || j.message?.role !== 'user') continue;
    const said = words(textOf(j.message.content));
    if (!said || NOT_A_PROMPT.test(said)) continue;
    out.first = clip(said, EXCERPT);

    // cleaned first: a removed character leaves no second space in the one line
    out.title = clip(plain(said).replace(/\s+/g, ' '), TITLE);
    break;
  }
  return out;
}

// The last part of one → the last answer's text and the last thing the user asked there.
function claudeTail(text, whole) {
  const lines = text.split('\n');
  if (!whole) lines.shift(); // the first line began before the read
  let answer = '',
    asked = '';
  for (let i = lines.length - 1; i >= 0 && !(answer && asked); i--) {
    const line = lines[i];
    if (!line || (!line.includes('"assistant"') && !line.includes('"user"'))) continue;
    const j = parse(line);
    if (!j || j.isSidechain === true || j.isMeta === true) continue;
    if (!answer && j.type === 'assistant') answer = clip(textOf(j.message?.content), EXCERPT);
    else if (!asked && j.type === 'user' && j.message?.role === 'user') {
      const said = words(textOf(j.message.content));
      if (said && !NOT_A_PROMPT.test(said)) asked = clip(said, EXCERPT);
    }
  }
  return { answer, asked };
}

function createThreadList({
  root = () => '',
  lifecycle = {},
  accountDirs = async () => [],
  home = os.homedir(),
  env = process.env,
} = {}) {
  let running = null,
    // kept: key → what the last list knows of a row (its file never leaves this process)
    kept = new Map();

  async function claudeFiles(project, folders) {
    let dirs = [];
    try {
      dirs = await accountDirs(CLAUDE);
    } catch {
      /* the default home alone */
    }
    const homes = [
      ...new Set(
        [
          ...(Array.isArray(dirs) ? dirs : []),
          env.CLAUDE_CONFIG_DIR,
          path.join(home, '.claude'),
        ].filter(d => typeof d === 'string' && d)
      ),
    ];
    const slugs = [...new Set([project, ...folders].map(slug).filter(Boolean))],
      found = new Map();
    let more = false;
    for (const h of homes)
      for (const s of slugs) {
        const dir = path.join(h, 'projects', s);
        let names = [];
        try {
          names = await fs.promises.readdir(dir);
        } catch {
          continue;
        }
        names = names.filter(n => n.endsWith('.jsonl') && ID.test(n.slice(0, -6)));
        if (names.length > MAX_NAMES) {
          names = names.slice(0, MAX_NAMES);
          more = true;

          // a bound all the same; below it every name is looked at, so the cut after this is by
          // time
        }
        await each(names, 24, async name => {
          const id = name.slice(0, -6),
            k = id.toLowerCase();
          if (found.has(k)) return; // the same conversation through another account's shared folder
          try {
            const st = await fs.promises.stat(path.join(dir, name));
            if (st.isFile() && st.size > 0 && !found.has(k))
              found.set(k, { id, file: path.join(dir, name), at: st.mtimeMs, bytes: st.size });
          } catch {
            /* gone meanwhile */
          }
        });
      }

    // The newest MAX_FILES, not the first MAX_FILES names the folder happened to list.
    const files = [...found.values()].sort((a, b) => b.at - a.at);
    if (files.length > MAX_FILES) {
      files.length = MAX_FILES;
      more = true;
    }
    return { files, more };
  }

  async function build() {
    const project = String(root() || '');
    if (!project) return { ok: true, project: '', threads: [], more: false };
    let known = [];
    try {
      known = lifecycle.conversations?.(project) || [];
    } catch {
      /* files alone */
    }
    const mine = new Map(
      known.filter(c => c && c.agent === CLAUDE).map(c => [String(c.id).toLowerCase(), c])
    );
    const { files, more } = await claudeFiles(
      project,
      known.filter(c => c && c.agent === CLAUDE && c.cwd).map(c => c.cwd)
    );

    // Newest first before anything is opened: only the rows that can be shown are read.
    const rows = files
      .filter(f => !mine.get(f.id.toLowerCase())?.subagent)
      .map(f => ({ ...f, cli: CLAUDE, rec: mine.get(f.id.toLowerCase()) || null }));
    for (const c of known) {
      // another CLI: only what this app closed and can still revive
      if (!c || c.agent === CLAUDE || c.subagent || !c.revivable || !c.id) continue;
      rows.push({
        id: String(c.id),
        cli: String(c.agent),
        file: '',
        at: Number(c.at) || 0,
        bytes: 0,
        rec: c,
      });
    }
    rows.sort((a, b) => b.at - a.at);
    const out = [],
      next = new Map();

    // At most MAX_HEADS first parts are read for one list: when most files are ones to skip (side
    // files, runs without a terminal), the loop would otherwise open every one of them.
    // The list then says there are more.
    let i = 0,
      read = 0;
    while (out.length < MAX_LISTED && i < rows.length && read < MAX_HEADS) {
      const batch = rows.slice(i, i + 8);
      i += batch.length;
      read += batch.filter(r => r.file).length;
      const heads = await Promise.all(
        batch.map(r =>
          r.file
            ? readPart(r.file, 0, Math.min(HEAD, r.bytes)).then(t => claudeHead(t, r.bytes <= HEAD))
            : null
        )
      );
      batch.forEach((r, k) => {
        const h = heads[k],
          rec = r.rec;
        if (h?.skip || out.length >= MAX_LISTED) return;
        const task = rec?.task ? clip(plain(words(rec.task)).replace(/\s+/g, ' '), TITLE) : '';
        let remote = !!rec?.remote;
        if (!remote) {
          try {
            remote = lifecycle.remoteConversation?.(r.cli, r.id) === true;
          } catch {
            /* not marked */
          }
        }
        const row = {
          key: r.cli + '\n' + r.id,
          cli: r.cli,
          id: r.id,
          title:
            h?.title ||
            task ||
            (rec?.name ? rec.name + '’s conversation' : 'Conversation ' + r.id.slice(0, 8)),
          at: r.at,
          started: h?.started || 0,
          bytes: r.bytes,
          name: clip(rec?.name, 80),
          known: !!rec,
          remote,
          accountId: String(rec?.accountId || ''),
          customAgentId: String(rec?.customAgentId || ''),
          ownedByUser: !!rec?.ownedByUser,
        };
        out.push(row);
        next.set(row.key, {
          cli: r.cli,
          id: r.id,
          file: r.file,
          bytes: r.bytes,
          first: h?.first || (rec?.task ? clip(words(rec.task), EXCERPT) : ''),
          result: rec?.result ? clip(rec.result, EXCERPT) : '',
        });
      });
    }
    kept = next;
    return { ok: true, project, threads: out, more: more || i < rows.length };
  }

  return {
    // The rows for the window. One run at a time: a second ask while one runs gets the same answer.
    list() {
      if (!running)
        running = build()
          .catch(error => ({
            ok: false,
            error: String(error?.message || error),
            threads: [],
            more: false,
          }))
          .finally(() => {
            running = null;
          });
      return running;
    },
    // The session record of one row of the last list, for a paired computer that reads it (plan
    // item 44, remote-service.js pastCheck; thread-log.js readForPeer): { agent, sessionId, file }.
    // The file is this list's own find, never anything another computer named.
    recordFor(key) {
      const k = kept.get(String(key || ''));
      return k && k.cli && k.id ? { agent: k.cli, sessionId: k.id, file: k.file || '' } : null;
    },
    // One row of the last list, looked at: the first thing asked and how it ended. The window names
    // the row, never a file.
    async peek(key) {
      const k = kept.get(String(key || ''));
      if (!k) return null;
      if (!k.file) return { first: k.first, asked: '', answer: k.result, part: false };
      const whole = k.bytes <= TAIL,
        tail = claudeTail(
          await readPart(k.file, Math.max(0, k.bytes - TAIL), Math.min(TAIL, k.bytes)),
          whole
        );
      return {
        first: k.first,
        asked: tail.asked === k.first ? '' : tail.asked,
        answer: tail.answer || k.result,
        part: !whole,
      };
    },
  };
}

module.exports = {
  createThreadList,
  claudeHead,
  claudeTail,
  MAX_LISTED,
  MAX_FILES,
  MAX_HEADS,
  HEAD,
  TAIL,
};
