// Technically Not tools · desktop-check/tests/thread-open-end.js — a thread opens at its newest
// line. Two real Claude Code panels are started (nothing is sent to them, so no usage is spent),
// each gets a long made-up conversation, and each is opened for the first time and then again
// after the other one. Every time, the conversation must be at its end (and "Latest" hidden) a
// moment after the press and still there once everything has been drawn.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
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
const native = window.tnaiNative;
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;

const PANELS = 2;
const ROUNDS = 60;

// Claude Code at its prompt (its trust question is answered on the way).
async function replayed(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return '';
  const terminal = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => terminal.write(replay.buffer, done));
  const rows = [];
  for (let y = 0; y < terminal.rows; y++) {
    const line = terminal.buffer.active.getLine(terminal.buffer.active.baseY + y);
    rows.push(line?.translateToString(true) || '');
  }
  terminal.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await replayed(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const chosen = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(chosen) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

// A long conversation whose blocks are of very different heights: a prompt, two tool steps and a
// long answer with a report, ROUNDS times.
function longTranscript(name) {
  const lines = [];
  let step = 0;
  const use = (tool, input) => {
    step++;
    lines.push({
      type: 'assistant',
      message: {
        id: 'msg_use_' + step,
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't' + step, name: tool, input }],
      },
    });
    return 't' + step;
  };
  const gave = (id, toolUseResult) =>
    lines.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
      ...(toolUseResult ? { toolUseResult } : {}),
    });
  for (let round = 1; round <= ROUNDS; round++) {
    lines.push({
      type: 'user',
      message: { role: 'user', content: '[TN.ai] ' + name + ', task ' + round + ': fix the cart.' },
    });
    gave(use('Read', { file_path: 'src/cart/total-' + round + '.js' }));
    gave(use('Bash', { command: 'npm test', description: 'Run every test' }), {
      stdout: '26 passed',
      stderr: '',
    });
    lines.push({
      type: 'assistant',
      message: {
        id: 'msg_say_' + round,
        role: 'assistant',
        content: [
          {
            type: 'text',
            text:
              'The total was rounded before the tax was added.\n\n'.repeat(1 + (round % 4)) +
              'Done:\n- moved the rounding to the end\n- added a test\n\n' +
              'Technically Not report\n- Did: fixed the cart total of task ' +
              round +
              '\n- Changed: src/cart/total-' +
              round +
              '.js\n- Remains: the footer',
          },
        ],
      },
    });
  }
  return lines;
}

const gapToEnd = host => Math.round(host.scrollHeight - host.scrollTop - host.clientHeight);

try {
  threads.open();
  await until(() => threads.visible(), 5000);
  const ids = [];
  for (let count = 0; count < PANELS; count++) {
    const made = await window.TnaiTest.startThread({ tool: 'Claude Code' }).catch(() => null);
    const id = made?.paneId;
    if (!id) break;
    await until(() => agents.sessions().find(s => s.paneId === id && s.running), 30000);
    if (!(await ready(id))) break;
    ids.push(id);
  }
  if (ids.length < PANELS) {
    check(false, 'Claude Code started ' + PANELS + ' times on this PC');
    throw new Error('stopped');
  }
  for (const [index, id] of ids.entries())
    check(
      !!(await main('writeTranscript', id, longTranscript('thread ' + (index + 1)))),
      'a long made-up conversation stands for thread ' + (index + 1)
    );
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const island = threads.slot('main');
  const host = () => island.querySelector('.tnt-talk');
  const latest = () => island.querySelector('.tnt-jump-btn[data-jump="latest"]');
  const drawn = id => () =>
    view().shown() === id && view().mode() === 'read' && !!host()?.querySelector('.tnt-report');

  // first opening of each, then each again after the other
  const order = [...ids, ...ids, ...ids];
  for (const [at, id] of order.entries()) {
    const label = (at < ids.length ? 'first opening' : 'opened again') + ' of thread ' + id;
    threads.select(id);
    await until(drawn(id), 8000);
    await wait(150);
    const soon = gapToEnd(host());
    await wait(1500);
    const later = gapToEnd(host());
    log.push('note ' + label + ': ' + soon + ' px from the end at once, ' + later + ' px later');
    check(
      soon < 48 && later < 48 && latest()?.hidden !== false,
      label + ' shows its newest line (' + soon + ' / ' + later + ' px from the end)'
    );
  }
} catch (error) {
  if (error?.message !== 'stopped') check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  agents.sessions().forEach(session => agents.stop(session.paneId));
  await until(() => !agents.sessions().some(session => session.running), 15000);
  await main('cleanup').catch(() => {});
}
return { ok, log };
