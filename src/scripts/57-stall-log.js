// Technically Not · 57-stall-log.js — Logs renderer main-thread stalls over 100 ms to the console
// (and keeps the last 50 in window.tnaiStalls), so future freezes can be traced to a time. Uses
// Chromium long-task entries; falls back to a late-timer check where they are unavailable.
(() => {
  const STALL_MS = 100;
  const stalls = (window.tnaiStalls = []);
  const note = ms => {
    const at = new Date().toISOString();
    stalls.push({ ms: Math.round(ms), at });
    if (stalls.length > 50) stalls.shift();
    console.warn(`[tnai stall] UI thread blocked ~${Math.round(ms)} ms at ${at}`);
  };

  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.duration > STALL_MS) note(entry.duration);
    }).observe({ type: 'longtask' });
    return;
  }

  const TICK_MS = 50;
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (now - last - TICK_MS > STALL_MS) note(now - last - TICK_MS);
    last = now;
  }, TICK_MS);
})();
