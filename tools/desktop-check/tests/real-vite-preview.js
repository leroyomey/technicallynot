/*
 * Technically Not tools · desktop-check/tests/real-vite-preview.js — Live preview with a REAL Vite
 * dev server and a REAL agent (Claude Code on Haiku, one short edit, a few cents of the user's
 * usage). Needs TNAI_VITE_APP = a Vite React app (npm create vite + npm install) whose src/main.jsx
 * posts "TNAI_LIVE:load" on each page load and "TNAI_LIVE:h1:<heading>" whenever the page changes.
 * The agent changes the heading in src/App.jsx: Vite's hot reload must update the page with no full
 * reload by Technically Not, and the preview bar's note must name the agent. Hard cap ~4 min.
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
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const G = window.TnaiAgents,
  N = window.tnaiNative;
const markers = [];
window.addEventListener('message', e => {
  if (typeof e.data === 'string' && e.data.startsWith('TNAI_LIVE:')) markers.push(e.data.slice(10));
});
const loads = () => markers.filter(m => m === 'load').length;

async function screen(paneId) {
  const r = await N.pty.replay(paneId);
  if (!r?.buffer) return '';
  const vt = new window.Terminal({
    cols: r.cols || 120,
    rows: r.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => vt.write(r.buffer, done));
  const b = vt.buffer.active,
    rows = [];
  for (let y = 0; y < vt.rows; y++)
    rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
  vt.dispose();
  return rows.join('\n');
}
let offPerm = null,
  claude = '',
  server = null;

try {
  check(await main('setup'), 'Vite app copied into the project (node_modules copied)');

  // ---- Start "dev" (vite) from the Live preview page.
  const lp = document.getElementById('livePreviewPage');
  window.TnaiLivePreviewPage.open();
  await wait(300);
  const runBtn = await until(
    () =>
      [...lp.querySelectorAll('.lpp-scripts .lpp-row')]
        .find(r => r.querySelector('b')?.textContent === 'dev')
        ?.querySelector('.lp-go'),
    15000
  );
  check(!!runBtn, 'dev (vite) listed with Start');
  runBtn?.click();
  server = await until(
    () => window.TnaiLivePreview.tabs().find(t => t.script === 'dev' && t.state === 'running'),
    40000
  );
  check(!!server, 'Vite running at ' + server?.url);
  check(
    await until(() => loads() && markers.includes('h1:Get started'), 20000),
    'page loaded with its heading "Get started"'
  );
  await wait(1500);

  // ---- A real Claude Code agent (Haiku) makes one edit.
  // started as a thread, the way New thread does; the page shown stays the same
  window.TnaiLaunchPrefs?.once('Claude Code', { model: 'claude-haiku-4-5-20251001' });
  claude = (await window.TnaiTest.open('Claude Code'))?.paneId;
  check(
    !!claude &&
      !!(await until(() => G.sessions().find(s => s.paneId === claude && s.running), 20000)),
    'Claude Code started'
  );
  offPerm = N.permissions?.on?.(p => {
    if (p?.id && !p.done && p.paneId === claude) N.permissions.answer(p.id, 'once');
  });
  const readyAt = await until(async () => {
    const ask = (await N.trust?.pending?.())?.find(a => !a.paneId || a.paneId === claude);
    if (ask) {
      await N.trust.answer(ask.id, true);
      return false;
    }
    const raw = await screen(claude),
      text = raw.replace(/\s+/g, ' ');
    if (
      /trust the files in this folder|project you created or one you trust|Trust this folder\?/i.test(
        text
      )
    ) {
      // Enter only once "Yes" is selected
      const sel = raw.split('\n').find(r => /^\s*[❯›]/.test(r)) || '';
      N.pty.write(claude, /Yes/i.test(sel) ? '\r' : '\x1b[B');
      await wait(1200);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle/i.test(text) && !/esc to interrupt/i.test(text);
  }, 60000);
  check(
    !!readyAt,
    'Claude Code ready' +
      (readyAt
        ? ''
        : ' · screen: ' +
          (await screen(claude))
            .split('\n')
            .map(l => l.trimEnd())
            .filter(Boolean)
            .slice(-10)
            .join(' ⏎ ')
            .slice(-600))
  );
  await wait(2500);
  const loadsBefore = loads();
  check(
    G.send(
      claude,
      'In src/App.jsx change the heading text "Get started" to "Hello from the agent". Use the Edit tool once. Change nothing else, run nothing, and reply "done".'
    ),
    'edit task sent'
  );
  window.TnaiLivePreviewPage.open();
  await wait(300);
  const heading = await until(() => markers.includes('h1:Hello from the agent'), 120000);
  check(!!heading, 'page shows the new heading "Hello from the agent"');
  const note = await until(() => {
    const t = lp.querySelector('.lpp-stage .lp-state span')?.textContent || '';
    return /^Updated · /.test(t) ? t : null;
  }, 5000);
  const name = G.sessions().find(s => s.paneId === claude)?.name || '';
  check(
    !!note && note.includes(name + ' edited App.jsx'),
    'note names the agent: "' + note + '" (agent ' + name + ')'
  );
  await shot('real-vite-preview');
  await wait(2500);
  check(
    loads() === loadsBefore,
    'Vite updated the page itself: no full reload (' +
      loadsBefore +
      ' → ' +
      loads() +
      ' page loads)'
  );
  check(
    /Hello from the agent/.test(await main('read', 'src/App.jsx')),
    'App.jsx really changed on disk'
  );
  await until(() => window.TnaiTurns?.get(claude)?.endedAt, 60000);
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
try {
  offPerm?.();
} catch {}
try {
  if (claude) await G.stop?.(claude);
} catch {}
try {
  if (server) await window.TnaiLivePreview.stop(server.id);
} catch {}

// Let the panels finish closing: exiting the app mid-teardown crashed it (0xC0000409) after RESULT:
// PASS.
await until(() => !G.sessions().some(s => s.running), 8000);
await wait(300);
return { ok, log };
