/*
 * Technically Not · 70-voice-prompt.js — Desktop only: hold-to-talk mic button in the composer,
 * plus a voice key that works anywhere. Hold the button (or the voice key, or Space/Enter on the
 * focused button), speak, release: the clip (69 window.TnVoiceRecorder) is transcribed on this PC
 * (tnaiNative.voice, desktop/voice-service.js) and the text is inserted at the caret, not sent, so
 * the user just presses Enter. Esc while listening cancels. Only the user ends a hold (releasing,
 * pressing the key or mic again, Esc): blur, route or focus changes never do. While listening the
 * window stays on top, and a release another window caught (a pop-up) still ends the hold at once
 * (desktop/voice-hold.js). First use opens a small setup dialog that downloads the on-device speech
 * engine. The voice key (default Ctrl+Space, Option+Space on a Mac, set in Settings › Keyboard,
 * `tnai.voice-key.v1`) is taken over in every window, terminals included. Where the text goes is
 * fixed when the key goes down: the terminal the user is in (typed into that CLI's input like a
 * paste, in any view of it: Terminal page, Agents page, Build panels, pop-outs), a pane's own input
 * box, an open @N attachment note (68) or a notification's "Something else…" reply box (51), any
 * other text box the caret is in (search boxes, rename boxes, Settings fields; not password or
 * number inputs), else the composer when it is showing, else (Terminal page) the terminal panel
 * last clicked, anywhere on the panel (its header counts; one terminal on the page needs no click),
 * else (a page with neither, like Settings) the composer's draft, with a toast saying so. The
 * target terminal's whole panel gets an orange outline and glow while it listens (dashed while
 * transcribing); a composer target lights the whole box orange, and level bars (real mic loudness)
 * plus the voice key show right of the mic. The button sits at the left of the composer box, right
 * after ＋ attach (the website's look), so it travels with the composer into
 * its pop-out window; keys are bound there too. The mic uses the same target as the voice key
 * (focused terminal, pane command box, else composer). Text selected in the target box when the
 * talking starts is replaced by what was said, even if the selection changed while it was
 * transcribed. Voice commands: saying "new agent, …", "send this to a new agent: …", "start a new
 * Codex agent to …" (or ending with "… in a new agent") is the composer's ＋ New agent (11): the
 * toggle turns on for that CLI and the rest of what was said goes in the prompt, from any target.
 * Composer hidden (Terminal page, Settings): nowhere to check it, so it is sent right away, the
 * same as New agent + Send. Saying an agent's name into the composer ("Umber, fix the scroll bug",
 * "tell Umber to …", "send this to Umber: …") aims the composer's tasks at that agent (11
 * setTarget, like its card's "Send composer tasks here") and puts the task in the prompt, not sent.
 * Each clip goes to the engine with project words as hints (hints()). At release the clip so far is
 * sent at once (69 peek()) and that answer is kept when nothing was said after the release
 * (finish()); each clip's timings are kept in window.TnaiVoice.timings. Spoken language (Settings ›
 * Voice, `tnai.voice-lang.v1`): English (default, English-only model) or Auto-detect / another
 * language, which uses the multilingual model; that model is downloaded the first time it is needed
 * (same setup dialog). Voice commands stay English. Voice model (same card, `tnai.voice-model.v1`):
 * Fast (default, base), Accurate (small), Best (large-v3-turbo) or Parakeet (NVIDIA Parakeet TDT
 * 0.6B v3 via sherpa-onnx; 25 European languages, any other language or Auto-detect uses Accurate);
 * a bigger one downloads on first use through the same setup dialog, and switching restarts the
 * warm engine with it (voice-service.js CHOICES). Mic cues: a soft rising tone when listening
 * starts, a falling one when it stops or is cancelled (Settings › Voice › Voice sounds,
 * `tnai.voice-sounds.v1`, on by default). window.TnaiVoice: keys() (for 32's shortcut list),
 * command(text) (the parse, for tests). Browser build: the button is shown grayed out and blocked
 * by 12-inactive-ui.js.
 */
(() => {
  const box = document.querySelector('.composer .composebox'),
    prompt = document.getElementById('prompt');
  if (!box || !prompt) return;
  const native = window.tnaiNative,
    recorder = window.TnVoiceRecorder;

  // ---- the voice key
  // ------------------------------------------------------------------------------------------------------------
  // A Mac defaults to Option+Space: macOS keeps Ctrl+Space for switching the input source.
  const onMac = !!window.tnaiPlatform?.mac;
  const KEY_STORE = 'tnai.voice-key.v1',
    DEFAULT_KEY = onMac
      ? { ctrl: false, shift: false, alt: true, code: 'Space' }
      : { ctrl: true, shift: false, alt: false, code: 'Space' };

  // Keys other shortcuts already own (32's list, 62, 71, Windows): refused when picking a voice
  // key.
  const RESERVED = [
    'Ctrl+K',
    'Ctrl+B',
    'Ctrl+/',
    'Ctrl+Shift+J',
    'Ctrl+Shift+Alt+S',
    'Ctrl+Shift+Alt+C',
    'Ctrl+C',
    'Ctrl+Shift+C',
    'Ctrl+V',
    'Ctrl+X',
    'Ctrl+A',
    'Ctrl+Z',
    'Ctrl+Y',
    'Ctrl+S',
    'Ctrl+W',
    'Ctrl+Enter',
    'Alt+F4',
    'F2',
    ...'1234567'.split('').map(n => 'Ctrl+' + n),
  ];
  const NAMES = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };

  // Lenient on purpose: a combination, a bare F/Insert/Pause-style key, one modifier on its own
  // (Right Ctrl), or a mouse side button.
  const MODS = {
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  };
  const MOUSE = { Mouse4: 'Mouse Back', Mouse5: 'Mouse Forward' },
    MOUSE_BUTTON = { 3: 'Mouse4', 4: 'Mouse5' };
  const isMod = k => k.code in MODS,
    isMouse = k => k.code in MOUSE;
  const keyName = code =>
    MODS[code] ||
    MOUSE[code] ||
    NAMES[code] ||
    code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
  const keyParts = k => [
    ...(k.ctrl ? ['Ctrl'] : []),
    ...(k.shift ? ['Shift'] : []),
    ...(k.alt ? [onMac ? 'Option' : 'Alt'] : []),
    keyName(k.code),
  ];
  const keyLabel = k => keyParts(k).join('+');

  // Spoken language: 'en' uses the English-only model; 'auto' or any other code uses the
  // multilingual one (voice-service.js).
  const LANG_STORE = 'tnai.voice-lang.v1';

  // Every language the Whisper base models know (Whisper's own codes; 'jw' is its code for
  // Javanese).
  const LANGS = [
    'en',
    'af',
    'am',
    'ar',
    'as',
    'az',
    'ba',
    'be',
    'bg',
    'bn',
    'bo',
    'br',
    'bs',
    'ca',
    'cs',
    'cy',
    'da',
    'de',
    'el',
    'es',
    'et',
    'eu',
    'fa',
    'fi',
    'fo',
    'fr',
    'gl',
    'gu',
    'ha',
    'haw',
    'he',
    'hi',
    'hr',
    'ht',
    'hu',
    'hy',
    'id',
    'is',
    'it',
    'ja',
    'jw',
    'ka',
    'kk',
    'km',
    'kn',
    'ko',
    'la',
    'lb',
    'ln',
    'lo',
    'lt',
    'lv',
    'mg',
    'mi',
    'mk',
    'ml',
    'mn',
    'mr',
    'ms',
    'mt',
    'my',
    'ne',
    'nl',
    'nn',
    'no',
    'oc',
    'pa',
    'pl',
    'ps',
    'pt',
    'ro',
    'ru',
    'sa',
    'sd',
    'si',
    'sk',
    'sl',
    'sn',
    'so',
    'sq',
    'sr',
    'su',
    'sv',
    'sw',
    'ta',
    'te',
    'tg',
    'th',
    'tk',
    'tl',
    'tr',
    'tt',
    'uk',
    'ur',
    'uz',
    'vi',
    'yi',
    'yo',
    'zh',
  ];
  let voiceLang = 'en';
  try {
    const v = localStorage.getItem(LANG_STORE);
    if (v === 'auto' || LANGS.includes(v)) voiceLang = v;
  } catch {}

  // Voice model: which speech model size (voice-service.js CHOICES). Sizes are the download
  // (English and multilingual files are the same size); speed measured with tools/voice-bench.js on
  // a 6.6 s clip, warm engine, 8 threads (2026-09-29): 0.16 s, 0.42 s, 1.6 s; Parakeet (its own
  // engine, sherpa-onnx; size includes that 22 MB engine) 0.25–0.32 s through the real service.
  // Later engines (cloud) join as more entries here and in CHOICES.
  const MODEL_STORE = 'tnai.voice-model.v1';
  const VOICE_MODELS = [
    ['fast', 'Fast', '141 MB · quickest'],
    ['accurate', 'Accurate', '465 MB · about 3× slower'],
    ['best', 'Best', '547 MB · about 10× slower'],
    [
      'parakeet',
      'Parakeet',
      '662 MB · about 2× slower · 25 European languages, others use Accurate',
    ],
  ];
  let voiceModel = 'fast';
  try {
    const v = localStorage.getItem(MODEL_STORE);
    if (VOICE_MODELS.some(m => m[0] === v)) voiceModel = v;
  } catch {}
  const modelName = id => (VOICE_MODELS.find(m => m[0] === id) || VOICE_MODELS[0])[1];
  const langName = code => {
    if (code === 'auto') return 'Auto-detect';
    if (code === 'jw') return 'Javanese';
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
    } catch {
      return code;
    }
  };

  // Mic on/off cues (Settings › Voice, `tnai.voice-sounds.v1`, on by default): a soft rising
  // two-note tone when the mic starts listening, a falling one when it stops (released or Esc). The
  // off cue plays after the clip is closed, so it is never recorded.
  const SOUND_STORE = 'tnai.voice-sounds.v1';
  let voiceSounds = true;
  try {
    voiceSounds = localStorage.getItem(SOUND_STORE) !== 'off';
  } catch {}

  // Keep mic ready (Settings › Voice, `tnai.voice-ready.v1`, off by default):
  // while one of the app's windows has focus the mic stays open, not recording (69
  // warm), so listening and the highlight start with the press instead of after the mic opens. The
  // system shows its mic-in-use sign for as long. Given back shortly after the app loses focus (69
  // rest), never mid-hold.
  const READY_STORE = 'tnai.voice-ready.v1',
    READY_MS = 12 * 60 * 60 * 1000;
  let micReady = false;
  try {
    micReady = localStorage.getItem(READY_STORE) === 'on';
  } catch {}

  // Use graphics card (Settings › Voice, `tnai.voice-gpu.v1`, off by default):
  // Fast, Accurate and Best run on an NVIDIA card when this PC has a usable one
  // (voice-service.js CUDA). Sent with every engine call; main decides per clip whether the card is
  // used and does the clip on the processor by itself when it can't be. The switch is grayed out,
  // with the reason, without such a card.
  const GPU_STORE = 'tnai.voice-gpu.v1';
  let voiceGpu = false;
  try {
    voiceGpu = localStorage.getItem(GPU_STORE) === 'on';
  } catch {}

  function cue(on) {
    if (!voiceSounds) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(),
        t = ctx.currentTime;
      const notes = on ? [587, 880] : [880, 587];
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          at = t + i * 0.07;
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.03, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.1);
        if (i === notes.length - 1) osc.onended = () => ctx.close();
      });
    } catch {}
  }
  let hotkey = DEFAULT_KEY;
  try {
    const v = JSON.parse(localStorage.getItem(KEY_STORE) || 'null');
    if (v && typeof v.code === 'string' && v.code)
      hotkey = { ctrl: !!v.ctrl, shift: !!v.shift, alt: !!v.alt, code: v.code };
  } catch {}

  // The chosen modifiers must be held; extra ones are forgiven unless that makes another
  // Technically Not shortcut.
  const modsOk = e =>
    (e.ctrlKey || !hotkey.ctrl) &&
    (e.shiftKey || !hotkey.shift) &&
    (e.altKey || !hotkey.alt) &&
    !e.metaKey &&
    ((e.ctrlKey === hotkey.ctrl && e.shiftKey === hotkey.shift && e.altKey === hotkey.alt) ||
      !RESERVED.includes(
        keyLabel({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code || hotkey.code })
      ));
  const isHotkey = e => !isMouse(hotkey) && e.code === hotkey.code && (isMod(hotkey) || modsOk(e));
  const endsHotkey = e =>
    e.code === hotkey.code ||
    (hotkey.ctrl && e.key === 'Control') ||
    (hotkey.shift && e.key === 'Shift') ||
    (hotkey.alt && e.key === 'Alt');

  // A chord ends only once ALL its keys are up: easing off Space while Ctrl is still down (or the
  // reverse) keeps listening.
  let mainDown = false; // the chord's main key (Space in Ctrl+Space) is down
  const modsHeld = e =>
    (hotkey.ctrl && e.ctrlKey) || (hotkey.shift && e.shiftKey) || (hotkey.alt && e.altKey);

  // Proof from any key or mouse event that the held voice key is already up (its keyup went
  // elsewhere: another window, a closed pop-out). Never guessed: without proof the mic keeps
  // listening (nothing but the user ends a voice hold).
  const MOUSE_MASK = { Mouse4: 8, Mouse5: 16 },
    MOD_FLAG = { Control: 'ctrlKey', Shift: 'shiftKey', Alt: 'altKey' };
  const hotkeyUp = e => {
    if (typeof e.ctrlKey !== 'boolean') return false;
    if (isMouse(hotkey))
      return typeof e.buttons === 'number' && !(e.buttons & MOUSE_MASK[hotkey.code]);
    if (isMod(hotkey)) return !e[MOD_FLAG[hotkey.code.replace(/Left|Right/, '')]];
    return !mainDown && !modsHeld(e);
  };
  const tip = () => 'Hold to talk (' + keyLabel(hotkey) + '). Release to paste what you said.';

  // ---- voice commands: "new agent" = the composer's ＋ New agent (11)
  // --------------------------------------------------------------- Only as the opening or the
  // closing words, and a bare "new agent" opening needs a pause or a joining word after it, so "new
  // agent button is broken" stays a plain prompt. Returns { text, newAgent: '' | CLI name }.
  const src = re => re.source;
  const CLI = src(/(?:(?<cli>claude(?:\s+code)?|codex|codecs|cursor|open\s?code)\s+)?agent/),
    OPEN = src(/^(?:(?:ok(?:ay)?|hey|please)[,\s]+)*/);
  const NEW = src(/(?:a\s+)?(?:brand[\s-]+)?new\s+/) + CLI,
    HAND = src(
      /(?:send|give|route|hand|pass|assign)\s+(?:this|it|that|the\s+following)(?:\s+(?:task|prompt))?\s+(?:over\s+)?to\s+/
    );
  const JOIN = src(
    /(?:\s+for\s+(?:this|it)\s*[,:;.!?-]*\s*|\s*[,:;.!?-]+\s*|\s+(?:to|and|that|which|who|for|so\s+it)\s+|\s*$)/
  );
  const LEADS = [
    new RegExp(OPEN + HAND + NEW + '(?:' + JOIN + '|\s+)', 'i'),
    new RegExp(
      OPEN + src(/(?:(?:start|spin\s+up|open|launch|create|use|get|with)\s+)?/) + NEW + JOIN,
      'i'
    ),
  ];
  const TAILS = [
    new RegExp(src(/[\s,;.-]*(?:and\s+)?/) + HAND + NEW + '[.!]*$', 'i'),
    new RegExp(src(/[\s,;-]*(?:with|in|using)\s+/) + NEW + '[.!]*$', 'i'),
    new RegExp(src(/(?<end>[.!?])\s*/) + NEW + '[.!]*$', 'i'),
  ];
  const CLI_OF = w =>
    /^cod/i.test(w || '')
      ? 'Codex'
      : /^cursor/i.test(w || '')
        ? 'Cursor Agent'
        : /^open/i.test(w || '')
          ? 'OpenCode'
          : 'Claude Code';

  function command(text) {
    const said = String(text || '').trim();
    for (const re of LEADS) {
      const m = said.match(re);
      if (m) return { text: tidy(said.slice(m[0].length)), newAgent: CLI_OF(m.groups.cli) };
    }
    for (const re of TAILS) {
      const m = said.match(re);
      if (m && m.index > 0)
        return {
          text: tidy(said.slice(0, m.index) + (m.groups.end || '')),
          newAgent: CLI_OF(m.groups.cli),
        };
    }
    return { text: said, newAgent: '' };
  }
  const tidy = t => {
    t = t.replace(/^[\s,:;.!?-]+/, '').trim();
    return t && t[0].toUpperCase() + t.slice(1);
  };

  // ---- voice commands: an agent's name = the Agents page's "Send composer tasks here" for that
  // agent (11 setTarget) ------------------ "Umber, fix the scroll bug" (the bare name needs a
  // pause after it, or "hey" before it), "tell/ask Umber to …", "send this to Umber: …", "…, and
  // send this to Umber". Only names of agents in this project right now; a name that is also a CLI
  // word keeps its CLI meaning.
  const CLI_WORD =
    /^(?:claude(?:\s+code)?|codex|codecs|cursor(?:\s+agent)?|open\s?code|agent|new(?:\s+agent)?|terminal|powershell)$/i;
  const agentList = () => {
    try {
      return (window.TnaiAgents?.sessions?.() || []).filter(
        s => s.agent !== 'Terminal' && s.mode !== 'login' && s.name && s.name !== s.paneId
      );
    } catch {
      return [];
    }
  };
  const escName = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

  function named(text, list = agentList()) {
    const said = String(text || '').trim();
    for (const s of [...list].sort((a, b) => b.name.length - a.name.length)) {
      const name = String(s.name).trim();
      if (!name || CLI_WORD.test(name)) continue;
      const N = escName(name) + '(?![\\w-])';
      const leads = [
        new RegExp(OPEN + N + '\\s*[,:;.!?-]+\\s*', 'i'),
        new RegExp(src(/^(?:(?:ok(?:ay)?|please)[,\s]+)*hey[,\s]+/) + N + '[\\s,:;.!?-]*', 'i'),
        new RegExp(OPEN + '(?:tell|ask)\\s+' + N + '\\s*[,:]?\\s+(?:to\\s+)?', 'i'),
        new RegExp(OPEN + HAND + N + '[\\s,:;.!?-]*', 'i'),
      ];
      for (const re of leads) {
        const m = said.match(re);
        if (m) return { agent: s, text: tidy(said.slice(m[0].length)) };
      }
      const m = said.match(new RegExp(src(/[\s,;.-]*(?:and\s+)?/) + HAND + N + '[.!]*$', 'i'));
      if (m && m.index > 0) return { agent: s, text: tidy(said.slice(0, m.index)) };
    }
    return null;
  }

  // ---- project words for the speech engine (desktop/voice-service.js hints): agent names, then
  // open and recently touched files, then the File Repository rows already on screen. Read from
  // what the app has loaded; no disk scan.
  const MAX_HINTS = 150;

  function hints() {
    const out = [],
      seen = new Set();
    const add = w => {
      w = String(w || '').trim();
      const k = w.toLowerCase();
      if (w.length < 2 || w.length > 60 || seen.has(k) || out.length >= MAX_HINTS) return;
      seen.add(k);
      out.push(w);
    };
    const file = p => {
      const base =
        String(p || '')
          .split(/[\\/]/)
          .filter(Boolean)
          .pop() || '';
      add(base);
      add(base.replace(/\.[^.]+$/, ''));
    };
    const sessions = agentList();
    sessions.forEach(s => add(s.name));
    try {
      (window.TnaiFileTabs?.list?.() || [])
        .sort((a, b) => b.active - a.active)
        .forEach(t => file(t.path));
    } catch {}
    try {
      const fa = window.TnaiFileActivity;
      sessions.forEach(s =>
        (fa?.forPane?.(s.paneId) || []).slice(0, 12).forEach(p => file(fa.lane(p).path))
      );
    } catch {}
    document
      .querySelectorAll('.repo-row[data-real-path]')
      .forEach(row => file(row.dataset.realPath));
    return out;
  }
  window.TnaiVoice = { keys: () => keyParts(hotkey), command, named, hints };
  const MIN_SECONDS = 0.35;
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  const style = document.createElement('style');
  style.textContent = `
.tnai-voice-btn{position:relative;display:grid;place-items:center;box-sizing:border-box;width:30px;height:30px;padding:0;border:0;border-radius:7px;background:transparent;color:#8e9088;line-height:1;flex:none;cursor:pointer;touch-action:none;transition:box-shadow .08s linear,background .12s,color .12s}
.tnai-voice-btn svg{display:block;pointer-events:none}
.tnai-voice-btn:hover{background:#f1f3ee;color:#3e4438}
.tnai-voice-btn:focus-visible{outline:var(--pg-ring,2px) solid #8da56c;outline-offset:2px}
.tnai-voice-btn[data-state=listening]{border-radius:50%;background:var(--ac-coral-fg);color:var(--ac-coral-on);box-shadow:0 0 0 calc(2px + var(--tnai-voice-lvl,0) * 5px) color-mix(in srgb,var(--ac-coral-line) 40%,transparent)}
.tnai-voice-btn[data-state=listening]:hover{background:var(--ac-coral-fg);color:var(--ac-coral-on);filter:brightness(.95)}
.composebox{transition:border-color .2s ease,box-shadow .2s ease}
.composebox.tnai-voice-live{border-color:var(--ac-coral-line)!important;box-shadow:0 0 18px color-mix(in srgb,var(--ac-coral-line) 40%,transparent)!important}
.tnai-voice-viz{display:none;flex:none;align-items:center;gap:3px;height:22px;margin-left:4px}
.tnai-voice-viz i{flex:none;width:3px;height:22px;border-radius:2px;background:var(--ac-coral-fg);transform:scaleY(.14);transform-origin:center;transition:transform .09s linear}
.tnai-voice-keys-live{display:none;flex:none;align-items:center;gap:4px;margin:0 6px 0 4px}
.tnai-voice-keys-live kbd{padding:1px 6px;border:1px solid var(--ac-coral-ring);border-radius:5px;background:var(--ac-coral-bg);color:var(--ac-coral-text);font:600 10px/16px var(--pg-sans)}
.composebox:has(>.tnai-voice-btn[data-state=listening]) :is(.tnai-voice-viz,.tnai-voice-keys-live){display:flex}
.composebox:has(>.tnai-voice-btn[data-state=transcribing]) .tnai-voice-viz{display:flex}
.composebox:has(>.tnai-voice-btn[data-state=transcribing]) .tnai-voice-viz i{opacity:.7;transition:none;animation:tnai-voice-recv 1s ease-in-out infinite;animation-delay:calc(var(--i) * -70ms)}
@keyframes tnai-voice-recv{0%,100%{transform:scaleY(.18)}50%{transform:scaleY(.62)}}
.tnai-voice-btn[data-state=transcribing]{color:#879d69;cursor:progress}
.tnai-voice-btn[data-state=transcribing] svg{opacity:.5}
.tnai-voice-btn[data-state=transcribing]::after{content:"";position:absolute;inset:5px;border:1.5px solid #dfe9d2;border-top-color:#879d69;border-radius:50%;animation:tnai-voice-spin .9s linear infinite}
@keyframes tnai-voice-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.tnai-voice-btn,.composebox,.tnai-voice-viz i,.tnai-voice-target{transition:none;animation:none!important}.tnai-voice-target{--tnai-voice-glow:0!important}.tnai-voice-btn[data-state=transcribing]::after{animation:none}}
.tnai-voice-overlay{z-index:1500}
.tnai-voice-progress{margin-top:14px}
.tnai-voice-progress[hidden]{display:none}
.tnai-voice-track{height:6px;border-radius:3px;background:#eceee9;overflow:hidden}
.tnai-voice-fill{width:0;height:100%;border-radius:3px;background:#879d69;transition:width .15s linear}
.tnai-voice-note{margin-top:7px;min-height:15px;color:#6e7467;font:10px/1.5 var(--pg-sans);overflow-wrap:anywhere}
.tnai-voice-note[data-error]{color:#9a4a3c}
.tnai-voice-actions button:disabled{opacity:.55;cursor:default}
/* The whole terminal panel lights up like the composer box, so it is clear where the words will land; a lone .xterm (pop-out) gets the outline only. */
:is(.terminal-pane,.ap-term,.xterm).tnai-voice-target{outline:2px solid var(--ac-coral-line)!important;outline-offset:-2px}
:is(.terminal-pane,.ap-term).tnai-voice-target{box-shadow:0 0 calc(18px + var(--tnai-voice-glow,0) * 16px) calc(var(--tnai-voice-glow,0) * 3px) color-mix(in srgb,var(--ac-coral-line) 40%,transparent)!important;transition:box-shadow .09s linear}
:is(.terminal-pane,.ap-term,.xterm).tnai-voice-target[data-voice=transcribing]{outline-style:dashed!important;box-shadow:none!important}
/* A terminal panel's own outline sits inside its edge, under its head, terminal and input rows, so only the rounded corners showed (user
   screenshot 2026-10-02). The same 2px line is drawn where it was meant to be seen: the panel's 1px border takes the color and a 1px layer over the panel's content adds the second pixel. */
.terminal-pane.tnai-voice-target{border-color:var(--ac-coral-line)!important}
.terminal-pane.tnai-voice-target::after{content:"";position:absolute;inset:0;z-index:8;border:1px solid var(--ac-coral-line);border-radius:inherit;pointer-events:none}
.terminal-pane.tnai-voice-target[data-voice=transcribing]{border-style:dashed!important}
.terminal-pane.tnai-voice-target[data-voice=transcribing]::after{border-style:dashed}
/* Overview focus view (99): the terminal sits in a rounded box (.tf-box) that cut the corners off a line drawn on the square terminal inside
   it (lines on the four sides, nothing at the corners). The box itself carries the line: its 1px border takes the
   color and 1px more is drawn just outside it, both following the rounded corners. No layer and nothing positioned, so nothing can sit over the terminal. */
.tf-box.tnai-voice-target{border-color:var(--ac-coral-line)!important;outline:1px solid var(--ac-coral-line)!important;outline-offset:0}
.tf-box.tnai-voice-target[data-voice=transcribing]{border-style:dashed!important;outline-style:dashed!important}
/* Any text box spoken into (every text box takes voice) gets the same ring as a terminal panel: a 2px line drawn
   inside its own edge, so no parent can clip it and it is the same width with or without a border. The class is doubled so the selector outranks 07's focus rules
   (which hide outline and shadow on a focused box inside the composer, a panel's input row and others), so the ring shows on a focused box too. */
:root:not(#pg) :is(input,textarea).tnai-voice-target.tnai-voice-target:not(.xterm-helper-textarea){outline:2px solid var(--ac-coral-line)!important;outline-offset:-2px!important;box-shadow:none!important}
:root:not(#pg) :is(input,textarea).tnai-voice-target.tnai-voice-target:not(.xterm-helper-textarea)[data-voice=transcribing]{outline-style:dashed!important}
.tnai-voice-key-actions{display:flex;gap:6px}
`;
  document.head.append(style);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'voicePrompt';
  btn.className = 'tnai-voice-btn';
  btn.title = tip();
  btn.dataset.state = 'idle';
  btn.setAttribute('aria-label', 'Hold to talk');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="1.75" width="5" height="8" rx="2.5"/><path d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2"/></svg>';

  // Left side, after ＋ attach (the website's composer): mic, then the level bars and keycaps while
  // listening, then the prompt.
  const attach = box.querySelector('#attachFiles');
  box.insertBefore(btn, attach ? attach.nextSibling : box.firstChild);

  // While listening: level bars (the real mic loudness from 69's onLevel; flat when silent) and the
  // voice key, right of the mic. While transcribing: the bars wave on their own (CSS).
  const BARS = 14,
    SHAPE = Array.from(
      { length: BARS },
      (_, i) => 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / BARS)
    );
  const viz = document.createElement('span');
  viz.className = 'tnai-voice-viz';
  viz.setAttribute('aria-hidden', 'true');
  viz.append(
    ...Array.from({ length: BARS }, (_, i) => {
      const bar = document.createElement('i');
      bar.style.setProperty('--i', i);
      return bar;
    })
  ); // --i: the transcribing wave's delay
  const liveKeys = document.createElement('span');
  liveKeys.className = 'tnai-voice-keys-live';
  liveKeys.setAttribute('aria-hidden', 'true');
  btn.after(viz, liveKeys);

  function paintBars(v) {
    // 69 scales RMS to 0..1; the square-root curve lets quiet talking still move the bars
    const loud = Math.sqrt(v);
    for (let i = 0; i < BARS; i++)
      viz.children[i].style.transform =
        'scaleY(' +
        Math.max(0.14, loud * SHAPE[i] * (0.55 + 0.45 * Math.random())).toFixed(3) +
        ')';
  }

  if (!native?.voice || !recorder) return; // browser build: grayed out by 12

  // ---- state
  // -------------------------------------------------------------------------------------------------------------------
  // a press is in progress (starting or listening); transcription runs on its own so the next press
  // is never ignored
  let busy = false;
  let pending = 0,
    queue = Promise.resolve(); // clips being transcribed, delivered in the order they were said
  let holding = null; // what is holding it down: 'pointer' | 'key' | 'chord' | 'toggle'
  let gen = 0; // bumped by cancel(): stale awaits drop their result
  let unLevel = null,
    installed = false;

  // when this press began (a lone-modifier voice key + another key right away is a normal shortcut)
  let pressedAt = 0;

  // where this press's text goes: { kind: 'composer' } | { kind: 'field', el } | { kind: 'term', el
  // } (xterm's textarea)
  let target = null;
  let gpuNoted = ''; // the last "graphics card not used" reason that was shown (finish)

  // Settings › Voice, once built: asks main about the card again and repaints the Use graphics card
  // row
  let refreshGpu = null;

  // per Voice model (and "+gpu" when on the card): engine seconds per second of audio, from its own
  // clips (none until its first answer this session)
  const pace = {};

  // finish(): a clip is sent at release only when its model should answer within this
  const EARLY_MAX_MS = 150;
  const timings = (window.TnaiVoice.timings = []); // finish(): one entry per clip, newest last

  const LABELS = {
    idle: 'Hold to talk',
    listening: 'Listening. Release to paste what you said',
    transcribing: 'Transcribing what you said',
  };

  function setState(state, t = target) {
    btn.dataset.state = state;
    btn.setAttribute('aria-pressed', state === 'listening' ? 'true' : 'false');
    btn.setAttribute('aria-label', LABELS[state]);
    btn.title = state === 'idle' ? tip() : LABELS[state] + '…';
    if (state !== 'listening') {
      btn.style.removeProperty('--tnai-voice-lvl');
      paintBars(0);
    } else
      liveKeys.replaceChildren(
        ...keyParts(hotkey).map(p => {
          const k = document.createElement('kbd');
          k.textContent = p;
          return k;
        })
      );
    box.classList.toggle('tnai-voice-live', state === 'listening' && t?.kind === 'composer');
    setMark(t, state);
  }
  const markOf = t =>
    t?.kind === 'term'
      ? t.el.closest('.terminal-pane, .ap-term, .tf-box') || t.el.closest('.xterm')
      : t?.kind === 'field'
        ? t.el
        : null;

  // The terminal can move to another box mid-hold (leaving the Agents page parks its mirror off the
  // page, 25; a Build panel hands its terminal on, 33), so the box lit before is remembered (t.lit)
  // and cleared when the outline moves or ends: no orange left behind.
  function setMark(t, state) {
    if (!t) return;
    const mark = markOf(t),
      off = el => {
        el.classList.remove('tnai-voice-target');
        delete el.dataset.voice;
        el.style.removeProperty('--tnai-voice-glow');
      };
    if (t.lit && (t.lit !== mark || state === 'idle')) off(t.lit);
    t.lit = null;
    if (!mark) return;
    if (state === 'idle') off(mark);
    else {
      mark.classList.add('tnai-voice-target');
      mark.dataset.voice = state;
      t.lit = mark;
      if (state !== 'listening') mark.style.removeProperty('--tnai-voice-glow');
    }
  }

  function stopLevel() {
    try {
      unLevel?.();
    } catch {}
    unLevel = null;
    stopParts();
  }

  // Long prompts: while listening, each part up to a pause (69 take(), past ~12 s) goes to the
  // engine at once, so letting go only waits for the last few seconds. parts holds this press's
  // transcriptions in the order said; finish() joins them with the rest.
  let parts = [],
    partTimer = null;

  function startParts() {
    stopParts();
    parts = [];
    if (!recorder.take) return;
    partTimer = setInterval(() => {
      let seg = null;
      try {
        seg = recorder.take();
      } catch {}
      if (!seg?.wav || seg.silent) return;
      let words = [];
      try {
        words = hints();
      } catch {}
      parts.push(
        native.voice
          .transcribe(seg.wav, voiceLang, words, voiceModel, voiceGpu)
          .catch(err => ({ ok: false, error: plain(err) }))
      );
    }, 1000);
  }

  function stopParts() {
    if (partTimer) {
      clearInterval(partTimer);
      partTimer = null;
    }
  }

  // While listening, the window spoken into stays on top of other windows, and the desktop reports
  // the release even when a pop-up took the keyboard or mouse, so letting go always stops the mic
  // at once (voice-hold.js).
  let pinned = false;

  function pin() {
    const codes =
      holding === 'pointer'
        ? ['Mouse1']
        : holding === 'key'
          ? [heldKey === 'Enter' ? 'Enter' : 'Space']
          : holding === 'chord'
            ? [
                hotkey.code,
                ...(hotkey.ctrl ? ['Ctrl'] : []),
                ...(hotkey.shift ? ['Shift'] : []),
                ...(hotkey.alt ? ['Alt'] : []),
              ]
            : [];
    pinned = true;
    try {
      native.voice.hold?.(true, codes)?.catch?.(() => {});
    } catch {}
  }

  function unpin() {
    if (!pinned) return;
    pinned = false;
    try {
      native.voice.hold?.(false)?.catch?.(() => {});
    } catch {}
  }
  try {
    native.voice.onReleased?.(() => {
      if (!busy || !holding || holding === 'toggle') return;
      if (holding === 'key') heldKey = null;
      release(holding);
    });
  } catch {}

  // Main is told from the press until the words are typed in (or nothing was heard), so no agent or
  // app message is typed into a panel meanwhile and sent together with them (attention-service.js
  // voice). One true per press, one false per press.
  const speaking = on => {
    try {
      native.voice.speaking?.(on);
    } catch {}
  };

  function idle() {
    if (busy) speaking(false);
    unpin();
    stopLevel();
    holding = null;
    busy = false;
    mainDown = false;
    setState(pending ? 'transcribing' : 'idle');
    if (pending) setMark(target, 'idle');
    target = null;
    keepReady();
  }

  function micMessage(err) {
    switch (err?.code) {
      case 'denied':
        return (
          'Microphone access is blocked. Allow it in ' +
          (window.tnaiPlatform.win
            ? 'Windows Settings › Privacy & security › Microphone.'
            : window.tnaiPlatform.mac
              ? 'System Settings › Privacy & Security › Microphone.'
              : 'your system’s sound or privacy settings.')
        );
      case 'no-mic':
        return 'No microphone found. Plug one in and try again.';
      case 'busy':
        return 'The microphone is busy. Try again in a moment.';
      default:
        return 'Could not start the microphone.';
    }
  }

  function plain(error) {
    const m = String(error?.message || error || '')
      .replace(/^Error:\s*/i, '')
      .trim();
    if (/ENOTFOUND|EAI_AGAIN|ECONNRE|ETIMEDOUT|network|offline|socket/i.test(m))
      return 'Could not reach the download server. Check your internet connection and try again.';
    if (/ENOSPC|disk space/i.test(m)) return 'Not enough free disk space for the speech engine.';
    return m || 'Something went wrong.';
  }

  // One status call in flight at most (the first one checks that the engine starts, a short process
  // run). Cached once installed.
  let statusCall = null;

  // installed is for the current language's model; picking another language or Voice model resets
  // it (see the settings below).
  function getStatus() {
    if (installed) return Promise.resolve({ installed: true });
    const lang = voiceLang,
      model = voiceModel,
      gpu = voiceGpu;
    return (statusCall ||= native.voice
      .status(lang, model, gpu)
      .then(
        st => {
          if (lang === voiceLang && model === voiceModel && gpu === voiceGpu) {
            installed = !!st?.installed;
            keepReady();
          }
          return st || {};
        },
        err => ({ installed: false, error: plain(err) })
      )
      .finally(() => {
        statusCall = null;
      }));
  }

  // Latency: check the engine once the app is idle (it also warms the engine files in the OS
  // cache), so the first press goes straight to the mic; and open the mic while the pointer is on
  // the button or it has focus, so the words said right at the press are kept.
  setTimeout(
    () =>
      window.requestIdleCallback
        ? window.requestIdleCallback(() => getStatus(), { timeout: 5000 })
        : getStatus(),
    3000
  );
  const warmEngine = () => {
    try {
      native.voice.warm?.(voiceLang, voiceModel, voiceGpu).catch(() => {});
    } catch {}
  }; // starts the engine server once; no-op when warm
  const warmMic = () => {
    if (installed && !busy) {
      recorder.warm?.();
      warmEngine();
    }
  };
  btn.addEventListener('pointerenter', warmMic);
  btn.addEventListener('focus', warmMic);
  const readyWins = new Set(); // the app's windows (bindKeys)
  const appFocused = () =>
    [...readyWins]
      .filter(w => {
        let gone = false;
        try {
          gone = w !== window && w.closed;
        } catch {}
        if (gone) readyWins.delete(w);
        return !gone;
      })
      .some(w => {
        try {
          return !w.closed && w.document.hasFocus();
        } catch {
          return false;
        }
      });
  let restTimer = null;

  function keepReady() {
    clearTimeout(restTimer);
    restTimer = null;
    if (micReady && installed && !busy && appFocused()) recorder.warm?.(READY_MS);
  }

  // Focus moving between the app's own windows blurs one before the next has it: look again a
  // moment later.
  function restSoon() {
    if (!micReady) return;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      restTimer = null;
      if (micReady && !busy && !appFocused()) recorder.rest?.();
    }, 250);
  }
  try {
    navigator.mediaDevices.addEventListener('devicechange', () => setTimeout(keepReady, 0));
  } catch {} // 69 dropped the old mic: open the new one

  // ---- hold → record → transcribe → insert
  // -------------------------------------------------------------------------------------
  async function press(source, to = { kind: 'composer' }) {
    if (busy) return;
    busy = true;
    holding = source;
    target = to;
    pressedAt = Date.now();
    speaking(true);
    if (to.kind !== 'term') to.sel = selOf(to.kind === 'field' ? to.el : prompt);
    const my = ++gen;
    const st = await getStatus();
    if (my !== gen) return;
    if (!st.installed) {
      idle();
      openSetup(st);
      return;
    }
    if (recorder.recording) {
      try {
        recorder.cancel();
      } catch {}
    } // stuck from an earlier attempt
    warmEngine();
    try {
      await recorder.start();
    } catch (err) {
      if (my !== gen) return;
      idle();
      say(micMessage(err));
      return;
    }
    if (my !== gen) {
      try {
        recorder.cancel();
      } catch {}
      return;
    }
    if (!holding) {
      try {
        recorder.cancel();
      } catch {}
      idle();
      say('Hold the mic button while you talk');
      return;
    } // a quick tap
    setState('listening');
    cue(true);
    pin();
    startParts();
    unLevel = recorder.onLevel(level => {
      const v = Math.max(0, Math.min(1, Number(level) || 0));
      btn.style.setProperty('--tnai-voice-lvl', v.toFixed(3));
      paintBars(v);

      // A terminal panel has no bars of its own: its orange glow moves with the voice instead
      // (steady under reduced motion, CSS).
      if (target?.kind === 'term') target.lit?.style.setProperty('--tnai-voice-glow', v.toFixed(3));
    });
  }

  function release(source) {
    if (!busy || holding !== source) return;
    holding = null;

    // still starting: press() sees the release and stops there
    if (btn.dataset.state === 'listening') finish();
  }

  async function finish() {
    const my = gen,
      to = target,
      t0 = performance.now(),
      model = voiceModel,
      gpu = voiceGpu,
      paced = model + (gpu ? '+gpu' : ''); // paced: the pace key, the card has its own
    unpin();
    stopLevel();
    setState('transcribing');
    const earlier = parts;
    parts = [];
    let words = [];
    try {
      words = hints();
    } catch {}
    const send = wav =>
      native.voice
        .transcribe(wav, voiceLang, words, model, gpu)
        .catch(err => ({ ok: false, error: plain(err) }));

    // Start on release: the clip so far goes to the engine now, while the
    // recorder still waits for the end of the last word. Nothing said after the release
    // (tailQuiet): that answer is the one used; else it is dropped and the whole clip is sent. Only
    // when this model is known to finish such a clip within EARLY_MAX_MS, so a dropped try is over
    // before the whole clip is ready.
    let early = null;
    if (pace[paced] != null) {
      try {
        early = recorder.peek?.();
      } catch {}
    }
    const earlyJob =
      early?.wav &&
      !early.silent &&
      early.seconds >= MIN_SECONDS &&
      pace[paced] * early.seconds * 1000 <= EARLY_MAX_MS
        ? send(early.wav)
        : null;
    let clip = null;
    try {
      clip = await recorder.stop();
    } catch {}
    cue(false);
    if (my !== gen) return;
    micCheck(clip);
    lostCheck(clip);

    // With earlier parts, a short or silent rest is simply nothing more to add.
    const rest =
      !!clip?.wav &&
      !clip.silent &&
      (clip.seconds >= MIN_SECONDS || (earlier.length && clip.seconds > 0));
    if (!rest && !earlier.length) {
      keepClip(clip, earlier, '');
      idle();
      say("Didn't catch anything");
      return;
    }

    // The mic is free again: a new press can start right away while this clip is transcribed.
    pending++;
    target = null;
    stopLevel();
    holding = null;
    busy = false;
    mainDown = false;
    keepReady();
    setMark(to, 'transcribing');
    window.TnaiVoice._lastHints = words; // desktop-check (voice-prompt): what the engine was given
    const useEarly = !!(rest && earlyJob && clip.tailQuiet);
    const jobs = rest ? [...earlier, useEarly ? earlyJob : send(clip.wav)] : earlier;
    queue = queue
      .then(async () => {
        // a throw below (a closed pop-out, a failed delivery) must not leave the queue rejected or
        // the button on "Transcribing"
        let freed = false;
        try {
          const results = await Promise.all(jobs);

          // Where this clip's time went (the last 20, window.TnaiVoice.timings; desktop-check
          // perf-latency prints them), and the model's pace.
          const last = rest ? results[results.length - 1] : null;
          if (last?.ok && typeof last.ms === 'number' && clip.seconds > 0) {
            const r = last.ms / 1000 / clip.seconds;
            pace[paced] = pace[paced] == null ? r : pace[paced] * 0.7 + r * 0.3;
          }
          timings.push({
            model,
            seconds: +(clip?.seconds || 0).toFixed(2),
            parts: earlier.length,
            openMs: recorder.openMs || 0,
            tailMs: clip?.tailMs || 0,
            early: useEarly,
            gpu: !!last?.gpu,
            engineMs: last?.ms ?? null,
            waitedMs: last?.waited ?? null,
            totalMs: Math.round(performance.now() - t0),
          });
          if (timings.length > 20) timings.shift();
          freed = true;
          pending--;
          setMark(to, 'idle');
          if (!busy) setState(pending ? 'transcribing' : 'idle', null);
          const bad = results.find(r => !r?.ok),
            good = results.filter(r => r?.ok);
          keepClip(
            clip,
            earlier,
            good
              .map(r => clean(r.text))
              .filter(Boolean)
              .join(' ')
          );
          if (!good.length) {
            say('Could not transcribe: ' + plain(bad?.error));
            return;
          }

          // keep the rest of a long prompt
          if (bad) say('Part of what you said could not be transcribed: ' + plain(bad.error));
          const text = clean(join(good.map(r => clean(r.text)).filter(Boolean)));
          if (!text) {
            say("Didn't catch anything");
            return;
          }
          deliver(text, to);

          // The card was asked for and could not be used (its engine did not start, or the card is
          // full): said once per reason, never silent.
          const note = results.find(r => r?.gpuNote)?.gpuNote;
          if (note && note !== gpuNoted) {
            gpuNoted = note;
            say(note);
          }
        } catch (err) {
          if (!freed) {
            freed = true;
            pending = Math.max(0, pending - 1);
            try {
              setMark(to, 'idle');
            } catch {}
            try {
              if (!busy) setState(pending ? 'transcribing' : 'idle', null);
            } catch {}
          }
          try {
            say('Could not type the words in: ' + plain(err));
          } catch {}
        }
      })

      // after the words are typed in: by then the input holds them as unsent text
      .finally(() => speaking(false));
  }

  // A mic that keeps coming in very quiet (far away, input volume low, the wrong device): one bell
  // notice with the way to the system's sound settings, gone again with the next clip at a normal
  // level. Two such clips in a row, so one soft word never raises it; a dismissed notice stays away
  // until the mic has been normal once.
  const LOW_LEVEL = 0.01,
    LOW_RUN = 2; // 69's level: a normal voice near the mic is about 0.05–0.2
  let lowRun = 0;

  // Audio the window was too busy to record (69 `lost`): said once in the bell for the prompt it
  // happened in, so missing words are not a mystery. Under LOST_MS nothing is said: a single short
  // block is not a word. The newest one replaces the one before it.
  const LOST_MS = 150;

  function lostCheck(clip) {
    const lost = clip && clip.lost;
    if (!lost || !(lost.ms >= LOST_MS)) return;
    const secs = (lost.ms / 1000).toFixed(1);
    window.TnaiNextActions?.notify?.({
      key: 'voice-lost-audio',
      source: 'Voice',
      tag: 'Microphone',
      k: 'next',
      title: 'Part of a voice prompt was not recorded',
      text:
        'About ' +
        secs +
        ' s of what you said was lost because the window was busy at that moment (longest pause ' +
        lost.worstGapMs +
        ' ms). Words may be missing from that prompt: read it before you send it.',
    });
  }

  function micCheck(clip) {
    // a quick tap says nothing about the mic
    if (!clip || !(clip.seconds >= 1) || typeof clip.level !== 'number') return;
    const bell = window.TnaiNextActions;
    if (clip.level >= LOW_LEVEL) {
      lowRun = 0;
      bell?.unnotify?.('voice-low-mic');
      return;
    }
    if (++lowRun < LOW_RUN) return;
    const p = window.tnaiPlatform,
      where = p.win
        ? 'Windows sound settings'
        : p.mac
          ? 'System Settings › Sound'
          : 'your system’s sound settings';
    bell?.notify?.({
      key: 'voice-low-mic',
      source: 'Voice',
      tag: 'Microphone',
      k: 'next',
      title: 'Your microphone is very quiet',
      text:
        'Your voice barely reaches the speech model, so words get missed. Raise the input volume or pick another microphone in ' +
        where +
        ', or move closer to it.',
      action:
        (p.win || p.mac) && native.voice.micSettings
          ? { label: 'Open sound settings', run: () => native.voice.micSettings() }
          : null,
    });
  }
  window.TnaiVoice._micCheck = micCheck; // desktop-check (voice-prompt)

  // A dev copy started with TNAI_VOICE_KEEP=1 keeps each short prompt's unprocessed clip and what
  // was heard as a test clip (tools/voice-regress.js). Never on in an installed build: main answers
  // keepOn() with false there and refuses keep().
  try {
    native.voice.keepOn?.().then(
      on => {
        if (on) recorder.keepRaw = true;
      },
      () => {}
    );
  } catch {}

  function keepClip(clip, earlier, heard) {
    // a long prompt was cut into parts: its clip is not the whole sentence
    if (!clip?.raw || earlier.length) return;
    try {
      native.voice.keep?.(clip.raw, heard).catch(() => {});
    } catch {}
  }

  function cancel() {
    if (!busy) return;
    const wasListening = btn.dataset.state === 'listening';
    gen++;
    try {
      recorder.cancel();
    } catch {}
    idle();
    if (wasListening) cue(false);
  }

  // Speech engines mark silence and sounds as [BLANK_AUDIO], (music), ♪ and the like: never paste
  // those. On a near-silent clip Whisper also invents a stock line ("Thank you.", "Thanks for
  // watching!") or a lone "." / "...": when that is all it heard, it heard nothing.
  const JUNK =
    /^(?:thanks for watching|thank you for watching|you|bye|subtitles by the amara\.org community)[.!]*$/i;

  function clean(text) {
    const t = String(text || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(
        /\((?:[^)]*\b(?:music|silence|noise|blank|inaudible|applause|laughs?)\b[^)]*)\)/gi,
        ' '
      )
      .replace(/[♪♫]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return JUNK.test(t) || !/[\p{L}\p{N}]/u.test(t) ? '' : t;
  }

  // Parts of one long prompt, cut at pauses: Whisper ends a part cut mid-sentence with "..." and
  // capitalizes the next one's first word. Drop the "..." and, in English, lowercase a plain
  // continuing word ("After that ask Claude", not "After that... Ask Claude").
  const GLUE =
    /^(And|But|Or|So|Then|To|The|A|An|That|This|It|We|You|Ask|Make|Also|Because|Which|With|For|In|On|Of|If|When|Please|Just|Add|Put|Use)\b/;

  function join(texts) {
    return texts.reduce((all, t) => {
      if (!all) return t;
      const cut = /(\.\.\.|…)$/.test(all);
      return (
        (cut ? all.replace(/\s*(\.\.\.|…)$/, '') : all) +
        ' ' +
        (cut && voiceLang === 'en' ? t.replace(GLUE, w => w.toLowerCase()) : t)
      );
    }, '');
  }

  function deliver(text, to) {
    const cmd = command(text);
    if (cmd.newAgent && window.TnaiLiveTasks?.newAgent) {
      toNewAgent(cmd);
      return;
    }
    if (to?.kind === 'term') {
      if (!to.el.isConnected) {
        say('That terminal closed before the text was ready');
        return;
      }

      // Typed into the CLI like a paste, through that view's own terminal: bracketed when the
      // program asks, never sent (no Enter).
      const win = to.el.ownerDocument.defaultView || window,
        data = new win.DataTransfer();
      data.setData('text/plain', text);
      try {
        win.focus();
      } catch {}
      to.el.focus();
      to.el.dispatchEvent(
        new win.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      );
      return;
    }
    if (to?.kind === 'field') {
      const again =
        !to.el.isConnected &&
        to.notice &&
        [...document.querySelectorAll('.tnai-nitem .n-other input')].find(i => {
          const h = i.closest('[data-item]');
          return h.dataset.item === to.notice.id && h.dataset.where === to.notice.where;
        });
      if (to.el.isConnected && !to.el.disabled) insert(text, to.el, to.sel);
      else if (again && !again.disabled) insert(text, again);
      else say('That input closed before the text was ready');
      return;
    }
    const aimed = window.TnaiLiveTasks?.setTarget && shown(prompt) ? named(text) : null;
    if (aimed) {
      toNamedAgent(aimed);
      return;
    }
    insert(text, prompt, to?.sel);
    if (to?.hidden && !shown(prompt)) say('Added to the prompt box · open Threads to send it');
  }

  // "Umber, …" said into the composer: the composer's tasks go to Umber (as its card's "Send
  // composer tasks here"), the task goes in the prompt, not sent.
  function toNamedAgent({ agent, text }) {
    const live = window.TnaiLiveTasks;
    if (live.newAgent?.()) live.newAgent(false); // otherwise Send would still start a new agent
    live.setTarget(agent.paneId);
    if (text) insert(text, prompt);
    else {
      try {
        prompt.ownerDocument.defaultView?.focus();
      } catch {}
      prompt.focus();
    }
    say(
      'Composer tasks now go to ' +
        agent.name +
        (text ? ' · press Enter to send' : ' · say or type the task')
    );
  }

  // desktop-check (voice-prompt): what a transcript does, without a mic
  window.TnaiVoice._deliver = deliver;

  // "New agent …" said anywhere: the composer's ＋ New agent turns on for that CLI (11 setNewAgent)
  // and the task goes in the prompt.
  function toNewAgent(cmd) {
    const live = window.TnaiLiveTasks;
    if (shown(prompt)) {
      live.newAgent(cmd.newAgent);
      if (cmd.text) insert(cmd.text, prompt);
      else {
        try {
          prompt.ownerDocument.defaultView?.focus();
        } catch {}
        prompt.focus();
      }
      say(
        'New agent (' +
          cmd.newAgent +
          ') is on' +
          (cmd.text ? ' · press Enter to send' : ' · say or type the task')
      );
      return;
    }

    // No composer on this page (Terminal, Settings): nothing to check it in, so it goes now, as New
    // agent + Send would.
    if (!cmd.text) {
      say('Say the task after "new agent", for example: new agent, fix the login page');
      return;
    }
    if (prompt.value.trim()) {
      say('The prompt box has an unsent draft, so this was not sent. Open Threads to send it.');
      return;
    }
    live.newAgent(cmd.newAgent);
    prompt.value = cmd.text;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.ownerDocument.getElementById('send')?.click();
  }

  // Text selected when the talking started is what the words replace (pick a sentence, say the new
  // one), even if the selection collapsed or moved while it was transcribed; the snapshot is used
  // only while that exact text is still in the same place.
  function selOf(el) {
    try {
      const a = el.selectionStart,
        b = el.selectionEnd;
      return a != null && b > a ? { start: a, end: b, text: el.value.slice(a, b) } : null;
    } catch {
      return null;
    }
  }

  // Same as 27/50: replace the selection, caret after it, then an input event so auto-grow, drafts
  // and mentions update.
  function insert(text, prompt, sel = null) {
    const v = prompt.value,
      keep = sel && v.slice(sel.start, sel.end) === sel.text;
    const start = keep ? sel.start : (prompt.selectionStart ?? v.length),
      end = keep ? sel.end : (prompt.selectionEnd ?? start);

    // Mid-sentence (after a lowercase word, digit or comma): Whisper's sentence-start capital is
    // dropped ("fix the Button" → "button").
    let add =
      /[\p{Ll}\p{N},;:]$/u.test(v.slice(0, start).replace(/[ \t]+$/, '')) &&
      /^[A-Z][a-z]*\b/.test(text) &&
      !/^I\b/.test(text)
        ? text[0].toLowerCase() + text.slice(1)
        : text;
    if (start > 0 && !/\s/.test(v[start - 1])) add = ' ' + add;
    if (end < v.length && !/\s/.test(v[end])) add += ' ';
    prompt.value = v.slice(0, start) + add + v.slice(end);
    const caret = start + add.length;
    try {
      prompt.ownerDocument.defaultView?.focus();
    } catch {}
    prompt.focus();
    prompt.setSelectionRange(caret, caret);
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---- where voice text goes (mic button + voice key)
  // ---------------------------------------------------------------------------
  const shown = el => !!el && el.isConnected && el.getClientRects().length > 0;
  const isTerm = el => !!el?.matches?.('.xterm-helper-textarea');
  const isPaneField = el =>
    !!el?.matches?.('.terminal-pane .terminal-input input, .tnai-shot-note textarea') &&
    !el.disabled; // + an attachment's @N note (68): it stays open until Enter

  // A notification's "Something else…" reply box (51's bell and cards): focused, it takes the words
  // like a pane's own input box. The bell repaints on every Project context change, so the words go
  // to the same item's new box when the old one was replaced mid-dictation.
  const isNoticeReply = el => !!el?.matches?.('.tnai-nitem .n-other input') && !el.disabled;
  const noticeReplyFor = el => {
    const h = el.closest('[data-item]');
    return h ? { id: h.dataset.item, where: h.dataset.where } : null;
  };

  // Any other text box the caret is in (every text box takes voice;
  // before, only one with text selected): the words go in at the caret, or replace the selection.
  // Not a password, number or other non-text input, and not a read-only box.
  const isTextField = el =>
    !!el?.matches?.(
      'textarea, input:is([type=text],[type=search],[type=url],[type=email],:not([type]))'
    ) &&
    !isTerm(el) &&
    !el.disabled &&
    !el.readOnly;

  // the terminal the user was last in, for the Terminal page when focus is elsewhere
  let lastTerm = null;

  function pickTarget(win) {
    const active = win.document.activeElement;
    const onTerminalPage = !!document.querySelector('.layout.terminal-mode'),
      lastShown = isTerm(lastTerm) && shown(lastTerm.closest('.xterm'));

    // Terminal page: a panel clicked on its header or edge after the caret was in another terminal
    // is the one being talked to.
    if (isTerm(active))
      return {
        kind: 'term',
        el: onTerminalPage && lastShown && win === window ? lastTerm : active,
      };
    if (isPaneField(active)) return { kind: 'field', el: active };
    if (isNoticeReply(active)) return { kind: 'field', el: active, notice: noticeReplyFor(active) };
    if (active !== prompt && isTextField(active)) return { kind: 'field', el: active };
    if (shown(prompt)) return { kind: 'composer' };
    if (onTerminalPage) {
      if (lastShown) return { kind: 'term', el: lastTerm };
      const terms = [...document.querySelectorAll('.terminal-pane .xterm-helper-textarea')].filter(
        t => shown(t.closest('.xterm'))
      );

      // one terminal on the page: no click needed
      if (terms.length === 1) return { kind: 'term', el: terms[0] };
      say('Click the terminal you want to talk to, then hold ' + keyLabel(hotkey));
      return null;
    }

    // A page with no composer and no terminal (Settings…): the words wait in the composer's draft,
    // not sent.
    say('Listening · your words go to the composer draft');
    return { kind: 'composer', hidden: true };
  }
  const voiceWin = () => btn.ownerDocument.defaultView || window;

  function pressVoice(source) {
    const to = pickTarget(voiceWin());
    if (to) press(source, to);
  }

  // ---- pointer + keys on the button
  // --------------------------------------------------------------------------------------------
  btn.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (busy && holding && holding !== 'pointer') {
      event.preventDefault();
      release(holding);
      return;
    } // pressing the mic again ends a key hold
    const to = pickTarget(voiceWin());
    if (!to) return;
    event.preventDefault(); // keeps focus (and the caret) in the field you are typing in
    try {
      btn.setPointerCapture(event.pointerId);
    } catch {}
    press('pointer', to);
  });

  // Only the button coming up ends a pointer hold: pointercancel / lost capture (the composer
  // moving to its pop-out, a re-render) don't. A pointerup that lands elsewhere is caught by
  // bindKeys' window listeners.
  btn.addEventListener('pointerup', () => release('pointer'));
  btn.addEventListener('mousedown', event => {
    if (event.button === 0) event.preventDefault();
  }); // the click never takes focus from the field being spoken into

  let heldKey = null;
  btn.addEventListener('keydown', event => {
    if (
      (event.key !== ' ' && event.key !== 'Enter') ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    event.preventDefault();
    if (event.repeat || heldKey) return;
    heldKey = event.key;
    pressVoice('key');
  });

  // Its keyup is caught at the window (bindKeys), so focus leaving the button mid-hold doesn't end
  // it. Pointer and keys handle the hold. A click with no pointer or key behind it (screen readers,
  // voice control) toggles instead.
  btn.addEventListener('click', event => {
    event.preventDefault();
    if (event.detail !== 0 || heldKey) return;
    if (!busy) pressVoice('toggle');
    else release('toggle');
  });

  // ---- the voice key and Esc, in every window: main, composer pop-out (38), Build panel pop-outs
  // (23) -----------------------------
  const bound = new WeakSet();

  function bindKeys(win) {
    if (!win || bound.has(win)) return;
    bound.add(win);
    readyWins.add(win);
    win.addEventListener('focus', keepReady);
    win.addEventListener('blur', restSoon);
    win.addEventListener(
      'focusin',
      event => {
        const el = event.target;
        if (isTerm(el)) lastTerm = el;
      },
      true
    );

    // A click anywhere on a terminal's panel (its header or edge, not only the terminal itself)
    // makes it the one voice talks to.
    win.addEventListener(
      'pointerdown',
      event => {
        const ta = event.target
          .closest?.('.terminal-pane')
          ?.querySelector('.xterm-helper-textarea');
        if (ta) lastTerm = ta;
      },
      true
    );
    win.addEventListener(
      'keydown',
      event => {
        if (picking) return;
        if (event.key === 'Escape' && busy && btn.dataset.state !== 'transcribing') {
          event.preventDefault();
          event.stopImmediatePropagation();
          heldKey = null;
          cancel();
          return;
        }
        if (holding === 'chord' && hotkeyUp(event)) release('chord');

        // A lone-modifier key (Right Ctrl) with another key right away is a normal shortcut: drop
        // the clip and let the keys through. Once the user has been talking (over half a second),
        // other keys never end the hold.
        if (holding === 'chord' && isMod(hotkey) && event.code !== hotkey.code) {
          if (Date.now() - pressedAt < 500) cancel();
          return;
        }
        if (!isHotkey(event)) return;
        if (!isMod(hotkey)) mainDown = true;

        // Taken over everywhere, terminals included: the key never reaches the page or the CLI (a
        // lone modifier still does, so its shortcuts work).
        if (!isMod(hotkey)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        if (event.repeat) return;
        if (busy) {
          if (holding === 'chord') release('chord');
          return;
        } // a fresh press while "held": its keyup was lost, so this ends it
        const to = pickTarget(win);
        if (to) press('chord', to);
      },
      true
    );
    win.addEventListener(
      'keyup',
      event => {
        if (event.code === hotkey.code) mainDown = false;
        if (heldKey && event.key === heldKey) {
          event.preventDefault();
          heldKey = null;
          release('key');
          return;
        } // Space/Enter on the mic button, wherever focus went
        if (holding === 'chord' && endsHotkey(event) && !mainDown && !modsHeld(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          release('chord');
        }
      },
      true
    );

    // Pointer holds end when the button comes up anywhere; a lost key/mouse-button release is
    // caught by the next event that proves it.
    win.addEventListener(
      'pointerup',
      event => {
        if (holding === 'pointer' && event.button === 0) release('pointer');
      },
      true
    );
    const upCheck = event => {
      if (holding === 'pointer' && event.pointerType === 'mouse' && !(event.buttons & 1))
        release('pointer');

      // an unfocused window's modifier flags can be stale
      else if (holding === 'chord' && win.document.hasFocus() && hotkeyUp(event)) release('chord');
    };
    win.addEventListener('pointermove', upCheck, true);
    win.addEventListener('pointerdown', upCheck, true);

    // A mouse side button as the voice key: hold to talk, and the browser's back/forward never
    // fires.
    const ours = event => isMouse(hotkey) && MOUSE_BUTTON[event.button] === hotkey.code;
    win.addEventListener(
      'mousedown',
      event => {
        if (picking || !ours(event) || !modsOk(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (busy) {
          if (holding === 'chord') release('chord');
          return;
        }
        const to = pickTarget(win);
        if (to) press('chord', to);
      },
      true
    );
    win.addEventListener(
      'mouseup',
      event => {
        if (ours(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          release('chord');
        }
      },
      true
    );
    win.addEventListener(
      'auxclick',
      event => {
        if (ours(event)) event.preventDefault();
      },
      true
    );

    // Window blur / a pop-out closing never end a hold (user rule): the release is caught when it
    // can be proven (above).
    if (win === window) win.addEventListener('pagehide', cancel); // the app itself unloading
  }
  bindKeys(window);
  window.addEventListener('tnai:composer-popout', event => {
    if (event.detail?.out) bindKeys(window.TnaiComposerPopout?.window?.());
  });
  window.addEventListener('tnai:panel-popout', event => bindKeys(event.detail?.win));

  // ---- Settings › Voice, and the voice key row in Settings › Keyboard (the card 32 builds)
  // ----
  let picking = null; // the capture listener while the user presses the new key

  function mountSetting() {
    const mount = document.getElementById('tnaiVoiceMount');
    if (!mount || mount.firstChild) return;
    mount.innerHTML =
      '<section class="set-group"><header class="set-group-head"><div><h3>Hold to talk</h3></div></header><div class="set-card"></div></section>';
    const card = mount.querySelector('.set-card');
    const row = document.createElement('div');
    row.className = 'set-row';
    row.id = 'tnaiVoiceKeyRow';
    row.innerHTML =
      '<span class="set-text"><b>Voice prompt key</b><small>Hold <span class="tnai-voice-keys"></span> anywhere, talk, then let go. The words go into the terminal you are in, or else the composer. Any key works: a combination, an F key, Right Ctrl or Right Alt on its own, or a mouse side button.</small></span>' +
      '<span class="tnai-voice-key-actions"><button type="button" class="settings-keys-button" data-act="change">Change</button><button type="button" class="settings-keys-button" data-act="reset">Default</button></span>';
    const langRow = document.createElement('label');
    langRow.className = 'set-row';
    langRow.id = 'tnaiVoiceLangRow';
    langRow.innerHTML =
      '<span class="set-text"><b>Voice language</b><small>The language you speak. English uses the English speech model; Auto-detect or another language uses a multilingual model of the same size (downloaded once the first time you talk). Spoken commands like "new agent" stay English.</small></span>' +
      '<span class="set-ctl"><select class="set-input" aria-label="Voice language"></select></span>';
    const modelRow = document.createElement('label');
    modelRow.className = 'set-row';
    modelRow.id = 'tnaiVoiceModelRow';
    modelRow.innerHTML =
      '<span class="set-text"><b>Voice model</b><small>Bigger models catch words and names more reliably but take longer after you let go. Each downloads once, the first time you talk with it; your voice never leaves this PC.</small></span>' +
      '<span class="set-ctl"><select class="set-input" aria-label="Voice model"></select></span>';
    const soundRow = document.createElement('label');
    soundRow.className = 'set-row';
    soundRow.id = 'tnaiVoiceSoundRow';
    soundRow.innerHTML =
      '<span class="set-text"><b>Voice sounds</b><small>A short tone when the mic starts listening and when it stops.</small></span>' +
      '<span class="set-ctl"><input type="checkbox" class="set-switch" aria-label="Voice sounds"></span>';
    const readyRow = document.createElement('label');
    readyRow.className = 'set-row';
    readyRow.id = 'tnaiVoiceReadyRow';
    readyRow.innerHTML =
      '<span class="set-text"><b>Keep mic ready</b><small>Keeps the microphone open while Technically Not is the window in front, so listening starts the moment you press. Nothing you say is kept until you hold the voice key. Your system shows its microphone-in-use sign while this is on.</small></span>' +
      '<span class="set-ctl"><input type="checkbox" class="set-switch" aria-label="Keep mic ready"></span>';
    const gpuRow = document.createElement('label');
    gpuRow.className = 'set-row';
    gpuRow.id = 'tnaiVoiceGpuRow';
    gpuRow.innerHTML =
      '<span class="set-text"><b>Use graphics card</b><small></small></span>' +
      '<span class="set-ctl"><input type="checkbox" class="set-switch" aria-label="Use graphics card"></span>';
    (document.getElementById('tnaiShowShortcuts')?.closest('.set-card') || card).append(row);
    card.append(langRow, modelRow, gpuRow, soundRow, readyRow);

    // Offered only when main finds a usable NVIDIA card (voice:gpu); otherwise the switch is grayed
    // out and the row says why.
    const gpuBox = gpuRow.querySelector('input'),
      gpuNote = gpuRow.querySelector('small');
    const paintGpu = info => {
      const ok = !!info?.available;
      gpuBox.disabled = !ok;
      gpuBox.checked = ok && voiceGpu;
      gpuNote.textContent = ok
        ? 'Runs Fast, Accurate and Best on your graphics card' +
          (info.name ? ' (' + info.name + ')' : '') +
          ', so the words arrive sooner after you let go.' +
          (info.installed
            ? ''
            : ' Its engine is a ' + info.sizeMB + ' MB download the first time.') +
          ' Parakeet stays on the processor.'
        : info?.reason || 'Could not check this PC’s graphics card.';
    };
    paintGpu({ available: false, reason: 'Checking this PC’s graphics card…' });
    const checkGpu = () =>
      (native.voice.gpu
        ? native.voice.gpu()
        : Promise.resolve({ available: false, reason: 'Needs the Technically Not desktop app.' })
      ).then(paintGpu, () => paintGpu(null));
    checkGpu();
    refreshGpu = checkGpu;
    const readyBox = readyRow.querySelector('input');
    readyBox.checked = micReady;
    readyBox.addEventListener('change', () => {
      micReady = readyBox.checked;
      try {
        localStorage.setItem(READY_STORE, micReady ? 'on' : 'off');
      } catch {}
      if (micReady) keepReady();
      else if (!busy) recorder.rest?.();
    });
    const soundBox = soundRow.querySelector('input');
    soundBox.checked = voiceSounds;
    soundBox.addEventListener('change', () => {
      voiceSounds = soundBox.checked;
      try {
        localStorage.setItem(SOUND_STORE, voiceSounds ? 'on' : 'off');
      } catch {}
      if (voiceSounds) cue(true);
    });
    const langSelect = langRow.querySelector('select');
    const opts = ['auto', ...LANGS].map(code => [code, langName(code)]);
    const [auto, en, ...rest] = opts;
    for (const [code, label] of [en, auto, ...rest.sort((a, b) => a[1].localeCompare(b[1]))])
      langSelect.add(new Option(label + (code === 'en' ? ' (default)' : ''), code));
    langSelect.value = voiceLang;
    const modelSelect = modelRow.querySelector('select');
    for (const [id, label, note] of VOICE_MODELS)
      modelSelect.add(new Option(label + ' · ' + note + (id === 'fast' ? ' (default)' : ''), id));
    modelSelect.value = voiceModel;
    modelSelect.title =
      'Time to text for a 6-second sentence on a fast PC: Fast about 0.2 s, Accurate about 0.4 s, Best about 1.6 s, Parakeet about 0.3 s. Slower PCs take longer. Parakeet covers 25 European languages; with another language or Auto-detect it uses Accurate (Whisper).';

    // After a language or model change: check the new model, and load it now so the next press
    // doesn't wait for a model swap. Never while a clip is recording or being transcribed: swapping
    // models restarts the engine server.
    const switched = what => {
      const lang = voiceLang,
        model = voiceModel,
        gpu = voiceGpu;
      native.voice.status(lang, model, gpu).then(
        st => {
          if (lang !== voiceLang || model !== voiceModel || gpu !== voiceGpu) return;
          installed = !!st?.installed;
          if (installed && !busy && !pending) warmEngine();

          // Parakeet with a language it lacks runs on Whisper (voice-service.js modelFor): say so,
          // so the switch is never silent.
          const fallback =
            model === 'parakeet' && st?.engine === 'whisper'
              ? '. Parakeet does not cover ' + langName(lang) + ', so Accurate (Whisper) is used'
              : '';

          // The card is on but not used for this model or right now (Parakeet, a full card, an
          // engine that did not start): say that too.
          const card = gpu && st?.gpuReason ? '. ' + st.gpuReason.replace(/\.$/, '') : '';
          const download = installed
            ? ''
            : st?.gpu && st.gpuInstalled === false
              ? '. The graphics card engine downloads the first time you talk.'
              : '. Its speech model downloads the first time you talk.';
          say(what + fallback + card + download);
        },
        () => {}
      );
    };
    gpuBox.addEventListener('change', () => {
      voiceGpu = gpuBox.checked;
      installed = false;
      try {
        localStorage.setItem(GPU_STORE, voiceGpu ? 'on' : 'off');
      } catch {}
      switched('Graphics card for voice: ' + (voiceGpu ? 'on' : 'off'));
    });
    langSelect.addEventListener('change', () => {
      voiceLang = langSelect.value;
      installed = false;
      try {
        localStorage.setItem(LANG_STORE, voiceLang);
      } catch {}
      switched('Voice language: ' + langName(voiceLang));
    });
    modelSelect.addEventListener('change', () => {
      voiceModel = modelSelect.value;
      installed = false;
      try {
        localStorage.setItem(MODEL_STORE, voiceModel);
      } catch {}
      switched('Voice model: ' + modelName(voiceModel));
    });
    const keys = row.querySelector('.tnai-voice-keys'),
      change = row.querySelector('[data-act=change]'),
      reset = row.querySelector('[data-act=reset]');
    const paint = () => {
      keys.replaceChildren(
        ...keyParts(hotkey).flatMap((p, i) => {
          const k = document.createElement('kbd');
          k.textContent = p;
          return i ? ['+', k] : [k];
        })
      );
      reset.disabled = keyLabel(hotkey) === keyLabel(DEFAULT_KEY);
      if (btn.dataset.state === 'idle') btn.title = tip();
    };
    let pendingMod = null,
      lastReserved = '';
    const onUp = event => {
      if (pendingMod && event.code === pendingMod) {
        event.preventDefault();
        event.stopImmediatePropagation();
        accept({ ctrl: false, shift: false, alt: false, code: pendingMod });
      }
    };
    const onMouse = event => {
      const code = MOUSE_BUTTON[event.button];
      if (!code) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      accept({ ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, code });
    };
    const stop = () => {
      if (picking) {
        window.removeEventListener('keydown', picking, true);
        window.removeEventListener('keyup', onUp, true);
        window.removeEventListener('mousedown', onMouse, true);
      }
      picking = null;
      pendingMod = null;
      lastReserved = '';
      change.textContent = 'Change';
      change.removeAttribute('aria-pressed');
    };
    const save = k => {
      hotkey = k;
      try {
        localStorage.setItem(KEY_STORE, JSON.stringify(k));
      } catch {}
      paint();
    };

    // A key another shortcut owns asks once; pressing it again means "use it anyway".
    const accept = k => {
      const label = keyLabel(k);
      if (RESERVED.includes(label) && lastReserved !== label) {
        lastReserved = label;
        say(
          label +
            ' is already a Technically Not shortcut. Press it again to use it for voice anyway, or pick another.'
        );
        return;
      }
      stop();
      save(k);
      say(
        'Voice prompt key: ' +
          label +
          (isMod(k)
            ? '. Hold it on its own to talk; with another key it stays a normal shortcut.'
            : '')
      );
    };
    const typing = e =>
      e.key.length === 1 ||
      /^(Enter|NumpadEnter|Tab|Backspace|Delete|Arrow\w+|Home|End|PageUp|PageDown)$/.test(e.code);
    change.addEventListener('click', () => {
      if (picking) {
        stop();
        return;
      }
      change.textContent = 'Press a key, combination or mouse button…';
      change.setAttribute('aria-pressed', 'true');
      picking = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          stop();
          return;
        }
        if (event.metaKey || event.key === 'Meta' || !event.code) {
          say(
            window.tnaiPlatform.win
              ? 'The Windows key belongs to Windows. Pick any other key or combination.'
              : window.tnaiPlatform.mac
                ? 'The Command key belongs to macOS. Pick any other key or combination.'
                : 'The Super key belongs to the system. Pick any other key or combination.'
          );
          return;
        }
        if (event.code in MODS) {
          if (!event.repeat) pendingMod = event.code;
          return;
        } // alone on release, or with the key that follows
        pendingMod = null;
        const k = {
          ctrl: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
          code: event.code,
        };
        if (!k.ctrl && !k.alt && typing(event)) {
          say(
            keyName(k.code) +
              ' is used for typing. Add Ctrl or Alt, or pick a key like F8, Insert, Pause, Right Ctrl or a mouse side button.'
          );
          return;
        }
        accept(k);
      };
      window.addEventListener('keydown', picking, true);
      window.addEventListener('keyup', onUp, true);
      window.addEventListener('mousedown', onMouse, true);
    });
    change.addEventListener('blur', () => {
      if (picking) stop();
    });
    reset.addEventListener('click', () => {
      save(DEFAULT_KEY);
      say('Voice prompt key: ' + keyLabel(DEFAULT_KEY));
    });
    paint();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mountSetting);
  else mountSetting();

  // ---- one-time setup dialog
  // ---------------------------------------------------------------------------------------------------
  let dialog = null;

  function closeSetup() {
    dialog?.overlay.remove();
    dialog = null;
  }

  function openSetup(st) {
    closeSetup();
    const doc = btn.ownerDocument;
    const el = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    const overlay = el('div', 'tnai-voice-overlay');
    const modal = el('div', 'tnai-voice-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'tnaiVoiceTitle');
    const title = el('h2', '', 'Set up voice prompts');
    title.id = 'tnaiVoiceTitle';
    const size = Number(st?.sizeMB) > 0 ? 'about ' + Math.round(st.sizeMB) + ' MB, ' : '';
    const which =
      voiceModel === 'fast'
        ? 'the multilingual speech model'
        : 'the ' + modelName(voiceModel) + ' speech model';
    const body = el(
      'p',
      '',
      st?.gpu && st.gpuInstalled === false
        ? `Voice prompts on your graphics card use their own speech engine (${size}downloaded once; your voice never leaves this PC).`
        : st?.engineInstalled && (voiceLang !== 'en' || voiceModel !== 'fast')
          ? `Voice prompts${voiceLang !== 'en' ? ' in ' + langName(voiceLang) : ''} use ${which} (${size}downloaded once; your voice never leaves this PC).`
          : `Voice prompts use an on-device speech engine (${size}downloaded once; your voice never leaves this PC).`
    );
    const progress = el('div', 'tnai-voice-progress');
    progress.hidden = true;
    const track = el('div', 'tnai-voice-track'),
      fill = el('div', 'tnai-voice-fill');
    track.append(fill);
    const note = el('div', 'tnai-voice-note');
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    progress.append(track, note);
    const actions = el('div', 'tnai-voice-actions');
    const cancelBtn = el('button', 'tnai-voice-secondary', 'Cancel');
    cancelBtn.type = 'button';
    const goBtn = el('button', 'tnai-voice-primary', 'Download');
    goBtn.type = 'button';
    actions.append(cancelBtn, goBtn);
    modal.append(title, body, progress, actions);
    overlay.append(modal);
    doc.body.append(overlay);
    dialog = { overlay, progress, fill, note, cancelBtn, goBtn, ready: false };

    cancelBtn.onclick = closeSetup;
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) closeSetup();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSetup();
      }
    });
    goBtn.onclick = () => (dialog?.ready ? (closeSetup(), prompt.focus()) : install());

    if (st?.installing) showProgress({ phase: 'engine' });
    else if (st?.error) showError(st.error);
    goBtn.focus();
  }

  function showProgress(p) {
    if (!dialog) return;
    const d = dialog;
    d.progress.hidden = false;
    delete d.note.dataset.error;
    const pct =
      p.total > 0 ? Math.max(0, Math.min(100, Math.round((p.received / p.total) * 100))) : null;
    const what =
      p.phase === 'model' ? 'Downloading the speech model' : 'Downloading the speech engine';
    d.note.textContent = what + (pct === null ? '…' : ' · ' + pct + '%');
    d.fill.style.width = (pct ?? 0) + '%';
    d.goBtn.disabled = true;
    d.goBtn.textContent = 'Downloading…';
    d.cancelBtn.textContent = 'Close';
    d.cancelBtn.title = 'The download keeps going in the background';
  }

  function showReady() {
    const first = !installed;
    installed = true;

    // the card's engine may just have been downloaded: its row no longer announces the download
    refreshGpu?.();
    if (!dialog) {
      if (first) say('Voice prompts are ready — hold the mic to talk');
      return;
    }
    const d = dialog;
    d.ready = true;
    d.progress.hidden = false;
    delete d.note.dataset.error;
    d.fill.style.width = '100%';
    d.note.textContent = 'Ready — hold the mic to talk';
    d.goBtn.disabled = false;
    d.goBtn.textContent = 'Done';
    d.cancelBtn.hidden = true;
    d.goBtn.focus();
  }

  function showError(message) {
    if (!dialog) {
      say('Voice setup failed: ' + plain(message));
      return;
    }
    const d = dialog;
    d.progress.hidden = false;
    d.note.dataset.error = '';
    d.note.textContent = plain(message);
    d.goBtn.disabled = false;
    d.goBtn.textContent = 'Try again';
    d.cancelBtn.textContent = 'Cancel';
    d.cancelBtn.title = '';
  }

  async function install() {
    showProgress({ phase: 'engine' });
    let res;
    try {
      res = await native.voice.install(voiceLang, voiceModel, voiceGpu);
    } catch (err) {
      res = { ok: false, error: plain(err) };
    }
    if (res?.ok) showReady();
    else showError(res?.error || 'The download did not finish.');
  }

  native.voice.onProgress?.(p => {
    if (!p) return;
    if (p.phase === 'done') showReady();
    else if (p.phase === 'error') {
      if (dialog) showError(p.message || 'The download did not finish.');
    } else showProgress(p);
  });
})();
