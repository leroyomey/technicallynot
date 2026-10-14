// Technically Not desktop · auth-loopback.js — One-shot OAuth redirect receiver for Technically Not
// sign-in: an HTTP server on 127.0.0.1 (ephemeral port) that accepts exactly one callback carrying
// the expected `state`, answers the browser with a short "return to Technically Not" page, and
// closes. Times out and can be cancelled.
'use strict';
const http = require('http');
const { safeEqual } = require('./auth-jwt');

const PATH = '/callback';

// Browsers only let a script close a tab it opened or one with a single history entry; after the
// provider's redirects this tab may have more, so window.close() can be refused silently. It is
// tried right away and again shortly after; if the tab stays, the text says it can be closed by
// hand. The app window comes to the front either way (user-auth.js finishSignIn).
const CLOSE_SCRIPT = `<script>(function(){function t(){try{window.close()}catch(e){}}t();setTimeout(t,300)})()</script>`;
const page = (
  title,
  text,
  close
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f3;color:#20211f;font:14px/1.5 system-ui,"Segoe UI",sans-serif}
main{max-width:360px;padding:28px 30px;border:1px solid #e4e7df;border-radius:12px;background:#fff;text-align:center}
b{display:grid;place-items:center;width:30px;height:30px;margin:0 auto 12px;border-radius:9px;background:#20211f;color:#c7f36b;font-weight:800}
h1{margin:0 0 6px;font-size:16px}p{margin:0;color:#6e7467}</style></head><body><main><b>a</b><h1>${title}</h1><p>${text}</p></main></body>${close ? CLOSE_SCRIPT : ''}</html>`;

const PAGES = {
  ok: page('Signed in', 'You can close this tab and return to Technically Not.', true),
  cancelled: page(
    'Sign-in cancelled',
    'Nothing was changed. You can close this tab and return to Technically Not.',
    true
  ),
  failed: page(
    'Sign-in didn’t finish',
    'Technically Not shows what went wrong. You can close this tab and return to Technically Not.',
    true
  ),
  mismatch: page(
    'This link isn’t for this sign-in',
    'Start the sign-in again from Technically Not.'
  ),
};

/**
 * Starts the receiver. Resolves once listening with { port, redirectUri, result, cancel(reason) }.
 * `result` resolves with the callback's query params (Object) for the matching `state`, or rejects with an Error whose `code` is
 * 'timeout' | 'cancelled'. Requests with a wrong `state` get an error page and don't end the wait (single-use state, no CSRF).
 */
function listen({ state, timeoutMs }) {
  return new Promise((resolveListen, rejectListen) => {
    let settle = null,
      done = false,
      timer = null;
    const result = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    result.catch(() => {}); // callers attach handlers later
    const server = http.createServer((req, res) => {
      const send = (status, html) => {
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close',
        });
        res.end(html);
      };
      const port = server.address()?.port;

      // DNS-rebinding guard: only our own loopback origin.
      if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + port)
        return send(400, PAGES.mismatch);
      const url = new URL(req.url, 'http://127.0.0.1:' + port);
      if (url.pathname !== PATH) {
        res.writeHead(404, { Connection: 'close' });
        return res.end();
      }
      const query = Object.fromEntries(
        [...url.searchParams].slice(0, 20).map(([k, v]) => [k, v.slice(0, 4096)])
      );
      if (done || !safeEqual(query.state || '', state)) return send(400, PAGES.mismatch);
      finish(null, query);
      send(
        200,
        query.error ? (query.error === 'access_denied' ? PAGES.cancelled : PAGES.failed) : PAGES.ok
      );
    });
    const finish = (error, query) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      setTimeout(() => server.closeAllConnections?.(), 1000).unref();
      if (error) settle.reject(error);
      else settle.resolve(query);
    };
    const fail = (code, message) => {
      const e = new Error(message);
      e.code = code;
      return e;
    };
    server.on('error', error => {
      if (!server.listening) rejectListen(error);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      timer = setTimeout(
        () => finish(fail('timeout', 'Sign-in timed out. Nothing was changed.')),
        timeoutMs
      );
      resolveListen({
        port,
        redirectUri: 'http://127.0.0.1:' + port + PATH,
        result,
        cancel: (message = 'Sign-in cancelled.') => finish(fail('cancelled', message)),
      });
    });
  });
}

module.exports = { listen, PATH };
