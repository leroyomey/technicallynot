// Checks desktop/user-interrupt.js (the prompt box's Stop) with stand-ins for the app's parts:
// which keys each CLI gets, and that Claude Code's input is cleared only when it put the prompt
// back. Run: node tools/user-interrupt-test.js

'use strict';

const assert = require('assert');
const { createUserInterrupt } = require('../desktop/user-interrupt');

// One fake app: a panel running `cli`, what `turns.stopped` answers, what OpenCode's abort answers.
function fakeApp({ cli, stopped = '', aborted = null, running = true }) {
  const written = [];
  const typed = [];
  const app = createUserInterrupt({
    ptys: {
      list: () => [{ paneId: 'p1', agent: cli, running, pid: 7 }],
      write: (paneId, data) => written.push(data),
    },
    turns: { stopped: () => stopped },
    attention: { typed: (paneId, keys) => typed.push(keys) },
    abort: async () => aborted,
  });
  return { app, written, typed };
}

async function main() {
  // Claude Code paused a reply: one Esc, nothing more.
  let t = fakeApp({ cli: 'Claude Code', stopped: 'reply' });
  assert.deepStrictEqual(await t.app.interrupt('p1'), { ok: true, state: 'reply' });
  assert.deepStrictEqual(t.written, ['\x1b']);
  assert.deepStrictEqual(t.typed, []);

  // Claude Code had not begun: Esc, then Esc Esc clears the prompt it put back.
  t = fakeApp({ cli: 'Claude Code', stopped: 'restored' });
  assert.deepStrictEqual(await t.app.interrupt('p1'), { ok: true, state: 'restored' });
  assert.deepStrictEqual(t.written, ['\x1b', '\x1b', '\x1b']);
  assert.deepStrictEqual(t.typed, ['\x1b\x1b']);

  // Codex: one Esc, no waiting.
  t = fakeApp({ cli: 'Codex' });
  assert.deepStrictEqual(await t.app.interrupt('p1'), { ok: true, state: 'done' });
  assert.deepStrictEqual(t.written, ['\x1b']);

  // OpenCode: its own abort, no key; without the link, its double Esc.
  t = fakeApp({ cli: 'OpenCode', aborted: { ok: true } });
  await t.app.interrupt('p1');
  assert.deepStrictEqual(t.written, []);
  t = fakeApp({ cli: 'OpenCode', aborted: null });
  await t.app.interrupt('p1');
  assert.deepStrictEqual(t.written, ['\x1b', '\x1b']);

  // A plain terminal gets Ctrl+C; a stopped panel gets nothing.
  t = fakeApp({ cli: 'Terminal' });
  await t.app.interrupt('p1');
  assert.deepStrictEqual(t.written, ['\x03']);
  t = fakeApp({ cli: 'Claude Code', running: false });
  assert.deepStrictEqual(await t.app.interrupt('p1'), { ok: false, state: 'not-running' });
  assert.deepStrictEqual(t.written, []);

  console.log('user-interrupt: all checks passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
