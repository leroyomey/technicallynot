// Technically Not tools · desktop-check/tests/all-threads-asks.main.js — main-process side of
// all-threads-asks.js: the made-up transcript and the window size (thread-helpers.main.js), a tool
// permission asked for a panel without any CLI asking it (a Claude Code-shaped hook posted to the
// app's own hook server, as agent-permissions.main.js does; the reply is what the user answered),
// a folder-trust question pushed to the window (as trust-ask.main.js does), and a held prompt.
'use strict';
const hooks = require('../../../desktop/agent-hooks.js');
const attention = require('../../../desktop/attention-service');
const threadHelpers = require('./thread-helpers.main.js');

// ticket -> the hook's reply, once the question was answered
const replies = new Map();
let asked = 0;

module.exports = win => ({
  ...threadHelpers(win),

  // Where that panel's hooks are posted. A panel whose CLI is running has its address already;
  // a plain PowerShell panel gets one here.
  async hookUrl(paneId) {
    let known = '';
    try {
      known = hooks.endpoint(paneId)?.hook || '';
    } catch {
      known = '';
    }
    if (known) return known;
    await hooks.launchOptions(paneId, 'Claude Code');
    return hooks.endpoint(paneId).hook;
  },

  // Asks and comes back at once with a ticket: the hook's request stays open until the question is
  // answered in the window, and a call held open that long would hold up the runner's pictures.
  permAsk(url, tool, input) {
    const ticket = 'ask' + ++asked;
    replies.set(
      ticket,
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hook_event_name: 'PermissionRequest',
          tool_name: tool,
          tool_input: input,
        }),
      }).then(response => response.text())
    );
    return ticket;
  },

  // The hook's reply for that ticket (what the user answered), or 'still waiting' after `ms`.
  permReply(ticket, ms) {
    const late = new Promise(resolve => setTimeout(() => resolve('still waiting'), ms));
    return Promise.race([replies.get(ticket), late]);
  },

  // A held prompt, as held-go-to.main.js makes one: text in the panel's draft (as if typed there)
  // and a message from another agent held for it. That is what shows the app's "Prompt held"
  // notice. `unhold` takes both away again.
  hold(paneId) {
    attention.typed(paneId, 'my own prompt');
    const result = attention.holdIfDraft(paneId, {
      text: 'hello from a test agent',
      from: 'Claude Code · Tester',
    });
    return result?.heldId || '';
  },
  unhold(paneId, heldId) {
    attention.cancelHeld(heldId);
    attention.typed(paneId, String.fromCharCode(3));
    return true;
  },
  trustAsk(ask) {
    win.webContents.send('trust:ask', ask);
    return true;
  },
  trustDone(id) {
    win.webContents.send('trust:done', { id });
    return true;
  },

  // What the window is to the system, for the line that says a size was not taken. The window is
  // never restored here: only thread-tablet may do that, so a size test never moves a window.
  state: () =>
    [
      win.isMinimized() ? 'minimized' : 'not minimized',
      win.isVisible() ? 'shown' : 'hidden',
      win.getContentSize().join(' x '),
    ].join(', '),
});
