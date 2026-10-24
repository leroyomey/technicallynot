// Technically Not tools · thread-looks-test.js — the four extra looks of Settings › General › Color
// (Dim, Paper, High contrast dark, High contrast light; src/styles/58-thread-looks.css).
// 1. Runs the real src/scripts/32-theme-and-shortcuts.js with a small stand-in for the page: each
//    shade keeps its base on data-theme, puts the shade on data-look, is saved, tells the page when
//    it changes, and does nothing in a browser (purple glass, always dark).
// 2. Reads the real colors: every text level of every look reads at 4.5 to 1 or better on its
//    panel, the status colors too, and the terminal's colors read on the shade's own island.
// Run: node tools/thread-looks-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const looksCss = source('src/styles/58-thread-looks.css');
const pagesCss = source('src/styles/31-thread-pages.css');

// ---------------------------------------------------------------- colors and contrast

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(start => parseInt(value.slice(start, start + 2), 16));
}

// A see-through fill laid over the ground, as the eye sees it.
function blend(ground, rgba) {
  const [red, green, blue, alpha] = rgba;
  return ground.map((channel, index) => channel * (1 - alpha) + [red, green, blue][index] * alpha);
}

function luminance(rgb) {
  const linear = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// The tokens of one block of a style sheet, found by a piece of its selector.
function tokensOf(css, selectorPart) {
  const start = css.indexOf(selectorPart);
  if (start < 0) return null;
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

const rgbaOf = text => {
  const parts = text
    .match(/rgba\(([^)]+)\)/)[1]
    .split(',')
    .map(Number);
  return parts;
};

const LOOKS = {
  dim: { base: 'dark', ground: '--pg-bg-d' },
  'hc-dark': { base: 'dark', ground: '--pg-bg-d' },
  paper: { base: 'light', ground: '--pg-bg-l' },
  'hc-light': { base: 'light', ground: '--pg-bg-l' },
};

for (const [look, info] of Object.entries(LOOKS)) {
  const selector = "html.tnt-on[data-look='" + look + "']:not(#tnt):not(#pg):not(#lk)";
  const tokens = tokensOf(looksCss, selector);
  check(!!tokens, look + ': has its block, one :not(#lk) over the base look of 31');
  if (!tokens) continue;

  const ground = hexToRgb(tokens[info.ground]);
  const panel = blend(ground, rgbaOf(tokens['--pg-panel']));
  const card = blend(ground, rgbaOf(tokens['--pg-panel-2']));
  for (const level of ['--pg-text', '--pg-text-2', '--pg-text-3', '--pg-text-4']) {
    const text = hexToRgb(tokens[level]);
    const onPanel = contrast(text, panel);
    check(onPanel >= 4.5, look + ': ' + level + ' on a panel ' + onPanel.toFixed(1) + ' to 1');
  }
  for (const level of ['--pg-text', '--pg-text-2', '--pg-text-3']) {
    const onCard = contrast(hexToRgb(tokens[level]), card);
    check(onCard >= 4.5, look + ': ' + level + ' on a card ' + onCard.toFixed(1) + ' to 1');
  }

  // Status colors: the look's own, else its base look's from 07 (Dark) or 31 (Light).
  const baseStatus =
    info.base === 'dark'
      ? {
          '--pg-work': '#5fe0a5',
          '--pg-wait': '#ffbf5e',
          '--pg-ready': '#7fa8ff',
          '--pg-err': '#ff7d8e',
        }
      : tokensOf(pagesCss, "html.tnt-on:not([data-theme='dark']):not(#tnt):not(#pg) {");
  for (const status of ['--pg-work', '--pg-wait', '--pg-ready', '--pg-err']) {
    const color = hexToRgb(tokens[status] || baseStatus[status]);
    const ratio = contrast(color, panel);
    check(ratio >= 4.5, look + ': ' + status + ' on a panel ' + ratio.toFixed(1) + ' to 1');
  }
  checkTextGreen(look, { ...baseStatus, ...tokens }, ground);
  info.island = tokens['--tnt-island'];
}

// ---------------------------------------------------------------- the text green

// color-mix(in srgb, A share, B) of two see-through colors, as the browser mixes them.
function mixColors(first, share, second) {
  const alpha = first[3] * share + second[3] * (1 - share);
  const channel = index =>
    (first[index] * first[3] * share + second[index] * second[3] * (1 - share)) / alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

// Green words (--pg-work-text, user decision 2026-10-23) read at 4.5 to 1 on a card and on the
// green-tinted card of Details' running time (14% of --pg-work over the card), the hardest place.
function checkTextGreen(look, tokens, ground) {
  const textGreen = tokens['--pg-work-text'];
  check(/^#[0-9a-f]{6}$/i.test(textGreen || ''), look + ': has its own --pg-work-text');
  if (!textGreen) return;
  const panel = blend(ground, rgbaOf(tokens['--pg-panel']));
  const card = blend(panel, rgbaOf(tokens['--pg-panel-2']));
  const tint = mixColors(
    [...hexToRgb(tokens['--pg-work']), 1],
    0.14,
    rgbaOf(tokens['--pg-panel-2'])
  );
  const tinted = blend(panel, tint);
  const onCard = contrast(hexToRgb(textGreen), card);
  const onTint = contrast(hexToRgb(textGreen), tinted);
  check(onCard >= 4.5, look + ': --pg-work-text on a card ' + onCard.toFixed(1) + ' to 1');
  check(onTint >= 4.5, look + ': --pg-work-text on a green tint ' + onTint.toFixed(1) + ' to 1');
}

// The two base looks: Dark's tokens from 07 and 31, Light's from 31.
const glassCss = source('src/styles/07-purple-glass.css');
const darkTokens = {
  ...tokensOf(glassCss, "html[data-theme='dark'] {"),
  ...tokensOf(pagesCss, "html.tnt-on[data-theme='dark']:not(#tnt):not(#pg) {"),
};
const lightTokens = tokensOf(pagesCss, "html.tnt-on:not([data-theme='dark']):not(#tnt):not(#pg) {");
checkTextGreen('dark', darkTokens, hexToRgb('#0e0e13'));
checkTextGreen('light', lightTokens, hexToRgb('#e9e7e1'));

// ---------------------------------------------------------------- the real 32 in a stand-in page

function element() {
  return {
    dataset: {},
    style: {},
    textContent: '',
    isConnected: false,
    append() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute(name) {
      const key = name
        .replace(/^data-/, '')
        .replace(/-(\w)/g, (all, letter) => letter.toUpperCase());
      delete this.dataset[key];
    },
  };
}

// Islands of the two base looks, from 31; a shade's from 58.
const baseIsland = {
  dark: tokensOf(pagesCss, "html.tnt-on[data-theme='dark']:not(#tnt):not(#pg) {")['--tnt-island'],
  light: tokensOf(pagesCss, "html.tnt-on:not([data-theme='dark']):not(#tnt):not(#pg) {")[
    '--tnt-island'
  ],
};

function makePage({ desktop, saved }) {
  const root = element();
  const listeners = {};
  const events = [];
  const store = new Map(saved ? [['tnai.theme.v1', saved]] : []);
  const head = element();
  const document = {
    documentElement: root,
    head,
    body: element(),
    readyState: 'complete',
    createElement: element,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const window = {
    document,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener(type, handler) {
      (listeners[type] ||= []).push(handler);
    },
    dispatchEvent(event) {
      events.push(event);
      (listeners[event.type] || []).forEach(handler => handler(event));
    },
    getComputedStyle: () => ({
      getPropertyValue: name => {
        if (name !== '--tnt-island') return '';
        const look = root.dataset.look;
        if (look) return LOOKS[look].island;
        return root.dataset.theme === 'dark' ? baseIsland.dark : baseIsland.light;
      },
    }),
    navigator: { platform: 'Win32', userAgent: '' },
  };
  if (desktop) window.tnaiNative = {};
  window.window = window;
  const context = vm.createContext({
    ...window,
    window,
    MutationObserver: class {
      observe() {}
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    console,
  });
  vm.runInContext(source('src/scripts/32-theme-and-shortcuts.js'), context);
  return { root, theme: context.window.TnaiTheme, events, store };
}

{
  const page = makePage({ desktop: true });
  const { root, theme, events, store } = page;
  check(root.dataset.theme === 'dark' && !root.dataset.look, 'no saved choice: plain Dark');

  const shown = [
    ['dim', 'dark'],
    ['hc-dark', 'dark'],
    ['paper', 'light'],
    ['hc-light', 'light'],
  ];
  for (const [look, base] of shown) {
    theme.set(look);
    const themeOk = base === 'dark' ? root.dataset.theme === 'dark' : !root.dataset.theme;
    check(themeOk && theme.resolved() === base, look + ': drawn on the ' + base + ' base');
    check(root.dataset.look === look, look + ': on <html data-look>');
    check(store.get('tnai.theme.v1') === look && theme.get() === look, look + ': saved');
  }

  theme.set('light');
  check(!root.dataset.look && !root.dataset.theme, 'plain Light takes the shade off');
  theme.set('dark');
  const before = events.length;
  theme.set('dim');
  check(events.length === before + 1, 'Dark to Dim alone tells the page (terminals recolor)');
  theme.set('not-a-look');
  check(theme.get() === 'dark' && !root.dataset.look, 'an unknown choice falls back to Dark');

  // The terminal draws on the shade's own island, and its colors read there.
  const names = [
    'foreground',
    'white',
    'brightBlack',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
  ];
  for (const look of ['dark', 'dim', 'hc-dark', 'light', 'paper', 'hc-light']) {
    theme.set(look);
    const colors = theme.xterm();
    const island = look in LOOKS ? LOOKS[look].island : baseIsland[look];
    check(colors.background === island, look + ': the terminal draws on ' + island);
    const weakest = names
      .map(name => [name, contrast(hexToRgb(colors[name]), hexToRgb(colors.background))])
      .sort((first, second) => first[1] - second[1])[0];
    check(
      weakest[1] >= 4.5,
      look + ': terminal colors read, the weakest ' + weakest[0] + ' ' + weakest[1].toFixed(1)
    );
  }
}

{
  const page = makePage({ desktop: true, saved: 'paper' });
  check(
    page.root.dataset.look === 'paper' && !page.root.dataset.theme,
    'a saved shade is on <html> at load, before the first paint'
  );
}

{
  const page = makePage({ desktop: false, saved: 'paper' });
  check(
    page.root.dataset.theme === 'dark' && !page.root.dataset.look,
    'in a browser the page stays the old dark, with no shade'
  );
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
