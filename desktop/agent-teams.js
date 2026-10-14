/*
 * Technically Not desktop · agent-teams.js — Opt-in teams the USER sets up ("team mode").
 * Agents started separately each hold their own file
 * locks; agents the user groups into a team share them like one lead tree (file-locks.js
 * deps.family), except that a whole-file rewrite stays exclusive for a short window (file-locks.js
 * deps.team). Only the user changes a team: the Team dialog on the Agents page (88) over IPC
 * `teams:set`, or `tnai team NAME NAME...` typed in a plain terminal panel (agent-mesh.js refuses
 * it from an agent). A team is a set of panel ids; a panel is on at most one team; a team of fewer
 * than two ends. Members leave when their panel closes (main.js ptyCleanup). In memory only:
 * nothing is saved. Main process only.
 */
'use strict';

const MAX = 12; // members per team (the terminal panel limit per workspace)
let teams = []; // [{ id, panes: Set<paneId> }]
let seq = 0;
let onChange = () => {};

const of = paneId => teams.find(t => t.panes.has(paneId)) || null;

function prune() {
  teams = teams.filter(t => t.panes.size >= 2);
}

function state() {
  return { teams: teams.map(t => ({ id: t.id, panes: [...t.panes] })) };
}

function changed(before) {
  const after = JSON.stringify(state());
  if (after !== before) {
    try {
      onChange(state());
    } catch (e) {
      console.warn('[tnai] team change failed:', e?.message || e);
    }
  }
}

// paneId's team becomes paneId + mates (each taken off any other team). No mates: paneId leaves its
// team.
function set(paneId, mates) {
  if (typeof paneId !== 'string' || !paneId) return { ok: false, error: 'No agent.' };
  const before = JSON.stringify(state());
  const list = [
    ...new Set(
      (Array.isArray(mates) ? mates : []).filter(p => typeof p === 'string' && p && p !== paneId)
    ),
  ].slice(0, MAX - 1);

  // A changed team keeps its id and its place, so the number the Agents page list shows for it
  // ("Team 1") does not move when a member joins or leaves.
  const old = of(paneId) || list.map(of).find(Boolean) || null;
  for (const t of teams) {
    t.panes.delete(paneId);
    for (const p of list) t.panes.delete(p);
  }
  if (list.length) {
    const next = { id: old ? old.id : 't' + ++seq, panes: new Set([paneId, ...list]) },
      at = old ? teams.indexOf(old) : -1;
    if (at >= 0) teams[at] = next;
    else teams.push(next);
  }
  prune();
  changed(before);
  return { ok: true, team: list.length ? [paneId, ...list] : [] };
}

function leave(paneId) {
  const t = of(paneId);
  if (!t) return false;
  const before = JSON.stringify(state());
  t.panes.delete(paneId);
  prune();
  changed(before);
  return true;
}

module.exports = {
  // listener(state) runs after every change.
  init(listener) {
    onChange = typeof listener === 'function' ? listener : onChange;
  },
  set,
  leave,
  forget: leave,
  // The team id of a panel, or '' when it is on none.
  teamOf(paneId) {
    return of(paneId)?.id || '';
  },
  // A panel's teammates (panel ids, without itself).
  mates(paneId) {
    const t = of(paneId);
    return t ? [...t.panes].filter(p => p !== paneId) : [];
  },
  state,
  _test: {
    reset() {
      teams = [];
      seq = 0;
    },
  },
};
