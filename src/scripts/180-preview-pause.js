/*
 * Technically Not · 180-preview-pause.js — a Live preview that is not on screen does not run
 * (user 2026-10-23: "pausing systems for live previews where they're not ever playing in the
 * background if they're not being viewed, they get paused or stopped until the next time it is
 * shown again").
 *
 * Live preview (31) keeps one frame per tab and only hides the ones not shown, so a page in a
 * hidden tab, a closed side column, another page of the app or a minimized window kept running:
 * its scripts, animations, videos and sound. This file watches every Live preview frame
 * (`iframe.lp-frame`, also the ones of All threads, the page beside the thread and a popped-out
 * preview window). When one has been out of sight for PAUSE_MS, it is stopped: its address is
 * kept and the frame is emptied (`about:blank`). The moment it is on screen again, its address
 * comes back and the page loads again. Its scroll is noted before it stops (desktop/
 * preview-emulation.js 'keep') and put back on the load when it is shown again within 15 s, the
 * limit that file keeps; after a longer pause the page starts at its top. What the page held only
 * in memory (typed text, an open menu) starts fresh, as after a reload; its own storage stays.
 *
 * The short wait lets a quick look at another tab come back without a reload. Pages are emptied,
 * not frozen, because a page from a dev server is another origin: this window cannot pause its
 * scripts, only unload it.
 *
 * window.TnaiPreviewPause = { paused(frame), check(), watch(frame) }; 31 calls `watch` for each
 * frame it makes. Test: node tools/preview-pause-test.js
 */
(() => {
  'use strict';

  // how long a frame may be out of sight before it stops
  const PAUSE_MS = 3000;
  const BLANK = 'about:blank';
  const FRAMES = 'iframe.lp-frame';

  // frame -> whether it is on screen, from the intersection observer
  const inSight = new WeakMap();

  // frame -> the timer that stops it
  const timers = new Map();
  const watched = new WeakSet();

  const paused = frame => !!frame.dataset.pausedSrc;

  // On screen: the frame takes room in the page, it is in view, and the window is not hidden.
  const onScreen = frame => frame.isConnected && !document.hidden && inSight.get(frame) === true;

  function stop(frame) {
    timers.delete(frame);
    if (onScreen(frame) || paused(frame) || !frame.isConnected) return;
    const src = frame.getAttribute('src') || '';
    if (!src || src === BLANK) return;
    frame.dataset.pausedSrc = src;

    // note the page's scroll first, then empty the frame (unless it came back meanwhile)
    let noted = null;
    try {
      noted = window.tnaiNative?.preview?.nav?.(frame.name, 'keep');
    } catch {}
    Promise.resolve(noted)
      .catch(() => {})
      .then(() => {
        if (paused(frame) && !onScreen(frame)) frame.src = BLANK;
      });
  }

  function resume(frame) {
    const src = frame.dataset.pausedSrc;
    if (!src) return;
    delete frame.dataset.pausedSrc;

    // stopped before the frame was emptied: it still shows its page
    if (frame.getAttribute('src') !== BLANK) return;

    // 31 may have moved the tab to another address meanwhile: that one wins
    frame.src = frame.dataset.src || src;
  }

  // Looks at one frame again: back on screen resumes it at once, out of sight stops it after the
  // wait.
  function look(frame) {
    if (onScreen(frame)) {
      clearTimeout(timers.get(frame));
      timers.delete(frame);
      resume(frame);
    } else if (!paused(frame) && !timers.has(frame)) {
      timers.set(
        frame,
        setTimeout(() => stop(frame), PAUSE_MS)
      );
    }
  }

  const sight = new IntersectionObserver(entries => {
    for (const entry of entries) {
      inSight.set(entry.target, entry.isIntersecting && entry.intersectionRect.width > 0);
      look(entry.target);
    }
  });

  function watch(frame) {
    if (watched.has(frame)) return;
    watched.add(frame);
    sight.observe(frame);
  }

  // Every frame already in the page; 31 hands over each frame it makes later (`watch`).
  function check() {
    document.querySelectorAll(FRAMES).forEach(watch);
    for (const frame of timers.keys()) if (!frame.isConnected) timers.delete(frame);
  }
  check();

  // A minimized or covered-by-a-tab window: every frame counts as out of sight; back, each on
  // screen comes back.
  document.addEventListener('visibilitychange', () => {
    document.querySelectorAll(FRAMES).forEach(look);
  });

  window.TnaiPreviewPause = { paused, check, watch };
})();
