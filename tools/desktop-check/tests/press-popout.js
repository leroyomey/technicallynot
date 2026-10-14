/*
 * Technically Not tools · desktop-check/tests/press-popout.js — A press inside a popped-out Live
 * preview keeps its click when the error notice is built anew under it (01 `TnaiPress`, which
 * hears presses in every pop-out's document since 2026-10-14).
 *
 * The Live preview is popped out into its own window, kept hidden and not focusable by
 * press-popout.main.js. Real mouse input reaches only the main test window, so the press in the
 * pop-out is made of the pop-out's own pointer events. "Clear these errors" is pressed twice
 * while an error arrives: with the guard switched off the button must be replaced (that shows the
 * press really was repainted under), with it on the button must stay and its click clear the
 * errors. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

const page = window.TnaiLivePreviewPage;
const guard = window.TnaiPress;
const realDefer = guard.defer;
let added = null;
let errorCount = 0;

try {
  const address = await main('serve');
  page.open();
  await wait(400);
  added = window.TnaiLivePreview.addUrl(address);
  check(!!added?.ok, 'Live preview: a tab for the test page');
  const frame = await until(() => {
    const f = [...document.querySelectorAll('iframe[name^="tnai-lp-"]')].find(
      x => x.getBoundingClientRect().width > 0
    );
    return f || null;
  }, 8000);
  check(!!frame, 'Live preview: the page has its frame');

  check(page.popOut() === true, 'Live preview pops out');
  const popDoc = await until(() =>
    frame?.ownerDocument !== document ? frame.ownerDocument : null
  );
  check(!!popDoc, 'the preview now lives in the pop-out window');
  const popWin = popDoc?.defaultView;
  const quiet = await main('quiet');
  check(
    !quiet.active && !quiet.onMain,
    'no window of the test is active or on the main monitor (' + JSON.stringify(quiet) + ')'
  );

  const errorBar = () => {
    const bar = popDoc.querySelector('.lp-errs');
    return bar && !bar.hidden ? bar : null;
  };

  // One press on "Clear these errors" in the pop-out while another error arrives.
  const pressOnce = async () => {
    let bar = null;
    for (let attempt = 0; attempt < 5 && !bar; attempt++) {
      await main('error', frame.name, 'press test error ' + ++errorCount);
      bar = await until(errorBar, 1500);
    }
    await wait(400);
    const clear = errorBar()?.querySelector('.lp-errs-x');
    if (!clear) return null;
    clear.dispatchEvent(new popWin.PointerEvent('pointerdown', { bubbles: true }));
    await main('error', frame.name, 'press test error ' + ++errorCount);

    // the notice is repainted some 150 ms and a frame after an error arrives
    await until(() => !clear.isConnected, 1500);
    const replaced = !clear.isConnected;
    popWin.dispatchEvent(new popWin.PointerEvent('pointerup', { bubbles: true }));
    if (clear.isConnected) clear.click();
    await wait(400);
    return { replaced, cleared: !errorBar() };
  };

  guard.defer = () => false;
  const off = await pressOnce();
  guard.defer = realDefer;
  check(
    !!off && off.replaced,
    'guard off: the pressed button was replaced under the press (' + JSON.stringify(off) + ')'
  );
  const on = await pressOnce();
  check(
    !!on && !on.replaced && on.cleared,
    'in the pop-out a repaint waits for the press and its click clears the errors (' +
      JSON.stringify(on) +
      ')'
  );
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
guard.defer = realDefer;
page.dock();
if (added?.ok) window.TnaiLivePreview.close(added.id);
await main('stop');
return { ok, log };
