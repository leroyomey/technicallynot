/*
 * Technically Not tools · desktop-check/tests/skill-use.main.js — Main-process side of
 * skill-use.js: seeds two project skills (one found by prompt keywords, one that owns `src/**`
 * through `paths:`) and plays recorded Claude Code hook payloads over HTTP to the real
 * desktop/agent-hooks.js server, as a running session would. Returns the additionalContext each
 * hook answered with. No CLI runs and no prompt is sent (no usage).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

module.exports = (win, profile) => {
  const project = path.join(profile, 'sample-project');
  const skill = (name, meta) => {
    const d = path.join(project, '.claude', 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'SKILL.md'),
      '---\nname: ' + name + '\n' + meta + '\n---\nSteps.\n'
    );
  };
  skill(
    'demo-sparkle',
    'description: Rules for sparkle buttons.\nkeywords: sparkle button, sparkle'
  );
  skill('demo-owner', 'description: Rules for the app source.\npaths: src/**');
  const hooks = require('../../../desktop/agent-hooks');
  const post = (url, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        res => {
          let t = '';
          res.on('data', c => (t += c));
          res.on('end', () => resolve(t));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  return {
    // events: hook payloads in Claude Code's shape; -> the additionalContext text of each answer
    // ('' = none).
    async play(paneId, events) {
      await hooks.launchOptions(paneId, 'Claude Code');
      const url = hooks.endpoint(paneId).hook,
        out = [];
      for (const e of events) {
        const text = await post(url, { session_id: 'skill-use-test', cwd: project, ...e });
        out.push(JSON.parse(text || '{}').hookSpecificOutput?.additionalContext || '');
      }
      return out;
    },
    done(paneId) {
      hooks.forget(paneId);
      return true;
    },
  };
};
