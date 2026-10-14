// Technically Not tools · desktop-check/tests/all-threads-preview.js — Live preview beside the
// threads of the All threads page (105 lays the page out, 135 shows the threads). The page is seen
// as the user sees it, opened as the three-dots menu opens it. Checked: the page
// starts with the threads; Live preview stands beside the row without lying over it; the divider
// moves with the keys inside 30% to 70% and with a real drag of the mouse, the threads take the
// room that is left, and the place is saved; the "Preview" button puts the preview away and brings
// it back; under 860 px the preview is closed (there is no room for it) and comes back when the
// page is wider; in the narrowest window the page still shows the threads, one wide, with usable
// arrows, and never the terminal panels. Three PowerShell threads are opened; nothing is sent.
// Pictures: terminal-preview-threads, terminal-preview-stacked. Returns {ok, log}.
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
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);
const displayed = el => !!el && el.getClientRects().length > 0;
const agents = window.TnaiAgents;
const preview = window.TnaiTerminalPreview;
const all = () => window.TnaiAllThreads;
const savedState = () => {
  try {
    return JSON.parse(localStorage.getItem('tnai.terminal-preview.v1') || '{}');
  } catch {
    return {};
  }
};
const opened = [];

try {
  window.resizeTo(1500, 860);
  check(
    (await window.TnaiTest.openAllThreads()) &&
      !!preview &&
      !document.querySelector('#terminalView :is(.tp-agents, .tp-views)'),
    'the All threads page starts with the threads, with no list of terminals and no view buttons'
  );
  for (let count = 0; count < 3; count++) {
    const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
    opened.push(made.paneId);
  }
  const view = document.getElementById('terminalView');
  check(
    !!(await until(() => all()?.state().on && all().state().order.length >= opened.length)),
    'the threads are shown (' + all()?.state().order.length + ')'
  );
  await wait(400);
  const content = view.querySelector('.terminal-content');
  const host = view.querySelector('.tp-preview');
  const divider = view.querySelector('.tp-divider');
  const clip = view.querySelector('.tat-clip');
  const strip = view.querySelector('.tat-strip');
  const state = () => all().state();
  const panels = () => [...view.querySelectorAll('.terminal-pane[data-pane-id]')];
  const cardsInSight = () =>
    state().shown.map(paneId => strip.querySelector('.tat-card[data-pane="' + paneId + '"]'));

  // the threads fill the row from edge to edge, whatever the row's width
  const rowFilled = () => {
    const cut = box(clip);
    const cards = cardsInSight().map(box);
    return (
      cards.length > 0 &&
      Math.abs(cards[0].left - cut.left) <= 1 &&
      // the threads have whole-pixel widths: the last one may end a pixel and a part short
      Math.abs(cards[cards.length - 1].right - cut.right) <= 2
    );
  };

  const rowSays = () =>
    'row ' +
    round(box(clip).left) +
    ' to ' +
    round(box(clip).right) +
    ', threads ' +
    cardsInSight()
      .map(card => round(box(card).left) + ' to ' + round(box(card).right))
      .join(', ') +
    ', ' +
    state().per +
    ' wide';

  // ---- Live preview beside the row ----
  check(
    displayed(host) && displayed(divider) && view.classList.contains('tp-pages'),
    'Live preview and its divider are displayed on the page of threads'
  );
  check(
    box(content).right <= box(divider).left + 0.5 && box(divider).right <= box(host).left + 0.5,
    'the threads, the divider and the preview stand side by side, none over another (' +
      round(box(content).right) +
      ' / ' +
      round(box(divider).left) +
      ' / ' +
      round(box(host).left) +
      ')'
  );
  check(
    Math.abs(box(host).bottom - box(content).bottom) <= 1 && box(host).height > 300,
    'the preview ends where the threads end (' +
      round(box(host).bottom) +
      ' and ' +
      round(box(content).bottom) +
      ')'
  );
  check(
    !!host.querySelector('input, .lp-note'),
    'the preview has its own address row or its first words'
  );
  check(
    panels().length > 0 && panels().every(panel => !displayed(panel)),
    'no terminal panel is displayed'
  );
  check(rowFilled(), 'the threads fill their row');
  console.log('TNAI_SHOT:terminal-preview-threads');
  await wait(700);

  // ---- the divider with the keys ----
  divider.focus();
  const key = name =>
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  for (let step = 0; step < 30; step++) key('ArrowLeft');
  await wait(400);
  const widest = box(host).width;
  check(
    savedState().left === 30 && divider.getAttribute('aria-valuenow') === '30',
    'the divider stops at 30% and the place is saved (' + savedState().left + ')'
  );
  check(rowFilled(), 'the threads take the room that is left (preview at its widest)');
  for (let step = 0; step < 30; step++) key('ArrowRight');
  await wait(400);

  // The preview column has an upper limit: the threads keep their room beside it (31: up to
  // three at 300 px with 10 px between, two arrows' room when there are more). So at its widest
  // the preview stands at that limit or at its share, whichever is less, and at 70% it stands
  // at its 30% share, or at the limit when that is less still.
  const threadCount = window.TnaiAllThreads.state().order.length;
  const wanted = Math.min(3, Math.max(threadCount, 1));
  const limit = () =>
    Math.max(
      320,
      view.clientWidth - (wanted * 300 + (wanted - 1) * 10 + (threadCount > wanted ? 68 : 0)) - 10
    );
  const share = () => Math.min(limit(), Math.max(320, view.clientWidth * 0.3));
  check(
    savedState().left === 70 &&
      widest <= limit() + 1 &&
      box(host).width <= widest + 1 &&
      Math.abs(box(host).width - share()) <= 12,
    'at 70% the preview is no wider than at 30%, and both keep under the limit the threads set (' +
      round(widest) +
      ' to ' +
      round(box(host).width) +
      ' px, limit ' +
      round(limit()) +
      ', its share ' +
      round(share()) +
      ')'
  );
  check(
    rowFilled(),
    'the threads take the room that is left (preview at its narrowest; ' + rowSays() + ')'
  );

  // ---- the divider with a real drag ----
  const before = box(host).width;
  const grip = box(divider);
  const x = grip.left + grip.width / 2;
  const y = grip.top + grip.height / 2;
  await input([
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, wait: 60 },
    { type: 'mouseMove', x: x - 60, y, down: true, wait: 40 },
    { type: 'mouseMove', x: x - 120, y, down: true, wait: 40 },
    { type: 'mouseUp', x: x - 120, y },
  ]);
  await wait(400);
  const grew = box(host).width - before;
  const roomToGrow = Math.max(0, limit() - before);
  const expected = Math.min(120, roomToGrow);
  check(
    Math.abs(grew - expected) <= 40,
    'a drag of 120 px to the left makes the preview that much wider, up to its limit (' +
      round(grew) +
      ' px, room to grow ' +
      round(roomToGrow) +
      ')'
  );
  check(
    savedState().left < 70 && !view.classList.contains('tp-dragging'),
    'the dragged place is saved and the drag is over (' + round(savedState().left) + '%)'
  );
  check(rowFilled(), 'the threads take the room that is left after the drag');

  // ---- the preview put away and brought back ----
  const previewButton = [...view.querySelectorAll('.terminal-tools button')].find(button =>
    /Preview/.test(button.textContent)
  );
  check(displayed(previewButton), 'the "Preview" button is in the top row');
  const withPreview = box(content).width;
  previewButton.click();
  check(
    !!(await until(() => !displayed(host) && view.classList.contains('tp-noprev'))),
    'a press on "Preview" puts the preview away'
  );
  await wait(400);
  check(
    box(content).width > withPreview + 100 && rowFilled(),
    'the threads take its room (' +
      round(withPreview) +
      ' to ' +
      round(box(content).width) +
      ' px), ' +
      state().per +
      ' side by side'
  );
  check(
    savedState().preview === false && previewButton.getAttribute('aria-expanded') === 'false',
    'that it is put away is saved, and the button says so'
  );
  previewButton.click();
  check(
    !!(await until(() => displayed(host) && !view.classList.contains('tp-noprev'))),
    'a second press brings the preview back'
  );
  await wait(400);
  check(savedState().preview === true && rowFilled(), 'saved again, the threads fitted again');

  // ---- narrow windows: the preview under the threads, and always threads ----
  window.resizeTo(900, 760);
  await until(() => view.classList.contains('tp-stack'), 4000);
  await wait(500);
  check(
    view.classList.contains('tp-stack') &&
      !displayed(host) &&
      !displayed(divider) &&
      !displayed(previewButton),
    'under 860 px of page Live preview is closed, with its divider and its button (page ' +
      round(box(view).width) +
      ' px wide)'
  );
  const promptTop = box(document.querySelector('footer.composer')).top;
  check(
    promptTop - box(content).bottom < 40,
    'the threads reach down to the prompt box, no empty band or line between (' +
      round(promptTop - box(content).bottom) +
      ' px)'
  );
  check(
    state().on && rowFilled() && box(content).height > 150,
    'the threads are still shown there (' + round(box(content).height) + ' px high)'
  );
  console.log('TNAI_SHOT:terminal-preview-stacked');
  await wait(700);
  window.resizeTo(768, 700);
  await wait(900);
  check(
    state().on && state().per === 1,
    'in the narrowest window the page still shows the threads, one wide (page ' +
      round(box(view).width) +
      ' px)'
  );
  check(
    panels().every(panel => !displayed(panel)),
    'and no terminal panel is displayed there'
  );
  all().show(state().order[0]);
  await wait(300);
  const next = view.querySelector('.tat-next');
  const dots = [...view.querySelectorAll('.tat-dots button')];
  const nextBox = box(next);
  check(
    displayed(next) &&
      !next.disabled &&
      dots.length === state().order.length &&
      document
        .elementFromPoint(nextBox.left + nextBox.width / 2, nextBox.top + nextBox.height / 2)
        ?.closest('button') === next,
    'its arrow takes a press and there is a dot per thread (' + dots.length + ')'
  );
  next.click();
  await wait(350);
  check(state().first === 1 && rowFilled(), 'the arrow moves one thread, which fills the row');
  dots[0].click();
  await wait(350);
  check(state().first === 0, 'a dot brings its thread back');
  console.log('TNAI_SHOT:terminal-preview-narrowest');
  await wait(700);
  window.resizeTo(1500, 860);
  check(
    !!(await until(() => displayed(host) && displayed(divider) && displayed(previewButton))),
    'in a wide window Live preview is back beside the threads'
  );
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
window.resizeTo(1440, 900);
for (const paneId of opened) await agents.stop(paneId).catch(() => {});

// the shells end before the window goes (the app closed badly when it was closed at once)
await wait(2500);
return { ok, log };
