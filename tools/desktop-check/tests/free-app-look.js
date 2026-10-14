// Technically Not tools · desktop-check/tests/free-app-look.js — the free app in a real window
// (accounts switched off: package.json `tnaiAccountsUrl` is empty): on every page of the left
// menu there is no sign-in control, no sign-in dialog and no lock, and no Settings section speaks
// of the community total. The rule itself is tested in plain Node (tools/free-app-test.js); this
// looks at the page the user gets. Returns {ok, log}.
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
    await wait(100);
  }
  return null;
};

// Is this element drawn? (in the page, not hidden, with a size)
const drawn = element => {
  if (!element || !element.isConnected || element.hidden) return false;
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
};

await window.TnaiAuth.ready();
check(window.TnaiAuth.state().off === true, 'the app says accounts are off');
check(
  window.TnaiAuth.state().lock?.locked !== true,
  'not locked: ' + JSON.stringify(window.TnaiAuth.state().lock)
);

// what must not be on any page
const leftovers = () => {
  const found = [];
  const control = document.getElementById('tnaiUser');
  if (drawn(control)) {
    const box = control.getBoundingClientRect();
    found.push('sign-in control drawn ' + Math.round(box.width) + '×' + Math.round(box.height));
  }
  if (drawn(document.querySelector('.tnai-auth-overlay'))) found.push('sign-in dialog');
  if (drawn(document.querySelector('.tnai-lock-overlay'))) found.push('lock');
  return found;
};

const control = document.getElementById('tnaiUser');
check(
  !!control && control.hidden && control.getBoundingClientRect().width === 0,
  'the sign-in control is in the page, hidden, and takes no room in the top bar'
);

// The bell is a badge on the corner of the account circle. Without the circle it must stand
// clear of everything else in the bar, not lie over the chip before it.
const bell = document.querySelector('.top-right > .tnai-bell');
const bellBox = bell.getBoundingClientRect();
const underBell = [...document.querySelectorAll('.top-right > *')]
  .filter(element => element !== bell && drawn(element))
  .filter(element => {
    const box = element.getBoundingClientRect();
    return box.left < bellBox.right && bellBox.left < box.right;
  })
  .map(element => element.id || element.className);
check(
  drawn(bell) && underBell.length === 0,
  'the bell lies over nothing in the top bar (' +
    Math.round(bellBox.width) +
    ' wide, at ' +
    Math.round(bellBox.left) +
    '): ' +
    underBell.join(', ')
);

const pages = [...document.querySelectorAll('.side-item[data-view]')].map(
  item => item.dataset.view
);
check(pages.length >= 5, 'the left menu lists its pages: ' + pages.join(', '));
for (const view of pages) {
  document.querySelector('.side-item[data-view="' + view + '"]').click();
  await wait(350);
  const found = leftovers();
  check(
    !found.length,
    view +
      ': no sign-in control, dialog or lock' +
      (found.length ? ' (' + found.join('; ') + ')' : '')
  );
}

// Settings: no section speaks of the community total
window.TnaiRoute('settings');
await until(() => document.getElementById('settingsPage')?.offsetParent);
const tabs = window.TnaiSettings.tabs();
check(tabs.length > 0, 'Settings lists its sections: ' + tabs.join(', '));
for (const tab of tabs) {
  window.TnaiSettings.open(tab);
  await wait(350);
  const panel = document.getElementById('settingsPanel-' + tab);
  const text = panel ? panel.textContent : '';
  check(
    !!panel && !/community/i.test(text),
    'Settings › ' + tab + ': no word of the community total'
  );
  if (tab === 'usage' && panel) {
    // the section ends with its last card: nothing empty is left under it
    const cards = [...panel.children].filter(drawn);
    const last = cards[cards.length - 1];
    const gap = last
      ? Math.round(panel.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom)
      : -1;
    log.push(
      'note Settings › usage: ' + cards.length + ' parts drawn, ' + gap + ' px under the last one'
    );
  }
}
console.log('TNAI_SHOT:free-app-look');
await wait(600);

return { ok, log };
