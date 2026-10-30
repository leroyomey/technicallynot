/*
 * Technically Not · 119-thread-list.js — the thread layout's left island. Desktop app only; fills
 * the `list` slot of 118 (`window.TnaiThreads`) and does nothing while the thread layout is off or
 * its page is hidden.
 *
 * One thread per live session, in Terminal order: every terminal panel with a connection, in every
 * terminal workspace. A thread is shown by its agent's letter, in the color its letter has under
 * the prompt box (128 `agentColor`), dimmed when nothing runs; the line under the name says what it
 * does in plain words (183) after a dot in its status color, and the tool's own words stay in the
 * row's tip (user 2026-10-24, tab 3 of app-polish.html). "Needs you" comes first, then one group
 * per open project. A lead's sub-agents sit under it: Claude Code's own (19 `TnaiTeam`, no panel of
 * their own) as small rows, a sub-agent in its own panel (43's graph) as a thread set in. After
 * this computer's groups comes one group per other computer ("On NAME") with its agents of the open
 * project, as 116 holds them; a press on one shows it in the thread's main area (138).
 *
 * Real state only, read from what the Terminal page list reads (10's `data-status` on the panel,
 * 104 `TnaiDigest.describe`, 71 `TnaiNeedsYou`), and redrawn on the app's own push events. There is
 * no timer. For tools other than Claude Code, "what it does now" is read from the terminal's
 * output, so the row says "inferred".
 *
 * A click or Enter opens the thread (`TnaiThreads.select`); the arrow keys move. While the Agents
 * and history page shows, the press chooses that agent on that page instead (25 has no list of its
 * own), and the row marked open is the agent that page shows. "New thread" is the prompt box's own
 * New agent switch (11). Under it, once the list has 6 rows or more, a search field narrows the
 * list by name, tool or task and lists the matching past conversations after it (opened in 138's
 * popover); Esc clears it. Look: src/styles/28-thread-list.css. `window.TnaiThreadList` (`refresh`,
 * `rows`, `search`) for the desktop test `thread-list` and `tools/thread-search-check.js`.
 */
(() => {
  'use strict';
  const threads = () => window.TnaiThreads;

  // ---------- small helpers ----------
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const setAttr = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };

  // A call into another script that must never stop the list from drawing.
  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const icon = (name, size) => safe(() => window.TnaiIcon?.(name, { size }), '');

  // Joins a lead's pane id and a sub-agent's key into one row key; no id holds this character.
  const SEPARATOR = String.fromCharCode(0);
  const terminalPanels = () => document.querySelector('#terminalView .terminal-content');

  // The panel's status (10 writes it as `data-status`) as one of the list's five tones.
  const TONE = {
    working: 'work',
    starting: 'work',
    running: 'work',
    'waiting-agents': 'agents',
    background: 'work',
    'needs-you': 'needs',
    waiting: 'ready',
    done: 'ready',
    error: 'err',
    exited: 'err',
    failed: 'err',
  };
  const SUB_TONE = { running: 'work', starting: 'work', failed: 'err', done: 'idle' };

  // An agent's letter and its color: the same as its letter under the prompt box (46), so a row,
  // a letter and a helper card match.
  const letterOf = name => (String(name || '?').trim()[0] || '?').toUpperCase();
  const colorOf = name =>
    safe(() => window.TnaiAgentMarks?.agentColor?.(name), '') || 'var(--pg-accent)';

  // ---------- the island's parts ----------
  const root = make('div', 'tnt-lst');
  const newButton = make('button', 'tnt-new');
  const note = make('p', 'tnt-lst-note');
  const box = make('div', 'tnt-threads');
  const empty = make('div', 'tnt-lst-empty');
  newButton.type = 'button';
  newButton.innerHTML = icon('plus', 16) + '<span>New thread</span>';
  note.setAttribute('role', 'status');
  note.hidden = true;
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', 'Threads');
  box.setAttribute('aria-orientation', 'vertical');
  empty.append(make('b', '', 'No threads yet'), make('span', '', ''));
  root.append(newButton, note, box);

  // ---------- projects ----------
  const normal = path =>
    String(path || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const lastPart = path =>
    String(path || '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || String(path || '');

  function openProjects() {
    return safe(() => window.TnaiProjects?.list?.(), [])
      .map(project => ({
        key: normal(project.path),
        path: project.path,
        name: project.name || lastPart(project.path),
      }))
      .filter(project => project.key);
  }

  // The open project a session runs in: the one whose folder holds the session's working folder
  // (the longest match). Inferred from the folder, and the row's tip says so.
  function projectOf(session, projects) {
    const folder = normal(session.cwd);
    let best = null;
    if (!folder) return null;
    for (const project of projects) {
      const inside = folder === project.key || folder.startsWith(project.key + '/');
      if (inside && (!best || project.key.length > best.key.length)) best = project;
    }
    return best;
  }

  // A session whose process has not answered yet has no folder. Its panel's workspace belongs to a
  // project (07 records it when the workspace is made), so the row stands in that project's group
  // from its first draw, and does not start under "Other folders" and then move.
  function workspaceProject(paneId, projects) {
    const key = normal(safe(() => window.TnaiTerminalWorkspaces?.projectOfPane?.(paneId), ''));
    return (key && projects.find(project => project.key === key)) || null;
  }

  // ---------- reading the live sessions ----------
  const clock = at => safe(() => (at ? new Date(at).toTimeString().slice(0, 5) : ''), '');

  // A row's time (172): a clock today, "Yesterday" or a date before; the full date on hover.
  const shortTime = at => safe(() => window.TnaiTimes?.short?.(at), '') || clock(at);
  const fullTime = at => safe(() => window.TnaiTimes?.full?.(at), '') || clock(at);

  // The panel of a sub-agent's lead, when the sub-agent runs in a panel of its own (43).
  function leadOf(paneId) {
    return safe(() => {
      const node = window.TnaiGraph?.node?.(paneId);
      if (!node?.parentId) return '';
      const nodes = window.TnaiGraph.state?.().nodes || [];
      return nodes.find(other => other.id === node.parentId)?.paneId || '';
    }, '');
  }

  function readThread(panel, session, projects, nameOf) {
    const id = panel.dataset.paneId;
    const status = panel.dataset.status || session.status || '';
    const digest = safe(() => window.TnaiDigest?.describe?.(panel, session), null);
    const label = panel.querySelector('.terminal-pane-state span')?.textContent.trim() || '';
    const needs = status === 'needs-you' || safe(() => !!window.TnaiNeedsYou?.has?.(id), false);

    // Paused by a usage limit (15 detects it): the row says so in words, and its card stands in
    // the thread (125).
    const limited = safe(() => !!window.TnaiAccounts?.limitFor?.(id), false);

    // A question or an error is worth more than "what it does now": it takes the row's line.
    const flagged = !!digest && (digest.tone === 'ask' || digest.tone === 'bad') && !!digest.last;
    const turn = safe(() => window.TnaiTurns?.get?.(id), null);

    // When it last did something: the end of its last task, or the start of the one it works on
    // now, or the session's start.
    const ended = turn?.endedAt && turn.endedAt >= (turn.startedAt || 0) ? turn.endedAt : 0;
    const at = ended || turn?.startedAt || session.startedAt || 0;

    // What the old agent cards carried beside the status, each read from the script that owns
    // it: messages with another agent (11, exact: `tnai send`), a team the user made (88), Claude
    // in Chrome in use now (87), and a large context (76, only from its warning level on).
    const running = session.running !== false;
    const talk = running && !limited ? safe(() => window.TnaiLiveTasks?.talk?.(id), null) : null;

    // Each of these is a lookup in a list its script already holds: none builds the sessions
    // again (the team's names come from the sessions this pass read once).
    const mates = safe(() => window.TnaiAgentTeams?.mates?.(id), []);
    const browser = safe(() => window.TnaiChromeBrowser?.active?.(id), null);
    const context = running ? turn?.context : null;

    // Another agent stopped it (`tnai intervene`, 11): the row's line says who, for the few
    // seconds 11 keeps that note. And a checklist the agent reports (Claude Code, OpenCode): how
    // far it is, after what it does now. Both stood on the old Overview's rows and had no place.
    const cut = running ? safe(() => window.TnaiLiveTasks?.interrupted?.(id), null) : null;
    const steps = running && turn && !turn.endedAt ? turn.steps : null;
    const count = steps?.total > 0 ? steps.index + '/' + steps.total : '';
    const stopped = !running && (!digest || digest.now === 'Not running');
    const doing = digest ? (flagged ? digest.last : stopped ? 'Stopped' : digest.now) : label;

    // Waiting on another agent: it asked that agent with the tnai command and has no answer yet
    // (37), or its own helpers still run (10). A violet tone of its own, never the blue of "free",
    // so a thread still tied to another's work is not closed by mistake. While it
    // works itself, "working" wins.
    const waitedOn = running ? safe(() => window.TnaiMesh?.waitsOn?.(id), []) : [];
    const waitingOn =
      waitedOn.length > 0 && status !== 'working' && status !== 'starting'
        ? 'Waiting on ' +
          waitedOn.slice(0, 2).map(nameOf).join(', ') +
          (waitedOn.length > 2 ? ' +' + (waitedOn.length - 2) : '')
        : '';

    // A built-in command the CLI runs, a compact above all (158): what the row says while it runs.
    const busy =
      running && !limited && !needs ? safe(() => window.TnaiCliBusy?.get?.(id), null) : null;
    const tone =
      needs || limited ? 'needs' : busy ? 'work' : waitingOn ? 'agents' : TONE[status] || 'idle';

    // A draft typed for this thread and not sent (16): its first words, unless the thread works
    // or needs the user, which say more.
    const typed = safe(() => window.TnaiDrafts?.of?.(id), '')
      .trim()
      .replace(/\s+/g, ' ');
    const draft = typed && tone !== 'needs' && tone !== 'work' && status !== 'working' ? typed : '';

    // Something new since the user last looked (174): a dot after the name, and what happened on
    // the time's hover.
    const unread = safe(() => !!window.TnaiUnread?.has?.(id), false);

    // When the line is the tool call in plain words (183), the call as the tool reported it and
    // the folder a command runs in: the row's tip and the Working line (122) use them.
    const plainLine = !!digest && !flagged && !limited && !busy && !cut && !waitingOn;
    return {
      nowRaw: plainLine ? digest.nowRaw || '' : '',
      nowFolder: plainLine ? digest.nowFolder || '' : '',
      unread,
      unreadTip: unread ? safe(() => window.TnaiUnread.tip(id), '') : '',
      draft: draft.length > 60 ? draft.slice(0, 60) + '…' : draft,
      busy,
      talk,
      team: mates.map(nameOf).join(', '),
      browser: browser ? (browser.waiting ? 'thinking' : 'in use') : '',
      context: context?.tokens > 0 ? context : null,
      id,
      session,
      name: session.name || panel.querySelector('.terminal-pane-title')?.textContent || 'Terminal',
      tool: session.agent || 'Terminal',
      tone,

      // The panel's own status word (10): the conversation's live line tells "working in
      // background" and "waiting on agents" apart from a reply that runs.
      status,
      label: limited ? 'Usage limit reached' : busy ? busy.words : waitingOn || label,
      now: limited
        ? 'Usage limit reached'
        : busy
          ? busy.words + ' · ' + busy.clock
          : cut
            ? 'Interrupted by ' + cut.by
            : waitingOn && !flagged
              ? waitingOn
              : [doing, count].filter(Boolean).join(' · '),
      inferred: busy
        ? busy.inferred
        : !limited && !cut && !!digest && !flagged && !!digest.inferred,
      task: digest?.task || '',
      needs,
      project: session.cwd ? projectOf(session, projects) : workspaceProject(id, projects),
      projectFrom: session.cwd ? 'folder' : 'workspace',
      lead: leadOf(id),
      time: shortTime(at),
      timeTip: !at
        ? ''
        : (ended
            ? 'Its last task ended '
            : turn?.startedAt
              ? 'Its current task started '
              : 'This session started ') + fullTime(at),
    };
  }

  // Every live session as a thread, in Terminal order (workspace after workspace). A panel with no
  // connection is not a thread.
  function readThreads(projects) {
    const host = terminalPanels();
    if (!host || !window.TnaiAgents?.sessions) return [];
    const sessions = safe(() => window.TnaiAgents.sessions(), []);
    const live = new Map(sessions.map(session => [session.paneId, session]));
    const nameOf = paneId => live.get(paneId)?.name || 'another agent';

    // The user's own plain terminal (136) is a session too, but it is not a thread: it has its
    // tab in the side column.
    const ownTerminal = paneId => safe(() => !!window.TnaiOwnTerminal?.owns(paneId), false);
    return [...host.querySelectorAll('.terminal-pane[data-pane-id]')]
      .filter(panel => live.has(panel.dataset.paneId) && !ownTerminal(panel.dataset.paneId))
      .map(panel => readThread(panel, live.get(panel.dataset.paneId), projects, nameOf));
  }

  // ---------- rows ----------
  // A row is kept and updated in place, so focus, hover and scrolling survive a redraw. A panel's
  // key is its pane id; a Claude Code sub-agent's is its lead's id, a zero character and its key.
  const rows = new Map();

  function rowFor(key, paneId, isSub) {
    let row = rows.get(key);
    if (row) return row;
    row = makeRow(key, paneId, isSub, !isSub);
    rows.set(key, row);
    return row;
  }

  function makeRow(key, paneId, isSub, withClose) {
    const row = make('button', isSub ? 'tnt-th tnt-sub' : 'tnt-th');
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.tabIndex = -1;
    row.dataset.pane = paneId;
    row.dataset.key = key;

    // The agent's letter, the name and time, and under them a status dot and what it does now.
    row.innerHTML =
      '<span class="tnt-av" aria-hidden="true"></span><b></b><time></time><small>' +
      '<i class="tnt-dot" aria-hidden="true"></i><span class="tnt-th-line">' +
      '<span class="tnt-th-tool"></span><span class="tnt-th-now"></span></span>' +
      '<i class="tnt-th-inf" hidden>· inferred</i></small>';

    // A thread's own ✕, shown on hover. It is a mark inside the row, not a
    // second button, since a button may not hold one: the list's click handler reads it, and
    // Delete on a focused row does the same for the keyboard. A Claude Code sub-agent has no
    // panel to close, so its small row gets none, and neither does a past conversation's.
    if (withClose) {
      const close = make('i', 'tnt-th-x');
      close.title = 'Close thread';
      close.setAttribute('aria-hidden', 'true');
      close.innerHTML = safe(() => window.TnaiIcon?.('x', { size: 14 }), '') || '';
      row.append(close);
    }
    return row;
  }

  // The letter in the agent's own color; dimmed while nothing runs, as a stopped agent's letter
  // under the prompt box is.
  function paintLetter(row, name, asleep) {
    const mark = row.querySelector('.tnt-av');
    setText(mark, letterOf(name));
    const color = colorOf(name);
    if (mark.style.getPropertyValue('--c') !== color) mark.style.setProperty('--c', color);
    if (asleep !== mark.hasAttribute('data-asleep')) mark.toggleAttribute('data-asleep', asleep);
  }

  function fillRow(row, view) {
    setText(row.querySelector('b'), view.name);
    setText(row.querySelector('time'), view.time || '');
    setAttr(row.querySelector('time'), 'title', view.unreadTip || view.timeTip || '');
    if (!!view.unread !== row.hasAttribute('data-unread'))
      row.toggleAttribute('data-unread', !!view.unread);

    // What stands before the words (the project in "Needs you", "↔ NAME"), then the words.
    const before = view.tool || '';
    const gap = before ? ' · ' : '';
    setText(row.querySelector('.tnt-th-tool'), before);
    const now = row.querySelector('.tnt-th-now');
    if (view.draft) {
      // "Draft:" in the accent, then the draft's first words (16)
      const drawn = gap + view.draft;
      if (now.dataset.draft !== drawn) {
        now.dataset.draft = drawn;
        now.replaceChildren(gap, make('em', 'tnt-th-draft', 'Draft:'), ' ' + view.draft);
      }
    } else {
      delete now.dataset.draft;
      setText(now, view.now ? gap + view.now : '');
    }
    row.querySelector('.tnt-th-inf').hidden = !view.inferred;
    if (row.dataset.tone !== view.tone) row.dataset.tone = view.tone;
    row.classList.toggle('tnt-kid', !!view.kid);
    setAttr(row, 'aria-selected', String(!!view.on));
    if (row.title !== view.tip) row.title = view.tip;
    paintLetter(row, view.letterName || view.name, view.tone === 'idle' || view.tone === 'err');
  }

  // What a Claude Code sub-agent does now, in a few words (183), and the call as reported.
  function subNow(sub, leadRuns) {
    if (leadRuns && sub.status === 'running' && sub.now) {
      const plain = safe(() => window.TnaiPlainWords?.step?.(sub.now.tool, sub.now.detail), null);
      const raw = sub.now.tool + (sub.now.detail ? ' · ' + sub.now.detail : '');
      return { text: plain?.text || raw, raw };
    }
    const word = text => ({ text, raw: '' });
    if (sub.status === 'done') return word('Done');
    if (sub.status === 'failed') return word('Failed');
    if (!leadRuns) return word('Stopped with its lead');
    if (sub.status === 'starting') return word(sub.asking ? 'Waiting for approval' : 'Starting');
    return word('Running');
  }

  function threadTip(thread) {
    return (
      thread.name +
      ' · ' +
      thread.tool +
      (thread.label ? ' · ' + thread.label : '') +
      (thread.project
        ? '\nProject: ' + thread.project.name + ' (from its ' + thread.projectFrom + ')'
        : '') +
      (thread.task ? '\nTask: ' + thread.task : '') +
      (thread.now
        ? '\nNow: ' +
          thread.now +
          (thread.nowFolder ? ' in ' + thread.nowFolder : '') +
          (thread.inferred ? ' (inferred)' : '')
        : '') +
      // the call as the tool reported it, word for word (the line says it in plain words)
      (thread.nowRaw && thread.nowRaw !== thread.now ? '\n' + thread.nowRaw : '') +
      (thread.team ? '\nTeam: with ' + thread.team : '') +
      (thread.browser ? '\nBrowser: Claude in Chrome, ' + thread.browser + ' now' : '') +
      (thread.context ? '\nContext: ' + contextWords(thread.context) : '') +
      (thread.talk ? '\n\n' + thread.talk.tip : '') +
      '\n\nOpen this thread'
    );
  }

  // "420k tokens, 42% of its window": the size of the conversation as the tool reported it with
  // its last task (42). A plain fact; when it is large is 76's to say, on the terminal panel.
  function contextWords(context) {
    const size = safe(() => window.TnaiTurns?.format?.tokens?.(context.tokens), '');
    const share = context.window > 0 ? Math.round((context.tokens / context.window) * 100) : 0;
    return (size || context.tokens) + ' tokens' + (share ? ', ' + share + '% of its window' : '');
  }

  // ---------- drawing ----------
  let shownPick = '';
  let autoPicked = '';
  let seenIds = null;
  let wantNew = false;

  // Which thread is open. One that started right after "New thread" is opened; so is the first one
  // when nothing is picked or the picked panel is gone.
  function settlePick(all) {
    const frame = threads();
    const ids = new Set(all.map(thread => thread.id));
    let picked = frame.selected() || '';
    const fresh = seenIds ? all.filter(thread => !seenIds.has(thread.id)) : [];
    seenIds = ids;
    let pickNow = wantNew && fresh.length === 1 ? fresh[0].id : '';
    if (!pickNow && !ids.has(picked))
      pickNow = (all.find(thread => thread.needs) || all[0])?.id || '';
    if (fresh.length) wantNew = false;
    if (pickNow && pickNow !== picked && pickNow !== autoPicked) {
      autoPicked = pickNow;
      frame.select(pickNow);
      picked = frame.selected() || picked;
    }
    if (ids.has(picked) && picked !== autoPicked) autoPicked = '';
    return picked;
  }

  // The rows of one group, in order: each thread, its Claude Code sub-agents, then the sub-agents
  // that run in panels of their own.
  function groupRows(items, picked, withProject, out, alive) {
    const inGroup = new Set(items.map(thread => thread.id));
    const under = new Map();
    items.forEach(thread => {
      if (thread.lead && inGroup.has(thread.lead))
        under.set(thread.lead, [...(under.get(thread.lead) || []), thread]);
    });

    const put = (thread, kid) => {
      const row = rowFor(thread.id, thread.id, false);
      alive.add(thread.id);
      findText.set(
        thread.id,
        searchable([thread.name, thread.tool, thread.task, thread.project?.name])
      );
      fillRow(row, {
        name: thread.name,
        time: thread.time,
        timeTip: thread.timeTip,
        letterName: thread.session.name || thread.name,

        // "↔ NAME" stands before what the agent does now: it is exact, and "inferred" at the
        // line's end then still stands beside the part it is about. The tool's name is in the tip.
        tool: [
          withProject && thread.project ? thread.project.name : '',
          thread.talk ? '↔ ' + thread.talk.label : '',
        ]
          .filter(Boolean)
          .join(' · '),
        now: thread.now,
        draft: thread.draft,
        unread: thread.unread,
        unreadTip: thread.unreadTip,
        inferred: thread.inferred,
        tone: thread.tone,
        kid,
        on: thread.id === picked,
        tip: threadTip(thread),
      });
      out.push(row);

      // Claude Code's own sub-agents have no panel: their row opens the lead's thread.
      const subs = safe(() => window.TnaiTeam?.get?.(thread.id)?.subs, []);
      subs.forEach(sub => {
        const key = thread.id + SEPARATOR + sub.key;
        const row = rowFor(key, thread.id, true);
        const what =
          (sub.alias ? sub.alias + ' · ' : '') + (sub.description || sub.type || 'Sub-agent');
        const leadRuns = thread.session.running !== false;
        const doing = subNow(sub, leadRuns);
        alive.add(key);
        findText.set(key, searchable([what, sub.type, 'sub-agent']));
        const subAt = sub.endedAt || sub.startedAt || 0;
        fillRow(row, {
          name: what,
          time: shortTime(subAt),
          timeTip: subAt ? (sub.endedAt ? 'Ended ' : 'Started ') + fullTime(subAt) : '',
          letterName: sub.alias || sub.description || sub.type || 'Sub-agent',
          tool: '',
          now: doing.text,
          tone: !leadRuns && sub.status !== 'done' ? 'err' : SUB_TONE[sub.status] || 'idle',
          on: false,
          tip:
            what +
            ' · sub-agent of ' +
            thread.name +
            '\nNow: ' +
            doing.text +
            (doing.raw ? '\n' + doing.raw : '') +
            '\n\nIt has no thread of its own: this opens the thread of ' +
            thread.name,
        });
        out.push(row);
      });
      (under.get(thread.id) || []).forEach(child => put(child, true));
    };
    items
      .filter(thread => !(thread.lead && inGroup.has(thread.lead)))
      .forEach(thread => put(thread, false));
  }

  // ---------- other computers ----------
  // The agents of the user's other computers that work in the project open here, as this computer
  // holds them (116 `TnaiRemoteAgents.shown`: the pushed state of the paired computers, nothing
  // asked for). A row says only what that computer reported: name, tool, state and task. Nothing
  // is known while connecting is off or nothing is paired, and then there is no group.
  const REMOTE_TONE = { working: 'work', needs: 'needs', idle: 'idle' };
  const REMOTE_WORD = { working: 'Working', needs: 'Needs you', idle: 'Idle' };
  const readComputers = () => safe(() => window.TnaiRemoteAgents?.shown?.(), []);

  // The agent of another computer that fills the thread's main area now (138 shows it there and
  // takes the press on its row), or ''.
  const openRemoteKey = () => safe(() => window.TnaiThreadHistory?.remote?.(), '') || '';

  function remoteRows(computer, openKey, out, alive) {
    computer.agents.forEach(agent => {
      const key = 'remote' + SEPARATOR + agent.key;
      const row = rowFor(key, '', false);
      const word = REMOTE_WORD[agent.status];
      const now = agent.status === 'needs' ? word : agent.task || word;
      const time = agent.status === 'working' ? clock(agent.since) : '';
      row.dataset.remote = agent.key;
      alive.add(key);
      findText.set(key, searchable([agent.name, agent.cli, agent.task, computer.name]));
      fillRow(row, {
        name: agent.name,
        time,
        timeTip: time ? 'Working since ' + time + ', as ' + computer.name + ' reports' : '',
        letterName: agent.name,
        tool: '',
        now,
        inferred: false,
        tone: REMOTE_TONE[agent.status],
        on: agent.key === openKey,
        tip:
          agent.name +
          (agent.cli ? ' · ' + agent.cli : '') +
          ' · on ' +
          computer.name +
          '\nState: ' +
          word +
          (agent.task ? '\nTask: ' + agent.task : '') +
          '\nAs ' +
          computer.name +
          ' reports it. It runs there, not on this computer.' +
          '\n\nOpen what this computer can show of it',
      });
      out.push(row);
    });
  }

  // Why some agents of another computer are not listed (rule: only agents known to work in the
  // project open here). One muted line, in the list's own note look; the same node while its words
  // are the same, so the list is not drawn again for it.
  const readHidden = () => safe(() => window.TnaiRemoteAgents?.notShown?.(), []) || [];
  const whyLines = new Map();

  function whyLine(item) {
    const parts = [];
    if (item.elsewhere)
      parts.push(
        item.elsewhere === 1
          ? '1 agent in another project.'
          : item.elsewhere.toLocaleString('en-US') + ' agents in other projects.'
      );
    if (item.unsure) parts.push('Open the same git project to see them here.');
    const words = parts.join(' ');
    const known = whyLines.get(item.id);
    if (known && known.textContent === words) return known;
    const node = make('p', 'tnt-lst-note tnt-why', words);
    whyLines.set(item.id, node);
    return node;
  }

  function heading(text, count, tip) {
    const head = make('div', 'tnt-proj');
    head.append(make('span', '', text), make('em', '', count));
    if (tip) head.title = tip;
    return head;
  }

  function buildList(all, projects, picked, computers, openKey) {
    const out = [];
    const alive = new Set();
    const needs = all.filter(thread => thread.needs);
    const rest = all.filter(thread => !thread.needs);
    if (needs.length) {
      out.push(
        heading(
          'Needs you',
          String(needs.length),
          'Agents stopped on a question, a permission or a held message'
        )
      );
      groupRows(needs, picked, true, out, alive);
    }
    projects.forEach(project => {
      const mine = rest.filter(thread => thread.project === project);
      if (!mine.length) return;
      out.push(heading(project.name, mine.length + ' open', project.path));
      groupRows(mine, picked, false, out, alive);
    });
    const other = rest.filter(thread => !thread.project);
    if (other.length) {
      const title = projects.length ? 'Other folders' : 'Threads';
      const tip = projects.length ? 'Running in a folder that is not one of the open projects' : '';
      out.push(heading(title, other.length + ' open', tip));
      groupRows(other, picked, false, out, alive);
    }
    const hidden = readHidden();
    computers.forEach(computer => {
      const count = computer.agents.length;
      out.push(
        heading(
          'On ' + computer.name,
          count + (count === 1 ? ' agent' : ' agents'),
          'Agents on ' +
            computer.name +
            ' that work in this project. What is shown is what that computer reports.'
        )
      );
      remoteRows(computer, openKey, out, alive);
      const why = hidden.find(item => item.id === computer.id);
      if (why) out.push(whyLine(why));
    });

    // A computer none of whose agents can be listed here still gets its group, with the line
    // that says why: a computer that connected late otherwise shows nothing and nobody can tell.
    hidden
      .filter(item => !computers.some(computer => computer.id === item.id))
      .forEach(item => {
        out.push(
          heading(
            'On ' + item.name,
            'none here',
            'Agents on ' + item.name + ' are listed here when they work in this project.'
          )
        );
        out.push(whyLine(item));
      });
    [...rows.keys()].forEach(key => {
      if (alive.has(key)) return;
      rows.delete(key);
      findText.delete(key);
    });
    return out;
  }

  // ---------- search ----------
  // A field under New thread narrows the list to the rows whose name, tool or task holds every
  // typed word, under their own headings, in the same order; the open project's past
  // conversations that match follow under their own heading. The rows are the same nodes, so
  // clearing the field gives the list back exactly as it was: order, "Needs you" first, the open
  // thread, the scroll. The field stands only once the list is long enough to need it, or while
  // it holds words or the keyboard.
  const SEARCH_FROM = 6;
  const PAST_SHOWN = 40;
  const findText = new Map();
  const searchable = parts => parts.filter(Boolean).join(' ').toLowerCase();
  const wordsOf = text =>
    String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  const find = make('label', 'tnt-lst-find');
  find.innerHTML =
    icon('search', 15) +
    '<input type="text" role="searchbox" placeholder="Search threads" autocomplete="off" ' +
    'spellcheck="false" aria-label="Search threads by name, tool or task">' +
    '<button type="button" class="tnt-lst-find-x" title="Clear the search (Esc)" ' +
    'aria-label="Clear the search" hidden>' +
    icon('x', 14) +
    '</button>';
  find.hidden = true;
  const field = find.querySelector('input');
  const clearButton = find.querySelector('.tnt-lst-find-x');
  const none = make('p', 'tnt-lst-note tnt-lst-none');
  none.setAttribute('role', 'status');
  root.insertBefore(find, note);

  // Where the list was scrolled before the first word was typed: given back when it is cleared.
  let scrollBefore = null;

  function showFind(rowCount) {
    const want = rowCount >= SEARCH_FROM || !!field.value || document.activeElement === field;
    if (find.hidden === want) find.hidden = !want;
    if (clearButton.hidden === !!field.value) clearButton.hidden = !field.value;
  }

  // Only the rows that match, each group under its heading; a group with no match goes with its
  // heading, and so do the lines that say why another computer's agents are not listed.
  function narrow(kids, words) {
    const out = [];
    let head = null;
    kids.forEach(kid => {
      if (kid.classList.contains('tnt-proj')) {
        head = kid;
        return;
      }
      if (!kid.classList.contains('tnt-th')) return;
      const text = findText.get(kid.dataset.key) || '';
      if (!words.every(word => text.includes(word))) return;
      if (head) out.push(head);
      head = null;
      out.push(kid);
    });
    return out;
  }

  // The open project's past conversations, read once from the main process (the list the foot's
  // Past conversations popover reads, 117) when a search starts, and let go when it is cleared.
  let pastState = 'idle';
  let pastList = [];
  let pastAsk = 0;
  const pastRows = new Map();

  function readPast() {
    const native = window.tnaiNative?.threads;
    if (pastState !== 'idle' || !native?.list) return;
    const mine = ++pastAsk;
    pastState = 'reading';
    const done = list => {
      if (mine !== pastAsk) return;
      pastList = list;
      pastState = 'ready';
      refresh();
    };
    Promise.resolve(native.list())
      .then(result => {
        const ok = !!result && result.ok !== false && Array.isArray(result.threads);
        const valid = thread =>
          !!thread &&
          typeof thread.key === 'string' &&
          typeof thread.id === 'string' &&
          typeof thread.cli === 'string';
        done(ok ? result.threads.filter(valid) : []);
      })
      .catch(() => done([]));
  }

  function forgetPast() {
    pastAsk++;
    pastState = 'idle';
    pastList = [];
    pastRows.clear();
  }

  // The matching past conversations, under their own heading. One that runs in a thread now is
  // that thread, already in the list above.
  function pastMatches(words, out) {
    const sessions = safe(() => window.TnaiAgents.sessions(), []);
    const running = thread =>
      sessions.some(
        session =>
          session.sessionId && session.sessionId === thread.id && session.agent === thread.cli
      );
    const found = pastList
      .filter(thread => {
        const text = searchable([thread.title, thread.cli, thread.name]);
        return words.every(word => text.includes(word)) && !running(thread);
      })
      .slice(0, PAST_SHOWN);
    if (!found.length) return;
    out.push(
      heading(
        'Past conversations',
        String(found.length),
        'Conversations of this project saved on this computer: a press shows one, with Resume'
      )
    );
    found.forEach(thread => {
      const key = 'past' + SEPARATOR + thread.key;
      let row = pastRows.get(key);
      if (!row) {
        row = makeRow(key, '', false, false);
        row.dataset.past = thread.key;
        pastRows.set(key, row);
      }
      const title = thread.title || 'No first words';
      fillRow(row, {
        name: title,
        time: shortTime(thread.at),
        timeTip: thread.at > 0 ? 'Last saved ' + fullTime(thread.at) : '',
        letterName: thread.cli,
        tool: thread.cli,
        now: thread.name || '',
        tone: 'idle',
        on: false,
        tip:
          title +
          '\n' +
          thread.cli +
          (thread.name ? ' · ' + thread.name : '') +
          '\n\nShow this past conversation, with Resume',
      });
      out.push(row);
    });
  }

  // A past conversation's row opens the foot's popover (138) at that conversation. The list in
  // the popover is read again when it opens, so the conversation is chosen once it is there.
  function openPast(key) {
    const history = window.TnaiPastThreads;
    if (!history || !window.TnaiThreadHistory?.open) return;
    const choose = () => {
      const known = history.state();
      if (!known.shown || known.state === 'failed') return true;
      if (known.state !== 'ready') return false;
      history.select(key);
      return true;
    };
    window.TnaiThreadHistory.open();
    if (choose()) return;
    const wait = () => {
      if (choose()) window.removeEventListener('tnai:past-threads-changed', wait);
    };
    window.addEventListener('tnai:past-threads-changed', wait);
  }

  field.addEventListener('input', () => {
    if (field.value && scrollBefore == null) scrollBefore = box.scrollTop;
    if (field.value) box.scrollTop = 0;
    clearButton.hidden = !field.value;
    refresh();
  });

  function clearSearch() {
    if (!field.value) return;
    field.value = '';
    clearButton.hidden = true;
    refresh();
  }

  clearButton.addEventListener('click', event => {
    // the press is the button's, not the label's (a label hands its clicks to the field)
    event.preventDefault();
    clearSearch();
    field.focus({ preventScroll: true });
  });

  // Esc clears (and only then is the key taken); Esc on an empty field gives the keyboard back.
  // Down goes to the first row, Enter opens it.
  field.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const first = box.querySelector('.tnt-th');
    if (event.key === 'Escape') {
      if (field.value) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
      } else field.blur();
    } else if (event.key === 'ArrowDown' && first) {
      event.preventDefault();
      box.querySelectorAll('.tnt-th').forEach(row => {
        row.tabIndex = row === first ? 0 : -1;
      });
      first.focus();
    } else if (event.key === 'Enter' && first) {
      event.preventDefault();
      first.click();
    }
  });
  field.addEventListener('blur', () => refresh());

  window.addEventListener('tnai:project-changed', forgetPast);

  // The same nodes in the same order are left alone: nothing moves, so focus and scrolling stay.
  // Headings are new nodes each time and are compared by their words.
  function sameAsShown(kids) {
    if (kids.length !== box.children.length) return false;
    return kids.every((kid, index) => {
      const shown = box.children[index];
      if (shown === kid) return true;
      const bothHeadings = kid.className === 'tnt-proj' && shown.className === 'tnt-proj';
      return bothHeadings && shown.textContent === kid.textContent && shown.title === kid.title;
    });
  }

  // One row takes Tab: the focused one, else the open thread, else the first.
  function setTabStop() {
    const all = [...box.querySelectorAll('.tnt-th')];
    const stop =
      all.find(row => row === document.activeElement) ||
      all.find(row => row.getAttribute('aria-selected') === 'true') ||
      all[0];
    all.forEach(row => {
      const want = row === stop ? 0 : -1;
      if (row.tabIndex !== want) row.tabIndex = want;
    });
  }

  // A newly opened thread's row is brought into view once; the user's own scrolling is left alone.
  function revealPick(picked) {
    const row = rows.get(picked);
    if (!row?.isConnected || picked === shownPick || !box.clientHeight) return;
    const area = box.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < area.top) box.scrollTop -= area.top - at.top;
    else if (at.bottom > area.bottom) box.scrollTop += at.bottom - area.bottom;
    shownPick = picked;
  }

  function paint() {
    const slot = threads()?.slot('list');
    if (!slot) return;
    if (root.parentNode !== slot) slot.replaceChildren(root);
    const projects = openProjects();
    const all = readThreads(projects);
    const picked = settlePick(all);

    // While another computer's agent is the open one, no thread of this computer is marked open.
    const openKey = openRemoteKey();
    const marked = openKey ? '' : picked;
    let kids = buildList(all, projects, marked, readComputers(), openKey);
    showFind(kids.filter(kid => kid.classList.contains('tnt-th')).length);
    const words = wordsOf(field.value);
    if (words.length) {
      kids = narrow(kids, words);
      readPast();
      pastMatches(words, kids);
      if (!kids.length) {
        const reading = pastState === 'reading';
        setText(none, reading ? 'Looking through past conversations…' : 'No threads match');
        kids.push(none);
      }
    } else if (pastState !== 'idle') forgetPast();
    if (!kids.length) {
      setText(empty.lastChild, 'Every agent and terminal you start shows here as a thread.');
      kids.push(empty);
    }

    // Putting the rows in again takes a row that is being pressed out of the list for a moment,
    // and may move it away from the pointer: either way its click is never sent. With a press in
    // progress on the list, the rows are put in right after that press.
    const pressed = !sameAsShown(kids) && window.TnaiPress?.defer(box, paint);
    if (!pressed && !sameAsShown(kids)) {
      const focusedKey = box.contains(document.activeElement)
        ? document.activeElement.dataset.key
        : null;
      box.replaceChildren(...kids);
      if (focusedKey != null)
        (rows.get(focusedKey) || pastRows.get(focusedKey) || box.querySelector('.tnt-th'))?.focus({
          preventScroll: true,
        });
    }

    // the search was cleared: the list stands where it stood before the first word
    if (!words.length && scrollBefore != null && !pressed) {
      box.scrollTop = scrollBefore;
      scrollBefore = null;
    }
    setTabStop();
    revealPick(picked);
    paintNew();
    window.dispatchEvent(new CustomEvent('tnai:threads-painted'));
  }

  // ---------- New thread: the prompt box's own New agent switch (11) ----------
  const armed = () => safe(() => !!window.TnaiLiveTasks?.newAgent?.(), false);

  function paintNew() {
    const can = !!window.TnaiLiveTasks?.newAgent;
    newButton.disabled = !can;
    setAttr(newButton, 'aria-pressed', String(armed()));
    newButton.title = !can
      ? 'Agents run in the desktop app'
      : armed()
        ? 'Your next prompt starts a new agent · press again to turn this off'
        : 'Start a new agent: type its task in the prompt box';
  }

  function newThread() {
    const live = window.TnaiLiveTasks;
    if (!live?.newAgent) return;
    setText(note, '');
    note.hidden = true;

    // The switch's own button also applies the tool the user chose for new agents (46).
    const own = document.querySelector('.tnai-new-agent');
    if (own) own.click();
    else live.newAgent(!armed());
    wantNew = armed();
    if (wantNew) {
      document.getElementById('prompt')?.focus({ preventScroll: true });
      setText(note, 'Type the task below. It starts a new agent as its own thread.');
      note.hidden = false;
    }
    paintNew();
  }
  newButton.addEventListener('click', newThread);

  // ---------- opening a thread, moving with the keys ----------
  box.addEventListener('click', event => {
    const row = event.target.closest?.('.tnt-th');
    if (!row || !box.contains(row)) return;

    // a past conversation found by the search: it opens in the foot's popover, not as a thread
    if (row.dataset.past) {
      openPast(row.dataset.past);
      return;
    }

    // Another computer's agent is not a thread of this computer: 138 takes that press before
    // this handler and shows the agent in the thread's main area. Nothing is chosen here.
    if (row.dataset.remote) return;
    if (event.target.closest('.tnt-th-x')) {
      closeRow(row);
      return;
    }
    threads()?.select(row.dataset.pane);
    refresh();

    // a sub-agent's row opens its lead split evenly with that helper (123, user 2026-10-23)
    if (row.classList.contains('tnt-sub')) {
      const subKey = String(row.dataset.key || '').split(SEPARATOR)[1] || '';
      requestAnimationFrame(() => window.TnaiThreadHelpers?.open?.(subKey));
    }
  });

  // Closes a row's thread the way the thread's own "..." menu does (137): it asks first, over the
  // open thread, while the agent still runs.
  function closeRow(row) {
    if (!row.dataset.pane || row.dataset.remote || row.classList.contains('tnt-sub')) return;
    window.TnaiLiveTasks?.close?.(row.dataset.pane, document.querySelector('.tnt-view'));
  }

  // Up, Down, Home and End move the keyboard between rows here; 175 then opens the row they
  // reached (user 2026-10-23), so this handler must keep taking the key when it moves.
  box.addEventListener('keydown', event => {
    const row = event.target.closest?.('.tnt-th');
    if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      closeRow(row);
      return;
    }
    const all = [...box.querySelectorAll('.tnt-th')];
    const at = all.indexOf(row);
    let to = null;
    if (event.key === 'ArrowDown') to = all[at + 1];
    else if (event.key === 'ArrowUp') to = all[at - 1];
    else if (event.key === 'Home') to = all[0];
    else if (event.key === 'End') to = all[all.length - 1];

    // Up from the first row goes back to the search field, when it stands.
    if (!to && event.key === 'ArrowUp' && at === 0 && !find.hidden) {
      event.preventDefault();
      field.focus();
      return;
    }
    if (!to) return;
    event.preventDefault();
    all.forEach(other => {
      other.tabIndex = other === to ? 0 : -1;
    });
    to.focus();

    // 175 opens the row the keys reached; a past conversation's row opens a popover that would
    // take the keyboard, so it is only reached, and Enter opens it.
    if (to.dataset.past) event.stopPropagation();
  });

  // ---------- live, and only while the page shows ----------
  // Pushed by the app: sessions (10), sub-agents (19), who helps whom (43), task start and end
  // (42), needs you and held prompts (71), what an agent does now (53, 13), names, panels closing,
  // the prompt box's New agent switch (11), projects (09). Never the terminals' own output.
  const EVENTS = [
    'tnai:team-changed',
    'tnai:account-limit',
    'tnai:account-limit-cleared',
    'tnai:turn',
    'tnai:held',
    'tnai:live-activity',
    'tnai:file-activity',
    'tnai:agent-state',
    'tnai:terminal-pane-renamed',
    'tnai:terminal-pane-closed',
    'tnai:terminal-workspace-closed',
    'tnai:terminal-panes-reordered',
    'tnai:new-agent-changed',
    'tnai:project-changed',
    'tnai:custom-agents-changed',
    'tnai:threads-select',
    'tnai:remote-agents-changed',
    'tnai:agent-talk',
    'tnai:teams-changed',
    'tnai:graph-changed',
    'tnai:draft-changed',
    'tnai:unread-changed',
  ];
  let queued = 0;
  let stops = [];

  // Many pushes in one moment are one redraw. The timer beside the frame is for a window the user's
  // other windows cover: it draws no frames, and the list must still be right when it is seen.
  function refresh() {
    if (queued || !stops.length) return;
    const run = () => {
      cancelAnimationFrame(queued.frame);
      clearTimeout(queued.timer);
      queued = 0;
      if (stops.length) paint();
    };
    queued = { frame: requestAnimationFrame(run), timer: setTimeout(run, 120) };
  }

  function start() {
    if (stops.length || !threads()?.slot('list')) return;
    EVENTS.forEach(name => {
      window.addEventListener(name, refresh);
      stops.push(() => window.removeEventListener(name, refresh));
    });
    const offSessions = safe(() => window.TnaiAgents?.onChange?.(refresh), null);
    if (typeof offSessions === 'function') stops.push(offSessions);

    // Panels and workspaces coming and going, and a panel's status (10 writes data-status only
    // when it changes).
    const host = terminalPanels();
    if (host) {
      // Only the lists of workspaces and of panels are watched, never what is inside a panel: a
      // terminal's own output must not redraw the list.
      const watchPanels = new MutationObserver(() => {
        watchGrids();
        refresh();
      });
      const watchGrids = () => {
        watchPanels.observe(host, { childList: true });
        host
          .querySelectorAll('.terminal-workspace-view, .terminal-workspace-grid')
          .forEach(grid => watchPanels.observe(grid, { childList: true }));
      };
      watchGrids();
      const watchStatus = new MutationObserver(refresh);
      watchStatus.observe(host, {
        attributes: true,
        attributeFilter: ['data-status'],
        subtree: true,
      });
      stops.push(
        () => watchPanels.disconnect(),
        () => watchStatus.disconnect()
      );
    }

    // shown, even with nothing to watch
    stops.push(() => {});
    paint();
  }

  function stop() {
    stops.forEach(off => safe(off, null));
    stops = [];
    if (queued) {
      cancelAnimationFrame(queued.frame);
      clearTimeout(queued.timer);
    }
    queued = 0;
    shownPick = '';
  }

  // The list is on every page (118 moves it beside the other pages), so it keeps listening while
  // another page shows. Everything it listens to is pushed; nothing here polls.
  window.addEventListener('tnai:threads-shown', start);
  window.addEventListener('tnai:threads-removed', () => {
    stop();
    rows.clear();
    findText.clear();
    forgetPast();
    seenIds = null;
  });

  window.TnaiThreadList = {
    refresh,

    // Types into the search field as the user would ('' clears it); for the check page.
    search: text => {
      field.value = String(text || '');
      field.dispatchEvent(new Event('input'));
    },

    // One live session as the list reads it (name, tool, tone, label, project), or null.
    thread: paneId => readThreads(openProjects()).find(thread => thread.id === paneId) || null,

    // Every live session as the list reads it (the Board page, 157, places them in columns).
    all: () => readThreads(openProjects()),

    // The threads of the agents this one started in panels of their own (43's graph).
    kids: paneId => readThreads(openProjects()).filter(thread => thread.lead === paneId),
    rows: () =>
      [...box.querySelectorAll('.tnt-th')].map(row => ({
        paneId: row.dataset.pane,
        remote: row.dataset.remote || '',
        past: row.dataset.past || '',
        sub: row.classList.contains('tnt-sub'),
        kid: row.classList.contains('tnt-kid'),
        tone: row.dataset.tone || '',
        selected: row.getAttribute('aria-selected') === 'true',
      })),
  };
  if (safe(() => threads()?.visible(), false)) start();
})();
