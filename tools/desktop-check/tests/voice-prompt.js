/*
 * Technically Not tools · desktop-check/tests/voice-prompt.js — Composer mic button (69
 * recorder, 70 voice prompt, desktop/voice-service.js) with a fake mic (Chromium's beep device)
 * and a fake speech engine: check.ps1 sets TN_VOICE_FAKE for this test before Electron starts.
 * Own page gets an audio-only mic, video is refused; real mouse hold → fake text inserted at
 * the caret with spacing, nothing sent; a quick tap inserts nothing and toasts; real Ctrl+Space
 * hold works; blur/route/focus changes mid-hold don't end it; Esc while listening cancels; the
 * voice key in a focused terminal (a thread's CLI screen) types the text into that session; a
 * new key picked in Settings works and the old one stops; a "new agent" voice command turns on
 * the composer's New agent; an agent's name aims the composer at it (unknown names stay plain);
 * clips carry project-word hints; transcribe IPC refuses a non-WAV; a localhost frame (Live
 * preview) is denied the mic. One PowerShell thread stands by as a send target; no agent CLI,
 * no credits.
 */
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
    setTimeout(() => {
      if (window.__tnaiInputDone[id]) {
        log.push('info input ' + id + ' timed out');
        resolve();
      }
    }, 15000);
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const G = window.TnaiAgents,
  V = window.tnaiNative?.voice;
const sends = [],
  realSend = G.send;
G.send = (paneId, text) => {
  sends.push({ paneId, text });
  return realSend.call(G, paneId, text);
};
let paneId = null,
  frame = null;

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  const p = document.getElementById('prompt'),
    btn = document.getElementById('voicePrompt'),
    toastEl = document.getElementById('toast');
  const FAKE = (
    await V.transcribe(
      new Uint8Array(window.TnVoiceRecorder._test.encodeWav(new Float32Array(1600), 16000))
    )
  )?.text;
  check(
    !!btn &&
      !btn.disabled &&
      !btn.classList.contains('tnai-inactive') &&
      btn.parentElement?.classList.contains('composebox'),
    'mic button in the composer box, enabled'
  );
  check(
    !!FAKE && (await V.status())?.installed === true,
    'fake speech engine installed, a valid WAV transcribes to ' + JSON.stringify(FAKE)
  );
  const bad = await V.transcribe(new Uint8Array([1, 2, 3, 4, 5]).buffer);
  check(
    bad?.ok === false && /not a wav/i.test(bad.error || ''),
    'transcribe IPC refuses a non-WAV buffer: ' + JSON.stringify(bad)
  );

  // Voice model setting: IPC picks the file per language + model (default unchanged: base.en /
  // base), unknown → fast; the Settings select saves it.
  const pick = async (lang, model) => (await V.status(lang, model))?.model;
  const picks = [
    await pick('en'),
    await pick('de'),
    await pick('en', 'accurate'),
    await pick('auto', 'accurate'),
    await pick('en', 'best'),
    await pick('fr', 'best'),
    await pick('en', 'bogus'),
  ];
  check(
    JSON.stringify(picks) ===
      JSON.stringify([
        'base.en',
        'base',
        'small.en',
        'small',
        'large-v3-turbo-q5_0',
        'large-v3-turbo-q5_0',
        'base.en',
      ]),
    'voice model → file (en/de fast, en/auto accurate, en/fr best, bogus): ' + picks.join(', ')
  );

  // Parakeet: its own engine (sherpa) for English and its 25 European languages; Japanese and
  // Auto-detect fall back to Whisper Accurate.
  const pk = async lang => {
    const st = await V.status(lang, 'parakeet');
    return st?.model + '/' + st?.engine;
  };
  const pks = [await pk('en'), await pk('de'), await pk('uk'), await pk('ja'), await pk('auto')];
  check(
    JSON.stringify(pks) ===
      JSON.stringify([
        'parakeet-tdt-0.6b-v3-int8/sherpa',
        'parakeet-tdt-0.6b-v3-int8/sherpa',
        'parakeet-tdt-0.6b-v3-int8/sherpa',
        'small/whisper',
        'small/whisper',
      ]),
    'Parakeet → sherpa for en/de/uk, Whisper small for ja/auto: ' + pks.join(', ')
  );
  const modelSel = document.querySelector('#tnaiVoiceModelRow select');
  const readStore = () => {
    try {
      return localStorage.getItem('tnai.voice-model.v1');
    } catch {
      return 'error';
    }
  };
  check(
    !!modelSel &&
      modelSel.value === 'fast' &&
      [...modelSel.options].map(o => o.value).join() === 'fast,accurate,best,parakeet' &&
      /141 MB/.test(modelSel.options[0].text) &&
      /\(default\)/.test(modelSel.options[0].text) &&
      /^Parakeet · 662 MB .*25 European languages, others use Accurate$/.test(
        modelSel.options[3].text
      ),
    'Settings › Voice model: Fast (default) selected, options ' +
      (modelSel ? [...modelSel.options].map(o => o.text).join(' | ') : 'missing')
  );
  if (modelSel) {
    modelSel.value = 'best';
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
    const saved = readStore();
    modelSel.value = 'fast';
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
    check(
      saved === 'best' && readStore() === 'fast',
      'Voice model choice is saved (best → ' + saved + ', back to fast → ' + readStore() + ')'
    );
    await wait(300);

    // Parakeet with a language it lacks says it falls back to Whisper; then language and model go
    // back to English / Fast.
    const lSel = document.querySelector('#tnaiVoiceLangRow select'),
      toastBox = document.getElementById('toast');
    if (lSel) {
      lSel.value = 'ja';
      lSel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(300);
    }
    modelSel.value = 'parakeet';
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
    const fellBack = await until(() => {
      const t = toastBox?.textContent || '';
      return /Parakeet does not cover Japanese, so Accurate \(Whisper\) is used/.test(t) && t;
    }, 3000);
    const savedPk = readStore();
    if (lSel) {
      lSel.value = 'en';
      lSel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(100);
    }
    modelSel.value = 'fast';
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    check(
      !!fellBack &&
        savedPk === 'parakeet' &&
        readStore() === 'fast' &&
        localStorage.getItem('tnai.voice-lang.v1') === 'en',
      'Parakeet + Japanese says it uses Accurate (Whisper): ' + JSON.stringify(fellBack)
    );
  }

  // Permissions: own page audio-only yes, video no.
  const perm = await navigator.permissions.query({ name: 'microphone' }).then(
    s => s.state,
    e => 'error ' + e.name
  );
  check(
    perm !== 'denied' && !/^error/.test(perm),
    'own page: microphone permission check allows it (' + perm + ')'
  );
  const video = await navigator.mediaDevices.getUserMedia({ video: true }).then(
    s => {
      s.getTracks().forEach(t => t.stop());
      return 'granted';
    },
    e => e.name
  );
  check(video !== 'granted', 'own page: a camera request is still refused (' + video + ')');

  paneId = (await openThread('Terminal'))?.paneId;
  await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 15000);
  check(!!paneId, 'a running PowerShell pane stands by as a send target');
  window.TnaiRoute?.('overview');
  await wait(300);

  const center = () => {
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };
  const setText = (v, caret) => {
    p.focus();
    p.value = v;
    p.setSelectionRange(caret, caret);
    p.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const resetToast = () => {
    toastEl.textContent = '';
    toastEl.classList.remove('show');
  };

  // Other windows (parallel checks, a busy PC) can take OS focus mid-test; then focus() fires no
  // focus events and the voice code keeps an old target.
  const ensureFocus = async () => {
    if (!document.hasFocus()) {
      await main('focus');
      await until(() => document.hasFocus(), 2000);
    }
    if (!document.hasFocus()) log.push('info window has no OS focus');
  };
  const idle = () =>
    until(() => btn.dataset.state === 'idle' && !window.TnVoiceRecorder.recording, 10000);

  // A hold is counted from the app's own "listening", not from the press: with the window in the
  // background the mic rests (70 restSoon) and opens again only after a cold start, and a fixed 1.2
  // s then ended before it and read as a quick tap (seen once in three runs, 2026-10-02).
  const hold = async (down, ups) => {
    const heard = until(() => btn.dataset.state === 'listening', 15000);
    await realInput([...down.slice(0, -1), { ...down[down.length - 1], wait: 30 }]);
    if (!(await heard)) log.push('info hold: never listening within 15 s of the press');
    await wait(1200);
    await realInput(ups);
  };
  const KEY_UP = [
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ];
  const keyHold = () =>
    hold([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'] }], KEY_UP);

  // 0. Ready probe: the first press after launch waits for the engine status call and a cold
  // getUserMedia (70 press()); a release before the mic opens is a quick tap by design. So hold the
  // voice key until the app's own ready signal (state "listening"), then Esc (cancel, nothing
  // inserted). Later holds find the status cached and the mic warm. Logs how long the cold start
  // took.
  await ensureFocus();
  setText('', 0);
  const t0 = performance.now(),
    ready = until(() => btn.dataset.state === 'listening', 20000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 30 }]);
  const wasReady = !!(await ready);
  log.push(
    'info first press after launch: ' +
      (wasReady
        ? 'listening after ' + Math.round(performance.now() - t0) + ' ms'
        : 'never listening in 20 s') +
      ' (' +
      Math.round(t0 / 1000) +
      ' s after page load)'
  );
  await realInput([
    { type: 'keyDown', keyCode: 'Escape', wait: 30 },
    { type: 'keyUp', keyCode: 'Escape', wait: 100 },
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await idle();
  await wait(300);
  check(
    wasReady && p.value === '',
    'ready probe: the first voice-key hold reached listening, Esc cancelled it with nothing inserted'
  );

  // 1. Pointer hold ~1.2 s with the caret mid-text → inserted at the caret with one space each
  // side, not sent.
  await ensureFocus();
  setText('fix the button', 7);
  resetToast();
  sends.length = 0;

  // Tracer for the unexplained wipe: any write during step 1 that drops the text
  // set above logs who wrote it.
  const vDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  Object.defineProperty(p, 'value', {
    configurable: true,
    get() {
      return vDesc.get.call(this);
    },
    set(v) {
      if (!String(v).includes('fix the') && vDesc.get.call(this).includes('fix the'))
        log.push(
          'info composer text dropped by: ' +
            (new Error().stack || '')
              .split('\n')
              .slice(2, 6)
              .map(s => s.trim())
              .join(' < ')
        );
      vDesc.set.call(this, v);
    },
  });
  let states = new Set();
  const obs = new MutationObserver(() => states.add(btn.dataset.state));
  obs.observe(btn, { attributes: true, attributeFilter: ['data-state'] });
  const c = center();
  await hold(
    [
      { type: 'mouseMove', x: c.x, y: c.y },
      { type: 'mouseDown', x: c.x, y: c.y },
    ],
    [{ type: 'mouseUp', x: c.x, y: c.y }]
  );
  const want1 = 'fix the ' + FAKE + ' button';
  await until(() => p.value !== 'fix the button', 8000);
  await idle();
  obs.disconnect();
  delete p.value; // tracer off: the prototype value again

  // A failure names why: a toast like "Hold the mic button while you talk" means the mic opened
  // only after the release (a slow cold start).
  check(
    states.has('listening') && states.has('transcribing'),
    'button went listening → transcribing (' +
      [...states].join(', ') +
      (toastEl.textContent ? '; toast: ' + toastEl.textContent : '') +
      ')'
  );
  check(
    p.value === want1,
    'hold inserts the text at the caret with spacing: ' + JSON.stringify(p.value)
  );
  check(
    p.selectionStart === ('fix the ' + FAKE + ' ').length - 1 && document.activeElement === p,
    'caret after the inserted text, prompt focused (' + p.selectionStart + ')'
  );
  await wait(600);
  check(
    !sends.length &&
      p.value === want1 &&
      !/fix the/.test(window.TnaiLiveTasks?.get?.(paneId)?.text || ''),
    'not sent: no pane got it, prompt kept'
  );

  // 2. Quick tap (<0.3 s) → nothing inserted, a toast.
  setText('keep me', 7);
  resetToast();
  await realInput([
    { type: 'mouseDown', x: c.x, y: c.y, wait: 120 },
    { type: 'mouseUp', x: c.x, y: c.y },
  ]);
  await until(() => toastEl.textContent, 5000);
  await idle();
  await wait(300);
  check(
    p.value === 'keep me' && /didn.t catch anything|hold the mic/i.test(toastEl.textContent),
    'quick tap inserts nothing, toast: ' + JSON.stringify(toastEl.textContent)
  );

  // 3. Ctrl+Space hold (real keys) with the caret at the end → appended with a leading space.
  setText('please', 6);
  resetToast();
  await keyHold();
  await until(() => p.value !== 'please', 8000);
  await idle();
  check(
    p.value === 'please ' + FAKE,
    'Ctrl+Space hold appends with a space: ' + JSON.stringify(p.value)
  );

  // 3-tail. A new press while the last clip's tail is still recorded (up to 0.7 s after a release)
  // is kept and starts when the mic is free: it reaches listening and its words are typed in too.
  // Before 2026-10-14 that press was dropped with no sign.
  setText('two', 3);
  await ensureFocus();
  {
    const heard = until(() => btn.dataset.state === 'listening', 15000);
    await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 30 }]);
    await heard;
    await wait(1200);

    // let go and press again at once, in one batch: the press lands in the tail
    const queuedBefore = window.TnaiVoice._queuedPresses || 0;
    const listeningAgain = until(
      () =>
        (window.TnaiVoice._queuedPresses || 0) > queuedBefore && btn.dataset.state === 'listening',
      5000
    );
    await realInput([
      { type: 'keyUp', keyCode: 'Space', modifiers: ['control'], wait: 5 },
      { type: 'keyUp', keyCode: 'Control', wait: 5 },
      { type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 30 },
    ]);
    const again = !!(await listeningAgain);
    const inTail = (window.TnaiVoice._queuedPresses || 0) === queuedBefore + 1;
    await wait(1200);
    await realInput(KEY_UP);
    await until(() => p.value === 'two ' + FAKE + ' ' + FAKE, 8000);
    await idle();
    check(
      !!inTail && again && p.value === 'two ' + FAKE + ' ' + FAKE,
      'a press during the stop tail starts once the mic is free (pressed in the tail: ' +
        !!inTail +
        ', listening again: ' +
        again +
        '): ' +
        JSON.stringify(p.value)
    );
  }

  // 3a. Text selected in the prompt → the spoken text replaces the selection, caret after it.
  setText('fix the old button please', 18);
  p.setSelectionRange(8, 18);
  resetToast();
  await keyHold();
  await until(() => p.value !== 'fix the old button please', 8000);
  await idle();
  check(
    p.value === 'fix the ' + FAKE + ' please' && p.selectionStart === ('fix the ' + FAKE).length,
    'voice replaces the selected text: ' + JSON.stringify(p.value) + ' caret ' + p.selectionStart
  );

  // 3a2. The selection collapsing mid-hold (or while transcribing) still replaces the text that was
  // selected when talking started.
  setText('fix the old button please', 18);
  p.setSelectionRange(8, 18);
  resetToast();
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
  p.setSelectionRange(25, 25);
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'], wait: 600 },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => p.value !== 'fix the old button please', 8000);
  await idle();
  check(
    p.value === 'fix the ' + FAKE + ' please',
    'voice replaces the text selected at the start, after the selection moved: ' +
      JSON.stringify(p.value)
  );

  // The ring on a text box that is the voice target (70): a solid line inside its own edge (2px in
  // the sheet; whole device pixels on screen, so about 1px at the app's 95% zoom), whatever focus
  // rules the box has.
  const ringInfo = el => {
    const cs = getComputedStyle(el);
    return cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineOffset;
  };
  const ringOk = el =>
    el.classList.contains('tnai-voice-target') &&
    /^solid [\d.]+px -[\d.]+px$/.test(ringInfo(el)) &&
    !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(el).outlineColor);

  // 3a0. Every text box takes voice: the caret in any text box, no
  // selection, puts the words there and lights that box while listening. Tried on a plain textarea
  // and input, and on real boxes of the app whose focus rules hide outlines and shadows.
  const anyBox = async (el, label, clean) => {
    const was = el.value;
    el.focus();
    try {
      el.setSelectionRange(was.length, was.length);
    } catch {}
    const before = p.value,
      on = until(() => btn.dataset.state === 'listening', 5000);
    await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
    const heardIt = !!(await on),
      lit = ringOk(el),
      info = ringInfo(el),
      composerLit = document.querySelector('.composebox').classList.contains('tnai-voice-live');
    const box = el.getBoundingClientRect(),
      inView = box.width > 0 && box.height > 0;

    // held 1.2 s in all, as the other holds: the first 0.4 s after listening starts (the start
    // tone's time) don't count as something said (70 quietStart)
    await wait(600);
    await realInput([
      { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'Control' },
    ]);
    await until(() => el.value !== was, 8000);
    await idle();
    await wait(200);
    check(
      heardIt &&
        lit &&
        !composerLit &&
        inView &&
        el.value.includes(FAKE) &&
        p.value === before &&
        !el.classList.contains('tnai-voice-target') &&
        !/^solid [\d.]+px -[\d.]+px$/.test(ringInfo(el)),
      label +
        ': words go in it, lit while listening (' +
        info +
        '), not after, composer untouched (' +
        JSON.stringify(el.value.slice(0, 40)) +
        ')'
    );
    el.value = was;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    clean?.();
  };
  {
    const t = document.createElement('textarea');
    t.value = 'note';
    document.body.appendChild(t);
    await anyBox(t, 'a plain textarea with only a caret', () => t.remove());
  }
  {
    const t = document.createElement('input');
    t.type = 'search';
    document.body.appendChild(t);
    await anyBox(t, 'a plain search input', () => t.remove());
  }
  {
    const wrap = document.createElement('div');
    wrap.className = 'terminal-input';
    const t = document.createElement('input');
    t.type = 'text';
    wrap.append(t);
    document.body.appendChild(wrap);
    await anyBox(t, 'an input inside a panel input row (07 hides its focus outline)', () =>
      wrap.remove()
    );
  }
  for (const [sel, label] of [
    ['.tn-skp-search input', 'the skill picker search'],
    ['#settingsPage input.set-input:not([type=number])', 'a Settings text field'],
    ['.fd-search input, .file-search input, #fileSearch', 'the file search box'],
  ]) {
    const real = [...document.querySelectorAll(sel)].find(
      e => e.getClientRects().length && !e.disabled && !e.readOnly
    );
    if (real) await anyBox(real, label);
    else log.push('     not on screen, not tried: ' + label);
  }
  {
    // not text: a password or number box is never a voice target; the words go to the composer as
    // before
    const t = document.createElement('input');
    t.type = 'password';
    document.body.appendChild(t);
    t.focus();
    setText('', 0);
    await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
    const marked = t.classList.contains('tnai-voice-target');
    await realInput([
      { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'Control' },
    ]);
    await until(() => p.value !== '', 8000);
    await idle();
    check(
      !marked && t.value === '' && p.value === FAKE,
      'a password box is not a voice target: the words go to the composer (' +
        JSON.stringify(p.value) +
        ')'
    );
    t.remove();
    setText('', 0);
  }
  console.log('TNAI_SHOT:voice-any-box');

  // 3a3. Any other text box with a selection gets the words there, not in the composer.
  const other = document.createElement('textarea');
  other.value = 'keep this part and that';
  document.body.appendChild(other);
  other.focus();
  other.setSelectionRange(10, 14);
  const before = p.value;
  resetToast();
  await keyHold();
  await until(() => other.value !== 'keep this part and that', 8000);
  await idle();
  check(
    other.value === 'keep this ' + FAKE + ' and that' && p.value === before,
    'voice replaces a selection in another text box: ' + JSON.stringify(other.value)
  );
  other.remove();

  // 3b. Nothing but the user ends a hold: window blur, a route change there and back, focus moving
  // to another field, a lost pointer capture mid-hold all keep it listening; the text still lands
  // in the composer it was started for.
  setText('hold on', 7);
  resetToast();
  const heard = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 500 }]);
  const wasOn = !!(await heard);
  window.dispatchEvent(new Event('blur'));
  window.TnaiRoute?.('skills');
  await wait(200);
  window.TnaiRoute?.('overview');
  document.querySelector('.terminal-pane .terminal-input input, input:not([type=hidden])')?.focus();
  btn.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
  btn.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
  await wait(500);
  const stillOn = btn.dataset.state === 'listening' && window.TnVoiceRecorder.recording;
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => p.value !== 'hold on', 8000);
  await idle();
  check(
    wasOn && stillOn && p.value === 'hold on ' + FAKE,
    'blur, route change, focus change and lost capture mid-hold keep listening; text lands in the composer: ' +
      JSON.stringify(p.value)
  );

  // 3c. Only all keys up ends a chord hold: easing off Space while Ctrl stays down keeps listening;
  // Ctrl up then ends it.
  setText('ease', 4);
  resetToast();
  const on3c = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 500 }]);
  const was3c = !!(await on3c);
  await realInput([{ type: 'keyUp', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
  const kept3c = btn.dataset.state === 'listening' && window.TnVoiceRecorder.recording;
  await realInput([{ type: 'keyUp', keyCode: 'Control' }]);
  await until(() => p.value !== 'ease', 8000);
  await idle();
  check(
    was3c && kept3c && p.value === 'ease ' + FAKE,
    'Space up with Ctrl still down keeps listening; Ctrl up ends it: ' + JSON.stringify(p.value)
  );

  // 4. Esc while listening → cancelled, nothing inserted, then releasing Space does nothing.
  setText('esc test', 8);
  resetToast();
  const listening = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 800 }]);
  const wasListening = !!(await listening);
  await realInput([
    { type: 'keyDown', keyCode: 'Escape', wait: 30 },
    { type: 'keyUp', keyCode: 'Escape', wait: 100 },
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await idle();
  await wait(1000);
  check(
    wasListening &&
      p.value === 'esc test' &&
      btn.dataset.state === 'idle' &&
      !window.TnVoiceRecorder.recording,
    'Esc while listening cancels: nothing inserted, mic released (' + JSON.stringify(p.value) + ')'
  );
  console.log('TNAI_SHOT:voice-prompt');

  // 4b. Voice into an open @N screenshot note (68): the text goes in the note, the composer box
  // doesn't light up (it isn't the target), and letting go doesn't close the note; only Enter saves
  // it.
  setText('', 0);
  window.TnaiAttachments.add([
    new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }),
  ]);
  await wait(200);
  window.TnaiShotNotes.open(1);
  const note = document.querySelector('.tnai-shot-note textarea');
  note.value = 'make it';
  note.setSelectionRange(7, 7);
  const on4b = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
  const was4b = !!(await on4b),
    boxLit = document.querySelector('.composebox').classList.contains('tnai-voice-live'),
    barsOn = getComputedStyle(document.querySelector('.tnai-voice-viz')).display === 'flex';

  // The note's own box is lit while the mic records into it (the same ring as a pane input), and
  // not after.
  const ringOf = ringInfo,
    noteLit = note.classList.contains('tnai-voice-target') && note.dataset.voice === 'listening',
    ringOn = ringOf(note);
  await (window.TnaiTest?.shot?.('voice-shot-note') ?? wait(300));
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => note.value !== 'make it', 8000);
  await idle();
  await wait(300);
  check(
    was4b &&
      noteLit &&
      /^solid [\d.]+px -[\d.]+px$/.test(ringOn) &&
      !note.classList.contains('tnai-voice-target') &&
      ringOf(note) !== ringOn,
    'voice into an open @1 note: its box is lit while listening and not after (ring ' +
      ringOn +
      ' → ' +
      ringOf(note) +
      ')'
  );
  check(
    was4b &&
      !boxLit &&
      barsOn &&
      note.isConnected &&
      note.value === 'make it ' + FAKE &&
      p.value === '',
    'voice into an open @1 note: text in the note, note stays open after release, composer untouched (' +
      JSON.stringify(note.value) +
      ')'
  );
  await realInput([
    { type: 'keyDown', keyCode: 'Enter', wait: 30 },
    { type: 'keyUp', keyCode: 'Enter' },
  ]);
  await wait(200);
  check(
    !document.querySelector('.tnai-shot-note') && window.TnaiShotNotes.notes().size === 1,
    'Enter closes the note and keeps what was said'
  );
  window.TnaiAttachments.clear();
  setText('', 0);

  // 4b2. A notification's "Something else…" reply box (51, same markup): focused, the voice key's
  // words go there, composer untouched; the bell repainting mid-dictation (a new box for the same
  // item) still gets them.
  const nbox = () => {
    const d = document.createElement('div');
    d.className = 'tnai-nitem';
    d.dataset.item = 'vp-test';
    d.dataset.where = 'bell';
    d.innerHTML =
      '<ol class="n-opts"><li class="n-other"><input type="text" value="use"></li></ol>';
    document.body.append(d);
    return d;
  };
  let nh = nbox(),
    ni = nh.querySelector('input');
  ni.focus();
  ni.setSelectionRange(3, 3);
  const on4n = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
  const was4n = !!(await on4n),
    ring4n = ringOk(ni);
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => ni.value !== 'use', 8000);
  await idle();
  await wait(200);
  check(
    was4n && ring4n && ni.value === 'use ' + FAKE && p.value === '',
    'voice into a focused notification reply box: text there, box lit while listening, composer untouched (' +
      JSON.stringify(ni.value) +
      ', lit ' +
      ring4n +
      ')'
  );
  ni.focus();
  ni.value = '';
  const on4r = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 }]);
  const was4r = !!(await on4r);
  nh.remove();
  nh = nbox();
  const ni2 = nh.querySelector('input');
  ni2.value = ''; // the bell repainted while listening
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => ni2.value !== '', 8000);
  await idle();
  await wait(200);
  check(
    was4r && ni2.value === FAKE && p.value === '',
    "notification repainted mid-dictation: the text lands in the same item's new reply box (" +
      JSON.stringify(ni2.value) +
      ')'
  );
  nh.remove();
  setText('', 0);

  // 4c. Mic hold into the composer: the whole box lights up orange and the level bars show while
  // listening.
  setText('glow', 4);
  const on4c = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 700 }]);
  await on4c;
  await wait(300);
  const lit = document.querySelector('.composebox').classList.contains('tnai-voice-live');
  console.log('TNAI_SHOT:voice-listening');
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await until(() => p.value !== 'glow', 8000);
  await idle();
  check(
    lit && !document.querySelector('.composebox').classList.contains('tnai-voice-live'),
    'composer target: box lit orange while listening, off after'
  );

  // The steps below run on the agent's own thread.
  setText('', 0);
  window.TnaiThreads.show(paneId);
  await wait(400);

  // 4d. The listening look in Dark (tokens mirrored by 32) and at the minimum window (1024×680):
  // screenshots, box and mic stay inside.
  const listenShot = async (name, text) => {
    setText(text, text.length);
    const on = until(() => btn.dataset.state === 'listening', 5000);
    await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 700 }]);
    await on;
    await wait(300);
    const box = document.querySelector('.composebox').getBoundingClientRect(),
      mic = btn.getBoundingClientRect();
    console.log('TNAI_SHOT:' + name);
    await realInput([
      { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'Control' },
    ]);
    await until(() => p.value !== text, 8000);
    await idle();
    return box.right <= innerWidth && mic.left >= box.left && mic.right <= box.right;
  };
  window.TnaiTheme.set('dark');
  await wait(300);
  const darkOk = await listenShot('voice-listening-dark', 'dark');
  window.TnaiTheme.set('light');
  await main('size', 1024, 680);
  await wait(300);
  const smallOk = await listenShot('voice-listening-1024', 'small');
  await main('size', 1440, 900);
  check(
    darkOk && smallOk,
    'listening look fits in Dark and at 1024×680 (screenshots voice-listening-dark / -1024)'
  );
  check(!sends.length, 'nothing was sent during the whole test');

  // (The voice key in a panel of the Terminal page, and a click on that panel, went with that
  // page. The voice key in the terminal a user has, a thread's CLI screen, is 4b1 below.)

  // 4b00. A page with no composer and no terminal (Settings): the words wait in the composer draft,
  // not sent.
  window.TnaiRoute?.('settings');
  await wait(400);
  document.activeElement?.blur?.();
  const hidden4 = !p.getClientRects().length,
    before4s = p.value,
    sent4s = sends.length;
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 1000 }]);
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await idle();
  await wait(300);
  check(
    !hidden4 || (p.value !== before4s && p.value.includes(FAKE) && sends.length === sent4s),
    'Settings (composer hidden ' +
      hidden4 +
      '): voice lands in the composer draft, not sent: ' +
      JSON.stringify(p.value)
  );
  p.value = before4s;
  p.dispatchEvent(new Event('input', { bubbles: true }));
  window.TnaiThreads.open();
  await wait(300);

  // (4b0, the Overview focus view's rounded box, is gone with the focus view. The voice line on the
  // thread's Terminal view is not checked here yet.)

  // 4b1. Voice key into the terminal of a thread's CLI screen, then pages switched mid-hold
  // (leaving the page parks that terminal off the page): it keeps listening, the release types
  // the text into that session, and nothing is left lit orange (the bug: the box stayed lit).
  const replayText = async () => {
    const r = await window.tnaiNative.pty.replay(paneId);
    return (
      typeof r === 'string'
        ? r
        : Object.values(r || {})
            .filter(v => typeof v === 'string')
            .join('\n')
    ).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  };
  const count = s => s.split(FAKE).length - 1,
    before4f = count(await replayText());
  window.TnaiThreads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await wait(400);

  // the terminal of the thread's CLI screen: the box that lights up while listening (70)
  const mta = await until(
    () => document.querySelector('.tnt-term-host .xterm-helper-textarea'),
    6000
  );
  const apBox = mta?.closest('.xterm') || null;
  const pasted4f = [],
    onPaste4f = e => pasted4f.push(e.clipboardData?.getData('text/plain'));
  mta?.addEventListener('paste', onPaste4f);
  await ensureFocus();
  mta?.focus();
  const on4f = until(() => btn.dataset.state === 'listening', 5000);
  await realInput([{ type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 500 }]);
  const was4f = !!(await on4f),
    lit4f = !!apBox?.classList.contains('tnai-voice-target');
  window.TnaiRoute('skills');
  await wait(300);
  window.TnaiThreads.open();
  await wait(300);
  const kept4f = btn.dataset.state === 'listening' && window.TnVoiceRecorder.recording && !!mta;
  await realInput([
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await idle();
  await wait(300);
  const stuck4f = [
    ...document.querySelectorAll('.tnai-voice-target, .composebox.tnai-voice-live'),
  ].map(el => el.className);
  const typed4f = await until(async () => count(await replayText()) > before4f, 5000);
  check(
    was4f &&
      lit4f &&
      kept4f &&
      pasted4f.join() === FAKE &&
      !!typed4f &&
      !stuck4f.length &&
      btn.dataset.state === 'idle' &&
      !window.TnVoiceRecorder.recording,
    'hold in the thread’s CLI screen, pages switched mid-hold: kept listening, release types the text into that pane, nothing left orange (listening ' +
      was4f +
      ', lit ' +
      lit4f +
      ', kept ' +
      kept4f +
      ', typed ' +
      !!typed4f +
      ', state ' +
      btn.dataset.state +
      ', recording ' +
      !!window.TnVoiceRecorder.recording +
      ', pasted ' +
      JSON.stringify(pasted4f) +
      ', stuck ' +
      JSON.stringify(stuck4f) +
      ')'
  );
  mta?.removeEventListener('paste', onPaste4f);

  // 4b2. Voice language row: English is the default, Auto-detect is offered, a pick is saved and
  // still transcribes.
  const langSel = document.querySelector('#tnaiVoiceLangRow select');
  check(
    !!langSel &&
      langSel.value === 'en' &&
      langSel.options[0].value === 'en' &&
      langSel.options[1].value === 'auto' &&
      langSel.options.length > 20,
    'Settings shows the voice language row, English default, Auto-detect second: ' +
      (langSel && langSel.options.length)
  );
  if (langSel) {
    langSel.value = 'de';
    langSel.dispatchEvent(new Event('change'));
    await wait(300);
  }
  check(localStorage.getItem('tnai.voice-lang.v1') === 'de', 'voice language German saved');
  const deRes = await window.tnaiNative.voice.transcribe(
    await (
      await fetch(
        'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQgAAAAAAAAAAAAAAA=='
      )
    ).arrayBuffer(),
    'de'
  );
  check(
    deRes?.ok && deRes.text === FAKE,
    'transcribe with a language answers: ' + JSON.stringify(deRes)
  );
  if (langSel) {
    langSel.value = 'en';
    langSel.dispatchEvent(new Event('change'));
    await wait(100);
  }

  // Voice model row at the minimum width, Light and Dark: its select stays inside the row
  // (screenshots voice-model-1024 / -dark).
  window.TnaiSettings.open('voice');
  await main('size', 1024, 680);
  await wait(300);
  const mRow = document.getElementById('tnaiVoiceModelRow');
  mRow?.scrollIntoView({ block: 'center' });
  await wait(200);
  const fits = () => {
    const r = mRow.getBoundingClientRect(),
      s = mRow.querySelector('select').getBoundingClientRect();
    return r.width > 0 && s.left >= r.left && s.right <= r.right && s.right <= innerWidth;
  };
  const fitLight = !!mRow && fits();
  await (window.TnaiTest?.shot?.('voice-model-1024') ?? wait(500));
  window.TnaiTheme.set('dark');
  await wait(300);
  const fitDark = !!mRow && fits();
  await (window.TnaiTest?.shot?.('voice-model-dark') ?? wait(500));
  window.TnaiTheme.set('light');
  await main('size', 1440, 900);
  window.TnaiRoute?.('overview');
  await wait(300);
  check(
    fitLight && fitDark,
    'Voice model row fits at 1024×680 in Light and Dark (screenshots voice-model-1024 / -dark)'
  );

  // Keep mic ready (Settings › Voice, off by default): on opens the idle mic while the app has
  // focus, off gives it back at once.
  window.TnaiSettings.open('voice');
  await wait(300);
  const readyBox = document.querySelector('#tnaiVoiceReadyRow input'),
    VR = window.TnVoiceRecorder;
  const offByDefault =
    !!readyBox && !readyBox.checked && localStorage.getItem('tnai.voice-ready.v1') !== 'on';
  readyBox?.closest('.set-row').scrollIntoView({ block: 'center' });
  readyBox?.click();
  const focusedNow = document.hasFocus(),
    opened = !!(await until(() => VR.rate > 0, 4000));
  await (window.TnaiTest?.shot?.('voice-ready-row') ?? wait(500));
  const idleOpen = VR.rate > 0 && !VR.recording && btn.dataset.state === 'idle';
  readyBox?.click();
  await wait(300);
  check(
    offByDefault &&
      (!focusedNow || (opened && idleOpen)) &&
      !VR.rate &&
      localStorage.getItem('tnai.voice-ready.v1') === 'off',
    'Keep mic ready: off by default; on opens the idle mic while the app has focus, off gives it back at once (focused ' +
      focusedNow +
      ', opened ' +
      opened +
      ', rate after off ' +
      VR.rate +
      ')'
  );

  // Use graphics card (Settings › Voice, off by default): offered only with a usable NVIDIA card.
  // The card is this PC's real one, or the line in TN_VOICE_GPU_FAKE ("none" = no card), so one run
  // proves one of the two states: offered (on is saved and reaches the engine calls) or grayed out
  // (the row says why and a click changes nothing). The row lines up with the switch rows around it
  // in both.
  const gpuRow = document.getElementById('tnaiVoiceGpuRow'),
    gpuBox = gpuRow?.querySelector('input'),
    gpuSmall = gpuRow?.querySelector('small');
  const gpuInfo = await window.tnaiNative.voice.gpu();
  gpuRow?.scrollIntoView({ block: 'center' });
  await until(() => gpuSmall && !/^Checking/.test(gpuSmall.textContent), 4000);
  const gpuText = gpuSmall?.textContent || '',
    gpuOffAtStart =
      !!gpuBox && !gpuBox.checked && localStorage.getItem('tnai.voice-gpu.v1') !== 'on';
  const edge = id => {
    const r = document.getElementById(id),
      s = r?.querySelector('.set-switch');
    return r && s
      ? [
          r.getBoundingClientRect().left,
          r.getBoundingClientRect().right,
          s.getBoundingClientRect().right,
          s.getBoundingClientRect().width,
        ].map(n => Math.round(n * 10) / 10)
      : null;
  };
  const gpuEdge = edge('tnaiVoiceGpuRow'),
    soundEdge = edge('tnaiVoiceSoundRow'),
    gpuAligned =
      !!gpuEdge && !!soundEdge && gpuEdge.every((n, i) => Math.abs(n - soundEdge[i]) <= 0.5);
  const textRight = gpuSmall ? gpuSmall.getBoundingClientRect().right : 0,
    switchLeft = gpuBox ? gpuBox.getBoundingClientRect().left : 0;
  await (window.TnaiTest?.shot?.('voice-gpu-row') ?? wait(500));
  gpuBox?.click();
  await wait(500);
  const gpuSaved = localStorage.getItem('tnai.voice-gpu.v1'),
    gpuSt = await window.tnaiNative.voice.status('en', 'fast', true),
    gpuChecked = !!gpuBox?.checked;
  if (gpuChecked) {
    gpuBox.click();
    await wait(300);
  }
  const gpuNumbers =
    'row left, right, switch right, switch width ' +
    JSON.stringify(gpuEdge) +
    ' against Voice sounds ' +
    JSON.stringify(soundEdge) +
    ', text ends ' +
    Math.round(textRight) +
    ' before the switch at ' +
    Math.round(switchLeft);
  if (gpuInfo?.available)
    check(
      gpuOffAtStart &&
        !gpuBox.disabled &&
        gpuText.includes(gpuInfo.name) &&
        gpuChecked &&
        gpuSaved === 'on' &&
        gpuSt?.gpu === true &&
        localStorage.getItem('tnai.voice-gpu.v1') === 'off' &&
        gpuAligned &&
        textRight <= switchLeft,
      'Use graphics card with a usable card (' +
        gpuInfo.name +
        '): off by default, names the card, on is saved and the engine is told, off again is saved; ' +
        gpuNumbers +
        '; text ' +
        JSON.stringify(gpuText)
    );
  else
    check(
      gpuOffAtStart &&
        !!gpuBox?.disabled &&
        !gpuChecked &&
        gpuSaved !== 'on' &&
        gpuSt?.gpu === false &&
        !!gpuInfo?.reason &&
        gpuText === gpuInfo.reason &&
        gpuAligned &&
        textRight <= switchLeft,
      'Use graphics card without a usable card: grayed out, the row says why, a click changes nothing; ' +
        gpuNumbers +
        '; text ' +
        JSON.stringify(gpuText)
    );
  window.TnaiRoute?.('overview');
  await wait(300);

  // 4c. A new voice key picked in Settings › Keyboard works; the old one no longer does.
  const row = document.getElementById('tnaiVoiceKeyRow');
  check(
    !!row && /Ctrl.*Space/.test(row.textContent),
    'Settings shows the voice key row with Ctrl+Space'
  );

  // The Keyboard section holds the three key rows in one card, each the same width with its control
  // at the same right edge (screenshot settings-keyboard).
  window.TnaiSettings.open('keyboard');
  await main('size', 1024, 768);
  await wait(300);
  const kbRows = ['tnaiShowShortcuts', 'tnaiSnapshotKeyRow', 'tnaiVoiceKeyRow']
    .map(id => document.getElementById(id)?.closest('.set-row'))
    .filter(Boolean);
  const kbBox = kbRows.map(r => {
    const a = r.getBoundingClientRect(),
      b = r.lastElementChild.getBoundingClientRect();
    return [a.left, a.right, b.right].map(n => Math.round(n * 10) / 10);
  });
  const kbFits = kbRows.every(
    r =>
      r.lastElementChild.getBoundingClientRect().right <= innerWidth &&
      r.scrollWidth <= r.clientWidth
  );
  await (window.TnaiTest?.shot?.('settings-keyboard') ?? wait(500));
  await main('size', 1440, 900);
  check(
    kbFits &&
      kbRows.length === 3 &&
      new Set(kbRows.map(r => r.parentElement)).size === 1 &&
      !!row?.closest('#settingsPanel-keyboard') &&
      !document.querySelector('#tnaiVoiceMount #tnaiVoiceKeyRow') &&
      kbBox.every(b => b[1] - b[0] > 0 && b.every((n, i) => Math.abs(n - kbBox[0][i]) <= 0.5)),
    'Settings › Keyboard: shortcut list, snapshot key and voice key in one card at 1024×768, nothing cut, same edges (row left, right, control right ' +
      JSON.stringify(kbBox) +
      ')'
  );
  window.TnaiRoute?.('overview');
  await wait(300);
  row?.querySelector('[data-act=change]').click();
  await realInput([
    { type: 'keyDown', keyCode: 'M', modifiers: ['control', 'shift'], wait: 30 },
    { type: 'keyUp', keyCode: 'M', modifiers: ['control', 'shift'] },
  ]);
  await wait(200);
  check(
    /Ctrl.*Shift.*M/.test(row?.textContent || '') &&
      JSON.parse(localStorage.getItem('tnai.voice-key.v1') || '{}').code === 'KeyM',
    'new key Ctrl+Shift+M saved: ' + localStorage.getItem('tnai.voice-key.v1')
  );
  setText('new key', 7);
  await realInput([
    { type: 'keyDown', keyCode: 'Space', modifiers: ['control'], wait: 600 },
    { type: 'keyUp', keyCode: 'Space', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'Control' },
  ]);
  await wait(600);
  check(
    btn.dataset.state === 'idle' && p.value === 'new key',
    'old key Ctrl+Space no longer starts listening'
  );
  await hold(
    [{ type: 'keyDown', keyCode: 'M', modifiers: ['control', 'shift'] }],
    [
      { type: 'keyUp', keyCode: 'M', modifiers: ['control', 'shift'] },
      { type: 'keyUp', keyCode: 'Shift', modifiers: ['control'] },
      { type: 'keyUp', keyCode: 'Control' },
    ]
  );
  await idle();
  await wait(200);
  check(
    p.value === 'new key ' + FAKE,
    'new key hold inserts into the composer: ' + JSON.stringify(p.value)
  );
  row?.querySelector('[data-act=reset]').click();
  check(!/Shift/.test(row?.textContent || ''), 'Default puts Ctrl+Space back');
  check(!sends.length, 'still nothing sent');

  // Voice command: "new agent …" is the composer's ＋ New agent: the toggle turns on for that CLI,
  // the rest goes in the prompt, nothing sent.
  const LT = window.TnaiLiveTasks;
  p.value = '';
  LT.newAgent(false);
  window.TnaiVoice._deliver('Okay, start a new Codex agent to write the readme.', {
    kind: 'composer',
  });
  check(
    LT.newAgent() === 'Codex' &&
      p.value === 'Write the readme.' &&
      document.querySelector('.tnai-new-agent')?.getAttribute('aria-pressed') === 'true' &&
      !sends.length,
    'voice "start a new Codex agent to …": New agent on for Codex, task in the prompt, not sent (' +
      JSON.stringify(p.value) +
      ', ' +
      LT.newAgent() +
      ')'
  );
  LT.newAgent(false);
  p.value = '';
  window.TnaiVoice._deliver('The new agent button looks fine.', { kind: 'composer' });
  check(
    !LT.newAgent() && p.value === 'The new agent button looks fine.',
    'a prompt that only mentions the new agent button stays a plain prompt'
  );
  p.value = '';

  // Voice: an agent's name aims the composer at it (setTarget, like "Send composer tasks here"),
  // name phrase dropped, not sent. The standby pane poses as a Claude Code agent named Quillon (no
  // CLI, no credits); unknown names and the CLI command keep today's meaning.
  const realSessions = G.sessions,
    V2 = window.TnaiVoice;
  check(
    Array.isArray(V2._lastHints),
    'transcribe got a hints array: ' + JSON.stringify((V2._lastHints || 'none').slice?.(0, 8))
  );
  G.sessions = () =>
    realSessions
      .call(G)
      .map(s => (s.paneId === paneId ? { ...s, agent: 'Claude Code', name: 'Quillon' } : s));
  try {
    check(
      V2.hints()[0] === 'Quillon',
      'hints start with the agent names: ' + JSON.stringify(V2.hints().slice(0, 8))
    );
    LT.setTarget(null);
    LT.newAgent('Codex');
    p.value = '';
    V2._deliver('Quillon, fix the scroll bug.', { kind: 'composer' });
    check(
      LT.target() === paneId &&
        p.value === 'Fix the scroll bug.' &&
        !LT.newAgent() &&
        !sends.length,
      'voice "Quillon, fix …": composer aimed at Quillon, name dropped, New agent off, not sent (' +
        JSON.stringify(p.value) +
        ')'
    );
    LT.setTarget(null);
    p.value = '';
    V2._deliver('Tell Quillon to add tests.', { kind: 'composer' });
    check(
      LT.target() === paneId && p.value === 'Add tests.',
      'voice "tell Quillon to …" aims at Quillon: ' + JSON.stringify(p.value)
    );
    LT.setTarget(null);
    p.value = '';
    V2._deliver('Zorblat, fix the scroll bug.', { kind: 'composer' });
    check(
      !LT.target() && p.value === 'Zorblat, fix the scroll bug.',
      'an unknown name stays a plain prompt: ' + JSON.stringify(p.value)
    );
    p.value = '';
    V2._deliver('Okay, start a new Codex agent to write the readme.', { kind: 'composer' });
    check(
      LT.newAgent() === 'Codex' && !LT.target() && p.value === 'Write the readme.',
      'the new-agent CLI command is unchanged with named agents around'
    );
  } finally {
    G.sessions = realSessions;
    LT.setTarget(null);
    LT.newAgent(false);
    p.value = '';
  }

  // Low-mic notice: two very quiet clips in a row put one notice in the bell with the
  // sound-settings button; a quick tap never counts; a clip at a normal level takes it away again.
  {
    const bell = window.TnaiNextActions,
      realNotify = bell.notify,
      realUn = bell.unnotify,
      seen = [];
    bell.notify = n => {
      seen.push(n);
    };
    bell.unnotify = key => {
      seen.push('un:' + key);
    };
    try {
      V2._micCheck({ seconds: 2, level: 0.1 });
      seen.length = 0;
      V2._micCheck({ seconds: 2, level: 0.004 });
      V2._micCheck({ seconds: 0.4, level: 0.001 });
      const afterOne = seen.length;
      V2._micCheck({ seconds: 2, level: 0.004 });
      const n = seen[0];
      check(
        afterOne === 0 &&
          seen.length === 1 &&
          n?.key === 'voice-low-mic' &&
          /quiet/.test(n.title) &&
          n.action?.label === 'Open sound settings' &&
          typeof window.tnaiNative.voice.micSettings === 'function',
        'two quiet clips in a row raise the low-mic notice with its button, one clip or a quick tap does not: ' +
          JSON.stringify({ afterOne, n: seen.length, title: n?.title, action: n?.action?.label })
      );
      V2._micCheck({ seconds: 2, level: 0.08 });
      check(
        seen[1] === 'un:voice-low-mic',
        'a clip at a normal level takes the notice away: ' + JSON.stringify(seen.slice(1))
      );
    } finally {
      bell.notify = realNotify;
      bell.unnotify = realUn;
    }
    check(
      (await window.tnaiNative.voice.keepOn()) === false &&
        (await window.tnaiNative.voice.keep(new Uint8Array(64), 'x')) === false &&
        window.TnVoiceRecorder.keepRaw === false,
      'test clips are not kept unless a dev copy is started with TNAI_VOICE_KEEP'
    );
  }

  // 5. A localhost page in a frame (the Live preview's kind) asking for the mic is denied.
  const url = await main('serve');
  const answer = new Promise(resolve => {
    const on = e => {
      if (e.data?.tnVoiceProbe) {
        window.removeEventListener('message', on);
        resolve(e.data);
      }
    };
    window.addEventListener('message', on);
    setTimeout(() => resolve(null), 10000);
  });
  frame = document.createElement('iframe');
  frame.allow = 'microphone';
  frame.style.cssText = 'position:fixed;width:10px;height:10px;left:-50px;top:0';
  frame.src = url;
  document.body.append(frame);
  const probe = await answer;
  check(
    probe &&
      probe.ok === false &&
      /getUserMedia=NotAllowedError/.test(probe.detail) &&
      /permissions\.query=denied/.test(probe.detail),
    'localhost frame is denied the mic: ' + (probe ? probe.detail : 'no answer')
  );
  setText('', 0);

  // A delivery that throws (a pop-out that closed mid-transcription) must not stop later
  // dictations: the button goes back to idle, the user is told once, and the next hold types its
  // words. The throw is made where the clip's timing is recorded, before the words are typed.
  await wait(400);
  await ensureFocus();
  setText('', 0);
  resetToast();
  const T = window.TnaiVoice.timings;
  T.push = () => {
    throw new Error('test throw');
  };
  await keyHold();
  const backIdle = !!(await idle());
  delete T.push;
  check(
    backIdle && p.value === '' && /Could not type the words in/.test(toastEl.textContent),
    'a delivery that throws: nothing typed, the button is back to idle, and it is said once: ' +
      JSON.stringify(toastEl.textContent) +
      ' (state ' +
      btn.dataset.state +
      ')'
  );
  await wait(600);
  await ensureFocus();
  setText('', 0);
  resetToast();
  await keyHold();
  await until(() => p.value !== '', 8000);
  await idle();
  check(
    p.value.trim() === FAKE,
    'the next dictation after it is typed in as usual: ' + JSON.stringify(p.value)
  );
  setText('', 0);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
G.send = realSend;
frame?.remove();
try {
  await main('stop');
} catch {}
if (paneId) G.stop(paneId);
await wait(300);
return { ok, log };
