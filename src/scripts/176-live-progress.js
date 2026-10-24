/*
 * Technically Not · 176-live-progress.js — live progress in a thread (user 2026-10-23, mock
 * docs/plans/design-concepts/live-progress.html, from part 2 of the video review):
 * - a running clock of the task on the Working line, from the time the tool reported the task
 * started (42 `TnaiTurns.get(paneId).startedAt`, exact);
 * - the agent's own checklist as segments (done, now, to do) with the item it is on
 * (`TnaiTurns.get(paneId).steps`: { index, total, done, text }, from desktop/agent-turns.js), shown
 * only while the agent keeps a checklist; the "· N/M" count then leaves the line's words;
 * - new lines of the conversation rise in (the `tnt-fresh` mark 122's `addBlock` puts on a block
 * added after the first read; src/styles/55-live-progress.css).
 *
 * 122's `paintLive` calls `paint(state)` after it has set the line's words. The clock ticks once a
 * second only while a line shows it; nothing else is polled.
 *
 * Test: node tools/live-progress-test.js
 */
(() => {
  'use strict';

  // more items than this are drawn as this many segments, filled in proportion
  const MAX_SEGMENTS = 12;

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  // "2:14", "1:02:09"
  function clockText(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(seconds % 60).padStart(2, '0');
    return hours
      ? hours + ':' + String(minutes).padStart(2, '0') + ':' + rest
      : minutes + ':' + rest;
  }

  // The segments for a checklist: 'done', 'now' or '' each, at most MAX_SEGMENTS.
  function segments(steps) {
    const total = Math.max(0, Number(steps?.total) || 0);
    if (!total) return [];
    const done = Math.min(total, Math.max(0, Number(steps.done) || 0));
    const now = Math.min(total, Math.max(1, Number(steps.index) || 1));
    const count = Math.min(total, MAX_SEGMENTS);
    const out = [];
    for (let at = 0; at < count; at++) {
      // the item this segment stands for, when there are more items than segments
      const item = Math.floor((at * total) / count) + 1;
      const next = Math.floor(((at + 1) * total) / count);
      if (next <= done) out.push('done');
      else if (item <= now && now <= next) out.push('now');
      else out.push('');
    }
    return out;
  }

  // Lines that show a clock now, ticked together.
  const clocks = new Set();
  let ticking = 0;

  function tick() {
    for (const node of clocks) {
      if (!node.isConnected || node.closest('[hidden]')) {
        clocks.delete(node);
        continue;
      }
      node.textContent = clockText(Date.now() - Number(node.dataset.since));
    }
    if (!clocks.size) {
      clearInterval(ticking);
      ticking = 0;
    }
  }

  function watchClock(node) {
    clocks.add(node);
    if (!ticking) ticking = setInterval(tick, 1000);
  }

  function partOf(line, className, tag = 'span') {
    let node = line.querySelector(':scope > .' + className);
    if (!node) {
      node = document.createElement(tag);
      node.className = className;
      line.append(node);
    }
    return node;
  }

  // After 122 drew the Working line: the clock, and the checklist under it.
  function paint(state) {
    const line = state?.live;
    if (!line || line.hidden) return;
    const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
    const working = !!turn?.startedAt && !turn.endedAt && line.dataset.tone === 'work';

    // the clock, at the line's right end
    const clock = partOf(line, 'tnt-live-clock', 'time');
    clock.hidden = !working;
    if (working) {
      clock.dataset.since = String(turn.startedAt);
      clock.title = 'This task started ' + new Date(turn.startedAt).toLocaleTimeString();
      clock.textContent = clockText(Date.now() - turn.startedAt);
      watchClock(clock);
    }

    // the checklist, under the line, only while the agent keeps one
    const steps = working ? turn.steps : null;
    const parts = segments(steps);
    const check = partOf(line, 'tnt-live-check', 'div');
    check.hidden = !parts.length;
    if (!parts.length) return;
    const words = line.querySelector(':scope > span');

    // the count moves from the line's words into the bar
    if (words) words.textContent = words.textContent.replace(/\s·\s\d+\/\d+$/, '');
    const bar = document.createElement('span');
    bar.className = 'tnt-live-seg';
    bar.setAttribute('aria-hidden', 'true');
    parts.forEach(kind => {
      const part = document.createElement('i');
      if (kind) part.className = kind;
      bar.append(part);
    });
    const say = document.createElement('span');
    say.className = 'tnt-live-step';
    say.append('Step ' + steps.index + ' of ' + steps.total);
    if (steps.text) {
      const item = document.createElement('b');
      item.textContent = steps.text;
      say.append(': ', item);
    }
    check.replaceChildren(bar, say);
  }

  window.TnaiLiveProgress = { paint, clockText, segments };
})();
