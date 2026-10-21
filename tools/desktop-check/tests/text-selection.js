// Technically Not tools · desktop-check/tests/text-selection.js — moving around the app never
// selects its controls, and a text selection stays in the area it started in
// (169-text-selection.js, 50-text-selection.css; user screenshot 2026-10-21: a drag from the
// conversation ran on through the side column's text and file list).
//
// A real Claude Code panel that gets no prompt, with a made-up transcript; presses and drags are
// real mouse input. Checked:
// 1. A drag that starts in the conversation and ends in the side column selects conversation
//    words only.
// 2. A drag across the thread list selects nothing.
// 3. Ctrl+A with no text field focused selects the open thread's conversation only.
// 4. Opening another thread lets go of a selection in the thread view.
// 5. A right press opens no menu over a control, and lets the menu open over conversation words
//    (the page's half of desktop/text-menu.js; the menu itself: node tools/text-menu-test.js).
// 6. All threads: a drag in one card stays in that card; Ctrl+A selects the conversation of the
//    card under the pointer only.
// 7. A popped-out thread window: a selection and Ctrl+A there leave the app's selection alone.
// 8. A thread dragged out of the list pops out only when let go more than 40 px past the
//    window's edge (162 `droppedOutside`).
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

// Real mouse events through Chromium's input pipeline (run.js sends them one after another).
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++callId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    setTimeout(() => {
      if (window.__tnaiInputDone[id]) resolve();
    }, 10000);
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const drag = (from, to) =>
  realInput([
    { type: 'mouseMove', x: from.x, y: from.y },
    { type: 'mouseDown', x: from.x, y: from.y },
    { type: 'mouseMove', x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    { type: 'mouseMove', x: to.x, y: to.y },
    { type: 'mouseUp', x: to.x, y: to.y },
  ]);

const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;

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

const iso = ms => new Date(ms).toISOString();
const WORDS = 'The settings now sit in one raised card, and the side list belongs to the card.';
const transcript = tag => {
  const at = Date.now() - 60000;
  return [
    {
      type: 'user',
      timestamp: iso(at),
      message: { role: 'user', content: '[TN.ai] Tidy the settings page' },
    },
    {
      type: 'assistant',
      timestamp: iso(at + 20000),
      message: {
        id: 'msg_selection_1',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: WORDS + '\n\nA second paragraph to select across. Only in thread ' + tag + '.',
          },
        ],
      },
    },
  ];
};

const picked = () => String(window.getSelection() || '');
const center = node => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

const started = [];
try {
  threads.open();
  await until(() => threads.visible(), 5000);
  await main('size', 1440, 900);
  for (let at = 0; at < 2; at++) {
    const opened = await window.TnaiTest.open('Claude Code');
    const paneId = opened?.paneId || '';
    await until(() => agents.sessions().find(s => s.paneId === paneId && s.running), 30000);
    if (!paneId || !(await ready(paneId))) {
      log.push('note Claude Code did not start twice on this PC: nothing was checked');
      return { ok, log };
    }
    await main('writeTranscript', paneId, transcript(at + 1));
    started.push(paneId);
  }
  const [one, two] = started;
  threads.select(one);
  const say = await until(() =>
    [...document.querySelectorAll('.tnt-view .tnt-say p')].find(p =>
      p.textContent.includes('raised card')
    )
  );
  check(!!say, 'setup: the conversation shows');
  window.TnaiThreadSide?.open?.('details');
  const side = await until(() => {
    const slot = document.querySelector('.tnt-slot.tnt-side');
    return slot && slot.getBoundingClientRect().width > 100 ? slot : null;
  }, 4000);
  check(!!side, 'setup: the side column is open');

  // ---- 1. conversation into the side column ----
  const start = say.getBoundingClientRect();
  const sideBox = side.getBoundingClientRect();
  await drag(
    { x: start.left + 4, y: start.top + start.height / 2 },
    { x: sideBox.left + sideBox.width / 2, y: sideBox.top + sideBox.height / 2 }
  );
  await wait(200);
  const text = picked();
  const sideText = side.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
  check(
    text.includes('raised card') && !(sideText && text.includes(sideText.slice(0, 12))),
    'a drag from the conversation into the side column selects conversation words only (' +
      JSON.stringify(text.slice(0, 80)) +
      ')'
  );
  check(
    !window.getSelection().containsNode(side, true),
    'nothing in the side column is part of that selection'
  );

  // ---- 2. across the thread list ----
  window.getSelection().removeAllRanges();
  const rows = [...document.querySelectorAll('.tnt-list .tnt-th')];
  if (rows.length >= 2) {
    const a = rows[0].getBoundingClientRect();
    const b = rows[rows.length - 1].getBoundingClientRect();
    await drag({ x: a.left + 30, y: a.top + 8 }, { x: b.right - 10, y: b.bottom - 4 });
    await wait(200);
    check(
      picked().trim() === '',
      'a drag across the thread list selects nothing (' +
        JSON.stringify(picked().slice(0, 40)) +
        ')'
    );
  } else check(false, 'setup: two threads in the list');

  // ---- 3. Ctrl+A ----
  document.activeElement?.blur?.();
  await realInput([
    { type: 'mouseDown', ...center(say) },
    { type: 'mouseUp', ...center(say) },
  ]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
  await wait(100);
  const all = picked();
  check(
    all.includes('raised card') && !all.includes('New thread'),
    'Ctrl+A selects the open thread’s conversation only'
  );

  // after a press in the side column: Ctrl+A still selects (and copies) the conversation's words
  window.getSelection().removeAllRanges();
  await realInput([
    { type: 'mouseDown', ...center(side) },
    { type: 'mouseUp', ...center(side) },
  ]);
  document.activeElement?.blur?.();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
  await wait(100);
  check(
    picked().includes('raised card'),
    'Ctrl+A after a press in the side column still selects the conversation’s words (' +
      JSON.stringify(picked().slice(0, 40)) +
      ')'
  );

  // ---- 4. another thread lets go of it ----
  threads.select(two);
  await until(() => window.TnaiThreadView?.shown?.() === two, 4000);
  await wait(200);
  check(picked() === '', 'opening another thread lets go of the selection');
  await window.TnaiTest?.shot?.('text-selection-after');

  // ---- 5. a right press: no menu over a control, the menu over words ----
  // A made-up press never opens the system menu; it shows whether the page lets one open.
  const rightPress = node => {
    const press = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    node.dispatchEvent(press);
    return press.defaultPrevented;
  };
  const words2 = await until(() =>
    [...document.querySelectorAll('.tnt-view .tnt-say p')].find(p =>
      p.textContent.includes('raised card')
    )
  );
  const headButton = document.querySelector('.tnt-view .tnt-head button');
  const sideTab = document.querySelector(
    '.tnt-sidebox-tabs [role="tab"], .tnt-sidebox-tabs button'
  );
  check(!!words2 && !rightPress(words2), 'a right press on conversation words lets the menu open');
  check(!!headButton && rightPress(headButton), 'a right press on a top-row button opens no menu');
  check(!!sideTab && rightPress(sideTab), 'a right press on a side column tab opens no menu');

  // ---- 6. All threads ----
  window.getSelection().removeAllRanges();
  const onAll = await window.TnaiTest.openAllThreads();
  check(onAll, 'setup: the All threads page shows');
  const cardOf = paneId => document.querySelector('.tat-card[data-pane="' + paneId + '"]');
  const cardWords = paneId =>
    [...(cardOf(paneId)?.querySelectorAll('.tnt-say p') || [])].find(
      p => p.textContent.includes('raised card') && p.getClientRects().length
    );
  const nodeCard = node => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const card = element?.closest?.('.tat-card');
    return card ? (card.dataset.pane === one ? 'card one' : 'card two') : '';
  };
  const both = await until(() => cardWords(one) && cardWords(two), 10000);
  check(!!both, 'setup: both cards show their conversation');
  if (both) {
    const fromWords = cardWords(one).getBoundingClientRect();
    const otherCard = cardOf(two);
    const otherBox = otherCard.getBoundingClientRect();
    await drag(
      { x: fromWords.left + 4, y: fromWords.top + fromWords.height / 2 },
      { x: otherBox.left + otherBox.width / 2, y: otherBox.top + otherBox.height / 2 }
    );
    await wait(200);
    check(
      picked().includes('raised card') && !picked().includes('Only in thread 2'),
      'a drag from one card into the next selects words of the first card only (' +
        JSON.stringify(picked().slice(0, 60)) +
        ', ' +
        picked().length +
        ' letters, ends in ' +
        (nodeCard(window.getSelection().focusNode) || 'no card') +
        ', starts in ' +
        (nodeCard(window.getSelection().anchorNode) || 'no card') +
        ')'
    );

    // Ctrl+A with the pointer over the second card: that card's conversation only.
    window.getSelection().removeAllRanges();
    document.activeElement?.blur?.();
    await realInput([{ type: 'mouseMove', ...center(cardWords(two)) }]);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
    );
    await wait(100);
    const range = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
    const inside = range?.commonAncestorContainer;
    check(
      !!inside &&
        cardOf(two).contains(inside) &&
        !window.getSelection().containsNode(cardOf(one), true) &&
        picked().includes('raised card'),
      'Ctrl+A on All threads selects the conversation of the card under the pointer only'
    );
    await window.TnaiTest?.shot?.('text-selection-all-threads');
  }

  // ---- 7. a popped-out thread window ----
  threads.open();
  await until(() => !window.TnaiAllThreads?.on, 4000);
  threads.select(two);
  await until(() => window.TnaiThreadView?.shown?.() === two, 4000);
  const popout = window.TnaiThreadPopout;
  check(popout?.open(one) === true, 'setup: the first thread pops out');
  const outWindow = () =>
    window.TnaiPopout?.window?.('thread-' + String(one).replace(/[^\w-]/g, '_')) || null;
  const outWords = await until(
    () =>
      [...(outWindow()?.document.querySelectorAll('.tpo-talk .tnt-say p') || [])].find(p =>
        p.textContent.includes('raised card')
      ),
    10000
  );
  check(!!outWords, 'setup: the popped-out window shows its conversation');
  if (outWords) {
    // a selection in the app first, then one in the popped-out window
    const appWords = await until(() =>
      [...document.querySelectorAll('.tnt-view .tnt-say p')].find(p =>
        p.textContent.includes('raised card')
      )
    );

    // a real press in the conversation first, as a person's would be before selecting there
    await realInput([
      { type: 'mouseDown', ...center(appWords) },
      { type: 'mouseUp', ...center(appWords) },
    ]);
    const appRange = document.createRange();
    appRange.selectNodeContents(appWords);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(appRange);
    const appBefore = picked();
    const outDocument = outWindow().document;
    const outRange = outDocument.createRange();
    outRange.selectNodeContents(outWords);
    outWindow().getSelection().removeAllRanges();
    outWindow().getSelection().addRange(outRange);
    outDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
    );
    await wait(100);
    check(
      String(outWindow().getSelection()).includes('raised card') &&
        picked() === appBefore &&
        appBefore.includes('raised card'),
      'a selection and Ctrl+A in the popped-out window leave the app’s selection alone (window: ' +
        JSON.stringify(String(outWindow().getSelection()).slice(0, 40)) +
        ', ' +
        outWindow().getSelection().rangeCount +
        ' range, words ' +
        outWindow().getComputedStyle(outWords).userSelect +
        ', app before: ' +
        JSON.stringify(appBefore.slice(0, 40)) +
        ', app after: ' +
        JSON.stringify(picked().slice(0, 40)) +
        ')'
    );
  }
  popout?.back(one);
  await until(() => !popout?.isOut(one), 4000);

  // ---- 8. a thread let go near the window's edge does not pop out ----
  const edge = popout?.droppedOutside;
  const right = window.screenX + window.outerWidth;
  const middleY = window.screenY + window.outerHeight / 2;
  check(
    !!edge &&
      !edge({ screenX: right - 10, screenY: middleY }) &&
      !edge({ screenX: right + 20, screenY: middleY }) &&
      !edge({ screenX: window.screenX - 35, screenY: middleY }) &&
      edge({ screenX: right + 60, screenY: middleY }) &&
      edge({ screenX: window.screenX + 30, screenY: window.screenY - 60 }),
    'a thread pops out only when let go more than 40 px past the window’s edge'
  );
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
await main('cleanup').catch(() => {});
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 15000);
await wait(300);
return { ok, log };
