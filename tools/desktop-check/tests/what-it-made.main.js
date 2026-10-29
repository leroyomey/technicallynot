// Technically Not tools · desktop-check/tests/what-it-made.main.js — main-process side of
// what-it-made.js: the fake `claude` CLI of agent-mesh.main.js put first on PATH (a plain Node
// script, never the real Claude Code, so nothing is spent and nothing waits for it to start; the
// real one stalled this test for up to 405 s, bug sweep 2026-10-28 item 12), the helpers of
// thread-designs.main.js (the files a made-up Claude Code transcript names, the transcript itself,
// the window's size, cleanup), plus a stand-in local site: a tiny HTTP server on a free port that
// the test can start and stop, so "running" and "stopped" are real answers of this computer.
'use strict';
const http = require('http');
const designs = require('./thread-designs.main.js');
const fakeCli = require('./agent-mesh.main.js');

module.exports = (win, profile) => {
  // The panel the test opens takes this PATH, so its `claude` is the fake one. The app still gives
  // it a session id (`--session-id`), which is where the made-up transcript is written.
  fakeCli(win, profile);
  const base = designs(win);
  let server = null;
  const stop = () =>
    new Promise(resolve => {
      if (!server) return resolve(true);
      server.close(() => resolve(true));
      server = null;
    });
  return {
    ...base,

    // on: start the stand-in site and answer its address; off: stop it and answer true
    async site(on) {
      await stop();
      if (!on) return true;
      server = http.createServer((request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>Pricing</title><h1>Pricing</h1>');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return 'http://localhost:' + server.address().port + '/';
    },
    async cleanup() {
      await stop();
      return base.cleanup();
    },
  };
};
