// Technically Not · 09-project-folder.js — Real project folder: connect, lazy tree, editor in
// central workspace, verified Save, unsaved-edit drafts; desktop: project switcher and the Main | ⎇
// worktree toggle (the same tree showing an agent's worktree)

// Real project folder: File System Access API. Connect → lazy tree → open in the central workspace
// → explicit Save with reread verification.
(() => {
  const rail = document.querySelector('.repository-rail'),
    sampleTree = rail?.querySelector('.repo-rail-tree'),
    scroll = document.querySelector('.dock-scroll');
  if (!rail || !sampleTree || !scroll) return;
  const supported = typeof window.showDirectoryPicker === 'function';
  const TEXT_LIMIT = 2 * 1024 * 1024,
    PREVIEW_LIMIT = 64 * 1024,
    ENTRY_LIMIT = 1000;
  const head = rail.querySelector('.repository-rail-head'),
    sub = head?.querySelector('small'),
    search = rail.querySelector('#repoRailSearch'),
    note = rail.querySelector('.repository-rail-note'),
    sampleDetail = rail.querySelector('#repoFileDetail'),
    refresh = document.getElementById('repoRefresh');
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  let root = null,
    state = supported ? 'sample' : 'unsupported',
    stateDetail = '',
    current = null,
    openToken = 0;
  const handles = new Map();
  let projectPath = '',
    // desktop: the active project's full path and every open project (switcher below)
    projects = [];

  // Desktop: the project's Technically Not worktrees (lanes, fs:lanes) and the one the tree shows
  // (null = the project folder). A worktree's paths are keyed "⎇<lane id>/<path in it>" everywhere
  // (tree rows, open file, drafts, tabs), as 13's live file activity keys them, so its agents' tags
  // land on its rows.
  const LANE = '\u2387';
  let lanes = [],
    lane = null,
    laneHandle = null;
  const laneShort = l => String(l?.branch || l?.id || '').replace(/^tnai\//, '');
  const splitPath = p => {
    const m = String(p || '').startsWith(LANE) && /^.([^/]+)\/?(.*)$/su.exec(p);
    return m ? { laneId: m[1], rel: m[2] } : { laneId: '', rel: String(p || '') };
  };
  const display = p => {
    const s = splitPath(p);
    if (!s.laneId) return s.rel;
    const l = lanes.find(x => x.id === s.laneId);
    return '⎇ ' + (l ? laneShort(l) : s.laneId) + ' · ' + s.rel;
  };
  const treeBase = () => (lane ? LANE + lane.id : ''),
    treeRoot = () => (lane ? laneHandle : root);

  const style = document.createElement('style');
  style.textContent = `
.repo-connect{flex:none;display:grid;gap:8px;margin:10px 0 2px;padding:10px;border:1px solid #e7eae3;border-radius:7px;background:#f8f9f6}
.repo-connect p{margin:0;color:#7d8377;font:9px/1.5 var(--pg-sans);overflow-wrap:anywhere}.repo-connect p b{color:#4e5547;font-weight:600}
.repo-connect[data-state=connected]{background:#f3f6ee;border-color:#dfe6d5}.repo-connect[data-state=restorable],.repo-connect[data-state=reconnect]{background:#faf6ec;border-color:#eee3c9}
.repo-connect>div{display:flex;flex-wrap:wrap;gap:6px}.repo-connect>div:empty{display:none}
.repo-connect-button{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#5b6353;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}.repo-connect-button:hover{background:#f2f4ee}
.repo-connect-button.primary{background:#3d4a33;border-color:#3d4a33;color:#f3f7ec}.repo-connect-button.primary:hover{background:#4a5a3e}
.repo-connect[data-state=connected]{position:relative;display:flex;align-items:center;gap:6px;margin:8px 0 0;padding:0;border:0;border-radius:0;background:none}
.repo-connect[data-state=connected] p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;overflow-wrap:normal;font-size:10px;cursor:default}
.repo-connect[data-state=connected]>div{flex:none}
.repo-connect-more{box-sizing:border-box;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:6px;background:none;color:#73796c;font:700 12px/1 var(--pg-sans);letter-spacing:1px;cursor:pointer}
.repo-connect-more:hover,.repo-connect-more[aria-expanded=true]{border-color:#e5e8e0;background:#f4f6f1;color:#44493f}
.repo-connect-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:40;display:grid;gap:1px;min-width:160px;padding:4px;border:1px solid #e5e8e0;border-radius:7px;background:#fff;box-shadow:0 6px 18px rgba(40,46,34,.12)}
.repo-connect-menu[hidden]{display:none}
.repo-connect-menu .repo-connect-button{width:100%;height:24px;border:0;border-radius:4px;background:none;text-align:left}.repo-connect-menu .repo-connect-button:hover,.repo-connect-menu .repo-connect-button:focus-visible{background:#f4f6f1;outline:none}
.repository-rail .repo-rail-tree[hidden]{display:none!important}#repoRailSearch{flex:none}
.repo-filtering .repo-folder-children[data-loaded]{display:grid!important}.repo-filtering .repo-info-row{display:none!important}
.repo-info-row{padding:6px 10px;color:#9a9f94;font:italic 9px var(--pg-sans)}
.repo-row[aria-busy=true] .repo-chevron{opacity:.4}.repo-row.repo-dirty .repo-row-name:after{content:' ●';color:#b8913f}
.dock-scroll.repo-editor-open{overflow:hidden!important}
.repo-editor{box-sizing:border-box;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;height:100%;min-height:360px;padding:16px 18px 12px;border:1px solid #e4e8df;border-radius:9px;background:#fff;box-shadow:0 3px 12px #20211f07}
.repo-editor[hidden]{display:none!important}
.repo-editor-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding-bottom:12px;border-bottom:1px solid #eceee9}
.repo-editor-title{min-width:0}.repo-editor-title small{color:#969a90;font:8px var(--pg-sans);letter-spacing:.1em}
.repo-editor-title h2{margin:6px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#393d35;font:600 16px var(--pg-sans)}
.repo-editor-path{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#858a7f;font:10px Consolas,Menlo,monospace}
.repo-editor-actions{display:flex;align-items:center;gap:7px;flex:none}
@media (max-width:900px){.repo-editor-head,.repo-editor-head>.repo-editor-actions{flex-wrap:wrap}} /* narrow window: the actions flow under the title instead of widening the editor past its column */
.repo-editor-state{padding:5px 8px;border-radius:99px;background:#f0f2ed;color:#747a6e;font:9px var(--pg-sans);white-space:nowrap}
.repo-editor-state[data-tone=dirty]{background:#f7f2e5;color:#967331}.repo-editor-state[data-tone=saved]{background:#eff3e9;color:#5c7d43}.repo-editor-state[data-tone=error]{background:#f8eeec;color:#a45750}
.repo-editor-save:disabled,.repo-editor-reload:disabled{opacity:.45;cursor:default}
.repo-editor-meta{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 0;color:#8a8f84;font:9px var(--pg-sans)}.repo-editor-meta b{margin-left:5px;color:#4e5547;font-weight:500}
.repo-editor-body{display:grid;min-height:0}
.repo-editor-text{box-sizing:border-box;width:100%;height:100%;min-height:220px;margin:0;padding:12px 14px;resize:none;border:1px solid #e5e8e0;border-radius:6px;background:#fbfcf9;color:#34382f;font:12px/1.55 Consolas,'Cascadia Mono',Menlo,monospace;tab-size:2;white-space:pre;overflow:auto;outline:none}
.repo-editor-text:focus{border-color:#bec9ad;background:#fff}.repo-editor-text[readonly]{background:#f7f8f5;color:#5e6458}
.repo-editor-notice{display:grid;justify-items:center;align-content:center;gap:8px;min-height:180px;padding:20px;text-align:center;color:#6e7467}
.repo-editor-notice b{font:600 12px var(--pg-sans);color:#53594d}.repo-editor-notice p{max-width:440px;margin:0;color:#8d9288;font:10px/1.55 var(--pg-sans)}
.repo-editor-notice .repo-editor-actions{display:flex;gap:8px;justify-content:center;margin-top:4px}.repo-editor-body.has-preview{grid-template-rows:auto minmax(0,1fr)}.repo-editor-body.has-preview .repo-editor-notice{min-height:0;padding:4px 0 12px}
.repo-editor-draft{flex-basis:100%;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 9px;border:1px solid #eee3c9;border-radius:6px;background:#faf6ec;color:#8a6f35;font:10px var(--pg-sans)}.repo-editor-draft .button{height:24px;padding:0 8px;border-radius:6px;font-size:10px}
.repo-editor-message{min-height:14px;margin:9px 0 0;color:#858a80;font:10px/1.4 var(--pg-sans)}.repo-editor-message[data-tone=error]{color:#a45750}.repo-editor-message[data-tone=ok]{color:#5c7d43}
`;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'repo-connect';
  bar.setAttribute('aria-live', 'polite');
  const barText = document.createElement('p'),
    barActions = document.createElement('div');
  bar.append(barText, barActions);
  (head || search)?.after(bar);
  const realTree = document.createElement('div');
  realTree.className = 'repo-rail-tree repo-real-tree';
  realTree.setAttribute('role', 'tree');
  realTree.setAttribute('aria-label', 'Connected project files');
  realTree.hidden = true;
  sampleTree.after(realTree);

  const editor = document.createElement('section');
  editor.className = 'repo-editor';
  editor.hidden = true;
  editor.setAttribute('aria-label', 'Project file editor');
  editor.innerHTML =
    '<header class="repo-editor-head"><div class="repo-editor-title"><small>PROJECT FILE · LOCAL FOLDER</small><h2></h2><p class="repo-editor-path"></p></div><div class="repo-editor-actions"><span class="repo-editor-state" aria-live="polite"></span><button type="button" class="button repo-editor-reload" title="Read this file from disk again">Reload</button><button type="button" class="button dark repo-editor-save" title="Save to disk (' +
    window.tnaiKeys('Ctrl+S') +
    ')">Save</button><button type="button" class="repo-detail-close repo-editor-close" title="Close file" aria-label="Close file">' +
    window.TnaiIcon('x', { size: 14 }) +
    '</button></div></header><div class="repo-editor-meta"></div><div class="repo-editor-body"></div><p class="repo-editor-message" role="status"></p>';
  scroll.append(editor);
  const $ = selector => editor.querySelector(selector),
    saveButton = $('.repo-editor-save'),
    reloadButton = $('.repo-editor-reload'),
    stateEl = $('.repo-editor-state'),
    messageEl = $('.repo-editor-message');

  // IndexedDB keeps only the folder handle so access can be restored after reload; the browser
  // still owns permission.
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open('tnai-project-folder', 1);
      } catch (error) {
        reject(error);
        return;
      }
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        let out;
        try {
          const tx = db.transaction('handles', mode);
          out = fn(tx.objectStore('handles'));
          tx.oncomplete = () => {
            db.close();
            resolve(out?.result);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        } catch (error) {
          db.close();
          reject(error);
        }
      };
    });
  }
  const storeRoot = handle => idb('readwrite', s => s.put(handle, 'root')),
    loadStoredRoot = () => idb('readonly', s => s.get('root')),
    forgetRoot = () => {
      window.TnaiDesktop?.forget();
      return idb('readwrite', s => s.delete('root'));
    };

  const isPermissionError = error =>
    error?.name === 'NotAllowedError' || error?.name === 'SecurityError';

  function explain(error, action) {
    const name = error?.name;
    if (isPermissionError(error))
      return 'Could not ' + action + ': permission was not granted or has expired.';
    if (name === 'NotFoundError')
      return 'Could not ' + action + ': it no longer exists at this location.';
    if (
      name === 'NoModificationAllowedError' ||
      name === 'InvalidModificationError' ||
      name === 'InvalidStateError'
    )
      return (
        'Could not ' + action + ': the file is locked, read-only, or in use by another program.'
      );
    if (name === 'QuotaExceededError')
      return 'Could not ' + action + ': there is not enough disk space.';
    if (name === 'TypeMismatchError')
      return 'Could not ' + action + ': the item changed type on disk.';
    return 'Could not ' + action + (error?.message ? ': ' + error.message : '.');
  }
  const formatSize = bytes =>
    bytes < 1024
      ? bytes + ' B'
      : bytes < 1048576
        ? (bytes / 1024).toFixed(1) + ' KB'
        : (bytes / 1048576).toFixed(1) + ' MB';
  const kinds = {
    tsx: 'TypeScript JSX',
    ts: 'TypeScript',
    jsx: 'JavaScript JSX',
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    css: 'Stylesheet',
    scss: 'Stylesheet',
    json: 'JSON',
    md: 'Markdown',
    html: 'HTML',
    htm: 'HTML',
    svg: 'SVG',
    py: 'Python',
    txt: 'Text',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    sh: 'Shell',
    ps1: 'PowerShell',
    png: 'Image',
    jpg: 'Image',
    jpeg: 'Image',
    gif: 'Image',
    webp: 'Image',
    ico: 'Icon',
    pdf: 'PDF',
    zip: 'Archive',
    woff: 'Font',
    woff2: 'Font',
    ttf: 'Font',
  };
  const extOf = name => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

  function fileIcon(name) {
    const ext = extOf(name),
      span = document.createElement('span');
    span.className = 'repo-file-icon';
    const map = {
      ts: ['TS', 'ts'],
      tsx: ['TS', 'ts'],
      js: ['JS', 'ts'],
      jsx: ['JS', 'ts'],
      mjs: ['JS', 'ts'],
      cjs: ['JS', 'ts'],
      css: ['#', 'css'],
      scss: ['#', 'css'],
      json: ['{ }', 'json'],
      md: ['M', 'md'],
    }[ext];
    span.textContent = map ? map[0] : ext.slice(0, 2).toUpperCase() || '·';
    if (map) span.classList.add(map[1]);
    return span;
  }

  function renderBar() {
    barActions.replaceChildren();
    const add = (label, fn, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'repo-connect-button' + (primary ? ' primary' : '');
      b.textContent = label;
      b.onclick = fn;
      barActions.append(b);
    };
    bar.dataset.state = state;
    const name = root?.name || '';
    const crumb = document.getElementById('projectCrumb');
    if (crumb) crumb.textContent = name || 'No project folder';
    const pc = document.getElementById('pgProjCount');
    if (pc) pc.textContent = projects.length > 1 ? '· ' + projects.length + ' projects open' : '';
    if (state === 'unsupported')
      barText.textContent =
        'This browser cannot open local project folders (the File System Access API is unavailable). Use a current desktop Chrome or Edge to connect one. The files below are an illustrative sample.';
    else if (state === 'sample') {
      barText.textContent =
        'Not connected. The files below are an illustrative sample, not your project.';
      add('Connect project folder', connect, true);
      if (window.TnaiDesktop?.createProject) add('New project…', newProject);
    } else if (state === 'restorable') {
      barText.textContent =
        stateDetail || 'The browser needs you to confirm access to “' + name + '” again.';
      add('Restore access', restore, true);
      add('Choose another folder', connect);
    } else if (state === 'reconnect') {
      barText.textContent =
        (stateDetail ? stateDetail + ' ' : '') + 'Connect the folder again to continue.';
      add('Reconnect folder', connect, true);
    } else {
      // One line: folder name (the explanation is its tooltip) + a ⋯ menu with the folder actions.
      barText.replaceChildren(
        'Local folder ',
        Object.assign(document.createElement('b'), { textContent: name })
      );
      barText.title =
        'Connected to local folder ' +
        name +
        '. Files are written only when you press Save. This does not build the project, run agents, or update the preview.';
      add(window.TnaiDesktop?.projects ? 'Add project folder…' : 'Change folder', connect);
      if (window.TnaiDesktop?.createProject) add('New project…', newProject);
      add('Disconnect', disconnect);
      const items = [...barActions.children];
      items.forEach(b => {
        b.setAttribute('role', 'menuitem');
        b.tabIndex = -1;
        const run = b.onclick;
        b.onclick = () => {
          closeBarMenu();
          run();
        };
      });
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'repo-connect-more';
      more.innerHTML = window.TnaiIcon('ellipsis', { size: 16 });
      more.title = 'Folder actions';
      more.setAttribute('aria-label', 'Folder actions');
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      const list = document.createElement('div');
      list.className = 'repo-connect-menu';
      list.setAttribute('role', 'menu');
      list.setAttribute('aria-label', 'Folder actions');
      list.hidden = true;
      list.append(...items);
      more.onclick = event => {
        list.hidden ? openBarMenu(event.detail === 0) : closeBarMenu();
      };
      list.onkeydown = event => {
        const i = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
        } else if (event.key === 'Tab') closeBarMenu();
      };
      barActions.append(more, list);
    }
    bar.dataset.root = state === 'connected' ? projectPath || name : '';
    const connected = state === 'connected';
    sampleTree.hidden = connected;
    realTree.hidden = !connected;
    if (sub)
      sub.textContent = connected
        ? name + ' · local folder'
        : state === 'restorable' || state === 'reconnect'
          ? name + ' · access needed'
          : 'Illustrative sample · not connected';
    renderSwitch();
    renderLanes();
    if (note)
      note.textContent = connected
        ? window.tnaiNative?.fs?.search
          ? 'Folders load when you expand them. Search covers the whole project.'
          : 'Folders load when you expand them. The filter searches loaded items only.'
        : 'Sample structure · illustrative only. No project files are mounted.';
    if (search)
      search.placeholder = connected
        ? window.tnaiNative?.fs?.search
          ? 'Search project files…'
          : 'Filter loaded files…'
        : 'Filter sample files…';
    if (refresh)
      refresh.title = connected ? 'Reload folder contents from disk' : 'Reset sample view';
    if (connected && sampleDetail && !sampleDetail.hidden) {
      sampleDetail.hidden = true;
      rail.classList.remove('has-file-selection');
      sampleTree.querySelectorAll('.selected').forEach(row => row.classList.remove('selected'));
    }
  }
  const barMenu = () => [
    bar.querySelector('.repo-connect-more'),
    bar.querySelector('.repo-connect-menu'),
  ];

  function openBarMenu(focusFirst) {
    const [more, list] = barMenu();
    if (!list) return;
    list.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    if (focusFirst) list.querySelector('button')?.focus();
  }

  function closeBarMenu(refocus) {
    const [more, list] = barMenu();
    if (!list || list.hidden) return;
    list.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (refocus) more.focus();
  }
  document.addEventListener('click', event => {
    const [more, list] = barMenu();
    if (list && !list.contains(event.target) && !more.contains(event.target)) closeBarMenu();
  });
  document.addEventListener(
    'keydown',
    event => {
      const list = barMenu()[1];
      if (event.key === 'Escape' && list && !list.hidden) {
        event.stopPropagation();
        closeBarMenu(true);
      }
    },
    true
  );

  function lose(error, detail) {
    if (isPermissionError(error)) {
      state = 'restorable';
      stateDetail =
        'Access to “' +
        root.name +
        '” has expired or was revoked. Restore access to keep browsing and saving.';
    } else {
      state = 'reconnect';
      stateDetail = detail;
    }
    renderBar();
  }

  async function connect() {
    // Desktop: picking a folder adds it to the open projects and makes it active; unsaved edits
    // stay as drafts of the project being left.
    const desk = Boolean(window.TnaiDesktop?.projects);
    if (!supported || (desk ? (drafts.saveNow(), false) : !(await confirmDiscard()))) return;
    let handle;
    const previous = projectPath;
    try {
      handle = await window.showDirectoryPicker({ id: 'tnai-project', mode: 'read' });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      say(
        error?.name === 'SecurityError'
          ? 'The browser blocked folder access in this context. Open Technically Not directly in Chrome or Edge.'
          : explain(error, 'open that folder')
      );
      return;
    }
    closeEditor(true);
    root = handle;
    state = 'connected';
    stateDetail = '';
    lane = null;
    laneHandle = null;
    if (desk) await loadProjects(true);
    try {
      await storeRoot(handle);
    } catch {
      say(
        'Folder connected. This browser could not remember it, so you will need to reconnect after a reload.'
      );
    }
    if (await loadRootTree()) say('Connected to ' + handle.name);
    if (desk) {
      projectChanged(previous);
      loadLanes();
    }
  }

  // Desktop: a new project from just a name.
  // The desktop process makes the folder in Documents\Technically Not (fs-service.js `create`: a
  // name, never a path; refused when it exists) and it opens like a picked one (connect()).
  async function newProject() {
    if (!window.TnaiDesktop?.createProject) return;
    drafts.saveNow();
    const name = await prompt(
      'Name of the new project. A folder with this name is made in Documents\\Technically Not.',
      ''
    );
    if (!name || !String(name).trim()) return;
    let handle;
    const previous = projectPath;
    try {
      handle = await window.TnaiDesktop.createProject(String(name));
    } catch (error) {
      say(error?.message || 'Could not make that project folder.');
      return;
    }
    closeEditor(true);
    root = handle;
    state = 'connected';
    stateDetail = '';
    lane = null;
    laneHandle = null;
    await loadProjects(true);
    try {
      await storeRoot(handle);
    } catch {}
    if (await loadRootTree()) say('New project “' + handle.name + '” is ready');
    projectChanged(previous);
    loadLanes();
  }

  async function restore() {
    try {
      const permission = await root.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        state = 'restorable';
        stateDetail =
          'Access to “' +
          root.name +
          '” was not granted. Restore access or choose the folder again.';
        renderBar();
        return;
      }
      state = 'connected';
      stateDetail = '';
      const expanded = [...realTree.querySelectorAll('.repo-folder[aria-expanded="true"]')].map(
        row => row.dataset.realPath
      );
      await loadRootTree(expanded);
    } catch (error) {
      state = 'reconnect';
      stateDetail = explain(error, 'restore access');
      renderBar();
    }
  }

  async function disconnect() {
    if (!(await confirmDiscard())) return;
    closeEditor(true);
    root = null;
    lane = null;
    laneHandle = null;
    lanes = [];
    renderLanes();
    handles.clear();
    realTree.replaceChildren();
    state = 'sample';
    stateDetail = '';
    try {
      await forgetRoot();
    } catch {}
    const previous = projectPath;
    if (window.TnaiDesktop?.projects) {
      await loadProjects(true);
      projectChanged(previous);
    }
    renderBar();
    say('Project folder disconnected');
  }

  async function loadRootTree(expanded = []) {
    renderBar();
    handles.clear();
    handles.set(treeBase(), treeRoot());
    const fragment = document.createElement('div');
    if (!(await fillFolder(treeRoot(), treeBase(), fragment, 0, true))) return false;
    realTree.replaceChildren(...fragment.childNodes);
    for (const path of expanded) {
      const row = rowFor(path);
      if (row && row.getAttribute('aria-expanded') !== 'true') await toggleFolder(row, true);
    }
    markRows();
    applyFilter();
    return true;
  }

  async function fillFolder(dir, base, container, depth, isRoot) {
    const entries = [];
    try {
      for await (const entry of dir.values()) entries.push(entry);
    } catch (error) {
      if (lane) say(explain(error, 'read ' + (display(base) || 'the worktree')));
      else if (isRoot) lose(error, explain(error, 'read “' + (root?.name || 'the folder') + '”'));
      else if (isPermissionError(error)) lose(error);
      else say(explain(error, 'read ' + base));
      return false;
    }
    entries.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    const nodes = [];
    if (!entries.length) nodes.push(infoRow('Empty folder', depth));
    for (const entry of entries.slice(0, ENTRY_LIMIT)) {
      const path = base ? base + '/' + entry.name : entry.name;
      handles.set(path, entry);
      nodes.push(
        ...(entry.kind === 'directory'
          ? folderRow(entry.name, path, depth)
          : [fileRow(entry.name, path, depth)])
      );
    }
    if (entries.length > ENTRY_LIMIT)
      nodes.push(
        infoRow(entries.length - ENTRY_LIMIT + ' more items in this folder are not listed', depth)
      );
    container.replaceChildren(...nodes);
    return true;
  }

  function indent(el, depth) {
    el.style.setProperty('padding-left', 10 + depth * 18 + 'px', 'important');
  }

  function infoRow(text, depth) {
    const row = document.createElement('div');
    row.className = 'repo-info-row';
    row.textContent = text;
    indent(row, depth);
    return row;
  }

  function baseRow(name, path, depth) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'repo-row';
    row.dataset.realPath = path;
    row.dataset.depth = depth;
    row.title = splitPath(path).rel;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', depth + 1);
    indent(row, depth);
    return row;
  }

  function folderRow(name, path, depth) {
    const row = baseRow(name, path, depth);
    row.classList.add('repo-folder');
    row.setAttribute('aria-expanded', 'false');
    row.innerHTML =
      '<span class="repo-chevron">' +
      window.TnaiIcon('chevron-right', { size: 12 }) +
      '</span><span class="repo-folder-icon">' +
      window.TnaiIcon('folder', { size: 13 }) +
      '</span><span class="repo-row-name"></span>';
    row.querySelector('.repo-row-name').textContent = name;
    const children = document.createElement('div');
    children.className = 'repo-folder-children';
    children.setAttribute('role', 'group');
    children.hidden = true;
    return [row, children];
  }

  function fileRow(name, path, depth) {
    const row = baseRow(name, path, depth);
    row.classList.add('repo-file');
    const spacer = document.createElement('span');
    spacer.className = 'repo-chevron';
    const label = document.createElement('span');
    label.className = 'repo-row-name';
    label.textContent = name;
    const kind = document.createElement('span');
    kind.className = 'repo-file-kind';
    kind.textContent = kinds[extOf(name)] || 'File';
    const location = document.createElement('span');
    location.className = 'repo-file-path';
    location.textContent = splitPath(path).rel;
    row.append(spacer, fileIcon(name), label, kind, location);
    return row;
  }
  const rowFor = path => realTree.querySelector('[data-real-path="' + CSS.escape(path) + '"]');

  async function toggleFolder(row, quiet) {
    const path = row.dataset.realPath,
      children = row.nextElementSibling,
      open = row.getAttribute('aria-expanded') !== 'true';
    if (open && !children.dataset.loaded) {
      row.setAttribute('aria-busy', 'true');
      const ok = await fillFolder(
        handles.get(path),
        path,
        children,
        Number(row.dataset.depth) + 1,
        false
      );
      row.removeAttribute('aria-busy');
      if (!ok) return;
      children.dataset.loaded = '1';
    }
    row.setAttribute('aria-expanded', String(open));
    children.hidden = !open;
    row.querySelector('.repo-chevron').innerHTML = open
      ? window.TnaiIcon('chevron-down', { size: 12 })
      : window.TnaiIcon('chevron-right', { size: 12 });
    if (!quiet) {
      markRows();
      applyFilter();
    }
  }
  realTree.addEventListener('click', event => {
    const row = event.target.closest('[data-real-path]');
    if (!row) return;
    if (row.classList.contains('repo-folder')) {
      toggleFolder(row);
      return;
    }
    window.TnaiFileViewer.open(row.dataset.realPath);
  });

  function markRows() {
    const path = current?.path,
      dirty = isDirty();
    realTree.querySelectorAll('[data-real-path]').forEach(row => {
      const active = row.dataset.realPath === path;
      row.classList.toggle('selected', active);
      row.classList.toggle('repo-dirty', active && dirty);
      if (row.classList.contains('repo-file')) row.setAttribute('aria-selected', String(active));
    });
  }

  function applyFilter() {
    const query = (search?.value || '').trim().toLowerCase(),
      rows = [...realTree.querySelectorAll('[data-real-path]')];
    realTree.classList.toggle('repo-filtering', Boolean(query));
    if (!query) {
      rows.forEach(row => (row.hidden = false));
      return;
    }
    const keep = new Set();
    rows.forEach(row => {
      const path = row.dataset.realPath;
      if (!path.toLowerCase().includes(query)) return;
      keep.add(path);
      for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1))
        keep.add(path.slice(0, i));
    });
    rows.forEach(row => (row.hidden = !keep.has(row.dataset.realPath)));
  }
  if (search) {
    const sampleFilter = search.oninput;
    search.oninput = event => {
      if (state === 'connected') applyFilter();
      else sampleFilter?.call(search, event);
    };
  }

  // Files added or removed: re-list only the loaded folders that changed ('' = the top level, null
  // = everything), keeping their expanded sub-folders open. Calls within 250 ms merge into one
  // pass, and passes never overlap, so a burst of changes costs one small rebuild instead of a full
  // one per change.
  let reloadDirsPending = null,
    reloadDirsTimer = 0,
    reloadDirsRunning = null;

  function reloadDirs(dirs) {
    if (state !== 'connected') return;
    if (!reloadDirsPending) reloadDirsPending = new Set();
    if (dirs == null) reloadDirsPending.add(null);
    else for (const d of dirs) reloadDirsPending.add(d);
    if (!reloadDirsTimer)
      reloadDirsTimer = setTimeout(async () => {
        try {
          await reloadDirsRunning;
        } catch {}
        reloadDirsTimer = 0;
        const dirs = reloadDirsPending;
        reloadDirsPending = null;
        reloadDirsRunning = runReloadDirs(dirs).catch(() => {});
      }, 250);
  }

  async function runReloadDirs(dirs) {
    if (state !== 'connected') return;

    // Every folder is refilled in place (rows keyed by path), so a child needs its own pass:
    // parents first, so a removed parent's rows are gone before its children are looked up.
    const loadedFolders = () =>
      [...realTree.querySelectorAll('.repo-folder')]
        .filter(r => r.nextElementSibling?.dataset.loaded)
        .map(r => r.dataset.realPath);
    const list = [...new Set(dirs.has(null) ? [treeBase(), ...loadedFolders()] : dirs)].sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
    );
    for (const dir of list) {
      if (dir === treeBase()) {
        if (!(await refillInPlace(realTree, treeRoot(), dir, 0, true))) return;
        continue;
      }
      const row = rowFor(dir),
        children = row?.nextElementSibling,
        handle = handles.get(dir);

      // not loaded yet: it lists fresh when opened
      if (!row || !children?.dataset.loaded || !handle) continue;
      await refillInPlace(children, handle, dir, Number(row.dataset.depth) + 1, false);
    }
    markRows();
    applyFilter();
  }

  // Re-lists one folder without rebuilding it: rows that still exist stay the same DOM nodes (a
  // folder keeps its expanded, loaded children), new rows are inserted in sorted place and removed
  // ones taken out, so the tree never collapses, the scroll holds and a focused row keeps focus.
  async function refillInPlace(container, handle, base, depth, isRoot) {
    const fragment = document.createElement('div');
    if (!(await fillFolder(handle, base, fragment, depth, isRoot))) return false;
    const key = n =>
      n.dataset.realPath == null
        ? null
        : (n.classList.contains('repo-folder') ? 'd:' : 'f:') + n.dataset.realPath;
    const old = new Map();
    for (const n of container.children) {
      const k = key(n);
      if (k) old.set(k, n.classList.contains('repo-folder') ? [n, n.nextElementSibling] : [n]);
    }
    const next = [],
      fresh = [...fragment.children];
    for (let i = 0; i < fresh.length; i++) {
      const n = fresh[i],
        k = key(n),
        folder = n.classList.contains('repo-folder'),
        prev = k && old.get(k);
      if (prev) {
        next.push(...prev);
        old.delete(k);
      } else {
        next.push(n);
        if (folder) next.push(fresh[i + 1]);
      }
      if (folder) i++;
    }
    for (const k of old.keys()) {
      const gone = k.slice(2);
      for (const p of [...handles.keys()])
        if (p === gone || p.startsWith(gone + '/')) handles.delete(p);
    } // removed entries
    const keep = new Set(next);
    for (const n of [...container.children]) if (!keep.has(n)) n.remove();
    let ref = container.firstElementChild;
    for (const n of next) {
      if (n === ref) ref = ref.nextElementSibling;
      else container.insertBefore(n, ref);
    }
    return true;
  }

  // Used by the file tabs (24) and live agent activity (reload after files are added or removed).
  // open() is wrapped by the file tabs (24); openRaw(path,true) switches files keeping unsaved
  // edits as a draft that comes back on return (drafts from before a restart are offered instead).
  window.TnaiProjectFiles = {
    tree: realTree,
    open: path => (state === 'connected' ? openFile(path) : undefined),
    openRaw: (path, keep) => (state === 'connected' ? openFile(path, false, keep) : undefined),
    current: () => current?.path || '',
    dirty: () => isDirty(),
    stash: () => drafts.saveNow(),
    hasDraft: path => Boolean(drafts.get(path)),
    dropDraft: path => drafts.drop(path),
    close: force => closeEditor(force),
    connected: () => state === 'connected',
    refresh: mode => (state === 'connected' ? refreshOpen(mode) : Promise.resolve(false)),
    reload: () =>
      state === 'connected'
        ? loadRootTree(
            [...realTree.querySelectorAll('.repo-folder[aria-expanded="true"]')].map(
              row => row.dataset.realPath
            )
          )
        : false,
    // project-folder changes (13); a shown worktree follows its own batches (below)
    reloadDirs: dirs => (lane ? undefined : reloadDirs(dirs)),
    lane: () => (lane ? { ...lane } : null),
    lanes: () => lanes.map(l => ({ ...l })),
    setLane: id => selectLane(id || ''),
    label: path => display(path),
    askDiscard: path => askDiscard(path),
  };

  if (refresh) {
    const sampleRefresh = refresh.onclick;
    refresh.onclick = async event => {
      if (state !== 'connected') {
        sampleRefresh?.call(refresh, event);
        return;
      }
      const expanded = [...realTree.querySelectorAll('.repo-folder[aria-expanded="true"]')].map(
        row => row.dataset.realPath
      );
      if (await loadRootTree(expanded)) say('Folder contents reloaded from disk');
    };
  }

  // Editor: opens in the central workspace in place of the dock grid; the rail stays on the right.
  const normalized = text => text.replace(/\r\n?/g, '\n');

  function isDirty() {
    const area = editor.querySelector('.repo-editor-text:not([readonly])');
    return Boolean(current?.editable && area && area.value !== normalized(current.text));
  }

  // In-app question (same overlay/modal look as the workspace delete confirm) instead of the native
  // confirm box; resolves true on Discard, false on Cancel/Escape/backdrop.
  let discardAsk = null;

  function askDiscard(path) {
    if (discardAsk) return discardAsk;
    return (discardAsk = new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'bw-confirm-overlay';
      box.innerHTML =
        '<section class="bw-file-modal" role="alertdialog" aria-modal="true" aria-labelledby="repoDiscardTitle"><h2 id="repoDiscardTitle"></h2><div class="bw-confirm-actions"><button type="button" class="bw-cancel">Cancel</button><button type="button" class="bw-confirm-delete">Discard</button></div></section>';
      box.querySelector('h2').textContent = 'Discard unsaved changes to ' + display(path) + '?';
      const previous = document.activeElement;
      const done = ok => {
        document.removeEventListener('keydown', key, true);
        box.remove();
        discardAsk = null;
        try {
          previous?.focus?.();
        } catch {}
        resolve(ok);
      };
      const key = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          done(false);
        }
      };
      box.querySelector('.bw-cancel').onclick = () => done(false);
      box.querySelector('.bw-confirm-delete').onclick = () => done(true);
      box.addEventListener('click', event => {
        if (event.target === box) done(false);
      });
      document.addEventListener('keydown', key, true);
      document.body.append(box);
      box.querySelector('.bw-cancel').focus();
    }));
  }

  async function confirmDiscard() {
    if (!isDirty()) return true;
    const ok = await askDiscard(current.path);
    if (ok) drafts.drop(current.path);
    return ok;
  }

  // Unsaved edits are kept per file in localStorage, so a crash, close, or reload does not lose
  // them; reopening the file offers them back. Desktop: drafts are kept per project (paths are
  // relative, so two projects could share one), under the key + '|' + the project's full path.
  const drafts = {
    get key() {
      return 'tnai.editor-drafts.v1' + (projectPath ? '|' + projectPath : '');
    },
    timer: 0,
    all() {
      try {
        return JSON.parse(localStorage.getItem(this.key)) || {};
      } catch {
        return {};
      }
    },
    write(all) {
      try {
        localStorage.setItem(this.key, JSON.stringify(all));
      } catch {}
    },
    get(path) {
      return this.all()[path] || null;
    },
    drop(path) {
      const all = this.all();
      if (all[path]) {
        delete all[path];
        this.write(all);
      }
    },
    saveNow() {
      clearTimeout(this.timer);
      const area = editor.querySelector('.repo-editor-text:not([readonly])');
      if (!current?.editable || !area) return;
      if (isDirty()) {
        const all = this.all();
        all[current.path] = { text: area.value, modified: current.modified, at: Date.now() };
        this.write(all);
      } else this.drop(current.path);
    },
    save() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.saveNow(), 400);
    },
    offer(file, area) {
      const draft = this.get(file.path);
      if (!draft || draft.text === area.value) return;
      const bar = document.createElement('span');
      bar.className = 'repo-editor-draft';
      bar.textContent =
        'Unsaved edits from ' +
        new Date(draft.at).toLocaleString() +
        ' were recovered.' +
        (draft.modified !== file.modified ? ' The file changed on disk since then.' : '') +
        ' ';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'button';
      restore.textContent = 'Restore edits';
      restore.onclick = () => {
        area.value = draft.text;
        bar.remove();
        renderState();
        markRows();
      };
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'button';
      discard.textContent = 'Discard';
      discard.onclick = () => {
        this.drop(file.path);
        bar.remove();
      };
      bar.append(restore, discard);
      $('.repo-editor-meta').append(bar);
    },
  };
  window.addEventListener('beforeunload', () => drafts.saveNow());

  function showEditor() {
    editor.hidden = false;
    scroll.classList.add('repo-editor-open');
  }

  async function closeEditor(force) {
    if (!force && !(await confirmDiscard())) return;
    openToken++;
    current = null;
    editor.hidden = true;
    scroll.classList.remove('repo-editor-open');
    markRows();
  }

  async function decodeTextBytes(file) {
    if (file.size > TEXT_LIMIT) {
      const head = new Uint8Array(await file.slice(0, PREVIEW_LIMIT).arrayBuffer());
      if (head.subarray(0, 8192).includes(0))
        return {
          editable: false,
          reason:
            'This file is larger than 2 MB and looks binary, so it is view-only and its contents are not shown.',
        };
      return {
        editable: false,
        reason:
          'This file is larger than 2 MB, so Technically Not opens it view-only. The first 64 KB are shown below.',
        preview: new TextDecoder('utf-8').decode(head),
      };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.subarray(0, 8192).includes(0))
      return {
        editable: false,
        reason: 'This looks like a binary file, so it is view-only and its contents are not shown.',
      };
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return {
        editable: false,
        reason:
          'This file is not valid UTF-8 text. It is view-only so Technically Not cannot corrupt it by saving it in a different encoding.',
      };
    }
    const crlf = (text.match(/\r\n/g) || []).length,
      lf = (text.match(/\n/g) || []).length - crlf,
      cr = (text.match(/\r(?!\n)/g) || []).length;
    return {
      editable: true,
      text,
      eol: crlf > lf ? '\r\n' : '\n',
      mixedEol: Boolean((crlf && lf) || cr),
      bom: text.charCodeAt(0) === 0xfeff,
    };
  }
  let restoring = '';

  // drafts older than this page load came from before a restart: offered, not restored silently
  const pageStart = Date.now();

  async function openFile(path, force, keep) {
    if (!force && current?.path === path) {
      showEditor();
      return;
    }
    if (keep) {
      drafts.saveNow();
      restoring = path;
    } else if (!force && !(await confirmDiscard())) return;
    if (!handles.get(path)) await reveal(path);
    if (!handles.get(path) && !(await handleFromDisk(path))) {
      say(
        splitPath(path).laneId
          ? 'Could not find ' + display(path) + ': it or its worktree is gone'
          : 'Could not find ' + path + ' in the project folder'
      );
      return;
    }
    const token = ++openToken,
      handle = handles.get(path);
    if (!handle) return;
    current = { path, handle, loading: true };
    showEditor();
    renderEditor();
    markRows();
    try {
      const file = await handle.getFile(),
        result = await decodeTextBytes(file);
      if (token !== openToken) return;
      current = { path, handle, size: file.size, modified: file.lastModified, ...result };
    } catch (error) {
      if (token !== openToken) return;
      current = { path, handle, error: explain(error, 'read ' + path) };
      if (isPermissionError(error)) lose(error);
    }
    renderEditor();
    markRows();
  }

  // A file in a folder that was never expanded (project search, another view): expand its parent
  // folders so its handle loads.
  async function reveal(path) {
    const parts = path.split('/');
    for (let i = path.startsWith(LANE) ? 2 : 1; i < parts.length; i++) {
      const row = rowFor(parts.slice(0, i).join('/'));
      if (!row) return;
      if (row.getAttribute('aria-expanded') !== 'true') await toggleFolder(row, true);
    }
    markRows();
  }

  // A file past a folder's listing cap (ENTRY_LIMIT) has no row: find each part by name in its
  // folder's full listing and open it without a row. A worktree file (⎇<id>/…) starts from that
  // worktree's folder, whether or not the tree shows it; a worktree no longer listed has nothing to
  // find.
  async function handleFromDisk(path) {
    const s = splitPath(path),
      l = s.laneId && lanes.find(x => x.id === s.laneId);
    if (s.laneId && !l) return null;
    let dir = !l ? root : lane?.id === l.id ? laneHandle : window.TnaiDesktop.laneRoot(l);
    const parts = s.rel.split('/'),
      prefix = l ? LANE + l.id + '/' : '';
    for (let i = 0; i < parts.length; i++) {
      const at = prefix + parts.slice(0, i + 1).join('/');
      let h = handles.get(at);
      if (!h) {
        try {
          for await (const e of dir.values())
            if (e.name === parts[i]) {
              h = e;
              break;
            }
        } catch {
          return null;
        }
        if (!h || (i < parts.length - 1 && h.kind !== 'directory')) return null;
        handles.set(at, h);
      }
      dir = h;
    }
    return dir.kind === 'file' ? dir : null;
  }

  // The open file changed on disk (26): re-read it in place keeping scroll and caret. Unsaved edits
  // are kept ('dirty') unless mode is 'discard'; 'keep' only takes the disk timestamp so Save does
  // not ask again.
  async function refreshOpen(mode) {
    const file = current;
    if (!file || file.loading || file.saving || file.error) return false;
    if (mode !== 'discard' && mode !== 'keep' && isDirty()) return 'dirty';
    let disk, result;
    try {
      disk = await file.handle.getFile();
      if (mode === 'keep') {
        file.size = disk.size;
        file.modified = disk.lastModified;
        renderMeta();
        return 'kept';
      }
      result = await decodeTextBytes(disk);
    } catch {
      return false;
    }
    if (current !== file) return false;
    if (mode === 'discard') drafts.drop(file.path);
    const area = editor.querySelector('.repo-editor-text:not([readonly])');
    if (!result.editable || !file.editable || !area) {
      openFile(file.path, true);
      return 'reloaded';
    }
    Object.assign(file, { size: disk.size, modified: disk.lastModified, ...result });
    if (area.value === normalized(file.text)) {
      renderMeta();
      renderState();
      return 'same';
    }
    const top = area.scrollTop,
      left = area.scrollLeft,
      a = area.selectionStart,
      b = area.selectionEnd;
    area.value = file.text;
    area.scrollTop = top;
    area.scrollLeft = left;
    try {
      area.setSelectionRange(Math.min(a, area.value.length), Math.min(b, area.value.length));
    } catch {}
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.scrollTop = top;
    area.scrollLeft = left;
    renderMeta();
    renderState();
    markRows();
    return 'reloaded';
  }

  function renderEditor() {
    const file = current;
    if (!file) return;
    const name = file.path.split('/').pop(),
      ext = extOf(name);
    $('h2').textContent = name;
    const pathEl = $('.repo-editor-path');
    pathEl.textContent = display(file.path);
    pathEl.title = file.handle?.tnaiLane
      ? file.handle.tnaiLane + '/' + splitPath(file.path).rel
      : root
        ? root.name + '/' + file.path
        : file.path;
    renderMeta();
    const body = $('.repo-editor-body');
    body.className = 'repo-editor-body';
    body.replaceChildren();
    const notice = (title, text) => {
      const box = document.createElement('div');
      box.className = 'repo-editor-notice';
      box.innerHTML =
        '<span class="repo-detail-file-icon">' +
        window.TnaiIcon('file-text', { size: 16 }) +
        '</span><b></b><p></p>';
      box.querySelector('b').textContent = title;
      box.querySelector('p').textContent = text;
      body.append(box);
      return box;
    };
    if (file.loading)
      notice('Reading file…', 'Loading ' + file.path + ' from the connected folder.');
    else if (file.error) {
      const box = notice('This file could not be opened', file.error);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button';
      retry.textContent = 'Try again';
      retry.onclick = () =>
        state === 'connected' ? openFile(file.path, true) : say('Restore folder access first');
      box.append(retry);
    } else if (file.editable) {
      const area = document.createElement('textarea');
      area.className = 'repo-editor-text';
      area.spellcheck = false;
      area.wrap = 'off';
      area.setAttribute('aria-label', 'Contents of ' + file.path);
      area.value = file.text;
      area.oninput = () => {
        renderState();
        markRows();
        drafts.save();
      };
      body.append(area);
      if (restoring === file.path) {
        restoring = '';
        const d = drafts.get(file.path);
        if (d && d.modified === file.modified && d.at >= pageStart) area.value = d.text;
      }
      drafts.offer(file, area);
    } else {
      const box = notice('View only', file.reason);
      viewOutside(box, file);
      if (file.preview != null) {
        body.classList.add('has-preview');
        const area = document.createElement('textarea');
        area.className = 'repo-editor-text';
        area.readOnly = true;
        area.wrap = 'off';
        area.value = file.preview;
        body.append(area);
      }
    }
    setMessage('');
    renderState();
  }

  // A view-only file (too large, binary, not UTF-8) in the desktop app: pop it out into its own
  // view-only window (images, PDF, audio/video, text), or open it with the PC's default app.
  const VIEWABLE = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'avif',
    'svg',
    'pdf',
    'mp4',
    'webm',
    'ogg',
    'ogv',
    'mp3',
    'wav',
    'm4a',
    'flac',
  ]);

  function viewOutside(box, file) {
    const fsn = window.tnaiNative?.fs;
    if (!fsn?.popout) return;
    const rel = splitPath(file.path).rel,
      where = file.handle?.tnaiLane || '';
    const row = document.createElement('div');
    row.className = 'repo-editor-actions';
    const act = (label, tip, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button';
      b.textContent = label;
      b.title = tip;
      b.disabled = !!disabled;
      b.onclick = async () => {
        b.disabled = true;
        const r = await fn().catch(e => ({ ok: false, error: e }));
        b.disabled = false;
        if (!r?.ok) say(r?.error?.message || 'Could not open ' + file.path);
        else if (r.value === 'shown')
          say('Shown in File Explorer: Technically Not does not run program files');
      };
      row.append(b);
    };
    const asText = file.preview != null,
      viewable = VIEWABLE.has(extOf(file.path)) || asText;
    act(
      'Pop out',
      viewable
        ? 'View the whole file in its own window (view only)'
        : 'Technically Not cannot display this kind of file; open it on this PC instead',
      () => fsn.popout(rel, asText, where),
      !viewable
    );
    act('Open on this PC', 'Open with the default app for this file type', () =>
      fsn.openOnPc(rel, where)
    );
    box.append(row);
  }

  // Every "open this file" link (Overview rail and Files in motion, Agents page, command palette)
  // opens the file in its own view-only window (desktop, file-viewer.js). path: a tree path (a
  // worktree's is ⎇<id>/…), or with lane (a worktree's full path) a path inside it. A kind the
  // window cannot show (or too large) opens with the PC's default app instead; the browser build
  // says files open in the desktop app.
  const plainError = error =>
    String(error?.message || error || '').replace(
      /^Error invoking remote method '[^']+': (\w*Error: )?/,
      ''
    );

  // The most text the Files column shows of one file; a longer file is cut and says so.
  const COLUMN_TEXT_LIMIT = 400 * 1024;

  window.TnaiFileViewer = {
    // The file's text for a view inside the app (the Files column, 131). Nothing is opened:
    // { ok: true, name, rel, text, cut } or { ok: false, name, reason }, where the reason says
    // in plain words why the column cannot show it (a picture, a program file, a read error).
    async text(path, lane) {
      path = String(path || '');
      const fsn = window.tnaiNative?.fs;
      const s = splitPath(path);
      const name = s.rel.split('/').pop() || s.rel;
      if (!path || !fsn?.read) return { ok: false, name, reason: 'This file cannot be read here' };
      let where = lane || '';
      if (!where && s.laneId) {
        const found = lanes.find(x => x.id === s.laneId);
        if (!found) return { ok: false, name, reason: 'That worktree is no longer open' };
        where = found.dir;
      }
      if (VIEWABLE.has(extOf(name)))
        return {
          ok: false,
          name,
          reason: 'Pictures, sound, video and PDF open in their own window',
        };
      try {
        const stat = await fsn.stat(s.rel, where);
        const size = stat?.ok === false ? 0 : Number(stat?.value?.size ?? stat?.size) || 0;
        const most = Math.min(size || COLUMN_TEXT_LIMIT, COLUMN_TEXT_LIMIT);
        const got = await fsn.read(s.rel, 0, most, where);
        if (got?.ok === false) throw got.error || new Error('Could not read ' + name);
        const bytes = got?.value ?? got;

        // A NUL byte in the first 8 KB: not text.
        if (bytes?.subarray?.(0, 8192).includes(0))
          return { ok: false, name, reason: 'This is not a text file' };
        return {
          ok: true,
          name,
          rel: s.rel,
          text: new TextDecoder().decode(bytes),
          cut: size > COLUMN_TEXT_LIMIT,
        };
      } catch (error) {
        return { ok: false, name, reason: plainError(error) || 'Could not read ' + name };
      }
    },

    async open(path, lane) {
      path = String(path || '');
      if (!path) return false;
      const fsn = window.tnaiNative?.fs;
      if (!fsn?.popout) {
        say('Files open in their own window in the Technically Not desktop app');
        return false;
      }
      const s = splitPath(path);
      let where = lane || '';
      if (!where && s.laneId) {
        const l = lanes.find(x => x.id === s.laneId);
        if (!l) {
          say('That worktree is no longer open');
          return false;
        }
        where = l.dir;
      }
      const name = s.rel.split('/').pop() || s.rel;

      // Text unless its first 8 KB hold a NUL byte (binary: the window refuses it and the PC's
      // default app opens it).
      const head = VIEWABLE.has(extOf(name))
          ? null
          : await fsn.read?.(s.rel, 0, 8192, where)?.catch?.(() => null),
        asText = !(head?.ok && head.value?.includes?.(0));
      try {
        const r = await fsn.popout(s.rel, asText, where);
        if (r?.ok === false) throw r.error || new Error('Could not open ' + name);
        return true;
      } catch (error) {
        const message = plainError(error);
        if (/cannot show|too large/i.test(message) && fsn.openOnPc)
          try {
            const r = await fsn.openOnPc(s.rel, where);
            if (r?.ok !== false) {
              say(
                (r?.value ?? r) === 'shown'
                  ? 'Shown in File Explorer: Technically Not does not run program files'
                  : 'Opened ' + name + ' with its default app'
              );
              return true;
            }
          } catch (e) {
            say(plainError(e) || 'Could not open ' + name);
            return false;
          }
        say(message || 'Could not open ' + name);
        return false;
      }
    },
  };

  function renderState() {
    const file = current;
    if (!file) return;
    const dirty = isDirty();
    let text = 'Saved',
      tone = 'saved';
    if (file.loading) {
      text = 'Loading…';
      tone = '';
    } else if (file.error) {
      text = 'Read error';
      tone = 'error';
    } else if (!file.editable) {
      text = 'View only';
      tone = '';
    } else if (file.saving) {
      text = 'Saving…';
      tone = '';
    } else if (dirty) {
      text = 'Unsaved changes';
      tone = 'dirty';
    } else if (!file.verifiedAt) {
      text = 'No changes';
      tone = '';
    }
    stateEl.textContent = text;
    stateEl.dataset.tone = tone;
    saveButton.disabled = !file.editable || file.saving || !dirty;
    reloadButton.disabled = Boolean(file.loading || file.saving);
  }

  function renderMeta() {
    const file = current,
      ext = extOf(file.path);
    const meta = $('.repo-editor-meta');
    meta.replaceChildren();
    const fact = (label, value) => {
      const span = document.createElement('span');
      span.textContent = label;
      const b = document.createElement('b');
      b.textContent = value;
      span.append(b);
      meta.append(span);
    };
    fact('Type', kinds[ext] || (ext ? ext.toUpperCase() + ' file' : 'File'));
    if (file.size != null) fact('Size', formatSize(file.size));
    if (file.modified) fact('Modified', new Date(file.modified).toLocaleString());
    if (file.editable)
      fact(
        'Encoding',
        'UTF-8' +
          (file.bom ? ' with BOM' : '') +
          ' · ' +
          (file.eol === '\r\n' ? 'CRLF' : 'LF') +
          (file.mixedEol ? ' (mixed; saves as ' + (file.eol === '\r\n' ? 'CRLF' : 'LF') + ')' : '')
      );
    fact(
      'Access',
      file.editable ? 'Editable · write access is requested on first Save' : 'View only'
    );
  }

  function setMessage(text, tone) {
    messageEl.textContent = text;
    messageEl.dataset.tone = tone || '';
  }
  const failure = (name, message) => Object.assign(new Error(message), { name });

  async function save() {
    const file = current,
      area = editor.querySelector('.repo-editor-text:not([readonly])');
    if (!file?.editable || file.saving || !area || !isDirty()) return;
    const output = file.eol === '\r\n' ? area.value.replace(/\n/g, '\r\n') : area.value;
    file.saving = true;
    setMessage('Saving ' + display(file.path) + '…');
    renderState();
    try {
      let permission = await root.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted')
        permission = await root.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted')
        throw failure('NotAllowedError', 'write access was not granted');
      const disk = await file.handle.getFile();
      if (
        disk.lastModified !== file.modified &&
        !confirm(
          display(file.path) +
            ' changed on disk after you opened it. Overwrite it with your version?'
        )
      )
        throw failure(
          'Cancelled',
          'Save cancelled because the file changed on disk. Use Reload to see the disk version.'
        );
      const writable = await file.handle.createWritable();
      try {
        await writable.write(output);
        await writable.close();
      } catch (error) {
        try {
          await writable.abort();
        } catch {}
        throw error;
      }
      const reread = await file.handle.getFile(),
        actual = new Uint8Array(await reread.arrayBuffer()),
        expected = new TextEncoder().encode(output);
      if (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i]))
        throw failure(
          'VerifyError',
          'The file was written, but reading it back returned different contents. Reload before editing further.'
        );
      Object.assign(file, {
        text: output,
        size: reread.size,
        modified: reread.lastModified,
        verifiedAt: Date.now(),
        saving: false,
      });
      drafts.drop(file.path);
      if (current === file) {
        renderMeta();
        setMessage(
          'Saved and verified — reread ' +
            formatSize(reread.size) +
            ' from disk at ' +
            new Date(file.verifiedAt).toLocaleTimeString() +
            ' and it matches.',
          'ok'
        );
        say('Saved ' + display(file.path));
      }
    } catch (error) {
      file.saving = false;
      if (current === file)
        setMessage(
          error.name === 'Cancelled' || error.name === 'VerifyError'
            ? error.message
            : 'Not saved. ' +
                explain(error, 'write ' + display(file.path)) +
                ' Your edits are still here.',
          'error'
        );
    }
    if (current === file) {
      renderState();
      markRows();
    }
  }
  saveButton.onclick = save;
  reloadButton.onclick = async () => {
    if (current && (await confirmDiscard())) openFile(current.path, true);
  };
  $('.repo-editor-close').onclick = () => closeEditor(false);
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });

  // The desktop app keeps unsaved edits as drafts instead; blocking unload there would silently
  // stop a reload or close.
  window.addEventListener('beforeunload', event => {
    if (isDirty() && !window.tnaiNative) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  // A window added from the dock menu or sidebar should be visible, so the editor steps aside
  // unless it holds unsaved edits. Sample file rows skipped the chevron column, which squeezed
  // their names; align them with folders.
  sampleTree.querySelectorAll('.repo-file').forEach(row => {
    if (!row.firstElementChild?.classList.contains('repo-chevron')) {
      const spacer = document.createElement('span');
      spacer.className = 'repo-chevron';
      row.prepend(spacer);
    }
  });

  // ---- Desktop: several open projects, one active (fs-service.js). The project name under “File
  // Repository” becomes a compact switcher: open projects (active marked), switch, × remove from
  // the list (files on disk are never touched), Add project folder…. Switching keeps unsaved edits
  // as drafts of the project being left; `tnai:project-changed` ({root, previous}) tells other
  // views.
  const menu = document.createElement('div');
  menu.className = 'repo-project-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Open projects');
  menu.hidden = true;
  head?.append(menu);
  let switching = false;

  async function loadProjects() {
    if (!window.TnaiDesktop?.projects) return;
    try {
      const info = await window.TnaiDesktop.projects();
      projects = info.projects || [];
      projectPath = info.active || '';
    } catch {}
    renderSwitch();
  }

  // The top bar's Workspace chip opens this same small project menu (switch, add, new).
  // The rail's own switcher
  // below is not shown on any page of the current design, so the chip is the menu's place on
  // screen. The menu element sits under whichever opener was used last: the rail head, or the top
  // bar's left group beside the chip.
  const chip = window.TnaiDesktop?.projects ? document.querySelector('.top .project') : null;
  const chipOpen = () => !menu.hidden && menu.parentNode === chip?.parentNode;
  const syncChip = () => chip?.setAttribute('aria-expanded', String(chipOpen()));
  if (chip) {
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.title = 'Projects: switch, add a folder, or start a new one';
    const toggle = () => {
      if (chipOpen()) menu.hidden = true;
      else {
        // Under the chip's left edge; in a narrow window it moves left just enough to keep 8 px to
        // the window's right edge.
        const group = chip.parentNode.getBoundingClientRect().left,
          left = chip.getBoundingClientRect().left - group;
        chip.parentNode.append(menu);
        menu.style.left = left + 'px';
        menu.hidden = false;
        paintMenu();
        const over = menu.getBoundingClientRect().right - (innerWidth - 8);
        if (over > 0) menu.style.left = Math.max(8 - group, left - over) + 'px';
      }
      renderSwitch();
    };
    window.addEventListener('resize', () => {
      if (chipOpen()) {
        menu.hidden = true;
        renderSwitch();
      }
    }); // a new window size: closed, placed again at the next open
    chip.addEventListener('click', event => {
      event.stopPropagation();
      toggle();
    });
    chip.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  }

  function renderSwitch() {
    syncChip();
    if (!sub || !window.TnaiDesktop?.projects) return;
    if (!projects.length) {
      if (!chipOpen()) menu.hidden = true;
      return;
    } // from the chip the menu also opens with no project yet: add a folder, or start a new one
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'repo-project-switch';
    button.textContent = sub.textContent;
    button.title =
      projects.length +
      ' open project' +
      (projects.length > 1 ? 's' : '') +
      ' · switch, add, or remove';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', String(!menu.hidden));
    button.onclick = event => {
      event.stopPropagation();
      if (menu.parentNode !== head) {
        head?.append(menu);
        menu.style.left = '';
        menu.hidden = true;
      }
      menu.hidden = !menu.hidden;
      renderSwitch();
    };
    sub.replaceChildren(button);
    if (!menu.hidden) paintMenu();
  }

  async function showFolder(target) {
    const path = target || projectPath;
    if (!path || !window.TnaiDesktop?.showFolder) return;
    try {
      await window.TnaiDesktop.showFolder(path);
    } catch (error) {
      say(error?.message || 'Could not open that folder.');
    }
  }

  function paintMenu() {
    const rows = projects.map(p => {
      const row = document.createElement('div');
      row.className =
        'repo-project-item' + (p.active ? ' active' : '') + (p.missing ? ' missing' : '');
      row.dataset.projectPath = p.path;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'repo-project-open';
      open.setAttribute('role', 'menuitemradio');
      open.setAttribute('aria-checked', String(!!p.active));
      open.title = p.path;
      const name = document.createElement('b'),
        where = document.createElement('small');
      name.textContent = p.name;
      where.textContent = p.missing ? 'Folder not found · ' + p.path : p.path;
      open.append(name, where);
      if (!p.active) {
        const live = document.createElement('span');
        live.className = 'repo-project-live';
        where.prepend(live);
      }
      open.onclick = () => {
        menu.hidden = true;
        renderSwitch();
        if (!p.active) switchProject(p.path);
      };
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'repo-project-remove';
      remove.innerHTML = window.TnaiIcon('x', { size: 14 });
      remove.title = 'Remove from the list (its files stay on disk)';
      remove.setAttribute('aria-label', 'Remove ' + p.name + ' from the project list');
      remove.onclick = event => {
        event.stopPropagation();
        removeProject(p);
      };

      // "Show folder": opens this project's folder in the PC's file manager;
      // left out for a folder that is gone.
      const show =
        !p.missing && window.TnaiDesktop?.showFolder ? document.createElement('button') : null;
      if (show) {
        show.type = 'button';
        show.className = 'repo-project-show';
        show.innerHTML = window.TnaiIcon('folder', { size: 14 });
        show.title = 'Show folder';
        show.setAttribute('aria-label', 'Show the folder of ' + p.name);
        show.onclick = event => {
          event.stopPropagation();
          menu.hidden = true;
          renderSwitch();
          showFolder(p.path);
        };
      }
      row.append(open, ...(show ? [show] : []), remove);
      return row;
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'repo-project-add';
    add.setAttribute('role', 'menuitem');
    add.textContent = 'Add project folder…';
    add.onclick = () => {
      menu.hidden = true;
      renderSwitch();
      connect();
    };

    // "New project…": a second foot row in the same look (14: one top line for the pair).
    const make = window.TnaiDesktop?.createProject ? document.createElement('button') : null;
    if (make) {
      make.type = 'button';
      make.className = 'repo-project-add';
      make.setAttribute('role', 'menuitem');
      make.textContent = 'New project…';
      make.title =
        'Make an empty folder with the name you give, in Documents\\Technically Not, and open it';
      make.onclick = () => {
        menu.hidden = true;
        renderSwitch();
        newProject();
      };
    }
    menu.replaceChildren(...rows, add, ...(make ? [make] : []));
    hookLive();
    paintLive();
  }

  // Other open projects' rows say what their agents do: `● N working · ! M needs you` (zero parts
  // left out, nothing when idle), from the same session statuses Overview counts (10
  // TnaiAgents.sessions), grouped by the project each panel records (07 projectOfPane). Repainted
  // only while the menu is open, on pushed changes: 10's onChange and tnai:live-activity (53/71
  // questions). The open project's row shows none: its agents are on the page itself, and one open
  // project looks exactly as before.
  function liveCounts(path) {
    const w = window.TnaiTerminalWorkspaces,
      key = w?.normalize?.(path);
    let working = 0,
      needs = 0;
    if (key && w.projectOfPane)
      for (const s of window.TnaiAgents?.sessions?.() || []) {
        if (!s.running || w.projectOfPane(s.paneId) !== key) continue;
        if (s.status === 'working' || s.status === 'background') working++;
        else if (s.status === 'needs-you') needs++;
      }
    return { working, needs };
  }

  function paintLive() {
    for (const row of menu.querySelectorAll('.repo-project-item')) {
      const live = row.querySelector('.repo-project-live');
      if (!live) continue;
      const { working, needs } = liveCounts(row.dataset.projectPath),
        parts = [];
      if (working) parts.push('<span data-k="working">● ' + working + ' working</span>');
      if (needs)
        parts.push(
          '<span data-k="needs">! ' + needs + ' need' + (needs === 1 ? 's' : '') + ' you</span>'
        );
      const html = parts.length ? parts.join(' · ') + ' · ' : '';
      if (live.innerHTML !== html) live.innerHTML = html;
      const open = row.querySelector('.repo-project-open'),
        tip =
          row.dataset.projectPath +
          (parts.length ? '\n' + live.textContent.replace(/ · $/, '') : '');
      if (open && open.title !== tip) open.title = tip;
    }
  }
  let liveHooked = false;

  function hookLive() {
    if (liveHooked || !window.TnaiAgents?.onChange) return;
    liveHooked = true;
    const again = () => {
      if (!menu.hidden) paintLive();
    };
    window.TnaiAgents.onChange(again);
    window.addEventListener('tnai:live-activity', again);
  }

  // Capture phase on the window: a click on a control that takes the event for itself (the left
  // nav) still closes the menu. The two openers toggle it themselves.
  window.addEventListener(
    'click',
    event => {
      if (
        !menu.hidden &&
        !menu.contains(event.target) &&
        !chip?.contains(event.target) &&
        !event.target.closest?.('.repo-project-switch')
      ) {
        menu.hidden = true;
        renderSwitch();
      }
    },
    true
  );
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) {
      menu.hidden = true;
      renderSwitch();
    }
  });

  function projectChanged(previous) {
    window.dispatchEvent(
      new CustomEvent('tnai:project-changed', {
        detail: { root: projectPath, previous: previous || '' },
      })
    );
  }

  async function switchProject(target) {
    if (switching || !window.TnaiDesktop?.projects || target === projectPath) return;
    switching = true;
    const previous = projectPath,
      leaving = root?.name || '',
      kept = isDirty();
    drafts.saveNow();
    try {
      await window.TnaiDesktop.switchTo(target);
    } catch (error) {
      switching = false;
      say(error?.message || 'Could not open that project.');
      await loadProjects();
      renderBar();
      return;
    }
    closeEditor(true);
    handles.clear();
    realTree.replaceChildren();
    lane = null;
    laneHandle = null;
    lanes = [];
    renderLanes();
    await loadProjects();
    try {
      root = projectPath ? await window.TnaiDesktop.revive() : null;
    } catch {
      root = null;
    }
    state = root ? 'connected' : 'sample';
    stateDetail = '';
    if (root) await loadRootTree();
    else renderBar();
    switching = false;
    projectChanged(previous);
    loadLanes();
    say(
      kept
        ? 'Switched to ' +
            (root?.name || 'no project') +
            '. Unsaved edits in ' +
            leaving +
            ' are kept and come back when you switch back.'
        : 'Switched to ' + (root?.name || 'no project')
    );
  }

  async function removeProject(p) {
    if (p.active) {
      menu.hidden = true;
      await disconnect();
      return;
    }
    try {
      await window.TnaiDesktop.remove(p.path);
    } catch (error) {
      say(error?.message || 'Could not remove that project.');
      return;
    }
    await loadProjects();
    renderBar();
    say('Removed ' + p.name + ' from the project list. Its files were not touched.');
  }

  // Drafts from before projects were kept per project (one unscoped key) belong to the project that
  // was open then.
  function migrateDrafts() {
    if (!projectPath) return;
    try {
      const old = localStorage.getItem('tnai.editor-drafts.v1');
      if (old && !localStorage.getItem(drafts.key)) {
        localStorage.setItem(drafts.key, old);
        localStorage.removeItem('tnai.editor-drafts.v1');
      }
    } catch {}
  }
  window.TnaiProjects = {
    list: () => projects.map(p => ({ ...p })),
    active: () => projectPath,
    switchTo: switchProject,
    add: () => connect(),
    create: window.TnaiDesktop?.createProject ? () => newProject() : null,
    showFolder: window.TnaiDesktop?.showFolder ? target => showFolder(target) : null,
    remove: target => {
      const p = projects.find(x => x.path === target);
      return p ? removeProject(p) : undefined;
    },
  };

  // ---- Desktop: Main | ⎇ <worktree> … under the folder line, only while the project has
  // Technically Not worktrees (worktree-service lanes()). Picking one shows that worktree's folder
  // in the same tree (read, edit, Save work the same; fs-service allows only its known worktrees).
  // Up to 3 worktrees as buttons (the shown one always among them), the rest in a ⋯ menu; existing
  // compact button and menu styles.
  const LANE_SHOWN = 3;
  const laneStyle = document.createElement('style');
  laneStyle.textContent = `
.repo-lane-switch{position:relative;display:flex;gap:4px;min-width:0;margin:6px 0 0}.repo-lane-switch[hidden]{display:none}
.repo-lane-switch>.repo-connect-button{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.repo-lane-switch>.repo-connect-more{flex:none}
`;
  document.head.append(laneStyle);
  const laneBar = document.createElement('div');
  laneBar.className = 'repo-lane-switch';
  laneBar.setAttribute('role', 'radiogroup');
  laneBar.setAttribute('aria-label', 'Folder shown in the tree');
  laneBar.hidden = true;
  bar.after(laneBar);

  function laneButton(l, inMenu) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className =
      'repo-connect-button' + (!inMenu && (l?.id || '') === (lane?.id || '') ? ' primary' : '');
    b.dataset.lane = l?.id || '';
    b.innerHTML = l
      ? window.TnaiIcon('git-branch', { size: 13 }) +
        ' ' +
        laneShort(l).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
      : 'Main';
    b.title = l
      ? 'Worktree ' +
        l.branch +
        ' · ' +
        l.dir +
        '\nShow its files (an agent works here apart from the project folder)'
      : 'Show the project folder';
    b.setAttribute('role', inMenu ? 'menuitemradio' : 'radio');
    b.setAttribute('aria-checked', String((l?.id || '') === (lane?.id || '')));
    b.onclick = () => {
      closeLaneMenu();
      selectLane(l?.id || '');
    };
    return b;
  }

  function renderLanes() {
    const show = state === 'connected' && lanes.length > 0;
    laneBar.hidden = !show;
    if (!show) {
      laneBar.replaceChildren();
      return;
    }
    let visible = lanes.slice(0, LANE_SHOWN);
    if (lane && !visible.some(l => l.id === lane.id))
      visible = [...lanes.slice(0, LANE_SHOWN - 1), lanes.find(l => l.id === lane.id)];
    const rest = lanes.filter(l => !visible.includes(l)),
      parts = [laneButton(null), ...visible.map(l => laneButton(l))];
    if (rest.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'repo-connect-more';
      more.innerHTML = window.TnaiIcon('ellipsis', { size: 16 });
      more.title = rest.length + ' more worktree' + (rest.length > 1 ? 's' : '');
      more.setAttribute('aria-label', more.title);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      const list = document.createElement('div');
      list.className = 'repo-connect-menu';
      list.setAttribute('role', 'menu');
      list.setAttribute('aria-label', 'More worktrees');
      list.hidden = true;
      list.append(...rest.map(l => laneButton(l, true)));
      more.onclick = event => {
        event.stopPropagation();
        list.hidden = !list.hidden;
        more.setAttribute('aria-expanded', String(!list.hidden));
      };
      parts.push(more, list);
    }
    laneBar.replaceChildren(...parts);
  }

  function closeLaneMenu() {
    const list = laneBar.querySelector('.repo-connect-menu');
    if (list && !list.hidden) {
      list.hidden = true;
      laneBar.querySelector('.repo-connect-more')?.setAttribute('aria-expanded', 'false');
    }
  }
  document.addEventListener('click', event => {
    if (!laneBar.contains(event.target)) closeLaneMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeLaneMenu();
  });
  const laneChanged = () => {
    realTree.setAttribute(
      'aria-label',
      lane ? 'Files of worktree ' + lane.branch : 'Connected project files'
    );
    window.dispatchEvent(
      new CustomEvent('tnai:lane-changed', { detail: { lane: lane ? { ...lane } : null } })
    );
  };

  // Shows the project folder ('') or a worktree in the tree. The open file and the file tabs keep
  // their own folder.
  let laneToken = 0;

  async function selectLane(id) {
    const next = id ? lanes.find(l => l.id === id) || null : null;
    if (state !== 'connected' || (next?.id || '') === (lane?.id || '')) return;
    const my = ++laneToken;
    lane = next;
    laneHandle = next ? window.TnaiDesktop.laneRoot(next) : null;
    renderLanes();
    const ok = await loadRootTree();
    if (my !== laneToken) return;
    if (!ok && lane) {
      say('Could not show the worktree ⎇ ' + laneShort(lane) + '. Showing the project folder.');
      lane = null;
      laneHandle = null;
      renderLanes();
      await loadRootTree();
    }
    laneChanged();
  }

  // Worktrees come and go with git:changed (made, removed); a removed one that the tree shows hands
  // the tree back to the project folder.
  async function loadLanes() {
    if (!window.TnaiDesktop?.lanes) return;
    let next = [];
    if (state === 'connected')
      try {
        next = await window.TnaiDesktop.lanes();
      } catch {}
    lanes = Array.isArray(next) ? next : [];
    if (lane && !lanes.some(l => l.id === lane.id)) {
      const gone = lane;
      lane = null;
      laneHandle = null;
      renderLanes();
      say('The worktree ⎇ ' + laneShort(gone) + ' is gone. Showing the project folder.');
      await loadRootTree();
      laneChanged();
    } else renderLanes();
  }
  let lanesTimer = 0;
  const lanesSoon = () => {
    clearTimeout(lanesTimer);
    lanesTimer = setTimeout(loadLanes, 250);
  };
  window.tnaiNative?.git?.onChanged?.(lanesSoon);

  // The shown worktree's own change batches (watch-service watchLane, tagged lane): an added or
  // removed file re-lists its loaded folder in place.
  window.tnaiNative?.fs?.onChanges?.(payload => {
    const tag = Array.isArray(payload) && payload[0]?.lane;
    if (!tag || !lane || String(tag.id) !== lane.id || state !== 'connected') return;
    const base = treeBase(),
      key = p => (p ? base + '/' + p : base),
      parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''),
      dirs = new Set();
    for (const c of payload)
      if (c && typeof c.path === 'string') {
        if (c.dir) {
          dirs.add(key(parentOf(c.path)));
          dirs.add(key(c.path));
        } else if (c.type === 'rename') dirs.add(key(parentOf(c.path)));
      }
    if (dirs.size) reloadDirs(dirs);
  });

  (async () => {
    renderBar();
    if (!supported) return;
    if (window.TnaiDesktop?.projects) {
      await loadProjects();
      migrateDrafts();
      renderBar();
    }
    let handle;
    try {
      handle = window.TnaiDesktop ? await window.TnaiDesktop.revive() : await loadStoredRoot();
    } catch {
      return;
    }
    if (!handle) return;
    root = handle;
    let permission = 'prompt';
    try {
      permission = await handle.queryPermission({ mode: 'read' });
    } catch {}
    if (permission === 'granted') {
      state = 'connected';
      await loadRootTree();
      loadLanes();
    } else {
      state = permission === 'denied' ? 'reconnect' : 'restorable';
      stateDetail =
        permission === 'denied'
          ? 'Access to “' + handle.name + '” is blocked in this browser.'
          : 'Technically Not remembers “' +
            handle.name +
            '”, but the browser needs you to confirm access again after reload.';
      renderBar();
    }
  })();
})();
