/*
 * Technically Not · tools/voice-bench.js — Speed/accuracy benchmark for the local voice engine
 * (desktop/voice-service.js). Usage: node tools/voice-bench.js --engine <dir with whisper-cli.exe[,
 * whisper-server.exe]> --model <ggml-*.bin> --clips <dir of NAME.wav + NAME.txt> [--mode
 * cli|server|service|all] [--runs 3] [--threads N] [--extra "-flag value ..."] cli = one
 * whisper-cli.exe per clip (spawn + model load every time), same flags as voice-service.js. server
 * = one whisper-server.exe kept warm; cold = spawn → model loaded → first answer ready; warm =
 * per-clip HTTP round trip. service = the real createVoiceService() against a copy of the engine
 * (--engine dir must be laid out as <dir>/engine + <dir>/models). Prints medians (ms), real-time
 * factor (processing time / audio length) and word error rate against NAME.txt. Clips: 16 kHz mono
 * 16-bit WAVs, e.g. spoken by Windows SAPI (PowerShell: System.Speech
 * SpeechSynthesizer.SetOutputToWaveFile with a SpeechAudioFormatInfo(16000, Sixteen, Mono));
 * NAME.txt holds the words spoken.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');

const args = process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--'))
    acc[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
  return acc;
}, {});
const engine = path.resolve(args.engine || '.'),
  model = args.model && path.resolve(args.model),
  clipsDir = path.resolve(args.clips || '.');
const runs = Number(args.runs) || 3,
  mode = args.mode || 'all';
const threads = String(args.threads || Math.max(1, Math.min(8, os.cpus().length)));
const extra =
  args.extra && args.extra !== true ? String(args.extra).split(/\s+/).filter(Boolean) : [];

const median = xs => {
  const s = [...xs].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const words = t =>
  String(t)
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function wer(ref, hyp) {
  // word-level Levenshtein / reference length
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
  return r.length ? d[r.length][h.length] / r.length : 0;
}
const clean = t =>
  String(t || '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
const audioCtx = bytes =>
  String(Math.min(1500, Math.max(256, Math.ceil(((bytes - 44) / 32000) * 50) + 64)));

const clips = fs
  .readdirSync(clipsDir)
  .filter(f => f.endsWith('.wav'))
  .map(f => {
    const buf = fs.readFileSync(path.join(clipsDir, f)),
      txt = path.join(clipsDir, f.replace(/\.wav$/, '.txt'));
    return {
      name: f.replace(/\.wav$/, ''),
      file: path.join(clipsDir, f),
      buf,
      seconds: (buf.length - 44) / 32000,
      ref: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : '',
    };
  })
  .sort((a, b) => a.seconds - b.seconds);

function timeCli(clip) {
  const t0 = performance.now();
  return new Promise((resolve, reject) =>
    execFile(
      path.join(engine, 'whisper-cli.exe'),
      [
        '-m',
        model,
        '-f',
        clip.file,
        '-nt',
        '-np',
        '-l',
        'en',
        '-t',
        threads,
        '-bs',
        '1',
        '-bo',
        '1',
        '-ac',
        audioCtx(clip.buf.length),
        ...extra,
      ],
      { cwd: engine, windowsHide: true, maxBuffer: 8 << 20 },
      (err, stdout, stderr) =>
        err
          ? reject(new Error(stderr || err.message))
          : resolve({ ms: performance.now() - t0, text: clean(stdout) })
    )
  );
}

const freePort = () =>
  new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

async function postClip(port, clip) {
  const form = new FormData();
  form.append('file', new Blob([clip.buf], { type: 'audio/wav' }), 'clip.wav');
  for (const [k, v] of Object.entries({
    response_format: 'text',
    language: 'en',
    beam_size: '1',
    best_of: '1',
    no_timestamps: 'true',
    audio_ctx: audioCtx(clip.buf.length),
    temperature: '0',
  }))
    form.append(k, v);
  const t0 = performance.now(),
    res = await fetch('http://127.0.0.1:' + port + '/inference', { method: 'POST', body: form }),
    text = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text);
  return { ms: performance.now() - t0, text: clean(text) };
}

async function startServer() {
  const port = await freePort(),
    t0 = performance.now();
  const child = spawn(
    path.join(engine, 'whisper-server.exe'),
    [
      '-m',
      model,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-t',
      threads,
      '-l',
      'en',
      '-nt',
      ...extra,
    ],
    { cwd: engine, windowsHide: true, stdio: 'ignore' }
  );
  for (;;) {
    if (child.exitCode !== null) throw new Error('whisper-server exited ' + child.exitCode);
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/health');
      if (r.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 10));
  }
  return { child, port, readyMs: performance.now() - t0 };
}

function report(label, cold, rows) {
  console.log(
    '\n== ' +
      label +
      ' (threads ' +
      threads +
      (extra.length ? ', extra ' + extra.join(' ') : '') +
      ')'
  );
  if (cold) console.log('cold start median: ' + cold.toFixed(0) + ' ms');
  for (const r of rows)
    console.log(
      r.clip.name.padEnd(6) +
        ' ' +
        r.clip.seconds.toFixed(1).padStart(5) +
        ' s  median ' +
        r.med.toFixed(0).padStart(5) +
        ' ms  RTF ' +
        (r.med / 1000 / r.clip.seconds).toFixed(3) +
        '  WER ' +
        (r.wer * 100).toFixed(1) +
        '%  "' +
        r.text +
        '"'
    );
}

async function benchCli() {
  await timeCli(clips[0]); // warm the OS file cache so every run measures the same thing
  const rows = [];
  for (const clip of clips) {
    const t = [];
    let text = '';
    for (let i = 0; i < runs; i++) {
      const r = await timeCli(clip);
      t.push(r.ms);
      text = r.text;
    }
    rows.push({ clip, med: median(t), text, wer: wer(clip.ref, text) });
  }
  report('whisper-cli per clip (spawn + load + transcribe)', 0, rows);
}

async function benchServer() {
  const colds = [];
  for (let i = 0; i < runs; i++) {
    const s = await startServer();
    const first = await postClip(s.port, clips[0]);
    colds.push(s.readyMs + first.ms);
    s.child.kill();
    await new Promise(r => setTimeout(r, 200));
  }
  const s = await startServer(),
    rows = [];
  try {
    await postClip(s.port, clips[0]);
    for (const clip of clips) {
      const t = [];
      let text = '';
      for (let i = 0; i < runs; i++) {
        const r = await postClip(s.port, clip);
        t.push(r.ms);
        text = r.text;
      }
      rows.push({ clip, med: median(t), text, wer: wer(clip.ref, text) });
    }
  } finally {
    s.child.kill();
  }
  report('whisper-server warm (cold = spawn → ready → first 2 s clip)', median(colds), rows);
}

async function benchService() {
  const { createVoiceService } = require('../desktop/voice-service');
  const colds = [],
    rows = [];
  for (let i = 0; i < runs; i++) {
    const svc = createVoiceService({ dir: engine }),
      t0 = performance.now(),
      r = await svc.transcribe(clips[0].buf);
    if (!r.ok) throw new Error(r.error);
    colds.push(performance.now() - t0);
    if (svc.dispose) svc.dispose();
  }
  const svc = createVoiceService({ dir: engine });
  try {
    await svc.transcribe(clips[0].buf);
    for (const clip of clips) {
      const t = [];
      let text = '';
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now(),
          r = await svc.transcribe(clip.buf);
        if (!r.ok) throw new Error(r.error);
        t.push(performance.now() - t0);
        text = r.text;
      }
      rows.push({ clip, med: median(t), text, wer: wer(clip.ref, text) });
    }
  } finally {
    if (svc.dispose) svc.dispose();
  }
  report('createVoiceService (cold = new service → first 2 s clip)', median(colds), rows);
}

(async () => {
  if (!clips.length) throw new Error('No .wav clips in ' + clipsDir);
  if (mode === 'cli' || mode === 'all') await benchCli();
  if (mode === 'server' || mode === 'all') await benchServer();
  if (mode === 'service') await benchService();
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
