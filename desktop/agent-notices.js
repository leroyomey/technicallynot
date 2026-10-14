/*
 * Technically Not · desktop/agent-notices.js — App notices for a WORKING Claude Code agent.
 * A notice typed into a busy agent's prompt waits in the CLI's queue until
 * its task ends, which is too late for "your command may have changed a file another agent holds".
 * So main.js holds it here instead, and agent-hooks.js hands it over as additionalContext after the
 * main agent's next tool call (take): the agent reads it within one step and is not interrupted. A
 * notice no tool call took within WAIT_MS (a long command, pure thinking, waiting on sub-agents),
 * or still held when the task ends (flush), is typed in the old way through its own fallback, so
 * none is lost. Only app notices come here: `tnai send` messages between agents stay queued
 * prompts. Other CLIs have no such hook and keep the typed notice. Main process only.
 */
'use strict';

const WAIT_MS = 60e3;
const held = new Map(); // paneId → [{ text, fallback, timer }]

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

// fallback(): types the notice into the panel (main.js). waitMs is for the check only.
function hold(paneId, text, fallback, waitMs = WAIT_MS) {
  if (!paneId || !text) return false;
  const n = { text: String(text), fallback };
  n.timer = setTimeout(() => late(paneId, n), waitMs);
  n.timer.unref?.();
  held.set(paneId, [...(held.get(paneId) || []), n]);
  return true;
}

// The main agent's PostToolUse: everything held for it, as one note ('' when nothing is).
function take(paneId) {
  const q = held.get(paneId) || [];
  if (!q.length) return '';
  for (const n of q) clearTimeout(n.timer);
  held.delete(paneId);
  return (
    'Technically Not notice — this arrived while you work. It is not a new task: read it now, act on it if it concerns what you are doing, then carry on.\n' +
    q.map(n => '• ' + n.text).join('\n')
  );
}

// The task ended with notices no tool call took: typed in now.
function flush(paneId) {
  for (const n of [...(held.get(paneId) || [])]) late(paneId, n);
}

// The panel closed: nothing left to tell.
function forget(paneId) {
  for (const n of held.get(paneId) || []) clearTimeout(n.timer);
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
