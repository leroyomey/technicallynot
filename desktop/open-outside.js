// Technically Not desktop · open-outside.js — Opens a web link in the user's own browser, a few
// times at most per page. A Live preview page is the user's code and can ask for it with no click
// (a timer that keeps navigating its frame or calling window.open): without a limit it could open
// the default browser over and over.
'use strict';

// At most MAX_OPENS links from one page within WINDOW_MS; a person clicking links never gets near
// it.
const MAX_OPENS = 3;
const WINDOW_MS = 10000;

// page key -> times (ms) of its recent opens
const recent = new Map();

// Whether one more link from this page may open now; records it when it may.
function allowed(pageKey, now = Date.now()) {
  const key = String(pageKey || 'unknown');
  const times = (recent.get(key) || []).filter(at => now - at < WINDOW_MS);
  if (times.length >= MAX_OPENS) {
    recent.set(key, times);
    return false;
  }
  times.push(now);
  recent.set(key, times);

  // keys of pages long gone are dropped now and then
  if (recent.size > 200)
    for (const [other, list] of recent)
      if (!list.some(at => now - at < WINDOW_MS)) recent.delete(other);
  return true;
}

// Opens an http(s) link in the user's browser unless the page went over its limit. `open` is
// Electron's shell.openExternal (passed in, so a Node test can run this without Electron).
function openOutside(open, url, pageKey) {
  if (!/^https?:/i.test(url)) return false;
  if (!allowed(pageKey)) return false;
  try {
    Promise.resolve(open(url)).catch(() => {});
  } catch {}
  return true;
}

module.exports = { openOutside, allowed, MAX_OPENS, WINDOW_MS };
