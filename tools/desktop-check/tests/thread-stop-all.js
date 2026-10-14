// Technically Not tools · desktop-check/tests/thread-stop-all.js — the row "Stop all agents" of
// the three-dots menu (src/scripts/124-thread-menu.js), in the real app with a throwaway profile.
// Two PowerShell panels, no agent CLI and no usage. The row is in the list only while something
// runs; a press asks first; Cancel stops nothing; "Stop all" ends both. Pictures:
// thread-stop-all-row, thread-stop-all-question. Returns {ok, log}.
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
const threads = window.TnaiThreads,
  agents = window.TnaiAgents;
const shown = el => !!el && el.getClientRects().length > 0;
const box = el => el.getBoundingClientRect();
const n = v => Math.round(v * 10) / 10;
const running = () => agents.sessions().filter(s => s.running === true);

const button = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const rows = () => [...menu().querySelectorAll('.tnt-menu-row')];
const stopRow = () => rows().find(row => row.textContent.trim() === 'Stop all agents');
const openMenu = async () => {
  window.TnaiThreadMenu.close();
  window.TnaiThreadMenu.open(button());

  // Shown is not placed yet: the menu is put under its button a moment after it opens.
  return until(() => shown(menu()) && box(menu()).top < innerHeight / 2, 3000);
};
const question = () => document.querySelector('.layout .tnai-panel-confirm');

try {
  await until(() => threads?.visible(), 8000);
  check(
    !!window.TnaiThreadMenu && !!window.TnaiPanelConfirm,
    'the menu and the question are loaded'
  );

  // Nothing runs: the row is not in the list, and a search does not bring it up.
  check(running().length === 0, 'setup: nothing runs at the start');
  await openMenu();
  check(!!stopRow() && !shown(stopRow()), 'nothing runs: the row is not shown');
  const search = menu().querySelector('.tnt-menu-search input');
  search.value = 'stop';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(100);
  check(!shown(stopRow()), 'nothing runs: a search for "stop" does not show it either');
  window.TnaiThreadMenu.close();

  await agents.detect(true);
  const first = await window.TnaiTest.open('Terminal'),
    second = await window.TnaiTest.open('Terminal');
  check(
    !!first?.ok && !!second?.ok && !!(await until(() => running().length >= 2, 20000)),
    'setup: two PowerShell panels running'
  );
  await wait(1500);
  threads.open();
  await until(() => threads.visible(), 3000);

  // Two run: the row is in the list, a row like the others.
  await openMenu();
  const row = stopRow(),
    sibling = rows().find(r => r.textContent.trim() === 'Skills');
  check(shown(row), 'two agents run: the row is shown');
  check(
    row.parentElement === sibling.parentElement &&
      row.previousElementSibling === sibling &&
      n(box(row).height) === n(box(sibling).height) &&
      n(box(row).left) === n(box(sibling).left) &&
      n(box(row).width) === n(box(sibling).width),
    'it is the row after Skills in the same group, the same size and place as its neighbor (' +
      n(box(row).width) +
      ' x ' +
      n(box(row).height) +
      ' against ' +
      n(box(sibling).width) +
      ' x ' +
      n(box(sibling).height) +
      ')'
  );
  const menuBox = box(menu());
  check(
    menuBox.top >= 0 && menuBox.bottom <= innerHeight && menuBox.right <= innerWidth,
    'the menu with the row lies inside the window (' +
      n(menuBox.top) +
      ' to ' +
      n(menuBox.bottom) +
      ' of ' +
      innerHeight +
      ')'
  );
  console.log('TNAI_SHOT:thread-stop-all-row');
  await wait(600);

  // A press asks first and stops nothing.
  row.click();
  check(!!(await until(() => shown(question()), 3000)), 'a press opens the question over the page');
  check(!shown(menu()), 'and the menu is closed');
  const card = question().querySelector('.tnai-panel-confirm-box'),
    title = card.querySelector('h3').textContent,
    body = card.querySelector('p').textContent,
    yes = card.querySelector('.tnai-ws-close-confirm'),
    no = card.querySelector('.tnai-ws-close-cancel');
  check(title === 'Stop all 2 running agents?', 'the question names how many: ' + title);
  const names = running().map(s => s.name);
  check(
    names.every(name => body.includes(name)) && /Queued prompts are not sent/.test(body),
    'its text names each agent and says what is lost: ' + body.slice(0, 140)
  );
  check(yes.textContent === 'Stop all' && no.textContent === 'Cancel', 'buttons: Cancel, Stop all');
  const cardBox = box(card);
  check(
    cardBox.left >= 0 &&
      cardBox.top >= 0 &&
      cardBox.right <= innerWidth &&
      cardBox.bottom <= innerHeight &&
      cardBox.width > 200,
    'the question lies whole inside the window (' +
      n(cardBox.width) +
      ' x ' +
      n(cardBox.height) +
      ' at ' +
      n(cardBox.left) +
      ', ' +
      n(cardBox.top) +
      ')'
  );
  const top = document.elementFromPoint(
    cardBox.left + cardBox.width / 2,
    cardBox.top + cardBox.height / 2
  );
  check(card.contains(top), 'nothing lies over the question');
  check(running().length === 2, 'while it asks, both still run');

  // A covered test window draws no frames, so the question's short fade can stand at its first
  // step. It is ended here by hand for the picture, and the line says whether that was needed.
  const clockBefore = document.timeline.currentTime;
  await wait(400);
  const fading = question().getAnimations({ subtree: true });
  const faded = n(Number(getComputedStyle(question()).opacity));
  fading.forEach(animation => animation.finish());
  check(
    Number(getComputedStyle(question()).opacity) === 1 &&
      Number(getComputedStyle(card).opacity) === 1,
    'the question is fully drawn once its fade ended (opacity before: ' +
      faded +
      ', fades still open after 400 ms: ' +
      fading.length +
      ', page clock moved: ' +
      n(document.timeline.currentTime - clockBefore) +
      ' ms)'
  );
  console.log('TNAI_SHOT:thread-stop-all-question');
  await wait(600);

  // Cancel: nothing is stopped.
  no.click();
  check(!!(await until(() => !question(), 3000)), 'Cancel closes the question');
  await wait(1500);
  check(running().length === 2, 'after Cancel both still run');

  // Escape cancels too.
  await openMenu();
  stopRow().click();
  await until(() => shown(question()), 3000);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!!(await until(() => !question(), 3000)), 'Escape closes the question');
  await wait(800);
  check(running().length === 2, 'after Escape both still run');

  // The same on a page other than Threads: the question is on screen there too.
  window.TnaiRoute('skills');
  await until(() => !threads.visible(), 3000);
  await wait(400);
  await openMenu();
  check(shown(stopRow()), 'on the Skills page the row is in the list too');
  stopRow().click();
  const there = !!(await until(() => shown(question()), 3000));
  const skillsCard = question()?.querySelector('.tnai-panel-confirm-box'),
    skillsBox = skillsCard ? box(skillsCard) : { width: 0, height: 0, left: 0, top: 0 };
  check(
    there &&
      skillsBox.width > 200 &&
      skillsBox.left >= 0 &&
      skillsBox.top >= 0 &&
      skillsBox.right <= innerWidth &&
      skillsBox.bottom <= innerHeight,
    'and the question lies whole inside the window there (' +
      n(skillsBox.width) +
      ' x ' +
      n(skillsBox.height) +
      ' at ' +
      n(skillsBox.left) +
      ', ' +
      n(skillsBox.top) +
      ')'
  );
  console.log('TNAI_SHOT:thread-stop-all-skills');
  await wait(600);
  question()?.querySelector('.tnai-ws-close-cancel')?.click();
  await until(() => !question(), 3000);
  check(running().length === 2, 'Cancel there: both still run');
  threads.open();
  await until(() => threads.visible(), 3000);

  // Stop all: both end, and the row leaves the list.
  await openMenu();
  stopRow().click();
  await until(() => shown(question()), 3000);
  question().querySelector('.tnai-ws-close-confirm').click();
  check(!!(await until(() => running().length === 0, 12000)), '"Stop all" ends both processes');
  await wait(400);
  await openMenu();
  check(!shown(stopRow()), 'nothing runs any more: the row is gone from the list');
  window.TnaiThreadMenu.close();
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}

// A failed run must not leave a process behind.
try {
  agents.sessions().forEach(s => s.running && agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
} catch {}
return { ok, log };
