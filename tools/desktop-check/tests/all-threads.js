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

  // The unfocused test window can take longer than a fixed pause to lay the cards out, so this
  // waits (up to 6 s) until the row holds as many cards of one real width as the page says
  const laidOut = () => {
    const row = view.querySelector('.tat');
    const cards = [...(view.querySelector('.tat-strip')?.children || [])];
    if (!row || !all().state().per) return false;
    const rowEdges = box(row);
    const inside = cards.filter(
      card => box(card).left >= rowEdges.left - 1 && box(card).right <= rowEdges.right + 1
    );
    const widths = new Set(inside.map(card => round(box(card).width)));
    return inside.length === all().state().per && widths.size === 1 && !widths.has(0);
  };
  const cardsReady = await until(laidOut, 6000);
  if (!cardsReady) log.push('note the cards were not laid out within 6 s');
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
    // The row slides there (a 0.18 s transition, 38), and a slide does not move on in a window that
    // draws no frames (one the user's other windows cover; issue 20 found it 768 px short after a
    // fixed pause). Where the cards land is checked here, not the slide, so it is off for this part
    // (data-pg marks a style the check adds itself).
    const noSlide = document.createElement('style');
    noSlide.dataset.pg = '';
    noSlide.textContent = '.tat-strip { transition: none !important; }';
    document.head.append(noSlide);
    all().show(claude);
    const card = strip.querySelector('.tat-card[data-pane="' + claude + '"]');
    const said = await until(
      () => /Hello from the made-up conversation/.test(card?.textContent || ''),
      10000
    );
    check(!!said, 'the Claude Code thread shows its conversation');
    const cut = box(view.querySelector('.tat-clip'));
    const inRow = state().shown.map(paneId =>
      box(strip.querySelector('.tat-card[data-pane="' + paneId + '"]'))
    );
    noSlide.remove();
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

  // ---- one choice, shown in the card row and in the thread list ----
  // Found 2026-10-14: a card chosen here left the list on the thread last opened on Threads.
  const listRow = paneId =>
    threads.slot('list')?.querySelector('.tnt-th:not(.tnt-sub)[data-pane="' + paneId + '"]');
  const chosenRows = () =>
    (window.TnaiThreadList?.rows() || []).filter(row => row.selected && !row.sub);
  const second = state().shown[1];
  strip.querySelector('.tat-card[data-pane="' + second + '"] .tat-head').click();
  const listFollows = await until(
    () => chosenRows().length === 1 && chosenRows()[0].paneId === second,
    3000
  );
  check(
    !!listFollows,
    "a card chosen on the page is the thread list's chosen row (" +
      chosenRows()
        .map(row => row.paneId)
        .join(', ') +
      ', card ' +
      second +
      ')'
  );

  // a row whose card is off the page when there is one, else the third card
  const offPage = state().order.find(paneId => !state().shown.includes(paneId));
  const third = offPage || state().shown[2];
  listRow(third)?.click();
  const cardFollows = await until(
    () =>
      window.TnaiLiveTasks.target() === third &&
      strip
        .querySelector('.tat-card[data-pane="' + third + '"]')
        ?.classList.contains('tat-target') &&
      state().shown.includes(third) &&
      all().state().on,
    3000
  );
  check(
    !!cardFollows,
    'a row pressed in the list chooses its card and brings it on the page (' +
      third +
      (offPage ? ', was off the page' : '') +
      ')'
  );

  // the list redraws on its next frame, so this waits for it
  const rowFollows = await until(
    () => chosenRows().length === 1 && chosenRows()[0].paneId === third,
    3000
  );
  check(
    !!rowFollows,
    'the list shows that row as the only chosen one (' +
      chosenRows()
        .map(row => row.paneId)
        .join(', ') +
      ')'
  );
  console.log('TNAI_SHOT:all-threads-chosen');
  await wait(700);

  // back to the first card, as the steps below expect
  strip.querySelector('.tat-card[data-pane="' + pick + '"] .tat-head').click();
  await until(() => state().shown[0] === pick, 2000);

  // ---- the pencil beside a card's name ----
  const pickCard = strip.querySelector('.tat-card[data-pane="' + pick + '"]');
  const cardName = pickCard.querySelector('.tat-name-line b');
  const cardPencil = pickCard.querySelector('.tat-rename');
  const cardField = () => pickCard.querySelector('.tat-name-line .tnai-rename-input');
  const headHeight = box(pickCard.querySelector('.tat-head')).height;
  check(!!cardPencil && box(cardPencil).width > 0, 'a pencil stands beside the card’s name');
  const cardGap = box(cardPencil).left - box(cardName).right;
  check(
    cardGap >= 1 && cardGap <= 6,
    'the pencil sits right after the name (' + round(cardGap) + ' px)'
  );
  cardPencil.click();
  await wait(200);
  check(
    !!cardField() &&
      getComputedStyle(cardName).display === 'none' &&
      getComputedStyle(cardPencil).display === 'none' &&
      document.activeElement === cardField(),
    'the pencil puts a field where the card’s name stood'
  );
  check(
    Math.abs(box(pickCard.querySelector('.tat-head')).height - headHeight) < 1,
    'the card’s head keeps its height while the name is edited'
  );
  console.log('TNAI_SHOT:all-threads-pencil');
  await wait(700);
  const newName = 'Card ' + String(Date.now()).slice(-5);

  // A window covered by the user's other windows draws no frames (119's note), and the desktop
  // tests run in a window shown behind nothing in particular: this rename sometimes found the old
  // name on the card (issue 20). So frames are held back here on purpose, as a covered window
  // holds them, and the card must still follow; the held frames run afterwards, as they do when
  // the window is seen again.
  const realFrame = window.requestAnimationFrame;
  const realCancelFrame = window.cancelAnimationFrame;
  const heldFrames = new Map();
  let heldId = 0;
  window.requestAnimationFrame = callback => {
    heldId++;
    heldFrames.set(heldId, callback);
    return heldId;
  };
  window.cancelAnimationFrame = id => heldFrames.delete(id);
  cardField().value = newName;
  cardField().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  const renameFollows = await until(
    () =>
      !cardField() &&
      cardName.textContent === newName &&
      window.TnaiThreadList?.thread?.(pick)?.name === newName,
    5000
  );
  window.requestAnimationFrame = realFrame;
  window.cancelAnimationFrame = realCancelFrame;
  heldFrames.forEach(callback => realFrame(callback));
  check(
    !!renameFollows,
    'Enter saves the card’s new name, and the thread list has it, with no frame drawn (card ' +
      cardName.textContent +
      ', list ' +
      window.TnaiThreadList?.thread?.(pick)?.name +
      ')'
  );

  // ---- the open thread's top-row controls on the card ----
  const cardHead = box(pickCard.querySelector('.tat-head'));
  const acts = ['handoff', 'side', 'power', 'more'].map(name =>
    pickCard.querySelector('.tat-act-' + name)
  );
  check(
    acts.every(button => {
      const rect = button && box(button);
      return !!rect && rect.width > 0 && rect.left >= cardHead.left && rect.right <= cardHead.right;
    }),
    'the card’s head has handoff history, side column, on/off and "..." inside its edges'
  );
  const nameRoom = box(pickCard.querySelector('.tat-head-text')).width;
  check(nameRoom >= 120, 'the card’s name keeps room beside them (' + round(nameRoom) + ' px)');
  acts[3].click();
  await wait(200);
  const cardMenu = document.querySelector('.tnt-menu-thread:not([hidden])');
  const cardRows = cardMenu ? [...cardMenu.querySelectorAll('.tnt-menu-row')] : [];
  check(
    cardRows.some(row => row.dataset.row === 'close') &&
      cardRows.some(row => row.dataset.row === 'rename') &&
      acts[3].getAttribute('aria-expanded') === 'true',
    'the card’s "..." opens the thread menu (' +
      cardRows.map(row => row.dataset.row).join(', ') +
      ')'
  );
  check(
    !!cardMenu && box(cardMenu).top >= box(acts[3]).bottom,
    'the menu opens under the card’s "..."'
  );
  console.log('TNAI_SHOT:all-threads-card-menu');
  await wait(700);
  cardMenu?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  await wait(100);
  check(
    !document.querySelector('.tnt-menu-thread:not([hidden])') && all().state().on,
    'Escape closes the card’s menu and All threads stays open'
  );

  // ---- a thread on its own ----
  strip.querySelector('.tat-card[data-pane="' + pick + '"] .tat-open').click();
  check(
    !!(await until(() => threads.visible() && !all().state().on, 4000)),
    "a thread's button opens it on the Threads page"
  );

  // ---- the session clock beside the name ----
  const cardAge = pickCard.querySelector('.tat-age');
  const headAge = await until(() => {
    const found = document.querySelector('.tnt-view .tnt-head-age');
    return found && !found.hidden ? found : null;
  }, 3000);
  check(
    !!cardAge &&
      !cardAge.hidden &&
      /^\d+m$/.test(cardAge.textContent) &&
      cardAge.dataset.age === 'fresh' &&
      !!headAge &&
      headAge.textContent === cardAge.textContent &&
      box(headAge).left >= box(document.querySelector('.tnt-view .tnt-head h1')).right,
    'the card and the thread’s top row show how long the session is open, after the name (' +
      (cardAge?.textContent || '-') +
      ', ' +
      (headAge?.textContent || '-') +
      ')'
  );
  const ageSteps = [1, 2.5, 4.5, 7].map(hours => {
    const probe = document.createElement('span');
    probe.className = 'tnt-head-age';
    document.body.append(probe);
    const fake = 'age-probe-' + hours;
    const sessions = window.TnaiAgents.sessions;
    window.TnaiAgents.sessions = () => [
      { paneId: fake, running: true, startedAt: Date.now() - hours * 3600000 },
    ];
    window.TnaiThreadView.paintAge(probe, fake);
    window.TnaiAgents.sessions = sessions;
    const result =
      probe.textContent + ' ' + probe.dataset.age + ' ' + getComputedStyle(probe).color;
    probe.remove();
    return result;
  });
  check(
    ageSteps.map(step => step.split(' ').slice(0, 3).join(' ')).join(' | ') ===
      '1h 00m fresh | 2h 30m long | 4h 30m longer | 7h 00m longest' &&
      new Set(ageSteps.map(step => step.split(' ').slice(3).join(' '))).size === 4,
    'the clock’s four steps have four colors (' + ageSteps.join(' | ') + ')'
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
