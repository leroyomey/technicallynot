// Technically Not tools · desktop-check/tests/thread-blur.js — the blur of one thread
// (src/scripts/120-thread-view.js, its card on All threads in 135) in the real app with a
// throwaway profile and two real PowerShell threads. The blur button stands in the open
// thread's top-right controls, left of "...", in a color no other top-row button has. Pressing it
// blurs what the thread says (not its top row), only for that thread, keeps the choice, blurs
// the same thread's card on All threads, and a second press brings it back. Checked in Dark and
// Light. Pictures: thread-blur-on, thread-blur-light, thread-blur-card. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;

const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const until = async (read, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await wait(50);
  }
  return null;
};

// A covered test window draws no frames, so a frame is never waited on alone.
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);

const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};

// a call to this test's main-process side (thread-blur.main.js)
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = answer => {
      delete window.__tnaiMainDone[id];
      answer?.ok ? resolve(answer.value) : reject(new Error(answer?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;

async function openShell() {
  const made = await window.TnaiTest.startThread({ tool: 'Terminal' });
  await until(() => agents.sessions().find(s => s.paneId === made.paneId && s.running), 15000);
  return made.paneId;
}

// The blur of a part, read from its computed filter. A covered test window draws no frames, so
// a fade out can stand still part way: going off is read from the class, not the filter.
const blurOf = node => (node ? getComputedStyle(node).filter : '');

try {
  await agents.detect(true);
  threads.open();
  check(!!(await until(() => threads.visible(), 5000)), 'the thread layout is showing');
  const first = await openShell();
  const second = await openShell();
  check(!!first && !!second, 'two PowerShell threads are running');

  threads.show(first);
  await until(() => view().shown() === first, 6000);
  const island = threads.slot('main');
  const head = island.querySelector('.tnt-head');
  const term = island.querySelector('.tnt-term');
  const button = head.querySelector('.tnt-head-blur');
  const acts = [...head.querySelectorAll('.tnt-head-acts > button')].filter(
    one => one.getClientRects().length
  );

  // ---- the button: in the top row, before "...", in a color of its own ----
  check(!!button && button.getClientRects().length > 0, 'the blur button is shown in the top row');
  check(
    acts.indexOf(button) > 0 &&
      acts.indexOf(button) < acts.length - 1 &&
      acts.at(-1).classList.contains('tnt-head-menu') &&
      button.getBoundingClientRect().left > head.querySelector('h1').getBoundingClientRect().right,
    'it stands among the top-right controls, left of "..." (' +
      acts.map(one => one.className.replace('tnt-icon-btn ', '')).join(', ') +
      ')'
  );
  const others = acts.filter(one => one !== button).map(one => getComputedStyle(one).color);
  const own = getComputedStyle(button).color;
  check(
    !others.includes(own),
    'its color (' + own + ") is none of the other buttons' (" + [...new Set(others)] + ')'
  );
  check(button.getAttribute('aria-pressed') === 'false', 'it starts off');

  // ---- on: the thread is blurred, its top row is not ----
  button.click();
  await wait(400);
  check(button.getAttribute('aria-pressed') === 'true', 'pressed, it says it is on');
  check(/blur\(9px\)/.test(blurOf(term)), 'the thread is blurred: ' + blurOf(term));
  check(blurOf(head) === 'none', 'the top row stays sharp');
  check(getComputedStyle(term).pointerEvents === 'none', 'nothing under the blur can be pressed');
  const saved = JSON.parse(localStorage.getItem('tnai.thread-blur.v1') || '[]');
  check(saved.includes(first), 'the choice is kept for this thread');
  await shot('thread-blur-on');

  // ---- per thread: the other thread is not blurred, and the first is again on return ----
  threads.show(second);
  await until(() => view().shown() === second, 6000);
  await wait(400);
  check(
    !island.querySelector('.tnt-view').classList.contains('tnt-blurred'),
    'another thread is not blurred (filter now: ' + blurOf(term) + ')'
  );
  check(button.getAttribute('aria-pressed') === 'false', 'its button is off');
  threads.show(first);
  await until(() => view().shown() === first, 6000);
  await wait(400);
  check(/blur/.test(blurOf(term)), 'back on the first thread, it is blurred again');

  // ---- Light: the button keeps a color of its own ----
  const wasTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme');
  await wait(300);
  const lightOwn = getComputedStyle(button).color;
  const lightOthers = acts.filter(one => one !== button).map(one => getComputedStyle(one).color);
  check(!lightOthers.includes(lightOwn), 'in Light its color (' + lightOwn + ') is its own too');
  await shot('thread-blur-light');
  if (wasTheme) document.documentElement.setAttribute('data-theme', wasTheme);

  // ---- All threads: the same thread's card is blurred, and its button turns it off ----
  await window.TnaiTest.openAllThreads();
  const card = await until(
    () => document.querySelector('.tat-card[data-pane="' + first + '"]'),
    8000
  );
  const otherCard = document.querySelector('.tat-card[data-pane="' + second + '"]');
  check(!!card && card.classList.contains('tat-blurred'), 'its card on All threads is blurred');
  check(!!otherCard && !otherCard.classList.contains('tat-blurred'), 'the other card is not');
  const cardButton = card?.querySelector('.tat-act-blur');
  check(cardButton?.getAttribute('aria-pressed') === 'true', 'the card has the blur button, on');
  await shot('thread-blur-card');
  cardButton?.click();
  await wait(400);
  check(!card.classList.contains('tat-blurred'), 'the card button shows the thread again');
  check(
    head.querySelector('.tnt-head-blur').getAttribute('aria-pressed') === 'false',
    'the top row button follows'
  );
  check(
    !JSON.parse(localStorage.getItem('tnai.thread-blur.v1') || '[]').includes(first),
    'the kept choice is cleared'
  );

  // ---- no ghost lines: the blur changes softly everywhere, also at every edge ----
  await edgesHold(first);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
await main('cleanup').catch(() => {});
return { ok, log };

// A thread full of text is blurred and its picture searched for a hard line (thread-blur.main.js
// `lines`): around the conversation and the CLI screen (a terminal filled to its edges), on the
// open thread and on its All threads card, in Dark and in Light. The fade of the blur is turned
// off first, so the picture is the blur at rest (a covered window may never finish a fade).
async function edgesHold(shellId) {
  const longest = 12;
  const still = document.createElement('style');
  still.textContent = '* { transition: none !important; }';
  document.head.append(still);

  // the terminal filled to every edge with text
  window.tnaiNative.pty.write(shellId, "cls; 1..80 | % { 'ghost-line-check ' * 30 }\r");
  await wait(1500);

  // a Claude Code thread with a long made-up conversation
  const claude = (await window.TnaiTest.startThread({ tool: 'Claude Code' }).catch(() => null))
    ?.paneId;
  let talkId = '';
  if (claude && (await until(() => agents.sessions().some(s => s.paneId === claude), 30000))) {
    await wait(4000);
    const lines = [];
    for (let step = 0; step < 30; step++) {
      lines.push({
        type: 'user',
        message: {
          role: 'user',
          content: 'Question ' + step + ': explain the next part of the plan.',
        },
      });
      lines.push({
        type: 'assistant',
        message: {
          id: 'msg_' + step,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text:
                'Part ' +
                step +
                '. The private details stay private: account numbers, keys and names. '.repeat(6) +
                '\n\n- one point\n- another point\n\n`code inside a line` and **bold words**.',
            },
          ],
        },
      });
    }
    if (await main('writeTranscript', claude, lines)) talkId = claude;
  }
  if (!talkId) log.push('note Claude Code did not start: the conversation was not visited');

  const grow = (box, by) => ({
    left: box.left - by,
    top: box.top - by,
    right: box.right + by,
    bottom: box.bottom + by,
  });
  const inside = (box, by) => grow(box, -by);
  const corners = (box, radius) => [
    { left: box.left, top: box.top, right: box.left + radius, bottom: box.top + radius },
    { left: box.right - radius, top: box.top, right: box.right, bottom: box.top + radius },
    { left: box.left, top: box.bottom - radius, right: box.left + radius, bottom: box.bottom },
    { left: box.right - radius, top: box.bottom - radius, right: box.right, bottom: box.bottom },
  ];

  // One surface (the island, a card): everything in it but its sharp head and the prompt box
  // must change softly, right up to 3px from its own edge.
  const measure = async (name, surface, sharp) => {
    const box = surface.getBoundingClientRect();
    const skip = [
      ...corners(box, 22),
      ...sharp.filter(Boolean).map(one => grow(one.getBoundingClientRect(), 6)),
    ];
    const [found] = await main('lines', [{ name, ...inside(box, 3), skip }]);
    const run = Math.max(found.lying.run, found.standing.run);
    const where = found.lying.run >= found.standing.run ? found.lying : found.standing;
    check(
      run <= longest,
      name +
        ': no hard line (longest run of jumps ' +
        run +
        ' px at ' +
        where.x +
        ',' +
        where.y +
        '; biggest jump ' +
        found.biggest +
        ')'
    );
  };

  // The conversation's scrollbar under the blur, the way a user meets it: the thread is shown
  // sharp with its scrollbar drawn, then blurred. The scrollbar's strip is compared with the empty
  // strip beside it, first while sharp (to prove the comparison sees the bar at all), then
  // blurred, where no soft ghost of it may be left. The conversation keeps its width and place.
  const noGhostBar = async (look, paneId, talk) => {
    const edges = talk.getBoundingClientRect();

    // The conversation stands at its end, so its thumb is in the lowest 200px; the strip's top
    // part, with no thumb, says how much the ground itself differs between the two columns.
    const strip = async () =>
      (await main(
        'columns',
        edges.right - 5,
        edges.right - 17,
        edges.bottom - 200,
        edges.bottom - 24
      )) -
      (await main('columns', edges.right - 5, edges.right - 17, edges.top + 24, edges.top + 200));
    window.TnaiThreadBlur.set(paneId, false);
    await frame();
    await wait(600);
    const width = talk.clientWidth;
    const scrolled = talk.scrollTop;

    // The Dark thumb is all but invisible by design (--pg-line-2), so the bar is made plain to
    // see while the thread is sharp: then the blur must take away even a plain bar. A scrollbar
    // takes a new color only when it is drawn again, hence the pixel of scroll.
    const plain = document.createElement('style');
    plain.textContent =
      '.tnt-talk::-webkit-scrollbar-thumb { background: var(--pg-text-3) !important; }';
    document.head.append(plain);
    talk.scrollTop -= 1;
    await frame();
    talk.scrollTop += 1;
    await frame();
    await wait(300);
    const sharp = await strip();
    await main(
      'closeUp',
      'thread-blur-sharp-' + look,
      edges.right - 60,
      edges.bottom - 200,
      60,
      200
    );
    window.TnaiThreadBlur.set(paneId, true);
    await frame();
    await wait(600);
    const now = await strip();
    plain.remove();
    await main(
      'closeUp',
      'thread-blur-ghost-' + look,
      edges.right - 60,
      edges.bottom - 200,
      60,
      200
    );

    // The picture proves it where the window draws the bar while sharp (in Light; a covered
    // test window leaves the Dark bar undrawn even when made plain). In both looks the
    // conversation is no scroll area while blurred, so it has no bar to leave behind.
    if (sharp > 3)
      check(
        now <= 1.5,
        look +
          ' conversation: no soft ghost of its scrollbar (difference ' +
          now +
          ' of 255 over the ground; with the bar shown sharp ' +
          sharp +
          ')'
      );
    else
      log.push(
        'note ' +
          look +
          ': this window did not draw the scrollbar while sharp, so the picture proves nothing here'
      );
    if (look === 'light')
      check(sharp > 3, 'light: the picture sees the scrollbar while sharp (' + sharp + ')');
    const bars = [
      ...document.querySelectorAll(
        '.tnt-view.tnt-blurred .tnt-term .xterm-scrollable-element > .scrollbar'
      ),
    ];
    check(
      getComputedStyle(talk).overflowY === 'hidden' &&
        bars.every(bar => getComputedStyle(bar).visibility === 'hidden'),
      look + ': while blurred the conversation has no scrollbar and the terminal bar is hidden'
    );
    check(
      talk.clientWidth === width && talk.scrollTop === scrolled,
      look +
        ' conversation: the blur moves nothing (width ' +
        width +
        ' to ' +
        talk.clientWidth +
        ', scroll ' +
        scrolled +
        ' to ' +
        talk.scrollTop +
        ')'
    );
  };

  // Light first: a change of look draws the window anew, and a covered test window draws its
  // scrollbars only then, so each look is visited right after a change.
  for (const look of ['light', 'dark']) {
    window.TnaiTheme.set(look);
    await frame();
    await wait(900);
    threads.open();
    await until(() => threads.visible(), 4000);
    const island = threads.slot('main');
    const prompt = document.querySelector('footer.composer');
    for (const [label, paneId] of [
      ['CLI screen', shellId],
      ['conversation', talkId],
    ]) {
      if (!paneId) continue;
      threads.show(paneId);
      await until(() => view().shown() === paneId, 6000);
      if (label === 'conversation')
        await until(() => island.querySelectorAll('.tnt-talk-list > *').length > 20, 10000);
      window.TnaiThreadBlur.set(paneId, true);
      await frame();
      await wait(1200);
      await shot('thread-blur-edges-' + look + '-' + (label === 'CLI screen' ? 'screen' : 'talk'));
      await measure(look + ' ' + label, island, [island.querySelector('.tnt-head'), prompt]);
      if (label === 'conversation')
        await noGhostBar(look, paneId, island.querySelector('.tnt-talk'));
    }

    // the conversation's card on All threads
    if (talkId) {
      await window.TnaiTest.openAllThreads();
      const card = await until(
        () => document.querySelector('.tat-card[data-pane="' + talkId + '"]'),
        8000
      );
      await until(() => card?.querySelectorAll('.tnt-talk-list > *').length > 20, 10000);

      // the card brought onto the page (it can stand on another step of the row)
      window.TnaiAllThreads?.show?.(talkId);
      const row = document.querySelector('#terminalView .tat');
      await until(() => {
        const edges = card.getBoundingClientRect();
        const rowEdges = row.getBoundingClientRect();
        return edges.left >= rowEdges.left - 1 && edges.right <= rowEdges.right + 1;
      }, 6000);
      await frame();
      await wait(1200);
      await shot('thread-blur-edges-' + look + '-card');
      if (card) await measure(look + ' All threads card', card, [card.querySelector('.tat-head')]);
    }
  }
  window.TnaiThreadBlur.set(shellId, false);
  if (talkId) window.TnaiThreadBlur.set(talkId, false);
  window.TnaiTheme.set('dark');
  still.remove();
}
