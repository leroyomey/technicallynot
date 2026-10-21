// Technically Not · 164-remote-thread-more.js — Desktop only: another computer's thread gets the
// controls a thread of this computer has (plan item 44, `docs/plans/multi-computer.md` list J).
//
// - Its "..." menu. A "..." button stands in the head of the other computer's thread (116 draws
//   that head; a right press on its row of the thread list opens the same menu). The menu is 137's
//   own menu with the same rows as for a thread here: Rename, Team, CLI screen, Pop out, Stop,
//   Hand off, Close thread. A row that cannot work for another computer's thread is greyed with
//   its reason in its own words (12-inactive-ui.js greys a row that carries `data-off`), never
//   left out. Rename edits the name in place; Stop and Close ask first, as they do here.
// - The composer's Model and Effort. While that agent is the composer's target (116 `target`),
//   46 asks `subject` here and its pickers switch that agent's model or effort through its CLI's
//   own command on that computer. Access stays that computer's own, greyed with the reason.
// - Past conversations of that computer, in the same popover as this computer's (138 hands over
//   its popover through `paintPast`): its newest 30 of the project open here, each one read on a
//   press (remote-log.js, "As NAME reported it") and resumed there with Resume.
//
// Every operation goes through the main process (remote:thread, remote:resume, remote:askPast,
// remote:past, remote:askLog, remote:log), which sends it only to a computer whose full control
// switch for this one is on, and that computer checks it again (remote-control.js). Nothing here
// is a right. `window.TnaiRemoteThreadMore`. Test: `remote-thread-more` (written for the batch's
// one window-test round).
(() => {
  'use strict';
  const native = window.tnaiNative?.remote;
  if (!native?.on || !native.thread) return;

  const SEP = '\n';
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);
  const call = async (name, ...args) => {
    const result = await native[name](...args);
    if (result && result.ok === false) throw result.error || {};
    return result && typeof result === 'object' && 'value' in result ? result.value : result;
  };
  const WHEN = new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const when = at => (at > 0 ? WHEN.format(new Date(at)) : '');

  // What each CLI takes from another computer (desktop/remote-thread.js THREAD_CAN says the same
  // and decides): only Claude Code switches model and effort by a typed command.
  const CAN = {
    'Claude Code': ['rename', 'close', 'model', 'effort'],
    Codex: ['rename', 'close'],
    OpenCode: ['rename', 'close'],
    'Cursor Agent': ['rename', 'close'],
  };
  const can = (cli, what) => !!CAN[cli]?.includes(what);

  // ---------- the pushed state ----------
  let st = null;
  const pcOf = id => (st?.on ? st.computers || [] : []).find(pc => pc && pc.id === id) || null;

  // A computer's name as the thread list shows it (two of one name carry the end of the id).
  const pcName = pc =>
    window.TnaiRemoteAgents?.shown?.().find(x => x.id === pc.id)?.name || pc.name;

  // The agent of another computer a key names, as listed now: a live computer in a session and a
  // row of the project open here.
  function rowOf(key) {
    const [pcId, id] = String(key || '').split(SEP);
    const pc = pcOf(pcId);
    if (!pc || pc.state !== 'live' || pc.session !== true) return null;
    const ag = (pc.agents || []).find(a => a && a.id === id && a.sure === true);
    return ag ? { key, pc, ag } : null;
  }

  // The agent the user pressed on is still the one under that key (a row id can hold another
  // agent a moment later).
  const same = (a, b) =>
    !!a && !!b && a.id === b.id && a.name === b.name && a.cli === b.cli && a.mark === b.mark;

  // ---------- an operation, and its word ----------
  const QUIET = 'The list had just changed, so nothing was sent. Look again, then press.';
  const waiting = new Map();

  const SAID = {
    rename: {
      done: e => 'Renamed ' + e.name + ' on ' + e.pc + ' to ' + e.value + '.',
      refused: e =>
        e.pc + ' did not rename ' + e.name + ': the name may be taken there, or it changed.',
    },
    close: {
      done: e => e.name + ' on ' + e.pc + ' was closed. Its conversation is kept there.',
      refused: e => e.pc + ' did not close ' + e.name + ': it changed or closed there.',
    },
    model: {
      done: e => e.name + ' on ' + e.pc + ' → ' + e.value,
      busy: e =>
        e.name + ' on ' + e.pc + ' is working or waiting for an answer. Switch when it is idle.',
      refused: e => e.pc + ' did not switch ' + e.name + '’s model.',
    },
    effort: {
      done: e => e.name + ' on ' + e.pc + ' → ' + e.value + ' effort',
      busy: e =>
        e.name + ' on ' + e.pc + ' is working or waiting for an answer. Switch when it is idle.',
      refused: e => e.pc + ' did not switch ' + e.name + '’s effort.',
    },
    stop: {
      done: e => e.name + ' on ' + e.pc + ' was stopped.',
      refused: e => e.pc + ' did not stop ' + e.name + ': it changed or closed there.',
    },
    resume: {
      started: e => 'Resumed on ' + e.pc + ': “' + e.name + '”. It runs there at Ask first.',
      refused: e =>
        e.pc +
        ' did not resume it: it may be running in a thread there, the list is older than 30 minutes, or that computer is at its limit of agents started from here.',
    },
  };
  const failedWords = e => 'Something went wrong on ' + e.pc + ': nothing was changed.';
  const noReply = e => 'No answer from ' + e.pc + '. It may need an update for this.';

  function sayWord(e, word) {
    const said = SAID[e.what] || {};
    if (said[word]) return say(said[word](e));
    if (word === 'no_reply') return say(noReply(e));
    if (word === 'failed' || word === 'busy') return say(failedWords(e));
    say((said.refused || failedWords)(e));
  }

  // The word on an operation comes in the pushed state, under its number.
  function followWords() {
    for (const [n, e] of waiting) {
      const op = (pcOf(e.pcId)?.ops || []).find(one => one && one.n === n);
      if (!op || op.state === 'asked' || op.state === 'queued') {
        if (Date.now() - e.at > 60000) waiting.delete(n);
        continue;
      }
      waiting.delete(n);
      sayWord(e, op.state);
    }
  }

  const NOT_SENT = {
    changed: e => e.name + ' changed or closed on ' + e.pc + ' meanwhile, so nothing was sent.',
    not_sent: e => 'Not sent: ' + e.pc + ' is not connected, or it does not take this from here.',
  };

  async function send(e, run) {
    if (window.TnaiDevices?.quiet?.()) return say(QUIET);
    let result = null;
    try {
      result = await run();
    } catch {
      result = null;
    }
    if (result && result.sent === 'asked' && result.n) {
      waiting.set(result.n, { ...e, at: Date.now() });
      return;
    }
    say((NOT_SENT[result?.sent] || NOT_SENT.not_sent)(e));
  }

  // A thread operation for the agent under `key`, as it was when the user pressed.
  function threadOp(key, what, value, pressed) {
    const t = rowOf(key);
    if (!t || (pressed && !same(t.ag, pressed))) {
      const name = pressed?.name || 'That agent';
      return say(name + ' changed or closed on the other computer meanwhile, so nothing was sent.');
    }
    const e = { what, value, name: t.ag.name, pc: pcName(t.pc), pcId: t.pc.id };
    return send(e, () => call('thread', t.pc.id, t.ag.id, what, value || '', t.ag.mark || ''));
  }

  // ---------- the "..." menu's rows for another computer's thread ----------
  const hostOf = () => document.querySelector('.tnh-view') || document.body;
  const confirmOver = options =>
    window.TnaiPanelConfirm?.(hostOf(), options) || Promise.resolve(false);

  function rename(key) {
    const t = rowOf(key);
    const title = document.querySelector('.tnh-view .ap-far .ap-name h2');
    const edit = window.TnaiTerminalPage?.inlineEdit;
    if (!t || !title || title.hidden || !edit) return;
    const pressed = { ...t.ag };
    edit(
      title,
      t.ag.name,
      'Rename this thread on ' + pcName(t.pc),
      text => {
        const name = String(text || '').trim();
        if (name && name !== pressed.name) threadOp(key, 'rename', name, pressed);
      },
      () => {},
      true
    );
  }

  function stop(key) {
    const t = rowOf(key);
    if (!t) return;
    const pressed = { ...t.ag };
    confirmOver({
      title: 'Stop ' + t.ag.name + ' on ' + pcName(t.pc) + '?',
      body: 'Its process ends on that computer and its thread stays there, as with the stop button on that computer.',
      ok: 'Stop',
      danger: true,
    }).then(yes => {
      const now = rowOf(key);
      if (!yes) return;
      if (!now || !same(now.ag, pressed))
        return say(
          pressed.name + ' changed or closed on the other computer meanwhile, so nothing was sent.'
        );
      send({ what: 'stop', name: now.ag.name, pc: pcName(now.pc), pcId: now.pc.id }, () =>
        call('act', now.pc.id, now.ag.id, 'stop', now.ag.mark || '')
      );
    });
  }

  function close(key) {
    const t = rowOf(key);
    if (!t) return;
    const pressed = { ...t.ag };
    confirmOver({
      title: 'Close ' + t.ag.name + ' on ' + pcName(t.pc) + '?',
      body: 'Its session ends on that computer and the thread leaves its list there. Its conversation is kept there in Past conversations.',
      ok: 'Close',
      danger: true,
    }).then(yes => {
      if (yes) threadOp(key, 'close', '', pressed);
    });
  }

  // The CLI screen of another computer's thread is its live view (115), shown in the thread.
  function showScreen() {
    const section = document.querySelector('.tnh-view .ap-far [data-sec=term]');
    if (!section) return;
    section.scrollIntoView({ block: 'nearest' });
    const again = section.querySelector('[data-act=again]');
    if (again && !again.hidden && !again.disabled) again.click();
  }

  function rowsFor(key) {
    const t = rowOf(key);
    if (!t) return [];
    const name = pcName(t.pc);
    const control = t.pc.canControl === true && t.ag.can === true && !!t.ag.mark;
    const needs = control ? '' : 'needs full control from ' + name;
    const cliCan = what => (can(t.ag.cli, what) ? '' : t.ag.cli + ' does not take it from here');
    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: 'pencil',
        go: rename,
        keepFocus: true,
        off: needs || cliCan('rename'),
      },
      { id: 'team', label: 'Team', icon: 'users', go: () => {}, off: 'set up on ' + name },
      {
        id: 'screen',
        label: 'CLI screen',
        icon: 'square-terminal',
        go: showScreen,
        off: t.pc.canWatch === true ? '' : name + ' does not share its screen with this one',
      },
      {
        id: 'popout',
        label: 'Pop out into its own window',
        icon: 'external-link',
        go: () => {},
        off: 'not for another computer’s thread',
      },
      { id: 'stop', label: 'Stop', icon: 'square-stop', go: stop, off: needs },
      {
        id: 'handoff',
        label: 'Hand off to a fresh agent',
        icon: 'rotate-cw',
        go: () => {},
        off: 'started on ' + name,
      },
      {
        id: 'close',
        label: 'Close thread',
        icon: 'x',
        go: close,
        off: needs || cliCan('close'),
      },
    ];
  }

  function openMenu(anchor, key) {
    const menu = window.TnaiThreadMore;
    if (!menu?.openList || !rowOf(key)) return;
    if (menu.isOpen?.()) {
      menu.close();
      return;
    }
    menu.openList(anchor, key, { name: 'This thread', label: '', rows: rowsFor(key) });
  }

  // ---------- the "..." button in the head of another computer's thread ----------
  const moreButton = make('button', 'tnt-icon-btn tnr-more');
  moreButton.type = 'button';
  moreButton.setAttribute('aria-haspopup', 'menu');
  moreButton.title = 'More for this thread';
  moreButton.setAttribute('aria-label', 'More for this thread');
  moreButton.innerHTML = icon('ellipsis', 16);
  moreButton.addEventListener('click', () => {
    const key = window.TnaiThreadHistory?.remote?.() || '';
    if (key) openMenu(moreButton, key);
  });

  // 116 draws the head once per detail box: the button is put back whenever it was drawn.
  function placeButton() {
    const actions = document.querySelector('.tnh-view .ap-far .ap-actions');
    if (actions && moreButton.parentNode !== actions) actions.append(moreButton);

    // No "..." once the shown agent left the list or another agent took its row: the box then
    // keeps the old name with no button (security review 16, 2.5 and 2.9).
    const key = window.TnaiThreadHistory?.remote?.() || '';
    moreButton.hidden = !key || !rowOf(key);
  }
  ['tnai:remote-agents-changed', 'tnai:thread-view', 'tnai:threads-painted'].forEach(name =>
    window.addEventListener(name, () => setTimeout(placeButton, 0))
  );

  // A right press on another computer's row of the thread list: that thread opens and its menu
  // stands at the row (137 calls this).
  function menuAtRow(row) {
    const key = row?.dataset?.remote || '';
    if (!key) return;
    row.click();
    setTimeout(() => {
      if (window.TnaiThreadHistory?.remote?.() === key && row.isConnected) openMenu(row, key);
    }, 30);
  }

  // ---------- the composer's Model and Effort for that agent (46) ----------
  function subject() {
    const target = window.TnaiRemoteAgents?.target?.();
    const t = target ? rowOf(target.key) : null;
    if (!t) return null;
    const name = pcName(t.pc);
    const control = t.pc.canControl === true && t.ag.can === true && !!t.ag.mark;
    const why = what =>
      !control
        ? 'Needs full control from ' + name
        : can(t.ag.cli, what)
          ? ''
          : t.ag.cli +
            ' switches its ' +
            what +
            ' in its own picker: open its CLI screen from the thread’s "..." menu';
    return {
      key: t.key,
      name: t.ag.name,
      pc: name,
      agent: t.ag.cli,
      why: {
        model: why('model'),
        effort: why('effort'),
        access:
          'Access is set on ' + name + ' itself. Agents started from here run at Ask first there.',
      },
    };
  }

  function pick(far, what, value) {
    if (!far || (what !== 'model' && what !== 'effort') || !value) return;
    const t = rowOf(far.key);
    if (!t)
      return say(far.name + ' changed or closed on ' + far.pc + ' meanwhile, so nothing was sent.');
    threadOp(far.key, what, value, t.ag);
  }

  // ====================================================================== past conversations
  let pop = null;
  let group = null;
  let one = null;
  let opened = null;
  const asked = new Set();

  // The computers whose past conversations are listed: live, in a session, and with the project
  // open here (`project` is set only then).
  const pastPcs = () =>
    (st?.on ? st.computers || [] : []).filter(
      pc => pc && pc.state === 'live' && pc.session === true && !!pc.project
    );

  function buildGroup(ui) {
    group = make('div', 'tnr-past');
    one = make('div', 'tnh-one tnr-past-one');
    one.hidden = true;
    one.innerHTML =
      '<div class="tnh-one-head"><button type="button" class="tnh-back" aria-label="All past conversations" title="All past conversations">' +
      icon('arrow-left', 16) +
      '</button><b class="tnh-one-title"></b></div><p class="tnh-one-sub"></p>' +
      '<p class="tnh-one-note"></p><div class="tnh-excerpt tnr-past-talk"></div>' +
      '<div class="tnh-one-acts"><button type="button" class="tnh-resume">Resume there</button></div>';
    ui.list.append(group);
    pop.append(one);
    one.querySelector('.tnh-back').addEventListener('click', () => {
      opened = null;
      paintOne();
    });
    one.querySelector('.tnh-resume').addEventListener('click', resume);
    group.addEventListener('click', event => {
      const row = event.target.closest('.tnh-row[data-far]');
      if (!row) return;
      const [pcId, h] = row.dataset.far.split(SEP);
      openPast(pcId, h);
    });
  }

  async function askLists() {
    for (const pc of pastPcs()) {
      if (asked.has(pc.id)) continue;
      asked.add(pc.id);
      try {
        await call('askPast', pc.id);
      } catch {
        /* not asked: the group says so */
      }
    }
    paintGroup();
  }

  // Each computer's list as the main process holds it: { state, rows: [{ h, cli, title, at }] }.
  const lists = new Map();

  async function readLists() {
    for (const pc of pastPcs()) {
      try {
        lists.set(pc.id, await call('past', pc.id));
      } catch {
        lists.delete(pc.id);
      }
    }
    paintGroup();
  }

  function rowButton(pc, row) {
    const button = make('button', 'tnh-row');
    button.type = 'button';
    button.dataset.far = pc.id + SEP + row.h;
    button.setAttribute('role', 'option');
    button.innerHTML =
      '<span class="tnh-mark" aria-hidden="true"></span><span class="tnh-row-text"><b></b><small></small></span>';
    const mark = window.TnaiCliIcons?.svg?.(row.cli) || '';
    const markNode = button.querySelector('.tnh-mark');
    if (mark) markNode.innerHTML = mark;
    else markNode.textContent = (row.cli || '?').charAt(0);
    button.querySelector('b').textContent = row.title || 'No first words';
    button.querySelector('small').textContent = [row.cli, when(row.at)].filter(Boolean).join(' · ');
    button.title = (row.title || '') + '\n' + row.cli + ' · on ' + pcName(pc);
    return button;
  }

  function paintGroup() {
    if (!group) return;
    const parts = [];
    for (const pc of pastPcs()) {
      const held = lists.get(pc.id);
      parts.push(make('div', 'tnt-menu-label', 'On ' + pcName(pc)));
      const rows = held?.rows || [];
      let note = '';
      if (!held || held.state === 'reading') note = 'Reading…';
      else if (held.state === 'no_reply')
        note =
          'No answer from ' +
          pcName(pc) +
          '. It shares them only with conversations turned on there.';
      else if (!rows.length) note = 'None in this project there.';
      else note = rows.length + ' newest, saved on ' + pcName(pc) + '. Newest first.';
      parts.push(make('p', 'tnh-note', note));
      const box = make('div', 'tnh-rows');
      box.setAttribute('role', 'listbox');
      box.setAttribute('aria-label', 'Past conversations on ' + pcName(pc));
      rows.forEach(row => box.append(rowButton(pc, row)));
      parts.push(box);
    }
    group.replaceChildren(...parts);
    group.hidden = !parts.length;
  }

  // ---------- one past conversation of another computer, read-only ----------
  function entryNode(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.k === 'you') return make('div', 'tnt-you', entry.text);
    if (entry.k === 'say') return make('div', 'tnt-say', entry.text);
    if (entry.k === 'act')
      return make('div', 'tnt-act', [entry.verb, entry.what].filter(Boolean).join(' '));
    if (entry.k === 'ask')
      return make(
        'div',
        'tnt-note',
        (entry.questions || [])
          .map(item => item.q)
          .filter(Boolean)
          .join(' · ')
      );
    if (entry.k === 'note') return make('div', 'tnt-note', entry.text);
    return null;
  }

  async function openPast(pcId, h) {
    const pc = pcOf(pcId);
    const row = lists.get(pcId)?.rows?.find(one => one.h === h);
    if (!pc || !row) return;
    opened = { pcId, h, row, held: null, at: 0 };
    paintOne();
    try {
      await call('askLog', pcId, 'past:' + h, 'first');
    } catch {
      /* the note says nothing came */
    }
    refreshOne();
  }

  async function refreshOne() {
    const mine = opened;
    if (!mine) return;
    let held = null;
    try {
      held = await call('log', mine.pcId, 'past:' + mine.h);
    } catch {
      held = null;
    }
    if (opened !== mine) return;
    mine.held = held && typeof held === 'object' ? held : null;
    paintOne();
  }

  function paintOne() {
    if (!one || !pop) return;
    const list = pop.querySelector('.tnh-list');
    const own = pop.querySelector('.tnh-one:not(.tnr-past-one)');
    if (!opened) {
      one.hidden = true;
      if (list && own?.hidden) list.hidden = false;
      return;
    }
    const pc = pcOf(opened.pcId);
    const name = pc ? pcName(pc) : 'the other computer';
    if (list) list.hidden = true;
    if (own) own.hidden = true;
    one.hidden = false;
    one.querySelector('.tnh-one-title').textContent = opened.row.title || 'No first words';
    one.querySelector('.tnh-one-sub').textContent = [
      opened.row.cli,
      'on ' + name,
      when(opened.row.at),
    ]
      .filter(Boolean)
      .join(' · ');
    const held = opened.held;
    const entries = (held?.entries || []).map(entryNode).filter(Boolean);
    let note = 'As ' + name + ' reported it. Resume continues it there, at Ask first.';
    if (!held || held.state === 'reading') note = 'Reading…';
    else if (held.state === 'no_reply') note = 'No answer from ' + name + '.';
    else if (held.state === 'busy') note = 'Busy on ' + name + '. Try again in a minute.';
    else if (!entries.length)
      note =
        'Nothing of it is shared: only what was said after the two computers were paired goes. Resume continues it there.';
    else if (held.older) note = 'As ' + name + ' reported it. Earlier parts are not shared.';
    one.querySelector('.tnh-one-note').textContent = note;
    one.querySelector('.tnr-past-talk').replaceChildren(...entries);
    const resumeButton = one.querySelector('.tnh-resume');

    // `canStart` names the CLIs that computer starts from here by their words (116 START)
    const word = { 'Claude Code': 'claude', OpenCode: 'opencode' }[opened.row.cli] || '';
    const control = !!pc && pc.canControl === true && !!word && (pc.canStart || []).includes(word);
    resumeButton.disabled = !control;
    resumeButton.title = control
      ? 'Continue this conversation in a new thread on ' + name + ', at Ask first'
      : name +
        ' has not given this computer full control, or ' +
        opened.row.cli +
        ' cannot be started there from here';
    if (!control) resumeButton.dataset.off = resumeButton.title;
    else delete resumeButton.dataset.off;
  }

  function resume() {
    const mine = opened;
    const pc = mine ? pcOf(mine.pcId) : null;
    if (!mine || !pc) return;
    const e = {
      what: 'resume',
      name: mine.row.title || 'the conversation',
      pc: pcName(pc),
      pcId: pc.id,
    };
    send(e, () => call('resume', pc.id, mine.h));
  }

  // 138: its popover was drawn. ui: its parts ({ list }); `pop`: the popover itself.
  function paintPast(popover, ui) {
    if (!popover || !ui?.list) return;
    if (pop !== popover) {
      pop = popover;
      buildGroup(ui);
    }
    if (group.parentNode !== ui.list) ui.list.append(group);
    askLists();
    paintGroup();
    paintOne();
  }

  // 138: its popover closed. The lists are asked again the next time it opens.
  function pastClosed() {
    asked.clear();
    opened = null;
    if (one) one.hidden = true;
  }

  // 138: what Tab moves through while this file's part is shown.
  function pastStops() {
    if (!pop) return null;
    if (one && !one.hidden)
      return { only: true, buttons: [...one.querySelectorAll('button')].filter(b => !b.disabled) };
    return { only: false, buttons: group ? [...group.querySelectorAll('.tnh-row')] : [] };
  }

  // ---------- the state, pushed ----------
  native.on(next => {
    st = next && typeof next === 'object' ? next : null;
    followWords();

    // after 116 has read the same state: the "..." follows whether its agent is still listed
    setTimeout(placeButton, 0);
    if (pop && !pop.hidden) {
      readLists();
      if (opened) refreshOne();
    }
  });

  // What another computer made happen here, said where it lands (the main process sends it).
  native.onNote?.(note => {
    if (note && typeof note.text === 'string' && note.text) say(note.text);
  });

  window.TnaiRemoteThreadMore = {
    rows: key => rowsFor(key).map(row => ({ id: row.id, label: row.label, off: row.off || '' })),
    open: openMenu,
    menuAtRow,
    subject,
    pick,
    paintPast,
    pastClosed,
    pastStops,
  };
})();
