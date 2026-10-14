/*
 * Technically Not desktop · handoff-history.js — The record of agent handoffs (54-context-upkeep.js
 * "Retire & hand off"): one entry per attempt, written by the window (102-handoff-history.js) as
 * the real retire() steps happen, kept in userData/handoff-history.json (the last KEEP, older ones
 * dropped quietly), pushed on change (`handoffs:changed`). The id comes from the old agent's
 * session (paneId + its session start), so a repeated write updates the same entry instead of
 * adding one. chain: the id of the first entry of a run of takeovers (Maya → Maya 2 → Maya 3), set
 * here when the old agent had itself taken over from another. Main process only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const sessionStore = require('./session-store');

const KEEP = 200;
let list = null; // newest first
let send = () => {};
const file = () => path.join(app.getPath('userData'), 'handoff-history.json');
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = v => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
const strs = (a, n, len) =>
  Array.isArray(a)
    ? a
        .filter(x => typeof x === 'string' && x)
        .slice(0, n)
        .map(x => x.slice(0, len))
    : [];

function load() {
  if (list) return list;
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    list = Array.isArray(j?.handoffs) ? j.handoffs.filter(e => e && typeof e.id === 'string') : [];
  } catch {
    list = [];
  }
  return list;
}

function save() {
  try {
    sessionStore.writeAtomic(file(), JSON.stringify({ v: 1, handoffs: list }));
  } catch (e) {
    console.warn('[tnai] handoff history not saved:', e?.message || e);
  }
}
const state = () => ({ handoffs: load().map(e => ({ ...e })) });

function changed() {
  save();
  try {
    send('handoffs:changed', state());
  } catch {}
}

// Only known fields, clipped; unknown numbers stay null (never guessed).
function clean(e, old = {}) {
  const who = (x, o = {}) => ({
    paneId: str(x?.paneId ?? o.paneId, 200),
    name: str(x?.name ?? o.name, 120),
  });
  const r = e.reason ?? old.reason ?? {};
  const s = e.summary ?? old.summary ?? {};
  return {
    id: old.id || str(e.id, 300),
    chain: old.chain || '',
    at: num(e.at ?? old.at) ?? Date.now(),
    from: who(e.from, old.from),
    to: who(e.to, old.to),
    agent: str(e.agent ?? old.agent, 60),
    model: str(e.model ?? old.model, 120),
    account: str(e.account ?? old.account, 200),
    reason: {
      kind: ['context', 'age', 'requests', 'manual'].includes(r.kind) ? r.kind : 'manual',
      n: num(r.n),
    },
    before: num(e.before !== undefined ? e.before : old.before),
    after: num(e.after !== undefined ? e.after : old.after),
    task: str(e.task ?? old.task, 600),
    entryId: str(e.entryId ?? old.entryId, 40),
    project: str(e.project ?? old.project, 600),
    summary: {
      did: strs(s.did, 6, 300),
      next: strs(s.next, 6, 300),
      files: strs(s.files, 12, 300),
    },
    result: ['pending', 'ok', 'failed'].includes(e.result) ? e.result : old.result || 'pending',
    error: str(e.error ?? old.error, 400),
    confirmedAt: num(e.confirmedAt ?? old.confirmedAt),
  };
}

// Adds an entry, or updates the one with the same id.
function put(e) {
  if (!e || typeof e.id !== 'string' || !e.id) return { ok: false, error: 'No handoff id.' };
  load();
  const i = list.findIndex(x => x.id === e.id);
  if (i >= 0) {
    list[i] = clean(e, list[i]);
    changed();
    return { ok: true, id: e.id };
  }
  const n = clean(e);
  const prior = list.find(x => x.result === 'ok' && x.to.paneId && x.to.paneId === n.from.paneId);
  n.chain = prior ? prior.chain || prior.id : n.id;
  list.unshift(n);
  if (list.length > KEEP) list.length = KEEP;
  changed();
  return { ok: true, id: n.id };
}

function update(id, patch) {
  load();
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return { ok: false, error: 'No such handoff.' };
  list[i] = clean({ ...patch, id }, list[i]);
  changed();
  return { ok: true };
}

module.exports = {
  init(sender) {
    if (typeof sender === 'function') send = sender;
  },
  state,
  put,
  update,
  _test: {
    reset() {
      list = [];
      changed();
    },
  },
};
