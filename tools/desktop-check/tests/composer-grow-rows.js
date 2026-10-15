/*
 * * Technically Not tools · desktop-check/tests/composer-grow-rows.js — A MEASUREMENT, not a
 * * pass/fail rule: what changes the height of a thread's CLI screen by a few rows (rows gone
 * * from the middle of a reply, 2026-10-02). A real PowerShell thread (no agent CLI, no usage)
 * shown
 * * on its CLI screen, the terminal that sits above the prompt box: the screen's rows and the size
 * sent to its
 * * pty are read before and after the prompt box under it grows (a draft of 2 and of 6 lines, an
 * * attached picture) and shrinks back. It fails only when it could not measure. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const G = window.TnaiAgents;
let paneId;
const sizes = [];
const onSize = e => {
  if (e.detail?.paneId === paneId) sizes.push(e.detail.cols + 'x' + e.detail.rows);
};
window.addEventListener('tnai:pty-size', onSize);
try {
  paneId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  await until(() => G.sessions().find(s => s.paneId === paneId && s.running === true));

  // The thread's CLI screen (120) is the terminal that sits above the prompt box.
  window.TnaiThreads.show(paneId);
  await wait(400);
  window.TnaiThreadView.setMode('term');
  await wait(1200);
  const pane = document.querySelector('.tnt-term-host');
  const rows = () => {
    const s = pane.querySelector('.xterm-screen'),
      r = pane.querySelector('.xterm-rows > div');
    return s && r
      ? Math.round(s.getBoundingClientRect().height / r.getBoundingClientRect().height)
      : 0;
  };
  const composer = document.querySelector('.composer'),
    p = document.getElementById('prompt');
  const shown = () => !!composer?.offsetParent || composer?.getBoundingClientRect().height > 0;
  const at = async label => {
    await wait(700);
    const now = {
      rows: rows(),
      panel: Math.round(pane.getBoundingClientRect().height),
      composer: Math.round(composer.getBoundingClientRect().height),
    };
    log.push(
      'info ' +
        label +
        ': ' +
        JSON.stringify(now) +
        ' pty sizes sent since last: ' +
        JSON.stringify(sizes.splice(0))
    );
    return now;
  };
  check(shown(), 'the prompt box is under the thread Terminal view');
  const type = v => {
    p.focus();
    p.value = v;
    p.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const base = await at('empty prompt');
  check(base.rows > 5, 'the panel rows could be read (' + base.rows + ')');

  // The view is resized only once the prompt box has been still for a
  // moment (99 boxResized, 1.2 s).
  const edge = () =>
    Math.round(
      pane.querySelector('.xterm-screen').getBoundingClientRect().bottom -
        pane.getBoundingClientRect().bottom
    );

  // The app's own signal, not a fixed sleep (the test window is often not in front): the host
  // carries data-wait while the view waits.
  const waiting = () => pane.dataset.wait === '1',
    started = () => until(waiting, 8000),
    ended = () => until(() => !waiting(), 12000);
  type('1\n2\n3\n4\n5\n6');
  check(await started(), 'a growing draft starts the wait');
  check(
    sizes.length === 0 && rows() === base.rows,
    'and does not resize the terminal at once (rows ' +
      rows() +
      ', sizes ' +
      JSON.stringify(sizes) +
      ')'
  );
  check(
    edge() <= 0,
    'meanwhile the newest rows stay in sight (the screen ends ' + edge() + ' px past the box)'
  );
  type('');
  check(await ended(), 'the wait ends');
  await wait(300);
  check(
    sizes.length === 0 && rows() === base.rows,
    'a draft typed and cleared within the wait costs no resize (rows ' +
      rows() +
      ', sizes ' +
      JSON.stringify(sizes) +
      ')'
  );
  check(
    !pane.querySelector('.xterm-screen').style.transform,
    'the terminal is back in place after the wait'
  );
  type('one\ntwo');
  await started();
  await ended();
  const two = await at('a 2-line draft');
  type('1\n2\n3');
  await started();
  type('1\n2\n3\n4');
  await wait(300);
  type('1\n2\n3\n4\n5\n6');
  await ended();
  await wait(300);
  check(
    sizes.length === 1,
    'a draft growing in three steps resizes once, when still (' + JSON.stringify(sizes) + ')'
  );
  const six = await at('a 6-line draft');
  check(
    six.rows < base.rows && edge() <= 0,
    'then the terminal fits its smaller box (rows ' + six.rows + ', edge ' + edge() + ' px)'
  );
  type('');
  await started();
  await ended();
  const back = await at('draft cleared');
  check(
    back.rows === base.rows,
    'and takes its rows back when the draft is gone (' + back.rows + ')'
  );
  const c = document.createElement('canvas');
  c.width = 80;
  c.height = 60;
  c.getContext('2d').fillRect(0, 0, 80, 60);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  p.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  );
  await until(() => document.querySelector('#attachmentList .attachment-chip'), 3000);
  await started();
  await ended();
  const chip = await at('one pasted screenshot attached');
  check(
    chip.rows < base.rows,
    'an attached picture takes its rows once the box is still (' + chip.rows + ')'
  );
  document.querySelectorAll('#attachmentList .attachment-remove').forEach(b => b.click());
  await started();
  await ended();
  const gone = await at('attachment removed');
  check(gone.rows === base.rows, 'and gives them back when removed (' + gone.rows + ')');
  log.push(
    'info RESULT rows: empty ' +
      base.rows +
      ', 2 lines ' +
      two.rows +
      ', 6 lines ' +
      six.rows +
      ', cleared ' +
      back.rows +
      ', attachment ' +
      chip.rows +
      ', removed ' +
      gone.rows
  );
  log.push(
    'info RESULT ' +
      (six.rows < base.rows || chip.rows < base.rows
        ? 'the prompt box growing takes rows from the thread Terminal view, and the pty is resized'
        : 'the prompt box growing does not change the panel rows here')
  );

  // ---- A− / A+ in the thread top row: the CLI screen's own text size; the 'terminal' size (used
  // by Your terminal, 136) stays. The buttons sit on the strip's line.
  const fUp = document.querySelector('.tnt-head [data-tnai-font="1"]'),
    fDown = document.querySelector('.tnt-head [data-tnai-font="-1"]');
  const px = () => parseFloat(getComputedStyle(pane.querySelector('.xterm-rows')).fontSize),
    f0 = px(),
    t0 = G.fontFor('terminal'),
    rows0 = rows();
  check(
    !!fUp && !!fDown && !fUp.disabled && /px/.test(fUp.title),
    'the strip has A− / A+ (' + fUp?.title + ')'
  );
  fUp.click();
  fUp.click();
  await wait(900);
  check(
    px() === f0 + 2 &&
      G.fontFor('focus') === f0 + 2 &&
      G.fontFor('terminal') === t0 &&
      rows() < rows0,
    'A+ twice: thread Terminal view ' +
      f0 +
      ' → ' +
      px() +
      ' px, rows ' +
      rows0 +
      ' → ' +
      rows() +
      ', Your terminal still ' +
      G.fontFor('terminal') +
      ' px'
  );
  console.log('TNAI_SHOT:focus-font');
  await wait(500);
  fDown.click();
  fDown.click();
  await wait(700);
  check(
    px() === f0 && rows() === rows0,
    'A− twice: back at ' + px() + ' px and ' + rows() + ' rows'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
window.removeEventListener('tnai:pty-size', onSize);
document.getElementById('prompt').value = '';
document.getElementById('prompt').dispatchEvent(new Event('input', { bubbles: true }));
window.TnaiThreadView?.setMode('read');
if (paneId) {
  G.stop(paneId);
  await wait(300);
}
return { ok, log };
