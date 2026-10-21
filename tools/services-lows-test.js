// Test of the small fixes from the 2026-10-07 audit, report app-5 (services) and app-4 #5:
// node tools/services-lows-test.js
//
// Each part fails on the code before its fix:
// - #13 the question detector takes the line ending in "?" above a numbered menu, not one ending
//   in "?s" (desktop/attention-service.js)
// - #5 a skill named `__proto__` stays an ordinary row (desktop/skill-stats.js)
// - #6 a `paths:` pattern full of `**` cannot stall a file match (desktop/skill-triggers.js)
// - #8 a broken sessions.json is moved aside, not overwritten (desktop/session-store.js)
// - #9 the Discord line names only the tool of a permission request and masks secrets
//   (desktop/discord-alerts.js)
// - #11 a CLI update whose panel stop fails does not stay "is updating…", and one over the time
//   limit leaves its panels stopped (src/scripts/60-bell-notices.js, run in a stand-in window)
// - app-4 #5 the code highlighter escapes quotes (src/scripts/20-code-highlight.js)
// Plain Node, no window, no agent. LOWS_ROOT points the test at another copy of the project.
'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.LOWS_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-lows-'));

// electron is a stand-in: userData is the temp folder, encryption is plain text
const load = Module._load;
Module._load = (request, ...rest) =>
  request === 'electron'
    ? {
        app: { getPath: () => tmp, isPackaged: false },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: s => Buffer.from(s),
          decryptString: b => b.toString(),
        },
      }
    : load(request, ...rest);
process.env.TNAI_SELFTEST = '1';

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const desktop = name => require(path.join(ROOT, 'desktop', name));

(async () => {
  // ---- #13: the line above the options ----
  const attention = desktop('attention-service.js');
  const screen = [
    'Which file should it open?',
    'it said yes',
    'There is more to read: s',
    'notes?s',
    '❯ 1. First',
    '  2. Second',
  ].join('\n');
  const asked = attention._test.detectQuestion(screen);
  check(
    '#13 the question line is the one ending in "?" or ":", not "?s"',
    asked && !/\?s$/.test(asked.detail),
    asked
  );

  // ---- #5: a skill named __proto__ ----
  const stats = desktop('skill-stats.js');
  stats.init({ dir: tmp });
  stats.tool('p1', { tool_name: 'Skill', tool_input: { skill: '__proto__' } });
  stats.tool('p1', { tool_name: 'Read', tool_input: { file_path: 'x/__proto__/SKILL.md' } });
  check('#5 Object.prototype untouched', !('read' in {}) && !('readAt' in {}), Object.keys({}));
  delete Object.prototype.read;
  delete Object.prototype.readAt;

  // ---- #6: a pattern full of ** ----
  const triggers = desktop('skill-triggers.js');
  const bad = triggers._test.globRegex('**a**a**a**a**a**a**a**a**b');
  const started = Date.now();

  // 32 letters: the old pattern took about a second here (and grows five times per 4 letters, so
  // never more in a test: it would load the PC); the fixed one answers at once
  bad.test('a'.repeat(32));
  const took = Date.now() - started;
  check('#6 a pattern of many ** answers at once', took < 50, took + ' ms');
  const normal = [
    ['src/styles/**', 'src/styles/a/b.css', true],
    ['.claude/skills/**/SKILL.md', '.claude/skills/x/SKILL.md', true],
    ['src/**/*.test.*', 'src/a/b.test.js', true],
    ['tools/', 'tools/a.js', true],
    ['*.md', 'a/b.md', false],
    ['src/***', 'src/a/b', true],
  ];
  for (const [glob, file, want] of normal)
    check(
      '#6 ' + glob + ' still matches as before',
      triggers._test.globRegex(glob).test(file) === want
    );

  // ---- #8: a broken sessions.json ----
  fs.writeFileSync(path.join(tmp, 'sessions.json'), '[{"paneId": "p1", "agent');
  const sessions = desktop('session-store.js');
  const warn = console.warn;
  console.warn = () => {};
  sessions.init();
  console.warn = warn;
  const aside = fs.readdirSync(tmp).filter(n => /^sessions\.broken-\d+\.json$/.test(n));
  check(
    '#8 the broken file is moved aside with its text',
    aside.length === 1 &&
      fs.readFileSync(path.join(tmp, aside[0]), 'utf8') === '[{"paneId": "p1", "agent',
    fs.readdirSync(tmp)
  );

  // ---- #9: the Discord line ----
  const discord = desktop('discord-alerts.js')._test;
  check(
    '#9 a permission request names only its tool',
    discord.needsYouLine({
      kind: 'permission',
      tool: 'Bash',
      detail: 'Bash: curl -H "Authorization: Bearer abc"',
    }) === 'Bash'
  );
  check(
    '#9 a permission item without a tool keeps the part before ":"',
    discord.needsYouLine({ kind: 'permission', detail: 'Bash: npm test' }) === 'Bash'
  );
  const masked = discord.hideSecrets(
    'deploy with token=sk-live-abc and key ghp_1234567890abcdefghijABCDEFGHIJ, Bearer xyz'
  );
  check(
    '#9 secrets are masked in the task line',
    !/sk-live|ghp_|xyz/.test(masked) && /deploy with token=••••/.test(masked),
    masked
  );
  check(
    '#9 plain words and file paths stay',
    discord.hideSecrets('fix the key binding in src/scripts/11-agents-live.js') ===
      'fix the key binding in src/scripts/11-agents-live.js'
  );

  // ---- #11: a CLI update in a stand-in window ----
  const bell = fs.readFileSync(path.join(ROOT, 'src', 'scripts', '60-bell-notices.js'), 'utf8');

  async function runUpdate({ stopFails }) {
    const notices = new Map(),
      toasts = [];
    let restarted = 0,
      onState = null,
      onData = null;
    const win = {
      toast: m => toasts.push(m),
      tnaiPlatform: { win: true },
      TnaiNextActions: {
        notify: n => notices.set(n.key, n),
        unnotify: k => notices.delete(k),
      },
      tnaiNative: {
        cliUpdates: {
          onState: fn => (onState = fn),
          state: async () => ({}),
          check: async () => null,
        },
        pty: { onData: fn => ((onData = fn), () => {}) },
      },
      TnaiAgents: {
        sessions: () => [{ agent: 'codex', paneId: 'p1', running: true, status: 'idle' }],
        stop: async () => {
          if (stopFails) throw new Error('stop failed');
        },
        open: async () => {
          onData({ paneId: 't1', data: 'PS C:\\> ' });
          return { ok: true, paneId: 't1' };
        },
        restart: async () => {
          restarted++;
        },
        send: () => {},
      },
    };
    const sandbox = {
      window: win,
      document: { querySelector: () => null },
      CSS: { escape: s => s },
      Promise,
      Set,
      Map,
      Number,
      String,
      Date,
      // the 15-minute limit fires at once
      setTimeout: (fn, ms) => setTimeout(fn, ms >= 60000 ? 0 : ms),
    };
    Object.assign(sandbox, win);
    sandbox.window = sandbox;
    vm.runInNewContext(bell, sandbox);
    onState({ updates: [{ id: 'codex', installed: '1', latest: '2', command: 'npm i -g x' }] });
    try {
      await notices.get('cli:codex').action.run();
    } catch {}
    await new Promise(r => setTimeout(r, 30));
    return { title: notices.get('cli:codex')?.title || '', restarted, toasts };
  }
  const stopFailed = await runUpdate({ stopFails: true });
  check(
    '#11 a failed stop gives the Update button back',
    /is available$/.test(stopFailed.title),
    stopFailed.title
  );
  const overTime = await runUpdate({ stopFails: false });
  check(
    '#11 over the time limit the panels stay stopped and the user is told',
    overTime.restarted === 0 && overTime.toasts.some(t => /still updating/.test(t)),
    overTime
  );

  // ---- app-4 #5: the code highlighter escapes quotes ----
  const highlight = fs.readFileSync(
    path.join(ROOT, 'src', 'scripts', '20-code-highlight.js'),
    'utf8'
  );
  const escLine = highlight.match(/const esc = s =>[\s\S]*?;\r?\n/)?.[0] || '';
  const escSource = '(' + escLine.replace('const esc =', '').replace(/;\r?\n$/, '') + ')';
  const esc = vm.runInNewContext(escSource);
  check(
    'app-4 #5 esc() escapes both quotes',
    esc(`a"b'c<`) === 'a&quot;b&#39;c&lt;',
    esc(`a"b'c<`)
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('FAIL threw: ' + (error?.stack || error));
  process.exit(1);
});
