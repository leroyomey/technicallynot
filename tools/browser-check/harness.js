// Test helpers injected before Technically Not's own scripts. Each test calls check.done() when
// finished.
(() => {
  const params = new URLSearchParams(location.search),
    lines = [],
    errors = [];
  let finished = false;
  const check = (window.check = {
    test: params.get('test') || 'smoke',
    phase: params.get('phase') || '1',
    errors,
    log: (...parts) => lines.push(parts.map(String).join(' ')),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    q: selector => document.querySelector(selector),
    async until(fn, ms = 4000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const value = fn();
        if (value) return value;
        await check.wait(50);
      }
      return null;
    },
    done() {
      if (finished) return;
      finished = true;
      lines.push(errors.length ? 'JS ERRORS: ' + errors.join(' | ') : 'JS errors: none');
      fetch('/__log?test=' + check.test + '&phase=' + check.phase, {
        method: 'POST',
        body: lines.join('\n'),
      });
    },
  });

  // Chrome's "ResizeObserver loop completed with undelivered notifications" is a notice that a
  // resize callback changed layout again (the rest is delivered next frame), not a script error; it
  // is listed apart so real errors stand out.
  addEventListener('error', e => {
    if (/^ResizeObserver loop/.test(e.message || '')) {
      lines.push('note: ' + e.message);
      return;
    }
    errors.push(
      e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno
    );
  });
  addEventListener('unhandledrejection', e =>
    errors.push('unhandled rejection: ' + (e.reason?.message || e.reason))
  );
  setTimeout(() => {
    check.log('TIMEOUT: test did not call check.done()');
    check.done();
  }, 60000);
})();
