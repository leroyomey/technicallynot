// Technically Not tools · desktop-check/tests/thread-popout.main.js — main-process side of
// thread-popout.js: pop-outs are created hidden and never take the keyboard (quiet-window.js), the
// made-up Claude Code transcripts and the window's size (thread-helpers.main.js), how many
// thread windows are open, and a picture of one of them.
'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const quietWindow = require('../quiet-window');
const threadHelpers = require('./thread-helpers.main.js');

module.exports = win => {
  const quiet = quietWindow(win);

  // the app's other windows (its pop-outs): a thread's is titled "NAME · Technically Not"
  const threadWindows = () =>
    BrowserWindow.getAllWindows().filter(other => other !== win && !other.isDestroyed());
  return {
    ...threadHelpers(win),

    // every other window of the app now (the pop-outs)
    windows: () =>
      BrowserWindow.getAllWindows()
        .filter(other => other !== win && !other.isDestroyed())
        .map(other => ({
          title: other.getTitle(),
          focusable: other.isFocusable(),
          focused: other.isFocused(),
        })),

    quiet: () => quiet.state(),

    // a picture of the pop-out whose title starts with `name`, saved beside the test's own
    async shotWindow(name, file) {
      const one = threadWindows().find(other => (other.getTitle() || '').startsWith(name));
      if (!one) return '';
      const image = await one.webContents.capturePage();
      const out = path.resolve(
        __dirname,
        '..',
        '..',
        'browser-check',
        'out',
        'desktop-' + file + '.png'
      );
      fs.writeFileSync(out, image.toPNG());
      return out;
    },
  };
};
