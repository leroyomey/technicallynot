// Technically Not tools · desktop-check/tests/thread-side-size.js — the side column of the Threads
// page can be dragged wider (133). With the column open: a handle stands on its left edge and is
// what the pointer meets there; a drag to the left makes the column wider by what the pointer
// moved, the thread keeps room, the width is remembered, and a double press brings the app's own
// width back. Also here: the Computers chip of the top bar opens the Devices page.
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
    await wait(100);
  }
  return null;
};
const threads = window.TnaiThreads;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);

try {
  await until(() => threads?.visible());
  threads.side(true);
  const side = await until(() => {
    const slot = threads.slot('side');
    return slot && box(slot).width > 100 ? slot : null;
  });
  check(!!side, 'the side column is open');
  const grip = await until(() => side?.querySelector('.tnt-side-grip'));
  check(
    !!grip && grip.getAttribute('role') === 'separator' && !!grip.getAttribute('aria-label'),
    'a handle with a name stands in the column'
  );
  const line = getComputedStyle(grip, '::after');
  check(
    Number(line.opacity) >= 0.5 && parseFloat(line.height) >= 40 && parseFloat(line.width) >= 1.5,
    'a line marks it without the pointer on it (' +
      line.width +
      ' by ' +
      line.height +
      ', strength ' +
      line.opacity +
      ')'
  );
  console.log('TNAI_SHOT:thread-side-size-open');
  await wait(600);
  const usual = box(side).width;
  const at = box(grip);
  const middle = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  check(
    at.width >= 8 &&
      Math.abs(at.left - box(side).left) <= 2 &&
      document.elementFromPoint(middle.x, middle.y) === grip,
    "it lies on the column's left edge and is what the pointer meets there (" +
      round(at.width) +
      ' px wide, ' +
      round(at.left - box(side).left) +
      ' px from the edge; under the pointer: ' +
      (document.elementFromPoint(middle.x, middle.y)?.className || 'nothing') +
      ')'
  );

  // a drag of 140 px to the left
  const press = (type, x) =>
    grip.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: middle.y,
        bubbles: true,
        cancelable: true,
      })
    );
  grip.setPointerCapture = () => {};
  press('pointerdown', middle.x);
  for (let step = 1; step <= 7; step++) press('pointermove', middle.x - step * 20);
  press('pointerup', middle.x - 140);
  await wait(300);
  const wide = box(side).width;
  check(
    Math.abs(wide - (usual + 140)) <= 3,
    'a drag of 140 px to the left makes it 140 px wider (' +
      round(usual) +
      ' to ' +
      round(wide) +
      ')'
  );
  check(
    box(threads.slot('main')).width >= 400 && box(side).right <= innerWidth + 1,
    'the thread keeps its room and nothing leaves the window (thread ' +
      round(box(threads.slot('main')).width) +
      ' px)'
  );
  check(
    Number(localStorage.getItem('tnai.thread-side-w.v1')) === round(wide),
    'the width is remembered'
  );

  // far too wide: held at what the thread needs
  window.TnaiThreadSideSize.set(5000);
  await wait(200);
  check(
    box(threads.slot('main')).width >= 400,
    'asked for far too much, the column stops where the thread still has its room (' +
      round(box(threads.slot('main')).width) +
      ' px)'
  );
  grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await wait(300);
  check(
    Math.abs(box(side).width - usual) <= 1 && !localStorage.getItem('tnai.thread-side-w.v1'),
    'a double press brings the usual width back (' + round(box(side).width) + ')'
  );
  console.log('TNAI_SHOT:thread-side-size');
  await wait(600);
  threads.side(false);

  // ---- the Computers chip opens the Devices page ----
  const chip = document.querySelector('.top-right .pg-pcs');
  chip?.click();
  check(
    !!(await until(
      () => document.querySelector('.layout')?.classList.contains('devices-mode'),
      4000
    )),
    'a press on the Computers chip opens the Devices page'
  );
  threads.open();
  await wait(400);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
