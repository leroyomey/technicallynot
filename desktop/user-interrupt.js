/*
 * Technically Not · user-interrupt.js
 *
 * The prompt box's Stop (src/scripts/150-composer-stop.js): this computer's own user stops an
 * agent where it is, or cancels the prompt it is working on. Unlike `tnai intervene`
 * (agent-mesh.js) and an interrupt from another computer (remote-actions.js), the user may stop
 * their own agent at any time: no two-minute gap, and nothing is typed in after the key.
 *
 * The keys are the ones the user would press in the CLI screen: one Esc (a plain terminal gets
 * Ctrl+C); OpenCode its own abort call, else Esc Esc. Claude Code stopped before the first words
 * of its reply puts the task's prompt back into its own input (agent-turns.js `stopped` answers
 * 'restored'): that input is then cleared with Esc Esc, so the words live in one place only, the
 * prompt box, and a later prompt is never glued to them.
 *
 * createUserInterrupt({ ptys, turns, attention, abort }) → { interrupt(paneId) }
 * interrupt answers { ok, state }: state 'reply' (Claude Code paused a reply), 'restored' (Claude
 * Code had written nothing; its input was cleared), 'done' (the key went, nothing more is known),
 * 'not-running'.
 */

'use strict';

// How long Claude Code gets to say whether it paused its reply or put the prompt back (the same
// wait as remote-actions.js INTERRUPT_REPLY_MS).
const REPLY_WAIT_MS = 2500;

// Between the two Esc of a double Esc: Claude Code and OpenCode take them as one gesture only
// when they come apart (agent-mesh.js presses OpenCode's second one 300 ms after the first).
const DOUBLE_ESC_GAP_MS = 300;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createUserInterrupt({ ptys, turns, attention, abort }) {
  const write = (paneId, data) => {
    try {
      ptys.write(paneId, data);
    } catch {
      /* the panel closed meanwhile */
    }
  };

  // What the panel runs right now, or null.
  const session = paneId => ptys.list().find(one => one.paneId === paneId) || null;

  async function interrupt(paneId) {
    const id = String(paneId || '');
    const first = session(id);
    if (!first || first.running !== true) return { ok: false, state: 'not-running' };
    const cli = first.agent;

    // A plain terminal (Your terminal, a script) stops its command with Ctrl+C.
    if (cli === 'Terminal') {
      write(id, '\x03');
      return { ok: true, state: 'done' };
    }

    // OpenCode: its own abort call when the link to its server is on; else its double Esc.
    if (cli === 'OpenCode') {
      let aborted = null;
      try {
        aborted = await abort(id);
      } catch {
        /* not aborted: the keys below */
      }
      if (aborted?.ok === true) return { ok: true, state: 'done' };
      write(id, '\x1b');
      await wait(DOUBLE_ESC_GAP_MS);
      write(id, '\x1b');
      return { ok: true, state: 'done' };
    }

    write(id, '\x1b');
    if (cli !== 'Claude Code') return { ok: true, state: 'done' };

    let how = '';
    for (let waited = 0; !(how = turns.stopped(id)) && waited < REPLY_WAIT_MS; waited += 250)
      await wait(250);
    if (how !== 'restored') return { ok: true, state: how || 'done' };

    // The prompt went back into Claude Code's input. Only the same process is touched: a panel
    // that was stopped or restarted meanwhile gets no keys.
    const now = session(id);
    if (!now || now.running !== true || now.pid !== first.pid) return { ok: true, state: 'done' };
    write(id, '\x1b');
    await wait(DOUBLE_ESC_GAP_MS);
    write(id, '\x1b');

    // Esc Esc is a draft-clear key for attention-service.js: the input counts as empty again.
    try {
      attention.typed(id, '\x1b\x1b');
    } catch {
      /* only the count */
    }
    return { ok: true, state: 'restored' };
  }

  return { interrupt };
}

module.exports = { createUserInterrupt, REPLY_WAIT_MS };
