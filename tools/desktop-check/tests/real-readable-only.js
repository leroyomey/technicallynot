// Technically Not tools · desktop-check/tests/real-readable-only.js — A REAL Claude Code agent
// (Haiku, two short prompts, a few cents of the user's usage) that does a whole task in the
// conversation view, with the CLI's own screen never shown. It proves that a thread is enough:
//
// 1. a prompt from the prompt box ("Reply with the single word ok.") and its answer in the
//    conversation;
// 2. a prompt that needs a tool and a permission ("Create a file named hello.txt containing
//    hi."), the session started at the level that asks: the permission question comes as a card
//    in the thread and is answered there, the action and its result show in the conversation,
//    the task ends, and hello.txt is in the project.
//
// On the Threads page (the default) the agent is started the way a user starts one: New thread,
// then the first prompt. With TNAI_READABLE_PAGE=all the same is done on the All threads page: the
// prompt box there, the question answered on the thread's own card.
//
// Through the whole run an observer watches that the CLI screen is never displayed (the thread
// view's terminal, or any terminal panel) and that the layout never has `agents-mode` (nor
// `terminal-mode` on the Threads page). Every moment where only the CLI's own screen would have
// helped is written into the log as "CLI SCREEN NEEDED". The session's screen is read once or
// twice from its replay (never shown) only to name such a moment.
// Run alone, with TNAI_CHECK_LIMIT_MS=600000. Pictures: real-readable-asked, real-readable-done.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(150);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
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

const layout = document.querySelector('.layout');
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const live = window.TnaiLiveTasks;
const view = () => window.TnaiThreadView;
const shown = el => !!el && el.isConnected && el.getClientRects().length > 0;
const TOOL = 'Claude Code';
let paneId = '';
let prompts = 0;
const needed = [];
const cliNeeded = what => {
  needed.push(what);
  note('CLI SCREEN NEEDED: ' + what);
};

// ---------- the proof that the CLI screen is never shown ----------
// The thread view's terminal part, a terminal host in it, and every terminal panel of the
// Terminal page: none may be displayed at any moment. Looked at on every change of the page.
const seen = { cli: '', modes: new Set() };

function lookForCli() {
  ['terminal-mode', 'agents-mode'].forEach(mode => {
    if (layout.classList.contains(mode)) seen.modes.add(mode);
  });
  if (seen.cli) return;
  const island = threads.slot('main');
  const term = island?.querySelector('.tnt-view > .tnt-term');
  if (shown(term)) seen.cli = "the thread view's terminal part was displayed";
  else if (
    [...document.querySelectorAll('.tnt-term-host')].some(
      host => !host.closest('.ap-term-parked') && shown(host)
    )
  )
    seen.cli = 'a terminal of the thread view was displayed';
  else if ([...document.querySelectorAll('.terminal-pane[data-pane-id]')].some(shown))
    seen.cli = 'a terminal panel was displayed';
  else if (paneId && view()?.shown?.() === paneId && view().mode() === 'term')
    seen.cli = 'the thread was switched to its CLI screen';
}
const watchCli = new MutationObserver(lookForCli);
watchCli.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['hidden', 'class'],
});

// The session's screen, replayed into a scratch terminal that is never put on the page: used
// only to say what the CLI drew when the conversation view did not move on.
async function replayed() {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const scratch = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => scratch.write(replay.buffer, done));
  const buffer = scratch.buffer.active;
  const rows = [];
  for (let y = 0; y < scratch.rows; y++)
    rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '');
  scratch.dispose();
  return rows.map(row => row.trimEnd()).filter(Boolean);
}

// The CLI's own "trust this folder" question has no card: when it is what the session waits on,
// that is a moment for the CLI screen. It is answered through the session so the run can go on.
async function answerCliTrust() {
  const rows = await replayed();
  const text = rows.join('\n');
  if (!/project you created or one you trust|trust the files in this folder/i.test(text))
    return false;
  cliNeeded(
    'Claude Code drew its own folder-trust question on its screen ("' +
      (rows.find(row => /trust/i.test(row)) || '').trim().slice(0, 90) +
      '"); no card came for it in the thread'
  );
  for (let tries = 0; tries < 4; tries++) {
    const now = await replayed();
    if (!/trust/i.test(now.join('\n'))) break;
    const chosen = now.find(row => row.includes('❯')) || '';
    native.pty.write(paneId, /Yes/i.test(chosen) ? '\r' : '\x1b[B');
    await wait(900);
  }
  return true;
}

const typeAndSend = async text => {
  const prompt = document.getElementById('prompt');
  prompt.value = text;
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(120);
  document.getElementById('send').click();
  prompts++;
};

try {
  const page = await main('page');
  note('page: ' + (page === 'all' ? 'All threads' : 'Threads'));
  await agents.detect(true);
  threads.open();
  await until(() => threads.visible(), 5000);

  // The session starts on Haiku and at the level that asks, whatever the user's own settings
  // are: the pick for the next Claude Code start (46), and the level for new agents.
  const access = document.querySelector('#agentsWorkCard .tnai-access-row select');
  if (access) {
    access.value = 'ask';
    access.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.TnaiLaunchPrefs?.once(TOOL, { model: 'haiku', access: 'ask' });
  check(!!window.TnaiLaunchPrefs?.once, 'the next Claude Code session starts on Haiku, asking');

  // Where the conversation and the question cards of the thread are looked for.
  let scope = () => threads.slot('main');
  const blocks = selector => [...(scope()?.querySelectorAll('.tnt-talk-list > ' + selector) || [])];
  const cards = () =>
    [...(scope()?.querySelectorAll('.tnt-asks > *') || [])].filter(
      card => shown(card) && !card.classList.contains('tnai-held')
    );
  const known = new Set(agents.sessions().map(session => session.paneId));
  const fresh = () =>
    agents.sessions().find(session => !known.has(session.paneId) && session.agent === TOOL);
  const P1 = 'Reply with the single word ok.';
  const P2 = 'Create a file named hello.txt containing hi.';

  // The app's own questions before a start (trust this folder, as a card or as a confirm of the
  // app) are answered with yes for the throwaway project. They are the app's, not the CLI's.
  const answerAppAsks = () => {
    const yes =
      [...document.querySelectorAll('.tnt-asks .tnt-ask:not(.tnt-ask-perm) .tnt-ask-yes')].find(
        shown
      ) || [...document.querySelectorAll('.tnai-panel-confirm .tnai-ws-close-confirm')].find(shown);
    if (!yes) return false;
    note(
      'the app asked "' +
        (yes.closest('.tnt-ask, .tnai-panel-confirm')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80) +
        '": answered on its card'
    );
    yes.click();
    return true;
  };

  if (page === 'threads') {
    // ---- the way a user starts: New thread, then the first prompt ----
    threads.slot('list').querySelector('.tnt-new').click();
    await wait(300);
    const armed = live.newAgent?.();
    note('New thread is on: ' + JSON.stringify(armed));
    if (armed !== TOOL) live.newAgent(TOOL);
    check(!!live.newAgent?.(), 'New thread arms the prompt box for a new agent');
    await typeAndSend(P1);
    const started = await until(() => {
      answerAppAsks();
      return fresh();
    }, 60000);
    paneId = started?.paneId || '';
    check(!!paneId, 'the first prompt started a Claude Code session as its own thread');
    if (!paneId) throw new Error('no session started');
    check(
      !!(await until(() => threads.selected() === paneId && view().shown() === paneId, 20000)),
      'its thread is the open one, without a press'
    );
    check(view().mode() === 'read', 'it opens as its conversation');
  } else {
    // ---- All threads: the thread is started, then everything happens on its card ----
    const made = await window.TnaiTest.open(TOOL);
    paneId = made?.paneId || (await until(fresh, 30000))?.paneId || '';
    check(!!paneId, 'a Claude Code session started');
    if (!paneId) throw new Error('no session started');
    check(await window.TnaiTest.openAllThreads(8000), 'the All threads page is open');
    window.TnaiAllThreads.show(paneId);
    const cardOf = () =>
      document.querySelector('.tat-card[data-pane="' + CSS.escape(paneId) + '"]');
    check(!!(await until(() => shown(cardOf()), 8000)), 'its card is on the All threads page');
    scope = cardOf;

    // the CLI must be at its prompt before a prompt is sent to it; its trust question has no card
    await until(async () => {
      answerAppAsks();
      if (await answerCliTrust()) return false;
      return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(
        (await replayed()).join('\n')
      );
    }, 60000);
    cardOf().querySelector('.tat-head').click();
    await wait(300);
    check(
      live.target() === paneId,
      'a press on the card makes it the thread the prompt box sends to'
    );
    check(shown(document.querySelector('footer.composer')), 'the prompt box is on the page');
    await typeAndSend(P1);
  }

  // ---- prompt 1: the answer in the conversation ----
  let bubble = await until(() => {
    answerAppAsks();
    return blocks('.tnt-you').find(block => block.textContent.includes('single word ok'));
  }, 45000);
  if (!bubble) {
    // the conversation did not move: say what the CLI's screen holds, once
    if (!(await answerCliTrust()))
      note('the CLI screen holds: ' + JSON.stringify((await replayed()).slice(-8)));
    bubble = await until(
      () => blocks('.tnt-you').find(block => block.textContent.includes('single word ok')),
      60000
    );
  }
  check(
    !!bubble,
    'the first prompt is in the conversation: "' +
      (bubble?.textContent || 'no bubble').trim().slice(0, 60) +
      '"'
  );
  if (!bubble) throw new Error('the first prompt did not reach the conversation');
  const sentAt = Date.now();
  const findSaid = () => blocks('.tnt-say').find(block => /\bok\b/i.test(block.innerText));
  let said = await until(findSaid, 40000);
  if (!said) {
    // The answer is not on screen after 40 s. What the app knows of the task, and what the
    // tool's own record holds when it is read now, name where it stands (the first run of
    // 2026-10-12 showed the answer only after the next prompt was sent).
    const turn = window.TnaiTurns?.get?.(paneId);
    note(
      'no answer on screen after 40 s. The app knows of the task: ' +
        JSON.stringify(turn && { startedAt: !!turn.startedAt, endedAt: !!turn.endedAt }) +
        '; the view holds ' +
        JSON.stringify(window.TnaiThreadReadable.state())
    );
    const record = await native.threadLog.read(paneId, 0, '').catch(() => null);
    const kinds = (record?.entries || []).map(entry => entry.kind || entry.type || '?');
    note(
      'the record, read now: found ' +
        (record?.found !== false) +
        ', ' +
        kinds.length +
        ' entries (' +
        [...new Set(kinds)].join(', ') +
        '); the view shows ' +
        blocks('*').length +
        ' blocks'
    );
    note('the CLI screen ends with: ' + JSON.stringify((await replayed()).slice(-6)));
    said = await until(findSaid, 110000);
  }
  check(
    !!said,
    'its answer is in the conversation, ' +
      Math.round((Date.now() - sentAt) / 1000) +
      ' s after the prompt was seen: "' +
      (said?.innerText || 'no answer').trim().slice(0, 40) +
      '"'
  );
  const ended1 = await until(() => blocks('.tnt-worked, .tnt-report').length > 0, 30000);
  check(!!ended1, 'the first task ends in the conversation');
  const endsBefore = blocks('.tnt-worked').length;

  // ---- prompt 2: a tool, a permission, the result ----
  check(live.target() === paneId, 'the prompt box is aimed at the thread');
  await typeAndSend(P2);
  check(
    !!(await until(
      () => blocks('.tnt-you').find(block => block.textContent.includes('hello.txt')),
      45000
    )),
    'the second prompt is in the conversation'
  );
  let answered = 0;
  let pictured = false;
  const done = await until(async () => {
    const card = cards().find(one => /Allow once/.test(one.textContent));
    if (card) {
      const words = card.textContent.replace(/\s+/g, ' ').trim().slice(0, 110);
      if (!pictured) {
        pictured = true;
        check(
          !!card.closest('.tnt-asks') && scope().contains(card),
          'the permission question is a card in the thread: "' + words + '"'
        );
        await shot('real-readable-asked');
      } else note('another permission card: "' + words + '"');
      [...card.querySelectorAll('button')]
        .find(button => /Allow once/.test(button.textContent))
        .click();
      answered++;
      await until(() => !shown(card), 10000);
      return false;
    }

    // the end of THIS task: an end row that stands after the second prompt in the conversation
    const all = blocks('*');
    const asked = all.findIndex(
      block => block.classList.contains('tnt-you') && block.textContent.includes('hello.txt')
    );
    return (
      blocks('.tnt-worked').length > endsBefore &&
      all.slice(asked + 1).some(block => block.classList.contains('tnt-worked'))
    );
  }, 180000);
  check(answered > 0, 'it was answered there, with Allow once (' + answered + ' time(s))');
  check(!!done, 'the second task ends in the conversation');
  if (!done) {
    note('the CLI screen holds: ' + JSON.stringify((await replayed()).slice(-10)));
    if (!answered)
      cliNeeded(
        'the session waited and no permission card came in the thread (see the rows above)'
      );
  }
  const acts = blocks('.tnt-did').flatMap(group => [...group.querySelectorAll('.tnt-act')]);
  const wrote = acts.find(act => /hello\.txt/.test(act.textContent));
  check(
    !!wrote,
    'the action is a line of the conversation: "' +
      (wrote?.textContent || 'no line').replace(/\s+/g, ' ').trim().slice(0, 80) +
      '"'
  );
  check(
    !!wrote && wrote.dataset.state !== 'running' && wrote.dataset.state !== 'failed',
    'with its result: ' + (wrote?.dataset.state || 'no state')
  );
  note(
    'the conversation holds ' +
      acts.length +
      ' action(s), ' +
      blocks('.tnt-say').length +
      ' answer(s), ' +
      blocks('.tnt-worked').length +
      ' task end(s), ' +
      blocks('.tnt-report').length +
      ' Technically Not report(s)'
  );
  const last = blocks('.tnt-worked').pop();
  check(
    !!last || blocks('.tnt-report').length > 0,
    'the end of the task: "' +
      (last?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) +
      '"'
  );
  const file = await main('file', 'hello.txt');
  check(
    file.there && /^hi\s*$/.test(file.text),
    'hello.txt is in the project, containing ' + JSON.stringify(file.text)
  );
  await shot('real-readable-done');

  // ---- the CLI screen was never shown ----
  lookForCli();
  check(!seen.cli, 'the CLI screen was never displayed' + (seen.cli ? ': ' + seen.cli : ''));
  check(
    !seen.modes.has('agents-mode') && (page === 'all' || !seen.modes.has('terminal-mode')),
    page === 'all'
      ? 'the layout never had agents-mode (All threads shares the route terminal-mode)'
      : 'the layout never had terminal-mode or agents-mode'
  );
  note('prompts sent: ' + prompts);
  note(
    needed.length
      ? 'moments the conversation view was not enough: ' + needed.length
      : 'the conversation view was enough for the whole run'
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
  note('prompts sent: ' + prompts);
}
watchCli.disconnect();
if (paneId) {
  await agents.stop(paneId);
  await until(() => !agents.sessions().find(session => session.paneId === paneId)?.running, 10000);
}
return { ok, log };
