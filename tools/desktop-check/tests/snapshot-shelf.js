// Technically Not tools · desktop-check/tests/snapshot-shelf.js — The Snapshots box
// (src/scripts/151-snapshot-shelf.js, desktop/snapshot-shelf.js). Made-up pictures and clips go
// into the app's own box (snapshot-shelf.main.js), then the box is opened the way a person opens
// it: the three-dots menu's row "Snapshots". Checked: three pictures and two clips show with their
// counts and their small pictures drawn; the box lies inside the window and under the menu button;
// Copy puts a clip's line on the clipboard and says so; Delete takes a picture out; Clear all asks
// once and empties both groups; Escape closes the box and gives the keyboard back; at the smallest
// window the box still fits. Pictures: snapshot-shelf-dark, snapshot-shelf-light,
// snapshot-shelf-small. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 6000) => {
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
    const id = 's' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

const shown = el => !!el && el.getClientRects().length > 0;
const box = () => document.querySelector('.pgo-qpop.snap-shelf');
const button = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const tiles = kind => [...(box()?.querySelectorAll(`.snap-tile[data-kind="${kind}"]`) || [])];
const counts = () =>
  [...(box()?.querySelectorAll('.grp .who span') || [])].map(span => span.textContent).join(' | ');
const drawn = () =>
  [...(box()?.querySelectorAll('.snap-pic img') || [])].every(
    image => image.complete && image.naturalWidth > 0
  );
const inside = el => {
  const rect = el.getBoundingClientRect();
  return (
    rect.left >= 0 &&
    rect.top >= 0 &&
    rect.right <= window.innerWidth &&
    rect.bottom <= window.innerHeight
  );
};

// The box opened the way a person opens it: the menu, then its row.
async function openBox() {
  if (!shown(menu())) button().click();
  await until(() => shown(menu()));
  const row = [...menu().querySelectorAll('.tnt-menu-row')].find(
    one => one.querySelector('span')?.textContent.trim() === 'Snapshots'
  );
  check(!!row, 'the three-dots menu has the row Snapshots');
  row?.click();
  return until(() => (shown(box()) ? box() : null));
}

try {
  const seeded = await main('seed');
  check(
    seeded.pictures.length === 3 && seeded.clips.length === 2,
    'the box holds the made-up pictures and clips'
  );

  await openBox();
  check(shown(box()), 'the row opens the Snapshots box');
  check(
    tiles('picture').length === 3 && tiles('clip').length === 2,
    'three picture tiles and two clip tiles (' +
      tiles('picture').length +
      ', ' +
      tiles('clip').length +
      ')'
  );
  check(counts() === '3 of 5 | 2 of 5', 'each group says how many of five (' + counts() + ')');
  check(!!(await until(drawn)), 'every small picture is drawn, the clips first frames too');
  check(inside(box()), 'the box lies inside the window');
  const under = box().getBoundingClientRect().top >= button().getBoundingClientRect().bottom - 1;
  check(under, 'the box opens under the menu button');
  check(
    document.activeElement && box().contains(document.activeElement),
    'the keyboard is in the box when it opens'
  );
  await window.TnaiTest.shot('snapshot-shelf-dark');

  // Copy a clip again: its line is on the clipboard and the box says so.
  tiles('clip')[0].querySelector('button[data-act="copy"]').click();
  const said = await until(() =>
    /Clip copied/.test(box().querySelector('.snap-note')?.textContent)
  );
  const text = await main('clipboardText');
  check(
    !!said && /5eed0002-clip\.webm/.test(text),
    'Copy puts the newest clip line on the clipboard and says so'
  );

  // Delete one picture.
  tiles('picture')[0].querySelector('button[data-act="remove"]').click();
  check(
    !!(await until(() => tiles('picture').length === 2)),
    'Delete takes one picture out of the box'
  );

  // Light, the way Settings sets it.
  window.TnaiTheme.set('light');
  await wait(400);
  await window.TnaiTest.shot('snapshot-shelf-light');
  window.TnaiTheme.set('dark');
  await wait(300);

  // Clear all asks once, then empties both groups.
  box().querySelector('button[data-act="ask-clear"]').click();
  const asked = await until(() => box().querySelector('button[data-act="clear"]'));
  check(!!asked && /Delete all 4/.test(asked.textContent), 'Clear all asks once, naming how many');
  asked?.click();
  check(
    !!(await until(() => tiles('picture').length === 0 && tiles('clip').length === 0)),
    'after the answer both groups are empty'
  );
  check(
    box().querySelector('button[data-act="ask-clear"]')?.disabled === true &&
      box().querySelectorAll('.pgo-empty').length === 2,
    'an empty box says so in each group and Clear all is off'
  );

  // Escape closes it.
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  check(!!(await until(() => !shown(box()))), 'Escape closes the box');

  // The smallest window: the box still fits.
  await main('seed');
  await main('size', 768, 680);
  await wait(500);
  await openBox();
  check(
    !!box() && !box().querySelector('.snap-note')?.textContent,
    'a reopened box starts without the last status line'
  );
  check(
    !!box() && inside(box()),
    'at the smallest window the box lies inside it (' +
      window.innerWidth +
      ' x ' +
      window.innerHeight +
      ')'
  );
  await until(drawn);
  await window.TnaiTest.shot('snapshot-shelf-small');
  window.TnaiSnapshotShelf.close();
  await main('size', 1440, 900);
} catch (error) {
  check(false, 'the test ran to its end (' + error.message + ')');
}
return { ok, log };
