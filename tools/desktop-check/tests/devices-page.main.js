/*
 * Technically Not tools · desktop-check/tests/devices-page.main.js — Main-process side of
 * devices-page.js: hands the window one state as the remote service would push it
 * (`remote:change`), so the page can be looked at with a paired computer that has agents without a
 * second app or a relay. The state is made up by the test and labeled as such there; nothing is
 * sent anywhere. For the answer from another computer it also drives the
 * app's REAL permission and held-prompt code (agent-hooks.js, attention-service.js), which load
 * only inside Electron: a Claude Code-shaped PermissionRequest is posted to the app's hook server
 * for a panel id that has no CLI, and `remoteAnswer` makes exactly the call a paired computer's yes
 * or no ends in (remote-service.js `deliver`, then main.js's `answerPermission`). The steps before
 * that call (the session, the rights, the binding) are tools/remote-service-test.js's.
 */
'use strict';
const { ipcMain } = require('electron');
const hooks = require('../../../desktop/agent-hooks.js');
const attention = require('../../../desktop/attention-service.js');
const kept = new Map(),
  // a window channel the test stands in for → the app's own handler; → the calls written down
  calls = new Map();
const asks = new Map(); // token → { reply: promise of the hook's reply text, stop() }
let n = 0;
const post = (url, body, signal) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }).then(r => r.text());

module.exports = win => ({
  show(state) {
    win.webContents.send('remote:change', state);
    return true;
  },
  // The text of a finished answer is no longer in the pushed state: the page asks
  // `remote:reportText` when it shows it. In this profile nothing is paired, so the real service
  // has none; the test says what that call answers (null: as the real one does here).
  answerText(value) {
    ipcMain.removeHandler('remote:reportText');
    ipcMain.handle('remote:reportText', () => ({
      ok: true,
      value: value && typeof value === 'object' ? value : null,
    }));
    return true;
  },
  view(model) {
    win.webContents.send('remote:view', model);
    return true;
  },
  // A press on the page that would reach the remote service (`remote:answer`, `remote:pick`):
  // written down and answered "asked" here, without the service's own state, so the made-up card
  // the test looks at stays. record(channel) starts it and empties the list, recorded(channel) →
  // the arguments of every call since, unrecord(channel) puts the app's own handler back.
  record(channel) {
    const own = kept.get(channel) || ipcMain._invokeHandlers.get(channel);
    kept.set(channel, own);
    calls.set(channel, []);
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_e, ...args) => {
      calls.get(channel).push(args);
      return { ok: true, value: { sent: 'asked' } };
    });
    return true;
  },
  recorded(channel) {
    return calls.get(channel) || [];
  },
  unrecord(channel) {
    const own = kept.get(channel);
    if (own) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, own);
      kept.delete(channel);
    }
    return true;

    // what the open live-view dialog is handed: a made-up picture,
    // as the main process would push a real one
  },
  // A channel the page calls answers with the given replies in turn (the last one repeats), and the
  // arguments of each call are written down for recorded(channel); unrecord(channel) puts the
  // app's own handler back. Used for "Use my own relay": nothing is saved on this PC.
  stub(channel, replies) {
    const own = kept.get(channel) || ipcMain._invokeHandlers.get(channel);
    kept.set(channel, own);
    calls.set(channel, []);
    let i = 0;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_e, ...args) => {
      calls.get(channel).push(args);
      return replies[Math.min(i++, replies.length - 1)];
    });
    return true;
  },
  size(w, h) {
    win.setMinimumSize(800, 600);
    win.setContentSize(w, h);
    return true;
  }, // a layout check at another window size (as usage-stats.main.js)
  async register(paneId) {
    await hooks.launchOptions(paneId, 'Claude Code');
    return hooks.endpoint(paneId).hook;
  },
  // A permission request the app holds open, as Claude Code sends it. → a token for reply() /
  // giveUp().
  ask(url, tool, input) {
    const token = 't' + ++n,
      ctl = new AbortController();
    asks.set(token, {
      reply: post(
        url,
        { hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input },
        ctl.signal
      ).catch(e => 'ERROR ' + (e?.name || e)),
      stop: () => ctl.abort(),
    });
    return token;
  },
  // The hook's reply once the request was answered ('' while it is still held).
  reply(token, ms = 1500) {
    return Promise.race([asks.get(token).reply, new Promise(r => setTimeout(() => r(''), ms))]);
  },
  giveUp(token) {
    asks.get(token).stop();
    return true;
  }, // Claude Code stopped waiting: answered in its terminal, interrupted, its panel closed
  hook(url, body) {
    return post(url, body);
  },
  needs(paneId) {
    return attention
      .list()
      .items.filter(i => i.paneId === paneId)
      .map(({ id, kind, detail, whole, inferred, tool }) => ({
        id,
        kind,
        detail,
        whole,
        inferred,
        tool,
      }));
  },
  held(paneId) {
    return attention
      .list()
      .held.filter(h => h.paneId === paneId)
      .map(h => ({ id: h.id, why: h.why }));
  },
  hold(paneId, text) {
    const r = attention.holdIfBlocked(paneId, { text, ifBusy: true });
    return r ? { state: r.state, reason: r.reason } : null;
  },
  // What a paired computer's answer ends in, character for character: remote-service.js `deliver`
  // (the literal prefix, one of two literal decisions, only `=== true`) calling what main.js hands
  // in (`hooks.answerPermission(String(id), decision === 'once' ? 'once' : 'deny')`).
  remoteAnswer(itemId, say) {
    const rest =
      typeof itemId === 'string' && itemId.startsWith('permission:')
        ? itemId.slice('permission:'.length)
        : '';
    const answerPermission = (id, decision) =>
      hooks.answerPermission(String(id), decision === 'once' ? 'once' : 'deny');
    return rest !== '' && answerPermission(rest, say === 'yes' ? 'once' : 'deny') === true;
  },
  cleanup(paneId) {
    for (const a of asks.values()) a.stop();
    asks.clear();
    for (const h of attention.list().held.filter(x => x.paneId === paneId))
      attention.cancelHeld(h.id);
    return true;
  },
});
