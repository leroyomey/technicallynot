/*
 * Technically Not · tools/desktop-check/voice-gpu-check.js — plain Node check of the voice prompts'
 * graphics-card option (desktop/voice-service.js, Settings › Voice › Use graphics card): reading
 * the card from nvidia-smi's answer, when the switch is offered and the sentence shown when it is
 * not, and that the service says truthfully whether the card is used. No engine, no microphone, no
 * card: the engine is the fake one (TN_VOICE_FAKE) and the card is a given nvidia-smi line
 * (TN_VOICE_GPU_FAKE). Run: node tools/desktop-check/voice-gpu-check.js With a real NVIDIA card
 * (not for CI; loads a model on the card for a few seconds): node
 * tools/desktop-check/voice-gpu-check.js --real <voice dir> <clip.wav> [--broken <voice dir>]
 * <voice dir> is laid out like userData/voice (engine, engine-cuda, models with ggml-small.en.bin);
 * clip.wav is 16 kHz mono 16-bit speech. --broken: a second voice dir whose engine-cuda holds the
 * CPU build (plus empty stand-ins for the CUDA files), so the engine starts without taking the
 * card: the clip must still come back, from the processor. --switch <voice dir>: two Voice models
 * asked for 0.45 s apart on the real card (about 8 s, no clip): the card stays in use.
 */
'use strict';
const fs = require('fs');
const {
  createVoiceService,
  parseGpu,
  gpuVerdict,
  gpuNeedMB,
} = require('../../desktop/voice-service');

let failed = 0;
const check = (name, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) failed++;
};
const arg = flag => {
  const i = process.argv.indexOf(flag);
  return i < 0
    ? []
    : process.argv
        .slice(i + 1)
        .filter((a, n, all) => !all.slice(0, n + 1).some(x => x.startsWith('--')));
};
const GOOD = 'NVIDIA GeForce RTX 4080 SUPER, 610.88, 16376, 2165';
const service = (card, engine, dir) => {
  if (engine) process.env.TN_VOICE_FAKE = engine;
  else delete process.env.TN_VOICE_FAKE;
  if (card == null) delete process.env.TN_VOICE_GPU_FAKE;
  else process.env.TN_VOICE_GPU_FAKE = card;
  return createVoiceService({ dir: dir || __dirname });
};

(async () => {
  // Reading the card.
  const c = parseGpu(GOOD + '\r\nNVIDIA GeForce GTX 1050, 610.88, 4096, 100\r\n');
  check(
    'the first card is read: ' + JSON.stringify(c),
    !!c &&
      c.name === 'NVIDIA GeForce RTX 4080 SUPER' &&
      c.driver === 610.88 &&
      c.totalMB === 16376 &&
      c.usedMB === 2165
  );
  check(
    'no card, an error text or nothing gives null',
    parseGpu('') === null &&
      parseGpu(null) === null &&
      parseGpu("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.") ===
        null
  );
  check(
    'a four-part driver version keeps its first two parts',
    (parseGpu('Card, 31.0.15.5222, 8192, 0') || {}).driver === 31
  );

  // When the switch is offered, and the sentence beside it when it is not.
  const v = (card, platform = 'win32', arch = 'x64') =>
    gpuVerdict(card && parseGpu(card), platform, arch);
  check('a recent card is offered, with no reason', v(GOOD).available && v(GOOD).reason === '');
  check(
    'no card: ' + v(null).reason,
    !v(null).available &&
      /NVIDIA graphics card/.test(v(null).reason) &&
      /None was found/.test(v(null).reason)
  );
  check(
    'old driver: ' + v('NVIDIA GeForce GTX 1060, 472.12, 6144, 300').reason,
    !v('NVIDIA GeForce GTX 1060, 472.12, 6144, 300').available &&
      /Update your NVIDIA driver/.test(v('NVIDIA GeForce GTX 1060, 472.12, 6144, 300').reason) &&
      /472\.12/.test(v('NVIDIA GeForce GTX 1060, 472.12, 6144, 300').reason)
  );
  check(
    'the oldest driver that works is offered',
    v('Card, 551.61, 8192, 0').available && !v('Card, 551.60, 8192, 0').available
  );
  check(
    'small card: ' + v('NVIDIA GeForce GT 710, 610.88, 1024, 100').reason,
    !v('NVIDIA GeForce GT 710, 610.88, 1024, 100').available &&
      /too little graphics memory/.test(v('NVIDIA GeForce GT 710, 610.88, 1024, 100').reason)
  );
  check(
    'Mac with Apple silicon says it is already on',
    !v(GOOD, 'darwin', 'arm64').available && /Already on/.test(v(GOOD, 'darwin', 'arm64').reason)
  );
  check(
    'Linux, an Intel Mac and Windows on ARM name what is needed',
    [
      ['linux', 'x64'],
      ['darwin', 'x64'],
      ['win32', 'arm64'],
    ].every(
      ([p, a]) =>
        !v(GOOD, p, a).available && /Needs Windows with an NVIDIA/.test(v(GOOD, p, a).reason)
    )
  );
  check(
    'memory asked for per model is between its file size and 2 GB: ' +
      ['base.en', 'small.en', 'large-v3-turbo-q5_0'].map(n => n + ' ' + gpuNeedMB(n)).join(', '),
    gpuNeedMB('base.en') > 141 &&
      gpuNeedMB('small.en') > 465 &&
      gpuNeedMB('large-v3-turbo-q5_0') > 547 &&
      gpuNeedMB('large-v3-turbo-q5_0') < 2048
  );

  // What the service tells the window (fake engine; these answers depend on this being 64-bit
  // Windows).
  if (process.platform === 'win32' && process.arch === 'x64') {
    let svc = service(GOOD, 'fake words');
    let st = await svc.status('en', 'accurate', true);
    check('asked for with a good card: the card is used', st.gpu === true && !st.gpuReason);
    st = await svc.status('en', 'accurate', false);
    check(
      'not asked for: the card is not used, and no reason is given',
      st.gpu === false && !st.gpuReason
    );
    st = await svc.status('en', 'accurate');
    check(
      'a caller that passes nothing (older window code, tests) stays on the processor',
      st.gpu === false && !st.gpuReason
    );
    st = await svc.status('en', 'parakeet', true);
    check(
      'Parakeet says it runs on the processor: ' + st.gpuReason,
      st.gpu === false && /Parakeet runs on the processor/.test(st.gpuReason || '')
    );
    let g = await svc.gpu();
    check(
      'the switch is offered and names the card and the download: ' + JSON.stringify(g),
      g.available &&
        g.name === 'NVIDIA GeForce RTX 4080 SUPER' &&
        g.sizeMB === 643 &&
        g.installed === false
    );
    svc = service('none', 'fake words');
    st = await svc.status('en', 'best', true);
    g = await svc.gpu();
    check(
      'no card: the switch is not offered and status says why',
      !g.available &&
        st.gpu === false &&
        /None was found/.test(st.gpuReason || '') &&
        /None was found/.test(g.reason)
    );
    const r = await svc
      .transcribe(fs.readFileSync(__filename).subarray(0, 0), 'en', [], 'best', true)
      .catch(e => ({ ok: false, error: String(e) }));
    check(
      'a clip with the switch on and no card still gets an answer (here: not a recording)',
      r && r.ok === false && /WAV/.test(r.error || '')
    );
  } else console.log('SKIP  service answers (64-bit Windows only)');

  // The real card.
  const [realDir, clipFile] = arg('--real'),
    [brokenDir] = arg('--broken');
  if (realDir && clipFile) {
    const clip = fs.readFileSync(clipFile);
    let svc = service(null, '', realDir);
    const g = await svc.gpu();
    check(
      'real: the card is found and its engine is installed: ' + JSON.stringify(g),
      g.available && g.installed
    );
    let st = await svc.status('en', 'accurate', true);
    check(
      'real: Accurate on the card is ready: ' + JSON.stringify(st),
      st.installed && st.gpu && st.gpuInstalled && st.sizeMB === 0
    );
    const t0 = Date.now(),
      first = await svc.transcribe(clip, 'en', [], 'accurate', true),
      cold = Date.now() - t0;
    check(
      'real: first clip, engine start included, came from the card in ' +
        cold +
        ' ms: ' +
        JSON.stringify(first.text),
      first.ok && first.gpu === true && first.text.length > 10
    );
    const warm = [];
    let same = true;
    for (let i = 0; i < 3; i++) {
      const r = await svc.transcribe(clip, 'en', [], 'accurate', true);
      warm.push(r.ms);
      same = same && r.ok && r.gpu === true && r.text === first.text;
    }
    check('real: three more clips on the card, same words: ' + warm.join(', ') + ' ms', same);
    const cpu = await svc.transcribe(clip, 'en', [], 'accurate', false);
    check(
      'real: switch off, the next clip is done by the processor in ' +
        cpu.ms +
        ' ms (engine restart included)',
      cpu.ok && cpu.gpu !== true && cpu.text.length > 10
    );
    const cpu2 = await svc.transcribe(clip, 'en', [], 'accurate', false);
    check(
      'real: the card (' +
        Math.max(...warm) +
        ' ms at most) is faster than the processor (' +
        cpu2.ms +
        ' ms)',
      Math.max(...warm) < cpu2.ms
    );
    svc.dispose();

    // A full card: the clip goes to the processor and status says why; nothing is left switched off
    // for good.
    svc = service('Full Card, 610.88, 8192, 8100', '', realDir);
    const full = await svc.transcribe(clip, 'en', [], 'accurate', true);
    st = await svc.status('en', 'accurate', true);
    check(
      'real: a full card leaves the clip to the processor and says so: ' + st.gpuReason,
      full.ok &&
        full.gpu !== true &&
        full.text.length > 10 &&
        st.gpu === false &&
        /Not enough free graphics memory/.test(st.gpuReason || '')
    );
    svc.dispose();
  }
  if (brokenDir && clipFile) {
    const clip = fs.readFileSync(clipFile),
      svc = service(null, '', brokenDir);
    const r = await svc.transcribe(clip, 'en', [], 'accurate', true),
      st = await svc.status('en', 'accurate', true),
      again = await svc.transcribe(clip, 'en', [], 'accurate', true);
    check(
      'broken: an engine that does not take the card costs no words: ' + JSON.stringify(r.text),
      r.ok && r.gpu !== true && r.text.length > 10
    );
    check(
      'broken: status says the processor is used: ' + st.gpuReason,
      st.gpu === false && /did not start on this PC/.test(st.gpuReason || '')
    );
    check(
      'broken: the next clip goes straight to the processor (' +
        again.ms +
        ' ms after ' +
        r.ms +
        ' ms)',
      again.ok && again.gpu !== true && again.ms < r.ms
    );
    svc.dispose();
  }

  // A switch to another Voice model while the first is still loading on the card:
  // the first start is ended by the service itself, which is no card failure. Needs
  // base.en and small.en in <voice dir>/models; no clip.
  const [switchDir] = arg('--switch');
  if (switchDir) {
    const svc = service(null, '', switchDir),
      wait = ms => new Promise(r => setTimeout(r, ms));

    // reads the card, so the warm below starts its engine at once
    await svc.status('en', 'accurate', true);
    await svc.warm('en', 'accurate', true);
    await wait(450); // loading on the card takes about 0.85 s
    await svc.warm('en', 'fast', true);
    await wait(6000);
    const st = await svc.status('en', 'fast', true);
    check(
      'switch: a model changed while the first was loading leaves the card in use: ' +
        JSON.stringify({ gpu: st.gpu, reason: st.gpuReason || '' }),
      st.gpu === true && !st.gpuReason
    );
    svc.dispose();
  }

  console.log(failed ? failed + ' check(s) failed' : 'voice-gpu-check: all passed');
  process.exit(failed ? 1 : 0);
})();
