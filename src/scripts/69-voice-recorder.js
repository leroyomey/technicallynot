/*
 * * Technically Not · 69-voice-recorder.js — Records the microphone while the composer's voice
 * button
 * * (70) is held: opens the mic, captures raw PCM via a ScriptProcessorNode, resamples to 16 kHz
 * * mono, and packages a 16-bit PCM WAV for the Whisper engine (agent 1) to transcribe. Buffering
 * * starts as soon as the stream is live so a quick press-and-release still captures audio; a hard
 * * 5-minute cap auto-stops buffering while keeping what was recorded. Opening the mic
 * (getUserMedia
 * * + AudioContext) is the slow part of a press (~0.1–0.5 s on Windows), so the stream stays open,
 * * not buffering, for a short while: LINGER_MS after a clip (back-to-back prompts start at once)
 * and
 * * warm(ms) before one (70 calls it on mic-button hover/focus). Nothing is buffered unless
 * * recording. The mic is released when that time runs out, and at once on cancel/error/pagehide,
 * or
 * * (idle only) a device change or the track ending; mid-recording a lost mic is reopened and the
 * * clip continues. While open and idle only the last PREROLL_S is held (in memory), so a word said
 * * with the press isn't clipped; on release TAIL_S more is captured so the last word isn't (ended
 * * early after TAIL_QUIET_S of quiet). Long prompts: take() cuts off the audio up to the latest
 * * pause mid-recording, so 70 transcribes it while the user keeps talking. Speed and pickup: the
 * audio context runs at 16 kHz, so Chromium converts the mic's rate (its
 * * own filter, off this thread) and blocks are 64 ms; the level is pushed per block; quiet is
 * * tracked through the whole hold, so a release after the last word has ended cuts the clip on the
 * * next block; peek() gives 70 the clip so far at release, to start transcribing during that wait;
 * * each clip has its quiet ends trimmed and a quiet voice raised before encoding (pack). stop()
 * also
 * * reports tailMs/tailQuiet, openMs the mic start. rest() gives the idle mic back at once (70's
 * * "Keep mic ready" setting, when the app loses focus). stop() also reports level, how loud the
 * * speech came in before it was raised (70's low-mic notice), and, with keepRaw set (a dev copy
 * * collecting test clips, tools/voice-regress.js), raw: the clip as a WAV before trimming and
 * * raising. window.TnVoiceRecorder = { supported, warm, rest, start, stop, take, peek, cancel,
 * * onLevel, recording, openMs, rate, keepRaw }
 */
(() => {
  'use strict';

  const CAP_SECONDS = 5 * 60;
  const TARGET_RATE = 16000;
  const SILENCE_PEAK = 0.02; // the recording's tail ends early once it stays below this

  // A clip counts as silent (not sent) below this peak. Was 0.02 until 2026-09-30: quiet speech (a
  // far or soft mic, peak ~0.017) was dropped though Parakeet and Whisper still read speech at a
  // peak of 0.004 (user report: Parakeet "hardly picks up my voice").
  const SILENT_CLIP_PEAK = 0.005;
  const LEVEL_SCALE = 4; // rough RMS → 0..1 perceived-level scale

  // mic kept open (not buffering) after a clip, so the next press starts instantly
  const LINGER_MS = 20000;

  // default for warm(): opened ahead of a likely press, released if none comes
  const WARM_MS = 5000;

  // while the mic is open but idle, the last 0.3 s is kept so a word said with the press isn't
  // clipped
  const PREROLL_S = 0.3;

  // on release, keep capturing this much more (people let go on the last word; it is still in the
  // audio pipeline)
  const TAIL_S = 0.4;
  const TAIL_MAX_MS = 700; // …but never wait longer than this for it

  // …and end it early once the audio has been quiet this long (faster
  // voice, the word has ended)
  const TAIL_QUIET_S = 0.15;

  // …counted from before the release too, but never before this much audio from after it has
  // arrived (what was still in flight)
  const TAIL_FLIGHT_S = 0.06;

  // Each clip before encoding (pack): quiet ends are cut (less audio to decode, fewer words
  // invented from silence) and a quiet voice is raised. All relative to the clip's own loud level
  // (95th percentile of 20 ms windows), so a noisy room is simply left alone.
  const TRIM_REL = 0.06,
    TRIM_KEEP_S = 0.25,
    TRIM_MIN_S = 0.6,
    // "speech" = 3 windows in a row above 6% of loud (a key click is shorter); 0.25 s kept around
    // it
    TRIM_RUN = 3;
  const EVEN_TARGET = 0.1,
    EVEN_MAX = 20; // loud level raised to 0.1 (about -20 dB), at most 20x; never lowered

  // Long prompts: take() hands over the audio up to the latest pause once SEG_MIN_S is buffered (70
  // transcribes it while the user keeps talking), so a release only waits for the last few seconds
  // instead of the whole prompt. With no pause by SEG_MAX_S it cuts at the quietest spot, keeping
  // each part inside Whisper's 30 s window.
  const SEG_MIN_S = 12,
    SEG_MAX_S = 25,
    SEG_FROM_S = 6,
    SEG_EDGE_S = 0.4,
    PAUSE_S = 0.3,
    WIN_S = 0.02;

  // (No AudioWorklet: Technically Not's desktop window, Electron 44 sandboxed, never finishes
  // audioWorklet.addModule; voice-prompt test.)

  // ---- pure helpers (also exported via _test, safe to require() in Node with no `window`) ----

  function resample(input, fromRate, toRate) {
    if (!input.length || fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const newLen = Math.max(1, Math.round(input.length / ratio));
    const out = new Float32Array(newLen);
    if (ratio > 1) {
      // Downsampling (48/44.1 kHz → 16 kHz): average each output sample's span (a box low-pass).
      // Picking points aliased hiss above 8 kHz into speech.
      const last = input.length - 1;
      for (let i = 0; i < newLen; i++) {
        const a = Math.min(last, Math.floor(i * ratio)),
          b = Math.min(input.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (let j = a; j < b; j++) sum += input[j];
        out[i] = sum / (b - a);
      }
      return out;
    }
    for (let i = 0; i < newLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] + (input[i1] - input[i0]) * frac;
    }
    return out;
  }

  function writeAsciiStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // samples: Float32Array in -1..1, sampleRate: target rate for the header. Mono, 16-bit PCM,
  // 44-byte header.
  function encodeWav(samples, sampleRate) {
    const numSamples = samples.length;
    const blockAlign = 2; // mono, 16-bit
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeAsciiStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAsciiStr(view, 8, 'WAVE');
    writeAsciiStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAsciiStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < numSamples; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  // RMS of each 20 ms window, and the clip's loud level.
  function windows(samples, rate) {
    const win = Math.max(1, Math.round(rate * WIN_S)),
      n = Math.floor(samples.length / win),
      rms = new Float32Array(n);
    for (let w = 0; w < n; w++) {
      let sum = 0;
      for (let i = w * win, e = i + win; i < e; i++) sum += samples[i] * samples[i];
      rms[w] = Math.sqrt(sum / win);
    }
    return {
      win,
      rms,
      loud: n ? Float32Array.from(rms).sort()[Math.min(n - 1, Math.floor(n * 0.95))] : 0,
    };
  }

  // The clip without its quiet lead-in and tail (a view of the same samples); unchanged when there
  // is nothing clearly quiet to cut.
  function trimQuiet(samples, rate) {
    const { win, rms, loud } = windows(samples, rate),
      n = rms.length,
      thr = loud * TRIM_REL;
    if (!(loud > 0) || n < TRIM_RUN) return samples;
    const run = (w, dir) => {
      for (let k = 0; k < TRIM_RUN; k++) if (!(rms[w + k * dir] > thr)) return false;
      return true;
    };
    let first = 0,
      last = n - 1;
    while (first <= n - TRIM_RUN && !run(first, 1)) first++;
    while (last >= TRIM_RUN - 1 && !run(last, -1)) last--;
    if (first > n - TRIM_RUN || last < first) return samples;
    const keep = Math.round(rate * TRIM_KEEP_S),
      from = Math.max(0, first * win - keep),
      to = Math.min(samples.length, (last + 1) * win + keep);
    return to - from < rate * TRIM_MIN_S || (from === 0 && to === samples.length)
      ? samples
      : samples.subarray(from, to);
  }

  // A quiet voice (far or soft mic) raised to a normal level; a normal or loud clip is returned as
  // it is.
  function evenVolume(samples, rate) {
    const { loud } = windows(samples, rate),
      gain = loud > 0 ? Math.min(EVEN_MAX, EVEN_TARGET / loud) : 1;
    if (!(gain > 1.05)) return samples;
    const out = new Float32Array(samples.length);

    // encodeWav clamps the odd click
    for (let i = 0; i < out.length; i++) out[i] = samples[i] * gain;
    return out;
  }

  // How loud the speech in a clip is as it came from the mic (the loud level of its trimmed part,
  // before evenVolume): about 0.05–0.2 for a normal voice near the mic, under 0.01 for one that
  // barely reaches it.
  function speechLevel(raw, rate) {
    return windows(trimQuiet(resample(raw, rate, TARGET_RATE), TARGET_RATE), TARGET_RATE).loud;
  }

  // Recorded samples at the mic context's rate → the WAV the engine gets.
  function pack(raw, rate) {
    return encodeWav(
      evenVolume(trimQuiet(resample(raw, rate, TARGET_RATE), TARGET_RATE), TARGET_RATE),
      TARGET_RATE
    );
  }

  function concatFloat32(chunks, total) {
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  // Where to cut a long clip (sample index), or 0 when it isn't time yet. Measures 20 ms windows
  // from SEG_FROM_S to SEG_EDGE_S before the end: a pause is a run of PAUSE_S of windows near the
  // clip's own noise floor (relative, so quiet mics and noisy rooms both work); the middle of the
  // latest one wins. Past SEG_MAX_S without a pause, the quietest window is used.
  function cutPoint(samples, rate) {
    const n = samples.length;
    if (!rate || n < rate * SEG_MIN_S) return 0;
    const win = Math.max(1, Math.round(rate * WIN_S)),
      from = Math.floor((rate * SEG_FROM_S) / win),
      to = Math.floor((n - rate * SEG_EDGE_S) / win);
    if (to - from < 2) return 0;
    const rms = new Float32Array(to - from);
    for (let w = from; w < to; w++) {
      let s = 0;
      for (let i = w * win, e = i + win; i < e; i++) s += samples[i] * samples[i];
      rms[w - from] = Math.sqrt(s / win);
    }
    const sorted = Float32Array.from(rms).sort(),
      floor = sorted[Math.floor(sorted.length * 0.1)],
      loud = sorted[Math.floor(sorted.length * 0.9)];
    const quiet = floor + (loud - floor) * 0.15,
      need = Math.ceil(PAUSE_S / WIN_S);
    let best = -1;
    for (let w = rms.length - 1, run = 0; w >= 0; w--) {
      run = rms[w] <= quiet ? run + 1 : 0;
      if (run >= need) {
        let s = w;
        while (s > 0 && rms[s - 1] <= quiet) s--;
        let e = w;
        while (e + 1 < rms.length && rms[e + 1] <= quiet) e++;
        best = (s + e) >> 1;
        break;
      }
    }
    if (best < 0) {
      if (n < rate * SEG_MAX_S) return 0;
      best = 0;
      for (let w = 1; w < rms.length; w++) if (rms[w] < rms[best]) best = w;
    }
    return (from + best) * win + (win >> 1);
  }

  function mkErr(code, cause) {
    const err = new Error((cause && cause.message) || code);
    err.code = code;
    return err;
  }

  function mapGetUserMediaError(e) {
    const name = e && e.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return mkErr('denied', e);
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return mkErr('no-mic', e);
    if (name === 'NotReadableError') return mkErr('busy', e);
    return mkErr('failed', e);
  }

  function supported() {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext)
    );
  }

  // ---- recording state (single in-flight recording at a time) ----
  const st = {
    recording: false,
    // audio a busy window lost in this recording (attachScriptProcessor)
    lost: { blocks: 0, ms: 0, worstGapMs: 0 },
    lastBlockAt: null,
    lastBlockWall: 0,
    startPromise: null,
    opening: null, // the in-flight openMic() promise
    gen: 0, // bumped by start()/cancel(): a stale deferred release is dropped
    lingerTimer: null,
    wantRest: false, // rest() asked while the mic was still opening
    lingerUntil: 0,
    stream: null,
    audioCtx: null,
    source: null,
    node: null, // ScriptProcessorNode
    gain: null, // its silent sink
    chunks: [],
    totalSamples: 0,
    pre: [], // idle pre-roll chunks (last PREROLL_S), handed to the next start()
    preSamples: 0,
    heldFrom: 0, // samples of chunks that are pre-roll, not part of the hold
    taken: 0, // samples already handed over by take() (counts toward the cap)
    tailNeed: 0, // samples still wanted after stop() before the clip is cut
    tailGot: 0, // samples that arrived after stop()
    tailPeak: 0, // …and their peak (below SILENCE_PEAK: nothing was said after the release)

    // quiet samples in a row up to now, through the whole hold (TAIL_QUIET_S of it ends the tail
    // early)
    quietRun: 0,
    tailDone: null, // resolves stop()'s tail wait
    openMs: 0, // how long the last start() took to have the mic live (0 when it was warm)
    nativeRate: 0,
    peak: 0,
    capped: false,
    keepRaw: false, // stop() also returns the unprocessed clip (dev copy collecting test clips)
    levelListeners: new Set(),
  };

  function handleChunk(mono) {
    if (!st.recording || st.capped) {
      // warm but not recording: only the short pre-roll is kept
      if (st.recording || !st.nativeRate) return;
      st.pre.push(mono);
      st.preSamples += mono.length;
      while (st.pre.length > 1 && st.preSamples - st.pre[0].length >= st.nativeRate * PREROLL_S)
        st.preSamples -= st.pre.shift().length;
      return;
    }
    let sumSq = 0,
      chunkPeak = 0,
      quiet = st.quietRun;
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i],
        a = Math.abs(v);
      if (a > chunkPeak) chunkPeak = a;
      quiet = a < SILENCE_PEAK ? quiet + 1 : 0;
      sumSq += v * v;
    }
    if (chunkPeak > st.peak) st.peak = chunkPeak;
    st.quietRun = quiet;

    // The level goes out with the block it was measured on (no timer in between); none during the
    // tail, the hold is over.
    if (!st.tailDone && st.levelListeners.size) {
      const lvl = Math.max(0, Math.min(1, (Math.sqrt(sumSq / mono.length) || 0) * LEVEL_SCALE));
      st.levelListeners.forEach(cb => {
        try {
          cb(lvl);
        } catch (_e) {}
      });
    }

    st.chunks.push(mono);
    st.totalSamples += mono.length;

    if (st.nativeRate && (st.totalSamples + st.taken) / st.nativeRate >= CAP_SECONDS) {
      // auto-stop buffering, keep what was recorded; mic stays open until stop()/cancel()
      st.capped = true;
    }
    if (st.tailDone) {
      st.tailGot += mono.length;
      if (chunkPeak > st.tailPeak) st.tailPeak = chunkPeak;
      if (
        (st.tailNeed -= mono.length) <= 0 ||
        st.capped ||
        (st.quietRun >= st.nativeRate * TAIL_QUIET_S && st.tailGot >= st.nativeRate * TAIL_FLIGHT_S)
      )
        endTail();
    }
  }

  function endTail() {
    const r = st.tailDone;
    st.tailDone = null;
    st.tailNeed = 0;
    if (r) r();
  }

  function clearLinger() {
    if (st.lingerTimer) {
      clearTimeout(st.lingerTimer);
      st.lingerTimer = null;
    }
    st.lingerUntil = 0;
  }

  // Release the idle mic after ms, keeping any later deadline already set.
  function lingerRelease(ms) {
    const until = Date.now() + ms;
    if (st.lingerTimer && st.lingerUntil >= until) return;
    clearLinger();
    st.lingerUntil = until;
    st.lingerTimer = setTimeout(() => {
      st.lingerTimer = null;
      st.lingerUntil = 0;
      if (!st.recording && !st.startPromise) releaseMic();
    }, ms);
  }

  function releaseMic() {
    clearLinger();
    try {
      st.node && st.node.disconnect && st.node.disconnect();
    } catch (_e) {}
    try {
      st.gain && st.gain.disconnect && st.gain.disconnect();
    } catch (_e) {}
    try {
      st.source && st.source.disconnect && st.source.disconnect();
    } catch (_e) {}
    if (st.stream) {
      try {
        st.stream.getTracks().forEach(t => t.stop());
      } catch (_e) {}
    }
    if (st.audioCtx && st.audioCtx.state !== 'closed') {
      try {
        st.audioCtx.close();
      } catch (_e) {}
    }
    st.node = null;
    st.gain = null;
    st.source = null;
    st.stream = null;
    st.audioCtx = null;
    st.pre = [];
    st.preSamples = 0;
    st.nativeRate = 0;
  }

  function resetBuffers() {
    st.chunks = [];
    st.totalSamples = 0;
    st.peak = 0;
    st.capped = false;
    st.quietRun = 0;
    st.heldFrom = 0;
    st.taken = 0;
  }

  function resetState() {
    const was = st.recording;
    st.recording = false;

    // The notification sound waits for this (03 TnaiNotify.play): it is held while the mic records,
    // so it is never recorded into a clip.
    if (was) {
      try {
        window.dispatchEvent(new Event('tnai:voice-recording-ended'));
      } catch (_e) {}
    }
    st.startPromise = null;
    resetBuffers();
    endTail(); // a cancel during stop()'s tail wait ends it now
  }

  function attachScriptProcessor() {
    // 64 ms blocks at 16 kHz (85 ms on a context that stayed at the mic's own 44.1/48 kHz): the
    // level and the end of the tail follow the voice closely, and a block is still long enough that
    // a busy window doesn't lose one.
    const bufSize = st.audioCtx.sampleRate <= 24000 ? 1024 : 4096;

    // 1 input channel: Web Audio downmixes stereo mics to mono
    const proc = st.audioCtx.createScriptProcessor(bufSize, 1, 1);
    proc.onaudioprocess = ev => {
      const input = ev.inputBuffer;

      // Audio the window was too busy to take (notices seem to garble voice
      // prompts). This callback runs on the window's own thread; when that thread is held up, the
      // browser throws blocks away and the next one arrives with a later audio time. So the loss is
      // read from the audio clock itself (the step between two blocks against one block's length),
      // not guessed from our clock; the longest wait between two blocks on our clock is kept beside
      // it. Counted only while recording; stop() hands it on as `lost`.
      const blockS = input.length / st.audioCtx.sampleRate,
        at = ev.playbackTime,
        wall = performance.now();
      if (st.recording && st.lastBlockAt !== null && blockS > 0) {
        const missed = Math.round((at - st.lastBlockAt) / blockS) - 1;
        if (missed > 0) {
          st.lost.blocks += missed;
          st.lost.ms += missed * blockS * 1000;
        }
        if (wall - st.lastBlockWall > st.lost.worstGapMs)
          st.lost.worstGapMs = wall - st.lastBlockWall;
      }
      st.lastBlockAt = at;
      st.lastBlockWall = wall;
      let mono;
      if (input.numberOfChannels > 1) {
        mono = new Float32Array(input.length);
        for (let c = 0; c < input.numberOfChannels; c++) {
          const d = input.getChannelData(c);
          for (let i = 0; i < d.length; i++) mono[i] += d[i] / input.numberOfChannels;
        }
      } else {
        mono = input.getChannelData(0).slice();
      }
      handleChunk(mono);
    };
    const sink = st.audioCtx.createGain();
    sink.gain.value = 0; // keep the graph running without audible output or echo
    st.source.connect(proc);
    proc.connect(sink);
    sink.connect(st.audioCtx.destination);
    st.node = proc;
    st.gain = sink;
  }

  const isLive = () =>
    !!(
      st.stream &&
      st.audioCtx &&
      st.audioCtx.state !== 'closed' &&
      st.node &&
      st.stream.getAudioTracks().some(t => t.readyState === 'live')
    );

  // Opens the mic and the capture graph once; reused while it stays live.
  function openMic() {
    if (isLive()) return Promise.resolve();
    if (st.opening) return st.opening;
    const p = (async () => {
      releaseMic(); // a dead stream (device unplugged) from before
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Chromium's noise suppression and echo canceller gate quiet onsets and trailing
          // syllables (clipped first/last words); the speech engine handles room noise better on
          // the raw signal. Auto gain stays on for quiet mics.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
      } catch (e) {
        throw mapGetUserMediaError(e);
      }
      st.stream = stream;

      // A 16 kHz context: Chromium converts the mic's rate with its own filter, off this thread.
      // Where that isn't possible the context runs at the mic's rate as before and resample()
      // converts the clip.
      const AC = window.AudioContext || window.webkitAudioContext;
      let failed = null;
      for (const opts of [{ sampleRate: TARGET_RATE }, undefined]) {
        try {
          st.audioCtx = new AC(opts);
          st.source = st.audioCtx.createMediaStreamSource(stream);
          st.nativeRate = st.audioCtx.sampleRate;
          attachScriptProcessor();
          failed = null;
          break;
        } catch (e) {
          failed = e;
          try {
            st.audioCtx && st.audioCtx.state !== 'closed' && st.audioCtx.close();
          } catch (_e) {}
          st.audioCtx = null;
          st.source = null;
          st.node = null;
          st.gain = null;
        }
      }
      if (failed) {
        releaseMic();
        throw mkErr('failed', failed);
      }

      // Mid-recording, a device change / suspended audio never ends the clip:
      // resume, or reopen the (new default) mic and keep going.
      const ctx = st.audioCtx;
      ctx.onstatechange = () => {
        if (st.audioCtx === ctx && st.recording && ctx.state === 'suspended')
          ctx.resume().catch(() => {});
      };
      stream.getAudioTracks().forEach(t =>
        t.addEventListener('ended', () => {
          if (st.stream !== stream) return;
          if (!st.recording && !st.startPromise) {
            releaseMic();
            return;
          }
          if (st.recording) reopen();
        })
      );
    })();
    st.opening = p;
    const done = () => {
      if (st.opening === p) st.opening = null;
    };
    p.then(done, done);
    return p;
  }

  // The recording's mic went away (unplugged, default changed): open the current one and append to
  // the same clip.
  function reopen() {
    const rate = st.nativeRate,
      g = st.gen;
    openMic().then(
      () => {
        if (g !== st.gen || !st.recording) return;
        if (st.audioCtx.state === 'suspended') st.audioCtx.resume().catch(() => {});
        st.pre = [];
        st.preSamples = 0;
        if (rate && st.nativeRate !== rate && st.totalSamples) {
          // keep one rate in the clip
          const k = st.nativeRate / rate,
            joined = resample(concatFloat32(st.chunks, st.totalSamples), rate, st.nativeRate);
          st.chunks = [joined];
          st.totalSamples = joined.length;
          st.heldFrom = Math.round(st.heldFrom * k);
        }
      },
      () => {
        // No mic left: the stream is already dead, so nothing more can be recorded. 70 ends the
        // recording on this event (stop() still returns what was recorded) and says why; without
        // it the button stayed on "Listening" over a dead stream.
        if (g !== st.gen || !st.recording) return;

        // openMic's releaseMic() cleared the rate, and stop() returns nothing without it
        st.nativeRate = rate;
        try {
          window.dispatchEvent(new Event('tnai:voice-mic-gone'));
        } catch (_e) {}
      }
    );
  }

  // Open the mic ahead of a likely press (hover/focus on the mic button); released after ms unless
  // a recording starts.
  function warm(ms = WARM_MS) {
    if (!supported() || st.recording || st.startPromise) return;
    st.wantRest = false;
    const g = st.gen;
    openMic().then(
      () => {
        if (g === st.gen && !st.recording && !st.startPromise) lingerRelease(ms);
      },
      () => {}
    );
  }

  // Give the idle mic back now, also one that is still opening. Never touches a recording or one
  // that is starting.
  function rest() {
    if (st.recording || st.startPromise) return;
    st.wantRest = true;
    const done = () => {
      if (st.wantRest && !st.recording && !st.startPromise) {
        st.wantRest = false;
        releaseMic();
      }
    };
    if (st.opening) st.opening.then(done, done);
    else done();
  }

  async function start() {
    if (st.recording || st.startPromise) throw mkErr('busy');
    if (!supported()) throw mkErr('failed');
    clearLinger();
    st.wantRest = false;
    st.gen++;

    const p = (async () => {
      const t0 = performance.now(),
        wasLive = isLive();
      try {
        await openMic();
      } catch (e) {
        releaseMic();
        resetState();
        throw e;
      }
      if (st.audioCtx.state === 'suspended') {
        try {
          await st.audioCtx.resume();
        } catch (_e) {}
      }
      resetBuffers();
      st.nativeRate = st.audioCtx.sampleRate;
      st.chunks = st.pre;
      st.totalSamples = st.heldFrom = st.preSamples; // the pre-roll leads the clip
      st.pre = [];
      st.preSamples = 0;
      st.lost = { blocks: 0, ms: 0, worstGapMs: 0 };
      st.lastBlockAt = null;
      st.recording = true;
      st.openMs = wasLive ? 0 : Math.round(performance.now() - t0);
      return true;
    })();

    st.startPromise = p;
    try {
      await p;
    } finally {
      if (st.startPromise === p) st.startPromise = null;
    }
  }

  function emptyResult() {
    return { wav: encodeWav(new Float32Array(0), TARGET_RATE), seconds: 0, silent: true };
  }

  async function stop() {
    if (st.startPromise) {
      try {
        await st.startPromise;
      } catch (_e) {
        releaseMic();
        resetState();
        return emptyResult();
      }
    }
    if (!st.recording) return emptyResult();

    // the tail below isn't part of the hold (a quick tap stays a quick tap)
    const heldAtRelease = st.totalSamples - st.heldFrom;

    // The last word is still in flight (ScriptProcessor buffer + device latency): capture a little
    // more before cutting.
    const t0 = performance.now();
    let tailQuiet = false;
    if (!st.capped && isLive() && st.audioCtx.state === 'running') {
      const g = st.gen;
      await new Promise(res => {
        st.tailNeed = Math.round(st.nativeRate * TAIL_S);
        st.tailGot = 0;
        st.tailPeak = 0;
        st.tailDone = res;
        setTimeout(() => {
          if (st.tailDone === res) endTail();
        }, TAIL_MAX_MS);
      });
      if (g !== st.gen || !st.recording) return emptyResult(); // cancelled meanwhile

      // nothing was said after the release: peek()'s clip already had every word
      tailQuiet = st.tailGot > 0 && st.tailPeak < SILENCE_PEAK;
    }

    const chunks = st.chunks,
      total = st.totalSamples,
      nativeRate = st.nativeRate,
      peak = st.peak,
      held = heldAtRelease;
    resetState();
    lingerRelease(LINGER_MS); // stays open briefly for the next press

    if (!total || !nativeRate) return emptyResult();

    const seconds = held / nativeRate; // how long it was held (the pre-roll isn't counted)
    const all = concatFloat32(chunks, total),
      wav = pack(all, nativeRate);
    const silent = peak < SILENT_CLIP_PEAK || seconds < 0.3;
    const out = {
      wav,
      seconds,
      silent,
      tailQuiet,
      tailMs: Math.round(performance.now() - t0),
      level: speechLevel(all, nativeRate),
      lost: {
        blocks: st.lost.blocks,
        ms: Math.round(st.lost.ms),
        worstGapMs: Math.round(st.lost.worstGapMs),
      },
    };
    if (st.keepRaw) out.raw = encodeWav(resample(all, nativeRate, TARGET_RATE), TARGET_RATE);
    return out;
  }

  // While recording, at the release: the clip so far as { wav, seconds, silent }, nothing changed
  // (stop() still returns the whole clip). 70 starts transcribing it during stop()'s tail wait and
  // keeps that answer when stop() says tailQuiet.
  function peek() {
    if (
      !st.recording ||
      st.startPromise ||
      st.tailDone ||
      st.capped ||
      !st.nativeRate ||
      !st.totalSamples
    )
      return null;
    const raw = concatFloat32(st.chunks, st.totalSamples);
    st.chunks = [raw]; // joined once; later chunks append after it
    const seconds = (st.totalSamples - st.heldFrom) / st.nativeRate;
    return {
      wav: pack(raw, st.nativeRate),
      seconds,
      silent: st.peak < SILENT_CLIP_PEAK || seconds < 0.3,
    };
  }

  // While recording: the audio up to the latest pause as { wav, seconds, silent } (the rest keeps
  // recording and stop() returns only what follows), or null when the clip is still short or has no
  // cut point yet. Cheap enough to call about once a second.
  function take() {
    if (!st.recording || st.startPromise || st.tailDone || !st.nativeRate) return null;
    if (st.totalSamples < st.nativeRate * SEG_MIN_S) return null;
    const raw = concatFloat32(st.chunks, st.totalSamples),
      cut = cutPoint(raw, st.nativeRate);
    st.chunks = [raw]; // joined once; later chunks append after it
    if (!cut) return null;
    const head = raw.subarray(0, cut),
      rest = raw.slice(cut);
    let peak = 0,
      restPeak = 0;
    for (let i = 0; i < head.length; i++) {
      const a = Math.abs(head[i]);
      if (a > peak) peak = a;
    }
    for (let i = 0; i < rest.length; i++) {
      const a = Math.abs(rest[i]);
      if (a > restPeak) restPeak = a;
    }
    const seconds = Math.max(0, cut - st.heldFrom) / st.nativeRate;
    st.chunks = [rest];
    st.totalSamples = rest.length;
    st.taken += cut;
    st.peak = restPeak;
    st.heldFrom = Math.max(0, st.heldFrom - cut);
    return { wav: pack(head, st.nativeRate), seconds, silent: peak < SILENT_CLIP_PEAK };
  }

  function cancel() {
    try {
      const pending = st.startPromise || st.opening;
      if (pending) {
        const g = ++st.gen,
          done = () => {
            if (g === st.gen) {
              releaseMic();
              resetState();
            }
          };
        pending.then(done, done);
        return;
      }
      releaseMic();
      resetState();
    } catch (_e) {
      /* never throws */
    }
  }

  function onLevel(cb) {
    if (typeof cb !== 'function') return () => {};
    st.levelListeners.add(cb);
    return () => st.levelListeners.delete(cb);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => cancel());

    // A new default mic: drop the idle warm stream so the next press opens the right one.
    try {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        if (!st.recording && !st.startPromise) releaseMic();
      });
    } catch (_e) {}
  }

  const api = {
    supported,
    warm,
    rest,
    start,
    stop,
    take,
    peek,
    cancel,
    onLevel,
    get recording() {
      return st.recording;
    },
    get openMs() {
      return st.openMs;
    },
    get rate() {
      return st.nativeRate;
    }, // the open mic context's sample rate (0 when closed)
    get keepRaw() {
      return !!st.keepRaw;
    },
    set keepRaw(on) {
      st.keepRaw = !!on;
    },
    _test: { encodeWav, resample, cutPoint, trimQuiet, evenVolume, pack, speechLevel },
  };

  if (typeof window !== 'undefined') window.TnVoiceRecorder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
