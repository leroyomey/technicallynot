// Technically Not tools · desktop-check/tests/cli-screen-show-bottom.main.js — Main-process side of
// cli-screen-show-bottom.js (loaded by run.js): resizes, maximizes and restores Technically Not's
// window like the user would (popSize / popCount are for a pop-out window).
'use strict';
const { BrowserWindow } = require('electron');

module.exports = win => {
  const popout = () => {
    const w = BrowserWindow.getAllWindows().find(x => x !== win && !x.isDestroyed());
    if (!w) throw new Error('no pop-out window');
    return w;
  };
  return {
    setSize(w, h) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(w, h);
      return win.getContentBounds();
    },
    maximize() {
      win.maximize();
      return win.getContentBounds();
    },
    unmaximize() {
      win.unmaximize();
      return win.getContentBounds();
    },
    popSize(w, h) {
      const p = popout();
      p.setContentSize(w, h);
      return p.getContentBounds();
    },
    // The full log in %TEMP%\tnai-terminal-fit.log, for runs whose console output gets cut off.
    dump(lines, append) {
      require('fs')[append ? 'appendFileSync' : 'writeFileSync'](
        require('path').join(require('os').tmpdir(), 'tnai-terminal-fit.log'),
        (append ? '\n--- after reload\n' : '') + lines.join('\n')
      );
      return true;
    },
    popCount: () => BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed()).length,
  };
};
