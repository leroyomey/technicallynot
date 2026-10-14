// Technically Not tools · desktop-check/tests/live-preview-freeze.main.js — Main-process side of
// live-preview-freeze.js: a light localhost page that counts its own requestAnimationFrame calls,
// setInterval ticks (every 50 ms) and draws of a 64 px WebGL canvas, and posts the counts to this
// server every 200 ms. A frozen page posts nothing, so the server's last report per page is the
// proof; `born` is made once per document, so a page that was reloaded instead of resumed shows a
// new one.
'use strict';
const http = require('http');

module.exports = () => {
  const last = new Map(); // path -> newest report { at, born, raf, tick, gl, posts }

  // path and document -> that document's newest report: two views of one address are two
  // documents with their own counts, and a rate is only true within one of them
  const lastOfDocument = new Map();
  const page = `<!doctype html><title>freeze check</title><body style="margin:0;background:#123"><canvas id="c" width="64" height="64"></canvas><pre id="o"></pre><script>
const born = Math.random().toString(36).slice(2), n = { raf: 0, tick: 0, gl: 0, posts: 0 };
const gl = document.getElementById('c').getContext('webgl');
function frame(t) { n.raf++; if (gl) { gl.clearColor((t / 1000) % 1, 0.4, 0.8, 1); gl.clear(gl.COLOR_BUFFER_BIT); n.gl++; } requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setInterval(() => { n.tick++; }, 50);
setInterval(() => { n.posts++; document.getElementById('o').textContent = JSON.stringify(n); fetch('/report?' + encodeURIComponent(JSON.stringify({ path: location.pathname, born, ...n }))).catch(() => {}); }, 200);
</script>`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/report?')) {
      try {
        const r = JSON.parse(decodeURIComponent(req.url.slice(8)));
        last.set(r.path, { at: Date.now(), ...r });
        lastOfDocument.set(r.path + ' ' + r.born, { at: Date.now(), ...r });
      } catch {}
      res.end('ok');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(page);
  });
  const listening = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    async serve() {
      await listening;
      return server.address().port;
    },
    last: path => last.get(path) || null,
    lastOf: (path, born) => lastOfDocument.get(path + ' ' + born) || null,
  };
};
