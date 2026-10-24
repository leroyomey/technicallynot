/*
 * Technically Not · 172-thread-times.js — times across the threads, always shown and quiet (user
 * 2026-10-22, from the mock docs/plans/design-concepts/timestamps.html: "Yes, always shown,
 * quiet").
 *
 * One place that says a time the same way everywhere: today as a clock, "Yesterday", a date this
 * year, a date with its year before that, and the full date on hover. The conversation (122) asks
 * it for a small time line under a prompt and a reply, a day line when the day changes, and the
 * time on a report; the thread list (119) and a helper's card (122) use the short form.
 *
 * Every time comes from the tool's own record (`entry.at`, ms). A record without times (Cursor
 * Agent's) shows none: nothing is guessed.
 *
 * Test: node tools/thread-times-test.js
 */
(() => {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;

  const valid = at => Number.isFinite(at) && at > 0;

  // Midnight of the day `at` falls on, in the user's own time zone.
  function dayStart(at) {
    const date = new Date(at);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function clock(at) {
    if (!valid(at)) return '';
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function date(at, withYear) {
    const options = { month: 'short', day: 'numeric' };
    if (withYear) options.year = 'numeric';
    return new Date(at).toLocaleDateString([], options);
  }

  // The short form: "9:41 AM" today, "Yesterday", "Oct 19" this year, "Oct 19, 2025" before.
  function short(at, now = Date.now()) {
    if (!valid(at)) return '';
    const today = dayStart(now);
    if (at >= today) return clock(at);
    if (at >= today - DAY) return 'Yesterday';
    return date(at, new Date(at).getFullYear() !== new Date(now).getFullYear());
  }

  // The full date and time, for a time's hover.
  function full(at) {
    if (!valid(at)) return '';
    return new Date(at).toLocaleString([], {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // A day line's words: "Today · Wed, Oct 22", "Yesterday · Tue, Oct 21", "Sun, Oct 19".
  function dayWords(at, now = Date.now()) {
    const today = dayStart(now);
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    if (!sameYear) options.year = 'numeric';
    const named = new Date(at).toLocaleDateString([], options);
    if (at >= today) return 'Today · ' + named;
    if (at >= today - DAY) return 'Yesterday · ' + named;
    return named;
  }

  // How long from one time to another: "45s", "3m 12s", "1h 04m".
  function span(from, to) {
    if (!valid(from) || !valid(to) || to < from) return '';
    const seconds = Math.round((to - from) / 1000);
    if (seconds < 60) return seconds + 's';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
  }

  // A <time> element with the full date on hover.
  function timeNode(at, words, className) {
    const node = document.createElement('time');
    if (className) node.className = className;
    node.dateTime = new Date(at).toISOString();
    node.title = full(at);
    node.textContent = words;
    return node;
  }

  // ---------- the conversation (122) ----------

  // A day line before the first line of a day. `add` puts a node in the conversation (122's
  // addBlock), so the cap on blocks counts it like any other.
  function day(state, at, add) {
    if (!valid(at)) return;
    const start = dayStart(at);
    if (state.timesDay === start) return;
    state.timesDay = start;
    const line = document.createElement('div');
    line.className = 'tnt-day';
    line.setAttribute('role', 'separator');
    line.append(timeNode(at, dayWords(at), ''));
    add(line);
  }

  // The small line under a prompt (`mine`, at the right) or a reply: its time, and under a reply a
  // quiet Copy button that copies the whole reply (`copyText()` gives its words, as Markdown). A
  // reply in the same minute as the last time shown gets no time, so a reply cut by actions does
  // not repeat one; it keeps its Copy button.
  function stamp(state, at, mine, after, copyText) {
    if (!after?.isConnected) return;
    const words = valid(at) ? clock(at) : '';
    const showTime = !!words && (mine || state.timesLast !== words);
    const copy = !mine && typeof copyText === 'function';
    if (!showTime && !copy) return;
    const line = document.createElement('div');
    line.className = mine ? 'tnt-at tnt-at-you' : 'tnt-at';
    if (showTime) {
      state.timesLast = words;
      line.append(timeNode(at, words, ''));
    }
    if (copy) line.append(copyButton(copyText));
    after.after(line);
  }

  // ---------- copy a whole reply (user 2026-10-22, the same mock's "Copy a reply") ----------
  const COPIED_MS = 1400;
  const icon = name => {
    try {
      return window.TnaiIcon?.(name, { size: 13 }) || '';
    } catch {
      return '';
    }
  };

  // The clipboard can refuse a page that does not have the keyboard: a hidden text box is copied
  // the older way instead.
  async function writeText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    let done = false;
    try {
      done = document.execCommand('copy');
    } catch {}
    box.remove();
    return done;
  }

  function copyButton(copyText) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tnt-at-copy';
    button.title = 'Copy this reply as text';
    const paint = done => {
      button.innerHTML = icon(done ? 'check' : 'copy');
      button.append(done ? ' Copied' : ' Copy');
    };
    paint(false);
    button.addEventListener('click', async () => {
      const text = String(copyText() || '').trim();
      if (!text || !(await writeText(text))) return;
      button.dataset.done = '';
      paint(true);
      clearTimeout(button.copiedTimer);
      button.copiedTimer = setTimeout(() => {
        delete button.dataset.done;
        paint(false);
      }, COPIED_MS);
    });
    return button;
  }

  // The time on a report card's head.
  function onReport(card, at) {
    const head = card?.querySelector('h3');
    if (!head || !valid(at)) return;
    head.append(timeNode(at, clock(at), 'tnt-report-at'));
  }

  // A helper card's line: "since 9:36 AM", or "9:36 → 9:39 AM · 3m 12s" once it is done.
  function helperWords(startedAt, endedAt) {
    if (!valid(startedAt)) return '';
    if (!valid(endedAt)) return 'since ' + clock(startedAt);
    return clock(startedAt) + ' → ' + clock(endedAt) + ' · ' + span(startedAt, endedAt);
  }

  window.TnaiTimes = { clock, short, full, dayWords, span, day, stamp, onReport, helperWords };
})();
