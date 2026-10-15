/*
 * Technically Not tools · desktop-check/tests/whats-new-shots.js - Pictures for the website's
 * "What's new" cards, taken in the real app (Blue accent, as the website rule asks). 0.3.68: the
 * Skills page with the line under its title counting the skills loaded by running agents. The
 * running agent is a stand-in (TnaiAgents.sessions is wrapped, as desktop test session-skills does
 * it; no CLI is started and nothing is sent), with two of the library's own skills attached to it,
 * so the number on the page is the app's own count of a made-up agent. Saves desktop-wn-*.png (crop
 * each to 16:10 and save as webp in the website's assets/whats-new/; the log lines starting "rect"
 * give the place of each pictured part in the capture). The capture lags behind the page, so every
 * shot waits seconds on both sides. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const shot = async name => {
  await Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    wait(300),
  ]);
  await wait(1500);
  await (window.TnaiTest?.shot?.(name) ?? wait(4000));
};
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const rect = (label, n) => {
  const r = n?.getBoundingClientRect();
  log.push(
    'rect ' +
      label +
      ' ' +
      (r ? [r.left, r.top, r.width, r.height].map(Math.round).join(' ') : 'missing')
  );
};
const G = window.TnaiAgents,
  S = window.TnaiSessionSkills,
  PANE = 'whats-new-standin';
const realSessions = G.sessions,
  realSend = G.send;
try {
  window.TnaiTheme.setAccent('blue');
  log.push(
    'rect window 0 0 ' +
      innerWidth +
      ' ' +
      innerHeight +
      ' (device pixel ratio ' +
      devicePixelRatio +
      ')'
  );
  const fake = {
    paneId: PANE,
    name: 'Builder',
    agent: 'Claude Code',
    running: true,
    startedAt: 4242,
    status: 'working',
  };
  G.sessions = (...a) => [...realSessions.apply(G, a), fake];

  // nothing is sent anywhere for the stand-in
  G.send = (id, message, ...rest) => (id === PANE ? true : realSend.call(G, id, message, ...rest));
  const library = await until(() => {
    const l = window.TnaiSkills.list();
    return l.length >= 2 ? l : null;
  }, 10000);
  check(!!library, 'the library has skills to attach (' + (library ? library.length : 0) + ')');
  for (const k of (library || []).slice(0, 2)) await S.attach(PANE, k.id);
  const L = S.loaded(PANE);
  check(
    L.total >= 2,
    'the stand-in agent has skills loaded: ' +
      L.total +
      ' (' +
      L.attached.length +
      ' attached, ' +
      L.always.length +
      ' every session, ' +
      L.used.length +
      ' used)'
  );

  window.TnaiRoute('skills');
  const sk = document.getElementById('skillsPage');
  const line = await until(
    () =>
      [...sk.querySelectorAll('*')].find(
        n => !n.children.length && /loaded by running agents/.test(n.textContent)
      ),
    10000
  );
  check(
    !!line,
    'the Skills page counts the skills loaded by running agents: ' +
      (line ? line.textContent : 'no line')
  );
  await wait(800);
  rect('skills-page', sk);
  rect('loaded-line', line);
  await shot('wn-skills-loaded');
  await S.detachAll?.(PANE);
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
G.sessions = realSessions;
G.send = realSend;
return { ok, log };
