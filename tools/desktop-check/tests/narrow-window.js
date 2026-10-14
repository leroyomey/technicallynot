// Technically Not tools · desktop-check/tests/narrow-window.js — two things the smallest window
// (768 x 680) got wrong at full scale, which the size tests found: the window's own buttons stood
// partly outside the window (Close by 26 px), and on the Live preview page the thread list was so
// narrow that the threads' names were not drawn at all. Checked at 768 x 680 and at 1024 x 683,
// each at the app's own scale and at full scale, on Threads and on Live preview: every part of
// the top bar lies inside the window and no two parts overlap; the thread list has its width and
// every thread's name is drawn with room for at least a few letters. Two PowerShell threads are
// opened as threads (the old terminal grid is never shown).
// Pictures: narrow-window-threads-768, narrow-window-preview-768. Returns {ok, log}.
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
const threads = window.TnaiThreads;
const round = value => Math.round(value);
const shown = node => !!node && node.getClientRects().length > 0;
const opened = [];

// The parts of the top bar a user sees, each with its box.
function barParts() {
  const bar = document.querySelector('header.top');
  return [
    ...bar.querySelectorAll(
      '.brand, .tnt-fold, .project, .pg-chip, .tnt-menu-btn, #pgBell, .win-ctrl'
    ),
  ]
    .filter(shown)
    .map(part => ({
      name: (part.id || String(part.className).split(' ')[0] || part.tagName).slice(0, 24),
      box: part.getBoundingClientRect(),
    }));
}

function barFaults() {
  const parts = barParts();
  const faults = [];
  for (const part of parts) {
    if (part.box.left < -0.5 || part.box.right > window.innerWidth + 0.5)
      faults.push(part.name + ' ends at ' + round(part.box.right) + ' of ' + window.innerWidth);
  }
  const inOrder = parts.slice().sort((a, b) => a.box.left - b.box.left);
  for (let index = 1; index < inOrder.length; index++) {
    const before = inOrder[index - 1];
    const after = inOrder[index];

    // a part inside another (a chip in the project box) is not two parts side by side
    if (after.box.left >= before.box.left && after.box.right <= before.box.right) continue;
    if (after.box.left < before.box.right - 1)
      faults.push(
        after.name + ' lies over ' + before.name + ' by ' + round(before.box.right - after.box.left)
      );
  }
  return { faults, count: parts.length };
}

// Every thread's name in the list: how much of it is drawn.
function names() {
  return [...threads.slot('list').querySelectorAll('.tnt-th[data-pane] > b')]
    .filter(shown)
    .map(name => ({ words: name.textContent, width: round(name.getBoundingClientRect().width) }));
}

try {
  await agents.detect(true);
  for (let count = 0; count < 2; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made?.paneId) opened.push(made.paneId);
    await wait(300);
  }
  check(opened.length === 2, 'setup: two PowerShell threads are open');
  threads.show(opened[0]);
  await until(() => threads.visible());

  for (const [width, height, zoom] of [
    [768, 680, null],
    [768, 680, 1],
    [1024, 683, null],
    [1024, 683, 1],
  ]) {
    const got = await main('size', width, height, zoom);
    const tag = width + ' x ' + height + (zoom ? ' at full scale' : ' at the app’s own scale');
    for (const page of ['threads', 'preview']) {
      if (page === 'threads') threads.open();
      else window.TnaiRoute('live-preview');
      await wait(700);
      const bar = barFaults();
      check(
        !bar.faults.length,
        tag +
          ', ' +
          page +
          ': every part of the top bar is whole inside the window, none over another (' +
          bar.count +
          ' parts, ' +
          window.innerWidth +
          ' px, zoom ' +
          got.zoom +
          (bar.faults.length ? ': ' + bar.faults.join('; ') : '') +
          ')'
      );
      const listed = names();
      check(
        listed.length === 2 && listed.every(name => name.width >= 40),
        tag +
          ', ' +
          page +
          ': the thread list draws every thread’s name (' +
          listed.map(name => name.words + ' ' + name.width + ' px').join(', ') +
          '; the list is ' +
          round(threads.slot('list').getBoundingClientRect().width) +
          ' px wide)'
      );
      if (width === 768 && zoom === 1) {
        await wait(400);
        console.log('TNAI_SHOT:narrow-window-' + page + '-768');
        await wait(700);
      }
    }
  }
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
threads.open?.();
await main('size', 1440, 900).catch(() => {});
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await wait(2500);
return { ok, log };
