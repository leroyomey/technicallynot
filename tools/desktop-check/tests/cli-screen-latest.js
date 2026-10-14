/*
 * Technically Not tools · desktop-check/tests/cli-screen-latest.js — "↓ Latest" button (10): hidden
 * at the newest line, shown once the terminal is scrolled up, says "New output" when more arrives
 * below, and one click returns to the live output and hides it. Uses a PowerShell session (no
 * agent CLI) started as a thread, and looks at the button where a user sees a terminal: the CLI
 * screen of that thread (120).
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
try {
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const id = started.paneId;
  check(!!started.session?.running, 'PowerShell running as a thread');
  await wait(1200);

  // its thread: a PowerShell thread has no conversation, so it opens on its screen
  window.TnaiThreads.show(id);
  const view = window.TnaiThreadView;
  if (view.mode() !== 'term') view.setMode('term');
  const a = window.TnaiThreads.slot('main').querySelector('.tnt-term-box');
  check(
    !!(await until(
      () => view.shown() === id && view.term()?.element?.getClientRects().length,
      8000
    )),
    'its thread shows the CLI screen'
  );
  await wait(600);

  // what the screen holds, read from the terminal itself (the rows are drawn on a canvas)
  const onScreen = text => {
    const term = view.term();
    const buffer = term.buffer.active;
    for (let row = 0; row < term.rows; row++)
      if ((buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '').includes(text))
        return true;
    return false;
  };
  const btn = () => a.querySelector('.tnai-term-latest');
  const shown = () => {
    const b = btn();
    return !!b && !b.hidden && getComputedStyle(b).display !== 'none';
  };

  // the panel shell: PowerShell on Windows, bash elsewhere
  const windows = /Windows/.test(navigator.userAgent);
  window.tnaiNative.pty.write(
    id,
    windows ? '1..300 | % { "line $_" }\r' : 'for i in $(seq 1 300); do echo "line $i"; done\r'
  );
  check(!!(await until(() => onScreen('line 300'))), 'output printed');
  await wait(300);
  check(!!btn() && !shown(), 'button exists and is hidden at the newest line');
  const screen = a.querySelector('.xterm-screen') || a.querySelector('.xterm');
  for (let i = 0; i < 6; i++) {
    screen.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -600, deltaMode: 0, bubbles: true, cancelable: true })
    );
    await wait(60);
  }
  const ta = a.querySelector('.xterm-helper-textarea');
  for (let i = 0; i < 3; i++) {
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'PageUp',
        code: 'PageUp',
        keyCode: 33,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await wait(60);
  }
  check(!onScreen('line 300'), 'the wheel and Shift+PageUp scrolled the screen up');
  check(!!(await until(shown, 3000)), 'scrolled up: "' + (btn()?.textContent || '') + '" shows');
  check(/^↓ Latest$/.test(btn()?.textContent || ''), 'no new output yet: plain "↓ Latest"');
  window.tnaiNative.pty.write(id, windows ? '"more-output"\r' : 'echo "more-""output"\r');
  check(
    !!(await until(() => /New output/.test(btn()?.textContent || ''), 5000)),
    'new output below: "' + (btn()?.textContent || '') + '"'
  );
  console.log('TNAI_SHOT:cli-screen-latest');
  await wait(1500);
  btn().click();
  check(!!(await until(() => !shown(), 3000)), 'click: button hides');
  check(
    !!(await until(() => onScreen('more-output'), 3000)),
    '…and the newest output is on screen'
  );
  await window.tnaiNative.pty.stop(id);
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
