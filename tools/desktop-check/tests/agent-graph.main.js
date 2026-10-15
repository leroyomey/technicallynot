// Technically Not tools · desktop-check/tests/agent-graph.main.js — Main-process side of
// agent-graph.js: replaces pty:start with a recorder (no process is launched, so no real Claude
// Code and no credits) and the graph:* handlers with a fake graph the test drives
// (graph:spawnFailed recorded), and agents:detect on request (a signed-out CLI); pushes graph:state
// / graph:spawn / graph:close to the window like desktop/agent-graph.js does. The window size and
// touch come from the thread-tablet test's helper; the window is never focused or shown.
'use strict';
const { ipcMain } = require('electron');
const tabletHelper = require('./thread-tablet.main.js');

module.exports = win => {
  const starts = [],
    calls = [];
  let state = {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [],
  };
  const push = () => {
    if (!win.isDestroyed()) win.webContents.send('graph:state', state);
    return state;
  };
  const replace = (channel, fn) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_e, ...args) => fn(...args));
  };
  return {
    // size(width, height) and touch(on), for the helper line at the smallest window and by finger.
    ...tabletHelper(win),

    // The page behaves as if it had the keyboard, so a focus ring can be drawn and pictured, while
    // the window itself stays unfocused and takes nothing from the user's own window.
    async pageFocus(on) {
      const tools = win.webContents.debugger;
      if (!tools.isAttached()) tools.attach('1.3');
      await tools.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: !!on });
      return true;
    },

    // The page's zoom factor, read and (for the one step that measures the focus ring) set. The
    // app sets it again by itself at the next change of the window's size (desktop/main.js).
    zoom: () => win.webContents.getZoomFactor(),
    async setZoom(factor) {
      win.webContents.setZoomFactor(factor);
      await new Promise(resolve => setTimeout(resolve, 400));
      return win.webContents.getZoomFactor();
    },

    // The colors of one row of real screen pixels in a fresh picture of the window: from `before`
    // pixels left of the page position (left, middle; CSS px) to `after` pixels right of it. The
    // page counts the ring's thickness in them.
    async pixelRow(left, middle, before, after) {
      const picture = await win.webContents.capturePage();
      const size = picture.getSize();
      const zoom = win.webContents.getZoomFactor();
      const [contentWidth, contentHeight] = win.getContentSize();
      const scale = size.width / contentWidth;
      const bitmap = picture.toBitmap();
      const startX = Math.round(left * zoom * scale);
      const rowY = Math.min(size.height - 1, Math.round(middle * zoom * scale));

      // A window that reads 0 wide (minimized) made the scale Infinity, and the loop below then
      // never ended (x stayed Infinity) and filled the main process to 4 GB (learned 2026-10-14).
      // No usable picture fails the step with the window's state instead.
      if (!size.width || !size.height || !Number.isFinite(startX) || !Number.isFinite(rowY))
        throw new Error(
          'no picture to read: picture ' +
            size.width +
            ' x ' +
            size.height +
            ', window ' +
            contentWidth +
            ' x ' +
            contentHeight +
            (win.isMinimized() ? ', minimized' : '') +
            (win.isVisible() ? '' : ', hidden')
        );
      const row = [];

      // counted by offset, so the loop always ends after before + after + 1 pixels
      for (let offset = -before; offset <= after; offset++) {
        const x = startX + offset;

        // four bytes a pixel, in the order blue, green, red, alpha
        const at = (rowY * size.width + Math.max(0, Math.min(size.width - 1, x))) * 4;
        row.push([bitmap[at + 2], bitmap[at + 1], bitmap[at]]);
      }
      return { zoom, scale, row };
    },
    install() {
      let pid = 900000;
      replace('pty:start', options => {
        starts.push(options);
        return {
          ok: true,
          value: {
            paneId: options.paneId,
            agent: options.agent,
            pid: ++pid,
            sessionId: '',
            resumable: false,
            cwd: '',
          },
        };
      });
      replace('graph:state', () => state);
      replace('graph:keep', (nodeId, on) => {
        calls.push(['keep', nodeId, on]);
        const n = state.nodes.find(x => x.id === nodeId);
        if (n) {
          n.persistent = !!on;
          n.closesAt = on ? 0 : Date.now() + state.settings.graceSeconds * 1000;
        }
        return push();
      });
      replace('graph:settings', patch => {
        calls.push(['settings', patch]);
        state.settings = { ...state.settings, ...patch };
        return push();
      });
      replace('graph:removed', paneId => {
        calls.push(['removed', paneId]);
        return push();
      });
      replace('graph:spawnFailed', (nodeId, reason) => {
        calls.push(['spawnFailed', nodeId, reason]);
        return true;
      });
      return true;
    },
    // CLI detection the window sees (e.g. a signed-out CLI), instead of this PC's real one.
    detect(list) {
      replace('agents:detect', () => list);
      return true;
    },
    setState(next) {
      state = next;
      return push();
    },
    emit(channel, payload) {
      win.webContents.send(channel, payload);
      return true;
    },
    starts: () => starts,
    calls: () => calls,
  };
};
