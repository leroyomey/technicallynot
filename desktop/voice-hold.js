/*
 * Technically Not desktop · voice-hold.js — While a voice hold is listening (70-voice-prompt.js),
 * the window being spoken into stays on top of every other window, so a pop-up can't cover it; and
 * when a pop-up takes the keyboard or mouse anyway, the real key/button state is read from Windows
 * so the mic stops the moment the user lets go (the page never sees that keyup).
 */
'use strict';
const { BrowserWindow } = require('electron');
const processStarter = require('./process-starter');

// KeyboardEvent.code (and 70's Mouse4/Mouse5, 'Mouse1' for the mic button itself) → Windows
// virtual-key code.
const VK = {
  Mouse1: 0x01,
  Mouse4: 0x05,
  Mouse5: 0x06,
  Ctrl: 0x11,
  Shift: 0x10,
  Alt: 0x12,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  Space: 0x20,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Tab: 0x09,
  Pause: 0x13,
  ScrollLock: 0x91,
  Insert: 0x2d,
  Delete: 0x2e,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  Backquote: 0xc0,
  Minus: 0xbd,
  Equal: 0xbb,
  BracketLeft: 0xdb,
  BracketRight: 0xdd,
  Backslash: 0xdc,
  Semicolon: 0xba,
  Quote: 0xde,
  Comma: 0xbc,
  Period: 0xbe,
  Slash: 0xbf,
};
const vkOf = code => {
  if (VK[code]) return VK[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
  if ((m = /^Digit(\d)$/.exec(code))) return 0x30 + Number(m[1]);
  if ((m = /^Numpad(\d)$/.exec(code))) return 0x60 + Number(m[1]);
  if ((m = /^F(\d{1,2})$/.exec(code)) && m[1] >= 1 && m[1] <= 24) return 0x6f + Number(m[1]);
  return 0;
};

// Desktop tests (TN_VOICE_FAKE) press keys and the mouse with sendInputEvent, which Windows never
// sees as held: its key state says "up" and raising the window makes Chromium re-read the real (up)
// mouse button, both ending the hold at once. Tests leave the OS alone.
const FAKE_INPUT = !!process.env.TN_VOICE_FAKE;

function createVoiceHold() {
  let held = null; // { win, wasTop, onBlur, watcher, codes, notify }

  // Prints "up" once none of the keys/buttons is down (at once if already up), then exits. Started
  // with the hold (PowerShell takes about a second to start), so a release a pop-up swallows is
  // seen at once. GetAsyncKeyState reads physical buttons: with swapped mouse buttons the primary
  // one is the right button.
  function watch(h) {
    if (process.platform !== 'win32' || h.watcher || FAKE_INPUT) return;
    const vks = [...new Set(h.codes.map(vkOf).filter(Boolean))];
    if (!vks.length) return;
    const script =
      '$k=Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v); [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);\' -Name K -Namespace TnaiVoice -PassThru;' +
      '$v=@(' +
      vks.join(',') +
      ');if($k::GetSystemMetrics(23)){$v=@($v|%{if($_ -eq 1){2}else{$_}})};while(@($v|?{($k::GetAsyncKeyState($_) -band 0x8000) -ne 0}).Count){Start-Sleep -Milliseconds 20};"up"';

    // Started from the process starter's worker thread: a process start holds the thread that
    // starts it, 100 to 800 ms on a busy PC, and on the main thread that froze the window at
    // every voice press (the stall log's `ipc voice:hold`, 2026-10-14). It starts at the same
    // moment as before.
    const child = processStarter.watch(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      {
        onData: data => {
          if (held === h && /up/.test(data)) h.notify();
        },
        onExit: () => {
          if (h.watcher === child) h.watcher = null;
        },
      }
    );
    h.watcher = child;
  }

  function stop() {
    const h = held;
    held = null;
    if (!h) return;
    try {
      h.watcher?.kill();
    } catch {}
    if (h.win.isDestroyed()) return;
    h.win.removeListener('blur', h.onBlur);
    if (!FAKE_INPUT)
      try {
        h.win.setAlwaysOnTop(h.wasTop);
      } catch {}
  }

  // on: codes = the keys/buttons holding it (e.g. ['ControlLeft','Space'] or ['Mouse1']); notify()
  // when they are all released.
  function start(win, codes, notify) {
    stop();
    if (!win || win.isDestroyed()) return false;
    const h = {
      win,
      wasTop: win.isAlwaysOnTop(),
      codes: Array.isArray(codes) ? codes.map(String) : [],
      notify,
      watcher: null,
    };
    h.onBlur = () => {
      if (held !== h || FAKE_INPUT) return;
      try {
        win.moveTop();

        // stays above the pop-up; focus isn't grabbed back, so nothing the user clicked is fought
        // over
      } catch {}
    };
    held = h;
    if (!FAKE_INPUT)
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      } catch {}
    win.on('blur', h.onBlur);
    watch(h);
    return true;
  }

  return {
    start,
    stop,
    pick: sender => BrowserWindow.getFocusedWindow() || BrowserWindow.fromWebContents(sender),
  };
}

module.exports = { createVoiceHold, vkOf };
