// Technically Not tools · desktop-check/tests/composer-popout.js — The composer pops out into its
// own OS window (38; counted and driven in the main process by composer-popout.main.js): same
// security settings, the same live box moves (not a copy), Technically Not's composer row collapses
// to a "popped out · Bring back" chip; REAL typing + Enter in the pop-out sends to the selected
// PowerShell thread (and the Send button, and a second thread once it is the selected agent), the ＋
// menu renders in the pop-out window, a pasted image becomes an attachment chip there, the Build
// workspace lead chip shows there and the task goes to the lead, sending still works while
// Technically Not shows the All threads page, On top reaches the OS window,
// closing the window docks the box back exactly where it was, the moved/resized bounds and On top
// come back on the next pop-out, and Dock / Bring back dock it. Only plain PowerShell threads get
// input; no prompt is sent to any agent CLI. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const windows = /Windows/.test(navigator.userAgent);
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(80);
  }
  return null;
};
const shot = async name => {
  await (window.TnaiTest?.shot?.(name) ?? wait(600));
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents,
  pop = window.TnaiComposerPopout;
const buffer = async id => (await window.tnaiNative.pty.replay(id))?.buffer || '';
const box = document.querySelector('.composebox'),
  prompt = document.getElementById('prompt'),
  composer = document.querySelector('.composer');
const shown = el => !!el && el.getClientRects().length > 0;

// The pop-out's width holds the whole composer: no sideways overflow anywhere, and the bottom row's
// controls (sounds, Agent/Model/Effort pickers, hints) sit side by side without overlapping or
// being cut at the window's edge. Returns '' when fine, else what is wrong.
const layoutProblem = w => {
  const d = w.document,
    root = d.documentElement,
    hints = d.querySelector('body>.composer>.hints');
  if (root.scrollWidth > root.clientWidth + 1 || d.body.scrollWidth > w.innerWidth + 1)
    return 'overflow ' + root.scrollWidth + '/' + d.body.scrollWidth + ' > ' + w.innerWidth;
  if (!hints) return 'no hint row';
  const items = [...hints.querySelectorAll(':scope>*, .tnai-pickers>*')].filter(
    e =>
      shown(e) && !e.classList.contains('tnai-pickers') && !e.classList.contains('tnai-route-hint')
  );
  const rs = items.map(e => [e, e.getBoundingClientRect()]);
  for (const [e, r] of rs)
    if (
      r.left < -0.5 ||
      r.right > w.innerWidth + 0.5 ||
      r.right > hints.getBoundingClientRect().right + 0.5
    )
      return (
        'cut: ' +
        (e.textContent || e.dataset.pick || e.className).trim().slice(0, 30) +
        ' ' +
        Math.round(r.left) +
        '–' +
        Math.round(r.right) +
        ' in ' +
        w.innerWidth
      );
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const [a, ra] = rs[i],
        [b, rb] = rs[j];
      if (
        ra.left < rb.right - 0.5 &&
        rb.left < ra.right - 0.5 &&
        ra.top < rb.bottom - 0.5 &&
        rb.top < ra.bottom - 0.5
      )
        return (
          'overlap: ' +
          (a.textContent || a.dataset.pick).trim().slice(0, 24) +
          ' / ' +
          (b.textContent || b.dataset.pick).trim().slice(0, 24)
        );
    }
  const head = d.querySelector('.acp-head b');
  if (head && head.scrollWidth > head.clientWidth + 1) return 'title cut';
  return '';
};

try {
  check(
    !!pop && !!box.querySelector('.tnai-composer-pop'),
    'pop-out button in the composer: ' + box.querySelector('.tnai-composer-pop')?.title
  );

  // ---- Two plain PowerShell threads.
  await agents.detect(true);
  await window.TnaiTest.startThread({ tool: 'Terminal' });
  await window.TnaiTest.startThread({ tool: 'Terminal' });
  const shells = await until(() => {
    const s = agents.sessions().filter(x => x.agent === 'Terminal' && x.running);
    return s.length >= 2 ? s : null;
  });
  check(!!shells, 'two PowerShell threads running');
  const [A, B] = shells.map(s => s.paneId);
  const shellPrompt = windows ? /PS [A-Z]:/ : /[$#] $/;
  await until(
    async () => shellPrompt.test(await buffer(A)) && shellPrompt.test(await buffer(B)),
    8000
  );
  window.TnaiThreads.open();
  await wait(300);
  window.TnaiLiveTasks.setTarget(A);

  // ---- Pop out: a real second window, same box node, main row collapsed to the chip.
  const parent = box.parentNode,
    next = box.nextSibling,
    rowBefore = composer.getBoundingClientRect().height;
  box.querySelector('.tnai-composer-pop').click();
  check(!!(await until(async () => (await main('count')) === 2, 5000)), 'pop-out window opened');
  const [info] = await main('info');
  check(
    info &&
      info.url === 'about:blank' &&
      info.contextIsolation === true &&
      info.sandbox === true &&
      info.nodeIntegration === false,
    'pop-out window: about:blank, isolated, sandboxed, no node (' + JSON.stringify(info) + ')'
  );
  const cwin = pop.window(),
    cdoc = cwin.document;
  check(
    pop.isOut() &&
      box.ownerDocument === cdoc &&
      cdoc.querySelector('.composebox') === box &&
      !document.querySelector('.composebox'),
    'the same live composer box moved into the window'
  );
  const away = document.querySelector('.tnai-composer-away');
  check(
    shown(away) && /popped out/i.test(away.textContent) && !!away.querySelector('button.primary'),
    'Technically Not shows the "Composer is popped out · Bring back" chip'
  );
  await wait(200);
  check(
    composer.getBoundingClientRect().height < rowBefore * 0.7,
    'composer row collapsed to the Bring back chip (' +
      Math.round(rowBefore) +
      ' → ' +
      Math.round(composer.getBoundingClientRect().height) +
      ' px)'
  );
  check(cdoc.activeElement === prompt, 'prompt focused in the pop-out');

  // ---- Sized to its content, with padding; nothing clipped.
  const holder = cdoc.querySelector('body>.composer');
  const fits = () =>
    holder &&
    holder.scrollHeight <= holder.clientHeight + 1 &&
    cdoc.body.scrollHeight <= cwin.innerHeight + 1 &&
    cdoc.body.scrollWidth <= cwin.innerWidth + 1 &&
    box.getBoundingClientRect().bottom <= cwin.innerHeight;
  if (!fits())
    log.push(
      'info wide: ' +
        [...cdoc.querySelectorAll('body *')]
          .filter(e => e.getBoundingClientRect().right > cwin.innerWidth + 1)
          .slice(0, 8)
          .map(
            e =>
              e.tagName +
              '.' +
              e.className +
              '#' +
              e.id +
              ' ' +
              Math.round(e.getBoundingClientRect().width)
          )
          .join(' | ')
    );
  check(
    !!(await until(fits, 3000)),
    'nothing clipped: composer ' +
      holder?.scrollHeight +
      '/' +
      holder?.clientHeight +
      ', body ' +
      cdoc.body.scrollHeight +
      '/' +
      cwin.innerHeight +
      ' × ' +
      cdoc.body.scrollWidth +
      '/' +
      cwin.innerWidth
  );
  check(
    ['.composebox', '.hints'].every(s => shown(holder.querySelector(s))),
    'box and hints are in the window (the activity line is hidden in the purple design, 07)'
  );
  const pad = cwin.getComputedStyle(holder),
    br = box.getBoundingClientRect(),
    hr = holder.getBoundingClientRect();
  check(
    parseFloat(pad.paddingTop) >= 12 &&
      parseFloat(pad.paddingLeft) >= 14 &&
      parseFloat(pad.paddingRight) >= 14 &&
      br.left - hr.left >= 14 &&
      hr.right - br.right >= 14,
    'padding around the composer (' +
      [pad.paddingTop, pad.paddingRight, pad.paddingBottom, pad.paddingLeft].join(' ') +
      ')'
  );
  check(cwin.innerWidth >= 560, 'window wide enough (' + cwin.innerWidth + ' CSS px)');
  {
    let why = '';
    check(
      !!(await until(() => !(why = layoutProblem(cwin)), 3000)),
      'no sideways overflow, bottom-row controls side by side (' +
        (why || cwin.innerWidth + ' CSS px') +
        ')'
    );
  }
  await main('shot', 'composer-popout-window');

  // ---- Real typing + Enter sends to the selected pane (A).
  prompt.focus();
  await main(
    'type',
    windows ? "Write-Output ('pop' + 'out-' + (6*7))" : 'echo "pop""out-$((6*7))"',
    true
  );
  check(
    !!(await until(async () => (await buffer(A)).includes('popout-42'), 8000)),
    'typed in the pop-out + Enter → ran in the selected PowerShell pane'
  );
  check(prompt.value === '', 'prompt cleared after sending');
  check(!(await buffer(B)).includes('popout-42'), 'the other pane did not get it');

  // ---- The Send button (real click in the pop-out), to the newly selected pane B.
  window.TnaiLiveTasks.setTarget(B);
  prompt.focus();
  await main(
    'type',
    windows ? "Write-Output ('send' + 'btn-' + (7*8))" : 'echo "send""btn-$((7*8))"',
    false
  );
  const sr = cdoc.getElementById('send').getBoundingClientRect();
  await main('click', sr.left + sr.width / 2, sr.top + sr.height / 2);
  check(
    !!(await until(async () => (await buffer(B)).includes('sendbtn-56'), 8000)),
    'real click on Send in the pop-out → ran in the newly selected pane'
  );

  // ---- ＋ menu renders in the pop-out window, not behind it in Technically Not's.
  cdoc.getElementById('attachFiles').click();
  await wait(150);
  const menu = cdoc.querySelector('.tnai-attach-menu'),
    mr = menu?.getBoundingClientRect();
  check(
    !!menu && !document.querySelector('.tnai-attach-menu'),
    '＋ menu opened in the pop-out document'
  );
  await until(() => {
    const m = cdoc.querySelector('.tnai-attach-menu')?.getBoundingClientRect();
    return (
      m &&
      m.bottom <= cwin.innerHeight - 2 &&
      m.height >= cdoc.querySelector('.tnai-attach-menu').scrollHeight - 1
    );
  }, 3000);
  const mr2 = menu?.getBoundingClientRect(),
    plusR = cdoc.getElementById('attachFiles').getBoundingClientRect();
  check(
    !!mr2 &&
      (mr2.bottom <= plusR.top || mr2.top >= plusR.bottom) &&
      menu.scrollHeight <= menu.clientHeight + 1,
    'window grew so the whole menu shows without covering the ＋ (' +
      Math.round(mr2?.top) +
      '–' +
      Math.round(mr2?.bottom) +
      ', ＋ ' +
      Math.round(plusR.top) +
      '–' +
      Math.round(plusR.bottom) +
      ', window ' +
      cwin.innerHeight +
      ')'
  );
  check(
    !!mr2 &&
      mr2.top >= 0 &&
      mr.left >= 0 &&
      mr.bottom <= cwin.innerHeight + 1 &&
      mr.right <= cwin.innerWidth + 1 &&
      mr.height > 30,
    'menu inside the pop-out window (' +
      (mr2 && [
        Math.round(mr2.left),
        Math.round(mr2.top),
        Math.round(mr2.width),
        Math.round(mr2.height),
      ]) +
      ' in ' +
      cwin.innerWidth +
      '×' +
      cwin.innerHeight +
      ')'
  );
  await main('shot', 'composer-popout-window-menu');
  cdoc.dispatchEvent(new cwin.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!cdoc.querySelector('.tnai-attach-menu'), 'Esc in the pop-out closes the menu');

  // ---- Paste an image: attachment chip in the pop-out.
  const dt = new cwin.DataTransfer();
  dt.items.add(
    new cwin.File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'image.png', { type: 'image/png' })
  );
  prompt.dispatchEvent(
    new cwin.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  );
  await wait(100);
  check(
    window.TnaiAttachments.count() === 1 && !!cdoc.querySelector('.attachment-chip'),
    'pasted screenshot → attachment chip in the pop-out'
  );
  cdoc.querySelector('.attachment-remove').click();
  check(window.TnaiAttachments.count() === 0, 'chip × removes it');

  // ---- Another page shown (All threads): the pop-out still sends.
  await window.TnaiTest.openAllThreads();
  await wait(300);
  window.TnaiLiveTasks.setTarget(A);
  prompt.focus();
  await main(
    'type',
    windows ? "Write-Output ('term' + 'page-' + (3*11))" : 'echo "term""page-$((3*11))"',
    true
  );
  check(
    !!(await until(async () => (await buffer(A)).includes('termpage-33'), 8000)),
    'sent while Technically Not shows the All threads page'
  );
  window.TnaiThreads.open();
  await wait(200);

  // ---- On top, move/resize, close → docked exactly where it was.
  cdoc.querySelector('.acp-head input[type=checkbox]').click();
  check(
    !!(await until(async () => (await main('info'))[0]?.onTop === true, 3000)),
    'On top keeps the OS window above others'
  );
  const target = { x: 140, y: 160, width: 640, height: 200 };
  const set = await main('setBounds', target);
  cwin.dispatchEvent(new cwin.Event('resize'));
  log.push('info bounds set ' + JSON.stringify(set));
  await main('close');
  check(
    !!(await until(async () => (await main('count')) === 1 && !pop.isOut(), 5000)),
    'closing the window docks the composer'
  );
  check(
    box.ownerDocument === document && box.parentNode === parent && box.nextSibling === next,
    'box back exactly where it was'
  );
  check(
    !document.querySelector('.tnai-composer-away')?.isConnected &&
      !document.querySelector('.app').classList.contains('tnai-composer-out'),
    'chip gone, composer row restored'
  );
  await wait(200);
  check(
    Math.abs(composer.getBoundingClientRect().height - rowBefore) < 1,
    'composer row height restored'
  );
  prompt.value = windows ? "Write-Output ('dock' + 'ed-' + (5*5))" : 'echo "dock""ed-$((5*5))"';
  document.getElementById('send').click();
  check(
    !!(await until(async () => (await buffer(A)).includes('docked-25'), 8000)),
    'docked composer sends again'
  );

  // ---- Bounds + On top remembered.
  check(
    pop.popOut() && !!(await until(async () => (await main('count')) === 2, 5000)),
    'popped out again'
  );
  const [again] = await main('info');
  log.push('info bounds reopened ' + JSON.stringify(again?.bounds));
  const b = again?.bounds || {};
  check(
    Math.abs(b.x - set.x) <= 2 && Math.abs(b.y - set.y) <= 2 && Math.abs(b.width - set.width) <= 2,
    'window position and width remembered'
  );
  {
    const w2 = pop.window(),
      d2 = w2.document,
      used = [...d2.body.children].reduce((n, el) => n + el.getBoundingClientRect().height, 0);
    check(
      !!(await until(
        () =>
          Math.abs(
            w2.innerHeight - [...d2.body.children].reduce((n, el) => n + el.scrollHeight, 0)
          ) <= 3,
        3000
      )),
      'height is the content height, no dead space (' +
        w2.innerHeight +
        ' vs ' +
        Math.round(used) +
        ')'
    );
  }
  {
    await main('setBounds', { ...set, height: 900 });
    const w2 = pop.window();
    w2.dispatchEvent(new w2.Event('resize'));
    check(
      !!(await until(() => w2.innerHeight < 400, 3000)),
      'window cannot be stretched taller than its content (' + w2.innerHeight + ')'
    );
  }
  check(
    again?.onTop === true && pop.window().document.querySelector('.acp-head input').checked,
    'On top remembered'
  );
  await shot('composer-popout-main');

  // ---- Remembered bounds smaller than the content never restore it squished.
  pop.window().document.querySelector('.acp-head button').click();
  await until(async () => (await main('count')) === 1, 5000);
  localStorage.setItem(
    'tnai.composer-popout.v1',
    JSON.stringify({ ...pop.bounds(), w: 300, h: 90 })
  );
  pop.popOut();
  await until(async () => (await main('count')) === 2, 5000);
  {
    const w2 = pop.window(),
      d2 = w2.document,
      h2 = d2.querySelector('body>.composer');
    check(
      !!(await until(
        () =>
          h2.scrollHeight <= h2.clientHeight + 1 &&
          d2.body.scrollHeight <= w2.innerHeight + 1 &&
          w2.innerWidth >= 560,
        3000
      )),
      'tiny remembered bounds still open at the content size (' +
        w2.innerWidth +
        '×' +
        w2.innerHeight +
        ')'
    );
  }

  // ---- Remembered at the old 560 px minimum (build 24 opened there): the window widens to the
  // whole composer, light and dark.
  for (const theme of ['light', 'dark']) {
    pop.window().document.querySelector('.acp-head button').click();
    await until(async () => (await main('count')) === 1, 5000);
    window.TnaiTheme?.set?.(theme);
    await wait(200);
    localStorage.setItem('tnai.composer-popout.v1', JSON.stringify({ ...pop.bounds(), w: 560 }));
    pop.popOut();
    await until(async () => (await main('count')) === 2, 5000);
    const w2 = pop.window();
    let why = '';
    check(
      !!(await until(() => !(why = layoutProblem(w2)), 3000)),
      theme +
        ': remembered 560 px → no sideways overflow, controls side by side (' +
        (why || w2.innerWidth + '×' + w2.innerHeight + ' CSS px') +
        ')'
    );
    await wait(300);
    await main('shot', 'composer-popout-560-' + theme);
  }
  window.TnaiTheme?.set?.('light');

  // ---- Dock button in the window; Bring back chip in Technically Not.
  pop.window().document.querySelector('.acp-head button').click();
  check(
    !!(await until(async () => (await main('count')) === 1 && !pop.isOut(), 5000)) &&
      box.parentNode === parent,
    'Dock button docks it'
  );
  pop.popOut();
  await until(async () => (await main('count')) === 2, 5000);
  document.querySelector('.tnai-composer-away button.primary').click();
  check(
    !!(await until(async () => (await main('count')) === 1 && !pop.isOut(), 5000)) &&
      box.parentNode === parent &&
      document.activeElement === prompt,
    'Bring back docks it and focuses the prompt'
  );

  // ---- A frame inside Technically Not (like a Live preview page) can't open a pop-out under a
  // tnai-panel-* name (desktop/main.js opener check).
  {
    const f = document.createElement('iframe');
    f.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'
    );
    f.style.display = 'none'; // Live preview's own sandbox (31)
    let said = '';
    const hear = e => {
      if (e.source === f.contentWindow) said = String(e.data);
    };
    addEventListener('message', hear);
    f.src = await main('spoofPage');
    document.body.appendChild(f);
    await until(() => said, 3000);
    await wait(800);
    removeEventListener('message', hear);
    log.push('info spoof open returned ' + said);
    check((await main('count')) === 1, 'a frame asking for a tnai-panel-* window gets none');
    f.remove();
  }
} catch (error) {
  check(false, 'test threw: ' + error.stack);
}

// failures last (the runner shows the tail)
log.push(...log.filter(l => l.startsWith('FAIL')).map(l => 'SUMMARY ' + l));
try {
  await main('report', log);
} catch {}
return { ok, log };
