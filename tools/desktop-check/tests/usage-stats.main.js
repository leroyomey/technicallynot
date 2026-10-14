/*
 * Technically Not tools · desktop-check/tests/usage-stats.main.js — Fixture logs for Settings ›
 * Usage (59-usage-stats.js / desktop/usage-stats.js): a small Claude Code project.jsonl (one
 * session that crosses the compacting threshold, one session that doesn't, two models) and a Codex
 * rollout.jsonl (one full turn), written into the test's own temp profile, with TNAI_USAGE_ROOTS
 * pointed at them so usage-stats.js reads these instead of the real ~/.claude and ~/.codex folders.
 * Set once, synchronously, before the window loads — usage-stats.js re-reads the env var on every
 * call. TNAI_MAIN size(w, h) resizes the window for the layout screenshots.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (win, profile) => {
  const claudeRoot = path.join(profile, 'usage-fixtures', 'claude-projects');
  const codexRoot = path.join(profile, 'usage-fixtures', 'codex-sessions');
  const claudeProjectDir = path.join(claudeRoot, 'my-project');
  const codexDayDir = path.join(codexRoot, '2024', '01', '01');
  fs.mkdirSync(claudeProjectDir, { recursive: true });
  fs.mkdirSync(codexDayDir, { recursive: true });

  const today = new Date();
  const iso = (daysAgo, hour) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  // Claude Code: session s1 (today) has three turns;
  // session s2 (yesterday, a different model) stays small. Both feed the same project's usage
  // totals.
  const claudeLine = (id, ts, model, sessionId, usage) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      sessionId,
      cwd: 'C:\\x\\usage-proj',
      requestId: 'r-' + id,
      message: { id: 'm-' + id, model, usage },
    });
  const claudeLines = [
    claudeLine(1, iso(0, 9), 'claude-opus-5-5', 's1', {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 2000,
      cache_read_input_tokens: 1000,
    }),
    claudeLine(2, iso(0, 10), 'claude-opus-5-5', 's1', {
      input_tokens: 1200,
      output_tokens: 600,
      cache_creation_input_tokens: 200000,
      cache_read_input_tokens: 500,
    }),
    claudeLine(3, iso(0, 11), 'claude-opus-5-5', 's1', {
      input_tokens: 1000,
      output_tokens: 400,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 190000,
    }),
    claudeLine(4, iso(1, 9), 'claude-sonnet-5', 's2', {
      input_tokens: 800,
      output_tokens: 300,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 50,
    }),
    // 40 days ago: only gives the Sessions card an earlier period of re-read tokens to compare with
    // (small enough to leave the model order alone).
    claudeLine(5, iso(40, 9), 'claude-sonnet-5', 's0', {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 100000,
    }),
  ];
  fs.writeFileSync(
    path.join(claudeProjectDir, 'usage-session.jsonl'),
    claudeLines.join('\n') + '\n'
  );

  // Codex: one turn (task_started .. task_complete), a different project and model.
  const codexLines = [
    JSON.stringify({
      type: 'session_meta',
      timestamp: iso(2, 8),
      payload: { session_id: 'cx1', cwd: 'C:\\x\\usage-proj2' },
    }),
    JSON.stringify({
      type: 'turn_context',
      timestamp: iso(2, 8),
      payload: { model: 'gpt-5-codex' },
    }),
    JSON.stringify({ type: 'event_msg', timestamp: iso(2, 8), payload: { type: 'task_started' } }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: iso(2, 9),
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 1000,
            output_tokens: 900,
            cache_write_input_tokens: 300,
          },
        },
        rate_limits: {
          primary: {
            used_percent: 84,
            window_minutes: 10080,
            resets_at: Math.floor(Date.now() / 1000) + 2 * 86400,
          },
          secondary: null,
          plan_type: 'plus',
        },
      },
    }),
    JSON.stringify({ type: 'event_msg', timestamp: iso(2, 9), payload: { type: 'task_complete' } }),
  ];
  fs.writeFileSync(
    path.join(codexDayDir, 'rollout-2024-01-01T08-00-00-cx1.jsonl'),
    codexLines.join('\n') + '\n'
  );

  // no .credentials.json: Plan limits shows Claude Code as not signed in, no request is made
  const claudeHome = path.join(profile, 'usage-fixtures', 'claude-home');
  fs.mkdirSync(claudeHome, { recursive: true });
  process.env.TNAI_USAGE_ROOTS = JSON.stringify({
    claude: claudeRoot,
    codex: codexRoot,
    claudeHome,
  });
  return {
    size: (w, h) => {
      win.setMinimumSize(800, 600);
      win.setContentSize(w, h);
      return true;
    },
  }; // layout checks at other window sizes
};
