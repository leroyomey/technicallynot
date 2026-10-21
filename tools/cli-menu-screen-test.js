// Test of the menu commands that open the CLI screen (src/scripts/161-cli-menu-screen.js):
// node tools/cli-menu-screen-test.js
//
// Which commands open a menu for each CLI, and how the screen's text tells an open menu from a
// closed one (the lines each CLI draws, including the ones that only look alike). Runs the script
// in a Node sandbox with stand-ins for the window: no window opens, no CLI starts.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'scripts', '161-cli-menu-screen.js'),
  'utf8'
);
const window = {
  addEventListener: () => {},
  tnaiNative: { agentEvents: { on: () => () => {} } },
};
vm.runInNewContext(source, { window, document: { querySelector: () => null }, setTimeout });
const menus = window.TnaiCliMenus;

// ---------------------------------------------------------------- which commands
check('/model opens the screen on Claude Code', menus.opensScreen('Claude Code', '/model'));
check('with its argument too', menus.opensScreen('Claude Code', '/model haiku'));
check('in any case', menus.opensScreen('Claude Code', '/Model'));
check('/compact does not', !menus.opensScreen('Claude Code', '/compact'));
check('/clear does not', !menus.opensScreen('Claude Code', '/clear'));
check('Codex has its own: /permissions', menus.opensScreen('Codex', '/permissions'));
check('OpenCode says /models', menus.opensScreen('OpenCode', '/models'));
check('Copilot CLI goes by its app name', menus.opensScreen('GitHub Copilot', '/model'));
check('an unknown CLI opens nothing', !menus.opensScreen('Gemini CLI', '/model'));
check('plain words open nothing', !menus.opensScreen('Claude Code', 'model please'));

// ---------------------------------------------------------------- an open menu, from the screen
const open = text => menus.menuOpen(text);
check(
  'Claude Code’s model menu',
  open(' Select model\n ❯ 1. Default\n   2. Opus 5.5\n\n Enter to confirm · Esc to exit')
);
check('a settings list', open(' Settings\n Esc to cancel'));
check('Codex', open('Select a model\nPress enter to confirm or esc to go back'));
check('a closed-by-Esc hint the other way round', open('Back (esc)'));
check('a reply that runs is no menu', !open('✻ Thinking… (esc to interrupt)'));
check(
  'the idle prompt is no menu',
  !open('> \n  ? for shortcuts                                  ◯ high · /effort')
);
check(
  'the word "escape" inside a sentence is no menu',
  !open('We need to escape the quotes here.')
);

// OpenCode's dialogs (read in its 1.19.3 program): the title on the left, a bare "esc" on the
// right, and nothing after it. Only an OpenCode thread reads that as a menu.
const openOn = (cli, text) => menus.menuOpen(text, cli);
const openCodeDialog =
  '  Select model                                        esc\n' +
  '  > Search\n' +
  '  Recent\n' +
  '  Claude Sonnet 5.5   Anthropic';
check('OpenCode’s model dialog', openOn('OpenCode', openCodeDialog));

// the row as OpenCode 1.19.3 drew it in a real terminal (2026-10-21, /models, no prompt sent)
check(
  'OpenCode’s real /models row',
  openOn('OpenCode', '    Select model' + ' '.repeat(37) + 'esc    ')
);
check(
  'an OpenCode dialog over the dimmed conversation',
  openOn('OpenCode', '  Select session               esc     earlier words here')
);
check('OpenCode’s working line is no menu', !openOn('OpenCode', '  ⬝⬝⬝■  esc interrupt'));
check('nor its second press', !openOn('OpenCode', '  esc again to interrupt'));
check('nor its shell mode hint', !openOn('OpenCode', '  Shell  esc normal'));
check('nor the word in a sentence', !openOn('OpenCode', 'Press esc to stop the reply.'));
check('another CLI does not read the bare esc', !openOn('Claude Code', openCodeDialog));
check('nor a thread whose CLI is not known', !open(openCodeDialog));

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
