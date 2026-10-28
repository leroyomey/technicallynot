/*
 * Technically Not · 188-quiet-threads.js — says when a thread's task is open but its CLI has
 * written nothing for minutes (user, 2026-10-28: the quiet-thread warning; "/usage" once sat
 * waiting on Claude Code's own panel while the thread looked like any idle thread).
 *
 * The signal: the task is open (42 `TnaiTurns`: started, not ended, not paused for a usage limit),
 * the session runs, and its terminal has printed nothing for QUIET_MS (10 `lastOutputAt`). Claude
 * Code and Codex redraw a spinner and a clock while they think or run a command, so a long but
 * healthy step keeps printing; silence with an open task means the CLI waits on something on its
 * own screen (a menu, a key) or hangs. Left out: a thread that already needs the user (71: a
 * permission, a menu the app saw), one waiting on its own helpers or background tasks (10's
 * statuses), and CLIs whose start and end of a task the app cannot see (no turn, no warning).
 *
 * Shown as a card in the open thread's "Questions for you" row (120 `.tnt-asks`) with "Open CLI
 * screen", "Stop where it is" (150, one Esc) and "Dismiss", and as a bell notice for a thread that
 * is not open, with "Go to it". Both go when the CLI prints again or the task ends. It never stops
 * or types into an agent by itself.
 */
(() => {
  'use strict';
  if (!window.tnaiNative?.agents) return;

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  // Silence this long with an open task counts. A CLI that thinks or runs a command redraws its
  // clock every second, so minutes of silence are not a slow step.
  const QUIET_MS = 3 * 60 * 1000;

  // How often the quiet is measured: a timer over the app's own state, nothing is asked of the
  // agents (silence has no event of its own).
  const CHECK_MS = 20 * 1000;

  // Statuses where silence is already explained (10 `status`)
  const EXPLAINED = new Set(['needs-you', 'waiting-agents', 'background', 'starting']);

  // paneId -> when that quiet spell was dismissed (its lastOutputAt then): hidden until the CLI
  // prints again
  const dismissed = new Map();

  // paneIds quiet now: { paneId, name, since }
  let quiet = [];

  function measure() {
    const now = Date.now();
    const sessions = safe(() => window.TnaiAgents.sessions(), []);
    const found = [];

    // the quiet spell each thread with an open task is in: paneId -> since when
    const spells = new Map();
    for (const session of sessions) {
      if (!session.running) continue;
      const turn = safe(() => window.TnaiTurns?.get?.(session.paneId), null);
      if (!turn?.startedAt || turn.endedAt) continue;
      const since = Math.max(Number(session.lastOutputAt) || 0, Number(turn.startedAt) || 0);
      spells.set(session.paneId, since);
      if (EXPLAINED.has(session.status)) continue;
      if (safe(() => window.TnaiTurns.paused(session.paneId), false)) continue;
      if (!since || now - since < QUIET_MS) continue;
      if (dismissed.get(session.paneId) === since) continue;
      found.push({ paneId: session.paneId, name: session.name || 'The agent', since });
    }

    // a dismissed spell is forgotten once that thread prints again or its task ends
    for (const [paneId, since] of [...dismissed])
      if (spells.get(paneId) !== since) dismissed.delete(paneId);
    quiet = found;
    paint();
  }

  const minutes = since => Math.max(1, Math.round((Date.now() - since) / 60000));

  // ---------- the card in the open thread ----------
  const card = document.createElement('section');
  card.className = 'tnt-quiet';
  card.hidden = true;
  card.setAttribute('role', 'status');
  card.innerHTML =
    '<div class="tnt-ask-text"><b></b><p></p></div><div class="tnt-ask-acts">' +
    '<button type="button" data-act="dismiss">Dismiss</button>' +
    '<button type="button" data-act="stop">Stop where it is</button>' +
    '<button type="button" class="tnt-ask-yes" data-act="screen">Open CLI screen</button></div>';
  const title = card.querySelector('b');
  const body = card.querySelector('p');
  let cardFor = null;

  card.addEventListener('click', event => {
    const act = event.target.closest('button')?.dataset.act;
    if (!act || !cardFor) return;
    const paneId = cardFor.paneId;
    if (act === 'screen') safe(() => window.TnaiThreadView.setMode('term'), null);
    if (act === 'stop') safe(() => window.TnaiComposerStop.stop(paneId), null);
    dismissed.set(paneId, cardFor.since);
    measure();
  });

  // the open thread's "Questions for you" row (120)
  const row = () =>
    safe(() => window.TnaiThreads?.slot?.('main')?.querySelector('.tnt-asks'), null);
  const openPane = () => safe(() => window.TnaiThreads.selected(), '') || '';

  function paintCard() {
    const dock = row();
    const mine = quiet.find(one => one.paneId === openPane()) || null;
    cardFor = mine;
    if (!dock || !mine) {
      card.hidden = true;
      return;
    }
    if (card.parentElement !== dock) dock.prepend(card);
    const text = 'No output for ' + minutes(mine.since) + ' min while its task is open';
    if (title.textContent !== text) title.textContent = text;
    body.textContent =
      mine.name +
      ' may be waiting on something on its own screen (a menu or a key), or be stuck. The CLI screen shows what it is doing.';
    card.hidden = false;
  }

  // ---------- the bell, for threads that are not open ----------
  const noticed = new Set();

  function paintBell() {
    const bell = window.TnaiNextActions;
    if (!bell?.notify) return;
    const open = openPane();
    const now = new Set();
    for (const one of quiet) {
      if (one.paneId === open) continue;
      const key = 'quiet:' + one.paneId;
      now.add(key);
      bell.notify({
        key,
        source: 'Threads',
        title: one.name + ': no output for a few minutes',
        text: 'Its task is open but its CLI has printed nothing. It may be waiting on its own screen, or be stuck.',
        action: {
          label: 'Go to it',
          run: () => safe(() => window.TnaiThreads.show(one.paneId), null),
        },
      });
    }
    for (const key of noticed) if (!now.has(key)) safe(() => bell.unnotify(key), null);
    noticed.clear();
    now.forEach(key => noticed.add(key));
  }

  function paint() {
    paintCard();
    paintBell();
  }

  setInterval(measure, CHECK_MS);
  window.addEventListener('tnai:turn', measure);
  window.addEventListener('tnai:threads-select', paint);
  window.addEventListener('tnai:threads-built', paint);
  safe(() => window.TnaiAgents.onChange(() => quiet.length && measure()), null);
  measure();

  window.TnaiQuietThreads = { quiet: () => quiet.map(one => ({ ...one })), measure };
})();
