// Technically Not tools · desktop-check/tests/live-preview-device.main.js — Main-process side of
// live-preview-device.js: a localhost page that reports what it sees (user agent in JS and in the
// request header, pointer/hover media, touch, viewport) to this server, plus the pop-out window's
// content size and closing it like the user would, and the newest `tnai shot preview` PNG
// (signature + IHDR size).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

module.exports = win => {
  const reports = [];
  const page = `<!doctype html><title>device</title><h1>Device check</h1><script>
function report(){fetch('/report?' + encodeURIComponent(JSON.stringify({path:location.pathname,ua:navigator.userAgent,hdr:HDR,mobile:!!(navigator.userAgentData&&navigator.userAgentData.mobile),coarse:matchMedia('(pointer: coarse)').matches,hoverNone:matchMedia('(hover: none)').matches,touch:'ontouchstart' in window,mtp:navigator.maxTouchPoints,w:innerWidth,h:innerHeight,maxW500:matchMedia('(max-width: 500px)').matches})))}
addEventListener('resize', report); report();
</script>`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/report?')) {
      try {
        reports.push({ at: Date.now(), ...JSON.parse(decodeURIComponent(req.url.slice(8))) });
      } catch {}
      res.end('ok');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(page.replace('HDR', JSON.stringify(req.headers['user-agent'] || '')));
  });
  const listening = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const popouts = () => BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed());
  return {
    async serve() {
      await listening;
      return server.address().port;
    },
    reports: since => reports.filter(r => r.at >= (since || 0)),
    popout() {
      const w = popouts()[0];
      if (!w) return null;
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      return { content: w.getContentBounds(), zoom: w.webContents.getZoomFactor(), area };
    },
    close() {
      popouts()[0]?.close();
      return true;
    },
    windows: () => popouts().length,
    // The newest shot-*.png written after `since` in userData/attachments/<day>/ (preview-shot.js):
    // where, and what its header says.
    shot(since) {
      const root = path.join(app.getPath('userData'), 'attachments');
      let best = null;
      if (!fs.existsSync(root)) return null;
      for (const day of fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()))
        for (const n of fs.readdirSync(path.join(root, day.name))) {
          if (!/^shot-.*\.png$/.test(n)) continue;
          const file = path.join(root, day.name, n),
            at = fs.statSync(file).mtimeMs;
          if (at >= (since || 0) - 1000 && (!best || at > best.at))
            best = { file, day: day.name, at };
        }
      if (!best) return null;
      const b = fs.readFileSync(best.file);
      return {
        file: best.file,
        day: best.day,
        bytes: b.length,
        png:
          b.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          b.toString('ascii', 12, 16) === 'IHDR',
        width: b.readUInt32BE(16),
        height: b.readUInt32BE(20),
      };
    },
    parentMedia: () =>
      win.webContents.executeJavaScript(
        "({ coarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, ua: navigator.userAgent })"
      ),
  };
};
