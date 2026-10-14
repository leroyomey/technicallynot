/*
 * Technically Not tools · desktop-check/tests/composer-effort-keep.main.js — Main-process side of
 * composer-effort-keep.js: a FAKE `claude` (a plain Node script, never the real CLI, so no usage
 * and the user's sign-in is never touched) put first on PATH; it prints the arguments it was
 * started with. `turn()` plays one Claude Code task into the app's own turn reader
 * (desktop/agent-turns.js): the hook events plus the transcript lines a real reply writes, with the
 * effort the test names, none, or a sub-agent's own transcript at another effort.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const turns = require('../../../desktop/agent-turns');

const FAKE = `const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'first@example.com', authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0);
const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : 'none'; };
console.log('FAKE-claude model=' + at('--model') + ' effort=' + at('--effort') + ' .');
require('readline').createInterface({ input: process.stdin }).on('line', () => {});
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-claude-bin'),
    home = path.join(profile, 'fake-claude-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake-claude.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0fake-claude.js" %*\r\n');
  else
    fs.writeFileSync(
      path.join(bin, 'claude'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-claude.js" "$@"\n',
      { mode: 0o755 }
    );
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  const rest = process.env[key]
    .split(path.delimiter)
    .filter(dir => dir && !fs.existsSync(path.join(dir, 'claude.exe')));
  process.env[key] = [bin, ...rest].join(path.delimiter);
  process.env.CLAUDE_CONFIG_DIR = home;
  let n = 0;
  const line = (effort, at) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(at || Date.now()).toISOString(),
      ...(effort ? { effort, perTurnEffort: effort } : {}),
      message: {
        id: 'msg_fake_' + ++n,
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    }) + '\n';
  return {
    // One task in that panel. effort: what the lead's reply reports ('' = the reply names none).
    // sub: a sub-agent ran in the task and its own transcript reports this effort. at: the reply's
    // timestamp (ms), for a reply older than a pick.
    async turn(paneId, { effort = '', sub = '', at = 0 } = {}) {
      const tx = path.join(home, 'tx-' + String(paneId).replace(/[^a-zA-Z0-9_-]/g, '') + '.jsonl');
      if (!fs.existsSync(tx)) fs.writeFileSync(tx, '');
      const hook = h => turns.claudeHook(paneId, { transcript_path: tx, ...h });
      hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] fake task ' + n });
      if (sub) {
        const id = 'sub' + ++n,
          file = path.join(home, 'agent-' + id + '.jsonl');
        fs.writeFileSync(file, line(sub));
        hook({
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: {},
          agent_id: id,
          agent_transcript_path: file,
        });
        hook({ hook_event_name: 'SubagentStop', agent_id: id, agent_transcript_path: file });
      }
      fs.appendFileSync(tx, line(effort, at));
      hook({ hook_event_name: 'Stop', last_assistant_message: 'done' });
      const t = turns.state().find(x => x.paneId === paneId);
      return { effort: t?.effort || '', effortAt: t?.effortAt || 0, ended: !!t?.endedAt };
    },
  };
};
