// Checks that a new panel never inherits the markers of a Claude Code session the app itself was
// started from (desktop/pty-service.js panelEnvironment). A background-session marker
// (CLAUDE_CODE_SESSION_KIND=bg) makes Claude Code draw full-screen even with
// CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1, so the panel lost its scrollback.
// Run: node tools/panel-environment-test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelEnvironment } = require('../desktop/pty-service');

// What the app's own environment holds when it was started from a background session's tool.
const inherited = {
  PATH: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\someone',
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_KIND: 'bg',
  CLAUDE_CODE_SESSION_NAME: 'website',
  CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1',
  CLAUDE_JOB_DIR: 'C:\\Users\\someone\\.claude\\jobs\\abc',
  CLAUDE_BG_BACKEND: 'daemon',
  CLAUDE_BG_PTY_AUTH: 'secret',
  CLAUDE_BG_RENDEZVOUS_SOCK: '\\\\.\\pipe\\claude-bg',
};

const env = panelEnvironment(inherited);
const leftOver = Object.keys(env).filter(key => key.startsWith('CLAUDE'));
assert.deepStrictEqual(leftOver, [], 'session markers left in a panel: ' + leftOver.join(', '));
assert.strictEqual(env.PATH, inherited.PATH, 'ordinary variables are kept');
assert.strictEqual(env.USERPROFILE, inherited.USERPROFILE, 'ordinary variables are kept');
assert.strictEqual(inherited.CLAUDE_CODE_SESSION_KIND, 'bg', 'the source is not changed');
console.log('ok: a panel gets no Claude Code session markers, ordinary variables kept');

// The reason, read from the installed Claude Code (when it is there): the background marker is
// checked before the variable that turns full-screen off. If a newer Claude Code drops that rule,
// this says so, and the comment in pty-service.js should be brought up to date.
const claudeExe = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
if (!fs.existsSync(claudeExe)) {
  console.log('skipped: no Claude Code at ' + claudeExe);
} else {
  const program = fs.readFileSync(claudeExe, 'latin1');
  const rule = /CLAUDE_CODE_SESSION_KIND==="bg"\)return"bg_forced_on"/.test(program);
  console.log(
    rule
      ? 'ok: installed Claude Code still forces full-screen for a background session'
      : 'note: installed Claude Code no longer has the "bg_forced_on" rule'
  );
}
