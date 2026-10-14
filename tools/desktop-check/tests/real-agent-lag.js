/*
 * Technically Not tools · desktop-check/tests/real-agent-lag.js — Lag while a REAL agent works on a
 * REAL code base. Run with -RealProject (the project is a throwaway copy of this repo, run.js).
 * Starts Claude Code in a pane (answers the folder-trust question; tool permissions are allowed
 * once, it's a copy), sends one real read-only request about Technically Not's own code (uses the
 * user's Claude usage), and while it works rotates Overview → Terminal → Agents, typing real keys
 * into the composer on each. Per page: key latency p50/p95/max, long tasks (count, total, worst)
 * and the longest gap between frames. A CPU profile of the renderer and main process covers the
 * whole turn. Soft limits (FAIL lines): key p95 < 50 ms, worst long task < 200 ms, frame gap < 250
 * ms. Hard cap: 5 min, then it stops the pane and reports what it has.
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
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'r' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 30000);
  });
let inputId = 0;
const input = events =>
  new Promise(resolve => {
    const id = ++inputId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = resolve;
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const G = window.TnaiAgents,
  N = window.tnaiNative;
const go = async view => {
  document.querySelector('.side-item[data-view="' + view + '"]').click();
  await wait(300);
};
const prompt = document.getElementById('prompt');
const plain = s =>
  String(s || '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\s+/g, ' ');
const squash = s => plain(s).replace(/\s+/g, '');
let paneId = '';
const tail = async (n = 4000) => String((await N.pty.replay(paneId))?.buffer || '').slice(-n);

// The pane's current screen as text rows: its replay played into an off-screen xterm of the same
// size (never opened, so nothing is drawn).
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
const HARD_CAP = Date.now() + 5 * 60e3;
const REQUEST =
  'Read the Technically Not code in this project and explain, in about 10 lines, what happens to one chunk of terminal output from the moment node-pty emits it ' +
  'in desktop/pty-service.js until it is drawn on the Terminal page and mirrored on the Agents page (src/scripts). Name the functions and files involved and ' +
  'point out anything that runs per chunk and could cause UI lag. Do not edit, create or delete any files.';
let offPerm = null,
  offTurn = null;

try {
  const files = (await N.fs.list?.('src/scripts'))?.length ?? '?';
  log.push('project: ' + JSON.stringify(await N.fs.root()) + ' · src/scripts entries: ' + files);

  // 1. Claude Code in a pane.
  paneId = (await window.TnaiTest.open('Claude Code')).paneId;
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 20000)),
    'Claude Code started'
  );
  offPerm = N.permissions?.on?.(p => {
    if (p?.id && !p.done && p.paneId === paneId) {
      log.push(
        '     allowed once: ' + (p.tool || '') + ' ' + plain(p.detail || p.input || '').slice(0, 80)
      );
      N.permissions.answer(p.id, 'once');
    }
  });

  // Claude Code redraws only changed cells (the "❯" moves on its own), so the raw output can't say
  // which option is selected: the replay is played into an off-screen xterm of the pane's size and
  // the visible rows are read. Trust screen (default "❯ No, exit"): Down until the "❯" row is "Yes,
  // I trust this folder", then Enter. Ready = the idle input prompt ("? for shortcuts", or the mode
  // line "… (shift+tab to cycle)") with no trust question showing.
  let trusted = false,
    actedAt = 0;
  const ready = await until(async () => {
    if (!G.sessions().find(s => s.paneId === paneId)?.running)
      throw new Error('Claude Code exited: ' + (await screen()).join(' | ').slice(-400));
    if (Date.now() - actedAt < 700) return false; // let the CLI redraw after a key
    const rows = await screen(),
      text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const sel = rows.find(r => r.includes('❯')) || '';
      actedAt = Date.now();
      if (/Yes/i.test(sel)) {
        N.pty.write(paneId, '\r');
        trusted = true;
        log.push('     accepted the folder-trust question ("' + sel.trim() + '")');
      } else N.pty.write(paneId, '\x1b[B');
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle/i.test(text);
  }, 60000);
  check(!!ready, 'Claude Code is ready for a prompt');
  if (!ready)
    throw new Error(
      'Claude Code never became ready; screen: ' +
        (await screen()).filter(Boolean).join(' | ').slice(-500)
    );

  // 2. One real request; its end comes from the turn events (agent-turns.js).
  let sentAt = 0,
    turn = null;
  offTurn = N.agentTurns.on(t => {
    if (t?.paneId === paneId && sentAt && t.startedAt >= sentAt - 2000) {
      turn = t;
    }
  });
  await main('profileStart');
  sentAt = Date.now();
  check(G.send(paneId, REQUEST), 'real request sent to Claude Code');
  const started = await until(() => turn && !turn.endedAt, 20000);
  check(!!started, 'the turn started (hook/transcript events arrived)');
  if (!started)
    throw new Error(
      'the request never started a turn; screen: ' + squash(await tail()).slice(-300)
    );

  // 3. While it works: rotate pages; on each, type real keys and watch long tasks and frame gaps.
  const stats = {},
    text = 'measure typing while the agent works ';
  const long = [];
  const po = new PerformanceObserver(l =>
    l.getEntries().forEach(e => long.push({ at: e.startTime, d: e.duration }))
  );
  po.observe({ type: 'longtask' });
  let round = 0;
  const STATES = ['normal', 'maximized', 'fullscreen'];
  while (
    !turn?.endedAt &&
    Date.now() < HARD_CAP &&
    G.sessions().find(s => s.paneId === paneId)?.running
  ) {
    const view = ['overview', 'terminal', 'agents'][round % 3],
      state = STATES[Math.floor(round / 3) % 3];
    round++;
    if (round % 3 === 1) {
      await main('winState', state);
      await wait(600);
    } // each window state gets a full page rotation
    await go(view);
    const key = view + ' · ' + state,
      s = (stats[key] = stats[key] || { rounds: 0, lates: [], long: [], gap: 0 });
    s.rounds++;
    const t0 = performance.now();
    let last = t0,
      gapOn = true;
    const raf = () => {
      const n = performance.now();
      s.gap = Math.max(s.gap, n - last);
      last = n;
      if (gapOn) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    prompt.focus();
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const onKey = e => s.lates.push(performance.now() - e.timeStamp);
    prompt.addEventListener('keydown', onKey);
    const keys = [];
    for (const ch of text) {
      const code = ch === ' ' ? 'Space' : ch.toUpperCase();
      keys.push(
        { type: 'keyDown', keyCode: code, wait: 5 },
        { type: 'char', keyCode: ch, wait: 5 },
        { type: 'keyUp', keyCode: code, wait: 60 }
      );
    }
    if (document.activeElement === prompt) await input(keys);
    await wait(3000); // just watching the page with live output
    gapOn = false;
    prompt.removeEventListener('keydown', onKey);
    s.long.push(...long.filter(x => x.at >= t0).map(x => x.d));
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  }
  po.disconnect();
  const p = await main('profileStop');

  // Minimized → restored (on the Agents page, output still arriving if the turn runs): time to the
  // first frame, and long tasks right after (own profile).
  await main('winState', 'normal');
  await go('agents');
  await main('winState', 'minimized');
  await wait(3000);
  await main('profileStart');
  const r0 = performance.now(),
    restoreLong = [];
  const po2 = new PerformanceObserver(l =>
    l.getEntries().forEach(e => restoreLong.push(e.duration))
  );
  po2.observe({ type: 'longtask' });
  await main('winState', 'normal');
  await new Promise(r => requestAnimationFrame(() => r()));
  const firstFrame = performance.now() - r0;
  await wait(1500);
  po2.disconnect();
  log.push(
    'restore from minimized: first frame ' +
      Math.round(firstFrame) +
      ' ms after restore returned; long tasks in 1.5 s: ' +
      restoreLong.length +
      ' (worst ' +
      Math.round(Math.max(0, ...restoreLong)) +
      ' ms)'
  );
  check(Math.max(0, ...restoreLong) < 200, 'restore from minimized: no long task over 200 ms');
  const restoreProfile = await main('profileStop');
  const finished = !!turn?.endedAt;
  check(
    finished,
    'the real request finished within 5 min' +
      (finished
        ? ' (' +
          Math.round((turn.endedAt - turn.startedAt) / 1000) +
          ' s' +
          (turn.tokens ? ', tokens ' + JSON.stringify(turn.tokens) : '') +
          ')'
        : '')
  );

  // 4. Numbers.
  for (const [view, s] of Object.entries(stats)) {
    const l = s.lates.sort((a, b) => a - b),
      q = x => Math.round(l[Math.min(l.length - 1, Math.floor(l.length * x))] || 0);
    const r = {
      rounds: s.rounds,
      keys: l.length,
      p50: q(0.5),
      p95: q(0.95),
      max: Math.round(l[l.length - 1] || 0),
      longTasks: s.long.length,
      longMs: Math.round(s.long.reduce((a, b) => a + b, 0)),
      worst: Math.round(Math.max(0, ...s.long)),
      frameGap: Math.round(s.gap),
    };
    log.push(view + ': ' + JSON.stringify(r));
    check(r.p95 < 50, view + ': key latency p95 ' + r.p95 + ' ms < 50');
    check(r.worst < 200, view + ': worst long task ' + r.worst + ' ms < 200');
    check(r.frameGap < 250, view + ': longest frame gap ' + r.frameGap + ' ms < 250');
  }
  for (const k of ['renderer', 'main'])
    log.push(
      '--- ' + k + ' CPU over the whole turn (' + p[k].total + ' ms sampled) by file:',
      ...p[k].files,
      '--- by function:',
      ...p[k].fns,
      '--- callers:',
      ...p[k].callers
    );
  if (restoreProfile)
    log.push(
      '--- renderer CPU during restore from minimized (' +
        restoreProfile.renderer.total +
        ' ms sampled):',
      ...restoreProfile.renderer.fns.slice(0, 10),
      '--- callers:',
      ...restoreProfile.renderer.callers
    );
  const answer = plain((await N.pty.replay(paneId))?.buffer);
  log.push('     answer tail: ' + answer.slice(-400));
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
try {
  offPerm?.();
  offTurn?.();
} catch {}
if (paneId) {
  G.stop(paneId);
  await until(
    async () => !(await N.pty.list()).some(x => (x.paneId || x.id || x) === paneId),
    8000
  );
}
return { ok, log };
