/*
 * Technically Not · 158-cli-busy.js — a thread shows when its CLI runs one of its own built-in
 * commands (a compact above all), from the moment it starts until the CLI is done with it.
 *
 * A compact is no task: the CLI fires no task start or end for it, so the thread's "Working" line
 * (122) stayed away and a compact looked like nothing was happening. This script keeps, per
 * thread, "this command runs since then", and the thread list (119) and the conversation's last
 * line (122) show it with the time it has run and a moving bar.
 *
 * Where it starts (exact):
 * - a slash command the CLI took from the prompt box, any CLI (desktop/main.js `pty:submit`
 *   → agent event `command`);
 * - Claude Code's PreCompact hook, so a compact typed in the CLI screen or started by the CLI
 *   itself shows too (desktop/agent-hooks.js → agent event `compact-start`).
 *
 * Where it ends:
 * - a compact: the conversation's record gets its compact line (Claude Code's compact_boundary as
 *   `compactedAt` on the turn, 42; any CLI's reader as the note 122 adds), or the CLI's next task
 *   starts or ends (exact);
 * - otherwise, the CLI screen stopped saying it works for a few seconds (inferred, as the
 *   thread list's own status is);
 * - at the latest after LIMIT_MS, so a line never stays forever.
 * A command that never makes the CLI work (a menu such as /model) is never shown.
 *
 * `window.TnaiCliBusy` (`get`, `noted`, `start`). Test: `node tools/cli-busy-test.js`.
 */
(() => {
  'use strict';

  // The commands that compact the conversation, by CLI: Claude Code, Codex, OpenCode and Copilot
  // CLI say /compact, Cursor Agent /compress, OpenCode also /summarize.
  const COMPACT = new Set(['/compact', '/compress', '/summarize']);

  // The panel statuses (10) that mean the CLI screen says it works.
  const WORKING = new Set(['working', 'starting', 'running']);

  // How long the screen must stay quiet before a command counts as done (the status read from
  // the screen lags a little), how long a command that never worked is kept before it is
  // dropped, and the longest any line stays.
  const QUIET_MS = 2500;
  const NEVER_WORKED_MS = 10000;
  const LIMIT_MS = 10 * 60 * 1000;

  // paneId -> { command, compact, trigger, since, sawWork, quietSince }
  const running = new Map();
  let ticker = 0;

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const timeOf = at => (typeof at === 'string' ? Date.parse(at) || 0 : Number(at) || 0);

  function panelStatus(paneId) {
    const panel = safe(
      () => document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]'),
      null
    );
    return panel?.dataset.status || '';
  }

  // The thread list and the conversation's last line paint again (119 → 122).
  function repaint() {
    safe(() => window.TnaiThreadList?.refresh?.(), null);
  }

  // Main holds a prompt from the prompt box while its thread compacts and sends it when the
  // compact ends (desktop/attention-service.js `setCompacting`), so it waits in the conversation
  // as queued instead of vanishing into the CLI's input. This script is where a compact's start
  // and end are known for every CLI, so it tells main both.
  function tellMain(paneId, on) {
    safe(() => window.tnaiNative?.attention?.compacting?.(paneId, on)?.catch?.(() => {}), null);
  }

  // Held prompts no longer wait for this compact, however it ended (main sends them, and its
  // change repaints the queued bubbles through 71).
  const compactEnded = paneId => tellMain(paneId, false);

  function start(paneId, command, trigger) {
    if (!paneId || !command) return;
    const name = String(command).toLowerCase();
    const now = Date.now();
    const had = running.get(paneId);

    // The prompt box's /compact and Claude Code's PreCompact hook tell about the same compact:
    // it keeps the first moment and gains the trigger.
    if (had && had.compact && COMPACT.has(name)) {
      if (trigger) had.trigger = trigger;
      return;
    }
    running.set(paneId, {
      command: name,
      compact: COMPACT.has(name),
      trigger: trigger || '',
      since: now,
      sawWork: false,
      quietSince: 0,
    });
    if (COMPACT.has(name)) tellMain(paneId, true);

    // another command took the place of a compact: that compact is over
    else if (had?.compact) compactEnded(paneId);
    if (!ticker) ticker = setInterval(tick, 1000);
    repaint();
  }

  function end(paneId) {
    const entry = running.get(paneId);
    if (!running.delete(paneId)) return;
    if (entry.compact) compactEnded(paneId);
    if (!running.size) {
      clearInterval(ticker);
      ticker = 0;
    }
    repaint();
  }

  // Whether this command is over, from what is known now.
  function isOver(paneId, entry, now) {
    if (now - entry.since > LIMIT_MS) return true;
    const turn = safe(() => window.TnaiTurns?.get?.(paneId), null);

    // a compact the record shows as finished
    if (entry.compact && timeOf(turn?.compactedAt) >= entry.since - 1000) return true;

    // what the screen says (inferred)
    const working = WORKING.has(panelStatus(paneId));
    if (working) {
      entry.sawWork = true;
      entry.quietSince = 0;
      return false;
    }
    if (!entry.quietSince) entry.quietSince = now;
    if (entry.sawWork) return now - entry.quietSince >= QUIET_MS;

    // A command that never made the CLI work was a menu or an instant one. A compact is kept:
    // it ends by its record, or at the limit.
    return !entry.compact && now - entry.since >= NEVER_WORKED_MS;
  }

  function tick() {
    const now = Date.now();
    for (const [paneId, entry] of [...running]) if (isOver(paneId, entry, now)) end(paneId);
    if (running.size) repaint();
  }

  const clock = ms => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };

  // What the thread shows now, or null. A command other than a compact shows only while the
  // screen says the CLI works on it.
  function get(paneId) {
    const entry = running.get(paneId);
    if (!entry || (!entry.compact && !entry.sawWork)) return null;
    const words = entry.compact
      ? entry.trigger === 'auto'
        ? 'Compacting conversation (context was full)'
        : 'Compacting conversation'
      : 'Running ' + entry.command;
    return {
      command: entry.command,
      compact: entry.compact,
      words,
      clock: clock(Date.now() - entry.since),
      since: entry.since,
      inferred: !entry.compact,
    };
  }

  // A note the conversation's reader found (122): a compact line written after this compact began
  // means it is done, for every CLI with a reader.
  function noted(paneId, note) {
    const entry = running.get(paneId);
    if (!entry?.compact || !/compacted/i.test(String(note?.text || ''))) return;
    if (timeOf(note.at) >= entry.since - 1000) end(paneId);
  }

  function onEvent(event) {
    const paneId = event?.paneId;
    if (!paneId || event.agentId) return;
    if (event.kind === 'command') start(paneId, event.command);
    else if (event.kind === 'compact-start') start(paneId, '/compact', event.trigger);

    // The CLI's next task starts, or a task ends: a command before it is over. A prompt that is
    // the command itself (a CLI may report a slash command as a prompt) is not a next task.
    else if ((event.kind === 'prompt' || event.kind === 'stop') && running.has(paneId)) {
      const entry = running.get(paneId);
      const words = String(event.text || '')
        .trim()
        .toLowerCase();
      if (event.kind === 'prompt' && words.split(/\s/)[0] === entry.command) return;
      if (timeOf(event.at) > entry.since) end(paneId);
    }
  }

  safe(() => window.tnaiNative?.agentEvents?.on?.(onEvent), null);

  // A window that starts anew knows of no compact: main keeps none from before (a reload in the
  // middle of one would otherwise hold prompts until main's own limit).
  tellMain('', false);

  window.TnaiCliBusy = { get, noted, start, end };
})();
