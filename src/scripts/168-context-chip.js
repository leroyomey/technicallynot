// Technically Not · 168-context-chip.js — Desktop only: how full the open thread's conversation is,
// as an amber chip in the row under the prompt box ("142k of 200k · Compact"), and a press that
// runs the CLI's own compact.
//
// - It shows past the "amber" share of the model's window that Settings › Agents › Agent context
// sets (half by default, "Show context size warnings" turns it off): 76 `TnaiContextWarning.level`
// holds that rule and its numbers, read here, never worked out a second time. Below it, while the
// size is not known, and for a CLI without a compact command, there is no chip.
// - The size is what the CLI itself reported (Claude Code, Codex and OpenCode; Cursor Agent and
//   GitHub Copilot report none here), never guessed.
// - A press does what a "/compact" typed in the prompt box does: 54 `compactNow` (the agent writes
//   down what must survive first, then the command runs and the summary comes back), or, with
//   "Summarize first" off, the CLI's own /compact typed into its terminal. The thread then shows
//   "Compacting conversation" (158). While the agent works the chip says so and takes no press.
// - It stands right before "↵ send": that hint stays the second-last child of the row, which the
//   row's fit rules (07, 11 `fitRoute`) count on.
// - Painted on pushed events only (a turn, a session change, another thread opened).
//
// window.TnaiContextChip (decide, paint). Look: src/styles/49-context-chip.css. Test:
// tools/context-chip-test.js.
(() => {
  'use strict';
  const agents = window.TnaiAgents,
    pty = window.tnaiNative?.pty;
  if (!agents || !pty) return;

  // The CLIs with a compact command of their own (as 41 and 54).
  const COMPACTS = new Set(['Claude Code', 'Codex', 'OpenCode']);

  const tokens = n =>
    window.TnaiTurns?.format?.tokens?.(n) || Math.max(1, Math.round(n / 1000)) + 'k';

  // What the chip shows for one thread, as plain values (the test reads this):
  // null = no chip; else { text, steps, title, busy }. `steps` are its words from the longest to
  // the shortest; a tight row takes the first one that leaves the pickers' words free (`fit`).
  function decide(paneId) {
    if (!paneId) return null;
    const size = window.TnaiContextWarning?.level?.(paneId);
    if (!size || !size.lv) return null;
    const session = size.s;
    if (!session || !COMPACTS.has(session.agent)) return null;
    const busy = session.status === 'working' || session.status === 'starting';
    const used = tokens(size.tokens);
    const text = (size.win > 0 ? used + ' of ' + tokens(size.win) : used) + ' · Compact';
    const share = size.pct ? ' (' + size.pct + '% of its window)' : '';
    const title = busy
      ? session.name +
        "'s conversation holds " +
        used +
        share +
        '. Compact it once it has finished its task.'
      : session.name +
        "'s conversation holds " +
        used +
        share +
        '. Every message sends all of it again. A press compacts it with ' +
        session.agent +
        "'s own command.";
    const steps = [...new Set([text, used + ' · Compact', used])];
    return { text, steps, title, busy };
  }

  // The thread the prompt box is under: the open thread of the Threads page, not while another
  // computer's agent fills the main area (138).
  function openPane() {
    const frame = window.TnaiThreads;
    if (!frame?.visible?.()) return '';
    if (window.TnaiThreadHistory?.remote?.()) return '';
    return frame.selected?.() || '';
  }

  let chip = null;
  let shownFor = '';

  // "↵ send" in the row under the prompt box (11 rewrote its words when it loaded).
  function sendHint() {
    const row = document.querySelector('.composer .hints');
    if (!row) return null;
    return [...row.querySelectorAll(':scope>.hint')].find(hint => /send/.test(hint.textContent));
  }

  function makeChip() {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'tnai-ctx-chip';
    node.hidden = true;
    node.innerHTML = (window.TnaiIcon?.('gauge', { size: 12 }) || '') + '<span></span>';
    node.addEventListener('click', event => {
      event.preventDefault();
      press();
    });
    return node;
  }

  function paint() {
    const paneId = openPane();
    const shown = decide(paneId);
    if (!chip) {
      if (!shown) return;
      chip = makeChip();
    }

    // Kept right before "↵ send", also after the row moved to the composer's pop-out (38).
    const hint = sendHint();
    if (hint && chip.nextElementSibling !== hint) hint.before(chip);
    if (!shown || !hint) {
      if (!chip.hidden) chip.hidden = true;
      shownFor = '';
      return;
    }
    shownFor = paneId;
    shownSteps = shown.steps;
    if (chip.title !== shown.title) {
      chip.title = shown.title;
      chip.setAttribute('aria-label', shown.title);
    }
    chip.setAttribute('aria-disabled', String(shown.busy));
    if (chip.hidden) chip.hidden = false;
    fit();
    watchRow(hint.parentElement);
  }

  // A tight row (a thread beside a wide side column, a small window): the chip gives way first,
  // whole, one step at a time ("142k of 200k · Compact", "142k · Compact", "142k"), so the Model
  // and Effort pickers' words never lie under it. Their words are measured, not their boxes: a
  // picker's words can stand outside its own box (as in 11 `fitRoute`).
  let shownSteps = [];

  function pickersEnd(row) {
    const pickers = row?.querySelector(':scope>.tnai-pickers');
    let end = 0;
    if (!pickers) return end;
    for (const part of pickers.querySelectorAll('*')) {
      if (!part.getClientRects().length) continue;
      end = Math.max(end, part.getBoundingClientRect().right);
    }
    return end;
  }

  function fit() {
    if (!chip || chip.hidden || !shownSteps.length) return;
    const label = chip.querySelector('span');
    const row = chip.parentElement;
    const measurable = typeof chip.getBoundingClientRect === 'function';
    for (const words of shownSteps) {
      if (label.textContent !== words) label.textContent = words;
      if (!measurable) return;
      if (pickersEnd(row) <= chip.getBoundingClientRect().left + 1) return;
    }
  }

  // The row's size changes with the window and the side column, and the pickers' with their
  // choice: the chip fits again then. One observer, on whichever row holds the chip now.
  let rowWatch = null,
    watchedRow = null;

  function watchRow(row) {
    if (!row || row === watchedRow || !window.ResizeObserver) return;
    if (!rowWatch) rowWatch = new ResizeObserver(() => fit());
    rowWatch.disconnect();
    rowWatch.observe(row);
    const pickers = row.querySelector(':scope>.tnai-pickers');
    if (pickers) rowWatch.observe(pickers);
    watchedRow = row;
  }

  // The compact itself: the same path as "/compact" typed in the prompt box (11 → 54).
  function press() {
    const paneId = shownFor;
    const shown = decide(paneId);
    if (!shown || paneId !== openPane()) return;
    const session = agents.sessions().find(item => item.paneId === paneId);
    if (!session) return;
    if (shown.busy) {
      window.toast?.(session.name + ' is working. Compact it once it has finished its task.');
      return;
    }
    if (window.TnaiContextUpkeep?.compactNow?.(paneId, '/compact')) return;
    pty.submit(paneId, '/compact', { paste: false }).catch(() => {});
    window.toast?.('Sent /compact to ' + session.name);
  }

  let queued = false;

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  }

  for (const name of [
    'tnai:turn',
    'tnai:threads-select',
    'tnai:threads-shown',
    'tnai:threads-hidden',
    'tnai:thread-view',
    'tnai:remote-agents-changed',
  ])
    window.addEventListener(name, schedule);
  agents.onChange(schedule);
  schedule();

  window.TnaiContextChip = { decide, paint: schedule };
})();
