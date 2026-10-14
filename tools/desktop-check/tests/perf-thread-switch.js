// Technically Not tools · desktop-check/tests/perf-thread-switch.js — how long the thread layout
// takes to answer a press when the threads are long. Three real Claude Code panels are started
// (nothing is sent to them, so no usage is spent) and each gets a made-up conversation of about
// 2,000 steps. Then it times, each several times: going to another thread in the Readable view,
// Readable to Terminal and back, another thread in the Terminal view, and a change of page with
// the app's cross-fade. It prints the middle and the worst time of each; it sets no limit yet
// (the limits come from a baseline measured with the user away).
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

// A window that draws no frames (covered or minimized) never answers requestAnimationFrame: the
// wait is raced with a short timer so the test cannot stand still (it timed out at 405 s once).
const frame = () =>
  Promise.race([new Promise(resolve => requestAnimationFrame(resolve)), wait(150)]);

// Is the page drawing? A real frame within 500 ms and the page visible.
const drawing = async () => {
  const start = performance.now();
  const gotFrame = await Promise.race([
    new Promise(resolve => requestAnimationFrame(() => resolve(true))),
    wait(500).then(() => false),
  ]);
  return {
    ok: gotFrame && document.visibilityState === 'visible',
    text:
      (gotFrame
        ? 'a frame after ' + Math.round(performance.now() - start) + ' ms'
        : 'no frame in 500 ms') +
      ', page ' +
      document.visibilityState,
  };
};

const PANELS = 3;
const ROUNDS = 150;

// Claude Code at its prompt (its trust question is answered on the way).
async function replayed(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const terminal = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => terminal.write(replay.buffer, done));
  const rows = [];
  for (let y = 0; y < terminal.rows; y++)
    rows.push(
      terminal.buffer.active.getLine(terminal.buffer.active.baseY + y)?.translateToString(true) ||
        ''
    );
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

// A long made-up conversation: ROUNDS times a prompt, four tool steps and an answer with a report.
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
      message: {
        role: 'user',
        content: '[TN.ai] ' + name + ', task ' + round + ': make the cart total right and say how.',
      },
    });
    gave(use('Read', { file_path: 'src/cart/total-' + round + '.js' }));
    gave(use('Bash', { command: 'npm test -- cart', description: 'Run the cart tests' }), {
      stdout: '14 passed\n2 failed, 12 passed\n'.repeat(4),
      stderr: '',
    });
    gave(use('Edit', { file_path: 'src/cart/total-' + round + '.js' }), {
      structuredPatch: [{ lines: ['+a', '+b', '+c', '-d', ' e'] }],
      type: 'update',
    });
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
              'The total was rounded before the tax was added, so it came out a cent low on some carts.\n\n' +
              'Done:\n- moved the rounding to the end\n- added a test for a cart of three\n\n' +
              '**1 · the cart total**\n- Outcome: Fixed\n- How we know: the test passes\n\n' +
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

// The time from a press until `shown` holds and that frame is painted.
async function timed(press, shown, limit = 8000) {
  const start = performance.now();
  press();
  while (!shown() && performance.now() - start < limit) await frame();
  await frame();
  return performance.now() - start;
}
const middle = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const say = (label, list) =>
  log.push(
    'time ' +
      label +
      ': middle ' +
      Math.round(middle(list)) +
      ' ms, worst ' +
      Math.round(Math.max(...list)) +
      ' ms (' +
      list.map(Math.round).join(', ') +
      ')'
  );

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
  threads.open();
  await until(() => threads.visible(), 5000);
  const ids = [];
  for (let count = 0; count < PANELS; count++) {
    const before = new Set(agents.sessions().map(session => session.paneId));
    const opened = await openThread('Claude Code');
    const id =
      opened?.paneId ||
      (await until(() => agents.sessions().find(session => !before.has(session.paneId))))?.paneId;
    if (!id) break;
    await until(() => agents.sessions().find(s => s.paneId === id && s.running), 30000);
    if (!(await ready(id))) break;
    ids.push(id);
  }
  if (ids.length < PANELS) {
    log.push('note Claude Code did not start ' + PANELS + ' times on this PC: nothing was timed');
    return { ok, log };
  }
  let steps = 0;
  for (const [index, id] of ids.entries()) {
    const lines = longTranscript('thread ' + (index + 1));
    steps = lines.length;
    check(
      !!(await main('writeTranscript', id, lines)),
      'a made-up conversation of ' + steps + ' steps stands for thread ' + (index + 1)
    );
  }

  // The size must be taken and the page drawing, or every time below means nothing.
  const got = await main('size', 1920, 1040);
  await wait(1200);
  log.push('note window ' + innerWidth + ' x ' + innerHeight + ', scale ' + devicePixelRatio);
  const sized = got?.[0] === 1920 && got?.[1] === 1040;
  const draws = await drawing();
  if (!sized || !draws.ok) {
    check(
      false,
      'the test window can be timed (size asked 1920 x 1040, got ' +
        (got || []).join(' x ') +
        '; ' +
        draws.text +
        '; window ' +
        (await main('state').catch(() => '?')) +
        '): nothing was timed'
    );
    throw new Error('the window cannot be timed');
  }

  // starting a panel can leave another page in front
  threads.open();
  await until(() => threads.visible(), 5000);
  const island = threads.slot('main');
  const talk = () => island.querySelector('.tnt-talk .tnt-talk-list');
  const reportShown = id => () =>
    view().shown() === id && view().mode() === 'read' && !!talk()?.querySelector('.tnt-report');
  const termShown = id => () => {
    const term = view().term();
    const host = island.querySelector('.tnt-term-box .tnt-term-host');
    return (
      view().shown() === id &&
      view().mode() === 'term' &&
      !!term?.element?.isConnected &&
      !!host &&
      host.style.visibility !== 'hidden'
    );
  };

  // ---- the first opening of each long thread (it is read from disk and drawn) ----
  const first = [];
  for (const id of ids) {
    first.push(await timed(() => threads.select(id), reportShown(id), 6000));
    await wait(600);
  }
  say('a long thread opened for the first time, Readable', first);
  check(
    !!talk()?.querySelector('.tnt-report'),
    'the long conversation is drawn (' + (talk()?.children.length || 0) + ' parts in its list)'
  );

  // ---- another thread, Readable ----
  const again = [];
  for (let count = 0; count < 9; count++) {
    const id = ids[count % ids.length];
    again.push(await timed(() => threads.select(id), reportShown(id)));
    await wait(400);
  }
  say('another long thread, Readable', again);

  // ---- Readable to Terminal and back ----
  const toTerm = [];
  const toRead = [];
  const here = view().shown();
  for (let count = 0; count < 5; count++) {
    toTerm.push(await timed(() => view().setMode('term'), termShown(here)));
    await wait(500);
    toRead.push(await timed(() => view().setMode('read'), reportShown(here)));
    await wait(500);
  }
  say('Readable to Terminal', toTerm);
  say('Terminal to Readable', toRead);

  // ---- another thread, Terminal ----
  for (const id of ids) {
    threads.select(id);
    await until(() => view().shown() === id, 5000);
    view().setMode('term');
    await until(termShown(id), 8000);
    await wait(500);
  }
  const terms = [];
  for (let count = 0; count < 9; count++) {
    const id = ids[count % ids.length];
    terms.push(await timed(() => threads.select(id), termShown(id)));
    await wait(400);
  }
  say('another thread, Terminal', terms);
  view().setMode('read');
  await wait(600);

  // ---- a change of page, with the app's cross-fade ----
  // the pages of the three-dots menu; the route 'terminal' shows a user the All threads page
  const pagesToTry = [
    ['All threads', () => window.TnaiRoute('terminal')],
    ['Threads', () => threads.open()],
    ['Settings', () => window.TnaiSettings.open('general')],
    ['Threads', () => threads.open()],
    ['Skills', () => window.TnaiRoute('skills')],
    ['Threads', () => threads.open()],
  ];

  // A fade that never reports its end (a window that draws no frames) must not hold the test.
  const within = (promise, ms) => Promise.race([promise.catch(() => {}), wait(ms)]);
  const firstShown = [];
  const over = [];
  const toThreads = [];
  for (let count = 0; count < 2; count++) {
    for (const [name, change] of pagesToTry) {
      const start = performance.now();
      const transition = window.TnaiMotion.swap(change, 'page');
      if (!transition) {
        await frame();
        continue;
      }
      await within(transition.ready, 4000);
      const ready_ = performance.now() - start;
      await within(transition.finished, 4000);
      const done = performance.now() - start;
      (name === 'Threads' ? toThreads : firstShown).push(ready_);
      over.push(done);
      await wait(500);
    }
  }
  if (firstShown.length) {
    say('a page first shows (to another page)', firstShown);
    say('a page first shows (back to Threads, a long thread open)', toThreads);
    say('a page change is over, fade and all', over);
  } else log.push('note the cross-fade did not run in this window: page changes were not timed');
} catch (error) {
  // the window check above already said why it stopped
  if (error?.message !== 'the window cannot be timed')
    check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  agents.sessions().forEach(session => agents.stop(session.paneId));
  await until(() => !agents.sessions().some(session => session.running), 15000);
  await main('cleanup').catch(() => {});
}
return { ok, log };
