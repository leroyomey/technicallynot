// Technically Not · 28-version-label.js — Desktop app: the version and build number, small red text
// in the bottom-right corner (from window.tnaiNative.info()).
(() => {
  const native = window.tnaiNative;
  if (!native?.info) return;
  const style = document.createElement('style');
  style.textContent =
    '.tnai-version{display:none!important} /* hidden; kept in the DOM for tools/desktop-check/packaged-check.mjs; Settings › Updates shows the version */ .tnai-version{position:fixed;right:8px;bottom:4px;z-index:40;pointer-events:none;font:600 10px/1.2 var(--pg-sans);color:#c0392b;opacity:.85;letter-spacing:.02em}';
  document.head.append(style);
  native
    .info()
    .then(info => {
      if (!info?.version) return;
      const label = document.createElement('div');
      label.className = 'tnai-version';
      label.setAttribute('aria-label', 'Technically Not version');
      label.textContent =
        'v' +
        info.version +
        (info.build ? ' · build ' + info.build : '') +
        (info.dev ? ' · dev copy' : '');
      document.body.append(label);
    })
    .catch(() => {});
})();
