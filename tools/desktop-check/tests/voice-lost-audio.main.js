/*
 * Technically Not tools · desktop-check/tests/voice-lost-audio.main.js — Main-process side of
 * voice-lost-audio.js: a local server whose one page answers after a wait. The test asks it with a
 * blocking request, which holds the window's thread for that long without using the processor (no
 * busy loop), the way a heavy redraw would. It also counts the window's engine warm-ups.
 */
'use strict';
const http = require('http');
module.exports = win => {
  let server = null;
  let warms = 0;
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
    async serve() {
      if (!server) {
        server = http.createServer((req, res) => {
          const ms = Math.min(
            2000,
            Math.max(0, +new URL(req.url, 'http://x').searchParams.get('ms') || 0)
          );
          setTimeout(() => {
            res.writeHead(200, {
              'content-type': 'text/plain',
              'access-control-allow-origin': '*',
              'cache-control': 'no-store',
            });
            res.end('ok');
          }, ms);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      }
      return 'http://127.0.0.1:' + server.address().port + '/';
    },
    stop() {
      server?.close();
      server = null;
      return true;
    },
  };
};
