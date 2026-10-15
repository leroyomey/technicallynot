// Technically Not tools · desktop-check/tests/all-threads-asks.js — the "All threads" page (135):
// an agent's questions on its thread's card (121 `TnaiThreadAsks`), and the page's top row. Four
// PowerShell threads and one Claude Code thread with a made-up conversation are opened; no prompt
// is sent and no CLI asks anything: the tool permissions are made-up hooks posted to the app's own
// hook server (the hook's reply is the answer that was sent), the folder-trust questions are
// pushed to the window. Checked: a question stands on its own thread's card and nowhere else; with
// two threads asking, each shows its own; the answers pressed there reach the hook; the app's
// floating card is put away for a question that stands in a card and still shows for a thread out
// of sight; the open thread of the Threads page shows its questions as before. The top row: "+
// Terminal" and the two view buttons are not displayed, the workspace tabs and "Preview" are, "New
// thread" does what the thread list's button does; a saved `list` view opens as the threads, also
// after a real reload (all-threads-asks.after.js).
// Picture: all-threads-asks-card. Returns {ok, log}.
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

// Real mouse events through Chromium's input pipeline (run.js sends them one after another).
const input = events =>
  new Promise(resolve => {
    const id = 'i' + ++callId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const preview = window.TnaiTerminalPreview;
const live = window.TnaiLiveTasks;
const all = () => window.TnaiAllThreads;
const box = el => el.getBoundingClientRect();
const displayed = el => !!el && el.getClientRects().length > 0;

// what the hook was told: allow, deny, or nothing yet
const decision = reply => {
  try {
    return JSON.parse(reply).hookSpecificOutput?.decision?.behavior || 'none';
  } catch {
    return String(reply);
  }
};

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

const TRANSCRIPT = [
  { type: 'user', message: { role: 'user', content: '[TN.ai] push the branch' } },
  {
    type: 'assistant',
    message: {
      id: 'msg_push',
      role: 'assistant',
      content: [{ type: 'text', text: 'The branch is ready. I will push it now.' }],
    },
  },
];
const opened = [];

// questions asked and not yet answered by the test: closed at the end whatever happened
const openTrust = new Set();

// A window minimized from outside takes no size and its page keeps its old width, so every layout
// check after it fails for a fault the app does not have (2026-10-14: "window 0 x 0, page 1515 x
// 947"). The test stops there with one line that says so; it never restores the window itself.
const notSized = { stop: true };
const sized = async (width, height) => {
  const got = await main('size', width, height);

  // within 40 px: the smallest size lies near the window's own minimum
  if (got && Math.abs(got[0] - width) <= 40 && Math.abs(got[1] - height) <= 40) return got;
  check(
    false,
    'the window did not take ' +
      width +
      ' x ' +
      height +
      ' (' +
      (await main('state')) +
      '): it was minimized or hidden from outside, so its layout cannot be measured; run the test again and leave its window as it is'
  );
  throw notSized;
};

try {
  await agents.detect(true);
  await sized(1600, 900);
  for (let count = 0; count < 4; count++) {
    const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
    opened.push(made.paneId);
  }
  check(opened.length === 4, 'setup: four PowerShell threads are open');
  await window.TnaiTest.openAllThreads();
  const on = await until(() => all()?.state().on && all().state().order.length >= opened.length);
  check(!!on, 'the page shows the threads (' + all()?.state().order.length + ')');
  const view = document.getElementById('terminalView');
  const strip = view.querySelector('.tat-strip');
  const state = () => all().state();
  const cardOf = paneId => strip.querySelector('.tat-card[data-pane="' + paneId + '"]');
  const asksOf = paneId => [...(cardOf(paneId)?.querySelectorAll('.tat-asks > .tnt-ask') || [])];
  const float = () => document.querySelector('.tnai-perm:not(.tnai-held)');

  // ---- a real folder-trust question: "Trust folder" on the card reaches the main process ----
  // Claude Code is started the way the prompt box's New agent starts it (19 `openHere`), without
  // a task: the main process asks before the CLI may start in this folder, which no CLI was
  // allowed in yet (a new folder every run), and starts it only after a yes.
  const record = window.TnaiNewTerminalPane?.({ name: 'Asker', quiet: true, reuseEmpty: true });
  const claude = record?.id || '';
  await wait(50);
  const started = claude
    ? agents.openIn(claude, 'Claude Code', { ownedByUser: true, askTrust: true, name: 'Asker' })
    : Promise.resolve({ ok: false });
  const realAsk = await until(
    async () => (await native.trust.pending()).find(ask => ask.paneId === claude),
    20000
  );
  let withTalk = false;
  if (realAsk) {
    check(
      !agents.sessions().some(s => s.paneId === claude && s.running),
      'setup: the main process asks before Claude Code starts, and it has not started'
    );
    await until(() => state().order.includes(claude), 5000);
    all().show(claude);
    const realCard = await until(() => asksOf(claude).find(card => card.dataset.trustAsk));
    check(
      !!realCard && realCard.dataset.trustAsk === realAsk.id && displayed(realCard),
      "the main process's own folder-trust question stands on the new thread's card (" +
        (realCard?.querySelector('b')?.textContent || 'not shown') +
        ')'
    );
    await wait(450);
    await (window.TnaiTest?.shot?.('all-threads-asks-trust') ?? wait(700));
    realCard?.querySelector('.tnt-ask-yes').click();
    check(
      !!(await until(
        async () => !(await native.trust.pending()).some(ask => ask.id === realAsk.id)
      )),
      '"Trust folder" on the card reaches the main process: the question is no longer open there'
    );
    const runs = await until(
      () => agents.sessions().find(s => s.paneId === claude && s.running),
      30000
    );
    check(!!runs, 'and the session goes on: Claude Code starts in the folder that was trusted');
    check(
      !!(await until(() => asksOf(claude).length === 0)),
      'the answered question leaves the card'
    );
    await started.catch(() => {});
    withTalk = !!runs && !!(await ready(claude));
    if (withTalk) {
      opened.push(claude);
      await main('writeTranscript', claude, TRANSCRIPT);
    }
  } else
    log.push(
      'note the main process asked no folder-trust question (Claude Code is not on this PC, or ' +
        'the folder was trusted): "Trust folder" reaching it was NOT proven in this run'
    );
  check(!!realAsk, 'setup: a real folder-trust question was asked');

  // ---- the top row of a page of threads ----
  await wait(300);
  const addTerminal = document.getElementById('addTerminalPane');
  const viewButtons = view.querySelector('.tp-views');
  const newButton = view.querySelector('.tat-new');
  check(!addTerminal, '"+ Terminal" of the old Terminal page is not in the page');
  check(!viewButtons, 'the two view buttons of the old Terminal page are not in the page');
  check(
    displayed(view.querySelector('.terminal-workspaces')),
    'the workspace tabs are still displayed'
  );
  check(
    [...view.querySelectorAll('.terminal-tools button')].some(
      button => displayed(button) && /Preview/.test(button.textContent)
    ),
    '"Preview" is still displayed'
  );
  check(
    displayed(newButton) && /New thread/.test(newButton.textContent) && !newButton.disabled,
    '"New thread" is displayed in the top row'
  );
  const toolbar = box(view.querySelector('.terminal-toolbar'));
  check(
    !!newButton &&
      box(newButton).left >= toolbar.left &&
      box(newButton).right <= toolbar.right + 1 &&
      box(newButton).top >= toolbar.top &&
      box(newButton).bottom <= toolbar.bottom + 1,
    '"New thread" lies inside the top row'
  );

  // ---- one question, on its own thread's card ----
  const first = withTalk ? claude : opened[0];
  all().show(first);
  await wait(400);
  const inSight = state().shown;
  const second = inSight.find(paneId => paneId !== first);
  const outOfSight = state().order.find(paneId => !inSight.includes(paneId));
  check(
    inSight.includes(first) && !!second && !!outOfSight,
    'setup: two threads in sight and one out of sight (' + inSight.length + ' in sight)'
  );
  const urlFirst = await main('hookUrl', first);
  const urlSecond = await main('hookUrl', second);
  const urlOut = await main('hookUrl', outOfSight);

  const replyFirst = await main('permAsk', urlFirst, 'Bash', {
    command: 'git push origin main',
    description: 'Push the branch',
  });
  const firstCard = await until(() => asksOf(first)[0]);
  check(
    !!firstCard && /Bash/.test(firstCard.textContent) && /git push/.test(firstCard.textContent),
    'a tool permission stands as a card at the foot of its thread'
  );
  check(asksOf(second).length === 0, 'the thread beside it shows no question');
  check(
    !!float() && !displayed(float()),
    'the floating card is put away for a question that stands in a thread'
  );
  const tone = await until(() => cardOf(first)?.querySelector('.tat-dot').dataset.tone === 'needs');

  // what the card and the thread list read, so a failed run says which side was late
  const toneSeen = () => {
    const panel = document.querySelector('.terminal-pane[data-pane-id="' + first + '"]');
    return (
      'dot ' +
      (cardOf(first)?.querySelector('.tat-dot').dataset.tone || 'none') +
      ', list ' +
      (window.TnaiThreadList?.thread?.(first)?.tone || 'none') +
      ', panel ' +
      (panel?.dataset.status || 'none') +
      ', needs-you ' +
      !!window.TnaiNeedsYou?.has?.(first)
    );
  };
  check(!!tone, "the asking thread's state dot says it needs the user (" + toneSeen() + ')');
  check(
    JSON.stringify(state().shown) === JSON.stringify(inSight),
    'the threads keep their places when one of them starts to ask'
  );

  // ---- two threads asking: each shows its own ----
  const replySecond = await main('permAsk', urlSecond, 'Bash', { command: 'npm install left-pad' });
  await main('trustAsk', {
    id: 'tat-trust-1',
    paneId: second,
    title: 'Trust "sample-project" for Codex?',
    body: 'The agent you started needs it.',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });
  openTrust.add('tat-trust-1');
  await until(() => asksOf(second).length === 2);
  const textOf = paneId =>
    asksOf(paneId)
      .map(card => card.textContent)
      .join(' | ');
  check(
    asksOf(first).length === 1 &&
      /git push/.test(textOf(first)) &&
      !/npm install|sample-project/.test(textOf(first)),
    'the first thread still shows only its own question'
  );
  check(
    asksOf(second).length === 2 &&
      /npm install/.test(textOf(second)) &&
      /Trust "sample-project" for Codex\?/.test(textOf(second)) &&
      !/git push/.test(textOf(second)),
    'the second thread shows its own two questions (a permission and folder trust)'
  );
  check(
    asksOf(first)[0] === firstCard,
    'a question that stays is not drawn again when another thread asks'
  );
  await wait(400);

  // every answer of every card lies inside its thread's card and takes a press
  const buttons = [first, second].flatMap(paneId =>
    asksOf(paneId).flatMap(card =>
      [...card.querySelectorAll('button')]
        .filter(button => !button.hidden)
        .map(button => ({ button, home: box(cardOf(paneId)) }))
    )
  );
  const loose = buttons.filter(({ button, home }) => {
    const at = box(button);
    const top = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
    return (
      at.width < 20 ||
      at.left < home.left ||
      at.right > home.right + 0.5 ||
      at.bottom > home.bottom + 0.5 ||
      top?.closest('button') !== button
    );
  });
  check(
    buttons.length >= 8 && loose.length === 0,
    'all ' +
      buttons.length +
      " answers lie inside their thread's card and take a press (" +
      loose.map(({ button }) => button.textContent).join(', ') +
      ')'
  );
  const talk = cardOf(first).querySelector('.tat-body');
  check(
    !withTalk || (displayed(talk) && box(talk).height > 120),
    'the conversation keeps its room over the question (' + Math.round(box(talk).height) + ' px)'
  );
  await (window.TnaiTest?.shot?.('all-threads-asks-card') ?? wait(700));

  // the same cards in the Light look, and in a small window (one thread wide)
  window.TnaiTheme.set('light');
  await wait(500);
  await (window.TnaiTest?.shot?.('all-threads-asks-card-light') ?? wait(700));
  window.TnaiTheme.set('dark');
  await sized(1024, 700);
  all().show(first);
  await wait(500);
  const smallCard = box(cardOf(first));
  const smallAsk = asksOf(first)[0] ? box(asksOf(first)[0]) : null;
  check(
    !!smallAsk &&
      smallAsk.width > 200 &&
      smallAsk.left >= smallCard.left &&
      smallAsk.right <= smallCard.right + 0.5 &&
      smallAsk.bottom <= smallCard.bottom + 0.5,
    'in a 1024 x 700 window the question still lies inside its card'
  );
  await (window.TnaiTest?.shot?.('all-threads-asks-card-small') ?? wait(700));

  // a low window, and the smallest window the app allows
  await sized(1440, 720);
  all().show(first);
  await wait(500);
  const fits = () => {
    const home = box(cardOf(first));
    const ask = asksOf(first)[0] ? box(asksOf(first)[0]) : null;
    const promptBox = box(document.querySelector('footer.composer'));
    return (
      !!ask &&
      ask.height > 40 &&
      ask.top >= home.top &&
      ask.bottom <= home.bottom + 0.5 &&
      home.bottom <= promptBox.top + 1 &&
      promptBox.bottom <= window.innerHeight + 1
    );
  };
  check(
    fits(),
    'in a low window (1440 x 720) the question lies inside its card, over the prompt box'
  );
  await (window.TnaiTest?.shot?.('all-threads-asks-card-low') ?? wait(700));
  const smallest = await main('minimum');
  const smallestTaken = await sized(smallest[0], smallest[1]);
  all().show(first);
  await wait(600);

  // what was measured, so a failed run names the part that broke
  const smallestSeen = () => {
    const home = box(cardOf(first));
    const ask = asksOf(first)[0] ? box(asksOf(first)[0]) : null;
    const promptBox = box(document.querySelector('footer.composer'));
    return (
      'window ' +
      smallestTaken.join(' x ') +
      ', page ' +
      window.innerWidth +
      ' x ' +
      window.innerHeight +
      ', on ' +
      state().on +
      ', per ' +
      state().per +
      ', card ' +
      Math.round(home.top) +
      '-' +
      Math.round(home.bottom) +
      ', ask ' +
      (ask ? Math.round(ask.top) + '-' + Math.round(ask.bottom) : 'none') +
      ', prompt box ' +
      Math.round(promptBox.top) +
      '-' +
      Math.round(promptBox.bottom)
    );
  };
  check(
    state().on && state().per === 1 && fits(),
    'in the smallest window (' +
      smallest.join(' x ') +
      ') the threads are still shown, one wide, the question inside its card (' +
      smallestSeen() +
      ')'
  );
  check(
    [...view.querySelectorAll('.terminal-pane[data-pane-id]')].every(panel => !displayed(panel)),
    'and no terminal panel is displayed there'
  );
  await (window.TnaiTest?.shot?.('all-threads-asks-card-smallest') ?? wait(700));
  await sized(1600, 900);
  all().show(second);
  all().show(first);
  await wait(400);
  check(
    state().shown.includes(first) && state().shown.includes(second),
    'back at full width both asking threads are in sight again'
  );

  // ---- answering there sends the answer ----
  asksOf(first)[0].querySelector('[data-d="once"]').click();
  check(
    decision(await main('permReply', replyFirst, 5000)) === 'allow',
    '"Allow once" on the card reaches the hook as allow'
  );
  check(
    !!(await until(
      () => asksOf(first).length === 0 && !displayed(cardOf(first).querySelector('.tat-asks'))
    )),
    'the answered question leaves its card'
  );
  check(asksOf(second).length === 2, "the other thread's questions stay");
  asksOf(second)
    .find(card => card.dataset.permAsk)
    .querySelector('[data-d="deny"]')
    .click();
  check(
    decision(await main('permReply', replySecond, 5000)) === 'deny',
    '"Deny" on the other card reaches the hook as deny'
  );
  const trustCard = await until(() =>
    asksOf(second).length === 1 ? asksOf(second).find(card => card.dataset.trustAsk) : null
  );
  check(!!trustCard, 'the folder-trust question stays after the permission was answered');
  trustCard?.querySelector('.tnt-ask-yes').click();
  check(
    !!(await until(() => asksOf(second).length === 0)),
    '"Trust folder" takes the question off its thread'
  );

  // The made-up question is not one the main process asked, so it sends no "done" for it as it
  // does for a real one: the test says it, and the app's other drawings of the question go.
  await main('trustDone', 'tat-trust-1');
  openTrust.delete('tat-trust-1');
  check(
    !!(await until(() => !float() || float().hidden)),
    'no question is left over in the floating card'
  );

  // ---- the held-prompt notice (71) stands on its thread's card ----
  const heldNode = document.querySelector('.tnai-perm.tnai-held');
  const heldId = await main('hold', second);
  const heldIn = await until(
    () =>
      displayed(heldNode) && heldNode.parentElement === cardOf(second).querySelector('.tat-asks')
  );
  check(
    !!heldId && !!heldIn && /Prompt held/.test(heldNode.textContent),
    "a held prompt's notice stands at the foot of its thread's card (" +
      (heldNode.querySelector('.tnai-perm-desc')?.textContent || '').slice(0, 60) +
      ')'
  );
  const heldBox = box(heldNode);
  const heldHome = box(cardOf(second));
  check(
    getComputedStyle(heldNode).position === 'static' &&
      heldBox.left >= heldHome.left &&
      heldBox.right <= heldHome.right + 0.5 &&
      heldBox.bottom <= heldHome.bottom + 0.5 &&
      [...heldNode.querySelectorAll('button')].every(
        button => box(button).right <= heldBox.right + 0.5 && box(button).width > 20
      ),
    'it lies in the card, its buttons inside it'
  );
  await wait(300);
  await (window.TnaiTest?.shot?.('all-threads-asks-held') ?? wait(700));
  all().show(state().order.find(paneId => !state().shown.includes(paneId)));
  const stillSeen = state().shown.includes(second);
  if (!stillSeen)
    check(
      !!(await until(() => heldNode.parentElement === document.body && displayed(heldNode))),
      'with its thread out of sight the notice floats over the page, as on the other pages'
    );
  all().show(second);
  check(
    !!(await until(() => heldNode.parentElement === cardOf(second).querySelector('.tat-asks'))),
    'back in sight, the notice stands on the card again'
  );
  threads.open();
  await until(() => threads.visible(), 5000);
  check(
    !!(await until(
      () => heldNode.parentElement === threads.slot('main').querySelector('.tnt-asks')
    )),
    "on the Threads page the notice stands in the open thread's row, as before"
  );
  await window.TnaiTest.openAllThreads();
  all().show(second);
  check(
    !!(await until(() => heldNode.parentElement === cardOf(second).querySelector('.tat-asks'))),
    'and on the All threads page it is on the card again'
  );
  heldNode.querySelector('[data-act="cancel"]').click();
  check(
    !!(await until(() => heldNode.hidden && !displayed(cardOf(second).querySelector('.tat-asks')))),
    'its own "Cancel" still works there: the notice goes and the row takes no room'
  );
  await main('unhold', second, heldId);
  all().show(first);
  await wait(300);

  // ---- a thread out of sight: the floating card still asks; in sight, its own card does ----
  const replyOut = await main('permAsk', urlOut, 'Bash', { command: 'git tag v9' });
  check(
    !!(await until(() => displayed(float()) && /git tag/.test(float().textContent))),
    'a question of a thread out of sight shows in the floating card'
  );
  all().show(outOfSight);
  check(
    !!(await until(() => asksOf(outOfSight).length === 1 && !displayed(float()))),
    'brought in sight, the thread shows the question itself and the floating card is put away'
  );
  asksOf(outOfSight)[0]?.querySelector('[data-d="deny"]').click();
  check(
    decision(await main('permReply', replyOut, 5000)) === 'deny',
    'answered there, the hook is told'
  );

  // ---- the open thread of the Threads page shows its questions as before ----
  all().show(second);
  await wait(300);
  const replyOpen = await main('permAsk', urlSecond, 'Bash', { command: 'npm publish' });
  await main('trustAsk', {
    id: 'tat-trust-2',
    paneId: second,
    title: 'Trust "other-project" for Codex?',
    body: '',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });
  openTrust.add('tat-trust-2');
  await until(() => asksOf(second).length === 2);
  threads.open();
  await until(() => threads.visible(), 5000);
  threads.select(second);
  const row = threads.slot('main').querySelector('.tnt-asks');
  const inRow = await until(() =>
    row?.querySelector(':scope > .tnt-ask[data-trust-ask="tat-trust-2"]')
  );
  check(
    displayed(inRow),
    'the open thread shows its folder-trust question in its own row, as before'
  );
  const docked = await until(() => row?.querySelector(':scope > .tnai-perm:not(.tnai-held)'));
  check(
    displayed(docked) && /npm publish/.test(docked.textContent),
    "the app's permission card stands in the open thread's row, as before"
  );
  docked?.querySelector('[data-d="deny"]').click();
  check(
    decision(await main('permReply', replyOpen, 5000)) === 'deny',
    'answered in the open thread, the hook is told'
  );
  await main('trustDone', 'tat-trust-2');
  openTrust.delete('tat-trust-2');
  check(
    !!(await until(() => !row.querySelector(':scope > .tnt-ask'))),
    'a question answered elsewhere leaves the open thread'
  );

  // ---- "New thread" does what the thread list's button does ----
  const listButton = threads.slot('list').querySelector('.tnt-new');
  const armed = () => !!live.newAgent();
  const outcome = async press => {
    if (armed()) live.newAgent(false);
    await window.TnaiTest.openAllThreads();
    await wait(200);
    press();
    await until(() => threads.visible() && armed(), 4000);
    await wait(250);
    return {
      page: threads.visible() ? 'Threads' : 'another page',
      armed: armed(),
      pressed: listButton.getAttribute('aria-pressed'),
      focus: document.activeElement?.id || '',
      note: threads.slot('list').querySelector('.tnt-lst-note')?.textContent || '',
    };
  };
  const fromList = await outcome(() => listButton.click());
  const fromRow = await outcome(() => view.querySelector('.tat-new').click());
  check(
    fromRow.armed && fromRow.page === 'Threads' && fromRow.focus === 'prompt',
    '"New thread" in the top row opens the Threads page with the prompt box set to a new agent'
  );
  check(
    JSON.stringify(fromRow) === JSON.stringify(fromList),
    "it ends exactly where the thread list's button ends (" + JSON.stringify(fromRow) + ')'
  );
  if (armed()) live.newAgent(false);

  // ---- a saved "list" view across a real reload (all-threads-asks.after.js goes on) ----
  localStorage.setItem(
    'tnai.terminal-preview.v1',
    JSON.stringify({ left: 43, view: 'list', preview: true, v: 2 })
  );
} catch (error) {
  ok = false;

  // a size that was not taken has said so in its own line
  if (error !== notSized) log.push('ERROR ' + (error?.stack || error));
}
for (const id of openTrust) await main('trustDone', id).catch(() => {});
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log, reload: ok };
