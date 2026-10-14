/*
 * Technically Not desktop · agent-ask.js — `tnai ask NAME [--wait SEC] question` (agent-mesh.js):
 * the asker's command waits for the answer. The question is delivered like `tnai send`; the target
 * answers with `tnai send ASKER ...`, and that one message goes straight back to the waiting
 * command instead of into the asker's input. After the wait (or when the asker's command ends) a
 * later answer arrives as a normal message.
 */
'use strict';

const WAIT_DEFAULT = 300,
  WAIT_MAX = 600; // seconds
const waiters = new Set(); // { asker, panes: Set<paneId>, instances: Set<instanceId>, resolve }

const seconds = raw => Math.min(WAIT_MAX, Math.max(10, Math.round(Number(raw) || WAIT_DEFAULT)));

// Waits for one answer to `asker` from the target (its panel, or its conversation's instance when
// it is being revived or took over from a retired one). Resolves { from, text } or null when the
// wait ends first. onClose: the asker's command connection, so an interrupted ask stops waiting.
function wait(asker, target, secs, socket) {
  return new Promise(resolve => {
    const w = {
      asker,
      panes: new Set(target.panes.filter(Boolean)),
      instances: new Set(target.instances.filter(Boolean)),
      socket,
      resolve: null,
    };
    const end = value => {
      if (!waiters.delete(w)) return;
      clearTimeout(timer);
      resolve(value);
    };
    w.resolve = end;
    const timer = setTimeout(() => end(null), secs * 1000);
    waiters.add(w);
    socket?.once('close', () => end(null));
  });
}

// Called for every `tnai send`: true when it answered a waiting ask (the message then goes to that
// command, not into the asker's input).
function answer(sender, senderInstance, toPane, from, text) {
  for (const w of waiters) {
    if (w.asker !== toPane) continue;
    if (!w.panes.has(sender) && !(senderInstance && w.instances.has(senderInstance))) continue;
    w.resolve({ from, text });
    return true;
  }
  return false;
}

// The question was not delivered: stop that command's wait. Only its own (the one on its
// connection): the same agent may have another `tnai ask` waiting, whose question was delivered.
const cancel = (paneId, socket) => {
  for (const w of waiters) if (w.asker === paneId && w.socket === socket) w.resolve(null);
};

module.exports = { wait, answer, cancel, seconds };
