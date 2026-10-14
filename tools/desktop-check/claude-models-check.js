/*
 * Technically Not tools · desktop-check/claude-models-check.js — Claude Code's model list
 * (desktop/agent-registry.js claudeModels): the built-in list (with Sonnet 5.5) until the server's
 * GET /models/claude answers, then the server's list (a model added there shows up without an app
 * update); bad rows are ignored; model-pick matches names from the server list. A local fake server
 * stands in for api.technicallynot.ai. Run: node tools/desktop-check/claude-models-check.js
 */
'use strict';
const http = require('http');
let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  if (req.url !== '/models/claude') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      version: 1,
      models: [
        { id: 'claude-sonnet-6', label: 'Sonnet 6', group: 'Sonnet' },
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', group: 'Sonnet' },
        { id: 'rm -rf /', label: 'bad', group: 'x' },
        { id: 'claude-opus-5-5', label: 'x'.repeat(200), group: 'Opus' },
      ],
    })
  );
});
server.listen(0, '127.0.0.1', async () => {
  process.env.TNAI_ACCOUNTS_URL = 'http://127.0.0.1:' + server.address().port;
  try {
    const registry = require('../../desktop/agent-registry'),
      pick = require('../../desktop/model-pick');
    const first = (await registry.models('Claude Code')).models.map(m => m.id);
    check(
      first.includes('claude-sonnet-5-5') &&
        first.includes('claude-opus-5-5') &&
        !first.includes('claude-sonnet-6'),
      'first call: the built-in list (with Sonnet 5.5), no network wait'
    );
    await wait(300);
    const later = (await registry.models('Claude Code')).models.map(m => m.id);
    check(
      later.join() === 'claude-sonnet-6,claude-sonnet-5-5',
      'then the server list, bad rows dropped: ' + later.join()
    );
    const r = await pick.resolve('Claude Code', 'Sonnet 6', '');
    check(
      r.model === 'claude-sonnet-6',
      'a model only on the server can be picked by name: ' + JSON.stringify(r)
    );
  } catch (e) {
    check(false, 'threw: ' + (e.stack || e.message));
  }
  server.close();
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
});
