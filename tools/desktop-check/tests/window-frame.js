// Technically Not tools · desktop-check/tests/window-frame.js — No OS title bar (66 +
// desktop/main.js): the app's own minimize / maximize / close buttons sit compact at the top bar's
// right end with an instant (no-transition) hover, empty top bar space and the logo drag the window
// while its controls don't, and window:control reports state and refuses unknown actions. Returns
// {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};

try {
  const top = document.querySelector('.top'),
    right = document.querySelector('.top-right');
  check(document.documentElement.classList.contains('tnai-frameless'), 'frameless mode on');
  check(document.title === 'Technically Not', 'window title is just the name: ' + document.title);
  const ctrls = [...right.querySelectorAll('.win-ctrls .win-ctrl')];
  check(
    ctrls.length === 3,
    'minimize / maximize / close sit in the top bar: ' + ctrls.map(b => b.dataset.act).join(', ')
  );
  const cr = ctrls[2]?.getBoundingClientRect();
  check(
    !!cr &&
      cr.height <= 32 &&
      cr.width <= 44 &&
      innerWidth - cr.right <= 20 /* purple top bar: 16 px side padding */,
    'close button is compact and at the right edge (' +
      (cr
        ? Math.round(cr.width) +
          '×' +
          Math.round(cr.height) +
          ', ' +
          Math.round(innerWidth - cr.right) +
          'px from edge'
        : 'missing') +
      ')'
  );
  check(
    ctrls.every(b => parseFloat(getComputedStyle(b).transitionDuration) === 0),
    'hover highlight has no transition (instant)'
  );
  check(
    getComputedStyle(top).webkitAppRegion === 'drag' ||
      getComputedStyle(top).getPropertyValue('-webkit-app-region') === 'drag',
    'top bar drags the window'
  );
  const btn = right.querySelector('button');
  check(
    !!btn && getComputedStyle(btn).getPropertyValue('-webkit-app-region') === 'no-drag',
    'top-bar buttons stay clickable (no-drag)'
  );
  const brand = top.querySelector('.brand'),
    logo = brand?.querySelector('img');
  check(
    !!brand && getComputedStyle(brand).getPropertyValue('-webkit-app-region') === 'drag',
    'logo drags the window'
  );
  check(
    !!logo && getComputedStyle(logo).getPropertyValue('-webkit-user-drag') === 'none',
    'logo image itself cannot be dragged'
  );
  const crumb = top.querySelector('.project');
  check(
    !!crumb && getComputedStyle(crumb).getPropertyValue('-webkit-app-region') === 'no-drag',
    'project crumb stays no-drag'
  );
  const state = await window.tnaiNative.frame.control('state');
  check(
    !!state && typeof state.maximized === 'boolean',
    'window state reported: ' + JSON.stringify(state)
  );
  check(
    (await window.tnaiNative.frame.control('bogus')) === null,
    'unknown window actions refused'
  );
  await shot('window-frame-light');
  window.TnaiTheme?.set('dark');
  await wait(400);
  await shot('window-frame-dark');
  window.TnaiTheme?.set('light');
  await wait(200);
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
