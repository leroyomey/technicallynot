/*
 * Technically Not tools · desktop-check/tests/cli-screen-closed-note.js — A thread closed right as
 * its session ends gets no note written into its closed terminal (10 `sayBelow`). The note under an
 * ended session ("Exited · type a prompt…") is written from a terminal write callback; a thread
 * closed between the exit and that callback had its terminal disposed already, and the note was
 * still written into it. A real PowerShell thread is started, `exit` is typed, and the test's own
 * exit listener (which runs after the app's) closes the thread at once. Every write into a terminal
 * after its dispose is counted; there must be none. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
try {
  // Every terminal made from here on says when it was disposed and counts writes after that.
  // The app binds dispose when it builds a terminal, so the patch is in place before the start.
  const proto = window.Terminal.prototype;
  const plainDispose = proto.dispose;
  const plainWrite = proto.write;
  let lateWrites = 0;
  const errors = [];
  proto.dispose = function () {
    this.testGone = true;
    return plainDispose.apply(this, arguments);
  };
  proto.write = function (data) {
    if (this.testGone && data) lateWrites++;
    return plainWrite.apply(this, arguments);
  };
  const onError = event => errors.push(String(event.message || event.reason || event));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const id = started.paneId;
  check(!!started.session?.running, 'PowerShell running as a thread');

  // wait for the shell's prompt before typing
  await until(async () =>
    /PS .*>|\$ $/.test((await window.tnaiNative.pty.replay(id))?.buffer || '')
  );

  // the moment the session ends, the thread is closed (after the app's own exit handler)
  let closedAt = 0;
  const stopListening = window.tnaiNative.pty.onExit(event => {
    if (event.paneId !== id || closedAt) return;
    closedAt = Date.now();
    window.dispatchEvent(new CustomEvent('tnai:terminal-pane-closed', { detail: { paneId: id } }));
  });
  window.tnaiNative.pty.write(id, 'exit\r');
  check(!!(await until(() => closedAt, 10000)), 'the session ended and its thread was closed');
  await wait(800);

  check(lateWrites === 0, 'no write into the closed terminal (' + lateWrites + ')');
  check(errors.length === 0, 'no page error' + (errors.length ? ': ' + errors.join(' | ') : ''));

  if (typeof stopListening === 'function') stopListening();
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  proto.dispose = plainDispose;
  proto.write = plainWrite;
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
