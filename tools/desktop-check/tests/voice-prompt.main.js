/*
 * Technically Not tools · desktop-check/tests/voice-prompt.main.js — Main-process helper for
 * voice-prompt.js: a tiny localhost page (standing in for a Live preview dev server) that asks for
 * the microphone as soon as it loads and posts the answer to its parent frame.
 */
'use strict';
const http = require('http');

module.exports = win => {
  let server = null;
  const page = `<!doctype html><script>
const tell = (ok, detail) => parent.postMessage({ tnVoiceProbe: true, ok, detail }, '*');
Promise.all([
  navigator.permissions.query({ name: 'microphone' }).then(s => s.state, e => 'error ' + e.name),
  navigator.mediaDevices.getUserMedia({ audio: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'granted'; }, e => e.name),
]).then(([state, gum]) => tell(gum === 'granted', 'permissions.query=' + state + ' getUserMedia=' + gum));
</script>`;
  return {
    async serve() {
      if (!server) {
        server = http.createServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(page);
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
    // The page must act as focused: without that Chromium fires no focus events, so the voice
    // code never learns which box was clicked last. The window itself is not given the
    // keyboard (a test window never takes it from the user): the browser's focus emulation
    // makes the page behave as if it had it.
    async focus() {
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true,
      });
      await new Promise(r => setTimeout(r, 150));
      return true;
    },
    async size(width, height) {
      win.setContentSize(width, height);
      await new Promise(r => setTimeout(r, 500));
      return win.getContentSize();
    }, // listening screenshot at the minimum window
  };
};
