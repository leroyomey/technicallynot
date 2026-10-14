/*
 * Technically Not tools · desktop-check/tests/press-popout.main.js — Main-process side of
 * press-popout: keeps every pop-out hidden and not focusable (quiet-window.js), serves a one-page
 * test site on this computer for a Live preview tab, and pushes a page error for a preview frame
 * as desktop/preview-emulation.js would. Nothing leaves this computer.
 */
'use strict';
const http = require('http');
const quietWindow = require('../quiet-window');

module.exports = win => {
  const quiet = quietWindow(win);
  let server = null;

  return {
    // The address of a page that says one word.
    serve() {
      return new Promise((resolve, reject) => {
        server = http.createServer((request, response) => {
          response.writeHead(200, { 'content-type': 'text/html' });
          response.end('<!doctype html><title>press test</title><p>press test</p>');
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          resolve('http://127.0.0.1:' + server.address().port + '/');
        });
      });
    },

    error(frameName, text) {
      win.webContents.send('preview:error', { name: frameName, kind: 'error', text });
      return true;
    },

    quiet: () => quiet.state(),

    stop() {
      if (server) {
        server.closeAllConnections?.();
        server.close();
        server = null;
      }
      return true;
    },
  };
};
