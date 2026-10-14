/*
 * Technically Not desktop · voice-service.js — On-device voice prompts: downloads the whisper.cpp
 * CPU engine (pinned GitHub release) and a model (Hugging Face; the Voice model setting picks the
 * size: Fast = base, Accurate = small, Best = large-v3-turbo q5_0; English uses the .en variant
 * where one exists, another language or Auto-detect the multilingual one; each fetched the first
 * time it is needed) into <dir>/engine and <dir>/models, verifies both by SHA-256, and turns a 16
 * kHz mono 16-bit WAV into text. Clips go to one warm whisper-server.exe on 127.0.0.1 (model stays
 * loaded; stopped after 60 idle minutes, on dispose() and when this process exits), else to a
 * one-off whisper-cli.exe. Speed/accuracy measured with tools/voice-bench.js. The Parakeet choice
 * (Windows) instead downloads a pinned sherpa-onnx build (k2-fsa GitHub release) into <dir>/sherpa
 * and NVIDIA Parakeet TDT 0.6B v3 int8 (Hugging Face) into <dir>/models/parakeet-tdt-0.6b-v3-int8,
 * and sends clips to one warm sherpa-onnx-offline-websocket-server.exe on 127.0.0.1 (same idle/exit
 * rules). Languages Parakeet lacks fall back to Whisper (Accurate). Use graphics card (Windows,
 * NVIDIA, off by default): the Whisper models run on the card through the
 * same pinned whisper.cpp build made for CUDA (<dir>/engine-cuda, its own download); see CUDA
 * below. Any failure there falls back to the CPU engine. Nothing leaves this PC after the one-time
 * download. TN_VOICE_FAKE=<text> skips all files for tests (status installed, transcribe returns
 * that text).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const net = require('net');
const { execFile, spawn } = require('child_process');

// Pinned downloads: whisper.cpp build b5130 (= v1.9.4), Windows x64 CPU, and the ggml models below
// (size + SHA-256 from the Hugging Face LFS metadata of ggerganov/whisper.cpp, 2026-09-29). Hashes
// checked after every download.
const WIN = process.platform === 'win32';
const ENGINE = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
  bytes: 8573270,
};
const MODELS = {
  'base.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    bytes: 147964211,
  },
  base: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    bytes: 147951465,
  },
  'small.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    bytes: 487614201,
  },
  small: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    bytes: 487601967,
  },
  'large-v3-turbo-q5_0': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    bytes: 574041195,
  },
  // NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), int8 ONNX export by the sherpa-onnx author
  // (csukuangfj). A folder of four files; hashes from the Hugging Face LFS metadata, tokens.txt
  // (not LFS) hashed after download, all rechecked here 2026-09-29.
  'parakeet-tdt-0.6b-v3-int8': {
    engine: 'sherpa',
    files: [
      'encoder.int8.onnx:acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247:652184281',
      'decoder.int8.onnx:179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e:11845275',
      'joiner.int8.onnx:3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3:6355277',
      'tokens.txt:d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d:93939',
    ].map(line => {
      const [name, sha256, bytes] = line.split(':');
      return {
        name,
        sha256,
        bytes: Number(bytes),
        url:
          'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main/' +
          name,
      };
    }),
  },
};
for (const m of Object.values(MODELS))
  if (m.files) m.bytes = m.files.reduce((n, f) => n + f.bytes, 0);
const engineOf = name => (MODELS[name] && MODELS[name].engine) || 'whisper';

// sherpa-onnx v1.13.8 (2026-09-10), Windows x64, shared libs with the static C runtime (MT: no VC++
// redistributable needed), no TTS. SHA-256 = the GitHub release asset digest, rechecked after
// download. Only the offline websocket server and its two onnxruntime DLLs are kept.
const SHERPA = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts.tar.bz2',
  sha256: '4b0a94f7b5c606b1b64a19a831c2127559e4b3d34e195465ebc7be73d9ed4783',
  bytes: 23271851,
};
const SHERPA_ZIP_DIR = 'sherpa-onnx-v1.13.8-win-x64-shared-MT-Release-no-tts/bin';
const SHERPA_SERVER = 'sherpa-onnx-offline-websocket-server.exe';
const SHERPA_FILES = [SHERPA_SERVER, 'onnxruntime.dll', 'onnxruntime_providers_shared.dll'];

// Parakeet v3 transcribes these 25 European languages (it detects which one by itself); any other
// language, and Auto-detect (which may be any language), falls back to the choice's Whisper model.
const PARAKEET_LANGS = new Set([
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'de',
  'el',
  'hu',
  'it',
  'lv',
  'lt',
  'mt',
  'pl',
  'pt',
  'ro',
  'sk',
  'sl',
  'es',
  'sv',
  'ru',
  'uk',
]);

// Voice model choices (Settings › Voice › Voice model, `tnai.voice-model.v1` in
// 70-voice-prompt.js). Each names its engine and the model file for English and for every other
// language; 'fast' is the default and was the only model before the setting existed. The engine
// follows from the model file (engineOf: MODELS[name].engine, default whisper);
// status/install/transcribe/warm branch on it. A choice with langs uses its own model only for
// those languages (and only on Windows, where its engine is downloadable) and otherwise its
// fallback Whisper model. large-v3-turbo has no English-only variant, so Best uses the multilingual
// file with language en (decodeArgs).
const CHOICES = {
  fast: { engine: 'whisper', en: 'base.en', other: 'base' },
  accurate: { engine: 'whisper', en: 'small.en', other: 'small' },
  best: { engine: 'whisper', en: 'large-v3-turbo-q5_0', other: 'large-v3-turbo-q5_0' },
  parakeet: {
    engine: 'sherpa',
    en: 'parakeet-tdt-0.6b-v3-int8',
    other: 'parakeet-tdt-0.6b-v3-int8',
    langs: PARAKEET_LANGS,
    fallback: { en: 'small.en', other: 'small' },
  },
};
const choiceOf = value => (Object.prototype.hasOwnProperty.call(CHOICES, value) ? value : 'fast');

// Spoken language: 'en' (default, English-only model: most accurate for English), 'auto' (detect
// per clip) or a Whisper language code.
const langOf = value => {
  const l = String(value || 'en').toLowerCase();
  return /^(auto|[a-z]{2,3})$/.test(l) ? l : 'en';
};
const modelFor = (lang, choice) => {
  let c = CHOICES[choiceOf(choice)];
  if (c.langs && (!WIN || !c.langs.has(lang))) c = c.fallback;
  return lang === 'en' ? c.en : c.other;
};

// macOS and Linux: whisper.cpp publishes no binaries there, so tools/build-whisper.sh builds the
// same pinned tag in CI into build-resources/whisper/<mac|linux>-<arch>, and electron-builder ships
// it as <resources>/whisper (signed and notarized with the app on Mac, so no download, hash or
// quarantine step). Only the model is downloaded. TN_WHISPER_DIR overrides the folder for
// development.
const BUNDLED_DIR = () => {
  const own = path.join(
    __dirname,
    '..',
    'build-resources',
    'whisper',
    (process.platform === 'darwin' ? 'mac' : process.platform) + '-' + process.arch
  );
  return (
    [
      process.env.TN_WHISPER_DIR,
      process.resourcesPath && path.join(process.resourcesPath, 'whisper'),
      own,
    ]
      .filter(Boolean)
      .find(d => fs.existsSync(path.join(d, 'whisper-cli'))) || own
  );
};

// Only what the engine needs from the zip (it also ships tests, SDL2 …); ggml-cpu-*.dll are the
// per-CPU backends picked at run time.
const ZIP_DIR = 'Release';
const EXE = WIN ? '.exe' : '';
const SERVER_FILE = 'whisper-server' + EXE;
const ZIP_FILES = [
  'whisper-cli.exe',
  SERVER_FILE,
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-cpu-*.dll',
];
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

// NVIDIA graphics-card engine: the same pinned whisper.cpp build (b5130) made for CUDA 12.4, the
// one published build that carries cuBLAS itself (the 11.8 zip has no cublas64_11.dll, so its GPU
// part never loads without an installed CUDA toolkit; tried 2026-10-05). SHA-256 = the GitHub
// release asset digest. It reads the same ggml model files; ~1.1 GB unpacked. The CPU engine stays
// installed as the fallback. Measured 2026-10-05 on an RTX 4080 SUPER, small.en, 6.7 s clip, warm:
// ~90 ms (CPU engine, 8 threads: ~480 ms); server start ~0.85 s.
const CUDA = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip',
  sha256: 'af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7',
  bytes: 674539285,
};
const CUDA_NEED = [
  SERVER_FILE,
  'ggml-cuda.dll',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll',
];
const CUDA_FILES = [...ZIP_FILES, ...CUDA_NEED.slice(1)];

// What the card must have: the driver CUDA 12.4 names for Windows (NVIDIA's CUDA 12.4 release
// notes) and room for the largest model.
const CUDA_MIN_DRIVER = 551.61,
  CUDA_MIN_MB = 2048;

// installed with every NVIDIA driver
const NVIDIA_SMI = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe');
const GPU_QUERY = [
  '--query-gpu=name,driver_version,memory.total,memory.used',
  '--format=csv,noheader,nounits',
];

// The first card in nvidia-smi's answer to GPU_QUERY ("NVIDIA GeForce RTX 4080 SUPER, 610.88,
// 16376, 2165"); null when there is none.
function parseGpu(text) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(.+?),\s*(\d+(?:\.\d+)?)[\d.]*\s*,\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line);
    if (m)
      return {
        name: m[1].trim(),
        driver: Number(m[2]),
        totalMB: Number(m[3]),
        usedMB: Number(m[4]),
      };
  }
  return null;
}

// Whether the graphics-card engine can be offered on this computer, and when not, the sentence
// shown beside its grayed-out switch.
function gpuVerdict(card, platform = process.platform, arch = process.arch) {
  const no = reason => ({ available: false, reason });
  if (platform === 'darwin' && arch === 'arm64')
    return no('Already on: this Mac’s graphics chip runs the Whisper voice models.');
  if (platform !== 'win32' || arch !== 'x64')
    return no('Needs Windows with an NVIDIA graphics card.');
  if (!card) return no('Needs an NVIDIA graphics card. None was found on this PC.');
  if (card.driver < CUDA_MIN_DRIVER)
    return no(
      'Update your NVIDIA driver: ' +
        card.name +
        ' has version ' +
        card.driver +
        ', and ' +
        CUDA_MIN_DRIVER +
        ' or newer is needed.'
    );
  if (card.totalMB < CUDA_MIN_MB)
    return no(
      card.name +
        ' has too little graphics memory (' +
        (card.totalMB / 1024).toFixed(1) +
        ' GB; 2 GB or more is needed).'
    );
  return { available: true, reason: '' };
}

// Graphics memory a model needs free before it is loaded on the card, roughly: its file, half again
// for its work buffers, and 400 MB.
const gpuNeedMB = name => Math.round((MODELS[name].bytes / 1048576) * 1.5 + 400);
const GPU_FAILED = 'The graphics card engine did not start on this PC, so the processor is used.';
const GPU_FULL = 'Not enough free graphics memory right now, so the processor is used.';
const GPU_NOT_PARAKEET =
  'Parakeet runs on the processor. The graphics card is used with Fast, Accurate and Best.';

// Time allowed to transcribe one clip: 60 s plus twice its length (16 kHz 16-bit mono WAV = 32,000
// bytes/s), so a 5-minute recording on a slow PC (running at half real time) still finishes instead
// of being dropped; short prompts keep the 60 s floor.
const transcribeTimeout = bytes => 60 * 1000 + Math.ceil(Math.max(0, bytes - 44) / 32000) * 2000;
const SERVER_START_TIMEOUT = 20 * 1000;

// Parakeet loads ~670 MB before it listens: seconds on a fast PC, more on a slow disk
const SHERPA_START_TIMEOUT = 45 * 1000;

// Longer than the 10 minutes it was: a prompt after a break never waits for the model to
// load again
const SERVER_IDLE = 60 * 60 * 1000;

// on the card the loaded model holds graphics memory other programs may want; it starts again in
// under a second, hidden behind the mic press (warm)
const GPU_IDLE = 10 * 60 * 1000;

// a full card is asked again after this long; an engine that did not start stays off for the
// session
const GPU_RETRY = 5 * 60 * 1000;

// Warm servers of every service in this process, killed when it exits so no engine outlives the
// app.
const liveServers = new Set();
process.once('exit', () => {
  for (const child of liveServers)
    try {
      child.kill();
    } catch {}
});

const run = (file, args, opts = {}) =>
  new Promise(resolve => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) =>
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
  });
const rm = p => fs.promises.rm(p, { recursive: true, force: true }).catch(() => {});
const canConnect = port =>
  new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
const exists = p =>
  fs.promises.access(p).then(
    () => true,
    () => false
  );
const plain = err => String((err && err.message) || err || 'Unknown error');

// GET url → dest (via dest.part), following redirects; onBytes(received, total) per chunk. Rejects
// on HTTP errors or network failure.
function download(url, dest, onBytes, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'TechnicallyNot-voice' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (hops > 8) return reject(new Error('Too many redirects'));
        return resolve(
          download(new URL(res.headers.location, url).toString(), dest, onBytes, hops + 1)
        );
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('Download failed (server answered ' + res.statusCode + ')'));
      }
      const total = Number(res.headers['content-length']) || 0,
        part = dest + '.part',
        out = fs.createWriteStream(part);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        onBytes(received, total);
      });
      res.on('error', err => {
        out.destroy();
        reject(err);
      });
      out.on('error', reject);
      out.on('finish', () => fs.promises.rename(part, dest).then(resolve, reject));
      res.pipe(out);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Download stalled (no data for 30 s)')));
    req.on('error', reject);
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', d => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// Strip whisper's non-speech tags ([BLANK_AUDIO], (music), [inaudible], ♪ …) and fold lines into
// one prompt line. Also drop the phrases whisper invents for near-silence when they are the whole
// clip (a stock phrase, or only punctuation like "."), and collapse a sentence the decoder looped
// ("X. X.") back to one.
const PHANTOM = /^(you|thanks for watching|thank you for watching|please subscribe|bye)[.!]?$/i;

function clean(text) {
  const t = String(text || '')
    .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PHANTOM.test(t) || !/[\p{L}\p{N}]/u.test(t)
    ? ''
    : t.replace(/^(.{12,}?)(?:\s+\1)+$/, '$1');
}

// Initial prompt: biases decoding toward the names people say to their agents ("Claude", not
// "clock"; "Codex", not "code X").
const VOCAB = 'Technically Not, Claude, Codex, Cursor, Gemini, npm, Git, GitHub, terminal panel.';

// Project words the window sends with a clip (file names, agent names …): strings only, one line
// each, trimmed, ≤ 64 chars (longer ones are dropped, a cut name helps nobody), no repeats
// (case-insensitive, also against VOCAB), at most 150.
const HINT_MAX = 64,
  HINTS_MAX = 150;

function sanitizeHints(hints) {
  if (!Array.isArray(hints)) return [];
  const seen = new Set(
      VOCAB.slice(0, -1)
        .split(', ')
        .map(w => w.toLowerCase())
    ),
    out = [];
  for (const h of hints) {
    if (typeof h !== 'string') continue;
    const t = h
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = t.toLowerCase();
    if (!t || t.length > HINT_MAX || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= HINTS_MAX) break;
  }
  return out;
}

// Whisper keeps only the LAST 224 prompt tokens and drops the start, so the whole prompt stays
// under ~600 characters (file names tokenize densely, ~3 characters a token); VOCAB always comes
// first in full and hints are added in the order given until the next would not fit.
const PROMPT_MAX = 600;

function buildPrompt(hints) {
  let prompt = VOCAB;
  for (const h of sanitizeHints(hints)) {
    const next = prompt + ' ' + h + ',';
    if (next.length > PROMPT_MAX) break;
    prompt = next;
  }
  return prompt === VOCAB ? VOCAB : prompt.slice(0, -1) + '.';
}

// The hints are mostly file names, and Whisper copies the style of its prompt: after a list of
// snake_case names it can write plain speech as one more ("no bloated fake numbers" →
// "node_bloated_fake_numbers"). True when the text holds a word joined with
// "_" that is none of the hints, so nobody can have said it as a name: that clip is decoded again
// with VOCAB only (transcribeOne).
function inventedName(text, hints) {
  const known = new Set(sanitizeHints(hints).map(h => h.toLowerCase()));
  return String(text || '')
    .split(/\s+/)
    .some(w => {
      w = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      return /[\p{L}\p{N}]_+[\p{L}\p{N}]/u.test(w) && !known.has(w.toLowerCase());
    });
}

// Parakeet word hints: sherpa-onnx biases its beam search toward
// "hotwords" (--hotwords-file, modified_beam_search), read once when its server starts. Each line
// is one word or name written as the model's own tokens (fewest pieces from tokens.txt,
// sentencepiece style: "Claude" → "▁Cla ude"), since the model folder has no sentencepiece vocab to
// split them itself. Words the tokens can't spell are left out. Same words as Whisper's prompt:
// VOCAB, then the project hints of recent clips.
const HOTWORDS_MAX = 60;

function hotwordLines(tokensText, hints) {
  const tokens = new Set(
    String(tokensText || '')
      .split(/\r?\n/)
      .map(l => l.slice(0, l.lastIndexOf(' ')))
      .filter(Boolean)
  );
  const pieces = word => {
    const w = '▁' + word,
      best = [[]];
    for (let i = 1; i <= w.length; i++)
      for (let j = Math.max(0, i - 24); j < i; j++) {
        if (
          best[j] &&
          tokens.has(w.slice(j, i)) &&
          (!best[i] || best[j].length + 1 < best[i].length)
        )
          best[i] = [...best[j], w.slice(j, i)];
      }
    return best[w.length] || null;
  };
  const out = [];
  for (const phrase of [...VOCAB.slice(0, -1).split(', '), ...sanitizeHints(hints)]) {
    const parts = phrase.split(' ').filter(Boolean).map(pieces);
    if (parts.length && parts.every(Boolean)) out.push(parts.flat().join(' '));
    if (out.length >= HOTWORDS_MAX) break;
  }
  return out;
}

function isWav(buf) {
  return (
    buf.length > 44 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  );
}

// 16 kHz mono 16-bit PCM WAV → float samples in [-1, 1) for sherpa-onnx (walks the chunks to
// 'data'); null for any other format.
function wavToFloat(buf) {
  let off = 12,
    fmtOk = false;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4),
      size = buf.readUInt32LE(off + 4),
      body = off + 8;
    if (id === 'fmt ' && body + 16 <= buf.length)
      fmtOk =
        buf.readUInt16LE(body) === 1 &&
        buf.readUInt16LE(body + 2) === 1 &&
        buf.readUInt32LE(body + 4) === 16000 &&
        buf.readUInt16LE(body + 14) === 16;
    if (id === 'data') {
      if (!fmtOk) return null;
      const data = buf.subarray(body, Math.min(buf.length, body + size)),
        out = new Float32Array(data.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
      return out;
    }
    off = body + size + (size & 1);
  }
  return null;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.alloc(0);
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net
      .createServer()
      .once('error', reject)
      .listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
  });
const delay = ms => new Promise(r => setTimeout(r, ms));

// Low latency on release: greedy decoding (-bs 1) and an encoder window sized to the clip (-ac, 50
// frames per second of 16 kHz 16-bit audio) instead of whisper's padded 30 s. ~3x faster. The
// 128-frame margin and 384 floor matter: with +64 / 256 short clips came back doubled ("X. X.") and
// the vocabulary prompt misfired; 384 costs ~20 ms more per clip.
const audioCtx = bytes =>
  String(Math.min(1500, Math.max(384, Math.ceil(((bytes - 44) / 32000) * 50) + 128)));

// more than 8 measured no real gain (tools/voice-bench.js)
const threadCount = () => String(Math.max(1, Math.min(8, os.cpus().length)));

// guard (optional, desktop/process-guard.js from main.js): the warm server joins a kill-on-close
// Windows job, so it dies with the app even on a hard crash (Task Manager, power loss of the
// process), and its pid + creation time are recorded so the next app start ends one that is somehow
// still alive; a process that merely reused the pid is never touched. Without a guard (plain-node
// tools, other OSes) only a normal exit stops it.
function createVoiceService({ dir, onProgress, guard } = {}) {
  const fake = process.env.TN_VOICE_FAKE;
  const engineDir = WIN ? path.join(dir, 'engine') : BUNDLED_DIR(),
    modelsDir = path.join(dir, 'models');
  const exe = path.join(engineDir, 'whisper-cli' + EXE),
    serverExe = path.join(engineDir, SERVER_FILE),
    modelFile = name => path.join(modelsDir, 'ggml-' + name + '.bin');
  const sherpaDir = path.join(dir, 'sherpa'),
    sherpaServer = path.join(sherpaDir, SHERPA_SERVER),
    modelFolder = name => path.join(modelsDir, name);
  const engineFile = eng => (eng === 'sherpa' ? sherpaServer : exe),
    engineBytes = eng => (eng === 'sherpa' ? SHERPA.bytes : WIN ? ENGINE.bytes : 0);
  const installs = new Map(); // model name → install in flight
  let serverModel = '',
    lastError = '',
    queue = Promise.resolve();
  const verified = { whisper: false, sherpa: false },
    checking = {}; // per engine

  // the project words of the latest clip, for Parakeet's hotwords at its next server start
  let lastHints = [];
  let server = null,
    serverChild = null,
    serverBroken = false,
    startFailures = 0,
    idleTimer = null,
    upgrading = null; // server: Promise<{ child, port }>
  // Graphics card (see CUDA): card = nvidia-smi's last answer, asked at most every 30 s; gpuOff =
  // why the card is not used for now ({ reason, until }) after a failed start or a full card.
  // TN_VOICE_GPU_FAKE (tests) = 'none' or one nvidia-smi answer line.
  const cudaDir = path.join(dir || '', 'engine-cuda'),
    fakeGpu = process.env.TN_VOICE_GPU_FAKE;
  let card = null,
    cardAt = 0,
    cardCall = null,
    gpuOff = null;
  const mb = bytes => Math.round(bytes / 1048576);

  // what the warm server holds: a model, on the card or not
  const keyOf = (name, gpu) => name + (gpu ? '+gpu' : '');
  const idleFor = () => (serverModel.endsWith('+gpu') ? GPU_IDLE : SERVER_IDLE);

  function readCard(fresh) {
    if (fakeGpu != null) return Promise.resolve(fakeGpu === 'none' ? null : parseGpu(fakeGpu));
    if (!WIN) return Promise.resolve(null);
    if (!fresh && cardAt && Date.now() - cardAt < 30000) return Promise.resolve(card);
    return (cardCall ||= (async () => {
      try {
        const { err, stdout } = await run(NVIDIA_SMI, GPU_QUERY, { timeout: 5000 });
        card = err ? null : parseGpu(stdout);
        cardAt = Date.now();
        return card;
      } finally {
        cardCall = null;
      }
    })());
  }
  const cudaOk = async () =>
    (await Promise.all(CUDA_NEED.map(f => exists(path.join(cudaDir, f))))).every(Boolean);

  // Should this model run on the card: asked for (the setting), a Whisper model, a usable card, and
  // not switched off after a failure.
  async function gpuFor(name, gpu) {
    if (!gpu) return { use: false, reason: '' };
    if (engineOf(name) !== 'whisper') return { use: false, reason: GPU_NOT_PARAKEET };
    if (gpuOff && Date.now() < gpuOff.until) return { use: false, reason: gpuOff.reason };
    const v = gpuVerdict(await readCard());
    return { use: v.available, reason: v.reason };
  }
  const gpuFailed = err => {
    if (!gpuOff || Date.now() >= gpuOff.until)
      gpuOff =
        err && err.full
          ? { reason: GPU_FULL, until: Date.now() + GPU_RETRY }
          : { reason: GPU_FAILED, until: Infinity };
  };

  // For Settings › Voice: can the switch be offered, why not, and what turning it on still
  // downloads.
  async function gpuState() {
    const c = await readCard(),
      v = gpuVerdict(c);
    return {
      ...v,
      name: c ? c.name : '',
      installed: v.available && (await cudaOk()),
      sizeMB: mb(CUDA.bytes),
      ...(gpuOff && Date.now() < gpuOff.until ? { off: gpuOff.reason } : {}),
    };
  }

  const emit = payload => {
    try {
      onProgress && onProgress(payload);
    } catch {}
  };

  // ~10 progress events per second per phase, plus the final one.
  const throttled = phase => {
    let last = 0;
    return (received, total) => {
      const now = Date.now();
      if (now - last >= 100 || (total && received >= total)) {
        last = now;
        emit({ phase, received, total });
      }
    };
  };

  // A model cut short (disk full, older build that renamed before hashing) must read as "not
  // installed", not fail every clip.
  const sizeOf = async file => ((await fs.promises.stat(file).catch(() => null)) || {}).size;
  const modelOk = async name =>
    MODELS[name].files
      ? (
          await Promise.all(
            MODELS[name].files.map(
              async f => (await sizeOf(path.join(modelFolder(name), f.name))) === f.bytes
            )
          )
        ).every(Boolean)
      : (await sizeOf(modelFile(name))) === MODELS[name].bytes;

  // Shared while in flight so status/warm/transcribe arriving together spawn one --help, not three.
  function engineRuns(eng = 'whisper') {
    if (verified[eng]) return Promise.resolve(true);
    return (checking[eng] ||= (async () => {
      try {
        const file = engineFile(eng);
        if (!(await exists(file))) return false;
        const { err, stdout, stderr } = await run(file, ['--help'], {
          cwd: path.dirname(file),
          timeout: 15000,
        });

        // --help exits 0 on current builds; accept the usage text either way
        verified[eng] = !err || /usage:/i.test(stdout + stderr);
        return verified[eng];
      } finally {
        checking[eng] = null;
      }
    })());
  }
  const ready = async name => (await modelOk(name)) && (await engineRuns(engineOf(name)));

  // Download to dest.dl, and only a file whose hash matches becomes dest: a crash mid-way never
  // leaves a damaged file under the real name.
  async function fetchVerified(item, dest, phase, quiet, onBytes) {
    const tmp = dest + '.dl';
    await rm(dest);
    await rm(tmp);
    await rm(tmp + '.part');
    try {
      await download(item.url, tmp, onBytes || (quiet ? () => {} : throttled(phase)));
      if ((await sha256(tmp)) !== item.sha256)
        throw new Error(
          'The downloaded ' + phase + ' file is damaged or has changed (checksum mismatch)'
        );
      await fs.promises.rename(tmp, dest);
    } catch (err) {
      await rm(tmp);
      await rm(tmp + '.part');
      throw err;
    }
  }

  // Full install, or (onlyServer) add whisper-server.exe from the same pinned zip to an engine
  // installed before the warm server existed. macOS/Linux: the engine ships inside the app (see
  // BUNDLED_DIR), so there is nothing to fetch; only say clearly when this build lacks it.
  async function installEngine(onlyServer = false) {
    if (!WIN) {
      const runnable = f =>
        fs.promises.access(f, fs.constants.X_OK).then(
          () => true,
          () => false
        );
      if ((await runnable(exe)) && (!onlyServer || (await runnable(serverExe)))) return;
      throw new Error(
        'This build of Technically Not does not include the speech engine for ' +
          process.platform +
          ' ' +
          process.arch
      );
    }
    if ((await exists(exe)) && (!onlyServer || (await exists(serverExe)))) return;
    const zip = path.join(dir, onlyServer ? 'whisper-bin-x64-server.zip' : 'whisper-bin-x64.zip'),
      staging = path.join(dir, onlyServer ? 'engine-server.tmp' : 'engine.tmp');
    const files = onlyServer ? [SERVER_FILE] : ZIP_FILES;
    try {
      await fetchVerified(ENGINE, zip, 'engine', onlyServer);
      await rm(staging);
      await fs.promises.mkdir(staging, { recursive: true });
      const { err, stderr } = await run(
        TAR,
        ['-xf', zip, '-C', staging, ...files.map(f => ZIP_DIR + '/' + f)],
        { timeout: 120000 }
      );
      if (err)
        throw new Error('Could not unpack the speech engine: ' + (stderr.trim() || plain(err)));
      const need = path.join(staging, ZIP_DIR, files[0]);
      if (!(await exists(need)))
        throw new Error('The speech engine download did not contain ' + files[0]);
      if (onlyServer) await fs.promises.rename(need, serverExe);
      else {
        await rm(engineDir);
        await fs.promises.rename(path.join(staging, ZIP_DIR), engineDir);
      }
    } finally {
      await rm(staging);
      await rm(zip);
      await rm(zip + '.part');
    }
  }

  // Parakeet engine: the pinned sherpa-onnx archive, of which only the server and its onnxruntime
  // DLLs are kept (<dir>/sherpa).
  async function installSherpa() {
    if ((await Promise.all(SHERPA_FILES.map(f => exists(path.join(sherpaDir, f))))).every(Boolean))
      return;
    if (!WIN) throw new Error('The Parakeet speech engine is only available on Windows for now');
    const archive = path.join(dir, 'sherpa-onnx.tar.bz2'),
      staging = path.join(dir, 'sherpa.tmp');
    try {
      await fetchVerified(SHERPA, archive, 'engine');
      await rm(staging);
      await fs.promises.mkdir(staging, { recursive: true });
      const { err, stderr } = await run(
        TAR,
        ['-xf', archive, '-C', staging, ...SHERPA_FILES.map(f => SHERPA_ZIP_DIR + '/' + f)],
        { timeout: 120000 }
      );
      if (err)
        throw new Error(
          'Could not unpack the Parakeet speech engine: ' + (stderr.trim() || plain(err))
        );
      for (const f of SHERPA_FILES)
        if (!(await exists(path.join(staging, SHERPA_ZIP_DIR, f))))
          throw new Error('The Parakeet speech engine download did not contain ' + f);
      await rm(sherpaDir);
      await fs.promises.rename(path.join(staging, SHERPA_ZIP_DIR), sherpaDir);
    } finally {
      await rm(staging);
      await rm(archive);
      await rm(archive + '.part');
    }
  }

  // Graphics-card engine: the pinned CUDA zip, of which the engine, its CPU parts and the four CUDA
  // files are kept (<dir>/engine-cuda).
  async function installCuda() {
    if (await cudaOk()) return;
    const zip = path.join(dir, 'whisper-cuda.zip'),
      staging = path.join(dir, 'engine-cuda.tmp');
    try {
      await fetchVerified(CUDA, zip, 'engine');
      await rm(staging);
      await fs.promises.mkdir(staging, { recursive: true });
      const { err, stderr } = await run(
        TAR,
        ['-xf', zip, '-C', staging, ...CUDA_FILES.map(f => ZIP_DIR + '/' + f)],
        { timeout: 600000 }
      );
      if (err)
        throw new Error(
          'Could not unpack the graphics card speech engine: ' + (stderr.trim() || plain(err))
        );
      for (const f of CUDA_NEED)
        if (!(await exists(path.join(staging, ZIP_DIR, f))))
          throw new Error('The graphics card speech engine download did not contain ' + f);
      await rm(cudaDir);
      await fs.promises.rename(path.join(staging, ZIP_DIR), cudaDir);
    } finally {
      await rm(staging);
      await rm(zip);
      await rm(zip + '.part');
    }
  }

  async function installModel(name) {
    // hash was checked when it was downloaded; a wrong size (cut short) downloads it again
    if (await modelOk(name)) return;
    await fs.promises.mkdir(modelsDir, { recursive: true });
    const m = MODELS[name];
    if (!m.files) return fetchVerified(m, modelFile(name), 'model');

    // A model folder (Parakeet): fetch each missing file, one progress bar over the whole folder.
    await fs.promises.mkdir(modelFolder(name), { recursive: true });
    const tick = throttled('model');
    let done = 0;
    for (const f of m.files) {
      const dest = path.join(modelFolder(name), f.name);
      if ((await sizeOf(dest)) !== f.bytes)
        await fetchVerified(f, dest, 'model', false, received => tick(done + received, m.bytes));
      done += f.bytes;
    }
  }

  // sizeMB: what the first use of this language still has to download (engine and/or model).
  // engineInstalled lets the setup dialog say "another speech model" instead of "the speech engine"
  // when only a model is missing. gpu (the Use graphics card setting): gpu in the answer = this
  // model runs on the card; gpuReason = why not, when it was asked for; gpuInstalled = the card's
  // engine is there. With the card in use, "installed" also needs that engine, so the setup dialog
  // offers it.
  async function status(language, choice, gpu) {
    const lang = langOf(language),
      name = modelFor(lang, choice),
      engine = engineOf(name);
    const g = await gpuFor(name, gpu === true),
      gpuInfo = { gpu: g.use, ...(g.reason ? { gpuReason: g.reason } : {}) };
    if (fake)
      return {
        installed: true,
        installing: false,
        model: name,
        engine,
        choice: choiceOf(choice),
        language: lang,
        sizeMB: 0,
        engineInstalled: true,
        ...gpuInfo,
      };
    const cuda = !g.use || (await cudaOk());
    const installed = (await ready(name).catch(() => false)) && cuda;
    const engineInstalled = installed || (cuda && (await exists(engineFile(engine))));
    const sizeMB = installed
      ? 0
      : mb(
          ((await exists(engineFile(engine))) ? 0 : engineBytes(engine)) +
            (cuda ? 0 : CUDA.bytes) +
            ((await modelOk(name)) ? 0 : MODELS[name].bytes)
        );
    return {
      installed,
      installing: installs.has(keyOf(name, g.use)),
      model: name,
      engine,
      choice: choiceOf(choice),
      language: lang,
      sizeMB,
      engineInstalled,
      ...gpuInfo,
      ...(g.use ? { gpuInstalled: cuda } : {}),
      ...(lastError && !installed ? { error: lastError } : {}),
    };
  }

  async function install(language, choice, gpu) {
    if (fake) {
      emit({ phase: 'done', received: 0, total: 0 });
      return { ok: true };
    }
    const name = modelFor(langOf(language), choice);
    const onCard = (await gpuFor(name, gpu === true)).use,
      key = keyOf(name, onCard);
    if (installs.has(key)) return installs.get(key);

    // the switch was flipped mid-download: the same model file is not fetched twice at once
    const other = installs.get(keyOf(name, !onCard));
    const job = (async () => {
      try {
        if (other) await other;
        lastError = '';
        await fs.promises.mkdir(dir, { recursive: true });
        const eng = engineOf(name);
        if (!(await exists(engineFile(eng)))) verified[eng] = false;
        await (eng === 'sherpa' ? installSherpa() : installEngine());
        if (onCard) await installCuda();
        await installModel(name);

        // a check that began before the files landed would answer "not installed"
        checking[eng] = null;
        if (!(await engineRuns(eng)))
          throw new Error('The speech engine was installed but does not start on this PC');
        emit({ phase: 'done', received: 0, total: 0 });
        return { ok: true };
      } catch (err) {
        lastError = plain(err);
        emit({ phase: 'error', received: 0, total: 0, message: lastError });
        return { ok: false, error: lastError };
      } finally {
        installs.delete(key);
      }
    })();
    installs.set(key, job);
    return job;
  }

  // stopped: servers this service ended itself (a switch to another Voice model, the idle timer, a
  // hung clip). A start that ends that way did not fail: counted as a failure, two quick model
  // switches left the card switched off until the app restarted, and each later switch said "The
  // graphics card engine did not start on this PC".
  const stopped = new WeakSet();

  function stopServer() {
    clearTimeout(idleTimer);
    idleTimer = null;
    const child = serverChild;
    server = null;
    serverChild = null;
    serverModel = '';
    if (child) {
      stopped.add(child);
      liveServers.delete(child);
      try {
        child.kill();
      } catch {}
      release(child);
    }
  }
  const release = child => {
    try {
      guard && guard.end(child.pid).catch(() => {});
    } catch {}
  }; // frees its job (no-op once ended)

  // Spawn whisper-server.exe with the model loaded and wait for /health (sherpa: until its port
  // accepts connections, which it opens only after the model is loaded). Resolves { child, port };
  // rejects if it exits or never gets ready. Writes this start's hotwords file next to the models;
  // greedy search (as before) when none can be written.
  async function parakeetHotwords(folder) {
    try {
      const lines = hotwordLines(
        await fs.promises.readFile(path.join(folder, 'tokens.txt'), 'utf8'),
        lastHints
      );
      if (!lines.length) throw new Error('no hotwords');
      const file = path.join(modelsDir, 'parakeet-hotwords.txt');
      await fs.promises.writeFile(file, lines.join('\n') + '\n');
      return [
        '--decoding-method=modified_beam_search',
        '--max-active-paths=4',
        '--hotwords-file=' + file,
        '--hotwords-score=1.5',
      ];
    } catch {
      return ['--decoding-method=greedy_search'];
    }
  }

  // gpu: the CUDA build from <dir>/engine-cuda, started only with room on the card for the model;
  // its start log is read (below).
  async function startServer(name, gpu = false) {
    const port = await freePort(),
      sherpa = engineOf(name) === 'sherpa',
      folder = modelFolder(name),
      home = gpu ? cudaDir : engineDir;
    if (gpu) {
      const c = await readCard(true);
      if (!c || c.totalMB - c.usedMB < gpuNeedMB(name))
        throw Object.assign(new Error(GPU_FULL), { full: true });
    }

    // sherpa --log-file: the server appends a few lines per clip to ./log.txt by default; nothing
    // needs them, so they go nowhere.
    const child = sherpa
      ? spawn(
          sherpaServer,
          [
            '--port=' + port,
            '--tokens=' + path.join(folder, 'tokens.txt'),
            '--encoder=' + path.join(folder, 'encoder.int8.onnx'),
            '--decoder=' + path.join(folder, 'decoder.int8.onnx'),
            '--joiner=' + path.join(folder, 'joiner.int8.onnx'),
            '--num-threads=' + threadCount(),
            '--num-work-threads=1',
            '--num-io-threads=1',
            '--max-batch-size=1',
            ...(await parakeetHotwords(folder)),
            '--log-file=' + (WIN ? 'NUL' : '/dev/null'),
          ],
          { cwd: sherpaDir, windowsHide: true, stdio: 'ignore' }
        )
      : spawn(
          path.join(home, SERVER_FILE),
          [
            '-m',
            modelFile(name),
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '-t',
            threadCount(),
            '-l',
            'en',
            '-nt',
          ],
          { cwd: home, windowsHide: true, stdio: gpu ? ['ignore', 'pipe', 'pipe'] : 'ignore' }
        );
    serverChild = child;
    liveServers.add(child);

    // gpu only: the first lines the engine prints; read on and dropped afterwards so its pipes
    // never fill
    let log = '';
    if (gpu)
      for (const out of [child.stdout, child.stderr])
        out.on('data', d => {
          if (log.length < 65536) log += d;
        });
    if (guard && child.pid)
      try {
        guard.track(child.pid).catch(() => {});
      } catch {}
    let exited = false;
    child.once('error', () => {
      exited = true;
    });
    child.once('exit', () => {
      exited = true;
      liveServers.delete(child);
      release(child);
      if (serverChild === child) {
        server = null;
        serverChild = null;
      }
    });
    const deadline = Date.now() + (sherpa || gpu ? SHERPA_START_TIMEOUT : SERVER_START_TIMEOUT);
    let up = false;
    while (!exited && !up && Date.now() < deadline) {
      if (sherpa) up = await canConnect(port);
      else
        try {
          up = (
            await fetch('http://127.0.0.1:' + port + '/health', {
              signal: AbortSignal.timeout(2000),
            })
          ).ok;
        } catch {}
      if (!up) await delay(15);
    }

    // whisper.cpp quietly runs on the processor when CUDA does not come up, so its start log has to
    // say it took the card ("whisper_backend_init_gpu: using CUDA0 backend"; "… no GPU found"
    // otherwise). The lines may arrive a moment after /health answers.
    const took = /whisper_backend_init_gpu: (using \S+ backend|no GPU found)/;
    for (let i = 0; up && gpu && i < 40 && !took.test(log); i++) await delay(15);
    if (up && (!gpu || / using \S+ backend/.test((took.exec(log) || [''])[0])))
      return { child, port };
    liveServers.delete(child);
    try {
      child.kill();
    } catch {}
    release(child);
    throw Object.assign(
      new Error(
        up
          ? 'The speech engine did not take the graphics card'
          : 'The speech engine server did not start'
      ),
      { stopped: stopped.has(child) }
    );
  }

  // One start at a time (warm and a clip may both ask). A failed start is retried on the next clip;
  // after two failures (e.g. a slow start under heavy CPU load) this session stays on whisper-cli.
  // A server holds one model: switching between English and another language, or to another Voice
  // model, restarts it with the new model. On the card (gpu) a failed start is not retried: the
  // card is left alone (gpuFailed) and the clip goes to the CPU engine.
  function ensureServer(name, gpu = false) {
    const key = keyOf(name, gpu);
    if (server && serverModel !== key) stopServer();
    if (server) return server;
    serverModel = key;
    const pending = (server = startServer(name, gpu));
    pending.catch(err => {
      if (server === pending) {
        server = null;
        serverChild = null;
      }

      // ended by us for another model: neither the card nor the server failed
      if (err && err.stopped) return;
      if (gpu) gpuFailed(err);
      else if (engineOf(name) === 'whisper' && ++startFailures >= 2) serverBroken = true;
    });
    return pending;
  }

  // Server path: POST the WAV to the warm server. Returns null when the server can't be used, so
  // the caller falls back to whisper-cli. English keeps the vocabulary prompt; for other languages
  // an English prompt would pull the text toward English, so none is sent. hints: project words
  // from the window (sanitized again here), added after VOCAB for English only.
  const decodeArgs = (lang, hints) =>
    lang === 'en' ? { language: 'en', prompt: buildPrompt(hints) } : { language: lang };

  async function viaServer(buf, lang, hints, name, gpu = false) {
    if (!gpu && (serverBroken || !(await exists(serverExe)))) return null;
    let s;
    try {
      s = await ensureServer(name, gpu);
    } catch (err) {
      return err && err.stopped ? { ok: false, stopped: true } : null;
    } // stopped: this clip's start was ended for another model
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/wav' }), 'clip.wav');
    for (const [k, v] of Object.entries({
      response_format: 'text',
      beam_size: '1',
      best_of: '1',
      no_timestamps: 'true',
      temperature: '0',
      audio_ctx: audioCtx(buf.length),
      ...decodeArgs(lang, hints),
    }))
      form.append(k, v);
    try {
      const res = await fetch('http://127.0.0.1:' + s.port + '/inference', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(transcribeTimeout(buf.length)),
      });
      const body = await res.text();
      if (!res.ok)
        return {
          ok: false,
          error:
            'Transcription failed: ' +
            (body.trim().slice(0, 200) || 'engine answered ' + res.status),
        };
      return { ok: true, text: clean(body) };
    } catch (err) {
      stopServer(); // hung or crashed: the next clip starts a fresh one
      if (err && err.name === 'TimeoutError')
        return { ok: false, error: 'Transcription took too long and was stopped' };
      return null;
    }
  }

  async function viaCli(buf, lang, hints, name) {
    const { language, prompt } = decodeArgs(lang, hints);
    const wav = path.join(
      os.tmpdir(),
      'tn-voice-' + process.pid + '-' + crypto.randomBytes(6).toString('hex') + '.wav'
    );
    try {
      await fs.promises.writeFile(wav, buf);
      const { err, stdout, stderr } = await run(
        exe,
        [
          '-m',
          modelFile(name),
          '-f',
          wav,
          '-nt',
          '-np',
          '-l',
          language,
          '-t',
          threadCount(),
          '-bs',
          '1',
          '-bo',
          '1',
          '-ac',
          audioCtx(buf.length),
          ...(prompt ? ['--prompt', prompt] : []),
        ],
        { cwd: engineDir, timeout: transcribeTimeout(buf.length) }
      );
      if (err) {
        if (err.killed) return { ok: false, error: 'Transcription took too long and was stopped' };
        return {
          ok: false,
          error: 'Transcription failed: ' + (stderr.trim().split(/\r?\n/).pop() || plain(err)),
        };
      }
      return { ok: true, text: clean(stdout) };
    } finally {
      await rm(wav);
    }
  }

  // Parakeet: the sherpa-onnx offline websocket protocol. One connection per clip: int32 sample
  // rate, int32 byte count, float32 samples (sent in 64 KB messages); the server answers with one
  // JSON result ({ text, … }) and closes after "Done". No per-clip prompt: its word hints are the
  // hotwords its server started with (parakeetHotwords). There is no one-off fallback: a failed
  // start or a dropped connection answers with an error and the next clip starts a fresh server.
  async function viaSherpa(buf, name) {
    const samples = wavToFloat(buf);
    if (!samples) return { ok: false, error: 'Not a 16 kHz mono recording' };
    if (!samples.length) return { ok: true, text: '' };
    let s;
    try {
      s = await ensureServer(name);
    } catch {
      return { ok: false, error: 'The Parakeet speech engine did not start' };
    }
    const head = Buffer.alloc(8);
    head.writeInt32LE(16000, 0);
    head.writeInt32LE(samples.byteLength, 4);
    const payload = Buffer.concat([
      head,
      Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
    ]);
    try {
      const raw = await new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:' + s.port);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
        }, transcribeTimeout(buf.length));
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          for (let i = 0; i < payload.length; i += 65536) ws.send(payload.subarray(i, i + 65536));
        };
        ws.onmessage = ev => {
          clearTimeout(timer);
          resolve(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
          try {
            ws.send('Done');
            ws.close();
          } catch {}
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error('The Parakeet speech engine dropped the connection'));
        };
        ws.onclose = () => {
          clearTimeout(timer);
          reject(new Error('The Parakeet speech engine closed the connection'));
        };
      });
      let text = raw;
      try {
        const j = JSON.parse(raw);
        if (j && typeof j.text === 'string') text = j.text;
      } catch {}
      return { ok: true, text: clean(text) };
    } catch (err) {
      stopServer(); // hung or crashed: the next clip starts a fresh one
      if (err && err.name === 'TimeoutError')
        return { ok: false, error: 'Transcription took too long and was stopped' };
      return { ok: false, error: 'Transcription failed: ' + plain(err) };
    }
  }

  // gpu: the Use graphics card setting. The answer's gpu says whether the card did the work; a clip
  // the card's engine could not do is done by the CPU engine at once, and the card is then left
  // alone (gpuFailed), so a broken card costs one clip a short delay, never the words.
  async function transcribeOne(buf, lang, hints, name, gpu) {
    if (!isWav(buf)) return { ok: false, error: 'Not a WAV recording' };
    if (fake) return { ok: true, text: fake };
    if (!(await ready(name))) return { ok: false, error: 'Voice input is not installed yet' };
    clearTimeout(idleTimer);
    try {
      if (engineOf(name) === 'sherpa') return await viaSherpa(buf, name);
      let onCard = (await gpuFor(name, gpu)).use && (await cudaOk());
      const whisper = async h => {
        if (onCard) {
          const r = await viaServer(buf, lang, h, name, true);
          if (r && r.ok) return { ...r, gpu: true };
          onCard = false;
          if (!(r && r.stopped)) {
            stopServer();
            gpuFailed();

            // a start ended for another model is no card failure, and the server now starting is
            // not this clip's to stop
          }
        }
        const viaWarm = await viaServer(buf, lang, h, name),
          r = (viaWarm && !viaWarm.stopped ? viaWarm : null) || (await viaCli(buf, lang, h, name));

        // gpuNote: the card was asked for and is left alone after a failure; the window says it
        // once (70).
        return gpu && gpuOff && Date.now() < gpuOff.until ? { ...r, gpuNote: gpuOff.reason } : r;
      };
      let result = await whisper(hints);

      // The file-name hints made the model write speech as a name that is not in the project: the
      // same clip once more without them.
      if (result.ok && lang === 'en' && inventedName(result.text, hints)) {
        const again = await whisper([]);
        if (again.ok) result = again;
      }

      // Engines installed before the warm server existed lack whisper-server.exe: add it quietly
      // from the same pinned download, once.
      if (!serverBroken && !upgrading && !(await exists(serverExe)))
        upgrading = installEngine(true).catch(() => {
          serverBroken = true;
        });
      return result;
    } catch (err) {
      return { ok: false, error: 'Transcription failed: ' + plain(err) };
    } finally {
      if (server) {
        idleTimer = setTimeout(stopServer, idleFor());
        idleTimer.unref?.();
      }
    }
  }

  // One transcription at a time; a failed one never blocks the next. Every step already has its own
  // time limit; the watchdog is the last line: if a clip still hasn't finished after its server
  // try, a whisper-cli fallback and a server start, it answers with an error, stops the server (the
  // next clip starts a fresh one) and lets the queue move on. It never touches recording, which
  // lives in the window. hints: optional project words (see sanitizeHints), used in the English
  // prompt only. choice: the Voice model (CHOICES key; default fast).
  function transcribe(data, language, hints, choice, gpu) {
    const lang = langOf(language),
      buf = toBuffer(data),
      name = modelFor(lang, choice);
    if (Array.isArray(hints) && hints.length) lastHints = hints;
    const limit = 2 * transcribeTimeout(buf.length) + SERVER_START_TIMEOUT + 30 * 1000;

    // Every answer carries its timings: ms = this clip's own time in the engine, waited = time
    // spent behind earlier clips (70 keeps them).
    const asked = Date.now();
    const next = queue.then(
      () =>
        new Promise(done => {
          const began = Date.now(),
            resolve = r => done({ ...r, ms: Date.now() - began, waited: began - asked });
          const dog = setTimeout(() => {
            stopServer();
            resolve({ ok: false, error: 'Transcription took too long and was stopped' });
          }, limit);
          transcribeOne(buf, lang, hints, name, gpu === true)
            .then(resolve, err =>
              resolve({ ok: false, error: 'Transcription failed: ' + plain(err) })
            )
            .finally(() => clearTimeout(dog));
        })
    );
    queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  // Start the warm server ahead of the first clip (mic warm-up or record start) so its ~0.2 s start
  // (Parakeet: longer) hides behind the user speaking.
  async function warm(language, choice, gpu) {
    const name = modelFor(langOf(language), choice);
    const whisper = engineOf(name) === 'whisper';
    if (fake) return;
    const onCard = whisper && (await gpuFor(name, gpu === true)).use && (await cudaOk());
    if (
      (server && serverModel === keyOf(name, onCard)) ||
      (whisper && !onCard && (serverBroken || !(await exists(serverExe)))) ||
      !(await ready(name))
    )
      return;
    ensureServer(name, onCard).catch(() => {});
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopServer, idleFor());
    idleTimer.unref?.();
  }

  return { status, install, transcribe, warm, gpu: gpuState, dispose: stopServer };
}

module.exports = {
  createVoiceService,
  sanitizeHints,
  buildPrompt,
  inventedName,
  hotwordLines,
  modelFor,
  choiceOf,
  engineOf,
  wavToFloat,
  parseGpu,
  gpuVerdict,
  gpuNeedMB,
  CHOICES,
  MODELS,
  PARAKEET_LANGS,
};
