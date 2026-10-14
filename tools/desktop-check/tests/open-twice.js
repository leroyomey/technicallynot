/*
 * Technically Not tools · desktop-check/tests/open-twice.js — several new terminal panels asked for
 * at the same moment each get a panel of their own (two CLI updates pressed one
 * after the other; the second took the first one's place, so one update never ran or both commands
 * went to one terminal). TnaiAgents.open() is called three times without waiting: the first may
 * fill the empty panel the app starts with, the other two both need a new panel, which is the step
 * that used to hold a single request.
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
    await wait(50);
  }
  return null;
};
const A = window.TnaiAgents;
check(typeof A?.open === 'function', 'TnaiAgents.open is there');
const t0 = Date.now();
const asked = [A.open('Terminal'), A.open('Terminal'), A.open('Terminal')];
const got = await Promise.race([Promise.all(asked), wait(40000).then(() => null)]);
check(
  !!got,
  'all three calls answered (' +
    (Date.now() - t0) +
    ' ms)' +
    (got ? '' : ': at least one never did')
);
if (got) {
  const ids = got.map(r => r && r.ok && r.paneId).filter(Boolean);
  check(
    ids.length === 3,
    'each answered with a panel (' +
      got.map(r => (r?.ok ? 'ok' : r?.error || 'no answer')).join(', ') +
      ')'
  );
  check(new Set(ids).size === ids.length, 'three different panels: ' + ids.join(', '));
  const running = await until(
    () =>
      ids.every(id =>
        A.sessions().some(s => s.paneId === id && (s.running || s.status === 'starting'))
      ),
    15000
  );
  check(!!running, 'a shell runs in each of them');

  // Each takes its own command: what one panel is told is not typed into another.
  const tails = new Map(),
    off = window.tnaiNative.pty.onData(({ paneId, data }) =>
      tails.set(paneId, ((tails.get(paneId) || '') + String(data)).slice(-4000))
    );
  await wait(2500);
  ids.forEach((id, i) => A.send(id, 'Write-Output ("mark-" + "' + i + '-done")'));
  const each = await until(
    () => ids.every((id, i) => (tails.get(id) || '').includes('mark-' + i + '-done')),
    15000
  );
  check(!!each, 'each panel ran its own command');
  check(
    ids.every((id, i) =>
      ids.every((other, j) => i === j || !(tails.get(id) || '').includes('mark-' + j + '-done'))
    ),
    "no panel shows another panel's command"
  );
  off();
  for (const id of ids) await A.stop(id).catch(() => {});
}
return { ok, log };
