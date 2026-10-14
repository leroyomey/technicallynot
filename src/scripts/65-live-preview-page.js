// Technically Not · 65-live-preview-page.js — Desktop only: Live preview page (left nav "Live
// preview", `preview-mode`), its own page, laid out as "the Stage": the preview floats as a device
// frame on a dark stage canvas under browser chrome (a tab row with ＋ and Pop out; an address row
// with ← → ↻, the address box holding the status dot and Open in browser, ▶ Run) and over a device
// dock (Desktop / Tablet / Phone, size, Rotate, Side by side). Side by side shows the same address
// at once as Desktop, Tablet and Phone frames: the main view plus two real, emulated iframes from
// 31's mirror(), made only while it is on and the page is shown (off while popped out).
// tnai.live-preview-stage.v1 remembers Side by side. The preview stage is 31's
// `TnaiLivePreview.mount` in browser mode (same servers and tabs as the Build panel): tab strip, ←
// → ↻, an address bar that opens any localhost / 127.0.0.1 / [::1] address (only addresses on this
// computer), device picker, open in browser, plus this page's ▶ Run menu (the project's
// package.json dev scripts with Start / Stop and their state in plain words; Start runs the script
// in a Terminal panel, as before) and ⧉ Pop out. An empty tab shows what to do first. Below it, a
// terminal drawer (like browser devtools): one tab per terminal panel running this project's
// preview scripts and per PowerShell terminal added with its ＋, shown live through 33's Build
// terminal (the same pty mirrored: no second process); resized by its top edge, collapsed by its
// chevron; open / height / chosen terminal / added terminals remembered
// (tnai.live-preview-drawer.v1). Shown by this file since 08 has no route for it; hidden again when
// any other page mode is set. window.TnaiLivePreviewPage (open, visible, popOut, dock, isOut,
// window, setOnTop).
(() => {
  const layout = document.querySelector('.layout'),
    lp = window.TnaiLivePreview;
  if (!layout || !window.tnaiNative || !lp) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  // pick a project folder (09): it becomes the active project
  const openFolder = () => window.TnaiProjects?.add?.();
  const OTHER_MODES = [
    'overview-mode',
    'terminal-mode',
    'code-mode',
    'skills-mode',
    'settings-mode',
    'devices-mode',
  ];
  const visible = () => layout.classList.contains('preview-mode');

  const page = el('section', 'lpp-page');
  page.id = 'livePreviewPage';
  page.setAttribute('aria-label', 'Live preview');
  page.innerHTML = `<h1 class="pg-sr">Live preview</h1>
<div class="lpp-body"><div class="lpp-main"><section class="lpp-stage" aria-label="Preview"></section></div>
<section class="lpp-drawer" aria-label="Terminals"><div class="lpp-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the terminals" title="Drag to resize" tabindex="0"></div>
<div class="lpp-dhead"><button class="lpp-dtitle" type="button" aria-expanded="true">Terminals</button><div class="lpp-dtabs" role="tablist" aria-label="Terminals"></div><button class="lpp-dadd" type="button" title="New PowerShell terminal in this drawer (it also shows as a thread)" aria-label="New terminal">＋</button><span class="lpp-dgap"></span><span class="lpp-dslot"></span><button class="lp-btn lpp-dopen" type="button" title="Open its thread">Thread ↗</button><button class="lpp-dfold" type="button" aria-label="Collapse the terminals">⌄</button></div>
<div class="lpp-dbody"></div></section></div>`;
  layout.append(page);
  const $ = sel => page.querySelector(sel);
  const stage = $('.lpp-stage');
  let view = null;

  const button = (text, title, cls, fn) => {
    const b = el('button', 'lp-btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', event => {
      event.stopPropagation();
      fn();
    });
    return b;
  };
  const live = t => t && (t.state === 'starting' || t.state === 'running');

  // ---------- Empty tab (31 calls this with the stage's blank node): say what to do first. Rebuilt
  // only when what it says changes.
  function paintBlank(node, { adding } = {}) {
    const tabs = lp.tabs(),
      scripts = lp.scripts(),
      hasFolder = !!lp.project();
    const key = JSON.stringify([hasFolder, scripts.length, !!(adding && tabs.length)]);
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    const steps = el('ol'),
      step = (...parts) => {
        const li = el('li');
        li.append(...parts);
        steps.append(li);
      };
    if (!hasFolder)
      step(
        'Open your project folder. ',
        button(
          'Open a project folder',
          'Choose the folder of the project to preview',
          'lp-go',
          openFolder
        )
      );
    if (!hasFolder || scripts.length)
      step(
        'Pick your app’s dev script from ▶ Run above. It runs in a thread, and your app shows here once it prints its address.'
      );
    step(
      'Or type the address of a server already running on this computer, e.g. localhost:3000, in the address bar.'
    );
    node.replaceChildren(
      el('h2', '', adding && tabs.length ? 'New tab' : 'Nothing to preview yet'),
      steps,
      el(
        'p',
        'lpp-note',
        'Links you click stay in the preview. Addresses outside this computer open in your browser.'
      )
    );
  }

  // ---------- ▶ Run: the package.json dev scripts (what the old "Your app" list did), Start / Stop
  // and their state, in a menu on the toolbar.
  const runWrap = el('span', 'lpp-runwrap'),
    runBtn = el('button', 'lp-btn lp-go lpp-run'),
    menu = el('div', 'lpp-menu');
  runBtn.innerHTML = window.TnaiIcon('play', { size: 14 }) + ' Run';
  runBtn.type = 'button';
  runBtn.title = 'Run one of your app’s scripts from package.json';
  runBtn.setAttribute('aria-haspopup', 'true');
  runBtn.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Run a script');
  runWrap.append(runBtn, menu);
  const menuOpen = () => !menu.hidden;

  function setMenu(on) {
    menu.hidden = !on;
    runBtn.setAttribute('aria-expanded', String(on));
    if (on) {
      paintMenu();
      window.TnaiFloat?.attach(runBtn, menu, { placement: 'bottom-end', offset: 8 });
      (menu.querySelector('.lpp-mrow') || menu.querySelector('button'))?.focus();
    }
  }
  runBtn.addEventListener('click', event => {
    event.stopPropagation();
    setMenu(!menuOpen());
  });
  const outside = event => {
    if (menuOpen() && !runWrap.contains(event.target)) setMenu(false);
  };

  function paintMenu() {
    const tabs = lp.tabs(),
      scripts = lp.scripts(),
      hasFolder = !!lp.project();
    runBtn.dataset.live = String(
      scripts.some(s => live(tabs.find(t => t.kind === 'script' && t.script === s.name)))
    );
    if (!menuOpen()) return;
    const head = el('div', 'lpp-mhead');
    head.append(el('b', '', 'Run a script'), el('small', '', scripts[0]?.run?.split(' ')[0] || ''));
    head.lastChild.title = 'Package manager used to run scripts';
    const rows = [head];
    if (!hasFolder) {
      rows.push(
        el(
          'p',
          'lpp-note',
          'No project folder open. Open one first; its dev server can then be started here.'
        ),
        button(
          'Open a project folder',
          'Choose the folder of the project to preview',
          'lp-go',
          () => {
            setMenu(false);
            openFolder();
          }
        )
      );
    } else if (!scripts.length) {
      rows.push(
        el(
          'p',
          'lpp-note',
          'No dev, start, serve or preview script in package.json. If your app runs another way, type its address in the address bar.'
        )
      );
    } else {
      rows.push(
        el(
          'p',
          'lpp-note',
          'Start runs the script in a thread. Your app shows here once it is ready.'
        )
      );
      scripts.forEach(s => {
        const tab = tabs.find(t => t.kind === 'script' && t.script === s.name),
          info = tab ? lp.status(tab.id) : null;
        const r = el('div', 'lpp-mrow' + (tab?.active ? ' active' : ''));
        r.setAttribute('role', 'menuitem');
        r.tabIndex = 0;
        const d = el('i', 'bw-dot');
        d.dataset.s = info?.dot || '';
        const detail = info && tab.state !== 'idle' ? info.text : 'Not running · ' + s.run;
        const name = el('b', '', s.name),
          sub = el('small', '', detail);
        name.title = s.name;
        sub.title = detail;
        const act = live(tab)
          ? button('Stop', 'Stop this dev server', 'lp-stop', () => lp.stop(tab.id))
          : button('Start', 'Run ' + s.run + ' in a new thread and show it here', 'lp-go', () => {
              setMenu(false);
              lp.start(lp.addScript(s.name));
            });
        r.append(d, name, act, sub);
        const pick = () => {
          lp.addScript(s.name);
          setMenu(false);
        };
        r.addEventListener('click', pick);
        r.addEventListener('keydown', event => {
          if (event.target === r && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            pick();
          }
        });
        rows.push(r);
      });
    }
    menu.replaceChildren(...rows);
  }
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setMenu(false);
      runBtn.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.lpp-mrow')],
      i = items.indexOf(event.target.closest('.lpp-mrow'));
    if (!items.length) return;
    event.preventDefault();
    items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  });

  // ---------- Terminal drawer: the terminal panels of this project's preview scripts, plus
  // PowerShell terminals added here. One live view (33's Build terminal: the same pty mirrored,
  // sized by 10's one-driver rule), switched between them by the tabs.
  const DKEY = 'tnai.live-preview-drawer.v1';
  const dstate = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(DKEY) || '{}') || {};
      return {
        open: v.open === true,
        h: Number(v.h) || 200,
        pick: String(v.pick || ''),
        extra: Array.isArray(v.extra) ? v.extra.map(String).slice(-12) : [],
      };
    } catch {
      return { open: false, h: 200, pick: '', extra: [] };
    }
  })();
  const saveDrawer = () => {
    try {
      localStorage.setItem(DKEY, JSON.stringify(dstate));
    } catch {}
  };
  const drawer = $('.lpp-drawer'),
    dtabs = $('.lpp-dtabs'),
    dbody = $('.lpp-dbody'),
    dslot = $('.lpp-dslot'),
    dhead = $('.lpp-dhead');
  const dtitle = $('.lpp-dtitle'),
    dfold = $('.lpp-dfold'),
    dadd = $('.lpp-dadd'),
    dopen = $('.lpp-dopen'),
    grip = $('.lpp-grip');
  const STATUS = {
    starting: 'Starting…',
    working: 'Working',
    waiting: 'Waiting for input',
    'waiting-agents': 'Waiting on agents',
    background: 'Working in background',
    'needs-you': 'Needs you',
    'not-started': 'Not started',
    exited: 'Exited',
    error: 'Stopped with an error',
  };
  const termView = {
    panel: { config: { paneId: '' } },
    body: dbody,
    slot: dslot,
    head: dhead,
    kind: 'terminal',
  };
  let term = null,
    dframe = 0,
    looked = false;
  const seenPanes = new Set();
  const scheduleDrawer = () => {
    if (!dframe)
      dframe = requestAnimationFrame(() => {
        dframe = 0;

        // The tabs are built anew each time: with a press in progress on them, they are painted
        // right after that press, so the pressed tab still gets its click.
        if (!window.TnaiPress?.defer(dtabs, paintDrawer)) paintDrawer();
      });
  };
  const sessionsNow = () => window.TnaiAgents?.sessions?.() || [];

  function entries() {
    const sessions = sessionsNow(),
      find = id => sessions.find(s => s.paneId === id),
      out = [];
    lp.tabs().forEach(t => {
      if (
        t.kind !== 'script' ||
        !t.paneId ||
        !find(t.paneId) ||
        out.some(e => e.paneId === t.paneId)
      )
        return;
      out.push({
        paneId: t.paneId,
        name: t.script,
        dot: lp.status(t.id)?.dot || '',
        title: 'Terminal running ' + t.script,
      });
    });
    dstate.extra.forEach(id => {
      const s = find(id);
      if (!s || out.some(e => e.paneId === id)) return;
      out.push({
        paneId: id,
        name: s.name || 'PowerShell',
        dot: s.running ? 'working' : s.status === 'error' ? 'error' : '',
        title: (s.name || 'PowerShell') + ' · added here',
        extra: true,
      });
    });
    return out;
  }

  function paintDrawer() {
    drawer.dataset.open = String(dstate.open);
    drawer.style.setProperty('--lpp-dh', dstate.h + 'px');
    dtitle.setAttribute('aria-expanded', String(dstate.open));
    dfold.setAttribute('aria-label', dstate.open ? 'Collapse the terminals' : 'Show the terminals');
    dfold.title = dstate.open ? 'Collapse' : 'Show the terminals';
    dfold.textContent = dstate.open ? '⌄' : '⌃';
    if (!visible()) return;
    const list = entries();

    // A script started since the last look: its terminal panel becomes the one shown.
    const fresh = list.find(e => !e.extra && !seenPanes.has(e.paneId));
    if (fresh && looked) {
      dstate.pick = fresh.paneId;
      saveDrawer();
    }
    list.forEach(e => seenPanes.add(e.paneId));
    looked = true;
    const pick = list.some(e => e.paneId === dstate.pick) ? dstate.pick : list[0]?.paneId || '';
    dtabs.replaceChildren(
      ...list.map(e => {
        const t = el('div', 'lpp-dtab' + (e.paneId === pick ? ' active' : ''));
        t.title = e.title;
        const b = el('button', 'lpp-dtab-name');
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(e.paneId === pick));
        const d = el('i', 'bw-dot');
        d.dataset.s = e.dot;
        b.append(d, el('span', '', e.name));
        b.onclick = () => {
          dstate.pick = e.paneId;
          if (!dstate.open) dstate.open = true;
          saveDrawer();
          paintDrawer();
        };
        t.append(b);
        if (e.extra) {
          const x = el('button', 'lpp-dtab-close', '×');
          x.type = 'button';
          x.title = 'Close this terminal';
          x.setAttribute('aria-label', 'Close ' + e.name);
          x.onclick = async () => {
            await window.TnaiLiveTasks?.close?.(e.paneId, drawer);
            scheduleDrawer();
          };
          t.append(x);
        }
        return t;
      })
    );
    dopen.hidden = !pick;
    if (!dstate.open) return;
    if (!pick) {
      if (term && termView.panel.config.paneId) {
        termView.panel.config.paneId = '';
        term.update();
      }
      const note = el('p', 'lpp-note lpp-dempty');
      note.append(
        'No terminals yet. Start a script from ▶ Run, or press ＋ for a PowerShell terminal here.'
      );
      dbody.replaceChildren(note);
      return;
    }
    if (!term)
      term =
        window.TnaiBuildTerminal?.mount(termView, {
          save: saveDrawer,
          schedule: scheduleDrawer,
          STATUS,
        }) || null;
    if (!term) {
      dbody.replaceChildren(
        el('p', 'lpp-note lpp-dempty', 'Terminals are not available in this build.')
      );
      return;
    }
    termView.panel.config.paneId = pick;
    term.update();
  }
  const setOpen = on => {
    dstate.open = !!on;
    saveDrawer();
    paintDrawer();
    if (on) requestAnimationFrame(() => term?.shown?.());
  };
  dtitle.onclick = () => setOpen(!dstate.open);
  dfold.onclick = () => setOpen(!dstate.open);
  dopen.onclick = () => {
    const id = termView.panel.config.paneId;
    if (id) window.TnaiLiveTasks?.focusPane?.(id);
  };
  dadd.onclick = async () => {
    const start = window.TnaiBuildTerminal?.startNew;
    if (!start) {
      say('Terminals are not available in this build.');
      return;
    }
    dadd.disabled = true;
    const result = await start('Terminal').catch(error => ({ ok: false, error: error?.message }));
    dadd.disabled = false;
    if (!result?.ok) {
      say(result?.error || 'Could not start a terminal');
      return;
    }
    const alive = new Set(sessionsNow().map(s => s.paneId));
    dstate.extra = [...dstate.extra.filter(id => alive.has(id)), result.paneId].slice(-12);
    dstate.pick = result.paneId;
    dstate.open = true;
    saveDrawer();
    paintDrawer();
    requestAnimationFrame(() => term?.focus?.());
  };

  // Resize by the top edge (pointer or ↑ / ↓), between 120px and all but 160px of the page.
  const clampH = h =>
    Math.round(
      Math.max(120, Math.min(h, Math.max(160, page.querySelector('.lpp-body').clientHeight - 160)))
    );
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    if (!dstate.open) {
      dstate.open = true;
      paintDrawer();
    }
    const y0 = event.clientY,
      h0 = drawer.getBoundingClientRect().height;
    drawer.classList.add('lpp-dragging');
    const move = e => {
      dstate.h = clampH(h0 + y0 - e.clientY);
      drawer.style.setProperty('--lpp-dh', dstate.h + 'px');
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      drawer.classList.remove('lpp-dragging');
      saveDrawer();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    dstate.h = clampH(dstate.h + (event.key === 'ArrowUp' ? 24 : -24));
    if (!dstate.open) dstate.open = true;
    saveDrawer();
    paintDrawer();
  });
  window.TnaiAgents?.onChange?.(() => {
    if (visible()) scheduleDrawer();
  });

  // ---------- Stage settings: Side by side on (tnai.live-preview-stage.v1).
  const SKEY = 'tnai.live-preview-stage.v1';
  const sstate = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(SKEY) || '{}') || {};
      return { sbs: !!v.sbs };
    } catch {
      return { sbs: false };
    }
  })();
  const saveStage = () => {
    try {
      localStorage.setItem(SKEY, JSON.stringify(sstate));
    } catch {}
  };

  // ---------- Side by side: the main view (whatever device is picked) plus live mirrors (31) of
  // the other two devices, in device order. The mirrors exist only while Side by side is on, the
  // page is shown and the preview is docked, so there is no extra load otherwise.
  const DEVICES = ['desktop', 'tablet', 'phone'];
  const sbsBtn = el('button', 'lp-btn lpp-sbs-btn');
  sbsBtn.type = 'button';
  sbsBtn.innerHTML =
    // 107 swaps the drawing for the group of three device characters
    '<svg viewBox="0 0 20 14" aria-hidden="true"><rect x=".75" y="1.75" width="9.5" height="10.5" rx="1.5"/><rect x="11.75" y="2.75" width="4.5" height="8.5" rx="1.2"/><rect x="17.25" y="4.75" width="2" height="4.5" rx=".8"/></svg><span class="dvc-lbl">Side by side</span>';
  const mirrors = new Map(); // device -> { host, view }
  const lpRoot = () => stage.querySelector('.lp');
  const mainDevice = () => stage.querySelector('.lp-stage')?.dataset.device || 'desktop';

  // One height for all three views:
  // the tallest height at which the three frames fit the row side by side, never above
  // a device's real size. The columns get each frame's width plus SIDE_PAD, so 31's own fitting
  // (frame into its box) gives every frame that height: one top line, one bottom line, one caption
  // line, equal gaps, the row centered.
  const SIDE_PAD = 32,
    mainCap = el('div', 'lpp-main-cap');

  function layoutSides() {
    const lpEl = lpRoot();
    if (!lpEl?.hasAttribute('data-sbs') || !lp.deviceBox) return;
    const boxes = DEVICES.map(d => lp.deviceBox(d));
    if (boxes.some(b => !b)) return;

    // the stage row (chrome, stage, dock)
    const rowH = parseFloat(getComputedStyle(lpEl).gridTemplateRows.split(' ')[1]) || 0;
    const ratio = boxes.reduce((t, b) => t + b.w / b.h, 0),
      bezels = boxes.reduce((t, b) => t + 2 * b.b * (1 - b.w / b.h), 0);
    const h = Math.floor(
      Math.max(
        120,
        Math.min(
          rowH - 40,
          (lpEl.clientWidth - 16 - 3 * SIDE_PAD - bezels) / ratio,
          ...boxes.map(b => b.h + 2 * b.b)
        )
      )
    );
    const cols = boxes.map(b => Math.ceil(((h - 2 * b.b) * b.w) / b.h + 2 * b.b) + SIDE_PAD);
    lpEl.style.setProperty('--lpp-sbs-h', h + 'px');
    lpEl.style.gridTemplateColumns =
      'minmax(0,1fr) ' + cols.map(c => c + 'px').join(' ') + ' minmax(0,1fr)';
    lpEl.setAttribute('data-sbs', 'fit');
  }

  function paintMainCap() {
    // the main view's caption, like the mirrors' own: device · size · zoom
    const d = mainDevice(),
      b = lp.deviceBox?.(d),
      // the label is empty with no tab open: the device's size then
      shown = (lpRoot()?.querySelector('.lp-size-label')?.textContent || '').trim();
    const text =
      d[0].toUpperCase() +
      d.slice(1) +
      ' · ' +
      // size · zoom like the mirrors' captions; the emulation note stays in the dock's label, it
      // does not fit under a phone
      (shown.split(' · ').slice(0, 2).join(' · ') || (b ? b.w + '×' + b.h : ''));
    mainCap.dataset.device = d;
    if (mainCap.textContent !== text) mainCap.textContent = text;

    // no tab: the stage holds the page's "Nothing to preview yet" text, which needs the row's full
    // height
    lpRoot()?.toggleAttribute('data-sbs-empty', !shown);
  }

  // laid out in the next frame: changing the columns inside the observer's own callback is reported
  // as a ResizeObserver loop
  let sideFrame = 0;
  const RO = window.ResizeObserver,
    sideRO =
      typeof RO === 'function'
        ? new RO(() => {
            if (!sideFrame)
              sideFrame = requestAnimationFrame(() => {
                sideFrame = 0;
                layoutSides();
              });
          })
        : null;
  const capWatch = new MutationObserver(paintMainCap);

  function dropSides() {
    mirrors.forEach(m => {
      m.view?.destroy();
      m.host.remove();
    });
    mirrors.clear();
    sideRO?.disconnect();
    capWatch.disconnect();
    mainCap.remove();
    const lpEl = lpRoot();
    if (!lpEl) return;
    lpEl.removeAttribute('data-sbs');
    lpEl.removeAttribute('data-sbs-empty');
    lpEl.style.removeProperty('--lpp-sbs-h');
    lpEl.style.gridTemplateColumns = '';
  }

  function syncSides() {
    const lpEl = lpRoot(),
      on = sstate.sbs && visible() && !out && !!lpEl && !!lp.mirror;
    sbsBtn.setAttribute('aria-pressed', String(sstate.sbs && !out));
    sbsBtn.disabled = !!out || !lp.mirror;
    sbsBtn.title = out
      ? 'Bring the preview back to show it side by side'
      : sstate.sbs
        ? 'Show one device again'
        : 'Show this address as Desktop, Tablet and Phone at once (each a real live view)';
    if (!on) {
      dropSides();
      return;
    }
    if (!lpEl.hasAttribute('data-sbs')) {
      lpEl.setAttribute('data-sbs', '');
      lpEl.append(mainCap);
      sideRO?.observe(lpEl);
      const label = lpEl.querySelector('.lp-size-label');
      if (label) capWatch.observe(label, { childList: true, characterData: true, subtree: true });
    }
    paintMainCap();
    layoutSides();
    const want = DEVICES.filter(d => d !== mainDevice());
    mirrors.forEach((m, d) => {
      if (!want.includes(d)) {
        m.view?.destroy();
        m.host.remove();
        mirrors.delete(d);
      }
    });
    want.forEach(d => {
      if (mirrors.has(d)) return;
      const host = el('div', 'lpp-mirror');
      lpEl.append(host);
      mirrors.set(d, { host, view: lp.mirror(host, d) });
    });
  }
  sbsBtn.addEventListener('click', event => {
    event.stopPropagation();
    sstate.sbs = !sstate.sbs;
    saveStage();
    syncSides();
  });
  const deviceWatch = new MutationObserver(() => {
    if (sstate.sbs) syncSides();
  }); // the device picker changed the main view

  // ---------- An agent's file write reloads the Side-by-side mirrors (debounced): mirrors of an
  // app without hot reload would keep showing the old page; the main view already follows its own
  // reload path (31). From 13's latest file action per agent (push event tnai:file-activity).
  const WRITE =
    /^(Write|Writing|Wrote|WriteFile|Edit|Edited|Editing|MultiEdit|Update|Updated|Updating|Create|Created|Creating|Modified|Delete|Deleted|Replace|Patch|Patched|Added|Changed)$/;
  const lastAt = new Map(); // paneId -> time of its last seen write
  let mirrorTimer = 0;

  function collect() {
    const fa = window.TnaiFileActivity;
    if (!fa?.now) return;
    let added = false;
    sessionsNow().forEach(s => {
      // a shell running the dev server "touches" the files it serves
      if (s.agent === 'Terminal') return;
      const a = fa.now(s.paneId);
      if (!a || !WRITE.test(a.verb) || lastAt.get(s.paneId) === a.at) return;
      lastAt.set(s.paneId, a.at);
      added = true;
    });
    if (added && mirrors.size) {
      clearTimeout(mirrorTimer);
      mirrorTimer = setTimeout(() => mirrors.forEach(m => m.view?.reload()), 900);
    }
  }
  window.addEventListener('tnai:file-activity', collect);
  window.addEventListener('tnai:project-changed', () => lastAt.clear());

  function render() {
    if (!visible()) return;
    paintMenu();
    paintDrawer();
    syncSides();
  }
  lp.onChange(render);

  // Page routing: 08 has no route for this page, so it is shown here and hidden again when any
  // other page mode is set. Mounted once and kept, so coming back is instant and each page keeps
  // its state.
  function open() {
    layout.classList.remove(...OTHER_MODES);
    layout.classList.add('preview-mode');
    document
      .querySelectorAll('.side-item')
      .forEach(item => item.classList.toggle('active', item.dataset.view === 'live-preview'));
    if (!view) {
      view = lp.mount(stage, { browser: true, blank: paintBlank });
      addTools();
    }
    view.update();
    collect();
    render();
    requestAnimationFrame(() => term?.shown?.());
  }

  // ---------- Pop out: the page's preview (same 31 view, same tabs and servers) moves into its own
  // OS window the user can place anywhere and keep on top; it keeps running while any other page is
  // open (desktop/panel-windows.js, the Build panel's tnai-panel-* mechanism, so 31 sizes it to the
  // device and the desktop process keeps its device emulation). The stage shows "Show window /
  // Bring back" meanwhile; closing the window brings it back. Position and On top are remembered
  // (tnai.live-preview-popout.v1); after a reload it starts docked. The terminal drawer stays on
  // the page.
  const FRAME = 'tnai-panel-live-preview',
    KEY = 'tnai.live-preview-popout.v1',
    native = window.tnaiNative;
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch {
      return {};
    }
  };
  const store = patch => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
    } catch {}
  };
  let out = null,
    popBtn = null,
    onTopLabel = null,
    onTopBox = null;

  function addTools() {
    const bar = stage.querySelector('.lp-bar'),
      strip = stage.querySelector('.lp-tabs'),
      lpEl = lpRoot();
    if (!bar) return;

    // Browser chrome along the stage's top edge,
    // built from 31's own controls, only
    // moved (no frame moves, so nothing reloads): a tab row (tabs, ＋, Pop out at the far right)
    // over an address row (← → ↻, the address box holding the status dot, its note and Open in
    // browser, ▶ Run). The device controls (Desktop / Tablet / Phone, size, zoom, Rotate, Side by
    // side) sit in a dock under the frame they change.
    const chrome = el('div', 'lpp-chrome'),
      tabrow = el('div', 'lpp-tabrow'),
      omni = el('div', 'lpp-omni'),
      dock = el('div', 'lpp-dock');
    dock.setAttribute('role', 'toolbar');
    dock.setAttribute('aria-label', 'Device');
    const q = sel => bar.querySelector(sel),
      urlBox = q('.lp-url'),
      external = q('[data-act=external]');
    const deviceTools = ['.lp-modes', '.lp-size', '.lp-size-label', '.lp-rotate']
      .map(q)
      .filter(Boolean);
    if (strip) tabrow.append(strip);
    lpEl.prepend(chrome);
    chrome.append(tabrow, bar);
    if (urlBox) {
      urlBox.before(omni);
      omni.append(...[q('.lp-state'), urlBox, external].filter(Boolean));
    }
    dock.append(...deviceTools, sbsBtn);
    lpEl.append(dock);

    // 107: the device characters as the dock's buttons (the group first) and the device objects
    // over the stage
    window.TnaiDevicePicker?.attach(stage, dock);

    // One character shows that device alone (leaves Side by side); 31's own handler has already
    // switched the device. A new size or a rotation changes a frame's shape, so the three are laid
    // out again once 31 has saved it.
    dock.addEventListener('click', event => {
      if (sstate.sbs && event.target.closest('.lp-modes button')) {
        sstate.sbs = false;
        saveStage();
        syncSides();
      } else if (event.target.closest('.lp-rotate')) setTimeout(layoutSides, 0);
    });
    dock.addEventListener('change', () => setTimeout(layoutSides, 0));
    const lpStage = lpEl.querySelector('.lp-stage');
    if (lpStage)
      deviceWatch.observe(lpStage, { attributes: true, attributeFilter: ['data-device'] });
    bar.append(runWrap);
    if (!native.panels) return;
    popBtn = button('⧉ Pop out', '', 'lpp-pop', () => (out ? dock() : popOut()));
    onTopLabel = el('label', 'lp-btn lpp-ontop');
    onTopLabel.title = 'Keep this window above other windows';
    onTopLabel.hidden = true;
    onTopBox = el('input');
    onTopBox.type = 'checkbox';
    onTopBox.className = 'tnai-switch';
    onTopBox.setAttribute('role', 'switch');
    onTopLabel.append('On top', onTopBox);
    onTopBox.addEventListener('change', () => setOnTop(onTopBox.checked));
    tabrow.append(popBtn, onTopLabel);
    paintPop();
  }
  document.addEventListener('pointerdown', outside, true);

  function paintPop() {
    if (!popBtn) return;
    popBtn.innerHTML = out
      ? window.TnaiIcon('minimize-2', { size: 14 }) + ' <span class="lpp-lbl">Bring back</span>'
      : window.TnaiIcon('picture-in-picture-2', { size: 14 }) +
        ' <span class="lpp-lbl">Pop out</span>'; // the word gives way on a narrow stage
    popBtn.title = out
      ? 'Put the preview back into Technically Not'
      : 'Open the preview in its own window: place it anywhere, keep it on top, use it from any page';
    popBtn.setAttribute('aria-label', out ? 'Bring the preview back' : 'Pop out the preview');
    onTopLabel.hidden = !out;
  }

  function copyHead(doc) {
    doc.head.querySelectorAll('[data-tnai-copy]').forEach(n => n.remove());
    document.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(n => {
      const c = n.cloneNode(true);
      if (c.tagName === 'LINK') c.href = n.href;
      c.dataset.tnaiCopy = '';
      doc.head.append(c);
    });
    const theme = document.documentElement.dataset.theme;
    theme
      ? (doc.documentElement.dataset.theme = theme)
      : doc.documentElement.removeAttribute('data-theme');
    doc.documentElement.dataset.accent = document.documentElement.dataset.accent || 'purple';
  }
  window.addEventListener('tnai:theme-changed', () => {
    if (out && !out.win.closed) copyHead(out.win.document);
  });
  const saveSpot = w => {
    try {
      if (w && !w.closed && w.outerWidth > 0) store({ x: w.screenX, y: w.screenY });
    } catch {}
  };

  function setOnTop(on) {
    store({ onTop: !!on });
    if (onTopBox) onTopBox.checked = !!on;
    if (!out || !native.panels?.setOnTop) return false;
    const o = out,
      apply = tries =>
        native.panels
          .setOnTop(FRAME, !!on)
          .then(done => {
            if (!done && tries && out === o) setTimeout(() => apply(tries - 1), 150);
          })
          .catch(() => {});
    apply(5);
    return true;
  }

  function popOut() {
    const lpEl = stage.querySelector('.lp');
    if (!native.panels || !view || !lpEl) return false;
    if (out && !out.win.closed) {
      out.win.focus();
      return true;
    }
    const saved = load(),
      r = stage.getBoundingClientRect();
    const at =
      Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? ',left=' + Math.round(saved.x) + ',top=' + Math.round(saved.y)
        : '';
    const win = window.open(
      'about:blank',
      FRAME,
      'width=' +
        Math.round(Math.max(600, r.width)) +
        ',height=' +
        Math.round(Math.max(420, r.height)) +
        at
    );
    if (!win) {
      say('Could not open a separate window');
      return false;
    }
    setMenu(false);
    dropSides(); // the mirrors stay on the page only: removed before the view moves
    const doc = win.document;
    copyHead(doc);
    doc.title = 'Live preview · Technically Not';
    doc.body.className = 'bw-popout-body';
    doc.body.replaceChildren(lpEl);
    doc.addEventListener('pointerdown', outside, true);
    const away = el('div', 'bw-away'),
      actions = el('div');
    away.style.cssText = 'position:absolute;inset:0;z-index:2';
    const show = el('button', '', 'Show window'),
      back = el('button', 'primary', 'Bring back');
    show.type = back.type = 'button';
    show.onclick = () => out?.win.focus();
    back.onclick = () => dock();
    actions.append(show, back);
    away.append(el('b', '', 'Live preview'), 'Open in separate window', actions);
    stage.append(away);
    out = {
      win,
      away,
      lpEl,
      unframe: window.TnaiWindowFrame?.attach(
        win,
        lpEl.querySelector('.lpp-tabrow') || lpEl.querySelector('.lp-bar')
      ),
    };
    paintPop(); // window buttons in its top row (66)
    onTopBox.checked = false;
    if (saved.onTop) setOnTop(true);
    win.addEventListener('pagehide', () => {
      if (out?.win === win) dock();
    }); // the user closed the window
    win.addEventListener('beforeunload', () => saveSpot(win));
    window.dispatchEvent(
      new CustomEvent('tnai:panel-popout', { detail: { id: 'live-preview', win } })
    ); // 70 binds the voice key there
    view.moved?.();
    win.focus();
    return true;
  }

  function dock() {
    if (!out) return false;
    const { win, away, lpEl, unframe } = out;
    out = null;
    unframe?.();
    saveSpot(win);
    away.remove();
    setMenu(false);
    stage.prepend(lpEl);
    if (!win.closed) win.close();
    paintPop();
    view?.moved?.();
    render();
    syncSides();
    return true;
  }
  window.addEventListener('tnai:lock', () => {
    if (out) dock();
  }); // plan lock (34): pop-outs come back
  window.addEventListener('pagehide', () => {
    if (out) {
      saveSpot(out.win);
      if (!out.win.closed) out.win.close();
    }
  }); // Technically Not reloading or closing

  document.addEventListener(
    'click',
    event => {
      if (!event.target.closest?.('.side-item[data-view="live-preview"]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      open();

      // the user's own click on the menu: the device objects, once per app run (107)
      if (event.isTrusted) window.TnaiDevicePicker?.auto();
    },
    true
  );
  new MutationObserver(() => {
    if (visible() && OTHER_MODES.some(m => layout.classList.contains(m))) {
      layout.classList.remove('preview-mode');
      setMenu(false);
      syncSides();
    }
  }).observe(layout, { attributes: true, attributeFilter: ['class'] });

  window.TnaiLivePreviewPage = {
    open,
    visible,
    popOut,
    dock,
    isOut: () => !!out,
    window: () => out?.win || null,
    setOnTop,
  };
})();
