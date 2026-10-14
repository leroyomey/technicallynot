// Technically Not tools · desktop-check/tests/settings-page.main.js — Main-process side of
// settings-page.js: TNAI_MAIN size(w, h) resizes the window for the layout checks at the window
// minimum.
'use strict';
module.exports = win => ({
  size: (w, h) => {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    return win.getContentSize();
  },
});
