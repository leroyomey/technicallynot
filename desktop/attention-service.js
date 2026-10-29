/*
 * Technically Not desktop · attention-service.js — "Needs you": per-pane items for an agent stuck
 * on the user (a Claude Code permission request, an interactive question seen in the pane's output
 * — INFERRED —, a prompt left unsent in the CLI's input, Technically Not's own folder-trust
 * dialog), composer prompts held while such a question is open (so a pasted prompt never answers a
 * menu) and delivered once it clears, `tnai send` messages held while the user has unsent text in
 * the target's input (so a message is never merged into it; see draft tracking), and the Windows
 * notification (no taskbar flash). Push `attention:change` /
 * `attention:delivered` / `attention:jump`; IPC `attention:*` registered in main.js.
 */
'use strict';

const QUIET_MS = 600; // output quiet this long → look at the pane's final screen for a question
const SETTLE_MS = 800; // a question cleared this long (and still clear) → deliver held prompts

// A Claude Code task ended (its Stop hook) and every prompt held for it waited only for that task,
// none for a question: they go after this much instead of SETTLE_MS. Claude Code asks its questions
// during a task (permission and question hooks), never after Stop, so the long settle, which lets a
// question drawn on the screen be seen, has nothing to wait for. Every other check of the delivery
// timer still runs. Other CLIs keep SETTLE_MS: their task end and questions are read off their
// record and screen.
const END_SETTLE_MS = 150;
const TAIL_KEEP = 12000; // raw output kept per pane; trimmed in one slice to TAIL_TRIM when over
const TAIL_TRIM = 6000;

// a message held for the user's unsent text is dropped (sender told "not delivered") after this
// long
let DRAFT_HOLD_MS = 10 * 60 * 1000;

// a prompt from another computer held for ANY reason is dropped after this long (as long as its
// one-time number is remembered)
let REMOTE_HOLD_MS = 10 * 60 * 1000;

// an OpenCode question its own server reported (exact, not read off the screen)
const openCodeLink = require('./opencode-link');
let send = () => {},
  turns = null,
  hooks = null,
  submitFn = null,
  getWin = () => null,
  cliFn = () => null; // cliFn: paneId → 'Claude Code' | 'Codex' | …

// paneId -> { tail, timer, items: Map(kind -> item), held: [], delivering, deliverTimer, offSubmit,
// draft, offDraft }
const panes = new Map();
let seq = 0,
  emitQueued = false;

// shown Notification -> paneId whose question it is about (null: not a question), kept referenced
// so its click handler survives GC
const liveNotes = new Map();

const clip = (s, n) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// A key the user pressed, not a focus/mouse report: text left after the CSI reports, or Esc itself
// (one or two presses in one write).
const typedText = data => {
  const t = String(data).replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '');
  return /[^\x1b]/.test(t) || /^\x1b\x1b?$/.test(t);
};

function pane(paneId) {
  let p = panes.get(paneId);
  if (!p)
    panes.set(
      paneId,
      (p = {
        tail: '',
        timer: null,
        items: new Map(),
        held: [],
        delivering: false,
        deliverTimer: null,
        offSubmit: null,
        draft: '',
        offDraft: null,
      })
    );
  return p;
}

// ---- Question detection on terminal output (inferred) ----

// Terminal output → roughly the lines on screen: cursor moves / erases become line breaks,
// cursor-forward becomes spaces, other escapes go.
function screenText(raw) {
  return String(raw)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(200, Number(n) || 1)))
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[ABEFHJKfd]/g, '\n')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b[()*+][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>78DEHMc]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
const BOX = /[│┃║╭╮╰╯─━═┌┐└┘├┤┬┴┼╔╗╚╝▌▐]/g;

// A question that is only ever asked interactively (Claude Code, Codex, Cursor Agent, OpenCode,
// Gemini).
const STRONG = [
  /\bdo you want to (proceed|make (this|these) edits?|create|allow|run|continue|overwrite|delete|apply|write|execute)\b/i,
  /\bdo you trust (the|this) (files|folder|directory|contents|workspace|authors)\b/i,
  /\b(trust|allow) (this|the) (folder|directory|workspace)\s*\?/i,
  /\ballow (this )?command\s*\?/i,
  /\bwould you like to (run|execute) the following command/i,
  /\bwould you like to (make|apply) the following (edits|changes)/i,
  /\ballow execution of\b/i,
  /\bapply this change\s*\?/i,
  /\brun this command\s*\?/i,
  /\bpermission (required|requested)\b/i,
  /\b(select|choose) (a |an |your )?(login|sign[- ]?in|auth\w*) method\b/i,
  /\bhow would you like to (log ?in|sign ?in|authenticate)\b/i,
];

// Codex's review of a hook it has not run before (Codex 0.162 draws it as its own screen, and what
// is typed then goes into that screen, not to the model). The hook it asks about is the one
// Technically Not writes for Codex's live steps, so the user is told what it is and which key
// answers it, in place of Codex's own line.
const HOOK_REVIEW = /\b\d+ hooks? needs? review before (it|they) can run\b/i;
const HOOK_REVIEW_DETAIL =
  'Codex asks about the hook that shows its steps here: press t to trust it, or Esc to leave';

// The choice Codex opens with when a hook is new: 1 review, 2 trust all, 3 go on without hooks.
const HOOK_START = /\bhooks can run outside the sandbox after you trust them\b/i;
const HOOK_START_DETAIL =
  'Codex asks about the hook that shows its steps here: choose 2 to trust it, 3 to go on without';

// Only as one of the last lines: the shell / CLI is waiting on exactly this.
const FINAL = [
  /[\[(]\s*y(?:es)?\s*\/\s*n(?:o)?\s*[\])]/i,
  /\bpress (enter|return|any key) to (continue|proceed|confirm)\b/i,
];

// An idle input box or a busy agent drawn after the question: the question is over (Claude Code,
// Codex, Gemini, OpenCode, Cursor footers). Cursor Agent 2026.10.01 draws only its empty input ("→
// Add a follow-up", "→ Plan, search, build anything") and a model line under a reply: without those
// here, a reply that ended in "Do you want to proceed …" left the idle panel on "Needs you" (real
// run, desktop test real-cursor-idle, 2026-10-05).
const IDLE =
  /\? for shortcuts|esc to interrupt|ctrl\+c to interrupt|shift\+tab to cycle|context left|auto-compact|⏎ send|type your message|ctrl\+p commands|^→\s*(add a follow-up|plan, search, build anything)\s*$/i;

// An option's number may stand alone on its line: Codex 0.162 places each word of an option that
// is not chosen with its own cursor move, and every cursor move reads as a line break here.
const OPTION = /^([❯›→▶➤●◉]\s*)?(\d)[.)](\s+\S|$)/;

// raw tail of a pane's output → { detail } for an open interactive question, else null.
function detectQuestion(raw) {
  const text = screenText(String(raw).slice(-TAIL_TRIM)).slice(-2000);

  // Lines without a letter or digit (GitHub Copilot's logo animation, drawn after its dialog) never
  // ask anything and would push the question out.
  const lines = text
    .split('\n')
    .map(l => l.replace(BOX, ' ').trim())
    .filter(l => /[\p{L}\p{N}]/u.test(l))
    .slice(-15);
  if (!lines.length) return null;
  let at = -1,
    detail = '',
    // detail: the latest explicit question line; soft: the line a numbered selector sits under
    soft = '';
  const found = (i, line) => {
    if (i >= at) at = i;
    detail = line;
  };
  lines.forEach((line, i) => {
    if (STRONG.some(re => re.test(line))) found(i, line);
    if (HOOK_REVIEW.test(line)) found(i, HOOK_REVIEW_DETAIL);
    if (HOOK_START.test(line)) found(i, HOOK_START_DETAIL);
  });
  lines.forEach((line, i) => {
    if (i >= lines.length - 3 && FINAL.some(re => re.test(line))) found(i, line);
  });

  // A numbered selector: consecutive options 1., 2., … with a pointer on one of them; the question
  // is the line above it.
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION.exec(lines[i]);
    if (!m || m[2] !== '1') continue;
    let n = 1,
      pointer = !!m[1],
      j = i + 1;
    for (; j < lines.length && j <= i + 8; j++) {
      const o = OPTION.exec(lines[j]);
      if (!o) {
        if (n >= 2) break;
        continue;
      } // a wrapped option line between 1. and 2.
      if (Number(o[2]) !== n + 1) break;
      n++;
      pointer = pointer || !!o[1];
    }
    if (n >= 2 && pointer) {
      at = Math.max(at, j - 1);
      let k = i - 1;
      while (k > i - 7 && k >= 0 && !/[?:]\s*$/.test(lines[k])) k--;
      soft = lines[k >= 0 && k > i - 7 ? k : i - 1] || lines[i];
    }
  }
  if (at < 0) return null;
  if (lines.slice(at + 1).some(l => IDLE.test(l))) return null;
  return { detail: clip((detail || soft).replace(/^[❯›→▶➤●◉?]\s*/, ''), 100) };
}

// ---- Items ----

function setItem(paneId, kind, detail, inferred) {
  const p = pane(paneId),
    old = p.items.get(kind);
  if (old && old.detail === detail) return;
  p.items.set(kind, {
    id: kind + ':' + paneId,
    paneId,
    kind,
    detail,
    since: old?.since || Date.now(),
    inferred,

    // a question still on screen that only changed its words was read again already
    // (recheckGuess): no second redraw
    ...(old?.rechecked ? { rechecked: true } : null),
  });
  changed(paneId);
}

function clearItem(paneId, kind) {
  const p = panes.get(paneId);
  if (!p?.items.delete(kind)) return;
  if (kind === 'unsent' && p.offSubmit) {
    p.offSubmit();
    p.offSubmit = null;
  }
  changed(paneId);
}
const permissionsOf = paneId =>
  (hooks?.pendingPermissions?.() || []).filter(x => x.paneId === paneId);
const askText = q =>
  clip(q?.questions?.[0]?.question || q?.questions?.[0]?.header || 'a question', 100);

function blocker(paneId) {
  const perm = permissionsOf(paneId)[0];
  if (perm)
    return {
      kind: 'permission',
      detail: clip(perm.tool + (perm.detail ? ': ' + perm.detail : ''), 100),
    };
  const ask = openCodeLink.state(paneId)?.questions[0];
  if (ask) return { kind: 'menu', detail: askText(ask) };
  const p = panes.get(paneId);
  for (const kind of ['trust', 'menu']) {
    const it = p?.items.get(kind);
    if (it) return { kind, detail: it.detail };
  }
  return null;
}

function payload() {
  const perms = hooks?.pendingPermissions?.() || [];
  const items = perms.map(x => ({
    id: 'permission:' + x.id,
    paneId: x.paneId,
    kind: 'permission',
    tool: x.tool,
    detail: clip(x.tool + (x.detail ? ': ' + x.detail : ''), 100),
    whole: x.whole === true,
    ...(x.whole !== true && typeof x.full === 'string' && x.full ? { full: x.full } : {}),
    since: x.at,
    inferred: false,
  }));

  // OpenCode's questions from its own server: the same kind as a menu seen on the screen, but not
  // inferred; the screen's guess of it is left out.
  const asks = openCodeLink.questions();

  // A question that takes "choose option N" from another computer
  // carries its option labels (`opts`) and its own id (`ask`): only one that OpenCode's
  // server reported, asked by the panel's main session, the only question open in that panel, with
  // exactly one question, one answer allowed and 1 to 9 labelled options, and while no permission
  // request is held for that panel. Everything else is listed as before, without them. Whether a
  // computer may choose is decided in remote-service.js.
  const choice = q => {
    const one =
      q.child !== true &&
      Array.isArray(q.questions) &&
      q.questions.length === 1 &&
      q.questions[0].multiple !== true
        ? q.questions[0]
        : null;
    const labels =
      one && Array.isArray(one.options) ? one.options.map(o => String(o?.label || '')) : [];
    if (
      !one ||
      labels.length < 1 ||
      labels.length > 9 ||
      labels.some(l => !l) ||
      asks.filter(x => x.paneId === q.paneId).length !== 1 ||
      perms.some(x => x.paneId === q.paneId)
    )
      return {};
    return { opts: labels, ask: String(q.id) };
  };
  for (const q of asks)
    items.push({
      id: 'question:' + q.id,
      paneId: q.paneId,
      kind: 'menu',
      detail: askText(q),
      since: q.at,
      inferred: false,
      ...choice(q),
    });
  const held = [];
  for (const [paneId, p] of panes) {
    // Claude Code's own dialog in the terminal is the same question as its hook request
    const asked = perms.some(x => x.paneId === paneId) || asks.some(q => q.paneId === paneId);
    for (const it of p.items.values()) if (!(asked && it.kind === 'menu')) items.push({ ...it });

    // why: what it waits for now (question: the user must answer; draft: the user's unsent text;
    // busy: the agent's task; compact: the agent compacts its conversation; queue: earlier held
    // ones).
    const asking = p.held.length && !!blocker(paneId),
      busy = p.held.length && working(paneId),
      squeezing = p.held.length && compacting(paneId);
    for (const h of p.held)
      // remote: from is another computer's name
      held.push({
        id: h.id,
        paneId,
        preview: h.text.slice(0, 120),
        text: h.text.slice(0, 4000),
        at: h.at,
        from: h.from || null,
        waitDraft: !!h.waitDraft,
        why: asking
          ? 'question'
          : h.waitDraft && (p.draft || speaking)
            ? 'draft'
            : busy
              ? 'busy'
              : squeezing
                ? 'compact'
                : 'queue',
        ...(h.remote ? { remote: true } : {}),
      });
  }
  return { items: items.sort((a, b) => a.since - b.since), held };
}

function emit() {
  if (emitQueued) return;
  emitQueued = true;
  setImmediate(() => {
    emitQueued = false;
    send('attention:change', payload());
  });
}

function changed(paneId) {
  emit();
  if (paneId != null) {
    schedule(paneId);
    if (!blocker(paneId)) closeNotes(paneId);
  }
}

// A Windows notification about a question leaves Windows' list as soon as the question is answered
// anywhere (terminal, composer, the app's own prompt, or the panel closed), so it never lingers
// after the user handled it.
function closeNotes(paneId) {
  for (const [n, id] of liveNotes)
    if (id === paneId) {
      liveNotes.delete(n);
      try {
        n.close();
      } catch {}
    }
}

// ---- Held prompts ----

// A working agent also holds them: a prompt sent while its task runs
// stays here, where the user can send it now, edit it or remove it, instead of going into the CLI's
// own queue where nothing can be done with it. It goes out by itself when the task ends
// (turns.onEnd).
const working = paneId => !!turns?.busy?.(paneId);

// A compacting agent holds them too. A compact is no task (no task start or end), so a prompt sent
// during it went straight into the CLI: Claude Code keeps it in its own queue until the compact
// ends and writes it nowhere the thread can show (a queue-operation "enqueue" with no text), so
// it seemed to vanish. Held here, it stands in the conversation as waiting and goes out when the
// compact ends. The window tells when a compact begins and ends (158-cli-busy.js, which joins the
// PreCompact hook, a /compact from the prompt box and each CLI's compact line for every CLI).
// A compact the window never ends is let go after COMPACT_LIMIT_MS (158 keeps the same limit).
const COMPACT_LIMIT_MS = 10 * 60 * 1000;

// paneId -> { since, timer }
const compacts = new Map();
const compacting = paneId => compacts.has(paneId);

// on: a compact began in that thread; off: it ended. An empty paneId with on false: the window
// started anew and knows of no compact, so none is kept.
function setCompacting(paneId, on) {
  const id = String(paneId ?? '');
  if (!id) {
    if (on) return;
    for (const known of [...compacts.keys()]) setCompacting(known, false);
    return;
  }
  const had = compacts.get(id);
  if (on) {
    if (had) return;
    const timer = setTimeout(() => setCompacting(id, false), COMPACT_LIMIT_MS);
    timer.unref?.();
    compacts.set(id, { since: Date.now(), timer });
    emit();
    return;
  }
  if (!had) return;
  clearTimeout(had.timer);
  compacts.delete(id);

  // the prompts held for it go out now (schedule, through changed)
  changed(id);
}

const waitsOn = (p, paneId) =>
  blocker(paneId) ||
  (working(paneId) ? { kind: 'busy' } : compacting(paneId) ? { kind: 'compact' } : null);

// ---- A guessed question is read again ----
// The 'menu' item is a guess from the raw output: a reply that merely ended with words such as
// "Do you want to proceed" looks like a question when the CLI does not draw its idle footer again
// after it (a CLI that redraws only the rows that changed). Such a guess held every message to that
// agent until it printed something new or the user pressed a key, so opening its thread (which
// fits the screen and makes the CLI redraw) seemed to unstick it (bug sweep 2026-10-28,
// helpers-click). So when that guess is the only thing holding messages, the CLI is asked once
// per guess to draw its screen again (one row less and back). The quiet timer in `output` then
// reads the fresh screen: a real question is drawn again and keeps holding, a reply ends under
// the idle footer and the messages go. Exact questions (permission hooks, OpenCode's own,
// 'trust') and a working or compacting agent never get here.
let RECHECK_MS = 3000;
const NUDGE_BACK_MS = 80;

// (paneId) → asks the CLI to draw its screen again; init's deps.redraw replaces it in a test
let redrawFn = paneId => {
  const ptys = require('./pty-service');

  // the live session's size (a pane with no process has none and is not resized)
  const session = ptys.replay(paneId);
  if (!session || !(session.rows > 5) || !session.cols) return;
  ptys.resize(paneId, session.cols, session.rows - 1);

  // back, unless a view set another size meanwhile (that size stays)
  setTimeout(() => {
    const now = ptys.replay(paneId);
    if (now?.cols === session.cols && now?.rows === session.rows - 1)
      ptys.resize(paneId, session.cols, session.rows);
  }, NUDGE_BACK_MS);
};

function onlyGuess(p, paneId) {
  const guess = p.items.get('menu');
  if (!guess || !guess.inferred || p.items.has('trust')) return false;
  if (permissionsOf(paneId).length || openCodeLink.state(paneId)?.questions[0]) return false;
  return !working(paneId) && !compacting(paneId);
}

function recheckGuess(p, paneId) {
  const guess = p.items.get('menu');
  if (p.recheckTimer || guess.rechecked) return;
  p.recheckTimer = setTimeout(() => {
    p.recheckTimer = null;
    if (panes.get(paneId) !== p || !p.held.length || !onlyGuess(p, paneId)) return;
    const now = p.items.get('menu');

    // once per guess: a real question drawn again keeps the same item, so no loop of redraws
    if (now.rechecked) return;
    now.rechecked = true;
    try {
      redrawFn(paneId);
    } catch {}
  }, RECHECK_MS);
  p.recheckTimer.unref?.();
}

// After a task ended: END_SETTLE_MS for a Claude Code panel whose held prompts all waited only for
// its task (none was held for a question, none came from another computer), else SETTLE_MS.
function settleAfterEnd(paneId) {
  const p = panes.get(paneId);
  const onlyTask =
    !!p &&
    p.held.length > 0 &&
    !p.remoteIn &&
    p.held.every(h => !h.remote && h.heldFor !== 'question');
  return onlyTask && cliFn(paneId) === 'Claude Code' ? END_SETTLE_MS : SETTLE_MS;
}

// wait: how long the delivery timer waits (SETTLE_MS, or settleAfterEnd's answer at a task end)
function schedule(paneId, wait = SETTLE_MS) {
  const p = panes.get(paneId);
  if (p?.held.length && onlyGuess(p, paneId)) recheckGuess(p, paneId);
  if (!p || !p.held.length || p.delivering || p.deliverTimer || waitsOn(p, paneId)) return;
  p.deliverTimer = setTimeout(async () => {
    p.deliverTimer = null;
    if (!p.held.length || p.delivering || waitsOn(p, paneId)) return;

    // still typing an answer: never paste into it
    if (Date.now() - (p.typedAt || 0) < SETTLE_MS) return schedule(paneId);

    // the user's unsent text is still in the input (or on its way: voice): draftKeys / voice
    // reschedule once it is sent or cleared
    if (p.held[0].waitDraft && (p.draft || speaking)) return;

    // text from another computer may still sit in the input: nothing is typed behind it (remoteGone
    // / typed reschedule)
    if (p.remoteIn) return;
    if (p.held[0].remote) {
      // one at a time, never behind text left unsent or a local delivery on its way (remoteEnded /
      // clearItem / localDelivery reschedule)
      if (p.remoteOut || p.localOut || p.items.has('unsent')) return;

      // a question drawn a moment ago that is not an item yet: look again
      if (asking(paneId)) return schedule(paneId);
    }
    const h = p.held.shift();
    clearTimeout(h.expire);
    p.delivering = true;
    emit();
    let result;
    try {
      result = h.remote
        ? await sendRemote(p, h, paneId)
        : await submitFn(paneId, h.text, {
            paste: h.paste,
            agent: h.agent,
            ...(h.from
              ? null
              : {
                  person: true,
                }) /* held for this computer's user (no `from`): still their own prompt when it goes out (prompt-submit.js `person`) */,
          });
    } catch (err) {
      result = { ok: false, state: 'error', error: err.message };
    }
    p.delivering = false;
    done(h, paneId, result);
    schedule(paneId);
  }, wait);
}

// Every held prompt ends here exactly once (sent, cancelled, gone, expired): the window drops it, a
// `tnai send` sender hears the outcome.
function done(h, paneId, result) {
  clearTimeout(h.expire);
  send('attention:delivered', { heldId: h.id, paneId, result, from: h.from || null });
  try {
    h.onDone?.(result);
  } catch {}
}

// prompt-submit.js asks before writing anything for a composer prompt: held (and the answer to
// return) when the pane is on a question, else null. A pane that already holds prompts keeps
// holding, so they arrive in order. ifBusy (the composer's own prompts): a working agent holds it
// too; every other sender (a decision's answer, context upkeep, resume after a limit) keeps going
// straight to the CLI.
function holdIfBlocked(paneId, { text, paste = true, agent, ifBusy = false } = {}) {
  const b = blocker(paneId),
    p = panes.get(paneId),
    busy = !b && ifBusy && working(paneId),
    compact = !b && !busy && ifBusy && compacting(paneId);

  // remoteIn: a prompt from another computer is being typed into that input right now
  if (!b && !busy && !compact && !p?.held.length && !p?.remoteIn) return null;
  const h = {
    id: 'held-' + Date.now().toString(36) + '-' + ++seq,
    paneId,
    text: String(text ?? ''),
    paste,
    agent,
    at: Date.now(),

    // what it was held for first: one held for a question keeps the full settle (settleAfterEnd)
    heldFor: b ? 'question' : 'task',
  };
  pane(paneId).held.push(h);
  changed(paneId);
  const why =
    b ||
    (busy
      ? { kind: 'busy', detail: 'It is still working on its task.' }
      : compact
        ? { kind: 'compact', detail: 'It is compacting its conversation.' }
        : { kind: 'queue', detail: 'Earlier prompts for this thread are still held.' });
  return { ok: true, state: 'held', heldId: h.id, reason: why.kind, detail: why.detail };
}

// prompt-submit.js asks before writing a `tnai send` message: held when the user has unsent text in
// that input (never merged into it), or when earlier prompts for the pane are still held (order).
// Delivered once the input is empty and any question is answered; dropped after DRAFT_HOLD_MS. A
// working agent holds it too (see `working` above), except asap: a `tnai ask` question, whose
// sender is waiting for the answer. The app's own typed-in messages use it as well (file-lock and
// team notices, a sub-agent's task or report: main.js, agent-graph.js), with asap, so they still go
// straight to an empty input as before and only wait for the user's text. keep: never dropped (a
// report must arrive). While the user is dictating (voice below) every input counts as holding
// unsent text: the words are on their way and no key was pressed yet.
function holdIfDraft(
  paneId,
  { text, paste = true, agent, from, onDone, asap = false, keep = false } = {}
) {
  // A panel that waits on a question holds every such message, asap ones too:
  // typed into a permission dialog, the message's Enter answers the dialog
  // with its highlighted choice, so a command was approved that the user never saw. It goes out
  // when the question is answered (schedule), like a composer prompt held by holdIfBlocked, and is
  // never dropped for that reason.
  const was = panes.get(paneId),
    asked = !!blocker(paneId),
    busy = !asap && working(paneId),
    forDraft = !!was?.draft || !!speaking;
  if (!asked && !forDraft && (asap || (!was?.held.length && !busy))) return null;
  const p = pane(paneId);
  const h = {
    id: 'held-' + Date.now().toString(36) + '-' + ++seq,
    paneId,
    text: String(text ?? ''),
    paste,
    agent,
    at: Date.now(),
    waitDraft: true,
    from: from || null,
    onDone,
    heldFor: asked ? 'question' : 'task',
  };
  if (forDraft && !keep)
    h.expire = setTimeout(() => {
      // only a message waiting for the user's unsent text is ever dropped
      const i = p.held.indexOf(h);
      if (i < 0) return;
      p.held.splice(i, 1);
      changed(paneId);
      done(h, paneId, {
        ok: false,
        state: 'expired',
        error:
          'The unsent text in its input was not sent or cleared within ' +
          Math.round(DRAFT_HOLD_MS / 60000) +
          ' min.',
      });
    }, DRAFT_HOLD_MS);
  h.expire?.unref?.();
  p.held.push(h);
  changed(paneId);
  return forDraft
    ? {
        ok: true,
        state: 'held',
        heldId: h.id,
        reason: 'draft',
        detail: p.draft ? 'It has unsent text in its input.' : 'The user is speaking a prompt.',
      }
    : asked
      ? {
          ok: true,
          state: 'held',
          heldId: h.id,
          reason: blocker(paneId)?.kind || 'question',
          detail: 'It is waiting on a question.',
        }
      : busy
        ? {
            ok: true,
            state: 'held',
            heldId: h.id,
            reason: 'busy',
            detail: 'It is still working on its task.',
          }
        : {
            ok: true,
            state: 'held',
            heldId: h.id,
            reason: 'queue',
            detail: 'Earlier prompts for this thread are still held.',
          };
}

// The user is dictating (70-voice-prompt.js): from the voice key going down until the words are
// typed in, or nothing was heard. A message typed in meanwhile would land in the input first and
// the spoken words behind it, sent together. Counted, since a new press
// can start while an earlier clip is still transcribed; a count left over by a window that closed
// mid-press ends after SPEAK_MAX_MS.
const SPEAK_MAX_MS = 10 * 60 * 1000;
let speaking = 0,
  speakTimer = null;

function voice(on) {
  speaking = Math.max(0, speaking + (on ? 1 : -1));
  clearTimeout(speakTimer);
  speakTimer = null;
  if (speaking) {
    speakTimer = setTimeout(() => {
      speaking = 0;
      voice(false);
    }, SPEAK_MAX_MS);
    speakTimer.unref?.();
    return;
  }
  for (const paneId of panes.keys()) schedule(paneId);
  emit();
}

function findHeld(heldId) {
  for (const [paneId, p] of panes) {
    const i = p.held.findIndex(h => h.id === heldId);
    if (i >= 0) return { paneId, p, i };
  }
  return null;
}

function cancelHeld(heldId) {
  const f = findHeld(String(heldId));
  if (!f) return { ok: false, error: 'That prompt is no longer held.' };
  const [h] = f.p.held.splice(f.i, 1);
  changed(f.paneId);
  done(h, f.paneId, { ok: false, state: 'cancelled', error: 'The user cancelled it.' });
  return {
    ok: true,
    text: h.from || h.remote ? '' : h.text,
    paneId: f.paneId,
    from: h.from || null,
  }; // a held agent message never goes into the user's composer, nor does another computer's prompt
}

async function sendHeldNow(heldId) {
  const f = findHeld(String(heldId));
  if (!f) return { ok: false, state: 'gone', error: 'That prompt is no longer held.' };
  if (f.p.held[f.i].remote) return sendRemoteNow(f);
  const [h] = f.p.held.splice(f.i, 1);
  clearTimeout(h.expire);
  emit();
  let result;
  try {
    result = await submitFn(f.paneId, h.text, { paste: h.paste, agent: h.agent });
  } catch (err) {
    result = { ok: false, state: 'error', error: err.message };
  }
  done(h, f.paneId, result);
  schedule(f.paneId);
  return result;
}

// ---- Prompts from another computer (prompt-submit.js submitRemote) ----
// Their sender is not this computer's user, so they get what no local
// prompt needs. One at a time per panel: p.remoteOut is set in the turn of one's paste and stays
// until its task ended (turns.onEnd), it was reported not started, or REMOTE_HOLD_MS passed; every
// other one waits here, where the user sees which computer it is from and can remove it, never in a
// CLI's own queue. While one's pasted text may still sit in the input (p.remoteIn) the panel counts
// as holding unsent text: the draft is RECALLED, so messages wait and no delete empties it. A held
// one keeps its guard (the sender's right, the pairing, the very process it was sent to), asked
// again in the turn of its write. what the window is told; the other computer only ever gets a word
// (prompt-submit.js REMOTE)
const NOT_SENT = Object.freeze({ ok: false, state: 'expired', error: 'It was not sent.' });

// A question of any kind, with the screen read now: the quiet timer in `output` is up to QUIET_MS
// late, and an Enter must not be.
const asking = paneId =>
  blocker(paneId) ||
  (detectQuestion(panes.get(paneId)?.tail || '') ? { kind: 'menu', detail: '' } : null);
const remoteAllowed = h => {
  try {
    return h.remote.guard() === true;
  } catch {
    return false;
  }
};

function claimRemote(p, paneId) {
  clearTimeout(p.remoteTimer);
  p.remoteOut = Date.now();

  // a task whose end never shows must not keep the panel for good
  p.remoteTimer = setTimeout(() => remoteEnded(paneId), REMOTE_HOLD_MS);
  p.remoteTimer.unref?.();
}

// The one before it ended, or never started: the next held one may go.
function remoteEnded(paneId) {
  const p = panes.get(paneId);
  if (!p?.remoteOut) return;
  clearTimeout(p.remoteTimer);
  p.remoteTimer = null;
  p.remoteOut = 0;
  schedule(paneId);
}

// prompt-submit.js asks before writing a prompt from another computer: held (the answer is
// returned) when anything at all is in its way, else null and the panel is this prompt's until
// remoteEnded. A held one is dropped after REMOTE_HOLD_MS whatever it waits for.
function holdRemote(paneId, { text, agent, remote } = {}) {
  const p = pane(paneId);
  if (
    !asking(paneId) &&
    !p.draft &&
    !p.remoteIn &&
    !speaking &&
    !p.items.has('unsent') &&
    !working(paneId) &&
    !p.held.length &&
    !p.delivering &&
    !p.remoteOut &&
    !p.localOut
  ) {
    claimRemote(p, paneId);
    return null;
  }
  const h = {
    id: 'held-' + Date.now().toString(36) + '-' + ++seq,
    paneId,
    text: String(text ?? ''),
    paste: true,
    agent,
    at: Date.now(),
    waitDraft: true,
    from: clip(remote.from, 60) || 'another computer',
    onDone: remote.onDone,
    remote,
  };
  h.expire = setTimeout(() => {
    const i = p.held.indexOf(h);
    if (i < 0) return;
    p.held.splice(i, 1);
    changed(paneId);
    done(h, paneId, NOT_SENT);
  }, REMOTE_HOLD_MS);
  h.expire.unref?.();
  p.held.push(h);
  changed(paneId);
  return { ok: true, state: 'held', heldId: h.id };
}

// In the turn of its paste: nothing in the way (holdRemote's list without the queue).
const remoteReady = paneId => {
  const p = panes.get(paneId);
  return (
    !asking(paneId) &&
    !p?.draft &&
    !p?.remoteIn &&
    !speaking &&
    !p?.items.has('unsent') &&
    !working(paneId) &&
    !p?.localOut
  );
};

// prompt-submit.js says when a delivery of this computer's own (the composer, `tnai send`,
// /compact, context upkeep) has its text in a panel's input with an Enter still to come: from just
// before its paste until it returns. Meanwhile a prompt from
// another computer is held like one for a working agent: pasted behind that text, the local Enter
// would send both as one input, and the local path's later Enters ask none of the remote path's
// questions. Local deliveries are not changed by the count.
function localDelivery(paneId, by) {
  const p = pane(paneId);
  p.localOut = Math.max(0, (p.localOut || 0) + (by > 0 ? 1 : -1));
  if (!p.localOut) schedule(paneId);
}

// Review 23, L7: a delivery (this computer's own or a remote prompt) has its text in that panel's
// input with an Enter still to come. Keys typed from another computer meanwhile would be sent as
// part of it, so remote-actions.js `type` answers "changed" while this is true.
function deliveryOpen(paneId) {
  const p = panes.get(paneId);
  return !!p && ((p.localOut || 0) > 0 || !!p.remoteOut);
}

// A prompt from another computer got its one Enter and the CLI gives no sign (prompt-submit.js
// "unconfirmed"): its text may still sit in the input. This computer's user gets the "unsent text"
// note, so the reason prompts for that panel are held can be seen and acted on, and the hold itself
// ends after the time a held prompt gets instead of never.
function remoteUnconfirmed(paneId, text) {
  const p = pane(paneId);
  unsent(paneId, text);
  clearTimeout(p.remoteInTimer);
  p.remoteInTimer = setTimeout(() => {
    p.remoteInTimer = null;
    remoteGone(paneId);
  }, REMOTE_HOLD_MS);
  p.remoteInTimer.unref?.();
}

// Its text is in the input now. The CLI confirming a submitted prompt takes the mark off again,
// like any draft.
function remotePasted(paneId) {
  const p = pane(paneId);
  p.remoteIn = true;
  p.draft = RECALLED;
  if (!p.offDraft && turns?.onSubmit)
    p.offDraft = turns.onSubmit(paneId, () => {
      p.offDraft?.();
      p.offDraft = null;
      p.draft = '';
      p.remoteIn = false;
      schedule(paneId);
    });
  emit();
}

// Before each of its Enters: no question, and the input holds exactly what was pasted (no key of
// the user's, no spoken words on their way).
const remoteEnterOk = paneId => {
  const p = panes.get(paneId);
  return (
    !!p &&
    p.remoteIn === true &&
    p.draft === RECALLED &&
    !speaking &&
    !p.items.has('unsent') &&
    !asking(paneId)
  );
};

// Its text left the input: the CLI took it, its task ended, or its process is gone. Text the user
// has touched since is theirs (typed).
function remoteGone(paneId) {
  const p = panes.get(paneId);
  if (!p?.remoteIn) return;
  p.remoteIn = false;
  clearTimeout(p.remoteInTimer);
  p.remoteInTimer = null;
  if (p.draft === RECALLED) {
    p.draft = '';
    p.undo = [];
    if (p.offDraft) {
      p.offDraft();
      p.offDraft = null;
    }
  }
  emit();
  schedule(paneId);
}

// A held one goes out. The guard is asked in the same turn as the write (submitFn runs up to its
// paste before it first waits); a no drops it.
async function sendRemote(p, h, paneId) {
  if (!remoteAllowed(h)) return NOT_SENT;
  claimRemote(p, paneId);
  let result = null;
  try {
    result = await submitFn(paneId, h.text, { agent: h.agent, remote: h.remote, claimed: true });
  } catch {}
  if (result?.ok === true) return result;
  remoteEnded(paneId); // also when submit never ran
  return NOT_SENT;
}

// "Send now" on a prompt from another computer moves it ahead of the others and overrides nothing
// that holds it: its Enter would answer the question, or its text would land behind unsent text.
// When it cannot go this moment it stays held.
async function sendRemoteNow({ paneId, p, i }) {
  const h = p.held[i];
  if (p.delivering || p.remoteOut || !remoteReady(paneId)) {
    emit();
    return {
      ok: false,
      state: 'held',
      error: 'It is from ' + h.from + ' and is sent once nothing in that thread is in its way.',
    };
  }
  p.held.splice(i, 1);
  clearTimeout(h.expire);
  p.delivering = true;
  emit();
  const result = await sendRemote(p, h, paneId);
  p.delivering = false;
  done(h, paneId, result);
  schedule(paneId);
  return result;
}

// For the service that took them: the held prompts of one source (remote.key), and all of them gone
// at once when its right ends.
function remoteHeld(key) {
  const out = [];
  for (const [paneId, p] of panes)
    for (const h of p.held)
      if (h.remote && h.remote.key === String(key)) out.push({ id: h.id, paneId, at: h.at });
  return out;
}

function dropRemote(test) {
  let n = 0;
  for (const [paneId, p] of panes) {
    const out = p.held.filter(h => h.remote && test(h));
    if (!out.length) continue;
    p.held = p.held.filter(h => !out.includes(h));
    changed(paneId);
    for (const h of out) {
      done(h, paneId, NOT_SENT);
      n++;
    }
  }
  return n;
}
const cancelRemote = key => dropRemote(h => h.remote.key === String(key));

// every held one whose guard says no now (for the moment a panel's process or a right changes)
const remoteRecheck = () => dropRemote(h => !remoteAllowed(h));

// ---- Feeds from main.js / prompt-submit.js ----

function output(batch) {
  for (const { paneId, data } of Array.isArray(batch) ? batch : [batch]) {
    if (!paneId || !data) continue;
    const p = pane(paneId);
    p.tail += data;
    if (p.tail.length > TAIL_KEEP) p.tail = p.tail.slice(-TAIL_TRIM);

    // One timer per pane (not reset on every 16 ms batch): when it fires early it re-arms for the
    // rest of the quiet time.
    p.lastAt = Date.now();
    if (!p.timer)
      p.timer = setTimeout(function quiet() {
        const left = QUIET_MS - (Date.now() - p.lastAt);
        if (left > 0) {
          p.timer = setTimeout(quiet, left);
          return;
        }
        p.timer = null;
        const q = detectQuestion(p.tail);
        if (q) setItem(paneId, 'menu', q.detail, true);
        else clearItem(paneId, 'menu');
      }, QUIET_MS);
  }
}

// Keys the user typed into the pane (not focus/mouse reports): they are answering or editing, so
// inferred questions and the unsent note go. Output from before the keys is dropped too: an
// answered question still in the scrollback must not come back; only one drawn again counts.
function typed(paneId, data) {
  const r = panes.get(paneId);
  if (r?.remoteIn) {
    r.remoteIn = false;
    schedule(paneId);

    // the user's keys own that input now: text from another computer in it is theirs to send or
    // clear
  }
  if (data !== undefined && !typedText(data)) {
    if ((RECALL.test(data) || MOVE.test(data)) && !blocker(paneId)) draftKeys(paneId, String(data));
    return;
  } // arrows/Home/End alone: only the draft hears them (on a menu they move the choice)

  // keys pressed on a question answer it; they are not input text
  if (data !== undefined && !blocker(paneId)) draftKeys(paneId, String(data));
  const p = panes.get(paneId);
  if (p) {
    p.tail = '';
    p.typedAt = Date.now();
  }
  clearItem(paneId, 'menu');
  clearItem(paneId, 'unsent');
}

// ---- Draft: what the user has typed into a pane's input and not sent ----
// Built from the user's own keystrokes (main.js pty:write), never from the screen, so a CLI's
// placeholder ("Ask Codex to do anything"), its echo or redraws can't look like user text. Enter
// (outside a paste) sends it; Ctrl+C clears it; Backspace, Ctrl+W and Alt+Backspace delete; the CLI
// confirming a submitted prompt (agent-turns onSubmit) empties it too. The cursor is taken to be at
// the end until a cursor move (see MOVE below). The pane's CLI decides the rest (checked against
// Claude Code 2.1.283 docs and Codex 0.157 codex-rs/tui source, 2026-09-28): Claude Code and Codex:
// Ctrl+U deletes to the line start (the line break when already there), Ctrl+Y pastes the last
// Ctrl+U/Ctrl+W delete back; Claude Code only: Esc Esc clears, Ctrl+S stashes the text (clears) and
// on an empty input brings it back, Ctrl+_ undoes the last edit; Codex: Esc never clears (Esc Esc
// on an empty input edits the previous message). Other CLIs: Ctrl+U and Esc Esc clear. History
// recall (Up/Down, Ctrl+P/N, Ctrl+R search; Codex Esc Esc on an empty input) fills the input with
// text the keys never showed: the draft then holds RECALLED, which only a whole clear (Enter,
// Ctrl+C, Esc Esc, Ctrl+S, the CLI confirming a submit) removes, so a message waits, never merges.
// A cursor move (Left/Right, Home/End, Ctrl+A/E, Alt+B/F, Ctrl+B/F outside Claude Code, where
// Ctrl+B backgrounds a task) on a non-empty input does the same: deletes after it can remove any
// part (Ctrl+K and Delete too), so only a whole clear or a send empties it.
const RECALL = /\x1b\[(?:1;\d+)?[AB]|\x1bO[AB]/,
  RECALLED = '\u0000';
const MOVE = /\x1b\[(?:1;\d+)?[CDHF]|\x1bO[CDHF]|\x1b\[[1478](?:;\d+)?~/;
const KEY =
  /\x1b\[200~([\s\S]*?)(?:\x1b\[201~|$)|\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1bO.|\x1b[\r\n\x7f\b]|\x1b[\s\S]|\x1b|[\s\S]/g;

function draftKeys(paneId, data) {
  const p = pane(paneId),
    was = p.draft,
    cli = cliFn(paneId) || '';
  const claude = cli === 'Claude Code',
    codex = cli === 'Codex',
    lines = claude || codex;
  let d = p.draft;
  const edit = v => {
    if (v === d) return;
    if (claude) {
      (p.undo ||= []).push(d);
      if (p.undo.length > 100) p.undo.shift();
    }
    d = v;
  };

  // deletes never empty recalled text of unknown length
  const keep = v => (d.includes(RECALLED) && !v.includes(RECALLED) ? RECALLED + v : v);
  const kill = v => {
    p.killed = d.slice(v.length);
    edit(keep(v));
  };
  for (const [m, pasted] of data.matchAll(KEY)) {
    // Claude Code, measured on 2.1.290 with tools/desktop-check/tests/real-draft-keys.js
    // (2026-10-05), each of these left a count the input did not show:
    const search = p.search,
      home = p.home;
    p.search = undefined;
    p.home = false; // one key after Ctrl+R / Ctrl+A, unless that key keeps it below
    if (claude && pasted === undefined) {
      if (m === '\b') {
        kill(d.replace(/\S*\s*$/, ''));
        continue;
      } // Ctrl+Backspace (xterm sends \b) deletes a word, like Ctrl+W
      if (m === '\r' && d.endsWith('\\')) {
        edit(d.slice(0, -1) + '\n');
        continue;
      } // backslash then Enter is a new line, nothing is sent
      if (m === '?' && !d) continue; // "?" on an empty input opens the shortcuts, it is not typed
      if (m === '\x12') {
        p.search = search !== undefined ? search : d;
        edit(RECALLED);
        continue;
      } // Ctrl+R: remember what the input held
      if (search !== undefined && (m === '\x1b' || m === '\x1b\x1b')) {
        d = search;
        p.escAt = 0;
        continue;
      } // Esc leaves the search: the input is as before
      if (search !== undefined && (m === '\x7f' || (m.length === 1 && m >= ' '))) {
        p.search = search;
        continue;
      } // typing the search words

      // Ctrl+A: the caret is at the start (falls through to the cursor-move rule)
      if (m === '\x01') p.home = true;
      if (m === '\x0b' && home && !d.replace(RECALLED, '').includes('\n')) {
        edit('');
        continue;
      } // …so Ctrl+K takes the whole line
    }
    if (m === '\t' && lines && d && !d.includes(RECALLED)) {
      d = RECALLED + d;
      continue;
    } // Tab completes a command or path: text the keys never showed
    if (pasted !== undefined)
      edit(d + pasted); // a paste: its line breaks are text, not Enter
    else if (m === '\r') {
      d = '';
      p.undo = [];
    } // Enter sends it
    else if (m === '\x03')
      edit(''); // Ctrl+C clears the input
    else if (m === '\x15') {
      if (!lines) edit('');
      else if (d.endsWith('\n')) kill(d.slice(0, -1));
      else kill(d.slice(0, d.lastIndexOf('\n') + 1));
    } // Ctrl+U
    else if (m === '\x19') {
      if (lines && p.killed) edit(d + p.killed);
    } // Ctrl+Y pastes the last deleted text back
    else if (m === '\x13') {
      if (claude && d) {
        p.stash = d;
        edit('');
      } else if (claude && p.stash) {
        edit(p.stash);
        p.stash = '';
      }
    } // Ctrl+S stash / restore
    else if (m === '\x1f') {
      if (claude && p.undo?.length) d = keep(p.undo.pop());
    } // Ctrl+_ undo
    else if (RECALL.test(m) || m === '\x10' || m === '\x0e' || m === '\x12')
      edit(RECALLED); // history recall: the input now holds unseen text
    else if (
      MOVE.test(m) ||
      m === '\x01' ||
      m === '\x05' ||
      m === '\x1bb' ||
      m === '\x1bf' ||
      (!claude && (m === '\x02' || m === '\x06'))
    ) {
      if (d && !d.includes(RECALLED)) d = RECALLED + d;
    } // cursor moved: later deletes hit unknown text
    else if (m === '\x1b\x1b') {
      if (!codex) edit('');
      else if (!d) edit(RECALLED);
      p.escAt = Date.now();
    } // two Esc presses in one write
    else if (m === '\x1b') {
      if (Date.now() - (p.escAt || 0) < 800) {
        if (!codex) edit('');
        else if (!d) edit(RECALLED);
      }
      p.escAt = Date.now();
    } // Esc Esc clears (Claude Code; Codex: edits the previous message)
    else if (m === '\x7f' || m === '\b') edit(keep(d.slice(0, -1)));
    else if (m === '\x17' || m === '\x1b\x7f' || m === '\x1b\b') kill(d.replace(/\S*\s*$/, ''));
    else if (m === '\x1b\r' || m === '\x1b\n' || m === '\n')
      edit(d + '\n'); // Shift/Alt+Enter, Ctrl+J: a new line in the input
    else if (m.length === 1 && m >= ' ') edit(d + m);
  }
  p.draft = d.length > 2000 ? (d.includes(RECALLED) ? RECALLED : '') + d.slice(-1999) : d;
  if (p.draft && !p.offDraft && turns?.onSubmit)
    p.offDraft = turns.onSubmit(paneId, () => {
      p.offDraft?.();
      p.offDraft = null;
      p.draft = '';
      schedule(paneId);
    });
  if (!p.draft && p.offDraft) {
    p.offDraft();
    p.offDraft = null;
  }
  if (was && !p.draft) schedule(paneId);
}

// The keys are a count, not the truth: one key the CLI reads differently leaves a draft here that
// its input no longer shows, and every message for that panel then waits on nothing (the
// fault: "Prompt held" for an agent whose input was empty). The window reads the CLI's own
// input box on the terminal screen (71 `boxEmpty`, Claude Code only) and says so here; the screen
// wins, but never while keys still arrive.
const EMPTY_AFTER_MS = 1500;

function inputEmpty(paneId) {
  const p = panes.get(paneId);
  if (!p?.draft || Date.now() - (p.typedAt || 0) < EMPTY_AFTER_MS) return false;
  p.draft = '';
  p.undo = [];
  if (p.offDraft) {
    p.offDraft();
    p.offDraft = null;
  }
  changed(paneId);
  schedule(paneId);
  return true;
}

function unsent(paneId, text) {
  setItem(paneId, 'unsent', clip(text, 100), false);
  const p = pane(paneId);
  if (!p.offSubmit && turns?.onSubmit)
    p.offSubmit = turns.onSubmit(paneId, () => clearItem(paneId, 'unsent'));
}

// A CLI the user started by hand in a terminal panel ended (agent-mesh.js: its shim's connection
// closed). The panel's process is still the same PowerShell, so pty:exit never comes and the
// prompts held for that CLI would later be typed into the shell, where their lines can run as
// commands. They are dropped like on exit and each sender
// hears it; the panel's other state stays.
function cliEnded(paneId) {
  const p = panes.get(paneId);
  if (!p || !p.held.length) return;
  clearTimeout(p.deliverTimer);
  p.deliverTimer = null;
  for (const h of p.held.splice(0))
    done(h, paneId, {
      ok: false,
      state: 'gone',
      error: 'The agent in that thread ended before the message was sent.',
    });
  emit();
}

function exited(paneId) {
  const compact = compacts.get(paneId);
  if (compact) {
    clearTimeout(compact.timer);
    compacts.delete(paneId);
  }
  const p = panes.get(paneId);
  if (!p) return;
  clearTimeout(p.timer);
  clearTimeout(p.deliverTimer);
  clearTimeout(p.remoteTimer);
  clearTimeout(p.remoteInTimer);
  clearTimeout(p.recheckTimer);
  p.offSubmit?.();
  p.offDraft?.();
  for (const h of p.held)
    done(h, paneId, {
      ok: false,
      state: 'gone',
      error: 'The process in that thread ended before the prompt was sent.',
    });
  panes.delete(paneId);
  closeNotes(paneId);
  emit();
}

// ---- Windows attention ----

function notify({ paneId, title, body } = {}) {
  const w = getWin();
  if (!w || w.isDestroyed() || w.isFocused()) return false;
  const { app, Notification } = require('electron');

  // No flashFrame: Windows flashes the window border with the taskbar
  // button, which flickered on a window that is not maximized.
  if (Notification.isSupported()) {
    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId(require('../package.json').build.appId);
      } catch {}
    } // Windows shows toasts only for a known app id
    const n = new Notification({
      title: clip(title || 'Technically Not', 80),
      body: clip(body || '', 200),
      silent: true,
    });

    // only a question closes itself once answered
    liveNotes.set(n, paneId != null && blocker(paneId) ? paneId : null);
    n.on('click', () => {
      liveNotes.delete(n);
      if (w.isDestroyed()) return;
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      send('attention:jump', { paneId: paneId ?? null });
    });
    n.on('close', () => liveNotes.delete(n));
    n.show();
  }
  return true;
}

// The count on the app's taskbar icon (174, user 2026-10-23): a small picture the page draws with
// the number, or none when nothing is new. Windows only; elsewhere it does nothing.
const BADGE_MAX = 20000;

function badge(picture, count) {
  const w = getWin();
  if (!w || w.isDestroyed() || process.platform !== 'win32') return false;
  const text = String(picture || '');
  const total = Number(count) || 0;
  const shown = total > 0 && text.length <= BADGE_MAX && /^data:image\/png;base64,/.test(text);
  const image = shown ? require('electron').nativeImage.createFromDataURL(text) : null;
  const label = shown ? total + (total === 1 ? ' thread' : ' threads') + ' to look at' : '';
  w.setOverlayIcon(image && !image.isEmpty() ? image : null, label);
  return true;
}

module.exports = {
  init(sendFn, deps = {}) {
    send = sendFn;
    turns = deps.turns;
    hooks = deps.hooks;
    submitFn = deps.submit;
    if (deps.window) getWin = deps.window;
    if (deps.cli) cliFn = deps.cli;
    if (deps.redraw) redrawFn = deps.redraw;
    turns?.onEnd?.(paneId => {
      clearItem(paneId, 'unsent');
      remoteGone(paneId);
      remoteEnded(paneId);

      // the calls above may already have set the full settle for the held prompts: a shorter one
      // replaces it
      const wait = settleAfterEnd(paneId);
      const p = panes.get(paneId);
      if (p?.deliverTimer && wait < SETTLE_MS) {
        clearTimeout(p.deliverTimer);
        p.deliverTimer = null;
      }
      schedule(paneId, wait);
    });

    // a task that ended began after the note (it is only set on an idle agent): the text was taken;
    // the same for another computer's prompt, and the next one may go
  },
  output,
  typed,
  unsent,
  exited,
  cliEnded,
  forget: exited,
  // agent-hooks.js `agent:permission` (asked or done): re-send, and a cleared pane delivers its
  // held prompts.
  permissionChanged(p) {
    changed(p?.paneId);
  },
  // opencode-link.js: a question was asked or answered, or a panel's link ended.
  linkChanged(e) {
    if (e && (e.type === 'question' || e.type === 'question-done' || e.type === 'off'))
      changed(e.paneId);
  },
  // Technically Not's own "Trust this folder?" dialog open for a pane (main.js trustFolder).
  trustAsked(paneId, detail) {
    if (paneId) setItem(paneId, 'trust', clip(detail, 100), false);
  },
  trustAnswered(paneId) {
    if (paneId) clearItem(paneId, 'trust');
  },
  blocker,
  holdIfBlocked,
  holdIfDraft,

  // the window: a compact began or ended in a thread (158-cli-busy.js); compacting: tests
  setCompacting,
  compacting,
  cancelHeld,
  hasDraft: paneId => !!panes.get(paneId)?.draft || !!speaking,
  inputEmpty,
  voice,
  sendHeldNow,
  notify,
  badge,
  // Prompts from another computer. For prompt-submit.js: holdRemote, remoteReady, remotePasted,
  // remoteEnterOk, remoteGone, remoteEnded. For the service that takes them: remoteHeld(key) → [{
  // id, paneId, at }], cancelRemote(key) and remoteRecheck() → how many were dropped.
  holdRemote,
  remoteReady,
  remotePasted,
  remoteEnterOk,
  remoteGone,
  remoteEnded,
  remoteHeld,
  cancelRemote,
  remoteRecheck,
  localDelivery,
  deliveryOpen,
  remoteUnconfirmed,
  list: payload,
  _test: {
    detectQuestion,
    screenText,

    // what a pane's question matcher reads, for a check that prints why a screen did not match
    tail: paneId => panes.get(String(paneId))?.tail || '',
    draftHoldMs: ms => {
      DRAFT_HOLD_MS = ms;
    },
    remoteHoldMs: ms => {
      REMOTE_HOLD_MS = ms;
    },
    recheckMs: ms => {
      RECHECK_MS = ms;
    },
  },
};
openCodeLink.on(e => module.exports.linkChanged(e));
