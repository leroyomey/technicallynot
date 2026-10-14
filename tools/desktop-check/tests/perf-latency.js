/*
 * Technically Not tools · desktop-check/tests/perf-latency.js — How long the user waits on the
 * prompt box's key moments, in the real renderer with real OS input (sendInputEvent): (1) selecting
 * a long paragraph and deleting it (Backspace keydown → the frame after every input handler ran,
 * plus the Event Timing duration to the next paint and how many frames the box height took to
 * settle), on Threads and on All threads, and typing a key; (2) Enter → the prompt echoed by the
 * open thread's PowerShell, and a key typed in that thread's CLI screen → echoed; (3) voice: mic
 * key release → text in the box, split into stop (tail capture + resample + WAV encode) →
 * transcribe IPC (fake engine: TN_VOICE_FAKE, check.js sets it) → inserted → next frame. Prints ms
 * per step; fails only when a keystroke/delete misses ~2 frames (DELETE_BUDGET_MS) or the flow
 * breaks. No agent CLI, no credits, no load.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(20);
  }
  return null;
};
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(performance.now())));

// After the next frame's rendering steps (rAF, style/layout, ResizeObserver callbacks such as
// terminal fits, paint): a message posted from rAF runs after them.
const afterFrame = cb =>
  requestAnimationFrame(() => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => cb(performance.now());
    ch.port2.postMessage(0);
  });

// Output arriving in the window per panel (pty:data), timestamped: the renderer writes it into
// xterm at once, xterm paints it on its next frame.
const arrivals = [];
window.tnaiNative.pty.onData(({ paneId, data }) =>
  arrivals.push({ paneId, data, t: performance.now() })
);
const arrived = (id, test, from) =>
  until(() => arrivals.find(a => a.t >= from && a.paneId === id && test(a.data))?.t, 5000);
let callId = 0,
  inputSeq = 0;
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
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++inputSeq;
    (window.__tnaiInputDone ||= {})[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const G = window.TnaiAgents,
  p = document.getElementById('prompt');
const med = a => {
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.floor(s.length / 2)] || 0);
};
const max = a => Math.round(Math.max(0, ...a));
const DELETE_BUDGET_MS = 34; // two frames at 60 Hz: keydown → handlers done → next frame

// Event Timing: keydown/input/keyup durations (event → next paint), 8 ms granularity.
const timings = [];
const po = new PerformanceObserver(l => l.getEntries().forEach(e => timings.push(e)));
po.observe({ type: 'event', durationThreshold: 16, buffered: false });
const longTasks = [];
const lt = new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(e.duration)));
lt.observe({ type: 'longtask' });

let paneId = null;
try {
  await main('focus');
  paneId = (await window.TnaiTest.open('Terminal'))?.paneId;
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 15000)),
    'a PowerShell thread is running'
  );

  window.TnaiThreads.open();
  await wait(600);

  // ---- 1. delete a selected paragraph ----
  const para =
    'Please refactor the login flow so the session token is refreshed before it expires, add tests for the refresh path and the expired path, ' +
    'and keep the old behaviour for users who signed in with a key. Also check the settings page: the save button stays grey after a change. ';

  async function deletes(label, reps) {
    const del = [],
      settle = [],
      evDur = [];

    // Last listener on the window: runs after every app handler of the same event (they sit on the
    // textarea or earlier on the window).
    let mark = null;
    const onInput = () => {
      if (!mark) return;
      mark.done = performance.now();
      const m = mark;
      afterFrame(t => {
        m.frame = t;
      });
    };
    const onKey = e => {
      if (e.key === 'Backspace' && mark && !mark.down) mark.down = e.timeStamp;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('input', onInput);
    for (let r = 0; r < reps; r++) {
      p.focus();
      p.value = para.repeat(3);
      p.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(400);
      p.select();
      await nextFrame();
      const h0 = p.offsetHeight;
      mark = {};
      timings.length = 0;
      await realInput([
        { type: 'keyDown', keyCode: 'Backspace', wait: 5 },
        { type: 'keyUp', keyCode: 'Backspace', wait: 16 },
      ]);
      await until(() => mark.frame, 2000);

      // Frames until the box height stops changing (1 = it shrank in the same frame as the text
      // went).
      const hs = [p.offsetHeight];
      for (let f = 0; f < 6; f++) {
        await nextFrame();
        hs.push(p.offsetHeight);
      }
      const changed = hs.findIndex((h, i) => i && h !== hs[i - 1]);

      // What the height change sets off after the frame: terminal panels refit to the taller area
      // (pty resizes → the CLI redraws), long tasks.
      const lt0 = longTasks.length;
      await wait(500);
      const rz = await main('resizes', Math.floor(performance.timeOrigin + mark.down) - 1);
      if (r === 0)
        log.push(
          'info ' +
            label +
            ' after the delete: ' +
            rz.length +
            ' terminal resize(s)' +
            (rz.length ? ' at ' + rz.map(x => x.t + ' ms (' + x.rows + ' rows)').join(', ') : '') +
            '; long tasks in 500 ms: ' +
            longTasks.slice(lt0).map(Math.round).join(',') || 'none'
        );
      del.push(mark.frame - mark.down);
      settle.push(changed < 0 ? 0 : changed);
      const kd = timings.filter(t => t.name === 'keydown');
      if (kd.length) evDur.push(Math.max(...kd.map(t => t.duration)));
      if (r === 0)
        log.push(
          'info ' +
            label +
            ' delete: box ' +
            h0 +
            ' → ' +
            hs[0] +
            ' px in the same frame; heights after: ' +
            hs.join(',')
        );
      if (p.value !== '')
        check(false, label + ' delete ' + (r + 1) + ': the whole selection went in one keystroke');
      mark = null;
    }
    log.push(
      'info ' +
        label +
        ': delete selected paragraph (' +
        para.length * 3 +
        ' chars): keydown → frame after handlers median ' +
        med(del) +
        ' ms, max ' +
        max(del) +
        ' ms; Event Timing keydown→paint max ' +
        (evDur.length ? max(evDur) : '<16') +
        ' ms; later height changes: ' +
        settle.join(',')
    );
    check(
      med(del) <= DELETE_BUDGET_MS,
      label + ': delete lands within ' + DELETE_BUDGET_MS + ' ms (median ' + med(del) + ')'
    );
    check(
      settle.every(s => s === 0),
      label +
        ': the box height settles in the same frame as the delete (no stages): ' +
        settle.join(',')
    );

    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('input', onInput);
  }
  await deletes('threads idle', 6);

  // Three more PowerShell panels print like busy agents (a colored line every ~40 ms each, ~15 s),
  // then the same deletes on Overview and the Agents page.
  const busy = [];
  for (let i = 0; i < 3; i++) {
    const id = (await window.TnaiTest.open('Terminal'))?.paneId;
    if (await until(() => G.sessions().find(s => s.paneId === id && s.running), 15000))
      busy.push(id);
  }
  window.TnaiThreads.open();
  await wait(1200);
  const E = '$([char]27)';
  busy.forEach(id =>
    G.send(
      id,
      `$i=0; while($i -lt 380){ $i++; Write-Host "${E}[32m● Working${E}[0m ${E}[2mEdited src/app.js · step $i${E}[0m"; Start-Sleep -Milliseconds 40 }`
    )
  );
  await wait(800);
  await deletes('threads busy', 6);
  await window.TnaiTest.openAllThreads();
  await wait(800);
  await deletes('all threads busy', 6);
  window.TnaiThreads.open();
  await wait(400);
  busy.forEach(id => G.stop(id));

  // Typing: 40 real characters into a long draft.
  p.value = para;
  p.setSelectionRange(p.value.length, p.value.length);
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  const keyLat = [];
  let kmark = null;
  const onType = () => {
    if (kmark) {
      const m = kmark;
      kmark = null;
      afterFrame(t => keyLat.push(t - m));
    }
  };
  const onDown = e => {
    if (e.target === p && e.key.length === 1) kmark = e.timeStamp;
  };
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('input', onType);
  const keys = [];
  for (const ch of 'and add a changelog entry for this change') {
    const code = ch === ' ' ? 'Space' : ch.toUpperCase();
    keys.push(
      { type: 'keyDown', keyCode: code, wait: 2 },
      { type: 'char', keyCode: ch, wait: 2 },
      { type: 'keyUp', keyCode: code, wait: 40 }
    );
  }
  await realInput(keys);
  await wait(200);
  window.removeEventListener('keydown', onDown, true);
  window.removeEventListener('input', onType);
  log.push(
    'info typing (' +
      keyLat.length +
      ' keys): keydown → frame after handlers median ' +
      med(keyLat) +
      ' ms, max ' +
      max(keyLat) +
      ' ms'
  );
  check(
    med(keyLat) <= DELETE_BUDGET_MS,
    'typing lands within ' + DELETE_BUDGET_MS + ' ms (median ' + med(keyLat) + ')'
  );
  p.value = '';
  p.dispatchEvent(new Event('input', { bubbles: true }));

  // ---- 2. Enter → prompt in the thread; a key typed in its CLI screen → echoed ----
  // The prompt box stands under the open thread, and sends to that thread's agent.
  window.TnaiThreads.open();
  window.TnaiThreads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  await wait(600);
  const sendLat = [],
    sendCall = [],
    replayLat = [];
  const realSend = G.send;
  let sentAt = 0;
  G.send = (...a) => {
    sentAt = performance.now();
    return realSend.apply(G, a);
  };
  for (let r = 0; r < 4; r++) {
    const tag = 'LAT' + r + 'X' + Math.floor(Math.random() * 1e6);
    p.focus();
    p.value = 'echo ' + tag;
    p.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(300);
    let down = 0;
    const kd = e => {
      if (e.key === 'Enter' && !down) down = e.timeStamp;
    };
    window.addEventListener('keydown', kd, true);
    sentAt = 0;
    const from = performance.now(),
      shown = arrived(paneId, d => d.includes(tag.slice(-4)), from),
      inMain = Promise.resolve(0);
    await realInput([
      { type: 'keyDown', keyCode: 'Enter', wait: 5 },
      { type: 'keyUp', keyCode: 'Enter', wait: 16 },
    ]);
    const [t1, t2] = await Promise.all([shown, inMain]);
    window.removeEventListener('keydown', kd, true);
    if (r === 0 && !t1)
      log.push(
        'info first send not shown: prompt ' +
          JSON.stringify(p.value) +
          ', focus ' +
          (document.activeElement === p) +
          ', visible ' +
          !!p.offsetParent +
          ', Enter seen ' +
          !!down +
          ', send called ' +
          !!sentAt +
          ', toast ' +
          JSON.stringify(document.getElementById('toast')?.textContent || '') +
          ''
      );
    if (t1 && down) sendLat.push(t1 - down);
    if (sentAt && down) sendCall.push(sentAt - down);
    if (t2 && down) replayLat.push(t2 - down);
    await wait(700);
  }
  G.send = realSend;
  log.push(
    'info send (Enter → echo in the thread): Enter → TnaiAgents.send median ' +
      med(sendCall) +
      ' ms; → its echo reaches the window (pty:data) median ' +
      med(sendLat) +
      ' ms, max ' +
      max(sendLat) +
      ' ms'
  );
  check(sendLat.length === 4, 'every sent prompt showed in the thread (' + sendLat.length + '/4)');

  // The thread's own terminal: its CLI screen.
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  const term = await until(
    () => window.TnaiThreads.slot('main').querySelector('.tnt-term-host .xterm-helper-textarea'),
    6000
  );
  const echo = [],
    split = [];
  if (term) {
    term.focus();
    await wait(200);
    let down = 0;
    const kd = e => {
      if (!down) down = e.timeStamp;
    };
    window.addEventListener('keydown', kd, true);
    const epoch = t => performance.timeOrigin + t;
    for (const ch of 'qwertzuiop') {
      down = 0;
      const t0 = performance.now();
      const got = arrived(paneId, d => d.includes(ch), t0);
      await realInput([
        { type: 'keyDown', keyCode: ch.toUpperCase(), wait: 1 },
        { type: 'char', keyCode: ch, wait: 1 },
        { type: 'keyUp', keyCode: ch.toUpperCase(), wait: 1 },
      ]);
      const t1 = await got;
      if (!t1 || !down) continue;
      echo.push(t1 - down);
      const m = await main('trip', paneId, ch, ch, Math.floor(epoch(down)) - 1);
      if (m.write && m.out)
        split.push({
          toMain: m.write - epoch(down),
          shell: m.out - m.write,
          back: epoch(t1) - m.out,
        });
    }
    window.removeEventListener('keydown', kd, true);
    await realInput([
      { type: 'keyDown', keyCode: 'Escape', wait: 5 },
      { type: 'keyUp', keyCode: 'Escape', wait: 5 },
    ]);
  }
  const sc = k => med(split.map(x => x[k]));
  log.push(
    'info terminal typing echo (keydown → its echo reaches the window, pty:data): median ' +
      med(echo) +
      ' ms, max ' +
      max(echo) +
      ' ms (' +
      echo.length +
      ' keys); split: keydown → pty:write in main ' +
      sc('toMain') +
      ' ms, main write → echo leaves main (shell + ConPTY + 16 ms batch) ' +
      sc('shell') +
      ' ms, → window ' +
      sc('back') +
      ' ms'
  );
  check(echo.length >= 8, 'keys typed in the CLI screen echoed (' + echo.length + '/10)');

  // ---- 3. voice: release → text in the box ----
  window.TnaiThreads.open();
  await wait(500);
  const btn = document.querySelector('.tnai-voice-btn'),
    FAKE = (await window.tnaiNative.voice.status())?.installed && 'fake';
  const R = window.TnVoiceRecorder,
    realStop = R.stop;
  let stopT = null;
  R.stop = async (...a) => {
    const s = performance.now();
    const out = await realStop.apply(R, a);
    stopT = { s, e: performance.now(), bytes: out?.wav?.byteLength || 0 };
    return out;
  };
  const voice = [];
  const ready = until(() => btn.dataset.state === 'listening', 20000);
  p.focus();
  p.value = '';
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 30 }]);
  await ready; // cold start probe, cancelled
  await realInput([
    { type: 'keyDown', keyCode: 'Escape', wait: 30 },
    { type: 'keyUp', keyCode: 'Escape', wait: 100 },
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => btn.dataset.state === 'idle' && !R.recording, 10000);
  await wait(300);
  for (let r = 0; r < 4; r++) {
    p.focus();
    p.value = '';
    p.dispatchEvent(new Event('input', { bubbles: true }));
    stopT = null;
    let up = 0,
      ins = 0,
      frame = 0;
    const ku = e => {
      if (e.code === 'Space' && !up) up = e.timeStamp;
    };
    window.addEventListener('keyup', ku, true);
    const inp = () => {
      if (!ins && p.value) {
        ins = performance.now();
        afterFrame(t => {
          frame = t;
        });
      }
    };
    window.addEventListener('input', inp);
    await realInput([
      { type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 1500 },
      { type: 'keyUp', keyCode: 'Space', modifiers: ['control'], wait: 1 },
      { type: 'keyUp', keyCode: 'Control', wait: 1 },
    ]);
    await until(() => frame, 8000);
    window.removeEventListener('keyup', ku, true);
    window.removeEventListener('input', inp);
    if (up && stopT && frame)
      voice.push({
        toStop: stopT.s - up,
        stop: stopT.e - stopT.s,
        ipc: ins - stopT.e,
        paint: frame - ins,
        total: frame - up,
        kb: Math.round(stopT.bytes / 1024),
      });
    await until(() => btn.dataset.state === 'idle', 5000);
    await wait(400);
  }
  R.stop = realStop;
  const col = k => voice.map(v => v[k]);
  log.push(
    'info voice (' +
      voice.length +
      ' clips, ~1.5 s, fake engine): release → stop() called ' +
      med(col('toStop')) +
      ' ms; stop() (tail capture + resample + WAV) ' +
      med(col('stop')) +
      ' ms (max ' +
      max(col('stop')) +
      ');' +
      ' → transcribe IPC + deliver ' +
      med(col('ipc')) +
      ' ms; insert → next frame ' +
      med(col('paint')) +
      ' ms; total release → text shown median ' +
      med(col('total')) +
      ' ms, max ' +
      max(col('total')) +
      ' ms (WAV ' +
      (voice[0]?.kb || 0) +
      ' KB)'
  );
  check(!!FAKE && voice.length >= 3, 'voice clips inserted (' + voice.length + '/4)');

  // The app's own per-clip record (70 finish()): mic open, wait for the end of the last word,
  // engine time, release → text, and whether the clip sent at release was the one used.
  const tm = (window.TnaiVoice?.timings || []).slice(-4);
  log.push(
    'info voice timings kept by the app (mic context ' +
      R.rate +
      ' Hz; last ' +
      tm.length +
      '): ' +
      tm
        .map(
          t =>
            'open ' +
            t.openMs +
            ' · tail ' +
            t.tailMs +
            ' · engine ' +
            t.engineMs +
            ' · total ' +
            t.totalMs +
            ' ms' +
            (t.early ? ' · sent at release' : '')
        )
        .join(' | ')
  );
  check(
    tm.length >= 3 &&
      tm.every(
        t => typeof t.tailMs === 'number' && typeof t.engineMs === 'number' && t.totalMs >= t.tailMs
      ),
    'every clip has its timings (' + tm.length + ')'
  );

  // Resample + WAV encode alone, for a 6.6 s clip at 48 kHz (the recorded voice-bench length).
  const T = R._test,
    n = Math.round(48000 * 6.6),
    raw = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.sin(i / 20) * 0.3;
  const e0 = performance.now();
  const wav = T.encodeWav(T.resample(raw, 48000, 16000), 16000);
  const e1 = performance.now();
  const i0 = performance.now();
  await window.tnaiNative.voice.transcribe(wav.buffer || wav);
  const i1 = performance.now();
  log.push(
    'info 6.6 s clip: resample + encode ' +
      Math.round(e1 - e0) +
      ' ms; transcribe IPC round trip with the fake engine (' +
      Math.round((wav.byteLength || wav.length) / 1024) +
      ' KB) ' +
      Math.round(i1 - i0) +
      ' ms'
  );
  const h0 = performance.now();
  for (let i = 0; i < 10; i++) window.TnaiVoice?.hints?.();
  log.push(
    'info voice hints() (project words sent with each clip): ' +
      ((performance.now() - h0) / 10).toFixed(2) +
      ' ms'
  );
  log.push(
    'info long tasks during the run: ' + longTasks.length + ' (worst ' + max(longTasks) + ' ms)'
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
po.disconnect();
lt.disconnect();
try {
  if (paneId) await G.stop(paneId);
} catch {}
return { ok, log };
