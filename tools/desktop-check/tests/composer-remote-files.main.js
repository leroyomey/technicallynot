/*
 * Technically Not tools · desktop-check/tests/composer-remote-files.main.js — Main-process side of
 * composer-remote-files.js. Hands the window a made-up remote state (`show`, as the remote service
 * pushes `remote:change`), and stands in for the three calls a prompt with files makes
 * (`remote:promptFiles`, `remote:stopFiles`, `remote:showFile`): nothing is paired in the test
 * profile, so nothing could leave anyway, and here nothing even reaches the service. What the
 * window handed over is written down, and each file is put through the app's real checkFile
 * (desktop/remote-files.js): that is the answer to "does the picture the page's canvas writes pass
 * the strict walk the other computer holds", which no plain Node test can give. For a JPEG the
 * marks found in it are listed too, so a refusal names the segment.
 */
'use strict';
const { ipcMain } = require('electron');
module.exports = win => {
  const { checkFile } = require('../../../desktop/remote-files.js');
  const got = { prompts: [], stops: 0, shown: [] };
  let say = { sent: 'asked', n: 'aaaaaaaaaaaaaaaa' },
    hold = null;

  // The marks of a JPEG, in order, as two hex digits each (the scan's own bytes are skipped).
  const marks = b => {
    const out = [];
    let o = 2;
    while (o + 4 <= b.length && b[o] === 0xff && out.length < 64) {
      const m = b[o + 1];
      out.push(m.toString(16));
      if (m === 0xd9) break;
      const len = b.readUInt16BE(o + 2);
      o += 2 + len;
      if (m === 0xda) {
        while (o + 1 < b.length) {
          if (b[o] !== 0xff) {
            o++;
            continue;
          }
          const x = b[o + 1];
          if (x === 0 || (x >= 0xd0 && x <= 0xd7) || x === 0xff) {
            o += x === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
      }
    }
    return out;
  };
  const replace = (ch, fn) => {
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async (_e, ...args) => ({ ok: true, value: await fn(...args) }));
  };
  return {
    show(state) {
      win.webContents.send('remote:change', state);
      return true;
    },
    install() {
      replace('remote:promptFiles', async (peer, agentId, text, mark, files) => {
        const list = (Array.isArray(files) ? files : []).map(f => {
          const b = Buffer.from(
            f && f.bytes instanceof ArrayBuffer
              ? new Uint8Array(f.bytes)
              : f && ArrayBuffer.isView(f.bytes)
                ? f.bytes
                : []
          );
          return {
            kind: String(f && f.kind),
            bytes: b.length,
            why: checkFile(String(f && f.kind), b),
            head: b.subarray(0, 4).toString('hex'),
            marks: f && f.kind === 'jpg' ? marks(b) : [],
            text: f && f.kind === 'txt' ? b.toString('utf8').slice(0, 200) : '',
          };
        });
        got.prompts.push({ peer, agentId, text, mark, files: list });
        if (hold) await hold;
        return say;
      });
      replace('remote:stopFiles', () => {
        got.stops++;
        return {};
      });
      replace('remote:showFile', name => {
        got.shown.push(name);
        return true;
      });
      return true;
    },
    // What the next prompt with files is answered with ('asked': it left).
    answer(word) {
      say = { sent: String(word), n: word === 'asked' ? 'aaaaaaaaaaaaaaaa' : '' };
      return true;
    },
    // Keep the next call open until `release`, so the test can look at the page while files
    // "travel".
    wait() {
      let done;
      hold = new Promise(r => {
        done = r;
      });
      hold.release = done;
      return true;
    },
    release() {
      if (hold) {
        const h = hold;
        hold = null;
        h.release();
      }
      return true;
    },
    got: () => got,
  };
};
