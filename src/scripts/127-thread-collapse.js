// Technically Not · 127-thread-collapse.js — Desktop only: show and hide for the two side columns
// of the thread layout.
//
// Two buttons of one kind, mirrored: the thread list's stands in the top bar after the logo and
// works on every page (Ctrl+B too); the preview column's stands at the right end of the Terminal
// page's top row, above the column it puts away. A hidden column leaves its whole room to the
// page: nothing is animated, so a terminal beside it changes width once and is fitted once.
//
// The thread list's state is remembered per page (the layout's own page class), in
// `tnai.thread-collapse.v1` ({ closed: { 'terminal-mode': true } }). The preview column's state is
// 105's (`TnaiTerminalPreview.previewOpen`, `setPreview`). `window.TnaiThreadCollapse`
// (`listOpen`, `setList`, `toggleList`). Look: src/styles/33-thread-collapse.css.
// Test `thread-collapse`.
(() => {
  const layout = document.querySelector('.layout');
  const topLeft = document.querySelector('.top .top-left');
  if (!layout || !topLeft || !window.tnaiNative) return;

  const KEY = 'tnai.thread-collapse.v1';
  let closed = {};
  try {
    closed = (JSON.parse(localStorage.getItem(KEY) || '{}') || {}).closed || {};
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ closed }));
    } catch {}
  };
  const keys = text => window.tnaiKeys?.(text) || text;

  function makeButton(side, iconName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tnt-fold tnt-fold-' + side;
    button.innerHTML = window.TnaiIcon?.(iconName, { size: 16 }) || '';
    return button;
  }

  function paint(button, open, showText, hideText) {
    const text = open ? hideText : showText;
    if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
    if (button.title !== text) button.title = text;
    if (button.getAttribute('aria-expanded') !== String(open))
      button.setAttribute('aria-expanded', String(open));
  }

  // A column never jumps in or out: the page before fades into the page after. No width is
  // animated, so a terminal beside the column is still fitted once. Under reduced motion, or
  // while another change is fading, the change is made at once.
  const fade = change => (window.TnaiMotion ? window.TnaiMotion.swap(change, 'fold') : change());

  // ---------- the thread list, on every page ----------
  const listButton = makeButton('list', 'panel-left');
  const brand = topLeft.querySelector('.brand');
  if (brand) brand.after(listButton);
  else topLeft.prepend(listButton);

  // The page that shows, by the layout's own class for it. The Terminal page carries
  // "code-mode" beside its own class, so the page's own class is looked for first.
  const PAGES = [
    'threads-mode',
    'terminal-mode',
    'skills-mode',
    'settings-mode',
    'devices-mode',
    'board-mode',
    'connections-mode',
    'preview-mode',
    'code-mode',
  ];
  const page = () => PAGES.find(name => layout.classList.contains(name)) || 'page';
  const listOpen = () => !closed[page()];

  function applyList() {
    const open = listOpen();
    if (layout.classList.contains('tnt-list-closed') === open) {
      // The keyboard does not stay in a list that is no longer there.
      const inList = !open && document.activeElement?.closest?.('.tnt-list');
      fade(() => {
        layout.classList.toggle('tnt-list-closed', !open);
      });
      if (inList) listButton.focus({ preventScroll: true });
    }
    paint(
      listButton,
      open,
      keys('Show the thread list (Ctrl+B)'),
      keys('Hide the thread list (Ctrl+B)')
    );
  }

  function setList(open) {
    if (open) delete closed[page()];
    else closed[page()] = true;
    save();
    applyList();
  }

  const toggleList = () => setList(!listOpen());
  listButton.addEventListener('click', toggleList);

  // Ctrl+B (Cmd+B on a Mac). In a terminal the pair belongs to the program running there.
  document.addEventListener('keydown', event => {
    const platform = window.tnaiPlatform;
    if (!platform?.mod?.(event) || event.altKey || event.shiftKey || platform.otherMod?.(event))
      return;
    if (event.key.toLowerCase() !== 'b') return;
    if (!platform.mac && event.target?.closest?.('.xterm, [contenteditable="true"]')) return;
    event.preventDefault();
    toggleList();
  });

  // Another page shows: its own remembered state.
  let shownPage = page();
  new MutationObserver(() => {
    if (page() === shownPage) return;
    shownPage = page();
    applyList();
  }).observe(layout, { attributes: true, attributeFilter: ['class'] });

  // ---------- the preview column of the Terminal page ----------
  const tools = document.querySelector('#terminalView .terminal-tools');
  const previewButton = makeButton('preview', 'panel-right');

  // This one says what it is: an icon alone at the end of the row was not found, and with the
  // column put away nothing else on the page says that a preview exists.
  const previewWord = document.createElement('span');
  previewWord.className = 'tnt-fold-word';
  previewWord.textContent = 'Preview';
  previewButton.append(previewWord);

  function paintPreview() {
    paint(
      previewButton,
      window.TnaiTerminalPreview?.previewOpen?.() !== false,
      'Show the preview',
      'Hide the preview'
    );
  }

  if (tools && window.TnaiTerminalPreview?.setPreview) {
    tools.append(previewButton);
    previewButton.addEventListener('click', () => {
      const terminals = window.TnaiTerminalPreview;
      fade(() => terminals.setPreview(!terminals.previewOpen()));
    });
    window.addEventListener('tnai:terminal-preview-open', paintPreview);
    paintPreview();
  }

  window.TnaiThreadCollapse = { listOpen, setList, toggleList };
  applyList();
})();
