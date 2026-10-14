/*
 * Technically Not tools · desktop-check/tests/remote-agents.main.js — Main-process side of
 * remote-agents.js: hands the window one state as the remote service would push it
 * (`remote:change`) and one live-view model as it would hand it to the open view (`remote:view`),
 * so another computer's agents can be looked at on the Agents page without a second app or a relay.
 * Both are made up by the test and labeled so there; nothing is sent anywhere. `install` records
 * pty:start instead of launching anything (no process, no CLI, no credits), so the test can have
 * one agent of this computer beside them. `spy` writes down what the window asks the remote service
 * (a view, its end, a prompt, an act, the state) and hands each call on unchanged; `calls` lists
 * them. `loadCalls` runs the page's script once more, alone, against a stand-in window and says
 * what it asked the remote bridge while loading (nothing may be asked of the
 * main process at the app's start for a feature that may be off).
 */
'use strict';
const { ipcMain } = require('electron');
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
module.exports = win => {
  const calls = [];
  let spied = null;
  return {
    show(state) {
      win.webContents.send('remote:change', state);
      return true;
    },
    view(model) {
      win.webContents.send('remote:view', model);
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
    install() {
      let pid = 920000;
      ipcMain.removeHandler('pty:start');
      ipcMain.handle('pty:start', (_e, options) => ({
        ok: true,
        value: {
          paneId: options.paneId,
          agent: options.agent,
          pid: ++pid,
          sessionId: '',
          resumable: false,
          cwd: '',
        },
      }));
      return true;
    },
    // → the channels that are written down from now on. Each call still reaches the app's own
    // handler.
    spy() {
      if (spied) return spied;
      spied = [];
      for (const ch of [
        'remote:view',
        'remote:unview',
        'remote:keepView',
        'remote:prompt',
        'remote:act',
        'remote:state',
      ]) {
        const own = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(ch);
        if (typeof own !== 'function') continue;
        ipcMain.removeHandler(ch);
        ipcMain.handle(ch, (event, ...args) => {
          calls.push({ ch, args, at: Date.now() });
          return own(event, ...args);
        });
        spied.push(ch);
      }
      return spied;
    },
    calls: () => calls,
    loadCalls() {
      const src = fs.readFileSync(
          path.join(__dirname, '..', '..', '..', 'src', 'scripts', '116-remote-agents.js'),
          'utf8'
        ),
        asked = [];
      const remote = new Proxy(
        {},
        {
          get:
            (_t, name) =>
            (...args) => {
              asked.push(String(name));
              return name === 'on' || name === 'onView'
                ? () => {}
                : Promise.resolve({ ok: true, value: null });
            },
        }
      );
      const node = () => ({
        querySelector: () => node(),
        classList: { contains: () => false },
        addEventListener() {},
      });
      const window = { tnaiNative: { remote }, addEventListener() {}, dispatchEvent() {} };
      const document = {
        getElementById: () => node(),
        querySelector: () => node(),
        addEventListener() {},
        hidden: false,
      };
      vm.runInNewContext(src, {
        window,
        document,
        MutationObserver: class {
          observe() {}
        },
        CustomEvent: class {},
        setTimeout,
        clearTimeout,
        console,
      });
      return new Promise(resolve => setTimeout(() => resolve(asked), 60));
    },
  };
};
