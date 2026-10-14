// Technically Not tools · desktop-check/tests/dialog-audit.main.js — Main-process helpers for
// dialog-audit.js: resize the Technically Not window, and open the desktop prompt() window
// (desktop/prompt-dialog.js) with a given message, measure it, then cancel it; open its confirm
// variant (folder trust) and answer it with a real key press.
// The app shows these windows with show(), which takes the keyboard, and they are modal, which
// Electron cannot show without making them the active window. So here they stay hidden
// (quiet-window.js): each is measured once the app has sized it and asked to show it, and the key
// press is sent straight to its page. Not covered for that reason: that the window appears on
// screen and is the active one when it opens.
'use strict';
const { app } = require('electron');
const promptDialog = require('../../../desktop/prompt-dialog.js');
const quietWindow = require('../quiet-window');
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = win => {
  const quiet = quietWindow(win);
  return helpers(win, quiet);
};

const helpers = (win, quiet) => ({
  quiet: () => quiet.state(),
  // zoom (optional): 1 = the website's homepage demo, which lays the app out at its size unzoomed
  // (main.js's fitZoom would pick 0.85).
  async size(width, height, zoom) {
    win.setContentSize(width, height);
    await sleep(500);
    if (zoom) {
      win.webContents.setZoomFactor(zoom);
      await sleep(300);
    }
    return win.getContentSize();
  },
  // Confirm window (prompt-dialog.js confirm, main.js folder trust): measured like prompt, then
  // answered with a real key (Enter / Escape); returns its answer too.
  async confirm(message, key) {
    global.__tnaiKeepPrompts = true;
    let child = null;
    const grab = (_e, created) => {
      if (created !== win) child = created;
    };
    app.on('browser-window-created', grab);
    const answer = promptDialog.confirm(win, message, {
      ok: 'Trust folder',
      cancel: "Don't allow",
    });
    try {
      const end = Date.now() + 8000;
      while (Date.now() < end && !(child && !child.isDestroyed() && quiet.showAsked(child)))
        await sleep(50);
      if (!child || child.isDestroyed() || !quiet.showAsked(child))
        throw new Error('the app never asked to show the confirm window');
      await sleep(250);
      const [contentWidth, contentHeight] = child.getContentSize();

      // The window stays hidden in a test, and a hidden window's page hears of its new size late:
      // measured too early, the page still had its first height and read as "taller than the
      // window" in one run out of two. Wait until the page has the height the window was given.
      const pageEnd = Date.now() + 2000;
      while (
        Date.now() < pageEnd &&
        (await child.webContents.executeJavaScript('innerHeight')) !== contentHeight
      )
        await sleep(50);
      const page = await child.webContents.executeJavaScript(`(() => {
        const d = document.documentElement, p = document.querySelector('p');
        const buttons = [...document.querySelectorAll('form button')].map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent, h: Math.round(r.height), fits: b.scrollWidth <= b.clientWidth + 1, bottom: Math.round(r.bottom) }; });
        return { scrollHeight: d.scrollHeight, innerHeight, scrollWidth: d.scrollWidth, innerWidth, pClipped: p.scrollWidth > p.clientWidth + 1, scrolls: d.classList.contains('scroll'), focused: document.activeElement?.textContent || '', buttons };
      })()`);
      for (const type of ['keyDown', 'char', 'keyUp'])
        if (type !== 'char' || key === 'Enter')
          child.webContents.sendInputEvent({
            type,
            keyCode: key === 'Enter' ? 'Return' : 'Escape',
          });
      const result = await Promise.race([answer, sleep(4000).then(() => 'no answer')]);
      return { contentWidth, contentHeight, ...page, result };
    } finally {
      app.off('browser-window-created', grab);
      if (child && !child.isDestroyed()) child.close();
      await answer;
      global.__tnaiKeepPrompts = false;
    }
  },
  async prompt(message) {
    global.__tnaiKeepPrompts = true; // run.js answers prompt windows by itself otherwise
    let child = null;
    const grab = (_e, created) => {
      if (created !== win) child = created;
    };
    app.on('browser-window-created', grab);
    const closed = promptDialog(win, message, 'Workspace 2');
    try {
      const end = Date.now() + 8000;
      while (Date.now() < end && !(child && !child.isDestroyed() && quiet.showAsked(child)))
        await sleep(50);
      if (!child || child.isDestroyed() || !quiet.showAsked(child))
        throw new Error('the app never asked to show the prompt window');
      await sleep(250);
      const [contentWidth, contentHeight] = child.getContentSize();
      const page = await child.webContents.executeJavaScript(`(() => {
        const d = document.documentElement, p = document.querySelector('p');
        const buttons = [...document.querySelectorAll('form button')].map(b => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), fits: b.scrollWidth <= b.clientWidth + 1, bottom: Math.round(r.bottom) }; });
        return { scrollHeight: d.scrollHeight, innerHeight, scrollWidth: d.scrollWidth, innerWidth, pClipped: p.scrollWidth > p.clientWidth + 1, scrolls: d.classList.contains('scroll'), buttons };
      })()`);
      return { contentWidth, contentHeight, ...page };
    } finally {
      app.off('browser-window-created', grab);
      if (child && !child.isDestroyed()) child.close();
      await closed;
      global.__tnaiKeepPrompts = false;
    }
  },
});
