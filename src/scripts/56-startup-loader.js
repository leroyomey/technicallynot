/*
 * Technically Not · 56-startup-loader.js — Fades out the startup loading layer (#startupLoader in
 * index.html) once every earlier script has run. Loaded last. Performance marks tnai:scripts-done /
 * tnai:loader-gone let tests (desktop-check stress-soak) read startup time from the page's own
 * timeline.
 */
(() => {
  const layer = document.getElementById('startupLoader');
  performance.mark('tnai:scripts-done');
  if (!layer) return;
  requestAnimationFrame(() => {
    layer.classList.add('done');
    setTimeout(() => {
      layer.remove();
      performance.mark('tnai:loader-gone');
    }, 250);
  });
})();
