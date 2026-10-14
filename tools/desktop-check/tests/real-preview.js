/*
 * Technically Not tools · desktop-check/tests/real-preview.js — A REAL Claude Code agent (Haiku, a
 * few cents of the user's usage) follows the built-in Live preview rule
 * (desktop/hidden-skills/45-live-preview.md) without being told about it: asked to build a small
 * web page and show it, it must start a dev server and run `tnai preview`, not open an external
 * browser. The user is on the Terminal page, so the preview arrives as a bell notice with Open
 * (31). Permission questions are answered Yes in the pane. Hard cap: 5 min.
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
    await wait(250);
  }
  return null;
};
const G = window.TnaiAgents,
  N = window.tnaiNative;
let paneId = '';

async function screen(all = false) {
  const r = await N.pty.replay(paneId);
  if (!r?.buffer) return [];
  const vt = new window.Terminal({
    cols: r.cols || 120,
    rows: r.rows || 30,
    scrollback: 4000,
    allowProposedApi: true,
  });
  await new Promise(done => vt.write(r.buffer, done));
  const b = vt.buffer.active,
    rows = [];
  for (let y = all ? 0 : b.baseY; y < (all ? b.length : b.baseY + vt.rows); y++)
    rows.push(b.getLine(y)?.translateToString(true) || '');
  vt.dispose();
  return rows;
}
const tail = rows => rows.slice(-30).join('\n');

// Answers the folder-trust and tool-permission questions with Yes; true once Claude Code waits for
// a prompt.
const answer = async () => {
  if (!G.sessions().find(s => s.paneId === paneId)?.running)
    throw new Error('Claude Code exited: ' + tail(await screen()).slice(-400));
  const rows = await screen(),
    text = rows.join('\n'); // the visible screen only: answered questions stay in the scrollback
  if (
    /project you created or one you trust|trust the files in this folder|Do you want to /i.test(
      text
    )
  ) {
    // the selected option ("❯ No, exit" is the trust question's default)
    const sel = rows.find(r => r.includes('❯') && /Yes|No\b/i.test(r)) || '';
    N.pty.write(paneId, /Yes/i.test(sel) ? '\r' : '\x1b[B');
    await wait(900);
    return 'asked';
  }
  return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text) &&
    !/Esc to interrupt/i.test(text)
    ? 'ready'
    : '';
};
const ready = () => until(async () => (await answer()) === 'ready', 60000);
const send = async text => {
  const p = document.getElementById('prompt');
  p.value = text;
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  document.getElementById('send').click();
};

try {
  paneId = (await window.TnaiTest.open('Claude Code')).paneId;
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === paneId && s.running), 20000)),
    'Claude Code started'
  );
  check(!!(await ready()), 'Claude Code is ready for a prompt');
  G.send(paneId, '/model haiku');
  await wait(2500);
  check(!!(await ready()), 'switched to Haiku');

  const agentSel = document.querySelector('.tnai-pickers select');
  const opt = [...(agentSel?.options || [])].find(o => o.value.includes(paneId));
  if (opt) {
    agentSel.value = opt.value;
    agentSel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // No mention of Live preview or `tnai preview`: the built-in rule has to bring it in.
  await send(
    'Build a tiny one-page to-do list website in this folder (index.html plus a package.json whose "dev" script serves it with a small Node http server, no dependencies to install). Start it and show it to me so I can try it.'
  );

  const bellNotice = () =>
    [...document.querySelectorAll('[data-item]')].find(x =>
      x.textContent.includes('Preview ready')
    );
  const shown = await until(async () => {
    await answer();
    return window.TnaiLivePreview.tabs().find(t => t.by) || null;
  }, 240000);
  const rows = await screen(true),
    text = rows.join('\n');
  check(/tnai preview/i.test(text), 'the agent ran `tnai preview` on its own');
  check(
    !!shown,
    "Live preview got the agent's page: " +
      JSON.stringify(
        window.TnaiLivePreview.tabs().map(t => ({ url: t.url, by: t.by, state: t.state }))
      )
  );
  check(
    !/Start-Process\s+["']?https?:|\bstart\s+["']?https?:|explorer(\.exe)?\s+["']?https?:|(xdg-)?open\s+["']?https?:/i.test(
      text
    ),
    'no external browser was opened'
  );
  window.TnaiNextActions.openBell();
  await wait(300);
  const item = bellNotice();
  check(
    !!item || window.TnaiLivePreviewPage.visible(),
    'on the Terminal page it arrives as a bell notice "Preview ready" (or the page was already showing a preview)'
  );
  console.log('TNAI_SHOT:real-preview-bell');
  await wait(450);
  const openBtn = item?.querySelector('[data-act=notice]');
  if (item && !openBtn) item.querySelector('[data-act=expand]')?.click();
  await wait(150);
  item?.querySelector('[data-act=notice]')?.click();
  await wait(800);
  check(
    window.TnaiLivePreviewPage.visible() &&
      !!window.TnaiLivePreview.tabs().find(t => t.active && t.by),
    "Open shows the agent's page in Live preview"
  );
  console.log('TNAI_SHOT:real-preview-shown');
  await wait(450);
  log.push('     pane tail: ' + tail(rows).replace(/\s+/g, ' ').slice(-600));
} catch (error) {
  check(false, 'stopped: ' + error.message);
}
if (paneId) {
  G.stop(paneId);
  await wait(800);
}
return { ok, log };
