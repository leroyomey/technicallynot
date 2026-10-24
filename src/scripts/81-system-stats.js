/*
 * Technically Not · 81-system-stats.js — the top bar's System chip and what it opens (user
 * 2026-10-24, tab 4 of docs/plans/design-concepts/app-polish.html). One chip, "System OK" with a
 * small bar, stands where six meters stood; a press (or Enter or Space) opens a popover right under
 * it with every meter as a row: its name, a bar and its value. The rows are CPU, RAM and GPU (this
 * file), the plan's longer window, "Claude week" (80), and Tokens/min (129's #pgTokChip, moved into
 * the popover here). The chip turns amber when any row with a bar is high: 80 % and up, the same
 * line the meters and the account gauges (98) always used; a row from 95 % shows its number red.
 * Tokens/min has no top, so it shows its small line and never turns the chip amber. Esc closes the
 * popover and the keyboard goes back to the chip. Claude's 5-hour use stays its own chip (80).
 *
 * The load numbers are pushed by desktop/system-stats.js every 3 s, only while this window is
 * visible and not minimized (watch on visibilitychange; main also pauses on minimize/hide). GPU
 * shows only where nvidia-smi exists (NVIDIA cards). Nothing is sampled here, and an open popover
 * asks for nothing more: it shows the same rows, patched in place as readings arrive.
 * `window.TnaiSystemChip` (`meter(key, data)`, `open`, `close`, `isOpen`, `button`, `list`).
 * Look: .pg-sys and .pg-sys-pop in src/styles/07-purple-glass.css. Browser build: the chip greyed
 * with a dash, nothing sampled.
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

  // A meter is high from 80 % and full from 95 %: the lines the top bar's meters and the account
  // gauges (98) have always used.
  const level = pct => (pct >= 95 ? 'full' : pct >= 80 ? 'high' : 'ok');

  // ---------- the System chip and its popover
  const system = (() => {
    const bar = document.querySelector('.top .top-right');
    if (!bar) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pg-chip pg-sys';
    button.id = 'pgSysChip';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'pgSysPop');
    button.innerHTML =
      '<span class="k">System</span><span class="v">—</span>' +
      '<span class="pg-meter-bar" aria-hidden="true"><i></i></span>';
    const value = button.querySelector('.v');
    const fill = button.querySelector('.pg-meter-bar i');
    const status = bar.querySelector('.prototype-status');
    if (status) status.after(button);
    else bar.prepend(button);

    // The popover stays in the page's body: the top bar is the window's drag area, and a part
    // inside it would take no presses.
    const pop = document.createElement('section');
    pop.className = 'pg-sys-pop';
    pop.id = 'pgSysPop';
    pop.hidden = true;
    pop.setAttribute('aria-label', 'System meters');
    const list = document.createElement('div');
    list.className = 'pg-sys-list';
    pop.append(list);
    document.body.append(pop);

    // Tokens/min (129 paints it in place) is the popover's last row.
    const tokens = document.getElementById('pgTokChip');
    if (tokens) list.append(tokens);

    // The chip's word, bar and color from the rows that have a bar: the bar shows the fullest one,
    // and any row at "high" or "full" turns the chip amber and is named in its tip.
    function refresh() {
      const rows = [...list.querySelectorAll('.pg-chip[data-pct]')];
      let top = 0;
      const high = [];
      for (const row of rows) {
        const pct = Number(row.dataset.pct) || 0;
        top = Math.max(top, pct);
        if (row.dataset.level !== 'ok')
          high.push(row.querySelector('.k').textContent + ' ' + pct + '%');
      }
      const word = !rows.length ? '—' : high.length ? 'High' : 'OK';
      if (value.textContent !== word) value.textContent = word;
      button.dataset.level = high.length ? 'high' : 'ok';
      fill.style.setProperty('--v', String(top / 100));
      const said = !rows.length
        ? 'no readings yet'
        : high.length
          ? 'running high: ' + high.join(', ')
          : 'all meters are fine';
      button.title = 'System: ' + said + '. Press to see every meter.';
      button.setAttribute('aria-label', 'System, ' + said + '. Shows every meter.');
    }

    // One row of the popover, made once and patched in place after that, so a whole-number
    // percent rolls to its new value (21: .tn-count, @property --tn-n) and a level color fades
    // instead of jumping. data: { label, pct, value (HTML), count (a whole percent to roll),
    // title }, or null to take the row out.
    function meter(key, data) {
      let row = list.querySelector(`.pg-chip[data-m="${key}"]`);
      if (!data) {
        if (row) {
          row.remove();
          refresh();
        }
        return null;
      }
      if (!row) {
        row = document.createElement('div');
        row.className = 'pg-chip';
        row.dataset.m = key;
        row.innerHTML =
          '<span class="k"></span><span class="pg-meter-bar" aria-hidden="true"><i></i></span>' +
          '<span class="v"></span>';
        list.append(row);
      }
      const pct = Math.max(0, Math.min(100, Number(data.pct) || 0));
      row.querySelector('.k').textContent = data.label;
      row.dataset.pct = String(Math.round(pct));
      row.dataset.level = level(pct);
      row.querySelector('.pg-meter-bar i').style.setProperty('--v', String(pct / 100));
      const shown = row.querySelector('.v');
      if (data.count != null) {
        shown.className = 'v tn-count';
        shown.dataset.unit = '%';
        shown.style.setProperty('--tn-n', Math.round(data.count));
        shown.innerHTML = '';
      } else {
        shown.className = 'v';
        shown.innerHTML = data.value;
      }
      row.title = data.title || '';
      refresh();
      return row;
    }

    function setOpen(show) {
      if (show === !pop.hidden) return;
      pop.hidden = !show;
      button.setAttribute('aria-expanded', String(show));
      if (show) window.TnaiFloat?.attach(button, pop, { placement: 'bottom-start' });
    }

    // Enter and Space press the button by themselves.
    button.addEventListener('click', () => setOpen(pop.hidden));
    document.addEventListener(
      'pointerdown',
      event => {
        if (!pop.hidden && !pop.contains(event.target) && !button.contains(event.target))
          setOpen(false);
      },
      true
    );

    // Esc closes it first, before anything else that listens for Esc, and the keyboard goes back
    // to the chip.
    document.addEventListener(
      'keydown',
      event => {
        if (event.key !== 'Escape' || pop.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.focus({ preventScroll: true });
      },
      true
    );

    refresh();
    return {
      button,
      list,
      meter,
      open: () => setOpen(true),
      close: () => setOpen(false),
      isOpen: () => !pop.hidden,
    };
  })();
  if (system) window.TnaiSystemChip = system;

  // Browser build (no native stats): the chip greyed with a dash, so the bar keeps its shape and
  // says where the numbers come from.
  if (!native?.system?.watch) {
    if (!system) return;
    system.button.classList.add('off');
    system.button.disabled = true;
    system.button.title =
      "This PC's CPU, memory and GPU load show in the Technically Not desktop app.";
    return;
  }
  if (!system) return;

  const esc = text =>
    String(text ?? '').replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const GB = 2 ** 30;
  const gb = bytes => {
    const v = bytes / GB;
    return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  };
  const STALE_MS = 10e3;
  let staleTimer = 0;

  function show(s) {
    if (!s || !Number.isFinite(s.cpu)) return;
    const memPct = Math.round((100 * s.memUsed) / s.memTotal);
    system.meter('cpu', {
      label: 'CPU',
      pct: s.cpu,
      count: s.cpu,
      title: 'CPU ' + s.cpu + '% · ' + s.cpuModel + ' · ' + s.cores + ' threads',
    });
    system.meter('ram', {
      label: 'RAM',
      pct: memPct,
      value: esc(gb(s.memUsed)) + '<small>/' + esc(gb(s.memTotal)) + ' GB</small>',
      title:
        'Memory ' +
        gb(s.memUsed) +
        ' of ' +
        gb(s.memTotal) +
        ' GB used (' +
        memPct +
        '%) · Technically Not uses ' +
        gb(s.appMem) +
        ' GB',
    });
    if (s.gpu)
      system.meter('gpu', {
        label: 'GPU',
        pct: s.gpu.util,
        count: s.gpu.util,
        title:
          'GPU ' +
          Math.round(s.gpu.util) +
          '% · ' +
          s.gpu.name +
          ' · video memory ' +
          gb(s.gpu.vramUsed) +
          ' of ' +
          gb(s.gpu.vramTotal) +
          ' GB' +
          (s.gpu.count > 1 ? ' (busiest of ' + s.gpu.count + ' GPUs)' : ''),
      });
    else system.meter('gpu', null);

    // No fresh reading: take the rows out rather than show old numbers.
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      for (const key of ['cpu', 'ram', 'gpu']) system.meter(key, null);
    }, STALE_MS);
  }

  native.system.on(show);

  // Hidden or minimized: no readings are asked for.
  const sync = () => {
    native.system.watch(!document.hidden).catch(() => {});
  };
  document.addEventListener('visibilitychange', sync);
  sync();
})();
