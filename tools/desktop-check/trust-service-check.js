// Logic check for desktop/trust-service.js (plain Node): node
// tools/desktop-check/trust-service-check.js Uses temporary account homes and project folders only;
// never the real ~/.codex, ~/.claude.json or ~/.cursor.
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  assert = require('assert');
const t = require('../../desktop/trust-service');

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-trust-')));
const mk = (...p) => {
  const d = path.join(root, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const count = (text, s) => text.split(s).length - 1;
(async () => {
  try {
    const proj = mk('work', 'My Project'),
      fwd = proj.replace(/\\/g, '/');

    // Claude Code: account home = CLAUDE_CONFIG_DIR folder holding .claude.json.
    const ch = mk('claude-home');
    fs.writeFileSync(
      path.join(ch, '.claude.json'),
      JSON.stringify(
        {
          numStartups: 3,
          projects: { 'C:/other': { allowedTools: ['x'], hasTrustDialogAccepted: true } },
        },
        null,
        2
      )
    );
    assert.deepStrictEqual(
      await t.needs('Claude Code', proj, ch),
      { needed: true, label: 'Claude Code' },
      'claude: untrusted asks'
    );
    assert.deepStrictEqual(await t.grant('Claude Code', proj, ch), { ok: true });
    let j = JSON.parse(fs.readFileSync(path.join(ch, '.claude.json'), 'utf8'));
    assert.strictEqual(j.projects[fwd].hasTrustDialogAccepted, true, 'claude: forward-slash key');
    assert.strictEqual(j.numStartups, 3);
    assert.deepStrictEqual(
      j.projects['C:/other'].allowedTools,
      ['x'],
      'claude: unrelated content kept'
    );
    assert.strictEqual((await t.needs('Claude Code', proj, ch)).needed, false);
    const before = fs.readFileSync(path.join(ch, '.claude.json'), 'utf8');
    await t.grant('Claude Code', proj, ch);
    assert.strictEqual(
      fs.readFileSync(path.join(ch, '.claude.json'), 'utf8'),
      before,
      'claude: grant twice changes nothing'
    );
    assert.strictEqual(
      (await t.needs('Claude Code', mk('work', 'My Project', 'sub'), ch)).needed,
      false,
      'claude: trusted parent counts'
    );
    const ch2 = mk('claude-empty'); // missing file tolerated
    assert.strictEqual((await t.grant('Claude Code', proj, ch2)).ok, true);
    assert.strictEqual(t.granted('Claude Code', proj, ch2), true);

    // Claude Code: inside a git repo the root is saved, and trust doesn't pass down from above the
    // repo.
    const repo = mk('work', 'repo');
    mk('work', 'repo', '.git');
    const inRepo = mk('work', 'repo', 'pkg');
    const ch3 = mk('claude-git');
    fs.writeFileSync(
      path.join(ch3, '.claude.json'),
      JSON.stringify({
        projects: { [path.dirname(repo).replace(/\\/g, '/')]: { hasTrustDialogAccepted: true } },
      })
    );
    assert.strictEqual(
      (await t.needs('Claude Code', inRepo, ch3)).needed,
      true,
      'claude: parent above the git root does not count'
    );
    await t.grant('Claude Code', inRepo, ch3);
    assert.ok(
      JSON.parse(fs.readFileSync(path.join(ch3, '.claude.json'), 'utf8')).projects[
        repo.replace(/\\/g, '/')
      ],
      'claude: git root key'
    );

    // Codex: account home = CODEX_HOME folder holding config.toml.
    const xh = mk('codex-home'),
      toml = path.join(xh, 'config.toml');
    fs.writeFileSync(
      toml,
      'model = "gpt-5"\r\n\r\n[projects.\'c:\\other\']\r\ntrust_level = "trusted"\r\n'
    );
    assert.deepStrictEqual(
      await t.needs('Codex', proj, xh),
      { needed: true, label: 'Codex' },
      'codex: untrusted asks'
    );
    assert.deepStrictEqual(await t.grant('Codex', proj, xh), { ok: true });
    let text = fs.readFileSync(toml, 'utf8');
    assert.ok(
      text.includes("[projects.'" + proj.toLowerCase() + '\']\r\ntrust_level = "trusted"'),
      'codex: lowercased key, file line endings'
    );
    assert.ok(
      text.startsWith('model = "gpt-5"\r\n\r\n[projects.\'c:\\other\']'),
      'codex: unrelated content kept'
    );
    assert.strictEqual((await t.needs('Codex', proj, xh)).needed, false);
    await t.grant('Codex', proj, xh);
    assert.strictEqual(
      count(fs.readFileSync(toml, 'utf8'), proj.toLowerCase()),
      1,
      'codex: no duplicate'
    );
    assert.strictEqual(
      (await t.needs('Codex', mk('work', 'My Project', 'sub'), xh)).needed,
      true,
      'codex: a plain parent does not count'
    );
    await t.grant('Codex', inRepo, xh);
    assert.ok(
      fs.readFileSync(toml, 'utf8').includes("[projects.'" + repo.toLowerCase() + "']"),
      'codex: git root key'
    );
    assert.strictEqual(
      (await t.needs('Codex', inRepo, xh)).needed,
      false,
      'codex: trusted repo root covers subfolders'
    );
    fs.writeFileSync(toml, "[projects.'" + proj.toLowerCase() + '\']\nmodel = "x"\n');
    await t.grant('Codex', proj, xh);
    assert.strictEqual(
      fs.readFileSync(toml, 'utf8'),
      "[projects.'" + proj.toLowerCase() + '\']\ntrust_level = "trusted"\nmodel = "x"\n',
      'codex: fills an existing table'
    );
    const xh2 = mk('codex-empty');
    assert.strictEqual((await t.grant('Codex', proj, xh2)).ok, true);
    assert.strictEqual(t.granted('Codex', proj, xh2), true, 'codex: missing file');

    // Cursor Agent: marker in <data dir>/projects/<slug>/.workspace-trusted (accountDir stands in
    // for CURSOR_DATA_DIR here).
    const cu = mk('cursor-data');
    mk('cursor-data', 'projects', 'unrelated');
    fs.writeFileSync(path.join(cu, 'projects', 'unrelated', 'keep.txt'), 'x');
    assert.deepStrictEqual(await t.needs('Cursor Agent', proj, cu), {
      needed: true,
      label: 'Cursor Agent',
    });
    assert.strictEqual(t.granted('Cursor Agent', proj, cu), false);
    assert.deepStrictEqual(await t.grant('Cursor Agent', proj, cu), { ok: true });
    const marker = path.join(
      cu,
      'projects',
      proj
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, ''),
      '.workspace-trusted'
    );
    const m1 = fs.readFileSync(marker, 'utf8');
    assert.strictEqual(JSON.parse(m1).workspacePath, proj);
    assert.ok(fs.existsSync(path.join(cu, 'projects', 'unrelated', 'keep.txt')));
    assert.strictEqual(t.granted('Cursor Agent', proj, cu), true);
    assert.strictEqual((await t.needs('Cursor Agent', proj, cu)).needed, false);
    await t.grant('Cursor Agent', proj, cu);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), m1, 'cursor: grant twice changes nothing');
    assert.strictEqual(
      t.granted('Cursor Agent', mk('work', 'My Project', 'sub'), cu),
      true,
      'cursor: trusted parent counts'
    );

    // Gemini CLI: trustedFolders.json in a temporary GEMINI_CLI_HOME (its lowercased forward-slash
    // keys; a trusted parent or TRUST_PARENT counts).
    process.env.GEMINI_CLI_HOME = mk('gemini-home');
    const gfile = path.join(process.env.GEMINI_CLI_HOME, '.gemini', 'trustedFolders.json');
    assert.strictEqual(
      (await t.needs('Gemini CLI', proj, '')).needed,
      true,
      'gemini: no file asks'
    );
    assert.deepStrictEqual(await t.grant('Gemini CLI', proj, ''), { ok: true });
    const g1 = fs.readFileSync(gfile, 'utf8');
    assert.strictEqual(JSON.parse(g1)[fwd.toLowerCase()], 'TRUST_FOLDER');
    await t.grant('Gemini CLI', proj, '');
    assert.strictEqual(fs.readFileSync(gfile, 'utf8'), g1, 'gemini: grant twice changes nothing');
    assert.strictEqual(
      t.granted('Gemini CLI', mk('work', 'My Project', 'sub'), ''),
      true,
      'gemini: trusted parent counts'
    );
    const other = mk('work', 'Other', 'child');
    fs.writeFileSync(
      gfile,
      JSON.stringify({ [other.replace(/\\/g, '/').toLowerCase()]: 'TRUST_PARENT' })
    );
    assert.strictEqual(
      t.granted('Gemini CLI', mk('work', 'Other', 'sibling'), ''),
      true,
      'gemini: TRUST_PARENT trusts the parent folder'
    );
    fs.writeFileSync(
      path.join(process.env.GEMINI_CLI_HOME, '.gemini', 'settings.json'),
      '// c\n{ "security": { "folderTrust": { "enabled": false } } }'
    );
    assert.strictEqual(
      t.granted('Gemini CLI', mk('elsewhere'), ''),
      true,
      'gemini: folder trust off never asks'
    );
    delete process.env.GEMINI_CLI_HOME;

    // GitHub Copilot: trustedFolders in a temporary COPILOT_HOME's config.json, keeping its //
    // comment header.
    process.env.COPILOT_HOME = mk('copilot-home');
    const cfile = path.join(process.env.COPILOT_HOME, 'config.json'),
      head = '// User settings belong in settings.json.\n// This file is managed automatically.\n';
    fs.writeFileSync(cfile, head + '{\n  "firstLaunchAt": "x"\n}\n');
    assert.strictEqual(
      (await t.needs('GitHub Copilot', proj, '')).needed,
      true,
      'copilot: not listed asks'
    );
    assert.deepStrictEqual(await t.grant('GitHub Copilot', proj, ''), { ok: true });
    const c1 = fs.readFileSync(cfile, 'utf8');
    assert.ok(c1.startsWith(head), 'copilot: comment header kept');
    assert.deepStrictEqual(JSON.parse(c1.slice(head.length)), {
      firstLaunchAt: 'x',
      trustedFolders: [proj],
    });
    await t.grant('GitHub Copilot', proj, '');
    assert.strictEqual(fs.readFileSync(cfile, 'utf8'), c1, 'copilot: grant twice changes nothing');
    assert.strictEqual(
      t.granted('GitHub Copilot', mk('work', 'My Project', 'sub'), ''),
      true,
      'copilot: trusted parent counts'
    );
    delete process.env.COPILOT_HOME;

    // CLIs without a (verified) folder-trust question.
    for (const id of ['OpenCode', 'Droid']) {
      assert.deepStrictEqual(await t.needs(id, proj, ''), { needed: false, label: id });
      assert.deepStrictEqual(await t.grant(id, proj, ''), { ok: true });
    }
    assert.ok(
      !fs.readdirSync(root, { recursive: true }).some(f => /\.tmp$/.test(f)),
      'no temp files left'
    );
    console.log('OK: trust-service');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
