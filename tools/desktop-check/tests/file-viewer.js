// Technically Not tools · desktop-check/tests/file-viewer.js — View-only files through
// TnaiFileViewer.open (09): a >2 MB text file and an image open in their own view-only window
// serving the WHOLE file; program files are only shown in Explorer; unknown binaries go to the
// default app, never a window.
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
const F = window.tnaiNative.fs,
  V = window.TnaiFileViewer;
try {
  // Seed: 3 MB text ending in a marker, a small PNG, a .bat, an unknown binary.
  const big = 'line of text for the large file check\n'.repeat(82000) + 'END-MARKER-3MB\n';
  await F.write('big.log', new TextEncoder().encode(big));
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 30;
  c.getContext('2d').fillRect(0, 0, 20, 20);
  await F.write(
    'shot.png',
    new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())
  );
  await F.write('run.bat', new TextEncoder().encode('@echo off\0\r\necho hi\r\n'));
  await F.write('data.bin', new Uint8Array([0, 1, 2, 0, 255, 0, 7]));

  // Opened through 09's TnaiFileViewer.open (Overview Files in motion, palette): the File
  // repository editor and its Pop out / Open on this PC buttons were removed in the purple
  // redesign.
  check((await V.open('big.log')) === true, '>2 MB text: opens');
  const w = await until(async () =>
    (await main('windows')).find(x => /big.log/.test(x.title) && /^tnai-view:/.test(x.url))
  );
  check(
    !!w && /^tnai-view:\/\//.test(w.url) && /view only/.test(w.title),
    'pop-out window opened: ' + (w?.title || 'none')
  );
  const s = w && (await main('served', w.url));
  check(
    s?.status === 200 &&
      /^text\/plain/.test(s.type) &&
      s.length === big.length &&
      /END-MARKER-3MB/.test(s.tail),
    'window is served the whole file as plain text (' + (s?.length || 0) + ' bytes)'
  );
  await wait(800);
  await main('shot', 'big\.log', 'popout-text');

  check((await V.open('shot.png')) === true, 'image: opens');
  const iw = await until(async () =>
    (await main('windows')).find(x => /shot.png/.test(x.title) && /^tnai-view:/.test(x.url))
  );
  const is = iw && (await main('served', iw.url));
  await wait(800);
  await main('shot', 'shot\.png', 'popout-image');
  check(is?.status === 200 && /image\/png/.test(is.type || ''), 'image window served as image/png');

  // The window's own minimize, maximize and close buttons (its top row, where the window has no
  // system title bar).
  if ((await main('state', 'shot.png')).bar) {
    const st = () => main('state', 'shot.png');
    check(
      (await main('press', 'shot.png', 'maximize')) &&
        !!(await until(async () => (await st()).max, 4000)),
      "the window's maximize button maximizes it"
    );
    check(
      /view only/.test((await st()).title),
      '…and the window keeps its title: ' + (await st()).title
    );
    check(
      (await main('press', 'shot.png', 'maximize')) &&
        !!(await until(async () => !(await st()).max, 4000)),
      '…and a second press puts it back'
    );
    check(
      (await main('press', 'shot.png', 'minimize')) &&
        !!(await until(async () => (await st()).min, 4000)),
      'the minimize button minimizes it'
    );
    log.push('info top row: ' + JSON.stringify(await main('barShot', 'shot\.png', 'popout-bar')));
    const hit = await main('click', 'shot.png', 'close');
    check(
      !!hit && hit.fileTop > 0 && hit.y + hit.h / 2 <= hit.fileTop,
      'the close button sits in the top row, not under the file (button middle y ' +
        hit?.y +
        ', file starts at ' +
        hit?.fileTop +
        ')'
    );
    check(
      !!hit && !!(await until(async () => !(await st()).open, 4000)),
      'a mouse click on the close button closes it (' + JSON.stringify(hit) + ')'
    );
  } else log.push('info this window has a system title bar here: its own buttons are not drawn');

  await V.open('run.bat');
  await wait(300);
  let o = await main('opened');
  check(
    !o.opened.length && o.shown.length === 1 && /run\.bat$/.test(o.shown[0]),
    '.bat is only shown in Explorer, never run (' + JSON.stringify(o) + ')'
  );

  await V.open('data.bin');
  await wait(300);
  o = await main('opened');

  // Since 0.3.72 only known-safe kinds open with the default app (file-viewer.js OPENABLE, audit
  // app-1 #5); an unknown kind is shown in File Explorer instead, never run.
  check(
    !o.opened.length &&
      o.shown.length === 2 &&
      /data\.bin$/.test(o.shown[1]) &&
      !(await main('windows')).some(x => /data.bin/.test(x.title)),
    'unknown binary: no window, only shown in Explorer with the confined path (' +
      JSON.stringify(o) +
      ')'
  );
  const r = await F.popout('data.bin', false);
  check(r && !r.ok, 'main refuses to pop out an unknown binary');
  const esc = await F.popout('../outside.txt', true);
  check(esc && !esc.ok, 'paths outside the project are refused');
  await main('closeAll');
} catch (error) {
  check(false, 'threw: ' + error.message);
}
return { ok, log };
