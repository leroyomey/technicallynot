/*
 * Technically Not desktop · remote-actions.js — the app's real actions behind the control
 * operations of a paired computer: a prompt for an agent, an interrupt, a stop, a start
 * ("change n" below names a numbered change of their design). remote-control.js has checked the
 * right, the limits, the one-time
 * number and the ticket before any of these is called, and hands each a guard that says whether all
 * of that still holds; every action asks it again in the turn of each of its writes. Every part of
 * the app is handed in (main.js does the wiring), so tools/remote-actions-test.js runs this file in
 * plain Node with stand-ins. Handed in: ptys { list() → the panels' processes as pty-service.js
 * lists them, write(panelId, data), stop(panelId) → true when one ended } mesh { nameOf(panelId),
 * cliOf(panelId) → the CLI typed by hand into that panel or null, taskOf(panelId),
 * interruptLeft(panelId) → ms until that agent may be interrupted again (0: now),
 * interruptedNow(panelId) } lifecycle { instanceOf(panelId), spawnRemote(cliName, kept) → Promise<{
 * paneId?, error?, openedPaneId?, panel }>, remoteTake(mark, panelId, cliName) → `kept` once for
 * the request that mark belongs to, else false, remoteStarted(panelId), remoteOpen() → how many
 * such panels this computer's user has not closed yet } turns { busy(panelId), stopped(panelId) →
 * 'reply' | 'restored' | '' } attention { blocker, hasDraft, remotePasted, unsent } submit
 * prompt-submit.js `submit` abort(panelId) → Promise<{
 * ok }> (OpenCode) panelKey(panelId) → Promise<the project key of the folder that panel's process
 * runs in, '' when it has none> folderKey(folder) → Promise<the project key of a folder>
 * parentsOf(nodeId) → the panel ids a sub-agent's node hangs under wait(ms) → Promise (the clock a
 * test moves by hand)
 */
'use strict';
const { appStarted } = require('./remote-control.js');

// after the Esc: how long Claude Code gets to show whether it paused its task or put the prompt
// back
const INTERRUPT_REPLY_MS = 2500;

// a first prompt that went in, or is held on this computer for its turn
const TAKEN = ['sent', 'queued', 'unconfirmed'];

// The CLIs a paired computer may start here:
// only those whose "Ask first" level (agent-registry.js accessArgs / accessEnv) is a
// rule the CLI itself enforces before it runs a command or edits a file. Claude Code:
// `--permission-mode manual`. OpenCode: `permission` rules in its session config, `edit: ask` and
// `bash: ask` for every command but Technically Not's own read-only `tnai` commands. Left out until
// proven otherwise, and what would let each back in. Looked at again 2026-10-10 against each CLI's
// own `--help` on this PC and its vendor's pages (nothing was run with a prompt); both stay out:
// Codex (codex-cli 0.162.0): its "Ask first" is `-a on-request` with no sandbox flag, so this
// computer's own Codex config decides what runs unasked (`sandbox_mode = "danger-full-access"` runs
// anything). Flags can close that much: `-s read-only` (given as a flag it is used instead of the
// config's `sandbox_mode` and `default_permissions`: "Permissions" page) and `-c
// approvals_reviewer=user` (so an `auto_review` saved there does not answer for the user). What no
// flag gives:
// 1. a level that asks before a command runs. `-a` takes `on-request` and `never` only, and the
// config reference calls `untrusted` unsupported. In the read-only sandbox, commands it allows "can
// run without approval" and read every file this computer's user can read ("Agent approvals &
// security"; the "Sandboxing" page says the opposite: not settled by reading).
// 2. the sandbox itself on Windows. What enforces "read-only" is this computer's `windows.sandbox`
// (mxc, elevated after an administrator's setup, or unelevated, which "does not support denied read
// paths" and is weakened by folders writable by Everyone); the Windows page does not say what a
// command does when none is set up or the setup was declined. Back in when one real run on Windows,
// sandbox set up and not set up, shows that with those flags no command writes or reaches the
// network unasked, and the user decides whether "reads and read-only commands unasked" may be
// called "Ask first" (the sentence on the other computer's dialog, "it asks before it runs commands
// there", is not true of Codex at any level). Cursor Agent (2026.10.01): its "Ask first" adds no
// flag at all. Its level is `approvalMode` in ~/.cursor/cli-config.json (`allowlist`, `auto-review`
// or `unrestricted`); `--force` and `--auto-review` set the other two and no flag sets `allowlist`,
// so a user who once chose "Run Everything" gets a remote start at full access. The allow list
// (that file, and .cursor/cli.json in the project) has no flag either; `--mode plan` and `--mode
// ask` do no work at all, which is another level and another sentence. Also a fresh one does not
// take the single Enter a remote first prompt gets (prompt-submit.js: it "ignores the first Enter
// after a paste"). Back in with a flag or a per-session setting for `allowlist` that this
// computer's files cannot widen.
const STARTABLE = ['Claude Code', 'OpenCode'];

// A resumed conversation gets its access level again only where the registry sends it on a resume
// (agent-registry.js accessOnResume): for every other CLI a resume runs at the CLI's own default,
// which nothing here can hold to "Ask first".
const LEVEL_ON_RESUME = ['OpenCode'];

// The CLIs whose resumed conversation can be held to "Ask first" by a flag of the resume itself,
// which the registry sends only when a start carries `askOnResume` (agent-registry.js spec; a CLI
// without it there is not started). Claude Code: `--resume <id>` restores the mode the conversation
// was in (and a settings `defaultMode` can take its place), so a resume without the flag is not
// "Ask first"; `--permission-mode manual` on the same command line overrides the restored mode
// (Claude Code's own pages, "Manage sessions" › "Permission mode on resume", read 2026-10-10).
// "Allow for this session" answers live in the process and do not come back with a resume. Read
// from those pages, not yet tried with the real CLI: that try is owed before a release.
const ASK_ON_RESUME = ['Claude Code'];

// For a choice (6i): questions() → OpenCode's open questions as its own server lists them ([{
// paneId, id, child, questions }]), answerQuestion(paneId, id, answers) → Promise<{ ok }>
// (opencode-link.js `answer`), pending() → the permission requests the app holds now ([{ paneId
// }]). Without them every choice is refused.
function createRemoteActions({
  ptys,
  mesh,
  lifecycle,
  turns,
  attention,
  submit,
  abort,
  panelKey,
  questions = () => [],
  answerQuestion = async () => ({ ok: false }),
  pending = () => [{ paneId: '*' }],
  folderKey = async () => '',
  parentsOf = () => [],
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  // What a panel runs at this moment, asked from the terminal service and the roster and never from
  // the kept agent list (change 3). remote-control.js gives a ticket, and takes an operation, only
  // when this says a running agent the app itself started in run mode, not a CLI typed by hand into
  // a PowerShell panel (`cli` is then "Terminal" and `hand` true), with a conversation of its own.
  function agentNow(panelId) {
    const s = ptys.list().find(x => x.paneId === panelId);
    if (!s) return null;
    return {
      name: mesh.nameOf(panelId) || s.agent,
      cli: s.agent,
      mode: s.mode,
      running: s.running === true,
      hand: !!mesh.cliOf(panelId),
      instance: lifecycle.instanceOf(panelId),
      pid: s.pid,
      startedAt: s.startedAt,
    };
  }

  // What the agent's terminal shows in front of a prompt or a first prompt from another computer
  // (so that a reader of the terminal knows which computer is talking):
  // "[Sent from <that computer as this one names it>] ". Put on here, on
  // the computer that is asked, never taken from the message. Brackets and line ends are taken out
  // of the name, so a computer's name cannot pass for one of the app's own marks ("[TN.ai]", "[from
  // …]"); the words never start with "[from", so the prompt still counts as its user's task
  // (agent-links.js NOT_USER). It is handed to the guarded delivery beside the words, never glued
  // to them here: prompt-submit.js checks that the words as sent start with a word (its second
  // lock) and puts the mark in front only where it writes (found by the two-copies check
  // 2026-10-09: glued on here, every prompt failed that lock).
  const markOf = from =>
    '[Sent from ' +
    (String(from || '')
      .replace(/[\[\]\r\n]/g, '')
      .trim() || 'another computer') +
    '] ';

  // A prompt from another computer (operation 1). The guarded
  // delivery of prompt-submit.js, which holds it on this computer while anything is in its way and
  // asks the guard again at every write (changes 2 and 4). `paste: true` is a literal and no
  // `agent` option is passed: the CLI is the one this computer's own terminal service says the
  // panel runs. → one of the five words of prompt-submit.js REMOTE; a held one ends through `done`.
  // tail: '' or this computer's own " [Attached image: <path>]" words for files that came with the
  // prompt and were saved here.
  async function prompt({ key, panelId, text, from, guard, done, tail }) {
    const allowed = () => guard() === true;
    const r = await submit(String(panelId), String(text), {
      paste: true,
      remote: {
        from: String(from || ''),
        key: String(key),
        mark: markOf(from),
        ...(typeof tail === 'string' && tail ? { tail } : null),
        guard: allowed,
        onDone: word => done(word),
      },
    });
    return r && typeof r.state === 'string' ? r.state : 'failed';
  }

  // A message from an agent on another computer. The same
  // guarded delivery as a prompt, and nothing else: held on this computer while anything is in its
  // way, the guard asked at every write, the words checked to start with a word. What differs is
  // what stands around the words, both made on this computer and handed in: mark ("[from NAME · CLI
  // on COMPUTER (…id)] ", so it reads as another agent's request and never as the user's task) and
  // tail (the fixed line that says so), and `say: true`, which tells prompt-submit.js that an
  // agent's text goes in. wrote(out): called in the turn of the write with exactly what is written
  // (remote-say.js ties the turn it starts to it).
  async function say({ key, panelId, text, from, mark, tail, guard, done, wrote }) {
    if (typeof mark !== 'string' || !mark.startsWith('[from ')) return 'refused';
    const allowed = () => guard() === true;
    const r = await submit(String(panelId), String(text), {
      paste: true,
      remote: {
        from: String(from || ''),
        key: String(key),
        mark,
        tail: typeof tail === 'string' ? tail : '',
        say: true,
        onWrite: out => {
          try {
            wrote(out);
          } catch {
            /* the tie is lost, not the message */
          }
        },
        guard: allowed,
        onDone: word => done(word),
      },
    });
    return r && typeof r.state === 'string' ? r.state : 'failed';
  }

  // An interrupt (operation 2): the guards of `tnai intervene` (agent-mesh.js), each a refusal
  // here, since nothing is sent in its place: a question waits (Esc would answer it), the input
  // holds unsent text or the user is dictating, the agent is not working, or it was interrupted
  // less than two minutes ago, by another computer or by an agent's `tnai intervene` (one count for
  // both, kept by agent-mesh.js). Then one Esc and nothing else, written in the turn of those
  // checks; OpenCode: its own abort call and no key at all. Claude Code stopped before the first
  // words of its reply puts the task's prompt back into its input: no Enter is pressed for the
  // other computer (as `tnai intervene` would), the panel is marked as holding unsent text and the
  // answer is "unsent" (change 12). Not known within the wait reads the same way, so nothing is
  // ever typed behind text that may be there.
  async function interrupt(panelId, guard) {
    const a = agentNow(panelId);
    if (!a || guard() !== true) return 'refused';
    if (attention.blocker(panelId) || attention.hasDraft(panelId) || !turns.busy(panelId))
      return 'refused';
    if (mesh.interruptLeft(panelId) > 0) return 'refused';
    mesh.interruptedNow(panelId);
    if (a.cli === 'OpenCode') {
      let r = null;
      try {
        r = await abort(panelId);
      } catch {
        /* not aborted */
      }
      return r && r.ok === true ? 'done' : 'failed';
    }
    ptys.write(panelId, '\x1b');
    if (a.cli !== 'Claude Code') return 'done';
    let how = '';
    for (
      let waited = 0;
      !(how = turns.stopped(panelId)) && waited < INTERRUPT_REPLY_MS;
      waited += 250
    )
      await wait(250);
    if (how === 'reply') return 'done';

    // The wait is over: what the panel runs is asked again. Its process ended meanwhile (a stop, a
    // close, the agent's own end): nothing is marked for a panel that runs nothing, or for another
    // process that took it.
    const now = agentNow(panelId);
    if (!now || now.running !== true || now.pid !== a.pid || now.startedAt !== a.startedAt)
      return 'done';
    attention.remotePasted(panelId);
    attention.unsent(panelId, mesh.taskOf(panelId) || 'its task');
    return 'unsent';
  }

  // Stop (operation 3): the stop button's own call, which ends the panel's process tree and leaves
  // the panel. What the panel runs is asked again in this same turn, here and by the guard (which
  // compares the ticket), so a PowerShell panel, a sign-in run or another process that took the
  // panel since is never stopped from another computer (change 3).
  function stop(panelId, guard) {
    if (!appStarted(agentNow(panelId)) || guard() !== true) return 'refused';
    return ptys.stop(panelId) === true ? 'done' : 'failed';
  }

  // ---- a start (operation 4, change 6) ----
  // `pty:start` asks this before anything else. Three kinds of start are changed; every other one
  // comes back untouched (the same object).
  // 1. One that carries the mark of a request `start` below sent to the window: taken once, for a
  // fresh agent in run mode only (never a sign-in run, a resumed conversation, a custom agent or a
  // sub-agent) of a CLI on the list above, and always at "Ask first", whatever level the project or
  // the CLI default would give. The level is set here, for this exact panel, and the panel is
  // remembered as started from another computer. → also `remote`: who asked and their guard, for
  // `mayStart` below. A mark that is unknown, used, or no longer waited for starts nothing.
  // 2. Every later start of a panel that is remembered so (its process ended and the panel is
  // started again: by this computer's user, after a restart of the app, by another agent's
  // message): "Ask first" again, for as long as the panel exists. A
  // resumed conversation gets the level only where it can be given on a resume (the two lists
  // above); elsewhere it is refused. The same holds for a conversation of such a panel that is
  // resumed in another panel, after this computer's user closed the first: that panel becomes one
  // of them (lifecycle.remoteResumed), so the agent still counts as started from another computer.
  // Nothing a paired computer sends asks for a resume: a marked start (1) never carries one.
  // 3. A sub-agent whose lead is such a panel: never above "Ask first", decided here and not by
  // what the window remembers.
  function startOptions(options) {
    if (!options || typeof options !== 'object') return { options };
    if (!(options.remote === undefined || options.remote === null || options.remote === '')) {
      const fresh =
        typeof options.remote === 'string' &&
        typeof options.paneId === 'string' &&
        options.paneId !== '' &&
        typeof options.agent === 'string' &&
        STARTABLE.includes(options.agent) &&
        (options.mode === undefined || options.mode === 'run') &&
        !options.resumeId &&
        !options.customAgentId &&
        !options.subagentOf &&
        !options.login;
      const kept = fresh
        ? lifecycle.remoteTake(options.remote, options.paneId, options.agent)
        : false;
      if (!kept)
        return { error: 'This start was asked from another computer and is no longer wanted.' };
      const { remote, ...rest } = options;
      return {
        options: { ...rest, mode: 'run', access: 'ask', ownedByUser: true },
        remote: { from: typeof kept.from === 'string' ? kept.from : '', guard: kept.guard },
      };
    }
    const agentRun =
      typeof options.agent === 'string' && options.agent !== 'Terminal' && options.mode !== 'login';
    const panel = agentRun && typeof options.paneId === 'string' && options.paneId !== '';
    const theirs =
      panel &&
      (lifecycle.remoteStarted(options.paneId) === true ||
        (typeof options.resumeId === 'string' &&
          options.resumeId !== '' &&
          typeof lifecycle.remoteResumed === 'function' &&
          lifecycle.remoteResumed(options.paneId, options.agent, options.resumeId) === true));
    if (theirs) {
      if (options.resumeId && ASK_ON_RESUME.includes(options.agent))
        return { options: { ...options, access: 'ask', askOnResume: true } };
      if (options.resumeId && !LEVEL_ON_RESUME.includes(options.agent))
        return {
          error:
            'This agent was started from your other computer and always runs at "Ask first". ' +
            options.agent +
            ' cannot be held to that when a conversation is resumed, so it was not resumed: start a new conversation in this thread, or close it.',
        };
      return options.access === 'ask' ? { options } : { options: { ...options, access: 'ask' } };
    }
    if (agentRun && options.subagentOf) {
      let line = [];
      try {
        line = parentsOf(options.subagentOf) || [];
      } catch {
        /* no known lead */
      }
      if (
        Array.isArray(line) &&
        line.some(id => typeof id === 'string' && id !== '' && lifecycle.remoteStarted(id) === true)
      ) {
        // A revived sub-agent of Claude Code: the level goes on its resume too, WHATEVER level the
        // window asked for (with the project at "Ask first" the
        // window sends `ask`, the start came back unchanged, the registry sends no level on a
        // Claude Code resume, and the CLI restored the conversation's own mode or a settings
        // `defaultMode`). `plan` stays the asked level; its resumed conversation is held too, at
        // "Ask first" (the registry's one held level), never unheld.
        const capped = options.access === 'ask' || options.access === 'plan',
          held = !!options.resumeId && ASK_ON_RESUME.includes(options.agent);
        if (capped && !held) return { options };
        return {
          options: {
            ...options,
            ...(capped ? null : { access: 'ask' }),
            ...(held ? { askOnResume: true } : null),
          },
        };
      }
    }
    return { options };
  }

  // Asked again by `pty:start` just before the process is made, with the folder it is about to
  // start in: the folder-trust question before it can stay open for
  // minutes, and the switch, the pairing or the open project can change meanwhile. A no starts
  // nothing. remote: what startOptions gave for a marked start.
  async function mayStart(remote, folder) {
    if (!remote || typeof remote.guard !== 'function') return false;
    let key = '';
    try {
      key = await folderKey(folder);
    } catch {
      /* no key: the guard says no */
    }
    try {
      return remote.guard(key) === true;
    } catch {
      return false;
    }
  }

  // Of the CLIs that are ready on this computer, the ones a paired computer may start (the list
  // above).
  const startable = ready => STARTABLE.filter(id => Array.isArray(ready) && ready.includes(id));

  // The waits of a start, and what is asked again after each (change 4: nothing here is "checked
  // once"):
  // 1. the window opens the panel and its CLI becomes ready (up to 90 s; a folder this CLI was not
  // yet allowed in is asked about on this computer first, and nobody else can answer that). After
  // it: the panel the window names must be the very one that started under this request's mark,
  // else whatever opened is stopped.
  // 2. the opened panel's own project key is read. After it: that the panel runs an
  // agent the app started, and the guard with that key (the right, the pairing, the session, the
  // project the message named), else the panel is stopped.
  // 3. the first prompt goes in through the guarded delivery, after the new agent's own start
  // questions were answered here (it is held while one is open). The same two are asked in the
  // turn of every write of it. Not taken: the panel is stopped. From the message only the CLI's
  // name from the fixed list and the text reach this; no model, effort, name or folder is passed
  // on.
  async function start({ cli, text, from, guard }) {
    if (typeof guard !== 'function') return 'refused';
    if (!STARTABLE.includes(cli)) return 'refused';
    let r = null;
    try {
      r = await lifecycle.spawnRemote(cli, { from: String(from || ''), guard });
    } catch {
      /* not started */
    }
    const opened = [
      ...new Set(
        [r && r.paneId, r && r.panel, r && r.openedPaneId].filter(
          id => typeof id === 'string' && id !== ''
        )
      ),
    ];
    const failed = () => {
      for (const id of opened) {
        try {
          ptys.stop(id);
        } catch {
          /* nothing runs there */
        }
      }
      return 'failed';
    };
    if (
      !r ||
      typeof r.paneId !== 'string' ||
      r.paneId === '' ||
      r.paneId !== r.panel ||
      lifecycle.remoteStarted(r.paneId) !== true
    )
      return failed();
    const panelId = r.paneId;
    let key = '';
    try {
      key = await panelKey(panelId);
    } catch {
      /* no key: the guard says no */
    }
    const allowed = () => {
      try {
        return appStarted(agentNow(panelId)) && guard(key) === true;
      } catch {
        return false;
      }
    };
    if (!allowed()) return failed();
    if (typeof text !== 'string' || text === '') return 'started';
    let s = null;
    try {
      s = await submit(panelId, text, {
        paste: true,
        remote: {
          from: String(from || ''),
          key: 'start:' + panelId,
          mark: markOf(from),
          guard: allowed,
          onDone: () => {},
        },
      });
    } catch {
      /* not delivered */
    }
    return s && s.ok === true && TAKEN.includes(s.state) ? 'started' : failed();
  }

  // "Choose option N" from another computer.
  // OpenCode only: the answer goes to OpenCode's own server by the question's
  // id with that option's label, taken once or refused by OpenCode itself. No byte is written to
  // the terminal, so nothing can land in the prompt box or on a permission dialog. Checked again
  // here, in the turn of the call: the plan, the agent, the guard of the operation, that very
  // question still open on OpenCode's own list, alone, asked by the main session, with one answer
  // allowed and that label at that number; and nothing else asked in that panel (a held permission
  // request). One choice for a question from here, whatever OpenCode then says.
  const chosenAsks = new Set();

  async function chooseAnswer({ panelId, ask, label, pick, guard }) {
    const a = agentNow(panelId);
    if (!a || a.cli !== 'OpenCode' || guard() !== true) return 'refused';
    let open = [];
    try {
      open = questions() || [];
    } catch {
      open = [];
    }
    const mine = open.filter(x => x && x.paneId === panelId),
      q = mine.length === 1 && mine[0].id === ask ? mine[0] : null;
    const one =
      q &&
      q.child !== true &&
      Array.isArray(q.questions) &&
      q.questions.length === 1 &&
      q.questions[0] &&
      q.questions[0].multiple !== true
        ? q.questions[0]
        : null;
    if (
      !one ||
      !Number.isInteger(pick) ||
      typeof label !== 'string' ||
      !label ||
      one.options?.[pick - 1]?.label !== label ||
      chosenAsks.has(ask)
    )
      return 'refused';
    let held = true;
    try {
      held = (pending() || []).some(p => p && p.paneId === panelId);
    } catch {
      held = true;
    }
    if (held) return 'refused';
    if (chosenAsks.size > 500) chosenAsks.clear();
    chosenAsks.add(ask); // before the call, and for good
    let r = null;
    try {
      r = await answerQuestion(panelId, ask, [[label]]);
    } catch {
      r = null;
    }
    return r && r.ok === true ? 'done' : 'failed';
  }

  return {
    agentNow,
    prompt,
    say,
    interrupt,
    stop,
    start,
    chooseAnswer,
    startOptions,
    mayStart,
    startable,
    remoteStarted: () => lifecycle.remoteOpen(),
  };
}

module.exports = {
  createRemoteActions,
  INTERRUPT_REPLY_MS,
  STARTABLE,
  LEVEL_ON_RESUME,
  ASK_ON_RESUME,
};
