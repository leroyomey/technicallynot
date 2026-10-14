/*
 * Technically Not tools · desktop-check/tests/real-queued.js — A REAL Claude Code agent (Haiku, a
 * few cents of the user's usage) and the "N queued" count. Starts Claude Code in a pane (answers
 * the folder-trust question), switches it to Haiku, sends a long no-tools answer through the
 * composer, then two more prompts while it writes. Claude Code 2.x fires its prompt hook the moment
 * a queued prompt is typed, but answers it only after the running answer ends: the queue must show
 * 1, then 2, stay up while the first answer runs, and empty once Claude starts them. The task clock
 * must not restart when the queued prompts arrive. Samples TnaiTurns every 25 ms. Hard cap: 3 min.
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
  N = window.tnaiNative;
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
const ready = () =>
  until(async () => {
    if (!G.sessions().find(s => s.paneId === paneId)?.running)
      throw new Error('Claude Code exited: ' + (await screen()).join(' | ').slice(-400));
    const rows = await screen(),
      text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const sel = rows.find(r => r.includes('❯')) || '';
      N.pty.write(paneId, /Yes/i.test(sel) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return (
      /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text) &&
      !/Esc to interrupt/i.test(text)
    );
  }, 60000);
const send = async text => {
  const p = document.getElementById('prompt');
  p.value = text;
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  document.getElementById('send').click();
};

try {
  paneId = (await window.TnaiTest.open('Claude Code')).paneId;
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 20000)),
    'Claude Code started'
  );
  check(!!(await ready()), 'Claude Code is ready for a prompt');
  G.send(paneId, '/model haiku');
  await wait(2500);
  check(!!(await ready()), 'switched to Haiku');

  const agentSel = document.querySelector('.tnai-pickers select');
  const opt = [...(agentSel?.options || [])].find(o => o.value.includes(paneId));
  if (opt) {
    agentSel.value = opt.value;
    agentSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const samples = [];
  let last = '';
  const t0 = performance.now();
  const iv = setInterval(() => {
    const t = window.TnaiTurns.get(paneId) || {};
    const s =
      (t.queued || []).length + '|' + (t.startedAt || '') + '|' + (t.endedAt ? 'end' : 'run');
    if (s !== last) {
      samples.push({
        ms: Math.round(performance.now() - t0),
        q: (t.queued || []).length,
        start: t.startedAt,
        ended: !!t.endedAt,
        task: String(t.task || '').slice(0, 40),
      });
      last = s;
    }
  }, 25);
  await send(
    'Without using any tools, count from 1 to 700 in your reply, one number per line, then write DONE.'
  );
  const first = await until(
    () => window.TnaiTurns.get(paneId)?.startedAt && !window.TnaiTurns.get(paneId)?.endedAt,
    30000
  );
  check(!!first, 'first task running');
  const start1 = window.TnaiTurns.get(paneId)?.startedAt;
  await wait(3000);
  await send('Next, reply with the word ONE.');
  await wait(600);
  await send('Then reply with the word TWO.');
  await wait(1500);
  const mid = window.TnaiTurns.get(paneId) || {};
  check(
    (mid.queued || []).length === 2 && !mid.endedAt,
    'both prompts counted as queued while the first answer runs (' + (mid.queued || []).length + ')'
  );
  check(mid.startedAt === start1, 'task clock kept its start when the prompts were queued');
  const pill = [...document.querySelectorAll('[data-pane-id="' + paneId + '"]')]
    .map(e => e.textContent)
    .join(' ');
  check(/2 queued/.test(pill), 'a "2 queued" pill shows on the pane');
  const done = await until(() => {
    const t = window.TnaiTurns.get(paneId);
    return t?.endedAt && /TWO/.test(t.result || '') ? t : null;
  }, 90000);
  clearInterval(iv);
  check(!!done, 'Claude answered the queued prompts');
  check(!(done?.queued || []).length, 'queue empty afterwards');
  const maxQ = Math.max(...samples.map(s => s.q));
  check(maxQ === 2, 'queue peaked at 2 (' + maxQ + ')');
  log.push(
    '     samples (ms, queued, ended, task): ' +
      samples
        .map(s => s.ms + ':' + s.q + (s.ended ? 'E' : 'R') + ':' + s.task.replace(/\s+/g, ' '))
        .join(' → ')
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
if (paneId) {
  G.stop(paneId);
  await until(
    async () => !(await N.pty.list()).some(x => (x.paneId || x.id || x) === paneId),
    8000
  );
}
return { ok, log };
