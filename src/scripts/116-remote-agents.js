// Technically Not · remote-agents — Desktop only: another computer's agents, and the detail of one.
// The agents are those of each paired computer that is live and known to work in the project open
// here (`sure` on a row, made by desktop/remote-service.js); the thread list (119) shows them as a
// group per computer and reads them through `shown`. Selecting one shows a detail with what is
// really known (name, CLI, computer, status, task, last finished answer) and asks ONCE for the
// live view of that agent's terminal panel when that computer lets this one watch; the picture is
// drawn into the terminal box by 111's drawScreen (text nodes only). The view ends when another
// agent is selected, the page is left or the window is hidden. Buttons only where an operation
// exists: Send composer tasks here and Follow up (a remote prompt), Interrupt and Stop (act);
// every press carries the row's mark and waits out 111's quiet time. The composer (11) asks
// `target()` and `send()` here. No message kind of its own: the pushed state, view / keep /
// unview, prompt, act.
//
// Where the detail stands: in the thread's main area, in the box 138 hands over with `mount`
// (look: 40-thread-history.css). The old Agents and history page (and its script 25) was deleted
// on 2026-10-13: the thread's main area is the only place the detail stands. `page`, `detail` and
// `list` below are what is left of that page; they find nothing now and are removed as their own
// step (CLAUDE.md, "There is no old view").
//
// window.TnaiRemoteAgents (list, shown, select, pick, selected, lost, mount, paint, target, send,
// leave). Hooks: 138 (mount), 119 (shown, notShown), 11 (target, send, start, progress), 46
// (starts, chooseStart).
// Tests: thread-remote, remote-agents.
(() => {
  const native = window.tnaiNative?.remote,
    page = document.getElementById('agentsPage'),
    layout = document.querySelector('.layout');

  // browser, or a build without the feature: nothing of another computer is shown
  if (!native?.on || !native.view || !layout) return;

  // The old Agents and history page's main area, while that page is still in the app. Nothing
  // here needs it.
  const detail = page?.querySelector('.ap-detail') || null;

  // The box in the thread's main area that 138 handed over, while the detail is shown there.
  let threadHost = null;
  const inThread = () =>
    !!threadHost && threadHost.isConnected && !!window.TnaiThreads?.visible?.();

  // 111: the drawing of a picture, the words for a view and for an operation, the quiet time
  const D = () => window.TnaiDevices || {};

  // a computer id and a row id are single lines, so a line break never occurs in either
  const SEP = '\n';
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const setText = (n, value) => {
    if (n.textContent !== value) n.textContent = value;
  };
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);
  const call = async (name, ...args) => {
    const r = await native[name](...args);
    if (r && r.ok === false) throw r.error || {};
    return r && typeof r === 'object' && 'value' in r ? r.value : r;
  };
  const clock = t =>
    D().clock
      ? D().clock(t)
      : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const setAvatar = (n, agent) => {
    // as 25 draws a row's CLI mark
    const cli = (agent || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (n.hasAttribute('data-cli') && n.dataset.cli === cli) return;
    const mark = window.TnaiCliIcons?.svg?.(agent) || '';
    n.dataset.cli = cli;
    n.classList.toggle('has-ico', !!mark);
    n.title = agent || '';
    if (mark) n.innerHTML = mark;
    else n.textContent = (agent || '?').trim().charAt(0).toUpperCase();
  };

  // ---- what is known: the pushed state, nothing else ----
  let st = null,
    sel = '',
    target = '',
    targetAg = null,
    seen = null,
    viewing = false,
    sent = '',
    stopped = '';

  // { k, text, done }: the answer text of the shown agent's last result, read through reportText
  // (it is not in the state)
  let answer = null;

  // shownAg: the agent the detail was opened for (a row id can hold another one later). lost: the
  // selection was let go by a push, and the box says so until the user selects something. askTimer:
  // the one timer of this page, see askSoon.
  let shownAg = null,
    lost = null,
    askTimer = 0;
  const ASK_AFTER = 1000,
    ASKS_A_MINUTE = 4,
    asks = new Map(); // asks: computer id → when a view was asked there in the last minute

  // The computers whose agents are shown here: live, with a session, and only the rows whose
  // project is known to be the open one.
  const shownPcs = () =>
    (st?.on ? st.computers || [] : [])
      .filter(pc => pc && pc.state === 'live' && pc.session === true)
      .map(pc => ({
        pc,
        rows: (pc.agents || []).filter(
          a => a && a.sure === true && typeof a.id === 'string' && typeof a.name === 'string'
        ),
      }))
      .filter(x => x.rows.length);

  // Two paired computers of one name are told apart by the end of the id: a name is the other
  // computer's own choice.
  const pcName = pc =>
    (st?.computers || []).filter(x => x.name === pc.name).length > 1
      ? pc.name + ' (…' + String(pc.id).slice(-4) + ')'
      : pc.name;
  const find = key => {
    const [pcId, id] = String(key || '').split(SEP);
    for (const { pc, rows } of shownPcs())
      if (pc.id === pcId) {
        const ag = rows.find(a => a.id === id);
        if (ag) return { key, pc, ag };
      }
    return null;
  };
  const cur = () => (sel ? find(sel) : null);
  const WORD = {
    working: ['working', 'Working'],
    needs: ['waiting', 'Needs you'],
    idle: ['idle', 'Idle'],
  };

  // ---- the list: one group and its rows for each such computer, handed to 25 to put after its own
  // ----
  const groups = new Map(),
    rows = new Map();

  function rowEl(key) {
    let r = rows.get(key);
    if (r) return r;
    const b = el('button', 'ap-row ap-far-row');
    b.type = 'button';
    b.dataset.remote = key;
    b.setAttribute('role', 'option');
    b.innerHTML =
      '<span class="ap-avwrap"><span class="ap-av agent-avatar"></span><i class="ap-dot"></i></span><span class="ap-row-main"><span class="ap-row-top"><b></b></span><small></small></span><em></em>';
    r = {
      el: b,
      av: b.querySelector('.ap-av'),
      name: b.querySelector('b'),
      now: b.querySelector('small'),
      tag: b.querySelector('em'),
    };
    rows.set(key, r);
    return r;
  }

  function list(q) {
    const els = [],
      alive = new Set(),
      pcs = new Set();
    let shown = 0;
    for (const { pc, rows: ags } of shownPcs()) {
      let g = groups.get(pc.id);
      if (!g) {
        g = el('div', 'ap-group ap-far-group');
        g.innerHTML = '<span></span><small></small>';
        g.dataset.computer = pc.id;
        groups.set(pc.id, g);
      }
      const name = pcName(pc);
      pcs.add(pc.id);
      setText(g.firstChild, name);
      setText(
        g.lastChild,
        'on another computer · ' + ags.length + ' agent' + (ags.length === 1 ? '' : 's')
      );
      g.title =
        'These agents run on ' +
        name +
        ', in this project. What is shown here is what that computer reports.';
      let any = false;
      els.push(g);
      for (const ag of ags) {
        const key = pc.id + SEP + ag.id,
          r = rowEl(key),
          tone = WORD[ag.status] || WORD.idle,
          now = ag.task || tone[1];
        alive.add(key);
        const match =
          !q ||
          [ag.name, ag.cli, name, ag.task].some(v =>
            String(v || '')
              .toLowerCase()
              .includes(q)
          );
        r.el.hidden = !match;
        if (match) {
          any = true;
          shown++;
        }
        r.el.dataset.tone = tone[0];
        r.el.dataset.cli = (ag.cli || '').trim().toLowerCase().replace(/\s+/g, '-');
        setAvatar(r.av, ag.cli);
        setText(r.name, ag.name);
        if (r.name.title !== ag.name) r.name.title = ag.name;
        setText(r.now, now);
        if (r.now.title !== now) r.now.title = now;
        const isTarget = key === target;
        setText(r.tag, isTarget ? 'Composer' : 'on ' + name);
        r.tag.className = isTarget ? 'ap-composer' : '';
        r.el.classList.toggle('tnai-target', key === sel);
        r.el.setAttribute('aria-selected', String(key === sel));
        els.push(r.el);
      }
      g.hidden = !any;
    }
    for (const [key, r] of rows)
      if (!alive.has(key)) {
        r.el.remove();
        rows.delete(key);
      }
    for (const [id, g] of groups)
      if (!pcs.has(id)) {
        g.remove();
        groups.delete(id);
      }
    return { els, shown };
  }

  // ---- the live view of the selected agent's terminal panel ----
  const mayWatch = t => !!t && t.pc.canWatch === true && t.ag.can === true;

  // The question of that agent that takes "choose option N" (6i): an item its computer sent with
  // the option labels, this agent's row id and a binding. Only that computer decides to send them
  // (its full control with choosing named, an OpenCode question it knows).
  const askOf = t =>
    t
      ? (t.pc.items || []).find(
          i =>
            i &&
            i.row === t.ag.id &&
            Array.isArray(i.opts) &&
            i.opts.length > 0 &&
            typeof i.kof === 'string' &&
            i.kof
        ) || null
      : null;

  // Asked once for a selection, and again only by "Watch again": never by a repaint, a timer or the
  // window coming back.
  function askView() {
    askNot();
    const t = cur();
    if (!mayWatch(t)) return;

    // That computer takes four a minute and answers the fifth with silence: it is not asked, and
    // the box says why.
    const now = Date.now(),
      times = (asks.get(t.pc.id) || []).filter(x => now - x < 60000);
    if (times.length >= ASKS_A_MINUTE) {
      asks.set(t.pc.id, times);
      viewing = false;
      seen = null;
      sent = '';
      stopped = 'often';
      paint();
      return;
    }
    times.push(now);
    asks.set(t.pc.id, times);
    const key = sel;
    viewing = true;
    sent = '';
    stopped = '';
    seen = null;
    call('view', t.pc.id, t.ag.id, t.ag.mark || '')
      .then(r => {
        if (sel === key && r && r.sent !== 'asked') {
          viewing = false;
          sent = r.sent || 'not_sent';
          paint();
        }
      })
      .catch(() => {
        if (sel === key) {
          viewing = false;
          sent = 'not_sent';
          paint();
        }
      });
  }

  // A row that is only passed (the arrow keys, clicks on the way to another row) asks nothing: a
  // begun view costs a minute of the day's allowance and a line on the other computer.
  // Asked once the row has stayed selected for a second, with this
  // page in view. One timer, alive only while such a row waits.
  function askNot() {
    if (askTimer) {
      clearTimeout(askTimer);
      askTimer = 0;
    }
  }

  function askSoon() {
    askNot();
    if (!mayWatch(cur())) return;
    const key = sel;
    askTimer = setTimeout(() => {
      askTimer = 0;
      if (sel === key && onPage() && !document.hidden) askView();
      else paint();
    }, ASK_AFTER);
  }

  // 'closed': nothing of the picture stays (another row, the page left). 'hidden': the window went
  // out of view; the last picture stays.
  function endView(why) {
    if (!viewing) return;
    viewing = false;
    call('unview', why).catch(() => {});
    if (why === 'closed') seen = null;
  }
  native.onView?.(m => {
    const t = cur();
    if (!t) return;
    if (m && typeof m === 'object') {
      if (m.peer !== t.pc.id || m.agent !== t.ag.id || !onPage()) return;

      /* not while another page is shown: that view was opened by the Devices page's Watch dialog (111) for the agent still selected here, and is that dialog's to end */ seen =
        m;
      viewing = m.state !== 'ended';
      if (viewing) askNot();
    } // a view that runs for the selected agent is this page's to end
    else {
      if (!seen && !viewing) return;
      seen = null;
      viewing = false;
      stopped = 'gone';
    } // nothing of the view stays: that computer was paused, forgotten, or connecting went off here
    paint();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      askNot();
      if (viewing) endView('hidden');
    } else if (sel && onPage()) paint();
  });

  // The detail is in view: in the thread's main area on the Threads page. Leaving that page ends
  // the view; coming back does not start one.
  const onPage = () => inThread();

  // The detail is drawn again where it stands.
  function repaint() {
    if (threadHost) drawInThread();
  }

  function drawInThread() {
    if (lost) {
      paintLost();
      return;
    }
    if (!sel) {
      if (box) box.hidden = true;
      return;
    }
    ensure();
    paint();
  }

  function leave() {
    askNot();
    lost = null;
    if (viewing) {
      endView('closed');
      stopped = 'left';
    }
  }
  new MutationObserver(() => {
    if (!onPage()) leave();
  }).observe(layout, { attributes: true, attributeFilter: ['class'] });

  // ---- the selection ----
  function select(key) {
    key = key && find(key) ? key : '';
    if (key === sel && !lost) return;
    askNot();
    endView('closed');
    sel = key;
    lost = null;
    shownAg = null;
    seen = null;
    sent = '';
    stopped = '';
    if (sel) {
      const a = find(sel).ag;
      shownAg = { name: a.name, cli: a.cli, mark: a.mark || '' };
      askSoon();
    }
    repaint();
    tellList();
  }

  // The thread list (119) shows the same computers and rows as a group of its own, and marks the
  // selected one: it is told when either changed. It reads them through `shown` below.
  function tellList() {
    window.dispatchEvent(new CustomEvent('tnai:remote-agents-changed'));
  }

  // What is shown here, as plain values: one entry for each computer, with its rows of the open
  // project. An unknown status is read as idle, never as working.
  function shownForList() {
    return shownPcs().map(({ pc, rows: ags }) => ({
      id: pc.id,
      name: pcName(pc),
      agents: ags.map(ag => ({
        key: pc.id + SEP + ag.id,
        name: ag.name,
        cli: typeof ag.cli === 'string' ? ag.cli : '',
        status: Object.hasOwn(WORD, ag.status) ? ag.status : 'idle',
        task: typeof ag.task === 'string' ? ag.task : '',
        since: ag.since > 0 ? ag.since : 0,

        // when its last task finished, 0 when not known (the Board's Done today, 165)
        done:
          ag.last && typeof ag.last === 'object' && Number.isFinite(ag.last.at) && ag.last.at > 0
            ? ag.last.at
            : 0,
      })),
    }));
  }

  // The computers whose agents are NOT all in the list, and why: `elsewhere` work in another
  // project, `unsure` cannot be told to work in this one (no git project with a first commit open
  // on both, or that computer does not send which project). Counts only, for 119's one line.
  function notShownForList() {
    return (st?.on ? st.computers || [] : [])
      .filter(pc => pc && pc.state === 'live' && pc.session === true)
      .map(pc => ({
        id: pc.id,
        name: pcName(pc),
        elsewhere: Number.isInteger(pc.elsewhere) && pc.elsewhere > 0 ? pc.elsewhere : 0,
        unsure: (pc.agents || []).filter(a => a && a.sure !== true).length,
      }))
      .filter(x => x.elsewhere || x.unsure);
  }

  // A click on a row. Not while that computer's rows just moved: the row under the pointer may be
  // another agent's by now.
  function pick(key) {
    if (D().quiet?.()) return false;
    select(key);
    return true;
  }

  // A push took the selected agent away, or put another agent under its row id.
  // Its view ends, nothing of its picture stays, and the box keeps
  // one line and no button until the user selects something: this computer's own agent, with its
  // ready buttons, is never put under the pointer by another computer, and a focused button never
  // turns into a button for another agent.
  function reconcile() {
    if (!sel) return;
    const t = find(sel),
      a = t?.ag,
      was = shownAg || {};
    const other =
      !!a &&
      (a.name !== was.name || a.cli !== was.cli || (!!a.mark && !!was.mark && a.mark !== was.mark));
    if (a && !other) {
      if (a.mark && !was.mark) was.mark = a.mark;
      return;
    }
    const pc = (st?.computers || []).find(x => x && x.id === sel.split(SEP)[0]),
      where = pc ? 'on ' + pcName(pc) : '',
      name = was.name || 'That agent';
    askNot();
    endView('closed');
    lost = {
      name,
      cli: was.cli || '',
      where,
      words:
        name +
        (where ? ' ' + where : '') +
        (other
          ? ' changed, or another agent took its place. Select it on the left to see what is there now.'
          : ' is no longer listed here.'),
    };
    sel = '';
    shownAg = null;
    seen = null;
    sent = '';
    stopped = '';
    if (box && box.contains(document.activeElement)) document.activeElement.blur();
  }

  // ---- the composer's target: its own press, never the selection (a prompt that leaves this
  // computer) ---- The hint is painted at once, not at the composer's next merged repaint: it never
  // names this target while Enter goes elsewhere.
  const announce = () => {
    window.dispatchEvent(
      new CustomEvent('tnai:target-changed', { detail: { paneId: null, remote: target } })
    );
    window.TnaiLiveTasks?.paintRoute?.();
  };

  // A line wider than the passing notice is cut there with "…": its full text is that notice's own
  // tooltip while it shows, and is taken off again the moment the notice says something else (so no
  // other notice ever carries it).
  const sayFull = message => {
    say(message);
    const t = document.getElementById('toast');
    if (!t || t.textContent !== message) return;
    t.title = message;
    const o = new MutationObserver(() => {
      if (t.textContent !== message) {
        t.removeAttribute('title');
        o.disconnect();
      }
    });
    o.observe(t, { childList: true, characterData: true, subtree: true });
  };

  function dropTarget(why) {
    if (!target) return;
    const was = targetAg?.name || '',
      pc = (st?.computers || []).find(x => x && x.id === target.split(SEP)[0]);
    target = '';
    targetAg = null;
    if (why) sayFull((was ? was + (pc ? ' on ' + pcName(pc) : '') + ': ' : '') + why);
    announce();
  }

  // The chosen agent itself: its row still holds the agent that was chosen (same name, CLI and
  // mark) and it still takes a prompt. A row that holds another agent by now is not the target: a
  // prompt never goes to an agent the user did not choose.
  const targetRow = () => {
    const t = target ? find(target) : null;
    return t && same(t.ag, targetAg) ? t : null;
  };

  function setTarget(key) {
    if (!key) {
      target = '';
      targetAg = null;
      announce();
      return;
    }
    const t = find(key);
    if (!t || t.ag.can !== true || !t.ag.mark) return;

    // typing (166): another computer's plain terminal takes keys only, never a prompt
    if (t.ag.cli === 'Terminal') return;

    // one target at a time: an agent here, or one on another computer
    window.TnaiLiveTasks?.setTarget?.(null);
    target = key;
    targetAg = { id: t.ag.id, name: t.ag.name, cli: t.ag.cli, mark: t.ag.mark, can: true };
    announce();
    say('Composer tasks now go to ' + t.ag.name + ' on ' + pcName(t.pc));
  }

  // A local agent was chosen (a row here, Overview, the picker): the remote one is no longer the
  // target.
  window.addEventListener('tnai:target-changed', e => {
    if (e.detail?.paneId && target) {
      target = '';
      targetAg = null;
      window.TnaiLiveTasks?.paintRoute?.();
      repaint();
    }
  });
  const targetNow = () => {
    const t = targetRow();
    return t ? { key: t.key, agent: t.ag.name, computer: pcName(t.pc), pc: t.pc, ag: t.ag } : null;
  };

  // ---- a press: not while that computer's rows just moved, only for the very agent that is shown,
  // and with its mark ----
  const QUIET = 'The list had just changed, so nothing was sent. Look again, then press.';
  const same = (a, b) =>
    !!a &&
    !!b &&
    a.can === true &&
    a.id === b.id &&
    a.name === b.name &&
    a.cli === b.cli &&
    (a.mark || '') === (b.mark || '') &&
    !!a.mark;
  const gone = t =>
    D().changedWords
      ? D().changedWords(t.pc, t.ag)
      : t.ag.name + ' changed or closed on ' + t.pc.name + ' meanwhile, so nothing was sent.';
  const NOT = {
    changed: t => gone(t),
    not_sent: t =>
      'Not sent: ' +
      pcName(t.pc) +
      ' is not connected, or ' +
      t.ag.name +
      ' changed or closed there.',
    no_word: () => 'Not sent: a prompt for another computer starts with a letter or a number.',
    too_long: () =>
      'Not sent: too long for one message to another computer. Nothing is cut: shorten it.',
  };

  async function operate(shown, run) {
    if (D().quiet?.()) {
      say(QUIET);
      return null;
    }
    const t = find(shown.key);
    if (!t || !same(t.ag, shown.ag)) {
      say(gone(shown));
      return null;
    }
    let v = null;
    try {
      v = await run(t);
    } catch {
      v = { sent: 'not_sent' };
    }
    if (v && v.sent && v.sent !== 'asked') say((NOT[v.sent] || NOT.not_sent)(t));
    paint();
    return v;
  }

  // The composer's Send for a chosen agent on another computer. → { ok, words }: ok only when the
  // prompt left this computer. files (optional): [{ kind, bytes }] as 27's forRemote made them:
  // they travel first, in pieces, and the prompt goes only when
  // every one arrived whole there; the call resolves when that is over.
  const FILE_NOT = {
    busy: () =>
      'Not sent: files are already on their way to another computer. Wait for them, or press Esc in the prompt box to stop them.',
    bad_file: () =>
      'Not sent: one of the files cannot go to another computer (only pictures and plain text files).',
    too_many: () => 'Not sent: at most 3 files go with one prompt to another computer.',
    too_big: () => 'Not sent: the files are over 300 KB together.',
    file_refused: t =>
      'Not sent: ' +
      pcName(t.pc) +
      ' did not take the file (it takes at most 3 MB and 30 files a day from one computer, or the agent changed there).',
    file_no_reply: t =>
      'Not sent: ' +
      pcName(t.pc) +
      ' did not answer for the file. It may need an update to take files.',
    file_failed: () => 'Not sent: a file did not arrive whole. Nothing was sent; send it again.',
    stopped: () => 'Stopped: nothing was sent.',
  };

  // What the composer's line says while files travel, '' when none do.
  const progress = () => {
    const s = st?.sending;
    if (!s) return '';
    const pc = (st.computers || []).find(x => x && x.id === s.peer),
      pct = s.pieces > 0 ? Math.min(100, Math.round((100 * s.piece) / s.pieces)) : 0;
    return (
      'Sending file ' +
      s.file +
      ' of ' +
      s.files +
      ' to ' +
      (pc ? pcName(pc) : 'the other computer') +
      ': ' +
      pct +
      '%'
    );
  };
  document.getElementById('prompt')?.addEventListener('keydown', e => {
    if (e.key === 'Escape' && st?.sending) call('stopFiles').catch(() => {});
  }); // Esc in the prompt box stops files that are on their way

  async function send(text, files) {
    const t = targetRow();
    if (!t) {
      dropTarget('');
      return {
        ok: false,
        words:
          'Not sent: that agent changed, closed or is no longer listed here. Your prompt is still in the box.',
      };
    }
    const body = String(text || '').trim();
    if (!/^[\p{L}\p{N}]/u.test(body))
      return {
        ok: false,
        words:
          'Not sent: a prompt for ' +
          t.ag.name +
          ' on ' +
          pcName(t.pc) +
          ' starts with a letter or a number. Commands are not sent to another computer.',
      };
    if (D().quiet?.()) return { ok: false, words: QUIET };
    let room = 0;
    try {
      room = await call('room', t.ag.id, body);
    } catch {
      room = 0;
    }
    if (Number.isFinite(room) && room < 0)
      return {
        ok: false,
        words:
          'Not sent: too long by about ' +
          (-room).toLocaleString('en-US') +
          ' characters for one message to another computer. Nothing is cut: shorten it.',
      };
    const now = find(t.key);
    if (!now || !same(now.ag, t.ag)) {
      return { ok: false, words: gone(t) };
    }
    const withFiles = Array.isArray(files) && files.length > 0;
    if (withFiles && typeof native.promptFiles !== 'function')
      return {
        ok: false,
        words:
          'Not sent: attachments are not sent to another computer. Remove them, or choose an agent on this computer.',
      };
    let v = null;
    try {
      v = withFiles
        ? await call('promptFiles', now.pc.id, now.ag.id, body, now.ag.mark || '', files)
        : await call('prompt', now.pc.id, now.ag.id, body, now.ag.mark || '');
    } catch {
      v = { sent: 'not_sent' };
    }
    paint();
    return v && v.sent === 'asked'
      ? {
          ok: true,
          words:
            'Sent to ' +
            now.ag.name +
            ' on ' +
            pcName(now.pc) +
            (withFiles ? ' with ' + files.length + (files.length === 1 ? ' file' : ' files') : ''),
        }
      : {
          ok: false,
          words:
            (FILE_NOT[v?.sent] || NOT[v?.sent] || NOT.not_sent)(now) +
            ' Your prompt is still in the box.',
        };
  }
  const followText = last =>
    'Follow up on your last task' +
    (last?.task
      ? ' ("' + (last.task.length > 200 ? last.task.slice(0, 200) + '…' : last.task) + '")'
      : '') +
    ': look into what remains from it (anything unfinished, unverified, blocked or left as a TODO), check its current state in the project, ' +
    "and recommend the next steps in priority order with a short reason for each. Don't start the next steps yet; only small checks needed to answer. End with your usual Technically Not report.";

  // ---- a new agent on another computer, chosen in the composer's own New agent menu (46) and
  // started by the composer's Send (11) ---- Nothing new crosses to the other computer: this is the
  // Devices card's "New agent" (the `start` operation, with every rule the other computer keeps for
  // it: the same project open there, never above "Ask first", its own folder-trust question, three
  // open and twenty a day, the first prompt through the word-first check with this computer's
  // mark). Offered: a paired computer that is live, has a session and says it can start that CLI
  // for the project open here (`canStart`, which the main process leaves empty when no git project
  // is open here). Only Claude Code and OpenCode: Codex and Cursor Agent cannot be held to ask
  // first, so they are not offered here whatever the other computer says.
  const START = { claude: 'Claude Code', opencode: 'OpenCode' };
  const starts = () =>
    (st?.on ? st.computers || [] : [])
      .filter(pc => pc && pc.state === 'live' && pc.session === true)
      .flatMap(pc =>
        (Array.isArray(pc.canStart) ? pc.canStart : [])
          .filter(c => Object.hasOwn(START, c))
          .map(c => ({
            key: pc.id + '|' + c,
            pc: pc.id,
            cli: c,
            name: START[c],
            computer: pcName(pc),
            label: START[c] + ' on ' + pcName(pc),
          }))
      );

  // The menu entry was pressed. Not while that computer's rows just moved (the entry under the
  // pointer may be another computer's by now).
  function chooseStart(k) {
    if (D().quiet?.()) {
      say(QUIET);
      return false;
    }
    const o = starts().find(x => x.key === k);
    if (!o) return false;
    window.TnaiLiveTasks?.newFar?.(o);
    say(
      'The next prompt starts a new ' +
        o.name +
        ' agent on ' +
        o.computer +
        '. It asks before it runs commands there.'
    );
    return true;
  }

  // The composer's Send with such a choice. → { ok, words }: ok only when the start left this
  // computer. What became of it on the other computer is said when its word arrives (watchStart),
  // where the composer speaks.
  let started = null; // { pc, n, name, computer }: the start this page is waiting to hear about

  async function start(k, text) {
    const o = starts().find(x => x.key === k);
    if (!o) {
      window.TnaiLiveTasks?.newFar?.(null);
      return {
        ok: false,
        words:
          'Not started: that computer no longer starts agents for this one. Your prompt is still in the box.',
      };
    }
    const body = String(text || '').trim();
    if (!/^[\p{L}\p{N}]/u.test(body))
      return {
        ok: false,
        words:
          'Not started: the first prompt for a new agent on ' +
          o.computer +
          ' starts with a letter or a number. Commands are not sent to another computer.',
      };
    if (D().quiet?.()) return { ok: false, words: QUIET };
    let room = 0;
    try {
      room = await call('room', '', body);
    } catch {
      room = 0;
    }
    if (Number.isFinite(room) && room < 0)
      return {
        ok: false,
        words:
          'Not started: too long by about ' +
          (-room).toLocaleString('en-US') +
          ' characters for one message to another computer. Nothing is cut: shorten it.',
      };
    if (!starts().some(x => x.key === k))
      return {
        ok: false,
        words:
          'Not started: ' +
          o.computer +
          ' no longer starts agents for this computer. Your prompt is still in the box.',
      };
    let v = null;
    try {
      v = await call('start', o.pc, o.cli, body);
    } catch {
      v = { sent: 'not_sent' };
    }
    const WHY = {
      no_word: 'the first prompt starts with a letter or a number.',
      too_long: 'too long for one message to another computer. Nothing is cut: shorten it.',
      no_project:
        'a new agent is started for the project open on this computer, and that needs a git project open here.',
      not_sent:
        o.computer + ' is not connected or does not start agents for this computer right now.',
    };
    if (!v || v.sent !== 'asked')
      return {
        ok: false,
        words:
          'Not started: ' + (WHY[v?.sent] || WHY.not_sent) + ' Your prompt is still in the box.',
      };
    started = { pc: o.pc, n: v.n || '', name: o.name, computer: o.computer };
    return {
      ok: true,
      words:
        'Asked ' +
        o.computer +
        ' to start a new ' +
        o.name +
        ' agent with this prompt. It asks before it runs commands there.',
    };
  }

  // The other computer's word on that start (started, refused, failed, no confirmation), said once,
  // in the Devices page's words.
  let startsKey = '';

  function watchStart() {
    // What can be started on another computer changed: the composer's Model pill is told (46: with
    // no CLI signed in here it is the only way to those entries, so it must wake and sleep with
    // them). Nothing is sent while connecting is off: the list stays empty.
    const sk = starts()
      .map(x => x.key)
      .join(',');
    if (sk !== startsKey) {
      startsKey = sk;
      window.dispatchEvent(new CustomEvent('tnai:remote-starts'));
    }

    // The choice itself ends when its computer no longer offers it (it went offline, its switch
    // went off, another project was opened).
    const nf = window.TnaiLiveTasks?.newFar?.();
    if (nf && !starts().some(x => x.key === nf.key)) {
      window.TnaiLiveTasks.newFar(null);
      say(
        nf.computer +
          ' no longer starts agents for this computer. New agent is back to this computer.'
      );
    }
    if (!started) return;
    const pc = (st?.computers || []).find(x => x && x.id === started.pc),
      op =
        pc &&
        (pc.ops || []).find(x => x && x.kind === 'start' && (!started.n || x.n === started.n));
    if (!op || op.state === 'asked') return;
    const said =
      D().startSaid?.(op.state, started.computer) ||
      (op.state === 'started' ? 'started' : 'it did not start on ' + started.computer);
    say('New ' + started.name + ' agent on ' + started.computer + ': ' + said + '.');
    started = null;
  }

  // ---- the detail: 25's layout, filled with what is known ----
  let box = null,
    ui = null,
    quietTimer = 0;

  // The box stands in the thread's main area while one was handed over, else in the old page's.
  function place() {
    const home = threadHost || detail;
    if (box && home && box.parentElement !== home) home.append(box);
  }

  function ensure() {
    if (box) {
      place();
      return box;
    }
    box = el('div', 'ap-agent ap-far');
    box.hidden = true;
    box.innerHTML =
      '<div class="ap-head"><span class="agent-avatar ap-avatar"></span><div class="ap-id"><div class="ap-name"><h2></h2></div><small></small></div>' +
      '<div class="ap-actions"><button type="button" data-act="target" title="Tasks you write in the composer go to this agent on the other computer, as a prompt">Send composer tasks here</button><button type="button" data-act="follow" title="Ask it to look into what remains of its last task and recommend next steps">Follow up</button><button type="button" data-act="interrupt">Interrupt</button><button type="button" data-act="stop">Stop</button></div></div>' +
      '<div class="ap-grid"><div class="ap-main"><section class="ap-term-sec" data-sec="term"><div class="ap-term-bar"><span>LIVE SCREEN</span><span class="ap-term-tools"><em></em><span class="ap-picks" role="group" aria-label="Options of its question"></span><button type="button" class="ap-font" data-act="keep">Keep watching</button><button type="button" class="ap-font" data-act="again">Watch again</button></span></div><div class="ap-term"></div></section></div>' +
      '<div class="ap-side"><section class="ap-sec" data-sec="now"><h3>NOW</h3><div></div></section><section class="ap-sec" data-sec="last"><h3>LAST RESULT</h3><div></div></section></div></div>';
    const q = s => box.querySelector(s);
    ui = {
      avatar: q('.ap-avatar'),
      name: q('h2'),
      sub: q('.ap-id small'),
      target: q('[data-act=target]'),
      follow: q('[data-act=follow]'),
      interrupt: q('[data-act=interrupt]'),
      stop: q('[data-act=stop]'),
      keep: q('[data-act=keep]'),
      again: q('[data-act=again]'),
      picks: q('.ap-picks'),
      term: q('.ap-term'),
      nowSec: q('[data-sec=now]'),
      now: q('[data-sec=now] div'),
      last: q('[data-sec=last] div'),
      lastSec: q('[data-sec=last]'),
      screen: null,
      note: null,
      key: '',
    };
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || b.hidden) return;
      const t = cur(),
        act = b.dataset.act;
      if (!t) return;
      if (act === 'keep') {
        call('keepView')
          .then(ok => {
            if (ok === false) say('Keep watching can be pressed once a minute.');
          })
          .catch(() => {});
        return;
      }
      if (act === 'again') {
        askView();
        paint();
        return;
      }

      // "Choose option N" of the question that agent asks: the number and
      // the binding of the question as it was drawn. Not a key: the other computer answers its
      // agent's question itself, or refuses.
      if (act === 'pick') {
        const ask = askOf(t),
          num = Number(b.dataset.n);
        if (D().quiet?.()) return say(QUIET);
        if (!ask || ask.kof !== b.dataset.kof || !same(find(sel)?.ag, t.ag)) return say(gone(t));
        call('pick', t.pc.id, ask.id, num, ask.kof)
          .then(v => {
            if (!v || v.sent !== 'asked')
              say(
                'Not sent: ' + pcName(t.pc) + ' is not connected, or the question changed there.'
              );
          })
          .catch(() =>
            say('Not sent: ' + pcName(t.pc) + ' is not connected, or the question changed there.')
          );
        return;
      }
      if (act === 'target') {
        if (D().quiet?.()) return say(QUIET);
        if (target === sel) setTarget('');
        else if (same(find(sel)?.ag, t.ag)) setTarget(sel);
        else say(gone(t));
        repaint();
        return;
      }
      if (act === 'interrupt') {
        operate(t, x => call('act', x.pc.id, x.ag.id, 'interrupt', x.ag.mark || ''));
        return;
      }
      if (act === 'follow') {
        operate(t, x =>
          call('prompt', x.pc.id, x.ag.id, followText(x.ag.last), x.ag.mark || '')
        ).then(v => {
          if (v && v.sent === 'asked')
            say('Follow-up sent to ' + t.ag.name + ' on ' + pcName(t.pc));
        });
        return;
      }
      if (act === 'stop') {
        if (D().quiet?.()) return say(QUIET);
        (
          window.TnaiPanelConfirm?.(box.parentElement || detail, {
            title: 'Stop ' + t.ag.name + ' on ' + pcName(t.pc) + '?',
            body: 'Its process ends on that computer and its thread stays there, as with the stop button on that computer.',
            ok: 'Stop',
            danger: true,
          }) || Promise.resolve(false)
        ).then(ok => {
          if (ok) operate(t, x => call('act', x.pc.id, x.ag.id, 'stop', x.ag.mark || ''));
        });
      }
    });
    place();
    return box;
  }
  const kv = (dl, k, v) => {
    if (!v) return;
    dl.append(el('dt', '', k), el('dd', '', v));
  };

  // Why there is no live picture, when this computer may not ask for one.
  function whyNot(t) {
    const n = pcName(t.pc);
    if (t.ag.can !== true)
      return t.pc.canControl
        ? t.ag.name +
            ' takes nothing from this computer (it was typed by hand on ' +
            n +
            ', or is not ready). Look at it on ' +
            n +
            '.'
        : n +
            ' does not let this computer control or watch its agents. Full control is given on ' +
            n +
            ', on its Devices page.';
    return (
      n +
      ' does not let this computer watch yet. On ' +
      n +
      ', turn full control for this computer off and on again on its Devices page.'
    );
  }

  // The selection was let go by a push: one line, no button, nothing of the agent that is there
  // now.
  function paintLost() {
    ensure();
    box.hidden = false;
    box.dataset.remote = '';
    setAvatar(ui.avatar, lost.cli);
    setText(ui.name, lost.name);
    ui.name.title = lost.name;
    setText(ui.sub, lost.where);
    for (const b of [ui.target, ui.follow, ui.interrupt, ui.stop, ui.keep, ui.again])
      b.hidden = true;
    ui.picks.replaceChildren();
    ui.picks.dataset.sig = '';
    if (!ui.note) ui.note = el('p', 'ap-none');
    setText(ui.note, lost.words);
    if (ui.note.parentElement !== ui.term) ui.term.replaceChildren(ui.note);
    ui.term.dataset.view = 'no';
    ui.nowSec.hidden = true;
    ui.lastSec.hidden = true;
    window.TnaiRemoteTalk?.show(null);
    return true;
  }

  function paint() {
    if (lost) return paintLost();
    const t = cur();
    if (!t || !box) {
      if (box) box.hidden = true;
      window.TnaiRemoteTalk?.show(null);
      return false;
    }
    const { pc, ag } = t,
      n = pcName(pc),
      tone = WORD[ag.status] || WORD.idle,
      can = ag.can === true,
      off = !!D().quiet?.();
    box.hidden = false;
    box.dataset.remote = t.key;
    ui.nowSec.hidden = false;

    // Its conversation as that computer reported it, read only, above the live picture (152), in
    // the thread's main area only.
    window.TnaiRemoteTalk?.show(threadHost ? box.querySelector('.ap-main') : null, {
      pc,
      ag,
      pcName: n,
    });

    // The buttons are off for a moment after that computer's rows moved (111's quiet time) and come
    // back by themselves.
    if (off && !quietTimer)
      quietTimer = setTimeout(() => {
        quietTimer = 0;
        if (sel && onPage()) paint();
      }, 680);
    setAvatar(ui.avatar, ag.cli);
    setText(ui.name, ag.name);
    ui.name.title = ag.name;
    setText(ui.sub, (ag.cli ? ag.cli + ' · ' : '') + 'on ' + n);

    // Only what has a path: nothing is offered for an agent that takes no operation from here.
    // Another computer's plain terminal (Your terminal, a PowerShell thread; listed only for a
    // computer that may type there) takes keys only: no prompt, interrupt or stop buttons.
    for (const b of [ui.target, ui.follow, ui.interrupt, ui.stop]) {
      b.hidden = !can || ag.cli === 'Terminal';
      b.disabled = off;
    }
    if (can) {
      ui.interrupt.hidden = ag.status !== 'working';
      ui.follow.hidden = !ag.last;
    }
    const isTarget = target === t.key;
    ui.target.setAttribute('aria-pressed', String(isTarget));
    setText(ui.target, isTarget ? 'Composer sends tasks here' : 'Send composer tasks here');
    for (const [b, word] of [
      [ui.interrupt, 'Interrupt'],
      [ui.stop, 'Stop'],
      [ui.follow, 'Follow up with'],
    ])
      b.setAttribute('aria-label', word + ' ' + ag.name + ' on ' + n);

    // The terminal box: the picture, or one muted line that says why there is none.
    const m = seen && seen.peer === pc.id && seen.agent === ag.id ? seen : null,
      pic = m?.picture || null,
      watch = mayWatch(t);
    let words = '';
    if (!watch) words = whyNot(t);
    else if (askTimer) words = 'Watching starts in a moment.';
    else if (stopped === 'often') words = 'Asked too often. Watch again in a minute.';
    else if (!m && !viewing && !sent && !stopped)
      // nothing was asked (it was not allowed when the row was selected, or the window was away)
      words = 'Not watched yet.';
    else if (stopped === 'left' && !m) words = 'Watching stopped when you left this page.';
    else if (stopped === 'gone' && !m)
      words = n + ' is no longer connected to this computer for watching.';
    else words = D().viewWords ? D().viewWords(m, sent, n, ag.name) : '';
    if (pic) {
      if (!ui.screen) {
        ui.screen = el('div', 'dv-screen');
        ui.screen.tabIndex = 0;
        D().screenColors?.(ui.screen);
      }
      ui.screen.setAttribute('aria-label', 'The screen of ' + ag.name + ' on ' + n + ', as text');
      if (ui.screen.parentElement !== ui.term) ui.term.replaceChildren(ui.screen);
      D().drawScreen?.(ui.screen, pic);
    } else {
      if (!ui.note) ui.note = el('p', 'ap-none');
      setText(ui.note, words);
      if (ui.note.parentElement !== ui.term) ui.term.replaceChildren(ui.note);
    }
    ui.term.dataset.view = !watch
      ? 'no'
      : m
        ? m.state
        : viewing
          ? 'asked'
          : askTimer
            ? 'soon'
            : 'ended';
    ui.keep.hidden = !(m && m.state === 'on');
    ui.again.hidden = !(watch && !viewing && !askTimer && (!m || m.state === 'ended'));

    // Typing into that panel (166, desktop/remote-type.js): its button in the bar and the keys on
    // the picture, drawn from the same view; nothing when 166 is not loaded.
    window.TnaiRemoteTyping?.paint?.({
      bar: ui.keep.parentElement,
      screen: pic ? ui.screen : null,
      pc,
      ag,
      pcName: n,
      model: m,
    });

    // NOW: status, task, where it runs, where the view and the last thing sent from here stand.
    const dl = el('dl', 'ap-kv');
    kv(
      dl,
      'Status',
      tone[1] + (ag.status === 'working' && ag.since > 0 ? ' since ' + clock(ag.since) : '')
    );
    kv(dl, 'Task', ag.task || '');
    kv(dl, 'Computer', n + ' (' + String(pc.id).slice(0, 8) + ')');
    kv(dl, 'Live terminal', pic || watch ? words : '');

    // Its question, when that computer sent the options with it (6i): the words in NOW, one small
    // button per option in the terminal box's bar. The buttons are rebuilt only when the question
    // or their state changes, so one never changes under the pointer.
    const ask = can ? askOf(t) : null,
      psig = ask ? ask.id + '|' + ask.kof + '|' + (off ? 1 : 0) : '';
    if (ui.picks.dataset.sig !== psig) {
      ui.picks.dataset.sig = psig;
      ui.picks.replaceChildren(
        ...(ask
          ? ask.opts.map((label, i) => {
              const b = el('button', 'ap-font', String(i + 1));
              b.type = 'button';
              b.dataset.act = 'pick';
              b.dataset.n = String(i + 1);
              b.dataset.kof = ask.kof;
              b.title = label;
              b.disabled = off;
              b.setAttribute(
                'aria-label',
                'Choose option ' + (i + 1) + ', ' + label + ', for ' + ag.name + ' on ' + n
              );
              return b;
            })
          : [])
      );
    }
    kv(
      dl,
      'Asks',
      ask
        ? (ask.detail || 'A question') +
            ' · ' +
            ask.opts.map((label, i) => i + 1 + ' ' + label).join(' · ')
        : ''
    );
    kv(dl, 'Sent from here', D().opWords ? D().opWords(pc, ag) : '');
    const sig = JSON.stringify([...dl.children].map(x => x.textContent));
    if (ui.now.dataset.sig !== sig) {
      ui.now.dataset.sig = sig;
      ui.now.replaceChildren(dl);
    }

    // LAST RESULT: the answer of the task it finished last, as that computer sent it.
    const last =
      ag.last && typeof ag.last === 'object' && Number.isFinite(ag.last.at) ? ag.last : null;
    ui.lastSec.hidden = !last;
    if (last) {
      // The answer's first part is not in the pushed state: it is read
      // once per result, only for the agent that is shown here, and used only when it belongs to
      // this very result (`at` and `got`).
      const ak = t.key + '|' + last.at + '|' + last.got;
      if (last.has && (!answer || answer.k !== ak)) {
        const mine = (answer = { k: ak, text: '', done: false }),
          end = a => {
            if (answer !== mine) return;
            mine.text =
              a && a.at === last.at && a.got === last.got && typeof a.text === 'string'
                ? a.text
                : '';
            mine.done = true;
            if (sel && onPage()) paint();
          };
        call('reportText', pc.id, ag.id).then(end, () => end(null));
      }
      const mineNow = last.has && answer && answer.k === ak ? answer : null,
        text = mineNow ? mineNow.text : '',
        reading = !!mineNow && !mineNow.done;
      const lsig = JSON.stringify([last.at, last.did, last.task, text, reading, last.more]);
      if (ui.last.dataset.sig !== lsig) {
        ui.last.dataset.sig = lsig;
        const more = Number.isInteger(last.more) && last.more > 0 ? last.more : 0,
          parts = [el('p', '', 'Finished ' + clock(last.at) + (last.did ? ': ' + last.did : ''))];
        if (last.task) parts.push(el('p', '', 'Task: ' + last.task));
        if (text) parts.push(el('p', 'ap-far-text', text));
        parts.push(
          el(
            'p',
            '',
            reading
              ? 'Reading the answer…'
              : !text
                ? 'The answer itself is in its thread on ' + n + '.'
                : more
                  ? 'This is the first part. ' +
                    more.toLocaleString('en-US') +
                    ' more ' +
                    (more === 1 ? 'character is' : 'characters are') +
                    ' in the whole answer, on ' +
                    n +
                    '.'
                  : 'This is the whole answer, as ' + n + ' sent it.'
          )
        );
        ui.last.replaceChildren(...parts);
      }
    }

    // This week's thread features for this agent's thread (165): the work button, its Changes
    // and its computer's CLIs. Drawn in this box only.
    window.TnaiRemoteFeatures?.paint?.(box, { key: t.key, pc, ag, pcName: n, off });
    return true;
  }

  // ---- the state, pushed ----
  let key = '',
    sendKey = 'null';
  const take = s => {
    st = s && typeof s === 'object' ? s : null;
    watchStart();
    {
      const p = JSON.stringify(st?.sending || null);
      if (p !== sendKey) {
        sendKey = p;
        window.TnaiLiveTasks?.paintRoute?.();
      }
    } // files on their way: the composer's line follows them
    const k = JSON.stringify(
      shownPcs().map(x => [
        x.pc.id,
        x.pc.name,
        x.pc.canWatch,
        x.pc.canControl,
        x.pc.ops,
        x.rows,
        (x.pc.items || []).filter(i => i && i.kof).map(i => [i.id, i.kof]),
      ])
    );

    // the thread list's line of why agents are not listed follows the counts too
    const k2 = k + JSON.stringify(notShownForList());
    if (k2 === key) return;
    key = k2;
    reconcile();
    tellList();

    // On any page: the composer's agent on another computer changed, closed or left the list, so it
    // is no longer the target.
    if (target && !targetRow())
      dropTarget(
        'It changed, closed or is no longer listed here, so composer tasks do not go to it any more.'
      );
    if (onPage()) repaint();
  };
  native.on(take);

  // Nothing is asked when this script loads: `remote:state` makes the main process ask the system's
  // secure storage, and the app's start never does that for a feature that may be off
  // (the rule for the Mac since 0.3.65). The main process pushes the state after the
  // window loaded whenever connecting is on (`windowLoaded` in desktop/remote-service.js), and at
  // every change.

  window.TnaiRemoteAgents = {
    list,

    // 165: a ready prompt (a thread action) for the agent shown now, the way Follow up sends one:
    // the quiet time, the very agent that is shown, its mark. → the operation's answer or null.
    // expected: the thread ({ key, pc, ag }) the menu was opened for. Review 23, L3: when the shown
    // thread changed while the menu was open, nothing is sent (the prompt names that agent's work).
    promptShown(text, expected) {
      const t = cur();
      if (!t || t.ag.can !== true) return Promise.resolve(null);
      if (!expected || !expected.ag || expected.key !== t.key || !same(t.ag, expected.ag)) {
        if (expected && expected.pc && expected.ag) say(gone(expected));
        return Promise.resolve(null);
      }
      return operate(t, x => call('prompt', x.pc.id, x.ag.id, String(text || ''), x.ag.mark || ''));
    },

    // 119, the thread list: the same computers and rows, read-only. A press there goes through
    // `pick`, as a press on a row of this page does.
    shown: shownForList,
    // 119: why some of a computer's agents are not in the list
    notShown: notShownForList,
    select,
    pick,
    selected: () => sel,
    lost: () => !!lost,
    target: targetNow,
    send,
    leave,
    progress,
    starts,
    chooseStart,
    // a new agent on another computer: the entries for the composer's New agent menu (46), its
    // press, the composer's Send (11)
    start,
    // 138: the box in the thread's main area that the detail is drawn into from now on; null when
    // the detail is not shown there any more (the selection itself is `select`'s).
    mount(host) {
      threadHost = host || null;
      if (threadHost) {
        drawInThread();
        return;
      }

      // the conversation is shown in the thread's main area only
      window.TnaiRemoteTalk?.show(null);
      if (!box) return;
      if (detail) place();
      else box.remove();
    },

    // 25 calls this from its own render, after the list: true when a remote agent is selected and
    // its detail was drawn into `.ap-detail`. Never while the detail stands in the thread's main
    // area.
    paint() {
      if (threadHost) return false;
      if (lost) return paintLost();
      if (!sel) {
        if (box) box.hidden = true;
        return false;
      }
      ensure();
      return paint();
    },
  };
})();
