/*
 * Technically Not tools · desktop-check/tests/dot-sizes.js — Every status dot is drawn the same
 * size. Two kinds of dots stand in rows: the status dot at the foot of each character in the
 * thread list, and the dot per thread under the cards of All threads. A dot whose box starts on
 * a part of a pixel is rounded to the screen by itself, so one row's dot came out larger than the
 * next one's. Checked here:
 * a dot is a whole number of screen pixels wide and high (then the screen's rounding of its
 * edges gives every copy the same size wherever it stands), and all dots of a kind have one size.
 */
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (read, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  return null;
};

// how far a length is from a whole pixel of the screen
const scale = window.devicePixelRatio;
const off = value => {
  const onScreen = value * scale;
  return Math.abs(onScreen - Math.round(onScreen));
};
const round = value => Math.round(value * 100) / 100;
const whole = boxes => boxes.every(box => [box.w, box.h].every(v => off(v) < 0.02));
const oneSize = boxes =>
  new Set(boxes.map(box => round(box.w) + 'x' + round(box.h))).size === 1 && boxes.length > 0;
const tell = boxes =>
  boxes
    .slice(0, 6)
    .map(box => round(box.x) + ',' + round(box.y) + ' ' + round(box.w) + 'x' + round(box.h))
    .join(' | ');

try {
  log.push('info the screen draws ' + scale + ' pixels for one');
  for (let count = 0; count < 6; count++) await window.TnaiTest.startThread({ tool: 'Terminal' });
  window.TnaiThreads.open();
  const list = window.TnaiThreads.slot('list');
  await until(() => list.querySelectorAll('.tnt-th .tnt-face').length >= 6);
  await wait(600);

  // ---- the status dot at each character's foot (the ::after of the face) ----
  // Its box is worked out as the browser places it: from the face's right and bottom edges.
  const faceDots = [...list.querySelectorAll('.tnt-th .tnt-face')].map(face => {
    const box = face.getBoundingClientRect();
    const style = getComputedStyle(face, '::after');
    const w = parseFloat(style.width);
    const h = parseFloat(style.height);
    return {
      x: box.right - parseFloat(style.right) - w,
      y: box.bottom - parseFloat(style.bottom) - h,
      w,
      h,
    };
  });
  check(oneSize(faceDots), 'thread list: every status dot has one size (' + tell(faceDots) + ')');
  check(
    whole(faceDots),
    'thread list: a status dot is a whole number of screen pixels wide and high'
  );
  console.log('TNAI_SHOT:dot-sizes-list');
  await wait(500);

  // ---- the dot per thread under the cards of All threads ----
  await window.TnaiTest.openAllThreads();
  const dots = await until(() => {
    const found = [...document.querySelectorAll('#terminalView .tat-dots button')];
    return found.length >= 6 && found[0].getClientRects().length ? found : null;
  });
  await wait(600);
  const pageDots = (dots || []).map(dot => {
    const box = dot.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
  check(oneSize(pageDots), 'All threads: every dot has one size (' + tell(pageDots) + ')');
  check(whole(pageDots), 'All threads: a dot is a whole number of screen pixels wide and high');
  console.log('TNAI_SHOT:dot-sizes-all-threads');
  await wait(500);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
