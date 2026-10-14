/*
 * Technically Not tools · desktop-check/tests/project-chip.js — The top bar's Workspace chip opens
 * the project menu: switch, add, new (09). Measured, not eyeballed: the
 * menu is on screen under the chip, inside the window, nothing covers it, its rows share one left
 * edge and width, and the chip's own box does not change. New folders are made inside the test
 * profile (project-chip.main.js). Run: .\tools\desktop-check\check.ps1 -Test project-chip
 */
const log = [],
  t = (name, pass, extra) => {
    log.push((pass ? 'ok   ' : 'FAIL ') + name + (extra ? ' · ' + extra : ''));
    return pass;
  };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(100);
  }
};
const r1 = n => Math.round(n * 10) / 10,
  box = e => e.getBoundingClientRect(),
  fmt = b => [b.left, b.top, b.width, b.height].map(r1).join(',');
try {
  await wait(900);
  const P = window.TnaiProjects,
    chip = document.querySelector('.top .project'),
    menu = () => document.querySelector('.top .repo-project-menu');
  const before = box(chip),
    right = box(document.querySelector('.top-right'));
  t(
    'the chip is a button with a menu',
    chip.getAttribute('role') === 'button' &&
      chip.tabIndex === 0 &&
      chip.getAttribute('aria-haspopup') === 'menu' &&
      chip.getAttribute('aria-expanded') === 'false' &&
      !!chip.title
  );
  t('the chip shows a pointer', getComputedStyle(chip).cursor === 'pointer');
  chip.click();
  await wait(350);
  const m = menu(),
    mb = m && box(m);
  t(
    'a click opens the menu',
    !!m && !m.hidden && chip.getAttribute('aria-expanded') === 'true' && mb.height > 40,
    m ? fmt(mb) : 'no menu'
  );
  const after = box(chip);
  t(
    'the chip keeps its box while open',
    Math.abs(after.left - before.left) < 0.5 &&
      Math.abs(after.width - before.width) < 0.5 &&
      Math.abs(after.height - before.height) < 0.5 &&
      Math.abs(after.top - before.top) < 0.5,
    fmt(before) + ' → ' + fmt(after)
  );
  t(
    "the menu starts at the chip's left edge, 4 to 12 px under it",
    Math.abs(mb.left - after.left) < 0.2 &&
      mb.top - after.bottom >= 3.5 &&
      mb.top - after.bottom <= 12,
    'left ' + r1(mb.left) + ' vs ' + r1(after.left) + ', gap ' + r1(mb.top - after.bottom)
  );
  t(
    'the menu is inside the window with room on each side',
    mb.left >= 8 && mb.right <= innerWidth - 8 && mb.bottom <= innerHeight - 8,
    fmt(mb) + ' in ' + innerWidth + 'x' + innerHeight
  );
  const top = (x, y) => document.elementFromPoint(x, y);
  t(
    'nothing covers the menu (center and four corners)',
    [
      [mb.left + mb.width / 2, mb.top + mb.height / 2],
      [mb.left + 6, mb.top + 6],
      [mb.right - 6, mb.top + 6],
      [mb.left + 6, mb.bottom - 6],
      [mb.right - 6, mb.bottom - 6],
    ].every(([x, y]) => m.contains(top(x, y)))
  );
  const rows = [...m.querySelectorAll('.repo-project-item')],
    foot = [...m.querySelectorAll('.repo-project-add')],
    kids = [...m.children],
    kb = kids.map(box);
  t(
    'it lists the open project, then Add project folder… and New project…',
    rows.length === P.list().length &&
      rows.length >= 1 &&
      foot.map(b => b.textContent).join(' | ') === 'Add project folder… | New project…',
    rows.length + ' project row(s) · ' + foot.map(b => b.textContent).join(' | ')
  );
  t(
    'every row has the same left edge and width',
    kb.every(b => Math.abs(b.left - kb[0].left) < 0.5 && Math.abs(b.width - kb[0].width) < 0.5),
    kb.map(b => r1(b.left) + '/' + r1(b.width)).join(' ')
  );
  const pad = getComputedStyle(m),
    pl = parseFloat(pad.paddingLeft);
  t(
    'the rows sit inside the menu with equal room left and right',
    Math.abs(kb[0].left - mb.left - (mb.right - kb[0].right)) < 1.5 &&
      kb[0].left - mb.left >= pl - 0.5,
    r1(kb[0].left - mb.left) + ' / ' + r1(mb.right - kb[0].right)
  );
  t(
    'rows do not overlap and nothing is cut at the bottom',
    kb.every((b, i) => i === 0 || b.top >= kb[i - 1].bottom - 0.5) &&
      kb[kb.length - 1].bottom <= mb.bottom - pl + 1,
    kb.map(b => r1(b.top) + '-' + r1(b.bottom)).join(' ') +
      ' in ' +
      r1(mb.top) +
      '-' +
      r1(mb.bottom)
  );
  const fs = foot.map(b => getComputedStyle(b));
  t(
    'one top line above the two foot rows, same type, color and height',
    parseFloat(fs[0].borderTopWidth) > 0.5 &&
      parseFloat(fs[1].borderTopWidth) === 0 &&
      fs[0].font === fs[1].font &&
      fs[0].color === fs[1].color &&
      Math.abs(box(foot[0]).height - 1 - box(foot[1]).height) < 1,
    'top line ' +
      fs[0].borderTopWidth +
      ' / ' +
      fs[1].borderTopWidth +
      ' · color ' +
      fs[0].color +
      ' / ' +
      fs[1].color +
      ' · height ' +
      r1(box(foot[0]).height) +
      ' / ' +
      r1(box(foot[1]).height)
  );
  t(
    'no row text is cut',
    [...m.querySelectorAll('b, .repo-project-add')].every(e => e.scrollWidth <= e.clientWidth + 1)
  );
  t(
    'the menu does not reach into the right side of the top bar',
    mb.bottom > right.bottom ? true : mb.right <= right.left,
    'menu right ' + r1(mb.right) + ', top-right starts ' + r1(right.left)
  );
  console.log('TNAI_SHOT:project-chip-open');
  await wait(600);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  t('Escape closes it', menu()?.hidden !== false && chip.getAttribute('aria-expanded') === 'false');
  chip.focus();
  chip.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  await wait(250);
  t(
    'Enter on the chip opens it',
    menu() && !menu().hidden && chip.getAttribute('aria-expanded') === 'true'
  );

  // A real click outside the menu: the menu closes on a click, not on a change of page.
  document.querySelector('.layout').click();
  await wait(250);
  t(
    'a click elsewhere closes it',
    menu()?.hidden !== false && chip.getAttribute('aria-expanded') === 'false',
    'hidden ' +
      menu()?.hidden +
      ', expanded ' +
      chip.getAttribute('aria-expanded') +
      ', menus in top ' +
      document.querySelectorAll('.top .repo-project-menu').length
  );
  chip.click();
  await wait(250);
  chip.click();
  await wait(150);
  t('a second click on the chip closes it', menu()?.hidden !== false);

  // A narrow window (Windows Snap, a quarter of a screen): the menu stays inside it. The app's own
  // smallest window was 903 px wide here (2026-10-09), wider than chip + menu, so 09's move-left
  // for narrower windows is a guard this test cannot reach.
  let callId = 0;
  const main = (cmd, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++callId;
      window.__tnaiMainDone = window.__tnaiMainDone || {};
      window.__tnaiMainDone[id] = r => {
        delete window.__tnaiMainDone[id];
        r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
      };
      console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    });
  const full = [window.outerWidth, window.outerHeight],
    wide = [innerWidth, innerHeight];
  chip.click();
  await wait(250);
  await main('size', 640, 700);
  t(
    'resizing the window closes the open menu',
    menu()?.hidden !== false,
    'window ' + innerWidth + 'x' + innerHeight
  );
  chip.click();
  await wait(300);
  const nb = box(menu()),
    cb = box(chip),
    nk = [...menu().children].map(box);
  t(
    'asked for 640 px wide, at the smallest window the app allows the menu is inside it, 8 px or more from each side',
    nb.left >= 7.5 && nb.right <= innerWidth - 7.5 && nb.bottom <= innerHeight - 8,
    fmt(nb) + ' in ' + innerWidth + 'x' + innerHeight + ', chip at ' + r1(cb.left)
  );
  t(
    'and still under the chip, rows inside it, no text cut',
    nb.top - cb.bottom >= 3.5 &&
      nk.every(b => b.left >= nb.left && b.right <= nb.right) &&
      [...menu().querySelectorAll('b, .repo-project-add')].every(
        e => e.scrollWidth <= e.clientWidth + 1
      )
  );
  console.log('TNAI_SHOT:project-chip-narrow');
  await wait(600);
  chip.click();
  await wait(150);
  await main('size', wide[0], wide[1]);
  await wait(300);

  const count = P.list().length;
  chip.click();
  await wait(250);
  [...menu().querySelectorAll('.repo-project-add')][1].click();
  const made = await until(() => P.list().find(p => p.active && p.name === 'Named by test'));
  t(
    'New project… from the menu makes and opens the named project',
    !!made && P.list().length === count + 1 && menu().hidden
  );
  await until(() => /Named by test/.test(chip.textContent), 3000);
  t(
    'the chip names the new project and counts two open',
    /Named by test/.test(chip.textContent) && /2 projects open/.test(chip.textContent),
    chip.textContent.replace(/\s+/g, ' ').trim()
  );
  chip.click();
  await wait(300);
  const two = [...menu().querySelectorAll('.repo-project-item')],
    b2 = box(menu());
  t(
    'two project rows now, the new one marked active',
    two.length === 2 &&
      two.filter(r => r.classList.contains('active')).length === 1 &&
      /Named by test/.test(two.find(r => r.classList.contains('active')).textContent)
  );
  t(
    'still inside the window with two rows',
    b2.right <= innerWidth - 8 && b2.bottom <= innerHeight - 8 && b2.left >= 8,
    fmt(b2)
  );

  // "Show folder": one small button per row, left of ×, the same box as × and on its center line;
  // it asks for that row's folder only.
  const act = two.find(r => r.classList.contains('active')),
    sh = act.querySelector('.repo-project-show'),
    rm = act.querySelector('.repo-project-remove'),
    sb = box(sh),
    rb = box(rm),
    ab = box(act),
    ic = box(sh.querySelector('svg')),
    ri = box(rm.querySelector('svg'));
  t(
    'each project row has a Show folder button',
    two.every(r => r.querySelectorAll('.repo-project-show').length === 1) &&
      sh.title === 'Show folder' &&
      /Named by test/.test(sh.getAttribute('aria-label'))
  );
  t(
    "it has the same box as ×, sits left of it with the row's 2 px gap, on one center line, inside the row",
    Math.abs(sb.width - rb.width) < 0.5 &&
      Math.abs(sb.height - rb.height) < 0.5 &&
      Math.abs(rb.left - sb.right - 2) < 1 &&
      Math.abs(sb.top + sb.height / 2 - (rb.top + rb.height / 2)) < 0.5 &&
      sb.top >= ab.top &&
      sb.bottom <= ab.bottom,
    fmt(sb) + ' | ' + fmt(rb) + ' in row ' + fmt(ab)
  );
  const off = (i, b) =>
    Math.max(
      Math.abs(i.left + i.width / 2 - (b.left + b.width / 2)),
      Math.abs(i.top + i.height / 2 - (b.top + b.height / 2))
    );
  t(
    "its icon and the × are each within 1 px of their box's center, and no larger than 14 px",
    off(ic, sb) < 1 && off(ri, rb) < 1 && ic.width <= 15,
    'icon ' + fmt(ic) + ' in ' + fmt(sb) + ' · × icon ' + fmt(ri) + ' in ' + fmt(rb)
  );
  t(
    'the project name still has room and is not cut',
    act.querySelector('b').scrollWidth <= act.querySelector('b').clientWidth + 1 &&
      box(act.querySelector('.repo-project-open')).width > 200
  );
  console.log('TNAI_SHOT:project-chip-two');
  await wait(600);
  sh.click();
  await wait(400);
  const shown = await main('revealed');
  t(
    "a click asks for exactly that project's folder and closes the menu",
    shown === P.list().find(p => p.active).path && menu().hidden,
    shown
  );
  const outside = await window.tnaiNative.fs.reveal('C:\\Windows'),
    parent = await window.tnaiNative.fs.reveal(shown.replace(/[\\/][^\\/]+$/, ''));
  t(
    "a folder that is not on the project list is refused, also the project's parent",
    outside?.ok === false && parent?.ok === false && (await main('revealed')) === shown,
    (outside?.error?.message || '') + ' / ' + (parent?.error?.message || '')
  );
  chip.click();
  await wait(300);
  two
    .find(r => !r.classList.contains('active'))
    .querySelector('.repo-project-open')
    .click();
  const back = await until(() => P.list().find(p => p.active && p.name !== 'Named by test'));
  t(
    'a click on the other project switches to it and closes the menu',
    !!back && menu().hidden,
    back?.name
  );
} catch (e) {
  t('threw: ' + e.message, false);
}
return { ok: log.every(l => l.startsWith('ok')), log };
