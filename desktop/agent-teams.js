/*
 * Technically Not desktop · agent-teams.js — Opt-in teams the USER sets up ("team mode").
 * Agents started separately each hold their own file
 * locks; agents the user groups into a team share them like one lead tree (file-locks.js
 * deps.family), except that a whole-file rewrite stays exclusive for a short window (file-locks.js
 * deps.team). Only the user changes a team: the Team dialog (88) over IPC `teams:set`, or
 * `tnai team NAME NAME...` typed in a plain terminal panel (agent-mesh.js refuses it from an
 * agent). A team is a set of panel ids; a panel is on at most one team; a team of fewer than two
 * ends. Members leave when their panel closes (main.js ptyCleanup). In memory only: nothing is
 * saved. Main process only.
 *
 * Sub-agents inherit (user 2026-11-02: "The sub-agent should inherit the team of their main
 * agent"): a sub-agent in its own panel is on its lead's team without the user adding it, for as
 * long as the lead is on it. A team the user set on the sub-agent itself wins. The panels of the
 * lead trees come from deps.tree (main.js, from agent-graph.js); main calls refresh() when the
 * graph changes, so a new or closed sub-agent panel updates the team at once.
 */
'use strict';

const MAX = 12; // members per team (the terminal panel limit per workspace)
let teams = []; // [{ id, panes: Set<paneId> }], only the panels the user put on the team
let seq = 0;
let onChange = () => {};
let lastSent = JSON.stringify({ teams: [] });

// tree() → [{ paneId, parentPaneId }] for every open sub-agent panel.
let deps = { tree: () => [] };

function parents() {
  const map = new Map();
  try {
    for (const row of deps.tree() || [])
      if (row?.paneId && row.parentPaneId && row.paneId !== row.parentPaneId)
        map.set(row.paneId, row.parentPaneId);
  } catch (e) {
    console.warn('[tnai] team tree failed:', e?.message || e);
  }
  return map;
}

// The team the user set on this panel itself.
const own = paneId => teams.find(t => t.panes.has(paneId)) || null;

// A panel's team: its own, else the nearest lead's above it.
function of(paneId, map = parents()) {
  let at = paneId;
  for (let i = 0; at && i < 20; i++) {
    const team = own(at);
    if (team) return team;
    at = map.get(at);
  }
  return null;
}

function prune() {
  teams = teams.filter(t => t.panes.size >= 2);
}

// panes: every member, inherited sub-agents included; inherited: the sub-agents among them.
function state() {
  const map = parents();
  const inheritedOf = new Map(teams.map(t => [t, []]));
  for (const paneId of map.keys()) {
    if (own(paneId)) continue;
    const team = of(paneId, map);
    if (team) inheritedOf.get(team).push(paneId);
  }
  return {
    teams: teams.map(t => ({
      id: t.id,
      panes: [...t.panes, ...inheritedOf.get(t)],
      inherited: inheritedOf.get(t),
    })),
  };
}

function changed() {
  const now = state();
  const after = JSON.stringify(now);
  if (after === lastSent) return;
  lastSent = after;
  try {
    onChange(now);
  } catch (e) {
    console.warn('[tnai] team change failed:', e?.message || e);
  }
}

// paneId's team becomes paneId + mates (each taken off any other team). No mates: paneId leaves its
// team.
function set(paneId, mates) {
  if (typeof paneId !== 'string' || !paneId) return { ok: false, error: 'No agent.' };
  const map = parents();
  const picked = [
    ...new Set(
      (Array.isArray(mates) ? mates : []).filter(p => typeof p === 'string' && p && p !== paneId)
    ),
  ];

  // A sub-agent of someone on the new team inherits it, so it is not stored as a member of its own
  // (it then leaves with its lead). The Team dialog shows it checked, so a Save hands it back.
  const roots = new Set([paneId, ...picked]);
  const underRoot = p => {
    let at = map.get(p);
    for (let i = 0; at && i < 20; i++) {
      if (roots.has(at)) return true;
      at = map.get(at);
    }
    return false;
  };
  const list = picked.filter(p => !underRoot(p)).slice(0, MAX - 1);

  // A changed team keeps its id and its place, so the number shown for it ("Team 1") does not move
  // when a member joins or leaves.
  const old = own(paneId) || list.map(own).find(Boolean) || null;
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
  changed();
  return { ok: true, team: list.length ? [paneId, ...list] : [] };
}

function leave(paneId) {
  const t = own(paneId);
  if (!t) return false;
  t.panes.delete(paneId);
  prune();
  changed();
  return true;
}

module.exports = {
  // listener(state) runs after every change; options.tree as in deps above.
  init(listener, options = {}) {
    onChange = typeof listener === 'function' ? listener : onChange;
    if (typeof options.tree === 'function') deps.tree = options.tree;
  },
  set,
  leave,
  forget: leave,
  // The lead trees changed (a sub-agent panel opened or closed): tell the listener if a team did.
  refresh: changed,
  // The team id of a panel (its own or its lead's), or '' when it is on none.
  teamOf(paneId) {
    return of(paneId)?.id || '';
  },
  // True when the panel is on its lead's team, not one the user set on it.
  inherited(paneId) {
    return !own(paneId) && !!of(paneId);
  },
  // A panel's teammates (panel ids, without itself), inherited sub-agents included.
  mates(paneId) {
    const team = of(paneId);
    if (!team) return [];
    const row = state().teams.find(t => t.id === team.id);
    return (row ? row.panes : [...team.panes]).filter(p => p !== paneId);
  },
  state,
  _test: {
    reset() {
      teams = [];
      seq = 0;
      lastSent = JSON.stringify({ teams: [] });
      deps = { tree: () => [] };
    },
  },
};
