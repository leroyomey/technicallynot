// Technically Not desktop · source-fix.js — "Fix a Technically Not bug from its source…" (a row
// of the thread's "..." menu, src/scripts/198-source-fix.js). One press copies Technically Not's
// public source at the installed version's tag into the settings folder (never the user's
// project), starts a new thread there and gives it the bug playbook
// (desktop/hidden-skills/70-source-fix.md) with the bug's details. The agent finds and fixes the
// cause and drafts an issue or pull request; nothing is posted by an agent, the user presses the
// final button on GitHub's own page. Plain Node (no Electron), so tools/source-fix-test.js runs
// it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const REPO = 'https://github.com/leroyomey/technicallynot';
const DEFAULT_BRANCH = 'main';

// How long a start mark waits for its thread's process (the same as a scheduled run's mark).
const MARK_MS = 15 * 60 * 1000;

// A clone over a slow line can take a while; a hung one must not hold the action forever.
const CLONE_MS = 5 * 60 * 1000;

// Copies of the same version: the first is "v0.3.77", then "v0.3.77-2" and so on.
const MAX_COPIES = 50;

// Runs git without a window and without ever asking for a password (the public repo needs none).
function runGit(args, options = {}) {
  return new Promise(resolve => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout || 30000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          missing: error?.code === 'ENOENT',
          stdout: String(stdout || ''),
          stderr: String(stderr || error?.message || ''),
        });
      }
    );
  });
}

// One short line of a detail the window sent: text only, no line breaks, limited length.
function oneLine(value, max = 300) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// The last line git printed, for an error the user can read.
function lastLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || '';
}

// deps: { dir (settings folder), version, agents () → CLI ids, spawn, submit, note, playbook
// (vars) → lines, git? (args, options) → { ok, missing, stdout, stderr }, now? }
function createSourceFix(deps) {
  const git = deps.git || runGit;
  const now = deps.now || Date.now;
  const marks = new Map();
  let working = false;

  const base = () => path.join(deps.dir, 'source-fix');
  const draftOf = folder => folder + '.draft.md';

  // A copy can be used again only while nothing was done in it: no changed or new file, still on
  // the tag it was copied at (no branch made), and no draft written next to it.
  async function untouched(folder) {
    if (fs.existsSync(draftOf(folder))) return false;
    const status = await git(['status', '--porcelain'], { cwd: folder });
    if (!status.ok || status.stdout.trim()) return false;
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: folder });
    return head.ok && head.stdout.trim() === 'HEAD';
  }

  // Copies the public source into `folder`: the version's tag, or the latest public code when the
  // tag is not there (a build newer than its release). → { ok, fromTag } or { ok: false, error }
  async function copyInto(folder, tag) {
    const clone = ref =>
      git(
        [
          '-c',
          'advice.detachedHead=false',
          'clone',
          '--depth',
          '1',
          '--single-branch',
          '--branch',
          ref,
          REPO,
          folder,
        ],
        { timeout: CLONE_MS }
      );
    let result = await clone(tag);
    if (result.ok) return { ok: true, fromTag: true };
    fs.rmSync(folder, { recursive: true, force: true });
    if (!/not found|did not match|couldn't find remote ref/i.test(result.stderr))
      return {
        ok: false,
        error: 'Could not get the source: ' + (lastLine(result.stderr) || 'git failed.'),
      };
    result = await clone(DEFAULT_BRANCH);
    if (result.ok) return { ok: true, fromTag: false };
    fs.rmSync(folder, { recursive: true, force: true });
    return {
      ok: false,
      error: 'Could not get the source: ' + (lastLine(result.stderr) || 'git failed.'),
    };
  }

  // The folder for this version: an untouched copy from before, else a new one.
  // → { ok, folder, fromTag } or { ok: false, error }
  async function prepare(tag) {
    fs.mkdirSync(base(), { recursive: true });
    for (let n = 1; n <= MAX_COPIES; n++) {
      const folder = path.join(base(), n === 1 ? tag : tag + '-' + n);
      if (!fs.existsSync(folder)) {
        const copied = await copyInto(folder, tag);
        return copied.ok ? { ok: true, folder, fromTag: copied.fromTag } : copied;
      }
      if (await untouched(folder)) {
        const onTag = await git(['describe', '--tags', '--exact-match'], { cwd: folder });
        return { ok: true, folder, fromTag: onTag.ok && onTag.stdout.trim() === tag };
      }
    }
    return {
      ok: false,
      error: 'There are already ' + MAX_COPIES + ' copies of ' + tag + ' in ' + base() + '.',
    };
  }

  // The thread's first prompt: the playbook, then the bug's details.
  function promptFor({ folder, tag, fromTag, details }) {
    const version = String(deps.version);
    const system = os.type() + ' ' + os.release();
    const lines = deps.playbook({
      folder,
      draft: draftOf(folder),
      version,
      os: system,
      repo: REPO,
      source: fromTag
        ? 'Technically Not ' + version + ', the tag ' + tag
        : 'the latest public code on ' +
          DEFAULT_BRANCH +
          ', because the tag ' +
          tag +
          ' was not found',
      issues: REPO + '/issues/new',
      compare: REPO + '/compare/' + DEFAULT_BRANCH + '...',
    });
    const told = [
      'Bug details (from the thread the user pressed it in):',
      '- Technically Not ' + version + ' on ' + system,
    ];
    for (const [label, key] of [
      ['Thread', 'thread'],
      ['Agent tool', 'agent'],
      ['Model', 'model'],
      ['State', 'state'],
      ['Error shown', 'error'],
    ]) {
      const value = oneLine(details?.[key]);
      if (value) told.push('- ' + label + ': ' + value);
    }
    const words = oneLine(details?.words, 2000);
    told.push(
      words
        ? "- The user's words: " + words
        : '- The user has not said yet what went wrong: ask first (step 1).'
    );
    return [...lines, '', ...told].join('\n');
  }

  // The press. job: { agent, details: { thread, agent, model, state, error, words } }
  // → { ok, paneId, folder, fromTag } or { ok: false, error }
  async function start(job = {}) {
    const agent = String(job.agent || '');
    if (agent === 'Terminal' || !deps.agents().includes(agent))
      return { ok: false, error: 'Pick a thread with an agent tool, then try again.' };
    if (working) return { ok: false, error: 'The source is already being fetched.' };
    working = true;
    try {
      const has = await git(['--version']);
      if (!has.ok)
        return {
          ok: false,
          error: has.missing
            ? 'Git is needed to get the source. Install Git, then try again.'
            : 'Git did not answer: ' + (lastLine(has.stderr) || 'unknown error.'),
        };
      const tag = 'v' + String(deps.version);
      const prepared = await prepare(tag);
      if (!prepared.ok) return prepared;
      const { folder, fromTag } = prepared;

      // The start mark: pty:start (main.js) turns it into this folder once, for this CLI only.
      const mark = crypto.randomUUID();
      marks.set(mark, { folder, agent, at: now() });
      try {
        const started = await deps.spawn(agent, null, 'Bug fix ' + deps.version, {
          schedule: mark,
          folder,
        });
        if (!started?.paneId)
          return {
            ok: false,
            error: 'The thread did not start: ' + (started?.error || 'no answer.'),
          };
        deps.note?.(started.paneId, { source: 'user' });
        const prompt = promptFor({ folder, tag, fromTag, details: job.details });
        const sent = await deps.submit(started.paneId, prompt, { agent });
        if (!sent?.ok)
          return {
            ok: false,
            error:
              'The thread started, but the playbook was not sent: ' + (sent?.error || 'no answer.'),
            paneId: started.paneId,
          };
        return { ok: true, paneId: started.paneId, folder, fromTag };
      } finally {
        marks.delete(mark);
      }
    } finally {
      working = false;
    }
  }

  // pty:start (main.js): the folder a source-fix thread starts in, taken once, only for the CLI it
  // was made for and only while it is fresh. '' for any other start.
  function takeFolder(mark, agent) {
    const entry = typeof mark === 'string' ? marks.get(mark) : null;
    if (!entry) return '';
    marks.delete(mark);
    if (entry.agent !== agent || now() - entry.at > MARK_MS) return '';
    return entry.folder;
  }

  return { start, takeFolder, promptFor, prepare };
}

module.exports = { createSourceFix, REPO };
