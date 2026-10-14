/*
 * Technically Not desktop · agent-context.js — Shared project context: every finished agent task
 * (any CLI) becomes one entry per project, so agents build on each other's work without the user
 * copying terminal output around. CAPTURE: agent-turns.js ends a task with its final answer (Claude
 * Code Stop hook, Codex task_complete). The entry keeps a short structured summary (did / found /
 * changed / decided / remains / blockers / next) — from the "Technically Not report" block the work
 * rules ask agents to end with, else extracted from the answer by keyword (labelled "extracted",
 * never presented as the agent's own) — plus tags (files, areas, keywords) and who got it. The full
 * answer and the pane's terminal output at that moment are stored beside it on disk
 * (userData/agent-context/<project>/), never injected anywhere. DECISIONS (summary.choices = {
 * question, options: [{ label, detail, recommended }], extracted? }): from the report line "-
 * Decide: <question> | 1. <option> (recommended) |
 * 2. <option> | …" (an option may add " — <detail>"), else extracted when the answer asks the user
 * to pick one of 2–4 numbered / lettered options with exactly one marked recommended and a question
 * right before or after the list. The recommended option is moved to #1. Marked as a whole
 * ('answered' / 'dismissed'), or parked 'stale' by consolidation once the same agent reported a
 * later result or after 3 days; never marked by agents; the window blocks automatic mode on it
 * (51). DELIVERY (bounded, no duplicates): when an entry is made, live agents of the same project
 * whose current or last work overlaps it (same files, or shared task keywords) get it queued.
 * Claude Code receives queued entries at its next tool call while working (PostToolUse
 * additionalContext) or with its next prompt, plus up to a few other relevant entries it has not
 * seen (UserPromptSubmit additionalContext). Every CLI can pull with `tnai context`
 * (agent-mesh.js). An entry reaches each agent at most once; only the latest entry per agent is
 * offered; a prompt that already quotes an entry skips it. KEEPING IT ON TRACK (per project, saved
 * with the entries): the user marks issues / next steps / ideas done, dismissed or moved to the
 * composer (`marks`), so they leave the open lists agents see; and adds project notes (goals,
 * constraints, current state) that every agent gets once per change with its next prompt and in
 * `tnai context`. Agents keep both current too: `tnai context note list|add|remove` and `tnai
 * context mark claimed|done|dismissed|undo KEY|RESULTID` (marks name the agent; a claim keeps the
 * item open, labeled "claimed by", until marked, undone, the claimant's agent instance is no longer
 * live, or 2 h pass; a different agent's `done`/`dismissed` on a live claim is refused, naming the
 * claimant; the user's own marks from the window are never blocked). AUTOMATIC UPKEEP (INFERRED, on
 * by default, per project `auto`): each new entry is compared with older open items (remains / next
 * / blockers / ideas) of the same project. A later result that clearly covers an item marks it
 * 'auto' {by, at, why}: at least 2 of the item's significant words and >= 75% of them appear in the
 * new entry's task / did / changed / decided, AND a file in common (the item names a file the new
 * entry touched, or both results edited the same file) or explicit completion wording (fixed, ran,
 * added, …, without "not / still / failed") in a did/changed item sharing 2+ of those words; never
 * when the new entry's own open items restate it. A later result of the SAME agent marks its older
 * remains / next / blockers 'superseded' when it lists its own of that kind, and older ideas it
 * repeats. A weaker overlap (2+ words and >= 50% of the item's, or the full rule minus file /
 * wording) only hints: `maybe` { by, name, at, why }, the item stays open, labeled "possibly done
 * by X" (window and `tnai context`). An agent's own "- Resolved: KEY; KEY" report line marks those
 * items done (by it), the strongest signal; the work rules ask for it
 * (hidden-skills/40-tnai-report.md). Undo of an automatic mark is remembered (`kept`) and never
 * re-applied. Turning upkeep off drops automatic marks; turning it on re-derives them. COMMITS
 * count as evidence too (scanCommits): a later commit whose message covers an open item (same word
 * rule) AND touched a file the item names or its result edited marks it 'auto' { commit, why };
 * scanned when the project is read (throttled) and whenever HEAD moves (git:changed), once per
 * HEAD. Changed files that no longer exist on disk are flagged (`missing`) when the state is built;
 * the window re-reads the state when such a file changes (fs:changes). CONSOLIDATION
 * (context-digest.js, part of upkeep): short exchanges folded, restated open items merged into the
 * newest, old open items parked, older results rolled into a digest grouped by the files they
 * changed; delivery and `tnai context` use the consolidated view.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const sessionStore = require('./session-store'); // writeAtomic only
const lifecycle = require('./agent-lifecycle');
const watch = require('./watch-service');
const digestOf = require('./context-digest');
const stalls = require('./stall-log');
const gitSvc = require('./git-service'); // internal.git: read-only log for the commit scan

const KEEP = 200; // entries kept per project (their files go with them)
const LOG_MAX = 400 * 1024; // terminal output kept per entry (the end of it)
const ITEM_MAX = 240,
  ITEMS = 4;
const PROMPT_PICKS = 3,
  TOOL_PICKS = 2,
  QUEUE_MAX = 6;
const FRESH_DAYS = 14; // older entries are not offered automatically (still listed / searchable)
const KEYS = [
  'did',
  'found',
  'changed',
  'decided',
  'remains',
  'untested',
  'blockers',
  'next',
  'ideas',
  'choices',
];
const LABEL = {
  did: 'Did',
  found: 'Found',
  changed: 'Changed',
  decided: 'Decided',
  remains: 'Remains',
  untested: 'Untested',
  blockers: 'Blockers',
  next: 'Next',
  ideas: 'Ideas',
  choices: 'Decision needed',
};

// summary.choices is one object, not a list: { question, options: [{ label, detail, recommended }],
// extracted?, more? } (recommended option first). A report with several "- Decide:" lines keeps the
// first there and the others in `more` (same shape, no `more`); decision n is marked on its own as
// <id>:choices:<n>.
const MARKABLE = new Set(['blockers', 'remains', 'next', 'ideas', 'choices']),
  MARK_STATES = new Set(['done', 'dismissed', 'sent', 'answered', 'deleted']),
  NOTES_MAX = 20;
const CHOICES_MAX = 4;

// set by automatic upkeep only (inferred), never through setMark
const AUTO_STATES = new Set(['auto', 'superseded', 'merged', 'stale']);

const projects = new Map(); // norm(project) -> { root, dir, file, entries: [] }

// paneId -> { files: Set, task, log } this turn's edits (Claude Code hooks), task text, CLI log
// file
const current = new Map();
const queued = new Map(); // instance id -> Set of entry ids waiting for it
const notesSeen = new Map(); // instance id -> notesAt it last got
let send = () => {},
  deps = { ptys: null, root: () => '' };

const clip = (s, n) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const norm = p => (p ? path.resolve(p).toLowerCase() : '');
const hashOf = s => crypto.createHash('sha1').update(norm(s)).digest('hex').slice(0, 12);
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1
    ? 'just now'
    : m < 60
      ? m + ' min ago'
      : m < 1440
        ? Math.round(m / 60) + ' h ago'
        : Math.round(m / 1440) + ' d ago';
};

// ---------- Storage ----------
// The folder a project's saved context lives in.
const storeDir = root => path.join(app.getPath('userData'), 'agent-context', hashOf(root));

// Reads a project's saved context ahead of the first question, without blocking the main process.
// Without it, the first context:state after a start or a project switch read the whole file
// synchronously (100 to 400 ms in the stall log, from a project in the OneDrive folder). A file
// that cannot be read now is left for store() to read as before, so nothing is ever taken as empty
// by mistake.
async function warm(root) {
  const key = norm(root);
  if (!key || projects.has(key)) return;
  let text;
  try {
    text = await fs.promises.readFile(path.join(storeDir(root), 'index.json'), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') return;
    text = '';
  }
  if (!projects.has(key)) store(root, text);
}

// text: the file's text when warm() already read it ('' for no file); otherwise it is read here.
function store(root, text) {
  const key = norm(root);
  if (!key) return null;
  let p = projects.get(key);
  if (p) return p;
  const dir = storeDir(root);
  p = {
    root,
    dir,
    file: path.join(dir, 'index.json'),
    entries: [],
    marks: {},
    claims: {},
    kept: {},
    maybe: {},
    auto: true,
    notes: [],
    notesAt: 0,
  };
  try {
    const j = JSON.parse(text ?? fs.readFileSync(p.file, 'utf8'));
    if (Array.isArray(j.entries)) p.entries = j.entries;
    if (j.marks && typeof j.marks === 'object') p.marks = j.marks;
    if (j.claims && typeof j.claims === 'object') p.claims = j.claims;
    if (j.kept && typeof j.kept === 'object') p.kept = j.kept;
    if (j.maybe && typeof j.maybe === 'object') p.maybe = j.maybe;
    if (j.auto === false) p.auto = false;
    if (Array.isArray(j.notes)) p.notes = j.notes;
    p.notesAt = +j.notesAt || 0;
  } catch {}

  // results saved before a cleanTask rule
  for (const e of p.entries) e.task = clip(cleanTask(e.task), 400);

  // Keys whose result is no longer stored go once, at load (the rule onTurn applies when a result
  // drops out; a stored result's keys are never touched): stores written before that rule kept them
  // for good (measured 2026-10-05: 7,165 marks and 1,699 maybe keys for 200 results).
  {
    const ids = new Set(p.entries.map(e => e.id));
    for (const m of [p.marks, p.claims, p.kept, p.maybe])
      for (const k of Object.keys(m)) if (!ids.has(k.slice(0, k.indexOf(':')))) delete m[k];
  }
  projects.set(key, p);
  consolidate(p);
  return p;
}
let saveTimers = new Map(); // file -> { timer, p }

// Debounced saves write asynchronously (index.json runs to a few hundred KB); quitting (flushSaves)
// writes sync.
function write(p, sync) {
  saveTimers.delete(p.file);
  const t0 = performance.now();
  try {
    (sync ? sessionStore.writeAtomic : sessionStore.writeAtomicLater)(
      p.file,
      JSON.stringify({
        root: p.root,
        entries: p.entries,
        marks: p.marks,
        claims: p.claims,
        kept: p.kept,
        maybe: p.maybe,
        auto: p.auto,
        notes: p.notes,
        notesAt: p.notesAt,
      })
    );
  } catch {}
  stalls.ran('context save (index.json)', performance.now() - t0); // a stall line can name it
}

function save(p) {
  clearTimeout(saveTimers.get(p.file)?.timer);
  saveTimers.set(p.file, { p, timer: setTimeout(() => write(p, false), 300) });
}

// The user renamed an agent (main.js, from lifecycle.setNames): its saved results carry the new
// name, so `tnai context`, the brief and every later prompt show only the name it has now.
function renamed(instanceId, name) {
  if (!instanceId || !name) return 0;
  let count = 0;
  for (const p of projects.values()) {
    let changed = false;
    for (const e of p.entries || [])
      if (e.instanceId === instanceId && e.name !== name) {
        e.name = name;
        changed = true;
        count++;
      }
    if (changed) save(p);
  }
  return count;
}

// Technically Not is quitting: saves still waiting on their timers are written now.
function flushSaves() {
  for (const { timer, p } of [...saveTimers.values()]) {
    clearTimeout(timer);
    write(p, true);
  }
}
const rawFile = (p, id, ext) => path.join(p.dir, id + ext);

// ---------- Summary ----------
const STOP = new Set(
  'about above after again against also because been before being below between both could does doing down during each from further have having here into itself just more most much must need only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your yours make made using used file files code change changes changed task tasks work done added update updated need needs like want please tnai agent agents claude codex'.split(
    ' '
  )
);

function words(text) {
  return (
    String(text || '')
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{3,}/g) || []
  ).filter(w => !STOP.has(w) && !/^\d/.test(w));
}

function keywords(text, n = 14) {
  const count = new Map();
  for (const w of words(text)) count.set(w, (count.get(w) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}
const EXT =
  'js|mjs|cjs|ts|tsx|jsx|css|scss|html|md|json|py|go|rs|java|kt|cs|cpp|cc|c|h|hpp|rb|php|swift|yml|yaml|toml|sh|ps1|sql|vue|svelte';
const PATH_RE = new RegExp(
  '(?:[A-Za-z]:)?(?:[\\w.@-]+[\\\\/])*[\\w.@-]+\\.(?:' + EXT + ')\\b',
  'g'
);

function relPath(file, root) {
  let f = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  const r = String(root || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (r && f.toLowerCase().startsWith(r.toLowerCase() + '/')) f = f.slice(r.length + 1);

  // outside the project: not a project file
  return /^[a-z]:\//i.test(f) || f.startsWith('/') || f.includes('../') ? '' : f;
}

function mentionedFiles(text, root) {
  return [
    ...new Set(
      (String(text || '').match(PATH_RE) || []).map(f => relPath(f, root)).filter(Boolean)
    ),
  ].slice(0, 30);
}

// The "Technically Not report" block the work rules ask for (older answers: "Technically Not
// report"): that line, then "- Did: …" lines (items split on "; ").
function parseReport(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (/^\W*(?:technically not|tnai) report\W*$/i.test(lines[i].trim())) {
      start = i;
      break;
    }
  if (start < 0) return null;
  const out = {},
    decides = [];
  let last = '',
    // every "- Decide:" line is a decision of its own (numbered "Decision 1 of 3: …"), in the order
    // written
    decide = null;
  for (const line of lines.slice(start + 1)) {
    const d = line.match(
      /^\s*[-*•]?\s*\**\s*(?:decide|decision needed|choose)\s*\**\s*:\s*\**\s*(.*)$/i
    );
    if (d) {
      decide = d[1].split(/\s+\|\s+/);
      decides.push(decide);
      last = 'choices';
      continue;
    }
    if (last === 'choices' && /^\s{2,}\S/.test(line)) {
      decide.push(line.trim().replace(/^[-*•]\s*/, ''));
      continue;
    }
    const m = line.match(
      /^\s*[-*•]?\s*\**\s*(did|found|changed|decided|decisions?|remains?|remaining|untested|resolved|blockers?|errors?|next|ideas?|suggestions?|suggest)\s*\**\s*:\s*\**\s*(.*)$/i
    );
    if (m) {
      const k = /^decision/i.test(m[1])
        ? 'decided'
        : /^remain/i.test(m[1])
          ? 'remains'
          : /^untested/i.test(m[1])
            ? 'untested'
            : /^(blocker|error)/i.test(m[1])
              ? 'blockers'
              : /^(idea|suggest)/i.test(m[1])
                ? 'ideas'
                : m[1].toLowerCase();
      last = k;
      out[k] = (out[k] || []).concat(m[2].split(/;\s+/));
    } else if (last && /^\s{2,}\S/.test(line)) out[last].push(line.trim().replace(/^[-*•]\s*/, ''));
    else if (line.trim() && !/^\s*[-*•]/.test(line)) break;
  }
  for (const k of Object.keys(out))
    out[k] = out[k]
      .map(s => clip(s.replace(/\*\*/g, ''), ITEM_MAX))
      .filter(
        s =>
          s &&
          !/^(none|n\/a|-|nothing|no)\.?$/i.test(s) &&
          !/^(none|nothing|no (blockers?|errors?|issues?))\b\s*[(—–:,.-]/i.test(s)
      )
      .slice(0, ITEMS);
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  const c = decides.length ? choicesOfAll(decides) : strayDecide(lines.slice(0, start).join('\n'));
  if (c) out.choices = c;
  return Object.keys(out).length ? { summary: out, rest: lines.slice(0, start).join('\n') } : null;
}

// A "- Decide:" line the agent wrote outside the block (in the reply above the heading, or in an
// answer with no block, where its options used to be no buttons) is the same decision: every
// such line that has its options on it, in the order written. Fenced code is left out (a quoted
// example).
function strayDecide(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n');
  const found = [];
  for (const l of lines) {
    const d = l.match(/^\s*[-*•]\s*\**\s*decide\s*\**\s*:\s*\**\s*(.*)$/i),
      parts = d && d[1].split(/\s+\|\s+/);
    if (parts && parts.length > 2) found.push(parts);
  }
  return choicesOfAll(found);
}

// Several decisions in one answer: summary.choices stays the first one (stored results and
// one-decision reports read as before) and carries the others in `more`, in the order written. Each
// has its own mark key (<id>:choices:<n>, n from 0), so each is answered on its own. A repeated
// question counts once.
const DECISIONS_MAX = 6;

function choicesOfAll(list) {
  const all = [];
  for (const parts of list) {
    const c = choicesFrom(parts[0], parts.slice(1), false);
    if (c && !all.some(x => x.question === c.question)) all.push(c);
  }
  if (!all.length) return null;
  return all.length > 1 ? { ...all[0], more: all.slice(1, DECISIONS_MAX) } : all[0];
}
const decisionsOf = c => (c ? [c, ...(c.more || [])] : []);

// A decision for the user: 2–4 options, the recommended one moved to #1 (only one keeps the flag).
// null when it is not a real choice.
const REC_RE = /\brecommend(ed|s)?\b/i;

function choicesFrom(question, raw, extracted) {
  question = String(question || '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .replace(/[:\s]+$/, '')
    .trim();
  const opts = raw
    .map(s =>
      String(s || '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim()
    )
    .filter(Boolean)
    .map(s => {
      const recommended = REC_RE.test(s);
      s = s
        .replace(/^\s*(?:option\s+)?(?:\d{1,2}|[a-d])\s*[.):]\s+/i, '')
        .replace(/\s*[([]\s*recommended\s*[)\]]/gi, '')
        .replace(/^\s*recommended\s*[:—–-]\s*/i, '')
        .replace(/\s*[—–-]\s*recommended\.?\s*$/i, '')
        .trim();
      const m = s.match(/^(.{2,}?)(?:\s+[—–-]\s+|:\s+)(.+)$/);
      return { label: clip(m ? m[1] : s, 140), detail: m ? clip(m[2], ITEM_MAX) : '', recommended };
    })
    .filter(o => o.label);
  if (!question || opts.length < 2 || opts.length > (extracted ? CHOICES_MAX : 8)) return null;
  const i = opts.findIndex(o => o.recommended);
  if (i > 0) opts.unshift(...opts.splice(i, 1));
  opts.forEach((o, j) => {
    if (j > 0) o.recommended = false;
  });
  return {
    question: clip(question, ITEM_MAX),
    options: opts.slice(0, CHOICES_MAX),
    ...(extracted ? { extracted: true } : {}),
  };
}

// No "Decide:" line: an answer that clearly asks the user to pick one of 2–4 numbered / lettered
// options, one marked recommended, with the question right before (or after) the list. Anything
// else (a list of changes, steps, a list with no question or no recommended option) is not a
// decision.
const ASK_RE =
  /\?\s*$|\b(which (one|option|approach|way|do you)|choose|pick|prefer|would you like|let me know|want me to|your call|decide|decision)\b/i;

function extractChoices(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .split('\n');
  const itemOf = l => {
    const m = l.match(/^\s*\**\s*(?:option\s+)?(\d{1,2}|[A-Da-d])\s*[.):]\**\s+(.+)$/i);
    return m
      ? { n: /\d/.test(m[1]) ? +m[1] : m[1].toLowerCase().charCodeAt(0) - 96, text: m[0].trim() }
      : null;
  };
  const runs = [];
  let run = null;
  for (let i = 0; i < lines.length; i++) {
    const it = itemOf(lines[i]);
    if (it && run && it.n === run.items.length + 1) {
      run.items.push(it.text);
      run.end = i;
      continue;
    }
    if (it && it.n === 1) {
      run = { start: i, end: i, items: [it.text] };
      runs.push(run);
      continue;
    }
    if (run && (!lines[i].trim() || /^\s{2,}\S/.test(lines[i]))) {
      if (lines[i].trim())
        run.items[run.items.length - 1] += ' — ' + lines[i].trim().replace(/^[-*•]\s*/, '');
      continue;
    }
    run = null;
  }
  const clean = l =>
    l
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/, '')
      .trim();
  for (const r of runs.reverse()) {
    if (
      r.items.length < 2 ||
      r.items.length > CHOICES_MAX ||
      r.items.filter(s => REC_RE.test(s)).length !== 1
    )
      continue;
    const near = [];
    for (let i = r.start - 1, n = 0; i >= 0 && n < 3; i--)
      if (lines[i].trim()) {
        near.push(clean(lines[i]));
        n++;
      }
    for (let i = r.end + 1, n = 0; i < lines.length && n < 2; i++)
      if (lines[i].trim()) {
        if (itemOf(lines[i])) break;
        near.push(clean(lines[i]));
        n++;
      }
    const q = near.find(l => /\?\s*$/.test(l)) || near.find(l => ASK_RE.test(l));
    if (q) return choicesFrom(q, r.items, true);
  }
  return null;
}
const choiceText = c =>
  decisionsOf(c)
    .flatMap(d => [d.question, ...d.options.map(o => o.label + ' ' + o.detail)])
    .join(' ');
const summaryText = s =>
  Object.entries(s || {})
    .map(([k, v]) => (k === 'choices' ? choiceText(v) : [].concat(v).join(' ')))
    .join(' ');

// No report: sentences and bullets sorted by what they say. Clearly marked as extracted in the UI.
const RULES = [
  [
    'blockers',
    /\b(error|errors|fail(s|ed|ing|ure)?|blocked|blocker|could ?n[o']t|unable|broken|crash(es|ed)?|exception|not (yet )?(verified|tested|checked|run))\b/i,
  ],
  [
    'ideas',
    /\b(suggest(s|ion|ions)?|ideas?|you (could|may want|might)|could also|consider|optional(ly)?|nice to have)\b/i,
  ],
  ['next', /\b(next step|next,|recommend|you (can|should)|follow[- ]up|todo|to do next)\b/i],
  [
    'remains',
    /\b(remain(s|ing)?|still (need|to|open|missing)|not yet|left to|pending|open item|outstanding|unfinished)\b/i,
  ],
  ['decided', /\b(decided|chose|chosen|opted|went with|instead of|trade-?off)\b/i],
  [
    'changed',
    /\b(added|adds|changed|updated|removed|fixed|fixes|renamed|created|edited|moved|refactor(ed)?|implemented|replaced|wired|deleted|rewrote)\b/i,
  ],
  [
    'found',
    /\b(found|cause[sd]?|because|turns out|root cause|discovered|the (issue|problem|bug) (is|was)|is due to|noticed)\b/i,
  ],
];

function extract(text) {
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '');
  const out = {};
  const paras = plain
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);
  const first = paras.find(s => !/^[-*•]|\d+[.)]\s/.test(s)) || paras[0] || '';
  if (first)
    out.did = [
      clip(
        first
          .split(/(?<=[.!?])\s+/)
          .slice(0, 2)
          .join(' '),
        ITEM_MAX
      ),
    ];
  const pieces = plain
    .split('\n')
    .flatMap(l =>
      /^\s*([-*•]|\d+[.)])\s+/.test(l)
        ? [l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')]
        : l.split(/(?<=[.!?])\s+/)
    )
    .map(s => s.trim())
    .filter(s => s.length > 12);
  for (const s of pieces) {
    if (out.did && out.did[0].startsWith(clip(s, ITEM_MAX).replace(/…$/, ''))) continue;
    const hit = RULES.find(([, re]) => re.test(s));
    if (!hit) continue;
    const list = (out[hit[0]] = out[hit[0]] || []);
    if (list.length < ITEMS) list.push(clip(s, ITEM_MAX));
  }
  return out;
}

// Ideas the agent lists under its own heading ("Suggestions", "Ideas", "Possible improvements",
// "Optional ..."), report or not.
function ideasSection(text) {
  const lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n'),
    out = [];
  for (let i = 0; i < lines.length; i++) {
    if (
      !/^\s*(#+\s*|\*\*)?\s*(suggestions?|ideas?|possible (improvements|next steps)|optional( next steps| improvements)?|further ideas)\b[^\n]{0,30}?:?\s*(\*\*)?\s*:?\s*$/i.test(
        lines[i]
      )
    )
      continue;
    for (let j = i + 1; j < lines.length && out.length < ITEMS * 2; j++) {
      const l = lines[j];
      if (!l.trim()) {
        if (out.length) break;
        continue;
      }
      const m = l.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (!m) break;
      out.push(clip(m[2].replace(/\*\*/g, '').replace(/`/g, ''), ITEM_MAX));
    }
  }
  return [...new Set(out)];
}

// ---------- Capture ----------
function terminalText(paneId) {
  const raw = deps.ptys?.replay?.(paneId)?.buffer || '';
  const text = raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .split('\n')
    .map(l => l.split('\r').filter(Boolean).pop() || '')
    .map(l => l.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd())
    .join('\n');
  return text.length > LOG_MAX ? text.slice(-LOG_MAX) : text;
}
const cleanTask = t =>
  String(t || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[\/\\]?(pasted_content|pasted_text|agent-message)\b[^<>]*>/g, '')
    .replace(/^\s*\[Subagent hand-back\][\s\S]*?The report follows:\s*/, 'Sub-agent report: ')
    .replace(/\s*\[Attached (image|file): [^\]]*\]/g, '')
    .replace(/^\s*\[(?:TN|TechnicallyNot)\.ai\]\s*/, '')
    .replace(
      /^\[New task(?: while you work on|, unrelated to your current work on) [\s\S]*?New task:\s*/,
      ''
    )
    .trim();

// agent-turns.js (via main.js), after agent-lifecycle.js saw the same turn.
async function onTurn(t) {
  if (!t?.paneId) return;
  if (t.cleared) {
    current.delete(t.paneId);
    return;
  }
  const cur = current.get(t.paneId) || { files: new Set() };
  if (!t.endedAt) {
    if (!cur.task || cur.startedAt !== t.startedAt)
      Object.assign(cur, {
        startedAt: t.startedAt,
        task: t.task || cur.task || '',
        log: t.log || cur.log || '',
      });
    current.set(t.paneId, cur);
    return;
  }
  if (!t.result) return;
  const who = lifecycle.info(t.paneId);
  const root = who?.project || deps.root();
  const p = store(root);
  if (!p) return;
  const turnKey = t.paneId + ':' + t.startedAt;
  if (p.entries.some(e => e.turnKey === turnKey)) return;
  const task = clip(cleanTask(t.task || cur.task), 400);

  // The work at the end of a turn with a result, in named sections (stall-log.js): the user sees
  // lag when an agent gives its final report.
  let lapAt = performance.now();
  const lap = name => {
    const now = performance.now();
    stalls.ran('turn end: context ' + name, now - lapAt);
    lapAt = now;
  };
  const report = parseReport(t.result);
  const summary = report ? report.summary : extract(t.result);
  const resolvedKeys = [...new Set((summary.resolved || []).join(' ').match(RESOLVED_RE) || [])];
  delete summary.resolved; // "- Resolved: KEY; KEY": the agent's own word, the strongest signal
  const listed = ideasSection(report ? report.rest : t.result);
  if (listed.length)
    summary.ideas = [...new Set(listed.concat(summary.ideas || []))].slice(0, ITEMS * 2);
  if (!summary.choices) {
    const c = (!report && strayDecide(t.result)) || extractChoices(t.result);
    if (c) summary.choices = c;
  }
  if (summary.choices?.extracted) {
    // the options are the decision, not next steps / ideas of their own
    const labels = summary.choices.options.map(o => o.label.toLowerCase().replace(/…$/, ''));
    for (const k of Object.keys(summary))
      if (k !== 'choices' && k !== 'did') {
        summary[k] = summary[k].filter(x => !labels.some(l => x.toLowerCase().includes(l)));
        if (!summary[k].length) delete summary[k];
      }
  }
  const edited = [...(cur.files || [])].map(f => relPath(f, root)).filter(Boolean);
  const files = [
    ...new Set([...edited, ...mentionedFiles(t.result, root), ...mentionedFiles(task, root)]),
  ].slice(0, 40);
  const e = {
    id: crypto.randomBytes(4).toString('hex'),
    turnKey,
    at: t.endedAt,
    startedAt: t.startedAt,
    endedBy: t.endedBy || '',
    instanceId: who?.id || '',
    name: who?.name || t.agent || 'Agent',
    agent: t.agent || who?.agent || '',
    paneId: t.paneId,
    subagent: !!who?.subagent,
    task,
    summary,
    reported: !!report,
    edited: edited.slice(0, 40),
    files,
    areas: [...new Set(files.map(f => (f.includes('/') ? f.split('/')[0] : '(root)')))].slice(0, 8),
    keywords: keywords(
      task +
        ' ' +
        task +
        ' ' +
        summaryText(summary) +
        ' ' +
        files
          .map(f =>
            path
              .basename(f)
              .replace(/\.\w+$/, '')
              .replace(/[-_.]/g, ' ')
          )
          .join(' ')
    ),
    errors: !!summary.blockers?.length,
    chars: t.result.length,
    log: t.log || cur.log || '',
    delivered: [],
    queued: [],
  };
  if (p.auto && digestOf.dropAsChatter(e)) {
    current.set(t.paneId, { files: new Set() });
    return;
  } // an acknowledgement or a short answer with no files and no decision is not a shared result
  const md =
      '# Task\n\n' +
      (cleanTask(t.task || cur.task) || '(unknown)') +
      '\n\n# Final answer\n\n' +
      t.result +
      '\n',
    log = terminalText(t.paneId);
  lap('entry (report, files, terminal text)');

  // before the async writes below, so a repeated report of the same turn is still skipped
  p.entries.unshift(e);
  rawText.set(norm(rawFile(p, e.id, '.md')), md);
  const dropped = p.entries.splice(KEEP);
  for (const old of dropped)
    for (const ext of ['.md', '.log']) {
      fs.rm(rawFile(p, old.id, ext), { force: true }, () => {});
      known.delete(norm(rawFile(p, old.id, ext)));
      rawText.delete(norm(rawFile(p, old.id, ext)));
    }

  // Its marks, claims, kept and maybe keys (all `<entry id>:kind:index`, read only through an
  // entry) go with it: they stayed for good, and index.json with them (2026-10-05: 7,103 marks for
  // 200 entries, 1.07 MB written on every save). Kept entries lose nothing.
  if (dropped.length) {
    const ids = new Set(dropped.map(old => old.id));
    for (const m of [p.marks, p.claims, p.kept, p.maybe])
      for (const k of Object.keys(m)) if (ids.has(k.slice(0, k.indexOf(':')))) delete m[k];
  }
  current.set(t.paneId, { files: new Set() });
  for (const key of resolvedKeys)
    if (!p.marks[key] || AUTO_STATES.has(p.marks[key].state))
      markIn(p, key, 'done', e.name) &&
        Object.assign(p.marks[key], {
          by: e.id,
          at: e.at,
          why: 'listed under Resolved in its report',
        });
  if (p.auto) upkeep(p, e);
  lap('upkeep');
  consolidate(p);
  lap('consolidate');
  broadcast(p, e);
  lap('broadcast');
  save(p);
  try {
    // off the main thread's critical path (the log can be 400 KB); the window hears about the entry
    // once its files are on disk
    await fs.promises.mkdir(p.dir, { recursive: true });
    await fs.promises.writeFile(rawFile(p, e.id, '.md'), md);
    if (log) {
      await fs.promises.writeFile(rawFile(p, e.id, '.log'), log);
      known.set(norm(rawFile(p, e.id, '.log')), { v: true, at: Date.now() });
    }
  } catch {}
  send('context:changed', { project: p.root, id: e.id });
}

// Claude Code hooks (agent-hooks.js): the files this turn edits, and its transcript. An OpenCode
// edit step comes in as the same PreToolUse shape (onStep).
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function hook(paneId, h) {
  if (h.hook_event_name === 'UserPromptSubmit') {
    current.set(paneId, {
      files: new Set(),
      task: String(h.prompt || '').slice(0, 2000),
      log: typeof h.transcript_path === 'string' ? h.transcript_path : '',
    });
    return;
  }
  if (h.hook_event_name === 'PreToolUse' && EDIT_TOOLS.has(h.tool_name)) {
    const f = h.tool_input?.file_path || h.tool_input?.notebook_path;
    if (typeof f === 'string' && f) {
      const cur = current.get(paneId) || { files: new Set() };
      if (cur.files.size < 200) cur.files.add(f);
      current.set(paneId, cur);
    }
  }
}

// ---------- Relevance and delivery ----------
function profile(inst, p, text) {
  const cur = inst.paneId ? current.get(inst.paneId) : null;
  const last = p.entries.find(e => e.instanceId === inst.id);
  const files = new Set(
    [...(cur?.files || [])]
      .map(f => relPath(f, p.root))
      .filter(Boolean)
      .concat(last?.edited || [], mentionedFiles(text || cur?.task, p.root))
      .map(f => f.toLowerCase())
  );
  return {
    files,
    bases: new Set([...files].map(f => path.basename(f))),
    words: new Set(keywords((text || cur?.task || '') + ' ' + (last?.task || ''), 24)),
  };
}

function score(e, pr) {
  let s = 0,
    why = '';
  for (const f of e.files) {
    const l = f.toLowerCase();
    if (pr.files.has(l)) {
      s += 4;
      why = why || f;
    } else if (pr.bases.has(path.basename(l))) {
      s += 2;
      why = why || f;
    }
  }
  const shared = e.keywords.filter(w => pr.words.has(w));
  s += shared.length;
  return {
    s,
    why: why
      ? 'same file ' + why
      : shared.length
        ? 'related: ' + shared.slice(0, 3).join(', ')
        : '',
  };
}
const relevant = r => r.s >= 4 || (r.s >= 2 && r.why);

function broadcast(p, e) {
  // a sub-agent's report already goes to its parent (agent-graph.js)
  if (e.subagent || e.chatter) return;
  for (const inst of lifecycle.live(p.root)) {
    if (inst.id === e.instanceId) continue;
    const r = score(e, profile(inst, p));
    if (!relevant(r)) continue;
    const q = queued.get(inst.id) || new Set();
    q.add(e.id);
    while (q.size > QUEUE_MAX) q.delete(q.values().next().value);
    queued.set(inst.id, q);
    if (!e.queued.some(x => x.id === inst.id))
      e.queued.push({ id: inst.id, name: inst.name || inst.agent, why: r.why });
  }
}

function mark(p, e, inst, how) {
  e.queued = e.queued.filter(x => x.id !== inst.id);
  if (!e.delivered.some(x => x.id === inst.id))
    e.delivered.push({ id: inst.id, name: inst.name || inst.agent, how, at: Date.now() });
  queued.get(inst.id)?.delete(e.id);
  save(p);
}

// A summary without the items the user marked done / dismissed / moved to the composer.
const markKey = (id, k, i) => id + ':' + k + ':' + i;

function openSummary(p, e) {
  const s = {};
  for (const [k, v] of Object.entries(e.summary || {})) {
    if (k === 'choices') {
      const left = decisionsOf(v)
        .filter((_, i) => !p.marks[markKey(e.id, k, i)])
        .map(({ more, ...d }) => d);
      if (left.length) s[k] = left.length > 1 ? { ...left[0], more: left.slice(1) } : left[0];
      continue;
    } // the decisions still open
    const left = MARKABLE.has(k) ? v.filter((_, i) => !p.marks[markKey(e.id, k, i)]) : v;
    if (left.length) s[k] = left;
  }
  return s;
}

// ---------- Automatic upkeep (inferred; rule in the header) ----------
const DONE_RE =
  /\b(fix(ed|es)?|resolv(ed|es)|complet(ed|es)|implement(ed|s)|add(ed|s)|ran|pass(ed|es)|install(ed|s)|wired|finish(ed|es)|address(ed|es)|handl(ed|es)|remov(ed|es)|creat(ed|es)|verifi(ed|es)|tested|now (works?|passes|runs|shows?))\b/i;
const NOT_RE =
  /n't\b|\b(not|still|fail(s|ed|ing)?|unable|blocked|pending|todo|skipp(ed)?|broken|later|yet)\b/i;
const RESOLVED_RE = /\b[0-9a-f]{8}:(?:remains|next|blockers|ideas):\d+\b/g;
const MAYBE = 0.5; // weaker cover: the item stays open, labeled "possibly done by" (p.maybe)
const COVER = 0.75; // share of an item's significant words a later result must contain
const stem = w => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w.replace(/s$/, ''));
const sig = text =>
  new Set(
    words(text)
      .filter(w => !DONE_RE.test(w) && !NOT_RE.test(w))
      .map(stem)
  );
const shareOf = (W, set) => [...W].filter(w => set.has(w));
const restates = (W, list) =>
  (list || []).some(o => {
    const s = shareOf(W, sig(o));
    return s.length >= 2 && s.length / W.size >= COVER;
  });
const agentKey = e => e.instanceId || 'pane:' + e.paneId;

function upkeep(p, e) {
  const at = p.entries.indexOf(e);
  if (at < 0) return 0;
  const s = e.summary || {},
    open = [].concat(s.remains || [], s.next || [], s.blockers || []);
  const proof = [].concat(s.did || [], s.changed || []);
  const evWords = sig([e.task, ...proof, ...(s.decided || [])].join(' '));
  const touched = new Set((e.files || []).concat(e.edited || []).map(f => f.toLowerCase())),
    edited = new Set((e.edited || []).map(f => f.toLowerCase()));
  let n = 0;
  for (const old of p.entries.slice(at + 1, at + 81)) {
    if (e.at - old.at > FRESH_DAYS * 864e5) break;
    const same = agentKey(old) === agentKey(e);
    for (const k of MARKABLE)
      if (k !== 'choices')
        (old.summary?.[k] || []).forEach((item, i) => {
          // a decision is the user's to answer, never resolved automatically
          const key = markKey(old.id, k, i);
          if (p.marks[key] || p.kept[key]) return;
          const W = sig(item);

          // 1. Covered by the later result (any agent).
          if (W.size >= 2 && !restates(W, open)) {
            const shared = shareOf(W, evWords);
            if (shared.length >= 2 && shared.length / W.size >= COVER) {
              const file =
                mentionedFiles(item, p.root).find(f => touched.has(f.toLowerCase())) ||
                (old.edited || []).find(f => edited.has(f.toLowerCase()));
              const said = proof.find(
                d =>
                  DONE_RE.test(d) &&
                  !NOT_RE.test(d) &&
                  shareOf(W, sig(d)).length >= Math.max(2, Math.ceil(W.size * COVER))
              );
              if (file || said) {
                p.marks[key] = {
                  state: 'auto',
                  by: e.id,
                  at: e.at,
                  why:
                    'matched ' +
                    shared.slice(0, 4).join(', ') +
                    (file ? ' · same file ' + file : ' · "' + clip(said, 80) + '"'),
                };
                delete p.maybe[key];
                n++;
                return;
              }
            }

            // 1b. Weaker overlap (half the item's words, or all of them without a shared file /
            // completion wording): a hint only, the item stays open.
            if (shared.length >= 2 && shared.length / W.size >= MAYBE)
              p.maybe[key] = {
                by: e.id,
                name: e.name,
                at: e.at,
                why: 'shares ' + shared.slice(0, 4).join(', '),
              };
          }

          // 2. Superseded by the same agent's later result: its own remains / next replace the old
          // ones; blockers and ideas only when restated.
          if (!same) return;
          const replaced =
            k === 'remains' || k === 'next'
              ? !!(s.remains?.length || s.next?.length)
              : W.size >= 2 && restates(W, s[k]);
          if (replaced) {
            p.marks[key] = { state: 'superseded', by: e.id, at: e.at };
            n++;
          }
        });
  }
  return n;
}

// Every finished result consolidates all stored results again, asking for the word sets of the same
// tasks, open items and digest lines: they are kept by text (sig depends on nothing else, and
// nobody changes a set it returns), so a new result costs its own texts only.
const sigKept = new Map();
const sigOf = text => {
  let W = sigKept.get(text);
  if (!W) {
    if (sigKept.size >= 20000) sigKept.clear();
    sigKept.set(text, (W = sig(text)));
  }
  return W;
};
const consolidate = p =>
  digestOf.consolidate(p, { sig: sigOf, shareOf, markKey, keywords, agentKey });

function dropAuto(p, by) {
  for (const [k, m] of Object.entries(p.marks))
    if (AUTO_STATES.has(m?.state) && (!by || m.by === by)) delete p.marks[k];
  for (const [k, m] of Object.entries(p.maybe))
    if (!by || m.by === by || k.startsWith(by + ':')) delete p.maybe[k];
}

// Re-derive every automatic mark, oldest result first (turning upkeep back on).
function rederive(p) {
  dropAuto(p);
  for (const e of p.entries.slice(0, 81).reverse()) upkeep(p, e);
  consolidate(p);
  p.head = '';
  scanCommits(p, true);
}

// Commits as evidence too (same cover rule): a commit made after a result, whose message covers one
// of its open items and which touched a file the item names or the result edited, marks it 'auto' {
// commit, why }. Runs when the project is first read and when HEAD moves (git:changed), never twice
// for one HEAD.
const SCAN_MS = 20000;

async function scanCommits(p, force) {
  if (!p?.auto || p.scanning || (!force && Date.now() - (p.scannedAt || 0) < SCAN_MS)) return;
  const open = p.entries.filter(
    e =>
      Date.now() - e.at < FRESH_DAYS * 864e5 &&
      ['blockers', 'remains', 'next', 'ideas'].some(k =>
        (e.summary?.[k] || []).some((_, i) => !p.marks[markKey(e.id, k, i)])
      )
  );
  if (!open.length) return;
  p.scanning = true;
  p.scannedAt = Date.now();
  try {
    const run = args => gitSvc.internal.git(args, { cwd: p.root });
    const head = (await run(['rev-parse', 'HEAD'])).stdout.trim();
    if (!head || head === p.head) return;
    const since = Math.floor(Math.min(...open.map(e => e.at)) / 1000);
    const out = (
      await run([
        'log',
        '--since=' + since,
        '-n',
        '200',
        '--name-only',
        '--format=%x1e%h%x1f%ct%x1f%s%x1f%b%x1d',
      ])
    ).stdout;
    const commits = out
      .split('\x1e')
      .filter(Boolean)
      .map(c => {
        const [meta, names = ''] = c.split('\x1d');
        const [sha, ct, subject, body] = meta.split('\x1f');
        return {
          sha,
          at: +ct * 1000,
          subject,
          words: sig(subject + ' ' + body),
          files: new Set(
            names
              .split(/\r?\n/)
              .map(f => f.trim().toLowerCase())
              .filter(Boolean)
          ),
        };
      })
      .filter(c => c.sha && c.at);
    let n = 0;
    for (const old of open)
      for (const k of ['blockers', 'remains', 'next', 'ideas'])
        (old.summary?.[k] || []).forEach((item, i) => {
          const key = markKey(old.id, k, i);
          if (p.marks[key] || p.kept[key]) return;
          const W = sig(item);
          if (W.size < 2) return;
          const itemFiles = mentionedFiles(item, p.root)
            .concat(old.edited || [])
            .map(f => f.toLowerCase());
          for (const c of commits.filter(c => c.at > old.at).sort((a, b) => a.at - b.at)) {
            const shared = shareOf(W, c.words),
              file = itemFiles.find(f => c.files.has(f));
            if (shared.length >= 2 && shared.length / W.size >= COVER && file) {
              p.marks[key] = {
                state: 'auto',
                commit: c.sha,
                at: c.at,
                why:
                  'commit ' +
                  c.sha +
                  ' "' +
                  clip(c.subject, 80) +
                  '" · matched ' +
                  shared.slice(0, 4).join(', ') +
                  ' · same file ' +
                  file,
              };
              n++;
              return;
            }
          }
        });
    p.head = head;
    if (n) {
      save(p);
      send('context:changed', { project: p.root });
    }
  } catch {
  } finally {
    p.scanning = false;
  }
}

function line(e, p) {
  const s = p ? openSummary(p, e) : e.summary,
    parts = [];
  for (const c of decisionsOf(s.choices))
    parts.push(
      'Decision waiting on the user: ' +
        c.question +
        ' — ' +
        c.options
          .map((o, i) => i + 1 + '. ' + o.label + (o.recommended ? ' (recommended)' : ''))
          .join(' ') +
        (c.extracted ? ' [extracted]' : '')
    );
  for (const k of KEYS)
    if (Array.isArray(s[k]) && s[k].length)
      parts.push(
        LABEL[k] +
          ': ' +
          (k === 'changed' && e.edited.length
            ? e.edited.slice(0, 6).join(', ') +
              (s[k].length ? ' — ' + s[k].slice(0, 2).join('; ') : '')
            : s[k].slice(0, k === 'did' ? 1 : 2).join('; '))
      );
  if (!s.changed?.length && e.edited.length)
    parts.push('Changed: ' + e.edited.slice(0, 6).join(', '));
  return (
    '• ' +
    e.name +
    ' (' +
    e.agent +
    ', ' +
    ago(e.at) +
    ', result ' +
    e.id +
    ')' +
    (e.task ? ' — task "' + clip(shownTask(e.task), 140) + '"' : '') +
    '. ' +
    parts.join(' | ')
  );
}

// Relayed wrappers read as what they carry (same rule as the window's cleanTask, 44): a sub-agent
// hand-back → its report's first line, a task notification → its summary.
function shownTask(task) {
  const s = String(task || '').replace(/^(\s*\[from [^\]\n]*\])+\s*/, '');
  if (/^\s*\[Subagent hand-back\]/i.test(s)) {
    const body = (s.split(/The report follows:\s*/i)[1] || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(l => l && !/^[-=*#`]+$/.test(l));
    return (
      'Sub-agent report' + (body ? ': ' + body.replace(/^[#*\-\s]+/, '').replace(/\*\*/g, '') : '')
    );
  }
  if (/^\s*<task-notification>/i.test(s)) {
    const m = s.match(/<summary>([\s\S]*?)<\/summary>/i);
    return m ? m[1].trim() : 'Background task finished';
  }
  return s;
}

function pick(paneId, text, max) {
  const inst = lifecycle.info(paneId);
  if (!inst) return null;
  const p = store(inst.project || deps.root());
  if (!p) return null;
  const pr = profile(inst, p, text),
    q = queued.get(inst.id) || new Set(),
    seenAgents = new Set(),
    out = [];
  const pool = p.entries.filter(
    e =>
      !e.chatter &&
      !e.rolled &&
      e.instanceId !== inst.id &&
      !e.delivered.some(x => x.id === inst.id) &&
      Date.now() - e.at < FRESH_DAYS * 864e5
  );
  const ranked = pool
    .map(e => ({ e, r: score(e, pr), q: q.has(e.id) }))
    .filter(x => x.q || (text != null && relevant(x.r)))
    .sort((a, b) => b.q - a.q || b.r.s - a.r.s || b.e.at - a.e.at);
  for (const x of ranked) {
    if (out.length >= max) break;
    const agentKey = x.e.instanceId || x.e.name;
    if (seenAgents.has(agentKey)) continue; // only the latest relevant entry per agent
    if (text && x.e.task && text.includes(x.e.task.slice(0, 80))) continue;

    // the prompt already carries it
    if (text && text.length > 200 && lifecycle.quotes(text, readRaw(p, x.e.id))) continue;
    seenAgents.add(agentKey);
    out.push(x.e);
  }
  return out.length ? { inst, p, list: out, total: p.entries.length } : null;
}

function digest(paneId, text, how, max) {
  const hit = pick(paneId, text, max);
  if (!hit) return '';
  hit.list.forEach(e => mark(hit.p, e, hit.inst, how));
  send('context:changed', { project: hit.p.root });
  return (
    'Technically Not project context — finished work by other agents in this project that relates to your task (summaries only; full answer: `tnai context show ID`, all results: `tnai context`). Build on it rather than redoing it; if it conflicts with your task, say so.\n' +
    hit.list.map(e => line(e, hit.p)).join('\n')
  );
}

// A result's .md never changes once written, so its text is kept in memory (set when the entry is
// created, else read once): pick() runs on the UserPromptSubmit hook path (5 s timeout) and would
// otherwise re-read every candidate from disk on every prompt.
const rawText = new Map(); // norm(.md path) -> text

function readRaw(p, id) {
  const f = rawFile(p, id, '.md'),
    k = norm(f);
  if (rawText.has(k)) return rawText.get(k);
  let text = '';
  try {
    text = fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
  rawText.set(k, text);
  return text;
}

// ---------- Standing brief ----------
// One picture of the project, recomputed from entries, file locks and live agents. No model call,
// no timer. `tnai context brief` prints it. The floor lead and the on-screen slot are later phases;
// this only prints.
const briefSeen = new Map(); // norm(project) -> last fingerprint for `tnai context brief`

// the same for the Result summary: unchanged picture keeps the same text, so the window does not
// redraw
const briefWindow = new Map();

function briefNow(p) {
  const byPane = new Map(
    lifecycle
      .state()
      .instances.filter(n => n.paneId)
      .map(n => [n.paneId, n])
  );
  let held = [];
  try {
    held = require('./file-locks').list(p.root);
  } catch {
    held = [];
  }
  return lifecycle.live(p.root).map(n => {
    const st = byPane.get(n.paneId);
    const cur = current.get(n.paneId);
    const last = p.entries.find(e => !e.chatter && !e.rolled && e.instanceId === n.id);
    return {
      id: n.id,
      paneId: n.paneId,
      name: n.name || n.agent || 'Agent',
      cli: n.agent || '',
      state: st?.state === 'active' ? 'working' : 'idle',
      task: clip(cleanTask(cur?.task || ''), 160),
      startedAt: cur?.startedAt || 0,
      files: held.filter(h => h.paneId === n.paneId).map(h => h.file),
      did: last?.summary?.did?.[0] || '',
    };
  });
}

function briefGoal(p, now) {
  const live = now.filter(n => n.task).sort((a, b) => b.startedAt - a.startedAt);
  const best = live[0];
  if (!best) return '';
  const last = p.entries.find(e => !e.chatter && !e.rolled && e.instanceId === best.id);
  const shared = last ? keywords(best.task).filter(w => keywords(last.task).includes(w)) : [];
  return clip(shared.length >= 2 ? last.task : best.task, 200);
}

function briefFiles(p, n) {
  const set = new Set((n.files || []).map(f => f.toLowerCase()));
  for (const f of mentionedFiles(n.task, p.root)) set.add(f.toLowerCase());
  return set;
}

function briefFields(p) {
  const now = briefNow(p);
  const latest = latestPerAgent(p);
  const proven = latest.flatMap(e =>
    (e.summary?.did || [])
      .slice(0, 1)
      .map(
        d =>
          d +
          ' (' +
          e.name +
          ((e.edited || []).length ? '; ' + e.edited.slice(0, 4).join(', ') : '') +
          ')'
      )
  );
  const open = [];
  for (const e of latest) {
    const s = openSummary(p, e);
    for (const item of s.remains || [])
      open.push({ kind: 'remains', text: item + ' (' + e.name + ')', at: e.at });
    for (const item of s.blockers || [])
      open.push({ kind: 'blockers', text: item + ' (' + e.name + ')', at: e.at });
    for (const item of s.untested || [])
      open.push({ kind: 'untested', text: item + ' (' + e.name + ')', at: e.at });
    for (const c of decisionsOf(s.choices))
      open.push({ kind: 'decide', text: c.question + ' (' + e.name + ')', at: e.at });
  }
  const newest = list => list.slice().sort((a, b) => b.at - a.at)[0];
  const oneNext =
    (
      newest(open.filter(o => o.kind === 'decide')) ||
      newest(open.filter(o => o.kind === 'blockers')) ||
      {}
    ).text || '';
  const crossings = [];
  for (let i = 0; i < now.length; i++)
    for (let j = i + 1; j < now.length; j++) {
      const shared = [...briefFiles(p, now[i])].filter(f => briefFiles(p, now[j]).has(f));
      if (shared.length)
        crossings.push(now[i].name + ' and ' + now[j].name + ' share ' + shared[0] + ' (inferred)');
    }
  return { goal: briefGoal(p, now), now, proven, open, crossings, oneNext };
}

function briefSnap(f) {
  return JSON.stringify({
    goal: f.goal,
    now: f.now.map(n => [n.name, n.state, n.task, n.files.join(','), n.did]),
    proven: f.proven,
    open: f.open.map(o => o.text),
    crossings: f.crossings,
    oneNext: f.oneNext,
  });
}

function briefSince(prev, f) {
  if (!prev) return ['first look'];
  if (prev === briefSnap(f)) return [];
  const old = JSON.parse(prev);
  const lines = [];
  const added = f.proven.filter(x => !old.proven.includes(x));
  if (added.length) lines.push('Proven: ' + added.slice(0, 2).join('; '));
  const opened = f.open.map(o => o.text).filter(x => !old.open.includes(x));
  if (opened.length) lines.push('Open: ' + opened.slice(0, 2).join('; '));
  if (f.oneNext && f.oneNext !== old.oneNext) lines.push('One next: ' + f.oneNext);
  return lines.length ? lines.slice(0, 3) : ['the picture changed'];
}

function renderBrief(f) {
  const out = ['Standing brief'];
  if (f.goal) out.push('Goal: ' + f.goal);
  const nowLines = f.now.map(
    n =>
      n.name +
      ' (' +
      n.cli +
      ', ' +
      n.state +
      ')' +
      (n.task ? ' — ' + clip(n.task, 80) : '') +
      (n.files.length ? '; editing ' + n.files.slice(0, 3).join(', ') : '') +
      (n.did ? '; last: ' + clip(n.did, 80) : '')
  );
  const sections = [
    ['Now:', nowLines],
    ['Proven:', f.proven],
    ['Open:', f.open.map(o => o.text)],
    ['One next:', f.oneNext ? [f.oneNext] : []],
    ['Crossings:', f.crossings],
    ['Since last look:', f.since || []],
  ];

  // Eight lines across the four headings: one next, two now, three open, two proven. Unused room
  // goes to Proven, then Open.
  const caps = new Map([
    ['One next:', 1],
    ['Now:', 2],
    ['Open:', 3],
    ['Proven:', 2],
  ]);
  const keep = new Map(
    sections.map(([head, items]) => {
      const cap = caps.get(head);
      return [head, cap == null ? items.slice() : items.slice(0, cap)];
    })
  );
  let spare = [...caps.entries()].reduce((n, [head, cap]) => n + cap - keep.get(head).length, 0);
  for (const head of ['Proven:', 'Open:']) {
    const all = sections.find(([h]) => h === head)[1],
      have = keep.get(head);
    while (spare > 0 && have.length < all.length) {
      have.push(all[have.length]);
      spare--;
    }
  }
  for (const [head] of sections) {
    const list = keep.get(head);
    if (list.length) out.push(head, ...list.map(s => '- ' + s));
  }
  return out.join('\n') + '\n';
}

function takeBrief(p) {
  const f = briefFields(p);
  const key = norm(p.root),
    prev = briefSeen.get(key);
  f.since = briefSince(prev, f);
  briefSeen.set(key, briefSnap(f));
  return f;
}

// Result summary (phase 2). Since last look stays until the picture itself changes, so a second
// read of the same picture is the same text.
function windowBrief(p) {
  const f = briefFields(p);
  const key = norm(p.root),
    snap = briefSnap(f),
    prev = briefWindow.get(key);
  if (!prev || prev.snap !== snap) {
    f.since = briefSince(prev?.snap, f);
    briefWindow.set(key, { snap, since: f.since });
  } else f.since = prev.since;
  return f;
}

// ---------- For `tnai context` (agent-mesh.js) and the window ----------
function find(p, key) {
  key = String(key || '').toLowerCase();
  return (
    p.entries.find(e => e.id === key) ||
    (key.length >= 4 ? p.entries.find(e => e.id.startsWith(key)) : null)
  );
}

function query(paneId, project, args) {
  const p = store(project);
  if (!p) return { ok: false, error: 'No project.' };
  const inst = lifecycle.info(paneId);
  if (args[0] === 'brief') return { ok: true, text: renderBrief(takeBrief(p)) };
  if (args[0] === 'note' || args[0] === 'mark')
    return edit(p, inst?.name || inst?.agent || 'an agent', args, inst);
  if (args[0] === 'show') {
    const e = find(p, args[1]);
    if (!e)
      return {
        ok: false,
        error:
          'No result "' + (args[1] || '') + '" in this project. Run `tnai context` for the list.',
      };
    if (inst) mark(p, e, inst, 'pull');
    const log = rawFile(p, e.id, '.log');
    return {
      ok: true,
      text:
        readRaw(p, e.id) +
        (fs.existsSync(log)
          ? '\nFull terminal output (search it rather than reading it all): ' + log + '\n'
          : '') +
        (e.log ? 'CLI session log: ' + e.log + '\n' : ''),
    };
  }

  // Plain `tnai context` stays short (usage: agents run it once per task and it stays in their
  // context): results queued for the caller in full, the 6 newest others clipped (`tnai context
  // show ID` opens one). `tnai context --all`: the 10 newest, every line in full.
  const all = args.includes('--all'),
    topic = args
      .filter(a => a !== '--all')
      .join(' ')
      .trim();
  let list,
    mine = [];
  if (topic) {
    const pr = {
      files: new Set(mentionedFiles(topic, p.root).map(f => f.toLowerCase())),
      bases: new Set(),
      words: new Set(keywords(topic, 24).concat(words(topic))),
    };
    pr.bases = new Set(
      [...pr.files].map(f => path.basename(f)).concat(topic.toLowerCase().split(/\s+/))
    );
    list = p.entries
      .map(e => ({ e, r: score(e, pr) }))
      .filter(x => x.r.s > 0)
      .sort((a, b) => b.r.s - a.r.s || b.e.at - a.e.at)
      .slice(0, 8)
      .map(x => x.e);
  } else {
    mine = inst ? [...(queued.get(inst.id) || [])].map(id => find(p, id)).filter(Boolean) : [];
    list = [
      ...new Set(
        mine.concat(p.entries.filter(e => !e.chatter && !e.rolled).slice(0, all ? 10 : 6))
      ),
    ].slice(0, 12);
  }
  if (inst)
    list.forEach(e => {
      if (e.instanceId !== inst.id) mark(p, e, inst, 'pull');
    });
  if (list.length) send('context:changed', { project: p.root });
  const board = topic ? '' : overview(p);
  return {
    ok: true,
    text:
      (list.length
        ? (topic
            ? 'Finished work matching "' + topic + '":\n'
            : 'Finished work in this project, newest first:\n') +
          list
            .map(e => (topic || all || mine.includes(e) ? line(e, p) : clip(line(e, p), 360)))
            .join('\n')
        : topic
          ? 'No finished work matches "' + topic + '".'
          : 'No finished agent work recorded in this project yet.') +
      board +
      '\n',
  };
}

// Open issues and next steps: from each agent's latest result only (a later result supersedes its
// earlier one).
function latestPerAgent(p) {
  const seen = new Set();
  return p.entries.filter(
    e =>
      !e.chatter &&
      !e.rolled &&
      Date.now() - e.at < FRESH_DAYS * 864e5 &&
      !seen.has(e.instanceId || e.name) &&
      seen.add(e.instanceId || e.name)
  );
}

function overview(p) {
  const latest = latestPerAgent(p);
  const open = latest.map(e => [e, openSummary(p, e)]);
  const keyed = (e, ks) =>
    ks
      .flatMap(k => (e.summary?.[k] || []).map((x, i) => [x, markKey(e.id, k, i)]))
      .filter(([, key]) => !p.marks[key])
      .map(([x, key]) => {
        const c = claimOf(p, key);
        const m = p.maybe[key];
        return (
          x +
          ' (' +
          e.name +
          '; ' +
          key +
          (c ? '; claimed by ' + c.agent + ' ' + ago(c.at) : '') +
          (m
            ? '; possibly done by ' +
              m.name +
              ' ' +
              ago(m.at) +
              ' (inferred, result ' +
              m.by +
              '; mark it done if so)'
            : '') +
          ')'
        );
      });
  const issues = open.flatMap(([e]) => keyed(e, ['blockers'])).slice(0, 6);
  const next = open.flatMap(([e]) => keyed(e, ['next', 'remains'])).slice(0, 6);
  const asks = open
    .flatMap(([e, s]) =>
      decisionsOf(s.choices).map(
        c =>
          c.question + ' (' + e.name + '; options: ' + c.options.map(o => o.label).join(' / ') + ')'
      )
    )
    .slice(0, 6);
  return (
    notesText(p) +
    digestOf.text(p, ago) +
    (asks.length
      ? '\nDecisions waiting on the user (do not pick for them):\n' +
        asks.map(s => '  - ' + s).join('\n')
      : '') +
    (issues.length ? '\nKnown issues:\n' + issues.map(s => '  - ' + s).join('\n') : '') +
    (next.length ? '\nOpen / recommended next:\n' + next.map(s => '  - ' + s).join('\n') : '')
  );
}

function notesText(p) {
  return p.notes.length
    ? '\nProject notes (goals, constraints and current state, kept by the user and agents; follow them):\n' +
        p.notes.map(n => '  - ' + n.text).join('\n')
    : '';
}

// Claude Code: the notes once per change, with its next prompt.
function notesFor(paneId) {
  const inst = lifecycle.info(paneId);
  if (!inst) return '';
  const p = store(inst.project || deps.root());
  if (!p || !p.notes.length || notesSeen.get(inst.id) === p.notesAt) return '';
  notesSeen.set(inst.id, p.notesAt);
  return notesText(p).trim();
}

// One mark key or a list of them (an array, or comma-joined from the window; one save, one push).
// by: the agent that marked it through `tnai context mark` (shown under Resolved).
function markIn(p, key, st, by) {
  key = String(key || '');
  const [id, k, i] = key.split(':');
  const v = p.entries.find(e => e.id === id)?.summary?.[k];
  if (
    !MARKABLE.has(k) ||
    (st && !MARK_STATES.has(st)) ||
    !(k === 'choices' ? /^\d+$/.test(i) && decisionsOf(v)[+i]?.question : v?.[+i])
  )
    return false;
  delete p.claims[key]; // resolved or put back: the claim ends either way
  if (st) {
    p.marks[key] = { state: st, at: Date.now(), ...(by ? { agent: by } : {}) };
    delete p.kept[key];
  } else {
    if (AUTO_STATES.has(p.marks[key]?.state)) p.kept[key] = Date.now();
    delete p.marks[key];
  } // an undone automatic mark is never re-applied
  return true;
}

function setMark(key, st, p = store(deps.root()), by) {
  if (!p) return 0;
  const n = []
    .concat(key)
    .flatMap(x => String(x).split(','))
    .filter(x => markIn(p, x, st, by)).length;
  if (n) {
    save(p);
    send('context:changed', { project: p.root });
  }
  return n;
}

// `tnai context mark claimed KEY`: an agent says it is fixing an open item, so others skip it. The
// item stays open (a claim is not a mark); the claim ends when the item is marked, undone, the
// claimant's agent instance is no longer live (exited / panel closed), or after CLAIM_MS regardless
// (the agent may have stopped without Technically Not noticing). instId (the claimant's lifecycle
// instance id) makes the liveness check exact; older claims stored with only a name fall back to a
// name match.
const CLAIM_MS = 2 * 3600e3;

function claimOf(p, key) {
  const c = p.claims[key];
  if (!c || Date.now() - c.at >= CLAIM_MS) return null;
  const live = lifecycle.live(p.root);
  return (c.id ? live.some(n => n.id === c.id) : live.some(n => n.name === c.agent)) ? c : null;
}

function claim(p, keys, by, instId) {
  const taken = [],
    mine = [];
  for (const key of keys) {
    const [id, k, i] = key.split(':'),
      c = claimOf(p, key);
    if (
      !MARKABLE.has(k) ||
      k === 'choices' ||
      p.marks[key] ||
      !p.entries.find(e => e.id === id)?.summary?.[k]?.[+i]
    )
      continue;
    if (c && c.agent !== by) {
      taken.push(key + ' (claimed by ' + c.agent + ' ' + ago(c.at) + ')');
      continue;
    }
    p.claims[key] = { agent: by, at: Date.now(), ...(instId ? { id: instId } : {}) };
    mine.push(key);
  }
  if (mine.length) {
    save(p);
    send('context:changed', { project: p.root });
  }
  return { mine, taken };
}

function addNote(text, p = store(deps.root()), by) {
  text = clip(text, 400);
  if (!p || !text || p.notes.length >= NOTES_MAX) return false;
  const n = {
    id: crypto.randomBytes(3).toString('hex'),
    text,
    at: Date.now(),
    ...(by ? { by } : {}),
  };
  p.notes.push(n);
  p.notesAt = Date.now();
  save(p);
  send('context:changed', { project: p.root });
  return n.id;
}

// A keyed note (e.g. `current`, which a build script rewrites after each build):
// replaced in place, added when missing.
function setNote(key, text, p = store(deps.root()), by) {
  const n = p?.notes.find(x => x.key === key);
  text = clip(text, 400);
  if (!n) {
    const id = key && addNote(text, p, by);
    if (id) {
      p.notes.find(x => x.id === id).key = key;
      save(p);
    }
    return id;
  }
  if (!text) return false;
  Object.assign(n, { text, at: Date.now() }, by ? { by } : {});
  p.notesAt = Date.now();
  save(p);
  send('context:changed', { project: p.root });
  return n.id;
}

function removeNote(id, p = store(deps.root())) {
  if (!p) return false;
  const n = p.notes.length;
  p.notes = p.notes.filter(x => x.id !== id);
  if (p.notes.length === n) return false;
  p.notesAt = Date.now();
  save(p);
  send('context:changed', { project: p.root });
  return true;
}

// `tnai context note ...` / `tnai context mark ...`: agents keep the project notes current.
// A decision stays the user's: agents cannot mark one (it goes stale on its own,
// context-digest.js).
function edit(p, who, args, inst) {
  const [what, verb, ...rest] = args;
  if (what === 'note') {
    if (verb === 'list' || !verb)
      return {
        ok: true,
        text: p.notes.length
          ? p.notes.map(n => n.id + '  ' + n.text).join('\n') + '\n'
          : 'No project notes.\n',
      };
    if (verb === 'add') {
      const id = addNote(rest.join(' '), p, who);
      return id
        ? { ok: true, text: 'Added note ' + id + '.\n' }
        : {
            ok: false,
            error:
              p.notes.length >= NOTES_MAX
                ? 'The project has ' + NOTES_MAX + ' notes; remove one first.'
                : 'Nothing to add.',
          };
    }
    if (verb === 'set') {
      const id = setNote(rest[0], rest.slice(1).join(' '), p, who);
      return id
        ? { ok: true, text: 'Set note ' + rest[0] + ' (' + id + ').\n' }
        : {
            ok: false,
            error: 'Use: tnai context note set KEY TEXT (' + NOTES_MAX + ' notes max).',
          };
    }
    if (verb === 'remove') {
      const n = rest.filter(id => removeNote(id, p)).length;
      return n
        ? { ok: true, text: 'Removed ' + n + ' note(s).\n' }
        : { ok: false, error: 'No such note. `tnai context note list` shows them.' };
    }
  }
  if (what === 'mark') {
    const st = verb === 'undo' ? '' : verb;
    if (st !== '' && st !== 'done' && st !== 'dismissed' && st !== 'claimed')
      return {
        ok: false,
        error:
          'Use: tnai context mark claimed|done|dismissed|undo KEY... (KEY = RESULTID:kind:index, or a RESULTID for all its open items).',
      };
    const all = e =>
      ['blockers', 'remains', 'next', 'ideas']
        .flatMap(k => (e.summary?.[k] || []).map((_, i) => markKey(e.id, k, i)))
        .filter(key => (st ? !p.marks[key] : p.marks[key] || p.claims[key]));
    const keys = rest
      .flatMap(x => (x.includes(':') ? [x] : (e => (e ? all(e) : []))(find(p, x))))
      .filter(key => key.split(':')[1] !== 'choices');
    if (st === 'claimed') {
      const { mine, taken } = claim(p, keys, who, inst?.id);
      if (!mine.length && !taken.length)
        return {
          ok: false,
          error: "Nothing matched (only open items can be claimed; decisions are the user's).",
        };
      return {
        ok: !!mine.length,
        text:
          (mine.length
            ? 'Claimed ' + mine.length + ' item(s); `tnai context mark done` them once fixed.\n'
            : '') + (taken.length ? 'Already claimed, skip: ' + taken.join(', ') + '\n' : ''),
        ...(mine.length ? {} : { error: 'Already claimed, skip: ' + taken.join(', ') }),
      };
    }

    // An item another live agent claimed is refused for done/dismissed (named, with its age), and
    // undo never releases it either — only setMark(free) below ever touches it.
    const blocked = keys.filter(key => {
      const c = claimOf(p, key);
      return c && c.agent !== who;
    });
    const free = keys.filter(key => !blocked.includes(key));
    if (!st) {
      const n = free.filter(key => p.claims[key] && !p.marks[key] && delete p.claims[key]).length;
      if (n) {
        save(p);
        send('context:changed', { project: p.root });
        if (!free.some(key => p.marks[key]) && !blocked.length)
          return { ok: true, text: 'Released ' + n + ' claim(s).\n' };
      }
    }
    const n = free.length ? setMark(free, st, p, who) : 0;
    if (blocked.length) {
      const msg = blocked
        .map(
          key =>
            'Claimed by ' +
            p.claims[key].agent +
            ' ' +
            ago(p.claims[key].at) +
            ', skip it or `tnai send ' +
            p.claims[key].agent +
            '`'
        )
        .join('; ');
      return n
        ? {
            ok: true,
            text:
              (st ? 'Marked ' + n + ' item(s) ' + st : 'Put ' + n + ' item(s) back') +
              '.\n' +
              msg +
              '\n',
          }
        : { ok: false, error: msg };
    }
    return n
      ? {
          ok: true,
          text: (st ? 'Marked ' + n + ' item(s) ' + st : 'Put ' + n + ' item(s) back') + '.\n',
        }
      : { ok: false, error: "Nothing matched (decisions are the user's to answer)." };
  }
  return {
    ok: false,
    error:
      'Use: tnai context note list|add TEXT|set KEY TEXT|remove ID, or tnai context mark done|dismissed|undo KEY...',
  };
}

function setAuto(on) {
  const p = store(deps.root());
  if (!p) return false;
  p.auto = !!on;
  if (p.auto) rederive(p);
  else {
    dropAuto(p);
    consolidate(p);
  }
  save(p);
  send('context:changed', { project: p.root });
  return true;
}

// Existence checks for state(): async (never a burst of sync stats on the main thread; the project
// may sit in a synced folder), at most EXIST_CONC at once, cached per absolute path until
// watch-service reports a change there (project files) or EXIST_TTL passes; .log files are set here
// when written / removed.
const EXIST_CONC = 16,
  EXIST_TTL = 30000;
const known = new Map(); // norm(abs path) -> { v: exists, at }

// norm(project) -> in-flight state() promise, shared by overlapping calls
const building = new Map();

function fsChanged(batch) {
  if (batch.many) {
    known.clear();
    return;
  }
  const root = deps.root();
  if (!root) return;
  for (const c of batch) known.delete(norm(path.join(root, c.path)));
}
watch.onChanges(fsChanged);

async function existAll(files) {
  const out = new Map(),
    todo = [];
  for (const f of files) {
    const k = known.get(norm(f));
    if (k && Date.now() - k.at < EXIST_TTL) out.set(f, k.v);
    else todo.push(f);
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const f = todo[i++];
      const v = await fs.promises.access(f).then(
        () => true,
        () => false
      );
      known.set(norm(f), { v, at: Date.now() });
      out.set(f, v);
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXIST_CONC, todo.length) }, worker));
  return out;
}

function state() {
  const p = store(deps.root());
  if (!p)
    return Promise.resolve({
      project: '',
      entries: [],
      marks: {},
      notes: [],
      auto: true,
      digest: null,
      brief: '',
    });
  const key = norm(p.root);
  scanCommits(p); // throttled; marks arrive with a later context:changed
  if (!building.has(key))
    building.set(
      key,
      build(p).finally(() => building.delete(key))
    );
  return building.get(key);
}

async function build(p) {
  const edited = [
    ...new Set(
      p.entries
        .slice(0, 80)
        .flatMap(e => e.edited || [])
        .concat((p.digest?.clusters || []).flatMap(c => c.files))
    ),
  ];
  const exists = await existAll(
    edited
      .map(f => path.join(p.root, f))
      .concat(p.entries.slice(0, 80).map(e => rawFile(p, e.id, '.log')))
  );

  // deleted since: off the changed-files list
  const gone = new Set(edited.filter(f => exists.get(path.join(p.root, f)) === false));
  const digest = p.digest && {
    ...p.digest,
    clusters: p.digest.clusters.map(c => ({
      ...c,
      files: c.files.filter(f => !gone.has(f)).slice(0, 8),
    })),
  };

  // taken after the checks, so marks / entries changed meanwhile are included
  const list = p.entries.slice(0, 80);

  // Only the marks and maybe keys of the results sent: the window reads them through those results
  // alone (49, 51, 54), and every key is `<result id>:kind:index` (measured 2026-10-05: all of them
  // were 784 KB of a 925 KB answer, read again after every context:changed).
  const ids = new Set(list.map(e => e.id)),
    listed = m =>
      Object.fromEntries(Object.entries(m).filter(([k]) => ids.has(k.slice(0, k.indexOf(':')))));
  return {
    project: p.root,
    marks: listed(p.marks),
    maybe: listed(p.maybe),
    notes: p.notes,
    auto: p.auto,
    digest,
    brief: renderBrief(windowBrief(p)),
    entries: list.map(({ turnKey, log, ...e }) => ({
      ...e,
      missing: (e.edited || []).filter(f => gone.has(f)),
      hasLog: !!(
        exists.get(rawFile(p, e.id, '.log')) ?? known.get(norm(rawFile(p, e.id, '.log')))?.v
      ),
      hasTranscript: !!log,
    })),
  };
}

function raw(id) {
  const p = store(deps.root());
  const e = p && find(p, id);
  return e ? { id: e.id, text: readRaw(p, e.id) } : null;
}

function openLog(id) {
  const p = store(deps.root()),
    e = p && find(p, id);
  if (!e) return false;
  const f = rawFile(p, e.id, '.log');
  return fs.existsSync(f)
    ? require('electron')
        .shell.openPath(f)
        .then(err => !err)
    : false;
}

function remove(id) {
  const p = store(deps.root());
  if (!p) return false;
  const i = p.entries.findIndex(e => e.id === id);
  if (i < 0) return false;
  p.entries.splice(i, 1);
  for (const ext of ['.md', '.log']) {
    fs.rm(rawFile(p, id, ext), { force: true }, () => {});
    rawText.delete(norm(rawFile(p, id, ext)));
  }
  for (const q of queued.values()) q.delete(id);
  for (const k of Object.keys(p.marks)) if (k.startsWith(id + ':')) delete p.marks[k];
  for (const k of Object.keys(p.claims)) if (k.startsWith(id + ':')) delete p.claims[k];
  for (const k of Object.keys(p.kept)) if (k.startsWith(id + ':')) delete p.kept[k];
  dropAuto(p, id); // its evidence is gone
  consolidate(p);
  save(p);
  send('context:changed', { project: p.root });
  return true;
}

module.exports = {
  // deps: { ptys, root() }
  init(sender, d = {}) {
    send = sender;
    deps = { ...deps, ...d };
  },
  gitChanged() {
    scanCommits(store(deps.root()), true);
  },
  flushSaves,
  onTurn(t) {
    onTurn(t).catch(() => {});
  },
  hook(paneId, h) {
    try {
      hook(paneId, h);
    } catch {}
  },
  // Claude Code: extra context for a new prompt (queued + relevant), or mid-task after a tool call
  // (queued only).
  forPrompt(paneId, prompt) {
    try {
      return [notesFor(paneId), digest(paneId, String(prompt || ''), 'prompt', PROMPT_PICKS)]
        .filter(Boolean)
        .join('\n\n');
    } catch {
      return '';
    }
  },
  forTool(paneId) {
    try {
      const inst = lifecycle.info(paneId);
      return inst && queued.get(inst.id)?.size ? digest(paneId, null, 'tool', TOOL_PICKS) : '';
    } catch {
      return '';
    }
  },
  // For agent-peers.js: the same keyword / file rules, and a Claude Code agent's current prompt.
  keywords,
  mentionedFiles: (text, root) => mentionedFiles(text, root),
  taskOf: paneId => current.get(paneId)?.task || '',
  // For a paired computer (main.js `remoteReport`): a finished task in the
  // short form a shared result keeps. The task as it is shown, and what the answer's report lists
  // under "- Did:" (its items joined again), or without a report the answer's first sentences.
  shortOf(task, result) {
    try {
      const r = parseReport(result),
        s = r ? r.summary : extract(result);
      return { task: shownTask(cleanTask(task)), did: (s.did || []).join('; ') };
    } catch {
      return { task: '', did: '' };
    }
  },
  query,
  state,
  warm,
  renamed,
  raw,
  openLog,
  remove,
  setMark,
  setAuto,
  addNote,
  setNote,
  removeNote,
  forget: paneId => {
    current.delete(paneId);
    for (const m of [queued, notesSeen])
      for (const id of m.keys()) if (!lifecycle.exists(id)) m.delete(id);
  }, // instances swept by lifecycle
  _test: {
    project: () => store(deps.root()),
    consolidate: () => {
      const p = store(deps.root());
      consolidate(p);
      return p;
    },
    isChatter: digestOf.isChatter,
    parseReport,
    extract,
    extractChoices,
    keywords,
    mentionedFiles,
    ideasSection,
    fsChanged,
    briefFields: () => briefFields(store(deps.root())),
  },
};
