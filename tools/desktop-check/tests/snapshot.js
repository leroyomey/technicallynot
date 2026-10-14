// Technically Not tools · desktop-check/tests/snapshot.js — Snapshot to the clipboard
// (desktop/snapshot-service.js): the shortcut is in the shortcut list; the real overlay opens on
// the display under the cursor, a dragged rectangle lands on the clipboard at native pixel size
// (display scale factor) with no image file written, the overlay closes; Esc cancels and leaves the
// clipboard alone; the clipboard image pastes into the composer as an attachment chip; Enter copies
// the whole screen; C records a clip of the dragged area behind a camera frame that is hidden from
// capture, and the stopped clip is saved as a video plus frames with one line on the clipboard;
// markup (M, remembered) keeps the selection open with its toolbar, and a block-out, arrow,
// numbered marker, text and blur drawn with real input are in the copied picture, a box taken back
// with Ctrl+Z and a highlighter line removed with the eraser are not; the Move tool moves the arrow
// and stretches the block-out, and the selection resized by its grips keeps every mark on the same
// screen pixels. The user's clipboard is restored at the end.
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
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
try {
  check(
    window.TnaiShortcuts.list().some(
      s => s.keys === 'Ctrl+Shift+Alt+S' && /clipboard/i.test(s.what)
    ),
    'shortcut list shows Ctrl+Shift+Alt+S'
  );
  const st = await main('state');
  check(st.accelerator === 'Ctrl+Shift+Alt+S' && !st.error, 'service state: ' + JSON.stringify(st));

  // Settings › Keyboard: the key can be changed, a typing key is refused, Default goes back.
  const row = document.getElementById('tnaiSnapshotKeyRow'),
    shownKeys = () => [...(row?.querySelectorAll('kbd') || [])].map(k => k.textContent).join('+');
  check(
    !!row?.closest('#settingsPanel-keyboard') &&
      !document.querySelector('#settingsPanel-general #tnaiShowShortcuts'),
    'the snapshot key row is in Settings › Keyboard, and General holds no keyboard rows'
  );
  check(
    !!row && shownKeys() === 'Ctrl+Shift+Alt+S' && row.querySelector('[data-act=reset]').disabled,
    'settings row shows the default key: ' + shownKeys()
  );
  const bad = await window.tnaiNative.snapshot.setShortcut('A');
  check(
    bad && !bad.ok && /cannot/.test(bad.error),
    'a plain letter is refused: ' + JSON.stringify(bad)
  );
  const set = await window.tnaiNative.snapshot.setShortcut('Control+Alt+F9');
  check(
    set?.ok && set.state.accelerator === 'Ctrl+Alt+F9' && !set.state.isDefault,
    'changed to Ctrl+Alt+F9: ' + JSON.stringify(set)
  );
  check(
    (await until(() => shownKeys() === 'Ctrl+Alt+F9')) &&
      window.TnaiShortcuts.list().some(s => s.keys === 'Ctrl+Alt+F9' && /clipboard/i.test(s.what)),
    'settings row and shortcut list follow: ' + shownKeys()
  );
  const back = await window.tnaiNative.snapshot.setShortcut(null);
  check(
    back?.ok && back.state.accelerator === 'Ctrl+Shift+Alt+S' && back.state.isDefault,
    'Default restores Ctrl+Shift+Alt+S'
  );
  check(await until(() => shownKeys() === 'Ctrl+Shift+Alt+S'), 'settings row back to the default');

  const r = await main('drag', 0.2, 0.25, 0.3, 0.2);
  log.push(
    '     display ' +
      JSON.stringify(r.display) +
      ' ×' +
      r.scale +
      ', overlay content ' +
      r.content.join('×')
  );
  check(r.result?.copied, 'drag → copied: ' + JSON.stringify(r.result));
  check(r.overlayClosed, 'overlay closed after the drag');
  check(
    !!r.size &&
      Math.abs(r.size.width - r.expected.width) <= 2 &&
      Math.abs(r.size.height - r.expected.height) <= 2,
    'clipboard image ' +
      JSON.stringify(r.size) +
      ' ≈ expected at native scale ' +
      JSON.stringify(r.expected)
  );
  check(
    r.written.length === 0,
    'no image file written to the profile or temp folder' +
      (r.written.length ? ': ' + r.written.join(', ') : '')
  );

  // The composer turns a pasted clipboard image into a chip (27).
  window.TnaiAttachments.clear?.();
  const prompt = document.querySelector('.composer .prompt, #prompt, textarea.prompt');
  prompt?.focus();
  await main('paste');
  const chip = await until(() =>
    document.querySelector('.attachment-chip[data-kind="image"], .attachment-chip img')
  );
  const listed = window.TnaiAttachments.list();
  check(
    !!chip &&
      listed.length === 1 &&
      /^shot-/.test(listed[0].name) &&
      listed[0].label === 'Screenshot 1',
    'pasted into the composer → image chip: ' + JSON.stringify(listed)
  );
  window.TnaiAttachments.clear?.();

  const esc = await main('escape');
  check(
    esc.result?.cancelled && esc.overlayClosed,
    'Esc cancels and closes the overlay: ' + JSON.stringify(esc.result)
  );
  check(esc.text === 'kept by Esc' && !esc.image, 'Esc leaves the clipboard untouched');

  // Enter with nothing selected: the whole screen.
  const all = await main('whole');
  check(
    all.result?.copied &&
      all.overlayClosed &&
      !!all.size &&
      Math.abs(all.size.width - all.expected.width) <= 2 &&
      Math.abs(all.size.height - all.expected.height) <= 2,
    'Enter copies the whole screen: ' +
      JSON.stringify(all.size) +
      ' vs ' +
      JSON.stringify(all.expected)
  );

  // Clip: C, drag, about 2 s of recording behind the frame, stop.
  const c = await main('clip', 0.25, 0.3, 0.3, 0.3);
  check(
    /record a clip/.test(c.hint) && c.result?.clip,
    'C turns the drag into a clip: hint "' + c.hint + '", ' + JSON.stringify(c.result)
  );
  const fb = c.shown?.bounds,
    ar = c.area;
  check(
    !!fb &&
      fb.x <= ar.x &&
      fb.y <= ar.y &&
      fb.x + fb.width >= ar.x + ar.width &&
      fb.y + fb.height >= ar.y + ar.height &&
      c.shown.hidden !== false &&
      c.shown.onTop &&
      !c.shown.focusable,
    'the camera frame is shown around the area, on top, without focus, hidden from capture: ' +
      JSON.stringify(c.shown) +
      ' around ' +
      JSON.stringify(ar)
  );
  check(c.second?.busy === true, 'a second snapshot while the clip records is refused');
  check(/^0:0[1-4] \/ 0:30$/.test(c.badge || ''), 'the frame counts the time: ' + c.badge);
  check(
    c.stopped === true && c.out.saved === true && c.out.ms >= 1500 && c.out.ms <= 8000,
    'stopping keeps the clip: ' + JSON.stringify(c.out).slice(0, 300)
  );
  check(
    c.video > 1000 && c.frames.length >= 2 && c.frames.length <= 8 && c.frames.every(n => n > 100),
    'saved a video (' +
      c.video +
      ' bytes) and ' +
      c.frames.length +
      ' frames: ' +
      JSON.stringify(c.frames)
  );
  check(
    !!c.first && c.first.width === c.expected.width && c.first.height === c.expected.height,
    'frames are the area, longest side at most 1280: ' +
      JSON.stringify(c.first) +
      ' vs ' +
      JSON.stringify(c.expected)
  );
  check(
    c.sameText &&
      /^\[Attached clip: \d+ s of screen recording as \d+ frames in order, .+-clip-1\.png to .+-clip-\d\.png; video .+-clip\.webm\]$/.test(
        c.text
      ),
    'one line naming the files is on the clipboard: ' + c.text
  );
  check(c.left === 0, 'the frame and the recorder are gone: ' + c.left + ' left');

  // Markup: off by default, M turns it on and the next overlay remembers it; the marks end up in
  // the copied picture.
  const m = await main('markup', 0.2, 0.25, 0.4, 0.4);
  check(
    m.startedOff === false && m.on === true && /mark it up/.test(m.hint),
    'markup is off by default, M turns it on: hint "' + m.hint + '"'
  );
  check(m.remembered === true, 'the next overlay remembers markup');
  const tb = m.toolbar || {};
  check(
    m.opened &&
      tb.shown === 'flex' &&
      tb.left >= 0 &&
      tb.top >= 0 &&
      tb.right <= tb.vw &&
      tb.bottom <= tb.vh &&
      tb.buttons === 17,
    'a drag opens the toolbar on screen: ' + JSON.stringify(tb)
  );
  check(
    JSON.stringify(m.counts) === '[1,2,3,2,3,4,5,6,5,5,5]',
    'marks counted (block, arrow, box, undo, number, text, blur, highlighter, eraser, move, stretch): ' +
      JSON.stringify(m.counts)
  );
  check(m.tools === 'block,arrow,number,text,blur', 'marks kept in order: ' + m.tools);
  check(
    m.typingIn === true && m.text === 'Hi' && m.toolWhileTyping === 'text',
    'text typed into its box stays text and switches no tool: ' +
      JSON.stringify([m.typingIn, m.text, m.toolWhileTyping])
  );
  check(
    m.shrunk && m.grown && JSON.stringify(m.frame) === JSON.stringify(m.wanted),
    'the selection resized by its top-left and bottom-right grips: ' +
      JSON.stringify(m.frame) +
      ' vs ' +
      JSON.stringify(m.wanted)
  );
  check(m.stillText === 'before markup', 'nothing reaches the clipboard before Enter');
  check(
    m.result?.copied && m.result.marked && m.overlayClosed,
    'Enter copies the marked-up picture: ' + JSON.stringify(m.result)
  );
  check(
    !!m.size &&
      Math.abs(m.size.width - m.expected.width) <= 2 &&
      Math.abs(m.size.height - m.expected.height) <= 2,
    'marked-up picture ' +
      JSON.stringify(m.size) +
      ' is the selection at native scale ' +
      JSON.stringify(m.expected)
  );
  check(
    !!m.block && m.block.every(v => v === 0),
    'the blocked-out area is solid black: ' + JSON.stringify(m.block)
  );
  const red = [255, 77, 79];
  check(
    !!m.arrow && m.arrow.every((v, i) => Math.abs(v - red[i]) <= 4),
    'the moved arrow is red at its new place, on the same screen pixels after the resize: ' +
      JSON.stringify(m.arrow)
  );
  check(
    !!m.arrowWas && !m.arrowWas.every((v, i) => Math.abs(v - red[i]) <= 4),
    'and gone from its old place: ' + JSON.stringify(m.arrowWas)
  );
  check(
    !!m.stretched && m.stretched.every(v => v === 0),
    'the block-out stretched by its corner covers the new area: ' + JSON.stringify(m.stretched)
  );

  // Copy enlarged: off by default, L turns it on and is remembered; a small selection is then
  // copied in whole multiples of its pixels, at least 1200 wide.
  const g = await main('large', 0.3, 0.4, 0.1, 0.05);
  check(
    g.startedOff === false && g.on === true && /L for exact size/.test(g.hint),
    'copy enlarged is off by default, L turns it on: hint "' + g.hint + '"'
  );
  check(g.remembered === true, 'the next overlay remembers copy enlarged');
  const gf = g.result?.enlarged,
    gs = g.selection;
  check(
    g.result?.copied &&
      Number.isInteger(gf) &&
      gf >= 2 &&
      gf <= 8 &&
      !!g.size &&
      Math.abs(g.size.width - gs.width * gf) <= 2 * gf &&
      Math.abs(g.size.height - gs.height * gf) <= 2 * gf &&
      g.size.width >= 1200,
    'a small selection ' +
      JSON.stringify(gs) +
      ' is copied ' +
      gf +
      ' times larger: ' +
      JSON.stringify(g.size)
  );
  check(g.whole === true, 'each screen pixel is a whole block, not smoothed');
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
} finally {
  try {
    await main('restore');
  } catch {}
}
return { ok, log };
