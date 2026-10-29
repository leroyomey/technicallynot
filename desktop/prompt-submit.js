/*
 * Technically Not desktop · prompt-submit.js — the one way Technically Not puts a prompt or slash
 * command into a pane and presses Enter (composer, Send to, `tnai send`, the task graph, /compact,
 * context upkeep), and says whether the CLI really took it.
 */
'use strict';

// Codex (and other TUIs on Windows) get no real bracketed paste through ConPTY: they spot a paste
// by how fast the keys come, and an Enter inside that burst becomes a newline in the input instead
// of submitting. So Enter waits a moment after the text, longer for longer text, per CLI.
// Terminal: the shells themselves need no wait. Measured 2026-10-28 with node-pty (Windows
// PowerShell 5.1, PowerShell 7, cmd, Git Bash): text and Enter even in one write ran whole in 33 of
// 33 tries, at a fresh first prompt and at an idle one, lines up to 428 characters. The 30 ms only
// keep Enter a key press of its own, apart from the typed text, for a program the user runs inside
// the thread (tools/terminal-enter-check.js; was 120 ms).
const ENTER_MS = { Codex: 450, Terminal: 30 };
const ENTER_DEFAULT = 300;

// extra Enters, 1.5 s apart, for a CLI that gives no sign yet (stops once its task shows as
// started)
const UNCONFIRMED_RETRIES = 3;

// how long to wait for the CLI's own sign that it took the prompt (prompt hook / rollout
// user_message)
const CONFIRM_MS = 3000;

// more Enters, 2 s apart, while a CLI that gives no sign printed nothing at all since our last
// Enter (below)
const QUIET_RETRIES = 6;

// Pure escape sequences (focus, mouse reports) are not the user typing; anything else written after
// our Enter is, and stops the retry. The terminal's own answers to a CLI's questions (OSC color
// replies, DCS/APC) are not keys either (main.js leaves them out the same way).
const TERMINAL_REPLY = /\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[P_^][\s\S]*?\x1b\\/g;
const typedText = data =>
  /[^\x1b]/.test(
    String(data)
      .replace(TERMINAL_REPLY, '')
      .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
  );

// A prompt that comes from the user's other computer (option `remote` of submit).
// These are the only words its result and
// its onDone ever carry, with no reason text, so nothing about this computer crosses with them:
// sent — the CLI took it; queued — held on this computer, where its user sees and can remove it
// (onDone later gets the word it ended with); unconfirmed — Enter was pressed once and this CLI
// gives no sign; failed — not delivered (text already pasted stays in the input, unsent).
const REMOTE = Object.freeze({
  sent: 'sent',
  queued: 'queued',
  unconfirmed: 'unconfirmed',
  failed: 'failed',
});

// Enters in all for a remote prompt, more than one only for a CLI that confirms and stayed silent
// (submitRemote)
const REMOTE_ENTERS = 3;

// how long a CLI that cannot confirm gets to show a started task after its one Enter; nothing is
// pressed meanwhile
const REMOTE_SIGN_MS = 6000;

// A remote prompt starts with a word (the sender's own check is the first lock,
// this is the second, at the write): a first "!" is a CLI's shell mode and a first "/" one of its
// own commands. An allow rule on purpose: the other characters differ per CLI.
const WORD_FIRST = /^\s*[\p{L}\p{N}]/u;

// For a remote prompt every key counts as "someone typed", arrows and a lone Esc too (Up swaps the
// input for an old prompt, which typedText above does not see). Only the terminal's own reports are
// left out: focus, mouse, cursor position, device, mode and size answers.
const REPORT = /\x1b\[(?:[IO]|<[0-9;]*[Mm]|[0-9;]*[Rnt]|[?>][0-9;]*[cu]|\?[0-9;]*\$y)/g;
const anyKey = data => String(data).replace(TERMINAL_REPLY, '').replace(REPORT, '') !== '';

let ptys = null,
  turns = null,
  hooks = null,
  attention = null,
  // noted(paneId, 'person' | 'agent', text): told at each prompt's write, with exactly the words
  // that are written
  noted = null;
const typedAt = new Map(); // paneId -> last time someone other than this module typed into it

// paneId -> what the last submit did: { enters, stop, typed } (desktop check real-cursor-new reads
// it to say why a prompt stayed unsent)
const lastDid = new Map();

// paneId -> count of writes that put keys into it, this module's own included (read by submitRemote
// only)
const touched = new Map();
let own = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const running = paneId => ptys.list().find(s => s.paneId === paneId && s.running);
const touch = paneId => touched.set(paneId, (touched.get(paneId) || 0) + 1);
const write = (paneId, data) => {
  own = true;
  touch(paneId);
  try {
    ptys.write(paneId, data);
  } finally {
    own = false;
  }
};

function enterDelay(agent, text) {
  return (ENTER_MS[agent] ?? ENTER_DEFAULT) + Math.min(1200, Math.floor(String(text).length / 4));
}

// Resolves true once the CLI reports a submitted prompt for this pane (agent-turns.js), false after
// ms.
function confirmed(paneId, ms) {
  return new Promise(resolve => {
    const off = turns.onSubmit(paneId, () => {
      clearTimeout(timer);
      off();
      resolve(true);
    });
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
  });
}

// text: the prompt; paste: as one bracketed paste (agent prompts) or typed (slash commands, a plain
// shell line); agent: overrides the pane's CLI (a CLI started by hand inside a Terminal pane).
// Result state: sent — the CLI took it; queued — the agent is busy and holds it; unconfirmed — this
// CLI gives no sign, Enter was pressed; not-submitted — the CLI gives signs but none came (the text
// may still sit in its input); gone — no process in that pane; held — holdIfBlocked and the pane is
// on a question (with holdIfBusy, the composer: also while its agent works), or holdIfDraft (`tnai
// send`) and the user has unsent text in its input: nothing written, attention-service.js sends it
// once that clears (holdIfDraft: onDone(result) then reports the outcome). remote: { from, guard,
// onDone, key } — the prompt comes from another computer and takes submitRemote below, whatever
// else is passed. person: true only for a prompt this computer's user sent from the window (main.js
// pty:submit, and attention-service.js for one it held for them). Everything else this path writes
// is an agent's or the app's own message, and remote-say.js is told at the write (`noted`): a turn
// such a write may have started or joined is not "a task a person started".
async function submit(
  paneId,
  text,
  {
    paste = true,
    agent,
    holdIfBlocked = false,
    holdIfBusy = false,
    holdIfDraft = null,
    remote = null,
    claimed = false,
    person = false,
  } = {}
) {
  if (remote) return submitRemote(paneId, text, { agent, remote, claimed });
  const target = running(paneId);
  if (!target) return { ok: false, state: 'gone', error: 'No running process in that thread.' };
  const same0 = () => running(paneId)?.pid === target.pid;
  if (holdIfBlocked && attention) {
    const held = attention.holdIfBlocked(paneId, { text, paste, agent, ifBusy: holdIfBusy });
    if (held) return held;
  }
  if (holdIfDraft && attention) {
    const held = attention.holdIfDraft(paneId, {
      text,
      paste,
      agent,
      from: holdIfDraft.from,
      onDone: holdIfDraft.onDone,
      asap: holdIfDraft.asap,
    });
    if (held) return held;
  }
  const cli = agent || target.agent;

  // An effort picked for a fresh OpenCode panel is set through its own server right after it starts
  // (opencode-link.js effort): a prompt waits for that to finish or give up, never longer than 15
  // s. Nothing is pending for any other panel, and then this adds no wait at all.
  if (cli === 'OpenCode') {
    try {
      const wait = require('./opencode-link').effortSettled(paneId);
      if (wait) {
        await wait;
        if (!same0())
          return { ok: false, state: 'gone', error: 'No running process in that thread.' };
      }
    } catch {}
  }
  const body = paste
    ? String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    : String(text ?? '').replace(/[\r\n]+/g, ' ');
  const same = () => running(paneId)?.pid === target.pid;
  const did = { enters: 0, stop: '', typed: '', at: 0 };
  lastDid.set(paneId, did);
  const enter = () => {
    did.enters++;
    did.at = Date.now();
    write(paneId, '\r');
  };

  // OpenCode's /compact with the link to its own server on and the agent idle (opencode-link.js):
  // the server's summarize call, so nothing is typed into its input. Real runs 2026-10-06: the same
  // screen and events as the typed command. Asked after every hold above; not taken at once (no
  // link, busy, model not known yet, a refused call), it is typed as before.
  if (cli === 'OpenCode' && !paste && body === '/compact') {
    const link = require('./opencode-link'),
      st = link.state(paneId);
    if (st?.connected && st.status === 'idle' && st.sessionId) {
      const r = await Promise.race([
        link.summarize(paneId),
        sleep(1500).then(() => ({ ok: true })),
      ]); // it answers only when the compaction is done
      if (r.ok) {
        did.stop = 'link';
        return { ok: true, state: 'sent' };
      }
    }
  }

  // From just before the text goes in until this delivery returns, the input can hold this
  // computer's own text with an Enter still to come. attention-service.js is told, so a prompt from
  // another computer is held meanwhile, never pasted behind that text and sent by this path's
  // Enter. Nothing about this delivery itself changes.
  attention?.localDelivery?.(paneId, 1);
  try {
    try {
      noted?.(paneId, person === true ? 'person' : 'agent', body);
    } catch {
      /* a listener's error is not the prompt's */
    }
    const pastedAt = Date.now();
    write(paneId, paste ? '\x1b[200~' + body + '\x1b[201~' : body);
    await sleep(enterDelay(cli, body));
    if (!same())
      return { ok: false, state: 'gone', error: 'The agent in that thread stopped before Enter.' };

    // Someone typed into this panel between the paste and our Enter: those keys now sit in the
    // input with the message, and Enter would send them along. An agent's or the app's message
    // then waits in the input unsent, the user decides. The user's own prompt is pressed as
    // before.
    if (person !== true && (typedAt.get(paneId) || 0) >= pastedAt) {
      did.stop = 'typed';
      attention?.unsent(paneId, body);
      return {
        ok: false,
        state: 'not-submitted',
        error:
          'Someone typed in that thread while the text went in, so Enter was not pressed: the text waits in its input.',
      };
    }
    const canConfirm = turns.canConfirm(paneId, cli) && paste;
    const waiting = canConfirm ? confirmed(paneId, CONFIRM_MS) : null;
    const enterAt = Date.now();
    enter();
    if (cli === 'Terminal' && !agent) return { ok: true, state: 'unconfirmed' };
    if (waiting && (await waiting)) return { ok: true, state: 'sent' };
    if (!waiting) await sleep(1200);

    // A slash command (/model, /resume, /clear …) starts no task, so nothing confirms it the way a
    // prompt is confirmed. A CLI that redrew its screen after our Enter took it, and one more Enter
    // would answer whatever it opened: /model's menu picked its first option and closed at once.
    // (learned 2026-10-21, 161-cli-menu-screen.js)
    const command = /^\/[\w:-]+(\s|$)/.test(body.trim());
    if (command && same() && (running(paneId)?.lastOutputAt || 0) > enterAt) {
      did.stop = 'command';
      return { ok: true, state: 'sent' };
    }

    // One more Enter, only when nobody typed meanwhile and no permission question waits (Enter
    // would answer it). An Enter on an empty input does nothing.
    const touched = (typedAt.get(paneId) || 0) > enterAt;
    const asking = hooks?.pendingPermissions?.().some(p => p.paneId === paneId);

    // a CLI that can't confirm, but its task already shows as started
    const started = !canConfirm && turns.busy(paneId);
    if (same() && !touched && !asking && !started) {
      const again = canConfirm ? confirmed(paneId, CONFIRM_MS) : null;
      enter();
      if (again && (await again)) return { ok: true, state: 'sent', retried: true };
    } else did.stop = !same() ? 'gone' : touched ? 'typed' : asking ? 'asking' : 'started';

    // A CLI that can't confirm yet (a fresh Cursor Agent / Codex / OpenCode: its transcript appears
    // only with the first prompt) may still be drawing its startup screen and drop Enter (seen live
    // with Cursor Agent 2026.09.23: task pasted, both Enters lost). Press it again until its task
    // starts.
    for (let i = 0; !canConfirm && i < UNCONFIRMED_RETRIES; i++) {
      await sleep(1500);
      const why = !same()
        ? 'gone'
        : turns.busy(paneId)
          ? 'started'
          : (typedAt.get(paneId) || 0) > enterAt
            ? 'typed'
            : hooks?.pendingPermissions?.().some(p => p.paneId === paneId)
              ? 'asking'
              : '';
      if (why) {
        did.stop = did.stop || why;
        break;
      }
      enter();
    }

    // The text can still sit in the input with every Enter so far lost or never pressed (a real
    // Cursor Agent started by `tnai new` in the running app, 2026-10-05, twice: it printed nothing
    // after the pasted task for minutes; real runs also showed Cursor Agent 2026.10.01 ignores the
    // first Enter after a paste, so it always depends on a later one). A CLI that takes a prompt,
    // and keys the user types, both print at once: while the panel printed nothing since our last
    // Enter and no task shows, the prompt was not taken, so Enter again. The same for a CLI that
    // does give signs (a running Cursor Agent whose record Technically Not reads, the same day: a
    // `tnai ask` sat in its input after both Enters and was reported "not started"). A CLI that was
    // already working holds the message itself: nothing more is pressed.
    for (let i = 0; i < QUIET_RETRIES && !turns.busy(paneId); i++) {
      await sleep(2000);
      if (
        !same() ||
        turns.busy(paneId) ||
        (running(paneId)?.lastOutputAt || 0) > did.at ||
        hooks?.pendingPermissions?.().some(p => p.paneId === paneId)
      )
        break;
      did.quiet = (did.quiet || 0) + 1;
      enter();
    }
    if (!same()) return { ok: false, state: 'gone', error: 'The agent in that thread stopped.' };

    // one of the later Enters started it
    if (did.quiet && turns.busy(paneId)) return { ok: true, state: 'sent', retried: true };
    if (!canConfirm) return { ok: true, state: turns.busy(paneId) ? 'sent' : 'unconfirmed' };
    if (turns.busy(paneId)) return { ok: true, state: 'queued' };

    // Cursor Agent writes a prompt into its record late (real run 2026-10-05: it was already
    // running the command when both waits above had passed, and the sender was told "did not start
    // it"). A panel that printed since our last Enter, with nobody typing, took the prompt: wait
    // for its record, and without one say "unconfirmed", never "not started".
    if (
      cli === 'Cursor Agent' &&
      (running(paneId)?.lastOutputAt || 0) > did.at &&
      (typedAt.get(paneId) || 0) <= enterAt
    ) {
      did.late = true;
      if ((await confirmed(paneId, 20000)) || turns.busy(paneId))
        return { ok: true, state: 'sent', retried: true };
      return same()
        ? { ok: true, state: 'unconfirmed' }
        : { ok: false, state: 'gone', error: 'The agent in that thread stopped.' };
    }
    attention?.unsent(paneId, body);
    return {
      ok: false,
      state: 'not-submitted',
      error: 'The text is in its input but it did not start it (press Enter on its CLI screen).',
    };
  } finally {
    attention?.localDelivery?.(paneId, -1);
  }
}

// A prompt from another computer never takes the path above, which was written for this computer's
// own user and agents. remote: { from: the computer's
// name (shown in the held list), guard: () => true while that computer may still do this (asked
// again at every write), onDone: word => … for a queued one, key: what remoteHeld / cancelRemote of
// attention-service.js find it by (default: from; two computers can share a name) }. What differs,
// each on purpose:
// - always one bracketed paste, never typed; never into a Terminal panel; the text starts with a
// word;
// - one at a time per panel: attention-service.js holds the next until the one before it ended, and
// holds for a question, unsent text and a working agent, so nothing ever goes into a CLI's own
// queue;
// - in the same turn as the paste and again before EVERY Enter: the guard, the same process, no
// question of any kind (the screen is read at that moment), no unsent text, no key from anyone
// since our own last write. A no after the paste: no Enter, the text stays and the panel is marked
// as holding unsent text;
// - no blind Enters: a second or third only for a CLI that confirms, and only while the panel
// printed nothing since the last one. Resolves { ok, state } with a word of REMOTE and nothing
// else. onDone is never called from here: attention-service.js calls it once for each prompt it
// held, with the word that prompt ended on.
const remoteWord = r =>
  r && r.ok === true && (r.state === REMOTE.sent || r.state === REMOTE.unconfirmed)
    ? r.state
    : REMOTE.failed;

async function submitRemote(paneId, text, { agent, remote, claimed }) {
  const failed = () => ({ ok: false, state: REMOTE.failed });

  // this call holds the panel's one-at-a-time claim (a held prompt arrives with it)
  let mine = claimed === true && !!attention?.remoteEnded;
  const end = result => {
    if (mine && !result.ok) attention.remoteEnded(paneId);
    return result;
  }; // not started: the next one may go
  const target = running(paneId);
  const body = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
  if (
    !target ||
    target.agent === 'Terminal' ||
    typeof remote.guard !== 'function' ||
    !attention?.holdRemote ||
    !WORD_FIRST.test(body)
  )
    return end(failed());

  // The sender's mark (remote-actions.js `markOf`; 6f change 21) is put in front of the words only
  // where they are written. The word-first lock above is on the words as the other computer sent
  // them, and a held prompt keeps its words and its mark apart (remote.mark), so the lock is asked
  // again, on the words alone, when it is sent later. `out` is what sits in the CLI's input.
  // remote.tail: this computer's own words after the prompt, naming the files that came with it and
  // were saved here (remote-control.js doPrompt). Like the mark
  // it is added only where the words are written, and kept apart while held.
  const lead =
    typeof remote.mark === 'string'
      ? remote.mark.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 120)
      : '';
  const tail =
      typeof remote.tail === 'string'
        ? remote.tail.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 1500)
        : '',
    out = lead + body + tail;
  const same = () => {
    const now = running(paneId);
    return (
      !!now &&
      now.pid === target.pid &&
      now.agent === target.agent &&
      now.startedAt === target.startedAt
    );
  };

  // The process is part of the guard: a panel restarted, or switched to another connection, while a
  // prompt is held ends without pty:exit.
  const allowed = () => {
    try {
      return same() && remote.guard() === true;
    } catch {
      return false;
    }
  };
  const cli = agent || target.agent;

  // As in submit. Asked before the hold, so no wait lies between the checks below and the paste.
  if (cli === 'OpenCode') {
    try {
      const wait = require('./opencode-link').effortSettled(paneId);
      if (wait) await wait;
    } catch {}
  }
  if (!mine) {
    if (!allowed()) return failed();
    const from = String(remote.from ?? ''),
      key = String(remote.key ?? from);
    if (
      attention.holdRemote(paneId, {
        text: body,
        agent,
        remote: {
          from,
          key,
          mark: lead,
          tail,
          say: remote.say === true,
          onWrite: remote.onWrite,
          guard: allowed,
          onDone: r => {
            try {
              remote.onDone?.(remoteWord(r));
            } catch {}
          },
        },
      })
    )
      return { ok: true, state: REMOTE.queued };
    mine = true; // not held: holdRemote gave this call the panel
  }
  if (!allowed() || !attention.remoteReady(paneId)) return end(failed()); // nothing written
  const did = { enters: 0, stop: '', typed: '', at: 0, remote: true };
  lastDid.set(paneId, did);

  // remote.say: the words are an agent's on another computer, not its user's.
  // In the turn of the write, remote-say.js is told that an agent's
  // text goes into this panel, and exactly what is written (the turn it starts is tied to it).
  try {
    noted?.(paneId, remote.say === true ? 'agent' : 'person', out);
    if (remote.say === true && typeof remote.onWrite === 'function') remote.onWrite(out);
  } catch {
    /* a listener's error is not the prompt's */
  }
  write(paneId, '\x1b[200~' + out + '\x1b[201~');
  attention.remotePasted(paneId);
  let mark = touched.get(paneId);
  const printed = () => (running(paneId)?.lastOutputAt || 0) > did.at;
  const gone = () => {
    did.stop = 'gone';
    attention.remoteGone(paneId);
    return end(failed());
  }; // its process ended: no text is left anywhere
  const left = why => {
    did.stop = why;
    attention.unsent(paneId, out);
    return end(failed());
  }; // the text sits in the input: this computer's user sends or clears it
  const taken = state => {
    attention.remoteGone(paneId);
    return { ok: true, state };
  };

  // Enter was pressed and this CLI gives no sign: the text may still sit in its input. This
  // computer's user is told so (the same note as for text left unsent), and the hold on the panel
  // ends by itself after the time a held prompt gets.
  const unknown = () => {
    did.stop = 'unconfirmed';
    attention.remoteUnconfirmed?.(paneId, out);
    return { ok: true, state: REMOTE.unconfirmed };
  };
  await sleep(enterDelay(cli, out));
  const canConfirm = turns.canConfirm(paneId, cli);
  for (;;) {
    if (!same()) return gone();
    const why =
      touched.get(paneId) !== mark
        ? 'typed'
        : !allowed()
          ? 'guard'
          : !attention.remoteEnterOk(paneId)
            ? 'asking'
            : '';
    if (why) return left(why);
    const waiting = canConfirm ? confirmed(paneId, CONFIRM_MS) : null;
    did.enters++;
    did.at = Date.now();
    write(paneId, '\r');
    mark = touched.get(paneId);
    if (!waiting) break;
    if (await waiting) return taken(REMOTE.sent);

    // it printed: that Enter did something, and another could answer what it opened
    if (did.enters >= REMOTE_ENTERS || turns.busy(paneId) || printed()) break;
  }
  if (!canConfirm) {
    // one Enter and no more: only its task showing says it was taken
    for (let waited = 0; waited < REMOTE_SIGN_MS && same() && !turns.busy(paneId); waited += 300)
      await sleep(300);
    if (!same()) return gone();
    return turns.busy(paneId) ? taken(REMOTE.sent) : unknown();
  }
  if (!same()) return gone();
  if (turns.busy(paneId)) return taken(REMOTE.sent);

  // Cursor Agent writes a prompt into its record late (see submit): it printed since our Enter and
  // nobody typed, so wait for the record.
  if (cli === 'Cursor Agent' && printed() && touched.get(paneId) === mark) {
    did.late = true;
    if ((await confirmed(paneId, 20000)) || turns.busy(paneId)) return taken(REMOTE.sent);
    return same() ? unknown() : gone();
  }
  return left('not-taken');
}

module.exports = {
  init(deps) {
    ptys = deps.ptys;
    turns = deps.turns;
    hooks = deps.hooks;
    attention = deps.attention || null;
    noted = typeof deps.noted === 'function' ? deps.noted : null;
  },
  // main.js calls this for every write into a pane.
  wrote(paneId, data) {
    if (own) return;
    if (anyKey(data)) touch(paneId);
    const d = lastDid.get(paneId);

    // the terminal answered a CLI question after our Enter (a view that opens replays the output
    // and answers again)
    if (d?.enters && String(data).search(TERMINAL_REPLY) >= 0) d.replies = (d.replies || 0) + 1;
    if (typedText(data)) {
      typedAt.set(paneId, Date.now());
      if (d) d.typed = JSON.stringify(String(data).slice(0, 40));
    }
  },
  forget: paneId => {
    typedAt.delete(paneId);
    lastDid.delete(paneId);
    touched.delete(paneId);
  },
  did: paneId => lastDid.get(paneId) || null,
  submit,
  REMOTE, // the words a remote prompt's result can be
};
