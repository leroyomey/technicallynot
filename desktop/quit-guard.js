// Technically Not desktop · quit-guard.js — Asks before quitting stops running terminal sessions
// on macOS. There, Cmd+Q, the app menu's Quit and the Dock's Quit go straight to the app's
// `before-quit` event, past the window's own "N sessions still running" warning (main.js, win
// 'close'). The guard asks in `before-quit` before anything is stopped. When the user cancels,
// every other `before-quit` step must skip too (mesh, watchers, hooks, saving and stopping the
// sessions): Electron still calls them after preventDefault(), so each one asks cancelled() first
// (main.js onQuit(), user-auth.js). On Windows the app quits only through the window's close, which
// warns already, and Restart to update, which asks first, so the guard never asks there.

// The quit events the user cancelled. Electron hands every `before-quit` listener the same event
// object, so a later listener can tell.
const cancelledEvents = new WeakSet();

function create({ platform, running, ask }) {
  return function beforeQuit(event) {
    if (platform !== 'darwin') return;
    const count = running();
    if (!count) return;
    if (ask(count)) return;
    event.preventDefault();
    cancelledEvents.add(event);
  };
}

function cancelled(event) {
  return !!event && typeof event === 'object' && cancelledEvents.has(event);
}

module.exports = { create, cancelled };
