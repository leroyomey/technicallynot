/*
 * Technically Not tools · desktop-check/tests/system-stats.main.js — Main-process side of
 * system-stats.js: resize, minimize/restore the window, and whether this app's own nvidia-smi
 * process is running (the GPU reader must stop while the window is minimized).
 */
'use strict';
const { execFileSync } = require('child_process');

module.exports = win => ({
  setSize(w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    return win.getContentBounds();
  },
  minimize() {
    win.minimize();
    return true;
  },
  restore() {
    win.restore();
    return true;
  },
  // Only this test app's own reader (a child of this main process): an installed Technically Not
  // running on the same PC has its own nvidia-smi.
  nvidiaRunning() {
    try {
      return process.platform === 'win32'
        ? /nvidia-smi/i.test(
            execFileSync(
              'powershell',
              [
                '-NoProfile',
                '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='nvidia-smi.exe' AND ParentProcessId=" +
                  process.pid +
                  '" | ForEach-Object Name',
              ],
              { windowsHide: true }
            ).toString()
          )
        : /nvidia-smi/.test(
            execFileSync('ps', ['-o', 'comm=', '--ppid', String(process.pid)]).toString()
          );
    } catch {
      return false;
    }
  },
});
