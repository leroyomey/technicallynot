/*
 * Technically Not tools · desktop-check/tests/api-keys.main.js — Main-process side of the API-key
 * self-test: a local stand-in for Anthropic's API that records only the
 * last 6 characters of the x-api-key it receives, and read-only looks at the files an API-key
 * account leaves on disk. The key used is fake; nothing reaches a real provider.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

module.exports = (win, profile) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))?.[1] || '';
    seen.push({
      method: req.method,
      url: req.url,
      key: req.headers['x-api-key'] ? String(req.headers['x-api-key']).slice(-6) : '',
      bearer: bearer ? bearer.slice(-6) : '',
    });
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'
    );
  });
  const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const userData = require('electron').app.getPath('userData');
  return {
    // Agent panels inherit the main process environment: point Claude Code at the stand-in before
    // any panel starts.
    async startServer() {
      await ready;
      process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + server.address().port;
      return true;
    },
    requests: () => seen.slice(),

    // The last lines the app's question matcher reads for a panel, and what it makes of them.
    question(paneId) {
      const attention = require('../../../desktop/attention-service');
      const tail = attention._test.tail(paneId);
      const lines = attention._test
        .screenText(tail.slice(-6000))
        .split('\n')
        .map(line => line.trim())
        .filter(line => /[\p{L}\p{N}]/u.test(line))
        .slice(-15);
      return { found: attention._test.detectQuestion(tail), lines };
    },
    // Points a Codex API-key account's provider at the stand-in (the app writes api.openai.com
    // there), and answers Codex's one-time Windows sandbox question the way the user's own Codex
    // home has (a fresh Codex home asks it before anything else).
    codexToStandIn(dir) {
      const file = path.join(dir, 'config.toml');
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace(
            'https://api.openai.com/v1',
            'http://127.0.0.1:' + server.address().port + '/v1'
          ) + ['', '[windows]', 'sandbox = "unelevated"', ''].join(String.fromCharCode(10))
      );
      return true;
    },
    // Stands in for the user answering Claude Code's folder-trust question for the test project in
    // this account.
    trustProject(dir) {
      const file = path.join(dir, '.claude.json'),
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.projects = {
        ...(data.projects || {}),
        [path.join(profile, 'sample-project').replace(/\\/g, '/')]: {
          hasTrustDialogAccepted: true,
        },
      };
      fs.writeFileSync(file, JSON.stringify(data));
      return true;
    },
    // What is on disk, without handing back the key: whether the encrypted store holds the key in
    // plain text, and the account files' relevant parts.
    disk(dir, key) {
      const bin = path.join(userData, 'api-keys.bin'),
        exists = fs.existsSync(bin);
      const read = f => {
        try {
          return fs.readFileSync(f, 'utf8');
        } catch {
          return '';
        }
      };
      const claude = read(path.join(dir, '.claude.json')),
        codex = read(path.join(dir, 'config.toml'));
      const everywhere = [
        exists ? fs.readFileSync(bin).toString('latin1') : '',
        read(path.join(userData, 'accounts.json')),
        codex,
      ].join('\n');
      let approved = [],
        onboarded = false;
      try {
        const j = JSON.parse(claude);
        approved = j.customApiKeyResponses?.approved || [];
        onboarded = j.hasCompletedOnboarding === true;
      } catch {}
      return {
        binExists: exists,
        plainKeyStored: everywhere.includes(key),
        claudeApprovedLast20: approved.includes(key.slice(-20)),
        claudeHasWholeKey: claude.includes(key),
        onboarded,
        codexConfig: codex,
      };
    },
    // The panel records Technically Not keeps (session-store) must never hold a key.
    recordsHold(key) {
      const hits = [];
      const walk = d => {
        let names = [];
        try {
          names = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const n of names) {
          const f = path.join(d, n.name);
          if (n.isDirectory()) {
            if (!/agent-accounts|Cache|GPU|blob_storage|Code Cache/i.test(n.name)) walk(f);
          } else {
            try {
              if (fs.statSync(f).size < 5e6 && fs.readFileSync(f).toString('latin1').includes(key))
                hits.push(path.relative(userData, f));
            } catch {}
          }
        }
      };
      walk(userData);
      return hits;
    },
  };
};
