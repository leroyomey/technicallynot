/*
 * Technically Not tools · desktop-check/tests/clip-smooth.js — Snapshot clips are recorded
 * smoothly: with something on screen that changes on every frame, a four-second clip of the app
 * window must hold close to the screen's own frame rate (60 a second on a 60 Hz screen), with no
 * long wait between two frames. The real recorder is used on the real screen (clip-smooth.main.js);
 * the moving picture is a strip the test draws over the window for those seconds
 * (requestAnimationFrame, one small element: no load on the PC). The camera frame window shows on
 * screen while it records. Needs a visible window, so it cannot run minimised. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
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

// A bar that moves on every frame of this screen, and how many frames a second this screen really
// draws.
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;inset:0;z-index:2147483000;background:#101014;pointer-events:none;overflow:hidden';
const bar = document.createElement('div');
bar.style.cssText =
  'position:absolute;top:0;bottom:0;left:0;width:90px;background:linear-gradient(90deg,#fff,#7c5cff);will-change:transform';
box.append(bar);
document.body.append(box);
let on = true,
  drawn = 0,
  x = 0;
const t0 = performance.now();
const step = () => {
  if (!on) return;
  drawn++;
  x = (x + 23) % Math.max(200, innerWidth - 90);
  bar.style.transform = 'translateX(' + x + 'px)';
  requestAnimationFrame(step);
};
requestAnimationFrame(step);
try {
  await wait(1000);
  const screenRate = drawn / ((performance.now() - t0) / 1000),
    target = await main('fps');
  log.push(
    'note this screen draws ' +
      screenRate.toFixed(0) +
      ' frames a second; the recorder asks for up to ' +
      target
  );
  const r = await main('record', 6000);
  log.push('note ' + JSON.stringify({ ...r, video: undefined, frameFiles: undefined }));
  check(
    r && r.saved === true && r.ms >= 2500 && r.ms <= 9000,
    'a clip of a few seconds was kept (' + (r && r.ms) + ' ms, ' + (r && r.bytes) + ' bytes)'
  );
  if (r && r.saved && !r.noProbe && r.frames) {
    const want = Math.min(target, screenRate);
    check(
      r.perSecond >= want * 0.85,
      'it holds ' + r.perSecond + ' frames a second (at least 85% of ' + want.toFixed(0) + ')'
    );
    check(
      r.longestGapMs <= 100,
      'no wait between two frames is longer than a tenth of a second (longest ' +
        r.longestGapMs +
        ' ms, usual ' +
        r.medianGapMs +
        ' ms)'
    );
    check(
      r.lateShare <= 0.03,
      'at most 3% of the frames come late (' + (r.lateShare * 100).toFixed(1) + '%)'
    );
    check(
      r.bytes <= ((64 * 1024 * 1024 * 4) / 30) * 1.5,
      'the file stays small enough that 30 seconds fit the limit (' +
        Math.round(r.bytes / 1024) +
        ' KB for 4 s)'
    );
  } else if (r && r.noProbe)
    log.push('note ffprobe is not on this PC: the frame rate was not measured (' + r.noProbe + ')');
  if (r && r.saved) await main('clean', [r.video, ...(r.frameFiles || [])]);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
on = false;
box.remove();
return { ok, log };
