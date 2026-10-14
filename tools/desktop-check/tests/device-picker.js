// Technically Not tools · desktop-check/tests/device-picker.js — Live preview page device picker
// (107): the dock holds the device characters (the group of three first, then Desktop / Tablet /
// Phone as 31's own buttons, each with its word as a hidden label, the shown one lit, all in one
// row of equal boxes with the character centered); the chooser (opened here with
// TnaiDevicePicker.open(), in the app once per run from the menu) shows three device objects over
// the stage; every picture loads and the four layers of an object share one box; the view now shown
// is lit, the others sleep until focused; clicking an object switches the device through the dock's
// own button and closes; Esc closes and keeps the device, focus goes back to the shown device’s
// character in the dock; a menu click made by a script does not open it by itself. Measured at the
// start size and 1024×768: three equal objects, equal gaps, inside the stage, nothing overlapping.
// Screenshots: device-picker-open, device-picker-1024. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const op = n => Number(getComputedStyle(n).opacity);
try {
  window.TnaiLivePreviewPage.open();
  await wait(900);
  const page = document.querySelector('#livePreviewPage'),
    dock = page.querySelector('.lpp-dock'),
    picker = window.TnaiDevicePicker;
  const openBtn = { click: () => picker.open() };
  const mode = d => dock.querySelector('.lp-modes button[data-device="' + d + '"]');
  {
    // the dock's characters
    const sbs0 = dock.querySelector('.lpp-sbs-btn');
    if (sbs0.getAttribute('aria-pressed') === 'true') {
      sbs0.click();
      await wait(600);
    }
    const all = dock.querySelector('.dvc-all'),
      singles = ['desktop', 'tablet', 'phone'].map(mode),
      r = n => n.getBoundingClientRect();
    check(
      !dock.querySelector('.dvp-open') && dock.firstElementChild === all && all === sbs0,
      'the group of three is first in the dock, it is the Side by side button, and there is no Devices word button'
    );
    check(
      all.querySelectorAll('.dvc').length === 3 &&
        singles.every(b => b?.querySelectorAll('.dvc').length === 1),
      'the group holds three characters, each device button one'
    );
    check(
      singles.every(
        b =>
          /^(Desktop|Tablet|Phone)$/.test(b.getAttribute('aria-label')) &&
          b.textContent.trim() === b.getAttribute('aria-label') &&
          r(b.querySelector('.dvc-lbl')).width <= 1.5
      ),
      'each device button keeps its word as a hidden label (' +
        singles.map(b => b.getAttribute('aria-label')).join(', ') +
        ')'
    );
    const dimgs = [...dock.querySelectorAll('.dvc img')];
    await until(() => dimgs.every(i => i.complete));
    check(
      dimgs.length === 18 && dimgs.every(i => i.naturalWidth === 960),
      'all 18 dock pictures loaded'
    );
    const boxes = singles.map(r),
      chars = singles.map(b => r(b.querySelector('.dvc')));
    check(
      boxes.every(
        b =>
          Math.abs(b.width - boxes[0].width) < 0.6 &&
          Math.abs(b.height - boxes[0].height) < 0.6 &&
          Math.abs(b.top - boxes[0].top) < 0.6
      ),
      'the three device buttons are one size on one line (' +
        boxes
          .map(b => Math.round(b.width * 10) / 10 + '×' + Math.round(b.height * 10) / 10)
          .join(', ') +
        ')'
    );
    check(
      Math.abs(boxes[1].left - boxes[0].right - (boxes[2].left - boxes[1].right)) < 0.6,
      'equal gaps between the device buttons (' +
        [boxes[1].left - boxes[0].right, boxes[2].left - boxes[1].right]
          .map(g => Math.round(g * 10) / 10)
          .join(', ') +
        ')'
    );
    chars.forEach((c, i) => {
      const b = boxes[i],
        dx = c.left + c.width / 2 - (b.left + b.width / 2),
        dy = c.top + c.height / 2 - (b.top + b.height / 2);
      check(
        Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && c.width <= b.width && c.height <= b.height,
        singles[i].dataset.device +
          ' character centered in its button (off by ' +
          dx.toFixed(1) +
          ' / ' +
          dy.toFixed(1) +
          ' px, ' +
          Math.round(c.width) +
          '×' +
          Math.round(c.height) +
          ' in ' +
          Math.round(b.width) +
          '×' +
          Math.round(b.height) +
          ')'
      );
    });
    check(
      chars.every(
        c =>
          Math.abs(c.height - chars[0].height) < 0.6 && Math.abs(c.bottom - chars[0].bottom) < 0.6
      ),
      'the three characters stand one height on one ground line (' +
        chars.map(c => Math.round(c.height * 10) / 10).join(', ') +
        ')'
    );
    const g = r(all.querySelector('.dvc-group')),
      a = r(all),
      gk = [...all.querySelectorAll('.dvc')].map(r);
    check(
      Math.abs(g.left + g.width / 2 - (a.left + a.width / 2)) <= 1 &&
        Math.abs(g.top + g.height / 2 - (a.top + a.height / 2)) <= 1 &&
        gk.every(
          k =>
            k.left >= g.left - 0.6 &&
            k.right <= g.right + 0.6 &&
            k.top >= g.top - 0.6 &&
            Math.abs(k.bottom - g.bottom) < 0.6
        ),
      'the group is centered in its button and its three characters stand inside it on one ground line'
    );
    const d = r(dock);
    check(
      [all, ...singles].every(b => r(b).top >= d.top && r(b).bottom <= d.bottom) &&
        Math.abs(a.top - d.top - (d.bottom - a.bottom)) < 0.6,
      'character buttons inside the dock, same space above and below (' +
        Math.round((a.top - d.top) * 10) / 10 +
        ' / ' +
        Math.round((d.bottom - a.bottom) * 10) / 10 +
        ')'
    );
    const litc = b => [...b.querySelectorAll('.dvc-screen')].every(s => op(s) > 0.9),
      now = page.querySelector('.lp-stage')?.dataset.device;
    await wait(400);
    check(
      litc(mode(now)) && singles.filter(b => b !== mode(now)).every(b => !litc(b)) && !litc(all),
      'one device shown: its character is lit (' + now + '), the others and the group sleep'
    );
    console.log('TNAI_SHOT:device-picker-dock');
    await wait(500);
  }
  check(!picker.isOpen(), 'a script’s menu click does not open the picker by itself');
  const device = () => page.querySelector('.lp-stage')?.dataset.device;
  const start = device();

  openBtn.click();
  await wait(400);
  const box = page.querySelector('.dvp'),
    objs = [...box.querySelectorAll('.dvp-obj')];
  check(
    picker.isOpen() && objs.length === 3,
    'the chooser opens three objects (' + objs.map(o => o.dataset.device).join(', ') + ')'
  );
  const imgs = [...box.querySelectorAll('img')];
  await until(() => imgs.every(i => i.complete));
  check(
    imgs.length === 9 && imgs.every(i => i.naturalWidth === 960 && i.naturalHeight === 780),
    'all 9 pictures loaded at 960×780 (' +
      imgs
        .filter(i => !i.naturalWidth)
        .map(i => i.src.split('/').pop())
        .join(' ') +
      ')'
  );
  const masks = objs.map(
    o =>
      getComputedStyle(o.querySelector('.dvp-screen')).maskImage ||
      getComputedStyle(o.querySelector('.dvp-screen')).webkitMaskImage
  );
  check(
    masks.every(m => /-screen\.webp/.test(m)),
    'each screen is masked by its own picture'
  );
  objs.forEach(o => {
    const a = o.querySelector('.dvp-art').getBoundingClientRect();
    const same = [...o.querySelector('.dvp-art').children].every(c => {
      const r = c.getBoundingClientRect();
      return (
        Math.abs(r.left - a.left) < 0.6 &&
        Math.abs(r.top - a.top) < 0.6 &&
        Math.abs(r.width - a.width) < 0.6 &&
        Math.abs(r.height - a.height) < 0.6
      );
    });
    check(
      same,
      o.dataset.device +
        ': its four layers share one box (' +
        Math.round(a.width) +
        '×' +
        Math.round(a.height) +
        ')'
    );
  });
  const lit = o =>
    op(o.querySelector('.dvp-screen')) > 0.9 &&
    op(o.querySelector('.dvp-eyes')) > 0.9 &&
    op(o.querySelector('.dvp-sleep')) < 0.1;
  const asleep = o =>
    op(o.querySelector('.dvp-screen')) < 0.1 &&
    op(o.querySelector('.dvp-eyes')) < 0.1 &&
    op(o.querySelector('.dvp-sleep')) > 0.9;
  const cur = objs.find(o => o.dataset.device === start),
    others = objs.filter(o => o !== cur);
  await wait(400);
  check(
    cur.getAttribute('aria-pressed') === 'true' && lit(cur),
    'the view now shown (' + start + ') is lit'
  );
  check(document.activeElement === cur, 'focus starts on it');
  check(others.every(asleep), 'the other two sleep (screen off, eyes closed)');

  function measure(at) {
    const stage = page.querySelector('.lpp-stage').getBoundingClientRect(),
      r = objs.map(o => o.getBoundingClientRect());
    const widths = r.map(x => Math.round(x.width * 10) / 10),
      gaps = [r[1].left - r[0].right, r[2].left - r[1].right].map(g => Math.round(g * 10) / 10);
    check(
      Math.max(...widths) - Math.min(...widths) < 1,
      at + ': three equal objects (widths ' + widths.join(', ') + ')'
    );
    check(
      Math.abs(gaps[0] - gaps[1]) < 1 && gaps[0] >= 8,
      at + ': equal gaps, nothing overlapping (' + gaps.join(', ') + ')'
    );
    check(
      r.every(
        x =>
          x.left >= stage.left &&
          x.right <= stage.right &&
          x.top >= stage.top &&
          x.bottom <= stage.bottom
      ),
      at + ': objects inside the stage'
    );
    const mid = (r[0].left + r[2].right) / 2,
      c = (stage.left + stage.right) / 2;
    check(
      Math.abs(mid - c) < 1,
      at + ': the row is centered in the stage (off by ' + Math.round((mid - c) * 10) / 10 + ' px)'
    );
    const title = box.querySelector('.dvp-title').getBoundingClientRect(),
      hint = box.querySelector('.dvp-hint').getBoundingClientRect();
    check(
      title.top >= stage.top &&
        hint.bottom <= stage.bottom &&
        title.bottom <= r[0].top + 0.5 &&
        hint.top >= Math.max(...r.map(x => x.bottom)) - 0.5,
      at + ': title above and hint below the objects, inside the stage'
    );
  }
  measure('start size');
  console.log('TNAI_SHOT:device-picker-open');
  await wait(500);

  // Keyboard focus wakes an object; Tab stays inside the three.
  const next = objs[(objs.indexOf(cur) + 1) % 3];
  next.focus();
  await wait(450);
  check(
    next.matches(':focus-visible') ? lit(next) : true,
    'a focused object lights up (' +
      next.dataset.device +
      ', focus ring ' +
      next.matches(':focus-visible') +
      ')'
  );

  // Esc keeps the device and gives focus back.
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  check(!picker.isOpen() && device() === start, 'Esc closes it and keeps ' + start);
  check(
    document.activeElement === mode(start),
    'focus is back on the shown device’s character in the dock'
  );

  // Clicking an object shows that device (through the dock's own button) and closes.
  const target = start === 'tablet' ? 'phone' : 'tablet';
  openBtn.click();
  await wait(300);
  objs.find(o => o.dataset.device === target).click();
  await wait(600);
  check(
    !picker.isOpen() && device() === target && mode(target).getAttribute('aria-pressed') === 'true',
    'clicking ' + target + ' shows the ' + target + ' view and closes (device ' + device() + ')'
  );
  openBtn.click();
  await wait(500);
  check(
    lit(objs.find(o => o.dataset.device === target)) && asleep(cur),
    'reopened: ' + target + ' is lit, ' + start + ' sleeps'
  );

  window.resizeTo(1024, 768);
  await wait(1200);
  measure('1024×768');
  console.log('TNAI_SHOT:device-picker-1024');
  await wait(500);
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  mode(start).click();
  await wait(300);
} catch (error) {
  check(false, 'stopped: ' + error.message);
}
return { ok, log };
