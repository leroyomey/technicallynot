/*
 * Technically Not · desktop/agent-notices.js — Notices and agent messages for a WORKING Claude Code
 * agent.
 * A notice typed into a busy agent's prompt waits in the CLI's queue until its task ends, which is
 * too late for "your command may have changed a file another agent holds", or for another agent's
 * "no need to add that block any more". So main.js (app notices) and agent-mesh.js (`tnai send`
 * messages from other agents) hold it here instead, and agent-hooks.js hands it over as
 * additionalContext after the main agent's next tool call (take): the agent reads it within one
 * step and is not interrupted. A notice no tool call took within WAIT_MS (a long command, pure
 * thinking, waiting on sub-agents), or still held when the task ends (flush), is typed in the old
 * way through its own fallback, so none is lost. Other CLIs have no such hook and keep the typed
 * notice. Main process only.
 */
'use strict';

const WAIT_MS = 60e3;

// paneId → [{ text, fallback, timer, from, onTaken }]; `from` set: a message from another agent
const held = new Map();

function drop(paneId, n) {
  clearTimeout(n.timer);
  const q = (held.get(paneId) || []).filter(x => x !== n);
  if (q.length) held.set(paneId, q);
  else held.delete(paneId);
}

function late(paneId, n) {
  drop(paneId, n);
  try {
    Promise.resolve(n.fallback?.()).catch(() => {});
  } catch {}
}

// fallback(): types the notice into the panel (main.js, agent-mesh.js). waitMs is for the check
// only. from: the sending agent's label, which makes it an agent message; onTaken(): called once
// the agent got it with a tool call (the sender's record says delivered).
function hold(paneId, text, fallback, waitMs = WAIT_MS, { from = '', onTaken = null } = {}) {
  if (!paneId || !text) return false;
  const n = { text: String(text), fallback, from: String(from || ''), onTaken };
  n.timer = setTimeout(() => late(paneId, n), waitMs);
  n.timer.unref?.();
  held.set(paneId, [...(held.get(paneId) || []), n]);
  return true;
}

// The main agent's PostToolUse: everything held for it, as one note ('' when nothing is). App
// notices and agent messages get their own heading, in the order they arrived within each.
function take(paneId) {
  const q = held.get(paneId) || [];
  if (!q.length) return '';
  for (const n of q) clearTimeout(n.timer);
  held.delete(paneId);
  const app = q.filter(n => !n.from);
  const agents = q.filter(n => n.from);
  const parts = [];
  if (app.length)
    parts.push(
      'Technically Not notice — this arrived while you work. It is not a new task: read it now, act on it if it concerns what you are doing, then carry on.\n' +
        app.map(n => '• ' + n.text).join('\n')
    );
  if (agents.length)
    parts.push(
      'Message from another agent — it arrived while you work and is not a new task or the user. Read it now: if it changes what you are doing (a file it holds, work it no longer needs, a correction), adjust; if it asks something, answer with one `tnai send NAME` line when you reach a natural point; if it says "No reply needed", do not reply. Then carry on with your task.\n' +
        agents.map(n => '• [from ' + n.from + '] ' + n.text).join('\n')
    );
  for (const n of q)
    try {
      n.onTaken?.();
    } catch {}
  return parts.join('\n\n');
}

// The task ended with notices no tool call took: typed in now. They leave the held list at once,
// but are typed only after the code that called flush has finished its own run: agent-hooks.js
// calls this from the Stop hook before agent-turns.js marks the task ended, and a fallback typed
// before that mark was held as "still working" and went out only after the 800 ms settle of
// attention-service.js.
function flush(paneId) {
  const due = [...(held.get(paneId) || [])];
  for (const n of due) drop(paneId, n);
  if (!due.length) return;
  setImmediate(() => {
    for (const n of due)
      try {
        Promise.resolve(n.fallback?.()).catch(() => {});
      } catch {}
  });
}

// The panel closed: nothing left to tell. An agent message still goes through its fallback, which
// finds the panel gone and tells the sender it was not delivered (agent-mesh.js).
function forget(paneId) {
  for (const n of [...(held.get(paneId) || [])]) {
    if (n.from) late(paneId, n);
    else clearTimeout(n.timer);
  }
  held.delete(paneId);
}

module.exports = {
  hold,
  take,
  flush,
  forget,
  WAIT_MS,
  _test: { size: paneId => (held.get(paneId) || []).length },
};
