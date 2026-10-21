/*
 * Technically Not tools · desktop-check/tests/voice-lost-audio.main.js — Main-process side of
 * voice-lost-audio.js: holds the window's thread for a set time without using the processor (no
 * busy loop), the way a heavy redraw would. The page runs a `debugger;` statement; with the
 * DevTools debugger attached here, the page stops there and this side lets it go on after the wait.
 * (Until 2026-10-21 the page held itself with a blocking request to a local page that answered
 * late; the app's policy lets the page connect nowhere since then.) It also counts the window's
 * engine warm-ups.
 */
'use strict';
module.exports = win => {
  let warms = 0;
  let holdMs = 0;
  let onPaused = null;
  return {
    // Counts the window's engine warm-ups (voice:warm) instead of starting the engine: a handler on
    // the window's own channel answers before the app's.
    watchWarm(on) {
      const ipc = win.webContents.ipc;
      ipc.removeHandler('voice:warm');
      if (on) {
        warms = 0;
        ipc.handle('voice:warm', () => {
          warms++;
        });
      }
      return true;
    },
    warms() {
      return warms;
    },

    // After this, the page's next `debugger;` statement holds its thread for `ms`.
    async armHold(ms) {
      holdMs = Math.min(2000, Math.max(0, Number(ms) || 0));
      const tools = win.webContents.debugger;
      if (!tools.isAttached()) tools.attach('1.3');
      if (!onPaused) {
        onPaused = (_event, method) => {
          if (method !== 'Debugger.paused') return;
          setTimeout(() => {
            if (tools.isAttached()) tools.sendCommand('Debugger.resume').catch(() => {});
          }, holdMs);
        };
        tools.on('message', onPaused);
      }
      await tools.sendCommand('Debugger.enable');
      return true;
    },
    disarm() {
      const tools = win.webContents.debugger;
      if (onPaused) tools.removeListener('message', onPaused);
      onPaused = null;
      if (tools.isAttached()) tools.detach();
      return true;
    },
  };
};
