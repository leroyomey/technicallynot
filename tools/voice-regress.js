/*
 * Technically Not · tools/voice-regress.js — Real-voice regression test for voice prompts: the
 * user's own recorded clips go through the recorder's clean-up (src/scripts/69-voice-recorder.js
 * pack: trim + raise) and the real speech engine (desktop/voice-service.js), and the words that
 * come back are compared with what was said. Run it before and after any change to how voice is
 * picked up. Collecting clips (once, and again whenever more are wanted):
 * 1. Start a dev copy with keeping on (PowerShell): $env:TNAI_VOICE_KEEP='1'; npm start
 * 2. Read the lines of tools/voice-clips/sentences.txt as voice prompts, one prompt per line:
 * normal, softly, from further away. Each prompt is saved in tools/voice-clips/real as NAME.wav
 * (the clip as the mic gave it) + NAME.heard.txt (what was heard).
 * 3. node tools/voice-regress.js label gives each clip NAME.txt, the sentence it matches; unsure
 * ones are listed to fix by hand. Running: node tools/voice-regress.js [--models fast,accurate]
 * [--raw] [--save] [--clips DIR] [--dir VOICE_DIR] --models Voice models to test (default: every
 * installed one of fast, accurate, best, parakeet) --raw skip the recorder's clean-up (shows what
 * trim + raise are worth) --save write this run as the baseline (baseline.json beside the clips)
 * --dir the folder with engine/ and models/ (default: the dev copy's, %APPDATA%\TechnicallyNot.ai
 * (dev)\voice; the installed app's folder also works, but Parakeet rewrites its word-hints file
 * there) Prints per clip its speech level and each model's word error rate, then the totals. Exit
 * code 1 when a model makes more word errors than its baseline. The clips are the user's voice:
 * tools/voice-clips/real is git-ignored and never leaves this PC.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createVoiceService, wavToFloat, CHOICES } = require('../desktop/voice-service');
const recorder = require('../src/scripts/69-voice-recorder.js')._test;

const argv = process.argv.slice(2),
  cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const args = argv.reduce((acc, a, i, all) => {
  if (a.startsWith('--'))
    acc[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
  return acc;
}, {});
const clipsDir = path.resolve(
  args.clips && args.clips !== true ? args.clips : path.join(__dirname, 'voice-clips', 'real')
);
const voiceDir = path.resolve(
  args.dir && args.dir !== true
    ? args.dir
    : path.join(process.env.APPDATA || '', 'TechnicallyNot.ai (dev)', 'voice')
);
const sentencesFile = path.join(__dirname, 'voice-clips', 'sentences.txt'),
  baselineFile = path.join(clipsDir, 'baseline.json');
const RATE = 16000,
  UNSURE = 0.5;

const words = t =>
  String(t)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function errors(ref, hyp) {
  // word-level Levenshtein distance
  const r = words(ref),
    h = words(hyp),
    d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1)
      );
  return d[r.length][h.length];
}
const read = file => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};
const names = () =>
  fs.existsSync(clipsDir)
    ? fs
        .readdirSync(clipsDir)
        .filter(f => f.endsWith('.wav'))
        .map(f => f.slice(0, -4))
        .sort()
    : [];
const pct = x => (x * 100).toFixed(1) + '%';

function label() {
  const sentences = read(sentencesFile)
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
  if (!sentences.length) throw new Error('No sentences in ' + sentencesFile);
  let done = 0,
    had = 0;
  const unsure = [];
  for (const name of names()) {
    const txt = path.join(clipsDir, name + '.txt');
    if (fs.existsSync(txt)) {
      had++;
      continue;
    }
    const heard = read(path.join(clipsDir, name + '.heard.txt'));
    const best = sentences
      .map(s => ({ s, wer: errors(s, heard) / words(s).length }))
      .sort((a, b) => a.wer - b.wer)[0];
    if (!words(heard).length || best.wer > UNSURE) {
      unsure.push(name + '  heard: "' + heard + '"');
      continue;
    }
    fs.writeFileSync(txt, best.s + '\n');
    done++;
  }
  console.log('Labeled ' + done + ' clip(s); ' + had + ' already had their words.');
  if (unsure.length)
    console.log(
      '\nNot sure which sentence these are (nothing or too little was heard). Write the sentence said into NAME.txt beside each, or delete the clip:\n  ' +
        unsure.join('\n  ')
    );
}

async function run() {
  const clips = names()
    .map(name => ({
      name,
      ref: read(path.join(clipsDir, name + '.txt')),
      samples: wavToFloat(fs.readFileSync(path.join(clipsDir, name + '.wav'))),
    }))
    .filter(c => c.ref && c.samples && c.samples.length);
  if (!clips.length)
    throw new Error(
      'No labeled clips in ' +
        clipsDir +
        ' (NAME.wav at 16 kHz mono with NAME.txt). See the top of this file for how to record them.'
    );
  for (const c of clips) {
    c.level = recorder.speechLevel(c.samples, RATE);
    c.buf = args.raw
      ? Buffer.from(recorder.encodeWav(c.samples, RATE))
      : Buffer.from(recorder.pack(c.samples, RATE));
    c.words = words(c.ref).length;
  }
  const svc = createVoiceService({ dir: voiceDir });
  const asked =
    args.models && args.models !== true
      ? String(args.models)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : Object.keys(CHOICES);
  const models = [];
  for (const m of asked) {
    if ((await svc.status('en', m)).installed) models.push(m);
    else console.log('skipped ' + m + ': not installed in ' + voiceDir);
  }
  if (!models.length)
    throw new Error(
      'No Voice model is installed in ' +
        voiceDir +
        '. Talk once in the dev copy with that model, or pass --dir.'
    );
  const result = {}; // model → { clip → word errors }
  try {
    for (const m of models) {
      result[m] = {};
      for (const c of clips) {
        const r = await svc.transcribe(c.buf, 'en', [], m);
        if (!r.ok) throw new Error(m + ' on ' + c.name + ': ' + r.error);
        (c.heard ||= {})[m] = r.text;
        result[m][c.name] = errors(c.ref, r.text);
      }
    }
  } finally {
    svc.dispose();
  }

  const base = (() => {
    try {
      return JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    } catch {
      return null;
    }
  })();
  const mode = args.raw ? 'raw' : 'packed',
    before = base && base[mode];
  console.log(
    clips.length +
      ' clips, ' +
      (args.raw ? 'as recorded (no clean-up)' : "through the recorder's clean-up") +
      '\n'
  );
  for (const c of clips) {
    console.log(
      c.name +
        '  level ' +
        c.level.toFixed(4) +
        (c.level < 0.01 ? ' (very quiet)' : '') +
        '  "' +
        c.ref +
        '"'
    );
    for (const m of models) {
      const e = result[m][c.name],
        was = before && before[m] && before[m][c.name];
      console.log(
        '    ' +
          m.padEnd(9) +
          pct(e / c.words).padStart(7) +
          (typeof was === 'number' && was !== e ? '  (was ' + pct(was / c.words) + ')' : '') +
          (e ? '  heard: "' + c.heard[m] + '"' : '')
      );
    }
  }
  const total = clips.reduce((n, c) => n + c.words, 0);
  let worse = false;
  console.log('\nTotals (word errors / ' + total + ' words):');
  for (const m of models) {
    const e = clips.reduce((n, c) => n + result[m][c.name], 0),
      missed = clips.filter(c => !words(c.heard[m]).length).length;

    // Against the baseline only over the clips both runs have, so adding clips later never reads as
    // getting worse.
    const shared =
      before && before[m] ? clips.filter(c => typeof before[m][c.name] === 'number') : [];
    const now = shared.reduce((n, c) => n + result[m][c.name], 0),
      was = shared.reduce((n, c) => n + before[m][c.name], 0);
    const verdict = !shared.length
      ? 'no baseline'
      : now > was
        ? 'WORSE than baseline (' + was + ' → ' + now + ' on ' + shared.length + ' clips)'
        : now < was
          ? 'better than baseline (' + was + ' → ' + now + ')'
          : 'same as baseline';
    if (shared.length && now > was) worse = true;
    console.log(
      '  ' +
        m.padEnd(9) +
        String(e).padStart(4) +
        '  ' +
        pct(e / total).padStart(6) +
        '  nothing heard in ' +
        missed +
        ' clip(s)  ' +
        verdict
    );
  }
  if (args.save) {
    fs.writeFileSync(
      baselineFile,
      JSON.stringify({ ...(base || {}), [mode]: { ...(before || {}), ...result } }, null, 1) + '\n'
    );
    console.log('\nSaved as the baseline: ' + baselineFile);
  } else if (!before)
    console.log(
      '\nNo baseline yet: run again with --save to keep this as the one to compare against.'
    );
  if (worse && !args.save) {
    console.log('\nFAIL: at least one model makes more word errors than its baseline.');
    process.exitCode = 1;
  }
}

(async () => {
  if (cmd === 'label') label();
  else await run();
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
