/*
 * * Technically Not desktop check · remote-submit-check.js — a prompt that comes from the user's
 * * other computer (option `remote` of desktop/prompt-submit.js with the hold code of
 * * desktop/attention-service.js, both real, wired as main.js wires them; the panels, the task
 * record
 * * and the permission list are stand-ins). Each check names the numbered test of the design it
 * covers
 * * ("Tests that must exist": 2, 4, 5, 6, 11, 12, 29, and
 * * the 10-minute part of 13). No CLI runs. About 25 s. Run: node
 * * tools/desktop-check/remote-submit-check.js
 */
'use strict';
const submitter = require('../../desktop/prompt-submit');
const attention = require('../../desktop/attention-service');
const W = submitter.REMOTE;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const writes = [],
  panes = new Map(),
  waiters = new Map(),
  endFns = [],
  perms = [],
  events = [];

// A panel: its CLI, whether that CLI confirms a prompt (signals), how many Enters it needs before
// it takes one (Infinity: never), and whether it prints on a key (silent: nothing at all).
const pane = (id, agent, o = {}) =>
  panes.set(id, {
    agent,
    pid: 100 + panes.size,
    startedAt: 1,
    enters: 0,
    busy: false,
    signals: agent === 'Claude Code' || agent === 'Codex',
    needs: 1,
    ...o,
  });

// Its task starts. lazyBusy: the CLI says at once that it took the prompt, and the task record
// shows it that many ms later.
const take = id => {
  const p = panes.get(id);
  p.enters = 0;
  if (p.lazyBusy)
    setTimeout(() => {
      p.busy = true;
    }, p.lazyBusy);
  else p.busy = true;
  if (p.signals) for (const fn of [...(waiters.get(id) || [])]) fn();
};
const finish = id => {
  panes.get(id).busy = false;
  endFns.forEach(fn => fn(id));
}; // its task ends
const ptys = {
  list: () =>
    [...panes].map(([paneId, p]) => ({
      paneId,
      agent: p.agent,
      pid: p.pid,
      startedAt: p.startedAt,
      running: !p.gone,
      lastOutputAt: p.out || 0,
    })),
  write(paneId, data) {
    writes.push([paneId, data, Date.now()]);
    submitter.wrote(paneId, data); // main.js tells prompt-submit.js of every write
    const p = panes.get(paneId);
    if (p && !p.silent)
      setTimeout(() => {
        p.out = Date.now();
      }, 5);
    if (data === '\r' && p && ++p.enters === p.needs) take(paneId);
  },
};
const turns = {
  onSubmit(paneId, fn) {
    if (!waiters.has(paneId)) waiters.set(paneId, new Set());
    waiters.get(paneId).add(fn);
    return () => waiters.get(paneId).delete(fn);
  },
  canConfirm: paneId => !!panes.get(paneId)?.signals,
  busy: paneId => !!panes.get(paneId)?.busy,
  onEnd(fn) {
    endFns.push(fn);
  },
};
const hooks = { pendingPermissions: () => perms.slice() };
attention.init((channel, payload) => events.push([channel, payload]), {
  turns,
  hooks,
  submit: (...a) => submitter.submit(...a),
  window: () => null,
  cli: id => panes.get(id)?.agent || null,
});
submitter.init({ ptys, turns, hooks, attention });

let failed = 0;
const check = (ok, name) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
};
const of = id => writes.filter(([p]) => p === id).map(([, d]) => d);
const pastes = id => of(id).filter(d => d.startsWith('\x1b[200~')).length;
const enters = id => of(id).filter(d => d === '\r').length;
const userTypes = (id, data) => {
  ptys.write(id, data);
  attention.typed(id, data);
}; // a key from the window, as main.js pty:write passes it on

// The other computer: its name, its right (on), and the words it was told for held prompts.
const computer = (name, o = {}) => {
  const c = {
    from: name,
    on: true,
    words: [],
    guard: () => c.on,
    onDone: w => c.words.push(w),
    ...o,
  };
  return c;
};
const send = (id, text, c, more = {}) => submitter.submit(id, text, { ...more, remote: c });
const results = [];
const sent = async (id, text, c, more) => {
  const r = await send(id, text, c, more);
  results.push(r);
  return r;
};
const noted = id => attention.list().items.some(i => i.paneId === id && i.kind === 'unsent');
const heldFor = id => attention.list().held.filter(h => h.paneId === id);
const MENU =
  "Would you like to run the following command?\r\n\r\n  $ npm test\r\n\r\n› 1. Yes, proceed (y)\r\n  2. Yes, and don't ask again for this command (a)\r\n  3. No, and tell Codex what to do differently (esc)\r\n";

(async () => {
  // ---- Test 2: control characters never reach the terminal; one Enter follows the paste ----
  pane('t2', 'Claude Code');
  const dirty =
    'Fix it \x1b[201~now\x03 and\rthen\x7f this\x9b[A\x00 \x1b]0;x\x07 done\r\nlast line\x85';
  const r2 = await sent('t2', dirty, computer('Laptop'), { paste: false, holdIfBlocked: true });
  const w2 = of('t2'),
    inner = (w2[0] || '').slice(6, -6);
  check(
    w2.length === 2 &&
      w2[0].startsWith('\x1b[200~') &&
      w2[0].endsWith('\x1b[201~') &&
      inner.length > 20 &&
      !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(inner) &&
      inner.includes('then') &&
      w2[1] === '\r' &&
      r2.state === W.sent,
    'test 2: Esc, Ctrl+C, carriage return, the end-of-paste mark, DEL and C1 characters are not in what is written, and one Enter follows the paste (' +
      JSON.stringify(inner) +
      ')'
  );
  check(
    w2[0] === '\x1b[200~' + inner + '\x1b[201~' && inner.includes('\n'),
    'test 2: pasted as one bracketed paste although paste: false was passed with it (Low 7: paste is forced)'
  );

  // The sender's mark (6f change 21): in front of the words where they are written, and the
  // word-first lock stays on the words as sent.
  pane('mk1', 'Claude Code');
  const MARK = '[Sent from Laptop (…a1b2)] ';
  const rm = await sent('mk1', 'Say hello', computer('Laptop', { mark: MARK }));
  check(
    rm.state === W.sent &&
      of('mk1').length === 2 &&
      of('mk1')[0] === '\x1b[200~' + MARK + 'Say hello\x1b[201~' &&
      of('mk1')[1] === '\r',
    'the mark: written once in front of the words, inside the one paste, then one Enter'
  );
  pane('mk2', 'Claude Code');
  const rmk = [
    await sent('mk2', '!whoami', computer('Laptop', { mark: MARK })),
    await sent('mk2', '/clear', computer('Laptop', { mark: MARK })),
    await sent('mk2', '[x] task', computer('Laptop')),
  ];
  check(
    rmk.every(r => r.ok === false && r.state === W.failed) && of('mk2').length === 0,
    'the mark does not open the word-first lock: words that start with "!", "/" or "[" are refused with or without it, nothing written'
  );
  pane('mk3', 'Claude Code');
  const rc = await sent(
    'mk3',
    'Go on',
    computer('Laptop', { mark: '[Sent from A\x1b[201~\r\x03B] ' })
  );
  check(
    rc.state === W.sent && of('mk3')[0] === '\x1b[200~[Sent from A[201~B] Go on\x1b[201~',
    'control characters in a mark are not written (' + JSON.stringify(of('mk3')[0]) + ')'
  );

  // ---- Test 4: a question that opens after the paste and before Enter gets no Enter ----
  const openAfterPaste = async (
    id,
    agent,
    kind,
    open,
    text = 'Run the build and tell me what failed',
    wait = 60
  ) => {
    pane(id, agent);
    const run = sent(id, text, computer('Laptop'));
    const pasted = pastes(id);
    await sleep(wait);
    await open();
    const r = await run;
    check(
      pasted === 1 &&
        r.state === W.failed &&
        r.ok === false &&
        enters(id) === 0 &&
        noted(id) &&
        attention.hasDraft(id),
      'test 4: ' +
        kind +
        ' opened after the paste → no Enter, failed, the panel is marked as holding unsent text (' +
        [r.state, enters(id), submitter.did(id)?.stop].join(', ') +
        ')'
    );
    const next = await sent(id, 'And then the next thing', computer('Laptop'));
    check(
      next.state === W.queued && pastes(id) === 1,
      'test 4: … and the next prompt for that panel is held, not pasted behind the text left there'
    );
  };
  await openAfterPaste('q-perm', 'Claude Code', 'a held permission request', () => {
    perms.push({
      id: 'pp1',
      paneId: 'q-perm',
      tool: 'Bash',
      detail: 'rm -rf build',
      at: Date.now(),
    });
    attention.permissionChanged({ paneId: 'q-perm' });
  });
  await openAfterPaste('q-trust', 'Codex', 'the folder trust question', () =>
    attention.trustAsked('q-trust', 'Trust "proj" for Codex?')
  );
  await openAfterPaste(
    'q-menu',
    'Codex',
    'a menu read from the screen (drawn 240 ms before the Enter, so not yet an item)',
    () => attention.output([{ paneId: 'q-menu', data: MENU }])
  );
  {
    const link = require('../../desktop/opencode-link'),
      oc = await require('./opencode-stand-in').standIn('pw').listen();
    link.tune({ first: 20, retryMin: 40, retryMax: 200 }, ['9.9.9']);
    link.attach('q-oc', oc.port, 'pw');
    for (let i = 0; i < 100 && !link.state('q-oc')?.connected; i++) await sleep(30);
    await openAfterPaste(
      'q-oc',
      'OpenCode',
      'an OpenCode question from its own server',
      async () => {
        oc.send('question.asked', {
          id: 'que_r',
          sessionID: 'ses_r',
          questions: [
            {
              question: 'Which database?',
              header: 'Database',
              options: [{ label: 'SQLite' }, { label: 'Postgres' }],
            },
          ],
        });
        for (let i = 0; i < 60 && !link.state('q-oc').questions.length; i++) await sleep(15);
      },
      'Set up the database layer. ' + 'Keep every existing test green. '.repeat(90)
    ); // long text: Enter waits about a second for it
    link.close('q-oc');
    await oc.close();
  }
  pane('q-before', 'Claude Code');
  perms.push({ id: 'pp2', paneId: 'q-before', tool: 'Edit', detail: 'a.js', at: Date.now() });
  const rb = await sent('q-before', 'Do the thing', computer('Laptop'));
  check(
    rb.state === W.queued && of('q-before').length === 0,
    'test 4: a question already open when it arrives → held on this computer, nothing written'
  );
  perms.length = 0;

  // ---- Test 5: no blind Enters ----
  // cannot confirm, prints nothing, never shows a task
  pane('n-silent', 'Cursor Agent', { needs: Infinity, silent: true });
  pane('n-prints', 'Cursor Agent', { needs: Infinity });
  pane('n-takes', 'OpenCode'); // cannot confirm, its task shows after the one Enter

  // confirms; the first Enter is lost without a sign
  pane('c-silent', 'Codex', { needs: 2, silent: true });

  // confirms; the first Enter became a line break, which it drew
  pane('c-newline', 'Codex', { needs: 2 });
  pane('c-never', 'Codex', { needs: Infinity, silent: true });

  // confirms and stays silent, but a question opens after the first Enter
  pane('c-asks', 'Codex', { needs: Infinity, silent: true });
  setTimeout(() => {
    perms.push({ id: 'pp3', paneId: 'c-asks', tool: 'Bash', detail: 'ls', at: Date.now() });
    attention.permissionChanged({ paneId: 'c-asks' });
  }, 1500);
  const t5 = Object.fromEntries(
    await Promise.all(
      ['n-silent', 'n-prints', 'n-takes', 'c-silent', 'c-newline', 'c-never', 'c-asks'].map(
        async id => [id, await sent(id, 'Go on with the plan', computer('Laptop'))]
      )
    )
  );
  check(
    t5['n-silent'].state === W.unconfirmed &&
      enters('n-silent') === 1 &&
      t5['n-prints'].state === W.unconfirmed &&
      enters('n-prints') === 1,
    'test 5: a CLI that cannot confirm gets one Enter and no more, silent or not → unconfirmed (' +
      enters('n-silent') +
      ', ' +
      enters('n-prints') +
      ')'
  );
  check(
    t5['n-takes'].state === W.sent && enters('n-takes') === 1,
    'test 5: … and when its task shows after that Enter → sent'
  );
  check(
    t5['c-silent'].state === W.sent && enters('c-silent') === 2,
    'test 5: a CLI that confirms and printed nothing since the Enter gets one more → sent (' +
      enters('c-silent') +
      ')'
  );
  check(
    t5['c-newline'].state === W.failed && enters('c-newline') === 1 && noted('c-newline'),
    'test 5: … but not when the panel printed since: one Enter, failed, marked as unsent (' +
      enters('c-newline') +
      ')'
  );
  check(
    t5['c-never'].state === W.failed && enters('c-never') === 3,
    'test 5: … and never more than three in all (' + enters('c-never') + ')'
  );
  check(
    t5['c-asks'].state === W.failed && enters('c-asks') === 1,
    'test 5: … and none once a question is open (' + enters('c-asks') + ')'
  );
  perms.length = 0;

  // ---- Test 6: one at a time per panel ----
  pane('two', 'Claude Code');
  const a1 = computer('Laptop'),
    a2 = computer('Laptop', { mark: '[Sent from Laptop] ' });
  const first = sent('two', 'First task', a1);
  await sleep(100);
  const second = await sent('two', 'Second task', a2);
  check(
    second.state === W.queued && pastes('two') === 1 && enters('two') === 0,
    'test 6: a second prompt 100 ms after the first, before its Enter → held, not written into the same input'
  );
  check(
    (await first).state === W.sent && turns.busy('two'),
    'test 6: the first is sent and its task runs'
  );
  await sleep(1800);
  check(
    pastes('two') === 1 &&
      heldFor('two').length === 1 &&
      heldFor('two')[0].why === 'busy' &&
      !a2.words.length,
    'test 6: nothing is typed into the working CLI; the second waits in the held list (why: ' +
      heldFor('two')[0]?.why +
      ')'
  );
  const endedAt = Date.now();
  finish('two');
  for (let i = 0; i < 60 && !a2.words.length; i++) await sleep(100);
  const w6 = writes.filter(([p]) => p === 'two');
  check(
    of('two')
      .filter(d => d.startsWith('\x1b[200~'))
      .pop() === '\x1b[200~[Sent from Laptop] Second task\x1b[201~',
    'a prompt that was held is written later with its mark in front, once (the mark is kept beside the held words)'
  );
  check(
    a2.words.join() === W.sent &&
      w6.length === 4 &&
      w6[0][1].includes('First task') &&
      w6[1][1] === '\r' &&
      w6[2][1].includes('Second task') &&
      w6[2][2] >= endedAt &&
      w6[3][1] === '\r',
    "test 6: after the first one's task ended the second is written, alone, and its sender hears sent (" +
      a2.words.join() +
      ')'
  );

  // … and the same when the first was never started: its text stays in the input and nothing is
  // typed behind it.
  pane('two-b', 'Claude Code');
  const b1 = computer('Laptop'),
    b2 = computer('Laptop');
  const firstB = sent('two-b', 'First task', b1);
  await sleep(50);
  b1.on = false;
  const rB = await firstB,
    secondB = await sent('two-b', 'Second task', b2);
  check(
    rB.state === W.failed && enters('two-b') === 0 && secondB.state === W.queued,
    'test 6: a first prompt left unsent in the input holds the second'
  );
  await sleep(1800);
  check(pastes('two-b') === 1, 'test 6: … which is not pasted behind it');
  userTypes('two-b', '\x03'); // this computer's user clears the input
  for (let i = 0; i < 60 && !b2.words.length; i++) await sleep(100);
  check(
    b2.words.join() === W.sent && pastes('two-b') === 2,
    'test 6: … and goes out once that input was cleared (' + b2.words.join() + ')'
  );

  // … and in the moment after the CLI said it took the first, before its task shows as started
  // ("a second prompt goes straight in").
  pane('gap', 'Claude Code', { lazyBusy: 1300 });
  const g2 = computer('Laptop');
  const firstG = await sent('gap', 'First task', computer('Laptop')),
    idleLooking = !turns.busy('gap') && !attention.hasDraft('gap'),
    secondG = await sent('gap', 'Second task', g2);
  check(
    firstG.state === W.sent && idleLooking && secondG.state === W.queued,
    'test 6: a second prompt right after the first was taken, while the agent still looks idle → held'
  );
  await sleep(1100);
  check(
    pastes('gap') === 1 && !turns.busy('gap'),
    "test 6: … and it stays held until the first one's task ended, though nothing else is in its way yet"
  );
  await sleep(500);
  finish('gap');
  for (let i = 0; i < 60 && !g2.words.length; i++) await sleep(100);
  check(
    g2.words.join() === W.sent && pastes('gap') === 2,
    'test 6: … then it goes out (' + g2.words.join() + ')'
  );

  // ---- Test 11: prompts already held when the right ends ----
  pane('off', 'Claude Code', { busy: true });
  const lap = computer('Laptop', { key: 'pair-1' }),
    lap2 = computer('Laptop', { key: 'pair-1' }),
    desk = computer('Laptop', { key: 'pair-2' }); // two computers of one name
  const h11 = [
    await sent('off', 'One', lap),
    await sent('off', 'Two', lap2),
    await sent('off', 'Three', desk),
  ];
  check(
    h11.every(r => r.state === W.queued) &&
      attention.remoteHeld('pair-1').length === 2 &&
      attention.remoteHeld('pair-1').every(h => h.paneId === 'off' && h.id) &&
      attention.remoteHeld('pair-2').length === 1,
    'test 11: the held prompts of one source can be listed, also when two computers share a name'
  );
  const dropped = attention.cancelRemote('pair-1');
  check(
    dropped === 2 &&
      lap.words.join() === W.failed &&
      lap2.words.join() === W.failed &&
      !attention.remoteHeld('pair-1').length &&
      attention.remoteHeld('pair-2').length === 1,
    "test 11: the switch goes off → its held prompts are removed at once and each is reported failed; another computer's stays"
  );
  finish('off');
  for (let i = 0; i < 60 && !desk.words.length; i++) await sleep(100);
  check(
    pastes('off') === 1 &&
      of('off')[0].includes('Three') &&
      !of('off').join('').includes('One') &&
      !of('off').join('').includes('Two'),
    'test 11: … and nothing of them is ever written'
  );
  pane('off-b', 'Claude Code', { busy: true });
  const gone1 = computer('Laptop');
  await sent('off-b', 'Held, then the right ends without a cancel', gone1);
  gone1.on = false;
  finish('off-b');
  await sleep(1500);
  check(
    gone1.words.join() === W.failed && of('off-b').length === 0 && !heldFor('off-b').length,
    'test 11 (Medium 1): the guard is asked again at the write: false → dropped, failed, nothing written'
  );
  pane('off-c', 'Claude Code', { busy: true });
  const gone2 = computer('Laptop');
  await sent('off-c', 'Held', gone2);
  gone2.on = false;
  check(
    attention.remoteRecheck() === 1 && gone2.words.join() === W.failed && !heldFor('off-c').length,
    'test 11: remoteRecheck drops every held prompt whose guard says no, at once'
  );

  // ---- Test 12: the panel was restarted, or its connection changed, while a prompt is held ----
  pane('restart', 'Claude Code', { busy: true });
  const rs = computer('Laptop');
  await sent('restart', 'For the agent that was here', rs);

  // a new process in the same panel; no exit event comes for the old one
  Object.assign(panes.get('restart'), { pid: 9001, startedAt: 2 });
  finish('restart');
  await sleep(1500);
  check(
    rs.words.join() === W.failed && of('restart').length === 0,
    'test 12: the panel was restarted while a prompt is held → dropped, nothing written into the new process (' +
      rs.words.join() +
      ')'
  );
  pane('switch', 'Claude Code', { busy: true });
  const sw = computer('Laptop');
  await sent('switch', 'For Claude Code', sw);
  panes.get('switch').agent = 'Codex'; // another connection in that panel
  finish('switch');
  await sleep(1500);
  check(
    sw.words.join() === W.failed && of('switch').length === 0,
    "test 12: the panel's connection changed → dropped, nothing written"
  );
  pane('restart-b', 'Claude Code', { busy: true });
  const rs2 = computer('Laptop');
  await sent('restart-b', 'Held', rs2);
  panes.get('restart-b').pid = 9002;
  check(
    attention.remoteRecheck() === 1 && rs2.words.join() === W.failed,
    'test 12: … and at once when remoteRecheck is called at the restart'
  );

  // ---- Test 29: a held remote prompt says where it came from, and removing it never fills this
  // computer's composer ----
  pane('list', 'Claude Code', { busy: true });
  const kitchen = computer('Kitchen laptop'),
    nameless = computer('');
  await sent('list', 'Text from the other computer', kitchen);
  await sent('list', 'Text from a computer without a name', nameless);
  const [l1, l2] = heldFor('list');
  check(
    l1?.from === 'Kitchen laptop' &&
      l1.remote === true &&
      l1.why === 'busy' &&
      l2?.from === 'another computer' &&
      l2.remote === true,
    "test 29: the held list shows the computer's name (" + [l1?.from, l2?.from].join(' | ') + ')'
  );
  const now29 = await attention.sendHeldNow(l1.id);
  check(
    now29.state === 'held' && of('list').length === 0 && heldFor('list').length === 2,
    'test 29: "Send now" overrides nothing for it: the agent works, so it stays held and nothing is written'
  );
  const c1 = attention.cancelHeld(l1.id),
    c2 = attention.cancelHeld(l2.id);
  check(
    c1.ok &&
      c1.text === '' &&
      c1.from === 'Kitchen laptop' &&
      c2.ok &&
      c2.text === '' &&
      kitchen.words.join() === W.failed &&
      nameless.words.join() === W.failed &&
      !heldFor('list').length,
    'test 29: removing it returns no text for the composer, with or without a name, and its sender hears failed'
  );

  // ---- Test 13, the 10-minute part: a held remote prompt is dropped whatever it waits for ----
  attention._test.remoteHoldMs(400);
  pane('old', 'Claude Code', { busy: true });
  pane('old-q', 'Claude Code');
  perms.push({ id: 'pp4', paneId: 'old-q', tool: 'Bash', detail: 'ls', at: Date.now() });
  const o1 = computer('Laptop'),
    o2 = computer('Laptop');
  await sent('old', 'Waits for a task', o1);
  await sent('old-q', 'Waits for a question', o2);
  attention._test.remoteHoldMs(10 * 60 * 1000);
  await sleep(700);
  check(
    o1.words.join() === W.failed &&
      o2.words.join() === W.failed &&
      !heldFor('old').length &&
      !heldFor('old-q').length &&
      !of('old').length &&
      !of('old-q').length,
    'test 13 (part): held for a working agent or for a question → dropped after the hold time, failed, never written'
  );
  perms.length = 0;

  // ---- What the path refuses before anything is written, and what it does to this computer's own
  // senders ----
  pane('word', 'Claude Code');
  pane('shell', 'Terminal');
  const refused = [];
  for (const text of ['!echo tnai', '/help', '  !whoami', '\n/clear', '#note', '', '   '])
    refused.push((await sent('word', text, computer('Laptop'))).state);
  check(
    refused.every(s => s === W.failed) && of('word').length === 0,
    'High 1, second lock: a text that does not start with a word is refused, nothing written (' +
      refused.length +
      ' cases)'
  );
  const shell = await sent('shell', 'Hello there', computer('Laptop')),
    nowhere = await sent('no-such-panel', 'Hello there', computer('Laptop')),
    typedCli = await sent('shell', 'Hello there', computer('Laptop'), { agent: 'Claude Code' });
  check(
    shell.state === W.failed &&
      typedCli.state === W.failed &&
      nowhere.state === W.failed &&
      of('shell').length === 0,
    'High 3, second lock: never into a Terminal panel, also with a CLI named for it'
  );
  const no = [
    await sent('word', 'Hello', computer('Laptop', { on: false })),
    await sent(
      'word',
      'Hello',
      computer('Laptop', {
        guard: () => {
          throw new Error('x');
        },
      })
    ),
    await sent('word', 'Hello', computer('Laptop', { guard: () => 'yes' })),
    await sent('word', 'Hello', { from: 'Laptop' }),
  ];
  check(
    no.every(r => r.state === W.failed) && of('word').length === 0 && !heldFor('word').length,
    'Medium 1: a guard that is false, throws, answers anything but true, or is missing → failed, nothing written or held'
  );
  pane('keys', 'Claude Code');
  pane('arrow', 'Claude Code');
  pane('report', 'Claude Code');
  pane('late-no', 'Claude Code');
  const k1 = sent('keys', 'Hello there', computer('Laptop')),
    k2 = sent('arrow', 'Hello there', computer('Laptop')),
    k3 = sent('report', 'Hello there', computer('Laptop'));
  const lateNo = computer('Laptop'),
    k4 = sent('late-no', 'Hello there', lateNo);
  await sleep(60);
  userTypes('keys', 'x');
  ptys.write('arrow', '\x1b[A');
  ptys.write('report', '\x1b[I');
  ptys.write('report', '\x1b]11;rgb:1b1b/1b1b/2424\x1b\\');
  ptys.write('report', '\x1b[12;40R');
  lateNo.on = false;
  const [rk1, rk2, rk3, rk4] = await Promise.all([k1, k2, k3, k4]);
  check(
    rk1.state === W.failed &&
      enters('keys') === 0 &&
      rk2.state === W.failed &&
      enters('arrow') === 0,
    'High 2: a key typed after the paste, an arrow too → no Enter, failed'
  );
  check(
    rk3.state === W.sent && enters('report') === 1,
    "High 2: the terminal's own reports (focus, a color answer, the cursor position) are not typing → sent"
  );
  check(
    rk4.state === W.failed && enters('late-no') === 0 && noted('late-no'),
    'Medium 1: the right ended between the paste and the Enter → no Enter, failed, marked as unsent'
  );
  pane('local', 'Claude Code');
  const flight = sent('local', 'Hello there', computer('Laptop'));
  await sleep(60);
  const msg = attention.holdIfDraft('local', {
      text: '[from Claude Code · Sable] hi',
      from: 'Claude Code · Sable',
      asap: true,
    }),
    own = attention.holdIfBlocked('local', { text: 'my own prompt' });
  check(
    msg?.state === 'held' && msg.reason === 'draft' && own?.state === 'held',
    "while its text is in the input, this computer's own messages and composer prompts for that panel wait instead of landing behind it"
  );
  check(
    (await flight).state === W.sent && !attention.hasDraft('local'),
    '… and the mark is gone once the CLI took it'
  );
  attention.cancelHeld(msg.heldId);
  attention.cancelHeld(own.heldId);
  pane('draft', 'Claude Code');
  for (const k of 'half a prompt') userTypes('draft', k);
  const dr = computer('Laptop'),
    rd = await sent('draft', 'Hello there', dr);
  check(
    rd.state === W.queued && pastes('draft') === 0 && heldFor('draft')[0]?.why === 'draft',
    "unsent text of this computer's user in the input → held, never merged into it"
  );

  // ---- This computer's own delivery is on
  // its way into that input ---- P1: the composer's prompt is pasted and waits for its Enter; a
  // prompt from the other computer arrives in that moment.
  {
    const until = async (fn, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fn()) return true;
        await sleep(50);
      }
      return false;
    };
    pane('own1', 'Claude Code');
    const own1 = submitter.submit('own1', '!git status', {
      paste: true,
      holdIfBlocked: true,
      holdIfBusy: true,
    });
    await sleep(60);
    const c1 = computer('Laptop'),
      r13 = await sent('own1', 'x; echo PWNED', c1);
    check(
      r13.state === W.queued &&
        pastes('own1') === 1 &&
        enters('own1') === 0 &&
        heldFor('own1').length === 1 &&
        heldFor('own1')[0].from === 'Laptop',
      'review 13, 1 (P1): a remote prompt that arrives between a local paste and its Enter is held, not pasted behind it'
    );
    const l13 = await own1;
    check(
      l13.state === 'sent' &&
        pastes('own1') === 1 &&
        enters('own1') === 1 &&
        of('own1')[0] === '\x1b[200~!git status\x1b[201~',
      'review 13, 1: the local delivery itself is as before: its own text, one Enter, "sent"'
    );
    finish('own1');
    await until(() => pastes('own1') === 2 && c1.words.length === 1, 4000);
    const o1w = of('own1'),
      second = o1w.findIndex((d, i) => i > 0 && d.startsWith('\x1b[200~'));
    check(
      c1.words[0] === W.sent &&
        second > 1 &&
        o1w.slice(1, second).includes('\r') &&
        o1w[second] === '\x1b[200~x; echo PWNED\x1b[201~',
      'review 13, 1: it goes in only after the local prompt was sent and its task ended: never two texts in one input (' +
        c1.words[0] +
        ')'
    );

    // P5: a CLI that gives no sign: the local path presses further Enters on its own. None of them
    // may follow remote text.
    pane('own5', 'Cursor Agent', { signals: false, needs: 3 });
    const own5 = submitter.submit('own5', 'local task', { paste: true });
    await sleep(700);
    const c5 = computer('Laptop'),
      e5 = enters('own5'),
      r5 = await sent('own5', 'Remote text', c5);
    check(
      r5.state === W.queued && pastes('own5') === 1 && e5 === 1,
      'review 13, 1 (P5): while the local path still presses its Enters, a remote prompt is held and nothing of it is written'
    );
    const l5 = await own5,
      atReturn = of('own5').slice();
    check(
      l5.ok === true &&
        atReturn.filter(d => d.startsWith('\x1b[200~')).length === 1 &&
        atReturn.filter(d => d === '\r').length === 3,
      'review 13, 1 (P5): every Enter of the local path was pressed with only its own text in the input (' +
        atReturn.filter(d => d === '\r').length +
        ' Enters, ' +
        l5.state +
        ')'
    );
    finish('own5');
    await until(() => c5.words.length === 1, 12000);
    check(
      pastes('own5') === 2 && Object.values(W).includes(c5.words[0]) && c5.words[0] !== W.queued,
      'review 13, 1 (P5): once the local delivery returned and its task ended, the held one goes (' +
        c5.words[0] +
        ')'
    );

    // The count ends with every way a local delivery returns: a panel whose process is gone, and
    // one that never takes the prompt.
    pane('own-gone', 'Claude Code');
    const og = submitter.submit('own-gone', 'x', { paste: true });
    await sleep(20);
    panes.get('own-gone').gone = true;
    await og;
    panes.get('own-gone').gone = false;
    check(
      (await sent('own-gone', 'Hello', computer('Laptop'))).state === W.sent,
      'review 13, 1: a local delivery that ended because its process stopped leaves nothing counted: the next remote prompt goes'
    );

    // A local delivery that starts no task (a slash command typed in): nothing else would wake the
    // held one, so the count's end does.
    pane('own-cmd', 'Claude Code', { needs: Infinity });
    const cmd = submitter.submit('own-cmd', '/status', { paste: false });
    await sleep(150);
    const cc = computer('Laptop'),
      rc = await sent('own-cmd', 'After the command', cc);
    const lc = await cmd;
    check(
      rc.state === W.queued && pastes('own-cmd') === 0 && lc.ok === true,
      'review 13, 1: a remote prompt waits for a local command that is being typed in (' +
        lc.state +
        ')'
    );
    check(
      await until(() => pastes('own-cmd') === 1, 4000),
      'review 13, 1: when that delivery returned without a task, the held prompt goes by itself'
    );
    await until(() => cc.words.length === 1, 15000);

    // ---- "unconfirmed" tells this computer's user, and its hold
    // ends ----
    attention._test.remoteHoldMs(900);
    pane('unc', 'Cursor Agent', { signals: false, needs: Infinity, silent: true });
    const ru = await sent('unc', 'Run the tests', computer('Laptop'));
    const mine = attention.holdIfBlocked('unc', { text: 'my own prompt' });
    check(
      ru.state === W.unconfirmed && enters('unc') === 1 && noted('unc') && mine?.state === 'held',
      'review 13, 5: one Enter and no sign: "unconfirmed", the panel shows the unsent-text note, and this computer\'s own prompt waits'
    );
    attention.cancelHeld(mine.heldId);
    await sleep(1100);
    check(
      !attention.hasDraft('unc') &&
        attention.holdIfBlocked('unc', { text: 'my own prompt' }) === null &&
        noted('unc'),
      'review 13, 5: the hold on the panel ends by itself after the time a held prompt gets (shortened here); the note stays until its user acts'
    );
    attention._test.remoteHoldMs(10 * 60 * 1000);
  }
  const fine = results.every(
    r => r && Object.keys(r).sort().join() === 'ok,state' && Object.values(W).includes(r.state)
  );
  check(
    fine && results.length > 40 && Object.values(W).join() === 'sent,queued,unconfirmed,failed',
    'Low 1: every result is { ok, state } with one of the four words and no reason text (' +
      results.length +
      ' results)'
  );
  check(
    [lap, lap2, desk, gone1, gone2, rs, sw, rs2, kitchen, nameless, o1, o2, a2, b2].every(
      c => c.words.length === 1 && Object.values(W).includes(c.words[0])
    ),
    'Low 1: onDone is called once per held prompt, with a word'
  );

  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})();
