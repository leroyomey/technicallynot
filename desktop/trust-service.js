/*
 * Technically Not desktop · trust-service.js — Folder trust per agent CLI: whether a CLI would ask
 * "Trust this folder?" for a working folder, and recording that trust exactly the way the CLI
 * itself does, only after the user said yes in Technically Not's dialog (main.js). A sub-agent's
 * first task would otherwise answer the CLI's question (Codex picks Quit and the sub-agent dies
 * before it reports). `accountDir` = the per-account config folder Technically Not passes through
 * the CLI's `home` env var (agent-registry.js); empty = the CLI's default home. Checked against the
 * installed CLIs on 2026-09-25:
 * - Claude Code 2.1.282: <config>/.claude.json projects["C:/fwd/slash/path"].hasTrustDialogAccepted
 * (config = CLAUDE_CONFIG_DIR, else the user folder; <CLAUDE_CONFIG_DIR or ~/.claude>/.config.json
 * wins when it exists). The dialog saves the git root (real path) or the folder; a trusted parent
 * counts up to the git root. Keys are compared exactly. Home-folder trust is session-only in Claude
 * Code, so it can't be saved.
 * - Codex 0.157: <CODEX_HOME or ~/.codex>/config.toml [projects.'<lowercased path>'] trust_level =
 * "trusted", keyed by the git root (a worktree's main repo) or the folder; matched ignoring case,
 * never by a plain parent folder (probed with project config loading in `codex debug
 * prompt-input`).
 * - Cursor Agent 2026.09.23: marker file <CURSOR_DATA_DIR or
 * ~/.cursor>/projects/<slug>/.workspace-trusted, JSON {trustedAt, workspacePath}, the same file its
 * own dialog and `--trust` write; a parent's marker counts unless that parent is the user folder or
 * above it, a drive root, or < 3 levels deep.
 * - OpenCode 1.18.32: no folder-trust question. Droid: not installed on the checked PC, so
 * unverified: needed:false. Checked 2026-09-27 (answered each CLI's own dialog in a test folder,
 * then read what it wrote; a subfolder of a trusted folder was not asked again):
 * - Gemini CLI 0.61.0: <GEMINI_CLI_TRUSTED_FOLDERS_PATH or <GEMINI_CLI_HOME or
 * ~>/.gemini/trustedFolders.json> { "<lowercased c:/fwd/slash/path>": "TRUST_FOLDER" };
 * "TRUST_PARENT" on a folder trusts its parent. No question at all when ~/.gemini/settings.json
 * (same folder) has security.folderTrust.enabled false.
 * - GitHub Copilot 1.0.88: <COPILOT_HOME or ~/.copilot>/config.json (two // comment lines, then
 * JSON) trustedFolders: ["C:\\native\\path"], written by "Yes, and remember this folder"; plain
 * "Yes" is session-only.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const full = cwd => path.resolve(String(cwd || ''));
const real = p => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};
const fwd = p => p.replace(/\\/g, '/');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Temp file + rename; a rename can briefly fail on Windows while the CLI itself has the file open,
// so it retries.
async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tnai-' + process.pid + '-' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, text);
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        await fsp.rm(tmp, { force: true });
        throw e;
      }
      await new Promise(r => setTimeout(r, 50 * (i + 1)));
    }
  }
}

// Nearest folder at or above `dir` with a `.git` entry (folder, or a worktree's file).
function gitRoot(dir) {
  for (let d = dir; ;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// --- Claude Code ---
function claudeFile(home) {
  const dir = home || process.env.CLAUDE_CONFIG_DIR || '';
  const legacy = path.join(dir || path.join(os.homedir(), '.claude'), '.config.json');
  return fs.existsSync(legacy) ? legacy : path.join(dir || os.homedir(), '.claude.json');
}
const claudeRead = file => {
  const text = readText(file);
  return text === null ? {} : JSON.parse(text);
};
const claudeKeys = cwd => {
  const root = gitRoot(cwd),
    target = root ? real(root) : cwd;
  return [...new Set([fwd(target), fwd(real(target))])];
};

function claudeTrusted(cwd, home) {
  const projects = claudeRead(claudeFile(home)).projects || {},
    ok = k => projects[k]?.hasTrustDialogAccepted === true;
  if (claudeKeys(cwd).some(ok)) return true;
  const root = gitRoot(cwd),
    stop = root ? fwd(root) : null;
  for (let s = fwd(cwd); ;) {
    if (stop && s !== stop && !s.startsWith(stop.endsWith('/') ? stop : stop + '/')) return false;
    if (ok(s)) return true;
    if (s === stop) return false;
    const up = fwd(path.dirname(s));
    if (up === s) return false;
    s = up;
  }
}

async function claudeGrant(cwd, home) {
  // Check the folder asked for and the key actually written (the git root, which can sit above it):
  // never the user folder or a drive root.
  const homeKey = fwd(os.homedir()).toLowerCase().replace(/\/+$/, ''),
    tooWide = p => {
      const k = fwd(p).toLowerCase().replace(/\/+$/, '');
      return k === homeKey || /^([a-z]:)?$/.test(k);
    };
  if ([cwd, ...claudeKeys(cwd)].some(tooWide))
    return {
      ok: false,
      error:
        'Claude Code trusts your user folder for one session only. Pick a project folder instead.',
    };
  const file = claudeFile(home),
    // re-read right before writing: Claude Code rewrites this file while it runs
    data = claudeRead(file);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { ok: false, error: 'Claude Code settings file is not a JSON object.' };
  const keys = claudeKeys(cwd).filter(k => data.projects?.[k]?.hasTrustDialogAccepted !== true);
  if (!keys.length) return { ok: true };
  data.projects = data.projects && typeof data.projects === 'object' ? data.projects : {};
  for (const k of keys)
    data.projects[k] = { ...(data.projects[k] || {}), hasTrustDialogAccepted: true };
  await writeAtomic(file, JSON.stringify(data, null, 2));
  return { ok: true };
}

// --- Codex ---
const codexFile = home =>
  path.join(home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');

// Codex's own rule: the git root, or for a worktree (.git file -> <main>/.git/worktrees/<name>) the
// main repo; else the folder itself.
function codexTarget(cwd) {
  const root = gitRoot(cwd);
  if (!root) return real(cwd);
  const dotgit = path.join(root, '.git');
  try {
    if (fs.statSync(dotgit).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
      const gd = m && real(path.resolve(root, m[1].trim()));
      return gd && path.basename(path.dirname(gd)) === 'worktrees'
        ? real(path.dirname(path.dirname(path.dirname(gd))))
        : real(cwd);
    }
  } catch {
    /* unreadable .git file: fall back to the root */
  }
  return real(root);
}
const HEADER = /^\s*\[\s*projects\s*\.\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\s*\]\s*(?:#.*)?$/;

// Each [projects.'…'] table: lowercased key, header line, trust_level (or '').
function codexProjects(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = HEADER.exec(line);
    if (!m) return;
    let key = m[1] ?? m[2];
    if (m[1] === undefined) {
      try {
        key = JSON.parse('"' + m[2] + '"');
      } catch {
        /* keep raw */
      }
    }
    let trust = '';
    for (let j = i + 1; j < lines.length && !/^\s*\[/.test(lines[j]); j++) {
      const t = /^\s*trust_level\s*=\s*["']([^"']*)["']/.exec(lines[j]);
      if (t) {
        trust = t[1];
        break;
      }
    }
    out.push({ key: key.toLowerCase(), line: i, trust });
  });
  return out;
}

function codexTrusted(cwd, home) {
  const text = readText(codexFile(home));
  if (text === null) return false;
  const want = new Set([codexTarget(cwd), real(cwd), cwd].map(p => p.toLowerCase()));

  // Any saved decision ("trusted" or "untrusted") means Codex won't ask again.
  return codexProjects(text.split(/\r?\n/)).some(p => want.has(p.key) && p.trust);
}

async function codexGrant(cwd, home) {
  const file = codexFile(home),
    text = readText(file) ?? '',
    eol = text.includes('\r\n') ? '\r\n' : '\n';
  const key = codexTarget(cwd).toLowerCase(),
    lines = text.split(/\r?\n/);
  const hit = codexProjects(lines).find(p => p.key === key);
  if (hit?.trust) return { ok: true };
  if (hit) lines.splice(hit.line + 1, 0, 'trust_level = "trusted"');
  else {
    const quoted = /['\r\n]/.test(key) ? JSON.stringify(key) : "'" + key + "'";
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(
      ...(lines.length ? [''] : []),
      '[projects.' + quoted + ']',
      'trust_level = "trusted"',
      ''
    );
  }
  await writeAtomic(file, lines.join(eol));
  return { ok: true };
}

// --- Cursor Agent ---
const cursorProjects = home =>
  path.join(home || process.env.CURSOR_DATA_DIR || path.join(os.homedir(), '.cursor'), 'projects');
const cursorSlug = p =>
  p
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
const MARKER = '.workspace-trusted';

// Parents that never pass trust down (cursor-agent's own rule): the user folder or anything above
// it, a drive root, fewer than 3 levels.
function cursorTooHigh(dir) {
  const home = os.homedir(),
    parts = dir.split(path.sep).filter(Boolean);
  return (
    dir === home || home.startsWith(dir + path.sep) || /^[A-Z]:\\?$/i.test(dir) || parts.length < 3
  );
}

function cursorTrusted(cwd, home) {
  const root = cursorProjects(home);
  if (fs.existsSync(path.join(root, cursorSlug(cwd), MARKER))) return true;
  let names;
  try {
    names = new Set(fs.readdirSync(root));
  } catch {
    return false;
  }
  for (let d = cwd, up = path.dirname(d); up !== d; d = up, up = path.dirname(d)) {
    const slug = cursorSlug(up);
    if (names.has(slug) && fs.existsSync(path.join(root, slug, MARKER)) && !cursorTooHigh(up))
      return true;
  }
  return false;
}

async function cursorGrant(cwd, home) {
  const file = path.join(cursorProjects(home), cursorSlug(cwd), MARKER);
  if (fs.existsSync(file)) return { ok: true };
  await writeAtomic(
    file,
    JSON.stringify({ trustedAt: new Date().toISOString(), workspacePath: cwd }, null, 2)
  );
  return { ok: true };
}

// cwd and every folder above it, compared the way Windows paths are (case-insensitive, either
// slash).
const norm = p => fwd(p).replace(/\/+$/, '').toLowerCase();
const upward = cwd => {
  const out = [];
  for (let d = cwd; ;) {
    out.push(norm(d));
    const up = path.dirname(d);
    if (up === d) return out;
    d = up;
  }
};

// --- Gemini CLI ---
// its homedir(): the account's GEMINI_CLI_HOME, else the env var, else the user folder
const geminiDir = home => path.join(home || process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini');
const geminiFile = home =>
  process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH || path.join(geminiDir(home), 'trustedFolders.json');
const jsonc = text =>
  JSON.parse(
    String(text)
      .replace(/^﻿/, '')
      .replace(/^\s*\/\/.*$/gm, '')
  );

function geminiTrusted(cwd, home) {
  const settings = readText(path.join(geminiDir(home), 'settings.json'));
  if (settings !== null) {
    try {
      if (jsonc(settings)?.security?.folderTrust?.enabled === false) return true;
    } catch {}
  }
  const text = readText(geminiFile(home));
  if (text === null) return false;
  const saved = new Map(Object.entries(JSON.parse(text) || {}).map(([k, v]) => [norm(k), v]));
  const mine = upward(cwd);
  if (mine.some(d => saved.get(d) === 'TRUST_FOLDER')) return true;
  return [...saved].some(
    ([k, v]) => v === 'TRUST_PARENT' && mine.includes(norm(path.posix.dirname(k)))
  );
}

async function geminiGrant(cwd, home) {
  const file = geminiFile(home),
    text = readText(file),
    data = text === null ? {} : JSON.parse(text) || {};
  const key = norm(cwd),
    hit = Object.keys(data).find(k => norm(k) === key);
  if (hit && data[hit] === 'TRUST_FOLDER') return { ok: true };
  data[hit || key] = 'TRUST_FOLDER';
  await writeAtomic(file, JSON.stringify(data, null, 2));
  return { ok: true };
}

// --- GitHub Copilot ---
const copilotFile = home =>
  // the account's COPILOT_HOME is the folder itself
  path.join(home || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'config.json');

function copilotTrusted(cwd, home) {
  const text = readText(copilotFile(home));
  if (text === null) return false;
  const mine = upward(cwd);
  return (jsonc(text).trustedFolders || []).some(
    p => typeof p === 'string' && mine.includes(norm(p))
  );
}

async function copilotGrant(cwd, home) {
  const file = copilotFile(home),
    text = readText(file) ?? '';

  // Keep Copilot's own comment header; only the JSON after it changes.
  const head = (text.match(/^(?:﻿)?(?:\s*\/\/.*\r?\n)*/) || [''])[0],
    data = text.slice(head.length).trim() ? JSON.parse(text.slice(head.length)) : {};
  const list = Array.isArray(data.trustedFolders) ? data.trustedFolders : [];
  if (list.some(p => typeof p === 'string' && norm(p) === norm(cwd))) return { ok: true };
  data.trustedFolders = [...list, cwd];
  await writeAtomic(file, head + JSON.stringify(data, null, 2) + '\n');
  return { ok: true };
}

const ADAPTERS = {
  'Claude Code': { trusted: claudeTrusted, grant: claudeGrant },
  Codex: { trusted: codexTrusted, grant: codexGrant },
  'Cursor Agent': { trusted: cursorTrusted, grant: cursorGrant },
  'Gemini CLI': { trusted: geminiTrusted, grant: geminiGrant },
  'GitHub Copilot': { trusted: copilotTrusted, grant: copilotGrant },
};

// { needed, label }: true when that CLI would ask to trust `cwd` under that account home.
// Unreadable settings count as "would ask".
async function needs(agent, cwd, accountDir) {
  const a = ADAPTERS[agent],
    label = String(agent || '');
  if (!a || !cwd) return { needed: false, label };
  try {
    return { needed: !a.trusted(full(cwd), accountDir || ''), label };
  } catch {
    return { needed: true, label };
  }
}

// Records trust the way the CLI does when the user picks "trust": merge/append only, missing file
// tolerated.
async function grant(agent, cwd, accountDir) {
  const a = ADAPTERS[agent];
  if (!a) return { ok: true };
  if (!cwd) return { ok: false, error: 'No folder to trust.' };
  try {
    return await a.grant(full(cwd), accountDir || '');
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Synchronous: is `cwd` trusted for that CLI now (e.g. Cursor's `--trust` launch flag,
// agent-registry.js `o.trust`).
function granted(agent, cwd, accountDir) {
  const a = ADAPTERS[agent];
  if (!a || !cwd) return false;
  try {
    return a.trusted(full(cwd), accountDir || '');
  } catch {
    return false;
  }
}

module.exports = { needs, grant, granted };
