/*
 * Technically Not · 81-system-stats.js — Desktop app only: this PC's load as telemetry chips in the
 * top bar after the agent status (and the plan-limit chip, 80): CPU %, RAM used/total and GPU %,
 * each with a sparkline of the last ~90 s (0–100 % scale; the number turns amber from 80 %, red
 * from 95 %). The tooltip adds the CPU model, video memory and Technically Not's own memory. The
 * chips are read-only (not clickable). Stats are pushed by
 * desktop/system-stats.js every 3 s, only while this window is visible and not minimized (watch on
 * visibilitychange; main also pauses on minimize/hide). GPU shows only where nvidia-smi exists
 * (NVIDIA cards). The history is only what this window received; nothing is sampled here. Top bar
 * room (fit-zoomed CSS px): sparklines from 1600, numbers only from 1340, hidden below
 * (07-purple-glass.css). Look: .pg-chip in 07. Browser build: greyed CPU/RAM/GPU chips with a dash
 * (.off), nothing sampled.
 */
(() => {
  const native = window.tnaiNative;

  // The room between two things in the top bar, as a whole number of screen pixels. The window
  // scales its page to its size, so a gap of 5 page pixels would land on 4 screen pixels in one
  // place and 5 in the next, and the chips would stand unevenly. A gap that is a whole number of
  // screen pixels moves every chip's edges by the same amount, so every gap draws the same.
  (() => {
    const bar = document.querySelector('.top .top-right');
    if (!bar) return;
    const WANTED = 5;
    const BELL = 13;
    const BELL_CIRCLE = 26;
    let scaleSet = 0;
    const snap = () => {
      const scale = window.devicePixelRatio || 1;
      if (scale === scaleSet) return;
      scaleSet = scale;
      const gap = Math.max(1, Math.round(WANTED * scale)) / scale;
      bar.style.setProperty('--pg-bar-gap', gap + 'px');

      // The bell and its circle, for the same reason: both a whole number of screen pixels, and
      // the room left over an even number, so the bell has the same room on every side (at a
      // scale of 0.95 it sat half a pixel to the right and low).
      const bell = Math.max(1, Math.round(BELL * scale));
      let circle = Math.round(BELL_CIRCLE * scale);
      if ((circle - bell) % 2) circle += 1;
      bar.style.setProperty('--pg-bell-icon', bell / scale + 'px');
      bar.style.setProperty('--pg-bell-box', circle / scale + 'px');
    };

    // The scale changes with the window's size, a moment after the size itself.
    let later = 0;
    window.addEventListener('resize', () => {
      snap();
      clearTimeout(later);
      later = setTimeout(snap, 250);
    });
    snap();
  })();

  // Computers chip (the picture's "3/3 COMPUTERS"): connected computers of known ones. Only this PC
  // exists until sync is built, so it reads 1/1 in the desktop app and 0/1 in the browser build.
  // The agent status text (11 writes .prototype-status, now visually hidden) is its tooltip; the
  // dot shows green while agents run. Clicking opens the Devices page.
  (() => {
    const status = document.querySelector('.top-right .prototype-status'),
      cmd = document.getElementById('topCommand');
    if (!status || !cmd) return;
    const pcs = document.createElement('button');
    pcs.type = 'button';
    pcs.className = 'pg-chip pg-pcs';
    pcs.innerHTML = `<i class="dot" aria-hidden="true"></i><span class="v">${native?.system ? '1/1' : '0/1'}</span><span class="k">Computers</span>`;
    cmd.before(pcs);
    const sync = () => {
      const text = status.textContent.trim();
      const note = native?.system
        ? 'This PC is connected. Syncing other computers is not built yet.'
        : 'Agents run in the Technically Not desktop app.';
      pcs.title = text + ' · ' + note;
      pcs.setAttribute('aria-label', 'Computers: ' + text + '. ' + note);
      pcs.dataset.live = /^[1-9]\d* agents? running/.test(text) ? '1' : '';
    };
    new MutationObserver(sync).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    sync();

    // A press opens the Devices page, where the computers are (it used to
    // press the old Overview's nav item, which no longer leads anywhere).
    pcs.addEventListener('click', () => {
      const open = () => window.TnaiRoute?.('devices');
      if (window.TnaiMotion) window.TnaiMotion.swap(open, 'page');
      else open();
    });
  })();

  // Browser build (no native stats): the same chips, greyed with a dash, so the bar keeps its shape
  // and says where the numbers come from.
  if (!native?.system?.watch) {
    const top = document.querySelector('.top-right .status');
    if (!top) return;
    const off = document.createElement('span');
    off.className = 'status tnai-sys-chip off';
    off.title = "This PC's CPU, memory and GPU load show in the Technically Not desktop app.";
    off.innerHTML = ['CPU', 'RAM', 'GPU']
      .map(
        k =>
          `<span class="pg-chip off" data-m="${k.toLowerCase()}"><span class="k">${k}</span><span class="v">—</span></span>`
      )
      .join('');
    top.after(off);
    return;
  }
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );

  const GB = 2 ** 30,
    KEEP = 30,
    W = 58,
    H = 20;
  const gb = bytes => {
    const v = bytes / GB;
    return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  };
  const level = pct => (pct >= 95 ? 'full' : pct >= 80 ? 'high' : 'ok');
  const hist = { cpu: [], ram: [], gpu: [] };
  const push = (key, v) => {
    const h = hist[key];
    h.push(Math.max(0, Math.min(100, v)));
    if (h.length > KEEP) h.shift();
  };

  // Smooth sparkline on a fixed 0–100 scale, drawn in currentColor (the chip sets the color from
  // the --pg-tel-* tokens).
  let gradSeq = 0;

  function spark(values) {
    if (values.length < 2) return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`;
    const step = W / (KEEP - 1),
      x0 = W - (values.length - 1) * step;
    const pts = values.map((v, i) => [x0 + i * step, H - 2 - (v / 100) * (H - 4)]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1],
        [bx, by] = pts[i],
        xm = ((ax + bx) / 2).toFixed(1);
      d += ` C${xm},${ay.toFixed(1)} ${xm},${by.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;
    }
    const [lx, ly] = pts[pts.length - 1],
      id = 'pgsp' + (++gradSeq % 1000);
    return (
      `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${d} L${lx.toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="currentColor"/></svg>`
    );
  }

  // Each chip is patched in place (not rebuilt), so a whole-number percent rolls to its new value
  // (21: .tn-count, @property --tn-n) and a level color fades instead of jumping.
  function paintChip(key, label, pct, valueHtml, count) {
    let c = chip.querySelector(`.pg-chip[data-m="${key}"]`);
    if (!c) {
      c = document.createElement('span');
      c.className = 'pg-chip';
      c.dataset.m = key;
      c.innerHTML = `<span class="k">${label}</span><span class="v"></span>`;
      chip.append(c);
    }
    c.dataset.level = level(pct);
    const v = c.querySelector('.v');
    if (count != null) {
      v.className = 'v tn-count';
      v.dataset.unit = '%';
      v.style.setProperty('--tn-n', Math.round(count));
      v.innerHTML = '';
    } else v.innerHTML = valueHtml;
    c.querySelector('svg')?.remove();
    c.insertAdjacentHTML('beforeend', spark(hist[key]));
  }

  let chip = null,
    staleTimer = 0;

  function place() {
    const top = document.querySelector('.top-right .status:not(.tnai-sys-chip)');
    if (!top) return null;
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'status tnai-sys-chip';
      chip.hidden = true;
    }

    // after the plan-limit chip when it's there
    const after = document.querySelector('.top-right .tnai-limit-chip') || top;
    if (chip.previousElementSibling !== after) after.after(chip);
    return chip;
  }

  function show(s) {
    if (!s || !Number.isFinite(s.cpu) || !place()) return;
    const memPct = Math.round((100 * s.memUsed) / s.memTotal);
    push('cpu', s.cpu);
    push('ram', memPct);
    if (s.gpu) push('gpu', s.gpu.util);
    else hist.gpu.length = 0;
    if (!chip.querySelector('.pg-chip')) chip.textContent = '';
    paintChip('cpu', 'CPU', s.cpu, '', s.cpu);
    paintChip(
      'ram',
      'RAM',
      memPct,
      esc(gb(s.memUsed)) + '<small>/' + esc(gb(s.memTotal)) + ' GB</small>'
    );
    if (s.gpu) paintChip('gpu', 'GPU', s.gpu.util, '', s.gpu.util);
    else chip.querySelector('.pg-chip[data-m="gpu"]')?.remove();
    const lines = [
      'CPU ' + s.cpu + '% · ' + s.cpuModel + ' · ' + s.cores + ' threads',
      'Memory ' +
        gb(s.memUsed) +
        ' of ' +
        gb(s.memTotal) +
        ' GB used (' +
        memPct +
        '%) · Technically Not uses ' +
        gb(s.appMem) +
        ' GB',
      s.gpu
        ? 'GPU ' +
          Math.round(s.gpu.util) +
          '% · ' +
          s.gpu.name +
          ' · video memory ' +
          gb(s.gpu.vramUsed) +
          ' of ' +
          gb(s.gpu.vramTotal) +
          ' GB' +
          (s.gpu.count > 1 ? ' (busiest of ' + s.gpu.count + ' GPUs)' : '')
        : 'GPU: shown for NVIDIA cards only',
      'This PC, updated every 3 s while this window is open; lines show the last 90 s.',
    ];
    chip.title = lines.join('\n');
    chip.setAttribute('aria-label', lines.slice(0, 3).join('. ') + '.');
    chip.hidden = false;
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (chip) chip.hidden = true;
    }, 10e3); // no fresh reading: hide rather than show old numbers
  }

  native.system.on(show);

  // Hidden or minimized: no readings arrive, so the history restarts instead of drawing a line
  // across the gap.
  const sync = () => {
    if (document.hidden) for (const k in hist) hist[k].length = 0;
    native.system.watch(!document.hidden).catch(() => {});
  };
  document.addEventListener('visibilitychange', sync);
  sync();
})();
