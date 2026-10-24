// Technically Not tools · desktop-check/tests/thread-list.js — the thread layout's list
// (src/scripts/119-thread-list.js) in the real app
// with a throwaway profile. With nothing running the list says so. Two real PowerShell panels show
// as two thread rows with their device character, name and tool; rows share one size and one left
// edge; a click and the arrow keys open and move; New thread is the prompt box's own switch; a
// stopped session's character falls asleep; a row's ✕ shows on a real hover, closes a stopped
// thread at once and asks first for a running one (Delete too). No agent CLI is started, so a
// working agent, "Needs you" and sub-agent rows are not visited. Pictures: thread-list-empty,
// thread-list-rows, thread-list-close. Returns {ok, log}.
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
const agents = window.TnaiAgents,
  threads = window.TnaiThreads;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 0.75) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
const one = values => [...new Set(values.map(n))];
const rowOf = id =>
  threads.slot('list')?.querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]:not(.tnt-sub)');

async function openShell() {
  const before = new Set(agents.sessions().map(s => s.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  const id =
    opened?.paneId ||
    (await until(() => agents.sessions().find(s => !before.has(s.paneId))))?.paneId ||
    '';
  await until(() => agents.sessions().find(s => s.paneId === id && s.running), 15000);
  return id;
}

try {
  await agents.detect(true);
  threads.open();
  check(!!(await until(() => threads.visible(), 5000)), 'the thread layout is on and showing');
  const list = threads.slot('list');
  await until(() => list.querySelector('.tnt-lst'), 3000);

  // ---- A0: the ground's drift holds still while the window is not in front ----
  // A test window never takes focus, so it is the "not in front" case; taking the mark off for a
  // moment shows the rule is what stops the drift.
  {
    const root = document.documentElement;
    const drift = () => getComputedStyle(document.body, '::before').animationPlayState;
    check(
      !document.hasFocus() && root.classList.contains('tnai-away') && drift() === 'paused',
      'with the window not in front the ground drift is paused (' + drift() + ')'
    );
    root.classList.remove('tnai-away');
    const running = drift();
    root.classList.add('tnai-away');
    check(running === 'running', 'without the mark it drifts again (' + running + ')');
  }

  // ---- A: nothing running ----
  const newButton = list.querySelector('.tnt-new');
  check(shown(newButton), 'the list island shows New thread');
  check(
    shown(list.querySelector('.tnt-lst-empty')) && !list.querySelector('.tnt-th'),
    'with nothing running it says so and has no row: "' +
      (list.querySelector('.tnt-lst-empty')?.textContent || '') +
      '"'
  );
  {
    const island = box(list),
      b = box(newButton);
    const left = b.left - island.left,
      right = island.right - b.right,
      top = b.top - island.top;
    check(
      near(left, right) && near(left, top),
      'New thread sits on one padding: left ' + n(left) + ', right ' + n(right) + ', top ' + n(top)
    );
  }
  await shot('thread-list-empty');

  // ---- B: two real PowerShell panels become two threads ----
  const first = await openShell();
  const second = await openShell();
  check(!!first && !!second && first !== second, 'two PowerShell panels are running');
  threads.open();
  await until(() => threads.visible(), 4000);
  check(
    !!(await until(() => rowOf(first) && rowOf(second), 6000)),
    'each panel has its thread row'
  );
  const a = rowOf(first),
    b = rowOf(second);

  // A row is drawn as soon as its panel has a connection, and drawn again a moment after its
  // process has started (the list gathers pushes into one redraw). Until then it has no start
  // time and no folder, so it stands under "Other folders": the rows are measured once both
  // show their start time. Measuring before that gave a heading between them (40 px).
  await until(() => [a, b].every(row => row?.querySelector('time')?.textContent), 6000);
  if (a && b) {
    check(
      !!a.querySelector('b').textContent.trim() &&
        /Terminal/.test(a.querySelector('small').textContent),
      'a row shows a name and its tool: "' + a.textContent.replace(/\s+/g, ' ').trim() + '"'
    );
    check(
      a.querySelector('b').textContent !== b.querySelector('b').textContent,
      'the two threads have different names (' +
        a.querySelector('b').textContent +
        ', ' +
        b.querySelector('b').textContent +
        ')'
    );

    // the agent's letter in the color of its letter under the prompt box (128 agentColor)
    const letter = a.querySelector('.tnt-av');
    check(
      !!letter &&
        letter.textContent === a.querySelector('b').textContent.trim()[0].toUpperCase() &&
        letter.style.getPropertyValue('--c') ===
          window.TnaiAgentMarks.agentColor(
            window.TnaiThreadList.thread(first)?.session?.name ||
              window.TnaiThreadList.thread(first)?.name
          ),
      "the row shows the agent's letter in its own color (" +
        (letter?.textContent || 'none') +
        ', ' +
        (letter?.style.getPropertyValue('--c') || 'no color') +
        ')'
    );
    check(
      a.dataset.tone === b.dataset.tone && !!a.dataset.tone,
      'both rows carry a status tone (' + a.dataset.tone + ')'
    );
    const island = box(list),
      heading = list.querySelector('.tnt-proj'),
      ra = box(a),
      rb = box(b);
    check(
      one([ra.height, rb.height]).length === 1 &&
        one([ra.left, rb.left]).length === 1 &&
        one([ra.width, rb.width]).length === 1,
      'rows share one height (' +
        n(ra.height) +
        '), one left edge and one width (' +
        n(ra.width) +
        ')'
    );
    check(
      near(ra.left - island.left, island.right - ra.right) && near(ra.left, box(newButton).left),
      'a row has the same room left and right (' +
        n(ra.left - island.left) +
        ' / ' +
        n(island.right - ra.right) +
        ') and starts where New thread starts'
    );
    check(
      near(rb.top, ra.bottom),
      'rows follow each other with no uneven gap (' +
        n(rb.top - ra.bottom) +
        '); the list holds: ' +
        [...a.parentNode.children]
          .map(kid => kid.className + ' "' + kid.textContent.replace(/\s+/g, ' ').trim() + '"')
          .join(' | ')
    );
    check(
      shown(heading) && near(box(heading).height, 28) && /open/.test(heading.textContent),
      'a group heading of 28 names the group and counts it: "' + heading.textContent + '"'
    );
    const faces = [box(a.querySelector('.tnt-av')), box(b.querySelector('.tnt-av'))],
      names = [box(a.querySelector('b')), box(b.querySelector('b'))];
    check(
      one(faces.map(f => f.left)).length === 1 &&
        one(names.map(t => t.left)).length === 1 &&
        one(faces.map(f => f.width)).length === 1,
      'letters stand in one column (' +
        n(faces[0].left - island.left) +
        ') and names in one (' +
        n(names[0].left - island.left) +
        ')'
    );
    const time = box(a.querySelector('time'));
    check(
      time.right <= ra.right && time.left >= names[0].left && names[0].right <= time.left + 0.5,
      'the time stays inside the row and the name never runs under it'
    );
    check(
      list.scrollWidth <= list.clientWidth + 1 && a.scrollWidth <= a.clientWidth + 1,
      'nothing in the island is cut sideways'
    );

    // ---- C: opening and moving ----
    check(
      [first, second].includes(threads.selected()),
      'one of them is open without a press (the first thread when nothing was picked)'
    );
    const other = threads.selected() === first ? b : a,
      otherId = other.dataset.pane;
    other.click();
    check(
      !!(await until(
        () => threads.selected() === otherId && other.getAttribute('aria-selected') === 'true',
        3000
      )),
      'a click opens the other thread and marks its row'
    );
    check(
      list.querySelectorAll('.tnt-th[aria-selected="true"]').length === 1,
      'exactly one row is marked open'
    );
    a.focus();
    a.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    check(document.activeElement === b, 'Arrow Down moves to the next row');
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    check(document.activeElement === a, 'Home moves to the first row');
    check(
      [...list.querySelectorAll('.tnt-th')].filter(r => r.tabIndex === 0).length === 1,
      'one row takes Tab'
    );
    await shot('thread-list-rows');

    // ---- D: New thread is the prompt box's own switch ----
    newButton.click();
    await wait(200);
    check(
      newButton.getAttribute('aria-pressed') === 'true' &&
        !!window.TnaiLiveTasks.newAgent() === true,
      'New thread turns on the New agent switch of the prompt box'
    );
    check(
      shown(list.querySelector('.tnt-lst-note')) &&
        document.activeElement === document.getElementById('prompt'),
      'it says what to do next and puts the cursor in the prompt box'
    );
    newButton.click();
    await wait(200);
    check(
      newButton.getAttribute('aria-pressed') === 'false' &&
        !!window.TnaiLiveTasks.newAgent() === false,
      'a second press turns it off again'
    );

    // ---- E: a stopped session ----
    await agents.stop(second);
    check(
      !!(await until(
        () => rowOf(second)?.querySelector('.tnt-av')?.hasAttribute('data-asleep'),
        8000
      )),
      'the letter of a stopped session dims (tone ' +
        (rowOf(second)?.dataset.tone || 'row gone') +
        ')'
    );

    // ---- F: the row's ✕, with real pointer input ----
    let inputId = 0;
    const realInput = events =>
      new Promise(resolve => {
        const id = 'x' + ++inputId;
        window.__tnaiInputDone = window.__tnaiInputDone || {};
        window.__tnaiInputDone[id] = () => {
          delete window.__tnaiInputDone[id];
          resolve();
        };
        console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
      });
    const middle = el => {
      const r = box(el);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const runningRow = rowOf(first);
    const closeMark = runningRow?.querySelector('.tnt-th-x');
    check(
      !!closeMark && getComputedStyle(closeMark).opacity === '0',
      'a row has a ✕ that is hidden at rest'
    );
    if (runningRow && closeMark) {
      // A first move straight onto the row is not always taken as entering it: come in from
      // beside it, as agent-graph does.
      const rowMiddle = middle(runningRow);
      await realInput([
        { type: 'mouseMove', x: rowMiddle.x - 30, y: rowMiddle.y },
        { type: 'mouseMove', ...rowMiddle },
      ]);
      await until(() => getComputedStyle(closeMark).opacity === '1', 2000);
      const row = box(runningRow),
        mark = box(closeMark),
        icon = box(closeMark.querySelector('svg')),
        name = box(runningRow.querySelector('b')),
        line = box(runningRow.querySelector('.tnt-th-line'));
      check(
        getComputedStyle(closeMark).opacity === '1' &&
          getComputedStyle(runningRow.querySelector('time')).visibility === 'hidden',
        'on hover the ✕ shows and the time gives it its place (opacity ' +
          getComputedStyle(closeMark).opacity +
          ', time ' +
          getComputedStyle(runningRow.querySelector('time')).visibility +
          ', row hovered ' +
          runningRow.matches(':hover') +
          ')'
      );
      check(
        mark.right <= row.right && near(mark.top + mark.height / 2, row.top + row.height / 2, 1),
        'the ✕ sits inside the row, on its middle line (' +
          n(row.right - mark.right) +
          ' from its right edge)'
      );
      check(
        name.right <= mark.left && line.right <= mark.left,
        'neither the name nor the line under it runs under the ✕ (name ends ' +
          n(mark.left - name.right) +
          ', line ' +
          n(mark.left - line.right) +
          ' before it)'
      );
      check(
        near(icon.left + icon.width / 2, mark.left + mark.width / 2, 1) &&
          near(icon.top + icon.height / 2, mark.top + mark.height / 2, 1),
        'the icon is centered in its box'
      );
      await shot('thread-list-close');

      // A stopped thread asks too: a thread is never closed without a question. Cancel keeps it,
      // Close removes it.
      const stoppedRow = rowOf(second);
      if (stoppedRow) {
        await realInput([{ type: 'mouseMove', ...middle(stoppedRow) }]);
        const stoppedMark = stoppedRow.querySelector('.tnt-th-x');
        await until(() => getComputedStyle(stoppedMark).opacity === '1', 2000);
        const at = middle(stoppedMark);
        const pressMark = () =>
          realInput([
            { type: 'mouseMove', ...at },
            { type: 'mouseDown', ...at },
            { type: 'mouseUp', ...at },
          ]);
        await pressMark();
        const stoppedAsk = await until(
          () => document.querySelector('.tnt-view .tnai-panel-confirm'),
          3000
        );
        check(
          !!stoppedAsk && /Close/.test(stoppedAsk.textContent),
          'a press on the ✕ of a stopped thread asks first: "' +
            (stoppedAsk?.textContent.replace(/\s+/g, ' ').trim() || 'no question') +
            '"'
        );
        stoppedAsk?.querySelector('.tnai-ws-close-cancel')?.click();
        await wait(300);
        check(!!rowOf(second), 'Cancel keeps the stopped thread in the list');
        await realInput([{ type: 'mouseMove', ...middle(rowOf(second)) }]);
        await until(() => getComputedStyle(stoppedMark).opacity === '1', 2000);
        await pressMark();
        const again = await until(
          () => document.querySelector('.tnt-view .tnai-panel-confirm'),
          3000
        );
        again?.querySelector('.tnai-ws-close-confirm')?.click();
        check(
          !!(await until(
            () => !rowOf(second) && !agents.sessions().some(s => s.paneId === second),
            5000
          )),
          'Close in the question closes the stopped thread'
        );
      }

      // A running thread asks first; Delete on the focused row is the keyboard's way.
      runningRow.focus();
      runningRow.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
      );
      const ask = await until(() => document.querySelector('.tnt-view .tnai-panel-confirm'), 3000);
      check(
        !!ask && /Close/.test(ask.textContent),
        'Delete on a running thread asks first: "' +
          (ask?.textContent.replace(/\s+/g, ' ').trim() || 'no question') +
          '"'
      );
      ask?.querySelector('.tnai-ws-close-cancel')?.click();
      await wait(300);
      check(
        !!rowOf(first) && agents.sessions().some(s => s.paneId === first && s.running),
        'Cancel keeps the thread and its session running'
      );
      await realInput([{ type: 'mouseMove', x: 5, y: 5 }]);
    }
  }
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
