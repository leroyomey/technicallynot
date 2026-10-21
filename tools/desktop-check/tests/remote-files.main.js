// Technically Not tools · desktop-check/tests/remote-files.main.js — main-process side of
// remote-files.js (plan items 42 and 43): everything remote-agents.main.js has (a made-up state
// pushed as the remote service would push it), plus stand-ins for the four calls of another
// computer's files and Live preview. The answers are made up here and labeled so; nothing is
// paired and nothing is sent anywhere. Every ask is written down in `fileAsks`. The window is never
// focused or shown by this file.
'use strict';
const remoteAgents = require('./remote-agents.main.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A tiny made-up JPEG (a gray square), so the picture has something to draw.
const PICTURE =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////' +
  '////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAB' +
  'PxA=';

module.exports = win => {
  const base = remoteAgents(win);
  const asks = [];

  // What is held of the other computer, as remote-browse.js's `get` hands it to the window.
  let held = { list: null, file: null, save: null };
  let picture = null;
  const tell = preview =>
    win.webContents.send('remote:files', { peer: 'sample-computer-1', preview });
  return {
    ...base,

    // The four calls answer from the made-up record above, and each ask moves it on as the other
    // computer would: a list, a file, a save, a picture.
    filesStub() {
      const { ipcMain } = require('electron');
      for (const channel of [
        'remote:askFiles',
        'remote:files',
        'remote:askPreview',
        'remote:preview',
      ])
        ipcMain.removeHandler(channel);
      ipcMain.handle('remote:files', () => ({ ok: true, value: held }));
      ipcMain.handle('remote:preview', () => ({ ok: true, value: picture }));
      ipcMain.handle('remote:askFiles', (_event, pc, op, path, text) => {
        asks.push({ op, path, text: typeof text === 'string' ? text : null });
        setTimeout(() => {
          if (op === 'list')
            held = {
              ...held,
              list: {
                path,
                state: 'shown',
                hidden: path ? 0 : 1,
                more: 0,
                entries: path
                  ? [['app.js', 'f', 30, 'text']]
                  : [
                      ['src', 'd', -1, ''],
                      ['README.md', 'f', 12, 'text'],
                      ['logo.png', 'f', 900, 'picture'],
                    ],
              },
            };
          if (op === 'read')
            held = {
              ...held,
              file:
                path === 'logo.png'
                  ? { path, state: 'binary', kind: 'picture' }
                  : {
                      path,
                      state: 'shown',
                      text: '// sample file\nconst a = 1;\n',
                      size: 28,
                      cut: false,
                    },
            };
          if (op === 'save')
            held = {
              ...held,
              save: path.endsWith('held.js')
                ? { path, state: 'locked', holder: 'Wren' }
                : { path, state: 'saved' },
              file: { ...held.file, text },
            };
          tell(false);
        }, 150);
        return { ok: true, value: { state: 'asked' } };
      });
      ipcMain.handle('remote:askPreview', () => {
        asks.push({ op: 'preview' });
        setTimeout(() => {
          picture = {
            state: 'shown',
            url: 'http://localhost:5173/',
            w: 1280,
            h: 800,
            data: PICTURE,
            shotAt: Date.now(),
          };
          tell(true);
        }, 150);
        return { ok: true, value: { state: 'asked' } };
      });
      return true;
    },
    fileAsks: () => asks.slice(),

    // another computer saved a file here: the notice where it lands
    landed(info) {
      win.webContents.send('remote:landed', info);
      return true;
    },

    async size(width, height) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(width, height);
      await sleep(450);
      return win.getContentSize();
    },
  };
};
