/* Technically Not · 148-browser-only.js — In a plain browser, a page that says the app runs on the
   desktop, in place of the old frame. The thread layout is built only in the desktop app (118) and
   the old frame must not be shown, so the browser shows this page and nothing else. The browser
   tests open the page at /__check (tools/browser-check) and still see the app underneath. Loaded
   just before 56, so the page is in place before the startup layer fades. Styles:
   42-browser-only.css. */
(() => {
  const inDesktopApp = !!window.tnaiNative;
  const inBrowserTest = location.pathname.startsWith('/__check');
  if (inDesktopApp || inBrowserTest) {
    return;
  }

  // The thread look's tokens (31-thread-pages.css) apply under html.tnt-on, Dark and Light alike.
  document.documentElement.classList.add('tnt-on');

  // Everything the old frame put on the page stays loaded but out of reach: no focus, no reader.
  for (const child of document.body.children) {
    child.inert = true;
    child.setAttribute('aria-hidden', 'true');
  }

  const page = document.createElement('main');
  page.className = 'browser-only';
  page.innerHTML =
    '<div class="browser-only-card">' +
    '<img class="browser-only-logo on-dark" src="src/assets/logo-light.png" alt="Technically Not">' +
    '<img class="browser-only-logo on-light" src="src/assets/logo-dark.png" alt="Technically Not">' +
    '<h1>Technically Not runs as a desktop app</h1>' +
    '<p>Your agents, their terminals and your project folder live in the app on your PC. ' +
    'Open it there, or download it for Windows or Linux from the website.</p>' +
    '<p class="browser-only-actions">' +
    '<a class="browser-only-get" href="https://technicallynot.ai/download" rel="noopener">Download</a>' +
    '<a class="browser-only-link" href="https://technicallynot.ai/docs" rel="noopener">How it works</a>' +
    '</p>' +
    '</div>';
  document.body.append(page);
  document.title = 'Technically Not';
})();
