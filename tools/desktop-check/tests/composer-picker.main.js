// Technically Not tools · desktop-check/tests/composer-picker.main.js — Main-process side of
// composer-picker.js: resizes Technically Not's window (1024×768 fit check).
'use strict';
module.exports = win => ({
  setSize(w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    return win.getContentBounds();
  },
});
