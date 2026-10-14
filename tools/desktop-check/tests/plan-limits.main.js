/*
 * Technically Not tools · desktop-check/tests/plan-limits.main.js — Fixtures for plan limits
 * (desktop/plan-limits.js, 80-plan-limits.js): a Claude Code config folder with a sign-in file
 * whose usage request goes to a local server here (TNAI_CLAUDE_USAGE_URL: 47% session, 91% week),
 * and a Codex session file with a rate_limits reading (84% of a weekly window). Set before the
 * window loads. TNAI_MAIN asks() = how many usage requests arrived; fail(on) makes the usage server
 * answer 500 (Claude Code reading unavailable).
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

module.exports = (win, profile) => {
  const root = path.join(profile, 'limit-fixtures'),
    claudeHome = path.join(root, 'claude'),
    codexDay = path.join(root, 'codex', '2026', '09', '27');
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.mkdirSync(codexDay, { recursive: true });
  fs.writeFileSync(
    path.join(claudeHome, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: 'test-token',
        expiresAt: Date.now() + 3600e3,
        subscriptionType: 'max',
      },
    })
  );
  const now = Date.now(),
    iso = ms => new Date(ms).toISOString();
  fs.writeFileSync(
    path.join(codexDay, 'rollout-2026-09-27T08-00-00-lim.jsonl'),
    JSON.stringify({
      type: 'event_msg',
      timestamp: iso(now - 60e3),
      payload: {
        type: 'token_count',
        info: null,
        rate_limits: {
          primary: {
            used_percent: 84,
            window_minutes: 10080,
            resets_at: Math.floor(now / 1000) + 2 * 86400,
          },
          secondary: null,
          plan_type: 'plus',
        },
      },
    }) + '\n'
  );
  let asks = 0,
    auth = '',
    fail = false;
  const server = http
    .createServer((req, res) => {
      asks++;
      auth = req.headers.authorization || '';
      if (fail) {
        res.statusCode = 500;
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          five_hour: { utilization: 47, resets_at: iso(now + 2 * 3600e3) },
          seven_day: { utilization: 91, resets_at: iso(now + 3 * 86400e3) },
          seven_day_opus: null,
        })
      );
    })
    .listen(0, '127.0.0.1');
  const port = () => server.address().port;

  // listen(0) binds synchronously enough for address() on the next tick; the window loads later
  // than that.
  process.env.TNAI_USAGE_ROOTS = JSON.stringify({
    claude: path.join(root, 'none'),
    codex: path.join(root, 'codex'),
    claudeHome,
  });
  server.on('listening', () => {
    process.env.TNAI_CLAUDE_USAGE_URL = 'http://127.0.0.1:' + port() + '/api/oauth/usage';
  });
  return {
    asks: () => ({ asks, auth }),
    fail: on => {
      fail = !!on;
      return fail;
    },
  };
};
