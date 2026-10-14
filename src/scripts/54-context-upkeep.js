/*
 * Technically Not · 54-context-upkeep.js — Desktop app only, opt-in (Settings › Agents › "Suggest
 * compacting large agent context", default on, asks first): after an agent finishes a turn,
 * Technically Not may offer to type the CLI's own /compact or /clear (Codex: /compact, /new) into
 * its pane — only when Project Context already holds what that turn did, so nothing is lost. It
 * never runs on its own: the notice waits until the user picks Run or Not now. CONTEXT SIZE is
 * real, pushed by desktop/agent-turns.js on `agent:turn` as turn.context { tokens, at, window? }:
 * Claude Code = the last main-transcript assistant message's usage (input + cache_read +
 * cache_creation); Codex = its token_count last_token_usage.input_tokens. null = unknown → nothing
 * happens (never guessed). GATE, all must hold for the pane's latest finished turn: setting on and
 * its CLI enabled here and the CLI has the command; the session is running; the turn ended normally
 * with nothing queued (42's turn.queued); no permission prompt open (45); a Project Context entry
 * for the same pane with entry.at >= turn.endedAt; that entry has no open blockers and no open
 * decision (unmarked summary.choices); no typing into the pane and the turn ended at least N idle
 * minutes ago. DECIDE: tokens >= clear threshold (unless "never clear") AND every next step of the
 * entry is marked (sent / done / dismissed / resolved) or there are none → clear; else tokens >=
 * compact threshold, or (Claude Code) turn.context.calls >= 150 model requests since the last
 * compact with >= 100k tokens → compact; else nothing. At most once per finished turn
 * (paneId:startedAt). A bell item asks (Run /compact, ✕ = Not now; it was a
 * box above the composer) and stays until answered or the gate stops holding; the gate is checked
 * again on Run. Typed like the pane's ↻ button (41): the command, then Enter. Result: toast +
 * TnaiLiveTasks.record. Pushed events only (agent:turn, context:changed, session changes); the only
 * timer is one idle-expiry timeout per pane. RETIRE (the notice's second choice, or "Without
 * asking: Retire and hand off"): the same gate, so its Project Context entry is the summary.
 * Technically Not starts a fresh agent of the same CLI and account on the retired one's model (46
 * TnaiLaunchPrefs.once), sends it a handoff (task + that entry + where to read more; it confirms
 * and waits), moves the composer's selection to it, then closes the old pane (its results stay in
 * `tnai context`). If the new agent can't start, the old one stays. SINCE 2026-10-14 (user: "Yes,
 * build all four"): every hand-off starts with a hand-off LETTER (the old agent is asked to write
 * one; that reply's entry is what the successor gets), the old agent STAYS OPEN and idle so the
 * successor can `tnai ask` it, and it closes only when the successor finishes a task after its
 * hand-off summary (the user answered it). The thread's "..." menu has "Hand off to a fresh agent"
 * (137 → handOff), at any size. Each step is pushed as
 * `tnai:handoff` (102 shows it on the Agent Tree row and keeps the Handoff history). Not offered
 * for delegated sub-agents (their lead manages them) or custom agents (a fresh one would lose its
 * setup). "Without asking: Compact" runs the command itself once the gate holds. SUMMARY FIRST
 * (`brief`, default on): before a command that runs without asking, the
 * agent gets one prompt to write down what must survive (what it is doing, decisions, changed
 * files, what is left, the next step); the command is typed when that reply has ended and its
 * result reached Project Context (or 15 s later). Typing into the panel, an interrupted reply or a
 * queued prompt cancels it. Costs one extra reply. Since 2026-10-14 it is also used for Run on the
 * bell and for a /compact typed in the prompt box (11 → compactNow), and once the command has run
 * the agent is sent that summary back (restoreLater/giveBack). A finished task with nothing left
 * to do, past half the compact size, is offered a hand-off (SOFT). THRESHOLDS: defaults suit Claude
 * Max-size (1M-token) windows: compact 400k, clear 600k, "never clear" on. Until the user sets a
 * threshold, its default is scaled to the pane's context window: 75% (compact) / 90% (clear) of it,
 * never above the default. Window = Codex's reported model_context_window; else 1M once the context
 * passed 200k; else 200k when the pane's Claude Code account plan is known and not
 * Max/Team/Enterprise (TnaiAccounts, 15) — a heuristic, as Claude Code does not report its window;
 * else unknown -> the full defaults. A threshold the user set is used as is. Stored: only the
 * user's own changes (v2). window.TnaiContextUpkeep (prefs, set, limits, pending, check, run,
 * retire, cancel).
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.agentTurns || !native.context || !native.pty || !agents) return;

  const STORE = 'tnai.context-upkeep.v2',
    OLD_STORE = 'tnai.context-upkeep.v1'; // per viewer; v2 holds only what the user changed
  const COMMANDS = {
    'Claude Code': { compact: '/compact', clear: '/clear' },
    Codex: { compact: '/compact', clear: '/new' },
    OpenCode: { compact: '/compact', clear: '/new' },
    // OpenCode: both are in its docs' TUI command list, its context size comes from its own record
    // (agent-turns.js `opencode-db`); not yet typed into a real panel (2026-10-06)
  };
  const DEFAULTS = {
    on: true,
    compact: 400000,
    clear: 600000,
    never: true,
    idle: 3,
    skip: [],
    auto: '',
    age: 2,
    handoff: 150000,
    brief: true,
  }; // auto: '' ask | 'compact' | 'retire'

  // HAND-OFF (usage): a session running `age` hours (since its panel
  // started; 0 = off) or at `handoff` tokens (0 = off), whichever comes first, is offered the same
  // notice below the compact threshold, with "Retire & hand off" as the main choice. Same gate
  // (idle, work saved, nothing open). "Not now" on such an offer snoozes it for SNOOZE, so it
  // doesn't ask after every turn.
  const SNOOZE = 60 * 60 * 1000;
  const OLD_DEFAULTS = {
    on: true,
    compact: 120000,
    clear: 160000,
    never: false,
    idle: 3,
    skip: [],
    auto: '',
  }; // v1 stored every key; equal to these = never changed

  // Claude Code: 150+ model requests since the last compact with 100k+ context also suggests
  // /compact
  const LONG = { calls: 150, tokens: 100000 };

  // A finished task with nothing left to do, past this share of the compact size, is offered a
  // hand-off: the cheapest moment to switch.
  const SOFT = 0.5;
  const SCALE = { compact: 0.75, clear: 0.9 },
    BIG_PLAN = /max|team|enterprise/i;
  const clamp = (v, lo, hi, d) => {
    const n = Math.round(+v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const k = n => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let user = {}; // only the keys the user changed
  try {
    const v2 = localStorage.getItem(STORE);
    if (v2) user = JSON.parse(v2) || {};
    else {
      const v1 = JSON.parse(localStorage.getItem(OLD_STORE) || 'null');
      if (v1) {
        for (const key of Object.keys(DEFAULTS))
          if (key in v1 && !same(v1[key], OLD_DEFAULTS[key])) user[key] = v1[key];
        localStorage.setItem(STORE, JSON.stringify(user));
        localStorage.removeItem(OLD_STORE);
      }
    }
  } catch {}
  let prefs = { ...DEFAULTS, ...user };
  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(user));
    } catch {}
  };
  const assign = patch => {
    for (const [key, v] of Object.entries(patch)) {
      if (!(key in DEFAULTS)) continue;
      if (same(v, DEFAULTS[key])) delete user[key];
      else user[key] = v;
    }
    prefs = { ...DEFAULTS, ...user };
  };

  const turns = new Map(); // paneId -> latest pushed turn

  // paneId:startedAt already acted on (run, cancelled or refused at send time)
  const handled = new Set();
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (id) for (const k of [...handled]) if (k.startsWith(id + ':')) handled.delete(k);
  });
  const idleTimers = new Map(); // paneId -> timeout for "idle long enough"
  const lastInput = new Map(); // paneId -> last time the user typed into that pane

  // paneId -> { key, cmd, kind, tokens, entryId, name, agent } waiting for the user's answer
  const pending = new Map();

  // paneId -> { at, cmd, kind, name, agent, tokens, turn, timer }: a summary was asked for; the
  // command runs when that reply ends
  const briefing = new Map();
  const snoozed = new Map(); // paneId -> time until which a hand-off-only offer is not repeated

  // paneId -> { b, entry, timer }: a command ran after a summary; the summary goes back to the
  // agent once the command has finished
  const restoring = new Map();

  // retired paneId -> { to, toName, name, since, summaryAt }: its successor took over; it stays
  // open for questions until the user answers the successor's hand-off summary
  const handingOver = new Map();
  let entries = [],
    marks = {},
    syncSettings = () => {};

  const keyOf = t => t.paneId + ':' + t.startedAt;
  const session = paneId => agents.sessions().find(s => s.paneId === paneId);
  const permissionOpen = () => !!document.querySelector('.tnai-perm:not([hidden])');
  const open = (e, kind) =>
    (e.summary?.[kind] || []).filter((_, i) => !marks[e.id + ':' + kind + ':' + i]);

  // The pane's context window: reported (Codex), inferred from size (> 200k means a 1M window), or
  // from a known non-Max Claude Code plan (200k); 0 = unknown.
  function windowOf(t, s) {
    const tokens = t?.context?.tokens || 0;
    if (t?.context?.window > 0) return t.context.window;
    if (tokens > 200000) return 1000000;
    if (t?.agent === 'Claude Code') {
      const plan =
        window.TnaiAccounts?.list?.()
          ?.find?.(d => d.agentId === t.agent)
          ?.accounts?.find(a => a.id === (s?.accountId || ''))?.status?.plan || '';
      if (plan && !BIG_PLAN.test(plan)) return 200000;
    }
    return 0;
  }

  // The thresholds in effect for a pane: the user's own value, else the default scaled to its
  // window (rounded to 10k).
  function limits(t, s) {
    const win = windowOf(t, s),
      out = { window: win };
    for (const key of ['compact', 'clear'])
      out[key] =
        key in user || !win
          ? prefs[key]
          : Math.min(DEFAULTS[key], Math.round((win * SCALE[key]) / 10000) * 10000);
    return out;
  }

  // The plan for a pane, or { why } when it must not act (why '' = nothing to do yet).
  function plan(paneId, now = Date.now()) {
    const t = turns.get(paneId);
    if (!prefs.on || !t) return { why: '' };
    const cmds = COMMANDS[t.agent];
    if (!cmds) return { why: t.agent + ' has no compact/clear command' };
    if (prefs.skip.includes(t.agent)) return { why: 'off for ' + t.agent };
    if (handingOver.has(paneId)) return { why: 'it is handing its work over' };
    if (!t.endedAt || t.endedBy !== 'stop') return { why: 'the agent is working' };
    if (handled.has(keyOf(t))) return { why: 'already handled this turn' };
    if (t.queued?.length) return { why: 'prompts are queued' };
    const s = session(paneId);
    if (!s?.running) return { why: 'not running' };
    const tokens = t.context?.tokens;
    if (!(tokens > 0)) return { why: 'context size unknown' };
    const lim = limits(t, s);

    // many requests, each re-sending the context: compact even below the size threshold
    const long = (t.context.calls || 0) >= LONG.calls && tokens >= LONG.tokens;
    const ageMs = s.startedAt ? now - s.startedAt : 0;
    const handoff =
      (prefs.age > 0 && ageMs >= prefs.age * 3600000) ||
      (prefs.handoff > 0 && tokens >= prefs.handoff);
    const due = tokens >= lim.compact || long || (!prefs.never && tokens >= lim.clear);

    // the best moment: past half the compact size, at a natural end (checked below, once its
    // result is known)
    const soft = tokens >= Math.round(lim.compact * SOFT);
    if (!due && !handoff && !soft) return { why: '' };
    if (!due && (snoozed.get(paneId) || 0) > now) return { why: '' };
    const e = entries
      .filter(x => x.paneId === paneId && +x.at >= t.endedAt)
      .sort((a, b) => b.at - a.at)[0];
    if (!e) return { why: 'Project Context has no entry for its last turn yet' };
    if (!due && !handoff && open(e, 'next').length + open(e, 'remains').length) return { why: '' };
    if (open(e, 'blockers').length) return { why: 'its last result has open blockers' };
    if (window.TnaiContext?.openChoice?.(e, key => marks[key]))
      return { why: 'a decision is waiting on you' };
    if (permissionOpen()) return { why: 'a permission prompt is open' };
    const quietSince = Math.max(t.endedAt, lastInput.get(paneId) || 0),
      wait = quietSince + prefs.idle * 60000 - now;
    if (wait > 0) return { why: 'idle', wait };
    const kind =
      !prefs.never && tokens >= lim.clear && !open(e, 'next').length ? 'clear' : 'compact';
    const retire =
      !!window.TnaiTeam && !s.customAgentId && !window.TnaiGraph?.node?.(paneId)?.parentId;
    return {
      why: '',
      kind,
      cmd: cmds[kind],
      tokens,
      entryId: e.id,
      key: keyOf(t),
      name: s.name,
      agent: t.agent,
      retire,
      task: t.task || '',
      handoff: !due,
      ageMs,
    };
  }

  function check(paneId) {
    clearTimeout(idleTimers.get(paneId));
    idleTimers.delete(paneId);
    const p = plan(paneId),
      cur = pending.get(paneId);

    // no longer applies, or settings changed the command: ask again for the new one
    if (cur && (p.why || p.key !== cur.key || p.cmd !== cur.cmd)) stop(paneId);
    if (p.why === 'idle') {
      idleTimers.set(
        paneId,
        setTimeout(() => check(paneId), p.wait + 50)
      );
      return;
    }
    if (p.why || !p.cmd || pending.has(paneId) || briefing.has(paneId)) return render();
    pending.set(paneId, p);
    render();
    if (prefs.auto === 'retire' && p.retire) retire(paneId, 'auto');
    else if (prefs.auto) (prefs.brief ? brief : run)(paneId);
  }
  const checkAll = () => {
    for (const paneId of new Set([...turns.keys(), ...pending.keys()])) check(paneId);
  };

  function stop(paneId) {
    pending.delete(paneId);
    render();
  }

  // Runs the command the user chose: the gate is checked again first (the agent may have started
  // something meanwhile).
  function run(paneId) {
    const cur = pending.get(paneId);
    if (!cur) return false;
    stop(paneId);
    const p = plan(paneId);
    handled.add(cur.key);
    if (p.why || p.key !== cur.key) {
      say('Context upkeep for ' + cur.name + ' skipped: ' + (p.why || 'a new turn started') + '.');
      return false;
    }
    native.pty.submit(paneId, p.cmd, { paste: false }).catch(() => {});
    const verb = p.kind === 'clear' ? 'Cleared' : 'Compacted';
    const msg =
      verb +
      ' ' +
      p.name +
      ' at ' +
      k(p.tokens) +
      ' tokens (Project Context up to date: result ' +
      p.entryId +
      ')';
    say(msg);
    window.TnaiLiveTasks?.record?.(paneId, msg + ' · ' + p.cmd, p.name + ' (' + p.agent + ')');
    return true;
  }

  // Summary first: asks the agent to write down what must survive, then types the command when that
  // reply has ended (see the header).
  const BRIEF_START = 120000,
    // the reply must start within 2 min; after it ends, wait up to 15 s for its Project Context
    // entry
    BRIEF_SAVED = 15000;

  function dropBrief(paneId, why) {
    const b = briefing.get(paneId);
    if (!b) return;
    clearTimeout(b.timer);
    briefing.delete(paneId);
    if (why) say(jobName(b) + ' cancelled: ' + why + '.');
  }
  const jobName = b => (b.then === 'retire' ? 'Hand-off of ' + b.name : b.cmd + ' for ' + b.name);

  function brief(paneId) {
    const cur = pending.get(paneId);
    if (!cur) return false;
    stop(paneId);
    const p = plan(paneId);
    handled.add(cur.key);
    if (p.why || p.key !== cur.key) {
      say('Context upkeep for ' + cur.name + ' skipped: ' + (p.why || 'a new turn started') + '.');
      return false;
    }
    return ask(paneId, {
      then: 'command',
      cmd: p.cmd,
      kind: p.kind,
      name: p.name,
      agent: p.agent,
      tokens: p.tokens,
    });
  }

  // What must survive, in the agent's own words. `then` is what follows the reply: 'command' types
  // the CLI's command, 'retire' starts the successor (the reply is its hand-off letter).
  const WHAT_TO_WRITE =
    'what you are working on and why, the decisions and user instructions still in force, the files you changed, what is finished, what is left, and the exact next step. ' +
    'If anything important exists only in this conversation (open work, findings, a plan), save it now to the project file where it belongs. ' +
    'Start no new work and ask nothing. Keep it short and end with your Technically Not report.';

  function askText(job) {
    const size = job.tokens > 0 ? 'Your context is at ' + k(job.tokens) + ' tokens, so ' : '';
    if (job.then === 'retire')
      return (
        '[TN.ai] ' +
        size +
        'Technically Not hands your work to a fresh ' +
        job.agent +
        ' agent right after this reply. Write a hand-off letter for it: ' +
        WHAT_TO_WRITE +
        ' After this reply your successor may ask you questions with `tnai ask`: answer each with one `tnai send` to it, and start no other work.'
      );
    return (
      '[TN.ai] ' +
      (size || 'You asked for ' + job.cmd + ', so ') +
      'Technically Not will run ' +
      job.cmd +
      ' in this session right after this reply, and give you your summary back once it has run. ' +
      'Before that, write down what must survive it: ' +
      WHAT_TO_WRITE
    );
  }

  function ask(paneId, job) {
    const b = { ...job, at: Date.now(), turn: null, timer: 0 };
    if (!agents.send(paneId, askText(job))) {
      say(
        (job.then === 'retire' ? 'Hand-off of ' : job.cmd + ' for ') +
          job.name +
          ' skipped: it is not running.'
      );
      return false;
    }
    b.timer = setTimeout(() => {
      if (briefing.get(paneId) === b && !b.turn) dropBrief(paneId, 'it did not start its summary');
    }, BRIEF_START);
    briefing.set(paneId, b);
    say(
      job.then === 'retire'
        ? 'Asked ' + job.name + ' to write its hand-off letter; a fresh agent takes over after it.'
        : 'Asked ' + job.name + ' to write its summary, then ' + job.cmd + ' runs.'
    );
    return true;
  }

  // A /compact the user typed in the prompt box: the same summary first, and the summary back after
  // it. false = not taken (the prompt is sent as typed).
  function compactNow(paneId, typed) {
    const s = session(paneId),
      t = turns.get(paneId);
    if (!prefs.brief || !s?.running || !COMMANDS[agentOf(t, s)]) return false;
    if (busy(paneId) || s.status === 'working' || s.status === 'starting') return false;
    if (t && !t.endedAt) return false;
    stop(paneId);
    if (t?.endedAt) handled.add(keyOf(t));
    return ask(paneId, {
      then: 'command',
      cmd: typed,
      kind: 'compact',
      name: s.name,
      agent: agentOf(t, s),
      tokens: t?.context?.tokens || 0,
    });
  }

  // the CLI as its turns report it, else as the session names it
  const agentOf = (t, s) => t?.agent || s?.agent || '';
  const busy = paneId => briefing.has(paneId) || retiring.has(paneId) || handingOver.has(paneId);

  // The summary reply for a pane ended (or its Project Context entry arrived): type the command
  // once the summary is saved, or after BRIEF_SAVED.
  function afterBrief(paneId) {
    const b = briefing.get(paneId),
      t = b?.turn;
    if (!t?.endedAt) return;
    const entry = entries
        .filter(x => x.paneId === paneId && +x.at >= t.endedAt)
        .sort((x, y) => y.at - x.at)[0],
      saved = !!entry,
      left = t.endedAt + BRIEF_SAVED - Date.now();
    clearTimeout(b.timer);
    if (!saved && left > 0) {
      b.timer = setTimeout(() => afterBrief(paneId), left + 50);
      return;
    }
    briefing.delete(paneId);
    const s = session(paneId),
      why = !s?.running
        ? 'it is not running'
        : permissionOpen()
          ? 'a permission prompt is open'
          : turns.get(paneId) !== t
            ? 'a new turn started'
            : '';
    if (why) {
      say(jobName(b) + ' cancelled: ' + why + '.');
      return;
    }

    // the letter is written: the successor starts with it (an older result when it was not saved)
    if (b.then === 'retire') {
      const letter =
        entry || entries.filter(x => x.paneId === paneId).sort((x, y) => y.at - x.at)[0] || null;
      takeOver(paneId, b, letter).catch(() => {});
      return;
    }
    native.pty.submit(paneId, b.cmd, { paste: false }).catch(() => {});
    if (entry) restoreLater(paneId, b, entry);
    const msg =
      (b.kind === 'clear' ? 'Cleared ' : 'Compacted ') +
      b.name +
      ' at ' +
      k(b.tokens) +
      ' tokens after it wrote its summary' +
      (saved ? ' (saved in Project Context)' : '');
    say(msg);
    window.TnaiLiveTasks?.record?.(paneId, msg + ' · ' + b.cmd, b.name + ' (' + b.agent + ')');
  }

  // After the command: the summary goes back to the agent once its context has shrunk (Claude Code
  // reports the size after a /compact), or after RESTORE_WAIT for a CLI that does not report it
  // (a /clear or /new is done at once).
  const RESTORE_WAIT = 120000,
    RESTORE_CLEAR = 3000;

  function restoreLater(paneId, b, entry) {
    const r = { b, entry, timer: 0 };
    r.timer = setTimeout(() => giveBack(paneId), b.kind === 'clear' ? RESTORE_CLEAR : RESTORE_WAIT);
    restoring.set(paneId, r);
  }

  // A pushed turn shows the command has run: the size dropped well below what it was.
  function restoreTurn(t) {
    const r = restoring.get(t.paneId);
    if (!r) return;
    const now = t.context?.tokens || 0;
    if (t.cleared || (r.b.tokens > 0 && now > 0 && now < r.b.tokens * 0.6)) giveBack(t.paneId);
  }

  function giveBack(paneId) {
    const r = restoring.get(paneId);
    if (!r) return;
    clearTimeout(r.timer);
    restoring.delete(paneId);
    if (!session(paneId)?.running) return;
    const sum = summaryOf(r.entry);
    agents.send(
      paneId,
      '[TN.ai] ' +
        r.b.cmd +
        ' has run in this session. Before it you wrote down what must survive; here it is again so it stays in your context. ' +
        (sum ? sum + '. ' : '') +
        'Your full note: `tnai context show ' +
        r.entry.id +
        '`; read it now if you need more detail. Then reply with one short line saying where you stand, and start no new work.'
    );
    const msg = 'Gave ' + r.b.name + ' its summary back after ' + r.b.cmd;
    say(msg);
    window.TnaiLiveTasks?.record?.(paneId, msg, r.b.name + ' (' + r.b.agent + ')');
  }
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const r = restoring.get(e.detail?.paneId);
    if (!r) return;
    clearTimeout(r.timer);
    restoring.delete(e.detail.paneId);
  });

  // A result's summary in one line: what it did, what is left, the next steps, what blocks it.
  const clip = (text, n) => (text.length > n ? text.slice(0, n - 1) + '…' : text);

  function summaryOf(entry) {
    const s = entry?.summary || {};
    return ['did', 'remains', 'next', 'blockers']
      .filter(x => s[x]?.length)
      .map(
        x =>
          x[0].toUpperCase() +
          x.slice(1) +
          ': ' +
          s[x]
            .slice(0, 3)
            .map(v => clip(String(v), 200))
            .join(' / ')
      )
      .join(' · ');
  }

  // A pushed turn while a summary is awaited: true = it was the summary reply and is dealt with
  // here.
  function briefTurn(t) {
    const b = briefing.get(t.paneId);
    if (!b || t.startedAt < b.at - 1000) return false;
    if (!t.endedAt) {
      b.turn = b.turn || t;
      return false;
    }
    handled.add(keyOf(t)); // its own end is never a new offer
    if (t.endedBy !== 'stop') {
      dropBrief(t.paneId, 'its summary was interrupted');
      return true;
    }
    if (t.queued?.length) {
      dropBrief(t.paneId, 'prompts are queued');
      return true;
    }
    b.turn = t;
    return true;
  }
  window.addEventListener('tnai:terminal-pane-closed', e => dropBrief(e.detail?.paneId, ''));

  // Retires the agent: it writes a hand-off letter first, a fresh one of the same CLI/account takes
  // over with it, and the old one stays open for the successor's questions until the user answers
  // the successor's hand-off summary; then it closes.
  const retiring = new Set();

  // Each real step is also pushed as `tnai:handoff` { phase: start | started | done | failed,
  // paneId, ... } for the Agent Tree status and the Handoff history (102).
  const tell = (phase, d) => {
    try {
      window.dispatchEvent(new CustomEvent('tnai:handoff', { detail: { phase, ...d } }));
    } catch {}
  };

  // From the bell (Retire & hand off) or "Without asking: Retire".
  function retire(paneId, how) {
    const cur = pending.get(paneId);
    if (!cur || busy(paneId)) return false;
    stop(paneId);
    const p = plan(paneId); // before marking it handled, which the plan would refuse
    handled.add(cur.key);
    if (p.why || p.key !== cur.key || !p.retire) {
      say(
        'Retiring ' +
          cur.name +
          ' skipped: ' +
          (p.why || (p.retire ? 'a new turn started' : 'it is a sub-agent or custom agent')) +
          '.'
      );
      return false;
    }
    const lim = limits(turns.get(paneId), session(paneId)),
      calls = turns.get(paneId)?.context?.calls || 0;
    const reason =
      how !== 'auto'
        ? { kind: 'manual' }
        : p.tokens >= lim.compact
          ? { kind: 'context', n: lim.compact }
          : !p.handoff
            ? { kind: 'requests', n: calls || null }
            : prefs.handoff > 0 && p.tokens >= prefs.handoff
              ? { kind: 'context', n: prefs.handoff }
              : { kind: 'age', n: prefs.age };
    return letterFirst(paneId, {
      name: p.name,
      agent: p.agent,
      tokens: p.tokens,
      task: p.task,
      reason,
    });
  }

  // Why this thread cannot be handed off now ('' = it can): the "..." menu's "Hand off to a fresh
  // agent" (137), at any size.
  function handOffWhy(paneId) {
    const s = session(paneId),
      t = turns.get(paneId);
    if (!s?.running) return 'it is not running';
    if (!agentOf(t, s) || agentOf(t, s) === 'Terminal')
      return 'a plain terminal has no agent to hand off';
    if (!window.TnaiTeam) return 'agents cannot be started here';
    if (s.customAgentId) return 'a fresh custom agent would lose its setup';
    if (window.TnaiGraph?.node?.(paneId)?.parentId) return 'its lead manages this sub-agent';
    if (busy(paneId)) return 'a hand-off or summary is already under way';
    if (s.status === 'working' || s.status === 'starting' || (t && !t.endedAt))
      return 'it is working; hand it off when its task ends';
    return '';
  }

  function handOff(paneId) {
    const why = handOffWhy(paneId);
    if (why) {
      say('Not handing off: ' + why + '.');
      return false;
    }
    const s = session(paneId),
      t = turns.get(paneId);
    stop(paneId);
    if (t?.endedAt) handled.add(keyOf(t));
    return letterFirst(paneId, {
      name: s.name,
      agent: agentOf(t, s),
      tokens: t?.context?.tokens || 0,
      task: t?.task || '',
      reason: { kind: 'manual' },
    });
  }

  // The letter is asked for only when there is room for a successor, so no reply is spent on a
  // hand-off that cannot happen.
  function letterFirst(paneId, job) {
    if (window.TnaiPaneLimit?.full?.()) {
      say(
        'Not handing off ' +
          job.name +
          ': this workspace is full, so there is no room for its successor. Close a thread, or use /compact.'
      );
      return false;
    }
    return ask(paneId, { ...job, then: 'retire' });
  }

  // The letter is written (or `letter` is its latest older result): start the successor.
  async function takeOver(paneId, b, letter) {
    if (retiring.has(paneId)) return false;
    const old = session(paneId);
    const pick0 = window.TnaiLaunchPrefs?.pane(paneId, b.agent);
    tell('start', {
      paneId,
      name: b.name,
      agent: b.agent,
      accountId: old?.accountId ?? '',
      sessionStartedAt: old?.startedAt || 0,
      model: pick0?.model || turns.get(paneId)?.model || '',
      tokens: b.tokens,
      task: b.task,
      entryId: letter?.id || '',
      entry: letter,
      reason: b.reason,
    });
    if (window.TnaiPaneLimit?.full?.()) {
      say(
        'Retiring ' +
          b.name +
          ' skipped: this workspace is full, so there is no room for its successor. Close a thread, or use /compact.'
      );
      tell('failed', {
        paneId,
        error: 'This workspace is full, so there was no room for its successor.',
      });
      return false;
    }
    retiring.add(paneId);
    let told = false;
    try {
      say('Starting a fresh ' + b.agent + ' to take over from ' + b.name + '…');
      const pick = window.TnaiLaunchPrefs?.pane(paneId, b.agent);
      window.TnaiLaunchPrefs?.once(b.agent, {
        model: pick?.model || turns.get(paneId)?.model || '',
        effort: pick?.effort || '',
      });
      const next = await window.TnaiTeam.startLead({
        agent: b.agent,
        accountId: old?.accountId ?? undefined,
      });
      window.TnaiLaunchPrefs?.once(b.agent, null);
      if (!next?.paneId) {
        say(
          'Could not hand off ' +
            b.name +
            ': ' +
            (next?.error || 'its successor could not start') +
            '. It keeps working as before.'
        );
        told = true;
        tell('failed', { paneId, error: next?.error || 'Its successor could not start.' });
        return false;
      }
      tell('started', { paneId, to: { paneId: next.paneId, name: next.name || '' } });
      const sum = summaryOf(letter);
      const why =
        b.reason?.kind === 'manual'
          ? ', which the user handed off'
          : ', which Technically Not retired at ' + k(b.tokens) + ' tokens of context';
      agents.send(
        next.paneId,
        '[TN.ai handoff: you take over from ' +
          b.name +
          ' (' +
          b.agent +
          ')' +
          why +
          ' so the work continues in a fresh context. ' +
          (b.task ? 'Its last task: "' + clip(b.task, 240) + '". ' : '') +
          (sum ? 'Its hand-off letter: ' + sum + '. ' : '') +
          (letter ? 'Full letter: `tnai context show ' + letter.id + '`; ' : '') +
          'its terminal history: `tnai read ' +
          b.name +
          '`. ' +
          // the two talk: the old one stays open and idle until the user answers below
          b.name +
          ' stays open until the user confirms your summary: when its letter leaves out something you need, ask it with `tnai ask ' +
          b.name +
          ' QUESTION` (only what the letter does not say, at most a few questions). ' +
          // The successor tells the user what it took over and waits for a yes:
          // the report's Decide line shows as a decision.
          'Read the full letter now. Then reply with a short summary of what you took over under the headings "Done:", "Where we stopped:" and "Still open:", and end with a Technically Not report whose last line is "- Decide: Is this hand-off summary right? | 1. Yes, carry on (recommended) | 2. No, I will correct it". Start no work until the user answers.]'
      );
      handingOver.set(paneId, {
        to: next.paneId,
        toName: next.name || '',
        name: b.name,
        since: Date.now(),
        summaryAt: 0,
      });
      if (window.TnaiLiveTasks?.target?.() === paneId) window.TnaiLiveTasks.setTarget(next.paneId);
      const msg =
        next.name +
        ' took over from ' +
        b.name +
        (letter ? ' with its hand-off letter (result ' + letter.id + ')' : '') +
        '; ' +
        b.name +
        ' stays open for its questions until you confirm the summary';
      window.TnaiLiveTasks?.record?.(next.paneId, msg, next.name + ' (' + b.agent + ')');
      told = true;
      tell('done', { paneId, to: { paneId: next.paneId, name: next.name || '' } });
      say(msg);
      return true;
    } catch (err) {
      if (!told) {
        told = true;
        tell('failed', {
          paneId,
          error: String(err?.message || err || 'The handoff stopped with an error.'),
        });
      }
      throw err;
    } finally {
      retiring.delete(paneId);
    }
  }

  // The successor wrote its summary (its first result) and then finished another task: the user has
  // answered it, so the old agent's part is over. `tnai send` to it now goes to its successor, and
  // its thread closes (its results stay in `tnai context`).
  function handOverTurn(t) {
    for (const [oldPane, h] of handingOver) {
      if (h.to !== t.paneId || !t.endedAt || !h.summaryAt || t.startedAt <= h.summaryAt) continue;
      finishHandOver(oldPane);
    }
  }

  function noteSummaries() {
    for (const h of handingOver.values()) {
      if (h.summaryAt) continue;
      const first = entries
        .filter(x => x.paneId === h.to && +x.at >= h.since)
        .sort((x, y) => x.at - y.at)[0];
      if (first) h.summaryAt = +first.at;
    }
  }

  function finishHandOver(oldPane) {
    const h = handingOver.get(oldPane);
    if (!h) return;
    handingOver.delete(oldPane);
    native.lifecycle?.retire?.(oldPane, h.to)?.catch?.(() => {});
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' +
          CSS.escape(oldPane) +
          '"] .terminal-pane-tools button[title="Close terminal"]'
      )
      ?.click();
    say('Closed ' + h.name + ': ' + (h.toName || 'its successor') + ' has taken over.');
  }

  // Either thread closed by hand: a closed old one still sends its messages on; a closed successor
  // leaves the old one as it is, open, and no longer handing over.
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (!id) return;
    const h = handingOver.get(id);
    if (h) {
      handingOver.delete(id);
      native.lifecycle?.retire?.(id, h.to)?.catch?.(() => {});
    }
    for (const [oldPane, other] of handingOver) if (other.to === id) handingOver.delete(oldPane);
  });

  function cancel(paneId) {
    const cur = pending.get(paneId);
    if (!cur) return false;
    handled.add(cur.key);
    stop(paneId);
    if (cur.handoff) {
      snoozed.set(paneId, Date.now() + SNOOZE);
      say('Not handing off ' + cur.name + ' now · asking again in an hour.');
      return true;
    }
    say('Not running ' + cur.cmd + ' for ' + cur.name + ' this turn.');
    return true;
  }

  // The offer: one bell item per pane waiting for the user's answer (no
  // floating box above the composer). It stays open in the bell with its buttons (Retire & hand
  // off, Run /compact); ✕ is Not now. It leaves the bell the moment it no longer applies (answered
  // here or in the terminal, a new turn, typing into the pane). 51's TnaiNextActions.notify /
  // unnotify.
  const offered = new Set(); // bell keys this file has up

  function render() {
    const bell = window.TnaiNextActions;
    if (!bell?.notify) return;
    const hrs = ms => {
      const m = Math.round(ms / 60000);
      return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
    };
    const RETIRE_TIP =
      'A fresh agent takes over with this one’s Project Context summary, then this one closes';
    const live = new Set();
    for (const [paneId, p] of pending) {
      const key = 'upkeep:' + paneId,
        lead = p.handoff && p.retire;
      live.add(key);
      offered.add(key);
      const retireAct = {
        id: 'retire',
        label: 'Retire & hand off',
        title: RETIRE_TIP,
        run: () => retire(paneId),
      };

      // with Summarize first on, the agent writes its summary before the command and gets it back
      // after
      const nowAct = {
        id: 'now',
        label: 'Run ' + p.cmd,
        run: () => (prefs.brief ? brief : run)(paneId),
      };
      bell.notify({
        key,
        source: p.agent,
        k: 'next',
        open: true,
        tag: lead ? 'Hand off?' : p.cmd + '?',
        title: p.handoff
          ? p.name + ' has run ' + hrs(p.ageMs) + ' · ' + k(p.tokens) + ' tokens in context'
          : p.name + ' has ' + k(p.tokens) + ' tokens in context',
        text:
          (lead
            ? 'Hand off to a fresh agent? Long sessions re-send more with every message; a fresh agent continues from its summary.'
            : p.kind === 'clear'
              ? 'Run ' + p.cmd + '? Its next steps are done, so it can start fresh.'
              : 'Run ' + p.cmd + '? It summarizes the conversation so far.') +
          ' Project Context up to date (result ' +
          p.entryId +
          '). ✕ = Not now.',
        actions: lead
          ? [{ ...retireAct, primary: true }, nowAct]
          : [{ ...nowAct, primary: true }].concat(p.retire ? [retireAct] : []),
        onRemove: () => cancel(paneId),
      });
    }
    for (const key of [...offered])
      if (!live.has(key)) {
        offered.delete(key);
        bell.unnotify(key);
      }
  }

  // Typing into a pane means the user is talking to it: restart its idle wait and put the question
  // away until it is idle again.
  const typed = e => {
    const paneId = e.target.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId;
    if (!paneId) return;
    lastInput.set(paneId, Date.now());
    if (pending.has(paneId)) stop(paneId);
    if (briefing.has(paneId)) dropBrief(paneId, 'you typed in its panel');
    if (turns.has(paneId)) check(paneId);
  };
  document.addEventListener('keydown', typed, true);
  document.addEventListener('paste', typed, true);

  // Settings › Agents (column B). Short help on each row; the full rule is in the help's hover
  // title.
  const mount =
    document.getElementById('agentsColB') || document.getElementById('settingsPanel-agents');
  if (mount) {
    const set = document.createElement('section');
    set.className = 'set-group tnai-upkeep-set';
    const help = (h, tip) => (h ? `<small${tip ? ` title="${esc(tip)}"` : ''}>${h}</small>` : '');
    const row = (text, h, control, tip = '') =>
      `<label class="set-row"><span class="set-text"><b>${text}</b>${help(h, tip)}</span>${control}</label>`;
    const num = (k, lo, hi, step, unit) =>
      `<span class="set-ctl"><input type="number" class="set-input set-num" min="${lo}" max="${hi}"${step ? ` step="${step}"` : ''} data-k="${k}"><em>${unit}</em></span>`;
    set.innerHTML = `<header class="set-group-head"><div><h3>Agent context</h3><p title="Long conversations use more of each request. Technically Not offers the agent CLI's own /compact (or /clear; Codex and OpenCode: /new) for an idle agent whose context grew large — only after Project Context holds what its last turn did (no open blockers or decisions), nothing is queued, no permission prompt is open, and you haven't typed in its panel for a while. Not now skips that turn. Context size is read from the CLI's own session files; when it is unknown, nothing is offered.">Keep long agent conversations small and cheap.</p></div></header>
<div class="set-card">
${row('Suggest compacting large context', 'Asks first, once the agent is idle and its work is saved.', '<input type="checkbox" class="set-switch" data-k="on">')}
<div class="u-nums set-sub">
${row('Compact at', 'Scales to smaller context windows until you change it.', num('compact', 10000, 2000000, 10000, 'tokens'), 'The defaults suit Claude Max’s 1M-token context; until you change them they scale to smaller windows (75% / 90% of it, so a 200k window compacts at 150k).')}
${row('Never clear, only compact', '', '<input type="checkbox" class="set-switch" data-k="never">')}
${row('Clear at', 'Once its next steps are done or sent.', num('clear', 10000, 2000000, 10000, 'tokens'), 'Clears when its next steps are done or sent; otherwise it compacts.')}
${row('Ask after the agent is idle for', '', num('idle', 0, 120, 0, 'minutes'))}
${row('Offer a hand-off after', '0 = off. Counted from when its thread started.', num('age', 0, 24, 0, 'hours'), 'A session this old is offered Retire & hand off (a fresh agent continues from its summary) after its current task, even below the compact size.')}
${row('or at', '0 = off. Whichever comes first.', num('handoff', 0, 2000000, 10000, 'tokens'))}
<div class="set-row"><span class="set-text"><b>Without asking</b><small title="Retire and hand off: a fresh agent of the same CLI takes over with the old one’s Project Context summary, then the old thread closes.">Retire hands off to a fresh agent. Only Claude Code, Codex and OpenCode report their context, so only they are handed off.</small></span><span class="set-seg set-seg-sm" role="radiogroup" aria-label="Without asking">${[
      ['', 'Off'],
      ['compact', 'Compact'],
      ['retire', 'Retire'],
    ]
      .map(
        ([v, l]) =>
          `<label><input type="radio" name="u-auto" data-k="auto" value="${v}">${l}</label>`
      )
      .join('')}</span></div>
${row('Summarize first', 'Before every compact, the agent writes down what matters and gets it back after. Two short extra replies.', '<input type="checkbox" class="set-switch" data-k="brief">', 'For Run on the bell, Without asking: Compact, and a /compact typed in the prompt box. The agent is asked to write what it is doing, its decisions, changed files, what is left and the next step, and to save open work to the project. The command runs when that reply has ended, and once it has run the agent is given that summary back. Typing in its thread cancels it. A hand-off always starts with a letter like this.')}
<div class="set-row u-clis"><span class="set-text"><b>Use it for</b><small>Only these CLIs support it.</small></span><span class="set-chips">${Object.keys(
      COMMANDS
    )
      .map(
        n => `<label class="set-chip"><input type="checkbox" data-cli="${esc(n)}">${esc(n)}</label>`
      )
      .join('')}</span></div>
</div>
</div>`;
    const sync = () => {
      set.querySelector('[data-k=on]').checked = !!prefs.on;
      set.querySelector('[data-k=never]').checked = !!prefs.never;
      {
        const b = set.querySelector('[data-k=brief]');
        b.checked = !!prefs.brief;
        b.disabled = !prefs.on;
      }
      for (const key of ['compact', 'clear', 'idle', 'age', 'handoff'])
        set.querySelector(`[data-k=${key}]`).value = prefs[key];
      set.querySelectorAll('[data-k=auto]').forEach(r => {
        r.checked = r.value === (prefs.auto || '');
      });
      set.querySelector('[data-k=clear]').disabled = !!prefs.never;
      set
        .querySelector('[data-k=clear]')
        .closest('.set-row')
        .classList.toggle('off', !!prefs.never);
      set.querySelectorAll('[data-cli]').forEach(c => {
        c.checked = !prefs.skip.includes(c.dataset.cli);
      });
      set.querySelector('.u-nums').classList.toggle('off', !prefs.on);
    };
    set.addEventListener('change', e => {
      const t = e.target,
        key = t.dataset.k;
      if (key === 'on' || key === 'never' || key === 'brief') assign({ [key]: t.checked });
      else if (key === 'compact' || key === 'clear')
        assign({ [key]: clamp(t.value, 10000, 2000000, DEFAULTS[key]) });
      else if (key === 'idle') assign({ idle: clamp(t.value, 0, 120, DEFAULTS.idle) });
      else if (key === 'age') assign({ age: clamp(t.value, 0, 24, DEFAULTS.age) });
      else if (key === 'handoff') assign({ handoff: clamp(t.value, 0, 2000000, DEFAULTS.handoff) });
      else if (key === 'auto')
        assign({ auto: ['compact', 'retire'].includes(t.value) ? t.value : '' });
      else if (t.dataset.cli)
        assign({
          skip: Object.keys(COMMANDS).filter(c => !set.querySelector(`[data-cli="${c}"]`).checked),
        });
      save();
      sync();
      checkAll();
    });
    sync();
    mount.prepend(set);
    syncSettings = sync;
  }

  // Pushed inputs.
  function onTurn(t) {
    if (!t?.paneId) return;
    restoreTurn(t);
    handOverTurn(t);
    if (t.cleared) {
      turns.delete(t.paneId);
      stop(t.paneId);
      clearTimeout(idleTimers.get(t.paneId));
      idleTimers.delete(t.paneId);
      return;
    }
    const summary = briefTurn(t);
    turns.set(t.paneId, t);
    if (summary) afterBrief(t.paneId);
    else check(t.paneId);
  }

  async function refresh() {
    try {
      const st = (await (window.TnaiContextState?.() ?? native.context.state())) || {};

      /* shared, debounced read (49) */ entries = st.entries || [];
      marks = st.marks || {};
    } catch {
      return;
    }
    noteSummaries();
    for (const paneId of [...briefing.keys()]) afterBrief(paneId);
    checkAll();
  }
  native.agentTurns.on(onTurn);
  native.agentTurns
    .state()
    .then(list =>
      (list || []).forEach(t => {
        if (t?.endedAt) handled.add(keyOf(t));
        onTurn(t);
      })
    )
    .catch(() => {}); // turns finished before this window loaded are not acted on
  native.context.onChange(refresh);

  // a prompt opening or closing (45 paints its card first)
  native.permissions?.on?.(() => setTimeout(checkAll, 0));
  agents.onChange?.(() => {
    for (const paneId of pending.keys()) if (!session(paneId)?.running) check(paneId);
  });
  refresh();

  window.TnaiContextUpkeep = {
    prefs: () => ({ ...prefs, skip: [...prefs.skip] }),
    set(patch) {
      assign(patch);
      save();
      syncSettings();
      checkAll();
    },
    limits: paneId => limits(turns.get(paneId), session(paneId)),
    pending: () =>
      [...pending.entries()].map(([paneId, p]) => ({
        paneId,
        kind: p.kind,
        cmd: p.cmd,
        tokens: p.tokens,
        entryId: p.entryId,
        handoff: !!p.handoff,
      })),
    check: paneId => {
      if (paneId) check(paneId);
      else checkAll();
      return plan(paneId || '').why;
    },
    why: paneId => plan(paneId).why,
    run,
    retire,
    cancel,
    handOff,
    handOffWhy,
    compactNow,
    handingOver: () =>
      [...handingOver.entries()].map(([paneId, h]) => ({
        paneId,
        to: h.to,
        summaryAt: h.summaryAt,
      })),
    briefing: () =>
      [...briefing.entries()].map(([paneId, b]) => ({
        paneId,
        cmd: b.cmd,
        tokens: b.tokens,
        replied: !!b.turn?.endedAt,
      })),
  };
})();
