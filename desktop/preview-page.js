/*
 * Technically Not desktop · preview-page.js — the helper preview-control.js puts into the
 * previewed page (the user's localhost page in Live preview) before each action of the
 * `tnai_preview` tool. The functions below never run in Node: source() turns them into one
 * script that sets window.__tnaiCtl in the page, with read (the page's text and controls, each
 * control numbered as a ref), aim (where a control is, scrolled into view), flash (the ring and
 * label the user sees for each action) and the small reads the actions need.
 */
'use strict';

// What counts as a control in the page (it gets a ref in read).
const CONTROLS =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable=""], ' +
  '[contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
  '[role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], ' +
  '[role="textbox"], [role="slider"], [tabindex]:not([tabindex="-1"])';

// Elements whose text is never page text.
const SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK'];

// Input types that take no typed text.
const NOT_TEXT = [
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'image',
];

// The refs of the last read, kept in the page (declared here only so this file reads whole).
const state = { refs: [] };

function squeeze(value, max) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function isFlash(node) {
  return !!(node.closest && node.closest('[data-tnai-flash]'));
}

function shown(node) {
  const rect = node.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  if (!node.checkVisibility) return true;
  return node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

function editable(node) {
  if (!node) return false;
  if (node.tagName === 'INPUT') return !NOT_TEXT.includes(node.type);
  return node.tagName === 'TEXTAREA' || node.isContentEditable;
}

// A label's own words: a label wrapped around its control ("Color <select>") leaves the
// control's text (a list's options, a field's value) out.
function labelWords(label) {
  const copy = label.cloneNode(true);
  copy.querySelectorAll('input, select, textarea, button').forEach(control => control.remove());
  return copy.textContent;
}

// A control's name the way a screen reader would say it, near enough.
function nameOf(node) {
  const aria = node.getAttribute('aria-label');
  if (aria) return aria;
  const labelledBy = node.getAttribute('aria-labelledby');
  if (labelledBy)
    return labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.innerText || '')
      .join(' ');
  if (node.labels && node.labels.length) return [...node.labels].map(labelWords).join(' ');
  if (node.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(node.type))
    return node.value;
  const words = node.tagName === 'SELECT' ? '' : node.innerText;
  if (words && words.trim()) return words;
  return (
    node.getAttribute('placeholder') ||
    node.getAttribute('title') ||
    node.getAttribute('alt') ||
    node.querySelector?.('img[alt]')?.alt ||
    node.getAttribute('name') ||
    ''
  );
}

function roleOf(node) {
  const role = node.getAttribute('role');
  if (role) return role;
  const tag = node.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'input') {
    const kind = node.type || 'text';
    if (kind === 'checkbox' || kind === 'radio') return kind;
    if (['button', 'submit', 'reset', 'image'].includes(kind)) return 'button';
    if (kind === 'range') return 'slider';
    return kind === 'text' ? 'textbox' : 'textbox (' + kind + ')';
  }
  if (tag === 'textarea' || node.isContentEditable) return 'textbox';
  return tag;
}

function describe(node) {
  return roleOf(node) + ' "' + squeeze(nameOf(node), 60) + '"';
}

// Value, checked, disabled, open and where it is, in a few words. A password shows only
// whether it is filled.
function stateOf(node) {
  const parts = [];
  if (editable(node)) {
    const value = node.isContentEditable ? node.innerText : node.value;
    if (node.type === 'password') parts.push(value ? 'filled' : 'empty');
    else parts.push('value "' + squeeze(value, 40) + '"');
  }
  if (node.tagName === 'SELECT')
    parts.push('chosen "' + squeeze(node.selectedOptions[0]?.text, 40) + '"');
  if (node.checked || node.getAttribute('aria-checked') === 'true') parts.push('checked');
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') parts.push('disabled');
  const expanded = node.getAttribute('aria-expanded');
  if (expanded) parts.push(expanded === 'true' ? 'open' : 'closed');
  if (node.getAttribute('aria-selected') === 'true' || node.getAttribute('aria-pressed') === 'true')
    parts.push('selected');
  const rect = node.getBoundingClientRect();
  if (rect.top > innerHeight) parts.push('below');
  else if (rect.bottom < 0) parts.push('above');
  return parts.length ? ' (' + parts.join(', ') + ')' : '';
}

// The page in document order: headings (#), controls ([ref] role "name" (state)), pictures with
// words, and text, cut to maxChars; `find` keeps only the lines with those words.
function readPage(options) {
  state.refs = [];
  const lines = [];
  const find = String(options.find || '').toLowerCase();
  let seen = 0;
  const add = line => {
    if (find && !line.toLowerCase().includes(find)) return false;
    if (lines[lines.length - 1] === line) return false;
    lines.push(line);
    return true;
  };
  const visit = node => {
    seen++;
    if (seen > 6000 || SKIP_TAGS.includes(node.tagName) || isFlash(node)) return;
    const display = getComputedStyle(node).display;
    if (display === 'none') return;
    if (display !== 'contents' && !shown(node)) return;
    if (node.matches(CONTROLS)) {
      const line = '[' + (state.refs.length + 1) + '] ' + describe(node) + stateOf(node);
      if (add(line)) state.refs.push(node);
      return;
    }
    if (/^H[1-6]$/.test(node.tagName)) {
      add('#'.repeat(Number(node.tagName[1])) + ' ' + squeeze(node.innerText, 120));
      return;
    }
    if (node.tagName === 'IMG') {
      if (node.alt) add('image "' + squeeze(node.alt, 80) + '"');
      return;
    }

    // a box with no control, heading or picture inside: its words as one line
    const leaf = !node.querySelector(CONTROLS + ', h1, h2, h3, h4, h5, h6, img[alt]');
    if (leaf && node.children.length < 40) {
      const words = squeeze(node.innerText, 300);
      if (words) add(words);
      return;
    }
    const own = [...node.childNodes]
      .filter(child => child.nodeType === 3)
      .map(child => child.textContent)
      .join(' ');
    if (own.trim()) add(squeeze(own, 300));
    for (const child of node.children) visit(child);
    if (node.shadowRoot) for (const child of node.shadowRoot.children) visit(child);
  };
  if (document.body) visit(document.body);
  return pageHead() + linesWithin(lines, options.maxChars, find);
}

function pageHead() {
  const top = document.scrollingElement || document.documentElement;
  return (
    'Title "' +
    squeeze(document.title, 80) +
    '" · ' +
    location.href.slice(0, 200) +
    ' · viewport ' +
    innerWidth +
    '×' +
    innerHeight +
    ' · scrolled ' +
    Math.round(top.scrollTop) +
    ' of ' +
    Math.max(0, top.scrollHeight - innerHeight) +
    ' px'
  );
}

function linesWithin(lines, maxChars, find) {
  let out = '';
  let cut = 0;
  for (const line of lines) {
    if (out.length + line.length + 200 > maxChars) {
      cut++;
      continue;
    }
    out += '\n' + line;
  }
  if (!lines.length) out += '\n(nothing' + (find ? ' with "' + find + '"' : '') + ' on the page)';
  if (cut) out += '\n… ' + cut + ' more lines (use find, or a larger max_chars)';
  return out;
}

// The element a call names: a ref from the last read, a CSS selector, or a control's words.
function element(target) {
  if (target.ref !== null && target.ref !== undefined) {
    const node = state.refs[target.ref - 1];
    if (!node || !node.isConnected)
      return { error: 'ref ' + target.ref + ' is gone (the page changed); read the page again' };
    return { node };
  }
  if (target.selector) {
    let node = null;
    try {
      node = document.querySelector(target.selector);
    } catch {
      return { error: 'not a valid CSS selector' };
    }
    return node ? { node } : { error: 'nothing matches ' + target.selector };
  }
  const words = String(target.text || '')
    .toLowerCase()
    .trim();
  if (!words) return { error: 'no target given' };
  const controls = [...document.querySelectorAll(CONTROLS)].filter(
    node => !isFlash(node) && shown(node)
  );
  const named = node => squeeze(nameOf(node), 200).toLowerCase();
  const found =
    controls.find(node => named(node) === words) ||
    controls.find(node => named(node).includes(words));
  return found ? { node: found } : { error: 'no control with the words "' + target.text + '"' };
}

// Where to press it (its middle, in the page's own pixels), after scrolling it into view; what
// covers that point, the link it would follow, and whether it is a list to choose from.
function aim(target) {
  const found = element(target);
  if (found.error) return found;
  const node = found.node;
  let rect = node.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth) {
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    rect = node.getBoundingClientRect();
  }
  const x = Math.round(Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1));
  const y = Math.round(Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1));
  const hit = document.elementFromPoint(x, y);
  const covers = hit && hit !== node && !node.contains(hit) && !hit.contains(node);
  const link = node.closest('a[href]');
  return {
    x,
    y,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    label: describe(node),
    covered: covers ? describe(hit) : '',
    href: link ? link.href : '',
    select: node.tagName === 'SELECT',
  };
}

// Only when the page's session takes no input events: a click from inside the page.
function pressInside(target) {
  const found = element(target);
  if (found.error) return found;
  found.node.focus?.();
  found.node.click();
  return { ok: true };
}

// A <select>: the option with these words (its own list never opens).
function choose(target, words) {
  const found = element(target);
  if (found.error) return found;
  const wanted = String(words || '')
    .toLowerCase()
    .trim();
  const options = [...found.node.options];
  const option =
    options.find(
      item => item.text.trim().toLowerCase() === wanted || item.value.toLowerCase() === wanted
    ) || options.find(item => item.text.toLowerCase().includes(wanted));
  if (!option) {
    const names = options.map(item => item.text.trim()).slice(0, 12);
    return { error: 'no option "' + words + '" (there are: ' + names.join(', ') + ')' };
  }
  found.node.value = option.value;
  found.node.dispatchEvent(new Event('input', { bubbles: true }));
  found.node.dispatchEvent(new Event('change', { bubbles: true }));
  return { option: option.text.trim() };
}

function focusOn(target) {
  const found = element(target);
  if (found.error) return found;
  found.node.focus();
  return { label: describe(found.node) };
}

function focused() {
  let node = document.activeElement;
  while (node && node.shadowRoot && node.shadowRoot.activeElement)
    node = node.shadowRoot.activeElement;
  if (!node || node === document.body) return { editable: false, label: '' };
  return {
    editable: editable(node),
    label: describe(node),
    secret: node.type === 'password',
    value: node.isContentEditable ? node.innerText : node.value,
  };
}

function selectAll() {
  const node = document.activeElement;
  if (node && typeof node.select === 'function') node.select();
  else document.execCommand('selectAll');
  return true;
}

function viewport() {
  return { width: innerWidth, height: innerHeight };
}

// Where the page is scrolled, and up to three inner areas that are scrolled too.
function scrolled() {
  const top = document.scrollingElement || document.documentElement;
  const inner = [...document.querySelectorAll('*')]
    .filter(node => node.scrollTop > 0 && node !== top)
    .slice(0, 3)
    .map(node => node.tagName.toLowerCase() + ' at ' + Math.round(node.scrollTop));
  const across = top.scrollLeft ? ', ' + Math.round(top.scrollLeft) + ' across' : '';
  const inside = inner.length ? ' · inner: ' + inner.join(', ') : '';
  const height = Math.max(0, top.scrollHeight - innerHeight);
  return 'page at ' + Math.round(top.scrollTop) + ' of ' + height + ' px' + across + inside;
}

// A ring around the target and a label with the agent's name, gone after a second. It takes no
// presses, read leaves it out, and with reduced motion it goes without fading.
function flash(rect, words) {
  unflash();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layer = document.createElement('div');
  layer.setAttribute('data-tnai-flash', '');
  layer.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:1;' +
    (still ? '' : 'transition:opacity .35s ease');
  const label = document.createElement('div');
  label.textContent = words;
  label.style.cssText =
    'position:absolute;padding:3px 9px;border-radius:999px;background:rgba(24,24,27,.9);' +
    'color:#fff;font:500 12px/1.4 system-ui,sans-serif;white-space:nowrap;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.25)';
  if (rect) {
    const ring = document.createElement('div');
    ring.style.cssText =
      'position:absolute;border:2px solid #a78bfa;border-radius:6px;box-sizing:border-box;' +
      'box-shadow:0 0 0 4px rgba(167,139,250,.28)';
    ring.style.left = rect.x - 3 + 'px';
    ring.style.top = rect.y - 3 + 'px';
    ring.style.width = rect.w + 6 + 'px';
    ring.style.height = rect.h + 6 + 'px';
    layer.append(ring);
    const below = rect.y + rect.h + 30 < innerHeight;
    label.style.left = Math.max(4, Math.min(rect.x, innerWidth - 160)) + 'px';
    label.style.top = (below ? rect.y + rect.h + 8 : Math.max(4, rect.y - 30)) + 'px';
  } else {
    label.style.left = '50%';
    label.style.top = '10px';
    label.style.transform = 'translateX(-50%)';
  }
  layer.append(label);
  document.documentElement.append(layer);
  setTimeout(() => {
    layer.style.opacity = '0';
    setTimeout(() => layer.remove(), still ? 0 : 400);
  }, 1000);
  return true;
}

function unflash() {
  document.querySelectorAll('[data-tnai-flash]').forEach(node => node.remove());
  return true;
}

// Resolves once the page has drawn two frames (at most half a second), so a picture taken next
// shows its latest state.
function drawn() {
  return new Promise(resolve => {
    setTimeout(() => resolve(true), 500);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  });
}

// The functions that go into the page, and the names window.__tnaiCtl gives them.
const PARTS = [
  squeeze,
  labelWords,
  isFlash,
  shown,
  editable,
  nameOf,
  roleOf,
  describe,
  stateOf,
  readPage,
  pageHead,
  linesWithin,
  element,
  aim,
  pressInside,
  choose,
  focusOn,
  focused,
  selectAll,
  viewport,
  scrolled,
  flash,
  unflash,
  drawn,
];
const CALLS =
  'read: readPage, aim, pressInside, choose, focusOn, focused, selectAll, viewport, scrolled, flash, unflash, drawn';

let built = '';

// One script: sets window.__tnaiCtl once per document (a page that navigated gets it again).
function source() {
  if (built) return built;
  built =
    '(() => {\n' +
    'if (window.__tnaiCtl && window.__tnaiCtl.version === 1) return;\n' +
    'const CONTROLS = ' +
    JSON.stringify(CONTROLS) +
    ';\n' +
    'const SKIP_TAGS = ' +
    JSON.stringify(SKIP_TAGS) +
    ';\n' +
    'const NOT_TEXT = ' +
    JSON.stringify(NOT_TEXT) +
    ';\n' +
    'const state = { refs: [] };\n' +
    PARTS.map(part => part.toString()).join('\n') +
    '\nwindow.__tnaiCtl = { version: 1, ' +
    CALLS +
    ' };\n})()';
  return built;
}

module.exports = { source, state };
