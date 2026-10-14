/*
 * Technically Not · 72-limit-resume.js — Desktop app only: agents carry on by themselves once their
 * usage limit resets. 15 detects the CLI's own limit line (`tnai:account-limit`); this reads the
 * reset time from that line and the output right after it ("resets 3pm", "reset at 3:30 PM",
 * "resets Oct 2, 9am", "try again in 2 hours 13 minutes", "try again at 3:45 PM"), and a minute
 * after the reset clears the limit (15 clearLimit: the card's limit note goes and 42's paused clock
 * resumes), presses Esc (closes a "what do you want to do?" limit menu) and sends the agent RESUME.
 * Still limited → the CLI prints its limit line again → 15 detects it → this schedules again. No
 * reset time found → a try every 30 minutes, up to 12. The limit also clears, without sending
 * anything, when the pane's next task uses tokens (the user continued it by hand, or the CLI
 * carried on). On by default; Settings › Agents (22 pref `autoResumeLimit`). The Agent Tree's limit
 * box (103) calls `schedule` / `resumeNow` for the user's own choice and repaints on
 * `tnai:limit-plan`. A pane restart / account switch / close cancels (15 clears the limit).
 * `window.TnaiLimitResume`
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents,
    accounts = window.TnaiAccounts;
  if (!native?.pty || !agents || !accounts?.clearLimit) return;

  const RESUME =
    'Your usage limit has reset. Continue the task you were working on when the limit was reached; do not repeat work that is already complete.';
  const GRACE = 60 * 1000,
    RETRY = 30 * 60 * 1000,
    MAX_TRIES = 12,
    READ_MS = 2500,
    MAX_WAIT = 8 * 24 * 3600 * 1000;
  const on = () => window.TnaiSettings?.get?.('autoResumeLimit') ?? true;
  const say = m => (typeof toast === 'function' ? toast(m) : console.info(m));
  const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
  const MONTHS = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];

  // Reset time (ms) from a limit message, or null. Clock times are the PC's local time (the CLIs
  // print the user's own zone).
  function resetAt(text, now = Date.now()) {
    text = String(text || '').replace(/\s+/g, ' ');
    const rel =
      /(?:try again|resets?|available again)\s+in\s+((?:\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[\s,]*(?:and\s+)?)+)/i.exec(
        text
      );
    if (rel) {
      let ms = 0;
      for (const [, n, u] of rel[1].matchAll(/(\d+)\s*([a-z]+)/gi)) {
        const k = u[0].toLowerCase();
        ms += +n * (k === 'd' ? 864e5 : k === 'h' ? 36e5 : k === 'm' ? 6e4 : 1e3);
      }
      if (ms > 0) return now + ms;
    }
    const abs =
      /(?:resets?|reset at|try again at|available again at)\s+(?:at\s+|on\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(
        text
      );
    if (!abs || (!abs[5] && !abs[4])) return null; // a bare number ("resets 5") is not a time
    let h = +abs[3];
    const min = +(abs[4] || 0),
      ap = (abs[5] || '').toLowerCase();
    if (h > 23 || min > 59 || (ap && (h < 1 || h > 12))) return null;
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(h, min);
    const mon = abs[1] ? MONTHS.indexOf(abs[1].toLowerCase()) : -1;
    if (mon >= 0) {
      d.setMonth(mon, +abs[2]);
      if (d.getTime() < now - 864e5) d.setFullYear(d.getFullYear() + 1);
    } else if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // paneId -> { timer, due, timed, tries, forced, startedAt, name }; forced: the user chose it in
  // the limit box (103), so it holds with the setting off
  const plans = new Map();

  // paneId -> text seen right after the limit line (the reset time may arrive in the next chunk)
  const reading = new Map();

  // paneId -> the limit line plus what followed it, kept while the limit lasts (103 can schedule
  // later)
  const texts = new Map();
  const clock = ms =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
    (new Date(ms).toDateString() === new Date().toDateString()
      ? ''
      : ' ' + new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }));

  // 103's box shows the plan
  const told = () => window.dispatchEvent(new CustomEvent('tnai:limit-plan'));

  function cancel(paneId) {
    const p = plans.get(paneId);
    if (p) clearTimeout(p.timer);
    if (plans.delete(paneId)) told();
  }
  const session = paneId => agents.sessions().find(s => s.paneId === paneId);

  // Plans the resume for a minute after the reset time in the pane's limit text; no time found → a
  // try in 30 minutes.
  function plan(paneId, s, tries, forced) {
    cancel(paneId);
    const at = resetAt(texts.get(paneId) || ''),
      timed = !!at && at - Date.now() < MAX_WAIT,
      due = timed ? at + GRACE : Date.now() + RETRY;
    plans.set(paneId, {
      due,
      timed,
      tries,
      forced,
      startedAt: s.startedAt,
      name: s.name,
      timer: setTimeout(() => fire(paneId), Math.max(1000, due - Date.now())),
    });
    told();
    return { timed, due };
  }

  native.pty.onData(({ paneId, data }) => {
    if (reading.has(paneId))
      reading.set(paneId, (reading.get(paneId) + data.replace(ANSI, ' ')).slice(-2000));
  });

  window.addEventListener('tnai:account-limit', e => {
    const info = e.detail || {},
      paneId = info.paneId;
    if (!paneId) return;
    reading.set(paneId, '');
    setTimeout(() => {
      const after = reading.get(paneId) || '';
      reading.delete(paneId);
      const s = session(paneId);
      if (!s?.running) return;
      if (accounts.limitFor(paneId)) texts.set(paneId, info.text + ' ' + after);
      const prev = plans.get(paneId),
        same = prev && prev.startedAt === s.startedAt,
        tries = same ? prev.tries : 0,
        forced = !!(same && prev.forced);
      if (!on() && !forced) return;
      cancel(paneId);
      if (tries >= MAX_TRIES) {
        say(
          s.name + ' is still at its usage limit · auto-continue gave up after ' + tries + ' tries'
        );
        return;
      }
      const { timed, due } = plan(paneId, s, tries, forced);
      say(
        s.name +
          ' will continue ' +
          (timed
            ? 'at ' + clock(due) + ', after its usage limit resets'
            : 'on its own once its usage limit resets (checking every 30 minutes)')
      );
    }, READ_MS);
  });

  // The limit is over some other way (restart, account switch, the next task used tokens): nothing
  // left to send.
  window.addEventListener('tnai:account-limit-cleared', e => {
    texts.delete(e.detail?.paneId);
    if (!e.detail?.resumed) cancel(e.detail?.paneId);
  });

  // The user's own choices in the limit box (103). schedule: resume at the reset, also with the
  // setting off. resumeNow: try at once (not counted as an automatic try); still limited → the CLI
  // prints its limit line again and the plan is made anew.
  function schedule(paneId) {
    const s = session(paneId);
    if (!s?.running || !accounts.limitFor(paneId)) return false;
    const p = plans.get(paneId);
    if (p?.timer && p.startedAt === s.startedAt) {
      p.forced = true;
      return true;
    }
    plan(paneId, s, p && p.startedAt === s.startedAt ? p.tries : 0, true);
    return true;
  }

  function resumeNow(paneId) {
    if (!schedule(paneId)) return false;
    plans.get(paneId).manual = true;
    fire(paneId);
    return true;
  }

  // Timers can fire late after sleep; a long-sleeping PC catches up when the window regains focus.
  const catchUp = () => {
    for (const [paneId, p] of plans)
      if (Date.now() >= p.due) {
        clearTimeout(p.timer);
        fire(paneId);
      }
  };
  window.addEventListener('focus', catchUp);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) catchUp();
  });

  // Agents on one account share a reset time: each fire takes the next slot STAGGER ms after the
  // previous one, so they carry on a few seconds apart instead of all in the same second.
  const STAGGER = 5000;
  let nextSlot = 0;

  function fire(paneId) {
    const p = plans.get(paneId);
    if (!p) return;
    const now = Date.now(),
      slot = Math.max(now, nextSlot);
    nextSlot = slot + STAGGER;
    if (slot > now) {
      clearTimeout(p.timer);
      p.timer = setTimeout(() => fireNow(paneId), slot - now);
      return;
    }
    fireNow(paneId);
  }

  function fireNow(paneId) {
    const p = plans.get(paneId);
    if (!p) return;
    const s = session(paneId);
    if (
      (!on() && !p.forced) ||
      !s?.running ||
      s.startedAt !== p.startedAt ||
      !accounts.limitFor(paneId)
    ) {
      cancel(paneId);
      return;
    }
    if (!p.manual) p.tries += 1;
    p.manual = false;
    clearTimeout(p.timer);
    p.timer = 0;
    told();

    // Cleared first so the CLI's answer is read fresh: a new limit line means it's still limited
    // (then a new plan keeps p.tries).
    accounts.clearLimit(paneId, true, { resumed: true });
    native.pty.write(paneId, '\x1b');
    setTimeout(() => {
      if (!agents.send(paneId, RESUME)) {
        say(p.name + ' stopped before it could continue.');
        cancel(paneId);
        return;
      }
      say(p.name + ' is continuing: its usage limit has reset');
    }, 400);
  }

  // Usage is back when a task started after the limit uses tokens: the limit note goes (sent by
  // hand, or the CLI carried on).
  window.addEventListener('tnai:turn', e => {
    const paneId = e.detail?.paneId,
      limit = accounts.limitFor(paneId),
      t = window.TnaiTurns?.get?.(paneId);
    const tok = t?.tokens || {};
    if (!t || !((tok.output || 0) + (tok.input || 0) > 0)) return;
    if (!limit) {
      if (plans.get(paneId)?.timer === 0) cancel(paneId);
      return;
    } // a sent resume worked
    if (t.startedAt > limit.at + 1000) accounts.clearLimit(paneId, true);
  });

  window.TnaiLimitResume = {
    resetAt,
    pending: () =>
      [...plans].map(([paneId, p]) => ({
        paneId,
        due: p.due,
        timed: p.timed,
        tries: p.tries,
        scheduled: !!p.timer,
      })),
    fire,
    fireNow,
    cancel,
    schedule,
    resumeNow,
    STAGGER,
    MESSAGE: RESUME,
  };
})();
