// Technically Not · 31-live-preview.js — Desktop only: live preview of the user's project from its
// dev server on localhost. A package.json script (dev/start/serve/preview) runs as a real Terminal
// pane; its served URL is read from the pane's output (push, pty data events) and embedded; several
// previews as tabs (script or manual localhost URL), saved per project folder; a tab an agent in
// its own worktree showed is labeled ⎇ <worktree> (req.lane). Device frames: Desktop/Tablet/Phone
// with real device sizes (a rotate toggle for Phone/Tablet; Phone/Tablet drawn in a bezel and, in
// the desktop app, emulated inside the frame only: device user agent + touch via
// desktop/preview-emulation.js; a popped-out panel window is sized to the device), the frame sized
// to the real CSS-pixel viewport and scaled down to fit the panel with a CSS transform so media
// queries fire correctly; last size/rotation remembered per device (tnai.live-preview-device.v1).
// Shown by the Build workspace "Live preview" panel (23) and the Live preview page (65), which
// mounts it as a browser (mount(body, { browser: true, blank })): back / forward inside the frame's
// own history and the address it moved to after a click, read in the desktop process (preview:nav),
// an address bar that is always there (Enter opens a localhost address, in a new tab unless the tab
// shows a running page), and blank(node) fills the stage when no tab is shown. Agents show what
// they built here with `tnai preview URL [device]` (desktop/agent-mesh.js → `preview:show`): tab
// selected, device view set, page opened when no preview is on screen; a tab an agent's request
// created closes when that agent's terminal panel closes, or when that agent runs `tnai preview
// close [URL]`. Side-by-side (65): mirror(host, device) adds one more real, emulated iframe of the
// shown tab's address at a fixed device, made only while shown. window.TnaiLivePreview (mount,
// mirror, show (the `tnai_preview` tool's open, through 196), laneName, tabs, localUrl, addUrl,
// addScript, start, stop, close, select, scripts,
// project, status).
(() => {
  const native = window.tnaiNative;
  if (!native?.pty || !native?.fs) return;

  const KEY = 'tnai.live-preview.v1';
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
  const SCRIPT_NAMES = /^(dev|start|serve|preview)(?:$|[:\-_.])/;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const uid = () => 'lp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------------------------------------------------------------- device frames: real CSS-pixel
  // viewport sizes
  const DEVICE_LABEL = { desktop: 'Desktop', tablet: 'Tablet', phone: 'Phone' };
  const DEVICE_SIZES = {
    phone: [
      { id: 'se', label: 'iPhone SE', w: 375, h: 667 },
      { id: 'i15', label: 'iPhone 15/16', w: 393, h: 852 },
      { id: 'i15pm', label: 'iPhone 15/16 Pro Max', w: 430, h: 932 },
      { id: 'pixel8', label: 'Pixel 8', w: 412, h: 915 },
      { id: 's24', label: 'Galaxy S24', w: 360, h: 780 },
      { id: 'sm', label: 'Small Android', w: 360, h: 640 },
    ],
    tablet: [
      { id: 'ipadmini', label: 'iPad mini', w: 744, h: 1133 },
      { id: 'ipad10', label: 'iPad 10th gen', w: 820, h: 1180 },
      { id: 'ipadair', label: 'iPad Air / Pro 11″', w: 834, h: 1194 },
      { id: 'ipadpro13', label: 'iPad Pro 13″', w: 1032, h: 1376 },
      { id: 'tabs9', label: 'Galaxy Tab S9', w: 800, h: 1280 },
      { id: 'surfacepro', label: 'Surface Pro', w: 912, h: 1368 },
    ],
    // Desktop always fills the preview area and grows with it (no small
    // fixed screen inside the area), so it has no size to pick and the size box is hidden for it. A
    // fixed desktop size saved by an older build falls back to this one.
    desktop: [{ id: 'fit', label: 'Fit to panel', w: 0, h: 0 }],
  };

  // Desktop's size next to the other two in Side by side
  const DESKTOP_SBS = { id: 'laptop', label: '1280×800 laptop', w: 1280, h: 800 };
  const DEVICE_DEFAULT = { phone: 'i15', tablet: 'ipad10', desktop: 'fit' };
  const DEVICE_KEY = 'tnai.live-preview-device.v1';

  // Device bezel around a Phone/Tablet screen: thickness in screen px, screen corner radius in the
  // device's CSS px (scaled with it).
  const BEZEL = { phone: { b: 10, r: 34 }, tablet: { b: 14, r: 18 } };
  let mounts = 0;

  function loadDevicePrefs() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
    } catch {}
    const prefs = { device: DEVICE_SIZES[saved.device] ? saved.device : 'desktop' };
    for (const d of ['phone', 'tablet', 'desktop']) {
      const list = DEVICE_SIZES[d],
        has = id => list.some(s => s.id === id);
      prefs[d] = {
        size: has(saved[d]?.size) ? saved[d].size : DEVICE_DEFAULT[d],
        landscape: !!saved[d]?.landscape,
      };
    }
    return prefs;
  }

  function saveDevicePrefs(prefs) {
    try {
      localStorage.setItem(DEVICE_KEY, JSON.stringify(prefs));
    } catch {}
  }

  // The only addresses Technically Not embeds: http(s) on this computer. Returns the normalized
  // URL, or '' when refused. [::1] becomes localhost (Chromium tries ::1 for localhost too),
  // because CSP frame-src cannot name an IPv6 host (index.html).
  function localUrl(raw) {
    let text = String(raw || '').trim();
    if (!text) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'http://' + text;
    try {
      const url = new URL(text);
      if (
        !/^https?:$/.test(url.protocol) ||
        !LOCAL_HOSTS.has(url.hostname) ||
        url.username ||
        url.password
      )
        return '';
      if (url.hostname === '[::1]') url.hostname = 'localhost';
      return url.href;
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------- styles

  // ---------------------------------------------------------------- state (data; the DOM is a
  // view)
  let root = ''; // connected project folder
  let scripts = []; // [{ name, command }] offered from package.json
  let runner = 'npm'; // npm / pnpm / yarn / bun, from the lock file

  // { id, kind: 'script'|'url', script, url, paneId, state, exitCode, stopped, error }
  let tabs = [];
  let activeId = '';

  // paneId -> recent output (ANSI stripped), for URL detection across chunk borders
  const tails = new Map();
  const views = new Set();
  const listeners = new Set();

  const store = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };

  function persist() {
    if (!root) return;
    const all = store();

    // Only what to show, never running state: script names and manual URLs (the pane id lets a
    // reloaded window re-find a server still running). A `tnai show` page (t.file) is not saved:
    // its address ends with the app, and whatever later answers on that port must not be embedded.
    const kept = tabs.filter(t => !t.file);
    all[root] = {
      tabs: kept.map(t =>
        t.kind === 'url'
          ? { kind: 'url', url: t.url, by: t.by || '', byPane: t.byPane || '', lane: t.lane || '' }
          : { kind: 'script', script: t.script, paneId: t.paneId || '' }
      ),
      active: Math.max(
        0,
        kept.findIndex(t => t.id === activeId)
      ),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  }

  // A renamed agent: the URL tabs it opened say "Shown by <new name>" (the tab keeps the name as
  // text, the pane id tells whose it is).
  window.addEventListener('tnai:terminal-pane-renamed', e => {
    const d = e.detail || {};
    if (!d.paneId || !d.name || !d.previous) return;
    let any = false;
    for (const t of tabs)
      if (t.kind === 'url' && t.byPane === d.paneId && t.by && t.by.includes(d.previous)) {
        t.by = t.by.replace(d.previous, d.name).slice(0, 80);
        any = true;
      }
    if (any) {
      persist();
      paint();
    }
  });
  let frame = 0;

  function paint() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;

        // A view builds its tabs and notices anew: one with a press in progress on it is painted
        // right after that press, so the pressed button still gets its click.
        views.forEach(v => {
          if (!window.TnaiPress?.defer(v.box, v.render)) v.render();
        });
        listeners.forEach(fn => {
          try {
            fn();
          } catch {}
        });
      });
  }

  const tabByPane = paneId =>
    tabs.find(
      t =>
        t.kind === 'script' &&
        t.paneId === paneId &&
        (t.state === 'starting' || t.state === 'running')
    );

  // a worktree's ⎇ short name (its branch without tnai/)
  const laneName = branch => String(branch || '').replace(/^tnai\//, '');
  const commandFor = script =>
    runner +
    ' run ' +
    (/^[\w:.\-]+$/.test(script) ? script : "'" + script.replace(/'/g, "''") + "'");

  // ---------------------------------------------------------------- project folder + package.json
  async function readText(rel, max = 256 * 1024) {
    const stat = await native.fs.stat(rel);
    if (!stat?.ok) return null;
    const read = await native.fs.read(rel, 0, Math.min(stat.value.size, max));
    if (!read?.ok) return null;
    return new TextDecoder().decode(read.value);
  }

  // A project switch while the files are read: what was read belongs to the old folder (a read
  // started there ends in the new one), so it is dropped; the new project reads its own.
  async function readScripts() {
    const forRoot = root;
    let found = [];
    try {
      const pkg = JSON.parse((await readText('package.json')) || 'null');
      const all = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      found = Object.keys(all)
        .filter(name => SCRIPT_NAMES.test(name) && typeof all[name] === 'string')
        .map(name => ({ name, command: all[name] }));
    } catch {}
    const locks = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
      ['bun.lock', 'bun'],
    ];
    let foundRunner = 'npm';
    for (const [file, tool] of locks)
      if ((await native.fs.stat(file))?.ok) {
        foundRunner = tool;
        break;
      }
    if (root !== forRoot) return;
    runner = foundRunner;
    scripts = found;
    paint();
  }

  // Two quick project switches: the older pass stops at its next wait, so it never paints the old
  // project's scripts or reattaches its servers under the new one.
  let syncSeq = 0;

  async function syncProject() {
    const now = (await native.fs.root()) || '';
    if (now === root) return;
    root = now;
    const seq = ++syncSeq;
    tabs = [];
    activeId = '';
    scripts = [];
    if (!root) {
      paint();
      return;
    }
    const saved = store()[root];
    (Array.isArray(saved?.tabs) ? saved.tabs : []).forEach(t => {
      if (t?.kind === 'url' && localUrl(t.url))
        tabs.push({
          id: uid(),
          kind: 'url',
          url: localUrl(t.url),
          state: 'manual',
          by: String(t.by || ''),
          byPane: String(t.byPane || ''),
          lane: String(t.lane || ''),
        });
      else if (t?.kind === 'script' && typeof t.script === 'string')
        tabs.push({
          id: uid(),
          kind: 'script',
          script: t.script,
          url: '',
          paneId: typeof t.paneId === 'string' ? t.paneId : '',
          state: 'idle',
          exitCode: null,
        });
    });
    activeId = tabs[Math.min(tabs.length - 1, saved?.active | 0)]?.id || '';
    paint();
    await readScripts();
    if (seq !== syncSeq) return;

    // A server started before this window reloaded still runs in its Terminal pane: reattach and
    // read its URL from the pane's output.
    for (const tab of tabs) {
      if (tab.kind !== 'script' || !tab.paneId) continue;
      const info = await native.pty.replay(tab.paneId);
      if (seq !== syncSeq) return;
      if (info && info.running && !info.saved && info.agent === 'Terminal') {
        // The whole replay buffer, newest address wins: a chatty server has pushed its URL line far
        // out of the last 4 KB by now.
        tab.state = 'starting';
        tails.set(tab.paneId, '');
        const text = String(info.buffer || '').replace(ANSI, ''),
          found = lastServed(text);
        if (found) {
          tab.url = found;
          tab.state = 'running';
          tails.set(tab.paneId, text.slice(-4096));
        } else onOutput(tab.paneId, text);
      } else tab.paneId = '';
    }
    paint();
  }

  // ---------------------------------------------------------------- server output → URL (push)
  const ANSI =
    /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
  const SERVED =
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\])(?::\d{2,5})?(?:\/[^\s"'<>`]*)?/i;
  const cleanUrl = raw =>
    localUrl(
      raw
        .replace(/[).,;:]+$/, '')
        .replace('//0.0.0.0', '//localhost')
        .replace('//[::]', '//localhost')
    );

  function lastServed(text) {
    const all = new RegExp(SERVED.source, 'gi');
    let found = '',
      m;
    while ((m = all.exec(text))) {
      const u = cleanUrl(m[0]);
      if (u) found = u;
    }
    return found;
  }

  function onOutput(paneId, data) {
    const tab = tabByPane(paneId);

    // only preview panes need a tail: stripping every agent pane's output on each chunk cost the UI
    // thread for nothing
    if (!tab) return;
    const tail = ((tails.get(paneId) || '') + String(data).replace(ANSI, '')).slice(-4096);
    tails.set(paneId, tail);
    if (tab.state !== 'starting') return;
    const match = SERVED.exec(tail);
    if (!match) return;
    const url = cleanUrl(match[0]);
    if (!url) return;
    tab.url = url;
    tab.state = 'running';
    paint();
  }
  native.pty.onData(({ paneId, data }) => onOutput(paneId, data));
  native.pty.onExit(({ paneId, exitCode }) => {
    const tab = tabByPane(paneId);
    if (!tab) return;
    tab.state = 'exited';
    tab.exitCode = exitCode;
    paint();
  });
  window.addEventListener('tnai:terminal-pane-closed', event => {
    tails.delete(event.detail?.paneId); // pane ids are never reused
    const tab = tabByPane(event.detail?.paneId);
    if (!tab) return;
    tab.state = 'exited';
    tab.stopped = true;
    tab.error = 'Its thread was closed.';
    paint();
  });

  // A preview an agent opened (`tnai preview`, showRequest) closes with that agent's panel, along
  // with its "Preview ready" bell notice.
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    if (!id) return;
    tabs
      .filter(t => t.kind === 'url' && t.byPane === id)
      .forEach(t => {
        window.TnaiNextActions?.unnotify?.('preview:' + t.url);
        close(t.id);
      });

    // also a notice whose tab is already gone
    window.TnaiNextActions?.unnotifyGroup?.('preview:' + id);
  });
  native.fs.onChanges?.(changes => {
    if (
      !changes?.[0]?.lane &&
      (changes || []).some(c =>
        /^(package\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(c.path)
      )
    )
      readScripts();
  });

  // ---------------------------------------------------------------- actions
  function select(id) {
    if (tabs.some(t => t.id === id)) {
      activeId = id;
      persist();
      paint();
    }
  }

  function addScript(script) {
    const existing = tabs.find(t => t.kind === 'script' && t.script === script);
    if (existing) {
      select(existing.id);
      return existing.id;
    }
    const tab = {
      id: uid(),
      kind: 'script',
      script,
      url: '',
      paneId: '',
      state: 'idle',
      exitCode: null,
    };
    tabs.push(tab);
    activeId = tab.id;
    persist();
    paint();
    return tab.id;
  }

  function addUrl(raw) {
    const url = localUrl(raw);
    if (!url)
      return {
        ok: false,
        error:
          'Only addresses on this computer can be shown here: http://localhost:PORT, 127.0.0.1, or [::1].',
      };
    const existing = tabs.find(t => t.kind === 'url' && t.url === url);
    if (existing) {
      select(existing.id);
      return { ok: true, id: existing.id };
    }
    const tab = { id: uid(), kind: 'url', url, state: 'manual' };
    tabs.push(tab);
    activeId = tab.id;
    persist();
    paint();
    return { ok: true, id: tab.id };
  }

  // A new PowerShell panel underneath (an empty one is filled first) with the shell started in it,
  // without leaving the page shown (the way the prompt box's New agent gets its panel, 19).
  // Answers { ok, paneId, error }.
  async function openPanel() {
    const record = window.TnaiNewTerminalPane?.({ quiet: true, reuseEmpty: true });
    if (!record) return { ok: false, error: window.TnaiPaneLimit?.message };

    // 05 gives the panel its connection select; 07 moves it into its workspace
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = await window.TnaiAgents.openIn(record.id, 'Terminal', { name: record.name });
    return { ...result, paneId: record.id };
  }

  // Runs the script in a new PowerShell panel underneath. The panel ends with the server, so its
  // exit code is real.
  async function start(id) {
    const tab = tabs.find(t => t.id === id);
    if (
      !tab ||
      tab.kind !== 'script' ||
      tab.state === 'starting' ||
      tab.state === 'running' ||
      !window.TnaiAgents
    )
      return false;
    Object.assign(tab, {
      state: 'starting',
      url: '',
      view: '',
      exitCode: null,
      stopped: false,
      error: '',
      paneId: '',
    });
    paint();
    const result = await openPanel();
    if (!result?.ok) {
      tab.state = 'exited';
      tab.error = result?.error || 'Could not open a thread for it.';
      paint();
      return false;
    }
    tab.paneId = result.paneId;
    persist();

    // Wait for the shell's first prompt so the command isn't typed into a console that is still
    // starting.
    const until = Date.now() + 8000;
    while (Date.now() < until && !/>\s*$/.test(tails.get(tab.paneId) || ''))
      await new Promise(r => setTimeout(r, 50));
    tails.set(tab.paneId, '');
    if (tab.state !== 'starting') return false;
    window.TnaiAgents.send(tab.paneId, commandFor(tab.script) + '; exit $LASTEXITCODE');
    return true;
  }

  async function stop(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab?.paneId || (tab.state !== 'starting' && tab.state !== 'running')) return false;
    tab.stopped = true;
    await window.TnaiAgents?.stop(tab.paneId);
    return true;
  }

  function close(id) {
    const i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const [tab] = tabs.splice(i, 1);

    // Closing the tab stops a server Technically Not started for it; its Terminal pane stays with
    // the output.
    if (
      tab.kind === 'script' &&
      tab.paneId &&
      (tab.state === 'starting' || tab.state === 'running')
    ) {
      tab.stopped = true;
      window.TnaiAgents?.stop(tab.paneId);
    }
    if (activeId === id) activeId = (tabs[i] || tabs[i - 1])?.id || '';
    persist();
    paint();
  }

  // ---------------------------------------------------------------- view (one per mount: the Live
  // preview page)
  function describe(tab) {
    if (tab.kind === 'url')
      return {
        dot: 'ok',
        text:
          (tab.by ? 'Shown by ' + tab.by : 'Manual URL') +
          (tab.lane ? ' from worktree ⎇ ' + laneName(tab.lane) : '') +
          ' · not started by Technically Not',
      };
    if (tab.state === 'starting')
      return { dot: 'starting', text: 'Starting ' + commandFor(tab.script) + '…' };
    if (tab.state === 'running') return { dot: 'working', text: 'Running at ' + tab.url };
    if (tab.state === 'exited')
      return {
        dot: tab.stopped || tab.exitCode === 0 ? '' : 'error',
        text: tab.error || (tab.stopped ? 'Stopped' : 'Exited · code ' + tab.exitCode),
      };
    return { dot: '', text: 'Not running' };
  }

  // ---------------------------------------------------------------- the page's own errors, click
  // to ask, follow the picked agent desktop/preview-emulation.js reports, per preview frame (by its
  // name): the page's errors (exceptions, console.error, failed requests), the element the user
  // clicked while "Click to ask" was on, and each new document (which clears that frame's list).
  // iframe name -> [{ kind, text, url, line, n }], oldest first, at most 50
  const pageErrors = new Map();
  let picking = ''; // the frame waiting for a click
  let errTimer = 0;
  native.preview?.onLoaded?.(d => {
    const had = pageErrors.delete(d?.name),
      was = picking === d?.name;
    if (was) picking = '';
    if (had || was) paint();
  });
  native.preview?.onError?.(d => {
    if (!d?.name || !d.text) return;
    const list = pageErrors.get(d.name) || [],
      last = list[list.length - 1];
    if (last && last.text === d.text && last.line === (d.line || 0)) last.n++;
    else {
      list.push({
        kind: String(d.kind || ''),
        text: String(d.text),
        url: String(d.url || ''),
        line: d.line || 0,
        n: 1,
      });
      if (list.length > 50) list.shift();
    }
    pageErrors.set(d.name, list);
    if (!errTimer)
      errTimer = setTimeout(() => {
        errTimer = 0;
        paint();
      }, 150); // a page that logs in a loop repaints at most a few times a second
  });

  // Text for an agent goes into the composer, never straight into a terminal: the user reads it,
  // finishes it and presses Enter. The agent tied to the tab becomes the composer's target; when
  // none can be told, the picked agent stays. Which agent a tab belongs to, most certain first: the
  // agent that last showed this address (`tnai preview`), the one that opened the tab, an open
  // agent with the name the tab was shown under (panel ids are new after a restart or a revived
  // agent, names stay), and last, inferred, the only agent with file activity in the tab's folder
  // (its worktree for a ⎇ tab). Two candidates = no guess.
  function agentFor(tab) {
    if (!tab) return '';
    const sessions = window.TnaiAgents?.sessions?.() || [],
      // read once per click (sessions() is expensive)
      agents = sessions.filter(s => s.agent !== 'Terminal');

    // the panel that ran `tnai preview` counts whatever runs in it; the name and file guesses below
    // take agents only
    const open = id => !!id && sessions.some(s => s.paneId === id);
    if (open(tab.lastPane)) return tab.lastPane;
    if (open(tab.byPane)) return tab.byPane;
    for (const name of [tab.lastBy, tab.by]) {
      const named = name ? agents.filter(s => s.name === name) : [];
      if (named.length === 1) return named[0].paneId;
    }
    const fa = window.TnaiFileActivity;
    const near = agents.filter(s =>
      (fa?.forPane?.(s.paneId) || []).some(p => {
        const at = fa.lane(p);
        return tab.lane ? at.lane?.branch === tab.lane : !at.lane;
      })
    );
    return near.length === 1 ? near[0].paneId : '';
  }

  // Page text (an error, a picked element's selector and words, the page's address) put into the
  // composer: one line, no backticks, at most `max` characters. Main folds it already
  // (preview-emulation.js `clip`); this holds for anything that reaches here another way.
  const pageText = (v, max = 200) =>
    String(v ?? '')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);

  function toComposer(text, tab) {
    const prompt = document.getElementById('prompt');
    if (!prompt) return false;
    const to = agentFor(tab);
    if (to) window.TnaiLiveTasks?.setTarget?.(to);
    prompt.value = prompt.value.trim() ? prompt.value.replace(/\s+$/, '') + '\n\n' + text : text;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const pop = window.TnaiComposerPopout;
    if (pop?.isOut?.()) pop.window()?.focus();
    else {
      prompt.focus();
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
    }
    if (!prompt.offsetParent && !pop?.isOut?.()) window.toast?.('Added to the composer');
    return true;
  }
  native.preview?.onPicked?.(d => {
    // only the pick the user opened here: a page calling the report by itself changes nothing (main
    // holds the same rule)
    if (!d?.name || picking !== d.name) return;
    picking = '';
    const tab = tabs.find(t => d.name.endsWith('-' + t.id));
    if (!d.cancelled && tab && d.selector)
      toComposer(
        'In the page shown in Live preview (' +
          pageText(tab.view || tab.url, 500) +
          '), this element: `' +
          pageText(d.selector, 300) +
          '`' +
          (d.text ? ' ("' + pageText(d.text, 80) + '")' : '') +
          '\nChange: ',
        tab
      );
    paint();
  });

  // The preview follows the agent picked in the composer: the newest page that agent showed (`tnai
  // preview`) comes to the front. Tabs the user opened belong to no agent, so picking an agent
  // never hides one for nothing.
  window.addEventListener('tnai:target-changed', event => {
    const id = event.detail?.paneId;
    if (!id) return;
    const t = tabs.filter(x => x.kind === 'url' && x.byPane === id).pop();
    if (t && t.id !== activeId) select(t.id);
  });

  function mount(body, opts = {}) {
    const browser = !!opts.browser; // 65's page: a browser toolbar (see the header)
    const rootEl = el('div', 'lp' + (browser ? ' lp-browser' : ''));
    const strip = el('div', 'lp-tabs'),
      bar = el('div', 'lp-bar'),
      stage = el('div', 'lp-stage');

    // More tabs than fit: the mouse wheel scrolls the strip sideways (its scrollbar is hidden on
    // the Live preview page).
    strip.addEventListener(
      'wheel',
      e => {
        if (
          e.ctrlKey ||
          strip.scrollWidth <= strip.clientWidth + 1 ||
          Math.abs(e.deltaY) <= Math.abs(e.deltaX)
        )
          return;
        strip.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false }
    );

    // The open tab is always in view, clear of the ＋ that stays at the strip's right edge (14).
    const showActive = () => {
      strip.classList.toggle('lp-tabs-over', strip.scrollWidth > strip.clientWidth + 1);
      const a = strip.querySelector('.lp-tab.active'),
        plus = strip.querySelector('.lp-tab-add');
      if (!a) return;
      const left = a.offsetLeft - strip.offsetLeft,
        right = left + a.offsetWidth,
        room = strip.clientWidth - (plus ? plus.offsetWidth + 4 : 0);
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + room) strip.scrollLeft = right - room;
    };
    rootEl.append(strip, bar, stage);
    body.replaceChildren(rootEl);

    // tab id -> iframe (kept while the tab is open, so switching tabs keeps each page's state)
    const frames = new Map();

    // tab id -> { shell, scale } around its iframe, created once so the iframe is never moved in
    // the DOM
    const wraps = new Map();
    let adding = false,
      message = '';
    const mountId = (++mounts).toString(36) + Date.now().toString(36).slice(-4);
    const devicePrefs = loadDevicePrefs();
    let device = devicePrefs.device;
    const persistDevice = () =>
      saveDevicePrefs({
        device,
        phone: devicePrefs.phone,
        tablet: devicePrefs.tablet,
        desktop: devicePrefs.desktop,
      });

    const state = el('span', 'lp-state'),
      dot = el('i', 'bw-dot'),
      stateText = el('span');
    state.append(dot, stateText);
    const url = el('input', 'lp-url');
    url.spellcheck = false;
    url.setAttribute('aria-label', 'Preview address');
    const reload = el('button', 'lp-btn');
    reload.innerHTML = window.TnaiIcon('rotate-cw', { size: 16 });
    reload.title = 'Reload the preview';
    reload.setAttribute('aria-label', 'Reload the preview');
    const external = el('button', 'lp-btn');
    external.innerHTML = window.TnaiIcon('external-link', { size: 16 });
    external.title = 'Open this address in your web browser';
    external.setAttribute('aria-label', 'Open in your browser');
    const back = el('button', 'lp-btn lp-nav'),
      forward = el('button', 'lp-btn lp-nav');
    back.innerHTML = window.TnaiIcon('arrow-left', { size: 16 });
    forward.innerHTML = window.TnaiIcon('arrow-right', { size: 16 });
    back.title = 'Back';
    forward.title = 'Forward';
    back.setAttribute('aria-label', 'Back');
    forward.setAttribute('aria-label', 'Forward');
    back.dataset.act = 'back';
    forward.dataset.act = 'forward';
    const modes = el('span', 'lp-modes');
    Object.entries(DEVICE_LABEL).forEach(([id, label]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.dataset.device = id;
      b.title = 'Show the preview at ' + label.toLowerCase() + ' size';
      b.onclick = () => {
        device = id;
        persistDevice();
        render();
        fitWindow();
      };
      modes.append(b);
    });
    const sizeSelect = el('select', 'lp-size');
    sizeSelect.setAttribute('aria-label', 'Preview size');
    sizeSelect.title = 'Screen size of the preview';
    sizeSelect.onchange = () => {
      devicePrefs[device].size = sizeSelect.value;
      persistDevice();
      render();
      fitWindow();
    };
    const rotateBtn = el('button', 'lp-rotate');
    rotateBtn.type = 'button';
    rotateBtn.innerHTML = window.TnaiIcon('rotate-cw', { size: 14 });
    rotateBtn.title = 'Rotate';
    rotateBtn.onclick = () => {
      devicePrefs[device].landscape = !devicePrefs[device].landscape;
      persistDevice();
      render();
      fitWindow();
    };
    const sizeLabel = el('span', 'lp-size-label');
    const run = el('button', 'lp-btn');
    const terminal = el('button', 'lp-btn', 'Terminal ↗');
    terminal.title = 'Show this server’s output in its thread';

    // Click to ask (browser toolbar only): the next click in the page names that element in the
    // composer (desktop/preview-emulation.js `pick`).
    const pickBtn =
      browser && native.preview?.pick && native.preview.onPicked
        ? el('button', 'lp-btn lp-pick')
        : null;
    if (pickBtn) {
      pickBtn.type = 'button';
      pickBtn.dataset.act = 'pick';
      pickBtn.setAttribute('aria-pressed', 'false');
      pickBtn.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 2.5l3.6 10 1.6-4.2 4.3-1.7z"/><path d="M9.6 9.6l3.4 3.4"/></svg><span>Click to ask</span>';
      pickBtn.onclick = () => {
        const tab = active(),
          f = tab && frames.get(tab.id);
        if (!f) return;
        const on = picking !== f.name;
        if (picking && picking !== f.name) native.preview.pick(picking, false).catch(() => {});
        picking = on ? f.name : '';
        native.preview
          .pick(f.name, on)
          .then(
            r => r?.ok,
            () => false
          )
          .then(ok => {
            if (on && !ok && picking === f.name) {
              picking = '';
              window.toast?.('This page is not ready yet. Reload it and try again.');
            }
            paint();
          });
        paint();
      };
    }
    [back, forward, reload, external, run, terminal].forEach(b => {
      b.type = 'button';
    });
    reload.dataset.act = 'reload';
    external.dataset.act = 'external';
    run.dataset.act = 'run';
    terminal.dataset.act = 'terminal'; // 65's page relabels / hides these
    if (browser)
      bar.append(
        ...[
          back,
          forward,
          reload,
          url,
          state,
          modes,
          sizeSelect,
          rotateBtn,
          sizeLabel,
          external,
          pickBtn,
          run,
          terminal,
        ].filter(Boolean)
      );
    else
      bar.append(
        state,
        url,
        reload,
        external,
        modes,
        sizeSelect,
        rotateBtn,
        sizeLabel,
        run,
        terminal
      );

    const active = () => tabs.find(t => t.id === activeId) || null;
    const shownUrl = tab => (tab ? tab.url : '');

    function destroyFrame(id) {
      const f = frames.get(id);
      if (f) native.preview?.forget(f.name);
      wraps.get(id)?.shell.remove();
      wraps.delete(id);
      frames.get(id)?.remove();
      frames.delete(id);
    }

    // Empty device screen: with no page to show yet, the chosen device (size, rotation, bezel) is
    // still drawn, with the status note inside it.
    const EMPTY = '\u0000empty';

    function emptyScreen() {
      let w = wraps.get(EMPTY);
      if (!w) {
        const scale = el('div', 'lp-frame-scale lp-empty-screen'),
          shell = el('div', 'lp-frame-shell');
        shell.append(scale);
        stage.append(shell);
        w = { shell, scale };
        wraps.set(EMPTY, w);
      }
      return w;
    }
    const hideEmpty = () => {
      const w = wraps.get(EMPTY);
      if (w) w.shell.hidden = true;
    };

    function embed(tab) {
      let f = frames.get(tab.id);
      const src = localUrl(tab.view || tab.url);
      if (!src) {
        if (f) destroyFrame(tab.id);
        return null;
      }
      if (!f) {
        f = el('iframe', 'lp-frame');

        // stopped while out of sight (180)
        window.TnaiPreviewPause?.watch?.(f);

        // No top navigation: the page can never replace Technically Not. Popups and non-localhost
        // links open in the user's browser (desktop/main.js).
        f.setAttribute(
          'sandbox',
          'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
        );
        f.setAttribute('referrerpolicy', 'no-referrer');
        f.title = 'Live preview';

        // desktop/preview-emulation.js finds this frame by its name
        f.name = 'tnai-lp-' + mountId + '-' + tab.id;
        f.addEventListener('load', () => {
          f.dataset.loaded = String(Date.now());
          if (browser) track(tab.id, f);
          native.preview?.nav?.(f.name, 'restore')?.catch?.(() => {});
        }); // 'restore': back to where the user had scrolled before reloadKeep
        const scale = el('div', 'lp-frame-scale');
        scale.append(f);
        const shell = el('div', 'lp-frame-shell');
        shell.append(scale);

        // appended once; the iframe is only resized/rescaled afterward, never moved, so it never
        // reloads
        stage.append(shell);
        frames.set(tab.id, f);
        wraps.set(tab.id, { shell, scale });
      }

      // The device's user agent + touch are set before the page loads, so its first script already
      // sees the device.
      if (f.dataset.src !== src) {
        f.dataset.src = src;
        delete f.dataset.loaded;

        // A new frame shown as Desktop has nothing to emulate (its name is new, so main holds no
        // preset for it): it gets its address at once instead of after the emulate round trip.
        const first = !('emu' in f.dataset);
        const done = emulate(f);
        if (first && f.dataset.emu === '') f.src = src;
        else
          done.then(() => {
            if (f.dataset.src === src && f.getAttribute('src') !== src) f.src = src;
          });
      }
      return f;
    }

    // Browser mode: the address the frame moved to (a link clicked in it, back / forward) becomes
    // the tab's shown address (tab.view, not saved), and the frame's src bookkeeping follows it so
    // nothing reloads. Asked on each load, and once after back / forward.
    function track(id, f) {
      native.preview
        ?.nav?.(f.name, 'where')
        .then(href => {
          const now = localUrl(href),
            t = tabs.find(x => x.id === id);

          // a `tnai show` page has one address: what its script writes into its own address bar is
          // not followed
          if (!now || !t || t.file || frames.get(id) !== f || now === f.dataset.src) return;
          f.dataset.src = now;
          t.view = now === localUrl(t.url) ? '' : now;
          if (!adding && activeId === id && document.activeElement !== url) url.value = now;
          paint(); // side-by-side views (mirror) follow the address
        })
        .catch(() => {});
    }

    // Real viewport size for the current device: the frame is sized to this in CSS pixels, then
    // visually scaled to fit the panel (transform doesn't change layout, so media queries and
    // window.innerWidth inside the frame see the real size). null = fill the panel (Desktop "Fit to
    // panel").
    function frameBox() {
      // Side by side (65 sets data-sbs): Desktop is a 1280×800 screen scaled into its column like
      // the other two, not the column's own narrow width.
      if (device === 'desktop' && devicePrefs.desktop.size === 'fit')
        return stage.closest('.lp')?.hasAttribute('data-sbs')
          ? { w: DESKTOP_SBS.w, h: DESKTOP_SBS.h, size: DESKTOP_SBS }
          : null;
      const list = DEVICE_SIZES[device],
        pref = devicePrefs[device];
      const size = list.find(s => s.id === pref.size) || list[0];
      const landscape = device !== 'desktop' && pref.landscape;
      return { w: landscape ? size.h : size.w, h: landscape ? size.w : size.h, size };
    }

    function layoutFrame(id, box) {
      const w = wraps.get(id);
      if (!w) return;
      const bezel = box && BEZEL[device];
      w.shell.classList.toggle('lp-bezel', !!bezel);
      if (!box) {
        w.shell.style.cssText = 'width:100%;height:100%';
        w.scale.style.cssText = 'width:100%;height:100%;transform:none';
        return 1;
      }
      const b = bezel ? bezel.b : 0;
      const availW = Math.max(stage.clientWidth - 32 - 2 * b, 80),
        availH = Math.max(stage.clientHeight - 32 - 2 * b, 80);
      const scale = Math.max(0.1, Math.min(1, availW / box.w, availH / box.h));
      w.shell.style.cssText =
        `width:${Math.round(box.w * scale)}px;height:${Math.round(box.h * scale)}px` +
        (bezel ? `;padding:${b}px;border-radius:${Math.round(b + bezel.r * scale)}px` : '');

      // The window's zoom is rarely ×1 (desktop/main.js fitZoom), and a frame is laid out in whole
      // screen pixels: 393 px at ×0.95 would give the page a 392 px viewport. Round up to the next
      // whole screen pixel, so the page sees exactly the device's size.
      const dpr = (stage.ownerDocument.defaultView || window).devicePixelRatio || 1,
        snap = v => Math.ceil(v * dpr - 0.001) / dpr;
      w.scale.style.cssText =
        `width:${snap(box.w)}px;height:${snap(box.h)}px;transform:scale(${scale});transform-origin:0 0` +
        (bezel ? `;border-radius:${bezel.r}px` : '');
      return scale;
    }

    // Device emulation (desktop/preview-emulation.js): Phone/Tablet presets get that device's user
    // agent and touch (pointer: coarse, hover: none) inside the preview frame only. A frame already
    // showing a page is reloaded so the page starts as the new device.
    const emuKey = () => (device === 'desktop' ? '' : devicePrefs[device].size);

    // iframe name -> { label } from the desktop process, null = none, 'size' = size only
    const emuResult = new Map();

    function emulate(f) {
      const key = emuKey();
      if (f.dataset.emu === key && f.emuDone) return f.emuDone;
      const first = !('emu' in f.dataset);
      f.dataset.emu = key;
      const ask = native.preview?.emulate
        ? native.preview.emulate(f.name, key).then(
            r => (r?.ok ? r.value : null),
            () => null
          )
        : Promise.resolve('size');
      f.emuDone = ask.then(result => {
        emuResult.set(f.name, result);
        if (!first && f.dataset.emu === key && f.getAttribute('src')) {
          delete f.dataset.loaded;
          f.src = f.dataset.src;
        }
        paint();
      });
      return f.emuDone;
    }

    function emuText(f) {
      if (!f || device === 'desktop') return '';
      const r = emuResult.get(f.name);
      return r === 'size'
        ? ' · size only (no device emulation in this build)'
        : r?.label
          ? ' · ' + r.label
          : '';
    }

    // Popped out (23): size the window so the device shows at 100% where the screen allows (the
    // desktop process clamps it to the screen). The bars around the stage are measured at the
    // window's current width, but the toolbar wraps to another row at the new, narrower width (27
    // px more at 600 px wide), so once the window has its new size they are measured again and the
    // size corrected (once).
    function fitWindow(again) {
      const win = rootEl.ownerDocument.defaultView,
        box = frameBox();
      if (!win || win === window || !box || !native.panels?.size || !/^tnai-panel-/.test(win.name))
        return;
      const b = BEZEL[device]?.b || 0;
      const w = Math.max(600, box.w + 32 + 2 * b + (win.innerWidth - stage.clientWidth)),
        h = box.h + 32 + 2 * b + (win.innerHeight - stage.clientHeight);
      if (again === true && Math.abs(win.innerWidth - w) <= 1 && Math.abs(win.innerHeight - h) <= 1)
        return;
      Promise.resolve(native.panels.size(win.name, w, h)).then(
        () => {
          if (again !== true) win.setTimeout(() => fitWindow(true), 150);
        },
        () => {}
      );
    }

    // Click to ask + the page's errors (module part above). The button sits in the address row; the
    // strip lies along the stage's bottom edge only while the shown page has errors, and is rebuilt
    // on each render.
    const errBar = el('div', 'lp-errs');
    errBar.hidden = true;
    let errOpen = false;
    const errWhere = e =>
      e.url
        ? ' (' +
          pageText(e.url.split('/').pop().split('?')[0] || e.url, 500) +
          (e.line ? ':' + e.line : '') +
          ')'
        : '';
    const errLine = e => pageText(e.text) + errWhere(e) + (e.n > 1 ? ' ×' + e.n : '');

    function paintExtras(tab, f) {
      if (pickBtn) {
        const on = picking === f.name;
        pickBtn.setAttribute('aria-pressed', String(on));
        pickBtn.title = on
          ? 'Cancel (or press Esc in the page)'
          : 'Click an element in the page to ask an agent to change it';
        if (on) {
          stateText.textContent = 'Click an element · Esc cancels';
          state.title = stateText.textContent;
        }
      }
      const list = pageErrors.get(f.name) || [];
      if (!list.length) {
        errOpen = false;
        return;
      }
      const total = list.reduce((n, e) => n + e.n, 0);
      const d = el('i', 'bw-dot');
      d.dataset.s = 'error';
      const head = el(
        'button',
        'lp-errs-head',
        total + (total === 1 ? ' page error' : ' page errors') + ' · ' + list[list.length - 1].text
      );
      head.type = 'button';
      head.title = errOpen ? 'Hide the list' : 'Show them all';
      head.setAttribute('aria-expanded', String(errOpen));
      head.onclick = () => {
        errOpen = !errOpen;
        render();
      };
      const ask = el('button', 'lp-btn lp-errs-ask', 'Ask agent to fix');
      ask.type = 'button';
      ask.title = 'Puts these errors in the composer for the agent this page belongs to';
      ask.onclick = () =>
        toComposer(
          'The page shown in Live preview (' +
            pageText(tab.view || tab.url, 500) +
            ') reports ' +
            (total === 1 ? 'this error' : 'these errors') +
            ':\n' +
            list
              .slice(-10)
              .map(e => '- ' + errLine(e))
              .join('\n') +
            '\nPlease fix ' +
            (total === 1 ? 'it' : 'them') +
            '.',
          tab
        );
      const x = el('button', 'lp-errs-x', '×');
      x.type = 'button';
      x.title = 'Clear these errors';
      x.setAttribute('aria-label', 'Clear these errors');
      x.onclick = () => {
        pageErrors.delete(f.name);
        errOpen = false;
        render();
      };
      const row = el('div', 'lp-errs-row');
      row.append(d, head, ask, x);
      const kids = [row];
      if (errOpen) {
        const ul = el('ul', 'lp-errs-list');
        list.slice(-20).forEach(e => ul.append(el('li', '', errLine(e))));
        kids.unshift(ul);
      }
      errBar.replaceChildren(...kids);
      errBar.hidden = false;
      if (errBar.parentNode !== stage) stage.append(errBar);
    }

    function addForm() {
      const box = el('div', 'lp-add');
      if (scripts.length) {
        box.append(
          el('h4', '', 'RUN A SCRIPT FROM PACKAGE.JSON'),
          el(
            'p',
            '',
            'Runs in a new thread in the project folder. The address it prints is shown here.'
          )
        );
        const list = el('div', 'lp-scripts');
        scripts.forEach(s => {
          const b = el('button', 'lp-script');
          b.type = 'button';
          b.dataset.script = s.name;
          b.append(el('b', '', commandFor(s.name)), el('small', '', s.command));
          b.title = s.command;
          b.onclick = () => {
            adding = false;
            start(addScript(s.name));
          };
          list.append(b);
        });
        box.append(list);
      } else
        box.append(
          el(
            'p',
            '',
            root
              ? 'No dev, start, serve, or preview script in this folder’s package.json.'
              : 'Connect a project folder to run its dev server here.'
          )
        );
      box.append(
        el('h4', '', 'OR OPEN A LOCALHOST ADDRESS'),
        el('p', '', 'For a server you started yourself, e.g. http://localhost:3000.')
      );
      const form = el('form', 'lp-url-form'),
        input = el('input', 'lp-url'),
        go = el('button', 'lp-btn lp-go', 'Open');
      input.placeholder = 'http://localhost:3000';
      input.spellcheck = false;
      input.setAttribute('aria-label', 'Localhost address');
      go.type = 'submit';
      const msg = el('div', 'lp-msg', message);
      form.onsubmit = event => {
        event.preventDefault();
        const result = addUrl(input.value);
        if (!result.ok) {
          message = result.error;
          msg.textContent = message;
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        message = '';
        adding = false;
        render();
      };
      form.append(input, go);
      box.append(form, msg);
      return box;
    }

    function render() {
      // Tabs
      const add = el('button', 'lp-tab-add');
      add.type = 'button';
      add.innerHTML = window.TnaiIcon('plus', { size: 14 });
      add.title = 'Add a preview';
      add.setAttribute('aria-pressed', String(adding));
      add.onclick = () => {
        adding = !adding;
        message = '';
        render();
        if (browser && adding) url.focus();
      };

      // URL tabs that all sit on one host show only the page path:
      // shortened tabs otherwise all start with the same host and look alike. A tab on the site's
      // root keeps the host; the full address stays in the tooltip and the address box.
      const urlHosts = tabs.filter(t => t.kind === 'url').map(t => new URL(t.url).host),
        oneHost = urlHosts.length > 1 && urlHosts.every(h => h === urlHosts[0]);
      const urlLabel = t => {
        const u = new URL(t.url),
          p = u.pathname.replace(/\/$/, '');
        return oneHost && p ? p : u.host + p;
      };
      strip.replaceChildren(
        ...tabs.map(t => {
          const node = el('div', 'lp-tab' + (t.id === activeId && !adding ? ' active' : ''));
          node.dataset.id = t.id;
          const d = el('i', 'bw-dot');
          d.dataset.s = describe(t).dot;
          const name = el(
            'button',
            'lp-tab-name',
            t.kind === 'script'
              ? t.script + (t.url && t.state === 'running' ? ' · ' + new URL(t.url).host : '')
              : (t.lane ? '⎇ ' + laneName(t.lane) + ' · ' : '') + urlLabel(t)
          );
          name.type = 'button';
          name.title =
            t.kind === 'script'
              ? commandFor(t.script)
              : t.url + (t.lane ? ' · from worktree ' + t.lane : '');
          name.onclick = () => {
            adding = false;
            select(t.id);
            render();
          };
          const x = el('button', 'lp-tab-close', '×');
          x.type = 'button';
          x.title = 'Close this preview';
          x.dataset.close = t.id;
          x.onclick = () => close(t.id);
          node.append(d, name, x);
          return node;
        }),
        add
      );
      showActive();

      // Forget frames of closed tabs.
      frames.forEach((f, id) => {
        if (!tabs.some(t => t.id === id)) destroyFrame(id);
      });

      const tab = adding ? null : active();
      bar.hidden = !tab && !browser;
      errBar.hidden = true;
      pickBtn?.setAttribute('aria-pressed', 'false');
      stage.dataset.device = device;
      modes
        .querySelectorAll('button')
        .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.device === device)));

      // Size picker for the current device.
      const sizeList = DEVICE_SIZES[device];
      const sizeKey = device;
      if (sizeSelect.dataset.key !== sizeKey) {
        sizeSelect.replaceChildren(
          ...sizeList.map(s => {
            const o = el('option', '', s.label + (s.w ? ' · ' + s.w + '×' + s.h : ''));
            o.value = s.id;
            return o;
          })
        );
        sizeSelect.dataset.key = sizeKey;
      }
      sizeSelect.value = devicePrefs[device].size;
      sizeSelect.hidden = sizeList.length < 2;
      rotateBtn.hidden = device === 'desktop';
      rotateBtn.setAttribute('aria-pressed', String(!!devicePrefs[device].landscape));
      rotateBtn.title = devicePrefs[device].landscape
        ? 'Rotate to portrait'
        : 'Rotate to landscape';
      if (!tab) {
        frames.forEach((f, id) => {
          const w = wraps.get(id);
          if (w) w.shell.hidden = true;
        });
        hideEmpty();
        sizeLabel.textContent = '';
        stage.classList.remove('lp-framed');
        stage.querySelector('.lp-note')?.remove();
        if (browser) {
          // an empty browser tab: the address bar stays, the page (65) fills the stage
          back.disabled = forward.disabled = reload.disabled = external.disabled = true;
          if (pickBtn) pickBtn.disabled = true;
          run.hidden = terminal.hidden = true;
          url.disabled = false;
          url.placeholder = 'Type a localhost address, e.g. localhost:3000, and press Enter';
          if (document.activeElement !== url) {
            url.value = '';
            url.removeAttribute('aria-invalid');
          }
          dot.dataset.s = '';
          stateText.textContent = message;
          state.title = message;
          let blank = stage.querySelector(':scope>.lp-blank');
          if (!blank) {
            blank = el('div', 'lp-blank');
            stage.append(blank);
          }
          opts.blank?.(blank, { adding });
          return;
        }

        // Rebuilt only when what it offers changed, so typing in the address field survives live
        // updates.
        const key = JSON.stringify([root, runner, scripts]);
        const form = stage.querySelector(':scope>.lp-add');
        if (!form || form.dataset.key !== key) {
          const next = addForm();
          next.dataset.key = key;
          form ? form.replaceWith(next) : stage.append(next);
        }
        return;
      }
      stage.querySelector(':scope>.lp-add')?.remove();
      stage.querySelector(':scope>.lp-blank')?.remove();

      const info = describe(tab);
      const shownNote =
        // "Updated · …" (live changes below)
        liveNote && liveNote.tabId === tab.id && Date.now() < liveNote.until ? liveNote : null;
      dot.dataset.s = info.dot;

      // browser mode: the dot, its words on hover
      stateText.textContent = shownNote ? shownNote.text : browser ? '' : info.text;
      state.title = shownNote ? shownNote.title : info.text;
      if (document.activeElement !== url) {
        url.value = tab.view || shownUrl(tab);
        url.removeAttribute('aria-invalid');
      }
      const live = tab.kind === 'url' || tab.state === 'running';
      if (!live && document.activeElement !== url) url.value = '';

      // a server that never prints its address: type it and press Enter
      const waiting = tab.kind === 'script' && tab.state === 'starting';
      url.placeholder = live
        ? ''
        : waiting
          ? 'Waiting for the address… or type it (localhost) and press Enter'
          : browser
            ? 'Server not running · type a localhost address to open it'
            : 'The address appears when the server is running';
      url.disabled = !browser && !live && !waiting;
      reload.disabled = !live;
      external.disabled = !live;
      back.disabled = forward.disabled = !live || !native.preview?.nav;
      if (pickBtn) pickBtn.disabled = !live;
      run.hidden = tab.kind !== 'script';
      terminal.hidden = tab.kind !== 'script' || !tab.paneId;
      const busy = tab.state === 'starting' || tab.state === 'running';
      run.innerHTML = busy
        ? window.TnaiIcon('square-stop', { size: 14 }) + ' Stop'
        : window.TnaiIcon('play', { size: 14 }) + ' Start';
      run.className = 'lp-btn ' + (busy ? 'lp-stop' : 'lp-go');
      run.title = busy
        ? 'Stop the server (ends its process)'
        : 'Run ' + commandFor(tab.script) + ' in a new thread';

      frames.forEach((f, id) => {
        const w = wraps.get(id);
        if (w) w.shell.hidden = id !== tab.id;
      });
      const f = tab.kind === 'url' || tab.state === 'running' ? embed(tab) : null;
      let note = stage.querySelector('.lp-note');
      if (f) {
        note?.remove();
        hideEmpty();
        const box = frameBox();
        stage.classList.toggle('lp-framed', !!box);
        const scale = layoutFrame(tab.id, box);
        if (f.dataset.src && f.dataset.emu !== emuKey()) emulate(f);
        paintExtras(tab, f);
        sizeLabel.textContent = box
          ? box.w + '×' + box.h + ' · ' + Math.round(scale * 100) + '%' + emuText(f)
          : browser
            ? ''
            : 'Fit to panel';
        sizeLabel.title =
          device === 'desktop'
            ? ''
            : 'Real CSS viewport size. Inside the preview only: the device user agent and touch (pointer: coarse, hover: none). Screen size and pixel ratio stay this PC\u2019s; mouse clicks stay mouse events.';
        return;
      }
      if (frames.get(tab.id)) destroyFrame(tab.id);
      if (!note) note = el('p', 'lp-note');
      const box = frameBox();
      stage.classList.toggle('lp-framed', !!box);
      if (box) {
        const w = emptyScreen();
        w.shell.hidden = false;
        if (note.parentNode !== w.scale) w.scale.append(note);
        const scale = layoutFrame(EMPTY, box);
        sizeLabel.textContent = box.w + '×' + box.h + ' · ' + Math.round(scale * 100) + '%';
      } else {
        hideEmpty();
        if (note.parentNode !== stage) stage.append(note);
        sizeLabel.textContent = '';
      }
      const b = el(
        'b',
        '',
        tab.state === 'starting'
          ? 'Waiting for the server’s address…'
          : tab.state === 'exited'
            ? info.text
            : 'Server not running'
      );
      note.replaceChildren(
        b,
        document.createElement('br'),
        tab.state === 'starting'
          ? 'The preview appears when the server prints a localhost address. Its output is in its thread.'
          : 'Start runs ' + commandFor(tab.script) + ' in a new thread in the project folder.'
      );
    }

    url.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        url.value = shownUrl(active());
        url.blur();
        return;
      }
      if (event.key !== 'Enter') return;
      const tab = browser && adding ? null : active();
      if (!tab && !browser) return;
      const next = localUrl(url.value);
      if (!next) {
        url.setAttribute('aria-invalid', 'true');
        url.title = 'Only localhost addresses can be shown here';
        if (browser) {
          message = 'Only addresses on this computer work: localhost, 127.0.0.1 or [::1].';
          stateText.textContent = state.title = message;
          dot.dataset.s = 'error';
        }
        return;
      }
      url.removeAttribute('aria-invalid');
      url.title = '';
      message = '';

      // Browser mode: an empty tab, or a script tab whose server isn't running, opens the address
      // as a new tab.
      if (
        browser &&
        (!tab || (tab.kind === 'script' && tab.state !== 'running' && tab.state !== 'starting'))
      ) {
        adding = false;
        addUrl(next);
        url.blur();
        render();
        return;
      }
      if (tab.kind === 'url') {
        tab.url = next;
        tab.view = '';
        persist();
      } else if (tab.state === 'starting') {
        tab.url = next;
        tab.view = '';
        tab.state = 'running';
        paint();
      } // the user gave the address the server did not print
      else tab.view = next === tab.url ? '' : next;
      url.blur();
      render();
    });
    const go = action => {
      const tab = active(),
        f = tab && frames.get(tab.id);
      if (f && native.preview?.nav)
        native.preview.nav(f.name, action).then(
          () => setTimeout(() => track(tab.id, f), 300),
          () => {}
        );
    };
    back.onclick = () => go('back');
    forward.onclick = () => go('forward');
    reload.onclick = () => {
      const tab = active(),
        f = tab && frames.get(tab.id);
      if (f && localUrl(f.dataset.src)) reloadKeep(f);
    };
    external.onclick = () => {
      const src = localUrl(active()?.view || active()?.url);
      if (src) window.open(src, '_blank', 'noopener');
    };
    run.onclick = () => {
      const tab = active();
      if (!tab) return;
      if (tab.state === 'starting' || tab.state === 'running') stop(tab.id);
      else start(tab.id);
    };
    terminal.onclick = () => {
      const tab = active();
      if (tab?.paneId) window.TnaiLiveTasks?.focusPane?.(tab.paneId);
    };

    // Re-fit the scaled frame when the panel is resized (the page resizes with the window).
    // Observed from the document the panel is in (a pop-out window has its own), re-made when 23
    // moves the panel. A resize only re-scales the shown frame and its size label: no tab strip
    // rebuild (render), no emulation, no reload.
    function refit() {
      const tab = adding ? null : active(),
        box = frameBox();
      if (tab && !!box !== stage.classList.contains('lp-framed') && device === 'desktop') {
        render();
        return;
      } // Side by side went on or off: Desktop switches between its fixed size and Fit to panel
      if (!tab || !box || !stage.classList.contains('lp-framed')) return;
      const id = frames.has(tab.id) ? tab.id : EMPTY,
        scale = layoutFrame(id, box);
      if (scale)
        sizeLabel.textContent =
          box.w +
          '×' +
          box.h +
          ' · ' +
          Math.round(scale * 100) +
          '%' +
          (id === EMPTY ? '' : emuText(frames.get(id)));
    }

    // Reloads the page in a frame and keeps the user's place in it: the scroll positions are noted
    // inside the frame first (preview-emulation.js 'keep') and put back by the frame's load handler
    // ('restore'). Without it every automatic reload threw the page back to its top.
    async function reloadKeep(f) {
      try {
        await native.preview?.nav?.(f.name, 'keep');
      } catch {}
      delete f.dataset.loaded;
      f.src = f.dataset.src;
    }
    let resizeObserver = null;
    const observe = () => {
      resizeObserver?.disconnect();
      const RO = rootEl.ownerDocument.defaultView?.ResizeObserver;
      resizeObserver = typeof RO === 'function' ? new RO(refit) : null;
      resizeObserver?.observe(stage);
    };
    observe();

    // Side by side on or off (65 sets data-sbs on the root): Desktop switches at once between its
    // 1280×800 screen and Fit to panel. Not left to the resize observer alone: that only answers
    // when the window draws a frame.
    const sbsRoot = stage.closest('.lp') || rootEl;
    let sbsWas = sbsRoot.hasAttribute('data-sbs');
    new MutationObserver(() => {
      const on = sbsRoot.hasAttribute('data-sbs');
      if (on !== sbsWas) {
        sbsWas = on;
        if (device === 'desktop') render();
      }
    }).observe(sbsRoot, { attributes: true, attributeFilter: ['data-sbs'] });

    // Live changes: a page file saved in the shown tab's folder (the project, or its worktree for a
    // ⎇ tab) reloads a page that doesn't update itself (preview:hot asks inside the frame; a dev
    // server's hot reload is left to do its own work), once the saves settle. Either way the status
    // spot says for a few seconds what changed and which agent was working on it (inferred from its
    // file activity, 13).
    const PAGE_FILE =
      /\.(html?|css|scss|sass|less|m?[jt]sx?|vue|svelte|astro|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?)$/i;
    const SETTLE = 600,
      NOTE_MS = 6000;
    let liveNote = null,
      settleTimer = null,
      noteTimer = null,
      pending = [];
    const editorOf = (c, lane) => {
      const fa = window.TnaiFileActivity,
        sessions = window.TnaiAgents?.sessions?.() || [];
      for (const s of sessions)
        if (s.agent !== 'Terminal')
          for (const p of fa?.forPane?.(s.paneId) || []) {
            // agents only: a shell running the dev server "touches" the files it serves
            const at = fa.lane(p);
            if (at.path === c.path && (at.lane?.id || '') === (lane?.id || '')) return s.name || '';
          }
      return '';
    };
    const liveChanged = async () => {
      settleTimer = null;
      const tab = adding ? null : active(),
        f = tab && frames.get(tab.id),
        batch = pending;
      pending = [];
      if (!f || !localUrl(f.dataset.src) || !rootEl.isConnected) return;
      const mine = batch.filter(
        c =>
          (tab.lane ? c.lane?.branch === tab.lane : !c.lane) && (!tab.file || c.path === tab.file)
      ); // a `tnai show` page holds everything itself: only its own file reloads it
      if (!mine.length) return;
      const last = mine[mine.length - 1],
        file = last.path.split('/').pop(),
        who = editorOf(last, last.lane),
        more = mine.length > 1 ? ' +' + (mine.length - 1) : '';
      const hot = await native.preview?.hot?.(f.name).catch(() => null);
      if (hot === false && frames.get(tab.id) === f) await reloadKeep(f);
      liveNote = {
        tabId: tab.id,
        until: Date.now() + NOTE_MS,
        text: 'Updated · ' + (who ? who + ' edited ' : '') + file + more,
        title:
          mine
            .slice(-8)
            .map(c => c.path)
            .join('\n') +
          (who ? '\nBy ' + who + ' (inferred from its file activity)' : '') +
          (hot === false
            ? '\nReloaded: this page has no hot reload.'
            : hot
              ? '\nThe dev server updated the page itself.'
              : ''),
      };
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        liveNote = null;
        render();
      }, NOTE_MS + 50);
      render();
    };
    const offChanges = native.fs.onChanges?.(batch => {
      // a folded batch (an install, a build) is not a page edit
      if (!frames.size || !Array.isArray(batch) || batch.some(c => c.dir)) return;
      const hits = batch.filter(c => typeof c?.path === 'string' && PAGE_FILE.test(c.path));
      if (!hits.length) return;
      pending.push(...hits);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(liveChanged, SETTLE);
    });

    // An agent's `tnai preview` picks the device view (showRequest below).
    const view = {
      render,
      box: rootEl,
      setDevice(d) {
        if (d === device) return;
        device = d;
        persistDevice();
        render();
        fitWindow();
      },
    };
    views.add(view);
    syncProject();
    render();
    return {
      update() {
        syncProject();
        render();
      },
      shown: render,
      // Popped out or docked (23): the iframes reload in the new document with the same emulation;
      // a pop-out is sized to the device.
      moved() {
        observe();
        render();
        setTimeout(fitWindow, 60);
      },
      destroy() {
        views.delete(view);
        resizeObserver?.disconnect();
        clearTimeout(settleTimer);
        clearTimeout(noteTimer);
        if (typeof offChanges === 'function') offChanges();
        [...frames.keys()].forEach(destroyFrame);
      },
    };
  }

  // ---------------------------------------------------------------- side-by-side (65): one more
  // live view of the shown tab A real iframe of its own showing the active tab's address (and the
  // address its main frame moved to) at one fixed device: that device's remembered size and
  // rotation (Desktop shows 1280×800), with the same device emulation as the main frame. Made only
  // while side-by-side is on (destroy() removes the frame); links clicked inside it stay in its own
  // history. The size a device is shown at Side by side (remembered size and rotation; Desktop
  // counts as 1280×800) and its bezel thickness: 65 gives the three views one height from these.
  function deviceBox(device) {
    const list = DEVICE_SIZES[device];
    if (!list) return null;
    const pref = loadDevicePrefs()[device],
      size =
        list.find(x => x.id === pref.size && x.w) ||
        (device === 'desktop' ? DESKTOP_SBS : list.find(x => x.w));
    const land = device !== 'desktop' && pref.landscape;
    return { w: land ? size.h : size.w, h: land ? size.w : size.h, b: BEZEL[device]?.b || 0 };
  }

  function mirror(host, device) {
    if (!DEVICE_SIZES[device]) return null;
    const id = (++mounts).toString(36) + Date.now().toString(36).slice(-4);
    const shell = el('div', 'lp-frame-shell'),
      scale = el('div', 'lp-frame-scale'),
      cap = el('div', 'lp-mirror-cap'),
      f = el('iframe', 'lp-frame');

    // stopped while out of sight (180)
    window.TnaiPreviewPause?.watch?.(f);
    f.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
    );
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.title = DEVICE_LABEL[device] + ' preview';
    f.name = 'tnai-lp-' + id + '-' + device; // desktop/preview-emulation.js finds it by name
    f.addEventListener('load', () => {
      f.dataset.loaded = String(Date.now());
    });
    scale.append(f);
    shell.append(scale);
    host.dataset.device = device;
    host.replaceChildren(shell, cap);
    let box = null,
      emu = null,
      ready = Promise.resolve();
    const sizeOf = () => {
      const pref = loadDevicePrefs()[device],
        list = DEVICE_SIZES[device];
      const size =
        list.find(s => s.id === pref.size && s.w) ||
        (device === 'desktop' ? DESKTOP_SBS : list.find(s => s.w));
      const land = device !== 'desktop' && pref.landscape;
      return {
        w: land ? size.h : size.w,
        h: land ? size.w : size.h,
        size,
        key: device === 'desktop' ? '' : size.id,
      };
    };

    function fit() {
      if (!box || !host.isConnected) return;
      const bezel = BEZEL[device],
        b = bezel ? bezel.b : 0;
      const availW = Math.max(host.clientWidth - 16 - 2 * b, 60),
        // 20 px free above and below: the caption (6 px gap + one line) sits right under the frame,
        // inside the column
        availH = Math.max(host.clientHeight - 40 - 2 * b, 60);
      const s = Math.max(0.05, Math.min(1, availW / box.w, availH / box.h));
      shell.classList.toggle('lp-bezel', !!bezel);
      shell.style.cssText =
        `width:${Math.round(box.w * s)}px;height:${Math.round(box.h * s)}px` +
        (bezel ? `;padding:${b}px;border-radius:${Math.round(b + bezel.r * s)}px` : '');
      scale.style.cssText =
        `width:${box.w}px;height:${box.h}px;transform:scale(${s});transform-origin:0 0` +
        (bezel ? `;border-radius:${bezel.r}px` : '');

      // 14 places the caption the same distance under every frame. Computed, not read from the
      // shell: its height animates, so offsetHeight is still the old one right after a resize and
      // the caption landed on the frame
      host.style.setProperty('--lp-frame-h', Math.round(box.h * s) + 2 * b + 'px');
      cap.textContent =
        DEVICE_LABEL[device] + ' · ' + box.w + '×' + box.h + ' · ' + Math.round(s * 100) + '%';
      cap.title = box.size.label + (host.dataset.empty === 'true' ? ' · nothing to show yet' : '');
    }

    function render() {
      const tab = tabs.find(t => t.id === activeId);
      const src =
        tab && (tab.kind === 'url' || tab.state === 'running') ? localUrl(tab.view || tab.url) : '';
      box = sizeOf();
      host.dataset.empty = String(!src);
      if (box.key !== emu) {
        // the device's user agent + touch first; a page already shown restarts as the new device
        emu = box.key;
        ready = native.preview?.emulate
          ? native.preview.emulate(f.name, emu).catch(() => null)
          : Promise.resolve();
        if (f.dataset.src) {
          const again = f.dataset.src;
          ready.then(() => {
            if (f.dataset.src === again) f.src = again;
          });
        }
      }
      if ((f.dataset.src || '') !== src) {
        f.dataset.src = src;
        if (!src) f.removeAttribute('src');
        else
          ready.then(() => {
            if (f.dataset.src === src) f.src = src;
          });
      }
      fit();
    }
    const view = { render, setDevice() {} };
    views.add(view);
    const RO = host.ownerDocument.defaultView?.ResizeObserver,
      ro = typeof RO === 'function' ? new RO(fit) : null;
    ro?.observe(host);
    render();
    return {
      frame: f,
      reload() {
        if (f.dataset.src) {
          delete f.dataset.loaded;
          f.src = f.dataset.src;
        }
      },
      destroy() {
        views.delete(view);
        ro?.disconnect();
        native.preview?.forget?.(f.name);
        host.replaceChildren();
      },
    };
  }

  // ---------------------------------------------------------------- agents: `tnai preview URL
  // [device]` (desktop/agent-mesh.js) The agent's project must be the one open here (tabs are saved
  // per project). The URL's tab is selected (a running script tab at that address, else a URL tab
  // marked with the agent's name), every view switches to the device, and the Live preview page
  // opens unless a preview is on screen.
  const samePath = (a, b) =>
    String(a || '')
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase() ===
    String(b || '')
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase();

  async function showRequest(req) {
    await syncProject();
    if (!root || !samePath(root, req.project))
      return {
        ok: false,
        error:
          'the user has another project open in Technically Not (' +
          (root || 'none') +
          '); give them the address instead',
      };
    const url = localUrl(req.url);
    if (!url) return { ok: false, error: 'only addresses on this computer can be shown' };
    const hit = tabs.find(
      t =>
        (t.kind === 'url' && t.url === url) ||
        (t.kind === 'script' && t.state === 'running' && t.url === url)
    );
    if (hit) {
      hit.lastBy = String(req.by || '').slice(0, 80);
      hit.lastPane = String(req.paneId || '');
      select(hit.id);
    } // shown again, maybe by another agent: asks about this page go to it
    else {
      const r = addUrl(url);
      if (!r.ok) return r;
      const t = tabs.find(x => x.id === r.id);
      if (t) {
        t.by = String(req.by || 'an agent').slice(0, 80);
        t.byPane = String(req.paneId || '');
        t.lane = String(req.lane || '').slice(0, 120);
        if (req.file) t.file = String(req.file).slice(0, 400);
        persist();
      }
      paint();
    }

    // One preview per agent, so that only what the user looks at
    // keeps running: the address an agent shows now closes the URL tabs
    // its panel opened before, so old pages don't keep running behind it. Tabs the user or another
    // agent opened stay, as with `tnai preview close`.
    if (req.paneId)
      tabs
        .filter(x => x.kind === 'url' && x.byPane === String(req.paneId) && x.url !== url)
        .forEach(x => {
          window.TnaiNextActions?.unnotify?.('preview:' + x.url);
          close(x.id);
        });
    if (DEVICE_SIZES[req.device]) {
      const prefs = loadDevicePrefs();
      prefs.device = req.device;
      saveDevicePrefs(prefs);
      views.forEach(v => v.setDevice?.(req.device));
    }

    // Switch pages only where the user is already looking at previews (the Live preview page);
    // anywhere else a bell notice with Open.
    const onScreen = window.TnaiLivePreviewPage?.visible?.();
    if (onScreen) return { ok: true, where: 'in the Live preview the user has on screen' };
    if (!window.TnaiNextActions?.notify) {
      window.TnaiLivePreviewPage?.open();
      return { ok: true, where: 'the Live preview page was opened for the user' };
    }
    const by = String(req.by || 'An agent').slice(0, 80),
      view = DEVICE_SIZES[req.device] ? ' (' + req.device + ' view)' : '';

    // group: one "Preview ready" per agent in the bell; a newer address from the same agent
    // replaces its older notice.
    window.TnaiNextActions.notify({
      key: 'preview:' + url,
      group: 'preview:' + (req.paneId || by),
      source: by,
      tag: 'Preview',
      k: 'next',
      title: 'Preview ready: ' + url,
      text: by + ' wants to show you ' + url + view + ' in Live preview.',
      action: {
        label: 'Open',
        run: () => {
          const t = tabs.find(x => (x.kind === 'url' || x.kind === 'script') && x.url === url);
          if (t) select(t.id);
          window.TnaiLivePreviewPage?.open();
          window.TnaiNextActions.unnotify('preview:' + url);
        },
      },
    });
    return {
      ok: true,
      where:
        'the user got a bell notice with Open; they are on another page, so the preview was not forced on screen',
    };
  }

  // `tnai preview close [URL]`: closes only the URL tabs this agent's panel created (byPane), with
  // their "Preview ready" notices; the user's own tabs stay.
  async function closeRequest(req) {
    await syncProject();
    if (!root || !samePath(root, req.project))
      return {
        ok: false,
        error: 'the user has another project open in Technically Not (' + (root || 'none') + ')',
      };
    const url = req.url ? localUrl(req.url) : '';
    const mine = tabs.filter(
      t =>
        t.kind === 'url' && req.paneId && t.byPane === String(req.paneId) && (!url || t.url === url)
    );
    if (!url && req.paneId) window.TnaiNextActions?.unnotifyGroup?.('preview:' + req.paneId);
    if (!mine.length)
      return {
        ok: false,
        error:
          url && tabs.some(t => t.kind === 'url' && t.url === url)
            ? url + ' was not opened by you (the user or another agent opened it), so it stays'
            : 'no Live preview tab opened by you' + (url ? ' at ' + url : ''),
      };
    mine.forEach(t => {
      window.TnaiNextActions?.unnotify?.('preview:' + t.url);
      close(t.id);
    });
    return { ok: true, where: mine.map(t => t.url).join(', ') };
  }

  // `tnai shot preview [URL] [device]`: only answers which address and viewport to capture
  // (desktop/preview-shot.js loads it in a hidden window). Read-only: no tab is selected, no device
  // view, page or focus changes. Address: the one asked for, else the newest tab this agent opened,
  // else the active tab.
  async function shotRequest(req) {
    await syncProject();
    let url = req.url ? localUrl(req.url) : '';
    if (!url) {
      if (!root || !samePath(root, req.project))
        return {
          ok: false,
          error:
            'the user has another project open in Technically Not (' +
            (root || 'none') +
            '); give the address: tnai shot preview URL',
        };
      const live = t =>
        (t.kind === 'url' || (t.kind === 'script' && t.state === 'running')) && localUrl(t.url);
      const pick =
        tabs.filter(t => live(t) && req.paneId && t.byPane === String(req.paneId)).pop() ||
        tabs.find(t => t.id === activeId && live(t));
      url = pick ? localUrl(pick.url) : '';
      if (!url)
        return {
          ok: false,
          error:
            'no Live preview tab with a page to capture; show it first with tnai preview URL, or give the address: tnai shot preview URL',
        };
    }
    const prefs = loadDevicePrefs(),
      device = DEVICE_SIZES[req.device] ? req.device : prefs.device;
    const list = DEVICE_SIZES[device],
      size =
        list.find(s => s.id === prefs[device].size && s.w) ||
        list.find(s => s.id === DEVICE_DEFAULT[device] && s.w) ||
        (device === 'desktop' ? DESKTOP_SBS : list.find(s => s.w));
    const landscape = device !== 'desktop' && prefs[device].landscape;
    return {
      ok: true,
      where: url,
      shot: {
        url,
        device,
        w: landscape ? size.h : size.w,
        h: landscape ? size.w : size.h,
        preset: device === 'desktop' ? '' : size.id,
        label: size.label + (landscape ? ' landscape' : ''),
      },
    };
  }

  // The `tnai_preview` tool's "open" (desktop/preview-control.js through 196): the same as
  // `tnai preview`, in the project open now.
  async function controlShow(req) {
    await syncProject();
    return showRequest({ ...req, project: root });
  }

  // A request of the `tnai_preview` tool (control: true) is answered by 196.
  const controlAnswer = req =>
    window.TnaiPreviewControl?.answer?.(req) ||
    Promise.resolve({ ok: false, error: 'preview control is not loaded' });
  native.preview?.onShow?.(req => {
    if (!req?.id) return;
    const answer = req.control
      ? controlAnswer(req)
      : req.shot
        ? shotRequest(req)
        : req.close
          ? closeRequest(req)
          : showRequest(req);
    answer.then(
      r => native.preview.shown(req.id, r),
      error => native.preview.shown(req.id, { ok: false, error: error?.message || String(error) })
    );
  });

  window.addEventListener('tnai:project-changed', () => {
    syncProject();
  }); // tabs are saved per project folder; running servers keep their panes

  window.TnaiLivePreview = {
    mount,
    mirror,
    show: controlShow,
    deviceBox,
    laneName,
    localUrl,
    addUrl,
    addScript,
    start,
    stop,
    close,
    select,
    project: () => root,
    status: id => {
      const t = tabs.find(x => x.id === id);
      return t ? describe(t) : null;
    }, // 65's page
    tabs: () =>
      tabs.map(t => ({
        id: t.id,
        kind: t.kind,
        script: t.script || '',
        url: t.url || '',
        by: t.by || '',
        byPane: t.byPane || '',
        lane: t.lane || '',
        paneId: t.paneId || '',
        state: t.state,
        exitCode: t.exitCode ?? null,
        stopped: !!t.stopped,
        active: t.id === activeId,
      })),
    scripts: () => scripts.map(s => ({ ...s, run: commandFor(s.name) })),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
