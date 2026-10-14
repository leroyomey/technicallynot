/*
 * Technically Not tools · desktop-check/tests/real-intervene.js — `tnai intervene` and Summarize
 * first on REAL agent CLIs (Claude Code on Haiku, Codex on its cheapest model; a few cents of the
 * user's usage). For each CLI: a long no-tools answer is started, a PowerShell panel runs `tnai
 * intervene NAME message` while it writes, the sender is told "Interrupted", the CLI stops its
 * answer, and the message arrives as its own prompt (marked "interrupted you on purpose") and is
 * answered. A second interrupt right after is refused (2-minute gap). Then, on Claude Code:
 * automatic compacting with Summarize first at a tiny size: the summary prompt is sent, and
 * /compact runs only after that reply ended. Answers the folder-trust questions for the throwaway
 * project. Hard cap ~6 min.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true,
  current = '';
const G = window.TnaiAgents,
  N = window.tnaiNative,
  U = window.TnaiContextUpkeep;

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

// everything the panel ever printed (the screen scrolls)
const raw = async paneId => String((await N.pty.replay(paneId))?.buffer || '');
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

// run with TNAI_CHECK_LIMIT_MS=680000 // the whole test gives up waiting here, so its log is still
// returned before the runner's limit
const END = Date.now() + 600000;
const until = async (fn, ms = 15000) => {
  const end = Math.min(Date.now() + ms, END);
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};

async function openPane(provider) {
  const opened = await window.TnaiTest.open(provider);
  if (!opened.paneId) throw new Error('no new thread: ' + (opened.error || 'no reason'));
  return opened.paneId;
}
let idleSince = 0;

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
    return Date.now() - idleSince > 2500;
  }, 60000)
);
const turn = paneId => window.TnaiTurns?.get(paneId) || null;
const LONG =
  'Without using any tools, write a 2500-word story about a lighthouse keeper, in plain paragraphs, then write FINISHED-COUNT on its own line.';
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
const started = [],
  SUMMARIZE = true;

// One CLI: start the long answer, interrupt it from the PowerShell panel S, and see what the CLI
// does with the message.
async function trial(S, paneId, who, idle, nth, fixedMs = 0) {
  current = paneId;
  const name = G.sessions().find(s => s.paneId === paneId)?.name;
  const d0 = await main('draft', paneId);
  log.push(
    '     ' +
      who +
      ': keys the app counted as typed before the prompt: ' +
      JSON.stringify(await main('typed', paneId)).slice(0, 500)
  );
  const len0 = (await raw(paneId)).length;
  G.send(paneId, LONG);
  const running = await until(async () => {
    const t = turn(paneId);
    return (t?.startedAt && !t.endedAt) || /esc to interrupt/i.test(await screen(paneId));
  }, 30000);
  await check(!!running, who + ': the long answer is running');
  const shown = async () =>
    // the first words of the story are on screen: a stop now pauses the task
    /[●⏺•]\s*(?:\x1b\[[0-9;]*m)*\s*[A-Z][a-z]+ [a-z]/.test((await raw(paneId)).slice(len0));

  // Claude Code on Haiku can show the whole story only at its end, so waiting for text interrupts
  // an idle agent: interrupt it a fixed 8 s after the prompt instead. Both outcomes are valid there
  // ("Interrupted NAME" or "had only just started its task").
  const writing = fixedMs ? (await wait(fixedMs), await shown()) : await until(shown, 60000);
  log.push(
    '     ' +
      who +
      ': story on screen before the interrupt: ' +
      !!writing +
      (fixedMs
        ? ' (interrupted a fixed ' +
          fixedMs / 1000 +
          ' s after the prompt); still working: ' +
          !!(turn(paneId)?.startedAt && !turn(paneId)?.endedAt)
        : '')
  );
  log.push(
    '     ' +
      who +
      ': draft tracked before the prompt: ' +
      d0 +
      ', while it works: ' +
      (await main('draft', paneId)) +
      '; turn task: ' +
      JSON.stringify(String(turn(paneId)?.task || '').slice(0, 60))
  );
  const before = (await raw(paneId)).length;
  const tWrite = Date.now();
  N.pty.write(
    S,
    'tnai intervene "' + name + '" The count is cancelled. Reply with exactly one word: pong\r'
  );
  current = S;
  const told = await until(async () => {
    const out = await raw(S);
    return out.split('Interrupted ' + name).length > 1
      ? 'stopped'
      : out.includes(name + ' had only just started its task')
        ? 'early'
        : null;
  }, 30000);
  await check(
    !!told,
    who +
      ': the sender is told what happened (' +
      (told === 'early'
        ? 'it had written nothing yet: task started again, message typed in'
        : 'interrupted ' + name) +
      ')'
  );
  if (told === 'early') {
    log.push(
      '     ' + who + ': the pause of a task that had begun its reply was not tried in this run'
    );
    await until(
      async () =>
        idle.test(await screen(paneId)) && !/esc to interrupt/i.test(await screen(paneId)),
      120000
    );
    return;
  }
  current = paneId;
  const got = await until(async () => {
    const t = turn(paneId);
    if (t?.task && /interrupted you on purpose/.test(t.task)) return 'turn';
    return /interrupted you on purpose/.test((await raw(paneId)).slice(before)) ? 'screen' : null;
  }, 25000);
  await check(
    !!got,
    who + ': the message arrived as its own prompt after the interrupt (' + got + ')'
  );
  const answered = await until(async () => {
    const t = turn(paneId);
    if (t?.endedAt && /pong/i.test(t.result || '')) return 'turn result';
    return /^\s*\S\s*pong\s*$/im.test(await screen(paneId)) &&
      !/esc to interrupt/i.test(await screen(paneId))
      ? 'screen'
      : null;
  }, 90000);
  log.push(
    '     ' +
      who +
      ': written to its terminal from the interrupt on: ' +
      JSON.stringify(await main('written', paneId, tWrite)).slice(0, 700)
  );
  await wait(1500);
  {
    const t = turn(paneId) || {};
    log.push(
      '     ' +
        who +
        ': its turn as the app sees it: ' +
        JSON.stringify({
          task: String(t.task || '').slice(0, 50),
          ended: !!t.endedAt,
          endedBy: t.endedBy,
          queued: (t.queued || []).map(q => String(q.text || '').slice(0, 40)),
          result: String(t.result || '').slice(0, 40),
        })
    );
  }
  await check(
    !!answered,
    who +
      ': it answered the interrupting message (' +
      answered +
      '); turn task ' +
      JSON.stringify(String(turn(paneId)?.task || '').slice(0, 80)) +
      ', result ' +
      JSON.stringify(turn(paneId)?.result || '').slice(0, 120)
  );
  await check(
    !/FINISHED-COUNT\s*$/m.test(
      (await raw(paneId)).slice(before).replace(/then write FINISHED-COUNT/g, '')
    ) || /pong/i.test(turn(paneId)?.result || ''),
    who + ': the count was stopped, not run to its end first'
  );
  const sLen = (await raw(S)).length;
  N.pty.write(S, 'tnai intervene "' + name + '" again\r');
  current = S;
  await check(
    !!(await until(
      async () => (await raw(S)).slice(sLen).includes('less than 2 min ago'),
      15000
    )) ||
      !!(await until(
        async () => /is not working on a task/.test((await raw(S)).slice(sLen)),
        3000
      )),
    who + ': a second interrupt right away is refused or sent as a normal message'
  );
  current = paneId;
  await until(
    async () => idle.test(await screen(paneId)) && !/esc to interrupt/i.test(await screen(paneId)),
    60000
  );
}

try {
  const S = (await window.TnaiTest.open('Terminal'))?.paneId;
  started.push(S);
  current = S;
  await check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );

  // ---- Claude Code on Haiku ----
  const idleC =
    /\? for shortcuts|shift\+tab to cycle|manual mode on|bypass permissions|accept edits/i;
  window.TnaiLaunchPrefs?.once('Claude Code', { model: 'claude-haiku-4-5-20251001' });
  const C = (current = await openPane('Claude Code'));
  started.push(C);
  await check(
    !!(await until(() => G.sessions().find(s => s.paneId === C && s.running), 20000)),
    'Claude Code started'
  );
  await check(!!(await ready(C, idleC)), 'Claude Code ready for input');
  await trial(S, C, 'Claude', idleC, 1, 8000);

  if (SUMMARIZE) {
    // ---- Summarize first, on the same Claude Code ----
    // A plain turn first: with no report block, Project Context reads blockers out of words like
    // "failed" or "broken" (agent-context.js), a story has them, and context upkeep never compacts
    // while the last result has open blockers (seen 2026-10-01: "its last result has open
    // blockers").
    await until(() => turn(C)?.endedAt, 60000);
    G.send(C, 'Reply with exactly one word: ready');
    await check(
      !!(await until(
        () => turn(C)?.endedAt && /^\s*ready\W*$/i.test(turn(C)?.result || ''),
        60000
      )),
      'Claude: a plain turn ended before Summarize first (' +
        JSON.stringify(String(turn(C)?.result || '').slice(0, 40)) +
        ')'
    );
    await check(
      !!(await until(() => turn(C)?.endedAt && turn(C)?.context?.tokens, 120000)),
      'Claude: the finished turn carries a context size (' +
        (turn(C)?.context?.tokens || 0) +
        ' tokens)'
    );
    const beforeC = (await raw(C)).length;
    U.set({ on: true, auto: 'compact', brief: true, compact: 1000 });
    const asked = await until(
      () =>
        U.briefing().find(b => b.paneId === C) ||
        (/after it wrote its summary/.test(window.TnaiLiveTasks?.get(C)?.text || '')
          ? 'done already'
          : null),
      240000
    );
    await check(
      !!asked,
      'Summarize first: the summary prompt was sent before /compact (' +
        JSON.stringify(window.TnaiLiveTasks?.get(C)?.text || '').slice(0, 140) +
        ')'
    );
    if (!asked)
      log.push(
        '     Summarize first did not start; context upkeep says: ' +
          JSON.stringify(U.why?.(C)) +
          ' (the later waits are skipped so the Codex trial still runs)'
      );
    const compacted =
      asked &&
      (await until(
        () => /after it wrote its summary/.test(window.TnaiLiveTasks?.get(C)?.text || ''),
        150000
      ));
    await check(
      !!compacted,
      'Summarize first: /compact ran after the summary reply ended: ' +
        JSON.stringify(window.TnaiLiveTasks?.get(C)?.text || '').slice(0, 200)
    );
    const summary = turn(C)?.result || '';
    log.push('     summary reply (start): ' + JSON.stringify(summary.slice(0, 300)));
    const shown =
      asked &&
      (await until(
        async () =>
          /compact/i.test((await raw(C)).slice(beforeC)) &&
          /Compacted|Conversation compacted|compact summary/i.test((await raw(C)).slice(beforeC)),
        120000
      ));
    await check(
      !!shown,
      'Summarize first: Claude Code itself shows the conversation was compacted'
    );
    U.set({ auto: '', compact: 400000 });
  }
  G.stop(C);

  // ---- Codex on its cheapest model ----
  const idleX = /context left|\? for shortcuts/i;
  window.TnaiLaunchPrefs?.once('Codex', { model: 'gpt-6-luna', effort: 'low' });
  const X = (current = await openPane('Codex'));
  started.push(X);
  await check(
    !!(await until(() => G.sessions().find(s => s.paneId === X && s.running), 20000)),
    'Codex started'
  );
  await check(!!(await ready(X, idleX)), 'Codex ready for input');
  await trial(S, X, 'Codex', idleX, 2);
} catch (error) {
  await check(false, 'error: ' + (error.stack || error.message));
}
console.log('TNAI_SHOT:real-intervene');
await wait(800);
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
