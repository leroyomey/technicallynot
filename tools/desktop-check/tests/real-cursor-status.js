/*
 * Technically Not tools · desktop-check/tests/real-cursor-status.js — a REAL Cursor Agent that is
 * working must read as working (two prompts on its default model that each run a ~7 s shell
 * command, a few cents of the user's usage). The app learns a Cursor task from Cursor's own chat
 * transcript (agent-turns.js readCursor): this test samples every 500 ms, for a first task (`tnai
 * new cursor TASK`) and for a follow-up sent to the idle panel, the panel status
 * (`TnaiAgents.sessions()`), the task record (`TnaiTurns.get`), main's `turns.busy`, what the
 * transcript on disk holds (read directly, see the .main.js) and whether Cursor's screen shows it
 * working, and prints the timeline. Use after changing readCursor / attachCursor in
 * desktop/agent-turns.js, desktop/cursor-store.js, or when a Cursor Agent update changes when it
 * writes its transcript. Hard cap ~4 min.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const G = window.TnaiAgents,
  N = window.tnaiNative,
  T0 = Date.now();

async function screen(paneId) {
  const r = await N.pty.replay(paneId);
  if (!r?.buffer) return '';
  const vt = new window.Terminal({
    cols: r.cols || 120,
    rows: r.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => vt.write(r.buffer, done));
  const b = vt.buffer.active,
    rows = [];
  for (let y = 0; y < vt.rows; y++)
    rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
  vt.dispose();
  return rows.join('\n');
}
const tailOf = text =>
  text
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .slice(-9)
    .join(' / ');
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(250);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const trust = async () => {
  for (const ask of (await N.trust?.pending?.()) || []) await N.trust.answer(ask.id, true);
};
const statusOf = paneId => G.sessions().find(s => s.paneId === paneId)?.status;
const WORKING = /ctrl\+c to stop/i; // Cursor's own line while a task runs
const sec = ms => (ms / 1000).toFixed(1) + 's';

// Samples one task every 500 ms from `t0` until the transcript holds `turn` finished turns (+3 s),
// at most `capMs`. Prints each change.
async function sample(C, label, t0, turn, capMs) {
  const m = { first: {}, wrong: 0, wrongSpans: [], samples: 0, statusWorking: 0, screenWorking: 0 };
  const mark = (k, at) => {
    if (m.first[k] == null) m.first[k] = at;
  };
  let last = '',
    endSeen = 0,
    wrongFrom = null,
    shots = 0;
  while (Date.now() - t0 < capMs) {
    const at = Date.now() - t0;
    await trust();
    const text = await screen(C),
      status = statusOf(C),
      t = window.TnaiTurns?.get(C);
    const p = await main('peek', C, T0).catch(() => ({}));

    // Cursor removes a turn_ended line when the next prompt comes, so a finished task = its user
    // line is there and the file ends in turn_ended.
    const kinds = p.file?.kinds || [],
      users = kinds.filter(k => k === 'user').length;
    const onScreen = WORKING.test(text),
      inRecord = users >= turn,
      ended = inRecord && /^turn_ended/.test(kinds[kinds.length - 1] || '');
    const appTurn = !!t && t.startedAt >= t0 - 1000,
      appBusy = appTurn && !t.endedAt,
      appEnded = appTurn && !!t.endedAt;
    m.samples++;
    if (onScreen) {
      m.screenWorking++;
      mark('screen working', at);
    }
    if (inRecord) mark('user line in the transcript file', at);
    if (appTurn) mark('task in the app (TnaiTurns)', at);
    if (p.busy) mark('main turns.busy', at);
    if (status === 'working') {
      m.statusWorking++;
      mark('status working', at);
    }
    if (ended) mark('turn_ended in the transcript file', at);
    if (appEnded) mark('task ended in the app', at);

    // Wrong = Cursor's screen says it works, and the app has no running task for it (so the card
    // has no task clock and reads as idle when quiet).
    const wrong = onScreen && !ended && !appBusy;

    // the part the app can know: Cursor has written the prompt down
    if (wrong && inRecord) m.late = (m.late || 0) + 1;
    if (wrong) {
      m.wrong++;
      if (wrongFrom == null) wrongFrom = at;
    } else if (wrongFrom != null) {
      m.wrongSpans.push(sec(wrongFrom) + '-' + sec(at));
      wrongFrom = null;
    }
    if (onScreen && !ended && status !== 'working' && status !== 'needs-you')
      m.statusNotWorking = (m.statusNotWorking || 0) + 1;
    const line =
      'status=' +
      status +
      ' screen=' +
      (onScreen ? 'working' : 'idle') +
      ' app=' +
      (appBusy ? 'busy' : appEnded ? 'ended' : 'none') +
      ' main.busy=' +
      !!p.busy +
      ' file=[' +
      kinds.join(',') +
      ']';
    if (line !== last) {
      log.push('  ' + label + ' +' + sec(at) + ' ' + line);
      last = line;
    }
    if (onScreen && shots < 1) {
      shots++;
      log.push('       screen while working: ' + tailOf(text).slice(-420));
    }
    if (ended && appEnded && !onScreen) {
      if (!endSeen) endSeen = Date.now();
      if (Date.now() - endSeen >= 3000) break;
    }
    await wait(500);
  }
  if (wrongFrom != null) m.wrongSpans.push(sec(wrongFrom) + '-end');
  log.push(
    '  ' +
      label +
      ' first seen: ' +
      Object.entries(m.first)
        .map(([k, v]) => k + ' +' + sec(v))
        .join(' · ')
  );
  log.push(
    '  ' +
      label +
      ' samples ' +
      m.samples +
      ': screen working ' +
      m.screenWorking +
      ', status working ' +
      m.statusWorking +
      ', screen working without a running task in the app ' +
      m.wrong +
      (m.wrongSpans.length ? ' (' + m.wrongSpans.join(', ') + ')' : '') +
      ', screen working with a status other than working ' +
      (m.statusNotWorking || 0)
  );
  return m;
}
const TASK = n =>
  'Check of status, change no files. Run the shell command: ping -n 8 127.0.0.1 and then reply with only the number ' +
  n;
const started = [];
try {
  window.TnaiRoute('terminal');
  await wait(400);
  const S = (await G.open('Terminal'))?.paneId;
  started.push(S);
  check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );
  N.pty.write(S, 'tnai new cursor --name "Cursor status test" "' + TASK(1) + '"\r');
  const C = await until(async () => {
    await trust();
    return G.sessions().find(s => s.agent === 'Cursor Agent' && s.running)?.paneId;
  }, 40000);
  if (C) started.push(C);
  check(!!C, 'tnai new opened a Cursor Agent panel');
  if (C) {
    // First task: time counts from the moment its text is on Cursor's screen (the paste), a little
    // before its Enter.
    const typed = await until(async () => {
      await trust();
      return /reply with only the number 1/.test((await screen(C)).replace(/\s+/g, ' '));
    }, 50000);
    check(!!typed, 'the first task reached Cursor');
    const a = await sample(C, 'first', Date.now(), 1, 90000);
    check(a.first['turn_ended in the transcript file'] != null, 'first task ran to its end');
    await wait(1500);
    log.push(
      '  between: status=' + statusOf(C) + ' screen: ' + tailOf(await screen(C)).slice(-300)
    );

    // Follow-up to the running, idle panel.
    const t1 = Date.now();
    N.pty.submit(C, TASK(2)).then(
      r =>
        log.push('  follow-up submit answered +' + sec(Date.now() - t1) + ': ' + JSON.stringify(r)),
      e => log.push('  follow-up submit failed: ' + e.message)
    );
    const b = await sample(C, 'follow-up', t1, 2, 90000);
    check(b.first['turn_ended in the transcript file'] != null, 'follow-up task ran to its end');
    for (const [name, m] of [
      ['first', a],
      ['follow-up', b],
    ]) {
      check(
        m.screenWorking >= 6,
        name +
          ': Cursor was seen working for 3 s or more (' +
          m.screenWorking +
          ' samples), so the run measured a task'
      );

      // Cursor writes the prompt into its transcript only seconds after it began (its own delay,
      // printed, not failed here); from then on the app must show the task.
      log.push(
        'note ' +
          name +
          ': Cursor worked for ' +
          sec(
            (m.first['user line in the transcript file'] ?? 0) - (m.first['screen working'] ?? 0)
          ) +
          ' before it wrote the prompt into its transcript; the app has no task for it in that time (' +
          m.wrong +
          ' samples of 500 ms without one' +
          (m.wrongSpans.length ? ', ' + m.wrongSpans.join(', ') : '') +
          ')'
      );
      check(
        m.first['task in the app (TnaiTurns)'] != null && (m.late || 0) <= 6,
        name +
          ': once the prompt was in the transcript the app had a running task for it within 3 s (samples without one: ' +
          (m.late || 0) +
          '; task in the app +' +
          sec(m.first['task in the app (TnaiTurns)'] ?? -1000) +
          ', user line +' +
          sec(m.first['user line in the transcript file'] ?? -1000) +
          ')'
      );
      check(
        m.first['task ended in the app'] != null &&
          m.first['task ended in the app'] - m.first['turn_ended in the transcript file'] <= 3000,
        name +
          ': the task ended in the app within 3 s of turn_ended (+' +
          sec(m.first['task ended in the app'] ?? -1000) +
          ' against +' +
          sec(m.first['turn_ended in the transcript file'] ?? -1000) +
          ')'
      );
      check(
        (m.statusNotWorking || 0) <= 10,
        name +
          ': while Cursor worked the panel status was working (other: ' +
          (m.statusNotWorking || 0) +
          ' samples of 500 ms, 5 s allowed)'
      );
    }
  }
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
