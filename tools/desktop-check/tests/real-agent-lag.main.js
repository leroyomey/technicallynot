/*
 * Technically Not tools · desktop-check/tests/real-agent-lag.main.js — Main-process side of
 * real-agent-lag.js: the renderer + main CPU profile from typing-lag.main.js, and the window state
 * (normal / maximized / fullscreen / minimized; resolves once Electron reports the change or after
 * 1.5 s).
 */
'use strict';
module.exports = win => {
  const t = require('./typing-lag.main')(win);
  const settle = ev =>
    new Promise(r => {
      const done = () => {
          clearTimeout(timer);
          r(true);
        },
        timer = setTimeout(done, 1500);
      win.once(ev, done);
    });
  return {
    profileStart: t.profileStart,
    profileStop: t.profileStop,
    async winState(state) {
      if (win.isFullScreen() && state !== 'fullscreen') {
        const p = settle('leave-full-screen');
        win.setFullScreen(false);
        await p;
      }
      if (state === 'normal') {
        if (win.isMinimized()) {
          const p = settle('restore');
          win.restore();
          await p;
        }
        if (win.isMaximized()) {
          const p = settle('unmaximize');
          win.unmaximize();
          await p;
        }
      }
      if (state === 'maximized' && !win.isMaximized()) {
        const p = settle('maximize');
        win.maximize();
        await p;
      }
      if (state === 'fullscreen' && !win.isFullScreen()) {
        const p = settle('enter-full-screen');
        win.setFullScreen(true);
        await p;
      }
      if (state === 'minimized') {
        const p = settle('minimize');
        win.minimize();
        await p;
      }
      return {
        maximized: win.isMaximized(),
        fullscreen: win.isFullScreen(),
        minimized: win.isMinimized(),
      };
    },
  };
};
