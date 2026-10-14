// Technically Not tools · desktop-check/tests/thread-frame.js — the thread layout's frame
// (src/scripts/118-thread-frame.js) in the real app
// with a throwaway profile. The thread layout is the app:
// a fresh settings folder opens on the Threads
// page in the clean Dark look, there is no switch for it in Settings, and nothing of the old left
// navigation shows. Then: the islands and the prompt box on one measured grid; the three-dots
// menu has no row for the old Overview or the old Agents page, also not by search; a row opens
// its page with the thread list where the old navigation was; a route to an old page lands on
// Threads; the menu's "Threads" row comes back. Pictures: thread-frame-on, thread-frame-menu,
// thread-frame-page, thread-frame-teal. Then one restart with the old switch's "off" still saved:
// it is ignored (thread-frame.after.js). Returns {ok, log}.
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
const layout = document.querySelector('.layout'),
  bar = document.querySelector('.top'),
  html = document.documentElement,
  threads = window.TnaiThreads;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 0.75) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
const rectText = el => {
  const r = box(el);
  return [n(r.left), n(r.top), n(r.width), n(r.height)].join(' ');
};
const modes = () => [...layout.classList].filter(c => /-mode$/.test(c)).join(' ');
const SETTING_KEY = 'tnai.thread-layout.v1';

// No item of the old left navigation is on screen.
const oldNavShown = () =>
  [...document.querySelectorAll('.sidebar .side-item, .sidebar .side-label')].filter(shown).length;

try {
  // ---- A: a first start: the thread layout is what opens, and there is no setting for it ----
  check(
    !!(await until(() => threads?.visible(), 8000)),
    'a fresh settings folder opens on the Threads page'
  );
  await wait(600);
  const ground = getComputedStyle(html).getPropertyValue('--pg-bg').trim();
  check(
    html.dataset.theme === 'dark' && html.classList.contains('tnt-on') && ground === '#0e0e13',
    'in the clean Dark look (theme ' + html.dataset.theme + ', ground ' + ground + ')'
  );
  check(
    !document.querySelector('.tnt-setting') &&
      ![...document.querySelectorAll('#settingsPanel-general h3')].some(
        h => h.textContent.trim() === 'Layout'
      ),
    'Settings › General has no switch for the layout'
  );
  check(
    typeof threads.setEnabled === 'undefined' && threads.enabled() === true && threads.visible(),
    'nothing switches it off: the frame has no such call'
  );
  check(
    !document.querySelector('.tnt-nav') && oldNavShown() === 0,
    'no "Threads" item on an old navigation, and no item of the old navigation shows'
  );

  // ---- B: the page ----
  await frame();
  const list = threads.slot('list'),
    main = threads.slot('main'),
    side = threads.slot('side'),
    promptBox = document.querySelector('footer.composer');
  check(
    layout.classList.contains('threads-mode') && html.classList.contains('tnt-open'),
    'on: threads-mode on the layout and tnt-open on the page'
  );
  check(modes() === 'threads-mode', 'no other page mode is set (' + modes() + ')');
  const others = [...layout.children].filter(
    el => !el.classList.contains('tnt-slot') && el !== promptBox && shown(el)
  );
  check(
    !others.length,
    'nothing of another page shows (' + (others.map(el => el.className).join(', ') || 'none') + ')'
  );
  check(
    shown(list) && shown(main) && !shown(side),
    'the list and the thread show; the code column is closed'
  );
  {
    const l = box(list),
      m = box(main),
      p = box(promptBox),
      area = box(layout);
    const left = l.left - area.left,
      gap = m.left - l.right,
      right = area.right - m.right,
      under = area.bottom - l.bottom,
      underPrompt = area.bottom - p.bottom;
    check(
      near(left, 12) &&
        near(gap, 12) &&
        near(right, 12) &&
        near(under, 12) &&
        near(underPrompt, 12),
      'one spacing: left ' +
        n(left) +
        ', between ' +
        n(gap) +
        ', right ' +
        n(right) +
        ', under the list ' +
        n(under) +
        ', under the prompt box ' +
        n(underPrompt) +
        ' (all 12)'
    );
    check(
      near(l.top, m.top) && near(l.top - area.top, 12),
      'the islands start on one line, 12 under the top bar (' + n(l.top - area.top) + ')'
    );
    check(near(l.width, 260), 'the list is 260 wide (' + n(l.width) + ')');
    check(
      near(m.bottom, p.top) && near(m.left, p.left) && near(m.right, p.right),
      'the prompt box is the bottom of the thread island: it starts where the thread ends (' +
        n(m.bottom) +
        ' / ' +
        n(p.top) +
        ') and has its sides'
    );
    const ta = document.getElementById('prompt');
    check(
      shown(ta) && box(ta).left >= p.left && box(ta).right <= p.right,
      'the prompt text box is on screen inside it'
    );
    check(
      getComputedStyle(list).backgroundColor === getComputedStyle(promptBox).backgroundColor &&
        getComputedStyle(main).backgroundColor === getComputedStyle(list).backgroundColor,
      'list, thread and prompt box are one surface color (' +
        getComputedStyle(list).backgroundColor +
        ')'
    );
    check(
      getComputedStyle(list).borderTopLeftRadius === getComputedStyle(main).borderTopLeftRadius &&
        getComputedStyle(promptBox).borderBottomLeftRadius ===
          getComputedStyle(list).borderBottomLeftRadius,
      'one corner radius (' + getComputedStyle(list).borderTopLeftRadius + ')'
    );
    check(
      area.right <= innerWidth + 1 &&
        area.bottom <= innerHeight + 1 &&
        document.documentElement.scrollWidth <= innerWidth + 1,
      'nothing reaches past the window (' +
        innerWidth +
        ' x ' +
        innerHeight +
        '; the layout ends at ' +
        n(area.right) +
        ' x ' +
        n(area.bottom) +
        ', the page is ' +
        document.documentElement.scrollWidth +
        ' wide)'
    );
  }
  check(
    getComputedStyle(html).getPropertyValue('--pg-bg').trim() === '#0e0e13',
    'the ground is the neutral dark (' +
      getComputedStyle(html).getPropertyValue('--pg-bg').trim() +
      ')'
  );
  const button = bar.querySelector('.tnt-menu-btn'),
    winButtons = bar.querySelector('.win-ctrls');
  check(shown(button), 'the three-dots button is in the top bar');
  check(
    !winButtons || (shown(winButtons) && box(button).right <= box(winButtons).left + 0.5),
    'the window buttons are still there, after the menu button'
  );
  {
    const b = box(button),
      icon = box(button.querySelector('svg'));
    check(
      near(b.left + b.width / 2, icon.left + icon.width / 2, 1) &&
        near(b.top + b.height / 2, icon.top + icon.height / 2, 1) &&
        icon.width <= b.width * 0.6,
      'its icon is centred and at most 60% of the button (' +
        n(icon.width) +
        ' in ' +
        n(b.width) +
        ')'
    );
  }
  await shot('thread-frame-on');

  // ---- C: the menu ----
  button.click();
  const menu = await until(() => {
    const el = document.querySelector('.tnt-menu');
    return shown(el) ? el : null;
  }, 3000);
  check(!!menu, 'a press opens the menu');
  await frame();
  await wait(250);
  if (menu) {
    // The panel is the menu's own file (124-thread-menu.js) and its rhythm is measured by that
    // file's test, thread-pages, in Dark and in Light. Here only the rows on screen count: the
    // panel keeps rows that show when a search finds them.
    const rows = [...menu.querySelectorAll('.tnt-menu-row')].filter(shown),
      m = box(menu);
    check(rows.length >= 6, 'the menu shows its rows (' + rows.length + ' on screen)');
    check(
      m.left >= 0 &&
        m.right <= innerWidth &&
        m.bottom <= innerHeight &&
        m.top >= box(button).bottom &&
        near(m.right, box(button).right, 1),
      'the menu is inside the window, under its button and ending on its right edge (menu ' +
        rectText(menu) +
        ', button ' +
        rectText(button) +
        ')'
    );

    // The rows are the menu's own business (124-thread-menu.js owns the panel when it is there);
    // this test needs the pages it presses below, and names what it found.
    const names = rows.map(r => r.querySelector('span')?.textContent.trim() || '');
    check(
      ['Threads', 'All threads', 'Usage and accounts', 'Skills', 'Settings'].every(name =>
        names.includes(name)
      ) && !names.includes('Agents and history'),
      'its rows, by name, with no row for the removed Agents and history page: ' + names.join(', ')
    );

    // The old frame's pages have no row, shown or kept for a search.
    const everyName = [...menu.querySelectorAll('.tnt-menu-row')].map(r =>
      (r.querySelector('span')?.textContent || '').trim()
    );
    const OLD = ['Overview'];
    check(
      !everyName.some(name => OLD.includes(name)),
      'no row for the old Overview, also not among the rows kept for a search'
    );
    const search = menu.querySelector('input');
    if (search) {
      const found = [];
      for (const words of ['overview', 'agent tree']) {
        search.value = words;
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(120);
        found.push(
          ...[...menu.querySelectorAll('.tnt-menu-row')]
            .filter(shown)
            .map(r => (r.querySelector('span')?.textContent || '').trim())
            .filter(name => OLD.includes(name))
        );
      }
      check(
        !found.length,
        'a search for them finds no such row (' + (found.join(', ') || 'none') + ')'
      );
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(120);
    } else check(false, 'the menu has no search field to try');
    await shot('thread-frame-menu');
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    check(
      menu.hidden && document.activeElement === button,
      'Escape closes it and the button has the focus again'
    );

    // A row opens its page inside the frame: the thread list stands where the old navigation
    // was, and nothing of the old navigation shows.
    const pressRow = async name => {
      button.click();
      await until(() => shown(menu), 2000);
      [...menu.querySelectorAll('.tnt-menu-row')]
        .filter(shown)
        .find(r => (r.querySelector('span')?.textContent || '').trim() === name)
        ?.click();
    };
    await pressRow('Skills');
    check(
      !!(await until(() => layout.classList.contains('skills-mode') && !threads.visible(), 4000)),
      '"Skills" opens the Skills page and the Threads page lets go'
    );
    await frame();
    await wait(400);
    check(
      !html.classList.contains('tnt-open') &&
        !layout.classList.contains('threads-mode') &&
        menu.hidden,
      'on that page: no Threads page class, the menu closed'
    );
    check(
      shown(button) && html.classList.contains('tnt-on'),
      'the three-dots button stays in the top bar on every page'
    );
    check(oldNavShown() === 0, 'no item of the old navigation shows on that page');
    {
      const column = layout.querySelector('.sidebar'),
        l = box(list),
        beside = [...layout.children].filter(
          el => el !== column && el !== promptBox && shown(el) && box(el).width > 200
        );
      check(
        shown(list) &&
          list.parentElement === column &&
          near(l.left, 12, 1) &&
          near(l.width, 260, 1),
        'the thread list stands in the left column, as on Threads (' + rectText(list) + ')'
      );
      check(
        beside.length > 0 && beside.every(el => box(el).left >= l.right - 0.75),
        'the page is beside the list and never under it (' +
          beside.map(el => el.className.split(' ')[0] + ' from ' + n(box(el).left)).join(', ') +
          '; list ends at ' +
          n(l.right) +
          ')'
      );
      check(
        near(innerHeight - l.bottom, 12, 1),
        'the list ends 12 above the window edge (' + n(innerHeight - l.bottom) + ')'
      );
    }
    await shot('thread-frame-page');

    // The old frame's pages cannot be reached: every route to them lands on Threads.
    window.TnaiRoute?.('overview');
    check(
      !!(await until(() => threads.visible() && modes() === 'threads-mode', 4000)),
      'a route to the old Overview lands on Threads (' + modes() + ')'
    );
    window.TnaiRoute?.('skills');
    await until(() => layout.classList.contains('skills-mode'), 4000);

    // Agents and history is no page any more (threads only): its route lands on Threads too.
    window.TnaiRoute?.('agents');
    check(
      !!(await until(() => threads.visible() && modes() === 'threads-mode', 4000)) &&
        shown(list) &&
        oldNavShown() === 0,
      'a route to the removed Agents and history page lands on Threads (' + modes() + ')'
    );

    // "Go to this agent" for an agent that has no thread says so, and nothing moves.
    window.TnaiRoute?.('skills');
    await until(() => layout.classList.contains('skills-mode'), 4000);
    check(
      threads.show('no-such-panel') === false && layout.classList.contains('skills-mode'),
      'TnaiThreads.show answers false for an agent with no thread, and the page stays'
    );
    window.TnaiRoute?.('skills');
    await until(() => layout.classList.contains('skills-mode'), 4000);
    document.querySelector('.sidebar .side-item[data-view="overview"]')?.click();
    check(
      !!(await until(() => threads.visible() && modes() === 'threads-mode', 4000)),
      'the old navigation item itself, pressed by a shortcut, lands on Threads too'
    );

    // The way back from a page: the menu's "Threads" row.
    window.TnaiRoute?.('skills');
    await until(() => layout.classList.contains('skills-mode'), 4000);
    await pressRow('Threads');
    check(
      !!(await until(
        () => threads.visible() && shown(list) && list.parentElement === layout,
        4000
      )),
      'the menu row "Threads" comes back, with the list in its own slot again'
    );
  }

  // ---- D: the accent ----
  // Only the accent is visited here: it changes what is accent-colored and never the ground. The
  // two looks, Dark and Light, are thread-pages' business.
  const accentBefore = window.TnaiTheme?.accent?.();
  if (window.TnaiTheme?.setAccent) {
    const send = document.querySelector('.composebox .send');
    const purple = getComputedStyle(send).backgroundImage;
    window.TnaiTheme.setAccent('teal');
    await frame();
    await wait(300);
    const teal = getComputedStyle(send).backgroundImage;
    check(
      teal !== purple && getComputedStyle(html).getPropertyValue('--pg-bg').trim() === '#0e0e13',
      'another accent recolors Send and leaves the ground alone (ground ' +
        getComputedStyle(html).getPropertyValue('--pg-bg').trim() +
        ')'
    );
    await shot('thread-frame-teal');
    window.TnaiTheme.setAccent(accentBefore || 'purple');
    await frame();
    await wait(300);
  } else check(false, 'TnaiTheme.setAccent is missing: no other accent was visited');

  // ---- the old Overview's file is gone; what the app still needed of it has its own owner ----
  {
    const chip = document.getElementById('pgTokChip'),
      promptBox = document.querySelector('footer.composer');
    check(
      !window.TnaiOverviewPurple && !document.getElementById('pgOverview'),
      'nothing of the old Overview is in the page'
    );
    check(
      !!chip &&
        chip.dataset.on === '1' &&
        chip.getClientRects().length > 0 &&
        chip.querySelector('.v')?.textContent === '0' &&
        window.TnaiTokenChip?.tokensPerMinute() === 0,
      'the top bar Tokens/min chip is painted by its own file and reads 0 with no agent ("' +
        chip?.textContent.trim() +
        '")'
    );
    check(
      /^#[0-9a-f]{6}$/.test(window.TnaiAgentMarks?.agentColor('Ash') || '') &&
        window.TnaiAgentMarks.agentColor('Ash') === window.TnaiAgentMarks.agentColor(' ash ') &&
        /^#/.test(window.TnaiAgentMarks.cliColor('Codex')),
      'an agent keeps its own color by its name, and a tool has its color (' +
        window.TnaiAgentMarks?.agentColor('Ash') +
        ', ' +
        window.TnaiAgentMarks?.cliColor('Codex') +
        ')'
    );
    check(
      promptBox?.parentElement === layout,
      'the prompt box is a part of the layout (the frame moves it in; the old Overview used to)'
    );
  }

  // ---- the top bar's chips: one height, one room between them, the same room inside each ----
  {
    const chips = [...document.querySelectorAll('.top .top-right .pg-chip')].filter(shown);
    const facts = chips.map(chip => {
      const rect = box(chip);
      const style = getComputedStyle(chip);
      const parts = [...chip.children].filter(shown).map(box);
      const first = parts[0];
      const last = parts[parts.length - 1];
      return {
        text: chip.textContent.trim().replace(/\s+/g, ' ').slice(0, 18),
        left: rect.left,
        right: rect.right,
        height: rect.height,
        padLeft: first ? first.left - rect.left : parseFloat(style.paddingLeft),
        padRight: last ? rect.right - last.right : parseFloat(style.paddingRight),
        inner: parts.slice(1).map((part, index) => n(part.left - parts[index].right)),
      };
    });
    const between = facts.slice(1).map((fact, index) => n(fact.left - facts[index].right));
    for (const fact of facts)
      log.push(
        'info chip "' +
          fact.text +
          '": height ' +
          n(fact.height) +
          ', room inside left ' +
          n(fact.padLeft) +
          ' right ' +
          n(fact.padRight) +
          ', between its parts ' +
          fact.inner.join(' / ')
      );
    check(
      facts.length >= 3 && facts.every(fact => near(fact.height, facts[0].height, 0.5)),
      'the top bar’s chips are one height (' + facts.map(fact => n(fact.height)).join(', ') + ')'
    );
    check(
      between.every(gap => near(gap, between[0], 0.5)),
      'the room between two chips is one number: ' + between.join(', ')
    );
    check(
      facts.every(fact => fact.inner.every(gap => near(gap, 6, 0.5))),
      'the parts of a chip stand 6 px apart in every chip: ' +
        facts.map(fact => fact.inner.join('/')).join(', ')
    );
    check(
      facts.every(fact => near(fact.padLeft, fact.padRight, 1)),
      'each chip has the same room at its left and its right end: ' +
        facts.map(fact => n(fact.padLeft) + '/' + n(fact.padRight)).join(', ')
    );
  }

  // ---- E: the old switch's "off", still saved in a settings folder, is ignored ----
  // (thread-frame.after.js looks at the app after the restart.)
  localStorage.setItem(SETTING_KEY, '0');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log, reload: true };
