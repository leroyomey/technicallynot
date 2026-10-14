// Technically Not tools · desktop-check/tests/theme-shortcuts.js — The shortcut list (32): opens
// with ? and Ctrl+/, every key wears the microphone's highlight, closes with Esc, not from the
// composer; Ctrl+5 opens All threads, Ctrl+2 lands on Threads (no Agents page), Ctrl+6 and Ctrl+1
// switch pages; Ctrl+6 inside a thread's CLI screen stays with the terminal. (The
// purple glass and accent checks that stood here are gone with purple glass; the looks and accents
// are checked by thread-pages.) No prompt is sent to any agent. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
const lum = el => {
  const m = getComputedStyle(el)
    .backgroundColor.match(/[\d.]+/g)
    .map(Number);
  return m.length > 3 && m[3] < 0.5
    ? null /* glass tints (translucent white over the dark page) are not the surface */
    : (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
};
const bgOf = el => {
  for (let e = el; e; e = e.parentElement) {
    const l = lum(e);
    if (l !== null) return l;
  }
  return 1;
};
const key = (target, init) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const html = document.documentElement,
  layout = document.querySelector('.layout');

window.TnaiThreads.open();
await wait(500);

// Shortcut list.
key(document.body, { key: '?' });
await wait(100);
const overlay = document.querySelector('.tnai-keys-overlay');
check(
  !!overlay && !overlay.hidden && overlay.querySelectorAll('.tnai-keys-row').length >= 15,
  '? opens the shortcut list (' +
    (overlay?.querySelectorAll('.tnai-keys-row').length || 0) +
    ' entries)'
);
check(bgOf(overlay.querySelector('.tnai-keys')) < 0.2, 'shortcut list is dark too');

// Every key wears the microphone's highlight: the mic's border color and a soft
// 2px ring, on all of them, and no key touches the next.
{
  const ks = [...overlay.querySelectorAll('.tnai-keys kbd')],
    probe = document.createElement('i');
  probe.style.color = 'var(--ac-coral-line)';
  overlay.append(probe);
  const coral = getComputedStyle(probe).color;
  probe.remove();
  const lit = ks.filter(k => {
    const s = getComputedStyle(k);
    return s.borderTopColor === coral && /0px 0px 0px 1px/.test(s.boxShadow);
  });
  const rows = [...overlay.querySelectorAll('.tnai-keys-row')].map(r =>
      [...r.querySelectorAll('kbd')].map(k => k.getBoundingClientRect())
    ),
    gap = Math.min(
      ...rows.flatMap(r => r.slice(1).map((b, i) => b.left - r[i].right)).filter(Number.isFinite)
    );
  check(
    ks.length > 20 && lit.length === ks.length && gap > 2,
    'shortcut keys highlighted like the microphone: ' +
      lit.length +
      '/' +
      ks.length +
      ' keys, ring color ' +
      coral +
      ', smallest gap between two keys ' +
      gap.toFixed(1) +
      ' px (two 1 px rings fit)'
  );

  // The same on every other key hint (Settings rows are in the page even while hidden): one rule
  // for all <kbd>.
  const others = [...document.querySelectorAll('kbd')].filter(k => !k.closest('.tnai-keys')),
    same = others.filter(k => getComputedStyle(k).borderTopColor === coral);
  check(
    others.length > 0 && same.length === others.length,
    'every other key hint in the app has the same color: ' + same.length + '/' + others.length
  );
}
await shot('dark-shortcuts');
key(document.activeElement, { key: 'Escape' });
await wait(100);
check(overlay.hidden, 'Esc closes it');
key(document.body, { key: '/', ctrlKey: true });
await wait(100);
check(!overlay.hidden, 'Ctrl+/ opens it');
key(document.activeElement, { key: 'Escape' });
await wait(100);
const prompt = document.getElementById('prompt');
prompt.focus();
key(prompt, { key: '?' });
await wait(100);
check(overlay.hidden, '? typed in the composer does not open it');
key(prompt, { key: '5', ctrlKey: true });
await wait(300);
check(
  layout.classList.contains('terminal-mode') && layout.classList.contains('tat-on'),
  'Ctrl+5 opens All threads (the page that stands where the Terminal page stood)'
);
await shot('dark-all-threads-ctrl5');

// There is no Agents page: its key lands on Threads, and the layout never gets that page's class.
key(document.body, { key: '2', ctrlKey: true });
await wait(400);
check(
  layout.classList.contains('threads-mode') &&
    !layout.classList.contains('agents-mode') &&
    !layout.classList.contains('terminal-mode'),
  'Ctrl+2 lands on Threads: there is no Agents page (' + layout.className + ')'
);
key(document.body, { key: '6', ctrlKey: true });
await wait(400);
check(layout.classList.contains('skills-mode'), 'Ctrl+6 opens Skills');
await shot('dark-skills');
key(document.body, { key: '1', ctrlKey: true });
await wait(300);
check(layout.classList.contains('threads-mode'), 'Ctrl+1 opens Threads');

// A real PowerShell thread (no agent), on its CLI screen: the terminal follows the theme.
const { paneId } = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
const view = window.TnaiThreadView;
const until = async (read, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = read();
    if (value) return value;
    await wait(100);
  }
  return null;
};
await until(() => view.shown() === paneId, 6000);
if (view.mode() !== 'term') view.setMode('term');
const screen = await until(() => {
  const element = view.term()?.element;
  return element?.getClientRects().length ? element : null;
}, 8000);
await wait(1500);
const xt = screen?.querySelector('.xterm-viewport') || screen;
check(!!xt && bgOf(xt) < 0.2, 'the CLI screen background is dark');

// A page key pressed inside a terminal goes to the program there: the page does not change.
const typing = screen?.querySelector('.xterm-helper-textarea');
check(!!typing, 'the CLI screen has its input');
key(typing || document.body, { key: '6', ctrlKey: true });
await wait(300);
check(
  !!typing &&
    layout.classList.contains('threads-mode') &&
    !layout.classList.contains('skills-mode'),
  'Ctrl+6 inside the CLI screen stays with the terminal (' + layout.className + ')'
);
await shot('dark-cli-screen');
await window.TnaiAgents.stop(paneId);
await wait(800);
return { ok, log };
