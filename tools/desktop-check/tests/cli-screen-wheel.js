// Technically Not tools · desktop-check/tests/cli-screen-wheel.js — Mouse wheel over a program that
// turned on mouse reporting (as Claude Code does) on the normal screen scrolls Technically Not's
// own scrollback and sends nothing to the program (a reported wheel interrupted a running
// /compact); on the alternate screen (full-screen programs) the wheel is still reported. Uses
// TnaiAgents.createTerm in a detached box; no process runs. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const write = (term, s) => new Promise(r => term.write(s, r));
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;left:0;top:0;width:640px;height:320px;z-index:9999;background:#fff';
document.body.append(box);
try {
  const { term, fit } = await window.TnaiAgents.createTerm();
  term.open(box);
  fit.fit();
  await wait(100);
  const sent = [];
  term.onData(d => sent.push(d));
  await write(term, Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\r\n'));
  await write(term, '\x1b[?1000h\x1b[?1003h\x1b[?1006h'); // what Claude Code turns on
  check(
    term.modes.mouseTrackingMode === 'any' && term.buffer.active.type === 'normal',
    'mouse reporting on, normal screen'
  );
  const bottom = term.buffer.active.viewportY;
  const wheel = dy =>
    term.element.querySelector('.xterm-screen').dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: dy,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
      })
    );
  for (let i = 0; i < 5; i++) wheel(-100);
  await wait(100);
  check(
    term.buffer.active.viewportY < bottom,
    'wheel up scrolled the scrollback (' + bottom + ' → ' + term.buffer.active.viewportY + ')'
  );
  check(!sent.length, 'nothing sent to the program (' + JSON.stringify(sent.slice(0, 2)) + ')');
  const y1 = term.buffer.active.viewportY,
    fs = term.options.fontSize,
    cev = new WheelEvent('wheel', {
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
  term.element.querySelector('.xterm-screen').dispatchEvent(cev);
  await wait(100);
  check(
    cev.defaultPrevented &&
      term.buffer.active.viewportY === y1 &&
      term.options.fontSize === fs &&
      !sent.length,
    'Ctrl+wheel does nothing: no zoom, no scroll, nothing sent'
  );

  await write(term, '\x1b[?1049h'); // a full-screen program
  wheel(-100);
  await wait(100);
  check(
    sent.some(d => /^\x1b\[<6[45];/.test(d)),
    'alternate screen: the wheel is still reported to the program'
  );
  term.dispose();
} catch (error) {
  check(false, 'threw: ' + error.message);
}
box.remove();
return { ok, log };
