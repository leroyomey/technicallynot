// Technically Not tools · desktop-check/tests/agent-mesh.main.js — Main-process side of the
// agent-mesh test: fake `claude` / `codex` / `cursor-agent` CLIs (plain Node scripts, never the
// real CLIs, so no credits) put first on PATH after Technically Not's own shim folder, and a folder
// outside every open project.
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `// Fake agent CLI for the agent-mesh desktop test: reports what Technically Not passed it, echoes lines, runs "tnai ..." lines, "inject NAME" sends raw control characters, "quit" exits 7.
const net = require('net');
const [, , name, ...argv] = process.argv;
const has = f => argv.includes(f);
const val = f => argv[argv.indexOf(f) + 1] || '';
// Codex: Technically Not's work rules as developer_instructions in the profile file it names with -p (CODEX_HOME/<name>.config.toml).
let dev = ''; try { dev = has('-p') ? require('fs').readFileSync(require('path').join(process.env.CODEX_HOME || require('path').join(require('os').homedir(), '.codex'), val('-p') + '.config.toml'), 'utf8') : ''; } catch {}
// Claude Code: its appended system prompt arrives as a file (--append-system-prompt-file), never as a long argument.
let prompt = ''; try { prompt = require('fs').readFileSync(val('--append-system-prompt-file'), 'utf8'); } catch {}
// Cursor Agent: Technically Not's work rules as an always-applied rule in the --plugin-dir folder.
let rule = ''; try { rule = require('fs').readFileSync(require('path').join(val('--plugin-dir'), 'rules', 'tnai-work-rules.mdc'), 'utf8'); } catch {}
// ...and as the plugin's sessionStart hook, which prints the same text as additional_context (the route cursor-agent 2026.10.01 honors).
let hook = false; try { const P = require('path'), F = require('fs'), file = P.join(val('--plugin-dir'), 'hooks', 'context.json'); const ctx = JSON.parse(F.readFileSync(file, 'utf8')).additional_context; hook = JSON.parse(F.readFileSync(P.join(val('--plugin-dir'), 'hooks', 'hooks.json'), 'utf8')).hooks.sessionStart[0].command.includes(file) && /Technically Not report/.test(ctx) && /tnai agents/.test(ctx); } catch {}
if (name === 'cursor-agent') console.log('FAKE-cursor-agent rules=' + (/alwaysApply: true/.test(rule) && /Technically Not report/.test(rule) && /tnai agents/.test(rule) && hook));
console.log('FAKE-' + name + ' start settings=' + has('--settings') + ' mcp=' + has('--mcp-config') + ' prompt-hint=' + (/tnai agents/.test(prompt) && !has('--append-system-prompt')) +
  ' codex-hint=' + (/developer_instructions = '''/.test(dev) && /tnai agents/.test(dev)) + ' env-hint=' + /tnai agents/.test(process.env.TNAI_AGENTS_HINT || '') + ' tty=' + !!process.stdin.isTTY + ' node-mode=' + !!process.env.ELECTRON_RUN_AS_NODE);
if ((name !== 'codex' && has('-p')) || !process.stdin.isTTY) { console.log('FAKE-' + name + ' one-off'); process.exit(0); } // Technically Not's own CLI detection runs it without a console
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', raw => {
  const line = raw.replace(/\\x1b\\[20[01]~/g, '').trim();
  if (line === 'quit') process.exit(7);
  if (line.startsWith('tnai ')) { try { require('child_process').execSync(line, { stdio: 'inherit' }); } catch {} return; }
  if (line.startsWith('inject ')) {
    const s = net.connect(Number(process.env.TNAI_MESH_PORT), '127.0.0.1');
    s.on('connect', () => s.write(JSON.stringify({ token: process.env.TNAI_PANE_TOKEN, op: 'send', to: line.slice(7), text: 'X\\x1b[201~\\rINJECTED\\x07\\x03' }) + '\\n'));
    s.on('data', d => console.log('FAKE-' + name + ' inject reply ' + String(d).trim()));
    return;
  }
  console.log('FAKE-' + name + ' got: ' + JSON.stringify(line));
});
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-bin'),
    outside = path.join(profile, 'outside-folder');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake.js'), FAKE);
  const windows = process.platform === 'win32';
  for (const name of ['claude', 'codex', 'cursor-agent', 'gemini']) {
    if (windows)
      fs.writeFileSync(path.join(bin, name + '.cmd'), '@node "%~dp0fake.js" ' + name + ' %*\r\n');
    else
      fs.writeFileSync(
        path.join(bin, name),
        '#!/bin/sh\nexec node "$(dirname "$0")/fake.js" ' + name + ' "$@"\n',
        { mode: 0o755 }
      );
  }

  // Panes copy this PATH when they start: Technically Not's shim folder goes in front of it, so a
  // hand-typed `claude` reaches the shim, then this fake.
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  process.env[key] = bin + path.delimiter + process.env[key];
  return { paths: () => ({ bin, outside }) };
};
