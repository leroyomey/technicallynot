/*
 * Technically Not desktop · window-recover.js — The app window's page process ended on its own
 * (crashed, ran out of memory, killed in Task Manager): the window would stay empty while the
 * terminals and agents keep running here in the main process. The page is loaded again, once; it
 * re-finds the running sessions and replays their saved output, as after any reload
 * (10-live-terminals.js). A second end within a minute is left alone, so a page that dies while
 * loading cannot loop. Nothing is shown: the user sees the app come back. Check: npx electron
 * tools/desktop-check/window-recover-check.js
 */
'use strict';
const QUIET_MS = 60000;

// load() puts the app's page back into `win`; log gets one line per ended page process.
function watch(win, load, log = console.log) {
  let last = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (win.isDestroyed() || details?.reason === 'clean-exit') return;
    const again = Date.now() - last < QUIET_MS;
    log(
      '[window] the page process ended (' +
        (details?.reason || 'unknown') +
        (again ? '), a second time within a minute: not loaded again' : '): loading the page again')
    );
    if (again) return;
    last = Date.now();
    load();
  });
}

module.exports = { watch, QUIET_MS };
