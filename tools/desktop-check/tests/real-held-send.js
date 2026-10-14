/*
 * Technically Not tools · desktop-check/tests/real-held-send.js — A `tnai send` message held while
 * the user has unsent text in a REAL agent CLI's input (Claude Code on Haiku, Codex on its cheapest
 * model; one one-word prompt each, a few cents of the user's usage). For each CLI: the draft
 * Technically Not tracks from the keys (attention-service.js) must match what the CLI really does
 * with its own clear keys (checked on the CLI's screen), a message sent from a PowerShell panel
 * with `tnai send` is held (sender told "Queued", nothing typed into the text), and once the CLI's
 * own clear key empties the input the message arrives alone. Claude Code: Esc Esc, Ctrl+S stash /
 * restore, Ctrl+U. Codex: Esc Esc does NOT clear, Ctrl+U deletes only the last line, Ctrl+C clears.
 * Answers the folder-trust questions for the throwaway project. Hard cap ~4 min.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true,
  current = '';
const G = window.TnaiAgents,
  N = window.tnaiNative;

// What the panel shows now: its output replayed into a scratch terminal of the same size.
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
const tail = async paneId =>
  (await screen(paneId))
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .slice(-12)
    .join(' ⏎ ');
const check = async (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) {
    ok = false;
    if (current) log.push('       screen: ' + (await tail(current)).slice(-700));
  }
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

async function openPane(provider) {
  const opened = await window.TnaiTest.open(provider);
  if (!opened.paneId) throw new Error('no new thread: ' + (opened.error || 'no reason'));
  return opened.paneId;
}

// Ready for input: answers Technically Not's and the CLI's own folder-trust questions on the way.
const ready = (paneId, idle) => (
  (idleSince = 0),
  until(async () => {
    const ask = (await N.trust?.pending?.())?.find(a => !a.paneId || a.paneId === paneId);
    if (ask) {
      await N.trust.answer(ask.id, true);
      return false;
    }
    const text = await screen(paneId),
      rows = text.split('\n');
    if (/Update available/i.test(text) && /esc skip/i.test(text)) {
      N.pty.write(paneId, '\x1b');
      await wait(1500);
      return false;
    } // Codex update offer: skip, never update
    if (
      /trust the files in this folder|project you created or one you trust|trust the contents of this directory|Trust this folder\?/i.test(
        text.replace(/\s+/g, ' ')
      )
    ) {
      const sel = rows.find(r => /^\s*[❯›]/.test(r)) || '';
      N.pty.write(paneId, /Yes|Trust and continue/i.test(sel) ? '\r' : '\x1b[B');
      await wait(1200);
      return false;
    }
    if (
      !idle.test(text) ||
      /esc to interrupt|enter to confirm|enter continue|esc skip/i.test(text)
    ) {
      idleSince = 0;
      return false;
    }
    idleSince = idleSince || Date.now();

    // idle and staying idle (a start-up dialog can draw over the input box a moment later)
    return Date.now() - idleSince > 2500;
  }, 60000)
);
let idleSince = 0;
const key = async (paneId, data, ms = 700) => {
  N.pty.write(paneId, data);
  await wait(ms);
};
const shows = async (paneId, s) => (await screen(paneId)).includes(s);
const draft = paneId => main('draft', paneId);
const started = [];

try {
  const S = (await window.TnaiTest.open('Terminal'))?.paneId;
  started.push(S);
  current = S;
  await check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );

  // ---- Claude Code on Haiku ----
  window.TnaiLaunchPrefs?.once('Claude Code', { model: 'claude-haiku-4-5-20251001' });
  const C = (current = await openPane('Claude Code'));
  started.push(C);
  await check(
    !!(await until(() => G.sessions().find(s => s.paneId === C && s.running), 20000)),
    'Claude Code started'
  );
  await check(
    !!(await ready(
      C,
      /\? for shortcuts|shift\+tab to cycle|manual mode on|bypass permissions|accept edits/i
    )),
    'Claude Code ready for input'
  );
  await key(C, 'alpha beta');
  await check(
    (await shows(C, 'alpha beta')) && (await draft(C)),
    'Claude: typed text is in its input and tracked as a draft'
  );
  await key(C, '\x1b', 150);
  await key(C, '\x1b', 900);
  await check(
    !(await shows(C, 'alpha beta')) && !(await draft(C)),
    'Claude: Esc Esc clears the input, and the draft is empty'
  );
  await key(C, 'gamma delta');
  await key(C, '\x13');
  const stashed = !(await shows(C, 'gamma delta'));
  await check(
    stashed && !(await draft(C)),
    'Claude: Ctrl+S stashes (input empty on screen: ' +
      stashed +
      ', draft: ' +
      (await draft(C)) +
      ')'
  );
  await key(C, '\x13');
  await check(
    (await shows(C, 'gamma delta')) && (await draft(C)),
    'Claude: Ctrl+S on the empty input brings it back, draft back too'
  );
  await key(C, '\x15');
  await check(
    !(await shows(C, 'gamma delta')) && !(await draft(C)),
    'Claude: Ctrl+U on one line clears it'
  );
  await key(C, 'epsilon words');
  const nameC = G.sessions().find(s => s.paneId === C)?.name;
  N.pty.write(S, 'tnai send "' + nameC + '" Reply with exactly one word: pong\r');
  current = S;
  await check(
    !!(await until(() => shows(S, 'Queued for'), 15000)),
    'sender told the message is queued for Claude (unsent text in its input)'
  );
  current = C;
  await wait(2500);
  await check(
    !(await shows(C, 'exactly one word')) && (await shows(C, 'epsilon words')),
    'Claude: nothing typed into the half-typed input'
  );
  await key(C, '\x1b', 150);
  await key(C, '\x1b', 300);
  const tC = await until(() => {
    const t = window.TnaiTurns?.get(C);
    return t?.task && /pong/.test(t.task) ? t : null;
  }, 20000);
  await check(
    !!tC && !/epsilon/.test(tC.task),
    'Claude: after Esc Esc the held message arrives alone: ' +
      JSON.stringify(tC?.task || '').slice(0, 120)
  );
  await check(!!(await until(() => window.TnaiTurns?.get(C)?.endedAt, 60000)), 'Claude answered');
  G.stop(C);

  // ---- Codex on its cheapest model ----
  window.TnaiLaunchPrefs?.once('Codex', { model: 'gpt-6-luna', effort: 'low' });
  const X = (current = await openPane('Codex'));
  started.push(X);
  await check(
    !!(await until(() => G.sessions().find(s => s.paneId === X && s.running), 20000)),
    'Codex started'
  );
  await check(!!(await ready(X, /context left|\? for shortcuts/i)), 'Codex ready for input');
  await key(X, 'alpha beta');
  await check(
    (await shows(X, 'alpha beta')) && (await draft(X)),
    'Codex: typed text is in its input and tracked as a draft'
  );
  await key(X, '\x1b', 150);
  await key(X, '\x1b', 900);
  const kept = await shows(X, 'alpha beta');
  await check(
    kept && (await draft(X)),
    'Codex: Esc Esc leaves its input alone (on screen: ' +
      kept +
      '), draft kept (' +
      (await draft(X)) +
      ')'
  );
  if (!kept) {
    await key(X, '\x1b', 900);
    await key(X, 'alpha beta');
  }
  await key(X, '\x1b\r', 300);
  await key(X, 'second line');
  await key(X, '\x15');
  await check(
    !(await shows(X, 'second line')) && (await shows(X, 'alpha beta')) && (await draft(X)),
    'Codex: Ctrl+U deletes only the last line, draft kept'
  );
  const nameX = G.sessions().find(s => s.paneId === X)?.name;
  N.pty.write(S, 'tnai send "' + nameX + '" Reply with exactly one word: pong\r');
  current = S;
  await check(
    !!(await until(async () => (await screen(S)).split('Queued for').length > 2, 15000)),
    'sender told the message is queued for Codex'
  );
  current = X;
  await wait(2500);
  await check(
    !(await shows(X, 'exactly one word')) && (await shows(X, 'alpha beta')),
    'Codex: nothing typed into the half-typed input'
  );
  await key(X, '\x03', 300);
  const arrived = await until(async () => {
    const t = window.TnaiTurns?.get(X);
    if (t?.task && /pong/.test(t.task)) return t.task;
    return /exactly one word: pong/.test(await screen(X)) ? 'screen' : null;
  }, 20000);
  await check(
    !!arrived && !/alpha beta/.test(window.TnaiTurns?.get(X)?.task || ''),
    'Codex: after Ctrl+C the held message arrives alone (' + String(arrived).slice(0, 80) + ')'
  );
  await until(() => window.TnaiTurns?.get(X)?.endedAt, 45000);
  await check((await main('held')).length === 0, 'nothing left held');
} catch (error) {
  await check(false, 'error: ' + (error.stack || error.message));
}
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
