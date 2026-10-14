// Technically Not tools · desktop-check/tests/preview-layout.js — Live preview page layout with
// Side by side on and nothing to preview: no device caption may
// overlap the device dock or leave the stage, the three views share one height, one top line and
// one caption line with equal gaps and the row centered (device-dock.html, 2026-10-01), a click on
// one character leaves Side by side, every icon button in the address row and the dock has its icon
// centered (within 1 px) and no larger than 60% of its box. Checked at the start size and at
// 1024×768. Screenshot: preview-layout. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const hit = (a, b) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;

function audit(at) {
  const page = document.querySelector('#livePreviewPage'),
    stage = page.querySelector('.lpp-stage').getBoundingClientRect();
  const dock = page.querySelector('.lpp-dock').getBoundingClientRect();
  const caps = [...page.querySelectorAll('.lp-mirror-cap')];
  check(caps.length === 2, at + ': two device captions (' + caps.length + ')');
  caps.forEach(c => {
    const r = c.getBoundingClientRect(),
      name = c.textContent.split(' ')[0];
    check(!hit(r, dock), at + ': ' + name + ' caption clear of the device dock');
    check(
      r.bottom <= stage.bottom + 0.5 && r.top >= stage.top,
      at + ': ' + name + ' caption inside the stage'
    );
    const shell = c.parentElement.querySelector('.lp-frame-shell').getBoundingClientRect();
    check(!hit(r, shell), at + ': ' + name + ' caption clear of its device frame');
  });
  const buttons = [
    ...page.querySelectorAll('.lpp-chrome .lp-bar button, .lpp-tabrow button, .lpp-dock button'),
  ].filter(
    b =>
      b.offsetParent &&
      b.querySelector('svg') &&
      !b.textContent.replace(b.querySelector('span')?.textContent || '', '').trim()
  );
  check(buttons.length >= 5, at + ': icon buttons found (' + buttons.length + ')');
  buttons.forEach(b => {
    const r = b.getBoundingClientRect(),
      s = b.querySelector('svg').getBoundingClientRect(),
      name = b.getAttribute('aria-label') || b.title || b.className;
    const dx = s.left + s.width / 2 - (r.left + r.width / 2),
      dy = s.top + s.height / 2 - (r.top + r.height / 2);
    check(
      Math.abs(dx) <= 1 && Math.abs(dy) <= 1,
      at +
        ': icon centered in "' +
        name.slice(0, 40) +
        '" (off by ' +
        dx.toFixed(1) +
        ' / ' +
        dy.toFixed(1) +
        ' px)'
    );
    check(
      Math.max(s.width, s.height) <= Math.min(r.width, r.height) * 0.6 + 0.5,
      at +
        ': icon fits "' +
        name.slice(0, 40) +
        '" (' +
        Math.round(s.width) +
        '×' +
        Math.round(s.height) +
        ' in ' +
        Math.round(r.width) +
        '×' +
        Math.round(r.height) +
        ')'
    );
  });
}

function even(at) {
  // the approved Side by side layout: measured, not eyeballed
  const page = document.querySelector('#livePreviewPage'),
    lpEl = page.querySelector('.lp'),
    r1 = n => Math.round(n * 10) / 10;
  const hosts = ['desktop', 'tablet', 'phone'].map(d =>
    lpEl.querySelector(':is(.lp-stage,.lpp-mirror)[data-device="' + d + '"]')
  );
  check(
    hosts.every(Boolean) && lpEl.getAttribute('data-sbs') === 'fit',
    at + ': three views, laid out by 65'
  );

  // Nothing previewed (no tab): the main view is the page's own "Nothing to preview yet" text over
  // the row's full height, with no frame and no caption, so the two mirrors are compared. With a
  // tab open all three are frames and all three are compared.
  const empty = lpEl.hasAttribute('data-sbs-empty'),
    views = hosts.filter(h => !empty || !h.classList.contains('lp-stage'));
  const fr = views
      .map(h =>
        [...h.querySelectorAll('.lp-frame-shell')]
          .find(x => x.offsetParent)
          ?.getBoundingClientRect()
      )
      .filter(Boolean),
    n = views.length;
  if (fr.length !== n) {
    check(false, at + ': ' + n + ' frames on screen (' + fr.length + ')');
    return;
  }
  check(
    fr.every(x => Math.abs(x.height - fr[0].height) <= 1),
    at + ': one height for ' + n + ' views (' + fr.map(x => r1(x.height)).join(', ') + ')'
  );
  check(
    fr.every(x => Math.abs(x.top - fr[0].top) <= 1),
    at + ': one top line (' + fr.map(x => r1(x.top)).join(', ') + ')'
  );
  const l = lpEl.getBoundingClientRect(),
    dock = page.querySelector('.lpp-dock').getBoundingClientRect();
  check(
    fr.every(x => x.left >= l.left && x.right <= l.right && x.bottom <= dock.top),
    at + ': every frame inside the page and above the dock'
  );
  if (!empty) {
    const gaps = [fr[1].left - fr[0].right, fr[2].left - fr[1].right],
      off = fr[0].left - l.left - (l.right - fr[2].right);
    check(
      Math.abs(gaps[0] - gaps[1]) <= 2 && gaps[0] >= 16,
      at + ': equal gaps between the views (' + gaps.map(r1).join(', ') + ')'
    );
    check(
      Math.abs(off) <= 2,
      at +
        ': the row is centered (left ' +
        r1(fr[0].left - l.left) +
        ', right ' +
        r1(l.right - fr[2].right) +
        ')'
    );
  }
  const mc = lpEl.querySelector('.lpp-main-cap');
  const caps = views.map(h =>
    (h.classList.contains('lp-stage')
      ? mc
      : h.querySelector('.lp-mirror-cap')
    )?.getBoundingClientRect()
  );
  check(
    caps.every(Boolean) && caps.every(x => Math.abs(x.top - caps[0].top) <= 1),
    at + ': ' + n + ' captions on one line (' + caps.map(x => x && r1(x.top)).join(', ') + ')'
  );
  const under = caps.map((x, i) => (x ? x.top - fr[i].bottom : -1));
  check(
    under.every(g => g >= 4 && g <= 9),
    at + ': each caption 4 to 9 px under its frame (' + under.map(r1).join(', ') + ')'
  );
  check(
    caps.every(
      (x, i) =>
        x && x.bottom <= dock.top && x.left >= fr[i].left - 40 && x.right <= fr[i].right + 40
    ),
    at + ': captions above the dock and under their own view'
  );
  const st = lpEl.querySelector('.lp-stage');
  if (empty)
    check(
      !mc.offsetParent && st.scrollHeight <= st.clientHeight + 1,
      at +
        ': nothing previewed: no caption for the main view, its text fits without scrolling (' +
        st.scrollHeight +
        ' in ' +
        st.clientHeight +
        ')'
    );
  else
    check(
      mc.scrollWidth <= mc.clientWidth + 1 && /^(Desktop|Tablet|Phone) · \S/.test(mc.textContent),
      at + ': the main view has its caption, not cut ("' + mc.textContent + '")'
    );
}

function measure(at) {
  const page = document.querySelector('#livePreviewPage'),
    dock = page.querySelector('.lpp-dock'),
    d = dock.getBoundingClientRect(),
    r1 = n => Math.round(n * 10) / 10;
  for (const c of page.querySelectorAll('.lp-mirror-cap')) {
    const r = c.getBoundingClientRect(),
      sh = c.parentElement.querySelector('.lp-frame-shell').getBoundingClientRect(),
      col = c.parentElement.getBoundingClientRect();
    log.push(
      '     ' +
        at +
        ': caption "' +
        c.textContent +
        '" gap below its frame ' +
        r1(r.top - sh.bottom) +
        ', above the dock ' +
        r1(d.top - r.bottom) +
        ', frame ' +
        r1(sh.width) +
        '×' +
        r1(sh.height) +
        ' in column ' +
        r1(col.width) +
        '×' +
        r1(col.height) +
        ' top gap ' +
        r1(sh.top - col.top)
    );
  }
  const gaps = [...page.querySelectorAll('.lp-mirror-cap')].map(c =>
    r1(
      c.getBoundingClientRect().top -
        c.parentElement.querySelector('.lp-frame-shell').getBoundingClientRect().bottom
    )
  );
  check(
    gaps.length === 2 && Math.abs(gaps[0] - gaps[1]) <= 1 && gaps.every(g => g >= 4 && g <= 9),
    at + ': each caption sits the same distance under its own frame (' + gaps.join(' and ') + ' px)'
  );
  const kids = [...dock.querySelectorAll(':scope > *, .lp-modes button')].filter(
    k => k.offsetParent && !k.classList.contains('lp-modes')
  );
  for (const k of kids) {
    const r = k.getBoundingClientRect(),
      cs = getComputedStyle(k);
    log.push(
      '     ' +
        at +
        ': dock ' +
        (k.className || k.tagName) +
        ' "' +
        (k.textContent || k.value || '').trim().slice(0, 18) +
        '" x ' +
        r1(r.left - d.left) +
        '..' +
        r1(d.right - r.right) +
        ' from the edges, ' +
        r1(r.width) +
        '×' +
        r1(r.height) +
        ', center y off ' +
        r1(r.top + r.height / 2 - (d.top + d.height / 2)) +
        ', padding ' +
        cs.padding +
        ', font ' +
        cs.fontSize
    );
  }
  const main = page.querySelector('.lp-stage'),
    ms = main?.getBoundingClientRect(),
    st = page.querySelector('.lpp-stage').getBoundingClientRect();
  if (ms)
    log.push(
      '     ' +
        at +
        ': lp-stage ' +
        [ms.left, ms.top, ms.right, ms.bottom].map(r1) +
        ' in stage ' +
        [st.left, st.top, st.right, st.bottom].map(r1) +
        ' dock ' +
        [d.left, d.top, d.right, d.bottom].map(r1)
    );
  for (const sh of page.querySelectorAll('.lp-frame-shell')) {
    const r = sh.getBoundingClientRect();
    log.push(
      '     ' +
        at +
        ': frame ' +
        [r.left, r.top, r.right, r.bottom].map(r1) +
        ' ' +
        sh.parentElement.className
    );
  }
}
try {
  window.TnaiLivePreviewPage.open();
  await wait(900);
  const sbs = document.querySelector('.lpp-sbs-btn');
  if (sbs.getAttribute('aria-pressed') !== 'true') sbs.click();
  await wait(1200);
  audit('start size');
  even('start size');
  {
    // Phone as the main device: measure caption gaps and
    // the dock's own padding
    const page = document.querySelector('#livePreviewPage'),
      dock = page.querySelector('.lpp-dock');
    [...dock.querySelectorAll('.lp-modes button')].find(b => /phone/i.test(b.textContent))?.click();
    await wait(900);
    check(
      sbs.getAttribute('aria-pressed') === 'false' &&
        !page.querySelector('.lp').hasAttribute('data-sbs') &&
        !page.querySelector('.lpp-mirror, .lpp-main-cap') &&
        page.querySelector('.lp-stage')?.dataset.device === 'phone',
      'a click on one character leaves Side by side and shows that device alone'
    );
    check(
      !page.querySelector('.lp').style.gridTemplateColumns,
      'the one-device layout has its own columns back'
    );
    sbs.click();
    await wait(1200);
    even('Phone main');
    measure('Phone main');
    audit('Phone main');
    console.log('TNAI_SHOT:preview-layout-phone');
    await wait(500);
  }
  console.log('TNAI_SHOT:preview-layout');
  await wait(500);
  window.resizeTo(1024, 768);
  await wait(1200);
  audit('1024×768');
  even('1024×768');
  console.log('TNAI_SHOT:preview-layout-1024');
  await wait(500);

  // A page open (an address nothing answers at still gets its frame): all three views are frames,
  // measured at both sizes, then with the tablet rotated.
  const added = window.TnaiLivePreview.addUrl('http://localhost:59321/');
  await wait(1500);
  check(
    !!added?.ok && !document.querySelector('#livePreviewPage .lp').hasAttribute('data-sbs-empty'),
    'a tab is open, the main view is a frame'
  );
  even('1024×768 with a page');
  console.log('TNAI_SHOT:preview-layout-page-1024');
  await wait(500);
  window.resizeTo(1440, 900);
  await wait(1400);
  even('1440×900 with a page');
  console.log('TNAI_SHOT:preview-layout-page');
  await wait(500);
  {
    // Desktop as the main device: alone it fills the panel; Side by side it is a 1280×800 screen
    // scaled into its column like the other two, not the column's own narrow width, which cut
    // desktop pages off at the right
    const page = document.querySelector('#livePreviewPage'),
      scaleOf = () => page.querySelector('.lp-stage .lp-frame-shell:not([hidden]) .lp-frame-scale');
    [...page.querySelectorAll('.lpp-dock .lp-modes button')]
      .find(b => /desktop/i.test(b.textContent))
      ?.click();
    await wait(900);
    check(
      page.querySelector('.lp-stage')?.dataset.device === 'desktop' &&
        scaleOf()?.style.transform === 'none',
      'Desktop alone fills the panel (' +
        scaleOf()?.style.width +
        ', ' +
        scaleOf()?.style.transform +
        ')'
    );
    sbs.click();
    await wait(1400);
    const sc = scaleOf(),
      cap = page.querySelector('.lpp-main-cap')?.textContent || '';
    check(
      !!sc &&
        Math.abs(parseFloat(sc.style.width) - 1280) < 2 &&
        /scale\(0?\.\d+\)/.test(sc.style.transform) &&
        /1280×800 · \d+%/.test(cap),
      'Side by side: Desktop is 1280 px wide, scaled to fit (' +
        sc?.style.width +
        ', ' +
        sc?.style.transform +
        ', "' +
        cap +
        '")'
    );
    even('Desktop main');
    console.log('TNAI_SHOT:preview-layout-desktop');
    await wait(500);
    sbs.click();
    await wait(1200);
    check(
      scaleOf()?.style.transform === 'none',
      'Side by side off: Desktop fills the panel again (' + scaleOf()?.style.transform + ')'
    );
  }
  {
    // The terminal drawer's A− / A+ (33, 2026-10-06): its own text size, on the head's line beside
    // "Terminal page", nothing overlapping.
    const page = document.querySelector('#livePreviewPage'),
      G = window.TnaiAgents,
      r1 = n => Math.round(n * 10) / 10;
    page.querySelector('.lpp-dadd').click();
    const fonts = () =>
      [...page.querySelectorAll('.lpp-dslot .bw-font')].filter(b => b.offsetParent);
    const have = await (async () => {
      for (let i = 0; i < 80; i++) {
        if (fonts().length === 2 && page.querySelector('.lpp-dbody .xterm-rows')) return true;
        await wait(150);
      }
      return false;
    })();
    check(have, 'a drawer terminal shows A− / A+ in the head (' + fonts().length + ')');
    if (have) {
      await wait(600);
      const [down, up] = fonts(),
        open = page.querySelector('.lpp-dopen'),
        head = page.querySelector('.lpp-dhead').getBoundingClientRect();
      const rd = down.getBoundingClientRect(),
        ru = up.getBoundingClientRect(),
        ro = open.getBoundingClientRect(),
        mid = r => r.top + r.height / 2;
      check(
        Math.abs(rd.height - ro.height) < 0.6 &&
          Math.abs(mid(rd) - mid(ro)) < 0.6 &&
          Math.abs(mid(ru) - mid(head)) <= 1 &&
          Math.abs(ru.left - rd.right - (ro.left - ru.right)) < 0.6 &&
          ro.right <= head.right &&
          rd.left >= head.left,
        'they match the Terminal page button: heights ' +
          r1(rd.height) +
          '/' +
          r1(ru.height) +
          '/' +
          r1(ro.height) +
          ', centers ' +
          r1(mid(rd)) +
          '/' +
          r1(mid(ru)) +
          '/' +
          r1(mid(ro)) +
          ' in a head centered at ' +
          r1(mid(head)) +
          ', gaps ' +
          r1(ru.left - rd.right) +
          '/' +
          r1(ro.left - ru.right)
      );
      const px = () =>
          parseFloat(getComputedStyle(page.querySelector('.lpp-dbody .xterm-rows')).fontSize),
        f0 = px(),
        t0 = G.fontFor('terminal');
      up.click();
      up.click();
      await wait(900);
      check(
        px() === f0 + 2 &&
          G.fontFor('preview') === f0 + 2 &&
          G.fontFor('terminal') === t0 &&
          G.fontFor('agents') === t0,
        'A+ twice: drawer ' +
          f0 +
          ' → ' +
          px() +
          ' px, Terminal page still ' +
          G.fontFor('terminal') +
          ' px'
      );
      console.log('TNAI_SHOT:preview-layout-drawer-font');
      await wait(500);
      down.click();
      down.click();
      await wait(500);
    }
  }
  if (added?.ok) window.TnaiLivePreview.close(added.id);
} catch (error) {
  check(false, 'stopped: ' + error.message);
}
return { ok, log };
