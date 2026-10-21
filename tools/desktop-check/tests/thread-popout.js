// Technically Not tools · desktop-check/tests/thread-popout.js — threads popped out into windows
// of their own, worked in together with a thread still in the app (162-thread-popout.js; user,
// 2026-10-21: "Yes, build it as shown").
//
// Three real Claude Code panels are started and get no prompt: their conversations are made-up
// transcripts (thread-helpers.main.js writes them where the app looks), and every answer is caught
// at `TnaiAgents.send`, so nothing reaches a CLI. Pop-outs are created hidden and never take the
// keyboard (quiet-window.js). Checked:
// 1. Two threads popped out: each window shows its conversation; the app shows "… is in its own
//    window" in their place, the list marks them, the menu offers "Back into the app".
// 2. A prompt typed in each window goes to that thread only; the main prompt box sends to the
//    thread left in the app; the main box's text and target are left alone by the windows.
// 3. A decision pressed in a window answers that thread.
// 4. "Back into the app" and closing a window each bring the conversation back where it was.
// Returns {ok, log}.
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
    await wait(50);
  }
  return null;
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
const view = () => window.TnaiThreadView;
const popout = () => window.TnaiThreadPopout;

// Claude Code's screen, replayed into a scratch terminal: only to answer its folder-trust
// question and to see that it reached its empty prompt.
async function replayed(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const screen = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => screen.write(replay.buffer, done));
  const buffer = screen.buffer.active;
  const rows = [];
  for (let y = 0; y < screen.rows; y++)
    rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '');
  screen.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await replayed(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const selected = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(selected) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

// ---------- the made-up conversations ----------
const iso = ms => new Date(ms).toISOString();
let messageCount = 0;
const prompt = (at, text) => ({
  type: 'user',
  timestamp: iso(at),
  message: { role: 'user', content: text },
});
const said = (at, text) => ({
  type: 'assistant',
  timestamp: iso(at),
  message: {
    id: 'msg_popout_' + ++messageCount,
    role: 'assistant',
    content: [{ type: 'text', text }],
  },
});
const QUESTION = 'Ship the card as it is?';
const conversation = (task, reply, decide) => {
  const at = Date.now() - 60000;
  return [
    prompt(at, '[TN.ai] ' + task),
    said(
      at + 20000,
      reply +
        '\n\nTechnically Not report\n- Did: ' +
        task.toLowerCase() +
        (decide
          ? '\n\n- Decide: ' + QUESTION + ' | 1. Yes, ship it (recommended) | 2. Not yet'
          : '')
    ),
  ];
};

const windowOf = paneId =>
  window.TnaiPopout?.window?.('thread-' + String(paneId).replace(/[^\w-]/g, '_')) || null;
const docOf = paneId => windowOf(paneId)?.document || null;
const mainTalk = () => threads.slot('main')?.querySelector('.tnt-talk');

async function startThread(task, reply, decide) {
  const opened = await window.TnaiTest.open('Claude Code');
  const paneId =
    opened?.paneId ||
    (await until(() => agents.sessions().find(session => !started.includes(session.paneId))))
      ?.paneId ||
    '';
  started.push(paneId);
  const running = await until(
    () => agents.sessions().find(session => session.paneId === paneId && session.running),
    30000
  );
  if (!running || !(await ready(paneId))) return '';
  await main('writeTranscript', paneId, conversation(task, reply, decide));
  return paneId;
}

const started = [];
const sent = [];
const realSend = agents.send;
try {
  threads.open();
  await until(() => threads.visible(), 5000);
  await main('size', 1440, 900);
  const one = await startThread(
    'Make the settings one card',
    'Settings now sit in one card.',
    true
  );
  const two = await startThread('Fix the flaky login test', 'The test now waits for its event.');
  const three = await startThread('Write the release notes', 'The notes are written.');
  if (!one || !two || !three) {
    log.push('note Claude Code did not start three times on this PC: nothing was checked');
    return { ok, log };
  }

  // every answer stops here: nothing reaches a CLI
  agents.send = (paneId, text, options) => {
    sent.push({ paneId, text: String(text) });
    return true;
  };

  // ---- 1. two threads out ----
  threads.select(one);
  await until(
    () => view().shown() === one && /one card/.test(mainTalk()?.textContent || ''),
    12000
  );
  check(popout()?.can(one), 'setup: a Claude Code thread can have a window of its own');
  check(popout().open(one) === true, 'the first thread pops out');
  check(popout().open(two) === true, 'the second thread pops out');
  const firstShown = await until(
    () =>
      /Settings now sit in one card/.test(
        docOf(one)?.querySelector('.tpo-talk')?.textContent || ''
      ),
    10000
  );
  check(!!firstShown, 'the first window shows its conversation');
  const secondShown = await until(
    () => /waits for its event/.test(docOf(two)?.querySelector('.tpo-talk')?.textContent || ''),
    10000
  );
  check(!!secondShown, 'the second window shows its own conversation');
  const away = await until(() => mainTalk()?.querySelector('.tpo-away'), 4000);
  check(
    !!away && /in its own window/.test(away.textContent),
    'the app says the open thread is in its own window'
  );
  const rowOf = paneId => document.querySelector('.tnt-list .tnt-th[data-pane="' + paneId + '"]');
  await until(() => rowOf(one)?.querySelector('.tnt-th-out'), 3000);
  check(
    !!rowOf(one)?.querySelector('.tnt-th-out') &&
      !!rowOf(two)?.querySelector('.tnt-th-out') &&
      !rowOf(three)?.querySelector('.tnt-th-out'),
    'the list marks the two threads that are out, and only those'
  );
  const windows = await main('windows');
  check(
    windows.length >= 2 && windows.every(each => !each.focused),
    'two windows are open and none took the keyboard (' + JSON.stringify(windows) + ')'
  );

  // ---- 2. typing in each window, and in the app ----
  const mainInput = document.getElementById('prompt');
  mainInput.value = 'a draft in the main box';
  mainInput.dispatchEvent(new Event('input', { bubbles: true }));
  threads.select(three);
  await until(() => view().shown() === three, 4000);
  window.TnaiLiveTasks.setTarget(three);
  const typeIn = async (paneId, words) => {
    const input = docOf(paneId).querySelector('.tpo-input');
    input.value = words;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return until(() => sent.find(each => each.text.includes(words)), 6000);
  };
  const fromOne = await typeIn(one, 'Hello from the first window');
  check(fromOne?.paneId === one, 'a prompt typed in the first window goes to its thread');
  const fromTwo = await typeIn(two, 'Hello from the second window');
  check(fromTwo?.paneId === two, 'a prompt typed in the second window goes to its thread');
  check(
    mainInput.value === 'a draft in the main box' && window.TnaiLiveTasks.target() === three,
    'the main prompt box keeps its draft and its thread'
  );
  mainInput.value = 'Hello from the app';
  mainInput.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('send').click();
  const fromApp = await until(
    () => sent.find(each => each.text.includes('Hello from the app')),
    6000
  );
  check(fromApp?.paneId === three, 'the main prompt box sends to the thread left in the app');

  // ---- 3. a decision pressed in a window ----
  const decide = await until(
    () => docOf(one)?.querySelector('.tnt-report .tnt-decide button:not(:disabled)'),
    6000
  );
  decide?.click();
  const answer = await until(
    () => sent.find(each => each.paneId === one && /Ship the card/.test(each.text)),
    6000
  );
  check(
    !!answer,
    'a decision pressed in a window answers that thread (' + (answer?.text || 'nothing sent') + ')'
  );
  await wait(200);
  const pressed = [...(docOf(one)?.querySelectorAll('.tnt-report .tnt-decide button') || [])];
  check(
    pressed.length > 0 &&
      pressed.every(button => button.disabled) &&
      pressed.some(button => button.classList.contains('tnt-decide-chosen')),
    'the window marks the decision answered, with the pressed option chosen (a hidden test window may not repaint its picture)'
  );
  check(
    window.TnaiLiveTasks.target() === three,
    'and the main prompt box still sends to the thread left in the app (learned 2026-10-21: the press pointed it at the window’s thread)'
  );
  const markRect = rowOf(one)?.querySelector('.tnt-th-out')?.getBoundingClientRect();
  const wordsRect = rowOf(one)
    ?.querySelector('.tnt-th-inf:not([hidden]), small')
    ?.getBoundingClientRect();
  check(
    !!markRect &&
      !!wordsRect &&
      (markRect.bottom <= wordsRect.top ||
        markRect.left >= wordsRect.right ||
        markRect.top >= wordsRect.bottom),
    'the list mark lies over none of the row’s words'
  );
  await main('shotWindow', window.TnaiThreadList.thread(one)?.name || '', 'thread-popout-window');
  await window.TnaiTest?.shot?.('thread-popout-app');

  // ---- 4. back into the app, and a window closed ----
  threads.select(one);
  await until(() => view().shown() === one, 4000);
  popout().back(one);
  const backInApp = await until(
    () =>
      /Settings now sit in one card/.test(mainTalk()?.textContent || '') &&
      !mainTalk()?.querySelector('.tpo-away'),
    6000
  );
  check(!!backInApp, '"Back into the app" shows the conversation in the app again');
  check(!windowOf(one) || windowOf(one).closed, 'and its window is gone');
  windowOf(two)?.close();
  const closed = await until(() => !popout().isOut(two), 4000);
  check(!!closed, 'closing a window puts its thread back');
  threads.select(two);
  const secondBack = await until(
    () => view().shown() === two && /waits for its event/.test(mainTalk()?.textContent || ''),
    6000
  );
  check(!!secondBack, 'the closed window’s conversation shows in the app again');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  agents.send = realSend;
  for (const paneId of popout()?.list?.() || []) popout().back(paneId);
}
await main('cleanup').catch(() => {});
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 15000);
await wait(300);
return { ok, log };
