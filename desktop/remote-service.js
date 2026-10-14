// Technically Not · remote-service.js — several computers, put together for the app.
// It joins the key store,
// the link, the trust gate and the "needs you" list into one service with plain-data state for the
// Devices page, and holds what the user chose (on or off, this computer's name, the per-computer
// "send the question text" switch) and the activity log, all inside the key store's encrypted blob.
// - Off (the default): no key is made, no link exists, no timer runs, no connection is made.
// Turning it on makes the key once.
// - The list leaves only through the trust gate (trust.send), and a received message goes to
// trust.onMessage first and to remote-api.js only when that returns false.
// - Only the items that block an agent are offered (permission, menu, trust): never the user's
// unsent text or a held prompt.
// - This computer's agents (name, CLI, working / needs you / idle, and the task where the question
// text may go) leave the same way (phase 1, "See"). The app hands in the list ready-made
// (agents()), so nothing here waits or asks the system for it.
// - Which project is open here leaves the same way as two commit ids (piece P2, "same project,
// seen"), and a paired computer's ids are compared with this computer's own
// copy by remote-project.js, at a rate this computer sets.
// - One thing another computer can make this one do (phase 2, first operation; remote-protocol.md
// 6c): a yes or no to a held permission request, through phone-answer.js, for a computer whose "may
// answer" switch is on here. Off by default; with it off an `answer` message is dropped unread.
// - The rest of what another computer can make this one do ("change n" below names a numbered
// change of its design): a prompt for an agent,
// an interrupt, a stop, a start, through remote-control.js, for a computer whose one "full control"
// switch is on here (change 17). Off by default; with it off such a message is dropped unread and
// unanswered (change 10). The switch includes the answer right; the "may answer" switch stays as
// the smaller right. Whenever it goes off, by any path, that computer's prompts still held here are
// removed at once (change 4).
// - A task one of this computer's agents finished leaves the same way as the lists:
// its first words, the short result and the answer's first part, to each
// computer whose text switch is on. What a paired computer reports is shown on its agent's row and
// as one bell entry, for the project open here; nothing received makes this computer do anything.
// - The live view (the rules are
// remote-view.js): a computer whose full-control switch is on here, turned on under the sentence
// about watching, may watch one agent's terminal panel at a time: text rows this computer's window
// reads from the terminal while it is asked to, inside a daily allowance kept in the key store.
// Every view is a line in the control list, a mark on the watched panel and in the bell, and ends
// the moment the switch does. The other way round, this computer's one open view of another
// computer's panel hands its picture to the open dialog on a channel of its own (on.view), never
// through state().
// - Pair, the six digits, Forget, Keep, Stop and the three switches are reachable from this
// computer's own window only (registerIpc below): no `tnai` command and no remote operation may
// call them.
//
// The real actions of the control operations are handed in (the app passes them from main.js). Each
// default does nothing and reports failure, so a service made without them can take no operation.
// Every one is called inside try/catch; a throw reads as the refusing answer. agentNow(panelId) →
// null, or what that panel runs at this moment, read from ptys.list() and the mesh and never from a
// kept list: { name, cli, mode, running, hand, instance, pid, startedAt } (cli: ptys' `agent`,
// 'Terminal' for a shell; mode 'run' for an agent; hand: true for a CLI typed by hand, must be
// exactly false; instance: lifecycle.instanceOf, not empty; pid, startedAt: the process).
// submitRemote({ key, panelId, text, from, guard, done }) → 'sent' | 'queued' | 'unconfirmed' |
// 'refused' | 'failed', or a promise of one. Delivers a prompt from another computer
// (prompt-submit.js `submit` with `remote`, paste forced on; the CLI is taken from this computer's
// own roster, never from here). text: already cleaned as a paste and starting with a word. from:
// that computer's name as shown here. key: what cancelHeld finds it by. guard() → true while it may
// still be written, asked in the turn of every write. 'queued': it is held here, and done('sent' |
// 'unconfirmed' | 'failed') is called once when it ended. 'unconfirmed': Enter was pressed once and
// this CLI gives no sign that it started. Any other word reads as 'failed'. interrupt(panelId,
// guard) → 'done' | 'unsent' | 'refused' | 'failed' (or a promise). One Esc under `tnai
// intervene`'s guards; 'unsent': interrupted, and the task's prompt is back in its input, marked as
// unsent text (change 12). stopAgent(panelId, guard) → 'done' | 'refused' | 'failed' (or a
// promise). The stop button's call; guard() again in the turn of ptys.stop. startAgent({ cli, text,
// from, guard }) → 'started' | 'refused' | 'failed' (or a promise). cli: one of 'Claude Code',
// 'Codex', 'OpenCode', 'Cursor Agent'; never a model, an effort, a name or a folder. text: '' or a
// first prompt. guard(panelKey) → true while the opened panel (its own project key handed in) may
// be used and `text` may go in; false: stop the panel, 'failed' (change 6). clis() → the lead CLIs
// installed and signed in here now, by name (['Claude Code', 'Codex']). remoteStarted() → how many
// panels started from other computers this computer's user has not closed yet (stopped ones count).
// remoteStartsToday(computerId) → how many starts that computer was given in the last 24 hours,
// remoteStartTaken(computerId) → one more now: optional, so the limit of 20 a day survives a
// restart of the app (kept with the lifecycle record). cancelHeld(key, panelId) → remove that held
// prompt unwritten (attention-service's cancelRemote). watchScreen(panelId, on) → ask this
// computer's window to hand over that panel's screen while a view runs (the rows come back through
// screen() below), or to stop. on.view(model) → what the open live-view dialog shows changed
// (model: remote-view.js createWatcher; null = no view). mono() → milliseconds on a clock that only
// goes forward. planLocked() → false only while the plan lets agents be used here (main.js
// `lockedOut`); anything else refuses every operation. Pure Node apart from storageBackend(), so
// tools/remote-service-test.js runs it as the app does. Nothing here may log a key or a code.
const keys = require('./remote-keys.js');
const { createLink } = require('./remote-link.js');
const {
  createRemoteApi,
  projectKey: keyShape,
  shapeOp,
  shape: shapeItem,
} = require('./remote-api.js');
const {
  createControl,
  shapeReply,
  promptText,
  roomLeft,
  firmKey,
  CLIS,
  withFull,
  readFull,
  bindingFor,
  withPick,
  readPick,
  bindingPick,
} = require('./remote-control.js');
const { createViews, createWatcher } = require('./remote-view.js');
const {
  createTaker,
  createSender,
  checkFile,
  PROMPT_FILES,
  PROMPT_MAX,
  // a picture or text file with a prompt
} = require('./remote-files.js');
const { createRelater } = require('./remote-project.js');

// the git hand-over's branch name, made here from the pairing record
const { shortId: handoffId, branchName: handoffBranch } = require('./remote-git.js');
const { createTrust } = require('./remote-trust.js');
const { phoneAnswers, bindingOf } = require('./phone-answer.js');
const crypto = require('crypto');
const { fields } = require('./remote-noise.js');

// attention-service.js kinds that mean "an agent waits for you"
const NEEDS = new Set(['permission', 'menu', 'trust']);

// keep-awake: how long a waiting question holds this computer awake
const AWAKE_WAIT_MS = 2 * 60 * 60 * 1000;
const LOG_MAX = 50;
const OTHERS_MAX = 10;

// answers taken from other computers that the window is told about (each is in the activity log as
// well)
const TAKEN_MAX = 8;

// Control operations get a list of their own (change 11): ten prompts a minute would push the
// pairing lines out of the 50 above.
const OPS_MAX = 500,
  // lines kept, and how many of the newest go to the window with every state (all of them:
  // controlLog())
  OPS_SHOWN = 50;
const NOTICE_MS = 60 * 1000; // operations of one computer inside this time are one notice

// say: an agent's message for an agent here, taken only under its own
// mark.
// sync: the git hand-over.
// choose (6i): "option N of the question that was shown"; never a key.
// file, promptf: a file's offer and the prompt that names files (remote-files.js)
const OPS = new Set(['prompt', 'act', 'start', 'choose', 'file', 'promptf', 'sync', 'say']);

// The relay takes 120 messages a minute from one connection, and past that this computer's whole
// link is silent for up to two minutes. Everything sent through the
// trust gate is counted, and the live view's frames go only while the last minute holds fewer than
// this: the lists, "needs you" and the replies keep the rest. 50 of the 120 stay for what is not a
// frame: with full control a computer can make this one send about 40 replies a minute, beside the
// lists
const LINK_SAFE = 70;

// The largest an operation's own fields can be, for "how much room is left" on the sending
// computer.
const WORST = { n: 'f'.repeat(16), c: 0x7fffffff, ms: 9999999999 };

// The key store's backend in the app: Electron safeStorage and one file in the settings folder. Not
// available when safeStorage would only be plain text (Linux without a keyring, where user-auth.js
// switches the plain-text fallback on for the sign-in).
function storageBackend({ safeStorage, file, fs = require('fs'), platform = process.platform }) {
  return {
    available() {
      // macOS always has its keychain, and asking reads it: a keychain item made by another build
      // then raises a prompt that blocks the main process, at start, while the window asks for the
      // state. The real read happens only when something is saved or read.
      if (platform === 'darwin') return true;
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        return !(
          platform === 'linux' &&
          typeof safeStorage.getSelectedStorageBackend === 'function' &&
          safeStorage.getSelectedStorageBackend() === 'basic_text'
        );
      } catch {
        return false;
      }
    },
    encrypt: buf => safeStorage.encryptString(buf.toString('base64')),
    decrypt: buf => Buffer.from(safeStorage.decryptString(buf), 'base64'),
    exists() {
      return fs.existsSync(file);
    },
    read() {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    write(text) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  };
}

// self = { id }: this computer's device id (user-auth.js). deviceName() → its default name.
// backend: see storageBackend. getTicket() → Promise<string>, rejecting with { status, code }. url
// = "wss://api…", or a function giving it (read when remote is turned on). items() → the local
// attention items. agentName(paneId) → the agent's name. agents() → this computer's agents now, [{
// id, name, cli, status, since, task }]. devices() → Promise<[{ id, name, last_seen }]>, the
// account's computers as the server lists them. on.changed(state) fires (once per turn) whenever
// state() would return something new. on.up() fires when the link was just made and when a session
// with another computer starts (the app fills its agent list then). answerPermission(requestId,
// 'once' | 'deny') → true when that held permission request took the answer: the call the app's own
// permission card makes (agent-hooks.js). It is the one thing another computer can make this one
// do, and only for a computer whose "may answer" switch the user turned on here. project() → the
// project open on this computer now, { root, head } (two commit ids) or null, kept ready by the app
// like the agent list. projectKey() → the key of the project open here ('' = none or not known
// yet), kept ready by the app; a paired computer's agents are listed when theirs is the same (6e).
// relate(mine, theirs) → Promise: how far a paired computer's copy of the same project is from this
// one (remote-project.js). Read-only: each computer's card then says whether it has this project
// (piece P2).
function createRemoteService({
  self,
  deviceName = () => '',
  backend,
  getTicket,
  url,
  items = () => [],
  agents = () => [],
  agentName = () => '',
  devices = async () => [],
  // true while the relay is one where device ids are free (main.js: the user's own relay)
  freeIds = () => false,
  answerPermission = () => false,
  project = () => null,
  projectKey = () => '',
  relate = null,
  // Files that came with a prompt: remoteFiles.save(kind, bytes)
  // → { path, name } once written in the app's attachments folder under a name made there,
  // remoteFiles.remove(path), remoteFiles.show(name) → show it in its folder. null: no file is
  // taken from another computer.
  remoteFiles = null,
  agentNow = () => null,
  submitRemote = () => 'failed',
  interrupt = () => 'failed',
  stopAgent = () => 'failed',
  startAgent = () => 'failed',
  clis = () => [],
  // A choice (6i): chooseAnswer({ panelId, ask, label, pick, guard }) → 'done' | 'refused' |
  // 'failed'. The app answers that very question of that panel with that option
  // (desktop/remote-actions.js: OpenCode's own server, by the question's id; no byte is written).
  chooseAnswer = () => 'failed',
  // The git hand-over: desktop/remote-git.js createHandoff for the open
  // project, { handoff({ commit, short, guard }) → Promise<word>, branches() → Promise<short ids
  // that have a hand-over branch> }. null: this app offers and takes none.
  handover = null,
  remoteStarted = () => Infinity,
  remoteStartsToday = null,
  remoteStartTaken = null,
  cancelHeld = () => 0,
  planLocked = () => true,
  watchScreen = () => {},
  mono,
  on = {},
  WebSocket,
  now = Date.now,
  timers,
  random,
  // Keep-awake (item 18). power.hold(on) → start or end the system's
  // "do not sleep by itself" request (desktop/main.js: Electron's powerSaveBlocker),
  // power.battery() → true while this computer runs on battery, power.working() → true while an
  // agent on this computer is in a turn (from what the app already knows; optional). By default
  // nothing is held.
  power = { hold: () => {}, battery: () => false },
  // Agents message agents (the rules are remote-say.js, the write is
  // remote-actions.js `say`). sayTarget(panelId) → true while that panel may take a message from
  // another computer's agent. sayHere(o) → Promise of a prompt's word: o = { key, peerId, panelId,
  // text, kind, by, n, guard, from, computer, done }. By default nothing is taken.
  sayTarget = () => false,
  sayHere = async () => 'refused',
}) {
  const store = keys.keyStore(backend);
  let prefs = null,
    problem = null,
    link = null,
    // a link was taken down by relayGoing() and waits for relayChanged() to be made again
    relayWent = false,
    trust = null,
    api = null,
    answers = null,
    relater = null,
    control = null,
    views = null,
    watcher = null;
  let opsLog = [],
    notices = [],
    noticeN = 0,
    written = false;

  // Files with a prompt (remote-files.js): taker holds what another computer sends this one until
  // its prompt names it; sender carries this computer's own files to another; sending is what the
  // window may show of that ({ peer, agent, file, files, piece, pieces }).
  let taker = null,
    sender = null,
    sending = null;

  // Every message for a paired computer leaves through here: the trust gate, and a count of the
  // last minute for the live view's budget. ONE ACCOUNT OF THE LINK, for all three. The
  // relay takes 120 messages a minute from this computer and mutes its whole link past that. So
  // nothing is counted per feature any more: `lastMinute()` is everything sent in the last 60
  // seconds plus one for every operation of another computer that was taken and has not been
  // answered yet (its reply is owed). Four lines, each below the next: STREAM_MAX 70 optional
  // streams go only below it: the live view's frames, a choice, a piece of an attachment (class
  // 'stream'). REPLY_MAX 100 an operation of another computer is taken only below it (`admit`);
  // past it the message is dropped unanswered and that computer reads "no reply". Also at most
  // OPS_PEER_MIN taken operations a minute from one computer, of all kinds. FIRST_MAX 112 a stop,
  // an interrupt and a yes or no to a permission request are still taken up to here: served first.
  // HARD_MAX 116 nothing leaves at or above it, lists and "needs you" included (they are sent again
  // at their next change). Four are left for the difference between this computer's minute and the
  // relay's. A caller that sends a stream of its own passes the third argument 'stream'; a reply to
  // an operation it took after `admit` passes 'reply' (or uses a type named in REPLIES).
  const STREAM_MAX = LINK_SAFE,
    REPLY_MAX = 100,
    FIRST_MAX = 112,
    HARD_MAX = 116,
    OPS_PEER_MIN = 30,
    ACT_ROOM = 4;
  const REPLIES = new Set([
      'prompted',
      'acted',
      'started',
      'chosen',
      'answered',
      'filed',
      'synced',
      'said',
    ]),
    STREAMS = new Set(['frame']);
  const sentAt = [],
    admitAt = [],
    replyAt = [],
    admits = new Map(); // admits: computer id → when its operations were taken in the last minute
  const pruned = (a, t) => {
    while (a.length && t - a[0] >= 60000) a.shift();
    return a.length;
  };
  const lastMinute = () => {
    const t = now();
    return pruned(sentAt, t) + Math.max(0, pruned(admitAt, t) - pruned(replyAt, t));
  };
  const gateSend = (to, obj, cls) => {
    const type = obj && typeof obj.t === 'string' ? obj.t : '',
      kind =
        cls === 'stream' || STREAMS.has(type)
          ? 'stream'
          : cls === 'reply' || REPLIES.has(type)
            ? 'reply'
            : 'other';
    const load = lastMinute();
    if (load >= HARD_MAX || (kind === 'stream' && load >= STREAM_MAX)) return false;
    const ok = trust ? trust.send(to, obj) === true : false;
    if (ok) {
      const t = now();
      sentAt.push(t);
      if (kind === 'reply') replyAt.push(t);
    }
    return ok;
  };

  // May an operation of that computer be taken now? Asked before any of its checks; true reserves
  // the room for its reply. first: a stop, an interrupt, a yes or no to a permission request.
  // False: drop the message and say nothing.
  const admit = (peerId, first = false) => {
    const t = now(),
      load = lastMinute(),
      mine = (admits.get(peerId) || []).filter(x => t - x < 60000);

    // Served first means "up to FIRST_MAX", not "outside one computer's count"
    // (a yes or no, a stop and an interrupt were taken beside the 30, so one computer
    // could take 54 places a minute). They count toward the 30 now. A stop or an interrupt (first
    // === 'act') has ACT_ROOM places past it, the four a minute remote-control.js takes of them, so
    // that computer's own prompts and answers can never crowd out its Stop: 34 at most from one
    // computer.
    const urgent = first === true || first === 'act',
      room = OPS_PEER_MIN + (first === 'act' ? ACT_ROOM : 0);
    const ok = mine.length < room && (urgent ? load < FIRST_MAX : load < REPLY_MAX);
    if (ok) {
      mine.push(t);
      admitAt.push(t);
    }
    if (mine.length) admits.set(peerId, mine);
    else admits.delete(peerId);
    return ok;
  };

  // A list that was refused at the hard line would otherwise go again only "at its next change",
  // and "needs you" that never changes again would never arrive.
  // So one timer, alive only after such a refusal: when the full minute has passed, what did not
  // leave is sent (remote-api.js sends a list again only when its last send failed, so nothing goes
  // twice). Still full then: the refusal starts the timer again. It ends with the link.
  const LISTS = new Set(['needs', 'agents', 'project', 'control']),
    AGAIN_MS = 61 * 1000;
  const clock = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) };
  let againTimer = null;
  const listsAgain = () => {
    if (againTimer || !api) return;
    againTimer = clock.set(() => {
      againTimer = null;
      if (!api) return;
      try {
        api.changed();
        api.projectChanged();
        api.controlChanged();
      } catch {
        /* the next change sends them */
      }
    }, AGAIN_MS);
  };
  const myProject = () => {
    try {
      return project() || null;
    } catch {
      return null;
    }
  };

  // Another computer's agents follow the project that is open here: nobody should see agents from
  // another project after switching. A row whose key
  // is another project's is counted, not listed. A row without a key (an older version, the text
  // switch off over there) is listed as before: nothing is known about it. The window is never
  // given a key.
  const myKey = () => {
    try {
      return keyShape(projectKey());
    } catch {
      return '';
    }
  };

  // Nor a ticket: a row says only whether it can be controlled from here (`can`), which is true
  // while that computer says it takes operations from this one (lets) and the row carries a ticket.
  // A hint for the buttons; the other computer checks every operation. `mark`: which agent a row
  // is, for the page to hand back with a press: 12 hex characters of a hash over the row's ticket,
  // never the ticket. `prompt` and `act` below compare it with the ticket they are about to send,
  // so a press is carried out only for the very agent the page had drawn: not for one that was
  // restarted, renamed or replaced under the same row id a moment before, while the page still
  // showed the older list. '' for a row that cannot be controlled.
  const rowMark = to =>
    crypto
      .createHash('sha256')
      .update(fields('tnai-row-v1', String(to)))
      .digest('hex')
      .slice(0, 12);

  // `last`: the task that agent finished last (6g), only when the report names this row's id, name
  // and CLI: the app reuses panel ids, so an id alone could put an earlier agent's result on the
  // one that sits in that panel now. `reports` is already the open project's.
  function byProject(rows, lets, reports = []) {
    const mine = myKey(),
      here = [];
    let elsewhere = 0;
    for (const { p, to, ...row } of rows) {
      if (p && p !== mine) {
        elsewhere++;
        continue;
      }
      const r = reports.find(
        x => !x.off && x.id === row.id && x.name === row.name && x.cli === row.cli
      ); // off: that row went through another task, or left the list, since (remote-api.js)

      // sure: the row names its project and it is the one open here. A row without a key (an older
      // version, the text switch off over there) is listed on the card as before, but a place that
      // shows only what is known to belong to this project asks for this.
      here.push({
        ...row,
        sure:
          /^[0-9a-f]{40}$/.test(p || '') &&
          p ===
            mine /* a first-commit key only: a folder without git has a key made from its name, and two folders of one name are not one project (security review 16) */,
        can: lets === true && !!to,
        mark: lets === true && to ? rowMark(to) : '',
        ...(r
          ? {
              last: {
                at: r.at,
                task: r.task,
                did: r.did,
                has: !!r.text /* the answer's first part itself is not in the state: reportText() (security review 14, Low 7) */,
                more: r.more,
                got: r.got,
              },
            }
          : {}),
      });
    }
    return { here, elsewhere };
  }

  // A paired computer's finished tasks follow the project open here like its rows (6e, skill rule
  // 12): one whose key is another project's is kept and not shown, one without a key is shown.
  // Nothing of a paused pairing is shown.
  const reportsHere = (v, mine) => (v ? v.reports.filter(r => !r.p || r.p === mine) : []);

  // From when a paired computer may be told of this computer's finished tasks:
  // the moment it was paired, its text switch last went on, or its paused pairing was
  // kept, whichever is latest. A task that ended before that is never sent to it: not one from
  // before the pairing, not one that finished while the switch was off or the pairing paused. The
  // pairing's time is in the key store; the other two are noted here when they happen, session or
  // not, and live as long as the app runs (what could be sent does not outlive it either).
  const tellSince = new Map();
  const tellFrom = id => {
    const p = store.pairing(id);
    return p
      ? Math.max(Number.isFinite(p.since) && p.since > 0 ? p.since : 0, tellSince.get(id) || 0)
      : Infinity;
  };

  // A paired computer's project against this one's, looked at again whenever either changes.
  // Nothing of a paused pairing is compared.
  const relook = id => {
    if (!relater || !api) return;
    const v = api.view(id);
    relater.set(id, myProject(), v && trust && trust.open(id) ? v.project : null);
  };
  let conn = { connection: 'off', reason: null },
    run = null,
    ended = null,
    asked = null,
    others = [],
    queued = false,
    signedOut = false,
    acct = '',
    taken = [],
    takenN = 0;
  const peerState = new Map(),
    needUpdate = new Set(),
    told = new Set();

  // Keep-awake: OFF unless the user turned it on. Held only while all of these are true: the
  // setting is on, connecting is on and its link exists, at least one computer is paired and not
  // paused, at least one agent on this computer is working or waits on a question a paired computer
  // could answer, and this computer is not on battery (the plan's "while agents are working"). A
  // live session is NOT needed: the point is that this computer can still be reached after the
  // other one disconnected. It is given back the moment one of them ends, and when the app quits.
  // Looked at again at every change that is pushed, when the power source changes and when the app
  // says its agents changed (powerChanged; pushed events, nothing is polled; the one timer is the
  // end of a waiting question's hold). Reads the key store only when the setting is on (so never on
  // a computer that never used this).
  let awakeHeld = false,
    awakeSaid = 'setting',
    awakeUntil = 0,
    awakeTimer = null;
  const awakeWhy = () => {
    if (!prefs || prefs.awake !== true) return 'setting';
    if (!prefs.on || !link) return 'off';
    let paired = [];
    try {
      paired = store.pairings();
    } catch {
      paired = [];
    }
    if (!paired.length) return 'unpaired';
    if (!trust || !paired.some(p => trust.open(p.id) === true)) return 'paused';

    // A question that waits holds this computer awake for AWAKE_WAIT_MS from the moment it was
    // asked, not for as long as it waits (an
    // agent that stops at a question at night kept the PC awake until morning). A panel with an
    // open question is waiting, not working, also while its turn has not ended, so it is left out
    // of power.working. A question without a readable time holds nothing.
    let busy = false,
      waited = false;
    awakeUntil = 0;
    try {
      const waits = (items() || []).filter(it => it && NEEDS.has(it.kind)),
        t = now();
      for (const it of waits) {
        const end = Number.isFinite(it.since) ? it.since + AWAKE_WAIT_MS : 0;
        if (end > t) {
          busy = true;
          awakeUntil = awakeUntil ? Math.min(awakeUntil, end) : end;
        } else waited = true;
      }
      if (
        typeof power.working === 'function' &&
        power.working(new Set(waits.map(it => it.paneId))) === true
      ) {
        busy = true;
        awakeUntil = 0; /* a working agent holds it whatever the questions do */
      }
    } catch {
      busy = false;
      awakeUntil = 0;
    }
    if (!busy) return waited ? 'waited' : 'idle';
    let battery = false;
    try {
      battery = power.battery() === true;
    } catch {
      battery = false;
    }
    return battery ? 'battery' : '';
  };

  // → true when the reason changed (held or not, and why not), so the caller knows the card's line
  // is out of date. One timer, only while this computer is held awake by nothing but a waiting
  // question: it looks again when the youngest hold ends.
  const applyAwake = () => {
    const why = awakeWhy(),
      changed = why !== awakeSaid,
      want = why === '';
    awakeSaid = why;
    if (want !== awakeHeld) {
      awakeHeld = want;
      try {
        power.hold(want);
      } catch {
        /* the system refused: nothing is held */
      }
    }
    if (awakeTimer) {
      clock.clear(awakeTimer);
      awakeTimer = null;
    }
    if (want && awakeUntil)
      awakeTimer = clock.set(
        () => {
          awakeTimer = null;
          if (applyAwake() && link) push();
        },
        Math.max(1000, awakeUntil - now() + 1000)
      );
    return changed;
  };
  const push = () => {
    applyAwake();
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      try {
        on.changed?.(state());
      } catch {
        /* a listener's error is not ours */
      }
    });
  };

  // What the user chose. Read once; a store that cannot be used or read leaves remote off and says
  // why.
  function ready() {
    if (prefs) return true;
    if (!store.available()) {
      problem = 'no_storage';
      return false;
    }
    try {
      const p = store.note('prefs') || {};
      prefs = {
        on: p.on === true,
        account: typeof p.account === 'string' ? p.account : '',
        name: keys.clean(p.name, 60),
        detail: p.detail && typeof p.detail === 'object' ? p.detail : {},
        answer:
          p.answer && typeof p.answer === 'object' && !Array.isArray(p.answer) ? p.answer : {},
        control:
          p.control && typeof p.control === 'object' && !Array.isArray(p.control) ? p.control : {},
        watch: p.watch && typeof p.watch === 'object' && !Array.isArray(p.watch) ? p.watch : {},
        awake: p.awake === true,
        choose:
          p.choose && typeof p.choose === 'object' && !Array.isArray(p.choose) ? p.choose : {},
        say: p.say && typeof p.say === 'object' && !Array.isArray(p.say) ? p.say : {},
        sync: p.sync && typeof p.sync === 'object' && !Array.isArray(p.sync) ? p.sync : {},
        log: Array.isArray(p.log) ? p.log.slice(0, LOG_MAX) : [],
      };
      const o = store.note('ops');
      opsLog = Array.isArray(o) ? o.filter(e => e && typeof e === 'object').slice(0, OPS_MAX) : [];
      problem = null;
      return true;
    } catch {
      problem = 'unreadable';
      return false;
    }
  }

  // Nothing was ever saved: remote is off and nothing is paired, so the app's own start must not
  // ask the system's secure storage at all (on macOS that question can open a keychain prompt that
  // blocks the whole app before its window: release 0.3.65's Mac build hung there).
  const never = () => {
    try {
      return !prefs && typeof backend.exists === 'function' && !backend.exists();
    } catch {
      return false;
    }
  };
  const save = () => store.setNote('prefs', prefs);
  const myName = () => (prefs && prefs.name) || keys.clean(deviceName(), 60) || 'Computer';
  const nameOf = id => store.pairing(id)?.name || others.find(o => o.id === id)?.name || 'Computer';
  const detailOn = id =>
    // on for a newly paired computer
    !(keys.safeId(id) && Object.hasOwn(prefs.detail, id) && prefs.detail[id] === false);

  function log(kind, extra = {}) {
    prefs.log.unshift({ at: now(), kind, ...extra });
    prefs.log.length = Math.min(prefs.log.length, LOG_MAX);
    save();
  }

  // ---- a yes or no to a permission prompt from a paired computer ----
  // The "may answer" switch is stored as the id of the pairing it was
  // given to, and is on only while it equals that pairing's id now and the text switch is on: a
  // computer that was forgotten and paired again starts with it off, whichever way the old pairing
  // ended.
  const rightOn = (map, id) => {
    if (
      !prefs ||
      !keys.safeId(id) ||
      !Object.hasOwn(map, id) ||
      typeof map[id] !== 'string' ||
      !map[id] ||
      !detailOn(id)
    )
      return false;
    const p = store.pairing(id);
    return !!p && p.pairingId.toString('base64') === map[id];
  };

  // The one "full control" switch (6f, change 17), stored and read exactly like "may answer": the
  // id of the pairing it was given to.
  const controlOn = id => !!prefs && rightOn(prefs.control, id);

  // the "may answer" switch by itself
  const answerAlone = id => !!prefs && rightOn(prefs.answer, id);

  // Full control includes the answer right; nothing is written for it, so turning full control off
  // leaves "may answer" as the user set it.
  const answerOn = id => answerAlone(id) || controlOn(id);

  // The right is taken away (the text switch went off, the pairing was paused): said in the
  // activity log, like turning it off by hand.
  const dropAnswer = id => {
    if (!Object.hasOwn(prefs.answer, id)) return;
    delete prefs.answer[id];
    log('answer_off', { peer: id, name: nameOf(id) });
  };

  // The same for full control, and first that computer's prompts still held here are removed
  // (change 4): each is cancelled unwritten and the computer hears "failed" if it can still be
  // reached. Watching: full control that was turned on under the sentence
  // that says what can be watched. Stored like the switch, as the pairing id it was given for; a
  // full-control switch from before the sentence keeps its prompts and refuses a view.
  const watchOn = id => controlOn(id) && rightOn(prefs.watch, id);

  // Choosing an option (change 11): full control that was turned on under a
  // sentence that names it. Stored like watching. A grant from before does not include it. The
  // words are "It can pick an option when your agents ask you
  // to choose."; the page shows them in the full-control question and then passes setControl's
  // third argument.
  const chooseOn = id => controlOn(id) && !!prefs.choose && rightOn(prefs.choose, id);

  // Agents message agents: full control
  // that was turned on under the sentence for it ("Agents on (A) can, with
  // nobody pressing anything, ask agents here questions. …"). Stored like watching and choosing; a
  // grant from before does not include it. It is read in two places: on the computer that is asked
  // (may that computer's agents message mine) and on the computer that asks (may that computer's
  // answer enter my agent).
  const sayOn = id => controlOn(id) && !!prefs.say && rightOn(prefs.say, id);

  // n → { peer, answer, at }: an ask of one of this computer's agents that waits for its answer
  const sayWait = new Map();

  // The git hand-over: full control that was
  // turned on under a sentence that names it. Stored like watching and choosing. The user
  // approved the sentence as written 2026-10-10: the window's channel remote:setControl sets this
  // mark only for the word 'choose say sync', which the question passes when it showed that
  // sentence. Without the mark every `sync` from another computer is refused. Bringing another
  // computer's commit here by this computer's own press needs no right and works.
  const syncOn = id => controlOn(id) && !!prefs.sync && rightOn(prefs.sync, id);
  const handoffShort = id => {
    let all = [];
    try {
      all = store.pairings().map(p => p.id);
    } catch {
      /* no list: no name */
      return '';
    }
    return handoffId(id, all);
  };

  // Which paired computers have a hand-over branch in the project open here: read with one git
  // command when git's files change while a session is open, after a hand-over, and when a session
  // starts; never on a timer. brought: how this computer's own last "bring" ended for each
  // computer, in this run of the app only.
  let handed = new Set(),
    handedBusy = false,
    handedAgain = false;
  const brought = new Map();

  function lookHanded() {
    let any = false;
    try {
      any = !!handover && !!link && link.state().sessions.length > 0;
    } catch {
      /* no link */
    }
    if (!any) return; // nobody is connected: nothing is read
    if (handedBusy) {
      handedAgain = true;
      return;
    }
    handedBusy = true;
    Promise.resolve()
      .then(() => handover.branches())
      .then(
        list => (Array.isArray(list) ? list : []),
        () => []
      )
      .then(list => {
        handedBusy = false;
        const next = new Set(list.filter(s => typeof s === 'string'));
        if (next.size !== handed.size || [...next].some(s => !handed.has(s))) {
          handed = next;
          push();
        }
        if (handedAgain) {
          handedAgain = false;
          lookHanded();
        }
      });
  }

  // A hand-over asked by another computer, in the turn of remote-control.js's checks: that computer
  // holds the right now, and the branch's name is this computer's own. Asked again before every
  // fetch and before the write, with the plan lock.
  const syncHere = ({ peerId, commit, guard }) => {
    if (!handover || !syncOn(peerId)) return 'refused';
    const short = handoffShort(peerId);
    if (!short) return 'failed';
    return Promise.resolve(
      handover.handoff({
        commit,
        short,
        guard: () => !locked() && syncOn(peerId) && guard() === true,
      })
    ).then(
      w => {
        lookHanded();
        return w;
      },
      () => 'failed'
    );
  };

  // The one open question of that panel that takes a choice, as this computer would send it now:
  // the app's item (attention-service.js adds `opts` and `ask` only to a question the CLI itself
  // reported, alone in its panel) shaped with its labels and its binding.
  const choiceOf = panelId => {
    const it = offered().find(
      x =>
        x.kind === 'menu' &&
        x.inferred !== true &&
        x.paneId === panelId &&
        Array.isArray(x.opts) &&
        typeof x.ask === 'string' &&
        x.ask
    );
    const s = it
      ? withPick(
          shapeItem(
            {
              id: it.id,
              kind: it.kind,
              agent: agentName(it.paneId),
              detail: it.detail,
              since: it.since,
              inferred: it.inferred,
            },
            true
          ),
          it
        )
      : null;
    return s && Array.isArray(s.opts) ? { it, s, of: bindingPick(s) } : null;
  };

  // A choice from another computer, in the turn of remote-control.js's checks: that computer holds
  // the right now, that panel has such a question now, the binding it sent is the binding of that
  // question as it is listed now, and the number is one of its options. Then the app answers it.
  // Anything else: refused, and nothing is written or answered.
  const chooseHere = ({ peerId, panelId, of, pick, guard }) => {
    // The line remote-control.js wrote a moment ago for this choice. It says "chose" only when an
    // option was really chosen: the option's words are put in when the question is found,
    // and a choice that is refused here, or that the app does not carry out, turns it
    // into the line of a try that was not taken (found in the test round of 2026-10-10: the list
    // said "chose" for a choice whose question had changed).
    const line =
      opsLog[0] && opsLog[0].op === 'choose' && opsLog[0].peer === peerId ? opsLog[0] : null;
    const amend = (op, head) => {
      if (!line) return;
      line.op = op;
      line.head = head;
      line.length = head.length;
      try {
        store.setNote('ops', opsLog);
      } catch {
        /* the line stays as it was written */
      }
    };
    const no = word => {
      amend('choose_no', '');
      return word;
    };
    if (!chooseOn(peerId) || !detailOn(peerId)) return no('refused');
    const c = choiceOf(panelId);
    if (!c || c.of !== of || pick > c.s.opts.length) return no('refused');
    const label = c.s.opts[pick - 1];
    amend('choose', pick + ': ' + label);
    let r;
    try {
      r = chooseAnswer({ panelId, ask: c.it.ask, label, pick, guard });
    } catch {
      return no('failed');
    }
    return r && typeof r.then === 'function'
      ? r.then(
          word => (word === 'done' ? word : no(word)),
          () => no('failed')
        )
      : r === 'done'
        ? r
        : no(r);
  };

  // That computer's right ended, by any path: its held prompts go, and a view it has open ends in
  // the same call (change 4).
  // and every file of that computer that is on its way or waits for its prompt
  const endControl = id => {
    if (control) control.dropAll(id);
    if (views) views.endFor(id, 'off');
    if (taker) taker.dropAll(id);
  };
  const dropControl = id => {
    endControl(id);
    if (Object.hasOwn(prefs.watch, id)) delete prefs.watch[id];
    if (prefs.choose) delete prefs.choose[id];
    if (prefs.say) delete prefs.say[id];
    if (prefs.sync) delete prefs.sync[id];

    /* the mark for picking an option goes with the switch, like the one for watching */
    if (!Object.hasOwn(prefs.control, id)) return;
    delete prefs.control[id];
    log('control_off', { peer: id, name: nameOf(id) });
  };

  // The connection is closing (remote off, signed out, quit): nothing held for any computer stays.
  const dropHeld = () => {
    if (taker) for (const x of taker.holding()) taker.dropAll(x.peer);
    if (sender) sender.stop();
    if (control) for (const id of new Set(control.held().map(h => h.peerId))) control.dropAll(id);
    if (views) for (const x of views.watching()) views.endFor(x.peer, 'gone');

    // the link closes (the app, connecting off): no right was taken away, so the watching computer
    // keeps its last picture with its time
  };

  // The list line of a view, written when it starts (if it cannot be written the view is refused)
  // and completed with its length when it ends; a view cut short by a crash leaves its line without
  // one (change 15).
  function watchLine(e) {
    const line = {
      at: now(),
      peer: e.peerId,
      name: e.from,
      agent: keys.clean(e.agent, 60),
      op: 'watch',
      head: '',
      length: 0,
      more: 0,
      secs: null,
      why: '',
    };
    opsLog.unshift(line);
    opsLog.length = Math.min(opsLog.length, OPS_MAX);
    try {
      store.setNote('ops', opsLog);
    } catch (err) {
      opsLog.splice(opsLog.indexOf(line), 1);
      throw err;
    }
    push();
    return (secs, why) => {
      line.secs = Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : 0;
      line.why = String(why || '');
      try {
        store.setNote('ops', opsLog);
      } catch {
        /* the line stays as it was written */
      }
      push();
    };
  }

  // what this computer sends at all
  const offered = () => (items() || []).filter(it => it && NEEDS.has(it.kind));

  // Of those, what another computer may answer: a permission request whose short text is the whole
  // request (`whole`, set by agent-hooks.js) or whose whole command can travel beside it (`full`,
  // 6f change 8: sent as `full` with `can2`, answered with the v2 binding, and only when it fits
  // one message), and whose id leaves this computer unchanged and belongs to one item only.
  const fullOf = (s, it) => withFull(s, it.tool, it.whole === true ? undefined : it.full);
  const answerable = () => {
    const all = offered(),
      count = new Map();
    for (const it of all) {
      const k = keys.clean(it.id, 80);
      count.set(k, (count.get(k) || 0) + 1);
    }
    return all.filter(
      it =>
        it.kind === 'permission' &&
        (it.whole === true || (typeof it.full === 'string' && it.full !== '')) &&
        it.inferred !== true &&
        typeof it.id === 'string' &&
        keys.clean(it.id, 80) === it.id &&
        count.get(it.id) === 1
    );
  };

  // What a computer may do here now: nothing without its pairing, while that pairing is paused or
  // this computer is stopping, or without a session.
  const rights = id =>
    store.pairing(id) && trust && trust.open(id) && link.state().sessions.includes(id)
      ? { see: detailOn(id), answer: answerOn(id) }
      : null;

  // The delivery. phone-answer.js has checked the rights, the limit, the binding and "at most once"
  // and marked the prompt taken. First the answer is written to the activity log and kept for the
  // window's notice, whatever the delivery then returns; if that cannot be written, nothing is
  // delivered. Then the request id (the item id without the literal "permission:") goes to the
  // app's own answer call with one of two literal decisions: "session" or any wider grant cannot be
  // reached from here. All of it runs in one turn, with no wait between the rights check and the
  // call. What this computer's own record says was approved or denied. For a longer command
  // (`full`: the other computer was shown all of it) the short line is only its start, so the
  // record says how much more there was, as a prompt's line does (once,
  // after a 1,000-character command was allowed, "Activity on this computer" showed its first 100
  // and nothing else).
  const answeredText = local => {
    const shown = keys.clean(local ? local.detail : '', 100);
    if (!local || local.whole === true || typeof local.full !== 'string' || !local.full)
      return shown;
    const one = keys.clean(
      ((typeof local.tool === 'string' && local.tool ? local.tool + ': ' : '') + local.full)
        .replace(/\s+/g, ' ')
        .trim(),
      Infinity
    );
    const head = shown.replace(/…$/, '').trimEnd(),
      more = Array.from(one).length - Array.from(head).length;
    return more > 0 ? head + ' … and ' + more.toLocaleString('en-US') + ' more characters' : shown;
  };

  function deliver(item, say, from) {
    const rest =
      typeof item.id === 'string' && item.id.startsWith('permission:')
        ? item.id.slice('permission:'.length)
        : '';
    const local = offered().find(it => it.id === item.id),
      name = nameOf(from),
      same = store.pairings().filter(p => (p.name || 'Computer') === name).length > 1;
    const entry = {
      peer: from,
      name: same ? name + ' (…' + from.slice(-4) + ')' : name,
      agent: keys.clean(agentName(item.paneId), 60),
      text: answeredText(local),
      say: say === 'yes' ? 'yes' : 'no',
    };
    log('answered', entry);
    taken.unshift({ key: now() + '-' + ++takenN, at: now(), ...entry });
    taken.length = Math.min(taken.length, TAKEN_MAX);
    push();
    return rest !== '' && answerPermission(rest, say === 'yes' ? 'once' : 'deny') === true;
  }

  // ---- a prompt, an interrupt, a stop, a start from a paired computer ----
  // The plan lock is asked first (change 16): while it holds
  // no agent is "now", no CLI can be started and no ticket is given, so every operation is refused
  // before it is taken, and a prompt already held is dropped at its write.
  const locked = () => {
    try {
      return planLocked() !== false;
    } catch {
      return true;
    }
  };

  // What remote-control.js reads as the right: the pairing id the switch is on for, only while that
  // pairing is not paused and this computer is not stopping.
  const controlRight = id =>
    link && trust && trust.open(id) && controlOn(id) ? prefs.control[id] : '';

  // The computer's name as this computer's notices, list and held prompts show it; two paired
  // computers of one name are told apart by the id's last characters (as the answer's notice does).
  // The computer's name as this computer's control list, its notices and a held prompt's source
  // show it: always with the last characters of its id. The name is one that computer chose for
  // itself ("You" would read "You sent Moss a prompt"), the id is not.
  const shownName = id => nameOf(id) + ' (…' + String(id).slice(-4) + ')';
  const startable = () => {
    let have = [];
    try {
      have = locked() ? [] : clis() || [];
    } catch {
      /* none */
    }
    return Array.isArray(have) ? Object.keys(CLIS).filter(w => have.includes(CLIS[w])) : [];
  };

  // remote-control.js writes one entry per operation when it is taken, before the delivery,
  // whatever that then returns, and one ("dropped") when a held prompt was removed unwritten. Kept
  // in a list of its own with the prompt's first 100 characters, its length and how many characters
  // are not shown (change 11). The window's notice joins what one computer did inside a minute into
  // one.
  function record(e) {
    written = false;
    const t = now(),
      // files: what came with a prompt, under the names this computer gave them
      line = {
        at: t,
        peer: e.peerId,
        name: e.from,
        agent: e.agent,
        op: e.op,
        head: e.head,
        length: e.length,
        more: e.more,
        ...(Array.isArray(e.files) && e.files.length
          ? {
              files: e.files.slice(0, PROMPT_FILES).map(x => ({
                name: String(x.name),
                kind: String(x.kind),
                bytes: Number(x.bytes) || 0,
              })),
            }
          : null),
      };
    opsLog.unshift(line);
    opsLog.length = Math.min(opsLog.length, OPS_MAX);
    store.setNote('ops', opsLog);
    written = true;
    if (e.op !== 'dropped') {
      const open = notices.find(x => x.peer === e.peerId && t - x.at < NOTICE_MS);
      if (open)
        Object.assign(open, {
          until: t,
          n: open.n + 1,
          agent: line.agent,
          op: line.op,
          head: line.head,
          length: line.length,
          more: line.more,
        });
      else {
        notices.unshift({
          key: t + '-c' + ++noticeN,
          at: t,
          until: t,
          n: 1,
          peer: line.peer,
          name: line.name,
          agent: line.agent,
          op: line.op,
          head: line.head,
          length: line.length,
          more: line.more,
        });
        notices.length = Math.min(notices.length, TAKEN_MAX);
      }
    }
    push();
  }

  // Every delivery: only for an operation whose entry was just written (if that cannot be written,
  // nothing is delivered, as for an answer), and the plan lock once more in the turn of the call.
  // Nothing of the message but what is named reaches the app's action.
  const act = (fn, no) => {
    const ok = written;
    written = false;
    return !ok ? 'failed' : locked() ? no : fn();
  };

  // The files a taken prompt names are written now, by the app's own saving, under names made on
  // this computer (never anything from the message). All of them or none. → what remote-control.js
  // needs: the words for the agent, what the list shows, and the undo for a prompt that then does
  // not go in.
  const saveFiles = list => {
    if (!remoteFiles || locked() || !Array.isArray(list)) return null;
    const done = [],
      undo = () => {
        for (const x of done) {
          try {
            remoteFiles.remove(x.path);
          } catch {
            /* the 7-day rule takes it */
          }
        }
      };
    try {
      for (const f of list) {
        const r = remoteFiles.save(f.kind, f.data);
        if (!r || typeof r.path !== 'string' || !r.path) throw new Error('not saved');
        done.push({ path: r.path, name: String(r.name || ''), kind: f.kind, bytes: f.data.length });
      }
    } catch {
      undo();
      return null;
    }
    return {
      tail: done
        .map(x => ' [Attached ' + (x.kind === 'txt' ? 'file' : 'image') + ': ' + x.path + ']')
        .join(''),
      files: done.map(x => ({ name: x.name, kind: x.kind, bytes: x.bytes })),
      undo,
    };
  };
  const roomFor = (agentId, text) => {
    const body = typeof text === 'string' ? promptText(text) || text : '';
    return roomLeft(
      agentId
        ? { t: 'prompt', ...WORST, id: String(agentId), to: WORST.n, text: body }
        : { t: 'start', ...WORST, cli: 'opencode', project: 'f'.repeat(64), text: body }
    );
  };

  function up() {
    if (link) return;
    store.identity(); // this computer's long-term key, made the first time remote is turned on
    link = createLink({
      self,
      store,
      getTicket,
      url: typeof url === 'function' ? url() : url,
      freeIds,
      name: myName,
      hear: true,
      // No new name from a computer whose pairing is paused or that is itself asking: the Keep or
      // Forget lines must not change under the user.
      mayRename: id => !trust.status().asks.some(a => a.peer === id || a.by.some(b => b.id === id)),
      WebSocket,
      now,
      timers,
      random,
      on: {
        state: s => {
          conn = s;
          push();
        },
        pairing: p => {
          if (p.state === 'ended')
            ended = {
              reason: p.reason || 'ended',
              peer: p.peer,
              name: p.peer ? nameOf(p.peer) : '',
            };
          run = p.role && p.state !== 'ended' ? p : null; // role null = no run
          push();
        },
        paired: (id, name) => {
          ended = { reason: 'paired', peer: id, name };
          log('paired', { peer: id, name });
          push();
        },
        asked: id => {
          asked = id || null;
          push();
        }, // another computer of the account pressed Pair for this one (remote-link.js pairAsked)

        // A new session with that computer, also in place of a live one: a view of the session
        // before it ends on both sides here.
        session: id => {
          if (taker) taker.dropAll(id);
          if (sender) sender.stop(id);

          // a file lives inside one session, also when the session is only replaced
          if (views) views.endFor(id, 'gone');
          if (watcher) watcher.sessionEnded(id);
          trust.sessionStarted(id);
          if (trust.open(id)) {
            api.sessionStarted(id);
            try {
              on.up?.();
            } catch {
              /* a listener's error is not ours */
            }
          }
          push();
        },
        // Through the trust gate first (a paused or stopping pairing's message ends there). An
        // `answer` is looked at only for a computer whose "may answer" switch is on: for any other
        // it is dropped here, unread and unanswered. A control operation the same way, only for a
        // computer whose "full control" switch is on (change 10); what reaches the rules is the
        // message read field by field, or only its type and number when it has another shape (it
        // still counts toward the limit there, change 16).
        message: (from, obj) => {
          if (trust.onMessage(from, obj)) return;
          if (obj.t === 'answer') {
            try {
              if (answerOn(from) && admit(from, true)) answers.receive(from, obj);
            } catch {
              /* nothing a message does may throw out of here */
            }
            return;
          }

          // The live view (6h). `view`, `keep` and `unview` are looked at by the watched side only
          // for a computer whose full-control switch is on: for any other they are dropped here,
          // unread, unanswered and uncounted. `viewing`, `frame` and `unview` go to this computer's
          // own open view, which drops what is not for it before reading it.
          if (obj.t === 'view' || obj.t === 'keep' || obj.t === 'unview') {
            try {
              if (views && controlOn(from) && (obj.t === 'unview' || admit(from)))
                views.receive(from, obj);
              if (obj.t === 'unview' && watcher) watcher.receive(from, obj);
            } /* ending a view is always taken; asking for one or keeping one only while the link has room */ catch {
              /* as below */
            }
            return;
          }
          if (obj.t === 'viewing' || obj.t === 'frame') {
            try {
              if (watcher) watcher.receive(from, obj);
            } catch {
              /* as below */
            }
            return;
          }

          // A file with a prompt (remote-files.js). A piece is looked at only for a computer whose
          // full-control switch is on and only for the one file it was told to send: anything else
          // is dropped before any work, unanswered. `got` is the other computer's word on this
          // computer's own file on its way, read only for that file.
          if (obj.t === 'part') {
            try {
              if (taker && controlOn(from)) taker.part(from, obj);
            } catch {
              /* as below */
            }
            return;
          }
          if (obj.t === 'got') {
            try {
              if (sender) sender.receive(from, obj);
            } catch {
              /* as below */
            }
            return;
          }
          if (typeof obj.t === 'string' && OPS.has(obj.t)) {
            try {
              if (
                controlOn(from) &&
                (obj.t !== 'say' ||
                  sayOn(from)) /* an agent's message: dropped unread without its own mark */ &&
                admit(from, obj.t === 'act' ? 'act' : false)
              ) {
                const r = control.receive(from, shapeOp(obj) || { t: obj.t, n: obj.n });

                // a stop or an interrupt is served first; the rest only while the link has room for
                // its reply
                if (r && typeof r.then === 'function') r.then(push, () => {});
              }
            } catch {
              /* as above */
            }
            return;
          }
          api.onMessage(from, obj);
        },
        peer: (id, s) => {
          peerState.set(id, s);
          if (!s.session) {
            if (taker) taker.dropAll(id);
            if (sender) sender.stop(id);
            api.sessionEnded(id);
            if (views) views.endFor(id, 'gone');
            if (watcher) watcher.sessionEnded(id);
          }
          push();
        }, // a view lives inside one session (6h)
        update: id => {
          needUpdate.add(id);
          push();
        },
      },
    });
    trust = createTrust({
      self,
      store,
      link,
      now,
      timers,
      live: id => link.state().sessions.includes(id),
      on: {
        changed: push,
        // Closed: another computer asked to end this pairing (or this one is stopping). Nothing of
        // it stays shown as waiting. A pairing that was paused loses "may answer" for good: after
        // Keep the user turns it on again. The same for full control, and
        // what that computer still had held here is removed at once (change 4). The results of its
        // finished tasks go too (6g): nothing of a paused pairing is kept to show.
        gate: (id, open) => {
          if (open) return;
          api.sessionEnded(id);
          api.forgetReports(id);
          if (watcher) watcher.drop(id);
          dropAnswer(id);
          dropControl(id);
          const ask = trust.status().asks.find(a => a.peer === id);
          if (ask)
            log('asked', {
              peer: id,
              name: nameOf(id),
              by: ask.by.map(b => nameOf(b.id)).join(', '),
            });
        },
        outcome: o => {
          log(o.choice === 'keep' ? 'they_kept' : 'they_forgot', {
            peer: o.to,
            name: nameOf(o.to),
            about: o.about,
          });
          push();
        },
        // Every computer confirmed the stop (or the user chose "finish anyway"): the old key is
        // gone, remote is off here.
        stopped: () => {
          Promise.resolve().then(() => {
            if (!prefs.on) return;
            log('stopped');
            prefs.on = false;
            save();
            down();
            push();
          });
        },
      },
    });
    api = createRemoteApi({
      // The only way out for content: through the trust gate. A list that carried items is written
      // to the activity log once per item.
      send: (to, obj) => {
        const sent = gateSend(to, obj);

        // it did not leave because the minute was full: tried again when that minute has passed
        if (!sent && obj && LISTS.has(obj.t) && lastMinute() >= HARD_MAX) listsAgain();
        if (sent && obj && obj.t === 'needs')
          for (const it of obj.items) {
            const k = to + '|' + it.id;
            if (!told.has(k)) {
              told.add(k);
              log('saw', { peer: to, name: nameOf(to), agent: it.agent });
            }
          }
        return sent;
      },
      items: offered,
      agents: () => agents() || [],
      project: myProject,
      agentName,
      showDetail: detailOn,
      now,
      timers,
      canAnswer: id => (answerOn(id) && trust.open(id) ? answerable().map(it => it.id) : []),
      bind: bindingFor,
      full: fullOf,
      read: readFull,
      pick: (peerId, s, it) => (chooseOn(peerId) && trust.open(peerId) ? withPick(s, it) : s),
      readPick, // a question's options leave only for a computer that may choose (6i)

      // Full control (6f): the ticket in a row, the counter on a list and the word "you may
      // control" leave only for a computer whose switch is on now; replies to this computer's own
      // operations are read through remote-control.js's shaping.
      tellFrom,
      ticket: (id, panelId) => (control && trust.open(id) ? control.ticketFor(id, panelId) : ''),
      stamp: id => (control && controlRight(id) ? control.stamp(id) : 0),
      starts: id => (controlRight(id) && !locked() ? startable() : null),
      reply: shapeReply,
      // the git hand-over: said as one word too, only under its own sentence's mark
      syncable: id => !!handover && !!controlRight(id) && syncOn(id),
      // said as one word in `control`: the other computer shows Watch only then
      watchable: id => !!controlRight(id) && watchOn(id),
      // Agents message agents: said as one word in `control` and as `m` on each row that may take
      // one now, only under its own mark.
      sayable: id => !!controlRight(id) && sayOn(id),
      sayRow: (id, panelId) =>
        !!controlRight(id) && sayOn(id) && !locked() && sayTarget(panelId) === true,
      // A kept picture of that computer's panel goes when that computer, connected, does not say
      // this one may watch: its switch went off there, or a new
      // session began. While it is offline the picture stays, with its time.
      on: {
        remote: (id, v) => {
          if (watcher && v && v.state !== 'offline' && !(v.control && v.control.watch === true))
            watcher.rightEnded(id);
          relook(id);
          push();
        },
        // The answer to an ask of one of this computer's agents came back (remote-api.js: only for
        // a number this computer sent). It is handed to the waiting command only while THIS
        // computer's own mark for that computer is on (the asking side has
        // a say too); otherwise the command is told that the answer is on the Devices card, where
        // it is in any case.
        answer: (id, n, r) => {
          const w = sayWait.get(n);
          if (!w || w.peer !== id) return;
          sayWait.delete(n);
          try {
            w.answer(
              sayOn(id) && trust && trust.open(id)
                ? {
                    text: String(r.text || ''),
                    more: Number.isInteger(r.more) ? r.more : 0,
                    cut: r.cut === true,
                  }
                : { card: true }
            );
          } catch {
            /* the command's error is not ours */
          }
        },
      },
    });
    relater = createRelater({
      relate: relate || (async () => ({ rel: 'unknown' })),
      on: () => push(),
      now,
      timers,
    });

    // The other half of the answer: phone-answer.js holds the rules, this hands it only what may be
    // answered and the trust gate's send. Made once and kept across connecting off and on, so a
    // prompt it took an answer for stays taken.
    if (!answers)
      answers = phoneAnswers({
        items: answerable,
        rights,
        showDetail: detailOn,
        agentName,
        deliver,
        send: gateSend,
        now,
        full: fullOf,
        bind: bindingFor,
      });

    // The rules for the control operations, handed the right, the agent as it is now and the app's
    // actions. Made once and kept across connecting off and on like the answers, so a number it
    // took stays taken; its ticket key lives as long as it does (change 5). From the message only
    // this reaches an action: the panel id it named (checked against its ticket), its text cleaned
    // as a paste, and one of four CLI names from a fixed list. Never a model, an effort, a name, a
    // folder or an option of the delivery (change 16). The live view. The watched side: made once
    // and kept like the control rules, so a one-time number it took stays taken; it asks the same
    // right, the same ticket and the same freshness as an operation, and the allowance lives in the
    // key store's blob, keyed by the other computer's device id (Forget does not clear it, an
    // account change does).
    if (!views)
      views = createViews({
        now,
        timers,
        ...(typeof mono === 'function' ? { mono } : {}),
        rights: controlRight,
        granted: watchOn,
        live: id => !!link && link.state().sessions.includes(id),
        peerName: shownName,
        fresh: (id, msg) => !!control && control.fresh(id, msg),
        ticket: (id, panelId) =>
          control && trust && trust.open(id) ? control.ticketFor(id, panelId) : '',
        agentName: panelId => {
          const a = locked() ? null : agentNow(panelId);
          return a && typeof a.name === 'string' ? a.name : '';
        },
        send: gateSend,
        room: () => LINK_SAFE - lastMinute(),
        screen: (panelId, on) => watchScreen(panelId, on === true),
        allowance: {
          read: () => store.note('views') || {},
          write: map => store.setNote('views', map),
        },
        log: watchLine,
        on: { changed: push },
      });

    // The watching side: one open view of another computer's panel. Its picture leaves this file
    // only through on.view.
    if (!watcher)
      watcher = createWatcher({
        now,
        timers,
        send: gateSend,
        fields: (id, agentId) =>
          api && trust && trust.open(id) ? api.viewFields(id, agentId) : null,
        on: {
          changed: model => {
            try {
              on.view?.(model);
            } catch {
              /* a listener's error is not ours */
            }
          },
        },
      });

    // Files with a prompt. The target's side holds what arrives in memory; its replies (`got`)
    // leave as replies. The sender's pieces leave as a stream: only below the line optional traffic
    // stops at, the same line and the same count as the live view's frames. The day's allowance
    // lives in the key store's blob beside the watching minutes, keyed by the other computer's
    // device id.
    if (!taker)
      taker = createTaker({
        now,
        timers,
        send: (to, obj) => gateSend(to, obj, 'reply'),
        allowance: {
          read: () => store.note('files') || {},
          write: map => store.setNote('files', map),
        },
      });
    if (!sender)
      sender = createSender({
        now,
        timers,
        random,
        send: (to, obj) => gateSend(to, obj, 'stream'),
        room: () => STREAM_MAX - lastMinute(),
        offer: (id, agentId, fill, onWord) =>
          api && trust && trust.open(id)
            ? api.offer(id, agentId, fill, onWord)
            : { state: 'not_sent', n: '' },
        on: {
          changed: p => {
            sending = p;
            push();
          },
        },
      });
    if (!control)
      control = createControl({
        now,
        timers,
        rights: controlRight,
        live: id => !!link && link.state().sessions.includes(id),
        peerName: shownName,
        files: {
          offer: o => (locked() || !remoteFiles ? 'refused' : taker.offer(o)),
          take: o => (locked() ? null : taker.take(o)),
          save: list => saveFiles(list),
        },
        send: gateSend,
        agentNow: panelId => (locked() ? null : agentNow(panelId)),
        clis: () => (locked() ? [] : clis()),
        openKey: myKey,
        remoteStarted: () => remoteStarted(),
        startsToday: typeof remoteStartsToday === 'function' ? id => remoteStartsToday(id) : null,
        startTaken: typeof remoteStartTaken === 'function' ? id => remoteStartTaken(id) : null,
        log: record,
        cancel: (key, panelId) => cancelHeld(key, panelId),
        prompt: ({ key, panelId, text, guard, from, done, tail }) =>
          act(() => submitRemote({ key, panelId, text, from, guard, done, tail }), 'refused'),
        interrupt: (panelId, guard) => act(() => interrupt(panelId, guard), 'refused'),
        stop: (panelId, guard) => act(() => stopAgent(panelId, guard), 'refused'),
        choose: o => act(() => chooseHere(o), 'refused'),
        sync: ({ peerId, commit, guard }) =>
          // from the message: one commit id
          act(() => syncHere({ peerId, commit, guard }), 'refused'),
        // a choice is answered only below the line pictures stop at
        busy: () => !(lastMinute() < LINK_SAFE),
        // An agent's message: the mark as the pairing id it was given for; the panel asked at
        // arrival and again at the write.
        say: {
          right: id => (trust && trust.open(id) && sayOn(id) ? prefs.say[id] : ''),
          target: panelId => !locked() && sayTarget(panelId) === true,
          deliver: o => act(() => sayHere({ ...o, computer: nameOf(o.peerId) }), 'refused'),
          // computer: this computer's plain name for the other one, for the mark (the list's own
          // name carries the id's last characters, and the mark adds its own)
        },
        start: ({ cli, text, guard, from }) =>
          act(
            () => startAgent({ cli, text, from, guard: key => !locked() && guard(key) }),
            'refused'
          ),
      });
    link.start();
    try {
      on.up?.();
    } catch {
      /* a listener's error is not ours */
    }
  }

  function down() {
    if (!link) return;
    if (againTimer) {
      clock.clear(againTimer);
      againTimer = null;
    } // no list waits for a link that is going
    dropHeld(); // before the link goes, so the other computer can still hear "failed"
    if (watcher) {
      watcher.close('closed');
      watcher.drop();
    } // this computer's own view of another one ends with the link, and nothing of it stays
    link.stop();
    api.stop();
    trust.stop();
    relater.stop();
    link = trust = api = relater = null;
    run = null;
    asked = null;
    signedOut = false;
    conn = { connection: 'off', reason: null };
    taken = [];
    notices = [];
    peerState.clear();
    needUpdate.clear();
    told.clear();
  }

  function state() {
    const ok = ready();
    const base = {
      available: problem !== 'no_storage',
      problem,
      on: !!(ok && prefs.on),
      connection: conn.connection,
      reason: conn.reason,
      self: { id: self.id, name: ok ? myName() : keys.clean(deviceName(), 60) },
      computers: [],
      others: [],
      pairing: null,
      asked: null,
      ended,
      stopping: false,
      waiting: [],
      awake: {
        on: !!(ok && prefs.awake === true),
        held: awakeHeld,
        why: awakeHeld ? '' : awakeWhy(),
      }, // keep-awake: the setting, whether the system is asked not to sleep now, and why not
      log: ok ? prefs.log.map(e => ({ ...e })) : [],
      // answers other computers gave to this one's agents (newest first), for the window's notice
      answers: taken.map(e => ({ ...e })),
      // What other computers made this one's agents do (6f): the notices (one per computer and
      // minute: n operations, the newest one's agent, operation and text) and the newest lines of
      // the list (controlTotal says how many there are; all of them: controlLog()). this computer's
      // own files on their way to another computer, for the composer's line
      sending: sending ? { ...sending } : null,
      // who watches which of this computer's panels now (the mark on the panel, the bell, the card)
      watching: views ? views.watching() : [],
      controlled: notices.map(e => ({ ...e })),
      controlLog: ok ? opsLog.slice(0, OPS_SHOWN).map(e => ({ ...e })) : [],
      controlTotal: ok ? opsLog.length : 0,
    };
    if (!ok) return base;
    let pairings = [];
    try {
      pairings = store.pairings();
    } catch {
      /* reported by ready() next time */
    }
    const st = trust ? trust.status() : { stopping: false, waiting: [], asks: [], kept: [] };
    const live = link ? link.state() : { online: [], sessions: [] };
    const mine = myKey();
    base.computers = pairings.map(p => {
      const s = peerState.get(p.id) || {},
        v = api?.view(p.id) || null,
        ask = st.asks.find(a => a.peer === p.id) || null;
      const session = live.sessions.includes(p.id),
        shown = !ask && session && !!v,
        lets = shown && !!v.control;
      const reps = ask ? [] : reportsHere(v, mine),
        done = reps.at(-1); // newest last, by when each arrived here
      const its = byProject(shown ? v.agents : [], lets, reps),
        ctl = controlOn(p.id),
        ans = ctl || answerAlone(p.id);
      return {
        id: p.id,
        name: p.name || 'Computer',
        since: p.since,
        online: live.online.includes(p.id),
        session,
        state: ask ? 'paused' : session && v ? v.state : 'offline',
        heard: Math.max(s.heard || 0, v?.heard || 0),
        items: ask || !session || !v ? [] : v.items,
        agents: its.here,
        elsewhere: its.elsewhere, // elsewhere: how many of its agents work in other projects

        // It has the project that is open here: how far apart the two copies are, by commits. null:
        // another project, none, or not told.
        project: ask || !session || !v || !relater ? null : relater.get(p.id),
        detail: detailOn(p.id),
        answer: ans,
        update: needUpdate.has(p.id),
        // Full control (6f). control: this computer's switch for it (answer above is then on too:
        // it includes that right). commands: both rights are on for it, so the card says once
        // "(name) can run commands on this computer." (change 9). canControl: it says it takes
        // operations from this computer; canStart: the CLIs that can be started there for the
        // project open here (none while that is not a git project). ops: what this computer sent it
        // and how each ended (newest first; never a text). The live view. watchable: this
        // computer's switch for it was turned on under the sentence about watching (a switch from
        // before it refuses a view until it is turned off and on). canWatch: it says it takes a
        // view from this computer.
        watchable: ctl && watchOn(p.id),
        canWatch: lets && v.control.watch === true,
        // The git hand-over. syncable: this computer takes one from it (never yet: the sentence
        // waits for the user). canSync: it says it takes one from this computer. bringable: its
        // commit is known, so this computer can fetch it by its own press. handed: the branch here
        // that holds a commit it handed over, '' when there is none. brought: how this computer's
        // last "bring" ended.
        syncable: ctl && syncOn(p.id),
        canSync: lets && v.control.sync === true && !!firmKey(mine),
        bringable:
          !!handover &&
          shown &&
          !!v.project &&
          !!v.project.head &&
          !!relater &&
          !!relater.get(p.id),
        handed: (h => (h && handed.has(h) ? handoffBranch(h) : ''))(
          handed.size
            ? handoffId(
                p.id,
                pairings.map(x => x.id)
              )
            : ''
        ),
        brought: brought.get(p.id) ? { ...brought.get(p.id) } : null,
        // Agents message agents. talkable: this computer's full control for it was turned on under
        // the sentence that names it (a switch from before says false). canSay: it says it takes a
        // message from this computer's agents.
        talkable: ctl && sayOn(p.id),
        canSay: lets && v.control.say === true,
        // this computer's full control for it was turned on under the sentence about picking an
        // option (6i); a switch from before says false, and its card says how to allow it
        pickable: ctl && chooseOn(p.id),
        control: ctl,
        commands: ctl && ans,
        canControl: lets,
        canStart: lets && firmKey(myKey()) ? v.control.clis : [],
        ops: v ? v.ops : [],
        // The task one of its agents finished last, for the bell's one entry per computer (6g).
        // Kept while it is offline: a finished task stays finished. The row of that agent carries
        // the same result with the answer's first part (`last`).
        finished: done
          ? { key: done.key, agent: done.name, task: done.task, did: done.did, at: done.at }
          : null,
        asks: ask
          ? ask.by.map(b => ({
              id: b.id,
              name: b.id === p.id ? p.name || 'Computer' : nameOf(b.id),
              kind: b.kind,
            }))
          : [],
        keepsAsking: st.kept.filter(k => k.peer === p.id).reduce((n, k) => n + k.again, 0),
      };
    });
    const paired = new Set(pairings.map(p => p.id));
    base.others = others
      .filter(o => !paired.has(o.id))
      .map(o => ({ ...o, online: live.online.includes(o.id) }));
    base.pairing = run
      ? {
          role: run.role,
          state: run.state,
          shows: run.shows,
          peer: run.peer,
          name: run.peer ? nameOf(run.peer) : '',
        }
      : null;

    // On a relay with free ids a request can come under the id of a computer that is already
    // paired, so it is never shown with that computer's saved name; nor with the id, which the
    // asker chose and could spell like a name. The six digits are what tell the user it is theirs.
    base.asked =
      asked && !run
        ? { peer: asked, name: freeIds() ? 'A computer on your relay' : nameOf(asked) }
        : null;
    base.stopping = st.stopping;
    base.waiting = st.waiting.map(w => ({
      r: w.r,
      kind: w.kind,
      status: w.status,
      since: w.since,
      to: w.to,
      toName: nameOf(w.to),
      about: w.about,
      aboutName: w.about ? nameOf(w.about) : '',
    }));
    return base;
  }
  const need = () => {
    if (!ready()) throw new Error('remote: ' + problem);
  };
  const live = () => {
    need();
    if (!prefs.on || !link) throw new Error('remote: off');
  };

  return {
    state,
    // Called once when the app starts: connects only when the user had turned remote on.
    start() {
      if (!never() && ready() && prefs.on) {
        try {
          up();
        } catch {
          problem = 'unreadable';
        }
      }
    },
    // The account's computers that are not paired yet, as the server lists them (names are cleaned:
    // the server is not trusted with text).
    async refresh() {
      if (!ready() || !prefs.on) return state();
      let list = [];
      try {
        list = await devices();
      } catch {
        return state();
      }
      others = (Array.isArray(list) ? list : [])
        .filter(d => d && keys.safeId(d.id) && d.id !== self.id)
        .slice(0, OTHERS_MAX)
        .map(d => ({
          id: d.id,
          name: keys.clean(d.name, 60) || 'Computer',
          lastSeen: Number.isFinite(d.last_seen) ? d.last_seen * 1000 : 0,
        }));
      return state();
    },
    setOn(value) {
      need();
      if (!!value === prefs.on) return state();

      // before the link goes: what the others hold of this computer's finished tasks ends here
      //
      if (!value) api?.takeBack();
      prefs.on = !!value;
      if (prefs.on && acct) prefs.account = acct;
      log(prefs.on ? 'on' : 'off');
      if (prefs.on) up();
      else down();
      push();
      return state();
    },
    // This computer's name as the others see it; they take it at the next session start.
    setName(text) {
      need();
      prefs.name = keys.clean(text, 60);
      save();
      push();
      return state();
    },
    pair(id) {
      live();
      if (!keys.safeId(id) || id === self.id) throw new Error('remote: bad computer');
      ended = null;
      link.pair(id);
      return state();
    },
    pairAny() {
      live();
      ended = null;
      link.pairAny();
      return state();
    },
    cancelPairing() {
      if (link) link.cancelPairing();
      ended = null;
      push();
      return state();
    },
    // The user's answer, at this computer, to another computer's request to pair (state().asked).
    acceptPairing() {
      live();
      ended = null;
      link.acceptAsked();
      asked = link.asked();
      push();
      return state();
    }, // still shown when this computer is not connected right now
    declinePairing() {
      asked = null;
      if (link) link.declineAsked();
      push();
      return state();
    },
    // The six digits typed at this computer's own keyboard.
    enterCode(code) {
      live();
      const r = link.enterCode(String(code ?? '').slice(0, 12));
      push();
      return {
        ok: r.ok === true,
        left: r.left ?? null,
        ended: r.ended || null,
        until: r.until || null,
        error: r.error || null,
      };
    },
    clearEnded() {
      ended = null;
      push();
      return state();
    },
    // Turning the text off takes "may answer" and full control with it: nobody approves, or steers,
    // what they cannot read.
    setDetail(id, value) {
      need();
      if (!store.pairing(id)) return state();
      if (value && !detailOn(id)) tellSince.set(id, now());

      /* it went on: only tasks that end from now are told */
      prefs.detail[id] = !!value;
      if (!value) {
        dropAnswer(id);
        dropControl(id);
      }
      save();
      api?.detailChanged(id);
      push();
      return state();
    },
    // "(that computer) may answer my agents' permission questions". On only for a pairing that
    // exists, is not paused and has the text switch on, and bound to that pairing's id. Off always
    // works. Keep-awake, the user's own switch on this computer. Off by default; turning it on
    // changes nothing by itself until the conditions above hold. Kept with the other choices in the
    // key store.
    setAwake(value) {
      need();
      if ((value === true) === (prefs.awake === true)) return state();
      prefs.awake = value === true;
      save();
      push();
      return state();
    },
    // The power source changed (plugged in, on battery), or one of this computer's agents started
    // or stopped working or waiting: the hold follows. With the setting off, or connecting off, it
    // returns at the first test and pushes nothing.
    powerChanged() {
      if (applyAwake() && link) push();
    },
    // The computer woke from sleep or its network came back: the link looks now (remote-link.js
    // `wake`). Nothing while connecting is off.
    woke() {
      let did = false;
      try {
        did = !!link && link.wake() === true;
      } catch {
        did = false;
      }
      return did;
    },
    // The computer is about to sleep: the link closes its socket now, so the paired computers show
    // this one offline at that moment (remote-link.js `sleep`). The ordinary close, nothing is sent
    // to them. Nothing while connecting is off. Main process only: no channel.
    asleep() {
      let did = false;
      try {
        did = !!link && link.sleep() === true;
      } catch {
        did = false;
      }
      return did;
    },
    setAnswer(id, value) {
      need();
      const p = store.pairing(id);
      if (!p) return state();
      if (value) {
        if (!trust || !trust.open(id) || !detailOn(id) || answerAlone(id)) return state();
        prefs.answer[id] = p.pairingId.toString('base64');
      } else {
        if (!Object.hasOwn(prefs.answer, id)) return state();
        delete prefs.answer[id];
      }
      log(value ? 'answer_on' : 'answer_off', { peer: id, name: nameOf(id) });
      api?.answerChanged(id);
      push();
      return state();
    },
    // "(that computer) may control my agents" (6f, change 17): the one full-control switch. On only
    // for a pairing that exists, is not paused and has the text switch on, and bound to that
    // pairing's id; it brings the answer right with it. Off always works, and removes at once what
    // that computer still had held here. The user pressed a numbered option of a question of that
    // computer's agent (6i). → { ...state, sent, n }.
    pick(id, itemId, n, kof) {
      live();
      const r = trust.open(id) ? api.choose(id, itemId, n, kof) : { state: 'not_sent', n: '' };
      push();
      return { ...state(), sent: r.state, n: r.n };
    },
    // more.choose: the page showed the sentence that names choosing an option when the switch was
    // turned on (change 11).
    setControl(id, value, more) {
      need();
      const p = store.pairing(id);
      if (!p) return state();

      // Turned on by this build's question, which carries the sentence about watching: the grant is
      // marked so (change 19).
      if (value) {
        if (!trust || !trust.open(id) || !detailOn(id) || controlOn(id)) return state();
        prefs.control[id] = p.pairingId.toString('base64');
        prefs.watch[id] = prefs.control[id];
        if (!prefs.choose) prefs.choose = {};
        if (more && more.choose === true) prefs.choose[id] = prefs.control[id];
        else delete prefs.choose[id];
        if (!prefs.sync) prefs.sync = {};
        if (more && more.sync === true) prefs.sync[id] = prefs.control[id];
        else delete prefs.sync[id];
        if (!prefs.say) prefs.say = {};
        if (more && more.say === true) prefs.say[id] = prefs.control[id];
        else
          delete prefs.say[
            id
          ]; /* agents message agents: only when the question showed the sentence for it */ /* the git hand-over's mark: set only when the question showed its sentence */
      } else {
        if (!Object.hasOwn(prefs.control, id)) return state();
        endControl(id);
        delete prefs.control[id];
        if (Object.hasOwn(prefs.watch, id)) delete prefs.watch[id];
        if (prefs.choose) delete prefs.choose[id];
        if (prefs.say) delete prefs.say[id];
        if (prefs.sync) delete prefs.sync[id];
      }
      log(value ? 'control_on' : 'control_off', { peer: id, name: nameOf(id) });
      api?.answerChanged(id);
      api?.controlChanged(id);
      push();
      return state();
    },
    // ---- the live view ----
    // Watch pressed, at this computer, on an agent of another computer: only for a row listed for
    // the project open here that can be controlled, on a computer that says it can be watched, and
    // only for the very agent the page drew (`mark`, as for a prompt). → { sent: 'asked' |
    // 'not_sent' | 'changed' }; what follows comes through on.view.
    view(id, agentId, mark) {
      live();
      const v = api.view(id);
      const row =
        trust.open(id) && v && v.control && v.control.watch === true
          ? byProject(v.agents, true).here.find(a => a.id === agentId && a.can)
          : null;
      if (!row) return { sent: 'not_sent' };
      if (typeof mark !== 'string' || mark === '' || mark !== row.mark) return { sent: 'changed' };
      return { sent: watcher.open(id, agentId, row.name).state };
    },
    keepView() {
      return !!watcher && watcher.keep();
    },
    // The dialog was closed ('closed'), or the window or the Devices page went out of view
    // ('hidden').
    unview(why) {
      if (watcher) watcher.close(why === 'hidden' ? 'hidden' : 'closed');
      return true;
    },
    viewNow() {
      return watcher ? watcher.model() : null;
    },
    // This computer's user pressed the mark on a watched panel: that computer's view ends and it
    // gets none for ten minutes.
    stopView(id) {
      const did = !!views && views.stop(id);
      push();
      return did;
    },
    // This computer's window hands over the screen of a panel a view runs for (or null: no terminal
    // is mounted for it).
    screen(panelId, raw) {
      if (views) views.rows(panelId, raw);
    },
    // A panel's process, conversation or name changed: a view that runs for it is looked at now,
    // not at its next frame.
    viewRecheck() {
      if (views) views.recheck();
    },
    // This computer's window was loaded again: a panel that is being watched is asked for once more
    // (it no longer reads it).
    viewReask() {
      if (views) views.reask();
    },
    // ---- what the app's window and account tell (desktop/main.js); here, so that the rules run in
    // the unit tests ---- This window starts to load another document: its page forgets the open
    // view, so the view ends. Read from the event's own fields; the old positional arguments
    // (deprecated in Electron) only when those are missing. A move inside the page and a frame
    // inside it end nothing. → whether the view was ended.
    windowNavigates(details, inPlace, mainFrame) {
      const main =
        details && typeof details.isMainFrame === 'boolean'
          ? details.isMainFrame
          : mainFrame === true;
      const same =
        details && typeof details.isSameDocument === 'boolean'
          ? details.isSameDocument
          : inPlace === true;
      if (!main || same) return false;
      this.unview('closed');
      return true;
    },
    // The window finished loading: a panel that another computer watches is asked for again (the
    // page that read it is gone), and the page gets the state it would otherwise have to ask for.
    // Only when connecting is on: nothing is read from the key store here, so a computer that never
    // used the feature is asked nothing at its start.
    windowLoaded() {
      if (views) views.reask();
      if (prefs && prefs.on) push();
    },
    // The plan lock came on: this computer's own view of another computer's panel ends.
    lockChanged(lock) {
      if (lock && lock.locked === true) {
        this.unview('closed');
        return true;
      }
      return false;
    },
    // The CLIs that can be started here, the plan, or what a panel runs changed: every computer
    // that may control is told again.
    controlChanged() {
      if (views) views.recheck();
      api?.controlChanged();
    }, // a running view is looked at first: no frame of a panel that changed

    // Every line of the control operations' list (the state carries only the newest).
    controlLog() {
      return ready() ? opsLog.map(e => ({ ...e })) : [];
    },
    // The first part of the answer of the task that agent on a paired computer finished last (6g).
    // It is not in the pushed state (up to 12 texts of 4,000 characters
    // per computer went to the window with every push, as often as the other computer chose); the
    // page asks when it shows the answer. Only for a row and a result the state lists at this
    // moment, by the state's own rule: a live session, the pairing not paused, the project open
    // here, the report naming that row's id, name and CLI. → { at, got, text, more }, or null. `at`
    // and `got` say which result it is, so the page never shows a newer one's text under an older
    // one's words.
    reportText(id, agentId) {
      live();
      const v = api.view(id);
      if (!v || !trust.open(id) || !store.pairing(id) || !link.state().sessions.includes(id))
        return null;
      const row = byProject(v.agents, false).here.find(a => a.id === agentId);
      const r = row
        ? reportsHere(v, myKey()).find(
            x => !x.off && x.id === row.id && x.name === row.name && x.cli === row.cli
          )
        : null;
      return r
        ? { at: r.at, got: r.got, text: typeof r.text === 'string' ? r.text : '', more: r.more }
        : null;
    },
    // How many bytes are left in one message for this text: a prompt for that agent, or (agentId
    // '') a start's first prompt. Below 0 it does not fit and is not sent; nothing is ever cut or
    // split (change 7). Counted with the largest the other fields can be.
    room: roomFor,
    // The user sent a prompt, at this computer, to an agent of another computer. Only for an agent
    // listed for the project open here (skill rule 12) that can be controlled. → the state with
    // `sent`: 'asked' (it left; its word follows in that computer's `ops` under `n`) | 'not_sent' |
    // 'no_word' (it must start with a letter or a digit, change 1) | 'too_long' | 'changed' (the
    // agent under that row is no longer the one the page drew: `mark` is not the row's mark now, or
    // none was handed back; nothing is sent).
    prompt(id, agentId, text, mark) {
      live();
      let r = { state: 'not_sent', n: '' };
      const body = typeof text === 'string' ? promptText(text) : '',
        v = api.view(id);
      const row =
        trust.open(id) && v
          ? byProject(v.agents, !!v.control).here.find(a => a.id === agentId && a.can)
          : null;
      if (!body) r.state = 'no_word';
      else if (roomFor(agentId, body) < 0) r.state = 'too_long';
      else if (row && (typeof mark !== 'string' || mark === '' || mark !== row.mark))
        r.state = 'changed';

      // the same turn as the comparison: the ticket sent is the one the mark was made from
      else if (row) r = api.prompt(id, agentId, body);
      push();
      return { ...state(), sent: r.state, n: r.n };
    },
    // The same prompt with one to three files. list: [{ kind:
    // 'png' | 'jpg' | 'txt', data: Buffer }], pictures already made small by the window; each is
    // checked here with the rules the other computer holds, before anything is offered. The files
    // go first, one at a time; the prompt that names them goes only when every one is finished
    // there and the row still holds the agent the page drew. Resolves when that is over. → the
    // state with `sent`: 'asked' (the prompt left) | 'no_word' | 'too_long' | 'changed' |
    // 'not_sent' | 'busy' (files are already on their way) | 'bad_file' (with `file`: which one,
    // and `why`: checkFile's word) | 'too_many' | 'too_big' | 'file_refused' | 'file_no_reply' |
    // 'file_failed' | 'stopped'.
    async promptFiles(id, agentId, text, mark, list) {
      live();
      const out = (word, more) => {
        push();
        return { ...state(), sent: word, n: '', ...more };
      };
      const body = typeof text === 'string' ? promptText(text) : '';
      const rowNow = () => {
        const v = api.view(id);
        return trust.open(id) && v
          ? byProject(v.agents, !!v.control).here.find(a => a.id === agentId && a.can)
          : null;
      };
      if (!body) return out('no_word');

      // the three ids take about 70 bytes of the one message
      if (roomFor(agentId, body) < 80) return out('too_long');
      if (!Array.isArray(list) || !list.length) return out('not_sent');
      if (list.length > PROMPT_FILES) return out('too_many');
      let total = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[i],
          why = f && Buffer.isBuffer(f.data) ? checkFile(f.kind, f.data) : 'kind';
        if (why) return out('bad_file', { file: i, why });
        total += f.data.length;
      }
      if (total > PROMPT_MAX) return out('too_big');
      const row = rowNow();
      if (!row || !sender) return out('not_sent');
      if (typeof mark !== 'string' || mark === '' || mark !== row.mark) return out('changed');
      const r = await sender.sendFiles(
        id,
        agentId,
        list.map(f => ({ kind: f.kind, data: f.data }))
      );
      if (!r || r.ok !== true)
        return out(
          r && r.why === 'busy'
            ? 'busy'
            : r && r.why === 'refused'
              ? 'file_refused'
              : r && r.why === 'no_reply'
                ? 'file_no_reply'
                : r && r.why === 'stopped'
                  ? 'stopped'
                  : r && r.why === 'not_sent'
                    ? 'not_sent'
                    : 'file_failed'
        );

      // minutes may have passed: the same agent still, by the mark the page drew
      const again = rowNow();
      if (!again || again.mark !== mark) return out('changed');
      const p = api.promptf(id, agentId, body, r.ids);
      push();
      return { ...state(), sent: p.state, n: p.n };
    },
    // The user stopped files that are on their way. The other computer clears its side by its own
    // clock.
    stopFiles() {
      if (sender) sender.stop();
      return state();
    },
    // "Show in folder" on a line of the control list: a file that came with a prompt, by the name
    // this computer gave it.
    showFile(name) {
      try {
        return !!remoteFiles && remoteFiles.show(String(name || '')) === true;
      } catch {
        return false;
      }
    },
    // Interrupt or Stop pressed, at this computer, on an agent of another computer (the page asks
    // "Stop (agent) on (name)?" first).
    act(id, agentId, what, mark) {
      live();
      const v = api.view(id);
      const row =
        trust.open(id) && v
          ? byProject(v.agents, !!v.control).here.find(a => a.id === agentId && a.can)
          : null;
      const r = !row
        ? { state: 'not_sent', n: '' }
        : typeof mark !== 'string' || mark === '' || mark !== row.mark
          ? { state: 'changed', n: '' }
          : api.act(id, agentId, what);
      push();
      return { ...state(), sent: r.state, n: r.n };
    },
    // "New agent on (that computer)": for the project open here, named by its first commit's id, so
    // never for a folder without git ('no_project'). cli: one of the words in that computer's
    // `canStart`. text: '' or a first prompt. Named startOn because start() above is the app's own
    // start; the window's channel is remote:start. The git hand-over.
    // handOver: "Hand my commit to (that computer)": one sealed message with the project's
    // first-commit id and the commit this copy is on; nothing else. Only a computer that says it
    // takes one gets it.
    handOver(id) {
      live();
      let r = { state: 'not_sent', n: '' };
      const key = firmKey(myKey()),
        mine = myProject();
      if (!key || !mine || !mine.head) r.state = 'no_project';
      else if (trust.open(id)) r = api.sync(id, key, mine.head);
      push();
      return { ...state(), sent: r.state, n: r.n };
    },
    // "Bring (that computer)'s work here": this computer's own press. It fetches the commit that
    // computer says it is on from this copy's own git remote into this computer's branch for it. No
    // message is sent and no right is needed; the other computer only named a commit id, which is
    // shaped before it is used. → the state with `sent`: 'going' | 'not_sent'.
    bring(id) {
      live();
      const v = trust.open(id) ? api.view(id) : null,
        mine = myProject(),
        short = handoffShort(id);
      const theirs = v && v.project && mine && v.project.root === mine.root ? v.project.head : '';
      if (
        !handover ||
        locked() ||
        !theirs ||
        !short ||
        (brought.get(id) && brought.get(id).state === 'going')
      )
        return { ...state(), sent: 'not_sent' };

      // A branch that was made or moved is one line in this computer's activity log, so the user
      // can see later where it came from: the computer, the first ten
      // characters of the commit, the branch. Nothing is written for a try that did not end with
      // the commit in that branch.
      const root0 = mine.root,
        end = w => {
          brought.set(id, { state: typeof w === 'string' ? w : 'failed', at: now() });
          if (w === 'done') {
            try {
              log('brought', {
                peer: id,
                name: nameOf(id),
                commit: theirs.slice(0, 10),
                branch: handoffBranch(short),
              });
            } catch {
              /* the branch is there; only its line is missing */
            }
          }
          lookHanded();
          push();
        };
      brought.set(id, { state: 'going', at: now() });
      Promise.resolve()
        .then(() =>
          handover.handoff({
            commit: theirs,
            short,
            guard: () => {
              const p = myProject();
              return !locked() && !!p && p.root === root0;
            },
          })
        )
        .then(end, () => end('failed'));
      push();
      return { ...state(), sent: 'going' };
    },
    // git's own files changed in the open project, or a session started: which hand-over branches
    // exist is read again.
    gitChanged() {
      lookHanded();
    },
    startOn(id, cli, text) {
      live();
      let r = { state: 'not_sent', n: '' };
      const key = firmKey(myKey()),
        given = typeof text === 'string' && text !== '',
        body = given ? promptText(text) : '';
      if (!key) r.state = 'no_project';
      else if (given && !body) r.state = 'no_word';
      else if (given && roomFor('', body) < 0) r.state = 'too_long';
      else if (trust.open(id)) r = api.start(id, cli, key, body || undefined);
      push();
      return { ...state(), sent: r.state, n: r.n };
    },
    // The user pressed Allow once or Deny, at this computer, on an item of another computer. → the
    // state with `sent`: what became of the press.
    answer(id, itemId, say, of) {
      live();
      const sent = trust.open(id) ? api.answer(id, itemId, say, of) : 'not_sent';
      push();
      return { ...state(), sent };
    },
    // Forget a computer here and ask the other paired computers to forget it too.
    forget(id) {
      live();
      const name = nameOf(id);
      api.takeBack(id);
      tellSince.delete(id); // while it can still hear it
      if (!trust.forget(id)) return state();
      api.forget(id);
      relater.forget(id);
      peerState.delete(id);
      needUpdate.delete(id);
      if (Object.hasOwn(prefs.detail, id)) delete prefs.detail[id];
      if (Object.hasOwn(prefs.answer, id)) delete prefs.answer[id];
      endControl(id);
      if (watcher) watcher.drop(id);
      if (Object.hasOwn(prefs.control, id)) delete prefs.control[id];
      if (Object.hasOwn(prefs.watch, id)) delete prefs.watch[id];
      if (prefs.choose) delete prefs.choose[id];
      if (prefs.say) delete prefs.say[id];
      if (prefs.sync) delete prefs.sync[id];
      log('forgot', { peer: id, name });
      push();
      return state();
    },
    // The user's answer when another computer asked to end a pairing.
    choose(id, choice) {
      live();
      const name = nameOf(id);
      if (trust.choose(id, choice)) {
        if (choice === 'keep') tellSince.set(id, now());

        /* nothing from before or during the pause is told afterwards */
        if (choice === 'forget') {
          tellSince.delete(id);
          api.forget(id);
          relater.forget(id);
          peerState.delete(id);
          endControl(id);
          if (watcher) watcher.drop(id);
          if (Object.hasOwn(prefs.control, id)) delete prefs.control[id];
          if (Object.hasOwn(prefs.watch, id)) delete prefs.watch[id];
          if (prefs.choose) delete prefs.choose[id];
          if (prefs.say) delete prefs.say[id];
          if (prefs.sync) delete prefs.sync[id];
        }
        log(choice === 'keep' ? 'kept' : 'forgot', { peer: id, name });
      }
      push();
      return state();
    },
    stopEverywhere() {
      live();
      api.takeBack();
      if (trust.stopEverywhere()) log('stop');
      push();
      return state();
    },
    finishAnyway() {
      live();
      trust.finishAnyway();
      push();
      return state();
    },
    dismiss(r) {
      live();
      trust.dismiss(String(r ?? ''));
      push();
      return state();
    },
    // attention-service.js changed its list.
    itemsChanged() {
      api?.changed();
    },
    // One of this computer's agents finished a task (6g): { id, name, cli, at, task, did, text, p
    // }, shaped and cut in remote-api.js. It goes to each paired computer with a session whose text
    // switch is on. While connecting is off there is nobody to hand it to. tag: { peer, re, cut }
    // when that task answers a message an agent of one paired computer sent (remote-say.js): only
    // its copy says so.
    reported(r, tag) {
      return api ? api.reported(r, tag) : false;
    },
    // ---- agents message agents ----
    // The paired computers that say they take a message from this computer's agents, each with its
    // agents of the project open here (only rows known to be this project's): [{ id, name, rows: [{
    // id, name, cli, status, m }] }]. Empty while connecting is off.
    sayTargets() {
      if (!ready() || !prefs.on || !link || !api || !trust) return [];
      const live = link.state().sessions,
        out = [];
      for (const p of store.pairings()) {
        const v = live.includes(p.id) && trust.open(p.id) ? api.view(p.id) : null;
        if (!v || !v.control || v.control.say !== true) continue;
        out.push({
          id: p.id,
          name: p.name || '',
          rows: byProject(v.agents, true)
            .here.filter(a => a.sure && a.can)
            .map(a => ({ id: a.id, name: a.name, cli: a.cli, status: a.status, m: a.m === true })),
        });
      }
      return out;
    },
    // One of this computer's agents messages an agent of that computer. cb.word(w): that computer's
    // first word on it; cb.answer(a): the answer to an ask, a = { text, more, cut } or { card: true
    // } (it is on the Devices card only: this computer's own mark for that computer is off). → {
    // sent: 'asked' | 'not_sent' | 'too_long', n }.
    say(id, agentId, kind, by, text, cb) {
      live();
      const v = api.view(id);
      const row =
        trust.open(id) && v && v.control && v.control.say === true
          ? byProject(v.agents, true).here.find(
              a => a.id === agentId && a.can && a.sure && a.m === true
            )
          : null;
      if (!row) return { sent: 'not_sent', n: '' };
      const r = api.say(id, agentId, kind === 'ask' ? 'ask' : 'send', by, String(text), w => {
        try {
          cb && cb.word && cb.word(w);
        } catch {
          /* the command's error is not ours */
        }
      });
      if (r.state === 'asked' && kind === 'ask' && cb && typeof cb.answer === 'function') {
        const t = now();
        for (const [k, w] of sayWait) if (t - w.at > 15 * 60000) sayWait.delete(k);
        sayWait.set(r.n, { peer: id, answer: cb.answer, at: t });
      }
      return { sent: r.state, n: r.n };
    },
    // That ask stopped waiting (its time ran out, its command ended): a late answer stays on the
    // card and enters no agent.
    sayDone(n) {
      sayWait.delete(String(n));
    },
    // The app's agent list changed (an agent started, ended, was renamed, or changed status).
    agentsChanged() {
      api?.agentsChanged();
    },
    // Another project folder was opened here, or this one is on another commit.
    projectChanged() {
      if (!api) return;
      lookHanded();
      api.projectChanged();
      for (const id of link.state().sessions) relook(id);
      push();
    },
    // Is there a link at all? The app builds its agent list only then.
    active: () => !!link,
    // Does any paired computer hold full control here now? For the app's own rule on `tnai rename`.
    // With no link it answers false before anything is read: a
    // feature that is off never asks the system's secure storage (before,
    // the app asked for the whole state there). A list that cannot be read counts as yes.
    controlGiven() {
      if (!link || !prefs) return false;
      try {
        return store.pairings().some(p => controlOn(p.id));
      } catch {
        return true;
      }
    },
    // Is any computer in a session with this one? The app keeps its agent list current only then.
    listening: () => !!api && api.listening(),
    // Signed out on this computer: the connection closes at once, whatever the server does. Signed
    // in again: it reopens. A change that is neither (the account pushes one often) leaves a
    // waiting link its backoff. A different account signing in on this Windows profile gets nothing
    // of the last one: its pairings, key, names and log are removed here (the other computers keep
    // a pairing that no longer works, as after "finish anyway").
    accountChanged(signedIn, account = '') {
      if (signedIn && account) acct = account;
      if (signedIn && account && !never() && ready()) {
        if (prefs.account && prefs.account !== account) {
          api?.takeBack();
          down();
          for (const p of store.pairings()) store.remove(p.id);
          store.renewIdentity();
          store.setNote('trust', {});
          prefs = {
            on: false,
            account,
            name: '',
            detail: {},
            answer: {},
            control: {},
            watch: {},
            log: [],
          };
          save();
          answers = null;
          others = [];
          ended = null;

          // Nothing of the last account's control stays: no right, no held prompt (down() removed
          // them), no taken number, no ticket key, no list.
          if (control) {
            control.stop();
            control = null;
          }
          opsLog = [];
          store.setNote('ops', []);
          if (views) {
            views.quit();
            views = null;
          }
          if (watcher) {
            watcher.quit();
            watcher = null;
          }
          store.setNote('views', {});
          store.setNote('files', {});

          // the last account's watching allowance goes with it, and its day's allowance of files
          //
          push();
        } else if (!prefs.account && (prefs.on || store.pairings().length)) {
          prefs.account = account;
          save();
        }
      }
      if (!link) return;
      if (!signedIn) {
        if (!signedOut) {
          signedOut = true;
          dropHeld();
          api.takeBack();
          if (watcher) watcher.drop();

          /* signed out: no picture of another computer stays behind the lock */
          link.stop();
          push();
        }
        return;
      }

      // A link the relay ended as "replaced" (another window of this computer took the connection)
      // is not started again by an account push: two windows would take it from each other for
      // ever. The user's own "Connect
      // again" on Devices does it (connectAgain), and so does signing in again.
      if (signedOut || (conn.connection === 'stopped' && conn.reason !== 'replaced')) {
        signedOut = false;
        link.resume();
      }
    },
    // How many pairings would accountChanged(true, account) remove? Asked before the account that
    // stands behind the link is changed on purpose ("Use my own relay", own-relay-wiring.js), so
    // the user is asked first. It follows the wipe's own conditions above and changes nothing; only
    // a number leaves, never a key or an id. Nothing ever saved answers 0 without asking the
    // system's secure storage, as accountChanged does.
    wouldRemove(account = '') {
      if (!account || never() || !ready()) return 0;
      if (!prefs.account || prefs.account === account) return 0;
      try {
        return store.pairings().length;
      } catch {
        return 0;
      }
    },
    // "Connect again" on this computer's card: the user's own press, for a link that stopped for
    // good while signed in (replaced, or a plan or server refusal). Nothing happens while signed
    // out, with connecting off, or on a link that is not stopped.
    connectAgain() {
      live();
      if (!signedOut && conn.connection === 'stopped') link.resume();
      return state();
    },
    // The relay this computer connects through is about to change ("Use my own relay",
    // own-relay-wiring.js). Called BEFORE the change is saved: this computer's id and address come
    // from the relay that is set, so the link is ended while both are still the ones it was made
    // with. Ended afterwards, its last words (a held prompt reported as failed) would go out under
    // the new id on a socket opened under the old one, and the relay refuses those.
    // relayChanged() follows, whether the change was saved or not.
    relayGoing() {
      if (!link) return;
      down();
      relayWent = true;
      push();
    },
    // The relay this computer connects through changed (or the change failed after relayGoing()):
    // a link that is up was made for the old address, so it is ended, and a link is made again
    // when connecting is on.
    relayChanged() {
      if (!link && !relayWent) return;
      relayWent = false;
      down();
      if (prefs?.on) up();
      push();
    },
    quit() {
      down();
      applyAwake();
      if (awakeTimer) {
        clock.clear(awakeTimer);
        awakeTimer = null;
      }
      if (control) {
        control.stop();
        control = null;
      }
      if (views) {
        views.quit();
        views = null;
      }
      if (watcher) {
        watcher.quit();
        watcher = null;
      }
    },
  };
}

// Which finished turn of this computer's agents is told to its paired computers (remote-protocol.md
// 6g), as a function the tests can load without the app; main.js hands in the app's parts and calls
// it for every `agent:turn`. Once per task, and only for a turn
// that ended in the last two minutes by this computer's clock and after the panel's process
// started: a resumed Codex or OpenCode session publishes its last finished task again, with the end
// time it had then, and that is not a task that just finished. A Cursor Agent turn read from the
// chat's history has no true end time (agent-turns.js marks it `history`) and is never told.
// active() → is there a link at all. pane(panelId) → Promise of { name, cli, project } for a panel
// in the agent list, else null. processStart(panelId) → when that panel's process started
// (ptys.list()), 0 = unknown: nothing is told. short(task, result) → { task, did }
// (agent-context.js shortOf). keyOf(folder) → Promise of its project key. reported(r) →
// remote.reported.
const REPORT_FRESH_MS = 2 * 60 * 1000;

function createTurnReporter({
  active,
  pane,
  processStart,
  short,
  keyOf,
  reported,
  now = Date.now,
}) {
  const told = new Map(); // panel id → the start time of the task that was told last
  return async function report(t) {
    try {
      if (
        !t ||
        !t.paneId ||
        !t.result ||
        t.history === true ||
        !Number.isFinite(t.endedAt) ||
        t.endedAt <= 0 ||
        !active() ||
        told.get(t.paneId) === t.startedAt
      )
        return false;
      const age = now() - t.endedAt,
        born = processStart(t.paneId);
      if (!(age <= REPORT_FRESH_MS && age > -5000) || !(born > 0) || t.endedAt < born) return false;

      // panel ids are reused, so this stays small; a bound all the same
      if (told.size > 400) told.clear();
      told.set(t.paneId, t.startedAt);
      const p = await pane(t.paneId);
      if (!p) return false;
      const s = short(t.task, t.result) || {},
        key = p.project ? await Promise.resolve(keyOf(p.project)).catch(() => '') : '';

      // The task without the sender's mark of 6f change 21: that is for the terminal the prompt
      // landed in.
      return (
        reported({
          id: t.paneId,
          name: p.name,
          cli: p.cli,
          at: t.endedAt,
          task: String(s.task || '').replace(/^\[Sent from [^\[\]\r\n]{0,90}\] /, ''),
          did: s.did,
          text: t.result,
          p: key,
        }) === true
      );
    } catch {
      return false; /* nothing is told */
    }
  };
}

// The window's way in. Every argument is checked here; failures come back as { ok: false } like the
// app's other calls.
function registerIpc(ipcMain, service) {
  const id = v => {
    if (!keys.safeId(v)) throw new Error('remote: bad id');
    return v;
  };
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        return {
          ok: false,
          error: {
            code: String(e?.message || '').startsWith('remote: ') ? e.message.slice(8) : 'failed',
          },
        };
      }
    });
  handle('remote:state', () => service.state());
  handle('remote:refresh', () => service.refresh());
  handle('remote:setOn', v => service.setOn(v === true));
  handle('remote:setName', v => service.setName(typeof v === 'string' ? v : ''));
  handle('remote:pair', v => service.pair(id(v)));
  handle('remote:pairAny', () => service.pairAny());
  handle('remote:cancelPairing', () => service.cancelPairing());
  handle('remote:acceptPairing', () => service.acceptPairing());
  handle('remote:declinePairing', () => service.declinePairing());
  handle('remote:enterCode', v => service.enterCode(typeof v === 'string' ? v : ''));
  handle('remote:clearEnded', () => service.clearEnded());
  handle('remote:setDetail', (v, value) => service.setDetail(id(v), value === true));
  handle('remote:setAnswer', (v, value) => service.setAnswer(id(v), value === true));
  handle('remote:setAwake', v => service.setAwake(v === true));
  handle('remote:connectAgain', () => service.connectAgain());
  handle('remote:woke', () => service.woke());

  // Full control. Only text of a bounded length, a real true, two literal
  // words and a short CLI word get past here.
  const short = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  handle('remote:setControl', (v, value, more) =>
    service.setControl(id(v), value === true, {
      choose: more === 'choose' || more === 'choose say' || more === 'choose say sync',
      // 'choose say': the question also showed the sentence about agents messaging agents.
      // SWITCHED OFF 2026-10-10 (a known fault: only a message's
      // first turn counts as started by another computer's agent, `remote-say.js` `inSay`): the
      // mark can never be set until that is fixed and reviewed; then put back
      // `more === 'choose say'`.
      say: false,
      // 'choose say sync': the question also showed the git hand-over's sentence,
      // so the grant includes the
      // `sync` right.
      sync: more === 'choose say sync',
    })
  );
  handle('remote:pick', (v, itemId, n, kof) =>
    service.pick(
      id(v),
      typeof itemId === 'string' ? itemId.slice(0, 80) : '',
      Number.isInteger(n) && n >= 1 && n <= 9 ? n : 0,
      typeof kof === 'string' ? kof.slice(0, 24) : ''
    )
  );
  handle('remote:prompt', (v, agentId, text, mark) =>
    service.prompt(id(v), short(agentId, 80), typeof text === 'string' ? text : '', short(mark, 12))
  );
  handle('remote:act', (v, agentId, what, mark) =>
    service.act(
      id(v),
      short(agentId, 80),
      what === 'interrupt' ? 'interrupt' : what === 'stop' ? 'stop' : '',
      short(mark, 12)
    )
  );
  handle('remote:handOver', v => service.handOver(id(v)));
  handle('remote:bring', v => service.bring(id(v)));
  handle('remote:start', (v, cli, text) =>
    service.startOn(id(v), short(cli, 16), typeof text === 'string' ? text : '')
  );
  handle('remote:room', (agentId, text) =>
    service.room(short(agentId, 80), typeof text === 'string' ? text : '')
  );
  handle('remote:controlLog', () => service.controlLog());

  // A prompt with files. From the window only a kind word and
  // the bytes of each are taken; a fourth file is kept so the service can say "too many", and
  // nothing larger than the largest allowed file is copied.
  const filesIn = v =>
    (Array.isArray(v) ? v.slice(0, PROMPT_FILES + 1) : []).map(f => {
      const b =
        f &&
        (f.bytes instanceof ArrayBuffer
          ? new Uint8Array(f.bytes)
          : ArrayBuffer.isView(f.bytes)
            ? new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength)
            : null);
      return {
        kind: f && typeof f.kind === 'string' ? f.kind.slice(0, 8) : '',
        data: b && b.byteLength <= PROMPT_MAX ? Buffer.from(b) : Buffer.alloc(0),
      };
    });
  handle('remote:promptFiles', (v, agentId, text, mark, files) =>
    service.promptFiles(
      id(v),
      short(agentId, 80),
      typeof text === 'string' ? text : '',
      short(mark, 12),
      filesIn(files)
    )
  );
  handle('remote:stopFiles', () => service.stopFiles());
  handle('remote:showFile', name => service.showFile(short(name, 120)));

  // read-only: the text of a result the state already lists
  handle('remote:reportText', (v, agentId) => service.reportText(id(v), short(agentId, 80)));

  // The live view. What the window hands over of a screen is bounded here and read field by field
  // in remote-view.js before any of it is sealed.
  handle('remote:view', (v, agentId, mark) =>
    service.view(id(v), short(agentId, 80), short(mark, 12))
  );
  handle('remote:keepView', () => service.keepView());
  handle('remote:unview', why => service.unview(why === 'hidden' ? 'hidden' : 'closed'));
  handle('remote:viewNow', () => service.viewNow());
  handle('remote:stopView', v => service.stopView(id(v)));
  handle('remote:screenRows', (paneId, raw) => {
    service.screen(
      short(paneId, 80),
      raw && typeof raw === 'object' && Array.isArray(raw.lines) && raw.lines.length <= 1000
        ? raw
        : null
    );
    return true;
  });
  handle('remote:answer', (v, itemId, say, of) =>
    service.answer(
      id(v),
      typeof itemId === 'string' ? itemId.slice(0, 80) : '',
      say === 'yes' ? 'yes' : say === 'no' ? 'no' : '',
      typeof of === 'string' ? of.slice(0, 24) : ''
    )
  );
  handle('remote:forget', v => service.forget(id(v)));
  handle('remote:choose', (v, choice) =>
    service.choose(id(v), choice === 'keep' ? 'keep' : choice === 'forget' ? 'forget' : '')
  );
  handle('remote:stopEverywhere', () => service.stopEverywhere());
  handle('remote:finishAnyway', () => service.finishAnyway());
  handle('remote:dismiss', v => service.dismiss(typeof v === 'string' ? v : ''));
}

module.exports = {
  createRemoteService,
  storageBackend,
  registerIpc,
  createTurnReporter,
  NEEDS,
  REPORT_FRESH_MS,
};
