/*
 * Technically Not desktop · discord-alerts.js — "Alerts to Discord" (Settings › Agents, 22):
 * off by default. When on, a short message goes to the user's OWN
 * Discord webhook when an agent needs them, finishes, or seems stuck in a loop, so their phone
 * buzzes while they're away (skipped while the Technically Not window is in front). Events come
 * from main.js's senders: `attention:change` (new "Needs you" item, attention-service.js; kept 3 s
 * first so a menu that flickers past doesn't post), `agent:turn` (a task ended normally,
 * agent-turns.js) and `agent:loop` on (agent-loops.js). Throttled per agent + event (60 s) and
 * overall (20 per 10 min); one retry after a 429. The webhook URL is kept encrypted by the OS
 * (Electron safeStorage, like api-keys.js) in userData/discord-webhook.bin; the other settings in
 * userData/discord-alerts.json. The URL is only ever sent to Discord itself: never logged, never
 * returned to the window (only a masked form). Test: desktop-check discord-alerts.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { release } = require('./build-info');

const EVENTS = ['needsYou', 'finished', 'stuck'];
const DEFAULTS = { enabled: false, events: { needsYou: true, finished: false, stuck: true } };
const PER_KEY_MS = 60 * 1000,
  CAP = 20,
  CAP_MS = 10 * 60 * 1000,
  SETTLE_MS = 3000,
  MAX_LEN = 300,
  TIMEOUT_MS = 10000;

// Only a real Discord webhook: https, discord.com / discordapp.com (ptb., canary.),
// /api[/vN]/webhooks/<id>/<token>.
const WEBHOOK =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})\/?$/;

// Developer self-test only (tools/desktop-check, never a release build): a fake webhook on this
// computer.
const LOCAL =
  /^http:\/\/127\.0\.0\.1:\d{2,5}\/api\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})\/?$/;
let allowLocal = false;

let owner = async () => null,
  root = () => '',
  getWin = () => null,
  focused = null;
const configFile = () => path.join(app.getPath('userData'), 'discord-alerts.json');
const secretFile = () => path.join(app.getPath('userData'), 'discord-webhook.bin');

const clip = (s, n) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const valid = url => {
  const u = String(url || '').trim();
  return WEBHOOK.exec(u) || (allowLocal && LOCAL.exec(u)) ? u : '';
};

function unavailable() {
  // macOS always has its keychain, and asking reads it (a keychain item of another build raises a
  // prompt that blocks the main process while Settings asks for this state).
  if (process.platform === 'darwin') return '';
  try {
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : '';
    if (safeStorage.isEncryptionAvailable() && backend !== 'basic_text') return '';
  } catch {}
  return 'This computer has no secure storage, so Technically Not can’t keep a webhook address safely.';
}

function readConfig() {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {};
  } catch {}
  const events = { ...DEFAULTS.events };
  for (const k of EVENTS) if (typeof c.events?.[k] === 'boolean') events[k] = c.events[k];
  return {
    enabled: c.enabled === true,
    events,
    lastError: typeof c.lastError === 'string' ? c.lastError : '',
    lastSentAt: Number(c.lastSentAt) || 0,
  };
}

function writeConfig(c) {
  const target = configFile(),
    tmp = target + '.' + process.pid + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      enabled: c.enabled,
      events: c.events,
      lastError: c.lastError,
      lastSentAt: c.lastSentAt,
    })
  );
  fs.renameSync(tmp, target);
}

function readUrl() {
  try {
    return valid(
      safeStorage.decryptString(Buffer.from(fs.readFileSync(secretFile(), 'utf8'), 'base64'))
    );
  } catch {
    return '';
  }
}

function writeUrl(url) {
  if (!url) {
    fs.rmSync(secretFile(), { force: true });
    return;
  }
  const target = secretFile(),
    tmp = target + '.' + process.pid + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, safeStorage.encryptString(url).toString('base64'), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

// "discord.com/api/webhooks/1234…/••••": enough to recognise it, never enough to use it.
function mask(url) {
  const m = WEBHOOK.exec(url) || LOCAL.exec(url);
  if (!m) return '';
  return (
    url.replace(/^https?:\/\//, '').split('/')[0] + '/api/webhooks/' + m[1].slice(0, 4) + '…/••••'
  );
}
let config = null,
  url = null; // loaded on first use (userData is final by then)
const cfg = () => config || (config = readConfig());
const hook = () => url ?? (url = readUrl());

function publicState() {
  const c = cfg(),
    u = hook();
  return {
    enabled: c.enabled,
    events: { ...c.events },
    set: !!u,
    webhook: u ? mask(u) : '',
    lastError: c.lastError,
    lastSentAt: c.lastSentAt,
    unavailable: unavailable(),
  };
}

function saveNote(patch) {
  Object.assign(cfg(), patch);
  try {
    writeConfig(cfg());
  } catch {}
}

// ---- Posting ----

const sentAt = new Map(); // agent + event -> last post time
let recent = []; // post times in the last CAP_MS
const wait = ms => new Promise(r => setTimeout(r, ms));

async function post(content, { force = false } = {}) {
  const u = hook();
  if (!u) return { ok: false, error: 'No webhook address saved.' };
  const now = Date.now();
  recent = recent.filter(t => now - t < CAP_MS);
  if (!force && recent.length >= CAP)
    return { ok: false, error: 'Paused: ' + CAP + ' alerts in 10 minutes.', quiet: true };
  recent.push(now);
  const body = JSON.stringify({
    content: clip(content, MAX_LEN),
    username: 'Technically Not',
    allowed_mentions: { parse: [] },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(u, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      return fail(
        err?.name === 'TimeoutError' ? 'Discord didn’t answer in time.' : 'Couldn’t reach Discord.'
      );
    }
    if (res.ok) {
      saveNote({ lastError: '', lastSentAt: Date.now() });
      return { ok: true };
    }
    if (res.status === 429 && attempt === 0) {
      let after = Number(res.headers.get('retry-after')) || 0;
      try {
        after = Number((await res.json())?.retry_after) || after;
      } catch {}
      if (after > 0 && after <= 30) {
        await wait(Math.ceil(after * 1000));
        continue;
      }
    }
    return fail(
      res.status === 401 || res.status === 404
        ? 'Discord says this webhook no longer exists. Paste a new one.'
        : res.status === 429
          ? 'Discord is rate-limiting this webhook right now.'
          : 'Discord answered HTTP ' + res.status + '.'
    );
  }
  return fail('Discord is rate-limiting this webhook right now.');
}

function fail(error) {
  saveNote({ lastError: error });
  return { ok: false, error };
}

const LINES = {
  needsYou: (name, project, detail) =>
    '🟠 ' + name + ' needs you · ' + project + (detail ? ' — ' + detail : ''),
  finished: (name, project, detail) =>
    '✅ ' + name + ' finished · ' + project + (detail ? ' — ' + detail : ''),
  stuck: (name, project, detail) =>
    '⚠️ ' + name + ' seems stuck · ' + project + (detail ? ' — ' + detail : ''),
};
const away = () => {
  if (focused) return !focused();
  const w = getWin();
  return !w || w.isDestroyed() || !w.isFocused() || w.isMinimized();
};

async function alert(kind, paneId, detail) {
  const c = cfg();
  if (!c.enabled || !c.events[kind] || !hook() || !away()) return false;
  let name = '';
  try {
    name = (await owner(paneId))?.name || '';
  } catch {}
  const key = (name || paneId) + '|' + kind,
    now = Date.now();
  if (now - (sentAt.get(key) || 0) < PER_KEY_MS) return false;
  sentAt.set(key, now);
  const project = path.basename(String(root() || '')) || 'your project';
  const r = await post(
    LINES[kind](clip(name || 'An agent', 40), clip(project, 60), clip(detail, 140))
  );
  return r.ok;
}

// ---- Events from main.js ----

let items = new Map(); // "Needs you" item id -> item, from the latest attention:change
const pending = new Map(); // item id -> timer (SETTLE_MS before it counts)
const ended = new Map(); // paneId -> endedAt already seen
const NOT_FINISHED = new Set(['exit', 'interrupted', 'aborted', 'error', '']);

function event(channel, payload) {
  try {
    if (!cfg().enabled) {
      if (channel === 'attention:change')
        items = new Map((payload?.items || []).map(i => [i.id, i]));
      return;
    }
    if (channel === 'attention:change') {
      const next = new Map((payload?.items || []).map(i => [i.id, i]));
      for (const [id, it] of next)
        if (!items.has(id) && !pending.has(id)) {
          const t = setTimeout(() => {
            pending.delete(id);
            if (items.has(id)) alert('needsYou', it.paneId, items.get(id).detail || '');
          }, SETTLE_MS);
          t.unref?.();
          pending.set(id, t);
        }
      for (const [id, t] of pending)
        if (!next.has(id)) {
          clearTimeout(t);
          pending.delete(id);
        }
      items = next;
    } else if (channel === 'agent:turn' && payload?.paneId) {
      if (payload.cleared) {
        ended.delete(payload.paneId);
        return;
      }
      if (!payload.endedAt || ended.get(payload.paneId) === payload.endedAt) return;
      ended.set(payload.paneId, payload.endedAt);
      if (NOT_FINISHED.has(payload.endedBy || '') || Date.now() - payload.endedAt > 2 * 60 * 1000)
        return;
      alert('finished', payload.paneId, payload.task || '');
    } else if (
      channel === 'agent:loop' &&
      payload?.on &&
      payload.paneId &&
      payload.kind !== 'overrun'
    ) {
      // a long sub-agent is a bell notice only
      const tools = [...new Set(payload.tools || [])]
        .map(t => String(t).replace(/^mcp__.+?__/, ''))
        .join(', ');
      alert(
        'stuck',
        payload.paneId,
        'repeating ' + (tools || 'the same step') + (payload.agentId ? ' (a sub-agent)' : '')
      );
    }
  } catch {}
}

module.exports = {
  init(deps = {}) {
    if (deps.owner) owner = deps.owner;
    if (deps.root) root = deps.root;
    if (deps.window) getWin = deps.window;
  },
  event,
  forget: paneId => {
    ended.delete(paneId);
  },
  get: publicState,
  // patch: { enabled?, webhookUrl?, events? }. An empty webhookUrl removes it. Refused: an address
  // that isn't a Discord webhook.
  set(patch = {}) {
    const c = cfg();
    if (patch.webhookUrl !== undefined) {
      const raw = String(patch.webhookUrl || '').trim();
      if (raw) {
        const u = valid(raw);
        if (!u)
          return {
            ok: false,
            error:
              'That isn’t a Discord webhook address. It starts with https://discord.com/api/webhooks/.',
            value: publicState(),
          };
        const why = unavailable();
        if (why) return { ok: false, error: why, value: publicState() };
        try {
          writeUrl(u);
        } catch {
          return { ok: false, error: 'Couldn’t save the webhook address.', value: publicState() };
        }
        url = u;
        c.lastError = '';
      } else {
        try {
          writeUrl('');
        } catch {}
        url = '';
        c.lastError = '';
      }
    }
    if (patch.enabled === true && !hook())
      return {
        ok: false,
        error: 'Paste your Discord webhook address first.',
        value: publicState(),
      };
    if (patch.enabled !== undefined) c.enabled = patch.enabled === true;
    if (patch.events && typeof patch.events === 'object')
      for (const k of EVENTS)
        if (typeof patch.events[k] === 'boolean') c.events[k] = patch.events[k];
    if (!hook()) c.enabled = false;
    try {
      writeConfig(c);
    } catch {}
    return { ok: true, value: publicState() };
  },
  // "Send test": one message now, whatever the window, the events or the throttle say (still needs
  // a saved webhook).
  async test() {
    const project = path.basename(String(root() || '')) || 'your project';
    const r = await post(
      '🔔 Technically Not test · ' + clip(project, 60) + ' — alerts from this PC will arrive here.',
      { force: true }
    );
    return { ...r, value: publicState() };
  },
  _test:
    !release && process.env.TNAI_SELFTEST
      ? {
          allowLocal(on) {
            allowLocal = !!on;
          },
          focused(fn) {
            focused = typeof fn === 'function' ? fn : null;
          },
          reset() {
            sentAt.clear();
            recent = [];
            items = new Map();
            for (const t of pending.values()) clearTimeout(t);
            pending.clear();
            ended.clear();
            config = null;
            url = null;
          },
          settleMs: SETTLE_MS,
        }
      : null,
};
