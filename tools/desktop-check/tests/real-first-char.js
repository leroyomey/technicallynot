/*
 * Technically Not tools · desktop-check/tests/real-first-char.js — What a REAL agent CLI does with
 * a pasted prompt whose first character is "/" or "!" (the
 * rule "a prompt from another computer starts with a
 * word" rests on this). One CLI per run, named in TNAI_PROBE_CLI: claude (on Haiku), codex
 * (cheapest model, low effort), cursor, opencode (a free model, else it stops). It starts the CLI,
 * waits for its input, and puts "/help" and then "!echo tnai-probe-1" in through the app's own
 * submit with paste on (prompt-submit.js). No other prompt is sent. A probe, not a pass or fail:
 * the log says, per text, what submit answered, how many Enters it pressed, whether a task started,
 * whether the echo's output shows without the word "echo" before it (the shell ran it), and the
 * screen 1.5 s after the paste and at the end. A CLI that never reaches its input is said so. About
 * 2 min per CLI. Run it after a CLI update that changes its shell mode or its commands:
 * $env:TNAI_PROBE_CLI='codex'; node tools/desktop-check/check.js real-first-char
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const G = window.TnaiAgents,
  N = window.tnaiNative;

// The panel's own terminal view when it has one (what the user sees), else its saved output
// replayed at the pty's size.
async function screen(paneId) {
  const view = G.views().find(v => v.paneId === paneId)?.term;
  if (view) {
    const b = view.buffer.active,
      rows = [];
    for (let y = 0; y < view.rows; y++)
      rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
    return rows.join('\n');
  }
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
const tail = async (paneId, n = 22) =>
  (await screen(paneId))
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim())
    .slice(-n)
    .join(' / ');
const note = text => log.push('       ' + text);
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(200);
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

// Ready for input: answers Technically Not's and the CLI's own folder-trust questions on the way,
// and skips (never accepts) an update offer and Codex's "Hooks need review".
let idleSince = 0;
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
    if (/Update available|Hooks need review/i.test(text) && /esc skip/i.test(text)) {
      N.pty.write(paneId, '\x1b');
      await wait(1500);
      return false;
    }
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
    return Date.now() - idleSince > 2500;
  }, 70000)
);
const CLIS = {
  claude: {
    provider: 'Claude Code',
    prefs: { model: 'claude-haiku-4-5-20251001' },
    idle: /\? for shortcuts|shift\+tab to cycle|manual mode on|bypass permissions|accept edits/i,
  },
  codex: {
    provider: 'Codex',
    prefs: { model: 'gpt-6-luna', effort: 'low' },
    idle: /context left|\? for shortcuts/i,
    clear: '\x03',
  }, // Ctrl+U left a refused command in Codex's input; Ctrl+C empties it
  cursor: {
    provider: 'Cursor Agent',
    prefs: null,
    idle: /Add a follow-up|Plan, search, build anything/i,
  },
  opencode: { provider: 'OpenCode', prefs: 'free', idle: /ctrl\+p commands/i },
};
const started = [];
try {
  const which = await main('which'),
    cli = CLIS[which];
  if (!cli) throw new Error('set TNAI_PROBE_CLI to one of: ' + Object.keys(CLIS).join(', '));
  const found =
    ((await N.agents.detect().catch(() => null)) || []).find?.(
      a => a.name === cli.provider || a.id === cli.provider
    ) || null;
  note(
    cli.provider +
      ' as the app detects it: ' +
      JSON.stringify(found, (k, v) =>
        typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v
      ).slice(0, 400)
  );
  let prefs = cli.prefs;
  if (prefs === 'free') {
    const id = await main('pick');
    if (!id) throw new Error('OpenCode lists no free model: nothing started, no prompt sent');
    prefs = { model: id };
    note('free model: ' + id);
  }
  if (prefs) window.TnaiLaunchPrefs?.once(cli.provider, prefs);
  const P = await openPane(cli.provider);
  started.push(P);
  const runs = await until(() => G.sessions().find(s => s.paneId === P && s.running), 25000);
  if (!runs) {
    log.push('FAIL ' + cli.provider + ' did not start');
    ok = false;
  } else if (!(await ready(P, cli.idle))) {
    log.push(
      'NOTE ' +
        cli.provider +
        ' did not reach its input within 70 s (not signed in, or a start question this probe does not answer)'
    );
    note('screen: ' + (await tail(P)).slice(-900));
  } else {
    log.push('ok   ' + cli.provider + ' reached its input');
    note('idle screen: ' + (await tail(P, 8)).slice(-400));
    for (const text of ['/help', '!echo tnai-probe-1']) {
      const before = window.TnaiTurns?.get(P),
        run = main('submit', P, text).catch(e => ({ error: e.message })),
        t0 = Date.now();
      await wait(1500);
      const early = await tail(P);
      const result = await Promise.race([
        run,
        wait(45000).then(() => ({ state: 'no answer in 45 s' })),
      ]);
      await wait(2500);
      const late = await tail(P),
        full = await screen(P),
        did = await main('did', P).catch(() => null),
        turn = window.TnaiTurns?.get(P);
      const task =
        turn && turn.startedAt !== before?.startedAt
          ? String(turn.task || '(a task with no text)').slice(0, 80)
          : '';
      const lines = full.split('\n').filter(l => l.includes('tnai-probe-1'));
      log.push(
        'PROBE ' +
          cli.provider +
          ' ← ' +
          JSON.stringify(text) +
          ': submit said ' +
          (result?.state || JSON.stringify(result)) +
          ' after ' +
          (Date.now() - t0 - 2500) +
          ' ms, Enters pressed ' +
          (did?.enters ?? '?') +
          (did?.stop ? ' (stopped by: ' + did.stop + ')' : '') +
          '; a task started: ' +
          (task ? 'YES "' + task + '"' : 'no') +
          (text[0] === '!'
            ? '; lines with the probe word: ' +
              lines.length +
              ', of them without "echo" (command output): ' +
              lines.filter(l => !/echo/.test(l)).length
            : '')
      );
      note('screen 1.5 s after the paste: ' + early.slice(-700));
      note('screen at the end: ' + late.slice(-900));
      if (task) await until(() => window.TnaiTurns?.get(P)?.endedAt, 40000);
      N.pty.write(P, '\x1b');

      // leave a dialog or a mode it opened (one Esc; two would open Claude Code's Rewind)
      await wait(1200);
      N.pty.write(P, cli.clear || '\x15');

      // and empty the input (seen 2026-10-09 with Codex: text left there is sent together with the
      // next paste)
      await wait(800);
      note('screen after Esc and the clear key: ' + (await tail(P, 8)).slice(-400));
    }
  }
} catch (error) {
  log.push('FAIL error: ' + (error.stack || error.message));
  ok = false;
}
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
