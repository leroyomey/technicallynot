/*
 * Technically Not · 196-preview-control.js — the window's half of the `tnai_preview` tool
 * (desktop/preview-control.js): agents open, read, click, type, press keys, scroll and take
 * pictures in the Live preview page the user sees.
 *
 * The switch: off for every thread until the user turns it on, per thread, with the row
 * "Agent uses preview: off / on" in the thread's "..." menu (137 asks `on` and `toggle`).
 * Kept by panel id in localStorage, like the thread blur (120).
 *
 * The answers (31 hands every request marked `control` to `answer`):
 *   target  the preview frame on screen to act on: the newest one this agent's thread showed,
 *           else the selected tab's, else the largest one shown (Live preview page, the side
 *           column's Live preview, or the All threads preview column), with its place on screen
 *           for a picture. Nothing when the switch is off or no preview frame is on screen.
 *   open    the address as `tnai preview` shows it (31 `TnaiLivePreview.show`).
 *   after   the user's typing place back: a press in the page takes the keyboard into the frame,
 *           so a text box or terminal the user was typing in gets it back after each action.
 *
 * window.TnaiPreviewControl = { on, toggle, answer }.
 */
(() => {
  'use strict';
  if (!window.tnaiNative) return;

  const KEY = 'tnai.preview-control.v1';
  const FRAMES = 'iframe[name^="tnai-lp-"]';

  // The thread design cards (159) and other pages' frames are not Live preview.
  const NOT_PREVIEW = new Set(['tnai-lp-design']);

  let allowed = new Set();
  try {
    allowed = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {}

  const on = paneId => !!paneId && allowed.has(String(paneId));

  function toggle(paneId) {
    if (!paneId) return false;
    const id = String(paneId);
    if (allowed.has(id)) allowed.delete(id);
    else allowed.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...allowed]));
    } catch {}
    return allowed.has(id);
  }

  // A preview frame the user can see now: in the page, drawn, and inside the window.
  function onScreen(frame) {
    if (!frame.isConnected || NOT_PREVIEW.has(frame.name) || document.hidden) return false;
    if (frame.checkVisibility && !frame.checkVisibility({ visibilityProperty: true })) return false;
    const rect = frame.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  }

  // The Live preview tab a frame shows: 31 names its frames tnai-lp-<mount>-<tab id>.
  const tabIdOf = frame => (/-(lp-[a-z0-9]+)$/.exec(frame.name) || [])[1] || '';

  function pickFrame(paneId) {
    const frames = [...document.querySelectorAll(FRAMES)].filter(onScreen);
    if (!frames.length) return null;
    const tabs = window.TnaiLivePreview?.tabs?.() || [];
    const mine = tabs.filter(tab => tab.byPane === String(paneId)).map(tab => tab.id);
    const active = tabs.find(tab => tab.active)?.id || '';
    const area = frame => {
      const rect = frame.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const score = frame => {
      const tab = tabIdOf(frame);
      const index = mine.lastIndexOf(tab);
      if (index >= 0) return 3 + index / 1000;
      return tab && tab === active ? 2 : 1;
    };
    frames.sort((a, b) => score(b) - score(a) || area(b) - area(a));
    return frames[0];
  }

  // Where the user was typing when the agent's action began.
  let typingPlace = null;

  const typesText = node =>
    !!node &&
    node.tagName !== 'IFRAME' &&
    (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' || node.isContentEditable);

  function target(req) {
    const frame = pickFrame(req.paneId);
    if (!frame)
      return {
        ok: false,
        error:
          'the user has no Live preview on screen (the Live preview page, the side column’s Live preview or All threads)',
      };
    const active = document.activeElement;
    if (typesText(active)) typingPlace = active;
    const rect = frame.getBoundingClientRect();

    // `control` is the part the preload bridge passes on (desktop/preload.js preview.shown)
    return {
      ok: true,
      control: {
        frame: frame.name,
        url: frame.src || '',
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      },
    };
  }

  function after() {
    const place = typingPlace;
    typingPlace = null;
    const now = document.activeElement;
    if (place?.isConnected && now?.tagName === 'IFRAME' && now.name?.startsWith('tnai-lp-'))
      place.focus({ preventScroll: true });
    return { ok: true };
  }

  async function answer(req) {
    if (req.action === 'after') return after();
    if (!on(req.paneId)) return { ok: false, off: true };
    if (req.action === 'target') return target(req);
    if (req.action === 'open') {
      const shown = await window.TnaiLivePreview?.show?.({
        id: req.id,
        url: req.url,
        device: req.device || '',
        paneId: req.paneId,
        by: req.by || 'An agent',
      });
      return shown || { ok: false, error: 'Live preview is not loaded' };
    }
    return { ok: false, error: 'unknown request' };
  }

  window.TnaiPreviewControl = { on, toggle, answer };
})();
