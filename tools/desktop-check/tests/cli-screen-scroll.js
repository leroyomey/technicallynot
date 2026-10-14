// Technically Not tools · desktop-check/tests/cli-screen-scroll.js — Scrolled up in a terminal, the
// view stays put while output arrives, the box is refit, or the mouse moves/clicks over a program
// that turned on mouse reporting (Claude Code: every mouse report used to count as user input and
// snap to the bottom); typing or pasting returns to the bottom. Uses TnaiAgents.createTerm in a
// detached box; no process runs. Returns {ok, log}.
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
  await write(term, Array.from({ length: 300 }, (_, i) => 'line ' + i).join('\r\n'));

  // what Claude Code turns on (mouse any-motion, SGR, focus reports)
  await write(term, '\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[?1004h');
  const b = term.buffer.active,
    screen = term.element.querySelector('.xterm-screen');
  const up = async () => {
    term.scrollToBottom();
    term.scrollLines(-50);
    await wait(50);
    return b.viewportY;
  };

  // Fewer rows: xterm moves the top down by the rows removed so the view's bottom line stays (how
  // many depends on the PC's cell height).
  const stays = async (label, fn) => {
    const y = await up(),
      rows = term.rows;
    await fn();
    await wait(80);
    const slack = 2 + Math.max(0, rows - term.rows);
    check(
      b.viewportY < b.baseY && Math.abs(b.viewportY - y) <= slack,
      label +
        ' keeps the scroll (' +
        y +
        ' → ' +
        b.viewportY +
        ', bottom ' +
        b.baseY +
        ', rows ' +
        rows +
        ' → ' +
        term.rows +
        ')'
    );
  };
  const mouse = (type, x, y) =>
    screen.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'mousemove' ? 0 : 1,
      })
    );
  await stays('output', () => write(term, '\r\nmore 1\r\nmore 2'));
  await stays('mouse move', async () => {
    mouse('mousemove', 60, 60);
    mouse('mousemove', 90, 80);
  });
  check(
    sent.some(d => /^\x1b\[<35;/.test(d)),
    'mouse moves were still reported to the program'
  );
  await stays('mouse click', async () => {
    mouse('mousedown', 60, 60);
    mouse('mouseup', 60, 60);
  });
  await stays('focus report', async () => {
    term.focus();
    term.textarea.blur();
    term.focus();
  });
  await stays('refit (rows)', async () => {
    box.style.height = '280px';
    fit.fit();
  });
  await stays('refit (cols)', async () => {
    box.style.width = '560px';
    fit.fit();
  });
  await up();
  term.input('x');
  await wait(50);
  check(b.viewportY === b.baseY, 'typing returns to the bottom');
  await up();
  term.paste('pasted');
  await wait(50);
  check(b.viewportY === b.baseY, 'paste returns to the bottom');
  term.dispose();
} catch (error) {
  check(false, 'threw: ' + error.message);
}
box.remove();
return { ok, log };
