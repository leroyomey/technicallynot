// Technically Not · 24-file-tabs.js — The open-file tabs (no page shows them since the Build
// workspace page was removed, 2026-10-01; 70 reads the list): open(path) jumps to the tab that has
// the file or loads it into the active tab; openNew always adds a tab. A worktree's file is keyed
// ⎇<lane id>/…. Desktop: the Overview rail's search box searches file names across the whole
// project (native fs:search); a hit opens in the view-only file window (TnaiFileViewer, 09).
// Controls: `window.TnaiFileTabs` (list/open/openNew/add/close/activate/onChange).
(() => {
  const files = window.TnaiProjectFiles;
  if (!files?.connected) return;
  const MAX = 20;

  // ---- State: tabs [{ id, path }] ('' = an empty tab) and the active one. Tabs last for the
  // session. ----
  let seq = 0;
  const newTab = path => ({ id: 't' + ++seq, path: path || '' });
  let tabs = [newTab('')],
    active = tabs[0].id;
  const tabOf = id => tabs.find(t => t.id === id);

  // Subscribers hear every add/close/activate/path/dirty change, once per actual change.
  const listeners = new Set();
  let lastSig = '';
  const list = () => {
    const current = files.current(),
      dirtyNow = files.dirty();
    return tabs.map(t => ({
      id: t.id,
      path: t.path,
      active: t.id === active,
      dirty: !!t.path && (t.path === current ? dirtyNow : files.hasDraft(t.path)),
    }));
  };

  function emit() {
    const now = list(),
      sig = JSON.stringify(now);
    if (sig === lastSig) return;
    lastSig = sig;
    listeners.forEach(fn => {
      try {
        fn(now);
      } catch (error) {
        console.error(error);
      }
    });
  }

  // Tell subscribers about the change.
  const sync = emit;

  function activate(id) {
    if (!tabOf(id)) return;
    active = id;
    sync();
  }

  function add() {
    if (tabs.length >= MAX) return;
    const t = newTab('');
    const i = tabs.findIndex(x => x.id === active);
    tabs.splice(i + 1, 0, t);
    activate(t.id);
  }

  async function close(id) {
    const t = tabOf(id);
    if (!t) return;
    if (t.path) {
      if (t.path === files.current()) files.stash();
      if (files.hasDraft(t.path)) {
        if (!(await files.askDiscard(t.path))) return;
        files.dropDraft(t.path);
      }
    }
    if (!tabs.includes(t)) return;
    const i = tabs.indexOf(t);
    tabs.splice(i, 1);
    if (!tabs.length) tabs.push(newTab(''));
    if (active === id) active = (tabs[i] || tabs[i - 1] || tabs[0]).id;
    if (t.path === files.current() && !tabs.some(x => x.path === t.path)) files.close(true);
    sync();
  }

  // A file opened through the tabs: jump to its tab, or load it into the active one.
  function open(path) {
    if (!path || !files.connected()) return;
    const have = tabs.find(t => t.path === path);
    if (have) {
      activate(have.id);
      return;
    }
    const t = tabOf(active) || tabs[0];
    t.path = path;
    active = t.id;
    sync();
  }

  // Always a new tab (jumps to it instead if it's already open somewhere), never replaces the
  // active tab.
  function openNew(path) {
    if (!path || !files.connected()) return;
    const have = tabs.find(t => t.path === path);
    if (have) {
      activate(have.id);
      return;
    }
    if (tabs.length >= MAX) return;
    const t = newTab(path);
    const i = tabs.findIndex(x => x.id === active);
    tabs.splice(i + 1, 0, t);
    active = t.id;
    sync();
  }

  // Another project became active (09): each project keeps its own tabs for the session (paths are
  // relative, so they never mix).
  const tabsByProject = new Map();
  window.addEventListener('tnai:project-changed', event => {
    const { root = '', previous = '' } = event.detail || {};
    if (root === previous) return;
    tabsByProject.set(previous, { tabs, active });
    const saved = tabsByProject.get(root);
    tabsByProject.delete(root);
    if (saved) ({ tabs, active } = saved);
    else {
      tabs = [newTab('')];
      active = tabs[0].id;
    }
    sync();
  });

  // ---- Project search (desktop): the rail's search box looks up file names across the whole
  // folder; clearing it brings the tree back. The browser keeps 09's filter of loaded items. ----
  const native = window.tnaiNative,
    rail = document.querySelector('.repository-rail'),
    search = rail?.querySelector('#repoRailSearch');
  if (native?.fs?.search && search && files.tree) {
    const results = document.createElement('div');
    results.className = 'repo-search-results';
    results.hidden = true;
    results.setAttribute('aria-label', 'Search results');
    files.tree.after(results);
    let token = 0,
      timer = 0;

    // While the rail shows a worktree (09 lane), the search covers that worktree and a hit opens
    // its file (keyed ⎇<lane id>/<path>).
    const hitRow = (hit, base) => {
      const key = base ? base + '/' + hit.path : hit.path;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'repo-row repo-search-hit';
      row.dataset.searchPath = key;
      row.title = hit.path;
      if (key === files.current()) row.classList.add('selected');
      const icon = document.createElement('span');
      icon.className = 'repo-file-icon';
      if (hit.name.includes('.'))
        icon.textContent = hit.name.split('.').pop().slice(0, 2).toUpperCase();
      else icon.innerHTML = window.TnaiIcon('file-text', { size: 14 });
      const name = document.createElement('b');
      name.textContent = hit.name;
      const dir = document.createElement('small');
      dir.textContent = hit.path.includes('/')
        ? hit.path.slice(0, hit.path.lastIndexOf('/'))
        : './';
      row.append(icon, name, dir);
      return row;
    };

    async function run() {
      const q = search.value.trim(),
        my = ++token;
      if (!q || !files.connected()) {
        rail.classList.remove('repo-searching');
        results.hidden = true;
        results.replaceChildren();
        return;
      }
      const lane = files.lane?.(),
        r = await native.fs.search(q, 200, lane ? { lane: lane.dir } : undefined);
      if (my !== token) return;
      rail.classList.add('repo-searching');
      results.hidden = false;
      const status = document.createElement('p');
      status.className = 'repo-search-status';
      status.setAttribute('role', 'status');
      if (!r?.ok) {
        status.textContent = 'Search failed: ' + (r?.error?.message || 'unknown error');
        results.replaceChildren(status);
        return;
      }
      const v = r.value,
        n = v.results.length;
      status.textContent = !n
        ? 'No file names match “' + q + '”' + (v.timedOut ? ' in the part searched so far.' : '.')
        : v.truncated
          ? n +
            ' best matches shown' +
            (v.timedOut
              ? ' (search stopped after ' + (v.ms / 1000).toFixed(1) + ' s)'
              : ' of ' + v.total)
          : n + (n === 1 ? ' file' : ' files') + (lane ? ' · whole worktree' : ' · whole project');
      results.replaceChildren(
        status,
        ...v.results.map(hit => hitRow(hit, lane ? '⎇' + lane.id : ''))
      );
    }
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 120);
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') results.querySelector('.repo-search-hit')?.click();
      else if (event.key === 'Escape' && search.value) {
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    results.addEventListener('click', event => {
      const row = event.target.closest('.repo-search-hit');
      if (!row) return;

      // Overview's rail navigates; a file opens in its own view-only window (09)
      window.TnaiFileViewer?.open(row.dataset.searchPath);
      results
        .querySelectorAll('.repo-search-hit')
        .forEach(r => r.classList.toggle('selected', r === row));
    });

    // Reconnecting or changing the folder reruns the search against the new folder.
    const bar = rail.querySelector('.repo-connect');
    if (bar)
      new MutationObserver(() => {
        if (search.value.trim()) run();
      }).observe(bar, { attributes: true, attributeFilter: ['data-state'] });
    window.addEventListener('tnai:project-changed', () => {
      if (search.value.trim()) run();
    });
    window.addEventListener('tnai:lane-changed', () => {
      if (search.value.trim()) run();
    });
  }

  window.TnaiFileTabs = {
    list,
    open,
    openNew,
    add,
    close,
    activate,
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
