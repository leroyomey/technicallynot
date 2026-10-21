/*
 * Technically Not · text-menu.js — the right-press menu on text: Copy, Cut, Paste and Select all,
 * drawn by the system (Electron's own menu), not by the page.
 *
 * Every window of the app gets it: the main window and a thread popped out into its own window.
 * The page decides where no menu opens (src/scripts/169-text-selection.js): over a control, over
 * the thread list (137 shows its own menu there) and over a terminal (xterm copies and pastes on
 * a right press itself). A press the page has taken never reaches this file.
 *
 * Copy shows when something is selected; Cut and Paste in a text field; Select all always. In a
 * text field Select all takes the field. Elsewhere it presses Ctrl+A for the page, so it selects
 * what Ctrl+A selects there: a thread's conversation, not every word of the window (169).
 *
 * Wired in desktop/main.js with `require('./text-menu').watch(app)`.
 */
'use strict';

const { Menu, BrowserWindow } = require('electron');

// Ctrl on Windows and Linux, Cmd on a Mac: the key Select all presses with A.
const SELECT_KEY = process.platform === 'darwin' ? 'meta' : 'control';

// The items for one right press, from what Electron says about the spot (`params`).
function itemsFor(params, contents) {
  const flags = params.editFlags || {};
  const selected = String(params.selectionText || '').trim() !== '';
  const items = [];

  if (params.isEditable) {
    items.push({ label: 'Cut', role: 'cut', enabled: !!flags.canCut });
    items.push({ label: 'Copy', role: 'copy', enabled: !!flags.canCopy });
    items.push({ label: 'Paste', role: 'paste', enabled: !!flags.canPaste });
    items.push({ type: 'separator' });
    items.push({ label: 'Select all', role: 'selectAll' });
    return items;
  }

  if (selected) {
    items.push({ label: 'Copy', role: 'copy' });
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Select all', click: () => pressSelectAll(contents) });
  return items;
}

// Ctrl+A for the page, as if typed, so the page's own Select all rule decides what it takes.
function pressSelectAll(contents) {
  if (contents.isDestroyed()) return;
  const key = { keyCode: 'A', modifiers: [SELECT_KEY] };
  contents.sendInputEvent({ type: 'keyDown', ...key });
  contents.sendInputEvent({ type: 'keyUp', ...key });
}

// One window's page: show the menu on each right press the page let through.
function attach(contents) {
  contents.on('context-menu', (_event, params) => {
    const items = itemsFor(params, contents);
    const owner = BrowserWindow.fromWebContents(contents);
    const menu = Menu.buildFromTemplate(items);
    menu.popup(owner ? { window: owner } : {});
  });
}

// Every window the app opens, now and later. Embedded pages (a <webview>) keep their own menus.
function watch(app) {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'window') attach(contents);
  });
}

module.exports = { watch, itemsFor };
