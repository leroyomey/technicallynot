/*
 * Technically Not · 119-thread-list.js — the thread layout's left island.
 * Desktop app only; fills the `list` slot of 118
 * (`window.TnaiThreads`) and does nothing while the thread layout is off or its page is hidden.
 *
 * One thread per live session, in Terminal order: every terminal panel with a connection, in every
 * terminal workspace. A thread is shown by its agent, one of the app's device characters, awake and
 * lit in its status color or asleep when nothing runs. "Needs you" comes first, then one group per
 * open project. A lead's sub-agents sit under it: Claude Code's own (19 `TnaiTeam`, no panel of
 * their own) as small rows, a sub-agent in its own panel (43's graph) as a thread set in. After
 * this computer's groups comes one group per other computer ("On NAME") with its agents of the
 * open project, as 116 holds them; a press on one shows it in the thread's main area (138).
 *
 * Real state only, read from what the Terminal page list reads (10's `data-status` on the panel,
 * 104 `TnaiDigest.describe`, 71 `TnaiNeedsYou`), and redrawn on the app's own push events. There is
 * no timer. For tools other than Claude Code, "what it does now" is read from the terminal's
 * output, so the row says "inferred".
 *
 * A click or Enter opens the thread (`TnaiThreads.select`); the arrow keys move. While the Agents
 * and history page shows, the press chooses that agent on that page instead (25 has no list of its
 * own), and the row marked open is the agent that page shows. "New thread" is
 * the prompt box's own New agent switch (11). Look: src/styles/28-thread-list.css.
 * `window.TnaiThreadList` (`refresh`, `rows`) for the desktop test `thread-list`.
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
    'waiting-agents': 'work',
    background: 'work',
    'needs-you': 'needs',
    waiting: 'ready',
    done: 'ready',
    error: 'err',
    exited: 'err',
    failed: 'err',
  };
  const SUB_TONE = { running: 'work', starting: 'work', failed: 'err', done: 'idle' };

  // Which device character stands for which tool, as in the mock. A plain terminal is the laptop.
  const DEVICE = {
    'Claude Code': 'desktop',
    Codex: 'laptop',
    OpenCode: 'tablet',
    Terminal: 'laptop',
  };
  const deviceFile = (device, part) =>
    new URL('src/assets/devices/' + device + '-' + part + '.webp', document.baseURI).href;

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
    const at = turn?.startedAt || session.startedAt || 0;

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
    const doing = digest ? (flagged ? digest.last : digest.now) : label;
    return {
      talk,
      team: mates.map(nameOf).join(', '),
      browser: browser ? (browser.waiting ? 'thinking' : 'in use') : '',
      context: context?.tokens > 0 ? context : null,
      id,
      session,
      name: session.name || panel.querySelector('.terminal-pane-title')?.textContent || 'Terminal',
      tool: session.agent || 'Terminal',
      tone: needs || limited ? 'needs' : TONE[status] || 'idle',
      label: limited ? 'Usage limit reached' : label,
      now: limited
        ? 'Usage limit reached'
        : cut
          ? 'Interrupted by ' + cut.by
          : [doing, count].filter(Boolean).join(' · '),
      inferred: !limited && !cut && !!digest && !flagged && !!digest.inferred,
      task: digest?.task || '',
      needs,
      project: session.cwd ? projectOf(session, projects) : workspaceProject(id, projects),
      projectFrom: session.cwd ? 'folder' : 'workspace',
      lead: leadOf(id),
      time: clock(at),
      timeTip: !at
        ? ''
        : (turn?.startedAt ? 'Its current or last task started at ' : 'This session started at ') +
          clock(at),
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

  function faceHtml() {
    return (
      '<span class="tnt-face" aria-hidden="true"><img class="tnt-face-body" alt="" width="960" ' +
      'height="780"><i class="tnt-face-screen"></i><img class="tnt-face-eyes" alt="" width="960" ' +
      'height="780"></span>'
    );
  }

  function rowFor(key, paneId, isSub) {
    let row = rows.get(key);
    if (row) return row;
    row = make('button', isSub ? 'tnt-th tnt-sub' : 'tnt-th');
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.tabIndex = -1;
    row.dataset.pane = paneId;
    row.dataset.key = key;
    row.innerHTML =
      (isSub ? '<i class="tnt-dot" aria-hidden="true"></i>' : faceHtml()) +
      '<b></b><time></time><small><span class="tnt-th-line"><span class="tnt-th-tool"></span>' +
      '<span class="tnt-th-now"></span></span><i class="tnt-th-inf" hidden>· inferred</i></small>';
    rows.set(key, row);
    return row;
  }

  function paintFace(row, tool, asleep) {
    const face = row.querySelector('.tnt-face');
    if (!face) return;

    // The tool's name may come from another computer: only a name of the table picks a device.
    const device = Object.hasOwn(DEVICE, tool) ? DEVICE[tool] : 'desktop';
    const want = device + (asleep ? ' asleep' : ' awake');
    if (face.dataset.face === want) return;
    face.dataset.face = want;
    face.querySelector('.tnt-face-body').src = deviceFile(device, 'body');
    face.querySelector('.tnt-face-eyes').src = deviceFile(device, asleep ? 'sleep' : 'eyes');

    // A url() set from a script is not relative to the style sheet, so it is absolute.
    face.style.setProperty('--tnt-screen', 'url("' + deviceFile(device, 'screen') + '")');
  }

  function fillRow(row, view) {
    setText(row.querySelector('b'), view.name);
    setText(row.querySelector('time'), view.time || '');
    setAttr(row.querySelector('time'), 'title', view.timeTip || '');
    setText(row.querySelector('.tnt-th-tool'), view.tool);
    setText(row.querySelector('.tnt-th-now'), view.now ? ' · ' + view.now : '');
    row.querySelector('.tnt-th-inf').hidden = !view.inferred;
    if (row.dataset.tone !== view.tone) row.dataset.tone = view.tone;
    row.classList.toggle('tnt-kid', !!view.kid);
    setAttr(row, 'aria-selected', String(!!view.on));
    if (row.title !== view.tip) row.title = view.tip;
    paintFace(row, view.toolName, view.tone === 'idle' || view.tone === 'err');
  }

  // What a Claude Code sub-agent does now, in a few words.
  function subNow(sub, leadRuns) {
    if (leadRuns && sub.status === 'running' && sub.now)
      return sub.now.tool + (sub.now.detail ? ' · ' + sub.now.detail : '');
    if (sub.status === 'done') return 'Done';
    if (sub.status === 'failed') return 'Failed';
    if (!leadRuns) return 'Stopped with its lead';
    if (sub.status === 'starting') return sub.asking ? 'Waiting for approval' : 'Starting';
    return 'Running';
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
      (thread.now ? '\nNow: ' + thread.now + (thread.inferred ? ' (inferred)' : '') : '') +
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
      fillRow(row, {
        name: thread.name,
        time: thread.time,
        timeTip: thread.timeTip,
        toolName: thread.tool,

        // "↔ NAME" stands before what the agent does now: it is exact, and "inferred" at the
        // line's end then still stands beside the part it is about.
        tool:
          (withProject && thread.project ? thread.project.name + ' · ' : '') +
          thread.tool +
          (thread.talk ? ' · ↔ ' + thread.talk.label : ''),
        now: thread.now,
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
        fillRow(row, {
          name: what,
          toolName: thread.tool,
          tool: 'Sub-agent',
          now: doing,
          tone: !leadRuns && sub.status !== 'done' ? 'err' : SUB_TONE[sub.status] || 'idle',
          on: false,
          tip:
            what +
            ' · sub-agent of ' +
            thread.name +
            '\nNow: ' +
            doing +
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
      fillRow(row, {
        name: agent.name,
        time,
        timeTip: time ? 'Working since ' + time + ', as ' + computer.name + ' reports' : '',
        toolName: agent.cli,
        tool: agent.cli || 'Agent',
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
    });
    [...rows.keys()].forEach(key => {
      if (!alive.has(key)) rows.delete(key);
    });
    return out;
  }

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
    const kids = buildList(all, projects, marked, readComputers(), openKey);
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
        (rows.get(focusedKey) || box.querySelector('.tnt-th'))?.focus({ preventScroll: true });
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

    // Another computer's agent is not a thread of this computer: 138 takes that press before
    // this handler and shows the agent in the thread's main area. Nothing is chosen here.
    if (row.dataset.remote) return;
    threads()?.select(row.dataset.pane);
    refresh();
  });
  box.addEventListener('keydown', event => {
    const row = event.target.closest?.('.tnt-th');
    if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = [...box.querySelectorAll('.tnt-th')];
    const at = all.indexOf(row);
    let to = null;
    if (event.key === 'ArrowDown') to = all[at + 1];
    else if (event.key === 'ArrowUp') to = all[at - 1];
    else if (event.key === 'Home') to = all[0];
    else if (event.key === 'End') to = all[all.length - 1];
    if (!to) return;
    event.preventDefault();
    all.forEach(other => {
      other.tabIndex = other === to ? 0 : -1;
    });
    to.focus();
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
    seenIds = null;
  });

  window.TnaiThreadList = {
    refresh,

    // One live session as the list reads it (name, tool, tone, label, project), or null.
    thread: paneId => readThreads(openProjects()).find(thread => thread.id === paneId) || null,

    // The threads of the agents this one started in panels of their own (43's graph).
    kids: paneId => readThreads(openProjects()).filter(thread => thread.lead === paneId),
    rows: () =>
      [...box.querySelectorAll('.tnt-th')].map(row => ({
        paneId: row.dataset.pane,
        remote: row.dataset.remote || '',
        sub: row.classList.contains('tnt-sub'),
        kid: row.classList.contains('tnt-kid'),
        tone: row.dataset.tone || '',
        selected: row.getAttribute('aria-selected') === 'true',
      })),
  };
  if (safe(() => threads()?.visible(), false)) start();
})();
