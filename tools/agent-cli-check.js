// Checks Technically Not's agent CLI integrations against what is actually installed, so a new CLI
// or CLI version can be vetted in one command. Reuses desktop/agent-registry.js (the same
// detection/launch data Technically Not itself uses) instead of keeping a second list of CLIs,
// flags, and env vars. Never prompts a CLI or starts an interactive sign-in: only --version/--help,
// the same non-interactive status commands Technically Not runs at startup, and debug/render
// commands confirmed not to call a model (`codex debug prompt-input`, `opencode debug config`, and
// the skill listings in SKILLS_LIST). Also compares each installed version with the last one we
// verified (tools/agent-cli-versions.json) and flags a CLI with no release feed in
// agent-registry.js RELEASES. --mark-tested records the installed versions of every CLI that passed
// with no gaps as the new "tested" ones. Run: node tools/agent-cli-check.js [cliName]
// [--mark-tested]
'use strict';
const { execFile } = require('child_process');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const registry = require('../desktop/agent-registry');

const args = process.argv.slice(2),
  markTested = args.includes('--mark-tested'),
  want = args.find(a => !a.startsWith('--'));
const TESTED_FILE = path.join(__dirname, 'agent-cli-versions.json');
const readTested = () => {
  try {
    return JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  } catch {
    return {};
  }
};
const semver = t => (String(t || '').match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1, 4).map(Number);
const newerThan = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
};
const MARK = 'TNAI_CHECK_' + process.pid + '_' + Date.now();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-cli-check-'));

// .cmd/.bat shims (npm global installs) need one pre-quoted cmd.exe command line, same as
// agent-registry.js launchSpec.
function launch(file, args) {
  return /\.(cmd|bat)$/i.test(file)
    ? {
        file: process.env.ComSpec || 'cmd.exe',
        args: [
          '/d',
          '/s',
          '/c',
          '""' +
            file +
            '"' +
            args
              .map(a => ' ' + (/[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a))
              .join('') +
            '"',
        ],
        verbatim: true,
      }
    : { file, args, verbatim: false };
}

function run(file, args, opts = {}) {
  const spec = launch(file, args);
  return new Promise(resolve => {
    execFile(
      spec.file,
      spec.args,
      {
        timeout: opts.timeout || 15000,
        windowsHide: true,
        maxBuffer: 1 << 22,
        windowsVerbatimArguments: spec.verbatim,
        cwd: opts.cwd || scratch,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
      },
      (error, stdout, stderr) =>
        resolve({ ok: !error, out: String(stdout || '') + String(stderr || '') })
    );
  });
}
const help = p => run(p, ['--help']).then(r => r.out);
const hasWord = (text, word) =>
  new RegExp('(^|[^\\w-])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w-])', 'i').test(
    text
  );

// Non-interactive checks that Technically Not's work-rules path still lands where each CLI expects
// it, built from the exact args/env registry.handArgs() would hand the CLI — never a second copy of
// those flags.
const RULES_CHECK = {
  'Claude Code': async path_ => {
    // Claude Code is never run here (a real session would start); confirmed by flag presence only.
    // The rules go in as a file (--append-system-prompt-file, listed in --help as
    // `--append-system-prompt[-file]`), built from the args registry.handArgs() hands it.
    const h = await help(path_);
    const { args } = registry.handArgs('Claude Code', {
      appendPrompt: MARK,
      appendPromptFile: path.join(scratch, 'prompt.md'),
    });
    const need = ['--settings', '--mcp-config', '--add-dir'];
    const missing = need.filter(f => !h.includes(f));
    if (!args.includes('--append-system-prompt-file') || args.includes(MARK))
      missing.push('(Technically Not does not pass the prompt as a file)');
    else if (!/--append-system-prompt(\[-file\]|-file)/.test(h))
      missing.push('--append-system-prompt-file');
    return {
      ok: !missing.length,
      detail: missing.length
        ? '--help missing ' + missing.join(', ')
        : 'flags present: --append-system-prompt-file, ' + need.join(', '),
    };
  },
  Codex: async path_ => {
    // The rules go in a `-p tnai` profile file in the Codex home; a scratch home here, so the
    // user's own is never touched.
    const codexHome = path.join(scratch, 'codex-home');
    const { args } = registry.handArgs('Codex', { workRules: MARK, codexHome });
    const r = await run(path_, [...args, 'debug', 'prompt-input'], {
      env: { CODEX_HOME: codexHome },
    });
    return { ok: r.out.includes(MARK), detail: 'codex debug prompt-input ' + args.join(' ') };
  },
  // Cursor Agent has no instruction flag: the rules are an alwaysApply rule plus a sessionStart
  // hook in a --plugin-dir folder (agent-hooks.js rulesPluginFiles; since 2026.10.01 only the hook
  // reaches the model, seen with a real prompt 2026-10-04). Not run here (no debug command that
  // skips the model); checked by --help listing --plugin-dir and Technically Not passing that
  // folder.
  'Cursor Agent': async path_ => {
    const h = await help(path_);
    const dir = path.join(scratch, 'rules-plugin');
    const { args } = registry.handArgs('Cursor Agent', { workRules: MARK, rulesPlugin: dir });
    const ok = h.includes('--plugin-dir') && args.join(' ') === '--plugin-dir ' + dir;
    return {
      ok,
      detail: ok
        ? '--plugin-dir present and passed'
        : h.includes('--plugin-dir')
          ? 'Technically Not does not pass --plugin-dir'
          : '--help has no --plugin-dir',
    };
  },
  OpenCode: async path_ => {
    const rulesFile = path.join(scratch, 'work-rules.md');
    fs.writeFileSync(rulesFile, MARK);
    const { env } = registry.handArgs('OpenCode', { workRules: MARK, rulesFile });
    const r = await run(path_, ['debug', 'config'], { env });
    let ok = false;
    try {
      ok = JSON.parse(r.out).instructions?.includes(rulesFile);
    } catch {}
    return { ok, detail: 'opencode debug config (OPENCODE_CONFIG_CONTENT)' };
  },
  // GitHub Copilot: an always-applied instructions file in the COPILOT_CUSTOM_INSTRUCTIONS_DIRS
  // folder; `copilot instruction list --json` lists what a session loads (no model call).
  'GitHub Copilot': async path_ => {
    const rulesFile = path.join(scratch, 'work-rules.md');
    fs.writeFileSync(rulesFile, MARK);
    const { env } = registry.handArgs('GitHub Copilot', { workRules: MARK, rulesFile });
    const r = await run(path_, ['instruction', 'list', '--json'], { env });
    let ok = false;
    try {
      ok = JSON.parse(r.out.slice(r.out.indexOf('['))).some(s =>
        /tnai-work-rules\.instructions\.md$/.test(s.sourcePath || '')
      );
    } catch {}
    return { ok, detail: 'copilot instruction list (COPILOT_CUSTOM_INSTRUCTIONS_DIRS)' };
  },
};

// Which skill folders a CLI loads by itself. A probe skill goes into every known skills folder of a
// scratch project (and a scratch CLI home), then the CLI's own listing command says which ones it
// found. No model call; Claude Code and Cursor Agent have no such command and are not run.
// Informational: it never fails the check, and Technically Not's own delivery (a `--plugin-dir` for
// Claude Code) is the Hooks column.
const PROBE_DIRS = {
  claude: '.claude/skills',
  agents: '.agents/skills',
  codex: '.codex/skills',
  opencode: '.opencode/skills',
  github: '.github/skills',
  gemini: '.gemini/skills',
  cursor: '.cursor/skills',
};
const SKILLS_LIST = {
  Codex: home => ({ args: ['debug', 'prompt-input'], env: { CODEX_HOME: home } }),
  OpenCode: () => ({ args: ['debug', 'skill'] }),
  'GitHub Copilot': () => ({ args: ['skill', 'list'] }),
  'Gemini CLI': () => ({ args: ['skills', 'list'] }),
};
let probeProject = '';

function probe() {
  if (probeProject) return probeProject;
  const put = (dir, id) => {
    fs.mkdirSync(path.join(dir, 'tnprobe-' + id), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'tnprobe-' + id, 'SKILL.md'),
      '---\nname: tnprobe-' +
        id +
        '\ndescription: Probe skill in the ' +
        id +
        ' folder. Use when asked about tnprobe.\n---\nProbe.\n'
    );
  };
  probeProject = path.join(scratch, 'skills-project');
  for (const [id, rel] of Object.entries(PROBE_DIRS)) put(path.join(probeProject, rel), id);
  put(path.join(scratch, 'skills-home', 'skills'), 'home');
  return probeProject;
}

async function skillsCheck(id, path_) {
  if (!SKILLS_LIST[id]) return 'not checked (no listing command)';
  const { args, env } = SKILLS_LIST[id](path.join(scratch, 'skills-home'));
  const r = await run(path_, args, { cwd: probe(), env, timeout: 60000 });
  const found = [
    ...new Set(
      (
        r.out.match(/tnprobe-(claude|agents|codex|opencode|github|gemini|cursor|home)\b/g) || []
      ).map(m => m.slice(8))
    ),
  ];
  let text = found.length
    ? found.map(k => (k === 'home' ? 'its home skills folder' : PROBE_DIRS[k])).join(', ')
    : 'none of the project folders';

  // OpenCode also gets Technically Not's every-session skills through `skills.paths`: the env
  // registry.handArgs() builds must make a skill in that folder show up.
  if (id === 'OpenCode') {
    const plugin = path.join(scratch, 'skills-sent'),
      rulesFile = path.join(scratch, 'work-rules.md');
    fs.mkdirSync(path.join(plugin, 'skills', 'tnsent-probe'), { recursive: true });
    fs.writeFileSync(
      path.join(plugin, 'skills', 'tnsent-probe', 'SKILL.md'),
      '---\nname: tnsent-probe\ndescription: Probe skill sent by Technically Not. Use when asked about tnsent.\n---\nProbe.\n'
    );
    fs.writeFileSync(rulesFile, MARK);
    const sent = await run(path_, args, {
      cwd: probe(),
      env: registry.handArgs('OpenCode', { workRules: MARK, rulesFile, pluginDirs: [plugin] }).env,
      timeout: 60000,
    });
    text += sent.out.includes('tnsent-probe')
      ? " · Technically Not's every-session skills: delivered"
      : " · Technically Not's every-session skills: NOT delivered";
  }
  return text;
}

async function resumeCheck(id, path_, cap) {
  const h = await help(path_);
  const mentionsResume = hasWord(h, 'resume');
  if (!cap.resume) return { supported: false, mentionsResume };
  try {
    // .cmd shims wrap the whole command line into one pre-quoted string, so read the
    // flag/subcommand off whatever sits right before the resume id rather than assuming one arg per
    // array element.
    const spec = await registry.spec(id, 'run', { resumeId: 'TNAI_TEST_ID' });

    // cmd.exe's ^ escapes (a Technically Not panel resolves the CLI to its .cmd shim)
    const text = spec.args.join(' ').replace(/\^/g, '');
    const token = (text.match(/([^\s"]+)"?\s+"?TNAI_TEST_ID/) || [])[1] || '';
    return {
      supported: true,
      ok: !!token && hasWord(h, token.replace(/^--?/, '')),
      token,
      mentionsResume,
    };
  } catch (e) {
    return { supported: true, ok: false, error: e.message, mentionsResume };
  }
}

async function envCheck(id, cap) {
  if (!cap.home) return { supported: false };
  const dir = fs.mkdtempSync(path.join(scratch, 'home-'));
  try {
    const withEnv = await registry.detectAccount(id, dir);
    return { supported: true, ok: !withEnv.note || !/could not read/i.test(withEnv.note) };
  } catch (e) {
    return { supported: true, ok: false, error: e.message };
  }
}

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

(async () => {
  const allIds = registry.ids();
  const ids = want ? allIds.filter(id => id.toLowerCase() === want.toLowerCase()) : allIds;
  if (want && !ids.length) {
    console.log('Unknown CLI: ' + want + ' (known: ' + allIds.join(', ') + ')');
    process.exit(1);
  }

  // same installed/path/version/login check Technically Not runs at startup
  const detected = await registry.detectAll();
  const caps = registry.capabilities();
  const rows = [],
    gaps = [],
    broken = [],
    tested = readTested(),
    releases = registry.releases(),
    clean = [],
    skillFolders = [];

  for (const id of ids) {
    const d = detected.find(x => x.id === id);
    const cap = caps.find(x => x.id === id);

    // a CLI Technically Not actively wires login/rules/resume for, not just a picker placeholder
    const core = cap.signIn !== null;
    const fail = msg => {
      gaps.push(id + ': ' + msg);
      if (core) broken.push(id);
    };
    const row = {
      id,
      installed: d.installed ? 'yes' : 'no',
      version: d.version || (d.installed ? '?' : '—'),
      signIn: 'n/a',
      rules: 'n/a',
      resume: 'n/a',
      env: cap.home || '—',
      hooks: cap.skills ? 'yes' : 'no',
      tested: tested[id]?.version || '—',
    };
    if (!releases.find(r => r.id === id)?.feed)
      gaps.push(
        id +
          ": no release feed in agent-registry.js RELEASES, so the release watcher (tools/cli-watch) can't follow its updates."
      );

    if (!d.installed) {
      if (core)
        fail(
          'not installed (`' +
            d.command +
            '` not on PATH) but Technically Not marks it as supported.'
        );
      rows.push(row);
      continue;
    }
    if (!d.version || d.version === '?') {
      fail('`--version` gave no output.');
      row.version = 'FAIL';
    }

    // Sign-in detectable: same status command Technically Not uses; yes/no only, never the
    // account/email it returns.
    if (cap.signIn === null) row.signIn = 'n/a';
    else if (d.note && d.loggedIn !== null) {
      row.signIn = 'no';
      fail('sign-in check failed — ' + d.note);
    } else if (/could not read/i.test(d.note)) {
      row.signIn = 'no';
      fail('sign-in check failed — ' + d.note);
    } else
      row.signIn =
        'yes (' +
        (d.loggedIn === null ? 'no login needed' : 'logged ' + (d.loggedIn ? 'in' : 'out')) +
        ')';

    // Work rules / live hooks delivery.
    if (RULES_CHECK[id]) {
      try {
        const r = await RULES_CHECK[id](d.path);
        row.rules = r.ok ? 'yes' : 'FAIL';
        if (!r.ok) fail('work-rules delivery check failed — ' + r.detail);
      } catch (e) {
        row.rules = 'FAIL';
        fail('work-rules check errored — ' + e.message);
      }
    } else row.rules = 'n/a';

    // Resume.
    const rc = await resumeCheck(id, d.path, cap);
    if (!rc.supported) row.resume = rc.mentionsResume ? 'n/a*' : 'n/a';
    else {
      row.resume = rc.ok ? 'yes' : 'FAIL';
      if (!rc.ok)
        fail(
          'resume flag/subcommand not found in --help (checked ' + (rc.token || rc.error) + ').'
        );
    }
    if (!rc.supported && rc.mentionsResume)
      gaps.push(
        id + ': --help mentions resume, but Technically Not has no startArgs wired for it.'
      );

    // Account-folder env var.
    if (cap.home) {
      const ec = await envCheck(id, cap);
      row.env = ec.ok ? cap.home + ' (verified)' : cap.home + ' FAIL';
      if (!ec.ok)
        fail(
          cap.home +
            ' did not change detected login state as expected — ' +
            (ec.error || 'status still errored')
        );
    }

    try {
      skillFolders.push([id, await skillsCheck(id, d.path)]);
    } catch (e) {
      skillFolders.push([id, 'check errored: ' + e.message]);
    }

    // Tested version: a newer install means this run is the first check of that version.
    const now = semver(d.version),
      was = semver(tested[id]?.version);
    if (now.length === 3 && was.length === 3 && newerThan(now, was)) {
      row.tested += ' (older)';
      gaps.push(
        id +
          ': installed ' +
          now.join('.') +
          ' is newer than the last tested ' +
          was.join('.') +
          '. Check the rows above and its release notes, then run with --mark-tested.'
      );
    } else if (now.length === 3 && was.length !== 3)
      gaps.push(
        id + ': no tested version recorded yet (run with --mark-tested once it checks out).'
      );

    // notes (resume, feed, tested) don't block; failures do
    if (now.length === 3 && !broken.includes(id)) clean.push({ id, version: now.join('.') });
    rows.push(row);
  }

  const cols = [
    ['CLI', 12],
    ['Installed', 9],
    ['Version', 24],
    ['Tested', 16],
    ['Sign-in', 16],
    ['Rules', 6],
    ['Resume', 6],
    ['Env var', 28],
    ['Hooks', 5],
  ];
  console.log(cols.map(([h, w]) => pad(h, w)).join(' '));
  for (const r of rows)
    console.log(
      [
        pad(r.id, 12),
        pad(r.installed, 9),
        pad(r.version, 24),
        pad(r.tested, 16),
        pad(r.signIn, 16),
        pad(r.rules, 6),
        pad(r.resume, 6),
        pad(r.env, 28),
        pad(r.hooks, 5),
      ].join(' ')
    );

  console.log(
    '\n* mentions "resume" in --help but Technically Not has no startArgs for it (see gaps).'
  );
  console.log(
    '\nSkill folders each CLI loads by itself (probe skills in a scratch project, no model call):'
  );
  for (const [id, text] of skillFolders) console.log('- ' + pad(id, 15) + text);
  if (gaps.length) {
    console.log('\nGaps:');
    for (const g of gaps) console.log('- ' + g);
  } else console.log('\nNo gaps found.');

  if (markTested) {
    const next = { ...tested },
      today = new Date().toISOString().slice(0, 10);
    for (const c of clean) next[c.id] = { version: c.version, checked: today };
    fs.writeFileSync(TESTED_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(
      '\nMarked as tested: ' +
        (clean.map(c => c.id + ' ' + c.version).join(', ') ||
          'nothing (every installed CLI had a gap)')
    );
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(broken.length ? 1 : 0);
})().catch(e => {
  console.error('agent-cli-check failed:', e.message);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
});
