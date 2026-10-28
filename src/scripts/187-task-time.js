/*
 * Technically Not · 187-task-time.js — where a task's time went and what it cost, in the
 * "Worked for" block that ends the task (user 2026-10-28, mock
 * docs/plans/design-concepts/thread-visuals.html, ideas 2 and 3 of
 * docs/notes/thread-visuals-ideas-2026-10-28.md).
 *
 * - A thin bar under the block's top line splits the task's time by kind of step (reading,
 *   editing, running commands, helpers, waiting for you, other tools, and the agent's own thinking
 *   and writing in between), with the kind that took the most in words beside it. Hover a part:
 *   its time, its share and its slowest step. A press opens that step beside the thread (181,
 *   through a press on its line).
 * - "84k tokens" in the block's top line: the task's tokens, with input, output, cache and, for a
 *   task that just ended, its share of the plan's shortest window on hover. The share is left out
 *   when another thread on the same account may have worked during the task.
 *
 * Real data only. A step's time runs from its action to its result, both as the tool's own record
 * dates them (desktop/thread-log-*.js): Claude Code, OpenCode and Copilot CLI date both; Codex
 * dates a step only when it is done and Cursor Agent dates nothing, so those tasks get no bar.
 * Tokens come from the record (Claude Code writes them on every request) or, for the task that
 * just ended in any CLI, from 42 `TnaiTurns`. Hooks in 122: `note` for every entry, `block` when
 * the "Worked for" block is built. The pure parts (`split`, `cost`) are tested by
 * tools/task-time-test.js.
 */
(() => {
  // ---------- the pure part: entries in, numbers out ----------

  // The kinds, in the order they stand in the bar, with what the tip calls them.
  const KINDS = [
    ['read', 'Reading and searching'],
    ['edit', 'Editing'],
    ['run', 'Running commands'],
    ['helper', 'Helpers'],
    ['you', 'Waiting for you'],
    ['other', 'Other tools'],
    ['write', 'Thinking and writing'],
  ];
  const NAMES = Object.fromEntries(KINDS);

  // When two steps run at the same time, the time goes to the one first in this list.
  const FIRST = ['you', 'helper', 'run', 'edit', 'read', 'other'];

  // Every reader names a step with the same verbs (desktop/thread-log-*.js).
  const VERB_KINDS = {
    Read: 'read',
    'Read the skill': 'read',
    'Used the skill': 'read',
    'Searched for': 'read',
    'Looked for files': 'read',
    'Searched the web for': 'read',
    Opened: 'read',
    'Looked at': 'read',
    Listed: 'read',
    Edited: 'edit',
    Wrote: 'edit',
    Deleted: 'edit',
    Ran: 'run',
    'Typed into a command': 'run',
    'Started a sub-agent': 'helper',
    'Started a workflow': 'helper',
  };

  const kindOf = entry => (entry.kind === 'ask' ? 'you' : VERB_KINDS[entry.verb] || 'other');
  const isTime = value => Number.isFinite(value) && value > 0;

  // One task's entries (from its prompt to its "worked" entry) → { start, end, parts } with one
  // part per kind that took time ({ kind, ms, slowest: { id, what, ms } }), or null when the
  // record does not date every step from start to end.
  function split(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const worked = [...list].reverse().find(entry => entry.kind === 'worked');
    if (!worked || !isTime(worked.at)) return null;
    const prompt = list.find(entry => entry.kind === 'you' && isTime(entry.at));
    const start = prompt
      ? prompt.at
      : isTime(worked.ms)
        ? worked.at - worked.ms
        : list.find(entry => isTime(entry.at))?.at;
    const end = worked.at;
    if (!isTime(start) || end <= start) return null;

    // when each step came back; a result with no date means this tool does not date them
    const ended = new Map();
    for (const entry of list) {
      if (entry.kind !== 'result' || !entry.id) continue;
      if (!isTime(entry.at)) return null;
      ended.set(entry.id, entry.at);
    }

    const steps = [];
    for (const entry of list) {
      if ((entry.kind !== 'act' && entry.kind !== 'ask') || !entry.id) continue;
      if (!isTime(entry.at)) return null;

      // a step with no result yet (stopped, or still in the background) runs to the task's end
      const from = Math.min(Math.max(entry.at, start), end);
      const to = Math.min(Math.max(ended.get(entry.id) || end, from), end);
      steps.push({ id: entry.id, kind: kindOf(entry), what: entry.what || '', from, to });
    }
    if (!steps.length) return null;

    // walk the task's time in pieces between every start and end: each piece goes to the first
    // kind running then, or to the agent's own thinking and writing when no step runs
    const totals = new Map();
    const edges = [...new Set([start, end, ...steps.flatMap(step => [step.from, step.to])])].sort(
      (a, b) => a - b
    );
    for (let index = 0; index < edges.length - 1; index++) {
      const from = edges[index];
      const to = edges[index + 1];
      const running = steps.filter(
        step => step.from <= from && step.to >= to && step.to > step.from
      );
      const kind = FIRST.find(name => running.some(step => step.kind === name)) || 'write';
      totals.set(kind, (totals.get(kind) || 0) + (to - from));
    }

    const parts = [];
    for (const [kind] of KINDS) {
      const ms = totals.get(kind) || 0;
      if (ms <= 0) continue;
      const slowest = steps
        .filter(step => step.kind === kind)
        .sort((a, b) => b.to - b.from - (a.to - a.from))[0];
      parts.push({
        kind,
        ms,
        slowest: slowest
          ? { id: slowest.id, what: slowest.what, ms: slowest.to - slowest.from }
          : null,
      });
    }
    return { start, end, parts };
  }

  // One task's entries → its tokens { input, output, cacheRead, cacheWrite }, adding each
  // request once (its newest line wins), or null when the record carries none.
  function cost(entries) {
    const byRequest = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.usage?.id) byRequest.set(entry.usage.id, entry.usage);
    }
    if (!byRequest.size) return null;
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const usage of byRequest.values()) {
      for (const key of Object.keys(sum)) sum[key] += Number(usage[key]) || 0;
    }
    return sum;
  }

  const totalOf = tokens =>
    tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite : 0;

  // 84000 → "84k", 1250000 → "1.3M", 950 → "950"
  function shortNumber(value) {
    if (value >= 1e6) return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(value >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(value));
  }

  // 250000 → "4m 10s", 42000 → "42s", 3900000 → "1h 05m"
  function duration(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }

  const pure = { split, cost, totalOf, shortNumber, duration, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ---------- the window part ----------

  const safe = (work, fallback) => {
    try {
      return work();
    } catch {
      return fallback;
    }
  };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // How close to now an entry must be to count as the task that just ran here (not a re-read).
  const LIVE_MS = 120000;

  // The entries of each thread's current task: state → { entries, byKey, ended, before }
  const tasks = new WeakMap();
  const MAX_ENTRIES = 3000;

  const sessionOf = paneId =>
    safe(() => window.TnaiAgents.sessions().find(item => item.paneId === paneId), null);
  const readingOf = session =>
    safe(() => window.TnaiPlanLimits?.get?.(session?.agent || '', session?.accountId || ''), null);

  // the plan's shortest window (the 5-hour one), as { minutes, used, resetsAt }
  const shortestWindow = reading =>
    (reading?.windows || [])
      .filter(span => Number.isFinite(span.used) && !span.model)
      .sort((a, b) => a.minutes - b.minutes)[0] || null;

  // 122: one entry of the thread
  function note(state, entry) {
    if (!state || !entry) return;
    let task = tasks.get(state);

    // a prompt starts a new task once the last one ended; a prompt sent while the agent works
    // joins the task it runs in
    if (!task || (entry.kind === 'you' && task.ended)) {
      task = { entries: [], byKey: new Map(), ended: false, before: null };
      tasks.set(state, task);
    }
    if (entry.kind === 'you' && !task.before && Date.now() - (entry.at || 0) < LIVE_MS) {
      const session = sessionOf(state.paneId);
      const span = shortestWindow(readingOf(session));
      if (session && span) task.before = { used: span.used, minutes: span.minutes };
    }

    // an action, a result or words may come again, changed: the newest replaces the older
    const key = entry.id ? entry.kind + ' ' + entry.id : '';
    if (key && task.byKey.has(key)) {
      task.entries[task.byKey.get(key)] = entry;
      return;
    }
    if (task.entries.length >= MAX_ENTRIES) return;
    if (key) task.byKey.set(key, task.entries.length);
    task.entries.push(entry);
  }

  // Whether another thread on the same account may have worked between `start` and `end`. Only
  // each thread's latest task is known, so one that started after `end` may hide an earlier one:
  // that also counts as "may have".
  function sharedAccount(paneId, start, end) {
    const mine = sessionOf(paneId);
    const others = safe(() => window.TnaiAgents.sessions(), []).filter(
      other =>
        other.paneId !== paneId &&
        other.agent === mine?.agent &&
        (other.accountId || '') === (mine?.accountId || '')
    );
    return others.some(other => {
      const turn = safe(() => window.TnaiTurns?.get?.(other.paneId), null);
      if (!turn?.startedAt) return false;
      if (turn.startedAt > end) return true;
      return turn.startedAt < end && (turn.endedAt || Date.now()) > start;
    });
  }

  // ---------- the tip all three parts share ----------
  let tip = null;

  function showTip(target, html) {
    if (!tip) {
      tip = make('div', 'ttt-tip');
      tip.setAttribute('role', 'tooltip');
      document.body.append(tip);
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const left = Math.min(
      Math.max(8, box.left + box.width / 2 - width / 2),
      innerWidth - width - 8
    );
    let top = box.top - height - 8;
    if (top < 8) top = box.bottom + 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = () => {
    if (tip) tip.hidden = true;
  };
  const escape = text =>
    String(text).replace(
      /[&<>"]/g,
      char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]
    );

  function partTip(part, whole) {
    const share = Math.round((part.ms / whole) * 100);
    let html =
      '<i class="ttt-dot" data-kind="' +
      part.kind +
      '"></i><b>' +
      NAMES[part.kind] +
      '</b> · ' +
      duration(part.ms) +
      ' · ' +
      share +
      '%';
    if (part.slowest)
      html +=
        '<small>Slowest: ' +
        escape(part.slowest.what || NAMES[part.kind]) +
        ', ' +
        duration(part.slowest.ms) +
        '</small><small>Press to see that step.</small>';
    else html += '<small>The time between steps, when no tool ran.</small>';
    return html + "<small>Measured from the tool's own record.</small>";
  }

  function costTip(info) {
    const tokens = info.tokens;
    const total = totalOf(tokens);
    const cached = total ? Math.round((tokens.cacheRead / total) * 100) : 0;
    const row = (name, value) =>
      '<tr><td>' + name + '</td><td>' + shortNumber(value) + '</td></tr>';
    let html =
      '<b>' +
      shortNumber(total) +
      ' tokens</b> · ' +
      cached +
      '% from cache<table>' +
      row('Input', tokens.input) +
      row('Output', tokens.output) +
      row('Cache read', tokens.cacheRead) +
      row('Cache write', tokens.cacheWrite) +
      '</table>';
    if (info.helpers) html += '<small>Helpers used ' + shortNumber(info.helpers) + ' more.</small>';
    const share = windowShare(info);
    if (share) html += share;
    return html;
  }

  // The task's share of the plan's shortest window, read when the tip opens: the reading taken
  // when the task started against the newest one, only for a task that just ran here, only when
  // the newest reading came after the task ended and no other thread on the account may have
  // worked meanwhile.
  function windowShare(info) {
    if (!info.before) return '';
    const session = sessionOf(info.paneId);
    const reading = readingOf(session);
    const span = shortestWindow(reading);
    if (!span || span.minutes !== info.before.minutes) return '';
    if (sharedAccount(info.paneId, info.start, info.end))
      return "<small>Another thread on this account worked at the same time, so this task's share of the plan window is not shown.</small>";
    if (!(reading.at >= info.end))
      return '<small>The plan window is read again after the task; hover again in a moment.</small>';
    const used = span.used - info.before.used;
    if (used < 0) return '';
    const hours = span.minutes % 60 ? span.minutes + '-minute' : span.minutes / 60 + '-hour';
    return (
      '<b>About ' +
      Math.max(used < 1 ? 0 : 1, Math.round(used)) +
      '% of your ' +
      hours +
      ' window</b><small>' +
      escape(reading.plan ? String(reading.plan) + ' · ' : '') +
      Math.round(info.before.used) +
      '% → ' +
      Math.round(span.used) +
      '%</small>'
    );
  }

  // ---------- 122: the "Worked for" block ----------
  function block(state, entry, node) {
    const task = tasks.get(state);
    if (!task || !node) return;
    task.ended = true;
    const entries = task.entries;
    const timing = split(entries);

    // tokens: the record's own, else the CLI's count of the task that just ended here
    let tokens = cost(entries);
    let helpers = 0;
    const live = Date.now() - (entry.at || 0) < LIVE_MS;
    if (live) {
      const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
      const sameTurn = turn?.endedAt && Math.abs(turn.endedAt - (entry.at || Date.now())) < LIVE_MS;
      if (sameTurn && !tokens && totalOf(turn.tokens)) tokens = { ...turn.tokens };
      if (sameTurn) helpers = totalOf(turn.subTokens);
    }

    let word = null;
    if (tokens && totalOf(tokens)) {
      word = make('button', 'ttt-cost');
      word.type = 'button';
      word.innerHTML = '<b>' + shortNumber(totalOf(tokens)) + '</b> tokens';
      word.setAttribute('aria-label', shortNumber(totalOf(tokens)) + ' tokens, details');
      word.tntCost = {
        tokens,
        helpers,
        paneId: state.paneId,
        before: live ? task.before : null,
        start: timing?.start || (entry.at || 0) - (entry.ms || 0),
        end: entry.at || Date.now(),
      };
    }

    // the cost word goes into "What it made"'s top line, before its changed-files chip
    const top = node.querySelector(':scope > .tnt-made-top');
    if (word && top) top.insertBefore(word, top.querySelector(':scope > .tnt-made-chip') || null);
    if (!timing) {
      if (word && !top) {
        const row = make('div', 'ttt-row');
        row.append(word);
        node.append(row);
      }
      return;
    }
    const whole = timing.end - timing.start;
    const line = make('div', 'ttt-time');
    const bar = make('div', 'ttt-bar');
    for (const part of timing.parts) {
      const piece = make('button', 'ttt-seg');
      piece.type = 'button';
      piece.dataset.kind = part.kind;
      piece.style.flexGrow = String(part.ms);
      piece.setAttribute(
        'aria-label',
        NAMES[part.kind] +
          ' ' +
          duration(part.ms) +
          ', ' +
          Math.round((part.ms / whole) * 100) +
          '%'
      );
      piece.tntPart = { part, whole, state };
      bar.append(piece);
    }
    const most = [...timing.parts].sort((a, b) => b.ms - a.ms)[0];
    line.append(
      bar,
      make('span', 'ttt-most', NAMES[most.kind] + ' took the most: ' + duration(most.ms))
    );

    // under the top line, before what the task made; without that line, the cost word ends
    // this one
    if (top) top.after(line);
    else {
      if (word) line.append(word);
      node.append(line);
    }
  }

  // ---------- hover and press ----------
  const HOVERABLE = '.ttt-seg, .ttt-cost';
  const tipFor = target =>
    target.tntPart
      ? partTip(target.tntPart.part, target.tntPart.whole)
      : target.tntCost
        ? costTip(target.tntCost)
        : '';
  for (const type of ['mouseover', 'focusin']) {
    document.addEventListener(type, event => {
      const target = event.target.closest?.(HOVERABLE);
      if (target) safe(() => showTip(target, tipFor(target)), null);
    });
  }
  for (const type of ['mouseout', 'focusout']) {
    document.addEventListener(type, event => {
      if (event.target.closest?.(HOVERABLE)) hideTip();
    });
  }
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTip();
  });

  // a press on a part opens its slowest step beside the thread, as a press on its line does
  document.addEventListener('click', event => {
    const piece = event.target.closest?.('.ttt-seg');
    if (!piece?.tntPart) return;
    const { part, state } = piece.tntPart;
    const line = part.slowest && state.acts?.get(part.slowest.id)?.line;
    if (!line) return;
    hideTip();
    line.scrollIntoView({ block: 'center' });
    line.click();
  });

  window.TnaiTaskTime = { note, block, ...pure };
})();
