// Technically Not tools · desktop-check/tests/all-threads.js — the "All threads" page (135): the
// project's threads side by side as conversations where the terminals' slideshow stood. Four
// PowerShell threads and one Claude Code thread with a made-up conversation are opened (no prompt
// is sent). Checked: the threads are shown and the terminal panels are not; three stand side by
// side with one width; every way of moving (the arrows, Ctrl+Alt+arrows, a held key, a slide of a
// trackpad with its tail, the function) moves exactly one thread and no thread is skipped; the
// Claude Code thread shows its conversation; a press on a thread makes it the prompt box's thread
// and the prompt box is on the page; the button of a thread opens it on the Threads page; coming
// to the page shows no terminal panel at any moment; Live preview beside the threads leaves them
// their room. Returns {ok, log}.
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
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const all = () => window.TnaiAllThreads;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);

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
  { type: 'user', message: { role: 'user', content: '[TN.ai] say hello' } },
  {
    type: 'assistant',
    message: {
      id: 'msg_say',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from the made-up conversation.' }],
    },
  },
];
const opened = [];

try {
  await agents.detect(true);
  await main('size', 1600, 900);
  for (let count = 0; count < 4; count++) {
    const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
    opened.push(made.paneId);
  }
  check(opened.length === 4, 'setup: four PowerShell threads are open');
  const claude = await window.TnaiTest.startThread({ tool: 'Claude Code', waitMs: 30000 })
    .then(made => made.paneId)
    .catch(() => '');
  const withTalk = !!claude && !!(await ready(claude));
  if (withTalk) {
    opened.push(claude);
    check(
      !!(await main('writeTranscript', claude, TRANSCRIPT)),
      'setup: a Claude Code thread has a made-up conversation'
    );
  } else log.push('note Claude Code did not start on this PC: its conversation was not visited');

  await window.TnaiTest.openAllThreads();
  const on = await until(() => all()?.state().on && all().state().order.length >= opened.length);
  check(!!on, 'the page shows the threads (' + all()?.state().order.length + ')');
  const view = document.getElementById('terminalView');
  const panels = [...view.querySelectorAll('.terminal-pane[data-pane-id]')];
  check(
    panels.length > 0 && panels.every(panel => !panel.getClientRects().length),
    'the terminal panels are not shown (' + panels.length + ' underneath)'
  );
  await wait(400);
  const strip = view.querySelector('.tat-strip');
  const rowBox = box(view.querySelector('.tat'));
  const onScreen = () =>
    [...strip.children].filter(
      card => box(card).left >= rowBox.left - 1 && box(card).right <= rowBox.right + 1
    );
  const state = () => all().state();
  check(
    state().per >= 2 && onScreen().length === state().per,
    'as many threads as the width holds stand side by side (' +
      onScreen().length +
      ', the page says ' +
      state().per +
      ')'
  );
  const widths = onScreen().map(card => round(box(card).width));
  check(
    new Set(widths).size === 1 && widths[0] >= 340,
    'they have one width (' + widths.join(', ') + ' px)'
  );
  console.log('TNAI_SHOT:all-threads-look');
  await wait(700);

  // ---- every way of moving moves one thread ----
  all().show(state().order[0]);
  await wait(300);
  const steps = [];
  const moved = async (label, act) => {
    const before = state().first;
    await act();
    await wait(320);
    steps.push(label + ' ' + (state().first - before));
    return state().first - before;
  };
  const key = (name, repeat) =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: name,
        ctrlKey: true,
        altKey: true,
        repeat: !!repeat,
        bubbles: true,
        cancelable: true,
      })
    );
  const one = [];
  one.push(await moved('arrow', () => view.querySelector('.tat-next').click()));
  one.push(await moved('key', () => key('ArrowRight')));
  one.push(-(await moved('key back', () => key('ArrowLeft'))));
  one.push(await moved('function', () => all().go(1)));
  check(
    one.every(by => by === 1),
    'an arrow, a key and the function each move one thread (' + steps.join(', ') + ')'
  );
  all().show(state().order[0]);
  await wait(300);
  const held = await moved('held key', () => {
    key('ArrowRight');
    for (let again = 0; again < 8; again++) key('ArrowRight', true);
  });
  check(held === 1, 'a held key moves one thread (' + held + ')');
  all().show(state().order[0]);
  await wait(300);
  const slid = await moved('slide', async () => {
    const tat = view.querySelector('.tat');
    for (let part = 0; part < 14; part++) {
      tat.dispatchEvent(
        new WheelEvent('wheel', { deltaX: part < 6 ? 60 : 14, bubbles: true, cancelable: true })
      );
      await wait(30);
    }
  });
  check(slid === 1, 'one slide of a trackpad, with its tail, moves one thread (' + slid + ')');

  // no thread is skipped from the first to the last
  all().show(state().order[0]);
  await wait(300);
  const seen = [state().first];
  while (all().go(1)) {
    await wait(120);
    seen.push(state().first);
  }
  check(
    seen.every((at, index) => at === index) &&
      seen.length === state().order.length - state().per + 1,
    'stepping to the end visits every place in turn (' + seen.join(' ') + ')'
  );

  // ---- a conversation in a card ----
  if (withTalk) {
    all().show(claude);
    const card = strip.querySelector('.tat-card[data-pane="' + claude + '"]');
    const said = await until(
      () => /Hello from the made-up conversation/.test(card?.textContent || ''),
      10000
    );
    check(!!said, 'the Claude Code thread shows its conversation');
    await wait(450);
    const cut = box(view.querySelector('.tat-clip'));
    const inRow = state().shown.map(paneId =>
      box(strip.querySelector('.tat-card[data-pane="' + paneId + '"]'))
    );
    check(
      Math.abs(inRow[0].left - cut.left) <= 1 &&
        Math.abs(inRow[inRow.length - 1].right - cut.right) <= 1,
      'the threads on the page fill the row from edge to edge, none cut (' +
        round(inRow[0].left - cut.left) +
        ' and ' +
        round(cut.right - inRow[inRow.length - 1].right) +
        ' px off)'
    );
    console.log('TNAI_SHOT:all-threads-talk');
    await wait(700);
  }

  // ---- the prompt box and its thread ----
  const pick = state().shown[0];
  strip.querySelector('.tat-card[data-pane="' + pick + '"] .tat-head').click();
  await wait(300);
  check(
    window.TnaiLiveTasks.target() === pick &&
      strip.querySelector('.tat-card[data-pane="' + pick + '"]').classList.contains('tat-target'),
    'a press on a thread makes it the thread the prompt box sends to'
  );
  const prompt = document.querySelector('footer.composer');
  const promptBox = prompt ? box(prompt) : null;
  check(
    !!promptBox && promptBox.height > 40 && promptBox.bottom <= window.innerHeight + 1,
    'the prompt box is on the page, under the threads (' +
      round(promptBox?.height || 0) +
      ' px high, ends at ' +
      round(promptBox?.bottom || 0) +
      ' of ' +
      window.innerHeight +
      ')'
  );
  check(
    !!promptBox && box(strip).bottom <= promptBox.top + 1,
    'the threads end over the prompt box'
  );

  // ---- a thread on its own ----
  strip.querySelector('.tat-card[data-pane="' + pick + '"] .tat-open').click();
  check(
    !!(await until(() => threads.visible() && !all().state().on, 4000)),
    "a thread's button opens it on the Threads page"
  );

  // ---- a PowerShell thread's card: one line and a button to its screen ----
  await window.TnaiTest.openAllThreads();
  const shell = opened[1];
  all().show(shell);
  await wait(450);
  const shellCard = strip.querySelector('.tat-card[data-pane="' + shell + '"]');
  const plain = shellCard?.querySelector('.tat-plain');
  const screenButton = plain?.querySelector('.tat-screen');
  check(
    !!plain &&
      plain.getClientRects().length > 0 &&
      /This thread is a terminal\. Open its screen to type\./.test(plain.textContent) &&
      screenButton?.textContent === 'Open its screen' &&
      !shellCard.querySelector('.xterm'),
    'a PowerShell thread’s card says in one line what it is and has the button "Open its screen"; no terminal is drawn in the card'
  );
  console.log('TNAI_SHOT:all-threads-plain');
  await wait(700);
  screenButton?.click();
  const onScreen2 = await until(
    () =>
      threads.visible() &&
      threads.selected() === shell &&
      window.TnaiThreadView?.shown() === shell &&
      window.TnaiThreadView.mode() === 'term' &&
      !!window.TnaiThreadView.term(),
    6000
  );
  check(
    !!onScreen2,
    'the button opens that thread on the Threads page, on its screen (thread ' +
      threads.selected() +
      ', view ' +
      window.TnaiThreadView?.mode() +
      ')'
  );

  // ---- coming to the page: no terminal panel is displayed at any moment ----
  // The mode is `pages` already, as it is for a user. Looked at on every change of the page and
  // on every frame, from before the route until the threads stand (the real run of 2026-10-12
  // failed on exactly this, and named no moment).
  const flashes = [];
  const lookForPanel = how => {
    if (flashes.length >= 4 || !panels.some(panel => panel.getClientRects().length)) return;
    flashes.push(
      how + (view.classList.contains('tat-on') ? ', with' : ', before') + ' the threads'
    );
  };
  lookForPanel('before the page was asked for');
  const watchPanels = new MutationObserver(() => lookForPanel('at a change of the page'));
  watchPanels.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'class'],
  });
  let watching = true;
  const eachFrame = () => {
    if (!watching) return;
    lookForPanel('at a frame');
    requestAnimationFrame(eachFrame);
  };
  requestAnimationFrame(eachFrame);
  await window.TnaiTest.openAllThreads();
  await wait(300);
  watching = false;
  watchPanels.disconnect();
  check(
    !flashes.length,
    'coming to the page, no terminal panel is displayed at any moment (' +
      (flashes.join('; ') || 'none seen') +
      ')'
  );

  // Beside Live preview the threads keep their room: the preview column takes its share, but
  // never more than what is left beside the threads at their smallest width (38: up to three at
  // 300 px with 10 px between, two arrows' room of 34 px when there are more), and never under
  // 320 px. In a window too narrow for both, the preview is put under the threads and nothing is
  // measured.
  {
    const view = document.getElementById('terminalView');
    const wasOpen = window.TnaiTerminalPreview.previewOpen();
    window.TnaiTerminalPreview.setPreview(true);
    await wait(500);
    const column = view.querySelector('.tp-preview');
    const count = all().state().order.length;
    const wanted = Math.min(3, Math.max(count, 1));
    const need = wanted * 300 + (wanted - 1) * 10 + (count > wanted ? 68 : 0);
    const whole = view.clientWidth;
    const most = Math.max(320, whole - need - 10);
    if (view.classList.contains('tp-stack') || !column?.getClientRects().length)
      log.push('info the preview is not beside the threads at this size: its room not measured');
    else
      check(
        column.getBoundingClientRect().width <= most + 1,
        'beside Live preview the threads keep their room: the preview column is ' +
          Math.round(column.getBoundingClientRect().width) +
          ' px, at most ' +
          most +
          ' (' +
          count +
          ' threads, view ' +
          whole +
          ')'
      );
    window.TnaiTerminalPreview.setPreview(wasOpen);
    await wait(300);
  }
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log };
