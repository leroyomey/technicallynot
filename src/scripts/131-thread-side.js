// Technically Not · 131-thread-side.js — Desktop only: the Threads page's side column, with tabs.
//
// The frame's third slot (118) holds one column with a tab per thing it can show:
//
// - Files: the project's file rail. The rail is the one 03 builds and 09, 13 and 24 fill (the
//   folders-first tree that loads a folder when it is opened, the search, the marks on files an
//   agent is touching). It is moved in here, not built again, so everything it does keeps
//   working. A press on a file shows its text inside the column, in place of the tree, with a
//   button back to the tree and one for the view-only window (09), where every kind still opens.
// - Helpers: the open thread's helpers and the chosen one's own conversation. That part is
//   123's; it hands its panel over and is told when its tab is chosen or left. The tab is there
//   only while the open thread has helpers.
// - Details: the open thread's agent in detail (running time, queued prompts, what it does now,
//   its sub-agents, files, skills and setup). That part is 139's; it is mounted for the open
//   thread while its tab shows and unmounted when the tab is left, the column closes or no
//   thread is open (the tab then says so in one line).
// - Terminal: the one plain terminal for the user's own commands. That part is 136's; it is told
//   which box to stand in each time its tab shows.
//
// A button in the thread's top row, the last one before its "..." menu, shows and hides the column,
// the same kind of button as the two of 127. The column stays open across threads, pages and
// restarts once it is opened that way (`tnai.thread-side.v1`, { open: true }); opened only for a
// helper, it closes again with the helper. In a narrow window the column takes the thread's place
// (27) and its close button brings the thread back.
//
// `window.TnaiThreadSide` (`open` with 'files', 'details', 'terminal', 'helpers' or 'preview',
// `close`, `toggle`, `state`, `showFile(path, row, line)`, `hideFile`, for 123: `helpers`,
// `refresh`, and for 170: `preview(node, show)`, the Live preview tab that is there only while a
// site an agent started was opened by itself). Look: src/styles/35-thread-side.css. Test:
// `thread-side`.
(() => {
  'use strict';
  const layout = document.querySelector('.layout');
  if (!layout || !window.tnaiNative) return;

  const KEY = 'tnai.thread-side.v1';
  const threads = () => window.TnaiThreads;
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  // Kept open by the user (remembered), and shown for a helper (not remembered).
  let kept = false;
  let helpersOpen = false;
  let helpersPanel = null;

  // Which of the tabs that are always there shows while no helper is read. Not remembered: the
  // column opens on the files.
  let wanted = 'files';
  try {
    kept = !!(JSON.parse(localStorage.getItem(KEY) || '{}') || {}).open;
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ open: kept }));
    } catch {}
  };

  // Live preview, opened by itself when an agent started a site (170, its setting): the node 170
  // hands over, and whether it is shown (not remembered, like a helper).
  let previewNode = null;
  let previewOpen = false;

  const shown = () => kept || helpersOpen || previewOpen;
  const tab = () =>
    helpersOpen
      ? 'helpers'
      : wanted === 'preview' && !previewNode
        ? 'files'
        : previewOpen && !kept
          ? 'preview'
          : wanted;
  const helperCount = () => {
    try {
      return window.TnaiThreadHelpers?.state().helpers.length || 0;
    } catch {
      return 0;
    }
  };

  // ---------- the column's parts ----------
  const column = document.createElement('div');
  column.className = 'tnt-sidebox';
  column.innerHTML =
    '<header class="tnt-sidebox-head">' +
    '<div class="tnt-sidebox-tabs" role="tablist" aria-label="What this column shows">' +
    '<button type="button" role="tab" data-tab="files" id="tntSideTabFiles" ' +
    'aria-controls="tntSideFiles">Files</button>' +
    '<button type="button" role="tab" data-tab="helpers" id="tntSideTabHelpers" ' +
    'aria-controls="tntSideHelpers">Helpers</button>' +
    '<button type="button" role="tab" data-tab="details" id="tntSideTabDetails" ' +
    'aria-controls="tntSideDetails">Details</button>' +
    '<button type="button" role="tab" data-tab="terminal" id="tntSideTabTerminal" ' +
    'aria-controls="tntSideTerminal">Terminal</button>' +
    '<button type="button" role="tab" data-tab="preview" id="tntSideTabPreview" ' +
    'aria-controls="tntSidePreview" hidden>Live preview</button></div>' +
    '<button type="button" class="tnt-sidebox-close" aria-label="Close this column" ' +
    'title="Close">' +
    icon('x', 16) +
    '</button></header>' +
    '<div class="tnt-sidebox-part" id="tntSideHelpers" role="tabpanel" ' +
    'aria-labelledby="tntSideTabHelpers" hidden></div>' +
    '<div class="tnt-sidebox-part tnt-sidefiles" id="tntSideFiles" role="tabpanel" ' +
    'aria-labelledby="tntSideTabFiles" hidden></div>' +
    '<div class="tnt-sidebox-part tnt-sidedetails" id="tntSideDetails" role="tabpanel" ' +
    'aria-labelledby="tntSideTabDetails" hidden>' +
    '<p class="tnt-sidedetails-none" hidden>No thread is open.</p></div>' +
    '<div class="tnt-sidebox-part tnt-sideterm" id="tntSideTerminal" role="tabpanel" ' +
    'aria-labelledby="tntSideTabTerminal" hidden></div>' +
    '<div class="tnt-sidebox-part tnt-sidepreview" id="tntSidePreview" role="tabpanel" ' +
    'aria-labelledby="tntSideTabPreview" hidden></div>';
  const tabs = column.querySelector('.tnt-sidebox-tabs');
  const closeButton = column.querySelector('.tnt-sidebox-close');
  const helpersPart = column.querySelector('#tntSideHelpers');
  const filesPart = column.querySelector('#tntSideFiles');
  const terminalPart = column.querySelector('#tntSideTerminal');
  const helpersTab = tabs.querySelector('[data-tab="helpers"]');
  const detailsPart = column.querySelector('#tntSideDetails');
  const detailsTab = tabs.querySelector('[data-tab="details"]');
  const detailsNone = detailsPart.querySelector('.tnt-sidedetails-none');
  const previewPart = column.querySelector('#tntSidePreview');
  const previewTab = tabs.querySelector('[data-tab="preview"]');

  // The button in the thread's top row: the look and the spoken state of 127's two.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tnt-fold tnt-fold-side';
  button.innerHTML = icon('panel-right', 16);

  function paintButton() {
    const open = shown();
    const text = open ? 'Hide the column beside the thread' : 'Show the project’s files';
    if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
    if (button.title !== text) button.title = text;
    if (button.getAttribute('aria-expanded') !== String(open))
      button.setAttribute('aria-expanded', String(open));
  }

  // The file rail comes in once, the first time its tab shows, and stays.
  function bringFiles() {
    const rail = document.querySelector('.repository-rail');
    if (rail && rail.parentNode !== filesPart) filesPart.append(rail);
  }

  // ---------- a file, read inside the column ----------
  // A press on a file shows its text here, in place of the tree, with a way back; the tree keeps
  // its folders and its scroll place underneath. A kind the column cannot show (a picture, a
  // program file) says so and offers the view-only window, which every file can still open in.
  const fileView = document.createElement('div');
  fileView.className = 'tnt-fileview';
  fileView.hidden = true;
  fileView.innerHTML =
    '<div class="tnt-fileview-head">' +
    '<button type="button" class="tnt-fileview-back" aria-label="Back to the files" ' +
    'title="Back to the files">' +
    icon('arrow-left', 16) +
    '</button><strong class="tnt-fileview-name"></strong>' +
    '<button type="button" class="tnt-fileview-window" aria-label="Open in its own window" ' +
    'title="Open in its own window">' +
    icon('external-link', 16) +
    '</button></div>' +
    '<p class="tnt-fileview-note" hidden></p>' +
    '<pre class="tnt-fileview-text" tabindex="0"></pre>';
  filesPart.append(fileView);
  const fileBack = fileView.querySelector('.tnt-fileview-back');
  const fileWindow = fileView.querySelector('.tnt-fileview-window');
  const fileName = fileView.querySelector('.tnt-fileview-name');
  const fileNote = fileView.querySelector('.tnt-fileview-note');
  const fileText = fileView.querySelector('.tnt-fileview-text');

  // The file that shows, and the row it was opened from (the keyboard returns to it).
  let filePath = '';
  let fileRow = null;

  // The text of the reader up to the start of line `line`, as a place on screen: the reader wraps
  // long lines, so a line's place is read from the page, not counted.
  function scrollToLine(line) {
    const source = fileText.textContent;
    let offset = 0;
    for (let passed = 1; passed < line; passed++) {
      const next = source.indexOf('\n', offset);
      if (next < 0) return;
      offset = next + 1;
    }
    const walker = document.createTreeWalker(fileText, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && offset > node.length) {
      offset -= node.length;
      node = walker.nextNode();
    }
    if (!node) return;
    const range = document.createRange();
    range.setStart(node, Math.min(offset, node.length));
    range.setEnd(node, Math.min(offset + 1, node.length));
    const at = range.getBoundingClientRect();
    const box = fileText.getBoundingClientRect();
    fileText.scrollTop += at.top - box.top - box.height / 3;
  }

  // `line`: the line to bring into view (a path with a line number pressed in the terminal, 136).
  async function showFile(path, row, line) {
    const viewer = window.TnaiFileViewer;
    if (!viewer?.text) {
      viewer?.open(path);
      return;
    }
    filePath = path;
    fileRow = row || null;
    const result = await viewer.text(path);

    // A later press won: this answer is for a file that no longer shows.
    if (filePath !== path) return;
    fileName.textContent = result.name || path;
    fileName.title = result.rel || path;

    // code is colored by its language (134); plain text and unknown kinds stay as they are
    const text = result.ok ? result.text : '';
    if (window.TnaiCodeColors) window.TnaiCodeColors.paint(fileText, text, result.name || path);
    else fileText.textContent = text;
    fileText.hidden = !result.ok;
    const note = result.ok
      ? result.cut
        ? 'This is the start of a long file. Open it in its own window to read all of it.'
        : ''
      : result.reason + '.';
    fileNote.textContent = note;
    fileNote.hidden = !note;
    fileText.scrollTop = 0;
    filesPart.classList.add('tnt-file-open');
    fileView.hidden = false;
    fileBack.focus({ preventScroll: true });
    if (result.ok && line > 1) scrollToLine(line);
  }

  function hideFile() {
    if (fileView.hidden) return;
    const inside = fileView.contains(document.activeElement);
    filePath = '';
    fileView.hidden = true;
    filesPart.classList.remove('tnt-file-open');
    fileText.textContent = '';
    if (inside && fileRow?.isConnected) fileRow.focus({ preventScroll: true });
    fileRow = null;
  }

  // Taken before the rail's own handlers (09 for a tree row, 24 for a search hit), which would
  // open the window. A folder row is left to them.
  filesPart.addEventListener(
    'click',
    event => {
      const row = event.target.closest?.('.repo-file[data-real-path], .repo-search-hit');
      if (!row || !filesPart.contains(row)) return;
      const path = row.dataset.realPath || row.dataset.searchPath;
      if (!path) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showFile(path, row);
    },
    true
  );
  fileBack.addEventListener('click', hideFile);
  fileWindow.addEventListener('click', () => {
    if (filePath) window.TnaiFileViewer?.open(filePath);
  });
  fileView.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    hideFile();
  });

  function paint() {
    const now = tab();
    const withHelpers = helperCount() > 0;

    // Files, Details and Terminal are always there; Helpers only while the open thread has
    // helpers. (Details only in a build that has 139.)
    helpersTab.hidden = !withHelpers;
    detailsTab.hidden = !window.TnaiThreadDetails;
    tabs.querySelectorAll('[role="tab"]').forEach(tabButton => {
      const chosen = tabButton.dataset.tab === now;
      tabButton.setAttribute('aria-selected', String(chosen));
      tabButton.tabIndex = chosen ? 0 : -1;
    });
    helpersPart.hidden = now !== 'helpers';
    filesPart.hidden = now !== 'files';
    terminalPart.hidden = now !== 'terminal';
    detailsPart.hidden = now !== 'details';

    // Live preview is a tab only while a site was opened by itself
    previewTab.hidden = !previewNode;
    previewPart.hidden = now !== 'preview';
    if (previewNode && previewNode.parentNode !== previewPart) previewPart.append(previewNode);
    paintDetails(now === 'details');
    if (now === 'files') bringFiles();

    // 163: while another computer's thread is open, its files take the rail's place here
    if (now === 'files') window.TnaiRemoteFiles?.place?.(filesPart);

    // 136 puts the terminal into its box and starts its session the first time
    if (now === 'terminal') window.TnaiOwnTerminal?.show(terminalPart);
    if (helpersPanel && helpersPanel.parentNode !== helpersPart) helpersPart.append(helpersPanel);
  }

  // ---------- Details: 139's part, for the open thread ----------
  // The thread whose details are mounted now ('' for none).
  let detailsPane = '';

  // The open thread, when its session is there ('' with no thread open).
  function openPane() {
    try {
      const want = threads()?.selected() || '';
      const live = window.TnaiAgents.sessions().some(session => session.paneId === want);
      return want && live ? want : '';
    } catch {
      return '';
    }
  }

  // Mounted while the tab shows and a thread is open, for that thread; unmounted otherwise, so 139
  // listens to nothing while nobody reads it.
  function paintDetails(showing) {
    const details = window.TnaiThreadDetails;
    if (!details) return;
    const pane = showing ? openPane() : '';
    detailsNone.hidden = !showing || !!pane;
    if (pane === detailsPane) return;
    detailsPane = pane;
    if (pane) details.mount(detailsPart, pane);
    else details.unmount(detailsPart);
  }

  function apply() {
    const frame = threads();
    const slot = frame?.slot('side');
    paintButton();
    if (!slot) return;
    const open = shown();
    if (open) {
      if (column.parentNode !== slot) slot.replaceChildren(column);
      paint();
    } else paintDetails(false);
    frame.side(open);
  }

  // ---------- what the user does ----------
  function open(which) {
    if (which === 'helpers' && helperCount() > 0) {
      window.TnaiThreadHelpers.open();
      return;
    }
    wanted =
      which === 'terminal' || which === 'details' || (which === 'preview' && previewNode)
        ? which
        : 'files';
    kept = true;
    save();

    // The helper's conversation stops being read while another tab shows.
    if (helpersOpen) window.TnaiThreadHelpers?.close();
    apply();
  }

  function close() {
    const inside = column.contains(document.activeElement);
    kept = false;
    previewOpen = false;
    save();
    if (helpersOpen) window.TnaiThreadHelpers?.close();
    apply();

    // The keyboard does not stay in a column that is no longer there.
    if (inside && button.isConnected) button.focus({ preventScroll: true });
  }

  const toggle = () => (shown() ? close() : open('files'));

  button.addEventListener('click', toggle);
  closeButton.addEventListener('click', close);
  tabs.addEventListener('click', event => {
    const tabButton = event.target.closest('[role="tab"]');
    if (!tabButton) return;
    open(tabButton.dataset.tab);

    // a press on Terminal is a press to type there
    if (tabButton.dataset.tab === 'terminal') window.TnaiOwnTerminal?.focus();
  });

  // Left and Right move between the tabs that are there, as in any tab row.
  tabs.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const names = [...tabs.querySelectorAll('[role="tab"]:not([hidden])')].map(
      tabButton => tabButton.dataset.tab
    );
    const step = event.key === 'ArrowRight' ? 1 : -1;
    open(names[(names.indexOf(tab()) + step + names.length) % names.length]);
    tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  });

  // ---------- following the frame ----------
  // The button goes into the thread's top row, which 120 builds with the first thread: after
  // every other button and before the thread's own "..." menu (137), which is looked for last.
  function placeButton() {
    const acts = threads()?.slot('main')?.querySelector('.tnt-view .tnt-head-acts');
    if (!acts) return;
    const more = acts.querySelector('.tnt-head-menu');
    const inPlace =
      button.parentNode === acts && (more ? button.nextElementSibling === more : true);
    if (!inPlace) acts.insertBefore(button, more || null);
  }

  window.addEventListener('tnai:thread-view', () => {
    placeButton();
    apply();
  });
  window.addEventListener('tnai:threads-built', apply);
  window.addEventListener('tnai:threads-shown', apply);

  window.TnaiThreadSide = {
    open,
    close,
    toggle,
    state: () => ({ shown: shown(), kept, tab: tab(), file: filePath }),
    showFile,
    hideFile,

    // 123 hands its panel over and says whether a helper is being read.
    helpers(panel, wanted) {
      helpersPanel = panel || helpersPanel;
      helpersOpen = !!wanted;
      apply();
    },

    // 170 hands over Live preview, opened by itself for a site an agent started: shown as the
    // column's own tab until the user closes the column or picks another tab.
    preview(node, show) {
      previewNode = node || previewNode;
      previewOpen = !!show && !!previewNode;
      if (previewOpen) wanted = 'preview';
      apply();
    },

    // 123 says that the open thread's helpers changed.
    refresh() {
      if (shown()) paint();
    },
  };
  apply();
})();
