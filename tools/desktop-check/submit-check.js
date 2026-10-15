/*
 * Technically Not desktop check · submit-check.js — prompt-submit.js with fake panes: Enter after
 * the text, the CLI's confirmation, one retry when a CLI (Codex on Windows) turned the Enter into a
 * newline, and honest states. Run: node tools/desktop-check/submit-check.js
 */
'use strict';
const submitter = require('../../desktop/prompt-submit');

const writes = [],
  panes = new Map(),
  waiters = new Map();

// A pane: agent, busy, and how many Enters it needs before it "takes" the prompt (0 = never
// signals; Infinity = never takes).
const pane = (id, agent, o = {}) =>
  panes.set(id, {
    agent,
    pid: 7,
    enters: 0,
    busy: false,
    signals: agent === 'Claude Code' || agent === 'Codex',
    needs: 1,
    ...o,
  });
const ptys = {
  list: () =>
    [...panes].map(([paneId, p]) => ({
      paneId,
      agent: p.agent,
      pid: p.pid,
      running: !p.gone,
      lastOutputAt: p.out || 0,
    })),
  write(paneId, data) {
    writes.push([paneId, data]);
    submitter.wrote(paneId, data);
    const p = panes.get(paneId);
    if (p && !p.silent)
      setTimeout(() => {
        p.out = Date.now();

        // a CLI echoes or redraws on a key; `silent` panes print nothing at all (a stuck Cursor
        // Agent)
      }, 5);
    if (data === '\r' && p && ++p.enters === p.needs) {
      p.busy = true;
      if (p.signals) for (const fn of [...(waiters.get(paneId) || [])]) fn();
    } // took it: its task starts
  },
};
const turns = {
  onSubmit(paneId, fn) {
    if (!waiters.has(paneId)) waiters.set(paneId, new Set());
    waiters.get(paneId).add(fn);
    return () => waiters.get(paneId).delete(fn);
  },
  canConfirm: (paneId, agent) =>
    panes.get(paneId)?.canConfirm ||
    // canConfirm: a Cursor Agent whose record is read
    (panes.get(paneId)?.signals && (agent === 'Claude Code' || agent === 'Codex')),
  busy: paneId => !!panes.get(paneId)?.busy,
};
const asking = new Set();
const unsent = [];
submitter.init({
  ptys,
  turns,
  hooks: { pendingPermissions: () => [...asking].map(paneId => ({ paneId })) },
  attention: { unsent: paneId => unsent.push(paneId) },
});

let failed = 0;
const check = (ok, name) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
};
const enters = id => writes.filter(([p, d]) => p === id && d === '\r').length;

(async () => {
  pane('claude', 'Claude Code');
  pane('codex', 'Codex');
  pane('codexNewline', 'Codex', { needs: 2 }); // first Enter became a newline (paste burst)
  pane('codexBusy', 'Codex', { needs: Infinity, busy: true });
  pane('codexStuck', 'Codex', { needs: Infinity });
  pane('opencode', 'OpenCode');

  // still drawing its startup screen: drops the first two Enters
  pane('cursorStartup', 'Cursor Agent', { needs: 3 });
  pane('cursorNever', 'Cursor Agent', { needs: Infinity });

  // prints nothing after the pasted text and loses the first seven Enters
  pane('cursorSilent', 'Cursor Agent', { needs: 8, silent: true });

  // a CLI that gives signs, idle, prints nothing and loses three Enters (a running Cursor Agent,
  // 2026-10-05)
  pane('liveSilent', 'Codex', { needs: 4, silent: true });

  // the terminal answers a color question right after the first Enter
  pane('reply', 'Cursor Agent', { needs: 2 });
  setTimeout(() => ptys.write('reply', '\x1b]11;rgb:1b1b/1b1b/2424\x1b\\'), 600);

  // Late confirmation branch (end of submit()): printed after the last Enter, never confirms, never
  // busy. The 20 s late wait runs in parallel with the rest. 1: waits 20 s, then unconfirmed
  pane('lateCursor', 'Cursor Agent', { needs: Infinity, canConfirm: true });

  // 2: the confirmation arrives a few seconds into the wait
  pane('lateCursorOk', 'Cursor Agent', { needs: Infinity, canConfirm: true });

  // 3: another CLI: unchanged, not-submitted
  pane('lateClaude', 'Claude Code', { needs: Infinity });

  // 4: printed nothing after the last Enter
  pane('lateCursorQuiet', 'Cursor Agent', { needs: Infinity, canConfirm: true, silent: true });
  (async () => {
    for (let i = 0; i < 400 && !submitter.did('lateCursorOk')?.late; i++)
      await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 2500));
    for (const fn of [...(waiters.get('lateCursorOk') || [])]) fn();
  })();
  pane('typed', 'Codex', { needs: Infinity });
  pane('asking', 'Claude Code', { needs: Infinity });
  pane('shell', 'Terminal');
  asking.add('asking');
  const typedLater = submitter.submit('typed', 'hi');

  // the user types while Technically Not waits for the confirmation
  setTimeout(() => ptys.write('typed', 'x'), 1500);
  const r = Object.fromEntries(
    await Promise.all(
      [
        ['claude', 'fix the bug'],
        ['codex', 'line one\r\nline two'],
        ['codexNewline', 'hello'],
        ['codexBusy', 'next'],
        ['codexStuck', 'x'],
        ['opencode', 'go'],
        ['cursorStartup', 'go'],
        ['cursorNever', 'go'],
        ['cursorSilent', 'go'],
        ['liveSilent', 'go'],
        ['reply', 'go'],
        ['lateCursor', 'go'],
        ['lateCursorOk', 'go'],
        ['lateClaude', 'go'],
        ['lateCursorQuiet', 'go'],
        ['asking', 'go'],
        ['shell', 'dir'],
      ]
        .map(async ([id, text]) => [
          id,
          await submitter.submit(id, text, { paste: id !== 'shell' }),
        ])
        .concat([typedLater.then(v => ['typed', v])])
    )
  );
  const gone = await submitter.submit('nope', 'x');

  check(
    r.claude.state === 'sent' && enters('claude') === 1,
    'Claude Code: one Enter, confirmed → sent'
  );
  check(
    r.codex.state === 'sent' &&
      writes.some(([p, d]) => p === 'codex' && d === '\x1b[200~line one\nline two\x1b[201~'),
    'Codex: sent as one bracketed paste, CRLF → LF'
  );
  check(
    r.codexNewline.state === 'sent' && r.codexNewline.retried && enters('codexNewline') === 2,
    'Codex: Enter turned into a newline → one retry → sent'
  );
  check(r.codexBusy.state === 'queued', 'Codex busy, no confirmation → queued');
  check(
    r.codexStuck.state === 'not-submitted' && !r.codexStuck.ok && enters('codexStuck') === 2,
    'Codex idle, never took it → not-submitted after one retry'
  );
  check(
    r.opencode.state === 'sent' && enters('opencode') === 1,
    'CLI with no confirmation, task started → sent, no extra Enter'
  );
  check(
    r.cursorStartup.state === 'sent' && enters('cursorStartup') === 3,
    'Cursor Agent dropping Enters while it starts → Enter again until its task starts'
  );
  check(
    r.cursorNever.state === 'unconfirmed' && enters('cursorNever') === 5,
    'CLI that never shows a task → unconfirmed after 4 extra Enters at most'
  );
  check(
    r.cursorSilent.state === 'sent' && enters('cursorSilent') === 8,
    'CLI that prints nothing after the text and loses seven Enters → Enter again while it stays silent, until its task starts (' +
      enters('cursorSilent') +
      ')'
  );
  check(
    r.liveSilent.state === 'sent' && r.liveSilent.retried && enters('liveSilent') === 4,
    'CLI that gives signs but stays silent after two Enters → Enter again until it takes it, reported sent (' +
      r.liveSilent.state +
      ', ' +
      enters('liveSilent') +
      ')'
  );
  check(
    r.reply.state === 'sent' && enters('reply') === 2,
    "the terminal's own color answer is not typing: the retry Enter is still pressed (" +
      enters('reply') +
      ')'
  );
  check(
    r.lateCursor.ok === true &&
      r.lateCursor.state === 'unconfirmed' &&
      !unsent.includes('lateCursor'),
    'Cursor Agent, can confirm, printed after each Enter, never confirms → unconfirmed, unsent not called (' +
      r.lateCursor.state +
      ')'
  );
  check(
    r.lateCursorOk.ok === true &&
      r.lateCursorOk.state === 'sent' &&
      r.lateCursorOk.retried === true &&
      !unsent.includes('lateCursorOk'),
    'same, confirmation arrives during the late wait → sent, retried (' + r.lateCursorOk.state + ')'
  );
  check(
    r.lateClaude.state === 'not-submitted' && !r.lateClaude.ok && unsent.includes('lateClaude'),
    'Claude Code in the same situation → not-submitted, unsent called'
  );
  check(
    r.lateCursorQuiet.state === 'not-submitted' &&
      !r.lateCursorQuiet.ok &&
      unsent.includes('lateCursorQuiet'),
    'Cursor Agent that printed nothing after the last Enter → not-submitted, unsent called (' +
      r.lateCursorQuiet.state +
      ')'
  );
  check(
    r.typed.state === 'not-submitted' && enters('typed') === 1,
    'user typed meanwhile → no retry Enter'
  );
  check(enters('asking') === 1, 'permission question waiting → no retry Enter');
  check(
    r.shell.state === 'unconfirmed' &&
      enters('shell') === 1 &&
      writes.some(([p, d]) => p === 'shell' && d === 'dir'),
    'Terminal: typed plain, one Enter'
  );
  check(gone.state === 'gone' && !gone.ok, 'no process → gone');

  // The user types between an agent message's paste and its Enter: no Enter, so the user's keys
  // are not sent with the message. The user's own prompt is pressed as before.
  {
    pane('earlyAgent', 'Claude Code');
    pane('earlyPerson', 'Claude Code');
    setTimeout(() => ptys.write('earlyAgent', 'h'), 50);
    setTimeout(() => ptys.write('earlyPerson', 'h'), 50);
    const [agentSent, personSent] = await Promise.all([
      submitter.submit('earlyAgent', 'done: report'),
      submitter.submit('earlyPerson', 'my prompt', { person: true }),
    ]);
    check(
      agentSent.state === 'not-submitted' &&
        enters('earlyAgent') === 0 &&
        unsent.includes('earlyAgent'),
      'user typed before the Enter → agent message not sent, left in the input (' +
        agentSent.state +
        ')'
    );
    check(
      personSent.state === 'sent' && enters('earlyPerson') === 1,
      "the user's own prompt with a key before the Enter → sent as before"
    );
  }

  // OpenCode's /compact: through its server link when it is on and idle (a stand-in behind the real
  // desktop/opencode-link.js), typed otherwise.
  {
    const link = require('../../desktop/opencode-link'),
      oc = await require('./opencode-stand-in').standIn('pw').listen();
    const nap = ms => new Promise(res => setTimeout(res, ms));
    link.tune({ first: 20, retryMin: 40, retryMax: 200 }, ['9.9.9']);
    pane('ocLink', 'OpenCode');
    const typed = id =>
      writes
        .filter(([p]) => p === id)
        .map(([, d]) => d)
        .join('');
    link.attach('ocLink', oc.port, 'pw');
    for (let i = 0; i < 100 && !link.state('ocLink')?.connected; i++) await nap(30);
    oc.send('session.created', { sessionID: 'ses_c', info: { id: 'ses_c' } });
    oc.send('message.updated', {
      sessionID: 'ses_c',
      info: {
        id: 'msg_1',
        sessionID: 'ses_c',
        role: 'assistant',
        providerID: 'opencode',
        modelID: 'big-pickle',
      },
    });
    oc.send('session.status', { sessionID: 'ses_c', status: { type: 'busy' } });
    for (let i = 0; i < 100 && link.state('ocLink').sessionId !== 'ses_c'; i++) await nap(30);
    const busyRun = submitter.submit('ocLink', '/compact', { paste: false });
    await nap(700);
    check(
      oc.calls.length === 0 && typed('ocLink').startsWith('/compact'),
      'OpenCode busy: /compact is typed as before, no call'
    );
    await busyRun;
    writes.length = 0;
    oc.send('session.status', { sessionID: 'ses_c', status: { type: 'idle' } });
    for (let i = 0; i < 100 && link.state('ocLink').status !== 'idle'; i++) await nap(30);
    const viaLink = await submitter.submit('ocLink', '/compact', { paste: false });
    check(
      viaLink.state === 'sent' &&
        typed('ocLink') === '' &&
        oc.calls.length === 1 &&
        oc.calls[0].url === '/session/ses_c/summarize' &&
        oc.calls[0].body.modelID === 'big-pickle',
      'OpenCode idle with its link on: /compact goes as the summarize call, nothing typed'
    );
    writes.length = 0;
    await submitter.submit('ocLink', '/new', { paste: false });
    check(
      typed('ocLink').startsWith('/new') && oc.calls.length === 1,
      'another slash command is typed as before'
    );
    writes.length = 0;
    oc.failPosts = true;
    await submitter.submit('ocLink', '/compact', { paste: false });
    check(
      typed('ocLink').startsWith('/compact'),
      'a refused summarize call: /compact is typed as before'
    );
    link.close('ocLink');
    await oc.close();
  }
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})();
