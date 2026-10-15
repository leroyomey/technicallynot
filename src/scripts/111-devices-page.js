// Technically Not · devices-page — the Devices page: this account's computers, pairing with two
// typed codes, what another computer's agents wait for, Forget, Keep or Forget, Stop everywhere
// (desktop/remote-service.js through window.tnaiNative.remote)
(() => {
  const native = window.tnaiNative?.remote;
  if (!native) return; // browser, or a build without the feature: the page is never mounted

  let st = null,
    root = null,
    unsub = null;
  let dlg = null,
    dlgKey = '',
    opener = null,
    local = null,
    step2 = false,
    note = '';

  // Every text from another computer or the server is set as text, never as markup.
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const add = (parent, ...kids) => {
    for (const k of kids) if (k) parent.append(k);
    return parent;
  };
  const btn = (label, cls, onClick) => {
    const b = el('button', 'dv-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  };
  const call = async (name, ...args) => {
    const r = await native[name](...args);
    if (r && r.ok === false) throw r.error || {};
    return r && typeof r === 'object' && 'value' in r ? r.value : r;
  };
  const act = (name, ...args) =>
    call(name, ...args)
      .then(v => {
        if (v && v.self) apply(v);
        return v;
      })
      .catch(() => null);
  const shortId = id => String(id).slice(0, 8);

  // A fixed time, not "2 min ago": nothing on this page runs a timer to keep a relative time true.
  function clock(t) {
    if (!t) return '';
    const d = new Date(t),
      today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // The app's own computer character (src/assets/devices, as the Live preview device picker draws
  // it): awake = live, asleep = not.
  const CROP = [50, 40, 850, 700];

  function character() {
    const c = el('span', 'dv-ch'),
      base = 'src/assets/devices/desktop-';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = `--cx:${CROP[0]};--cy:${CROP[1]};--cw:${CROP[2]};--chh:${CROP[3]};--dv-mask:url("${new URL(base + 'screen.webp', document.baseURI).href}")`;
    for (const [part, cls] of [
      ['body', ''],
      ['screen', 'dv-scr'],
      ['sleep', 'dv-sleep'],
      ['eyes', 'dv-eyes'],
    ]) {
      const n = el(part === 'screen' ? 'span' : 'img', cls);
      if (part !== 'screen') {
        n.src = base + part + '.webp';
        n.alt = '';
        n.draggable = false;
      }
      c.append(n);
    }
    return c;
  }

  function toggle(on, label, onChange) {
    const t = el('button', 'dv-tog');
    t.type = 'button';
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', String(!!on));
    t.setAttribute('aria-label', label);
    t.onclick = () => onChange(!on);
    return t;
  }

  // ---- the page ----
  const CONNECTION = {
    online: 'Connected to your other computers.',
    connecting: 'Connecting…',
    off: 'Not connecting: no computer is paired yet.',
    waiting: 'Not connected right now. It tries again by itself.',
    stopped: 'Not connected.',
  };
  const STOPPED = {
    // no plans and no hosted relay since 2026-10-10: the way to connect
    // is a relay of the user's own, set on this computer's card
    signed_out: 'No relay is set. Choose "Use my own relay" on this computer below.',
    replaced: 'This computer connected from another window.',
    plan_required: 'This account has no relay. Choose "Use my own relay" on this computer below.',
    remote_disabled: 'Connecting computers is unavailable right now.',

    // an own relay's refusals that do not pass by themselves
    invalid_proof: 'Your relay refused the secret. Check the address and the secret under Change.',
    relay_not_set_up: 'Your relay has no secret yet. Finish its setup, then connect again.',
    clock_off:
      "This computer's clock is more than two minutes off. Set the time, then connect again.",
    too_many_ids:
      'Your relay knows too many devices. Set a new secret on the relay and here; your pairings stay.',
    refused: 'No relay answers at that address. Check the address under Change.',
  };

  // "Use my own relay": a relay the user runs themselves. `own` is what
  // the bridge says: { available, set, url } and never the secret.
  let own = null;
  const RELAY_ERR = {
    unavailable:
      'This computer has no secure storage for the secret, so a relay cannot be saved here.',
    bad_url:
      'The address must start with https:// and have no path, for example https://my-relay.example.workers.dev.',
    bad_secret: 'The secret must be 32 to 200 characters long, with no spaces.',
    not_saved: 'It could not be saved. Try again.',
  };

  // This computer's id on an own relay is not on disk (`own.idProblem`). Everything works in this
  // run; said to nobody, the next start would make another id and the pairings would just stop.
  const ID_ERR = {
    id_not_saved:
      "This computer's id could not be saved, so its pairings work only until the app closes: free disk space or make the app's settings folder writable, and it is saved by itself.",
    id_not_read:
      "This computer's saved id could not be read, so earlier pairings do not work now and new ones will not survive a restart: make the app's settings folder readable, then restart the app.",
  };

  // A relay is saved here, but what was saved is no longer taken (`own.problem`).
  const OLD_RELAY = {
    old_secret: 'The secret saved for your relay is no longer accepted. Set the secret again.',
    old_address:
      'The address saved for your relay is no longer accepted. Set your relay again; your pairings stay.',
  };
  const loadOwn = () =>
    Promise.resolve(native.ownRelay?.())
      .then(r => {
        if (r && typeof r === 'object') {
          own = r;
          render();
        }
      })
      .catch(() => {});

  function relayRow() {
    if (!own) return null;
    if (!own.available)
      return el(
        'p',
        'dv-muted',
        'This computer has no secure storage for a relay secret, so your own relay cannot be used here.'
      );

    // A relay was saved here with a secret this version no longer accepts (its rules about
    // patterns were tightened). Nothing is connected until the secret is set again; saying only
    // "no relay" would leave the user wondering where theirs went.
    // The same for a saved address this version no longer accepts.
    if (!own.set && Object.hasOwn(OLD_RELAY, own.problem))
      return add(
        el('div', 'dv-owed'),
        el('span', '', OLD_RELAY[own.problem]),
        btn('Use my own relay', '', e => ask('relay', e))
      );
    if (!own.set)
      return add(
        el('div', 'dv-owed'),
        el('span', '', 'Connect through a relay you run yourself.'),
        btn('Use my own relay', '', e => ask('relay', e))
      );
    const row = add(
      el('div', 'dv-owed'),
      el('span', '', 'Through your own relay: ' + own.url),
      btn('Change', '', e => ask('relay', e)),
      btn('Remove', '', e => ask('relay-remove', e))
    );
    row.dataset.relay = '1';
    return row;
  }

  // Save or remove: the page is repainted from the state the bridge hands back.
  async function relayDo(name, args, fail) {
    let r;
    try {
      r = await native[name](...args);
    } catch {
      r = { ok: false, error: 'not_saved' };
    }

    // The change would remove pairings (going between a Technically Not account and an own relay):
    // nothing was changed yet. The question is asked in a dialog, and its Remove calls again with
    // the confirm flag. What was typed is kept only until that dialog closes.
    if (r && r.ok === false && r.error === 'would_remove') {
      local = { kind: 'relay-confirm', name, args, count: Number(r.count) || 0 };
      dialog();
      return;
    }
    if (!r || r.ok === false) {
      fail(RELAY_ERR[r?.error] || RELAY_ERR.not_saved);
      return;
    }
    own = { available: r.available, set: r.set, url: r.url, idProblem: r.idProblem };
    local = null;
    if (r.state && r.state.self) apply(r.state);
    else render();
    dialog();

    // A relay was just saved: ask it who else is there. The state handed back was made before
    // anything was asked of the new relay, so without this the other computers are listed only
    // when the page is opened again. (After a removal there is no relay to ask.)
    if (r.set) act('refresh');
  }

  function meCard() {
    const card = el('article', 'dv-surf dv-pc dv-me dv-awake');
    const who = add(el('div', 'dv-who'), el('h3', '', st.self.name));
    const now = el('div', 'dv-now');
    const line =
      st.connection === 'stopped'
        ? STOPPED[st.reason] || CONNECTION.stopped
        : st.connection === 'off' && st.computers.length
          ? 'Not connected.'
          : CONNECTION[st.connection] || '';

    // Replaced by another window of this computer: it does not connect again by itself (two windows
    // would take the connection from each other for ever), so the way back is this press.
    // The row is the one "is watching … End it" uses.
    if (st.connection === 'stopped' && st.reason === 'replaced') {
      const row = add(
        el('div', 'dv-owed'),
        el('span', '', line),
        btn('Connect again', '', () => act('connectAgain'))
      );
      row.dataset.replaced = '1';
      add(now, row);
    } else add(now, el('p', '', line));
    if (st.reason === 'remote_disabled' && st.connection !== 'stopped')
      add(now, el('p', 'dv-muted', STOPPED.remote_disabled));

    // the id file could not be written or read: one more line, in the same place and style
    if (own && Object.hasOwn(ID_ERR, own.idProblem)) {
      const idLine = el('p', 'dv-muted', ID_ERR[own.idProblem]);
      idLine.dataset.idProblem = own.idProblem;
      add(now, idLine);
    }

    // Keep-awake: this computer's own choice, off by default. The line under it says what is true
    // right now.
    if (st.awake) {
      const a = st.awake,
        AWAKE = {
          '': 'On now: an agent here is working or waiting for an answer, so this computer does not go to sleep by itself. Sleep that you start yourself still happens, and so does sleep on battery.',
          idle: 'On, but no agent is working right now, so this computer sleeps as usual.',
          waited:
            'On, but an agent has waited for an answer for more than two hours, so this computer sleeps as usual.',
          paused: 'On, but nothing is kept awake while the pairing is paused.',
          battery: 'On, but not on battery: it sleeps as usual until it is plugged in.',
          unpaired: 'On, but nothing is kept awake until a computer is paired.',
          off: 'On, but nothing is kept awake while this computer is not connecting.',
        };
      add(
        now,
        add(
          el('div', 'dv-opt'),
          el('span', '', 'Keep this computer awake while agents are working'),
          toggle(a.on, 'Keep this computer awake while agents are working', v => act('setAwake', v))
        ),
        el(
          'p',
          'dv-muted',
          a.on
            ? AWAKE[a.held ? '' : a.why] || AWAKE.off
            : 'Off: this computer sleeps as usual, and its agents cannot be reached while it sleeps.'
        )
      );
    }
    const rel = relayRow();
    if (rel) add(now, rel);
    add(
      card,
      add(el('div', 'dv-stage'), character()),
      add(
        el('div'),
        who,
        add(el('div', 'dv-state'), dot('var(--pg-work)'), el('span', '', 'This computer'))
      ),
      now,
      add(
        el('div', 'dv-acts'),
        btn('Rename', '', e => ask('rename', e)),
        btn('Pair a computer', '', e => {
          opener = e.currentTarget;
          act('pairAny');
        })
      )
    );
    return card;
  }
  const dot = color => {
    const d = el('i', 'dv-dot');
    if (color) d.style.setProperty('--dv-c', color);
    return d;
  };
  const AGENT_ROWS = 6; // agents listed on one computer's card; the rest are counted

  // A card lists the agents of the project that is open here; that computer's agents in other
  // projects are one counted line (the main process sorts them, remote-protocol.md 6e, and hands
  // over a whole number). Waiting questions above are shown whatever the project.
  const elsewhere = pc => (Number.isInteger(pc?.elsewhere) && pc.elsewhere > 0 ? pc.elsewhere : 0);

  // What the main process found when it compared a paired computer's copy of this project with this
  // one (remote-project.js `relate`). The words are this page's own and the counts are read as
  // whole numbers: nothing the other computer wrote is shown.
  const commits = n =>
    Number.isInteger(n) && n > 0
      ? n.toLocaleString('en-US') + (n === 1 ? ' commit' : ' commits')
      : '';

  function projectLine(p) {
    if (!p || typeof p !== 'object') return '';
    const has = 'Has this project';
    if (p.rel === 'same') return has + ', on the same commit as this computer.';
    if (p.rel === 'behind' && commits(p.n))
      return has + ', ' + commits(p.n) + ' behind this computer.';
    if (p.rel === 'ahead' && commits(p.n))
      return has + ', ' + commits(p.n) + ' ahead of this computer.';
    if (p.rel === 'apart' && commits(p.behind) && commits(p.ahead))
      return (
        has +
        ', ' +
        commits(p.behind) +
        ' behind and ' +
        commits(p.ahead) +
        ' ahead of this computer.'
      );
    if (p.rel === 'missing') return has + ', with commits this computer does not have.';
    return has + '.';
  }

  // The git hand-over. A commit travels as its id only; the
  // computer that receives fetches it from its own git remote into one branch, `tnai/handoff/…`,
  // and touches nothing else. The words are this page's own: what the main process hands over is
  // one fixed word. here: this computer fetched (the user's own press); else the other computer was
  // asked.
  const HANDOFF = {
    going: n => 'Fetching ' + n + "'s commit from this computer's git remote…",
    asked: n => 'Asked ' + n + " to fetch this computer's commit…",
    no_reply: n => n + ' did not reply.',
    done: (n, here) =>
      here
        ? n +
          "'s commit is here now, in a branch of its own. Your current branch and your files were not touched."
        : n + " has this computer's commit now, in a branch named after this computer.",
    same: (n, here) =>
      here
        ? "This computer's current branch already has " + n + "'s commit."
        : n + ' already has this commit.',
    absent: (n, here) =>
      here
        ? 'Not pushed from ' + n + " yet: this computer's git remote does not have that commit."
        : 'Not pushed from this computer yet. Push your commits, then ask again.',
    offline: (n, here) =>
      here
        ? 'This computer could not reach its git remote.'
        : n + ' could not reach its git remote.',
    signin: (n, here) =>
      here
        ? 'This computer must be signed in to its git remote first: run git fetch in your terminal here.'
        : n + ' must sign in to its git remote itself.',
    remote: (n, here) =>
      here
        ? 'This copy has no git remote that can be fetched from.'
        : n + "'s copy has no git remote it can fetch from.",
    kept: (n, here) =>
      here
        ? 'The branch of an earlier hand-over is checked out here, or holds work that is nowhere else. That branch was left as it is.'
        : n +
          ' is using the branch of an earlier hand-over, or it holds work that is nowhere else. That branch was left as it is.',
    project: (n, here) =>
      here ? 'Another project is open here now.' : n + ' has another project open now.',
    busy: (n, here) =>
      here
        ? 'Another hand-over is still running here.'
        : n + ' is still fetching for an earlier hand-over.',
    large: (n, here) =>
      here
        ? 'Stopped: more than 200 MB would have been fetched.'
        : n + ' stopped: more than 200 MB would have been fetched.',
    refused: (n, here) =>
      here
        ? 'It was not done. Your current branch and your files were not touched.'
        : n + ' did not take it.',
    failed: (n, here) =>
      here
        ? 'It did not work. Your current branch and your files were not touched.'
        : 'It did not work on ' + n + '. Its current branch and its files were not touched.',
    // never "nothing was changed": a fetch brings what this copy knows of the remote's branches up
    // to date, as any fetch would
  };
  const HANDOFF_SHOWN_MS = 10 * 60 * 1000; // a result stays on the card this long
  const handoffSay = (word, name, here) =>
    Object.hasOwn(HANDOFF, word) ? HANDOFF[word](name, here) : '';

  // The newest result of each direction for that computer, as lines: this computer's own "bring",
  // and what it asked of the other one.
  function handoffLines(pc) {
    const out = [],
      recent = at => Number.isFinite(at) && Date.now() - at < HANDOFF_SHOWN_MS;
    const b = pc.brought;
    if (b && recent(b.at)) {
      const t = handoffSay(b.state, pc.name, true);
      if (t) out.push(t);
    }
    const o = (pc.ops || []).find(x => x && x.kind === 'sync');
    if (o && recent(o.at)) {
      const t = handoffSay(o.state, pc.name, false);
      if (t) out.push(t);
    }
    return out;
  }

  // The same word in this computer's own list of what other computers did here.
  const HANDOFF_END = {
    done: 'It is in its branch now',
    same: "This computer's current branch already had it",
    absent: 'Not done: not pushed from that computer yet',
    offline: 'Not done: this computer could not reach its git remote',
    signin: 'Not done: this computer is not signed in to its git remote',
    remote: 'Not done: this copy has no git remote that can be fetched from',
    kept: 'Not done: the branch of an earlier hand-over is in use here',
    project: 'Not done: another project was open',
    busy: 'Not done: another hand-over was running',
    large: 'Stopped: more than 200 MB would have been fetched',
    refused: 'Not done',
    failed: 'It did not work. No branch or file here was touched',
  };

  // A yes or no to a permission question on another computer. The words are
  // this page's own: what the other computer sends back is read in the main process as one of these
  // states and nothing else. An answer nobody confirmed is not called failed: it may have arrived.
  const SAID = { yes: 'Allow once', no: 'Deny' };
  const RESULT = {
    sent: () => 'Sent',
    answered: () => 'Answered',
    not_sent: () => 'Not sent',
    no_reply: () => 'No confirmation yet',
    not_allowed: n => n + ' does not take answers from this computer',
    refused: n => 'Not taken. Answer this one on ' + n,
    failed: n => 'It was already answered or closed on ' + n,
  };

  // no second press while it waits or after it was taken
  const DONE = new Set(['sent', 'answered', 'failed']);

  // Is this element in view right now: inside the window and inside every box it scrolls in. For a
  // longer command, whose last line must be on screen at the moment Allow once or Deny is pressed.
  const inView = node => {
    const r = node.getBoundingClientRect();
    if (!(r.height > 0) || r.top < 0 || r.bottom > window.innerHeight + 1) return false;
    for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
      if (
        p.scrollHeight > p.clientHeight + 1 &&
        /auto|scroll|hidden/.test(getComputedStyle(p).overflowY)
      ) {
        const b = p.getBoundingClientRect();
        if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return false;
      }
    }
    return true;
  };
  const answerLine = (it, name) =>
    it.answer && RESULT[it.answer]
      ? (SAID[it.said] || 'Answer') + ' · ' + RESULT[it.answer](name)
      : '';

  // A paired computer decides how many items and agents it reports, so it can make its card taller
  // or shorter and slide another computer's Allow once under the pointer. As
  // on the app's own permission card (45, SWAP_MS): for a moment after what is listed changed, the
  // answer buttons are off and a press does nothing. The result of an answer is not such a change.
  const QUIET_MS = 600;
  let listed = '',
    movedAt = 0,
    quietTimer = 0;
  const quiet = () => Date.now() - movedAt < QUIET_MS;

  // The buttons of full control (below) sit on the agent rows, which also move when an agent starts
  // or ends work or gets a task, so they have a quiet time of their own on top of the one above;
  // the answer buttons keep exactly theirs.
  let listed2 = '',
    movedAt2 = 0,
    quietTimer2 = 0;
  const quiet2 = () => quiet() || Date.now() - movedAt2 < QUIET_MS;

  function sawList(s) {
    const pcs = s?.on ? s.computers || [] : [];
    const key2 = JSON.stringify(
      pcs.map(pc => [
        pc.id,
        !!pc.canControl,
        !!pc.canWatch /* Watch comes and goes with it, beside the other buttons */,
        (pc.canStart || []).length,
        (pc.agents || []).map(a => [
          a.id,
          !!a.can,
          a.mark || '',
          a.status === 'working',
          !!(a.task || resultOf(a)),
        ]),
      ])
    );
    if (key2 !== listed2) {
      listed2 = key2;
      movedAt2 = Date.now();
      clearTimeout(quietTimer2);
      quietTimer2 = setTimeout(() => {
        if (root) render();
      }, QUIET_MS + 30);
    }
    const key = JSON.stringify(
      pcs.map(pc => [
        pc.id,
        pc.state,
        pc.update,
        pc.keepsAsking,
        (pc.asks || []).length,
        (pc.agents || []).length,
        elsewhere(pc),
        pc.project ? String(pc.project.rel) : '',
        (pc.items || []).map(it => [
          it.id,
          it.of || '',
          !!it.can,
          !!it.can2,
          it.full || '',
          it.detail || '',
          it.kof || '',
        ]),
      ])
    );
    if (key === listed) return;
    listed = key;
    movedAt = Date.now();
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      if (root) render();
    }, QUIET_MS + 30); // the buttons come back by themselves
  }
  const sendAnswer = (pc, it, say) =>
    quiet()
      ? Promise.resolve('moved')
      : call('answer', pc.id, it.id, say, it.of)
          .then(v => {
            if (v && v.self) apply(v);
            return v?.sent || 'not_sent';
          })
          .catch(() => 'not_sent');

  // Full control: a prompt, Interrupt and Stop for an agent on another
  // computer that says it takes them from this one (`can` on its row; the ticket itself never
  // reaches the window), and "New agent" where it lists CLIs to start. The words are this page's
  // own: what that computer sends back is read in the main process as one of a few fixed states.
  const FULL_SAYS =
    'It can make agents on this computer do anything you could ask them to. Agents that work without asking will run what it sends without asking.';

  // What full control also gives since the live view ("Whose right it is"):
  // shown in the question that turns the switch on and under the switch.
  const WATCH_SAYS =
    "It can watch your agents' terminal panels while they work, in any project: everything shown there, such as file contents, command output and what you type into them.";

  // The sentence for picking an option, word for word.
  // Full control that is turned on under this sentence includes picking an option; one
  // turned on before it does not, until it is turned off and on again.
  const PICK_SAYS = 'It can pick an option when your agents ask you to choose.';

  // The sentence for agents messaging agents, word for word.
  // Full control that is turned on under this sentence lets that computer's
  // agents message agents here; one turned on before it does not.
  const SAY_SAYS = name =>
    `Agents on ${name} can, with nobody pressing anything, ask agents here questions. Those agents can read any file they can reach and their answers go back to ${name}'s agents. Commands and edits you have already allowed run without asking.`;

  // The sentence for the git hand-over, word for word.
  // Full control that is turned on under this sentence lets that
  // computer ask this one to fetch a commit; one turned on before it does not.
  const SYNC_SAYS =
    "It can have this computer fetch from this project's git remote, with the sign-in saved on this computer, and keep the commit it names in a branch of its own. Your files and your current branch are not touched; what this copy knows of the remote's branches is brought up to date, as a fetch would.";
  const CLI_NAME = {
    claude: 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
    cursor: 'Cursor Agent',
  };

  // how long the result of something sent stays on the row; read when the page is drawn, no timer
  const OP_FRESH_MS = 10 * 60 * 1000;
  const OP_SAID = {
    prompt: {
      asked: () => 'Prompt: sending…',
      sent: () => 'Prompt sent',
      queued: n => 'Prompt is held on ' + n + ' until its agent is free',
      unconfirmed: n => 'Prompt sent. ' + n + ' could not confirm that it started',
      refused: n => 'Prompt not taken by ' + n,
      failed: n =>
        'Prompt not delivered: the agent was asking something, changed or closed on ' + n,
      not_sent: () => 'Prompt not sent',
      no_reply: n => 'Prompt: no confirmation from ' + n + ' yet',
    },
    interrupt: {
      asked: () => 'Interrupt: sending…',
      done: () => 'Interrupted',
      unsent: n => 'Interrupted. Its prompt is back in its input on ' + n + ', not sent',
      refused: n => 'Interrupt not taken by ' + n,
      failed: n => 'Interrupt did not work on ' + n,
      not_sent: () => 'Interrupt not sent',
      no_reply: n => 'Interrupt: no confirmation from ' + n + ' yet',
    },
    stop: {
      asked: () => 'Stop: sending…',
      done: () => 'Stopped',
      refused: n => 'Stop not taken by ' + n,
      failed: n => 'Stop did not work: it had ended or changed on ' + n,
      not_sent: () => 'Stop not sent',
      no_reply: n => 'Stop: no confirmation from ' + n + ' yet',
    },
    // "Choose option N" of an agent's question.
    choose: {
      asked: () => 'Choice: sending…',
      done: () => 'Option chosen',
      refused: n => 'Choice not taken by ' + n + '. Answer it on ' + n,
      failed: n => 'Choice did not go through on ' + n,
      not_sent: () => 'Choice not sent',
      no_reply: n => 'Choice: no confirmation from ' + n + ' yet',
    },
    start: {
      asked: () => 'starting…',
      started: () => 'started',
      refused: n =>
        'not taken by ' +
        n +
        '. It starts one only while this project is open there, and three at most',
      failed: n => 'it did not start on ' + n,
      not_sent: () => 'not sent',
      no_reply: n => 'no confirmation from ' + n + ' yet',
    },
  };
  const fresh = o => !!o && Number.isFinite(o.at) && Date.now() - o.at < OP_FRESH_MS;
  const opLine = (pc, ag) => {
    const o = (pc.ops || []).find(
      x =>
        x.id === ag.id &&
        (x.kind === 'prompt' || x.kind === 'promptf' || x.kind === 'act' || x.kind === 'choose')
    );
    return fresh(o)
      ? {
          o,
          text:
            OP_SAID[o.kind === 'act' ? o.do : o.kind === 'promptf' ? 'prompt' : o.kind]?.[
              o.state
            ]?.(pc.name) || '',
        }
      : null;

    // promptf: a prompt that went with files, worded as a prompt
  };

  // The task an agent on another computer finished last, handed over on its
  // row as `last`. It takes the row's second line, where the task or the word on something sent
  // already shows: no new line. Until that agent is on a newer task, when the task shows again (the
  // app's own Result view does the same). Every word of it is that computer's and is set as text.
  const resultOf = ag =>
    ag?.last && typeof ag.last === 'object' && Number.isFinite(ag.last.at) && !(ag.since > 0)
      ? ag.last
      : null;
  const resultLine = r => 'Finished ' + clock(r.at) + ': ' + (r.did || r.task || 'no summary');

  // The line is the way in to the fuller text: a press, or Enter or Space on it, opens the page's
  // dialog.
  function resultSpan(pc, ag, r) {
    const line = el('span', '', resultLine(r)),
      open = e => ask('report', e, pc, ag);
    line.setAttribute('role', 'button');
    line.tabIndex = 0;
    line.dataset.report = '1';
    line.title = 'Open the result';
    line.setAttribute(
      'aria-label',
      ag.name + ' on ' + pc.name + ': ' + line.textContent + '. Open the result.'
    ); // the words on screen are part of its name
    line.onclick = open;
    line.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(e);
      }
    };
    return line;
  }
  const firstWords = (t, n) => {
    const c = Array.from(String(t));
    return c.length > n
      ? c
          .slice(0, n - 1)
          .join('')
          .trimEnd() + '…'
      : c.join('');
  };
  const startLine = pc => {
    const o = (pc.ops || []).find(x => x.kind === 'start');
    const t = fresh(o) ? OP_SAID.start[o.state]?.(pc.name) : '';
    return t ? 'New ' + (CLI_NAME[o.cli] || 'agent') + ': ' + t + '.' : '';
  };

  // Between the press and the send the list may have changed: the same row id can be another agent
  // by then. Nothing is sent unless the agent that was named on the button is still the one listed,
  // under the same name and CLI, and still takes it.
  const pcNow = id => st?.computers?.find(c => c.id === id) || null;
  const still = (pc, ag) => {
    const a = pcNow(pc.id)?.agents?.find(x => x.id === ag.id);
    return !!a && a.can === true && a.name === ag.name && a.cli === ag.cli;
  };

  // The row's `mark` (a short digest the main process made of that agent's ticket, never the
  // ticket) goes back with every press: the main process sends nothing when the agent under that
  // row is no longer the one this page drew.
  const CHANGED = (pc, ag) =>
    `${ag.name} changed or closed on ${pc.name} meanwhile, so nothing was sent.`;
  const sendAct = (pc, ag, what) =>
    still(pc, ag)
      ? act('act', pc.id, ag.id, what, ag.mark || '').then(v => {
          if (v?.sent === 'changed') window.toast?.(CHANGED(pc, ag));
          return v;
        })
      : Promise.resolve(window.toast?.(CHANGED(pc, ag)) && null);

  // What other computers made this one's agents do (the list kept by the main process): one line
  // each, the text as text.
  const who = e => e.agent || 'an agent';
  const CTL = {
    // an agent on another computer messaged an agent here; e.name is
    // "(agent) on (computer)"
    say: e => e.name + ' asked ' + who(e) + ', with nobody pressing anything',
    prompt: e => e.name + ' sent ' + who(e) + ' a prompt',
    interrupt: e => e.name + ' interrupted ' + who(e),
    stop: e => e.name + ' stopped ' + who(e),
    choose: e => e.name + ' chose an option for ' + who(e),
    choose_no: e =>
      e.name +
      ' tried to choose an option' +
      (e.agent ? ' for ' + who(e) : '') +
      '. It was not taken',
    sync: e => e.name + ' asked this computer to fetch a commit into its hand-over branch',
    sync_end: e =>
      'The commit ' +
      e.name +
      ' named: ' +
      (Object.hasOwn(HANDOFF_END, e.head) ? HANDOFF_END[e.head] : HANDOFF_END.failed),
    // remote-attachments.md: the offer of one file; its kind and size follow as the line's small
    // text
    file: e => e.name + ' sent a file for ' + who(e) + '. It waits here for its prompt',
    watch: e => e.name + ' watched ' + who(e) + "'s terminal panel",
    start: e => e.name + ' started ' + who(e),
    dropped: e =>
      'A prompt from ' + e.name + ' for ' + who(e) + ' was removed before it was written',
  };
  const ctlText = e =>
    e.head
      ? e.head +
        (Number.isInteger(e.more) && e.more > 0
          ? ' … and ' + e.more.toLocaleString('en-US') + ' more characters'
          : '')
      : '';

  // A view's line: how long it lasted and how it ended, in this page's own words; a line without a
  // length is a view that still runs, or one this computer could not finish writing (it was closed
  // in the middle).
  const WATCH_END = {
    closed: 'closed there',
    hidden: 'its window went out of view',
    timeout: 'ended after 10 minutes',
    spent: "the day's 120 minutes were used up",
    off: 'its right ended here',
    gone: 'the agent ended or changed',
    stopped: 'ended here',
  };
  const watchText = e =>
    Number.isFinite(e.secs)
      ? 'for ' +
        (e.secs >= 90 ? Math.round(e.secs / 60) + ' min' : Math.max(1, Math.round(e.secs)) + ' s') +
        (WATCH_END[e.why] ? ', ' + WATCH_END[e.why] : '')
      : (Array.isArray(st?.watching) ? st.watching : []).some(
            x => x && x.peer === e.peer && Math.abs(x.since - e.at) < 5000
          )
        ? 'still watching'
        : 'its end was not recorded';

  // The files that came with a prompt: what each is, how big, the name this
  // computer gave it in its attachments folder, and "Show in folder". The page never opens one.
  const cameWith = e =>
    (e.op === 'prompt' && Array.isArray(e.files)
      ? e.files.filter(f => f && typeof f.name === 'string' && f.name).slice(0, 3)
      : []
    ).flatMap(f => {
      const kb =
          Number(f.bytes) >= 1024
            ? Math.round(f.bytes / 1024) + ' KB'
            : (Number(f.bytes) || 0) + ' bytes',
        b = btn('Show in folder', '', () => {
          call('showFile', f.name)
            .then(ok => {
              if (ok === false && typeof window.toast === 'function')
                window.toast(
                  'That file is no longer in the attachments folder (files from another computer are removed after 7 days).'
                );
            })
            .catch(() => {});
        });
      b.setAttribute('aria-label', 'Show ' + f.name + ' in its folder');
      return [
        add(
          el(
            'small',
            '',
            'With a ' +
              (f.kind === 'txt' ? 'text file' : 'picture') +
              ', ' +
              kb +
              ': ' +
              f.name +
              ' '
          ),
          b
        ),
        // the button sits in the line's own text column, after the file it shows (window run 1:
        // beside it, it fell under the time)
      ];
    });
  const ctlItem = e => {
    const t = CTL[e.op]?.(e),
      more = !t ? '' : e.op === 'watch' ? watchText(e) : e.op === 'sync_end' ? '' : ctlText(e);
    return t
      ? add(
          el('li'),
          el('time', '', clock(e.at)),
          el('span', '', t),
          more ? el('small', '', more) : null,
          ...cameWith(e)
        )
      : null;
  };
  const CTL_ROWS = 5;

  function pcCard(pc) {
    const live = pc.session && pc.state !== 'paused';
    const card = el('article', 'dv-surf dv-pc ' + (live ? 'dv-awake' : 'dv-asleep'));
    card.dataset.pc = pc.id;
    const heard = pc.heard ? ' · last heard ' + clock(pc.heard) : '';
    const state =
      pc.state === 'paused'
        ? ['var(--pg-wait)', 'Paused: waiting for your answer']
        : pc.state === 'live'
          ? ['var(--pg-work)', 'Online']
          : pc.state === 'last_heard'
            ? ['var(--pg-idle)', 'Not answering' + heard]
            : ['', (pc.online ? 'Connecting' : 'Offline') + heard];
    const now = el('div', 'dv-now');
    if (pc.update)
      add(now, el('p', 'dv-muted', 'Update Technically Not on ' + pc.name + ' to connect.'));
    if (pc.state === 'paused') {
      for (const a of pc.asks)
        add(
          now,
          el(
            'p',
            '',
            a.kind === 'stop'
              ? `${a.name} (${shortId(a.id)}) is stopping on all computers and asks this one to forget it.`
              : `${a.name} (${shortId(a.id)}) asks this computer to forget ${pc.name} (${shortId(pc.id)}).`
          )
        );
      add(
        now,
        el(
          'p',
          'dv-muted',
          'Nothing is sent to it or shown from it until you choose, so its agents cannot be answered from here meanwhile. Forget it if that computer was lost, sold or stopped by you; keep it if you did not ask for this.'
        )
      );
    } else if (pc.state === 'live') {
      for (const it of pc.items) {
        const need = el('div', 'dv-need'),
          head = el('b', '', (it.agent || 'An agent') + ' needs you');
        add(head, add(el('time', '', clock(it.since))));
        add(
          need,
          head,
          el('span', '', it.detail || 'It is waiting for an answer on ' + pc.name + '.'),
          it.inferred ? el('small', '', 'read from its screen') : null
        );
        if (it.can) {
          // That computer lets this one answer this request: the same two answers as its own
          // permission card, never "for this session".
          const off = !pc.session || DONE.has(it.answer) || quiet(),
            said = answerLine(it, pc.name);
          const yes = btn('Allow once', 'dv-pri', () => sendAnswer(pc, it, 'yes')),
            no = btn('Deny', '', () => sendAnswer(pc, it, 'no'));
          for (const [b, word] of [
            [yes, 'Allow once'],
            [no, 'Deny'],
          ]) {
            b.disabled = off;
            b.setAttribute('aria-label', word + ': ' + (it.detail || it.agent || 'request'));
          }
          add(need, said ? el('span', 'dv-muted', said) : null, add(el('div', 'dv-acts'), no, yes));
        } else if (it.can2 && typeof it.full === 'string' && it.full) {
          // A longer command that computer lets this one answer: every line of it, wrapped, with no
          // cut height. The two answers take a press only while its last line is in view, so what
          // is approved was on screen to its end.
          const cmd = el('div', 'dv-full');
          for (const l of it.full.split('\n')) add(cmd, el('span', '', l === '' ? ' ' : l));
          cmd.setAttribute('role', 'group');
          cmd.setAttribute(
            'aria-label',
            'The whole command, ' +
              cmd.children.length +
              (cmd.children.length === 1 ? ' line' : ' lines')
          );
          const off = !pc.session || DONE.has(it.answer) || quiet(),
            said = answerLine(it, pc.name),
            unseen = el('span', 'dv-muted', '');
          const press = say => () => {
            if (!inView(cmd.lastElementChild)) {
              unseen.textContent =
                'Scroll until the last line of the command is in view, then press.';
              return;
            }
            unseen.textContent = '';
            return sendAnswer(pc, it, say);
          };
          const yes = btn('Allow once', 'dv-pri', press('yes')),
            no = btn('Deny', '', press('no'));
          for (const [b, word] of [
            [yes, 'Allow once'],
            [no, 'Deny'],
          ]) {
            b.disabled = off;
            b.setAttribute(
              'aria-label',
              word + ': the whole command above, ' + (it.agent || 'an agent') + ' on ' + pc.name
            );
          }
          add(
            need,
            cmd,
            said ? el('span', 'dv-muted', said) : null,
            unseen,
            add(el('div', 'dv-acts'), no, yes)
          );
        } else if (
          Array.isArray(it.opts) &&
          it.opts.length &&
          typeof it.kof === 'string' &&
          it.kof &&
          (pc.agents || []).some(a => a.id === it.row && a.can === true)
        ) {
          // A question with numbered options that computer lets this one answer (remote-protocol.md
          // 6i): one button per option. A press sends "option N of this question", never a key;
          // that computer answers its agent itself, or refuses.
          const off = !pc.session || quiet() || quiet2(),
            acts = el('div', 'dv-acts');
          it.opts.forEach((label, i) => {
            const b = btn(i + 1 + ' ' + label, '', () => {
              if (quiet() || quiet2()) return;
              call('pick', pc.id, it.id, i + 1, it.kof)
                .then(v => {
                  if (v && v.self) apply(v);
                })
                .catch(() => {});
            });
            b.disabled = off;
            b.setAttribute(
              'aria-label',
              'Choose option ' +
                (i + 1) +
                ', ' +
                label +
                ', for ' +
                (it.agent || 'the agent') +
                ' on ' +
                pc.name
            );
            add(acts, b);
          });
          add(need, acts);
        } else if (it.kind === 'permission')
          add(need, el('span', 'dv-muted', 'Answer this one on ' + pc.name + '.'));
        add(now, need);
      }

      // Its agents as that computer reports them (phase 1, "See"): name, CLI, status, and the task
      // when it sends text.
      const agents = pc.agents || [],
        WORD = {
          working: ['var(--pg-work)', 'Working'],
          needs: ['var(--pg-wait)', 'Needs you'],
          idle: ['', 'Idle'],
        };
      for (const ag of agents.slice(0, AGENT_ROWS)) {
        const st = WORD[ag.status] || WORD.idle,
          row = el('div', 'dv-agent'),
          head = add(
            el('b'),
            el('span', '', ag.name),
            el('small', '', (ag.cli ? ag.cli + ' · ' : '') + st[1])
          );
        if (ag.can === true && pc.canControl) {
          // That computer takes operations for this agent from here. The second line always exists
          // for such a row, so a result that comes in changes its words and never the height of the
          // card; the task is then in the row's tip. The newest of the two wins the line: the word
          // on something sent from here, until a result arrived after it was sent.
          const said = opLine(pc, ag),
            off = !pc.session || quiet2() || said?.o.state === 'asked',
            res = resultOf(ag);
          const done = res && !(said?.text && !(res.got > said.o.at)) ? res : null,
            line = done ? '' : said?.text || ag.task || '';
          const acts = el('div'),
            press = (word, cls, run) => {
              const b = btn(word, 'dv-sm' + cls, run);
              b.disabled = off;
              b.setAttribute('aria-label', word + ' ' + ag.name + ' on ' + pc.name);
              add(acts, b);
            };
          press('Prompt', '', e => ask('prompt', e, pc, ag));
          if (pc.canWatch === true) press('Watch', '', e => watch(e, pc, ag));
          if (ag.status === 'working')
            press('Interrupt', '', () => {
              if (!quiet2()) sendAct(pc, ag, 'interrupt');
            });
          press('Stop', '', e => ask('stop-agent', e, pc, ag));
          const second = add(
            el('div', 'dv-do'),
            done ? resultSpan(pc, ag, done) : line ? el('span', '', line) : null,
            acts
          );
          if (!done && said?.text) second.dataset.op = said.o.state;
          add(row, dot(st[0]), add(el('div'), head, second));
        } else {
          const done = resultOf(ag);
          add(
            row,
            dot(st[0]),
            add(
              el('div'),
              head,
              done ? resultSpan(pc, ag, done) : ag.task ? el('span', '', ag.task) : null
            )
          );

          // typed by hand there, or not started by the app as an agent: no buttons
          if (pc.canControl) row.dataset.there = '1';
        }
        if (ag.task || row.dataset.there)
          row.title = [ag.task, row.dataset.there ? 'Control this one on ' + pc.name + '.' : '']
            .filter(Boolean)
            .join('\n');
        add(now, row);
      }
      if (agents.length > AGENT_ROWS)
        add(now, el('p', 'dv-muted', agents.length - AGENT_ROWS + ' more on ' + pc.name + '.'));
      const away = elsewhere(pc);
      if (away) {
        const p = el(
          'p',
          'dv-muted',
          away === 1
            ? '1 agent in another project.'
            : away.toLocaleString('en-US') + ' agents in other projects.'
        );
        p.dataset.elsewhere = away;
        p.title = 'They are listed when that project is open on this computer.';
        add(now, p);
      }
      if (!pc.items.length && !agents.length && !away)
        add(now, el('p', 'dv-muted', 'Nothing reported.'));

      // It has the project that is open here (piece P2, "same project, seen"): one line, counted in
      // commits by this computer's own git.
      const same = projectLine(pc.project);
      if (same) {
        const p = el('p', 'dv-muted', same);
        p.dataset.project = pc.project.rel;
        p.title = 'Compared by commits. Changes that are not committed are not compared.';
        add(now, p);
      }
      for (const t of handoffLines(pc)) {
        const p = el('p', 'dv-muted', t);
        p.dataset.handoff = '1';
        add(now, p);
      } // how the newest hand-over in each direction ended
      const begun = startLine(pc);
      if (begun) {
        const p = el('p', 'dv-muted', begun);
        p.dataset.started = '1';
        add(now, p);
      }
    } else
      add(
        now,
        el(
          'p',
          'dv-muted',
          'Nothing from it is shown as live while it is ' +
            (pc.state === 'last_heard' ? 'not answering.' : 'offline.')
        )
      );

    // A commit that computer named is in a branch of this computer's own naming (the review's
    // words: it is a commit it named, not "its work").
    if (pc.handed && pc.state !== 'paused') {
      const p = el(
        'p',
        'dv-muted',
        'The commit ' + pc.name + ' handed over is in branch ' + pc.handed + '.'
      );
      p.dataset.handed = '1';
      p.title =
        'Your current branch and your files were not touched. Look at it, merge it or delete it as you like.';
      add(now, p);
    }
    if (pc.keepsAsking)
      add(
        now,
        el(
          'p',
          'dv-muted',
          `A computer you answered Keep to keeps asking (${pc.keepsAsking} more).`
        )
      );
    if (pc.state !== 'paused')
      add(
        now,
        add(
          el('div', 'dv-opt'),
          el(
            'span',
            '',
            pc.name + ' sees what my agents ask, work on and answer, not only their names'
          ),
          toggle(pc.detail, 'Show ' + pc.name + ' what my agents ask, work on and answer', v => {
            if (!v || !quiet2()) act('setDetail', pc.id, v);
          })
        ),
        el('p', 'dv-muted', 'The first part of each finished answer is sent. It can quote files.')
      ); // these words are fixed
    if (pc.state !== 'paused') {
      // Off by default, and only while the switch above is on: nobody approves what they cannot
      // read.
      const may = toggle(
        pc.answer,
        'Let ' + pc.name + " answer my agents' permission questions",
        v => {
          if (!v || !quiet2()) act('setAnswer', pc.id, v);
        }
      ); // on: not while the rows above just moved (review 13, Low 9); off always works
      if (!pc.detail) {
        may.disabled = true;
        may.title = 'Needs the switch above: ' + pc.name + ' must see what it answers.';
      } else if (pc.control) {
        may.disabled = true;
        may.title = 'Included in full control, below.';
      }
      add(
        now,
        add(
          el('div', 'dv-opt'),
          el('span', '', pc.name + " may answer my agents' permission questions"),
          may
        ),
        el('p', 'dv-muted', 'It can allow commands on this computer while you are away.')
      );

      // The one full-control switch (6f, changes 9 and 17). Off by
      // default and only while the first switch is on. Turning it on asks once, with that
      // computer's id; turning it off is one press.
      const full = toggle(pc.control, 'Give ' + pc.name + ' full control of my agents', v =>
        v ? ask('control', { currentTarget: full }, pc) : act('setControl', pc.id, false)
      );
      if (!pc.detail) {
        full.disabled = true;
        full.title = 'Needs the first switch: ' + pc.name + ' must see what it controls.';
      }
      add(
        now,
        add(
          el('div', 'dv-opt'),
          el(
            'span',
            '',
            pc.name +
              ' has full control of my agents: it may send them prompts and interrupt, stop and start them'
          ),
          full
        ),
        el('p', 'dv-muted', FULL_SAYS),
        el('p', 'dv-muted', WATCH_SAYS),
        el('p', 'dv-muted', PICK_SAYS),
        el('p', 'dv-muted', SAY_SAYS(pc.name)),
        el('p', 'dv-muted', SYNC_SAYS)
      );

      // The git hand-over: a switch from before its sentence does not include it.
      if (pc.control && pc.syncable === false) {
        const p = el(
          'p',
          'dv-muted',
          pc.name + ' cannot hand over commits yet: turn full control off and on again to allow it.'
        );
        p.dataset.nosync = '1';
        add(now, p);
      }

      // Agents messaging agents: a switch from before that sentence does not include it.
      if (pc.control && pc.talkable === false) {
        const p = el(
          'p',
          'dv-muted',
          'Agents on ' +
            pc.name +
            ' cannot message agents here yet: turn full control off and on again to allow it.'
        );
        p.dataset.nosay = '1';
        add(now, p);
      }

      // A switch that was turned on before the sentence above existed keeps its prompts and gives
      // no view until it is turned on again.
      if (pc.control && pc.watchable === false) {
        const p = el(
          'p',
          'dv-muted',
          pc.name + ' cannot watch yet: turn full control off and on again to allow it.'
        );
        p.dataset.nowatch = '1';
        add(now, p);
      }

      // The same for picking an option: a switch from before that sentence does not include it.
      if (pc.control && pc.pickable === false) {
        const p = el(
          'p',
          'dv-muted',
          pc.name + ' cannot pick options yet: turn full control off and on again to allow it.'
        );
        p.dataset.nopick = '1';
        add(now, p);
      }

      // Someone is watching right now: said here too, with a way to end it (the mark on the panel's
      // header is the other one).
      const eye = (Array.isArray(st.watching) ? st.watching : []).find(x => x && x.peer === pc.id);
      if (eye) {
        const row = add(
          el('div', 'dv-owed'),
          el(
            'span',
            '',
            pc.name +
              ' is watching ' +
              (eye.agent || 'an agent') +
              ' since ' +
              clock(eye.since) +
              '.'
          ),
          btn('End it', '', () => {
            call('stopView', pc.id).catch(() => {});
          })
        );
        row.dataset.watching = '1';
        add(now, row);
      }
      if (pc.commands) {
        const p = el('p', '', pc.name + ' can run commands on this computer.');
        p.dataset.commands = '1';
        add(now, p);
      }
    }
    const acts = el('div', 'dv-acts');
    if (pc.state === 'live' && (pc.canStart || []).some(c => CLI_NAME[c])) {
      const b = btn('New agent', '', e => ask('start', e, pc));
      b.disabled = !pc.session || quiet2();
      b.setAttribute('aria-label', 'New agent on ' + pc.name);
      add(acts, b);
    }

    // The git hand-over, where the card says how far apart the two copies are. "Bring … here": this
    // computer fetches (its own press, no right needed). "Hand my commits to …": only for a
    // computer that says it takes one from this computer.
    const rel = pc.state === 'live' && pc.project ? pc.project.rel : '';
    if (pc.bringable && (rel === 'ahead' || rel === 'apart' || rel === 'missing')) {
      const b = btn('Bring ' + pc.name + "'s work here", '', () => {
        act('bring', pc.id).then(v => {
          if (v && v.sent === 'not_sent')
            window.toast?.(
              'Nothing was fetched: ' +
                pc.name +
                "'s commit is not known now, or a fetch is already running."
            );
        });
      });
      b.disabled = !pc.session || quiet2() || pc.brought?.state === 'going';
      b.title =
        'Fetches ' +
        pc.name +
        "'s commit from this project's git remote into its own branch here. Your current branch and your files are not touched.";
      b.dataset.bring = '1';
      add(acts, b);
    }
    if (pc.canSync && (rel === 'behind' || rel === 'apart')) {
      const b = btn('Hand my commits to ' + pc.name, '', () => {
        act('handOver', pc.id).then(v => {
          if (v && v.sent !== 'asked') window.toast?.('Nothing was sent to ' + pc.name + '.');
        });
      });
      b.disabled = !pc.session || quiet2();
      b.title =
        pc.name +
        " fetches this computer's commit from its own git remote into a branch named after this computer. Its current branch and its files are not touched.";
      b.dataset.handover = '1';
      add(acts, b);
    }
    if (pc.state === 'paused')
      add(
        acts,
        btn('Keep', '', () => act('choose', pc.id, 'keep')),
        btn('Forget', 'dv-danger', e => ask('forget-paused', e, pc))
      );
    else
      add(
        acts,
        btn('Forget', '', e => ask('forget', e, pc))
      );
    add(
      card,
      add(el('div', 'dv-stage'), character()),
      add(
        el('div'),
        add(el('div', 'dv-who'), el('h3', '', pc.name), el('small', '', shortId(pc.id))),
        add(el('div', 'dv-state'), dot(state[0]), el('span', '', state[1]))
      ),
      now,
      acts
    );
    return card;
  }

  function otherCard(o) {
    const card = el('article', 'dv-surf dv-pc dv-ask dv-asleep');
    card.dataset.pc = o.id;

    // Through an own relay the relay knows ids only, so two unnamed computers read the same:
    // the id's start tells them apart.
    if (own?.set && (!o.name || o.name === 'Computer'))
      o = { ...o, name: 'Computer · ' + shortId(o.id) };

    // Where this computer was found: on the user's own relay no account is involved, so the
    // sentence must not speak of one.
    const foundOn = own?.set ? 'On your relay.' : 'Signed in to your account.';
    add(
      card,
      add(el('div', 'dv-stage'), character()),
      add(
        el('div'),
        add(el('div', 'dv-who'), el('h3', '', o.name), el('small', '', shortId(o.id))),
        add(el('div', 'dv-state'), dot('var(--pg-wait)'), el('span', '', 'Not paired'))
      ),
      add(
        el('div', 'dv-now'),
        el(
          'p',
          'dv-muted',
          foundOn +
            ' Pair it once by typing six digits on each computer. On ' +
            o.name +
            ', open Devices and choose Pair a computer first.'
        )
      ),
      add(
        el('div', 'dv-acts'),
        // On the user's own relay an unpaired computer that is not connected can be removed from
        // the list (an old computer, a test device), without a command.
        own?.set && !o.online ? btn('Remove', '', e => ask('relay-forget', e, o)) : null,
        btn('Pair', 'dv-pri', e => {
          opener = e.currentTarget;
          act('pair', o.id);
        })
      )
    );
    return card;
  }

  // Why Remove did not remove an unpaired computer from the user's own relay.
  const RELAY_FORGET_ERR = {
    online: 'It is connected to your relay right now. Close Technically Not on it first.',
    paired: 'It is paired with this computer. Use Forget on its card instead.',
    not_found: 'Your relay is older than this app. Deploy it again, then try once more.',
    failed: 'It could not be removed. Try again.',
  };
  const LOG = {
    paired: e => ['Paired with ' + e.name, 'Six digits typed on each'],
    forgot: e => ['Forgot ' + e.name],
    kept: e => ['Kept ' + e.name],
    saw: e => [e.name + ' saw that ' + (e.agent || 'an agent') + ' needs you'],
    asked: e => [(e.by || 'A computer') + ' asked to end the pairing with ' + e.name],
    they_kept: e => [e.name + ' kept its pairing'],
    they_forgot: e => [e.name + ' forgot it too'],
    answered: e => [
      e.name + ' answered ' + (e.agent || 'an agent') + ': ' + (SAID[e.say] || 'Deny'),
      e.text,
    ],
    answer_on: e => [e.name + ' may answer permission questions'],
    answer_off: e => [e.name + ' may no longer answer permission questions'],
    // "Bring (name)'s work here" ended with the commit in its branch:
    // where that branch came from.
    brought: e =>
      /^tnai\/handoff\/[a-z0-9]{8,12}$/.test(e.branch) && /^[0-9a-f]{7,10}$/.test(e.commit)
        ? ['Fetched ' + e.name + "'s commit " + e.commit + ' into branch ' + e.branch]
        : null,
    control_on: e => [e.name + ' has full control of my agents'],
    control_off: e => [e.name + ' no longer has full control of my agents'],
    on: () => ['Connected this computer'],
    off: () => ['Disconnected this computer'],
    stop: () => ['Stop on all computers started'],
    stopped: () => ['Stopped on all computers'],
  };

  function aside() {
    const a = el('aside', 'dv-aside');
    const log = el('ul', 'dv-log');
    for (const e of st.log.slice(0, 8)) {
      const t = LOG[e.kind]?.(e);
      if (t)
        add(
          log,
          add(
            el('li'),
            el('time', '', clock(e.at)),
            el('span', '', t[0]),
            t[1] ? el('small', '', t[1]) : null
          )
        );
    }
    if (!log.children.length)
      add(log, add(el('li'), el('time', '', ''), el('span', '', 'Nothing yet.')));
    add(a, add(el('section', 'dv-surf'), el('h2', '', 'Activity on this computer'), log));

    // What other computers made this computer's agents do: its own list, so many of them never push
    // a pairing line out of the one above. Shown only once there is something in it.
    if (st.controlTotal > 0) {
      const did = el('ul', 'dv-log'),
        sec = add(
          el('section', 'dv-surf dv-did'),
          el('h2', '', 'What other computers did here'),
          did
        );
      for (const e of (st.controlLog || []).slice(0, CTL_ROWS)) add(did, ctlItem(e));
      if (st.controlTotal > CTL_ROWS)
        add(
          sec,
          add(
            el('div', 'dv-acts'),
            btn('Show all ' + st.controlTotal.toLocaleString('en-US'), '', e => ask('ops', e))
          )
        );
      add(a, sec);
    }
    const sees = el('ul', 'dv-sees');
    for (const [never, text] of [
      [false, 'Which of your computers are connected, when, and from which internet address'],
      [false, 'Which computer sends to which, when, and roughly how large each message is'],
      [true, 'What agents ask, prompts, output, file names'],
    ])
      add(
        sees,
        add(
          el('li', never ? 'dv-no' : ''),
          el('b', '', never ? 'Never' : 'Sees'),
          el('span', '', text)
        )
      );

    // Through a relay the user runs themselves, nothing goes through a server of ours: the same
    // three lines are then true of their relay, and the heading says so.
    const seesTitle = own?.set ? 'What your relay can see' : 'What our server can see';
    add(a, add(el('section', 'dv-surf'), el('h2', '', seesTitle), sees));
    const stop = el('section', 'dv-surf dv-stop');
    for (const w of st.waiting) {
      const text =
        w.kind === 'stop'
          ? `Waiting for ${w.toName} to confirm the stop.`
          : w.status === 'paused'
            ? `${w.toName} was asked to forget ${w.aboutName || 'that computer'} and has not answered yet.`
            : `${w.toName} has not confirmed forgetting ${w.aboutName || 'that computer'} yet.`;
      add(
        stop,
        add(
          el('div', 'dv-owed'),
          el('span', '', text),
          w.kind === 'forget' ? btn('Stop waiting', '', () => act('dismiss', w.r)) : null
        )
      );
    }
    if (st.stopping)
      add(
        stop,
        el(
          'p',
          '',
          'Stopping. A computer that is off confirms when it is next on. Finish anyway ends it here now; that computer keeps a pairing that no longer works.'
        ),
        btn('Finish anyway', 'dv-danger', () => act('finishAnyway'))
      );
    else
      add(
        stop,
        el(
          'p',
          '',
          'Stop on all my computers: closes every connection and removes every pairing. Agents keep running where they are.'
        ),
        btn('Stop everywhere', 'dv-danger', e => ask('stop', e))
      );
    return add(a, stop);
  }

  function offState() {
    const off = el('section', 'dv-off dv-asleep');
    add(
      off,
      add(el('div', 'dv-pair'), character(), el('i'), character()),
      el('h2', '', 'Your computers are not connected')
    );
    if (!st.available)
      add(
        off,
        el(
          'p',
          '',
          'This computer has no secure place to keep the key, so connecting computers is not available on it.'
        )
      );
    else if (st.problem === 'unreadable')
      add(
        off,
        el(
          'p',
          '',
          'The saved keys on this computer cannot be read, so nothing is connected. They are left as they are.'
        )
      );
    else
      add(
        off,
        el(
          'p',
          '',
          'Connect them to see, on this computer, when an agent on another one needs you.'
        ),
        btn('Connect my computers', 'dv-pri', () => act('setOn', true).then(() => act('refresh')))
      );
    const facts = el('ul');
    for (const t of [
      'Encrypted on your computers. Our server cannot read it.',
      'While this is off, this computer makes no connection for it.',
      'You can stop it on every computer at once.',
    ])
      add(facts, el('li', '', t));
    return add(off, facts);
  }

  function render() {
    if (!root || !st) return;

    // Focus is put back on the same button of the same computer's card, never on a button with the
    // same label on another card.
    const at =
        document.activeElement && root.contains(document.activeElement)
          ? document.activeElement
          : null,
      label = b => b.getAttribute('aria-label') || b.textContent;
    const focused = at ? { text: label(at), pc: at.closest('[data-pc]')?.dataset.pc || '' } : null;
    const page = document.createDocumentFragment(),
      head = el('header', 'dv-head');
    add(
      head,
      add(el('div'), el('p', 'dv-eyebrow', 'TECHNICALLY NOT / DEVICES'), el('h1', '', 'Devices'))
    );
    if (st.on) {
      const kpi = (n, label, cls) =>
        add(el('div', cls), el('b', '', String(n)), el('span', '', label));
      const waiting = st.computers.reduce((n, pc) => n + pc.items.length, 0);
      add(
        head,
        add(
          el('div', 'dv-kpis'),
          kpi(st.computers.length + 1, st.computers.length ? 'computers' : 'computer'),
          kpi(
            (st.connection === 'online' ? 1 : 0) +
              st.computers.filter(pc => pc.state === 'live').length,
            'online'
          ),
          kpi(waiting, waiting === 1 ? 'needs you' : 'need you', waiting ? 'dv-wait' : '')
        ),
        add(
          el('label', 'dv-master'),
          el('span', '', 'Connected'),
          toggle(true, 'Connect my computers', () => act('setOn', false))
        )
      );
      const pcs = el('section', 'dv-pcs');
      pcs.setAttribute('aria-label', 'Computers');
      add(pcs, meCard(), ...st.computers.map(pcCard), ...st.others.map(otherCard));
      add(
        page,
        head,
        add(el('div', 'dv-cols'), pcs, aside()),
        el(
          'p',
          'dv-later',
          "Later, not here yet: phones, typing into another computer's terminal panels, projects across devices."
        )
      );
    } else add(page, head, offState());
    root.replaceChildren(page);
    if (focused)
      [...root.querySelectorAll('button, [role=button]')]
        .find(
          b =>
            label(b) === focused.text && (b.closest('[data-pc]')?.dataset.pc || '') === focused.pc
        )
        ?.focus({ preventScroll: true });
    dialog();
  }

  // ---- the live view: what the open Watch dialog shows ----
  // The main process hands the picture to this page on a channel of its own (`onView`), never in
  // the state. It is already checked there: rows of cleaned text and style runs of whole numbers.
  // This page draws it with text nodes only, one element a row, and a class from a fixed table for
  // each color: no markup from it, no link, no tip made from its words, no live region.
  let seen = null,
    watchUi = null;
  const ANSI = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'brightBlack',
    'brightRed',
    'brightGreen',
    'brightYellow',
    'brightBlue',
    'brightMagenta',
    'brightCyan',
    'brightWhite',
  ];
  const VIEW_END = {
    refused: n => 'Not taken by ' + n + '. Look at it on that computer.',
    busy: n => 'Another computer is watching ' + n + ' right now.',
    spent: n => "Today's 120 minutes of watching " + n + ' are used up.',
    no_reply: n => 'No reply from ' + n + '.',
    timeout: () => 'Ended after 10 minutes without Keep watching.',
    off: n => n + ' no longer lets this computer watch.',
    gone: (n, a) => a + ' ended, was restarted or changed on ' + n + '.',
    stopped: n =>
      'Ended on ' + n + ' by its user. It takes no new view from this computer for 10 minutes.',
    hidden: () => 'Stopped because this window was not in view.',
    offline: n => n + ' is no longer connected.',
    bad: n => n + ' sent pictures this computer could not read, so watching was ended.',
    flood: n => n + ' sent pictures faster than agreed, so watching was ended.',
    not_sent: n =>
      'Not asked: ' + n + ' is not connected or does not let this computer watch right now.',
    changed: (n, a) => a + ' changed or closed on ' + n + ' meanwhile, so nothing was asked.',
  };
  const isMark = ch => /\p{M}/u.test(ch);

  function drawScreen(box, pic) {
    if (!pic || !Array.isArray(pic.lines)) {
      if (box.firstChild) box.replaceChildren();
      return;
    }
    const rows = [];
    for (const line of pic.lines.slice(0, 100)) {
      const row = document.createElement('div'),
        cells = [];
      for (const ch of String(line?.t ?? '')) {
        if (isMark(ch) && cells.length) cells[cells.length - 1] += ch;
        else cells.push(ch);
      }
      let at = 0;
      for (const r of Array.isArray(line?.r) ? line.r : []) {
        if (
          !Array.isArray(r) ||
          !Number.isInteger(r[0]) ||
          !Number.isInteger(r[1]) ||
          r[0] < at ||
          r[1] < 1
        )
          continue;
        if (r[0] > at) row.append(document.createTextNode(cells.slice(at, r[0]).join('')));
        const part = document.createElement('span'),
          inverse = (r[4] & 2) === 2,
          sixteen = v => Number.isInteger(v) && v >= 0 && v <= 15,
          cls = [];
        const fg = inverse ? r[3] : r[2],
          bg = inverse ? r[2] : r[3];
        if (sixteen(fg)) cls.push('f' + fg);
        else if (inverse) cls.push('fd');
        if (sixteen(bg)) cls.push('g' + bg);
        else if (inverse) cls.push('gd');
        if ((r[4] & 1) === 1) cls.push('b');
        part.className = cls.join(' ');
        part.textContent = cells.slice(r[0], r[0] + r[1]).join('');
        row.append(part);
        at = r[0] + r[1];
      }
      if (at < cells.length) row.append(document.createTextNode(cells.slice(at).join('')));
      rows.push(row);
    }
    box.replaceChildren(...rows);
  }

  // Where a view stands, in this page's own words: m is the model the main process handed over (or
  // null), sent the word on a press that did not go out, n the computer's name and a the agent's.
  // Used by the Watch dialog here and by the Agents page (116).
  function viewWords(m, sent, n, a) {
    const pic = m?.picture || null,
      d = { sent };
    let words = '';
    if (!m) words = d.sent ? (VIEW_END[d.sent] || VIEW_END.not_sent)(n, a) : 'Asking ' + n + '…';
    else if (m.state === 'asked') words = 'Asking ' + n + '…';
    else if (m.state === 'on')
      words =
        'Live.' +
        (pic && Number.isFinite(pic.at) ? ' Last change ' + clock(pic.at) + '.' : '') +
        ' Ends at ' +
        clock(m.until) +
        ' unless you press Keep watching.' +
        (Number.isInteger(m.left)
          ? ' ' + m.left + (m.left === 1 ? ' minute' : ' minutes') + " of today's 120 are left."
          : '');
    else
      words =
        (VIEW_END[m.why] || (() => 'Watching ended.'))(n, a) +
        (pic ? ' This is the last picture, of ' + clock(pic.at) + '.' : '');
    if (pic && Number.isInteger(pic.cut) && pic.cut > 0)
      words +=
        ' The top ' +
        pic.cut +
        (pic.cut === 1 ? ' row' : ' rows') +
        ' did not fit and ' +
        (pic.cut === 1 ? 'is' : 'are') +
        ' left out.';
    if (pic && pic.incomplete === true)
      words += ' Some rows may be missing until the next full picture.';
    return words;
  }

  // The sixteen colors a picture may use are this app's own terminal colors, set on the box that
  // holds it.
  function screenColors(box) {
    const theme = window.TnaiTheme?.xterm?.() || {};
    ANSI.forEach((k, i) => {
      if (typeof theme[k] === 'string' && /^#[0-9a-f]{3,8}$/i.test(theme[k]))
        box.style.setProperty('--dv-c' + i, theme[k]);
    });
  }

  function paintWatch() {
    const ui = watchUi,
      d = local;
    if (!ui || d?.kind !== 'watch') return;
    const m = seen && seen.peer === d.pc.id && seen.agent === d.ag.id ? seen : null,
      n = d.pc.name,
      a = d.ag.name,
      pic = m?.picture || null;
    if (m) d.live = true;
    const words = viewWords(m, d.sent, n, a);
    const ended = (!!m && m.state === 'ended') || (!m && !!d.sent);
    ui.status.textContent = words;
    ui.status.classList.toggle('dv-warn', ended);
    ui.keep.disabled = !(m && m.state === 'on');
    ui.screen.dataset.state = ended ? 'ended' : m && m.state === 'on' ? 'on' : 'asked';
    drawScreen(ui.screen, pic);
  }

  // Watch pressed on an agent's row: the dialog opens at once and says where it stands; the picture
  // follows on `onView`.
  function watch(e, pc, ag) {
    if (!still(pc, ag)) {
      window.toast?.(CHANGED(pc, ag));
      return;
    }
    seen = null;
    ask('watch', e, pc, ag);
    const mine = local;
    call('view', pc.id, ag.id, ag.mark || '')
      .then(r => {
        if (local === mine && r && r.sent !== 'asked') {
          mine.sent = r.sent || 'not_sent';
          paintWatch();
        }
      })
      .catch(() => {
        if (local === mine) {
          mine.sent = 'not_sent';
          paintWatch();
        }
      });
  }

  // This computer ends its view: 'closed' when the dialog goes (nothing of it stays), 'hidden' when
  // the window is no longer in view (the last picture stays, with its time, for when the user is
  // back).
  function endWatch(why) {
    call('unview', why).catch(() => {});
    if (why === 'closed') {
      seen = null;
      watchUi = null;
    }
  }
  native.onView?.(m => {
    seen = m && typeof m === 'object' ? m : null;
    if (local?.kind !== 'watch') return;

    // Nothing of the view stays (that computer was paused or forgotten, or connecting went off
    // here): the dialog goes with it.
    if (!seen && local.live) {
      const name = local.pc.name;
      local = null;
      watchUi = null;
      dialog();
      window.toast?.(
        'Watching ' + name + ' was closed: it is no longer connected to this computer.'
      );
      return;
    }
    paintWatch();
  });

  // A view exists only while a person looks at it: a hidden or minimized window ends it. Losing the
  // keyboard focus does not.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && local?.kind === 'watch' && seen && seen.state !== 'ended')
      endWatch('hidden');
  });

  // ---- dialogs: pairing, rename, confirmations ----
  const ENDED = {
    offline: n =>
      `${n} is not waiting to be paired. On it, open Devices and choose Pair a computer, then press Pair here again.`,
    locked: () => 'Three wrong codes. Pairing with that computer is stopped for ten minutes.',
    expired: () => 'Pairing took longer than two minutes, so it was stopped. Nothing was paired.',
  };

  function ask(kind, e, pc, ag) {
    opener = e?.currentTarget || null;
    local = { kind, pc, ag };
    note = '';
    dialog();
  }

  function close() {
    // a dialog of this computer's own (rename, forget, stop) was the one closed: a request waiting
    // behind it is not answered by that
    const own = local;
    if (own?.kind === 'watch') endWatch('closed');
    local = null;
    step2 = false;
    note = '';
    if (st?.pairing) act('cancelPairing');
    else if (st?.asked) {
      if (!own) act('declinePairing');
    } else if (st?.ended) act('clearEnded');
    dialog();
  }

  function digitsShown(code) {
    const box = el('div', 'dv-code');
    box.setAttribute('aria-label', 'Pairing code ' + [...code].join(' '));
    for (const d of code) add(box, el('span', '', d));
    return box;
  }

  function digitsInput(onFull) {
    const box = el('div', 'dv-code');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Six digits shown on the other computer');
    for (let i = 0; i < 6; i++) {
      const inp = el('input');
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Digit ' + (i + 1));
      add(box, inp);
    }
    const all = [...box.children],
      value = () => all.map(x => x.value).join('');
    box.oninput = e => {
      e.target.value = e.target.value.replace(/\D/g, '');
      if (e.target.value) e.target.nextElementSibling?.focus();
      onFull(value().length === 6 ? value() : '');
    };
    box.onkeydown = e => {
      if (e.key === 'Backspace' && !e.target.value) e.target.previousElementSibling?.focus();
    };
    box.onpaste = e => {
      const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!t) return;
      e.preventDefault();
      all.forEach((x, i) => {
        x.value = t[i] || '';
      });
      onFull(t.length === 6 ? t : '');
    };
    return box;
  }

  function typed(code) {
    call('enterCode', code)
      .then(r => {
        note = r.ok
          ? ''
          : r.left != null
            ? `Those digits are not the ones shown. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`
            : '';
        dlgKey = '';
        act('state');
      })
      .catch(() => {});
  }

  function content() {
    const p = st?.pairing,
      done = st?.ended,
      box = el('div', 'dv-dlg'),
      acts = el('div', 'dv-acts');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'dvDlgTitle');
    const title = el('h2', '', '');
    title.id = 'dvDlgTitle';
    add(box, title);
    if (local?.kind === 'rename') {
      title.textContent = 'Rename this computer';
      const inp = el('input', 'dv-name');
      inp.value = st.self.name;
      inp.maxLength = 60;
      inp.setAttribute('aria-label', 'Name of this computer');
      const save = () => {
        const v = inp.value.trim();
        local = null;
        if (v) act('setName', v);
        dialog();
      };
      inp.onkeydown = e => {
        if (e.key === 'Enter') save();
      };
      add(
        box,
        el(
          'p',
          '',
          'Your other computers show this name. They take it the next time they connect.'
        ),
        inp,
        add(acts, btn('Cancel', '', close), btn('Rename', 'dv-pri', save))
      );
    } else if (local?.kind === 'relay') {
      title.textContent = 'Use my own relay';
      const url = el('input', 'dv-name'),
        secret = el('input', 'dv-name'),
        err = el('p', 'dv-hint dv-warn', '');
      url.value = own?.set ? own.url || '' : '';
      url.placeholder = 'https://my-relay.example.workers.dev';
      url.autocomplete = 'off';
      url.spellcheck = false;
      url.setAttribute('aria-label', 'Relay address');
      secret.type = 'password';
      secret.autocomplete = 'off';
      secret.setAttribute('aria-label', 'Relay secret');
      secret.placeholder = 'Relay secret';
      err.setAttribute('role', 'alert');
      const save = () => {
        err.textContent = '';
        relayDo('setOwnRelay', [url.value.trim(), secret.value.trim()], t => {
          err.textContent = t;
        });
      };
      for (const i of [url, secret])
        i.onkeydown = e => {
          if (e.key === 'Enter') save();
        };
      add(
        box,
        el(
          'p',
          '',
          'Enter the address and the secret of a relay you deployed yourself. Enter the same two on each computer, then pair with six digits.'
        ),
        url,
        secret,
        err,
        add(acts, btn('Cancel', '', close), btn('Save', 'dv-pri', save))
      );
    } else if (local?.kind === 'relay-remove') {
      title.textContent = 'Remove your own relay?';
      const err = el('p', 'dv-hint dv-warn', '');
      err.setAttribute('role', 'alert');
      add(
        box,
        el('p', '', 'Pairings made through this relay stop working.'),
        err,
        add(
          acts,
          btn('Cancel', 'dv-pri', close),
          btn('Remove', 'dv-danger', () =>
            relayDo('clearOwnRelay', [], t => {
              err.textContent = t;
            })
          )
        )
      );
    } else if (local?.kind === 'relay-confirm') {
      // Asked by the main process before anything changed: the same question and buttons as
      // "Remove your own relay?".
      const { name, args, count } = local;
      const saving = name === 'setOwnRelay';
      title.textContent = saving ? 'Switch to your own relay?' : 'Remove your own relay?';
      const err = el('p', 'dv-hint dv-warn', '');
      err.setAttribute('role', 'alert');
      const many = count === 1 ? '1 pairing' : count + ' pairings';
      const through = saving ? 'your Technically Not account' : 'your own relay';
      add(
        box,
        el('p', '', `This removes your ${many} made through ${through}. Pair again afterwards.`),
        err,
        add(
          acts,
          btn('Cancel', 'dv-pri', close),
          btn('Remove', 'dv-danger', () =>
            relayDo(name, [...args, true], t => {
              err.textContent = t;
            })
          )
        )
      );
    } else if (local?.kind === 'forget') {
      const pc = local.pc;
      title.textContent = 'Forget ' + pc.name + '?';
      add(
        box,
        el(
          'p',
          '',
          `Its key is deleted here at once, and your other paired computers are asked to forget it too. ${pc.name} (${shortId(pc.id)}) can be paired again later.`
        ),
        add(
          acts,
          btn('Cancel', '', close),
          btn('Forget', 'dv-danger', () => {
            local = null;
            act('forget', pc.id);
            dialog();
          })
        )
      );
    } else if (local?.kind === 'relay-forget') {
      // An unpaired computer on the user's own relay (an old computer, a test device): its record
      // on the relay is removed. Nothing here or on it is paired, so nothing else changes.
      const pc = local.pc;
      title.textContent = 'Remove ' + pc.name + ' from your relay?';
      const err = el('p', 'dv-hint dv-warn', '');
      err.setAttribute('role', 'alert');
      const remove = async () => {
        err.textContent = '';
        let r;
        try {
          r = await native.forgetRelayDevice(pc.id);
        } catch {
          r = { ok: false };
        }
        if (!r || r.ok === false) {
          err.textContent = RELAY_FORGET_ERR[r?.error] || RELAY_FORGET_ERR.failed;
          return;
        }
        local = null;
        if (r.state && r.state.self) apply(r.state);
        dialog();
      };
      add(
        box,
        el(
          'p',
          '',
          `It is not paired with this computer and is no longer listed here. If it connects to your relay again, it shows up again.`
        ),
        err,
        add(acts, btn('Cancel', 'dv-pri', close), btn('Remove', 'dv-danger', remove))
      );
    } else if (local?.kind === 'forget-paused') {
      const pc = local.pc;
      title.textContent = 'Forget ' + pc.name + '?';
      add(
        box,
        el(
          'p',
          '',
          `You are forgetting ${pc.name}, id ${shortId(pc.id)}. Its key is deleted here and it can no longer connect to this computer. Check the id: another computer can carry the same name.`
        ),
        add(
          acts,
          btn('Cancel', 'dv-pri', close),
          btn('Forget ' + shortId(pc.id), 'dv-danger', () => {
            local = null;
            act('choose', pc.id, 'forget');
            dialog();
          })
        )
      );
    } else if (local?.kind === 'stop') {
      title.textContent = 'Stop on all my computers?';
      add(
        box,
        el(
          'p',
          '',
          'Every connection is closed and every pairing is removed, here and on each computer that confirms. Agents keep running where they are. Pair again afterwards to reconnect.'
        ),
        add(
          acts,
          btn('Cancel', '', close),
          btn('Stop everywhere', 'dv-danger', () => {
            local = null;
            act('stopEverywhere');
            dialog();
          })
        )
      );
    } else if (local?.kind === 'control') {
      // Turning full control on. Cancel has the focus, and the id is named: another computer can
      // carry the same name.
      const pc = local.pc;
      title.textContent = 'Give ' + pc.name + ' full control of your agents?';
      add(
        box,
        el('p', '', FULL_SAYS),
        el('p', '', WATCH_SAYS),
        el('p', '', PICK_SAYS),
        el('p', '', SAY_SAYS(pc.name)),
        el('p', '', SYNC_SAYS),
        el(
          'p',
          'dv-hint',
          `This is ${pc.name}, id ${shortId(pc.id)}. Turn it on only for a computer that is yours and in your hands. You can turn it off here at any time.`
        ),
        add(
          acts,
          btn('Cancel', 'dv-pri', close),
          btn('Give full control', 'dv-danger', () => {
            local = null;
            act('setControl', pc.id, true, 'choose say sync');
            dialog();
          })
        )

        // 'choose say sync': this question showed the sentences about picking an option, about
        // agents messaging agents and about the git hand-over, so the grant names all three (agents
        // messaging agents is switched off in the main process)
      );
    } else if (local?.kind === 'stop-agent') {
      const { pc, ag } = local,
        warn = el('p', 'dv-hint dv-warn', '');
      title.textContent = 'Stop ' + ag.name + ' on ' + pc.name + '?';
      add(
        box,
        el(
          'p',
          '',
          `Its process ends on ${pc.name} and its terminal panel stays there, as with the stop button on that computer. Work it has not finished stays as it is.`
        ),
        warn,
        add(
          acts,
          btn('Cancel', '', close),
          btn('Stop', 'dv-danger', e => {
            if (!still(pc, ag)) {
              warn.textContent = CHANGED(pc, ag);
              warn.hidden = false;
              e.currentTarget.disabled = true;
              return;
            }
            local = null;
            sendAct(pc, ag, 'stop');
            dialog();
          })
        )
      );
      warn.hidden = true;
    } else if (local?.kind === 'prompt' || local?.kind === 'start') {
      // A prompt for an agent on another computer, or a new agent there with an optional first
      // prompt. Nothing is ever cut: a text that does not fit one message is not sent, and the room
      // left is asked from the main process, which counts it as it will be sent.
      const { pc, ag } = local,
        isStart = local.kind === 'start',
        clis = isStart ? (pcNow(pc.id)?.canStart || []).filter(c => CLI_NAME[c]) : [];
      title.textContent = isStart
        ? 'New agent on ' + pc.name
        : 'Send a prompt to ' + ag.name + ' on ' + pc.name;
      const text = el('textarea', 'dv-name dv-text');
      text.rows = 5;
      text.value = local.text || '';
      text.setAttribute(
        'aria-label',
        isStart ? 'First prompt, if you want one' : 'Prompt for ' + ag.name
      );
      const hint = el('p', 'dv-hint', ''),
        go = btn(isStart ? 'Start' : 'Send', 'dv-pri', () => send());
      const base = isStart
        ? 'A first prompt is optional. It starts with a word.'
        : `It arrives as your own prompt in its terminal panel on ${pc.name}. It starts with a word.`;
      const say = (t, warn) => {
        hint.textContent = t;
        hint.classList.toggle('dv-warn', !!warn);
      };
      const NOT = {
        no_word: 'Start the prompt with a letter or a number.',
        too_long: 'Too long for one message. Nothing is cut: shorten it.',
        no_project:
          'A new agent is started for the project open on this computer, and that needs a git project open here.',
        changed: isStart ? '' : CHANGED(pc, ag) + ' Close this and press Prompt on its row again.',
        not_sent: isStart
          ? `Not sent: ${pc.name} is not connected or does not start agents for this computer right now.`
          : `Not sent: ${pc.name} is not connected, or ${ag?.name} changed or closed there.`,
      };
      const room = () => {
        const v = text.value;
        local.text = v;
        go.disabled = isStart ? !clis.length : !v.trim();
        if (!v.trim()) return say(base);
        call('room', isStart ? '' : ag.id, v)
          .then(n => {
            if (local?.text !== v || !hint.isConnected || !Number.isFinite(n)) return;
            if (n < 0) {
              go.disabled = true;
              say(
                'Too long by about ' +
                  (-n).toLocaleString('en-US') +
                  ' characters. Nothing is cut: shorten it.',
                true
              );
            } else say(base + ' Room for about ' + n.toLocaleString('en-US') + ' more characters.');
          })
          .catch(() => {});
      };

      function send() {
        if (go.disabled) return;
        if (!isStart && !still(pc, ag)) return say(NOT.changed, true);
        go.disabled = true;
        (isStart
          ? call('start', pc.id, local.cli, text.value)
          : call('prompt', pc.id, ag.id, text.value, ag.mark || '')
        )
          .then(v => {
            if (v && v.self) apply(v);
            if (local?.pc !== pc || local.ag !== ag) return; // closed meanwhile
            if (v?.sent === 'asked') {
              local = null;
              dialog();
              return;
            }
            say(NOT[v?.sent] || NOT.not_sent, true);
            go.disabled = false;
          })
          .catch(() => {
            if (local?.pc === pc && local.ag === ag) {
              say(NOT.not_sent, true);
              go.disabled = false;
            }
          });
      }
      text.oninput = room;
      text.onkeydown = e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send();
        }
      };
      if (isStart) {
        // Which CLI: only the ones that computer says it can start now. It decides the model; the
        // agent asks before it runs commands.
        local.cli = clis.includes(local.cli) ? local.cli : clis[0] || '';
        const pick = el('div', 'dv-pick');
        pick.setAttribute('role', 'radiogroup');
        pick.setAttribute('aria-label', 'Which agent');
        for (const c of clis) {
          const b = btn(CLI_NAME[c], '', () => {
            local.cli = c;
            for (const x of pick.children) x.setAttribute('aria-checked', String(x === b));
          });
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(c === local.cli));
          add(pick, b);
        }
        add(
          box,
          el(
            'p',
            '',
            `It starts in this project on ${pc.name}, which must have the same project open, and it asks before it runs commands there.`
          ),
          pick
        );
      }
      add(box, text, hint, add(acts, btn('Cancel', '', close), go));
      room();
    } else if (local?.kind === 'watch') {
      // The live view: a picture of an agent's terminal panel on another computer. Plain text rows
      // drawn by this page; nothing in it can be pressed, and questions it shows are answered with
      // the buttons on the card.
      const { pc, ag } = local;
      title.textContent = 'Watching ' + ag.name + ' on ' + pc.name;
      box.classList.add('dv-wide');
      const screen = el('div', 'dv-name dv-text dv-screen');
      screen.tabIndex = 0;
      screen.setAttribute(
        'aria-label',
        'The screen of ' + ag.name + ' on ' + pc.name + ', as text'
      );
      screenColors(screen);
      const status = el('p', 'dv-hint', ''),
        keep = btn('Keep watching', '', () => {
          call('keepView')
            .then(ok => {
              if (ok === false) window.toast?.('Keep watching can be pressed once a minute.');
            })
            .catch(() => {});
        });
      add(
        box,
        el(
          'p',
          '',
          `A picture of ${ag.name}'s terminal panel on ${pc.name}. Answer its questions with the buttons on its card.`
        ),
        screen,
        status,
        add(acts, keep, btn('Close', 'dv-pri', close))
      );
      watchUi = { box, screen, status, keep };
      paintWatch();
    } else if (local?.kind === 'report') {
      // What an agent on another computer finished last: read-only, every
      // word as text, the answer's first part in the Prompt dialog's text box. It shows the result
      // as it was on the row when it was opened: a newer one that comes in meanwhile is on the row
      // and not mixed into this.
      const { pc, ag } = local,
        r = ag.last || {},
        more = Number.isInteger(r.more) && r.more > 0 ? r.more : 0,
        where = `${ag.name}'s terminal panel on ${pc.name}`;
      title.textContent = ag.name + ' on ' + pc.name + ': finished ' + clock(r.at);
      if (r.task) add(box, el('p', 'dv-hint', 'Task: ' + r.task));
      if (r.did) add(box, el('p', '', r.did));

      // The answer's first part is not in the pushed state: it is read
      // now, once, for this dialog. It is shown only when it belongs to the very result the row
      // showed when this was opened (`at` and `got`).
      const words = el(
        'p',
        'dv-hint',
        r.has ? 'Reading the answer…' : `The answer itself is in ${where}.`
      );
      if (r.has) {
        const text = el('textarea', 'dv-name dv-text');
        text.readOnly = true;
        text.rows = 4;
        text.setAttribute(
          'aria-label',
          (more ? 'The first part of the answer of ' : 'The answer of ') + ag.name
        );
        add(box, text);
        call('reportText', pc.id, ag.id)
          .then(a => {
            if (!a || typeof a.text !== 'string' || !a.text) {
              words.textContent = `The answer could not be read here. It is in ${where}.`;
              return;
            }
            if (a.at !== r.at || a.got !== r.got) {
              words.textContent = `${ag.name} finished another task meanwhile. Close this and open its newest result.`;
              return;
            }
            text.value = a.text;
            text.rows = Math.max(
              4,
              Math.min(
                12,
                a.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 52)), 0)
              )
            );
            words.textContent = more
              ? `This is the first part. ${more.toLocaleString('en-US')} more ${more === 1 ? 'character is' : 'characters are'} in the whole answer, in ${where}.`
              : `This is the whole answer, as ${pc.name} sent it.`;
          })
          .catch(() => {
            words.textContent = `The answer could not be read here. It is in ${where}.`;
          });
      }
      add(box, words, add(acts, btn('Close', 'dv-pri', close)));
    } else if (local?.kind === 'ops') {
      // Every line of what other computers did here (the page shows the newest few), read when the
      // dialog opens.
      title.textContent = 'What other computers did here';
      const all = el('ul', 'dv-log dv-all');
      all.tabIndex = 0;
      all.setAttribute('aria-label', 'Everything other computers did here, newest first');
      call('controlLog')
        .then(lines => {
          for (const e of Array.isArray(lines) ? lines : []) add(all, ctlItem(e));
        })
        .catch(() => {});
      add(box, all, add(acts, btn('Close', 'dv-pri', close)));
    } else if (p) {
      const other = p.name || 'the other computer';
      title.textContent = p.peer ? 'Pair with ' + other : 'Pair a computer';
      const cancel = btn('Cancel', '', close);
      if (p.role === 'a' && p.state === 'show' && !step2) {
        add(
          box,
          el('p', '', `Step 1 of 2. Type these six digits on ${other}.`),
          digitsShown(p.shows),
          el(
            'p',
            'dv-hint',
            `If ${other} refuses the digits, something is in between: cancel and try again.`
          ),
          add(
            acts,
            cancel,
            btn('Next', 'dv-pri', () => {
              step2 = true;
              dialog();
            })
          )
        );
      } else if (
        (p.role === 'a' && p.state === 'show') ||
        (p.role === 'b' && p.state === 'enter')
      ) {
        const go = btn('Pair', 'dv-pri', () => typed(go.dataset.code));
        go.disabled = true;
        add(
          box,
          el(
            'p',
            '',
            p.role === 'a'
              ? `Step 2 of 2. ${other} now shows six digits of its own. Type them here.`
              : `Step 1 of 2. ${other} shows six digits. Type them here.`
          ),
          digitsInput(code => {
            go.dataset.code = code;
            go.disabled = !code;
          }),
          note ? el('p', 'dv-hint dv-warn', note) : null,
          el(
            'p',
            'dv-hint',
            p.role === 'a'
              ? `No digits on ${other} means it did not accept. Cancel and try again.`
              : 'Only type digits you see on your own other computer.'
          ),
          add(acts, cancel, go)
        );
      } else if (p.role === 'b' && p.state === 'done') {
        add(
          box,
          el('p', '', `Step 2 of 2. Type these six digits on ${other}.`),
          digitsShown(p.shows),
          el('p', 'dv-hint', 'This closes by itself when the other computer has accepted them.'),
          add(acts, cancel)
        );
      } else if (st.connection === 'stopped' || st.connection === 'waiting') {
        // Pairing needs the connection: say why there is none instead of "waiting" for a computer
        // that cannot be reached.
        add(
          box,
          el(
            'p',
            '',
            st.connection === 'stopped'
              ? STOPPED[st.reason] || 'This computer cannot connect right now, so it cannot pair.'
              : STOPPED[st.reason] ||
                  'This computer is not connected right now. It tries again by itself.'
          ),
          el('p', 'dv-hint', 'Nothing was paired.'),
          add(acts, cancel)
        );
      } else {
        add(
          box,
          el(
            'p',
            '',
            p.role === 'b' && !p.peer
              ? `This computer is waiting to be paired. On your other computer, open Devices and press Pair next to ${st.self.name}.`
              : p.state === 'done'
                ? `Finishing with ${other}…`
                : `Waiting for ${other}…`
          ),
          el('p', 'dv-hint', 'Pairing stops by itself after two minutes.'),
          add(acts, cancel)
        );
      }
    } else if (st?.asked) {
      // Another computer of this account pressed Pair for this one.
      // Nothing was answered yet: Pair starts pairing here.
      const other = st.asked.name || 'Another computer';
      title.textContent = 'Pair with ' + other + '?';
      add(
        box,
        el(
          'p',
          '',
          `${other} (${shortId(st.asked.peer)}) asks to pair with this computer. Accept only if you pressed Pair on it yourself just now.`
        ),
        el(
          'p',
          'dv-hint',
          'Next you type six digits on each computer. Nothing is paired before that.'
        ),
        add(
          acts,
          btn('Not now', '', close),
          btn('Pair', 'dv-pri', () => {
            act('acceptPairing');
          })
        )
      );
    } else if (done && done.reason !== 'cancelled') {
      const other = done.name || 'the other computer';
      title.textContent = done.reason === 'paired' ? 'Paired with ' + other : 'Not paired';
      add(
        box,
        el(
          'p',
          '',
          done.reason === 'paired'
            ? `${other} now shows here when one of its agents needs you, and this computer shows there.`
            : (
                ENDED[done.reason] ||
                (() =>
                  'Pairing was stopped before it finished. Nothing was paired. You can try again.')
              )(other)
        ),
        add(acts, btn(done.reason === 'paired' ? 'Done' : 'Close', 'dv-pri', close))
      );
    } else return null;
    return box;
  }

  function dialog() {
    const p = st?.pairing,
      e = st?.ended;
    if (!p) step2 = false;
    const key = local
      ? 'local:' + local.kind + (local.pc?.id || '') + (local.ag ? ':' + local.ag.id : '')
      : p
        ? ['pair', p.role, p.state, p.shows, p.peer, step2, note].join('|')
        : st?.asked
          ? 'asked:' + st.asked.peer
          : e && e.reason !== 'cancelled'
            ? 'ended:' + e.reason + e.peer
            : '';
    if (key === dlgKey) return;
    dlgKey = key;
    const box = key ? content() : null;
    if (!box) {
      if (dlg) {
        dlg.remove();
        dlg = null;
        opener?.isConnected && opener.focus({ preventScroll: true });
        opener = null;
      }
      return;
    }
    if (!dlg) {
      dlg = el('div', 'dv-scrim');
      dlg.onkeydown = ev => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          close();
        }
      };
      document.body.append(dlg);
    }
    dlg.replaceChildren(box);

    // A request from another computer opens by itself: its focus is on "Not now", so a key pressed
    // for something else never accepts it.
    (key.startsWith('asked:')
      ? box.querySelector('button')
      : box.querySelector('input, textarea') ||
        box.querySelector('.dv-pri') ||
        box.querySelector('button')
    )?.focus({ preventScroll: true });
  }

  // A result that was taken back does not stay readable in an open dialog:
  // that computer's switch went off, its pairing was paused or forgotten, or connecting
  // was switched off here. Then the main process hands over no result of that computer any more. A
  // newer result of the same agent, or the computer merely going offline, leaves the dialog as it
  // is. While that computer has a session its agent's row says so (a row of another project is not
  // listed, so opening another project closes it too); without one there are no rows, and what it
  // left is still held as long as the computer names a finished task.
  const reportHeld = () => {
    const pc = st?.on ? pcNow(local.pc.id) : null;
    return (
      !!pc &&
      pc.state !== 'paused' &&
      (pc.session ? (pc.agents || []).some(a => a.id === local.ag.id && !!a.last) : !!pc.finished)
    );
  };

  function apply(next) {
    st = next;
    sawList(next);
    if (local?.kind === 'report' && !reportHeld()) {
      const name = local.pc.name;
      local = null;
      window.toast?.(name + ' no longer shares that result, so it was closed.');
    }
    render();
  }

  window.TnaiDevices = {
    // For the Agents page's rows of another computer's agents (116): the same drawing of a picture,
    // the same words, and the same protections for a press (not while the rows just moved; only for
    // the very agent that was shown).
    drawScreen,
    screenColors,
    viewWords,
    quiet: () => quiet2(),
    still,
    opWords: (pc, ag) => opLine(pc, ag)?.text || '',
    changedWords: CHANGED,
    clock,
    // what became of a new agent asked for there, in this page's words (116: a start from the
    // composer)
    startSaid: (state, name) => OP_SAID.start[state]?.(name) || '',
    // The router mounts the page into its container when Devices is opened…
    mount(container) {
      root = container;
      root.classList.add('dv-page');
      if (!unsub) unsub = native.on(apply) || (() => {});
      loadOwn();
      act('state').then(() => act('refresh'));
    },
    // …and tells it when the user leaves: pairing mode ends with the page.
    leave() {
      if (st?.pairing) act('cancelPairing');
      if (local?.kind === 'watch') endWatch('closed');
      local = null;
      dialog();
      if (unsub) {
        unsub();
        unsub = null;
      }
    },
    state: () => st,
  };

  // In the app: the page is a section of the layout, shown by the router's devices-mode (08) like
  // the Agents page (25). It is filled when opened and let go when left; the class watcher runs
  // only while the page is open. A request to pair that arrives while another page is shown: one
  // calm line. The answer is given in the dialog on Devices.
  let toldAsk = '';

  // The network came back (the browser's own event, pushed): the main process lets the link look
  // now instead of at the end of its wait. It does nothing when connecting is off, and at most once
  // in ten seconds (remote-link.js `wake`).
  window.addEventListener('online', () => {
    try {
      const r = native.woke?.();
      r?.catch?.(() => {});
    } catch {
      /* not this build */
    }
  });
  native.on(s => {
    const a = s?.asked?.peer || '';
    if (a && a !== toldAsk && !unsub)
      window.toast?.(
        (s.asked.name || 'Another computer') +
          ' asks to pair with this computer. Open Devices to answer.'
      );
    toldAsk = a;
  });

  // An agent on a paired computer needs you (phase 1 "See", second slice): one bell entry per
  // waiting item, on any page, gone the moment that computer reports it answered, stops being live
  // or the feature is switched off; and one Windows notice per new item when this window is not in
  // front (attention.notify, as for a local agent; main shows none while the window has focus).
  // Nothing here runs a timer: it follows the pushed state. The other computer's words go to the
  // bell as text (51 escapes them), and only when it sends them (its own switch). One computer
  // cannot fill the bell or the Windows notices: its first BELL_ROWS
  // waiting items are entries, the rest are counted in one, and it gets at most BELL_ROWS Windows
  // notices a minute. So an entry with buttons is not pushed around by a long list. An item that
  // computer lets this one answer has Allow once and Deny in its entry. Open Devices is always the
  // first button: the bell repaints an entry only when its words change, so a button must never
  // change its place under the same words.
  const waiting = new Set(),
    noticed = new Map(),
    pausedTold = new Set(),
    answersTold = new Set(),
    ctlTold = new Map(),
    repTold = new Map(),
    repGone = new Map(),
    BELL_ROWS = 8,
    // 16 item entries from all computers together: fewer than the bell holds, so none falls out and
    // comes back on top
    BELL_TOTAL = 16;
  const openDevices = { label: 'Open Devices', run: () => window.TnaiRoute?.('devices') };
  native.on(s => {
    const bell = window.TnaiNextActions,
      now = new Set(),
      paused = new Set(),
      on = !!s?.on,
      t = Date.now();
    let left = BELL_TOTAL;
    sawList(s);
    for (const pc of on ? s.computers || [] : []) {
      if (pc.state === 'paused') {
        // A pairing another computer asked to end shows nothing of that computer any more: say so
        // where the user is (audit app-2 #3).
        const a = (pc.asks || [])[0],
          key = 'remote-paused:' + pc.id;
        paused.add(key);
        const title = !a
          ? pc.name + ' is paused'
          : a.kind === 'stop'
            ? pc.name + ' is stopping on all computers and asks this one to forget it'
            : a.name + ' asks this computer to forget ' + pc.name;
        bell?.notify?.({
          key,
          source: pc.name,
          tag: 'Paused',
          k: 'blocked',
          title,
          text:
            'Until you choose Keep or Forget on Devices, nothing from ' +
            pc.name +
            ' is shown here and its agents cannot be answered from this computer.',
          action: openDevices,
        });
        if (!pausedTold.has(key)) {
          pausedTold.add(key);
          if (!unsub) window.toast?.(title + '. Open Devices to answer.');
        }
        continue;
      }
      if (pc.state !== 'live') continue;
      const items = pc.items || [],
        rows = Math.min(BELL_ROWS, left, items.length),
        more = items.length - rows;
      left -= rows;
      for (const it of items.slice(0, rows)) {
        const key = 'remote:' + pc.id + ':' + it.id,
          title = (it.agent || 'An agent') + ' on ' + pc.name + ' needs you',
          text = it.detail || 'It is waiting for an answer on ' + pc.name + '.';
        now.add(key);
        const press = say => ({
          label: SAID[say],
          primary: say === 'yes',
          run: () =>
            sendAnswer(pc, it, say).then(r =>
              window.toast?.(
                r === 'sent'
                  ? SAID[say] + ' sent to ' + pc.name + '.'
                  : r === 'moved'
                    ? 'The list had just changed, so nothing was sent. Look again, then press.'
                    : SAID[say] + ' was not sent to ' + pc.name + '. Open Devices to see why.'
              )
            ),
        });
        const actions =
          it.can && pc.session && !DONE.has(it.answer)
            ? [openDevices, press('no'), press('yes')]
            : [openDevices];
        bell?.notify?.({
          key,
          source: pc.name,
          tag: 'Needs you',
          k: 'blocked',
          title,
          text,
          actions,
        });
        if (waiting.has(key)) continue;
        waiting.add(key);
        const recent = (noticed.get(pc.id) || []).filter(x => t - x < 60000);
        if (recent.length < BELL_ROWS) {
          recent.push(t);
          Promise.resolve()
            .then(() => window.tnaiNative.attention?.notify?.({ paneId: null, title, body: text }))
            .catch(() => {});
        }
        noticed.set(pc.id, recent);
      }
      if (more > 0) {
        const key = 'remote-more:' + pc.id;

        /* its own kind of key: an item's id can be anything, "+more" included */ now.add(key);
        waiting.add(key);
        bell?.notify?.({
          key,
          source: pc.name,
          tag: 'Needs you',
          k: 'blocked',
          title: more + ' more on ' + pc.name + (more === 1 ? ' needs you' : ' need you'),
          text: 'Open Devices to see them all.',
          action: openDevices,
        });
      }
    }
    for (const key of [...waiting])
      if (!now.has(key)) {
        waiting.delete(key);
        bell?.unnotify?.(key);
      }
    for (const key of [...pausedTold])
      if (!paused.has(key)) {
        pausedTold.delete(key);
        bell?.unnotify?.(key);
      }
    for (const id of [...noticed.keys()])
      if (!on || !(s.computers || []).some(pc => pc.id === id)) noticed.delete(id);

    // On the computer that was answered: every answer another computer gave to one of this
    // computer's agents is a bell entry (it is in the activity log on Devices as well). It stays
    // until the user clears it.
    const given = on ? s.answers || [] : [];
    for (const a of given) {
      if (answersTold.has(a.key)) continue;
      answersTold.add(a.key);
      bell?.notify?.({
        key: 'remote-answered:' + a.key,
        source: a.name,
        tag: 'Answered',
        k: 'done',
        title: a.name + ' answered ' + (a.agent || 'an agent') + ': ' + (SAID[a.say] || 'Deny'),
        text: a.text || '',
        action: openDevices,
      });
    }
    for (const key of [...answersTold])
      if (!given.some(a => a.key === key)) answersTold.delete(key);

    // The same for full control: what another computer made this computer's agents do is ONE bell
    // entry per computer, changed in place as more is done (an entry
    // per minute would in time push everything else out of the bell). The whole record is the list
    // on Devices.
    const did = on ? s.controlled || [] : [],
      byPeer = new Map();
    for (const c of did) {
      const g = byPeer.get(c.peer) || { n: 0, first: c.at, last: null };
      g.n += c.n > 0 ? c.n : 1;
      g.first = Math.min(g.first, c.at);
      if (!g.last || c.until >= g.last.until) g.last = c;
      byPeer.set(c.peer, g);
    }

    // While a view runs, that computer's one entry says who watches which agent since when, on any
    // page; it goes back to the line above when the view ends ("What each side
    // shows").
    const eyes = new Map();
    for (const x of on && Array.isArray(s.watching) ? s.watching : [])
      if (x && typeof x.peer === 'string' && typeof x.name === 'string') eyes.set(x.peer, x);
    for (const [peer, x] of eyes) {
      const sig = 'w:' + x.since + ':' + x.agent;
      if (ctlTold.get(peer) === sig) continue;
      ctlTold.set(peer, sig);
      bell?.notify?.({
        key: 'remote-control:' + peer,
        source: x.name,
        tag: 'Full control',
        k: 'done',
        title: x.name + ' is watching ' + (x.agent || 'an agent') + ' since ' + clock(x.since),
        text: "It sees that terminal panel as text. End it on the panel's header or on Devices.",
        action: openDevices,
      });
    }
    for (const [peer, g] of byPeer) {
      if (eyes.has(peer)) continue;
      const line = CTL[g.last.op]?.(g.last),
        sig = g.n + ':' + g.last.key;
      if (!line || ctlTold.get(peer) === sig) continue;
      ctlTold.set(peer, sig);
      bell?.notify?.({
        key: 'remote-control:' + peer,
        source: g.last.name,
        tag: 'Full control',
        k: 'done',
        title:
          g.n > 1
            ? g.last.name +
              ' did ' +
              g.n +
              ' things with your agents since ' +
              clock(g.first) +
              '. Last: ' +
              line
            : line,
        text: ctlText(g.last),
        action: openDevices,
      });
    }
    for (const peer of [...ctlTold.keys()])
      if (!byPeer.has(peer) && !eyes.has(peer)) {
        if (String(ctlTold.get(peer)).startsWith('w:')) bell?.unnotify?.('remote-control:' + peer);
        ctlTold.delete(peer);
      }

    // The task an agent on a paired computer finished last: ONE entry per
    // computer, changed in place when another of its agents finishes, like the entry above. It
    // follows the project open here as the rows do: the main process hands over the one to show
    // (`finished`). It stays while that computer is offline, since a finished task stays finished,
    // and leaves when nothing is handed over any more: another project is open, that computer took
    // its results back, is paused or forgotten, or this is switched off.
    const ended = new Set();
    for (const pc of on ? s.computers || [] : []) {
      const f =
        pc.state !== 'paused' &&
        pc.finished &&
        typeof pc.finished === 'object' &&
        typeof pc.finished.key === 'string'
          ? pc.finished
          : null;
      if (!f) continue;
      ended.add(pc.id);
      if (repTold.get(pc.id) === f.key) continue;

      // What that computer sends decides the entry's words and how often they change, so after the
      // user removed the entry a new one for that computer waits a minute;
      // the result itself is on its row meanwhile. And two paired computers of one name
      // are told apart by the end of the id, as in the notice of an answer: a name is the other
      // computer's choice.
      if (t - (repGone.get(pc.id) || 0) < 60000) continue;
      const twin = (s.computers || []).filter(x => x.name === pc.name).length > 1,
        shown = twin ? pc.name + ' (…' + String(pc.id).slice(-4) + ')' : pc.name;
      repTold.set(pc.id, f.key);
      bell?.notify?.({
        key: 'remote-report:' + pc.id,
        source: shown,
        tag: 'Finished',
        k: 'done',
        title:
          (f.agent || 'An agent') +
          ' on ' +
          shown +
          ' finished' +
          (f.task ? ': ' + firstWords(f.task, 60) : ''),
        text: f.did || '',
        action: openDevices,
        onRemove: () => {
          repGone.set(pc.id, Date.now());
        },
      });
    }
    for (const id of [...repTold.keys()])
      if (!ended.has(id)) {
        repTold.delete(id);
        bell?.unnotify?.('remote-report:' + id);
      }
    for (const id of [...repGone.keys()])
      if (!on || !(s.computers || []).some(pc => pc.id === id)) repGone.delete(id);
  });

  const layout = document.querySelector('.layout');
  if (layout) {
    const page = el('section', 'dv-page');
    page.id = 'devicesPage';
    page.setAttribute('aria-label', 'Devices');
    layout.append(page);
    const watch = new MutationObserver(() => {
      if (!layout.classList.contains('devices-mode')) {
        watch.disconnect();
        window.TnaiDevices.leave();
      }
    });
    window.addEventListener('tnai:devices-page-shown', () => {
      window.TnaiDevices.mount(page);
      watch.observe(layout, { attributes: true, attributeFilter: ['class'] });
    });
  }
})();
