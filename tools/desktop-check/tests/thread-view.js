// Technically Not tools · desktop-check/tests/thread-view.js — the thread layout's open thread
// (src/scripts/120-thread-view.js) in the real app
// with a throwaway profile and real PowerShell sessions. With nothing open the island says so. An
// open thread shows its name, tool and state, and a terminal that is a typeable view of that very
// session, sized to the island; the prompt box is aimed at it; a second thread swaps the view and
// the first comes back as it was; a growing prompt box makes the terminal wait before it resizes;
// the layout holds in low and narrow windows; on another page the island goes and its view is
// kept. No
// agent CLI is started, so a full-screen CLI, a working agent and a restored session are not
// visited. Pictures: thread-view-empty, thread-view-terminal, thread-view-draft, thread-view-low,
// thread-view-narrow. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

// A covered test window draws no frames, so a frame is never waited on alone.
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents,
  threads = window.TnaiThreads,
  view = () => window.TnaiThreadView;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 0.75) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
const promptBox = () => document.querySelector('footer.composer');

// The text on a terminal's screen and in its history, read from its buffer (tests draw terminals
// with the DOM renderer, the app with WebGL: the buffer is the same for both).
const textOf = term => {
  const buffer = term?.buffer.active;
  let out = '';
  if (buffer)
    for (let y = 0; y < buffer.length; y++)
      out += (buffer.getLine(y)?.translateToString(true) || '') + '\n';
  return out;
};

async function openShell() {
  const before = new Set(agents.sessions().map(s => s.paneId));
  const opened = await openThread('Terminal');
  const id =
    opened?.paneId ||
    (await until(() => agents.sessions().find(s => !before.has(s.paneId))))?.paneId ||
    '';
  await until(() => agents.sessions().find(s => s.paneId === id && s.running), 15000);
  return id;
}

// What must hold at every window size.
function holds(label) {
  const list = threads.slot('list'),
    island = threads.slot('main'),
    prompt = promptBox(),
    l = box(list),
    m = box(island),
    p = box(prompt),
    acts = box(island.querySelector('.tnt-head-acts')),
    host = island.querySelector('.tnt-term-host'),
    term = view().term();
  const inside =
    m.right <= innerWidth + 1 &&
    p.bottom <= innerHeight + 1 &&
    l.bottom <= innerHeight + 1 &&
    document.documentElement.scrollWidth <= innerWidth + 1 &&
    document.documentElement.scrollHeight <= innerHeight + 1;
  check(
    inside,
    label +
      ': nothing reaches past the window (' +
      innerWidth +
      ' x ' +
      innerHeight +
      '; thread ends at ' +
      n(m.right) +
      ', prompt box at ' +
      n(p.bottom) +
      ', page ' +
      document.documentElement.scrollWidth +
      ' x ' +
      document.documentElement.scrollHeight +
      ')'
  );
  check(
    near(m.bottom, p.top) && box(host).bottom <= m.bottom + 0.5,
    label +
      ': the prompt box is under the thread, never over it (thread ends ' +
      n(m.bottom) +
      ', terminal ends ' +
      n(box(host).bottom) +
      ', prompt box starts ' +
      n(p.top) +
      ')'
  );
  check(
    acts.right <= m.right && acts.left >= box(island.querySelector('.tnt-head-text')).left,
    label + ': the top row keeps its buttons inside the island'
  );
  check(
    !!term && term.rows >= 4 && term.cols >= 20,
    label + ': the terminal has room (' + (term?.cols || 0) + ' x ' + (term?.rows || 0) + ')'
  );
}

let first = '',
  second = '';

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
  await agents.detect(true);
  threads.open();
  check(!!(await until(() => threads.visible(), 5000)), 'the thread layout is on and showing');
  const island = threads.slot('main');

  // ---- A: nothing open ----
  await until(() => island.querySelector('.tnt-view'), 3000);
  const none = island.querySelector('.tnt-none');
  check(
    shown(none) &&
      !shown(island.querySelector('.tnt-head')) &&
      !shown(island.querySelector('.tnt-term')),
    'with no thread the island says so and shows no top row or terminal: "' +
      (none?.textContent || '') +
      '"'
  );
  await shot('thread-view-empty');

  // ---- B: a real PowerShell session, started as a thread ----
  first = await openShell();
  check(!!first, 'a PowerShell thread is running');
  await wait(700);
  window.tnaiNative.pty.write(first, 'echo thread-marker-$(40+2)\r');
  await wait(700);

  // ---- C: the thread ----
  threads.open();
  await until(() => threads.visible(), 4000);
  check(
    !!(await until(() => threads.selected() === first && view().shown() === first, 6000)),
    'its thread is open'
  );
  const term = await until(() => {
    const t = view().term();
    return t?.element && shown(t.element) && box(t.element).height > 40 ? t : null;
  }, 10000);
  check(!!term, 'a terminal with a size is in the thread island');
  if (term) {
    check(
      !!(await until(() => /thread-marker-42/.test(textOf(term)), 8000)),
      'it is a view of this session: it shows what the session printed'
    );
    const head = island.querySelector('.tnt-head'),
      m = box(island),
      host = island.querySelector('.tnt-term-host'),
      h = box(host),
      title = head.querySelector('h1');
    check(
      shown(head) &&
        title.textContent.trim() === agents.sessions().find(s => s.paneId === first).name &&
        /Terminal/.test(head.querySelector('.tnt-head-tool').textContent),
      'the top row names the thread and its tool: "' +
        title.textContent +
        '", "' +
        head.querySelector('p').textContent +
        '"'
    );
    const state = head.querySelector('.tnt-head-state');
    check(
      shown(state) && !!state.textContent.trim() && !!state.dataset.tone,
      'and says its state in words: "' +
        state.textContent.trim() +
        '" (tone ' +
        state.dataset.tone +
        ')'
    );
    const titleLeft = box(title).left - m.left,
      termLeft = h.left - m.left,
      termRight = m.right - h.right,
      actsRight = m.right - box(head.querySelector('.tnt-head-acts')).right;
    check(
      near(titleLeft, termLeft) && near(termLeft, termRight) && near(actsRight, termRight),
      'one inset: the name starts at ' +
        n(titleLeft) +
        ', the terminal at ' +
        n(termLeft) +
        ', it ends ' +
        n(termRight) +
        ' from the edge and so do the buttons (' +
        n(actsRight) +
        ')'
    );
    check(
      near(h.top, box(head).bottom + 4, 1) && near(h.bottom, m.bottom, 1.5),
      'the terminal fills the island under the top row (starts ' +
        n(h.top - box(head).bottom) +
        ' under it, ends ' +
        n(m.bottom - h.bottom) +
        " above the island's end)"
    );
    {
      const screen = box(host.querySelector('.xterm-screen'));
      check(
        screen.width > h.width * 0.9 &&
          screen.height > h.height * 0.85 &&
          screen.bottom <= h.bottom + 1,
        'its screen fills its box (' +
          n(screen.width) +
          ' x ' +
          n(screen.height) +
          ' in ' +
          n(h.width) +
          ' x ' +
          n(h.height) +
          ')'
      );
    }
    const sized = await until(() => {
      const size = agents.ptySize.get(first);
      return size && size.cols === term.cols && size.rows === term.rows ? size : null;
    }, 5000);
    check(
      !!sized,
      "the session has this view's size (" +
        term.cols +
        ' x ' +
        term.rows +
        '; session ' +
        JSON.stringify(agents.ptySize.get(first)) +
        ')'
    );
    {
      // The five that 120 builds for a thread on its CLI screen; other files add theirs (the
      // helpers, the side column), so the row may hold more, all of the one size.
      const own = [
        '[data-tnai-font="-1"]',
        '[data-tnai-font="1"]',
        '.tnt-head-handoff',
        '.tnt-head-page',
        '.tnt-head-menu',
      ].map(selector => head.querySelector('.tnt-icon-btn' + selector));
      const buttons = [...head.querySelectorAll('.tnt-icon-btn')].filter(
          b => b.getClientRects().length
        ),
        sizes = [...new Set(buttons.map(b => n(box(b).width) + 'x' + n(box(b).height)))],
        page = head.querySelector('.tnt-head-page'),
        icon = box(page.querySelector('svg')),
        b = box(page);
      check(
        own.every(b => b && buttons.includes(b)) &&
          buttons[buttons.length - 1] === head.querySelector('.tnt-head-menu') &&
          sizes.length === 1 &&
          near(b.left + b.width / 2, icon.left + icon.width / 2, 1) &&
          near(b.top + b.height / 2, icon.top + icon.height / 2, 1) &&
          icon.width <= b.width * 0.6,
        'the top-row buttons (text smaller, text larger, handoff history, the Terminal page, the "..." menu last; ' +
          buttons.length +
          ' shown) of one size (' +
          sizes.join(', ') +
          '), the icon centred and at most 60% of its button'
      );
    }
    check(
      window.TnaiLiveTasks.target() === first,
      'the prompt box is aimed at this thread (target ' + window.TnaiLiveTasks.target() + ')'
    );

    // typing in the view reaches the session
    const type = text =>
      term.input ? term.input(text, true) : term._core.coreService.triggerDataEvent(text, true);
    type('echo typed-$(50+5)\r');
    check(
      !!(await until(() => /typed-55/.test(textOf(term)), 8000)),
      'typing in the view reaches the session and its answer comes back'
    );
    await shot('thread-view-terminal');

    // ---- D: the prompt box grows: the terminal waits, then resizes once ----
    const prompt = document.getElementById('prompt'),
      rowsBefore = term.rows,
      heightBefore = box(promptBox()).height;
    prompt.value = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const grew = await until(() => box(promptBox()).height > heightBefore + 20, 3000);
    check(
      !!grew,
      'a six-line draft makes the prompt box taller (' +
        n(heightBefore) +
        ' to ' +
        n(box(promptBox()).height) +
        ')'
    );
    await wait(300);
    check(
      term.rows === rowsBefore,
      'right after, the terminal still has its rows (' +
        term.rows +
        ' of ' +
        rowsBefore +
        ')' +
        (host.dataset.wait ? ' and is marked as waiting' : '')
    );
    check(
      box(promptBox()).top >= box(island).bottom - 1,
      'the taller prompt box is still under the thread, not over it'
    );
    const fewer = await until(() => term.rows < rowsBefore && !host.dataset.wait, 6000);
    check(
      !!fewer,
      'once the prompt box has been still, the terminal takes its smaller size (' +
        term.rows +
        ' rows)'
    );
    await shot('thread-view-draft');
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    check(
      !!(await until(() => term.rows === rowsBefore, 6000)),
      'with the draft gone it has its rows back (' + term.rows + ')'
    );

    // ---- E: another page of the menu: the thread island goes, its view is kept ----
    window.TnaiRoute('skills');
    await until(() => !threads.visible(), 5000);
    await wait(1200);
    check(
      !shown(threads.slot('main')) &&
        document.querySelectorAll('.ap-term-parked .tnt-term-host').length === 1,
      'on another page (Skills) the thread island is gone and its views are kept aside'
    );

    // ---- F: a second thread, and back ----
    second = await openShell();
    threads.open();
    await until(() => threads.visible(), 4000);
    window.tnaiNative.pty.write(second, 'echo second-marker-$(60+6)\r');
    threads.select(second);
    check(
      !!(await until(
        () => view().shown() === second && /second-marker-66/.test(textOf(view().term())),
        10000
      )),
      'opening the second thread shows the second session'
    );
    check(
      island.querySelectorAll('.tnt-term-box .xterm').length === 1 &&
        document.querySelectorAll('.ap-term-parked .tnt-term-host').length === 1,
      'one terminal is in the island and the first one is kept aside, not thrown away'
    );
    check(window.TnaiLiveTasks.target() === second, 'the prompt box follows to the second thread');
    threads.select(first);
    check(
      !!(await until(
        () => view().shown() === first && view().term() === term && shown(term.element),
        6000
      )),
      'back on the first thread, its own view returns'
    );
    check(/typed-55/.test(textOf(term)), 'with everything it showed before');
    await until(() => term.rows === rowsBefore, 4000);

    // ---- G: low and narrow windows ----
    const was = await main('minimum'),
      start = await main('content');
    await main('setMinimum', 600, 400);
    for (const [width, height, name] of [
      [1280, 620, 'thread-view-low'],
      [960, 680, ''],
      [768, 824, 'thread-view-narrow'],
    ]) {
      await main('size', width, height);
      await frame();
      await wait(1700);
      holds(width + ' x ' + height);
      if (name) await shot(name);
    }
    await main('size', start[0], start[1]);
    await main('setMinimum', was[0], was[1]);
    await frame();
    await wait(1700);
    holds('back at ' + start[0] + ' x ' + start[1]);
  }
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
