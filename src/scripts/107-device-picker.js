// Technically Not · 107-device-picker.js — Desktop only: the Live preview page's device characters
// (the device dock). Three mascot-style objects (an old monitor with a tower, a tablet, a phone).
// (1) The chooser: the three cover the stage; pointing at one or focusing it lights its screen in
// the accent color and opens its eyes, clicking it shows the preview at that device's size (it
// presses 31's own Desktop / Tablet / Phone button in the page's dock, so saving and fitting follow
// as before). Shown once per app run when the user opens the Live preview page from the menu with a
// tab open (open() for tests); Esc or a click beside the objects closes it and keeps the view. (2)
// The dock: attach() puts a small character into each of 31's Desktop / Tablet / Phone buttons in
// place of the word (the word stays as the hidden label) and the group of all three into 65's Side
// by side button, moved to the dock's start; the buttons, their handlers and aria-pressed stay 31's
// and 65's. The objects are Blender renders
// (src/assets/devices/<device>-body|screen|eyes|sleep.webp), stacked; the screen picture is a mask
// filled with the accent, so it follows the accent picker. Styles: 14-settings-preview-purple.css
// (.dvp-* chooser, .dvc-* dock). window.TnaiDevicePicker (attach, auto, open, close, isOpen).
(() => {
  if (!window.tnaiNative) return;
  const DEVICES = [
    ['desktop', 'Desktop'],
    ['tablet', 'Tablet'],
    ['phone', 'Phone'],
  ];
  const CROP = {
    desktop: [50, 40, 850, 700],
    tablet: [305, 130, 400, 566],
    phone: [362, 205, 248, 478],
  }; // each object's own box in the 960×780 picture: x, y, width, height
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  let stage = null,
    dock = null,
    box = null,
    opener = null,
    shown = false;

  const pressed = () => dock?.querySelector('.lp-modes button[aria-pressed="true"]');
  const current = () => pressed()?.dataset.device || 'desktop';
  const isOpen = () => !!box && !box.hidden;

  // The four stacked pictures of one object; `pre` is the class prefix (dvp = chooser, dvc = dock).
  function layers(id, pre) {
    const img = part => {
      const i = el('img', pre + '-' + part);
      i.src = 'src/assets/devices/' + id + '-' + part + '.webp';
      i.alt = '';
      i.draggable = false;
      return i;
    };
    const screen = el('span', pre + '-screen');
    screen.style.setProperty(
      '--dvp-mask',
      'url("' + new URL('src/assets/devices/' + id + '-screen.webp', document.baseURI).href + '")'
    ); // absolute: a url() in a custom property is not relative to the stylesheet
    return [img('body'), screen, img('sleep'), img('eyes')];
  }

  function character(id) {
    // a small object for the dock, cropped to its own box
    const c = el('span', 'dvc'),
      [x, y, w, h] = CROP[id];
    c.setAttribute('aria-hidden', 'true');
    c.style.setProperty('--cx', x);
    c.style.setProperty('--cy', y);
    c.style.setProperty('--cw', w);
    c.style.setProperty('--ch', h);
    c.append(...layers(id, 'dvc'));
    return c;
  }

  function build() {
    box = el('div', 'dvp');
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Choose a screen');
    const row = el('div', 'dvp-row');
    DEVICES.forEach(([id, label]) => {
      const b = el('button', 'dvp-obj');
      b.type = 'button';
      b.dataset.device = id;
      b.title = 'Show the preview at ' + label.toLowerCase() + ' size';
      const art = el('span', 'dvp-art');
      art.setAttribute('aria-hidden', 'true');
      art.append(...layers(id, 'dvp'));
      b.append(art, el('span', 'dvp-name', label));
      row.append(b);
    });
    box.append(
      el('h2', 'dvp-title', 'Which screen do you want to see?'),
      row,
      el(
        'p',
        'dvp-hint',
        'Point at one to wake it up. Click to open that view. Esc keeps the view you have.'
      )
    );
    box.addEventListener('click', event => {
      const b = event.target.closest('.dvp-obj');
      if (b)
        dock?.querySelector('.lp-modes button[data-device="' + b.dataset.device + '"]')?.click();
      close();
    });
    box.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return; // keep Tab inside the three objects while it is open
      const items = [...box.querySelectorAll('.dvp-obj')],
        i = items.indexOf(document.activeElement);
      event.preventDefault();
      items[(i + (event.shiftKey ? items.length - 1 : 1)) % items.length].focus({
        preventScroll: true,
      });
    });
    stage.append(box);
  }

  function open(from) {
    if (!stage || !dock) return false;
    if (!box) build();
    opener = from || pressed();
    const now = current();
    box
      .querySelectorAll('.dvp-obj')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.device === now)));
    box.hidden = false;
    shown = true;
    box.querySelector('.dvp-obj[aria-pressed="true"]')?.focus({ preventScroll: true });
    return true;
  }

  function close() {
    if (!isOpen()) return;
    box.hidden = true;
    const back = pressed() || opener; // the character of the view now shown
    if (back?.isConnected) back.focus({ preventScroll: true });
    opener = null;
  }

  // 65 calls this once, when it has built the page's dock: group of three | Desktop Tablet Phone |
  // size, zoom, Rotate.
  function attach(stageEl, dockEl) {
    stage = stageEl;
    dock = dockEl;
    const modes = dock.querySelector('.lp-modes'),
      all = dock.querySelector('.lpp-sbs-btn');
    modes?.querySelectorAll('button[data-device]').forEach(b => {
      if (!CROP[b.dataset.device]) return;
      const label = b.textContent.trim();
      b.classList.add('dvc-btn');
      b.setAttribute('aria-label', label);
      b.replaceChildren(character(b.dataset.device), el('span', 'dvc-lbl', label));
    });
    if (all) {
      const group = el('span', 'dvc-group');
      group.setAttribute('aria-hidden', 'true');
      group.append(...DEVICES.map(([id]) => character(id)));
      all.classList.add('dvc-btn', 'dvc-all');
      all.setAttribute('aria-label', 'All devices side by side');
      all.replaceChildren(group, el('span', 'dvc-lbl', 'Side by side'));
      dock.prepend(all, el('span', 'dvc-sep'));
    }
    modes?.after(el('span', 'dvc-sep'));
  }

  // 65 calls this when the user opens the page from the menu: once per app run, only with something
  // to preview and the preview docked.
  function auto() {
    if (
      shown ||
      !stage ||
      !dock ||
      window.TnaiLivePreviewPage?.isOut?.() ||
      !(window.TnaiLivePreview?.tabs?.() || []).length
    )
      return;
    open();
  }

  window.TnaiDevicePicker = { attach, auto, open: () => open(), close, isOpen };
})();
