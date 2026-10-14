// Technically Not tools · desktop-check/tests/composer-mention-start.js — @mentioning a stopped
// custom agent in the composer: Send starts it (a real Claude Code custom agent, launched with no
// prompt) and keeps the message; Send again once it runs hands the message to that pane (captured
// at TnaiAgents.send and not typed into Claude, so no usage; send → pty is covered by
// composer-mentions). Returns {ok, log}.
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
const C = window.TnaiCustomAgents,
  G = window.TnaiAgents,
  N = window.tnaiNative;
const sends = [],
  realSend = G.send;
G.send = (paneId, text) => {
  sends.push({ paneId, text });
  return true;
}; // never reaches Claude (no usage)
let agent = null;
try {
  await Promise.resolve(window.TnaiSessionStart?.ready);
  await wait(2000);
  for (const a of C.list().filter(x => x.name === 'Mention Starter')) await C.remove(a.id);
  agent = await C.create({ name: 'Mention Starter', base: 'Claude Code', role: 'Test agent' });
  check(!!agent?.id, 'custom agent saved (Claude Code), not running');
  const copies = async () =>
    (await N.pty.list()).filter(s => s.customAgentId === agent.id && s.running);
  check((await copies()).length === 0, 'nothing running before the mention');
  window.TnaiRoute?.('overview');
  await wait(200);
  const p = document.getElementById('prompt');
  const key = k =>
    p.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = v => {
    p.focus();
    p.value = v;
    p.setSelectionRange(v.length, v.length);
    p.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const msg = '@Mention Starter echo tnai-mention-start-ok';
  type(msg);
  await wait(100);
  document.querySelector('.tnai-at-menu') && key('Escape');
  await wait(50);
  key('Enter');
  const started = await until(async () => (await copies())[0]);
  check(!!started, 'first Send started the stopped agent');
  check(!sends.length, 'first Send delivered nothing yet (' + sends.length + ')');
  check(p.value === msg, 'message kept in the composer: ' + JSON.stringify(p.value));
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === started?.paneId && s.running))),
    'its pane is running in the window'
  );
  await wait(1500);
  key('Enter');
  check(!!(await until(() => sends.length)), 'second Send went out');
  check(
    sends.length === 1 &&
      sends[0].paneId === started?.paneId &&
      /echo tnai-mention-start-ok$/.test(sends[0].text),
    'delivered to that agent only, mention stripped: ' + JSON.stringify(sends)
  );
  check(p.value === '', 'composer cleared after delivery');
  console.log('TNAI_SHOT:mention-start');
} catch (e) {
  check(false, 'threw: ' + e.message);
} finally {
  G.send = realSend;
  if (agent) {
    for (const s of (await N.pty.list()).filter(s => s.customAgentId === agent.id && s.running))
      await G.stop(s.paneId);
    await wait(1200);
    try {
      await C.remove(agent.id);
    } catch {}
  }
}
return { ok, log };
