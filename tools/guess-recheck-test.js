// Test of a guessed question being read again (bug sweep 2026-10-28, helpers-click):
// node tools/guess-recheck-test.js
//
// desktop/attention-service.js guesses from a CLI's output that it shows a question and then holds
// every message to it. A reply that merely ended with such words used to hold them until new
// output or a key (opening the thread made the CLI redraw, so the click seemed to help). Now, when
// that guess is the only holder, the CLI is asked once to redraw and the fresh screen decides.
// This runs the real attention-service with a stand-in CLI. No window opens and no CLI starts.
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail === '' ? '' : ' · ' + JSON.stringify(detail)));
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await pause(50);
  }
  return test();
}

// What the stand-in CLIs have on screen. A reply ending in question words with no footer after
// it (a CLI that redraws only changed rows), and the same reply drawn again whole, footer last.
const REPLY = '\r\n● I can split the page in two.\r\n  Do you want to proceed with this plan?\r\n';
const REPLY_REDRAWN =
  '\x1b[2J\x1b[H● I can split the page in two.\r\n  Do you want to proceed with this plan?\r\n' +
  '\r\n╭────────────╮\r\n│ >          │\r\n╰────────────╯\r\n  ? for shortcuts\r\n';
const MENU =
  '\r\n Do you want to make this edit to page.js?\r\n ❯ 1. Yes\r\n   2. No, and tell Claude\r\n';

async function main() {
  const attention = require(path.join(ROOT, 'desktop', 'attention-service.js'));
  const world = { typed: [], redraws: [], permissions: [] };

  // what each stand-in CLI draws when it is asked to draw again
  const screens = { reply: REPLY_REDRAWN, menu: MENU, perm: MENU };
  attention.init(() => {}, {
    turns: { busy: () => false, onEnd: () => {} },
    hooks: { pendingPermissions: () => world.permissions },
    submit: async (paneId, text) => {
      world.typed.push(paneId + ':' + text);
      return { ok: true, state: 'sent' };
    },
    cli: () => 'Claude Code',
    redraw: paneId => {
      world.redraws.push(paneId);
      setTimeout(() => attention.output({ paneId, data: screens[paneId] }), 30);
    },
  });
  attention._test.recheckMs(400);
  const guessed = paneId =>
    attention.list().items.some(i => i.paneId === paneId && i.kind === 'menu');
  const message = paneId =>
    attention.holdIfDraft(paneId, { text: 'from Lead: hello ' + paneId, from: 'Lead', asap: true });

  // 1. a reply that ended with question words: held at first, then sent after one redraw
  attention.output({ paneId: 'reply', data: REPLY });
  check('the reply is first guessed as a question', await waitFor(() => guessed('reply'), 2000));
  const held = message('reply');
  check('a message to it is held at first', held?.state === 'held', held);
  check(
    'it goes out after the screen is read again',
    await waitFor(() => world.typed.includes('reply:from Lead: hello reply'), 4000),
    world
  );
  check('the CLI was asked to draw once', world.redraws.filter(id => id === 'reply').length === 1);

  // 2. a real numbered menu still on screen: drawn again, it keeps holding, with one redraw only
  attention.output({ paneId: 'menu', data: MENU });
  await waitFor(() => guessed('menu'), 2000);
  message('menu');
  await pause(2500);
  check('a real menu keeps the message held', !world.typed.some(t => t.startsWith('menu:')), world);
  check(
    'a real menu is redrawn once, not in a loop',
    world.redraws.filter(id => id === 'menu').length === 1,
    world.redraws
  );
  check('the real menu is still the question', guessed('menu'));

  // 3. a permission the hooks report: exact, never redrawn, still held
  world.permissions = [{ paneId: 'perm', tool: 'Bash', detail: 'npm test' }];
  attention.output({ paneId: 'perm', data: MENU });
  await waitFor(() => guessed('perm'), 2000);
  message('perm');
  await pause(1500);
  check('a permission is never redrawn', !world.redraws.includes('perm'), world.redraws);
  check('a permission keeps holding', !world.typed.some(t => t.startsWith('perm:')));

  // 4. the answer: keys on the real menu end it and the held message goes, as before
  attention.typed('menu', '1');
  check(
    'answering the menu sends the held message',
    await waitFor(() => world.typed.some(t => t.startsWith('menu:')), 3000)
  );

  attention.exited('reply');
  attention.exited('menu');
  attention.exited('perm');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.log('FAIL ' + (error?.stack || error));
  process.exit(1);
});
