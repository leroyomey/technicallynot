/*
 * Technically Not tools · desktop-check/tests/discord-alerts.main.js — Main-process side of
 * discord-alerts.js's test: a fake Discord webhook on 127.0.0.1 (random port, never a real webhook)
 * that records every POST, the self-test-only switches of desktop/discord-alerts.js (local URL
 * allowed, window counted as away, a fixed agent name), events fed the way main.js feeds them, and
 * every main-process log line captured so the test can prove the URL never appears.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const alerts = require('../../../desktop/discord-alerts');

module.exports = () => {
  const requests = [],
    logs = [];
  let server = null,
    base = '',
    fail429 = 0;
  const TOKEN = 'fakeToken_' + 'x'.repeat(40);

  // Every console line in main from now on (the app's own logging included).
  for (const k of ['log', 'info', 'warn', 'error']) {
    const orig = console[k];
    console[k] = (...a) => {
      logs.push(a.map(String).join(' '));
      return orig.apply(console, a);
    };
  }
  for (const s of [process.stdout, process.stderr]) {
    const orig = s.write.bind(s);
    s.write = (chunk, ...a) => {
      logs.push(String(chunk));
      return orig(chunk, ...a);
    };
  }
  return {
    async install() {
      alerts._test.allowLocal(true);
      alerts._test.focused(() => false);
      alerts._test.reset();
      alerts.init({ owner: async () => ({ name: 'Umber' }) });
      for (const f of ['discord-alerts.json', 'discord-webhook.bin'])
        fs.rmSync(path.join(app.getPath('userData'), f), { force: true });
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', d => {
          body += d;
        });
        req.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {}
          requests.push({ method: req.method, url: req.url, json });
          if (fail429 > 0) {
            fail429--;
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ retry_after: 0.2, global: false }));
            return;
          }
          res.writeHead(204);
          res.end();
        });
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      base =
        'http://127.0.0.1:' + server.address().port + '/api/webhooks/123456789012345678/' + TOKEN;
      return { url: base, token: TOKEN };
    },
    requests: () => requests,
    fail429(n) {
      fail429 = n;
      return true;
    },
    event(channel, payload) {
      alerts.event(channel, payload);
      return true;
    },
    state: () => alerts.get(),
    // The real validator: a Discord https address is taken, the local one only while the self-test
    // switch is on, anything else never.
    validator() {
      const discord = 'https://discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(68);
      const out = {
        discord: alerts.set({ webhookUrl: discord }).ok,
        canary: alerts.set({
          webhookUrl: discord.replace('://discord.com', '://canary.discordapp.com'),
        }).ok,
        other: alerts.set({
          webhookUrl: 'https://example.com/api/webhooks/123456789012345678/' + 'a'.repeat(68),
        }).ok,
        plainHttp: alerts.set({ webhookUrl: discord.replace('https:', 'http:') }).ok,
      };
      alerts._test.allowLocal(false);
      out.localWhenOff = alerts.set({ webhookUrl: base }).ok;
      alerts._test.allowLocal(true);
      alerts.set({ webhookUrl: '' });
      return out;
    },
    files() {
      const dir = app.getPath('userData'),
        read = f => {
          try {
            return fs.readFileSync(path.join(dir, f), 'utf8');
          } catch {
            return '';
          }
        };
      return { config: read('discord-alerts.json'), secret: read('discord-webhook.bin') };
    },
    logs: () => logs.join('\n'),
    async close() {
      await new Promise(r => (server ? server.close(r) : r()));
      server = null;
      return true;
    },
  };
};
