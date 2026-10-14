/*
 * Technically Not tools · desktop-check/tests/real-opencode.js — ONE REAL OpenCode agent on a free
 * OpenCode Zen model (opencode/big-pickle, else a *-free id; the test stops before any prompt when
 * OpenCode lists none, and stops sending when a reply names another model), in the test app's
 * throwaway project folder. Three tiny prompts (the third is the note after the interrupt) and one
 * /compact, no cost. It prints what the app saw at each step: 1 `tnai new opencode --model …` from
 * a PowerShell panel: panel opened, task on OpenCode's screen, the app showing it working (times);
 * the ready signal (OpenCode listing Technically Not's tools) and the launch config naming
 * work-rules-opencode.md, as a lead; 2 the task ("create hello.txt containing hi, then say done")
 * ends: ended by stop, result text, tokens, a tool step, the edited file noted; 3 the panel's
 * Compact button: /compact is taken by OpenCode as its command, not sent as a message; 4 a second
 * task interrupted the way `tnai intervene` does it (OpenCode's own stop call, else Esc twice, then
 * the note) ends as interrupted within seconds; 5 Usage data holds OpenCode rows afterwards, and
 * more than before. Use after changing OpenCode in desktop/agent-registry.js, opencode-store.js,
 * readOpenCode in agent-turns.js, onStep / stepPlugin in agent-hooks.js, 41-pane-compact.js, or
 * when an OpenCode update is flagged. Not in the full run unless asked for. About 1.5 minutes. Seen
 * 2026-10-06 (OpenCode 1.18.35): one Esc only brings up "esc again to interrupt"; two presses 300
 * ms apart end the task, which is what `tnai intervene` sends for OpenCode since then
 * (desktop/agent-mesh.js). The user's Intervene button (14) was removed 2026-10-07; step 4 sends
 * the same keys itself.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const G = window.TnaiAgents,
  N = window.tnaiNative;
const FREE = /^opencode\/(big-pickle|.*-free)$/;

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
const flat = async paneId => (await screen(paneId)).replace(/\s+/g, ' ');
const tail = async (paneId, n = 16) =>
  (await screen(paneId))
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim())
    .slice(-n)
    .join(' / ');
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
};
const note = text => log.push('       ' + text);
const until = async (fn, ms = 15000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(step);
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
const trust = async () => {
  for (const ask of (await N.trust?.pending?.()) || []) await N.trust.answer(ask.id, true);
};
const sessionOf = paneId => G.sessions().find(s => s.paneId === paneId);
const statusOf = paneId => sessionOf(paneId)?.status;
const turnOf = paneId => window.TnaiTurns?.get(paneId);

// Step 4's interrupt, as `tnai intervene` does it for OpenCode (desktop/agent-mesh.js): its own
// stop call, else Esc twice 300 ms apart, then the note.
const stopThenSend = async (paneId, text) => {
  const stopped = await main('stop', paneId).catch(() => false);
  if (!stopped) {
    N.pty.write(paneId, '\x1b');
    await wait(300);
    const now = sessionOf(paneId),
      turn = turnOf(paneId);
    if (
      now?.running &&
      now.status !== 'needs-you' &&
      (turn ? !turn.endedAt : now.status === 'working')
    )
      N.pty.write(paneId, '\x1b');
  }
  await wait(350);
  return !!G.send(
    paneId,
    '[Intervention — stop. I interrupted you on purpose.] Fix this first: ' +
      text +
      '. Then continue the original task from where you stopped.'
  );
};
const J = v => JSON.stringify(v);

// OpenCode rows of the Usage data: the per-model rows and the source line.
const usageOf = stats => {
  const rows = (stats?.models || []).filter(m => m.cli === 'opencode');
  return {
    rows: rows.length,
    turns: rows.reduce((n, m) => n + (m.turns || 0), 0),
    tokens: rows.reduce((n, m) => n + (m.tokens || 0), 0),
    source: (stats?.sources || []).find(s => s.cli === 'opencode') || null,
    sample: rows.slice(0, 3).map(m => m.model + ' ' + m.turns + ' turns'),
  };
};
const started = [];
let prompts = 0;
try {
  window.TnaiRoute('terminal');
  await wait(400);

  // $env:TNAI_OC_ONLY='interrupt' before the run: only the start (steps 1 and 6), the interrupt (4)
  // and Usage (5), two prompts in all.
  const mode = await main('mode'),
    extra = mode === 'extra',
    only = mode === 'interrupt' || extra,
    mark = only ? /300/ : /hello\.txt/;
  const LONG =
    'Use no tools. Write the numbers from 1 to 300, one per line, each followed by a short sentence about that number.';
  if (only)
    note(
      'TNAI_OC_ONLY=' +
        mode +
        ': steps 2 and 3 are left out' +
        (extra ? '; after the interrupt: Deny, a helper sub-agent, a file lock, a real lead' : '')
    );
  const pick = await main('pick');
  if (
    !check(
      FREE.test(pick.id),
      'a free OpenCode model is listed: ' +
        (pick.id || 'none') +
        ' (' +
        pick.listed +
        ' models, free: ' +
        pick.free.join(', ') +
        ')'
    )
  )
    throw new Error('no free model: no prompt sent');
  const before = usageOf(await N.usage.stats().catch(() => null));
  note('usage before: ' + J(before));

  // ---- 1. first prompt delivered, the turn starts ----
  const S = (await G.open('Terminal'))?.paneId;
  started.push(S);
  check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );

  // Access level Ask first, picked on the composer's own Access control before the panel starts (a
  // level is set when a session starts): the file write of step 2 must then ask through the app.
  // Every request of this panel is answered Allow once through the app's own answer path (the
  // card's call), and logged with what the test project held at that moment.
  const accessSel = document.querySelector('.composer .tnai-pick[data-pick="access"] select');
  if (accessSel) {
    accessSel.value = 'ask';
    accessSel.dispatchEvent(new Event('change'));
    await wait(200);
  }
  const askFirst = window.TnaiLaunchPrefs?.access?.() === 'ask';
  note(
    askFirst
      ? 'access level picked: Ask first'
      : 'access level could not be picked from the test (' +
          (accessSel
            ? 'the control kept ' + J(window.TnaiLaunchPrefs?.access?.())
            : 'no Access control') +
          '): the permission step is not run'
  );
  const asked = [];
  let answering = false,
    C = '';
  const answerer = setInterval(async () => {
    if (answering || !C) return;
    answering = true;
    try {
      for (const p of ((await N.permissions.pending()) || []).filter(
        p => !asked.some(a => a.id === p.id)
      )) {
        const entry = {
          id: p.id,
          tool: p.tool,
          detail: String(p.detail || '').slice(0, 100),
          scope: p.sessionScope,
          at: Date.now(),
          status: statusOf(C),
          fileBefore: (await main('file', C, 'hello.txt')).error || 'there',
        };
        asked.push(entry);
        entry.decision = extra && /deny\.txt/i.test(entry.detail) ? 'deny' : 'once';
        entry.own = p.paneId === C;
        entry.answered = await N.permissions.answer(p.id, entry.decision);
        entry.answerMs = Date.now() - entry.at;
      }
    } catch (e) {
      note('permission poll error: ' + e.message);
    }
    answering = false;
  }, 150);
  const t0 = Date.now(),
    ms = () => Date.now() - t0 + ' ms';
  prompts++;
  N.pty.write(
    S,
    'tnai new opencode --model ' +
      pick.id +
      ' --name "OC real" "' +
      (only
        ? LONG
        : 'Create a file named hello.txt in the current folder containing exactly the two letters hi, then reply with the single word done.') +
      '"\r'
  );
  C =
    (await until(async () => {
      await trust();
      return G.sessions().find(s => s.agent === 'OpenCode' && s.running)?.paneId;
    }, 45000)) || '';
  if (!check(!!C, 'step 1: tnai new opened an OpenCode panel (' + ms() + ')')) {
    note('sender screen: ' + (await tail(S)).slice(-500));
    throw new Error('no OpenCode panel');
  }
  started.push(C);
  const typedIn = await until(async () => {
    await trust();
    return mark.test(await flat(C));
  }, 60000);
  check(!!typedIn, 'step 1: the task reached the OpenCode screen (' + ms() + ')');
  const tTyped = Date.now();
  let workingAt = 0,
    turnAt = 0;
  await until(
    () => {
      if (!workingAt && statusOf(C) === 'working') workingAt = Date.now();
      const t = turnOf(C);
      if (!turnAt && t?.startedAt && mark.test(t.task || '')) turnAt = Date.now();
      return workingAt && turnAt;
    },
    45000,
    100
  );
  check(
    !!turnAt,
    'step 1: the app has the task from the OpenCode record' +
      (turnAt
        ? ', ' +
          (turnAt - t0) +
          ' ms after the command, ' +
          (turnAt - tTyped) +
          ' ms after it was on screen'
        : ' (not within 45 s)')
  );
  check(
    !!workingAt,
    'step 1: the app shows it working' +
      (workingAt
        ? ', ' +
          (workingAt - t0) +
          ' ms after the command, ' +
          (workingAt - tTyped) +
          ' ms after the task was on screen'
        : ' (status stayed ' + statusOf(C) + ')')
  );
  if (!turnAt) note('OpenCode screen: ' + (await tail(C)).slice(-900));
  note('sender screen: ' + (await tail(S, 6)).slice(-300));

  // ---- 6. as a lead: ready signal and rules file ----
  const launch = await main('launch', C);
  note('launch: ' + J(launch));
  check(
    !!launch && launch.model === pick.id,
    'step 6: the panel was started on the free model: ' + (launch?.model || 'none')
  );
  check(
    !!launch &&
      /work-rules-opencode\.md$/.test(launch.rulesFile) &&
      /work-rules-opencode\.md$/.test(launch.config.instructions[0] || ''),
    'step 6: its launch config names work-rules-opencode.md as instructions'
  );
  check(
    !!launch?.rulesNameDelegate && launch.ownedByUser,
    'step 6: started as a lead, and the rules file names tnai_delegate'
  );
  check(
    !!launch?.config.tnai &&
      launch.config.tnai.timeout === 660000 &&
      launch.config.plugin.includes('opencode-steps.js'),
    'step 6: the config holds the tnai server (660 s) and the step plugin: ' + J(launch?.config)
  );
  if (askFirst)
    check(launch?.access === 'ask', 'the panel was started at Ask first: ' + J(launch?.access));

  // The link to the panel's own OpenCode server, as the app's state says (no port or password is
  // read here).
  const link =
    (await until(
      async () => {
        const l = await main('link', C);
        return l?.connected ? l : null;
      },
      15000,
      300
    )) || (await main('link', C));
  check(!!link?.connected, 'link: the app says the panel link is on (' + ms() + '): ' + J(link));
  let seen = await main('seen', C);
  check(
    seen.ready.some(r => r.source === 'mcp'),
    'step 6: OpenCode listed the tools of Technically Not at start (ready signal): ' + J(seen.ready)
  );

  // ---- 2. the tiny task ends ----
  const ended =
    turnAt && !only
      ? await until(async () => {
          await trust();
          return turnOf(C)?.endedAt;
        }, 150000)
      : 0;
  const t1 = turnOf(C) || {};
  if (!only)
    check(
      !!ended,
      'step 2: the task ended' +
        (ended
          ? ', ' +
            (ended - t1.startedAt) +
            ' ms after it started (seen by the app ' +
            ms() +
            ' after the command)'
          : ' (not within 150 s; status ' + statusOf(C) + ')')
    );
  seen = await main('seen', C);
  note('turn: ' + J(seen.turn));
  note('OpenCode record: ' + J(seen.record));
  note('events: ' + J(seen.kinds));
  const modelOk = !t1.model || FREE.test(t1.model);
  check(modelOk, 'the reply came from a free model: ' + (t1.model || 'not named'));
  if (ended) {
    check(t1.endedBy === 'stop', 'step 2: ended by stop: ' + t1.endedBy);
    check(
      !!(t1.result || '').trim(),
      'step 2: result text present: ' + J((t1.result || '').slice(0, 120))
    );
    const tk = t1.tokens || {};
    check(
      (tk.input || 0) + (tk.output || 0) + (tk.cacheRead || 0) > 0,
      'step 2: tokens present: ' + J(t1.tokens)
    );
    check(
      seen.tools.length > 0,
      'step 2: a tool step was seen: ' + J(seen.tools.map(t => t.tool + ' ' + t.detail))
    );
    check(
      seen.tools.some(t => /^(Write|Edit|Bash)$/.test(t.tool) && /hello\.txt/i.test(t.detail)),
      'step 2: a step names the edited file hello.txt'
    );
    const f = await main('file', C, 'hello.txt');
    check(
      /^hi\s*$/.test(f.text || ''),
      'step 2: hello.txt is in the test project with "hi": ' + J(f)
    );
    if (askFirst) {
      note(
        'permission requests answered Allow once: ' +
          J(
            asked.map(a => ({
              tool: a.tool,
              detail: a.detail,
              scope: a.scope,
              afterTaskStart: a.at - t1.startedAt,
              status: a.status,
              fileBefore: a.fileBefore,
              answered: a.answered,
              answerMs: a.answerMs,
            }))
          )
      );
      const write = asked.find(a => /edit|write/i.test(a.tool) || /hello\.txt/i.test(a.detail));
      check(
        !!write,
        'permission: the file write raised the permission event of the app (' +
          asked.length +
          ' requests)'
      );
      if (write)
        check(
          write.fileBefore !== 'there' && !!write.answered && /^hi\s*$/.test(f.text || ''),
          'permission: hello.txt was not there when asked (' +
            write.fileBefore +
            '), Allow once through the app wrote it'
        );
    }
    await wait(2500);
    check(statusOf(C) === 'waiting', 'step 2: the panel is idle afterwards: ' + statusOf(C));
    note('Project context entries: ' + J(await main('entries')));
  } else if (!only) note('OpenCode screen: ' + (await tail(C)).slice(-900));

  // ---- 3. compact through the app ----
  if (only) {
  } else if (ended && modelOk) {
    const b = document.querySelector(
      '.terminal-pane[data-pane-id="' +
        CSS.escape(C) +
        '"] .terminal-pane-tools button[data-compact]'
    );
    const usable = !!b && !b.disabled;
    check(
      usable,
      'step 3: the panel Compact button is offered for OpenCode' +
        (b ? ': ' + J(b.title) : ' (no button)')
    );
    const sentAt = Date.now(),
      recordBefore = seen.record?.task || '';
    if (usable) b.click();
    else
      await N.pty
        .submit(C, '/compact', { paste: false })
        .catch(e => note('submit error: ' + e.message));
    await wait(1500);
    note('screen 1.5 s after /compact: ' + (await tail(C, 12)).slice(-700));

    // Done = output since, then 4 s of quiet (a summary is written by the model), at most 90 s.
    await until(
      () => {
        const s = sessionOf(C);
        return s && Date.now() - sentAt > 6000 && Date.now() - s.lastOutputAt > 4000;
      },
      90000,
      500
    );
    const after = await flat(C),
      shown = (await tail(C, 16)).slice(-900);
    note('screen after compact (' + (Date.now() - sentAt) + ' ms): ' + shown);
    const s3 = await main('seen', C);
    note('OpenCode record after compact: ' + J(s3.record));
    note('app turn after compact: ' + J(s3.turn));
    check(
      !/^\/compact\b/.test((s3.record?.task || '').trim()),
      'step 3: /compact was not sent to the model as a plain message (latest user message: ' +
        J((s3.record?.task || '').slice(0, 60)) +
        ', before: ' +
        J(recordBefore.slice(0, 40)) +
        ')'
    );
    check(
      /compact(ed|ing|ion)|summar/i.test(after.replace(/\/compact/g, '')),
      'step 3: the OpenCode screen shows a compaction, not the typed text'
    );
    check(
      statusOf(C) !== 'working' || !!(await until(() => statusOf(C) !== 'working', 20000)),
      'step 3: the panel is not left on working after the compact: ' + statusOf(C)
    );
    const t3 = turnOf(C) || {};
    check(
      typeof t3.context?.tokens === 'number' && t3.context.tokens > 0,
      'step 3: the context size after the compact is a number: ' + J(t3.context)
    );
    check(
      !!(t3.task || '').trim() && !!(s3.turn?.task || '').trim(),
      'step 3: no empty task appears after the compact (the app task: ' +
        J((t3.task || '').slice(0, 50)) +
        ')'
    );
    note(
      'link after compact: ' +
        J(await main('link', C)) +
        ' · prompt-submit: ' +
        J(await main('did', C).catch(e => ({ error: e.message })))
    );
  } else note('step 3 not run: the first task did not end');

  // ---- 4. a running task, interrupted with OpenCode's stop call or its interrupt keys, then the
  // note ----
  if ((ended && modelOk) || (only && turnAt)) {
    let began = only ? turnOf(C) : null,
      beganAt = turnAt;
    if (!only) {
      const prev = turnOf(C)?.startedAt || 0;
      prompts++;

      // The submit's answer and the task registering are timed apart: an answer of "not started"
      // for a task that runs is a wrong answer.
      const sendAt = Date.now();
      let answer = null,
        answerAt = 0;
      N.pty
        .submit(C, LONG, { paste: true })
        .catch(e => ({ error: e.message }))
        .then(r => {
          answer = r;
          answerAt = Date.now();
        });
      began = await until(
        () => {
          const t = turnOf(C);
          return t && t.startedAt > prev && !t.endedAt && /300/.test(t.task || '') ? t : null;
        },
        40000,
        100
      );
      beganAt = Date.now();
      check(
        !!began,
        'step 4: the second task registered' +
          (began
            ? ' ' + (beganAt - sendAt) + ' ms after the send'
            : ' (app turn: ' +
              J(
                turnOf(C) && {
                  task: (turnOf(C).task || '').slice(0, 60),
                  endedAt: turnOf(C).endedAt,
                }
              ) +
              ')')
      );
      await until(() => answer, 20000, 100);
      note(
        'send answer' +
          (answerAt ? ' after ' + (answerAt - sendAt) + ' ms' : ' (none within 20 s)') +
          ': ' +
          J(answer) +
          ' · prompt-submit: ' +
          J(await main('did', C).catch(e => ({ error: e.message })))
      );
      if (began)
        check(
          !!answer && answer.state !== 'not-submitted',
          'step 4: the send was not reported as "not started" for a task that runs: ' +
            J(answer?.state)
        );
    }
    if (began) {
      await wait(Math.max(0, 3000 - (Date.now() - beganAt)));
      if (turnOf(C)?.endedAt)
        note('the model finished before the interrupt: step 4 was not exercised');
      else {
        // The note that follows the interrupt starts a task of its own, which replaces the stopped
        // one in the app: both are watched from the key on.
        const old = turnOf(C).startedAt,
          escAt = Date.now();
        let endedBy = '',
          endedMs = 0,
          nextMs = 0,
          calmMs = 0;
        const watch = setInterval(() => {
          const t = turnOf(C);
          if (!t) return;
          if (t.startedAt === old && t.endedAt && !endedMs) {
            endedBy = t.endedBy;
            endedMs = Date.now() - escAt;
          }
          if (t.startedAt > old && !nextMs) nextMs = Date.now() - escAt;
          if (!calmMs && statusOf(C) !== 'working') calmMs = Date.now() - escAt;
        }, 50);
        prompts++;
        const delivered = await stopThenSend(
          C,
          extra
            ? 'Create a file named deny.txt in the current folder containing the word no. If that is refused, do not try any other way'
            : 'Reply with the single word stopped and nothing else'
        );
        await until(() => endedMs || nextMs, 8000, 50);
        await wait(600);
        const shown = await flat(C);
        note(
          'after Intervene: task ended ' +
            (endedMs ? 'as ' + J(endedBy) + ' after ' + endedMs + ' ms' : 'not seen') +
            ', the note began its own task ' +
            (nextMs ? 'after ' + nextMs + ' ms' : 'not seen') +
            ', status left working ' +
            (calmMs ? 'after ' + calmMs + ' ms' : 'never') +
            ', screen says interrupted: ' +
            /interrupted/i.test(shown)
        );
        check(delivered === true, 'step 4: Intervene sent its note after the interrupt');
        check(
          endedBy === 'interrupted' || (!!nextMs && /interrupted/i.test(shown)),
          'step 4: the app interrupt stopped the task' +
            (endedBy
              ? ', ended as ' + J(endedBy)
              : nextMs
                ? ' (OpenCode shows it interrupted; the note had replaced it in the app before its end was read)'
                : ' (still ' + statusOf(C) + ')')
        );
        check(
          !!(endedMs || nextMs) && (endedMs || nextMs) < 5000,
          'step 4: within seconds: ' +
            (endedMs || nextMs || 'not within 8 s') +
            ' ms after Intervene'
        );
        const s4 = await main('seen', C);
        note('OpenCode record after Intervene: ' + J(s4.record));
        note('screen after Intervene: ' + (await tail(C, 10)).slice(-600));
        clearInterval(watch);

        // The note asks it to go on with the long task afterwards: stopped here by hand (two Esc),
        // so no model call is left running.
        if (!extra) await wait(2500);
        if (!extra && turnOf(C) && !turnOf(C).endedAt) {
          N.pty.write(C, '\x1b');
          await wait(300);
          N.pty.write(C, '\x1b');
          const off = await until(() => turnOf(C)?.endedAt, 8000, 100);
          note(
            'the note task was stopped by hand: ' +
              (off ? turnOf(C).endedBy : 'not ended, the panel is closed next')
          );
        }
      }
    }
  } else note('step 4 not run: the first task did not end');

  // ---- extra mode ($env:TNAI_OC_ONLY='extra'): Deny, an OpenCode sub-agent, a file lock, and this
  // agent leading one sub-agent of Technically Not ----
  if (extra && C) {
    const idle = (ms = 20000) =>
      until(
        () => {
          const t = turnOf(C);
          return (!t || t.endedAt) && statusOf(C) !== 'working';
        },
        ms,
        200
      );

    // One prompt into the panel, then its task from start to end as the app has it.
    const ask = async (text, mark, capMs) => {
      const prev = turnOf(C)?.startedAt || 0,
        at = Date.now();
      prompts++;
      const r = await N.pty.submit(C, text, { paste: true }).catch(e => ({ error: e.message }));
      const began = await until(
        () => {
          const t = turnOf(C);
          return t && t.startedAt > prev && mark.test(t.task || '') ? t : null;
        },
        40000,
        100
      );
      const done = began
        ? await until(
            async () => {
              await trust();
              const t = turnOf(C);
              return t && t.startedAt === began.startedAt && t.endedAt ? t : null;
            },
            capMs,
            200
          )
        : null;
      return { at, r, began, done, ms: Date.now() - at };
    };
    const ending = (label, x) =>
      check(
        !!x.done && x.done.endedBy === 'stop',
        label +
          ': the task ' +
          (x.done
            ? 'ended by ' + x.done.endedBy + ' after ' + x.ms + ' ms'
            : x.began
              ? 'did not end in time (status ' + statusOf(C) + ')'
              : 'never registered, send answer ' + J(x.r)) +
          (x.done ? ', result ' + J((x.done.result || '').slice(0, 140)) : '')
      );

    // B1. Deny: the write the Intervene note asked for is answered Deny through the app; nothing is
    // written and the task goes on.
    const denied = await until(() => asked.find(a => /deny\.txt/i.test(a.detail)), 90000, 200);
    check(
      !!denied && denied.decision === 'deny' && !!denied.answered,
      'deny: the write of deny.txt raised a permission request, answered Deny through the app: ' +
        J(denied && { tool: denied.tool, status: denied.status, answerMs: denied.answerMs })
    );
    if (denied) {
      await wait(4000);
      const f = await main('file', C, 'deny.txt'),
        t = turnOf(C) || {};
      check(!!f.error, 'deny: deny.txt was not written: ' + J(f.error || 'it is there'));
      check(
        !t.endedAt || t.endedBy === 'stop',
        'deny: the task went on after Deny (4 s later: ' +
          (t.endedAt
            ? 'ended by ' + t.endedBy + ', result ' + J((t.result || '').slice(0, 100))
            : 'still working, status ' + statusOf(C)) +
          ')'
      );
      note('screen 4 s after Deny: ' + (await tail(C, 8)).slice(-500));
    } else
      note(
        'screen: ' +
          (await tail(C, 10)).slice(-600) +
          ' · requests: ' +
          J(asked.map(a => a.tool + ' ' + a.detail.slice(0, 40)))
      );

    // The note sends it back to the long task: stopped here through the same stop call, so the next
    // prompt finds it idle.
    if (turnOf(C) && !turnOf(C).endedAt) {
      const viaLink = await main('stop', C).catch(() => false);
      if (!viaLink) {
        N.pty.write(C, '\x1b');
        await wait(300);
        N.pty.write(C, '\x1b');
      }
      await until(() => turnOf(C)?.endedAt, 10000, 100);
      note(
        'the rest of that task was stopped by hand (' +
          (viaLink ? 'stop call' : 'keys') +
          '): ' +
          (turnOf(C)?.endedBy || 'not ended')
      );
    }
    await idle();

    // B2. A helper: OpenCode's own sub-agent, as the app's events show it (start, a step, end).
    const h = await ask(
      'Use the task tool once with the general subagent to list the files in this folder. Then reply with the single word done.',
      /general subagent/,
      150000
    );
    const subs = await main('subs', C, h.at);
    note(
      'sub-agent events (ms after the prompt): ' + J(subs) + ' · link: ' + J(await main('link', C))
    );
    const sStart = subs.find(e => e.kind === 'sub-start'),
      sStep = subs.find(e => e.kind === 'tool'),
      sEnd = subs.find(e => e.kind === 'sub-stop');
    check(
      !!sStart,
      'helper: the app shows a sub-agent of this panel starting' +
        (sStart ? ' ' + sStart.ms + ' ms after the prompt' : '')
    );
    check(
      !!sStep,
      'helper: a step of the sub-agent was seen' +
        (sStep ? ': ' + sStep.tool + ' ' + sStep.detail + ' at ' + sStep.ms + ' ms' : '')
    );
    check(
      !!sEnd,
      'helper: its end was seen' + (sEnd ? ' at ' + sEnd.ms + ' ms: ' + J(sEnd.text) : '')
    );
    ending('helper', h);
    await idle();

    // B3. A file lock held by another agent (the PowerShell panel, through `tnai lock`): the edit
    // is refused, the file is as it was, the model has the reason.
    const readme = await main('file', C, 'README.md');
    N.pty.write(S, 'tnai lock README.md\r');
    await wait(3000);
    note('sender after tnai lock: ' + (await tail(S, 3)).slice(-260));
    const k = await ask(
      'Use the edit tool to add a line with the word locked at the end of README.md. If the edit is refused, do not retry and do not use any other way: reply with the exact refusal text you received.',
      /README\.md/,
      150000
    );
    const readme2 = await main('file', C, 'README.md'),
      lockShown = await flat(C);
    note(
      'lock task: tools ' +
        J(await main('tools', C, k.at)) +
        ' · requests ' +
        J(asked.filter(a => a.at >= k.at).map(a => a.tool + ' → ' + a.decision))
    );
    check(
      typeof readme.text === 'string' && readme2.text === readme.text,
      'lock: README.md is unchanged (' +
        (readme2.text || '').length +
        ' characters, before ' +
        (readme.text || '').length +
        ')'
    );
    check(
      /file lock|locked by|holds/i.test(k.done?.result || '') ||
        /File lock \(Technically Not\)/i.test(lockShown),
      'lock: the model was told the reason: ' + J((k.done?.result || '').slice(0, 200))
    );
    ending('lock', k);
    N.pty.write(S, 'tnai unlock README.md\r');
    await wait(2500);
    note('sender after tnai unlock: ' + (await tail(S, 3)).slice(-200));
    await idle();

    // B4. A real lead: one tnai_delegate call for another OpenCode on the same free model (the
    // main-process side of this test refuses any other start).
    const d = await ask(
      'Call the tnai_delegate tool exactly once with agent "OpenCode", model "' +
        pick.id +
        '", purpose "pong check", task "Reply with the single word pong and nothing else.", why "test of delegation". Then call the tnai_wait tool once, and reply with one line: sub-agent said, followed by what it reported.',
      /tnai_delegate/,
      210000
    );
    const dTools = await main('tools', C, d.at),
      graph = (await main('graph')).filter(n => n.parentPaneId === C),
      starts = await main('starts');
    for (const s of starts.started)
      if (s.paneId !== C && !started.includes(s.paneId)) {
        started.push(s.paneId);
        prompts++;
      }
    note(
      'lead: tools ' +
        J(dTools.map(t => t.tool + ' @' + t.ms)) +
        ' · sub-agents of this panel ' +
        J(graph) +
        ' · starts ' +
        J(starts)
    );
    check(
      dTools.some(t => /delegate/i.test(t.tool)),
      'lead: OpenCode called tnai_delegate'
    );
    const kid = graph[0];
    check(
      !!kid && kid.agent === 'OpenCode' && !!kid.paneId,
      'lead: the call was accepted and a sub-agent panel started' +
        (kid
          ? ': ' +
            kid.name +
            ' (' +
            kid.agent +
            '), ' +
            (kid.createdAt - d.at) +
            ' ms after the prompt'
          : '')
    );
    check(
      starts.started.some(s => s.paneId !== C && FREE.test(s.model)) && !starts.refused.length,
      'lead: the sub-agent runs on the free model, nothing else was asked to start: ' +
        J(starts.refused)
    );
    check(
      !!kid && /pong/i.test(kid.report || ''),
      'lead: its report came back' +
        (kid
          ? ' (' +
            kid.status +
            (kid.doneAt ? ', ' + (kid.doneAt - kid.createdAt) + ' ms after it was made' : '') +
            '): ' +
            J((kid.report || '').slice(0, 100))
          : '')
    );
    check(
      /pong/i.test(d.done?.result || ''),
      'lead: the lead answered with it: ' + J((d.done?.result || '').slice(0, 140))
    );
    ending('lead', d);
    if (!d.done && turnOf(C) && !turnOf(C).endedAt) await main('stop', C).catch(() => false);
  }

  // ---- 5. Usage data ----
  await wait(1500);
  const afterUse = usageOf(await N.usage.stats().catch(() => null));
  note('usage after: ' + J(afterUse));
  check(
    afterUse.rows > 0 && !!afterUse.source?.found,
    'step 5: Usage data holds rows with cli opencode'
  );
  if (only && !extra)
    note(
      'both tasks of this mode were interrupted before any tokens, and an answer without tokens is no Usage row: growth not checked'
    );
  else
    check(
      afterUse.turns > before.turns || afterUse.tokens > before.tokens,
      'step 5: this run was added to them (turns ' +
        before.turns +
        ' to ' +
        afterUse.turns +
        ', tokens ' +
        before.tokens +
        ' to ' +
        afterUse.tokens +
        ')'
    );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
try {
  clearInterval(answerer);
} catch {}
log.push('       real prompts sent: ' + prompts + ' (plus one /compact when step 3 ran)');
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
