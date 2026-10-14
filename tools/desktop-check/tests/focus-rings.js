/*
 * Technically Not tools · desktop-check/tests/focus-rings.js — one highlight per text box (the
 * fault: a ghost rectangle over the Skills search box). A text box inside
 * a container that lights up on focus (:focus-within) must draw no ring of its own;
 * 07-purple-glass.css keeps the list of such containers. This walks every page of the left menu,
 * puts the cursor in each text box it can see and fails for a box that still draws a ring while
 * something around it lit up. It first proves it can see the fault on a box made for the purpose.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const TEXT =
  'input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=file],[type=color],[type=hidden]),textarea';
const look = el => {
  const cs = getComputedStyle(el);
  return cs.borderTopColor + '|' + cs.boxShadow + '|' + cs.outlineStyle + '|' + cs.outlineColor;
};
const name = el =>
  el.tagName.toLowerCase() +
  (el.id ? '#' + el.id : '') +
  (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
const shown = el =>
  !!el.offsetParent && !el.disabled && !el.readOnly && el.getBoundingClientRect().width > 8;

// What a box and the four containers around it look like with the cursor in it, against without.
async function probe(box) {
  const around = [];
  for (
    let p = box.parentElement, i = 0;
    p && i < 4 && p !== document.body;
    p = p.parentElement, i++
  )
    around.push(p);
  document.activeElement?.blur?.();
  await frame();
  await wait(260);
  const before = around.map(look);
  box.focus({ preventScroll: true });
  await frame();
  await wait(260);
  const lit = around.filter((p, i) => look(p) !== before[i]),
    cs = getComputedStyle(box);
  const own =
    (cs.boxShadow !== 'none' ? 'a shadow ring' : '') +
    (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      ? (cs.boxShadow !== 'none' ? ' and ' : '') + 'an outline'
      : '');
  box.blur();
  await frame();
  return { lit, own };
}

// The test window is never the active one, and a page that is not focused draws no focus ring at
// all: focus-rings.main.js asks the browser to treat the page as focused for this test.
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = answer => {
      delete window.__tnaiMainDone[id];
      if (answer?.ok) resolve(answer.value);
      else reject(new Error(answer?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
await main('actFocused', true);

// 1. The check sees the fault: a box made here, in a container that lights up and is not on the
// list.
{
  const style = document.createElement('style');
  style.textContent =
    '.tnai-ring-probe{display:inline-flex;border:1px solid #444;padding:4px}.tnai-ring-probe:focus-within{border-color:#a8f}';
  const wrap = document.createElement('label');
  wrap.className = 'tnai-ring-probe';
  wrap.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999';
  const box = document.createElement('input');
  box.type = 'text';
  box.style.cssText = 'border:0;background:none;width:120px';
  wrap.append(box);
  document.head.append(style);
  document.body.append(wrap);
  const got = await probe(box);
  check(
    got.lit.length > 0 && !!got.own,
    'the check sees a doubled ring on a box made for it (' + (got.own || 'nothing drawn') + ')'
  );
  wrap.remove();
  style.remove();
}

// 2. Every text box on every page. The old navigation's items are still in the page, unseen, and
// a press on one opens its page (the Overview item lands on Threads, 118); the old Agents page is
// gone from the interface and is not walked.
const pages = [...document.querySelectorAll('.side-item')].filter(
  b =>
    b.dataset.view !== 'agents' &&
    !b.disabled &&
    !b.classList.contains('inactive') &&
    b.getAttribute('aria-disabled') !== 'true'
);
let boxes = 0,
  inLit = 0;
const bad = [],
  seen = new Set();
for (const nav of pages) {
  const label = (nav.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  nav.click();
  await frame();
  await wait(500);
  for (const box of [...document.querySelectorAll(TEXT)].filter(shown)) {
    if (seen.has(box)) continue;
    seen.add(box);
    boxes++;
    const got = await probe(box);
    if (got.lit.length) {
      inLit++;
      if (got.own)
        bad.push(
          label +
            ': ' +
            name(box) +
            ' draws ' +
            got.own +
            ' inside ' +
            name(got.lit[0]) +
            ', which lights up itself'
        );
    }
  }
}
check(
  boxes >= 3,
  'text boxes looked at on ' +
    pages.length +
    ' pages: ' +
    boxes +
    ' (' +
    inLit +
    ' inside a container that lights up)'
);
check(
  !bad.length,
  bad.length ? bad.join(' · ') : 'no text box draws a second ring inside a container that lights up'
);

// 3. The two that were missing, by name.
for (const [sel, nav] of [
  ['.sk-search .skills-filter', '.side-item[data-ai-tool="skills"]'],
  ['.lpp-omni input', '.side-item[data-view="live-preview"]'],
]) {
  document.querySelector(nav)?.click();
  await frame();
  await wait(500);
  const box = [...document.querySelectorAll(sel)].find(shown);
  if (!box) {
    log.push('info ' + sel + ' is not on screen in the test app: not looked at');
    continue;
  }
  const got = await probe(box);
  check(
    !got.own,
    sel +
      ' draws no ring of its own (' +
      (got.lit.length ? 'its container lights up' : 'its container did not change') +
      ')'
  );
  if (sel.startsWith('.sk-search')) {
    box.focus({ preventScroll: true });
    box.value = 'ui';
    await frame();
    console.log('TNAI_SHOT:focus-rings-skills-search');
    await wait(600);
    box.value = '';
    box.blur();
  }
}
await main('actFocused', false).catch(() => {});
return { ok, log };
