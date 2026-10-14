// Technically Not tools · desktop-check/tests/attachments.js — Composer ＋: file input, pasted
// screenshot, dropped file; chips with thumbnails, ×, limits; send to a PowerShell thread (never an
// agent CLI, so no usage) saves uploads under userData/attachments and types one line with the
// paths; attachments without text send "(no instructions)"; a Claude Code session (no prompt sent)
// is launched with --add-dir for the attachments folder. Also: a long pasted plain-text paste
// collapses to a "[Pasted text #N +L lines]" token, expanded back to <pasted_text> on send while
// the recorded task title stays the token. Returns {ok, log}.
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
const G = window.TnaiAgents,
  N = window.tnaiNative,
  A = window.TnaiAttachments;
const sep = /Windows/.test(navigator.userAgent) ? '\\' : '/';
try {
  check(
    !!A &&
      !document.getElementById('attachFiles').disabled &&
      document.getElementById('attachFiles').getAttribute('aria-disabled') !== 'true',
    '＋ enabled in the desktop app'
  );
  const png = async (w, h, color) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.fillRect(4, 4, w / 2, h / 3);
    return new Promise(r => c.toBlob(r, 'image/png'));
  };
  const chips = () => [...document.querySelectorAll('#attachmentList .attachment-chip')];

  // Menu: upload, paste/drop hint. "Attach the open file" appears only while viewing a file on the
  // File repository page.
  document.getElementById('attachFiles').click();
  await wait(80);
  let menu = document.querySelector('.tnai-attach-menu');
  check(
    !!menu && menu.querySelectorAll('button').length === 1 && /Ctrl\+V/.test(menu.textContent),
    'menu: upload + paste hint, no attach-open-file while no file is viewed'
  );
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await wait(50);
  check(!document.querySelector('.tnai-attach-menu'), 'Escape closes the menu');

  // 1. File input.
  const dt1 = new DataTransfer();
  dt1.items.add(
    new File([await png(120, 80, '#294c3d')], 'design shot.png', { type: 'image/png' })
  );
  const fileInput = document.getElementById('attachmentInput');
  fileInput.files = dt1.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => chips().length === 1, 2000);
  check(
    chips().length === 1 &&
      !!chips()[0].querySelector('img')?.src &&
      /design shot\.png/.test(chips()[0].textContent) &&
      /B|KB/.test(chips()[0].querySelector('small').textContent),
    'file input: chip with thumbnail, name, size'
  );

  // 2. Paste a screenshot into the prompt.
  const dt2 = new DataTransfer();
  dt2.items.add(new File([await png(60, 60, '#c7f36b')], 'image.png', { type: 'image/png' }));
  const prompt = document.getElementById('prompt');
  prompt.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true })
  );
  await until(() => chips().length === 2, 2000);
  check(
    chips().length === 2 &&
      /^Screenshot \d+$/.test(chips()[1].querySelector('.attachment-name')?.textContent || '') &&
      /shot-\d{6}\.png/.test(chips()[1].title) &&
      !!chips()[1].querySelector('img'),
    'pasted screenshot: short chip label ' +
      (chips()[1]?.querySelector('.attachment-name')?.textContent || '') +
      ' · ' +
      chips()[1].title
  );

  // 2b. A screenshot pasted mid-draft keeps the caret and the scroll exactly where the user was
  // typing.
  chips()
    .slice(1)
    .forEach(c => c.querySelector('.attachment-remove').click());
  await wait(80);
  prompt.focus();
  prompt.value = Array.from(
    { length: 30 },
    (_, i) => 'line ' + i + ' of a long draft that wraps across the composer width'
  ).join('\n');
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  const mid = prompt.value.indexOf('line 20');
  prompt.setSelectionRange(mid, mid);
  prompt.scrollTop = prompt.scrollHeight;
  await wait(80);
  const scrollBefore = prompt.scrollTop;
  const dt2b = new DataTransfer();
  dt2b.items.add(new File([await png(60, 60, '#6b8cf3')], 'image.png', { type: 'image/png' }));
  prompt.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt2b, bubbles: true, cancelable: true })
  );
  await until(() => chips().length === 2, 2000);
  await wait(200);
  check(
    document.activeElement === prompt &&
      prompt.selectionStart === mid &&
      prompt.selectionEnd === mid,
    'screenshot paste keeps the caret (' + prompt.selectionStart + ' vs ' + mid + ')'
  );
  check(
    scrollBefore > 0 && prompt.scrollTop > 0 && Math.abs(prompt.scrollTop - scrollBefore) <= 40,
    'screenshot paste keeps the scroll (' + prompt.scrollTop + ' vs ' + scrollBefore + ')'
  );
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));

  // 3. Drop a text file onto the composer.
  const dt3 = new DataTransfer();
  dt3.items.add(new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' }));
  document
    .querySelector('.composebox')
    .dispatchEvent(new DragEvent('drop', { dataTransfer: dt3, bubbles: true, cancelable: true }));
  await until(() => chips().length === 3, 2000);
  check(
    chips().length === 3 && chips()[2].dataset.kind === 'file' && !chips()[2].querySelector('img'),
    'dropped file: chip without thumbnail'
  );

  // (4. "Attach the open file" was removed with the File repository page in the purple redesign.)
  // Remove.
  chips()[2].querySelector('.attachment-remove').click();
  await wait(50);
  check(
    chips().length === 2 && !chips().some(c => /data\.csv/.test(c.textContent)),
    '× removes a chip'
  );
  console.log('TNAI_SHOT:attach');
  await wait(500);

  // Limits.
  check(A.add([new File(['PK'], 'bundle.zip')]) === false && A.count() === 2, 'refuses a .zip');
  check(
    A.add([new File([new Uint8Array(21 * 1024 * 1024)], 'huge.png', { type: 'image/png' })]) ===
      false && A.count() === 2,
    'refuses a file over 20 MB'
  );
  const many = Array.from({ length: 7 }, (_, i) => new File(['x' + i], 'n' + i + '.txt'));
  check(A.add(many) === false && A.count() === 8, 'stops at 8 attachments');
  while (A.count() > 2) A.remove(A.list().pop().id);

  // A pasted clip (desktop/snapshot-service.js copies its video file together with one line naming
  // the video and its frames): a chip, and the line is what is sent.
  const clipLine =
    '[Attached clip: 2 s of screen recording as 1 frame, C:/x/ab12-clip-1.png; video C:/x/ab12-clip.webm]';
  check(
    A.add([new File(['v'], 'ab12-clip.webm', { type: 'video/webm' })], 'paste', clipLine) ===
      true &&
      A.count() === 3 &&
      A.list()[2].kind === 'clip' &&
      A.list()[2].label === 'Clip 3',
    'a pasted clip becomes a chip (' + JSON.stringify(A.list()[2]) + ')'
  );
  const flight = A.beginSend(),
    clipSent = await A.prepare(flight.items.slice(2));
  flight.restore();
  check(
    clipSent.refs === ' ' + clipLine && A.count() === 3,
    'a clip chip sends its line, not a second copy of the video (' + clipSent.refs + ')'
  );
  check(
    A.add([new File(['v'], 'holiday.webm', { type: 'video/webm' })], 'paste', '') === false &&
      A.count() === 3,
    'a video that is not a clip is still refused'
  );
  A.remove(A.list().pop().id);

  // Unused clips (desktop/attachment-service.js, attachments.main.js): a paste anywhere in the app
  // that names a clip keeps it; a clip nobody pasted goes at the next paste once the clipboard
  // holds something else.
  let mainId = 0;
  const mainCall = (cmd, ...args) =>
    new Promise((resolve, reject) => {
      const id = 'm' + ++mainId;
      window.__tnaiMainDone = window.__tnaiMainDone || {};
      window.__tnaiMainDone[id] = r => {
        delete window.__tnaiMainDone[id];
        r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
      };
      console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    });
  const field = document.createElement('textarea');
  field.style.cssText = 'position:fixed;left:-999px;top:0;width:10px;height:10px';
  document.body.append(field);
  const pasteInto = dt =>
    field.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
  const lineOf = f =>
    '[Attached clip: 1 s of screen recording as 1 frame, ' + f[1] + '; video ' + f[0] + ']';
  let held = await mainCall('hold', 'aa11aa11'),
    dtClip = new DataTransfer();
  dtClip.setData('text/plain', 'look at ' + lineOf(held));
  pasteInto(dtClip);
  await wait(300);
  let left = await mainCall('left', held, true);
  check(
    left === 2,
    'a clip whose line was pasted into a text box is kept after the clipboard changed (' +
      left +
      ' of 2 files left)'
  );
  held = await mainCall('hold', 'bb22bb22');
  dtClip = new DataTransfer();
  dtClip.items.add(new File(['v'], 'bb22bb22-clip.webm', { type: 'video/webm' }));
  pasteInto(dtClip);
  await wait(300);
  left = await mainCall('left', held, true);
  check(
    left === 2,
    'a clip whose video file was pasted is kept after the clipboard changed (' +
      left +
      ' of 2 files left)'
  );
  held = await mainCall('hold', 'cc33cc33');
  A.pasted('echo ' + lineOf(held));
  await wait(300); // what a terminal panel paste calls (10)
  left = await mainCall('left', held, true);
  check(
    left === 2,
    'a clip whose line was pasted into a terminal panel is kept after the clipboard changed (' +
      left +
      ' of 2 files left)'
  );
  held = await mainCall('hold', 'dd44dd44');
  dtClip = new DataTransfer();
  dtClip.setData('text/plain', 'plain words, no clip');
  pasteInto(dtClip);
  await wait(400);
  left = await mainCall('left', held, false);
  check(
    left === 0,
    'a clip nobody pasted is deleted at the next paste in the app, the clipboard holding something else (' +
      left +
      ' of 2 files left)'
  );
  field.remove();

  {
    // A pasted clip as a picture with a play button (27 chip, 113 preview and terminal link;
    // attachments.main.js makes a real clip: a recorded canvas and two frames).
    const C = window.TnaiClips;
    check(!!C, 'window.TnaiClips is there');
    const recCanvas = document.createElement('canvas');
    recCanvas.width = 320;
    recCanvas.height = 180;
    const recG = recCanvas.getContext('2d');
    let recOn = true,
      recN = 0;
    const recDraw = () => {
      if (!recOn) return;
      recG.fillStyle = 'hsl(' + ((recN * 23) % 360) + ' 70% 50%)';
      recG.fillRect(0, 0, 320, 180);
      recG.fillStyle = '#fff';
      recG.fillRect((recN * 9) % 300, 60, 40, 60);
      recN++;
      setTimeout(recDraw, 33);
    };
    recDraw();
    const recorder = new MediaRecorder(recCanvas.captureStream(30), {
        mimeType: 'video/webm;codecs=vp8',
      }),
      recParts = [];
    recorder.ondataavailable = e => e.data.size && recParts.push(e.data);
    const recDone = new Promise(r => {
      recorder.onstop = r;
    });
    recorder.start();
    await wait(3000);
    recorder.stop();
    await recDone;
    recOn = false;
    const recBytes = new Uint8Array(await new Blob(recParts).arrayBuffer());
    let recB64 = '';
    for (let i = 0; i < recBytes.length; i += 30000)
      recB64 += String.fromCharCode(...recBytes.subarray(i, i + 30000));
    const made = await mainCall('clip', 'ee55ee55', btoa(recB64));
    const base = p => p.split(/[\\/]/).pop();
    const realLine =
      '[Attached clip: 3 s of screen recording as 2 frames in order, ' +
      made.frames[0] +
      ' to ' +
      base(made.frames[1]) +
      '; video ' +
      made.video +
      ']';
    const chipsBefore = A.count(),
      draft = prompt.value;
    const dtLine = new DataTransfer();
    dtLine.setData('text/plain', realLine);
    prompt.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dtLine, bubbles: true, cancelable: true })
    );
    check(
      A.count() === chipsBefore + 1 && A.list().pop().kind === 'clip' && prompt.value === draft,
      'the clip line pasted as text becomes one chip and no text in the prompt (' +
        A.count() +
        ' chips, prompt changed: ' +
        (prompt.value !== draft) +
        ')'
    );
    const clipChip = () =>
        document.querySelector('#attachmentList .attachment-chip[data-kind="clip"]'),
      playBtn = () => clipChip()?.querySelector('.attachment-play');
    const frameShown = await until(() => {
      const i = playBtn()?.querySelector('img');
      return i && i.complete && i.naturalWidth > 0;
    }, 5000);
    check(
      !!frameShown,
      'the chip shows the first frame (' +
        (playBtn()?.querySelector('img')?.naturalWidth || 0) +
        ' px wide picture)'
    );
    await wait(250);
    const imgChip = document.querySelector('#attachmentList .attachment-chip[data-kind="image"]'),
      rc = el => el.getBoundingClientRect();
    const cc = rc(clipChip()),
      ic = rc(imgChip),
      pb = rc(playBtn()),
      ii = rc(imgChip.querySelector('img')),
      ico = rc(playBtn().querySelector('svg'));
    check(
      Math.abs(cc.height - ic.height) < 0.1,
      'the clip chip is as high as the image chip (' +
        cc.height.toFixed(2) +
        ' vs ' +
        ic.height.toFixed(2) +
        ')'
    );
    check(
      Math.abs(pb.width - ii.width) < 0.1 &&
        Math.abs(pb.height - ii.height) < 0.1 &&
        Math.abs(pb.width - pb.height) < 0.1,
      'the play picture is the size of an image chip picture (' +
        pb.width.toFixed(2) +
        'x' +
        pb.height.toFixed(2) +
        ' vs ' +
        ii.width.toFixed(2) +
        'x' +
        ii.height.toFixed(2) +
        ')'
    );
    const dx = ico.left + ico.width / 2 - (pb.left + pb.width / 2),
      dy = ico.top + ico.height / 2 - (pb.top + pb.height / 2);
    check(
      Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && ico.width > 0 && ico.width <= pb.width * 0.6,
      'the play icon is centered on the picture within 1 px and at most 60% of it (off by ' +
        dx.toFixed(2) +
        ', ' +
        dy.toFixed(2) +
        '; icon ' +
        ico.width.toFixed(1) +
        ' in ' +
        pb.width.toFixed(1) +
        ')'
    );
    const top = pb.top - cc.top,
      bottom = cc.bottom - pb.bottom,
      itop = ii.top - ic.top,
      ileft = ii.left - ic.left;
    check(
      Math.abs(top - bottom) <= 0.5 &&
        Math.abs(top - itop) <= 0.5 &&
        Math.abs(pb.left - cc.left - ileft) <= 0.5,
      'the picture sits in the chip as an image chip picture does (top ' +
        top.toFixed(2) +
        ', bottom ' +
        bottom.toFixed(2) +
        ', image chip top ' +
        itop.toFixed(2) +
        '; left ' +
        (pb.left - cc.left).toFixed(2) +
        ' vs ' +
        ileft.toFixed(2) +
        ')'
    );
    check(
      clipChip().querySelector('small').textContent === '3 s' &&
        /^Clip \d+$/.test(clipChip().querySelector('.attachment-name').textContent),
      'the chip says Clip N and its length (' +
        clipChip().querySelector('.attachment-name').textContent +
        ', ' +
        clipChip().querySelector('small').textContent +
        ')'
    );
    check(
      cc.right <= rc(document.getElementById('attachmentList')).right + 0.5 &&
        clipChip().scrollWidth <= clipChip().clientWidth,
      'nothing in the chip is cut (' +
        clipChip().scrollWidth +
        ' of ' +
        clipChip().clientWidth +
        ')'
    );
    console.log('TNAI_SHOT:clip-chip');
    await wait(500);
    playBtn().focus({ preventScroll: true });
    check(
      document.activeElement === playBtn() &&
        playBtn().tagName === 'BUTTON' &&
        playBtn().getAttribute('aria-label') ===
          'Play ' + clipChip().querySelector('.attachment-name').textContent,
      'the picture is a button the keyboard reaches, named ' + playBtn().getAttribute('aria-label')
    );
    const flightClip = A.beginSend(),
      sentClip = await A.prepare(flightClip.items.slice(-1));
    flightClip.restore();
    check(sentClip.refs === ' ' + realLine, 'on send the agent gets the same line as before');
    await until(() => playBtn(), 2000);
    playBtn().click();
    const viewer = await until(async () => {
      const v = await mainCall('viewers');
      return v.length && v[0].url ? v : null;
    }, 6000);
    check(
      !!viewer &&
        viewer.length === 1 &&
        /^tnai-view:\/\/[^/]+\/ee55ee55-clip\.webm$/.test(viewer[0].url) &&
        viewer[0].width <= 720 &&
        viewer[0].height <= 480 + 32,
      'a click opens the clip in one small view-only window (' + JSON.stringify(viewer) + ')'
    );
    const moves = viewer ? await mainCall('moving') : null;
    check(
      moves && moves.changed === true,
      'the clip plays there: two pictures of the window 500 ms apart differ (' +
        JSON.stringify(moves) +
        ')'
    );
    await mainCall('closeViewers');
    A.remove(A.list().pop().id);
    check(
      A.count() === chipsBefore && !/clip/i.test(prompt.value.replace(draft, '')),
      'removing the chip removes the clip'
    );

    // The shorter pasted line: Claude Code only; every other CLI keeps the line.
    const shortLine =
      '[Clip: 3 s, 2 frames in order, ' + made.frames[0] + ' to ' + base(made.frames[1]) + ']';
    check(
      C.forTerminal('see ' + realLine + ' now', 'Claude Code') === 'see ' + shortLine + ' now',
      'a Claude Code panel pastes the short line (' +
        shortLine.length +
        ' instead of ' +
        realLine.length +
        ' characters)'
    );
    check(
      ['Codex', 'Cursor Agent', 'OpenCode', 'Terminal', undefined].every(
        a => C.forTerminal(realLine, a) === realLine
      ),
      'Codex, Cursor Agent, OpenCode and a shell keep the line as it is'
    );
    const oneFrame =
      '[Attached clip: 1 s of screen recording as 1 frame, ' +
      made.frames[0] +
      '; video ' +
      made.video +
      ']';
    check(
      C.shorten(oneFrame) === '[Clip: 1 s, 1 frame, ' + made.frames[0] + ']' &&
        C.shorten('plain words') === 'plain words',
      'a one frame clip shortens too, other text is left alone'
    );

    // The link and the still in a terminal: a real xterm with the short line in it.
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;right:12px;bottom:12px;width:760px;height:120px;z-index:99999';
    document.body.append(host);
    const xt = new window.Terminal({ cols: 90, rows: 6, allowProposedApi: true });
    xt.open(host);
    C.attach(xt);
    await new Promise(r =>
      xt.write(
        'first row\r\n> ' +
          base(made.frames[0]) +
          ' and nothing-clip-1.png and 00000000-clip.webm\r\n',
        r
      )
    );
    const found = await C.links(xt, 2),
      nameAt = '> '.length + 1;
    check(
      found.length === 1 &&
        found[0].text === base(made.frames[0]) &&
        found[0].range.start.x === nameAt &&
        found[0].range.end.x === nameAt + base(made.frames[0]).length - 1,
      'the file name of a clip that is on this PC is a link, a name with no clip is not (' +
        found.length +
        ' link, columns ' +
        found[0]?.range.start.x +
        ' to ' +
        found[0]?.range.end.x +
        ')'
    );
    check((await C.links(xt, 1)).length === 0, 'a row without a clip has no link');

    // Real pointer first: move onto the name and wait for the still.
    const screenEl = host.querySelector('.xterm-screen'),
      sr = rc(screenEl),
      cw = sr.width / xt.cols,
      ch = sr.height / xt.rows;
    const px = sr.left + (nameAt + 4) * cw,
      py = sr.top + 1.5 * ch;
    const inputId = 'i' + Date.now();
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    const inputDone = new Promise(r => {
      window.__tnaiInputDone[inputId] = r;
    });
    console.log(
      'TNAI_INPUT:' +
        JSON.stringify({
          id: inputId,
          events: [
            { type: 'mouseMove', x: px - 30, y: py + 40 },
            { type: 'mouseMove', x: px - 6, y: py },
            { type: 'mouseMove', x: px, y: py },
            { type: 'mouseMove', x: px + 2, y: py },
          ],
        })
    );
    await Promise.race([inputDone, wait(3000)]);
    const tipOn = () => {
      const t = C.tip();
      return t && !t.hidden && t.querySelector('img').naturalWidth > 0 ? t : null;
    };
    let byPointer = !!(await until(tipOn, 2500));
    if (!byPointer) found[0].hover({ clientX: px, clientY: py });
    const tipEl = await until(tipOn, 3000);
    check(
      !!tipEl,
      'resting on the name shows the first frame (' +
        (byPointer
          ? 'by a real pointer move'
          : 'by calling the link hover: the real pointer move showed nothing') +
        ')'
    );
    await wait(350);
    if (tipEl) {
      const tr = rc(tipEl),
        st = rc(tipEl.querySelector('.tnai-clip-still')),
        mk = rc(tipEl.querySelector('.tnai-clip-mark')),
        mi = rc(tipEl.querySelector('.tnai-clip-mark svg')),
        im = rc(tipEl.querySelector('img'));
      check(
        tr.left >= 0 && tr.top >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight,
        'the still stays inside the window near its corner (' +
          [tr.left, tr.top, tr.right, tr.bottom].map(n => Math.round(n)).join(', ') +
          ' in ' +
          innerWidth +
          'x' +
          innerHeight +
          ')'
      );
      const mx = mk.left + mk.width / 2 - (st.left + st.width / 2),
        my = mk.top + mk.height / 2 - (st.top + st.height / 2),
        ix = mi.left + mi.width / 2 - (mk.left + mk.width / 2),
        iy = mi.top + mi.height / 2 - (mk.top + mk.height / 2);
      check(
        Math.abs(mx) <= 1 && Math.abs(my) <= 1 && Math.abs(ix) <= 1 && Math.abs(iy) <= 1,
        'the play mark is centered on the still within 1 px, and its icon in the mark (' +
          [mx, my, ix, iy].map(n => n.toFixed(2)).join(', ') +
          ')'
      );
      check(
        im.width <= 320.5 &&
          im.height <= 200.5 &&
          Math.abs(im.left - tr.left - (tr.right - im.right)) <= 1 &&
          getComputedStyle(tipEl).pointerEvents === 'none',
        'the still is at most 320 by 200, even room left and right, and never takes the pointer (' +
          im.width.toFixed(0) +
          'x' +
          im.height.toFixed(0) +
          ', left ' +
          (im.left - tr.left).toFixed(2) +
          ', right ' +
          (tr.right - im.right).toFixed(2) +
          ')'
      );
      console.log('TNAI_SHOT:clip-hover');
      await wait(500);
    }
    found[0].leave();
    check(!C.tip() || C.tip().hidden, 'the still goes when the pointer leaves');
    found[0].activate();
    const viewer2 = await until(async () => {
      const v = await mainCall('viewers');
      return v.length && v[0].url ? v : null;
    }, 6000);
    check(
      !!viewer2 && viewer2.length === 1,
      'a click on the link plays the clip in the same window kind'
    );
    await mainCall('closeViewers');
    xt.dispose();
    host.remove();
  }

  // A clip file name the terminal wrapped over two rows is one link (113 joins the rows xterm marks
  // isWrapped).
  {
    const C = window.TnaiClips,
      name = 'ee55ee55-clip-1.png',
      rc = el => el.getBoundingClientRect();
    const wrapHost = document.createElement('div');
    wrapHost.style.cssText =
      'position:fixed;right:12px;bottom:12px;width:300px;height:120px;z-index:99999';
    document.body.append(wrapHost);
    const xw = new window.Terminal({ cols: 30, rows: 6, allowProposedApi: true });
    xw.open(wrapHost);
    C.attach(xw);

    // 20 characters, so the 19 of the name end 9 columns into the second row
    const lead = 'frames of the clip: ';
    await new Promise(r => xw.write(lead + name + ' end\r\nnext line\r\n', r));
    const row2 = xw.buffer.active.getLine(1);
    check(
      row2.isWrapped === true &&
        xw.buffer.active.getLine(0).translateToString(true) === lead + name.slice(0, 10) &&
        row2.translateToString(true) === name.slice(10) + ' end',
      'at 30 columns the name is split over two rows (' +
        xw.buffer.active.getLine(0).translateToString(true) +
        ' | ' +
        row2.translateToString(true) +
        ')'
    );
    const up = await C.links(xw, 1),
      down = await C.links(xw, 2),
      rg = l => l && [l.range.start.x, l.range.start.y, l.range.end.x, l.range.end.y].join(',');
    check(
      up.length === 1 &&
        down.length === 1 &&
        up[0].text === name &&
        down[0].text === name &&
        rg(up[0]) === '21,1,9,2' &&
        rg(down[0]) === '21,1,9,2',
      'each of the two rows gives one link for the whole name, from column 21 of row 1 to column 9 of row 2 (' +
        up.length +
        ' and ' +
        down.length +
        ' links, ' +
        rg(up[0]) +
        ' and ' +
        rg(down[0]) +
        ')'
    );
    check((await C.links(xw, 3)).length === 0, 'the next line has no link');
    const sw = rc(wrapHost.querySelector('.xterm-screen')),
      cw2 = sw.width / xw.cols,
      ch2 = sw.height / xw.rows,
      wx = sw.left + 4.5 * cw2,
      wy = sw.top + 1.5 * ch2; // the part on the second row
    const wid = 'w' + Date.now();
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    const wDone = new Promise(r => {
      window.__tnaiInputDone[wid] = r;
    });
    console.log(
      'TNAI_INPUT:' +
        JSON.stringify({
          id: wid,
          events: [
            { type: 'mouseMove', x: wx - 30, y: wy + 50 },
            { type: 'mouseMove', x: wx - 4, y: wy },
            { type: 'mouseMove', x: wx, y: wy },
            { type: 'mouseMove', x: wx + 2, y: wy },
          ],
        })
    );
    await Promise.race([wDone, wait(3000)]);
    const wOn = () => {
      const t = C.tip();
      return t && !t.hidden && t.querySelector('img').naturalWidth > 0 ? t : null;
    };
    const wPointer = !!(await until(wOn, 2500));
    if (!wPointer) down[0].hover({ clientX: wx, clientY: wy });
    const wTip = await until(wOn, 3000),
      wr = wTip && rc(wTip);
    check(
      !!wTip &&
        wTip.querySelector('img').naturalWidth === 320 &&
        wr.left >= 0 &&
        wr.top >= 0 &&
        wr.right <= innerWidth &&
        wr.bottom <= innerHeight,
      'resting on the part of the name on the second row shows the still, inside the window (' +
        (wPointer
          ? 'by a real pointer move'
          : 'by calling the link hover: the real pointer move showed nothing') +
        '; picture ' +
        (wTip?.querySelector('img').naturalWidth || 0) +
        ' px wide)'
    );
    console.log('TNAI_SHOT:clip-hover-wrapped');
    await wait(500);
    down[0].leave();
    check(!C.tip() || C.tip().hidden, 'and it goes when the pointer leaves');
    xw.dispose();
    wrapHost.remove();
  }

  // Send to a PowerShell thread (never an agent CLI).
  window.TnaiThreads.open();
  await wait(120);

  // The saved paths are read from the screen of the shell's thread (rows joined across wraps),
  // not from the raw replay buffer: PSReadLine and ConPTY repaint only the changed cells of a long
  // wrapped line, so the replay holds partial redraws that, joined, can cut or double a path.
  // The screen is the CLI screen of that thread, the terminal a user sees.
  const screenLines = paneId => {
    const t = window.TnaiThreadView.term();
    if (!t || t.tnaiPaneId !== paneId) return null;
    const b = t.buffer.active,
      out = [];
    let joinNext = false;
    for (let y = 0; y < b.length; y++) {
      const line = b.getLine(y);
      if (!line) continue;
      const full = line.translateToString(false),
        text = line.translateToString(true);
      if (out.length && (line.isWrapped || joinNext)) out[out.length - 1] += text;
      else out.push(text);

      // a row filled to the last column continues on the next (repaints can drop isWrapped)
      joinNext = full.length >= t.cols && full[t.cols - 1] !== ' ';
    }
    return out;
  };
  const shell = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  check(!!shell.session?.running, 'PowerShell thread started');
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  window.TnaiLiveTasks.setTarget(shell.paneId);
  await wait(1200);
  prompt.value = 'echo tnai-attach-ok';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('send').click();
  const buffer = async () => (await N.pty.replay(shell.paneId))?.buffer || '';
  const dir = await N.attachments.dir();
  const typed = await until(async () => {
    const b = (await buffer()).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r?\n/g, '');
    return /tnai-attach-ok/.test(b) && (b.match(/\[Attached image: /g) || []).length >= 2 && b;
  }, 6000);
  check(!!typed && typed.includes('[Attached image: '), 'typed line has the image refs');
  check(A.count() === 0 && chips().length === 0, 'chips cleared after a successful send');
  const sent = (window.TnaiLiveTasks.get(shell.paneId) || {}).text;
  check(sent === 'echo tnai-attach-ok', 'task recorded as the typed text');

  // Saved files are under userData/attachments/<date>/ and load from disk.
  const now = new Date(),
    day =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');

  // The typed command line as the panel shows it (the last one on screen holding both markers).
  const onScreen =
    (await until(
      () =>
        (screenLines(shell.paneId) || [])
          .filter(
            l =>
              l.includes('echo tnai-attach-ok') &&
              (l.match(/\[Attached image: [^\]]+\]/g) || []).length >= 2
          )
          .pop(),
      4000
    )) || '';
  const saved = [...onScreen.matchAll(/\[Attached image: ([^\]]+)\]/g)].map(m => m[1].trim());
  check(
    saved.length === 2 && saved.every(p => p.startsWith(dir + sep + day + sep)),
    'images saved in ' +
      dir +
      sep +
      day +
      (saved.length === 2 && saved.every(p => p.startsWith(dir + sep + day + sep))
        ? ''
        : ' · read ' +
          JSON.stringify(saved) +
          (screenLines(shell.paneId) ? '' : ' · the CLI screen of the thread was not shown'))
  );
  const loads = await Promise.all(
    saved.map(
      p =>
        new Promise(r => {
          const img = new Image();
          img.onload = () => r(img.naturalWidth > 0);
          img.onerror = () => r(false);
          img.src = 'file:///' + p.replace(/\\/g, '/');
        })
    )
  );
  check(loads.length === 2 && loads.every(Boolean), 'saved images exist on disk');

  // Attachments with no text are allowed and marked "(no instructions)".
  A.add([new File([await png(30, 30, '#858780')], 'only.png', { type: 'image/png' })]);
  prompt.value = '';
  document.getElementById('send').click();
  check(
    !!(await until(
      async () =>
        /\(no instructions\) \[Attached image: [^\]]*only\.png\]/.test(
          (await buffer()).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r?\n/g, '')
        ),
      5000
    )),
    'empty text + attachment sends "(no instructions) [Attached image: …]"'
  );

  // Nothing to send: no attachments and no text. The session's record also holds a note of every
  // size the screen was given (pty-service, OSC 7717), and the CLI screen of the thread gets its
  // rows back when the prompt box empties: those notes are not something sent, so they are left
  // out of what is compared.
  const sizeNote = new RegExp(
    String.fromCharCode(27) + '\\]7717;[^' + String.fromCharCode(7) + ']*.',
    'g'
  );
  const sentSoFar = async () => (await buffer()).replace(sizeNote, '');
  let before = -1;
  await until(async () => {
    const n = (await sentSoFar()).length;
    const same = n === before;
    before = n;
    await wait(300);
    return same;
  }, 5000);
  document.getElementById('send').click();
  await wait(400);
  const afterEmpty = await sentSoFar();
  check(
    afterEmpty.length === before,
    'empty composer sends nothing (the screen got ' +
      JSON.stringify(afterEmpty.slice(before).slice(0, 120)) +
      ')'
  );

  // Pasted text placeholders: a long paste collapses to a token; short text inserts normally; on
  // send the token expands to <pasted_text>, while the recorded task title/history keeps only the
  // collapsed token.
  const P = window.TnaiPastedText;
  check(!!P, 'window.TnaiPastedText exposed');

  // 20 lines, well over the 8-line limit
  const longText = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n');
  const dtLong = new DataTransfer();
  dtLong.setData('text/plain', longText);
  prompt.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dtLong, bubbles: true, cancelable: true })
  );
  await wait(80);
  check(
    /^\[Pasted text #1 \+20 lines\]$/.test(prompt.value),
    'long paste collapses to a token: ' + prompt.value
  );

  // One stray Backspace at the token's end only selects the whole token (nothing deleted, the
  // pasted text kept); the next press deletes it.
  {
    const tok = prompt.value,
      key = k => {
        const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
        prompt.dispatchEvent(e);
        return e.defaultPrevented;
      };
    prompt.focus();
    prompt.setSelectionRange(tok.length, tok.length);
    const held = key('Backspace');
    check(
      held &&
        prompt.value === tok &&
        prompt.selectionStart === 0 &&
        prompt.selectionEnd === tok.length &&
        P.count() === 1,
      'Backspace at the token end selects the whole token, deletes nothing'
    );
    check(!key('Backspace'), 'the second Backspace is left to delete the selected token');
    prompt.setSelectionRange(tok.length, tok.length);
  }

  // A short paste is left to the browser's own default insertion (not exercised by this synthetic
  // event, since Chromium does not run default clipboard actions for untrusted events); what
  // matters here is that our handler does not intercept it. Then set the value the way that default
  // insertion would have, to exercise the rest.
  const dtShort = new DataTransfer();
  dtShort.setData('text/plain', ' short');
  const shortEvent = new ClipboardEvent('paste', {
    clipboardData: dtShort,
    bubbles: true,
    cancelable: true,
  });
  const notIntercepted = prompt.dispatchEvent(shortEvent);
  check(
    notIntercepted && !shortEvent.defaultPrevented && P.count() === 1,
    'short paste is not intercepted (left to default insertion)'
  );
  prompt.value += ' short';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  check(
    prompt.value === '[Pasted text #1 +20 lines] short',
    'composer value: token plus the short paste'
  );
  window.TnaiLiveTasks.setTarget(shell.paneId);
  document.getElementById('send').click();
  const typed3 = await until(async () => {
    const b = (await buffer()).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r?\n/g, ' ');
    return /<pasted_text n="1">/.test(b) && b;
  }, 6000);

  // The pty's own line-wrap redraw can repeat text in the replay buffer, so check the markers
  // loosely, not as one contiguous run.
  check(
    !!typed3 &&
      /<pasted_text n="1">line 0 line 1/.test(typed3) &&
      /line 18 line 19<\/pasted_text>/.test(typed3),
    'sent text expands the token: ' + (typed3 || '')
  );
  const sent3 = (window.TnaiLiveTasks.get(shell.paneId) || {}).text;
  check(
    sent3 === '[Pasted text #1 +20 lines] short',
    'recorded task title stays the collapsed token, not the full paste'
  );
  check(P.count() === 0, 'store resets after a send that cleared the composer');

  // Long text copied from a Technically Not terminal (10 sets TnaiTerminalCopy) pastes plain: no
  // token, handler leaves it to default insertion.
  window.TnaiTerminalCopy = longText;
  const dtTerm = new DataTransfer();
  dtTerm.setData('text/plain', longText.replace(/\n/g, '\r\n'));
  const termEvent = new ClipboardEvent('paste', {
    clipboardData: dtTerm,
    bubbles: true,
    cancelable: true,
  });
  prompt.dispatchEvent(termEvent);
  check(
    !termEvent.defaultPrevented && P.count() === 0 && !/Pasted text/.test(prompt.value),
    'terminal copy pastes plain, not as a token'
  );
  window.TnaiTerminalCopy = '';
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));

  // Claude Code session gets --add-dir for the attachments folder (no prompt is sent).
  // a session even where Claude Code is signed out (else a sign-in panel opens); only its launch
  // arguments are read
  const cc = await window.TnaiTest.startThread({ tool: 'Claude Code', mode: 'run' }).catch(
    error => ({ error: error.message })
  );
  const ccPane =
    cc?.paneId ||
    G.sessions()
      .filter(s => s.agent === 'Claude Code')
      .pop()?.paneId;
  const info = await until(async () => (await N.pty.list()).find(s => s.paneId === ccPane), 5000);
  check(
    !!info && info.commandLine.includes('--add-dir') && info.commandLine.includes(dir),
    'Claude Code launched with --add-dir ' + dir + (info ? '' : ' · ' + (cc?.error || 'no session'))
  );
  if (ccPane) G.stop(ccPane);
  await wait(300);

  // Without the mouse: the command palette plays the latest clip named in the terminal the user is
  // in (113 latest, 39). No key is taken from the terminal.
  {
    const C = window.TnaiClips,
      P = window.TnaiPalette,
      name = 'ee55ee55-clip-1.png';

    // The terminal a user is in: the CLI screen of the shell's thread.
    window.TnaiThreads.show(shell.paneId);
    await until(() => window.TnaiThreadView.shown() === shell.paneId, 6000);
    if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
    const view = await until(
      () =>
        G.views().find(
          v =>
            v.paneId === shell.paneId &&
            v.term === window.TnaiThreadView.term() &&
            v.term.element?.getClientRects().length
        ),
      8000
    );
    check(
      !!view && !!P && !!window.TnaiTerminalCapture,
      'the CLI screen of a thread, the palette and the capture target are there'
    );

    // the terminal the user was last in
    view.term.element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const palItems = () =>
      [...document.querySelectorAll('.tnai-pal [role="option"], .tnai-pal li, .tnai-pal button')]
        .map(el => el.textContent)
        .filter(t => /latest clip/i.test(t));

    // Ctrl+K outside a terminal is the three-dots menu's search (124 takes the key first), so
    // the palette is opened by its own call, as the top bar's button opens it.
    const openPal = async text => {
      P.open();
      await until(() => P.isOpen(), 2000);
      const input = document.querySelector('.tnai-pal-input');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(350);
      return input;
    };
    check(C.latest(view.term) === '', 'a terminal with no clip in it has no latest clip');
    await openPal('latest clip');
    check(
      P.isOpen() && palItems().length === 0,
      'and the palette offers no clip there (' + palItems().length + ' entries)'
    );
    P.close();
    await new Promise(r =>
      view.term.write('\r\nolder 00000000-clip.webm\r\nsee ' + name + ' here\r\n', r)
    );
    await C.info('00000000-clip.webm');
    check(
      C.latest(view.term) === name,
      'the latest clip of the terminal is the newest name whose clip is on this PC (' +
        C.latest(view.term) +
        ')'
    );
    view.term.element.querySelector('.xterm-helper-textarea').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        keyCode: 75,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await wait(250);
    check(
      !P.isOpen(),
      'Ctrl+K pressed inside the terminal still does not open the palette: the key stays with the program'
    );
    const palInput = await openPal('latest clip');
    check(
      P.isOpen() &&
        palItems().length === 1 &&
        /Play the latest clip shown in this terminal/.test(palItems()[0]),
      'from outside the terminal the palette lists one entry for it (' +
        JSON.stringify(palItems()) +
        ')'
    );
    palInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    const viewer3 = await until(async () => {
      const v = await mainCall('viewers');
      return v.length && v[0].url ? v : null;
    }, 6000);
    check(
      !!viewer3 &&
        viewer3.length === 1 &&
        /ee55ee55-clip\.webm$/.test(viewer3[0].url) &&
        !P.isOpen(),
      'Enter on it plays that clip in the view-only window, keys only (' +
        (viewer3 ? viewer3[0].url.split('/').pop() : 'no window') +
        ')'
    );
    await mainCall('closeViewers');
  }

  G.stop(shell.paneId);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
