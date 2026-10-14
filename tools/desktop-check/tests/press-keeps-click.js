/*
 * Technically Not tools · desktop-check/tests/press-keeps-click.js — A button that is being pressed
 * keeps its click when its card or list is repainted under the press (01 `TnaiPress`). Two places
 * that build their buttons anew on a push from the main process are pressed with a real mouse
 * (TNAI_INPUT), with a push arriving between the press and the release: a notice's button in the
 * bell (51) and "Clear these errors" on Live preview's error notice (31).
 *
 * Each place is pressed twice. First with the guard switched off, where the click must be lost:
 * that shows the press really was repainted under, so the second press proves something. Then with
 * the guard on, where the click must arrive. Returns {ok, log}.
 */
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
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

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

// A press held for `held` ms in the middle of the element. `duringPress` runs once, right after
// the button went down: it is where the push that repaints arrives.
let duringPress = null;
document.addEventListener(
  'mousedown',
  () => {
    const run = duringPress;
    duringPress = null;
    if (run) setTimeout(run, 30);
  },
  true
);
const press = async (element, held, during) => {
  const box = element.getBoundingClientRect(),
    x = box.left + box.width / 2,
    y = box.top + box.height / 2;
  duringPress = during || null;
  await input([
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, wait: held },
    { type: 'mouseUp', x, y },
  ]);
  await wait(150);
};

const guard = window.TnaiPress;
const realDefer = guard?.defer;
const guardOff = () => {
  guard.defer = () => false;
};
const guardOn = () => {
  guard.defer = realDefer;
};

// ---------- the bell: a notice's button ----------
const bell = window.TnaiNextActions;
let ran = 0;
let pushed = 0;
const notice = () =>
  bell.notify({
    key: 'press-test',
    source: 'Press test',
    title: 'A notice with a button',
    text: 'Its button is pressed while another notice arrives.',
    open: true,
    action: {
      label: 'Do it',
      run: () => {
        ran++;
      },
    },
  });
const otherNotice = () =>
  bell.notify({
    key: 'press-test-other-' + ++pushed,
    source: 'Press test',
    title: 'Another notice ' + pushed,
    text: 'It arrived during the press.',
  });
const noticeButton = () =>
  document.querySelector('.tnai-bell-pop [data-item="notice:press-test"] [data-act="notice"]');
const clearNotices = () => {
  bell.unnotify('press-test');
  for (let n = 1; n <= pushed; n++) bell.unnotify('press-test-other-' + n);
};

async function bellPress(label) {
  notice();
  bell.openBell(true);
  const button = await until(() => {
    const b = noticeButton();
    return b && b.getBoundingClientRect().width > 0 && b;
  }, 4000);
  check(!!button, label + ': the notice shows in the bell with its button');
  if (!button) return null;
  const before = ran;

  // the list is put in its place a moment after it opens
  await until(() => {
    const at = button.getBoundingClientRect();
    return at.bottom < innerHeight && at.top > 0;
  }, 2000);

  // where the press will land, said in the log when it does not land on the button
  const box = button.getBoundingClientRect();
  const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  if (under !== button)
    log.push(
      'note ' +
        label +
        ': the button at ' +
        Math.round(box.left) +
        ',' +
        Math.round(box.top) +
        ' (' +
        Math.round(box.width) +
        '×' +
        Math.round(box.height) +
        ', window ' +
        innerWidth +
        '×' +
        innerHeight +
        ') is under ' +
        (under ? under.tagName + '.' + under.className : 'nothing')
    );
  await press(button, 140, otherNotice);
  const result = { clicked: ran - before, replaced: !button.isConnected };
  bell.openBell(false);
  clearNotices();
  await wait(100);
  return result;
}

// ---------- Live preview: "Clear these errors" on the error notice ----------
const errorBar = () => {
  const bar = document.querySelector('.lp-errs');
  return bar && !bar.hidden && bar.getBoundingClientRect().width > 0 ? bar : null;
};
let errorCount = 0;

async function previewPress(label, frameName) {
  // A page that finishes loading clears its frame's errors, so the first error is sent again
  // until the notice stays.
  let bar = null;
  for (let attempt = 0; attempt < 5 && !bar; attempt++) {
    await main('error', frameName, 'press test error ' + ++errorCount);
    bar = await until(errorBar, 1500);
  }
  await wait(400);
  bar = errorBar();
  const clear = bar?.querySelector('.lp-errs-x');
  check(!!clear, label + ': the error notice shows with "Clear these errors"');
  if (!clear) return null;

  // The notice is repainted a moment after an error arrives (it waits 150 ms and a frame), so
  // the press is held longer than that.
  await press(clear, 700, () => main('error', frameName, 'press test error ' + ++errorCount));
  await wait(300);
  return { cleared: !errorBar(), replaced: !clear.isConnected };
}

// A press that goes down, lets `during` cause the repaint, waits until `done` says it happened,
// and only then comes up.
let releasedOnIt = false;
const pressUntil = async (element, during, done) => {
  const box = element.getBoundingClientRect(),
    x = box.left + box.width / 2,
    y = box.top + box.height / 2;
  await input([
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, wait: 40 },
  ]);
  await during();
  const happened = await until(done, 6000);
  await wait(450);

  // whether the pressed thing is still what lies under the pointer when the button comes up
  releasedOnIt = element.contains(document.elementFromPoint(x, y));
  await input([{ type: 'mouseUp', x, y }]);
  await wait(300);
  return !!happened;
};

// One place pressed twice: with the guard off the click must be lost, with it on it must arrive.
async function twice(label, pressOnce) {
  guardOff();
  const old = await pressOnce(label + ', guard off');
  guardOn();
  check(
    !!old && !old.clicked,
    label + ', guard off: the click was lost under the repaint (' + JSON.stringify(old) + ')'
  );
  const now = await pressOnce(label);
  check(
    !!now && now.clicked,
    label +
      ': a repaint during the press does not take the click away (' +
      JSON.stringify(now) +
      ')'
  );
}

const agents = window.TnaiAgents,
  threads = window.TnaiThreads;

// Terminals whose only job is to end or close during a press: that is a push that repaints, and
// unlike starting one it does not change the page.
const spares = [];
let stoppedSpares = 0;
let closedSpares = 0;

async function openSpare() {
  const before = new Set(agents.sessions().map(s => s.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  const id =
    opened?.paneId ||
    (await until(() => agents.sessions().find(s => !before.has(s.paneId))))?.paneId ||
    '';
  await until(() => agents.sessions().find(s => s.paneId === id && s.running), 15000);
  if (id) spares.push(id);
  return id;
}

// ---------- the finished-agent card ----------
let finished = 0;

async function cardPress(label) {
  const paneId = 'press-pane-' + ++finished;
  await main(
    'finish',
    paneId,
    'Ash',
    '[TN.ai] Press test ' + finished,
    'Done.\n\nTechnically Not report\n- Did: a test result\n- Next: look at it ' + finished + '\n'
  );
  const button = await until(() => {
    const card = document.querySelector('.tnai-next');
    const b = card && !card.hidden && card.querySelector('[data-act="dismiss"]');
    return b && b.getBoundingClientRect().width > 0 ? b : null;
  }, 8000);
  check(!!button, label + ': the card shows with its dismiss button');
  if (!button) return null;
  const before = bell.pending().length;

  // a panel closing is one of the pushes that paint the card again
  await press(button, 200, () =>
    window.dispatchEvent(
      new CustomEvent('tnai:terminal-pane-closed', { detail: { paneId: 'press-no-such-panel' } })
    )
  );
  const result = { clicked: bell.pending().length < before, replaced: !button.isConnected };
  bell.pending().forEach(id => bell.dismiss(id));
  await wait(150);
  return result;
}

// ---------- the Live preview page's terminal tabs ----------
const drawerTabs = () => [...document.querySelectorAll('.lpp-dtabs .lpp-dtab')];

async function drawerPress(label) {
  const tabs = drawerTabs();
  const at = tabs.findIndex(tab => !tab.classList.contains('active'));
  const button = tabs[at]?.querySelector('.lpp-dtab-name');
  check(!!button, label + ': a tab that is not the shown one');
  if (!button) return null;

  // a terminal ending elsewhere is an agent change, which paints the tabs again
  const spare = spares[stoppedSpares++];
  const repainted = await pressUntil(
    button,
    () => {
      agents.stop(spare);
    },
    () => !agents.sessions().some(s => s.paneId === spare && s.running)
  );
  return {
    clicked: !!drawerTabs()[at]?.classList.contains('active'),
    replaced: !button.isConnected,
    repainted,
  };
}

// ---------- the thread list's rows ----------
const listRows = () => [
  ...(threads.slot('list')?.querySelectorAll('.tnt-th[data-pane]:not(.tnt-sub)') || []),
];

// spareIs: where the row that leaves stands, 'above' the pressed row (the pressed row then moves
// up, away from the pointer) or 'below' it (the pressed row is put back in its place).
async function rowPress(label, spareIs) {
  const spare = spares[closedSpares++];

  // The open thread is one that stays: were it the one that leaves, the app would open another
  // thread by itself, and that would look like a click.
  const stays = listRows().filter(r => !spares.includes(r.dataset.pane));
  if (stays.length > 1 && !stays.some(r => r.dataset.pane === threads.selected())) {
    threads.select(stays[stays.length - 1].dataset.pane);
    await wait(400);
  }
  const rows = listRows();
  const spareAt = rows.findIndex(r => r.dataset.pane === spare);
  const row = rows.find(
    (r, at) =>
      r.dataset.pane !== threads.selected() &&
      !spares.includes(r.dataset.pane) &&
      (spareIs === 'above' ? at > spareAt : at < spareAt)
  );
  check(
    !!row && spareAt >= 0,
    label + ': a row that is not the open thread, with the leaving row ' + spareIs + ' it'
  );
  if (!row) return null;

  // the click is counted on the row itself
  let clicks = 0;
  const count = () => {
    clicks++;
  };
  row.addEventListener('click', count);

  // a thread whose panel closes leaves the list, which puts every other row back into it
  const before = listRows().length;
  const repainted = await pressUntil(
    row,
    () => {
      window.TnaiLiveTasks.close(spare, document.body);
    },
    () => listRows().length < before
  );
  row.removeEventListener('click', count);
  return {
    clicked: clicks === 1 && threads.selected() === row.dataset.pane,
    clicks,
    stillThere: row.isConnected,
    releasedOnIt,
    repainted,
  };
}

// ---------- the helper chips ----------
// Two made-up helpers of the open thread, as the app's own record of sub-agents gives them.
const helpers = [
  { toolUseId: 'press-helper-1', description: 'First helper', status: 'running' },
  { toolUseId: 'press-helper-2', description: 'Second helper', status: 'running' },
];
const team = (window.TnaiTeam = window.TnaiTeam || {});
const realTeamGet = team.get;
const chipsNow = () => [...document.querySelectorAll('.tnt-side-chip')];
const told = () => window.dispatchEvent(new CustomEvent('tnai:threads-painted'));

async function chipPress(label) {
  if (!threads.selected()) threads.select(listRows()[0]?.dataset.pane);
  await until(() => document.querySelector('.tnt-view .tnt-head-acts'), 5000);
  const open = threads.selected();
  team.get = paneId =>
    paneId === open ? { subs: helpers } : realTeamGet ? realTeamGet.call(team, paneId) : null;
  helpers[0].status = 'running';
  told();
  const helpersButton = await until(() => {
    const b = document.querySelector('.tnt-helpers-btn');
    return b && !b.hidden ? b : null;
  }, 4000);
  check(!!helpersButton, label + ': the thread says it has helpers');
  if (!helpersButton) return null;
  if (!chipsNow().length) helpersButton.click();
  await until(() => chipsNow().length === 2 && chipsNow()[0].getBoundingClientRect().width > 0);
  const chip = chipsNow().find(c => c.getAttribute('aria-selected') !== 'true');
  check(!!chip, label + ': two chips, one of them not the shown helper');
  if (!chip) return null;
  const key = chip.dataset.key;
  const chosenBefore = window.TnaiThreadHelpers.state().chosen;

  // the other helper finishing changes its tone, which builds the chips anew
  await press(chip, 250, () => {
    helpers[0].status = helpers[0].status === 'done' ? 'failed' : 'done';
    told();
  });
  const after = chipsNow().find(c => c.dataset.key === key);
  return {
    clicked: after?.getAttribute('aria-selected') === 'true',
    replaced: !chip.isConnected,
    pressed: key,
    chosenBefore,
    chosenAfter: window.TnaiThreadHelpers.state().chosen,
    releasedOnIt,
  };
}

try {
  check(typeof realDefer === 'function', 'TnaiPress.defer is there');
  check(!!bell?.notify && !!bell.openBell, 'the bell takes notices');

  // The first real press of a test may only wake the window: one on a harmless spot first.
  await press(document.body, 60);
  await wait(200);

  // --- the bell ---
  guardOff();
  const bellOld = await bellPress('bell, guard off');
  guardOn();
  check(
    !!bellOld && bellOld.replaced && bellOld.clicked === 0,
    'bell, guard off: the pressed button was replaced under the press and its click was lost (' +
      JSON.stringify(bellOld) +
      ')'
  );
  const bellNew = await bellPress('bell');
  check(
    !!bellNew && bellNew.clicked === 1,
    'bell: a notice arriving during the press does not take the click away (' +
      JSON.stringify(bellNew) +
      ')'
  );

  // The repaint that waited for the press is not lost: opened again, the list is current.
  bell.openBell(true);
  await wait(200);
  check(
    !document.querySelector('.tnai-bell-pop [data-item^="notice:press-test"]'),
    'bell: opened again, the list no longer holds the notices taken away after the press'
  );
  bell.openBell(false);

  // --- Live preview ---
  const address = await main('serve');
  window.TnaiLivePreviewPage.open();
  await wait(400);
  const added = window.TnaiLivePreview.addUrl(address);
  check(!!added?.ok, 'Live preview: a tab for the test page');
  const frame = await until(() => {
    const f = [...document.querySelectorAll('iframe[name^="tnai-lp-"]')].find(
      x => x.getBoundingClientRect().width > 0
    );
    return f || null;
  }, 8000);
  check(!!frame, 'Live preview: the page has its frame');
  if (frame) {
    guardOff();
    const previewOld = await previewPress('Live preview, guard off', frame.name);
    guardOn();
    check(
      !!previewOld && previewOld.replaced && !previewOld.cleared,
      'Live preview, guard off: the pressed button was replaced and its click was lost (' +
        JSON.stringify(previewOld) +
        ')'
    );
    const previewNew = await previewPress('Live preview', frame.name);
    check(
      !!previewNew && previewNew.cleared,
      'Live preview: an error arriving during the press does not take the click away (' +
        JSON.stringify(previewNew) +
        ')'
    );
  }
  if (added?.ok) window.TnaiLivePreview.close(added.id);

  // --- the finished-agent card (51) ---
  bell.setMode('suggest');
  await twice('finished-agent card', cardPress);
  bell.setMode('off');

  // --- the Live preview page's terminal tabs (65) ---
  await openSpare();
  await openSpare();
  check(spares.length === 2, 'two spare terminals are running');
  window.TnaiLivePreviewPage.open();
  await wait(500);
  const addTerminal = document.querySelector('.lpp-dadd');
  for (let count = 1; count <= 2 && addTerminal; count++) {
    addTerminal.click();
    await until(() => drawerTabs().length >= count && !addTerminal.disabled, 20000);
  }
  check(drawerTabs().length >= 2, 'Live preview page: two terminals in the drawer');
  if (drawerTabs().length >= 2) await twice('Live preview page, terminal tabs', drawerPress);

  // --- the thread list's rows (119) ---
  // the two spares above are stopped by now; a third one, started last, stands lowest
  const third = await openSpare();
  agents.stop(third);
  await until(() => !agents.sessions().some(s => s.paneId === third && s.running), 10000);
  threads.open();
  await until(() => threads.visible(), 5000);
  await until(() => listRows().length >= 2, 8000);
  check(listRows().length >= 2, 'thread list: at least two rows');
  if (listRows().length >= 2) {
    await twice('thread list row, a row above it leaves', label => rowPress(label, 'above'));

    // With the leaving row below, the pressed row is taken out and put back without moving:
    // that alone costs the click (seen with the guard off, clicked false and released on it).
    const inPlace = await rowPress('thread list row, a row below it leaves', 'below');
    check(
      !!inPlace && inPlace.clicked && inPlace.releasedOnIt,
      'thread list row, a row below it leaves: the row put back in its place keeps its click (' +
        JSON.stringify(inPlace) +
        ')'
    );
  }

  // --- the helper chips (123) ---
  await twice('helper chip', chipPress);
} catch (e) {
  check(false, 'threw: ' + (e?.stack || e));
}
if (guard && realDefer) guardOn();
if (realTeamGet) team.get = realTeamGet;
else delete team.get;
agents.sessions().forEach(s => s.running && agents.stop(s.paneId));
await until(() => !agents.sessions().some(s => s.running), 10000);
await main('stop').catch(() => {});
return { ok, log };
