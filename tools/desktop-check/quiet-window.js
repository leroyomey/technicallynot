/*
 * * Technically Not tools · desktop-check/quiet-window.js — Keeps a desktop test from taking the
 * * keyboard when the APP asks for it. The test window is already created not focusable
 * * (desktop/main.js, quietTestWindow), but parts of the app a test reaches ask for the keyboard
 * * themselves: a finished sign-in (desktop/user-auth.js, finishSignIn: show, always on top,
 * focus),
 * * the prompt() window (desktop/prompt-dialog.js: show), a pop-out (a new window, shown and active
 * * from its first moment). A test's .main.js calls quietWindow(win) once; from then on those calls
 * * do nothing for this window and for every window opened after it, and a pop-out is created
 * hidden
 * * and not focusable. A modal window (the prompt) stays hidden: Electron can only show one as the
 * * active window, so a test measures it hidden and waits for showAsked(window) instead. The app's
 * own files are not changed. The calls are counted, so a test can say
 * * that the app did ask and nothing reached Windows (state()).
 */
'use strict';
const { app, screen, BrowserWindow } = require('electron');

// The monitor tests open on, as testWindowPlace in desktop/main.js picks it: never the main
// (primary) monitor, where the user works; among the others the smallest (user, 2026-10-21,
// twice: tests on "the second monitor", not "my main monitor"; on this PC the 3440 × 1440 screen).
// Not by the mouse pointer: the user moves it between screens. Nothing with one monitor.
let picked = null;

function testMonitor() {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return null;
  if (picked && displays.some(display => display.id === picked.id)) return picked;
  const main = screen.getPrimaryDisplay().id;
  const others = displays.filter(display => display.id !== main);
  const area = display => display.workArea.width * display.workArea.height;
  picked = others.reduce((least, display) => (area(display) < area(least) ? display : least));
  return picked;
}

// Where a window of a test belongs: a little in from the corner of the test monitor. The name is
// kept from when that was always the second monitor.
function secondMonitorPlace() {
  const monitor = testMonitor();
  if (!monitor) return {};
  return { x: monitor.workArea.x + 60, y: monitor.workArea.y + 60 };
}

// true when the window lies, even partly, on the monitor the user works on (any monitor but the
// test monitor) while a test monitor exists. The name is kept from when that was the main monitor.
function onMainMonitor(target) {
  const monitor = testMonitor();
  if (!monitor) return false;
  return screen.getDisplayMatching(target.getBounds()).id !== monitor.id;
}

module.exports = function quietWindow(win) {
  // asked: how often the app asked for each thing. popouts: 'hidden' once pop-outs are created
  // hidden, 'refused' when that was not possible and none may open at all.
  const seen = {
    asked: { focus: 0, show: 0, onTop: 0, moveTop: 0 },
    popouts: '',
    opened: 0,
    keptHidden: 0,
  };

  // the windows the app asked to show, whether or not they were shown
  const askedToShow = new WeakSet();

  // One window: focus, moveTop and the page's own focus do nothing; show shows it without making
  // it the active window. A modal window is not shown at all: for one, Electron's showInactive
  // does nothing and show makes it the active window. The replacements sit on this one object, the
  // same one the app holds.
  function quietOne(target, isMain) {
    target.focus = () => {
      seen.asked.focus++;
    };
    target.moveTop = () => {
      seen.asked.moveTop++;
    };
    target.show = () => {
      seen.asked.show++;
      if (target.isDestroyed() || target.isVisible()) return;
      if (!askedToShow.has(target) && target.isModal()) seen.keptHidden++;
      askedToShow.add(target);
      if (!target.isModal()) target.showInactive();
    };
    target.webContents.focus = () => {
      seen.asked.focus++;
    };

    // Always on top is swallowed for the test window only (sign-in turns it on and off around its
    // focus call); a pop-out keeps its own "On top" button.
    if (isMain)
      target.setAlwaysOnTop = () => {
        seen.asked.onTop++;
      };
  }

  quietOne(win, true);

  // Every window opened from now on (a prompt, a confirm, a pop-out): not focusable, quiet, and off
  // the main monitor. A prompt is created hidden, so this runs before the app shows it.
  app.on('browser-window-created', (_event, child) => {
    if (child === win || child.isDestroyed()) return;
    seen.opened++;
    child.setFocusable(false);
    quietOne(child, false);
    const place = secondMonitorPlace();
    if (place.x != null && onMainMonitor(child)) child.setPosition(place.x, place.y);
  });

  // A pop-out is made by window.open, and Electron shows a new window as the active one the moment
  // it exists, before any event a test could catch. So the app's answer to window.open is passed
  // through here and gets "hidden, not focusable, second monitor" added. The app's handler is kept
  // on the page's object by Electron itself (setWindowOpenHandler stores it); when it is not found
  // there (another Electron version), no pop-out may open at all: a failed check, never a window.
  const contents = win.webContents;
  const appAnswer = contents._windowOpenHandler;
  if (typeof appAnswer === 'function') {
    seen.popouts = 'hidden';
    contents.setWindowOpenHandler(details => {
      const answer = appAnswer(details);
      if (answer && answer.action === 'allow')
        answer.overrideBrowserWindowOptions = {
          ...answer.overrideBrowserWindowOptions,
          show: false,
          focusable: false,
          ...secondMonitorPlace(),
        };
      return answer;
    });
  } else {
    seen.popouts = 'refused';
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  return {
    // true once the app asked to show this window (a modal one stays hidden, see above)
    showAsked: target => askedToShow.has(target),

    // What a test reads back: the counts above, and whether any window of this app is the active
    // one, can become it, or is shown on the main monitor right now.
    state: () => {
      const open = BrowserWindow.getAllWindows().filter(one => !one.isDestroyed());
      return {
        asked: { ...seen.asked },
        popouts: seen.popouts,
        opened: seen.opened,
        keptHidden: seen.keptHidden,
        active: open.some(one => one.isFocused()),
        focusable: open.some(one => one.isFocusable()),
        onMain: open.some(one => one.isVisible() && onMainMonitor(one)),
      };
    },
  };
};
