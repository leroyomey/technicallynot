// Technically Not · 39-command-palette.js — ⌘K / Ctrl+K command palette (top bar ⌘ K button, and
// the Projects nav item opens it on the project list): go to a page, switch, add or remove (× /
// Delete; files stay on disk) a project, find and open a project file, run an app action, or put a
// `tnai` command (agents, send, read, new, context, notes, skills, preview…) in the composer to
// send. Every entry calls a real feature; entries whose feature is unavailable are left out.
// window.TnaiPalette (open, close).
(() => {
  const style = document.createElement('style');
  style.textContent = `
.tnai-pal-overlay{position:fixed;inset:0;z-index:2000;display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;background:#20211f45}
.tnai-pal-overlay[hidden]{display:none}
.tnai-pal{box-sizing:border-box;width:min(600px,calc(100vw - 48px));max-height:calc(100vh - 12vh - 48px);display:flex;flex-direction:column;border:1px solid #e5e8e0;border-radius:12px;background:#fff;box-shadow:0 18px 50px #20211f1f;font:11px var(--pg-sans);color:#34382f;overflow:hidden}
.tnai-pal-input{box-sizing:border-box;width:100%;height:44px;padding:0 16px;border:0;border-bottom:1px solid #eef0ea;background:transparent;color:#34382f;font:13px var(--pg-sans);outline:none}
.tnai-pal-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:4px 6px 8px}
.tnai-pal-group{display:flex;align-items:center;gap:6px;margin:6px 4px 3px;padding:9px 6px 0;border-top:1px solid #eef0ea;font:600 9px var(--pg-sans);letter-spacing:.9px;text-transform:uppercase;color:#8d9288}
.tnai-pal-group:first-child{border-top:0;padding-top:4px}
.tnai-pal-count{margin-left:auto;font:10px var(--pg-sans);letter-spacing:0;text-transform:none;color:#a1a39c}
.tnai-pal-folder{display:flex;align-items:center;gap:7px;min-width:0;margin:4px 0 1px 14px;padding:3px 10px 1px;color:#8d9288;font:10.5px var(--pg-sans)}
.tnai-pal-folder span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-pal-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;min-height:34px;padding:0 10px 0 14px;border:0;border-radius:7px;background:none;color:#40463a;font:12px var(--pg-sans);text-align:left;cursor:pointer}
.tnai-pal-item.nested{padding-left:36px}
.tnai-pal-main{display:flex;align-items:center;gap:9px;min-width:0;flex:0 1 auto}
.tnai-pal-main span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-pal-item svg,.tnai-pal-folder svg{flex:none;color:#95978f}
.tnai-pal-item[aria-selected="true"] svg{color:#5b6353}
.tnai-pal-item small{flex:1 1 0;min-width:0;margin-left:auto;padding-left:10px;color:#8d9288;font:10px var(--pg-sans);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.tnai-pal-item small.warn{color:#b0664e}
.tnai-pal-pill{flex:none;display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:10px;background:#f0f5e9;color:#46563c;font:600 9.5px var(--pg-sans)}
.tnai-pal-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:#70b984}
.tnai-pal-item[aria-selected="true"] .tnai-pal-pill{background:#fff}
.tnai-pal-keys{flex:none;display:flex;gap:3px;margin-left:auto}
.tnai-pal-keys kbd{display:inline-block;min-width:14px;padding:0 4px;border:1px solid #dfe3d9;border-bottom-width:2px;border-radius:4px;background:#fafbf8;color:#4e5547;font:11px/1.45 Consolas,monospace;text-align:center}
.tnai-pal-item[aria-selected="true"]{background:#f0f5e9;color:#34382f}
.tnai-pal-row{display:flex;align-items:center;gap:2px}.tnai-pal-row .tnai-pal-item{flex:1;min-width:0}
.tnai-pal-remove{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:none;color:#9a9f94;font:14px var(--pg-sans);cursor:pointer;opacity:0;transition:opacity .18s ease}.tnai-pal-remove:hover{background:#eceee9;color:#5b6353}
.tnai-pal-row:hover .tnai-pal-remove,.tnai-pal-row:has([aria-selected="true"]) .tnai-pal-remove,.tnai-pal-remove:focus-visible{opacity:1}
.tnai-pal-empty{margin:14px 12px;color:#8d9288}
.tnai-pal-foot{padding:7px 14px;border-top:1px solid #eef0ea;color:#8d9288;font:10px var(--pg-sans)}`;
  document.head.append(style);

  const overlay = document.createElement('div');
  overlay.className = 'tnai-pal-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<section class="tnai-pal" role="dialog" aria-modal="true" aria-label="Command palette"><input class="tnai-pal-input" role="combobox" aria-expanded="true" aria-controls="tnaiPalList" aria-autocomplete="list" spellcheck="false"><div class="tnai-pal-list" id="tnaiPalList" role="listbox"></div><div class="tnai-pal-foot">↑ ↓ to choose · Enter to run · Esc to close</div></section>';
  document.body.append(overlay);
  const input = overlay.querySelector('input'),
    list = overlay.querySelector('.tnai-pal-list'),
    foot = overlay.querySelector('.tnai-pal-foot');
  let items = [],
    selected = 0,
    scope = '',
    lastFocus = null,
    searchToken = 0,
    fileHits = [];

  const ICONS = {
    page: 'layout-panel-top',
    project: 'box',
    add: 'plus',
    action: 'zap',
    file: 'file',
    command: 'terminal',
    folder: 'folder',
  };
  const icon = kind => {
    const t = document.createElement('template');
    t.innerHTML = window.TnaiIcon(ICONS[kind] || ICONS.action, { size: 16 });
    return t.content.firstChild;
  };

  // The user-facing `tnai` commands (full list: `tnai help`); agent-only ones (close --self,
  // context mark) are left out.
  const TNAI_COMMANDS = [
    ['tnai agents', 'List the agents in this project'],
    ['tnai read NAME', 'Show the last lines an agent wrote'],
    ['tnai send NAME MESSAGE', 'Type a message into an agent (revives a closed one)'],
    ['tnai new claude TASK', 'Start a fresh Claude Code agent with a task'],
    ['tnai new codex TASK', 'Start a fresh Codex agent with a task'],
    ['tnai context', 'Finished work of the agents in this project'],
    ['tnai context TOPIC', 'Finished work about a topic or file'],
    ['tnai context note list', 'Project notes: goals, constraints, current state'],
    ['tnai context note add TEXT', 'Add a project note every agent follows'],
    ['tnai close NAME', 'Close agents no longer needed (add --user for ones you started)'],
    ['tnai skill list', 'Skills in the library, this project and ~/.claude/skills'],
    ['tnai preview URL', 'Show a localhost dev server in Live preview'],
    ['tnai help', 'Every tnai command with what it does'],
  ];
  const usable = el => el && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[hidden]');
  const goPage = sel => () => document.querySelector(sel)?.click();

  function commands() {
    const out = [];
    for (const el of document.querySelectorAll('.sidebar .side-item')) {
      if (!usable(el) || el.dataset.view === 'projects') continue;
      const name = el.textContent
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/\d+$/, '')
        .trim();
      if (name) out.push({ group: 'Pages', kind: 'page', label: name, run: () => el.click() });
    }
    const projects = window.TnaiProjects;
    if (projects && window.TnaiDesktop?.projects) {
      for (const p of projects.list())
        out.push({
          group: 'Projects',
          kind: 'project',
          label: p.name,
          current: p.active,
          warn: p.missing,
          hint: p.missing ? 'Folder not found' : p.path,
          run: () => {
            if (!p.active) projects.switchTo(p.path);
          },
          remove: () => projects.remove(p.path),
          removeLabel: 'Remove ' + p.name + ' from the project list (its files stay on disk)',
        });
      out.push({
        group: 'Projects',
        kind: 'add',
        label: 'Add project folder…',
        run: () => projects.add(),
      });
      if (projects.showFolder && projects.active())
        out.push({
          group: 'Projects',
          kind: 'add',
          label: 'Show project folder',
          hint: projects.active(),
          run: () => projects.showFolder(),
        });
      if (projects.create)
        out.push({
          group: 'Projects',
          kind: 'add',
          label: 'New project…',
          hint: 'A folder with the name you give, in Documents\\Technically Not',
          run: () => projects.create(),
        });
    }
    const act = (label, run, keys) =>
      out.push({ group: 'Actions', kind: 'action', label, run, keys });
    if (usable(document.querySelector('#send')))
      act('Focus the composer', () => document.getElementById('prompt')?.focus());
    const up = window.TnaiUpdates?.state?.();
    if (up && !['unconfigured', 'dev', 'off'].includes(up.status))
      act(up.status === 'ready' ? 'Restart to update Technically Not' : 'Check for updates', () =>
        up.status === 'ready' ? window.TnaiUpdates.confirmRestart() : window.TnaiUpdates?.checkNow()
      );
    if (window.TnaiHandoffHistory) act('Handoff history', () => window.TnaiHandoffHistory.open(''));
    if (window.TnaiTerminalCapture?.target())
      act(
        'Capture terminal screen (rows missing from a reply)',
        () => window.TnaiTerminalCapture.capture(),
        window.TnaiTerminalCapture.keys()
      );
    {
      const term = window.TnaiTerminalCapture?.target()?.term;
      if (term && window.TnaiClips?.latest(term))
        act('Play the latest clip shown in this terminal', () => window.TnaiClips.playLatest(term));
    } // 113: a clip link, without the mouse
    act(
      'Keyboard shortcuts',
      () =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '/',
            [window.tnaiPlatform.mac ? 'metaKey' : 'ctrlKey']: true,
            bubbles: true,
          })
        ),
      [window.tnaiPlatform.modName, '/']
    );

    // The `tnai` command runs in every terminal panel of the desktop app. Picking one puts it in
    // the composer, ready to send to the selected agent or PowerShell panel.
    const composer = document.getElementById('prompt');
    if (window.tnaiNative && usable(document.querySelector('#send')) && composer) {
      for (const [cmd, hint] of TNAI_COMMANDS)
        out.push({
          group: 'tnai commands',
          kind: 'command',
          label: cmd,
          hint,
          terms: hint,
          run: () => {
            if (!composer.offsetParent)
              // Settings hides the composer
              document.querySelector('.side-item[data-view="overview"]')?.click();
            composer.value = cmd.replace(/ (NAME|TASK|TEXT|URL|TOPIC|MESSAGE).*$/, ' ');
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            composer.focus();
            composer.setSelectionRange(composer.value.length, composer.value.length);
          },
        });
    }
    return out;
  }

  // Subsequence match; earlier and tighter matches rank higher. Returns 0 when the query letters
  // are not all present in order.
  function score(text, q) {
    if (!q) return 1;
    const t = text.toLowerCase(),
      i = t.indexOf(q);
    if (i >= 0) return 100 - Math.min(50, i);
    let at = -1,
      first = -1;
    for (const ch of q) {
      at = t.indexOf(ch, at + 1);
      if (at < 0) return 0;
      if (first < 0) first = at;
    }
    return 30 - Math.min(25, at - first - q.length);
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    let pool = commands();
    if (scope) pool = pool.filter(c => c.group === scope);
    items = pool
      .map(c => ({ ...c, s: Math.max(score(c.label, q), c.terms ? score(c.terms, q) / 2 : 0) }))
      .filter(c => c.s > 0);
    if (q) items.sort((a, b) => b.s - a.s);
    if (!scope) items = items.concat(fileHits);
    selected = Math.min(selected, Math.max(0, items.length - 1));
    list.replaceChildren();
    const counts = {};
    for (const c of items) counts[c.group] = (counts[c.group] || 0) + 1;
    let group = '',
      folder = null;
    items.forEach((c, i) => {
      if (c.group !== group) {
        group = c.group;
        folder = null;
        const h = document.createElement('div'),
          n = document.createElement('span');
        h.className = 'tnai-pal-group';
        h.textContent = group;
        n.className = 'tnai-pal-count';
        n.textContent = counts[group];
        h.append(n);
        list.append(h);
      }

      // Files are listed under their parent folder, so which file sits in which folder is visible
      // at a glance.
      if (c.folder != null && c.folder !== folder) {
        folder = c.folder;
        const f = document.createElement('div'),
          t = document.createElement('span');
        f.className = 'tnai-pal-folder';
        t.textContent = f.title = folder || 'Top level of the project';
        f.append(icon('folder'), t);
        list.append(f);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tnai-pal-item' + (c.folder != null ? ' nested' : '');
      b.setAttribute('role', 'option');
      b.id = 'tnaiPal' + i;
      b.setAttribute('aria-selected', String(i === selected));
      if (c.path) {
        b.dataset.path = c.path;
        b.title = c.path;
      }
      const main = document.createElement('span'),
        name = document.createElement('span');
      main.className = 'tnai-pal-main';
      name.textContent = c.label;
      main.append(icon(c.kind), name);
      b.append(main);
      if (c.current) {
        const p = document.createElement('span');
        p.className = 'tnai-pal-pill';
        p.textContent = 'Current';
        b.append(p);
      }
      if (c.hint) {
        const s = document.createElement('small');
        s.textContent = c.hint;
        s.title = c.hint;
        if (c.warn) s.className = 'warn';
        b.append(s);
      }
      if (c.keys) {
        const k = document.createElement('span');
        k.className = 'tnai-pal-keys';
        k.setAttribute('aria-label', 'Shortcut ' + c.keys.join('+'));
        for (const key of c.keys) {
          const e = document.createElement('kbd');
          e.textContent = key;
          k.append(e);
        }
        b.append(k);
      }
      b.onmousemove = () => {
        if (selected !== i) {
          selected = i;
          mark();
        }
      };
      b.onclick = () => run(i);
      if (c.remove) {
        const row = document.createElement('div'),
          x = document.createElement('button');
        row.className = 'tnai-pal-row';
        x.type = 'button';
        x.className = 'tnai-pal-remove';
        x.textContent = '×';
        x.tabIndex = -1;
        x.title = c.removeLabel;
        x.setAttribute('aria-label', c.removeLabel);
        x.onclick = e => {
          e.stopPropagation();
          removeItem(i);
        };
        row.append(b, x);
        list.append(row);
      } else list.append(b);
    });
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'tnai-pal-empty';
      p.textContent = q ? 'Nothing matches “' + input.value.trim() + '”.' : 'Nothing to show.';
      list.append(p);
    }
    mark();
  }

  function mark() {
    list
      .querySelectorAll('.tnai-pal-item')
      .forEach((b, i) => b.setAttribute('aria-selected', String(i === selected)));
    const cur = list.querySelector('#tnaiPal' + selected);
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    cur?.scrollIntoView({ block: 'nearest' });
  }

  // Project files by name (desktop app, a folder connected), through the same confined search the
  // Overview rail uses; a hit opens in its own view-only window (09).
  async function searchFiles() {
    const q = input.value.trim(),
      my = ++searchToken,
      fs = window.tnaiNative?.fs;
    if (scope || !fs || q.length < 2 || !window.TnaiProjects?.active?.()) {
      if (fileHits.length) {
        fileHits = [];
        render();
      }
      return;
    }
    let r;
    try {
      r = await fs.search(q, 8);
    } catch {
      return;
    }
    if (my !== searchToken || overlay.hidden) return;
    const hits = (r?.ok ? r.value.results : []).map(f => ({
      group: 'Files',
      kind: 'file',
      label: f.name,
      path: f.path,
      folder: String(f.path).split(/[\\/]/).slice(0, -1).join('/'),
      run: () => window.TnaiFileViewer?.open(f.path),
    }));

    // Keep the search ranking, but gather files of one folder together (folders in order of their
    // best match).
    fileHits = [...new Set(hits.map(h => h.folder))].flatMap(d => hits.filter(h => h.folder === d));
    render();
  }
  let searchTimer = 0;
  input.addEventListener('input', () => {
    selected = 0;
    render();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchFiles, 120);
  });

  function run(i) {
    const c = items[i];
    if (!c) return;
    close(false);
    try {
      c.run();
    } catch (error) {
      window.toast?.(error?.message || 'That command failed');
    }
  }

  // × on a project row (or Delete with an empty search) takes it off the list through the project
  // switcher's remove (09); files on disk are never touched.
  async function removeItem(i) {
    const c = items[i];
    if (!c?.remove) return;
    try {
      await c.remove();
    } catch (error) {
      window.toast?.(error?.message || 'Could not remove that project');
    }
    if (!overlay.hidden) {
      render();
      input.focus();
    }
  }

  function open(only) {
    scope = only || '';
    fileHits = [];
    selected = 0;
    if (overlay.hidden) lastFocus = document.activeElement;
    input.value = '';
    input.placeholder =
      scope === 'Projects'
        ? 'Switch to a project, or add one…'
        : 'Go to a page, project, file, action or tnai command…';
    foot.textContent =
      '↑ ↓ to choose · Enter to run' +
      (scope === 'Projects' ? ' · Delete to remove from the list' : '') +
      ' · Esc to close';
    overlay.hidden = false;
    render();
    input.focus();
  }

  function close(restore = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    searchToken++;
    if (restore && lastFocus?.isConnected) lastFocus.focus?.();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) {
        selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        mark();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(selected);
    } else if (e.key === 'Delete' && !input.value && items[selected]?.remove) {
      e.preventDefault();
      removeItem(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') e.preventDefault();
  });
  overlay.addEventListener('mousedown', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    'keydown',
    e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k')
        return;
      if (
        !(window.tnaiPlatform.mac && e.metaKey) &&
        e.target?.closest?.('.xterm, [contenteditable="true"]')
      )
        return; // Ctrl+K belongs to the terminal program there (kill to end of line)
      e.preventDefault();
      overlay.hidden ? open() : close();
    },
    true
  );
  document.getElementById('topCommand')?.addEventListener('click', () => open());
  document.querySelector('.side-item[data-view="projects"]')?.addEventListener(
    'click',
    e => {
      e.stopImmediatePropagation();
      if (window.TnaiDesktop?.projects) open('Projects');
    },
    true
  );

  window.TnaiPalette = { open, close, isOpen: () => !overlay.hidden };
})();
