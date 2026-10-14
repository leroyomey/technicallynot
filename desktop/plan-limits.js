/*
 * Technically Not desktop · plan-limits.js — Settings › Usage "Plan limits": how much of each agent
 * CLI's plan window is used and when it resets. Codex: read from its own session files on this PC
 * (~/.codex/sessions/<y>/<m>/<d>/rollout-<id>.jsonl, the last token_count event's rate_limits:
 * primary/secondary { used_percent, window_minutes, resets_at (epoch s) }, plan_type); no network.
 * Claude Code: its plan usage is not written to disk, so it is asked from Anthropic's own usage
 * endpoint (the one Claude Code's /usage screen uses; undocumented) with
 * the OAuth token from ~/.claude/.credentials.json. The token goes only to api.anthropic.com, is
 * never refreshed or written here, and an expired one is not sent (the row says to open Claude
 * Code). Any failure gives a status instead of numbers, never a guess. Default accounts only (the
 * same roots usage-stats.js reads). Tests: TNAI_USAGE_ROOTS {"codex":"<sessions
 * dir>","claudeHome":"<dir with .credentials.json>"}; with TNAI_USAGE_ROOTS set and no claudeHome,
 * no request is made.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');

const CLAUDE_URL = 'https://api.anthropic.com/api/oauth/usage';
const claudeUrl = () =>
  // tests point it at a local server (only with test roots)
  (process.env.TNAI_USAGE_ROOTS && process.env.TNAI_CLAUDE_USAGE_URL) || CLAUDE_URL;
const CLAUDE_CACHE_MS = 60 * 1000; // automatic asks within a minute reuse the last answer

// … within 5 min while a Claude Code agent works: the endpoint's per-account limit is shared with
// every Claude Code session
const BUSY_CACHE_MS = 5 * 60 * 1000;

// a failed ask shows the last good reading (marked stale) if it is at most this old
const KEEP_MS = 6 * 3600 * 1000;
const FORCE_MIN_MS = 10 * 1000; // a Refresh click asks again, but not more than once per 10 s

// after HTTP 429, no ask (not even Refresh) for Retry-After or 5 min, so retries don't keep
// Anthropic's limit active
const RATE_LIMIT_MS = 5 * 60 * 1000;
const CODEX_FILES_TRIED = 8; // newest session files searched for a rate_limits reading

const pctOf = v => Math.max(0, Math.min(100, Number(v) || 0));
const title = s =>
  String(s || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

// ---------- Codex ----------
async function newestRollouts(root) {
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && /^rollout-.*\.jsonl$/i.test(e.name)) {
        try {
          files.push({ p, m: (await fsp.stat(p)).mtimeMs });
        } catch {}
      }
    }
  }
  await walk(root);
  return files
    .sort((a, b) => b.m - a.m)
    .slice(0, CODEX_FILES_TRIED)
    .map(f => f.p);
}

async function lastRateLimits(file) {
  let last = null;
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.includes('"rate_limits"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    const rl2 = j?.payload?.rate_limits;
    if (rl2?.primary) last = { limits: rl2, at: Date.parse(j.timestamp) || 0 };
  }
  return last;
}

async function codex(root) {
  let files;
  try {
    await fsp.access(root);
    files = await newestRollouts(root);
  } catch {
    return { cli: 'codex', status: 'none' };
  }
  for (const f of files) {
    let r;
    try {
      r = await lastRateLimits(f);
    } catch {
      continue;
    }
    if (!r) continue;
    const now = Date.now(),
      windows = [];
    for (const w of [r.limits.primary, r.limits.secondary]) {
      if (!w || !Number.isFinite(+w.used_percent)) continue;
      const resetsAt = (+w.resets_at || 0) * 1000,
        // passed since the reading: the window started over
        reset = resetsAt > 0 && resetsAt <= now;
      windows.push({
        minutes: +w.window_minutes || 0,
        used: reset ? 0 : pctOf(w.used_percent),
        resetsAt: reset ? 0 : resetsAt,
        resetSinceReading: reset,
      });
    }
    if (windows.length)
      return { cli: 'codex', status: 'ok', plan: title(r.limits.plan_type), at: r.at, windows };
  }
  return { cli: 'codex', status: files.length ? 'noreading' : 'none' };
}

// ---------- Claude Code ----------
const claudeCache = new Map(); // home -> { at, until, result }
const lastGood = new Map(); // home -> the last ok result

// A failed ask (429, no answer…) keeps showing the last good reading, marked stale with why;
// windows that reset since then read 0 %.
function staleOr(home, result) {
  const ok = lastGood.get(home);
  if (!ok || Date.now() - ok.at > KEEP_MS) return result;
  const now = Date.now();
  return {
    ...ok,
    stale: true,
    detail: result.detail || '',
    windows: ok.windows.map(w =>
      w.resetsAt && w.resetsAt <= now ? { ...w, used: 0, resetsAt: 0, resetSinceReading: true } : w
    ),
  };
}

async function claude(home, force, busy) {
  const hit = claudeCache.get(home);
  if (
    hit &&
    (Date.now() < (hit.until || 0) ||
      Date.now() - hit.at < (force ? FORCE_MIN_MS : busy ? BUSY_CACHE_MS : CLAUDE_CACHE_MS))
  )
    return hit.result.status === 'ok' ? hit.result : staleOr(home, hit.result);
  let o;
  try {
    o = JSON.parse(await fsp.readFile(path.join(home, '.credentials.json'), 'utf8'))?.claudeAiOauth;
  } catch {
    return { cli: 'claude-code', status: 'signedout' };
  }
  if (!o?.accessToken) return { cli: 'claude-code', status: 'signedout' };
  const plan = title(o.subscriptionType);
  if (+o.expiresAt && +o.expiresAt < Date.now())
    return { cli: 'claude-code', status: 'expired', plan };
  let result,
    until = 0;
  try {
    const res = await fetch(claudeUrl(), {
      headers: {
        Authorization: 'Bearer ' + o.accessToken,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403)
      result = { cli: 'claude-code', status: 'expired', plan };
    else if (res.status === 429) {
      until =
        Date.now() + (Math.max(0, +res.headers.get('retry-after') || 0) * 1000 || RATE_LIMIT_MS);
      result = { cli: 'claude-code', status: 'unavailable', plan, detail: 'HTTP 429' };
    } else if (!res.ok)
      result = { cli: 'claude-code', status: 'unavailable', plan, detail: 'HTTP ' + res.status };
    else {
      const j = await res.json(),
        windows = [];
      const add = (w, key, minutes, model) => {
        if (w && Number.isFinite(+w.utilization))
          windows.push({
            key,
            minutes,
            model,
            used: pctOf(w.utilization),
            resetsAt: Date.parse(w.resets_at) || 0,
          });
      };
      add(j.five_hour, 'five_hour', 300);
      add(j.seven_day, 'seven_day', 10080);
      add(j.seven_day_opus, 'seven_day_opus', 10080, 'Opus');
      add(j.seven_day_sonnet, 'seven_day_sonnet', 10080, 'Sonnet');
      result = windows.length
        ? { cli: 'claude-code', status: 'ok', plan, at: Date.now(), windows }
        : { cli: 'claude-code', status: 'unavailable', plan, detail: 'No limits in the answer' };
    }
  } catch (err) {
    result = {
      cli: 'claude-code',
      status: 'unavailable',
      plan,
      detail: err?.name === 'TimeoutError' ? 'No answer in 8 s' : 'Could not reach Anthropic',
    };
  }
  claudeCache.set(home, { at: Date.now(), until, result });
  if (result.status === 'ok') lastGood.set(home, result);
  return result.status === 'unavailable' ? staleOr(home, result) : result;
}

// Test roots (TNAI_USAGE_ROOTS, read fresh each call) or null for the real folders.
function testRoots() {
  try {
    return process.env.TNAI_USAGE_ROOTS ? JSON.parse(process.env.TNAI_USAGE_ROOTS) || {} : null;
  } catch {
    return {};
  }
}

async function limits() {
  const roots = testRoots();
  const codexRoot = roots?.codex || path.join(os.homedir(), '.codex', 'sessions');
  const claudeHome = roots ? roots.claudeHome : path.join(os.homedir(), '.claude');
  return Promise.all([
    claudeHome ? claude(claudeHome) : { cli: 'claude-code', status: 'none' },
    codex(codexRoot),
  ]);
}

// Every Claude Code / Codex account (account-service list(): { agentId, accounts: [{ id, dir,
// isDefault }] }). Claude Code: one ask per account's own config folder. Codex: extra accounts
// share the default account's sessions folder (agent-registry shared: ['sessions']), so a file
// reading can't be tied to one account; it is returned once as codexFile, and the window gives it
// to the default account only when Codex has no other account (per-account Codex readings come live
// from each panel's token_count events, agent-turns limits).
async function forAccounts(list, force, busy = false) {
  const r = testRoots(),
    claudeDefault = r ? r.claudeHome : path.join(os.homedir(), '.claude');
  const codexSessions =
    r?.codex || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  const claudeAccounts = list.find(c => c.agentId === 'Claude Code')?.accounts || [];
  const [claudeRows, codexFile] = await Promise.all([
    Promise.all(
      claudeAccounts.map(async a => {
        const home = a.dir || claudeDefault;
        return {
          agentId: 'Claude Code',
          accountId: a.id || '',
          ...(home ? await claude(home, force, busy) : { cli: 'claude-code', status: 'none' }),
        };
      })
    ),
    codex(codexSessions),
  ]);
  return { at: Date.now(), accounts: claudeRows, codexFile };
}

module.exports = { limits, forAccounts };
