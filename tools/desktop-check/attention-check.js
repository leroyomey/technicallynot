/*
 * Technically Not desktop check · attention-check.js — desktop/attention-service.js in plain Node:
 * the inferred question matcher on terminal output (Claude Code, Codex, Cursor Agent, OpenCode,
 * Gemini, shells; Claude Code's idle input box and ordinary output must NOT match), and the flow:
 * items from permissions / output / unsent / trust, composer prompts held while a pane is on a
 * question and delivered in order once it clears, typing clears inferred items, exit drops held
 * prompts, `tnai send` messages held while the user has unsent text in the input (draft from keys,
 * never from the screen) and delivered in order once it is sent or cleared. No CLI runs. Usage:
 * node tools/desktop-check/attention-check.js
 */
'use strict';
const attention = require('../../desktop/attention-service');
const { detectQuestion } = attention._test;

let failed = 0;
const check = (ok, name) => {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
};
const E = '\x1b[';
const box = lines =>
  [
    '╭' + '─'.repeat(50) + '╮',
    ...lines.map(l => '│ ' + l.padEnd(49) + '│'),
    '╰' + '─'.repeat(50) + '╯',
  ].join('\r\n');

const positive = {
  'Claude Code permission (boxed)': box([
    'Bash command',
    '  npm test',
    '  Run the tests',
    '',
    'Do you want to proceed?',
    `${E}36m❯ 1. Yes${E}39m`,
    "  2. Yes, and don't ask again for npm test commands",
    '  3. No, and tell Claude what to do differently (esc)',
  ]),
  'Claude Code edit (redrawn with cursor moves)': `${E}2K${E}1A${E}2K${E}G Edit file src/app.js\r\n Do you want to make this edit to app.js?\r\n ${E}1C❯ 1. Yes\r\n   2. Yes, allow all edits during this session (shift+tab)\r\n   3. No, and tell Claude what to do differently (esc)\r\n`,
  'Claude Code folder trust':
    ' Do you trust the files in this folder?\r\n\r\n C:\\work\\proj\r\n\r\n ❯ 1. Yes, proceed\r\n   2. No, exit\r\n\r\n Enter to confirm · Esc to exit\r\n',
  'Claude Code login picker':
    ' Select login method:\r\n\r\n ❯ 1. Claude account with subscription\r\n   2. Anthropic Console account\r\n   3. 3rd-party platform\r\n',
  'Codex run approval':
    "Would you like to run the following command?\r\n\r\n  $ npm test\r\n\r\n› 1. Yes, proceed (y)\r\n  2. Yes, and don't ask again for this command (a)\r\n  3. No, and tell Codex what to do differently (esc)\r\n",
  'Codex allow command': '  Allow command?\r\n  [y] Yes  [a] Always  [n] No\r\n',
  // Codex 0.162.1 at its start with a new hook, as the matcher reads it (from a real run): the
  // options that are not chosen arrive one word a line.
  'Codex hook choice at its start (words on their own lines)': [
    'Hooks need review',
    '1 hook is new or changed.',
    'Hooks can run outside the sandbox after you trust them.',
    '› 1. Review hooks',
    '2.',
    'Trust',
    'all',
    'and',
    'continue',
    '3.',
    'Continue',
    'without',
    'trusting',
    '(hooks',
    "won't",
    'run)',
    'enter confirm · esc skip',
  ].join('\r\n'),
  // Codex 0.162.1, the screen a profile shows whose hook was never trusted (from a real run).
  'Codex hook review':
    ' /hooks\r\n 1 hook needs review before it can run.\r\n› [!] 1 Unnamed hook · new\r\n   Event PreToolUse\r\n   Source User config - ~\\.codex\\tnai.config.toml\r\n   Command C:\\app\\agent-hooks\\codex-step.cmd\r\n   Mode Sync\r\n   Timeout 5s\r\n   Trust New hook - review required\r\n t trust · esc back\r\n',
  'Cursor Agent run': ' npm install\r\n Run this command?\r\n  → Run (y)   Skip (n)\r\n',
  'Gemini execution':
    " Allow execution of: 'ls -la'?\r\n ● 1. Yes, allow once\r\n   2. Yes, allow always\r\n   3. No, suggest changes (esc)\r\n",
  // GitHub Copilot 1.0.88: its logo animation keeps drawing (glyph-only lines) after the dialog.
  'Copilot folder trust (logo drawn after)':
    box([
      'Confirm folder trust',
      'Do you trust the files in this folder?',
      '❯ 1. Yes',
      '  2. Yes, and remember this folder',
      '  3. No (Esc)',
      '↑/↓ to navigate · enter to select · esc to cancel',
    ]) +
    [
      '',
      '╴╶',
      '▘▝',
      '─╮╭╮',
      '█ ▘▝▐',
      '▔',
      '╮╭─╮',
      '▘▝ █',
      '▔▔',
      '╴╶',
      '▘▝',
      '╴╶',
      '▘▝',
      '╴╶',
      '▘▝',
      '╴╶',
      '▘▝',
    ].join(`${E}1;1H`),
  'OpenCode permission':
    ' Permission required\r\n  bash: rm -rf build\r\n  Allow once   Allow always   Reject\r\n',
  'shell y/n': 'Remove all files? (y/n) ',
  'shell [Y/n]': 'After this operation, 12 MB will be used.\r\nDo you wish to continue? [Y/n] ',
  'press Enter': 'Setup finished.\r\nPress Enter to continue...',
  'generic numbered selector': ' Which project?\r\n  1. api\r\n ❯ 2. web\r\n',
};
const negative = {
  'Claude Code idle input box': box(['> ']) + '\r\n  ? for shortcuts\r\n',
  'Claude Code idle box with typed text':
    box(['> fix the login bug']) +
    '\r\n  ? for shortcuts                    Bypassing Permissions\r\n',
  'answered permission, then idle box':
    box(['Do you want to proceed?', '❯ 1. Yes', '  2. No']) +
    '\r\n⏺ Bash(npm test)\r\n  ⎿  passed\r\n' +
    box(['> ']) +
    '\r\n  ? for shortcuts\r\n',
  'Claude Code busy': '⏺ Reading files…\r\n✻ Thinking… (12s · esc to interrupt)\r\n',
  'numbered list in agent output (no pointer)':
    'Next steps:\r\n1. Install deps\r\n2. Run the build\r\n3. Deploy\r\n',
  'PowerShell prompt': 'PS C:\\work\\proj> ',
  'y/n far above the prompt':
    'Overwrite? (y/n) y\r\ncopied 3 files\r\nline a\r\nline b\r\nPS C:\\work> ',
  'Codex idle composer after a question in its answer':
    'Do you want to proceed with option 2?\r\n\r\n› Ask Codex to do anything\r\n  100% context left · ? for shortcuts\r\n',
  'Codex idle composer after its hook review was answered':
    ' 1 hook needs review before it can run.\r\n t trust · esc back\r\n\r\n› Ask Codex to do anything\r\n  100% context left · ? for shortcuts\r\n',
  'Cursor Agent idle input after a question in its answer (real screen 2026-10-05)':
    '  Do you want to proceed with the count?\r\n\r\n  → Add a follow-up\r\n\r\n  Grok 4.7 256K Medium · 10.5%            Run Everything\r\n  ~\\work\\proj\r\n',
  'empty': '',
};
for (const [name, raw] of Object.entries(positive)) {
  const q = detectQuestion(raw);
  check(
    !!q && q.detail.length > 0 && q.detail.length <= 100,
    'matches: ' + name + (q ? '  → "' + q.detail + '"' : '')
  );
}
{
  const review = detectQuestion(positive['Codex hook review']);
  check(
    /press t to trust it/.test(review?.detail || '') && /Esc/.test(review?.detail || ''),
    'the Codex hook review says which key answers it: "' + (review?.detail || '') + '"'
  );
}
{
  const start = detectQuestion(
    positive['Codex hook choice at its start (words on their own lines)']
  );
  check(
    /choose 2 to trust it, 3 to go on without/.test(start?.detail || ''),
    'the Codex hook choice says which numbers answer it: "' + (start?.detail || '') + '"'
  );
}
for (const [name, raw] of Object.entries(negative)) {
  const q = detectQuestion(raw);
  check(!q, 'no match: ' + name + (q ? '  → "' + q.detail + '"' : ''));
}

// ---- Flow with fakes ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
const events = [],
  sent = [],
  perms = [],
  waiters = new Map();
const hooks = { pendingPermissions: () => perms.slice() };
const working = new Set(),
  endFns = []; // panes whose agent is on a task; finish(id) ends it as agent-turns.js does
const turns = {
  onSubmit(paneId, fn) {
    waiters.set(paneId, fn);
    return () => waiters.delete(paneId);
  },
  busy: id => working.has(id),
  onEnd(fn) {
    endFns.push(fn);
  },
};
const finish = id => {
  working.delete(id);
  endFns.forEach(fn => fn(id));
};
attention.init((channel, payload) => events.push([channel, payload]), {
  turns,
  hooks,
  submit: async (paneId, text, opts) => {
    sent.push([paneId, text, opts]);
    return { ok: true, state: 'sent' };
  },
  window: () => null,
  cli: id =>
    ({ N: 'Claude Code', O: 'Codex', CE: 'Claude Code', CQ: 'Claude Code', XE: 'Codex' })[id] ||
    null,
});
const last = () => [...events].reverse().find(([c]) => c === 'attention:change')?.[1];
const delivered = () => events.filter(([c]) => c === 'attention:delivered').map(([, p]) => p);

(async () => {
  // Permission holds, clears → delivered after the settle time, in order.
  perms.push({ id: 'p1', paneId: 'A', tool: 'Bash', detail: 'npm test', at: Date.now() });
  attention.permissionChanged({ paneId: 'A' });
  const h1 = attention.holdIfBlocked('A', { text: 'first', paste: true });
  const h2 = attention.holdIfBlocked('A', { text: 'second', paste: true });
  check(
    h1?.state === 'held' && h1.reason === 'permission' && h2?.state === 'held',
    'permission open → prompts held (reason permission)'
  );
  check(attention.holdIfBlocked('B', { text: 'x' }) === null, 'a clear pane is not held');
  await sleep(20);
  check(
    last()?.items.some(i => i.kind === 'permission' && i.paneId === 'A' && !i.inferred) &&
      last()?.held.length === 2,
    'attention:change lists the permission and 2 held prompts'
  );
  perms.length = 0;
  attention.permissionChanged({ paneId: 'A', done: true });
  await sleep(2200);
  check(
    sent.map(s => s[1]).join(',') === 'first,second' &&
      delivered().length === 2 &&
      delivered().every(d => d.result.state === 'sent'),
    'cleared → both delivered in order via submit'
  );

  // Menu inferred from output after quiet; the user typing clears it; held prompt then delivered.
  attention.output([{ paneId: 'C', data: positive['Codex run approval'] }]);
  await sleep(700);
  const menu = attention.list().items.find(i => i.paneId === 'C');
  check(
    menu?.kind === 'menu' && menu.inferred === true,
    'menu item from output after 600 ms quiet (inferred)'
  );
  const h3 = attention.holdIfBlocked('C', { text: 'third' });
  check(
    h3?.reason === 'menu' && /run the following command/.test(h3.detail),
    'held with the question as detail'
  );
  attention.typed('C', '\x1b[I'); // a focus report is not typing
  check(!!attention.blocker('C'), 'focus report keeps the menu');
  attention.typed('C', 'y');
  await sleep(1000);
  check(sent.at(-1)?.[1] === 'third', 'typing clears the menu → held prompt delivered');
  attention.output([{ paneId: 'C', data: '\r\nRunning npm test…\r\n' }]);
  await sleep(700);
  check(!attention.blocker('C'), 'answered question left in scrollback does not come back');
  attention.output([{ paneId: 'C', data: box(['> ']) + '\r\n  ? for shortcuts\r\n' }]);
  await sleep(700);
  check(!attention.list().items.some(i => i.paneId === 'C'), 'idle input box output → no item');

  // Cancel returns the text; exit drops held prompts with a gone result.
  perms.push({ id: 'p2', paneId: 'D', tool: 'Edit', detail: 'a.js', at: Date.now() });
  const h4 = attention.holdIfBlocked('D', { text: 'cancel me' });
  const back = attention.cancelHeld(h4.heldId);
  check(
    back.ok && back.text === 'cancel me' && !attention.list().held.length,
    'cancelHeld returns the text'
  );
  const h5 = attention.holdIfBlocked('D', { text: 'dropped' });
  attention.exited('D');
  check(
    delivered().some(d => d.heldId === h5.heldId && d.result.state === 'gone'),
    'exit drops held prompts (delivered gone)'
  );
  const h6 = attention.holdIfBlocked('D', { text: 'now' });
  const now = await attention.sendHeldNow(h6.heldId);
  check(
    now.state === 'sent' && sent.at(-1)?.[1] === 'now',
    'sendHeldNow submits despite the question'
  );
  perms.length = 0;

  // Unsent: set, cleared by the next confirmed submit. Trust: set and answered.
  attention.unsent('E', 'hello there');
  check(
    attention.list().items.some(i => i.paneId === 'E' && i.kind === 'unsent'),
    'unsent item'
  );
  waiters.get('E')?.();
  check(!attention.list().items.some(i => i.paneId === 'E'), 'confirmed submit clears unsent');
  attention.trustAsked('F', 'Trust "proj" for Codex?');
  check(attention.holdIfBlocked('F', { text: 't' })?.reason === 'trust', 'trust dialog holds');
  attention.exited('F');
  check(
    attention.notify({ paneId: 'A', title: 't', body: 'b' }) === false,
    'notify without a window → false'
  );

  // No window flash (Windows flashes the border with the taskbar button).
  // The code must not call it again.
  check(
    !/\.flashFrame\(/.test(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'desktop', 'attention-service.js'),
        'utf8'
      )
    ),
    'notify never flashes the window'
  );

  // Draft: a `tnai send` message is never merged into text the user typed and has not sent (bug
  // seen 2026-09-26 with Codex Finch).
  const outcomes = [];
  const meshHold = (paneId, text) =>
    attention.holdIfDraft(paneId, {
      text,
      from: 'Claude Code · Sable',
      onDone: r => outcomes.push([text, r.state]),
    });
  check(meshHold('G', 'm0') === null, 'empty input → not held (normal fast path)');
  attention.output([
    {
      paneId: 'G',
      data: '› Ask Codex to do anything\r\n  100% context left · ? for shortcuts\r\n',
    },
  ]);
  check(!attention.hasDraft('G'), "the CLI's placeholder on screen is not user text");
  for (const k of 'Check the marketing docs') attention.typed('G', k);
  check(attention.hasDraft('G'), 'keys typed without Enter → unsent draft');
  const m1 = meshHold('G', 'm1'),
    m2 = meshHold('G', 'm2');
  check(
    m1?.state === 'held' && m1.reason === 'draft' && m2?.state === 'held',
    'message for an input with unsent text → held (reason draft), second one queued behind it'
  );
  check(
    attention.list().held.some(h => h.id === m1.heldId && h.from === 'Claude Code · Sable'),
    'held list says who sent it'
  );
  const before = sent.length;
  await sleep(1200);
  check(sent.length === before, 'nothing typed into the input while the draft is there');
  attention.typed('G', '\r');
  check(!attention.hasDraft('G'), 'Enter sends the draft');
  await sleep(2200);
  check(
    sent
      .slice(before)
      .map(s => s[1])
      .join(',') === 'm1,m2' && outcomes.map(o => o.join(':')).join(',') === 'm1:sent,m2:sent',
    'after the user sends it → both messages delivered in order, sender told'
  );

  // Backspace, Ctrl+U, a paste with a line break, Shift+Enter, cursor keys, Ctrl+C.
  attention.typed('H', 'ab');
  attention.typed('H', '\x7f');
  attention.typed('H', '\x7f');
  check(!attention.hasDraft('H'), 'typed then backspaced away → empty');
  attention.typed('H', '\x1b[200~line1\rline2\x1b[201~');
  check(attention.hasDraft('H'), 'a paste (its line break is not Enter) → draft');
  attention.typed('H', '\x1b[D');
  attention.typed('H', '\x1b\r');
  check(attention.hasDraft('H'), 'cursor key / Shift+Enter keep the draft');
  attention.typed('H', '\x15');
  check(!attention.hasDraft('H'), 'Ctrl+U clears it');
  attention.typed('H', 'x');
  attention.typed('H', '\x03');
  check(!attention.hasDraft('H'), 'Ctrl+C clears it');

  // Each CLI's own clear keys (Claude Code 2.1.283 docs, Codex 0.157 tui source): a missed clear
  // holds the message, a false clear merges it.
  attention.typed('N', 'stash me');
  attention.typed('N', '\x13');
  check(!attention.hasDraft('N'), 'Claude Code: Ctrl+S stashes the text → input empty');
  attention.typed('N', '\x13');
  check(attention.hasDraft('N'), 'Claude Code: Ctrl+S on an empty input brings the stash back');
  attention.typed('N', '\x1b');
  attention.typed('N', '\x1b');
  check(!attention.hasDraft('N'), 'Claude Code: Esc Esc clears');
  attention.typed('N', 'undo me');
  attention.typed('N', '\x15');
  check(!attention.hasDraft('N'), 'Claude Code: Ctrl+U on one line clears');
  attention.typed('N', '\x1f');
  check(attention.hasDraft('N'), 'Claude Code: Ctrl+_ undoes the clear');
  attention.typed('N', '\x15');
  attention.typed('N', '\x19');
  check(attention.hasDraft('N'), 'Claude Code: Ctrl+Y pastes the deleted line back');
  attention.typed('N', '\x03');
  attention.typed('O', 'two');
  attention.typed('O', '\x1b\x0d');
  attention.typed('O', 'lines');
  attention.typed('O', '\x15');
  check(attention.hasDraft('O'), 'Codex: Ctrl+U deletes only the last line of a multi-line draft');
  attention.typed('O', '\x15');
  attention.typed('O', '\x15');
  check(!attention.hasDraft('O'), 'Codex: Ctrl+U again takes the line break, then the first line');
  attention.typed('O', '\x19');
  check(attention.hasDraft('O'), 'Codex: Ctrl+Y pastes it back');
  attention.typed('O', '\x1b');
  attention.typed('O', '\x1b');
  check(attention.hasDraft('O'), 'Codex: Esc Esc does not clear its input');
  const m7 = meshHold('O', 'm7'),
    before7 = sent.length;
  await sleep(1200);
  check(
    m7?.state === 'held' && sent.length === before7,
    '…so a message for it stays held, not merged'
  );
  attention.typed('O', '\x03');
  await sleep(1200);
  check(
    !attention.hasDraft('O') && outcomes.some(o => o.join(':') === 'm7:sent'),
    'Codex: Ctrl+C clears → held message delivered'
  );

  // History recall right after a clear fills the input with text the keys never showed: held, never
  // merged (Up, Ctrl+R, Codex Esc Esc).
  attention.typed('N', 'mine');
  attention.typed('N', '\x1b');
  attention.typed('N', '\x1b');
  attention.typed('N', '\x1b[A');
  check(attention.hasDraft('N'), 'Claude Code: Up right after Esc Esc recalls a prompt → draft');
  const m8 = meshHold('N', 'm8'),
    before8 = sent.length;
  attention.typed('N', '\x7f');
  attention.typed('N', '\x17');
  attention.typed('N', '\x15');
  await sleep(1200);
  check(
    m8?.state === 'held' && sent.length === before8,
    '…deletes of unknown length never empty it, so the message stays held'
  );
  attention.typed('N', '\x1b');
  attention.typed('N', '\x1b');
  await sleep(1200);
  check(
    !attention.hasDraft('N') && outcomes.some(o => o.join(':') === 'm8:sent'),
    '…Esc Esc clears it → delivered'
  );
  attention.typed('N', '\x1bOB');
  check(attention.hasDraft('N'), 'Down (application cursor keys) recalls too');
  attention.typed('N', '\x03');
  attention.typed('N', '\x12');
  check(attention.hasDraft('N'), 'Ctrl+R history search counts as recalled text');
  attention.typed('N', '\r');

  // The screen wins over the count (71 reads the CLI's input box): a draft the input does not show
  // is dropped and the held message goes out.
  attention.typed('N', 'ghost');
  const m9 = meshHold('N', 'm9'),
    before9 = sent.length;
  check(
    m9?.state === 'held' && attention.inputEmpty('N') === false && attention.hasDraft('N'),
    'input read as empty right after a key: not believed yet'
  );
  await sleep(1600);
  check(
    attention.inputEmpty('N') === true && !attention.hasDraft('N'),
    'input read as empty once the keys rested → the counted draft is dropped'
  );
  await sleep(1200);
  check(
    sent.length === before9 + 1 && outcomes.some(o => o.join(':') === 'm9:sent'),
    '…and the held message is delivered'
  );
  check(attention.inputEmpty('N') === false, 'no draft: nothing to drop');

  // Claude Code keys that left a count the input did not show (measured on a real one: desktop test
  // real-draft-keys, 2026-10-05).
  const fresh = () => {
    attention.typed('N', '\x03');
    return attention.hasDraft('N');
  };
  fresh();
  attention.typed('N', 'one two three');
  attention.typed('N', '\b');
  attention.typed('N', '\b');
  check(attention.hasDraft('N'), 'Claude Code: Ctrl+Backspace x2 on three words → one word left');
  attention.typed('N', '\b');
  check(!attention.hasDraft('N'), '…a third takes the last word: no draft');
  attention.typed('N', '?');
  check(
    !attention.hasDraft('N'),
    'Claude Code: "?" on an empty input opens the shortcuts: no draft'
  );
  attention.typed('N', 'a?');
  check(attention.hasDraft('N'), '…"?" after text is text');
  fresh();
  attention.typed('N', '\x12');
  attention.typed('N', 'zq');
  attention.typed('N', '\x1b');
  check(
    !attention.hasDraft('N'),
    'Claude Code: Ctrl+R, search words, Esc on an empty input → no draft'
  );
  attention.typed('N', 'kept');
  attention.typed('N', '\x12');
  attention.typed('N', '\x1b');
  check(attention.hasDraft('N'), '…Ctrl+R then Esc on text: the text is still there');
  fresh();
  attention.typed('N', 'kill line');
  attention.typed('N', '\x01');
  attention.typed('N', '\x0b');
  check(!attention.hasDraft('N'), 'Claude Code: Ctrl+A then Ctrl+K clears the line');
  attention.typed('N', 'kill line');
  attention.typed('N', '\x0b');
  check(attention.hasDraft('N'), '…Ctrl+K at the end of the text deletes nothing');
  fresh();
  attention.typed('N', '/he');
  attention.typed('N', '\t');
  attention.typed('N', '\x7f\x7f\x7f');
  check(attention.hasDraft('N'), 'Tab completed the command: Backspace x3 does not empty it');
  fresh();
  attention.typed('N', 'line one\\');
  attention.typed('N', '\r');
  check(
    attention.hasDraft('N'),
    'Claude Code: backslash then Enter is a new line, the text is still unsent'
  );
  fresh();

  // A cursor move before deletes: the deletes may leave text the keys can't place, so they never
  // empty the input.
  attention.typed('N', 'ab');
  attention.typed('N', '\x1b[D');
  attention.typed('N', '\x7f');
  attention.typed('N', '\x7f');
  check(
    attention.hasDraft('N'),
    'Claude Code: Left then Backspace ×2 on "ab" → still a draft (a "b" is left)'
  );
  attention.typed('N', '\x1b');
  attention.typed('N', '\x1b');
  check(!attention.hasDraft('N'), '…Esc Esc clears it');
  attention.typed('O', 'one\ntwo');
  attention.typed('O', '\x01');
  attention.typed('O', '\x15');
  attention.typed('O', '\x15');
  check(attention.hasDraft('O'), 'Codex: Ctrl+A then Ctrl+U ×2 → still a draft');
  attention.typed('O', '\x1b[H');
  attention.typed('O', '\x0b');
  attention.typed('O', '\x03');
  check(!attention.hasDraft('O'), '…Ctrl+C clears it');
  attention.typed('N', '\x1b[D');
  check(!attention.hasDraft('N'), 'Left on an empty input → no draft');
  attention.typed('N', 'x');
  attention.typed('N', '\x02');
  attention.typed('N', '\x7f');
  check(!attention.hasDraft('N'), 'Claude Code: Ctrl+B (background task) is not a cursor move');
  attention.typed('O', '\x1b');
  attention.typed('O', '\x1b');
  check(
    attention.hasDraft('O'),
    'Codex: Esc Esc on an empty input brings the previous message back → draft'
  );
  attention.typed('O', '\x03');
  perms.push({ id: 'p4', paneId: 'N', tool: 'Bash', detail: 'ls', at: Date.now() });
  attention.typed('N', '\x1b[B');
  check(
    !attention.hasDraft('N') && !!attention.blocker('N'),
    'Down on an open question moves the choice: no draft, question kept'
  );
  perms.length = 0;

  // The CLI confirming a submitted prompt empties it; cancel tells the sender and gives no composer
  // text back.
  attention.typed('I', 'draft');
  const m3 = meshHold('I', 'm3');
  waiters.get('I')?.();
  check(!attention.hasDraft('I'), 'CLI-confirmed submit empties the draft');
  await sleep(1000);
  check(
    outcomes.some(o => o.join(':') === 'm3:sent'),
    '…and the held message goes'
  );
  attention.typed('J', 'draft');
  const m4 = meshHold('J', 'm4');
  const c4 = attention.cancelHeld(m4.heldId);
  check(
    c4.ok && c4.text === '' && outcomes.some(o => o.join(':') === 'm4:cancelled'),
    'cancel: sender told, nothing goes into the composer'
  );

  // Keys pressed on an open question answer it; they are not draft text.
  perms.push({ id: 'p3', paneId: 'K', tool: 'Bash', detail: 'ls', at: Date.now() });
  attention.typed('K', 'y');
  check(!attention.hasDraft('K'), 'a key answering a permission question is not a draft');
  perms.length = 0;
  check(meshHold('L', 'x') === null, 'untouched pane → not held');

  // Never sent or cleared → dropped after the hold time, sender told "not delivered".
  attention._test.draftHoldMs(300);
  attention.typed('M', 'left here');
  const m6 = meshHold('M', 'm6');
  await sleep(500);
  check(
    outcomes.some(o => o.join(':') === 'm6:expired') &&
      !attention.list().held.some(h => h.id === m6.heldId) &&
      delivered().some(d => d.heldId === m6.heldId && d.result.state === 'expired'),
    'draft never sent → message expires, not typed in, sender told'
  );

  // A working agent holds prompts too: send now, cancel (edit / remove),
  // or delivery in order once its task ends.
  working.add('W');
  const w1 = attention.holdIfBlocked('W', { text: 'w1', ifBusy: true }),
    w2 = attention.holdIfBlocked('W', { text: 'w2', ifBusy: true });
  working.add('X');
  check(
    attention.holdIfBlocked('X', { text: 'system' }) === null,
    'a prompt that did not ask for it (resume, upkeep) is not held for a working agent'
  );
  working.delete('X');
  const w3 = attention.holdIfDraft('W', {
    text: 'w3',
    from: 'Claude Code · Sable',
    onDone: r => outcomes.push(['w3', r.state]),
  });
  check(
    w1?.state === 'held' && w1.reason === 'busy' && w2?.reason === 'busy' && w3?.reason === 'busy',
    'working agent: composer prompts and an agent message are held (busy)'
  );
  check(
    attention.holdIfDraft('W', { text: 'ask', from: 'x', asap: true }) === null,
    'a `tnai ask` question (asap) is not held for a working agent'
  );
  const wl = attention.list().held.filter(h => h.paneId === 'W');
  check(
    wl.length === 3 &&
      wl.every(h => h.why === 'busy') &&
      wl[0].text === 'w1' &&
      wl[2].from === 'Claude Code · Sable',
    'the pushed list carries each one’s full text, sender and why it waits'
  );
  const quietAt = sent.length;
  await sleep(1100);
  check(sent.length === quietAt, 'nothing is delivered while the task runs');
  const now2 = await attention.sendHeldNow(w2.heldId);
  check(
    now2.state === 'sent' &&
      sent.at(-1)?.[1] === 'w2' &&
      attention.list().held.filter(h => h.paneId === 'W').length === 2,
    'Send now delivers that one while the agent works; the others stay'
  );
  const gone = attention.cancelHeld(w1.heldId);
  check(
    gone.ok &&
      gone.text === 'w1' &&
      attention.list().held.filter(h => h.paneId === 'W').length === 1,
    'cancel takes one out and returns its text (edit / remove)'
  );
  await sleep(700);
  check(!outcomes.some(o => o[0] === 'w3'), 'a busy-held agent message never expires');
  finish('W');
  await sleep(1100);
  check(
    sent.at(-1)?.[1] === 'w3' &&
      outcomes.some(o => o.join(':') === 'w3:sent') &&
      !attention.list().held.some(h => h.paneId === 'W'),
    'task ended → the rest is delivered, sender told'
  );
  check(
    attention.holdIfBlocked('W', { text: 'idle', ifBusy: true }) === null,
    'an idle agent is not held'
  );

  // Speed audit item 3: when a Claude Code task ends, prompts held only for that task go after
  // END_SETTLE_MS (150 ms), not the 800 ms settle. Codex, and a prompt first held for a question,
  // keep the full settle.
  working.add('CE');
  working.add('XE');
  working.add('CQ');
  attention.holdIfBlocked('CE', { text: 'ce', ifBusy: true });
  attention.holdIfDraft('CE', { text: 'ce-msg', from: 'Claude Code · Sable' });
  attention.holdIfBlocked('XE', { text: 'xe', ifBusy: true });
  perms.push({ id: 'pq', paneId: 'CQ', tool: 'Bash', detail: 'npm test', at: Date.now() });
  attention.permissionChanged({ paneId: 'CQ' });
  attention.holdIfBlocked('CQ', { text: 'cq', ifBusy: true });
  perms.length = 0;
  attention.permissionChanged({ paneId: 'CQ', done: true });
  await sleep(50);
  const sentTo = id => sent.filter(s => s[0] === id).map(s => s[1]);
  finish('CE');
  finish('XE');
  finish('CQ');
  await sleep(400);
  check(
    sentTo('CE').join(',') === 'ce',
    'Claude Code task ended: a prompt held only for its task goes within 400 ms (sent: ' +
      sentTo('CE').join(',') +
      ')'
  );
  check(
    sentTo('XE').length === 0 && sentTo('CQ').length === 0,
    'Codex, and a Claude Code prompt first held for a question, still wait the full settle'
  );
  await sleep(700);
  check(
    sentTo('XE').join(',') === 'xe' && sentTo('CQ').join(',') === 'cq',
    'Codex and the question-held prompt go after the full settle'
  );
  await sleep(900);
  check(
    sentTo('CE').join(',') === 'ce,ce-msg',
    'the next held one for Claude Code follows in order (sent: ' + sentTo('CE').join(',') + ')'
  );

  // The app's own typed-in messages (file-lock and team notices, a sub-agent's task or report) are
  // never merged into the user's unsent text either, and nothing is typed into a panel while the
  // user dictates (a message landed in the prompt being written).
  const appHold = (paneId, text, keep) =>
    attention.holdIfDraft(paneId, { text, from: 'Technically Not', asap: true, keep });
  check(appHold('P', 'n0') === null, 'app notice to an empty input → typed straight in, as before');
  working.add('P');
  check(
    appHold('P', 'n0b') === null,
    'app notice to a working agent with an empty input → not held, as before'
  );
  working.delete('P');
  for (const k of 'half a prompt') attention.typed('P', k);
  attention._test.draftHoldMs(400);
  const n1 = appHold('P', 'notice'),
    n2 = appHold('P', 'report', true);
  attention._test.draftHoldMs(10 * 60 * 1000);
  check(
    n1?.state === 'held' && n1.reason === 'draft' && n2?.state === 'held',
    'app notice and sub-agent report for an input with unsent text → held'
  );
  const pAt = sent.length;
  await sleep(1300);
  check(sent.length === pAt, 'neither is typed into the unsent text');
  check(
    delivered().some(d => d.heldId === n1.heldId && d.result.state === 'expired') &&
      attention.list().held.some(h => h.id === n2.heldId),
    'a stale notice is dropped; a report (keep) is never dropped'
  );
  attention.typed('P', '\r');
  await sleep(1100);
  check(sent.at(-1)?.[1] === 'report', 'the user sent their text → the report is delivered');

  attention.voice(true);
  const v1 = appHold('V', 'while speaking'),
    v2 = attention.holdIfDraft('V', { text: 'agent msg', from: 'Claude Code · Sable' });
  check(
    v1?.state === 'held' &&
      v1.reason === 'draft' &&
      /speaking/.test(v1.detail) &&
      v2?.state === 'held' &&
      attention.hasDraft('V'),
    'voice key down → messages for a panel are held though no key was pressed'
  );
  attention.voice(true);

  // a second press started and ended while the first clip is still transcribed
  attention.voice(false);
  const vAt = sent.length;
  await sleep(1100);
  check(
    sent.length === vAt,
    'nothing is typed in while the user speaks or the clip is transcribed'
  );

  // 70 types the words in, then says it is done
  attention.typed('V', '\x1b[200~the spoken words\x1b[201~');
  attention.voice(false);
  await sleep(1100);
  check(
    sent.length === vAt && attention.hasDraft('V'),
    'the spoken words are now unsent text: the messages keep waiting'
  );
  attention.typed('V', '\r');
  await sleep(2200);
  check(
    sent
      .slice(vAt)
      .map(s => s[1])
      .join(',') === 'while speaking,agent msg',
    'the user sent the spoken prompt → the messages are delivered in order'
  );
  attention.voice(true);
  const v3 = appHold('V', 'nothing heard');
  attention.voice(false);
  await sleep(1100);
  check(
    v3?.state === 'held' && sent.at(-1)?.[1] === 'nothing heard' && !attention.hasDraft('V'),
    'voice ended with nothing typed → the held message goes out'
  );
  const src = f =>
    require('fs').readFileSync(require('path').join(__dirname, '..', '..', f), 'utf8');

  // main.js sends three app notices this way: the file-lock notice, the team notice and (since
  // 0.3.72) the note that an agent was renamed
  check(
    (src('desktop/main.js').match(/holdIfDraft: APP_NOTICE/g) || []).length === 3 &&
      /submit\(paneId, body, \{ holdIfDraft:/.test(src('desktop/agent-graph.js')),
    'file-lock notice, team notice, rename note and graph prompts are sent with holdIfDraft'
  );
  const v70 = src('src/scripts/70-voice-prompt.js');
  check(
    (v70.match(/speaking\(true\)/g) || []).length === 1 &&
      (v70.match(/speaking\(false\)/g) || []).length === 2,
    'voice script: one start signal per press, an end signal on both ways out'
  );

  // An OpenCode question its own server reported (opencode-link.js, a stand-in server): it blocks
  // like a menu, is not inferred, replaces the screen's guess, holds a composer prompt and lets it
  // go once answered.
  {
    const link = require('../../desktop/opencode-link'),
      oc = await require('./opencode-stand-in').standIn('pw').listen();
    link.tune({ first: 20, retryMin: 40, retryMax: 200 }, ['9.9.9']);
    link.attach('OC', oc.port, 'pw');
    for (let i = 0; i < 100 && !link.state('OC')?.connected; i++) await sleep(30);
    attention.output({
      paneId: 'OC',
      data: ' Which database?\r\n  1. SQLite\r\n❯ 2. Postgres\r\n',
    }); // the same question as the screen shows it
    oc.send('question.asked', {
      id: 'que_1',
      sessionID: 'ses_1',
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [{ label: 'SQLite' }, { label: 'Postgres' }],
        },
      ],
    });
    for (let i = 0; i < 100 && !attention.blocker('OC'); i++) await sleep(30);
    await sleep(900);
    const b = attention.blocker('OC'),
      mine = attention.list().items.filter(i => i.paneId === 'OC');
    check(
      b?.kind === 'menu' && b.detail === 'Which database?',
      'OpenCode question from its server → the panel is blocked (menu)'
    );
    check(
      mine.length === 1 && mine[0].id === 'question:que_1' && mine[0].inferred === false,
      'listed once, not inferred (the screen’s guess of the same question is left out): ' +
        JSON.stringify(mine.map(i => [i.id, i.inferred]))
    );
    const before = sent.length,
      held = attention.holdIfBlocked('OC', { text: 'after the question', paste: true });
    check(held?.state === 'held', 'a composer prompt is held while the OpenCode question is open');

    // An app message (asap) and an agent's message must not
    // be typed into a panel that waits on a question either; their Enter would answer it.
    const report = attention.holdIfDraft('OC', {
        text: 'a report',
        from: 'Technically Not',
        asap: true,
        keep: true,
      }),
      fromAgent = attention.holdIfDraft('OC', { text: 'agent msg', from: 'Claude Code · Sable' });
    await sleep(1300);
    check(
      report?.state === 'held' &&
        report.reason === 'menu' &&
        fromAgent?.state === 'held' &&
        sent.length === before,
      'an app message (asap) and an agent message are held while the question is open; nothing is typed: ' +
        JSON.stringify([report?.reason, fromAgent?.reason, sent.length - before])
    );
    oc.send('question.replied', { sessionID: 'ses_1', requestID: 'que_1', answers: [['SQLite']] });
    attention.typed('OC', '\r'); // the answer's key also clears the screen's guess
    await sleep(2400);
    check(
      !attention.blocker('OC') && sent[before]?.[1] === 'after the question',
      'answered → no longer blocked, the held prompt is delivered'
    );
    for (let i = 0; i < 80 && sent.length < before + 3; i++) await sleep(100);
    check(
      sent
        .slice(before)
        .map(s => s[1])
        .join('|') === 'after the question|a report|agent msg',
      'then the held messages go out, in order: ' +
        sent
          .slice(before)
          .map(s => s[1])
          .join('|')
    );
    link.close('OC');
    await oc.close();
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall ok');
  process.exit(failed ? 1 : 0);
})();
