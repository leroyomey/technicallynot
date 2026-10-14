/*
 * Technically Not tools · desktop-check/tests/agent-permissions.main.js — Main-process side of
 * agent-permissions.js: registers Technically Not's hooks for a pane id without launching any CLI,
 * and posts Claude Code-shaped PermissionRequest hooks to Technically Not's hook server, returning
 * the hook's reply (held open until the card is answered).
 */
'use strict';
const hooks = require('../../../desktop/agent-hooks.js');

// OpenCode: a stand-in for the panel's own server (opencode-stand-in.js) behind the real
// desktop/opencode-link.js, so its permission requests take the app's real path (link ->
// agent-hooks.js -> 'agent:permission' -> the card; attention-service.js for "Needs you").
const link = require('../../../desktop/opencode-link.js');
const attention = require('../../../desktop/attention-service.js');
const { standIn } = require('../opencode-stand-in.js');
let oc = null;

module.exports = win => ({
  // The "Needs you" list as main pushes it to the window (71), with stand-in items: no CLI, no
  // screen to read.
  attn(state) {
    win.webContents.send('attention:change', state);
    return true;
  },
  async register(paneId) {
    await hooks.launchOptions(paneId, 'Claude Code');
    return hooks.endpoint(paneId).hook;
  },
  async ask(url, tool, input) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        tool_name: tool,
        tool_input: input,
      }),
    });
    return res.text();
  },
  async ocStart(paneId) {
    link.tune({ first: 20, retryMin: 40, retryMax: 200 }, ['9.9.9']);
    oc = await standIn('stand-in-password').listen();
    link.attach(paneId, oc.port, 'stand-in-password');
    for (let i = 0; i < 100 && !link.state(paneId)?.connected; i++)
      await new Promise(r => setTimeout(r, 30));
    return !!link.state(paneId)?.connected;
  },
  ocSend(type, properties) {
    oc.send(type, properties);
    return true;
  },
  ocPending(list) {
    oc.permissions = list;
    return true;
  },
  ocDrop() {
    oc.drop();
    return true;
  },
  ocFail(on) {
    oc.failPosts = !!on;
    return true;
  },
  ocCalls() {
    return oc.calls.map(c => ({ url: c.url, body: c.body }));
  },
  ocNeeds(paneId) {
    return attention
      .list()
      .items.filter(i => i.paneId === paneId)
      .map(({ id, kind, detail, inferred, tool }) => ({ id, kind, detail, inferred, tool }));
  },
  ocAnswer(id, decision) {
    return hooks.answerPermission(String(id), String(decision));
  },
  ocClosePanel(paneId) {
    link.close(paneId);
    return true;
  },
  async ocStop() {
    if (oc) await oc.close();
    oc = null;
    return true;
  },
  async hook(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.text();
  },
});
