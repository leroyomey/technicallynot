/*
 * Technically Not tools · desktop-check/tests/real-sub-agent-log.js — A REAL Claude Code
 * sub-agent's own activity in the Helpers tab of its lead's thread, live. Run with -RealProject (a
 * throwaway copy of this repo). Starts Claude Code in a terminal panel (answers the folder-trust
 * question; tool permissions allowed once), asks it for ONE sub-agent that runs three slow shell
 * commands (uses the user's Claude usage, a few cents), opens the lead's thread and that sub-agent
 * in its Helpers tab (123), and samples the helper's own conversation (122 draws it from the
 * sub-agent's own record) while it works: its tool steps and its words must grow while the
 * sub-agent is still running, and end with the three steps finished and its own text. The log the
 * app pushes for it (its task, tool calls, results and text) is checked beside that. Hard cap:
 * 4 min.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const G = window.TnaiAgents,
  N = window.tnaiNative,
  T = window.TnaiTeam;
let paneId = '';

async function screen() {
  const r = await N.pty.replay(paneId);
  if (!r?.buffer) return [];
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
  return rows;
}
const HARD_CAP = Date.now() + 4 * 60e3;
const REQUEST =
  'Use the Agent tool exactly once, in the foreground (not in the background), to start one general-purpose sub-agent with this task: ' +
  '"Run these three shell commands one at a time, each as its own tool call, and after each one write one short sentence about what it printed: ' +
  '`sleep 6 && echo alpha`, then `sleep 6 && echo beta`, then `sleep 6 && echo gamma`. Do not read, edit or create any files." ' +
  'Then reply with one line saying the sub-agent finished. Do nothing else.';
let offPerm = null;

// keep it listed after it ends; the page's own "viewed sub stays open" is checked separately
// (agent-team)
T.retireAfter = 600000;

try {
  // Claude Code as a thread, started the way a user starts one (no control of the old page).
  paneId = (await window.TnaiTest.startThread({ tool: 'Claude Code', show: true })).paneId;
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 20000)),
    'Claude Code started'
  );
  offPerm = N.permissions?.on?.(p => {
    if (p?.id && !p.done && p.paneId === paneId) {
      log.push('     allowed once: ' + (p.tool || '') + ' ' + String(p.detail || '').slice(0, 80));
      N.permissions.answer(p.id, 'once');
    }
  });
  let actedAt = 0;
  const ready = await until(async () => {
    if (!G.sessions().find(s => s.paneId === paneId)?.running)
      throw new Error('Claude Code exited: ' + (await screen()).join(' | ').slice(-400));
    if (Date.now() - actedAt < 700) return false;
    const rows = await screen(),
      text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const sel = rows.find(r => r.includes('❯')) || '';
      actedAt = Date.now();
      N.pty.write(paneId, /Yes/i.test(sel) ? '\r' : '\x1b[B');
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle/i.test(text);
  }, 60000);
  check(!!ready, 'Claude Code is ready for a prompt');
  if (!ready) throw new Error('never ready');

  check(G.send(paneId, REQUEST), 'real request sent');
  const sub = await until(
    () =>
      T.state(paneId)?.subs.find(
        s => s.agentId && (s.status === 'running' || s.status === 'starting')
      ),
    90000
  );
  check(
    !!sub,
    'a real sub-agent started: ' + (sub ? sub.description + ' · ' + sub.agentId : 'none')
  );
  if (!sub)
    throw new Error(
      'no sub-agent; screen: ' + (await screen()).filter(Boolean).join(' | ').slice(-500)
    );

  // The lead's thread, then the sub-agent in its Helpers tab (the tab exists only while the thread
  // has helpers). A helper's key there is its call id, or the sub-agent's own key without one.
  const helpers = window.TnaiThreadHelpers;
  const helperKey = String(sub.toolUseId || sub.key || '');
  window.TnaiThreads.open();
  window.TnaiThreads.select(paneId);
  const listed = await until(
    () => helpers.state().pane === paneId && helpers.state().helpers.includes(helperKey),
    8000
  );
  check(
    !!listed,
    'the lead’s thread lists the sub-agent as a helper (' +
      JSON.stringify(helpers.state().helpers) +
      ')'
  );
  helpers.open(helperKey);
  await wait(400);

  // the helper's own conversation, only while it is on screen and is this helper's
  const sideTalk = () => {
    const talk = document.querySelector('.tnt-side-panel .tnt-side-talk');
    return talk?.offsetParent && talk.dataset.helper === helperKey ? talk : null;
  };
  const chip = () =>
    [...document.querySelectorAll('.tnt-side-panel .tnt-side-chip')].find(
      one => one.dataset.key === helperKey
    );

  // what the conversation shows of the sub-agent: its tool steps and its own words
  const steps = () => [...(sideTalk()?.querySelectorAll('.tnt-act') || [])];
  const words = () => [...(sideTalk()?.querySelectorAll('.tnt-say:not([hidden])') || [])];
  const shown = () => steps().length + words().length;
  check(
    !!sideTalk() &&
      !!sideTalk().querySelector('.tnt-talk-list') &&
      chip()?.getAttribute('aria-selected') === 'true' &&
      window.TnaiThreadView.shown() === paneId,
    'the Helpers tab shows the sub-agent’s own conversation beside its lead’s thread'
  );

  // Sample while it runs: page rows, the pushed log, and whether it is still running.
  const samples = [],
    t0 = Date.now();
  let lastRows = -1,
    // lastLog: the newest pushed log (a finished sub-agent's leaves the turn; the page keeps it)
    lastLog = [];
  while (Date.now() < HARD_CAP) {
    const s = T.state(paneId)?.subs.find(x => x.key === sub.key),
      rows = shown();
    const pushedLog = window.TnaiTurns.get(paneId)?.subLog?.[sub.agentId],
      pushed = pushedLog?.length || 0;
    if (pushed) lastLog = pushedLog;
    if (rows !== lastRows) {
      samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1), rows, pushed, status: s?.status });
      lastRows = rows;
    }
    if (!s || s.status === 'done' || s.status === 'failed') break;
    await wait(150);
  }
  if (!samples.length) samples.push({ rows: 0 });
  log.push(
    '     samples (s since first, rows on page, entries pushed, status): ' +
      samples.map(x => x.t + 's:' + x.rows + '/' + x.pushed + ':' + x.status).join(' → ')
  );
  const whileRunning = samples.filter(x => x.status === 'running' && x.rows > 0);
  check(
    new Set(whileRunning.map(x => x.rows)).size >= 3,
    'activity grew live while the sub-agent ran (' + whileRunning.length + ' updates while running)'
  );
  await wait(400); // its last push reaches the page
  const now = window.TnaiTurns.get(paneId)?.subLog?.[sub.agentId];
  if (now?.length) lastLog = now;

  // The conversation is read from the sub-agent's own record, so its last lines can come a moment
  // after the sub-agent is reported as finished.
  const stillRunning = () => steps().filter(line => line.dataset.state === 'running').length;
  await until(() => steps().length >= 3 && !stillRunning() && words().length > 0, 8000);
  check(
    steps().length >= 3 && !stillRunning() && words().length > 0,
    'the conversation ends with its three tool steps finished and its own text (' +
      steps().length +
      ' steps, ' +
      stillRunning() +
      ' still running, ' +
      words().length +
      ' texts)'
  );
  log.push(
    '     steps on the page: ' +
      JSON.stringify(steps().map(line => line.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)))
  );

  // what the app pushed for it (the Details tab shows this log)
  const rows = lastLog.map(x => x.kind + ':' + x.text.slice(0, 60));
  log.push('     final rows: ' + JSON.stringify(rows));
  check(
    rows.filter(r => r.startsWith('tool:')).length >= 3 &&
      rows.some(r => r.startsWith('text:')) &&
      rows[0]?.startsWith('prompt:') &&
      rows.some(r => r.startsWith('result:')),
    'its task, three tool calls with their results, and its own text are in its pushed log'
  );
  console.log('TNAI_SHOT:real-sub-agent-log');
  await wait(500);

  // Closing the Helpers tab: the helper's conversation leaves, the lead's thread stays.
  helpers.close();
  await wait(400);
  check(
    !helpers.state().opened && !sideTalk() && window.TnaiThreadView.shown() === paneId,
    'closing the helper leaves the lead’s thread on screen'
  );
  await until(() => !T.busy(paneId), 60000);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
try {
  offPerm?.();
} catch {}
T.retireAfter = 3000;
if (paneId) {
  G.stop(paneId);
  await until(
    async () => !(await N.pty.list()).some(x => (x.paneId || x.id || x) === paneId),
    8000
  );
}
return { ok, log };
