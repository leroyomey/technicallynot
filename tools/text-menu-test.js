// Technically Not tools · text-menu-test.js — checks the right-press menu's items
// (desktop/text-menu.js) without opening a window: Electron is a stand-in, the menu is never shown.
// Run: node tools/text-menu-test.js
'use strict';

const Module = require('module');
const path = require('path');

// Electron stand-in: only what text-menu.js reads at load and in itemsFor.
const pressed = [];
const electronStandIn = {
  Menu: { buildFromTemplate: items => ({ items, popup() {} }) },
  BrowserWindow: { fromWebContents: () => null },
};
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return electronStandIn;
  return realLoad.call(this, request, ...rest);
};
const { itemsFor, watch } = require(path.join(__dirname, '..', 'desktop', 'text-menu.js'));

let failed = 0;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) failed++;
};
const labels = items => items.map(item => (item.type === 'separator' ? '-' : item.label));
const contents = {
  isDestroyed: () => false,
  sendInputEvent: event => pressed.push(event),
};

// 1. A text field, words selected.
const field = itemsFor(
  {
    isEditable: true,
    selectionText: 'abc',
    editFlags: { canCut: true, canCopy: true, canPaste: true },
  },
  contents
);
check(
  labels(field).join(',') === 'Cut,Copy,Paste,-,Select all',
  'a text field: Cut, Copy, Paste, Select all'
);
check(
  field.find(item => item.label === 'Select all').role === 'selectAll',
  'Select all in a field takes the field'
);

// 2. A text field with nothing selected and nothing to paste: Cut and Copy are off.
const empty = itemsFor({ isEditable: true, selectionText: '', editFlags: {} }, contents);
check(
  empty
    .filter(item => item.enabled === false)
    .map(item => item.label)
    .join(',') === 'Cut,Copy,Paste',
  'an empty field: Cut, Copy and Paste are greyed'
);

// 3. Words selected in the conversation: Copy and Select all, no Cut or Paste.
const words = itemsFor({ isEditable: false, selectionText: ' some words ' }, contents);
check(labels(words).join(',') === 'Copy,-,Select all', 'selected words: Copy, Select all');

// 4. Nothing selected outside a field: Select all only, and it presses Ctrl+A for the page.
const plain = itemsFor({ isEditable: false, selectionText: '   ' }, contents);
check(labels(plain).join(',') === 'Select all', 'no selection: Select all only');
plain[0].click();
const key = process.platform === 'darwin' ? 'meta' : 'control';
check(
  pressed.length === 2 &&
    pressed[0].type === 'keyDown' &&
    pressed[1].type === 'keyUp' &&
    pressed.every(event => event.keyCode === 'A' && event.modifiers.join() === key),
  'Select all outside a field presses ' + key + '+A for the page'
);

// 5. Only app windows get the menu, not embedded pages.
const attached = [];
const fakeApp = {
  on: (name, handler) => {
    if (name !== 'web-contents-created') return;
    for (const type of ['window', 'webview'])
      handler(null, { getType: () => type, on: event => attached.push(type + ':' + event) });
  },
};
watch(fakeApp);
check(attached.join() === 'window:context-menu', 'a window gets the menu, a webview does not');

Module._load = realLoad;
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
