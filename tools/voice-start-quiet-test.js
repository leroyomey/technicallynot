/*
 * Technically Not tools · voice-start-quiet-test.js — Plain Node check that the start tone alone is
 * not "something said" (src/scripts/69-voice-recorder.js quietStart, called by 70 as the tone
 * plays). A recording with no mic is fed 64 ms blocks: a hold with only
 * the tone in its first 0.4 s and mic hiss after comes back silent (nothing is sent), while a word
 * after 0.4 s, and a hold without quietStart, are not silent. No engine, no window, no sound.
 * Run: node tools/voice-start-quiet-test.js (exit code 1 on a failure).
 */
'use strict';
const recorder = require('../src/scripts/69-voice-recorder.js');

const RATE = 16000;
const BLOCK = 1024;

// A fixed random source, so a run gives the same numbers every time.
let seed = 7;

function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

// 70's cue(true) as the mic hears it: 587 Hz then 880 Hz, peak 0.1, played 30 ms into the hold.
function toneAt(time) {
  let value = 0;
  [587, 880].forEach((freq, index) => {
    const t = time - 0.03 - index * 0.07;
    if (t < 0 || t > 0.1) return;
    let envelope = 0;
    if (t < 0.01) envelope = Math.pow(0.1 / 0.0001, t / 0.01) * 0.0001;
    else if (t < 0.09) envelope = 0.1 * Math.pow(0.0001 / 0.1, (t - 0.01) / 0.08);
    value += envelope * Math.sin(2 * Math.PI * freq * t);
  });
  return value;
}

// A short spoken-sounding burst: a 150 Hz voice at 0.05 for 0.25 s from `from` seconds on.
function wordAt(time, from) {
  const t = time - from;
  if (t < 0 || t > 0.25) return 0;
  return 0.05 * Math.sin(2 * Math.PI * 150 * t) + 0.02 * Math.sin(2 * Math.PI * 450 * t);
}

// One hold of `seconds`, built by sound(time), fed block by block; quietStart as 70 calls it.
async function holdOf(seconds, sound, quiet) {
  recorder._test.hold(RATE);
  if (quiet) recorder.quietStart(0.4);
  const total = Math.round(seconds * RATE);
  for (let at = 0; at < total; at += BLOCK) {
    const block = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) block[i] = sound((at + i) / RATE) + (random() - 0.5) * 0.002;
    recorder._test.feed(block);
  }
  return recorder.stop();
}

const failures = [];

function check(ok, text) {
  console.log((ok ? 'ok   ' : 'FAIL ') + text);
  if (!ok) failures.push(text);
}

(async () => {
  const toneOnly = await holdOf(1.2, toneAt, true);
  check(toneOnly.silent, 'the start tone alone (first 0.4 s), then hiss: silent, nothing sent');

  const word = await holdOf(1.2, time => toneAt(time) + wordAt(time, 0.6), true);
  check(!word.silent, 'the tone and a word at 0.6 s: not silent, sent');

  const noQuiet = await holdOf(1.2, toneAt, false);
  check(!noQuiet.silent, 'without quietStart (voice sounds off) the same tone counts as before');

  const quietOnly = await holdOf(1.2, () => 0, true);
  check(quietOnly.silent, 'hiss only: silent, as before');

  console.log(failures.length ? 'RESULT: FAIL (' + failures.length + ')' : 'RESULT: PASS');
  process.exit(failures.length ? 1 : 0);
})();
