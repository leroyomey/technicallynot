// Technically Not tools · desktop-check/tests/thread-glass.js — every panel is see-through the way
// a card on the Settings page is, in the real app with a throwaway profile and one real
// PowerShell thread. Walked in Dark and in Light at 1440 x 900 and at the smallest window.
// The reference is read from the page, never written here: the fill of a Settings card. Each
// island of the thread layout must have that same fill, a surface with a terminal in it must show
// no block of another tone where the terminal's screen lies, and what floats over the page (the
// menu, a popover, a dialog) must have the denser fill of the floating token.
// Its notes list, for every page, each large surface that is still solid.
// Pictures: glass-<look>-<size>-<state>. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = text => log.push('     ' + text);
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

// A call into this test's main-process half: the window size, the colors along a line.
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
const layout = document.querySelector('.layout'),
  threads = window.TnaiThreads,
  agents = window.TnaiAgents;
const box = el => el.getBoundingClientRect();
const shown = el =>
  !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const shot = async name => {
  await (window.TnaiTest?.shot?.(name) ?? wait(650));
};
const nameOf = el => {
  if (!el) return 'nothing';
  const id = el.id ? '#' + el.id : '';
  const cls = [...el.classList].slice(0, 2).join('.');
  return el.tagName.toLowerCase() + id + (cls ? '.' + cls : '');
};

// ---------- colors ----------
const fillOf = el => getComputedStyle(el).backgroundColor;
const alphaOf = fill => {
  const inside = /rgba?\(([^)]+)\)/.exec(fill);
  if (!inside) return 0;
  const values = inside[1].split(',');
  return values[3] === undefined ? 1 : +values[3];
};
const parts = packed => [packed >> 16, (packed >> 8) & 255, packed & 255];
const step = (a, b) => {
  const one = parts(a),
    two = parts(b);
  return Math.max(Math.abs(one[0] - two[0]), Math.abs(one[1] - two[1]), Math.abs(one[2] - two[2]));
};
const hexOf = packed => '#' + packed.toString(16).padStart(6, '0');

// The color the window shows at some points of the page, read from a capture of the window.
async function colorsAt(points) {
  const read = await main(
    'lines',
    innerWidth,
    innerHeight,
    points.map(point => Math.round(point[0])),
    []
  );
  return points.map((point, i) => read.columns[i][Math.round(point[1])]);
}

// A token's value as the page resolves it for a fill.
function tokenFill(name) {
  const probe = document.createElement('i');
  probe.style.cssText =
    'position:fixed;left:-9px;width:1px;height:1px;background:var(' + name + ')';
  document.body.append(probe);
  const fill = fillOf(probe);
  probe.remove();
  return fill;
}

// Large surfaces with a round edge whose fill hides what lies behind them.
const CONTROL = 'button, input, textarea, select, a, kbd, svg, img, canvas, iframe, webview';

function solidSurfaces() {
  const found = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest(CONTROL)) continue;
    const size = box(el);
    if (size.width < 160 || size.height < 40 || size.bottom < 0 || size.top > innerHeight) continue;
    const style = getComputedStyle(el);
    if (!(parseFloat(style.borderTopLeftRadius) > 0)) continue;
    if (alphaOf(style.backgroundColor) < 0.5) continue;
    found.push(nameOf(el) + ' ' + style.backgroundColor.replace(/\s/g, ''));
  }
  return [...new Set(found)];
}

// ---------- the pages ----------
const menuButton = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const openMenu = async () => {
  if (!shown(menu())) menuButton().click();
  return until(() => (shown(menu()) ? menu() : null), 3000);
};
const pressRow = async name => {
  await openMenu();
  const row = [...menu().querySelectorAll('.tnt-menu-row')].find(
    one => one.querySelector('span').textContent.trim() === name
  );
  row?.click();
  await wait(500);
};
const settled = async () => {
  await wait(700);
  await until(() => !document.documentElement.matches('.vt-fold, .vt-page'), 5000);
  await wait(150);
};
const toThreads = async () => {
  threads.open();
  await until(() => threads.visible(), 3000);
  await settled();
};

// The islands of the Threads page, by name.
const islands = () => ({
  'the thread list': threads.slot('list'),
  'the open thread': threads.slot('main'),
  'the prompt box under it': layout.querySelector(':scope > footer.composer'),
});

// A card reads as a card: the color the window shows inside it against the ground just beside
// it, both read from a capture. In Light the two must differ by at least LIGHT_STEP levels in
// one channel (they were 10 to 14 apart when a card could not be told from the ground).
const LIGHT_STEP = 17;

async function cardOnGround(label, card, look) {
  const b = box(card);
  const y = b.top + b.height / 2;
  const [inside, beside] = await colorsAt([
    [b.right - 3, y],
    [Math.min(innerWidth - 2, b.right + 5), y],
  ]);
  const apart = step(inside, beside);
  if (look === 'light')
    check(
      apart >= LIGHT_STEP,
      label +
        ': a card reads as a card on the ground (card ' +
        hexOf(inside) +
        ', ground ' +
        hexOf(beside) +
        ', ' +
        apart +
        ' levels apart, at least ' +
        LIGHT_STEP +
        ')'
    );
  else
    note(
      label +
        ': card ' +
        hexOf(inside) +
        ', ground ' +
        hexOf(beside) +
        ', ' +
        apart +
        ' levels apart'
    );
}

// Parts of a settings page filled with black laid over what is under them: a well made for the
// dark ground, which on off-white is a gray block with hard edges.
function darkWells() {
  const found = [];
  for (const el of document.querySelectorAll('#settingsPage *')) {
    if (!shown(el) || el.closest(CONTROL)) continue;
    const size = box(el);
    if (size.width < 60 || size.height < 16) continue;
    const style = getComputedStyle(el);
    const black = /rgba\(0, 0, 0, 0?\.(\d+)\)/.exec(
      style.backgroundColor + ' ' + style.backgroundImage
    );
    if (black && +('0.' + black[1]) >= 0.05) found.push(nameOf(el) + ' ' + black[0]);
  }
  return [...new Set(found)];
}

// The other settings pages: Accounts, and each part of Agents.
async function settingsParts(look, tag, pic) {
  const seen = async (name, shotName) => {
    await settled();
    const wells = darkWells();
    if (look === 'light')
      check(
        !wells.length,
        tag + name + ': no part is a dark well' + (wells.length ? ': ' + wells.join('; ') : '')
      );
    else note(tag + name + ', wells of black: ' + (wells.join('; ') || 'none'));

    // On Agents a card's rows carry the surface, not the card itself: measure the first of them.
    const surface = [
      ...document.querySelectorAll(
        '#settingsPage .settings-panel:not([hidden]) :is(.set-card, .set-card > *, .ac-tool, .sa-agent)'
      ),
    ]
      .filter(one => shown(one) && alphaOf(fillOf(one)) > 0 && box(one).width > 300)
      .find(one => box(one).top > 60 && box(one).bottom < innerHeight);
    if (surface) await cardOnGround(tag + name, surface, look);
    else note(tag + name + ': no card lies whole in the window to measure');
    await pic(shotName);
  };
  window.TnaiSettings.open('accounts');
  await seen('Settings › Accounts', 'settings-accounts');

  // An account, its usage bars and the "Add account" rows lie on their tool's card with no fill
  // of their own (in Light they once got a well each: square gray blocks on the card).
  const accountParts = [
    ...document.querySelectorAll(
      '#tnaiAccountsMount :is(.ac-acct, .tnai-acct-gauge, .ac-accts .tnai-acct-addrow)'
    ),
  ].filter(shown);
  const filled = accountParts.filter(
    one => alphaOf(fillOf(one)) > 0 || getComputedStyle(one).backgroundImage !== 'none'
  );
  check(
    !filled.length,
    tag +
      'Settings › Accounts: none of the ' +
      accountParts.length +
      ' account parts on a tool card has a fill of its own' +
      (filled.length ? ': ' + [...new Set(filled.map(nameOf))].join('; ') : '')
  );
  window.TnaiSettings.open('agents');
  await settled();
  const parts = [...document.querySelectorAll('#settingsPanel-agents .sa-nav [role="tab"]')];
  for (const part of parts) {
    part.click();
    const name = part.querySelector('b').textContent.trim();
    await seen('Settings › Agents › ' + name, 'settings-agents-' + (parts.indexOf(part) + 1));
    if (name !== 'Context') continue;

    // The rows under "Show context size warnings" look as the rows under "Suggest compacting"
    // do: the same fill, whatever box another script wrapped them in.
    const compacting = document.querySelector('#settingsPanel-agents .u-nums');
    const warnings = document.querySelector('#settingsPanel-agents .cw-nums');
    warnings?.scrollIntoView({ block: 'center' });
    await wait(300);
    check(
      !!compacting &&
        !!warnings &&
        fillOf(warnings.parentElement) === fillOf(compacting) &&
        alphaOf(fillOf(warnings)) === 0,
      tag +
        'Settings › Agents › Context: the Size warnings rows have the fill of the Compacting rows (Compacting ' +
        (compacting ? fillOf(compacting) : 'missing') +
        ', the box around the Size warnings rows ' +
        (warnings ? fillOf(warnings.parentElement) : 'missing') +
        ', the rows themselves ' +
        (warnings ? fillOf(warnings) : 'missing') +
        ')'
    );
    await pic('settings-agents-context-warnings');
  }
}

// The computer of the first thread row, saved enlarged.
async function faceCrop(name) {
  const face = [...document.querySelectorAll('.tnt-th .tnt-face')].find(shown);
  if (!face) return note(name + ': no thread row with a computer is shown');
  const b = box(face);
  await main(
    'crop',
    'glass-' + name,
    innerWidth,
    b.left - 6,
    b.top - 6,
    b.width + 12,
    b.height + 12
  );
  const eyes = getComputedStyle(face.querySelector('.tnt-face-eyes')).filter;
  note(name + ': the computer is ' + face.dataset.face + ', its eyes drawn with ' + eyes);
  if (/asleep/.test(face.dataset.face))
    check(
      /invert\(1\)/.test(eyes),
      name + ': the closed eyes of a computer that is asleep are in a pale ink (' + eyes + ')'
    );
}

async function walk(look, size) {
  const tag = look + ' ' + size + ': ';
  const pic = state => shot('glass-' + look + '-' + size + '-' + state);

  // The reference: a card of Settings › General, as it is drawn.
  await pressRow('Settings');
  await until(
    () =>
      layout.classList.contains('settings-mode') &&
      shown(document.getElementById('settingsPanel-general')),
    4000
  );
  await settled();
  const card = [...document.querySelectorAll('#settingsPanel-general .set-card')].find(shown);
  const cardFill = card ? fillOf(card) : '';
  check(
    !!card && cardFill === tokenFill('--pg-panel') && alphaOf(cardFill) < 0.8,
    tag + 'a Settings card is see-through, the fill of --pg-panel (' + cardFill + ')'
  );
  check(
    cardFill === tokenFill('--tnt-glass'),
    tag + 'the island token --tnt-glass is that same fill (' + tokenFill('--tnt-glass') + ')'
  );
  await pic('settings');
  await cardOnGround(tag + 'Settings › General', card, look);
  if (size === '1440') await settingsParts(look, tag, pic);

  // Threads: every island has the card's fill. The thread here is a PowerShell panel, which has
  // no Readable view, so the open thread shows its terminal, and an island that shows a terminal
  // has the terminal's own flat color. With the terminal taken out of view for a moment (what
  // the Readable view does) the same island must be see-through. The Readable view's pictures
  // are the thread-readable test's.
  await toThreads();
  const flat = tokenFill('--tnt-island');
  const termPart = threads.slot('main').querySelector('.tnt-term');
  const withTerminal = Object.entries(islands()).map(([name, island]) => [name, fillOf(island)]);
  termPart.hidden = true;
  for (const [name, island] of Object.entries(islands()))
    check(
      !!island && (!shown(island) || fillOf(island) === cardFill),
      tag + name + ' has the Settings card fill (' + (island ? fillOf(island) : 'missing') + ')'
    );
  termPart.hidden = false;
  check(
    withTerminal[0][1] === cardFill && withTerminal[1][1] === flat && withTerminal[2][1] === flat,
    tag +
      'while the thread shows its terminal, its island and the prompt box are the terminal color ' +
      flat +
      ' and the list stays see-through (' +
      withTerminal.map(one => one.join(' ')).join('; ') +
      ')'
  );
  window.TnaiThreadSide.open();
  await until(() => window.TnaiThreadSide.state().shown, 3000);
  await settled();
  const side = threads.slot('side');
  check(
    shown(side) && fillOf(side) === cardFill,
    tag + 'the side column has the Settings card fill (' + (side ? fillOf(side) : 'missing') + ')'
  );
  note(tag + 'Threads, still solid: ' + (solidSurfaces().join('; ') || 'none'));
  window.TnaiThreadSide.close();
  await settled();

  // Where the terminal's screen lies the island shows no block of another tone. Read from the
  // window: a point of the screen and a point of the island's top row, both free of text, both
  // over the same stretch of ground.
  const host = await until(() => {
    const el = threads.slot('main').querySelector('.tnt-term-host');
    return shown(el) ? el : null;
  }, 5000);
  if (!host) check(false, tag + 'the thread shows its terminal');
  else {
    const screen = box(host),
      island = box(threads.slot('main'));
    const [inScreen, inIsland] = await colorsAt([
      [screen.right - 6, screen.top + 3],
      [screen.right - 6, island.top + 5],
    ]);
    check(
      step(inScreen, inIsland) <= 3,
      tag +
        'the terminal of a thread is no block of another tone on its island (screen ' +
        hexOf(inScreen) +
        ', the island beside it ' +
        hexOf(inIsland) +
        ', island fill ' +
        fillOf(threads.slot('main')) +
        ')'
    );
  }
  await pic('threads-terminal');

  // What floats over the page keeps a denser fill, so it reads over a conversation or a terminal.
  const over = tokenFill('--tnt-over');
  const floating = async (name, open, find, close) => {
    await open();
    const el = await until(() => (shown(find()) ? find() : null), 3000);
    await wait(350);
    check(
      !!el && fillOf(el) === over,
      tag + name + ' has the floating fill ' + over + ' (' + (el ? fillOf(el) : 'not opened') + ')'
    );
    if (el) {
      const blur = getComputedStyle(el).backdropFilter;
      check(/blur/.test(blur), tag + name + ' blurs what lies behind it (' + blur + ')');
      await pic(name.replace(/^the /, '').replace(/\W+/g, '-'));
    }
    await close();
    await wait(250);
  };
  await floating('the menu', openMenu, menu, () => window.TnaiThreadMenu.close());
  const chip = document.querySelector('.top .project');
  await floating(
    'the project menu',
    () => chip.click(),
    () => document.querySelector('.top .repo-project-menu'),
    () => chip.click()
  );
  const bell = document.querySelector('.top .tnai-bell');
  await floating(
    'the bell panel',
    () => bell.click(),
    () => document.querySelector('.tnai-bell-pop'),
    () => bell.getAttribute('aria-expanded') === 'true' && bell.click()
  );
  await floating(
    'the shortcuts dialog',
    () => window.TnaiShortcuts.open(),
    () => document.querySelector('.tnai-keys'),
    () => window.TnaiShortcuts.close()
  );

  // All threads (its route is 'terminal'), and the other pages of the menu: what is still solid
  // there.
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode'), 3000);
  await settled();
  note(tag + 'All threads, still solid: ' + (solidSurfaces().join('; ') || 'none'));
  await pic('all-threads');
  if (look === 'dark' && size === '1440')
    for (const [row, mode] of [
      ['Live preview', 'preview-mode'],
      ['Skills', 'skills-mode'],
      ['Usage and accounts', 'settings-mode'],
      ['Devices and own relay', 'devices-mode'],
    ]) {
      await pressRow(row);
      await until(() => layout.classList.contains(mode), 4000);
      await settled();
      note(tag + row + ', still solid: ' + (solidSurfaces().join('; ') || 'none'));
    }
}

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  await until(() => threads?.visible(), 8000);
  await agents.detect(true);
  await openThread('Terminal');
  check(
    !!(await until(() => agents.sessions().some(s => s.running), 20000)),
    'setup: a PowerShell panel is running'
  );
  for (const look of ['dark', 'light']) {
    window.TnaiTheme.set(look);
    for (const [width, height, size] of [
      [1440, 900, '1440'],
      [768, 680, 'small'],
    ]) {
      await main('size', width, height);
      await wait(700);
      await walk(look, size);
    }
  }

  // A thread row's computer, awake and then asleep, in both looks.
  await main('size', 1440, 900);
  await toThreads();
  for (const look of ['dark', 'light']) {
    window.TnaiTheme.set(look);
    await settled();
    await faceCrop('face-' + look + '-awake');
  }
  agents.sessions().forEach(s => agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
  await wait(600);
  for (const look of ['light', 'dark']) {
    window.TnaiTheme.set(look);
    await settled();
    await faceCrop('face-' + look + '-asleep');
  }
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
