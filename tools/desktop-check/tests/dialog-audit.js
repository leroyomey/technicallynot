// Technically Not tools · desktop-check/tests/dialog-audit.js — Opens every popup dialog that can
// be triggered safely and checks it is roomy enough: inside the window, no horizontal overflow, no
// clipped text (scrollHeight vs clientHeight on elements that don't scroll), action buttons on one
// line at the shared height (24/30). Runs at the default size, at the app's minimum window
// (768×680) and at the website demo sizes (1180×760, 1024×683 at zoom 1), with screenshots in light
// and dark. Also sizes the desktop prompt() window (dialog-audit.main.js). Only opens and cancels
// dialogs: no sign-in starts, no update installs, no prompt goes to any agent; git runs only in the
// test's temp project.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
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
const HEIGHTS = [24, 30];
const esc = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const LONG_PATH =
  'C:\\Users\\someone\\OneDrive\\Desktop\\Projects\\a-very-long-project-folder-name-without-spaces\\src\\components\\SettingsPanel.tsx';

// Measures one open dialog. `box` is the dialog surface; `scroller` (default: box) may scroll
// vertically.
function audit(name, box) {
  if (!box || !box.getClientRects().length) {
    check(false, name + ': dialog did not open');
    return;
  }
  const r = box.getBoundingClientRect(),
    problems = [];
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
    problems.push(
      'outside the window (' +
        [r.left, r.top, r.right, r.bottom].map(Math.round) +
        ' in ' +
        innerWidth +
        '×' +
        innerHeight +
        ')'
    );
  if (box.scrollWidth > box.clientWidth + 1)
    problems.push('scrolls sideways (' + box.scrollWidth + ' > ' + box.clientWidth + ')');
  for (const el of box.querySelectorAll('*')) {
    if (
      !el.getClientRects().length ||
      el.closest('[hidden]') ||
      /^(INPUT|TEXTAREA|SELECT|OPTION|svg|path|BR)$/i.test(el.tagName) ||
      el.closest('svg')
    )
      continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    const label =
      el.tagName.toLowerCase() +
      (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/)[0]
        : '') +
      ' "' +
      (el.textContent || '').trim().slice(0, 30) +
      '"';
    if (
      !/auto|scroll/.test(cs.overflowX) &&
      cs.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 1
    )
      problems.push(
        'text cut sideways: ' + label + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')'
      );
    if (!/auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)
      problems.push(
        'text cut/overflowing: ' + label + ' (' + el.scrollHeight + ' > ' + el.clientHeight + ')'
      );
  }

  // Link-style text buttons (no box) size like text.
  const buttons = [...box.querySelectorAll('button')].filter(
    b => b.getClientRects().length && !b.closest('[hidden]')
  );
  for (const b of buttons) {
    const br = b.getBoundingClientRect(),
      h = Math.round(br.height),
      wide = br.width > 260;

    // Full-width choice buttons (sign-in providers, "open in…" choices) may be taller; everything
    // else sits on the scale.
    if (!wide && !HEIGHTS.includes(h))
      problems.push(
        'button off the scale: "' + b.textContent.trim().slice(0, 24) + '" ' + h + 'px'
      );
    if (wide && h < 30)
      problems.push(
        'choice button too short: "' + b.textContent.trim().slice(0, 24) + '" ' + h + 'px'
      );
  }
  const scrolls = box.scrollHeight > box.clientHeight + 1 ? ' (body scrolls inside)' : '';
  check(
    !problems.length,
    name +
      ': ' +
      Math.round(r.width) +
      '×' +
      Math.round(r.height) +
      ' in ' +
      innerWidth +
      '×' +
      innerHeight +
      scrolls +
      (problems.length ? ' — ' + problems.slice(0, 4).join('; ') : '')
  );
}

async function allDialogs(tag, shots) {
  // Shortcut overlay.
  window.TnaiShortcuts?.open();
  await wait(200);
  audit(tag + ' shortcuts', document.querySelector('.tnai-keys'));
  window.TnaiShortcuts?.close();
  await wait(100);

  // Technically Not sign-in dialog (opened only; no provider flow starts).
  window.TnaiAuth?.open('signin');
  await wait(250);
  audit(
    tag + ' Technically Not sign-in',
    document.querySelector('.tnai-auth-overlay:not([hidden]) .tnai-auth-modal')
  );
  if (shots) await shot('dialog-auth-' + tag);
  document.querySelector('.tnai-auth-overlay:not([hidden]) .tnai-auth-x')?.click();
  esc();
  await wait(150);

  // Agent CLI sign-in dialog (opened and cancelled only).
  const A = window.TnaiAccounts;
  if (A) {
    await until(() => A.list().length, 20000);
    for (const [cli, opts] of [
      ['Claude Code', { adding: true }],
      ['Codex', { accountId: '' }],
    ]) {
      A.openSignIn(cli, opts);
      await wait(250);
      audit(
        tag + ' ' + cli + ' sign-in',
        document.querySelector('.tnai-signin-overlay:not([hidden]) .tnai-signin-modal')
      );
      if (shots && cli === 'Claude Code') await shot('dialog-signin-' + tag);
      document.querySelector('.tnai-signin-overlay:not([hidden]) .tnai-ws-close-cancel')?.click();
      await wait(150);
    }
  }

  // Update restart dialog with long release notes (Cancel only; the confirm button is never
  // clicked).
  const U = window.TnaiUpdates;
  if (U) {
    const s = U.state(),
      saved = { next: s.next, notes: s.notes };
    s.next = '0.9.9';
    s.notes = Array.from(
      { length: 30 },
      (_, i) => '• Change ' + (i + 1) + ': improved something useful in the app, see ' + LONG_PATH
    ).join('\n');
    U.confirmRestart();
    await wait(250);
    audit(
      tag + ' update restart',
      document.querySelector('.tnai-update-overlay .tnai-ws-close-modal')
    );
    if (shots) await shot('dialog-update-' + tag);
    document.querySelector('.tnai-update-overlay .tnai-ws-close-cancel')?.click();
    await wait(100);
    Object.assign(s, saved);
  }

  // Closing a thread whose shell runs asks first, over the thread ("Close thread" in the thread's
  // menu, 137), here with a long name. Answered Cancel.
  const openThread = window.TnaiAgents.sessions().find(session => session.running)?.paneId;
  const island = window.TnaiThreads.slot('main');
  window.TnaiThreads.show(openThread);
  await wait(250);
  window.TnaiLiveTasks.close(openThread, island);
  await wait(250);
  audit(tag + ' close thread', island.querySelector(':scope > .tnai-panel-confirm > section'));
  if (shots) await shot('dialog-close-' + tag);
  island.querySelector(':scope > .tnai-panel-confirm .tnai-ws-close-cancel')?.click();
  await wait(150);

  // Source control in-page confirmation (worktree merge/remove and push use the same TnaiGit.ask),
  // answered Cancel.
  const G = window.TnaiGit;
  if (G) {
    document.querySelector('.side-item[data-view="changes"]').click();
    await wait(400);
    const asked = G.ask(
      'Remove the worktree at ' +
        LONG_PATH +
        '? Its branch is kept; uncommitted changes in it are lost.',
      'Remove worktree'
    );
    await wait(200);
    const row = document.querySelector('.gp-ask');
    audit(tag + ' git confirm', row?.parentElement);
    row?.querySelector('button:not(.primary)')?.click();
    await asked;
  }
  window.TnaiThreads.open();
  await wait(200);
}

try {
  // A running shell with a long name, so closing its thread asks first (and the restart dialog
  // counts it).
  const agents = window.TnaiAgents;
  await agents.detect(true);
  const started = await window.TnaiTest.startThread({
    tool: 'Terminal',
    name: 'Client portal redesign and payments migration thread',
    show: true,
  });
  check(!!started.session?.running, 'setup: a PowerShell thread is running');

  // (Source control's page and its git confirm were removed with the Changes page in the purple
  // redesign.)

  log.push('--- default window');
  await allDialogs('default', true);
  window.TnaiTheme?.set('dark');
  await wait(300);
  log.push('--- dark theme');
  await allDialogs('dark', true);
  window.TnaiTheme?.set('light');
  await wait(200);

  const size = await main('size', 768, 680);
  await wait(400); // the window minimum (desktop/main.js)
  log.push(
    '--- minimum window ' + size.join('×') + ' (CSS ' + innerWidth + '×' + innerHeight + ')'
  );
  await allDialogs('small', true);

  // The website's homepage demo: the real app laid out at 1180×760 (and a 1024×683 laptop window)
  // at zoom ×1, then scaled down.
  for (const [w, h] of [
    [1180, 760],
    [1024, 683],
  ]) {
    await main('size', w, h, 1);
    await wait(400);
    log.push(
      '--- demo window ' + w + '×' + h + ' at zoom 1 (CSS ' + innerWidth + '×' + innerHeight + ')'
    );
    await allDialogs('demo-' + w, true);
  }

  // Desktop prompt() window: short and long messages.
  for (const [label, message] of [
    ['short', 'Name the new workspace'],
    [
      'long',
      'Name the new workspace. ' +
        'It is created in ' +
        LONG_PATH +
        ' and keeps its own panels, layout and lead agent. '.repeat(6),
    ],
  ]) {
    const p = await main('prompt', message);
    const problems = [];
    if (p.scrollHeight > p.innerHeight + 1 && !p.scrolls)
      problems.push(
        'content taller than the window (' + p.scrollHeight + ' > ' + p.innerHeight + ')'
      );
    if (p.scrollWidth > p.innerWidth + 1) problems.push('scrolls sideways');
    if (p.pClipped) problems.push('message cut');
    if (p.contentWidth < 420) problems.push('narrower than 420');
    if (p.buttons.some(b => b.h !== 30 || !b.fits))
      problems.push('buttons ' + JSON.stringify(p.buttons));
    if (p.buttons.some(b => b.bottom > p.innerHeight)) problems.push('buttons below the window');
    check(
      !problems.length,
      'prompt window (' +
        label +
        '): content ' +
        p.contentWidth +
        '×' +
        p.contentHeight +
        ', page ' +
        p.scrollHeight +
        (problems.length ? ' — ' + problems.join('; ') : '')
    );
  }

  // Folder-trust confirm window (main.js before a sub-agent starts): same sizing; Enter = Trust
  // folder (true), Escape = Don't allow (false).
  for (const key of ['Enter', 'Escape']) {
    const c = await main(
      'confirm',
      `Codex hasn't been allowed to work in "sample-project" yet. A sub-agent started by Nova needs it.\n\nTrust this folder for Codex? Codex can then read, edit and run files here.`,
      key
    );
    const problems = [];
    if (c.scrollHeight > c.innerHeight + 1 && !c.scrolls)
      problems.push('content taller than the window');
    if (c.scrollWidth > c.innerWidth + 1) problems.push('scrolls sideways');
    if (c.pClipped) problems.push('message cut');
    if (
      c.buttons.map(b => b.text).join('|') !== "Don't allow|Trust folder" ||
      c.buttons.some(b => b.h !== 30 || !b.fits || b.bottom > c.innerHeight)
    )
      problems.push('buttons ' + JSON.stringify(c.buttons));
    if (c.focused !== 'Trust folder') problems.push('focus on ' + c.focused);
    if (c.result !== (key === 'Enter')) problems.push(key + ' answered ' + c.result);
    check(
      !problems.length,
      'confirm window, ' +
        key +
        ' → ' +
        c.result +
        ': content ' +
        c.contentWidth +
        '×' +
        c.contentHeight +
        (problems.length ? ' — ' + problems.join('; ') : '')
    );
  }

  // The run stayed quiet: the app asked to show four windows of its own (two prompts, two
  // confirms); they are modal, so the test kept them hidden, and none became the active one.
  const quiet = await main('quiet');
  check(
    quiet.asked.show >= 4 &&
      quiet.keptHidden === 4 &&
      !quiet.active &&
      !quiet.focusable &&
      !quiet.onMain,
    'quiet run: the prompt and confirm windows were measured hidden, none took the keyboard (' +
      JSON.stringify(quiet) +
      ')'
  );
} catch (error) {
  check(false, 'threw: ' + error.message);
}
return { ok, log };
