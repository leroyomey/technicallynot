// Technically Not tools · desktop-check/tests/agent-graph.js — Custom agents' helpers in threads of
// their own (43) against a fake graph in main (agent-graph.main.js; pty:start is recorded, nothing
// is launched, no prompt is sent). Everything is looked at on the Threads page: graph:spawn starts
// Claude Code as a thread in its lead's group of panels (underneath, never shown) with subagentOf,
// a name and the lead's account, without changing the page; the "↳ sub-agent of" line with its
// countdown and Keep under the top row of the helper's own thread and in the lead's Helpers tab
// (pointer, keyboard ring, smallest window, touch, Dark and Light); the helper set in under its
// lead in the thread list; Keep and Release call through; graph:close removes the thread and main
// is told; a full group is filled or continued in a new one; a signed-out CLI is refused; a
// lead's thread closed by the user is reported; Settings › Agents limits save. Returns {ok, log}.
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
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const shot = async name => {
  await (window.TnaiTest?.shot?.(name) ?? wait(450));
};
const layout = document.querySelector('.layout'),
  G = window.TnaiAgents;
const pane = id => document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]');
const wsPanes = ws =>
  document.querySelectorAll('.terminal-pane[data-workspace-id="' + CSS.escape(ws) + '"]').length;
try {
  check(
    !!window.TnaiGraph && typeof G.openIn === 'function',
    'TnaiGraph and TnaiAgents.openIn exist'
  );
  await main('install');
  await G.detect(true);

  // Underneath, the threads' panels stand in groups (a group holds TnaiPaneLimit.max of them; the
  // app opens the next one when one is full). A second group is made the way the app makes it, and
  // the parent (a custom agent's thread) lives there; the first stays the active one.
  const WS = window.TnaiTerminalWorkspaces,
    ws1 = WS.activeId();
  const ws2 = WS.overflow({ activate: false });
  await wait(100);
  const parentRec = window.TnaiNewTerminalPane({ workspaceId: ws2, name: 'Nova', quiet: true });
  await wait(0);
  const parentId = parentRec.id;
  const started = await G.openIn(parentId, 'Terminal', { name: 'Nova' });
  check(
    started?.ok && G.sessions().some(s => s.paneId === parentId && s.running),
    'parent thread started through openIn (recorded, no process)'
  );
  window.TnaiThreads.open();
  await wait(200);
  check(
    WS.activeId() === ws1 && !!ws2 && ws1 !== ws2 && window.TnaiThreads.visible() === true,
    'Threads shown, panel group 1 active, parent in group 2'
  );

  const now = Date.now();
  const root = {
    id: 'root-1',
    paneId: parentId,
    parentId: '',
    parentPaneId: '',
    name: 'Nova',
    purpose: 'Your custom agent',
    task: '',
    status: 'working',
    persistent: true,
    depth: 0,
    createdAt: now,
    doneAt: 0,
    report: '',
    closesAt: 0,
    root: true,
  };
  const child = {
    id: 'node-1',
    paneId: '',
    parentId: 'root-1',
    parentPaneId: parentId,
    name: 'Sub-agent',
    instance: 1,
    purpose: 'Write the settings page tests',
    task: 'Write tests for the settings page and report which pass.',
    status: 'starting',
    persistent: false,
    depth: 1,
    createdAt: now,
    doneAt: 0,
    report: '',
    closesAt: 0,
    root: false,
  };
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, child],
  });

  // Spawn.
  const before2 = wsPanes(ws2),
    before1 = wsPanes(ws1);
  await main('emit', 'graph:spawn', {
    nodeId: 'node-1',
    parentPaneId: parentId,
    purpose: child.purpose,
  });
  const start = await until(async () =>
    (await main('starts')).find(o => o.subagentOf === 'node-1')
  );
  const parentAccount = G.sessions().find(s => s.paneId === parentId)?.accountId || '';
  check(
    !!start && start.agent === 'Claude Code' && (start.accountId || '') === parentAccount,
    "spawn started Claude Code with subagentOf and the parent's account (mode " + start?.mode + ')'
  );
  const subId = start?.paneId;
  check(
    !!subId &&
      pane(subId)?.dataset.workspaceId === ws2 &&
      wsPanes(ws2) === before2 + 1 &&
      wsPanes(ws1) === before1,
    "new pane is in the parent's workspace (hidden), not the shown one"
  );
  check(
    !!start?.name &&
      !!(await until(() => window.TnaiThreadList.thread(subId)?.name === start.name, 5000)),
    'its thread is named "' + start?.name + '" and that name was sent to main'
  );
  check(
    WS.activeId() === ws1 &&
      window.TnaiThreads.visible() === true &&
      !layout.classList.contains('terminal-mode'),
    'page and shown workspace unchanged'
  );

  // Main attached it: working, then done with a countdown.
  child.paneId = subId;
  child.name = start.name;
  child.status = 'working';
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, child],
  });

  // Where a user reads a helper's line: under the top row of the helper's own thread.
  const shownEl = el => !!el && el.getClientRects().length > 0;
  const inside = (inner, outer) => {
    const a = inner.getBoundingClientRect(),
      b = outer.getBoundingClientRect();
    return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1;
  };
  const threadView = window.TnaiThreadView;
  const island = window.TnaiThreads.slot('main');
  const ownLine = () =>
    island.querySelector('.tnt-view > .tnt-helper-line .tnai-graph-line:not([hidden])');
  await until(() => window.TnaiThreadList.thread(subId), 6000);
  window.TnaiThreads.show(subId);
  await until(() => threadView.shown() === subId && shownEl(ownLine()), 6000);
  const headLine = ownLine;
  check(
    !!(await until(
      () =>
        /sub-agent of Nova · Write the settings page tests/.test(headLine()?.textContent || '') &&
        /Working/.test(headLine().textContent)
    )),
    'the helper’s own thread: "↳ sub-agent of Nova · purpose · Working" ("' +
      (headLine()?.textContent || 'no line').trim().slice(0, 90) +
      '")'
  );
  child.status = 'done';
  child.doneAt = Date.now();
  child.report = 'All 4 settings tests pass. Files: tests/settings.js.';
  child.closesAt = Date.now() + 45000;
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, child],
  });
  check(
    !!(await until(() => /Done · closes in 4\ds/.test(headLine()?.textContent || ''))),
    'countdown: ' + headLine()?.querySelector('.g-state')?.textContent
  );
  const t1 = headLine()?.querySelector('.g-state').textContent;
  await wait(1300);
  check(
    headLine()?.querySelector('.g-state').textContent !== t1,
    'countdown ticks (' + t1 + ' → ' + headLine()?.querySelector('.g-state').textContent + ')'
  );
  const keepBtn = headLine()?.querySelector('.tnai-graph-keep');
  check(
    !!keepBtn &&
      !keepBtn.hidden &&
      keepBtn.textContent === 'Keep' &&
      Math.round(keepBtn.getBoundingClientRect().height) === 24,
    'Keep button on the helper’s own thread, ' +
      Math.round(keepBtn?.getBoundingClientRect().height || 0) +
      ' px high (24 wanted)'
  );

  // The thread list: a sub-agent in a panel of its own is set in under its lead (119).
  const threadRow = id =>
    document.querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]:not(.tnt-sub)');
  const kid = await until(
    () =>
      threadRow(subId)?.classList.contains('tnt-kid') && threadRow(parentId) && threadRow(subId),
    5000
  );
  const rowsInOrder = [...document.querySelectorAll('.tnt-th')];
  check(
    !!kid &&
      !threadRow(parentId).classList.contains('tnt-kid') &&
      rowsInOrder.indexOf(threadRow(parentId)) < rowsInOrder.indexOf(kid),
    'thread list: the sub-agent row is set in under its lead (rows: ' +
      rowsInOrder
        .map(
          row =>
            row.querySelector('b')?.textContent +
            (row.classList.contains('tnt-kid') ? ' (set in)' : '')
        )
        .join(', ') +
      ')'
  );
  await shot('agent-graph-thread-row');

  // Keep → through to main, then "Kept" + Release; Release → back.
  keepBtn.click();
  check(
    !!(await until(async () =>
      (await main('calls')).some(c => c[0] === 'keep' && c[1] === 'node-1' && c[2] === true)
    )),
    'Keep calls native.graph.keep(id, true)'
  );
  check(
    !!(await until(
      () =>
        /Kept/.test(headLine()?.textContent || '') &&
        headLine().querySelector('.tnai-graph-keep').textContent === 'Release'
    )),
    'kept: "Done · Kept" + Release'
  );
  check(
    !layout.classList.contains('agents-mode') && window.TnaiThreads.visible() === true,
    'Keep did not open the Agents page'
  );

  // What a user sees of it (threads only): the helper is set in under its lead in the thread
  // list; its line with Keep or Release stands under the top row of its own thread and, on the
  // lead's thread, under the chips of the Helpers tab. (The helper's report is its conversation,
  // which the test `thread-helpers` reads; the stand-in here has none.)
  window.TnaiThreads.show(subId);
  await until(() => threadView.shown() === subId, 6000);
  {
    const row = id =>
      window.TnaiThreads.slot('list').querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]');
    check(
      !!(await until(() => row(subId)?.classList.contains('tnt-kid'), 4000)) &&
        !row(parentId)?.classList.contains('tnt-kid'),
      'thread list: the helper is set in under its lead'
    );
  }
  check(
    !!(await until(
      () => shownEl(ownLine()) && /sub-agent of Nova/.test(ownLine().textContent),
      5000
    )) && inside(ownLine().querySelector('.tnai-graph-keep'), island),
    'the helper’s own thread: its line with Release stands under the top row, inside the island ("' +
      (ownLine()?.textContent || 'no line').trim().slice(0, 90) +
      '")'
  );
  await wait(500);
  await shot('agent-graph-own-thread');

  // The same spot in Light, so each place of the line has a picture in each look.
  window.TnaiTheme.set('light');
  await wait(500);
  await shot('agent-graph-own-thread-light');
  window.TnaiTheme.set('dark');
  await wait(500);

  window.TnaiThreads.show(parentId);
  await until(() => threadView.shown() === parentId, 6000);
  check(
    !island.querySelector('.tnt-view > .tnt-helper-line .tnai-graph-line:not([hidden])'),
    'the lead’s own thread has no such line: it is no helper'
  );
  window.TnaiThreadHelpers.open('pane:' + subId);
  const side = window.TnaiThreads.slot('side');
  const sideLine = () => side.querySelector('.tnt-helper-line .tnai-graph-line:not([hidden])');
  await until(() => shownEl(sideLine()), 5000);
  const sideText = sideLine()?.textContent || '';
  check(
    shownEl(sideLine()) &&
      /Write the settings page tests/.test(sideText) &&
      /Kept/.test(sideText) &&
      sideLine().querySelector('.tnai-graph-keep')?.textContent === 'Release' &&
      inside(sideLine().querySelector('.tnai-graph-keep'), side),
    'Helpers tab: under the chips the chosen helper’s line says its purpose and "Kept", with Release inside the column ("' +
      sideText.trim().slice(0, 110) +
      '")'
  );
  await wait(500);
  await shot('agent-graph-helpers');
  window.TnaiTheme.set('light');
  await wait(500);
  await shot('agent-graph-helpers-light');
  window.TnaiTheme.set('dark');
  await wait(300);
  sideLine()?.querySelector('.tnai-graph-keep[data-on]')?.click();
  check(
    !!(await until(async () => (await main('calls')).some(c => c[0] === 'keep' && c[2] === false))),
    'Release in the Helpers tab calls native.graph.keep(id, false)'
  );

  // The button's other states, each with a picture: under a real pointer, with the keyboard's
  // focus ring, at the smallest window and by finger. The line now says "Done · closes in" with
  // Keep, the state in which a pointer over the button changes its look.
  const realInput = events =>
    new Promise(resolve => {
      const id = 'i' + ++callId;
      window.__tnaiInputDone = window.__tnaiInputDone || {};
      window.__tnaiInputDone[id] = () => {
        delete window.__tnaiInputDone[id];
        resolve();
      };
      console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
    });
  const sideKeep = () => sideLine()?.querySelector('.tnai-graph-keep');
  await until(() => sideKeep()?.textContent === 'Keep', 4000);
  const restLook = getComputedStyle(sideKeep()).backgroundColor;
  {
    const box = sideKeep().getBoundingClientRect();
    await realInput([
      { type: 'mouseMove', x: box.left + box.width / 2 - 30, y: box.top + box.height / 2 },
      { type: 'mouseMove', x: box.left + box.width / 2, y: box.top + box.height / 2 },
    ]);
  }
  await wait(500);
  const hoverLook = getComputedStyle(sideKeep()).backgroundColor;
  check(
    sideKeep().matches(':hover') && hoverLook !== restLook,
    'Keep under a real pointer: its surface changes (' + restLook + ' → ' + hoverLook + ')'
  );
  await shot('agent-graph-keep-hover');
  await wait(500);

  // The pointer leaves. The test window never has the keyboard, so the page is told to behave as
  // if it had (the window itself stays unfocused), and a real Tab press makes the next focus a
  // keyboard focus: only that draws the ring.
  await main('pageFocus', true);
  await realInput([
    { type: 'mouseMove', x: 400, y: 400 },
    { type: 'keyDown', keyCode: 'Tab' },
    { type: 'keyUp', keyCode: 'Tab' },
  ]);
  sideKeep().focus({ preventScroll: true });
  await wait(500);
  {
    const look = getComputedStyle(sideKeep());
    check(
      sideKeep().matches(':focus-visible') &&
        look.outlineStyle === 'solid' &&
        Math.round(parseFloat(look.outlineWidth) * window.devicePixelRatio) >= 2,
      // The ring's width is the token --pg-ring (2.4px): two whole screen pixels at the app's
      // zooms.
      'Keep with keyboard focus (screen pixels per px: ' +
        window.devicePixelRatio +
        '): a ring of ' +
        look.outlineWidth +
        ' ' +
        look.outlineStyle +
        ' ' +
        look.outlineColor +
        ' (focus-visible: ' +
        sideKeep().matches(':focus-visible') +
        ')'
    );
  }
  await shot('agent-graph-keep-focus');
  await wait(500);

  // The ring's real thickness, counted in the screen pixels of a picture, at a zoom of 1, at the
  // app's usual zoom and at its smallest. The count depends on the screen, so it is only printed;
  // what is checked holds on any screen: the page draws whole screen pixels, so the 2.4px of
  // --pg-ring reads back as floor(2.4 × screen pixels per px) of them, and the ring has the
  // accent's color.
  const numbersOf = color =>
    color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
  const apart = (one, other) =>
    Math.abs(one[0] - other[0]) + Math.abs(one[1] - other[1]) + Math.abs(one[2] - other[2]);
  const ringRow = async () => {
    const box = sideKeep().getBoundingClientRect();
    return main('pixelRow', box.left, box.top + box.height / 2, 4, 8);
  };
  const usualZoom = await main('zoom');
  const accentProbe = document.createElement('i');
  accentProbe.style.color = 'var(--pg-accent)';
  document.body.append(accentProbe);
  const accentOf = () => getComputedStyle(accentProbe).color;
  const ringNotes = [];
  let ringRuleHolds = true;
  for (const factor of [1, usualZoom, 0.85]) {
    await main('setZoom', factor);
    await wait(300);
    const look = getComputedStyle(sideKeep());
    const read = await ringRow();
    const accent = numbersOf(look.outlineColor);
    const thick = read.row.filter(pixel => apart(pixel, accent) < 120).length;
    const drawn = Math.round(parseFloat(look.outlineWidth) * window.devicePixelRatio);
    if (
      drawn !== Math.max(2, Math.floor(2.4 * window.devicePixelRatio + 0.001)) ||
      look.outlineColor !== accentOf()
    )
      ringRuleHolds = false;
    ringNotes.push(
      'zoom ' +
        read.zoom.toFixed(2) +
        ' (screen pixels per px ' +
        window.devicePixelRatio.toFixed(3) +
        ', picture scale ' +
        read.scale.toFixed(2) +
        '): computed ' +
        look.outlineWidth +
        ', ' +
        thick +
        ' accent pixels in the picture [' +
        read.row.map(pixel => pixel.join(',')).join(' ') +
        ']'
    );
    if (factor === 1) {
      await shot('agent-graph-keep-focus-zoom1');
      await wait(500);
    }
  }
  await main('setZoom', usualZoom);
  check(
    ringRuleHolds,
    'the ring is --pg-ring in the accent, two whole screen pixels or more · ' +
      ringNotes.join(' · ')
  );
  sideKeep().blur();

  // The same two states in Light: the pointer's surface is soft but there, and the ring stands
  // out from the island (3 to 1 is the least a focus ring should have).
  const brightness = color => {
    const part = value => {
      const share = value / 255;
      return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * part(color[0]) + 0.7152 * part(color[1]) + 0.0722 * part(color[2]);
  };
  const contrast = (one, other) => {
    const high = Math.max(brightness(one), brightness(other)),
      low = Math.min(brightness(one), brightness(other));
    return (high + 0.05) / (low + 0.05);
  };
  window.TnaiTheme.set('light');
  await realInput([{ type: 'mouseMove', x: 400, y: 400 }]);
  await wait(500);
  const restLight = getComputedStyle(sideKeep()).backgroundColor;
  const restRow = (await ringRow()).row;
  {
    const box = sideKeep().getBoundingClientRect();
    await realInput([
      { type: 'mouseMove', x: box.left + box.width / 2 - 30, y: box.top + box.height / 2 },
      { type: 'mouseMove', x: box.left + box.width / 2, y: box.top + box.height / 2 },
    ]);
  }
  await wait(500);
  {
    const hoverLight = getComputedStyle(sideKeep()).backgroundColor;
    const hoverRow = (await ringRow()).row;
    check(
      sideKeep().matches(':hover') && hoverLight !== restLight,
      'Light, Keep under a real pointer: its surface changes (' +
        restLight +
        ' → ' +
        hoverLight +
        '; in the picture the island is ' +
        restRow[0].join(',') +
        ', the button ' +
        restRow[12].join(',') +
        ' at rest and ' +
        hoverRow[12].join(',') +
        ' under the pointer)'
    );
  }
  await shot('agent-graph-keep-hover-light');
  await wait(500);
  await realInput([
    { type: 'mouseMove', x: 400, y: 400 },
    { type: 'keyDown', keyCode: 'Tab' },
    { type: 'keyUp', keyCode: 'Tab' },
  ]);
  sideKeep().focus({ preventScroll: true });
  await wait(500);
  {
    const look = getComputedStyle(sideKeep());
    const accent = numbersOf(look.outlineColor);
    const row = (await ringRow()).row;
    const ringPixel = row.reduce((best, pixel) =>
      apart(pixel, accent) < apart(best, accent) ? pixel : best
    );
    const againstIsland = contrast(accent, row[0]),
      againstButton = contrast(accent, row[12]),
      drawnAgainstIsland = contrast(ringPixel, row[0]);
    check(
      sideKeep().matches(':focus-visible') &&
        look.outlineColor === accentOf() &&
        againstIsland >= 3 &&
        drawnAgainstIsland >= 3,
      'Light, Keep with keyboard focus: the ring ' +
        look.outlineColor +
        ' against the island ' +
        row[0].join(',') +
        ' is ' +
        againstIsland.toFixed(2) +
        ' to 1, against the button ' +
        row[12].join(',') +
        ' ' +
        againstButton.toFixed(2) +
        ' to 1; as drawn (' +
        ringPixel.join(',') +
        ') ' +
        drawnAgainstIsland.toFixed(2) +
        ' to 1 [' +
        row.map(pixel => pixel.join(',')).join(' ') +
        ']'
    );
  }
  await shot('agent-graph-keep-focus-light');
  await wait(500);
  sideKeep().blur();
  accentProbe.remove();
  window.TnaiTheme.set('dark');
  await wait(500);
  await main('pageFocus', false);

  // Whole: the state and the button are not cut, do not overlap and stay inside their box; only
  // the purpose may end in an ellipsis.
  const whole = (line, box) => {
    const state = line.querySelector('.g-state'),
      text = line.querySelector('.g-text'),
      button = line.querySelector('.tnai-graph-keep');
    const stateBox = state.getBoundingClientRect(),
      textBox = text.getBoundingClientRect(),
      buttonBox = button.getBoundingClientRect(),
      outer = box.getBoundingClientRect();
    const fine =
      state.scrollWidth <= state.clientWidth + 1 &&
      button.scrollWidth <= button.clientWidth + 1 &&
      textBox.right <= stateBox.left + 1 &&
      stateBox.right <= buttonBox.left + 1 &&
      textBox.left >= outer.left - 1 &&
      buttonBox.right <= outer.right + 1 &&
      buttonBox.bottom <= outer.bottom + 1 &&
      textBox.width >= 60;
    const numbers =
      'purpose ' +
      Math.round(textBox.left) +
      '–' +
      Math.round(textBox.right) +
      ', state ' +
      Math.round(stateBox.left) +
      '–' +
      Math.round(stateBox.right) +
      ', button ' +
      Math.round(buttonBox.left) +
      '–' +
      Math.round(buttonBox.right) +
      ' × ' +
      Math.round(buttonBox.height) +
      ' high, box ' +
      Math.round(outer.left) +
      '–' +
      Math.round(outer.right);
    return { fine, numbers, height: Math.round(buttonBox.height) };
  };
  const wideSize = [window.innerWidth, window.innerHeight];
  const smallSize = await main('size', 768, 680);
  await wait(500);
  {
    const result = whole(sideLine(), side);
    check(
      shownEl(sideLine()) && result.fine && result.height === 24,
      'smallest window (' +
        smallSize.join(' x ') +
        '), Helpers tab: the line is whole (' +
        result.numbers +
        ')'
    );
  }
  await shot('agent-graph-helpers-small');
  await wait(500);

  // By finger (touch switched on, the mouse is not changed): the button is 44 px high.
  await main('touch', true);
  await wait(300);
  {
    const result = whole(sideLine(), side);
    check(
      matchMedia('(pointer: coarse)').matches && result.fine && result.height === 44,
      'touch, Helpers tab: Keep is 44 px high and the line is whole (' + result.numbers + ')'
    );
  }
  await shot('agent-graph-helpers-touch');
  await wait(500);
  window.TnaiThreadHelpers.close();
  window.TnaiThreads.show(subId);
  await until(() => threadView.shown() === subId && shownEl(ownLine()), 6000);
  await wait(300);
  {
    const result = whole(ownLine(), island);
    check(
      result.fine && result.height === 44,
      'touch, the helper’s own thread: Keep is 44 px high and the line is whole (' +
        result.numbers +
        ')'
    );
  }
  await main('touch', false);
  await wait(300);
  {
    const result = whole(ownLine(), island);
    check(
      !matchMedia('(pointer: coarse)').matches && result.fine && result.height === 24,
      'smallest window, the helper’s own thread: the line is whole (' + result.numbers + ')'
    );
  }
  await shot('agent-graph-own-thread-small');
  await wait(500);
  await main('size', wideSize[0], wideSize[1]);
  window.TnaiThreads.show(parentId);
  await until(() => threadView.shown() === parentId, 6000);
  window.TnaiThreadHelpers.close();

  // graph:close removes the pane (no dialog) and main is told.
  await main('emit', 'graph:close', { nodeId: 'node-1', paneId: subId });
  check(!!(await until(() => !pane(subId))), 'graph:close removed the pane');
  check(!document.querySelector('.tnai-ws-close-overlay:not([hidden])'), 'no confirm dialog');
  check(
    !!(await until(async () =>
      (await main('calls')).some(c => c[0] === 'removed' && c[1] === subId)
    )),
    'native.graph.removed(paneId) called'
  );
  check(!G.sessions().some(s => s.paneId === subId), 'its session is gone');

  // Full workspace (TnaiPaneLimit.max panes) with empty panels: a sub-agent fills an empty one
  // first (0.3.15), no panel is added.
  for (let i = wsPanes(ws2); i < window.TnaiPaneLimit.max; i++)
    window.TnaiNewTerminalPane({ workspaceId: ws2, quiet: true });
  await wait(50);
  let startsBefore = (await main('starts')).length;
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, { ...child, id: 'node-2', paneId: '', status: 'starting' }],
  });
  await main('emit', 'graph:spawn', { nodeId: 'node-2', parentPaneId: parentId, purpose: 'x' });
  await wait(600);
  check(
    wsPanes(ws2) === window.TnaiPaneLimit.max && (await main('starts')).length === startsBefore + 1,
    'full workspace with an empty panel: the sub-agent fills it, no panel added'
  );

  // Every panel has a connection: the sub-agent continues in a new workspace (04 overflow, 0.3.41),
  // ws2 stays full, and the shown workspace doesn't change.
  const emptyPanes = () =>
    [
      ...document.querySelectorAll('.terminal-pane[data-workspace-id="' + CSS.escape(ws2) + '"]'),
    ].filter(p => !p.querySelector('.terminal-provider-select')?.value);
  for (const p of emptyPanes()) await G.openIn(p.dataset.paneId, 'Terminal');
  await wait(100);
  startsBefore = (await main('starts')).length;
  const shownBefore = window.TnaiActiveTerminalWorkspaceId;
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, { ...child, id: 'node-3', paneId: '', status: 'starting' }],
  });
  await main('emit', 'graph:spawn', { nodeId: 'node-3', parentPaneId: parentId, purpose: 'y' });
  await wait(600);
  const over = (await main('starts')).slice(startsBefore),
    overWs = pane(over[0]?.paneId || '')?.dataset.workspaceId;
  check(
    !emptyPanes().length &&
      wsPanes(ws2) === window.TnaiPaneLimit.max &&
      over.length === 1 &&
      over[0].subagentOf === 'node-3' &&
      overWs &&
      overWs !== ws2 &&
      window.TnaiActiveTerminalWorkspaceId === shownBefore,
    'full workspace, every panel in use: the sub-agent opens in a new workspace, quietly (' +
      (overWs || 'none') +
      ')'
  );

  // A signed-out CLI: no sign-in panel nobody watches, no pty:start; main gets the reason at once
  // (spawnFailed) for the lead's tnai_delegate.
  await main('detect', [
    { id: 'Claude Code', installed: true, loggedIn: true, version: 'test', account: '' },
    { id: 'Codex', installed: true, loggedIn: false, version: 'test', account: '' },
  ]);
  await G.detect(true);
  startsBefore = (await main('starts')).length;
  await main('setState', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [root, { ...child, id: 'node-4', paneId: '', status: 'starting' }],
  });
  await main('emit', 'graph:spawn', {
    nodeId: 'node-4',
    parentPaneId: parentId,
    agent: 'Codex',
    purpose: 'z',
  });
  const refused = await until(async () =>
    (await main('calls')).find(c => c[0] === 'spawnFailed' && c[1] === 'node-4')
  );
  check(
    /^Codex is not signed in: start a thread with it and sign in, then delegate again$/.test(
      refused?.[2] || ''
    ) && (await main('starts')).length === startsBefore,
    'signed-out CLI: main told "' + refused?.[2] + '", no sign-in flow started'
  );

  // The user closes the lead's thread ("Close thread" in the thread's menu asks first, over the
  // thread) → main is told.
  window.TnaiThreads.show(parentId);
  await until(() => threadView.shown() === parentId, 6000);
  window.TnaiLiveTasks.close(parentId, island);
  const closeYes = await until(
    () => island.querySelector(':scope > .tnai-panel-confirm .tnai-ws-close-confirm'),
    4000
  );
  check(!!closeYes, 'Close thread asks first, over the thread');
  closeYes?.click();
  check(
    !!(await until(async () =>
      (await main('calls')).some(c => c[0] === 'removed' && c[1] === parentId)
    )),
    'a lead’s thread closed by the user → native.graph.removed'
  );

  // Settings › Agents: Delegation limits.
  window.TnaiSettings.open('agents');
  await wait(200);
  const input = key =>
    document.querySelector('#tnaiDelegationMount input[data-limit="' + key + '"]');
  check(
    ['maxDepth', 'maxActivePerAgent', 'maxActiveTotal', 'graceSeconds'].every(k => input(k)) &&
      input('graceSeconds').value === '60',
    'Settings › Agents shows the 4 limits from pushed state'
  );
  input('maxDepth').value = '2';
  input('maxDepth').dispatchEvent(new Event('change', { bubbles: true }));
  check(
    !!(await until(async () =>
      (await main('calls')).some(c => c[0] === 'settings' && c[1].maxDepth === 2)
    )),
    'depth saved through native.graph.settings'
  );
  input('graceSeconds').value = '90';
  input('graceSeconds').dispatchEvent(new Event('change', { bubbles: true }));
  check(
    !!(await until(async () =>
      (await main('calls')).some(c => c[0] === 'settings' && c[1].graceSeconds === 90)
    )) && /Saved/.test(document.querySelector('.tnai-deleg-saved').textContent),
    'grace seconds saved ("Saved")'
  );

  // No limit: the per-agent count's checkbox saves 0, disables the number (∞);
  // off again restores the default 3.
  const free = document.querySelector(
    '#tnaiDelegationMount input[data-nolimit="maxActivePerAgent"]'
  );
  check(
    !!free && !document.querySelector('#tnaiDelegationMount input[data-nolimit="maxDepth"]'),
    'No limit offered for the sub-agent counts, not for depth'
  );
  free.checked = true;
  free.dispatchEvent(new Event('change', { bubbles: true }));
  check(
    !!(await until(
      async () =>
        (await main('calls')).some(c => c[0] === 'settings' && c[1].maxActivePerAgent === 0) &&
        input('maxActivePerAgent').disabled &&
        input('maxActivePerAgent').placeholder === '∞'
    )),
    'No limit saves 0 and shows ∞ (number disabled)'
  );
  free.checked = false;
  free.dispatchEvent(new Event('change', { bubbles: true }));
  check(
    !!(await until(
      () =>
        !input('maxActivePerAgent').disabled &&
        input('maxActivePerAgent').value === '3' &&
        window.TnaiGraph.state().settings.maxActivePerAgent === 3
    )),
    'No limit off again → back to 3'
  );

  // Estimated team usage: nothing invented before main has an estimate, then per task and a full
  // team at the per-agent limit.
  const estRow = () => document.querySelector('#tnaiDelegationMount .tnai-deleg-est');
  check(
    estRow()?.querySelector('em').textContent === '—' &&
      /after 3 sub-agent tasks/.test(estRow().querySelector('small').textContent),
    'no estimate yet → "—" and when it will show'
  );
  await main('setState', {
    ...window.TnaiGraph.state(),
    estimate: {
      all: { perTask: 62000, samples: 14, agent: '' },
      byCli: {
        Codex: {
          perTask: 40000,
          samples: 5,
          agent: 'Codex',
          planPct: 4,
          planSamples: 3,
          planWindow: 300,
          plan: 'plus',
        },
      },
    },
  });
  check(
    !!(await until(() => estRow().querySelector('em').textContent === '≈ ~186k for 3')) &&
      /~62k tokens \(median of your last 14\)/.test(estRow().querySelector('small').textContent),
    'estimate row: ~62k per task, ≈ ~186k for a team of 3'
  );
  check(
    /Codex: about 4% of your 5-hour plan window per task, ≈ 12% for 3 \(Codex’s own usage percent, plan plus\)/.test(
      estRow().querySelector('small').textContent
    ),
    'Codex share of its own plan window shown: ' + estRow().querySelector('small').textContent
  );
  await shot('agent-graph-settings');
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
