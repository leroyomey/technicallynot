// Technically Not tools · desktop-check/tests/real-thread-tool.js — A REAL session of one agent
// tool other than Claude Code in the thread layout's Readable view (122, desktop/thread-log.js):
// Codex, OpenCode or Cursor Agent, named in the environment (TNAI_THREAD_TOOL, default Codex). One
// prompt that needs no tool ("reply with two words"), so it costs as little as that tool can.
//
// What it proves is the one link the plain Node test cannot: that the app finds the record of a
// LIVE session of that tool (its rollout, its database rows, its transcript) from the panel alone,
// and that the conversation appears in the thread: your prompt as written, the reply, the end of
// the task. Actions and their results are proven on recorded real sessions by the Node test's
// readers. A tool that is not installed or not signed in is reported as such, not failed.
// Run alone, with TNAI_CHECK_LIMIT_MS=400000. Picture: real-thread-tool-<tool>.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents,
  threads = window.TnaiThreads,
  view = () => window.TnaiThreadView,
  readable = () => window.TnaiThreadReadable;
const shown = el => !!el && el.getClientRects().length > 0;
let paneId = '';

try {
  const tool = await main('tool');
  await agents.detect(true);
  const info = (agents.info?.() || []).find(a => a.id === tool || a.name === tool);
  note(tool + ' on this PC: ' + (agents.describe?.(tool) || JSON.stringify(info || 'not found')));
  check(readable().can(tool), 'the app has a reader for ' + tool);
  threads.open();
  await until(() => threads.visible(), 5000);

  // ---- start the tool, as a thread ----
  // Codex on its cheapest model and lowest effort, as the other real tests start it.
  if (tool === 'Codex')
    window.TnaiLaunchPrefs?.once('Codex', { model: 'gpt-6-luna', effort: 'low' });
  paneId = (await window.TnaiTest.open(tool)).paneId;

  // the app asks before a tool may work in a folder it does not trust yet: say yes for the
  // throwaway project
  const running = await until(() => {
    document.querySelector('.tnai-panel-confirm .tnai-ws-close-confirm')?.click();
    return agents.sessions().find(s => s.paneId === paneId && s.running);
  }, 40000);
  if (!running) {
    note(
      tool + ' did not start (not installed, or it needs a sign-in): its thread was not visited'
    );
    return { ok, log };
  }
  check(true, tool + ' started');

  // A full-screen tool (OpenCode) has no readable rows while it starts, so "still" alone says
  // nothing: it gets time to draw first, and then the app's own status must say it waits for input.
  await wait(9000);
  const panel = document.querySelector('.terminal-pane[data-pane-id="' + paneId + '"]');
  await until(() => panel?.dataset.status === 'waiting', 30000);

  // no sign of readiness is common to every tool: its screen has been still for a moment
  let last = '',
    still = 0;
  await until(async () => {
    const tail = (agents.tail?.(paneId, 6) || []).join('|');

    // A tool's own start-up questions in a new folder are skipped with Esc where the tool offers
    // that ("esc skip": Codex's question about the folder's hooks, its update offer); never
    // answered with a yes.
    if (/esc skip/i.test(tail)) {
      window.tnaiNative.pty.write(paneId, '\x1b');
      await wait(1500);
      still = 0;
      return false;
    }
    still = tail === last ? still + 1 : 0;
    last = tail;
    await wait(900);
    return still >= 3;
  }, 30000);
  note(
    'its screen ends with: ' +
      JSON.stringify((agents.tail?.(paneId, 3) || []).map(r => r.slice(0, 80)))
  );

  // ---- its thread opens as Readable ----
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(paneId);
  check(!!(await until(() => view().shown() === paneId, 8000)), 'its thread is open');
  const island = threads.slot('main'),
    talk = island.querySelector('.tnt-talk'),
    blocks = sel => [...talk.querySelectorAll('.tnt-talk-list > ' + sel)];
  check(
    view().mode() === 'read' &&
      shown(talk) &&
      window.TnaiThreadMore.rows().some(row => row.id === 'screen'),
    'a ' + tool + ' thread opens as its conversation, with "CLI screen" in its "..." menu'
  );
  check(!shown(island.querySelector('.tnt-plain')), 'and no sentence says it has no record');

  // ---- one prompt that needs no tool ----
  const PROMPT = 'Reply with exactly these two words and nothing else: thread ok';
  const prompt = document.getElementById('prompt');
  prompt.value = PROMPT;
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  document.getElementById('send').click();
  const bubble = await until(() => blocks('.tnt-you').pop(), 60000);
  check(
    !!bubble && bubble.textContent === PROMPT,
    'the prompt is in the conversation as written: "' +
      (bubble?.textContent || 'no bubble').slice(0, 70) +
      '"'
  );
  if (!bubble) {
    // one run names the cause: what the app knows of the task, and what the tool's own terminal
    // shows (it may be asking for a sign-in or a model)
    const turn = window.TnaiTurns?.get?.(paneId);
    note(
      'the app knows of this task: ' +
        JSON.stringify(
          turn && { startedAt: turn.startedAt, endedAt: turn.endedAt, source: turn.source }
        )
    );
    view().setMode('term');
    await wait(3500);
    const term = view().term();
    const rows = [];
    if (term)
      for (let y = 0; y < term.rows; y++) {
        const row = term.buffer.active.getLine(term.buffer.active.viewportY + y);
        const text = row?.translateToString(true).trim();
        if (text) rows.push(text.slice(0, 90));
      }
    note('its terminal shows: ' + JSON.stringify(rows.slice(-12)));
    await frame();
    console.log('TNAI_SHOT:real-thread-tool-stuck');
    await wait(700);
    throw new Error('the prompt did not reach the conversation');
  }
  const said = await until(
    () => blocks('.tnt-say').find(block => /thread ok/i.test(block.innerText)),
    120000
  );
  check(
    !!said,
    'the reply is in the conversation: "' +
      (said?.innerText || 'no reply').trim().slice(0, 60) +
      '"'
  );
  const ended = await until(() => blocks('.tnt-worked').pop(), 30000);
  check(
    !!ended,
    'the task ends with "' + (ended?.querySelector('span')?.textContent || 'no row') + '"'
  );
  note('the pane holds ' + JSON.stringify(readable().state()));
  note(
    'top row: "' +
      island.querySelector('.tnt-head-line').textContent.trim() +
      '" · state "' +
      island.querySelector('.tnt-head-state').textContent.trim() +
      '"'
  );
  await frame();
  console.log('TNAI_SHOT:real-thread-tool-' + tool.toLowerCase().replace(/[^a-z]+/g, '-'));
  await wait(700);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
if (paneId) {
  await agents.stop(paneId);
  await until(() => !agents.sessions().find(s => s.paneId === paneId)?.running, 10000);
}
return { ok, log };
