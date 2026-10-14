// Technically Not tools · desktop-check/tests/thread-late-answer.js — an answer that is written
// into the tool's record AFTER the app last read it appears in the conversation by itself
// (src/scripts/122-thread-readable.js, the watch in desktop/thread-log.js). Found with a real
// agent on 2026-10-12: the answer of a two-second first task stood unseen until the next prompt.
//
// One Claude Code session is started (no prompt is sent, so no usage is spent) and given a
// made-up conversation that holds the prompt only. Two seconds later, with no task event and no
// prompt, the answer and the task's length are appended to the record, as the tool does. Checked:
// they appear in the open thread within three seconds; the same for a second answer on the
// thread's card on the All threads page; and nothing was sent to the session meanwhile.
// Pictures: thread-late-answer-thread, thread-late-answer-card. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const shot = async name => {
  await wait(400);
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const shown = el => !!el && el.isConnected && el.getClientRects().length > 0;

// Claude Code's screen, read to answer its folder-trust question and to see its empty prompt.
async function screenOf(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const scratch = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => scratch.write(replay.buffer, done));
  const rows = [];
  const buffer = scratch.buffer.active;
  for (let row = 0; row < scratch.rows; row++)
    rows.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) || '');
  scratch.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await screenOf(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const chosen = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(chosen) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

const said = (id, text) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content: [{ type: 'text', text }] },
});
const ended = ms => ({ type: 'system', subtype: 'turn_duration', durationMs: ms });
let paneId = '';

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  check(
    typeof native.threadLog?.onChange === 'function',
    'the window can be told that a conversation has grown'
  );
  await agents.detect(true);
  await main('size', 1440, 900);
  paneId = (await openThread('Claude Code'))?.paneId || '';
  const runs = await until(
    () => agents.sessions().find(session => session.paneId === paneId && session.running),
    30000
  );
  if (!runs || !(await ready(paneId))) {
    log.push('note Claude Code did not start on this PC: nothing was checked');
    return { ok: false, log };
  }
  check(
    !!(await main('writeTranscript', paneId, [
      { type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } },
    ])),
    'setup: the session has a made-up conversation that holds the prompt only'
  );

  // ---- the open thread ----
  threads.show(paneId);
  const island = threads.slot('main');
  const blocks = (scope, selector) => [...scope.querySelectorAll('.tnt-talk-list > ' + selector)];
  check(
    !!(await until(() => blocks(island, '.tnt-you').length === 1, 10000)),
    'the open thread shows the prompt'
  );
  await wait(2000);
  check(
    !blocks(island, '.tnt-say').length && !blocks(island, '.tnt-worked').length,
    'two seconds later nothing else is there: the answer is not written yet'
  );
  const turnBefore = JSON.stringify(window.TnaiTurns?.get?.(paneId) || null);
  const wroteAt = Date.now();
  await main('appendTranscript', paneId, [said('msg_first', 'ok'), ended(2000)]);
  const first = await until(
    () => blocks(island, '.tnt-say').find(block => /\bok\b/.test(block.innerText)),
    3000
  );
  check(
    !!first,
    'the answer written afterwards appears by itself' +
      (first ? ', ' + (Date.now() - wroteAt) + ' ms after it was written' : '')
  );
  check(
    !!(await until(() => blocks(island, '.tnt-worked').length === 1, 3000)),
    'and the end of the task: "' +
      (blocks(island, '.tnt-worked')[0]?.textContent || '').trim() +
      '"'
  );
  check(
    JSON.stringify(window.TnaiTurns?.get?.(paneId) || null) === turnBefore &&
      document.getElementById('prompt').value === '',
    'no task event came and no prompt was written meanwhile: the push from the record did it'
  );
  await shot('thread-late-answer-thread');

  // ---- the same thread as a card on the All threads page (the route 'terminal' is that page) ----
  window.TnaiRoute('terminal');
  await until(() => window.TnaiAllThreads?.state().on, 8000);
  window.TnaiAllThreads.show(paneId);
  const card = await until(() => {
    const el = document.querySelector('.tat-card[data-pane="' + CSS.escape(paneId) + '"]');
    return shown(el) ? el : null;
  }, 8000);
  check(
    !!card && !!(await until(() => blocks(card, '.tnt-say').length === 1, 8000)),
    "the thread's card on the All threads page shows the conversation so far"
  );
  await wait(2000);
  const wroteCardAt = Date.now();
  await main('appendTranscript', paneId, [
    { type: 'user', message: { role: 'user', content: 'And once more.' } },
    said('msg_second', 'ok again'),
    ended(3000),
  ]);
  const second = await until(
    () => blocks(card, '.tnt-say').find(block => /ok again/.test(block.innerText)),
    3000
  );
  check(
    !!second,
    'an answer written afterwards appears on the card by itself' +
      (second ? ', ' + (Date.now() - wroteCardAt) + ' ms after it was written' : '')
  );
  check(
    !!(await until(() => blocks(card, '.tnt-worked').length === 2, 3000)),
    'with the end of that task'
  );
  await shot('thread-late-answer-card');
  window.TnaiThreads.open();
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
if (paneId) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
return { ok, log };
