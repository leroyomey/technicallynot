/*
 * Technically Not tools · desktop-check/tests/select-hold.js — Selecting while output arrives (10
 * holdViewWhileSelecting): from a mouse press until the selection is gone
 * the view holds still, so new output can't slide other lines under the mouse; a view that was at
 * the newest line goes back there once the selection is cleared, and a plain click keeps following
 * the output. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const host = document.createElement('div');
try {
  host.style.cssText =
    'position:fixed;left:40px;top:40px;width:760px;height:420px;z-index:99999;background:#fbfcf9';
  document.body.append(host);
  const { term, fit } = await window.TnaiAgents.createTerm();
  term.open(host);
  fit.fit();
  const write = n =>
    new Promise(r =>
      term.write(
        Array.from(
          { length: n },
          (_, i) => 'line ' + Math.random().toString(36).slice(2, 8) + ' ' + i
        ).join('\r\n') + '\r\n',
        r
      )
    );
  const b = () => term.buffer.active,
    atBottom = () => b().viewportY >= b().baseY;
  const screen = term.element.querySelector('.xterm-screen') || term.element,
    r = screen.getBoundingClientRect();
  const mouse = (type, target = screen) =>
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1,
        clientX: r.left + 40,
        clientY: r.top + 40,
        view: window,
      })
    );
  await write(120);
  await wait(100);
  check(atBottom(), 'starts at the newest line');

  // 1. Press, output streams during the drag: the view holds.
  mouse('mousedown');
  const y0 = b().viewportY;
  await write(40);
  await wait(100);
  check(
    b().viewportY === y0 && !atBottom(),
    'output during a drag does not move the view (' + y0 + ' → ' + b().viewportY + ')'
  );

  // 2. Released with text selected: still held, the selected text stays the same.
  term.select(0, y0 + 2, 12);
  const picked = term.getSelection();
  mouse('mouseup', window);
  await write(20);
  await wait(100);
  check(
    b().viewportY === y0 && term.getSelection() === picked,
    'with a selection kept, the view and the selected text stay put: ' + JSON.stringify(picked)
  );

  // 3. Selection cleared (copied or clicked away): back to the newest line.
  term.clearSelection();
  await wait(50);
  check(atBottom(), 'selection cleared → back at the newest line');
  await write(10);
  await wait(100);
  check(atBottom(), 'and following new output again');

  // 4. A plain click (nothing selected) keeps following.
  mouse('mousedown');
  mouse('mouseup', window);
  await wait(50);
  await write(10);
  await wait(100);
  check(atBottom(), 'a plain click keeps following the output');

  // 5. A view already scrolled up stays where it was after the selection is cleared.
  term.scrollLines(-30);
  await wait(50);
  const y1 = b().viewportY;
  mouse('mousedown');
  term.select(0, y1 + 1, 5);
  mouse('mouseup', window);
  term.clearSelection();
  await wait(50);
  check(
    b().viewportY === y1,
    'a view scrolled up by hand stays there after the selection (' +
      y1 +
      ' → ' +
      b().viewportY +
      ')'
  );
  term.dispose();
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
host.remove();
return { ok, log };
