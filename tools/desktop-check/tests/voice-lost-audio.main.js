/*
 * Technically Not tools · desktop-check/tests/voice-lost-audio.main.js — Main-process side of
 * voice-lost-audio.js: a local server whose one page answers after a wait. The test asks it with a
 * blocking request, which holds the window's thread for that long without using the processor (no
 * busy loop), the way a heavy redraw would.
 */
'use strict';
const http = require('http');
module.exports = () => {
  let server = null;
  return {
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
