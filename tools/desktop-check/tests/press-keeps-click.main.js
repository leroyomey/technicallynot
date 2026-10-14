/*
 * Technically Not tools · desktop-check/tests/press-keeps-click.main.js — Main-process side of
 * press-keeps-click: `serve` starts a one-page web server on this computer for a Live preview tab,
 * `error` pushes a page error for a preview frame as desktop/preview-emulation.js would, and `stop`
 * closes the server. Nothing is launched and nothing leaves this computer.
 */
'use strict';
const http = require('http');

module.exports = (win, profile) => {
  let server = null;

  // a finished agent with a result, fed through the app's own record as the next-actions test does
  const finished = require('./next-actions.main.js')(win, profile);

  return {
    finish: (...args) => finished.finish(...args),

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
