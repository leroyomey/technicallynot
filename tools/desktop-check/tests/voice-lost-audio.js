/*
 * Technically Not tools · desktop-check/tests/voice-lost-audio.js — a busy window loses no audio
 * of a voice prompt (the recorder reads the mic off the window's thread; it still says how much was
 * lost, which is now none), and the notification sound waits while the mic records. Uses this
 * PC's real microphone for about four seconds; nothing is transcribed, kept or sent. With no
 * microphone it says so and checks only what needs none. The window is held up by a blocking
 * request to a local page that answers late (voice-lost-audio.main.js): no busy loop. Returns {ok,
 * log}.
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
const R = window.TnVoiceRecorder,
  N = window.TnaiNotify,
  wasOn = N.enabled();

// Every tone the app plays is an oscillator: count them.
let tones = 0;
const AC = window.AudioContext || window.webkitAudioContext,
  realOsc = AC.prototype.createOscillator;
AC.prototype.createOscillator = function () {
  tones++;
  return realOsc.call(this);
};
const hold = (url, ms) => {
  const x = new XMLHttpRequest();
  x.open('GET', url + '?ms=' + ms + '&t=' + Date.now(), false);
  try {
    x.send();
  } catch (e) {}
};
try {
  check(!!R && R.supported(), 'the recorder is there');
  const url = await main('serve');
  let mic = true;
  try {
    await R.start();
  } catch (e) {
    mic = false;
    log.push(
      'note no microphone could be opened on this PC (' +
        (e && (e.code || e.message)) +
        '): the recording checks are skipped'
    );
  }
  if (mic) {
    // 1: a clean second of recording loses nothing.
    await wait(1000);
    const clean = await R.stop();
    check(
      clean && clean.lost && clean.lost.ms === 0 && clean.lost.blocks === 0,
      'a recording with an idle window reports no lost audio: ' +
        JSON.stringify(clean && clean.lost)
    );

    // 2: the window held up for 600 ms in the middle of a recording.
    await R.start();
    await wait(500);
    const t0 = performance.now();
    hold(url, 600);
    const heldMs = Math.round(performance.now() - t0);
    await wait(500);
    const clip = await R.stop();
    check(heldMs >= 500, 'the window really was held up (' + heldMs + ' ms)');
    check(
      clip && clip.lost && clip.lost.ms === 0,
      'no audio is lost while the window is held up (the mic is read off its thread): ' +
        JSON.stringify(clip && clip.lost)
    );
    check(
      clip && clip.lost && clip.lost.worstGapMs >= 400,
      'the longest pause between two reads still shows the hold (' +
        (clip && clip.lost && clip.lost.worstGapMs) +
        ' ms)'
    );
    check(
      Math.abs(clip.seconds - (1 + heldMs / 1000)) < 0.5,
      'the clip holds the whole time, the hold included (' +
        clip.seconds.toFixed(2) +
        ' s recorded)'
    );

    // 3: the next recording starts from zero again.
    await R.start();
    await wait(400);
    const next = await R.stop();
    check(
      next.lost.ms === 0,
      'the count starts again with the next recording: ' + JSON.stringify(next.lost)
    );

    // 4: the notification sound waits while the mic records.
    N.setEnabled(true);
    await wait(1600);
    tones = 0;
    N.play();
    check(tones === 1, 'with the mic closed the notification sound plays at once (' + tones + ')');
    await R.start();
    await wait(300);
    tones = 0;
    N.play();
    N.play();
    check(tones === 0, 'while the mic records no notification sound is played (' + tones + ')');
    await R.stop();
    await wait(200);
    check(tones === 1, 'it is played once when the recording ends (' + tones + ')');
    await R.start();
    await wait(200);
    R.cancel();
    await wait(200);
    check(
      tones === 1,
      'a recording with no sound asked for plays none when it ends (' + tones + ')'
    );
  }

  // 5: the engine is started when the app comes to the front, but only for someone who used voice
  // in the last day (70 keepReady), so a press after an hour away does not wait for its start.
  // 70 learns the engine is installed 3 to 8 s after the window loads (its first status check)
  await wait(Math.max(0, 9000 - performance.now()));
  await main('watchWarm', true);
  localStorage.removeItem('tnai.voice-used.v1');
  window.dispatchEvent(new Event('focus'));
  await wait(300);
  check(
    (await main('warms')) === 0,
    'no voice used lately: the app coming to the front starts no engine'
  );
  localStorage.setItem('tnai.voice-used.v1', String(Date.now()));
  window.dispatchEvent(new Event('focus'));
  await wait(300);
  const warmed = await main('warms');
  check(
    warmed === 1,
    'voice used today: the app coming to the front starts the engine (' + warmed + ')'
  );
  localStorage.removeItem('tnai.voice-used.v1');
  await main('watchWarm', false);
  N.setEnabled(false);
  tones = 0;
  N.play();
  check(tones === 0, 'with Notification sounds off nothing plays');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
AC.prototype.createOscillator = realOsc;
N.setEnabled(wasOn);
try {
  R.cancel();
  R.rest && R.rest();
} catch (e) {}
try {
  await main('stop');
} catch (e) {}
return { ok, log };
