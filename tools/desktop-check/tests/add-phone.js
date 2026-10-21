// Technically Not tools · desktop-check/tests/add-phone.js — "Add a phone" on the Devices page in
// the real app with a throwaway profile (nobody signed in, nothing paired): turning several
// computers on shows the button beside Pair a computer; it opens its own dialog with the code drawn
// as a picture (no text of the code in the page); the main process says a phone run waits; Cancel
// and Escape end it and leave nothing paired; turning it off restores the app. No phone and no
// relay are involved: the pairing itself is proven by phone/test/pair-link-test.mjs (the phone's
// real code against the computer's real link). Written 2026-10-21 for Lead's end-of-batch run;
// not run while building (the batch's rule). Returns {ok, log}.
const log = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
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
const shot = async name => {
  await wait(300);
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const R = window.tnaiNative.remote;
const page = document.getElementById('devicesPage');
const state = async () => (await R.state()).value;
const button = (scope, text) => {
  if (!scope) {
    check(false, 'the box the button "' + text + '" was looked for in is there');
    return undefined;
  }
  return [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text);
};
const dlg = () => document.querySelector('.dv-scrim .dv-dlg');

// ---- open the page and turn it on ----
window.TnaiRoute('devices');
check(
  !!(await until(() => page.querySelector('.dv-off'))),
  'the Devices page opens in its off state'
);
button(page, 'Connect my computers')?.click();
check(!!(await until(() => page.querySelector('.dv-me'))), 'turned on: this computer is shown');
const add = button(page.querySelector('.dv-me'), 'Add a phone');
check(
  !!add && !!button(page.querySelector('.dv-me'), 'Pair a computer'),
  'Add a phone sits beside Pair a computer'
);
check(
  !/phones/.test(page.querySelector('.dv-later')?.textContent || ''),
  'the "later" line no longer promises phones'
);

// ---- the dialog ----
add?.click();
check(
  !!(await until(() => dlg() && /Add a phone/.test(dlg().querySelector('h2').textContent))),
  'Add a phone opens its dialog'
);
check(
  !!(await until(() => dlg()?.querySelector('svg path')?.getAttribute('d')?.length > 100)),
  'the code is drawn as a picture: ' + (dlg()?.textContent || 'no dialog')
);
check(!/TNAIPAIR1/.test(document.body.innerHTML), 'no text of the code is in the page');
const run = await state();
check(
  run.phonePair && run.phonePair.state === 'wait',
  'the main process says a phone run waits: ' + JSON.stringify(run.phonePair)
);
const d = dlg().getBoundingClientRect();
check(
  d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
  'the dialog fits the window'
);
await shot('add-phone');
button(dlg(), 'Cancel')?.click();
check(
  !!(await until(async () => !dlg() && !(await state()).phonePair)),
  'Cancel ends the run and closes the dialog'
);
check((await state()).computers.length === 0, 'nothing was paired');

// Escape too
button(page.querySelector('.dv-me'), 'Add a phone')?.click();
await until(dlg);
dlg()?.parentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(!!(await until(async () => !dlg() && !(await state()).phonePair)), 'Escape ends it too');

// ---- off again ----
page.querySelector('.dv-master .dv-tog')?.click();
check(!!(await until(() => page.querySelector('.dv-off'))), 'turned off again');
window.TnaiThreads?.open();
return { ok, log };
