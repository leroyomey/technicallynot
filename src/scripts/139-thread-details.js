// Technically Not · 139-thread-details.js — Desktop app only: one agent's details as a part that
// can stand beside its thread (the side column), so the old "Agents and history" page (25) is not
// needed for them. For the agent of one terminal panel it shows the total running time with its
// color step, the queued prompts with their actions, and the sections Now, Changes (what the agent
// changed in its folder's git branch, and the branch's pull request; its rows are 153's),
// Sub-agents, Recent activity, Working with, Files it is touching now, Skills and Setup. Every
// section folds, and an empty one says so in one line. It listens to the same pushed events as the
// old page while at least one copy is mounted, and to nothing after the last one is unmounted.
// window.TnaiThreadDetails = { mount(host, paneId), unmount(host), refresh(host), state() }. Look:
// src/styles/41-thread-details.css.
(() => {
  const agents = window.TnaiAgents;
  const native = window.tnaiNative;
  if (!agents) return;

  // ---------------------------------------------------------------- small helpers
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };

  // One formatter for every time shown: making one per call is slow in a list that repaints while
  // agents work.
  const CLOCK = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const clock = at => (at ? CLOCK.format(at) : '');

  // Local time, "12:41 AM", as the terminal prints it.
  const DONE_AT = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true });
  const firstLine = text =>
    String(text || '')
      .split(/\r?\n/)
      .find(line => line.trim()) || '';
  const shellName = () => (typeof window.tnaiShell === 'function' ? window.tnaiShell() : 'Shell');
  const toolName = session => (session.agent === 'Terminal' ? shellName() : session.agent);

  // ---------------------------------------------------------------- the total running time
  // To the minute: "<1m", "14m", "2h 14m", "3d 4h".
  function upText(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 1) return '<1m';
    if (hours < 1) return minutes + 'm';
    if (days < 1) return hours + 'h ' + (minutes % 60) + 'm';
    return days + 'd ' + (hours % 24) + 'h';
  }

  // How long is too long for one session: green up to half the "Offer a hand-off after" time (54,
  // 2 hours when not set), yellow up to it, red past it.
  const upHours = () => window.TnaiContextUpkeep?.prefs?.().age || 2;
  const upTone = (milliseconds, hours = upHours()) => {
    if (milliseconds < hours * 1800000) return 'ok';
    if (milliseconds < hours * 3600000) return 'long';
    return 'over';
  };
  const UP_TIP = {
    ok: 'Green: within the recommended time for one session',
    long: 'Yellow: getting long, plan a hand-off soon',
    over: 'Red: open longer than recommended, hand it off to a fresh agent or retire it',
  };

  function paintTotal(view, session) {
    const line = view.total;
    const startedAt = session?.running && session.startedAt ? +session.startedAt : 0;
    if (line.hidden !== !startedAt) line.hidden = !startedAt;
    view.totalMs = startedAt ? Date.now() - startedAt : 0;
    if (!startedAt) return;
    const text = upText(view.totalMs);

    // The color step is for an agent CLI. A plain terminal has no session to hand off.
    const age = session.agent === 'Terminal' ? '' : upTone(view.totalMs);
    if ((line.dataset.age || '') !== age) line.dataset.age = age;
    const tip =
      'Running for ' +
      text +
      ' in total, since this agent started at ' +
      clock(startedAt) +
      '.' +
      (age ? ' ' + UP_TIP[age] + ' (' + upHours() + ' h).' : '');

    // in the card it follows the state: "Working · 51m"
    setText(line, text);
    if (line.title !== tip) line.title = tip;
  }

  // ---------------------------------------------------------------- where the facts come from
  // Tone and words of a status, as everywhere else in the app.
  const STATUS_WORDS = {
    working: 'Working',
    waiting: 'Waiting for input',
    'waiting-agents': 'Waiting on agents',
    background: 'Working in background',
    'needs-you': 'Needs you',
    starting: 'Starting',
    'not-started': 'Not started',
    exited: 'Exited',
    error: 'Error',
  };

  // 19: the lead's task and its sub-agents, from the CLI's own hooks.
  const teamOf = paneId => {
    try {
      return window.TnaiTeam?.get?.(paneId) || null;
    } catch {
      return null;
    }
  };

  // The CLIs that report sub-agents and steps as agent events (desktop/agent-hooks.js).
  const reportsSteps = session => session.agent === 'Claude Code' || session.agent === 'OpenCode';
  const customAgentOf = session => {
    const library = window.TnaiCustomAgents;
    try {
      return (
        library?.forPane?.(session.paneId) ||
        (session.customAgentId ? library?.get?.(session.customAgentId) : null) ||
        null
      );
    } catch {
      return null;
    }
  };
  const filesOf = paneId => window.TnaiFileActivity?.forPane?.(paneId) || [];
  const workspaceOf = paneId => {
    const workspaceId =
      window.TnaiTerminalWorkspaceByPane?.[paneId] ||
      document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]')?.dataset
        .workspaceId ||
      'workspace-1';
    const workspaces = window.TnaiTerminalWorkspaces?.list?.() || [];
    return workspaces.find(workspace => workspace.id === workspaceId) || null;
  };

  // ---------------------------------------------------------------- readable text
  // The project folder, so a file inside it is shown by its path from there, not the whole path.
  // Asked once while a copy is mounted; until it is known, paths show as they came.
  let projectRoot = '';

  // A bridge that throws at once must not stop the listening that follows (startListening).
  const askRoot = () =>
    new Promise(resolve => resolve(native?.fs?.root?.()))
      .then(root => {
        if (root && root !== projectRoot) {
          projectRoot = String(root);
          schedule();
        }
      })
      .catch(() => {});

  // A path or command with the project folder taken off, in each way a tool writes it: C:\x\y,
  // C:/x/y and /c/x/y.
  function fromProject(text) {
    let out = String(text || '');
    if (!projectRoot) return out;
    const forward = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
    const back = forward.replace(/\//g, '\\');
    const posix = forward.replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
    for (const prefix of [back + '\\', forward + '/', posix + '/'])
      out = out.split(prefix).join('');
    for (const prefix of [back, forward, posix]) out = out.split(prefix).join('.');
    return out;
  }

  // A command as the user reads it: without the "cd <folder>;" it starts with, from the project.
  const plainCommand = text =>
    fromProject(String(text || '').replace(/^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(;|&&)\s*/, ''));

  // A file's kind by its name, for its color: code, style, docs, tests.
  function fileKind(name) {
    if (/(^|[\\/])tests?[\\/]|-test\.m?js$|\.test\.|check\.js$/i.test(name)) return 'test';
    if (/\.(m?js|cjs|ts|tsx|jsx|py|ps1|sh)$/i.test(name)) return 'code';
    if (/\.(css|html)$/i.test(name)) return 'style';
    if (/\.(md|txt|json|ya?ml)$/i.test(name)) return 'doc';
    return '';
  }

  // A command in the app's code colors: the program, its flags, quoted words, numbers, files.
  function commandNodes(command) {
    const nodes = [];
    let program = true;
    for (const token of command.match(/"[^"]*"?|'[^']*'?|\s+|[^\s"']+/g) || []) {
      let kind = '';
      if (/^\s+$/.test(token)) kind = '';
      else if (/^(\||;|&&|\|\||>|>>|2>&1)$/.test(token)) {
        kind = 'op';
        program = true;
      } else if (program) {
        kind = 'cmd';
        program = false;
      } else if (/^-/.test(token)) kind = 'flag';
      else if (/^["']/.test(token)) kind = 'str';
      else if (/^\d[\d,.:]*p?$/.test(token)) kind = 'num';
      else if (/[\\/]|\.\w{1,5}$/.test(token)) kind = 'file-' + (fileKind(token) || 'other');
      nodes.push(kind ? make('i', 'ttd-c ttd-c-' + kind, token) : document.createTextNode(token));
    }
    return nodes;
  }

  // A file shown by its name first and its folder after, so a cut-off line never hides the name.
  // The text reads as the path ("src/theme.js") for copying and for screen readers.
  function fileNodes(path) {
    const shown = fromProject(path);
    const cut = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\'));
    const folder = cut >= 0 ? shown.slice(0, cut + 1) : '';
    const name = cut >= 0 ? shown.slice(cut + 1) : shown;
    const holder = make('span', 'ttd-file');
    holder.title = shown;
    holder.append(make('i', 'ttd-file-dir', folder));
    holder.append(make('i', 'ttd-file-name ttd-c-file-' + (fileKind(name) || 'other'), name));
    return holder;
  }

  // The kinds of a step, each with the app's code color and a Lucide icon (41).
  const STEP_KIND = [
    [/^(Edit|Write|MultiEdit|NotebookEdit|edit|write|patch)$/, 'edit', 'pencil'],
    [/^(Read|Grep|Glob|LS|read|grep|glob|list)$/, 'read', 'eye'],
    [/^(Bash|PowerShell|bash|shell)$/, 'run', 'terminal'],
  ];

  function stepKind(event) {
    if (event.kind !== 'tool') return ['', ''];
    const tool = String(event.tool || '');
    for (const [pattern, kind, icon] of STEP_KIND) {
      if (!pattern.test(tool)) continue;
      if (
        kind === 'run' &&
        /(-test\.m?js|check\.js|\bnpm (run )?test\b|\btest\b)/i.test(event.detail || '')
      )
        return ['test', 'check'];
      return [kind, icon];
    }
    return ['', ''];
  }

  // A prompt the app sent, in plain words: a decision becomes "Decision 1 of 2: Yes, …" rows and
  // the result it came from; the app's own marks, wrappers and "Full result:" lines go. Returns
  // { answers: [{ lead, answer }], from, text }.
  const DECISION =
    /Decision on "([\s\S]*?)"(?= from |:)(?: from (.+?)(?= \(task:|:))?(?: \(task:[\s\S]*?\))?:\s*(?:go with\s+)?([\s\S]*?)(?=\s*Full result:|\s*Decision on "|\s*$)/g;

  function plainPrompt(raw) {
    let text = String(raw || '')
      .replace(/<\/?pasted_content[^>]*>/g, '')
      .replace(/^\s*\[(?:TN|TechnicallyNot)\.ai\]\s*/, '')
      .replace(/\[(?:TN|TechnicallyNot)\.ai\][^\n]*\n?/g, '');
    const answers = [];
    let from = '';
    for (const match of text.matchAll(DECISION)) {
      const question = match[1].trim();
      const lead = /^(Decision \d+ of \d+)/.exec(question)?.[1] || question.slice(0, 80);
      answers.push({ lead, answer: match[3].trim().replace(/\.$/, '') });
      if (!from && match[2]) from = match[2].trim();
    }
    text = text
      .replace(/\s*Full result:\s*`[^`]*`/g, '')
      .replace(/\s*\(task:[^)]*\)/g, '')
      .trim();
    return { answers, from, text };
  }
  const sameWords = (first, second) =>
    plainPrompt(first).text.replace(/\s+/g, ' ') === plainPrompt(second).text.replace(/\s+/g, ' ');

  // The last part of a file path ("C:\…\src\app.js" → "app.js").
  const fileName = path =>
    String(path || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || '';

  // The head card's short line for a tool call: a verb and the file name or the agent's own label,
  // never a whole path or command (the full text stays on hover, see nowFull).
  const SHORT_VERBS = {
    Edit: 'Editing',
    MultiEdit: 'Editing',
    NotebookEdit: 'Editing',
    Write: 'Writing',
    Read: 'Reading',
    Bash: 'Running a command',
    PowerShell: 'Running a command',
    Grep: 'Searching the code',
    Glob: 'Looking for files',
    WebFetch: 'Reading a web page',
    WebSearch: 'Searching the web',
    Skill: 'Using skill',
    TodoWrite: 'Updating its plan',
    Agent: 'Starting a sub-agent',
    Task: 'Starting a sub-agent',
  };

  function nowShort(now) {
    const verb = SHORT_VERBS[now.tool];
    if (/^mcp__tnai__tnai_/.test(now.tool)) return 'Coordinating agents';
    if (!verb) {
      const short = String(now.label || '').slice(0, 60);
      return 'Using ' + now.tool + (short ? ' · ' + short : '');
    }
    if (/^(Edit|MultiEdit|NotebookEdit|Write|Read)$/.test(now.tool)) {
      const name = fileName(now.detail || now.label);
      return name ? verb + ' ' + name : verb;
    }
    if (now.tool === 'Skill') return verb + (now.detail ? ' ' + fileName(now.detail) : '');
    if (now.label && now.label.length <= 60) return now.label;
    return verb;
  }

  // The full tool call for the hover text of the short line.
  const nowFull = now => (now ? [now.tool, now.label, now.detail].filter(Boolean).join(' · ') : '');

  // What the agent is doing right now, from the freshest real signal: its reported tool, its
  // latest file action (inferred), or its process state.
  function doingNow(session, team) {
    if (!session.running) return session.exitText || 'Not running';
    if (session.mode === 'login') return 'Signing in';
    const question = window.TnaiLiveFeed?.asking?.(session.paneId);
    if (question) return 'Waiting for your answer · ' + question.text;
    if (session.status === 'needs-you')
      return window.TnaiNeedsYou?.label?.(session.paneId) || 'Needs you';
    if (team?.lead) return nowShort(team.lead);
    const action = window.TnaiFileActivity?.now?.(session.paneId);
    if (action && Date.now() - action.at < 120000)
      return (
        action.verb.charAt(0).toUpperCase() + action.verb.slice(1) + ' ' + fileName(action.path)
      );
    const running = (team?.subs || []).filter(sub => sub.status === 'running').length;
    if (running) return running + ' sub-agent' + (running > 1 ? 's' : '') + ' running';

    // 42: the task it last finished, with its real end time
    const last = session.status === 'waiting' ? window.TnaiTurns?.get?.(session.paneId) : null;
    const done =
      last?.endedAt && last.endedBy === 'stop' ? ' · done ' + DONE_AT.format(last.endedAt) : '';
    return (STATUS_WORDS[session.status] || session.status) + done;
  }

  function taskOf(session, team) {
    const raw =
      team?.task?.text ||
      window.TnaiLiveTasks?.title?.(session) ||
      window.TnaiLiveTasks?.get?.(session.paneId)?.text ||
      '';
    return window.TnaiResults?.cleanTask?.(raw) || raw;
  }

  function accountOf(session, cliInfo) {
    const picked =
      session.accountId !== undefined
        ? window.TnaiAccounts?.label?.(session.agent, session.accountId)
        : '';
    return picked || (window.tnaiMaskEmails || String)(cliInfo?.account || '');
  }

  const subState = (sub, leadRuns) => {
    if (sub.status === 'done') return 'Done · ' + clock(sub.endedAt);
    if (sub.status === 'failed') return 'Failed';
    if (!leadRuns) return 'Stopped with its lead';
    if (sub.status === 'starting') return sub.asking ? 'Waiting for approval' : 'Starting';
    return 'Running since ' + clock(sub.startedAt);
  };

  // The words of one agent event in Recent activity: [what, detail].
  const EVENT_WORDS = {
    ready: () => ['Connected', 'Ready to take tasks from Technically Not'],
    prompt: event => [
      'Prompt',
      String(event.text || '').replace(/^\[(?:TN|TechnicallyNot)\.ai\]\s*/, ''),
    ],
    spawn: event => ['Started sub-agent', event.description || event.type || ''],
    'sub-start': event => ['Sub-agent running', event.agentType || ''],
    'sub-stop': event => ['Sub-agent finished', firstLine(event.text)],
    'sub-note': event => ['Sub-agent reported back', firstLine(event.text)],
    'spawn-result': event => ['Sub-agent failed', firstLine(event.result?.text)],
    stop: event => ['Finished its turn', firstLine(event.text)],
    'mesh-in': event => ['Message from ' + (event.from || 'agent'), firstLine(event.text)],
    'mesh-out': event => ['Message to ' + (event.to || 'agent'), firstLine(event.text)],
  };

  // Agent events per panel, for Recent activity. Kept only while a copy is mounted; the history is
  // asked for again at the next first mount.
  const events = new Map();

  function keepEvent(event) {
    if (!event?.paneId || !event.kind) return;
    if (event.kind === 'spawn-result' && !/error|fail/i.test(event.result?.status || '')) return;
    const list = events.get(event.paneId) || [];
    events.set(event.paneId, list);
    if (event.seq && list.some(kept => kept.seq === event.seq)) return;
    list.push(event);
    if (list.length > 200) list.shift();
  }

  // ---------------------------------------------------------------- what the user opened or folded
  // Folded sections, the same for every thread, remembered on this computer.
  const FOLD_KEY = 'tnai.thread-details-folded';
  const folded = new Set();
  try {
    JSON.parse(localStorage.getItem(FOLD_KEY) || '[]').forEach(name => folded.add(String(name)));
  } catch {}
  const saveFolded = () => {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...folded]));
    } catch {}
  };

  // Long values opened with "View more", by "<scope>|<label>"; opened <details>, by "<sub key>:
  // <part>"; opened queued prompts, by panel. All kept across repaints for this app session.
  const expanded = new Set();
  const openDetails = new Set();
  const queueOpen = new Map();
  const queueOpenOf = paneId =>
    queueOpen.get(paneId) || queueOpen.set(paneId, new Set()).get(paneId);

  // ---------------------------------------------------------------- building blocks of a section
  const note = text => make('p', 'ttd-note', text);

  // "View more" shows only when the text is longer than three lines.
  function markOverflow(cell) {
    const text = cell.firstChild;
    if (!text?.isConnected || !text.clientWidth) return;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 14;
    const height = cell.classList.contains('ttd-open') ? text.clientHeight : text.scrollHeight;
    const over = height > lineHeight * 3 + 2;
    if (over !== cell.hasAttribute('data-over')) cell.toggleAttribute('data-over', over);
  }
  const clampWatch = new ResizeObserver(entries =>
    entries.forEach(entry =>
      entry.target.isConnected
        ? markOverflow(entry.target.parentNode)
        : clampWatch.unobserve(entry.target)
    )
  );

  // Long free text stands under its label across the full width.
  const WIDE_LABELS = new Set(['Doing now', 'Task', 'Last sent from Technically Not', 'Folder']);

  // A list of label and value rows. `rows` holds [label, value, hover text]; a row with no value
  // is left out.
  function facts(rows, scope) {
    const list = make('dl', 'ttd-kv');
    rows
      .filter(row => row[1])
      .forEach(([label, value, hover]) => {
        const term = make('dt', '', label);
        const cell = make('dd');
        const text = make('span', 'ttd-clamp', value);
        const more = make('button', 'ttd-more');
        const key = (scope || '') + '|' + label;
        const open = expanded.has(key);
        if (hover) text.title = hover;
        cell.dataset.clamp = key;
        cell.dataset.fact = label;
        cell.classList.toggle('ttd-open', open);
        more.type = 'button';
        more.textContent = open ? 'View less' : 'View more';
        if (WIDE_LABELS.has(label)) {
          term.classList.add('ttd-kv-wide');
          cell.classList.add('ttd-kv-wide');
        }
        cell.append(text, more);
        clampWatch.observe(text);
        list.append(term, cell);
      });
    return list;
  }

  // Rebuilds a section only when its data changed, so open parts and scroll positions survive the
  // live updates.
  function paint(view, name, data, build) {
    const part = view.sections[name];
    const key = JSON.stringify(data);
    if (part.key === key) return;
    part.key = key;
    const scrolled = new Map(
      [...part.body.querySelectorAll('[data-open] > .ttd-pre')]
        .filter(pre => pre.scrollTop)
        .map(pre => [pre.parentNode.dataset.open, pre.scrollTop])
    );
    part.body.querySelectorAll('.ttd-clamp').forEach(span => clampWatch.unobserve(span));
    const nodes = [].concat(build()).filter(Boolean);
    part.body.replaceChildren(...nodes);

    // A section with nothing but a line of words is an empty one.
    const empty = nodes.every(node => node.classList.contains('ttd-note'));
    part.section.toggleAttribute('data-empty', empty);
    scrolled.forEach((top, openKey) => {
      const pre = part.body.querySelector('[data-open="' + CSS.escape(openKey) + '"] > .ttd-pre');
      if (pre) pre.scrollTop = top;
    });
    drawCount++;
  }

  // ---------------------------------------------------------------- queued prompts
  // First the prompts the CLI already has (it takes them next; nothing can be done with them
  // here), then the ones Technically Not holds while the agent works (71): each of those has Send
  // now, Edit (the user's own only) and Remove.
  function queuedFor(session) {
    const turn = window.TnaiTurns?.get?.(session.paneId);
    const taken = turn && !turn.endedAt && session.running ? turn.queued || [] : [];
    const held = session.running ? window.TnaiNeedsYou?.heldFor?.(session.paneId) || [] : [];
    return taken
      .map(prompt => ({ key: prompt.at + '|' + prompt.text, text: prompt.text, id: '', from: '' }))
      .concat(
        held.map(prompt => ({
          key: 'held|' + prompt.id,
          text: prompt.remote ? 'From ' + prompt.from + ': ' + prompt.text : prompt.text,
          id: prompt.id,
          from: prompt.from || '',
        }))
      );
  }

  function queueRow(prompt, place, open) {
    const row = make('li', 'ttd-q');
    row.dataset.key = prompt.key;
    const item = make('button', 'ttd-q-item');
    item.type = 'button';
    item.setAttribute('aria-expanded', String(open));
    item.title = open ? 'Show one line' : 'Show the full message';
    item.append(make('b', '', place + '.'), make('span', '', prompt.text));
    row.append(item);
    if (!prompt.id) {
      const withAgent = make('span', 'ttd-q-note', 'With the agent');
      withAgent.title =
        'Already handed to the agent: it takes it next. It can no longer be changed here.';
      row.append(withAgent);
      return row;
    }
    row.dataset.held = prompt.id;
    const actions = make('span', 'ttd-q-acts');
    const action = (name, label, title) => {
      const button = make('button', '', label);
      button.type = 'button';
      button.dataset.q = name;
      button.title = title;
      actions.append(button);
    };
    action(
      'send',
      'Send now',
      'Send it to the agent now, while it works: it takes it between steps or right after its task'
    );
    if (!prompt.from)
      action(
        'edit',
        'Edit',
        'Take it out of the queue and put it back in the prompt box to change it'
      );
    action(
      'remove',
      'Remove',
      prompt.from
        ? 'Remove this message: it is not delivered, and its sender is told'
        : 'Remove this message: it is not sent'
    );
    row.append(actions);
    return row;
  }

  function paintQueue(view, session) {
    const queued = queuedFor(session);
    const open = queueOpenOf(session.paneId);
    const keys = new Set(queued.map(prompt => prompt.key));

    // a prompt the agent took is forgotten
    open.forEach(key => {
      if (!keys.has(key)) open.delete(key);
    });
    setText(view.sections.queue.count, queued.length ? String(queued.length) : '');
    paint(view, 'queue', [session.paneId, queued, [...open]], () => {
      if (!queued.length) return note('No prompts are waiting.');
      const list = make('ol', 'ttd-queue');
      list.setAttribute('aria-label', 'Queued prompts');
      queued.forEach((prompt, index) =>
        list.append(queueRow(prompt, index + 1, open.has(prompt.key)))
      );
      return list;
    });
  }

  // ---------------------------------------------------------------- the sections
  // What it does now stands in the card at the top (paintHead); this section holds the task, in
  // plain words, and the prompt the app last sent when that says something else.
  function paintNow(view, session, team) {
    const sent = window.TnaiLiveTasks?.get?.(session.paneId);
    const task = taskOf(session, team);
    const plain = plainPrompt(task);
    const sentDiffers = !!sent && !sameWords(sent.text, task);
    paint(
      view,
      'now',
      [
        session.paneId,
        task,
        sent,
        session.running,
        session.status,
        session.startedAt,
        session.exitText,
      ],
      () => {
        const list = facts(
          [
            [
              'Task',
              plain.text || (session.agent === 'Terminal' ? 'Shell session' : 'No task yet'),
              sent ? 'Sent ' + clock(sent.at) : '',
            ],
            [
              'Last sent from Technically Not',
              sentDiffers ? plainPrompt(sent.text).text + ' · ' + clock(sent.at) : '',
            ],
            [
              'Process',
              session.running
                ? 'Live since ' + clock(session.startedAt)
                : session.exitText || 'Not started',
            ],
          ],
          session.paneId
        );

        // Decisions read as one row each ("Decision 1 of 2 · Yes, build all four"), the result
        // they came from under them.
        const cell = list.querySelector('dd[data-fact="Task"]');
        if (cell && plain.answers.length) {
          const rows = plain.answers.map(item => {
            const row = make('span', 'ttd-answer');
            row.append(make('em', '', item.lead), make('b', '', item.answer));
            return row;
          });
          if (plain.from) rows.push(make('span', 'ttd-from', 'From ' + plain.from));
          cell.classList.add('ttd-answers');
          cell.firstChild.replaceChildren(...rows);
        }
        return list;
      }
    );
  }

  // ---------------------------------------------------------------- what the agent changed
  // The facts and the section's rows are 153's (`TnaiThreadChanges`); this part says when to ask
  // and places the section.
  const changesKit = () => window.TnaiThreadChanges || null;

  // A turn that ended is the moment the agent's work is done: its folder is asked again once.
  const turnEndsSeen = new Map();

  function onTurn(event) {
    const paneId = event.detail?.paneId;
    const turn = paneId ? window.TnaiTurns?.get?.(paneId) : null;
    if (!turn?.endedAt || turnEndsSeen.get(paneId) === turn.endedAt) return;
    turnEndsSeen.set(paneId, turn.endedAt);
    if (![...views.values()].some(view => view.paneId === paneId)) return;
    const session = agents.sessions().find(candidate => candidate.paneId === paneId);
    const kit = changesKit();
    kit?.ask(session?.cwd || '', kit.TURN_MS);
  }

  // Shown only for a folder in a git repository, once its first answer is in; `opened` is true
  // when Details has just come on screen.
  function paintChanges(view, session, opened) {
    const kit = changesKit();
    kit?.wantFor(session, opened);
    const changes = kit?.get(session.cwd || '') || null;
    const part = view.sections.changes;
    const show = !!changes?.repo;
    if (part.section.hidden === show) part.section.hidden = !show;
    if (!show) return;
    paint(view, 'changes', [session.paneId, changes], () =>
      kit.build({ make, facts, note }, session, changes)
    );
  }

  // The card at the top: the state in its color, how long the agent has run, and what it does now
  // (the answer first). Empty sections say so in one quiet line under it.
  function paintHead(view, session, team) {
    const doing = doingNow(session, team);
    const word = STATUS_WORDS[session.status] || session.status || '';
    if ((view.head.dataset.status || '') !== (session.status || ''))
      view.head.dataset.status = session.status || '';
    setText(view.state, word);
    setText(view.doing, doing);
    const raw =
      session.running && team?.lead && doing === nowShort(team.lead) ? nowFull(team.lead) : '';
    if (view.doing.title !== raw) view.doing.title = raw;
    const empty = [
      ['queue', 'no queued prompts'],
      ['team', 'no helpers'],
    ]
      .filter(([name]) => view.sections[name].section.hasAttribute('data-empty'))
      .map(([, words]) => words);
    const summary = empty.length
      ? empty.join(' · ').replace(/^./, letter => letter.toUpperCase())
      : '';
    setText(view.quiet, summary);
    view.quiet.hidden = !summary;
  }

  // One sub-agent: its name and state, what it does now, and its task and output folded under it.
  function subAgentItem(session, sub, subTokens) {
    const item = make('div', 'ttd-sub');
    const settled = sub.status === 'done' || sub.status === 'failed';
    item.dataset.status = session.running || settled ? sub.status : 'failed';
    item.dataset.key = sub.key;
    const head = make('div', 'ttd-sub-head');
    const label = make('span');
    if (sub.alias) label.append(make('b', '', sub.alias), ' · ');
    label.append(sub.description || sub.type || 'Sub-agent');
    const kind = sub.type && sub.type !== 'general-purpose' ? sub.type + ' · ' : '';
    head.append(
      make('i', 'ttd-dot'),
      label,
      make('small', '', kind + subState(sub, session.running))
    );
    item.append(
      head,
      facts(
        [
          [
            'Now',
            session.running && sub.status === 'running' && sub.now ? nowShort(sub.now) : '',
            nowFull(sub.now),
          ],
          ['Tool calls', sub.tools ? String(sub.tools) : ''],
          [
            'Tokens',
            sub.agentId && subTokens?.[sub.agentId] ? subTokens[sub.agentId].toLocaleString() : '',
          ],
        ],
        session.paneId + ':' + sub.key
      )
    );
    [
      ['task', 'Task from the lead', sub.prompt],
      ['output', 'Output', sub.result],
    ].forEach(([part, title, text]) => {
      if (!text) return;

      // The lead's own "Summary: ..." first line shows as plain text; the full prompt folds below.
      const summary = part === 'task' && /^\s*Summary:\s*(.+)/i.exec(text);
      if (summary) item.append(make('p', 'ttd-note', summary[1].trim()));
      const details = make('details');
      details.dataset.open = sub.key + ':' + part;
      details.open = openDetails.has(details.dataset.open);
      details.append(
        make('summary', '', summary ? 'Full task from the lead' : title),
        make('pre', 'ttd-pre', text)
      );
      item.append(details);
    });

    // A sub-agent stuck on "Starting" (the CLI never reported that it started, so nothing runs
    // behind it) can be removed (19).
    if (sub.status === 'starting' && window.TnaiTeam?.dismiss) {
      const remove = make('button', 'ttd-text-btn', 'Remove');
      remove.type = 'button';
      remove.dataset.dismiss = sub.key;
      remove.title =
        'Remove this sub-agent: ' +
        (session.agent === 'OpenCode' ? 'OpenCode' : 'Claude Code') +
        ' never reported that it started, so nothing is running behind it';
      item.append(remove);
    }
    return item;
  }

  function paintSubAgents(view, session, team) {
    const subTokens = window.TnaiTurns?.get?.(session.paneId)?.subTokens;
    paint(
      view,
      'team',
      [
        session.paneId,
        reportsSteps(session),
        session.running,
        team &&
          team.subs.map(sub => [sub.key, sub.status, sub.now, sub.result, sub.alias, sub.tools]),
        subTokens,
        [...openDetails],
      ],
      () => {
        if (!reportsSteps(session))
          return note(
            'Sub-agents come from Claude Code’s own hooks. ' +
              (session.agent === 'Terminal' ? 'A ' + shellName() + ' thread' : session.agent) +
              ' doesn’t report them to Technically Not.'
          );
        if (!team?.subs.length)
          return note(
            'No sub-agents for the current task. The agent starts them when it decides they help, or when you ask for them.'
          );
        return team.subs.map(sub => subAgentItem(session, sub, subTokens));
      }
    );
  }

  function paintActivity(view, session, team) {
    const log = (events.get(session.paneId) || []).slice(-60).reverse();
    paint(
      view,
      'timeline',
      [
        session.paneId,
        reportsSteps(session),
        log.map(event => event.seq || event.at),
        team?.subs?.map(sub => sub.alias),
      ],
      () => {
        if (!reportsSteps(session) && !log.length)
          return note(
            toolName(session) +
              ' doesn’t report its steps to Technically Not (only Claude Code and OpenCode do). Its full output is in its thread.'
          );
        if (!log.length)
          return note(
            session.agent === 'OpenCode'
              ? 'No activity yet. OpenCode reports its tool calls and sub-agents here as they happen.'
              : 'No activity yet. Claude Code reports its prompts, tool calls, and sub-agents here as they happen.'
          );
        const aliasOf = agentId =>
          team?.subs?.find(sub => sub.agentId === agentId)?.alias || 'Sub-agent';
        const list = make('ol', 'ttd-timeline');

        // The same step on the same thing again and again (four edits of one file) is one row
        // that says how many times, with the first and last time on hover.
        const grouped = [];
        log.forEach(event => {
          const last = grouped[grouped.length - 1];
          const same =
            last &&
            event.kind === 'tool' &&
            last.event.kind === 'tool' &&
            last.event.tool === event.tool &&
            last.event.agentId === event.agentId &&
            (last.event.detail || '') === (event.detail || '');
          if (same) {
            last.times++;
            last.first = event.at;
          } else grouped.push({ event, times: 1, first: event.at });
        });
        grouped.forEach(({ event, times, first }) => {
          const [what, text] =
            event.kind === 'tool'
              ? [
                  (event.agentId ? aliasOf(event.agentId) + ' · ' : '') + event.tool,
                  event.detail || '',
                ]
              : (EVENT_WORDS[event.kind] || (() => [event.kind, '']))(event);
          const [kind, icon] = stepKind(event);
          const row = make('li');
          row.dataset.kind = event.kind;
          if (kind) row.dataset.step = kind;
          const mark = make('i', 'ttd-step');
          if (icon) mark.innerHTML = window.TnaiIcon?.(icon, { size: 12 }) || '';
          const detail = make('span');
          if (kind === 'edit' || kind === 'read') {
            const path = /^[\w.:\\/~ -]+$/.test(text) && /[\\/.]/.test(text);
            if (path) detail.append(fileNodes(text));
            else detail.append(...commandNodes(fromProject(text)));
          } else if (kind === 'run' || kind === 'test')
            detail.append(...commandNodes(plainCommand(text)));
          else detail.textContent = text;
          detail.title = fromProject(text);
          row.append(make('time', '', clock(event.at)), mark, make('b', '', what), detail);
          if (times > 1) {
            const count = make('small', 'ttd-times', times + ' times');
            count.title = 'From ' + clock(first) + ' to ' + clock(event.at);
            row.append(count);
          }
          list.append(row);
        });
        return list;
      }
    );
  }

  // Working with: its running sub-agents, and other agents that touched the same files (inferred
  // from file activity, and said so).
  function paintWorkingWith(view, session, team, sessions, mine) {
    const shared = sessions
      .filter(other => other.paneId !== session.paneId)
      .map(other => [other, filesOf(other.paneId).filter(file => mine.includes(file))])
      .filter(([, files]) => files.length);
    const subs = (team?.subs || []).filter(
      sub => session.running && (sub.status === 'running' || sub.status === 'starting')
    );
    paint(
      view,
      'with',
      [
        session.paneId,
        subs.map(sub => [sub.alias, sub.description, sub.status]),
        shared.map(([other, files]) => [other.paneId, other.name, files]),
        reportsSteps(session),
      ],
      () => {
        const out = [];
        if (subs.length) {
          const box = make('div', 'ttd-links');
          subs.forEach(sub => {
            const row = make('div', 'ttd-link');
            row.append(
              make(
                'span',
                '',
                (sub.alias ? sub.alias + ' · ' : '') + (sub.description || 'Sub-agent')
              ),
              make('small', '', 'its sub-agent · ' + sub.status)
            );
            box.append(row);
          });
          out.push(box);
        }
        if (shared.length) {
          const box = make('div', 'ttd-links');
          shared.forEach(([other, files]) => {
            const button = make('button', 'ttd-link');
            button.type = 'button';
            button.dataset.go = other.paneId;
            button.title = 'Open ' + other.name + '’s thread';
            const names = files
              .slice(0, 3)
              .map(file => file.split('/').pop())
              .join(', ');
            button.append(
              make('span', '', other.name + ' · ' + toolName(other)),
              make('small', '', names + (files.length > 3 ? ' +' + (files.length - 3) : ''))
            );
            box.append(button);
          });
          out.push(
            note(
              'Inferred: these agents touched the same files recently (from their output and folder changes).'
            ),
            box
          );
        }
        if (!out.length)
          out.push(
            note(
              'Not working with other agents right now.' +
                (reportsSteps(session) ? '' : ' Sub-agents are reported only by Claude Code.')
            )
          );
        return out;
      }
    );
  }

  function paintFiles(view, session, mine) {
    const last = window.TnaiFileActivity?.now?.(session.paneId);
    paint(view, 'files', [session.paneId, mine, last && [last.verb, last.path, last.at]], () => {
      if (!mine.length)
        return note(
          'No files right now. Technically Not credits a file to an agent from its tool calls, its output, and changes in the project folder.'
        );
      const box = make('div', 'ttd-links');
      mine.forEach(file => {
        const button = make('button', 'ttd-link');
        button.type = 'button';
        button.dataset.file = file;
        button.title = 'Open ' + file + ' in a window';
        button.append(
          make('span', '', file),
          make('small', '', last?.path === file ? last.verb + ' · ' + clock(last.at) : '')
        );
        box.append(button);
      });
      return box;
    });
  }

  function paintSkills(view, session, customAgent) {
    const used = session.running ? window.TnaiFileActivity?.skills?.(session.paneId) || [] : [];
    let library = [];
    try {
      library = window.TnaiSkills?.list?.() || [];
    } catch {}
    const attached = (customAgent?.skillIds || []).map(
      id => library.find(skill => skill.id === id)?.name || id
    );
    const sameSkill =
      window.TnaiSkillsUI?.matches ||
      ((skill, name) => String(skill.name).toLowerCase() === String(name).toLowerCase());
    paint(view, 'skills', [session.paneId, attached, used.map(skill => skill.name)], () => {
      if (!attached.length && !used.length)
        return note(
          customAgent
            ? customAgent.name + ' has no skills attached, and none are in use right now.'
            : 'No skills in use right now. Skills can be attached to custom agents (Settings › Agents › Custom agents).'
        );
      const box = make('div', 'ttd-chips');
      const chip = (name, state, title) => {
        const node = make('span', 'ttd-chip');
        node.dataset.state = state;
        node.title = title;
        node.append(make('i'), make('span', '', name));
        box.append(node);
      };
      attached.forEach(name =>
        chip(
          name,
          used.some(skill => sameSkill({ name }, skill.name)) ? 'in-use' : 'attached',
          'Attached to ' + customAgent.name
        )
      );
      used
        .filter(skill => !attached.some(name => sameSkill({ name }, skill.name)))
        .forEach(skill => chip(skill.name, 'in-use', 'In use since ' + clock(skill.at)));
      return box;
    });
  }

  // A thread that works in its own git worktree: the branch and what is on it, as one row in the
  // look of the rows under "Working with". A press opens the choice to merge, keep working or
  // discard (35), which before stood only on the head of the terminal panel, never on screen.
  function worktreeRow(worktree) {
    if (!worktree) return null;
    const box = make('div', 'ttd-links');
    const button = make('button', 'ttd-link');
    const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
    const on = [
      worktree.changes ? plural(worktree.changes, 'file') : '',
      worktree.commits ? plural(worktree.commits, 'commit') + ' ahead' : '',
    ].filter(Boolean);
    button.type = 'button';
    button.dataset.worktree = worktree.branch;
    button.title =
      'Own git worktree · branch ' +
      worktree.branch +
      ' · press to merge, keep working or discard it';
    button.append(
      make('span', '', '⎇ ' + worktree.branch.replace(/^tnai\//, '')),
      make('small', '', on.length ? on.join(' · ') : 'Own worktree')
    );
    box.append(button);
    return box;
  }

  function paintSetup(view, session, customAgent) {
    const cliInfo = agents.info().find(cli => cli.id === session.agent);
    const account = accountOf(session, cliInfo);
    const workspace = workspaceOf(session.paneId);
    const model = window.TnaiAgentModel?.text?.(session) || '';
    const worktree = window.TnaiWorktrees?.of?.(session.paneId) || null;
    paint(
      view,
      'setup',
      [
        session.paneId,
        session.agent,
        cliInfo?.version,
        model,
        account,
        customAgent && [customAgent.name, customAgent.base],
        workspace?.name,
        session.cwd,
        session.resumable,
        session.mode,
        worktree,
      ],
      () => [
        facts(
          [
            ['Connection', toolName(session) + (cliInfo?.version ? ' · ' + cliInfo.version : '')],
            ['Model', model, window.TnaiAgentModel?.tip?.(session) || ''],
            ['Account', account || (session.agent === 'Terminal' ? '' : 'Default account')],
            [
              'Custom agent',
              customAgent
                ? customAgent.name + (customAgent.base ? ' · based on ' + customAgent.base : '')
                : '',
            ],
            ['Workspace', workspace?.name || ''],
            ['Folder', session.cwd || ''],
            [
              'Conversation',
              session.agent === 'Terminal'
                ? ''
                : session.resumable
                  ? 'Saved · resumes after a restart'
                  : 'Not saved yet',
            ],
            ['Mode', session.mode === 'login' ? 'Signing in' : ''],
          ],
          session.paneId
        ),
        worktreeRow(worktree),
      ]
    );
  }

  // ---------------------------------------------------------------- drawing one copy
  // The sections in the order they stand, with their headings.
  const SECTIONS = [
    ['queue', 'Queued prompts'],
    ['now', 'Now'],

    // after Now: the task, then what it has changed so far
    ['changes', 'Changes'],
    ['team', 'Sub-agents'],
    ['timeline', 'Recent activity'],
    ['with', 'Working with'],
    ['files', 'Files it is touching now'],
    ['skills', 'Skills'],
    ['setup', 'Setup'],
  ];
  const views = new Map();
  let drawCount = 0;

  function draw(view) {
    // Not on screen (another tab of the column is shown, or the window is hidden): nothing is
    // built now, and it is drawn when it shows again (its size watcher sees that).
    if (document.hidden || !view.root.offsetParent) {
      view.stale = true;
      return;
    }

    // just came on screen: mounted now, or shown again after its tab or the window was hidden
    const opened = view.fresh || view.stale;
    view.fresh = false;
    view.stale = false;
    const sessions = agents.sessions();
    const session = sessions.find(candidate => candidate.paneId === view.paneId);
    view.root.toggleAttribute('data-gone', !session);
    view.gone.hidden = !!session;
    view.list.hidden = !session;
    view.head.hidden = !session;
    if (!session) {
      view.quiet.hidden = true;
      paintTotal(view, null);
      return;
    }
    const team = teamOf(session.paneId);
    const customAgent = customAgentOf(session);
    const mine = filesOf(session.paneId);
    paintTotal(view, session);
    paintQueue(view, session);
    paintNow(view, session, team);
    paintChanges(view, session, opened);
    paintSubAgents(view, session, team);
    paintActivity(view, session, team);
    paintWorkingWith(view, session, team, sessions, mine);
    paintFiles(view, session, mine);
    paintSkills(view, session, customAgent);
    paintSetup(view, session, customAgent);

    // last: it reads which sections came out empty
    paintHead(view, session, team);
  }

  // Next frame, or 100 ms later if the window is not painting (a covered window gets no frames).
  let waiting = false;

  function schedule() {
    if (waiting || !views.size) return;
    waiting = true;
    const run = () => {
      if (!waiting) return;
      waiting = false;
      views.forEach(draw);
    };
    requestAnimationFrame(run);
    setTimeout(run, 100);
  }

  // ---------------------------------------------------------------- presses inside a copy
  function setFolded(view, name, fold) {
    const part = view.sections[name];
    if (!part) return;
    fold ? folded.add(name) : folded.delete(name);
    saveFolded();

    // every copy shows the same sections folded
    views.forEach(other => {
      const otherPart = other.sections[name];
      otherPart.head.setAttribute('aria-expanded', String(!fold));
      otherPart.body.hidden = fold;
    });
  }

  function queuePress(view, target) {
    const row = target.closest('.ttd-q');
    if (!row) return false;
    const act = target.closest('button[data-q]')?.dataset.q;
    const needsYou = window.TnaiNeedsYou;
    if (act === 'send') needsYou?.sendHeld?.(row.dataset.held);
    else if (act) {
      // Edit puts the user's own words back in the prompt box, aimed at this agent.
      if (act === 'edit') window.TnaiLiveTasks?.setTarget?.(view.paneId);
      needsYou?.takeHeld?.(row.dataset.held, act === 'edit');
    } else if (target.closest('.ttd-q-item')) {
      const open = queueOpenOf(view.paneId);
      open.has(row.dataset.key) ? open.delete(row.dataset.key) : open.add(row.dataset.key);
      draw(view);
    }
    return true;
  }

  function onPress(view, event) {
    const target = event.target;
    const head = target.closest('.ttd-head');
    if (head) {
      setFolded(view, head.dataset.name, head.getAttribute('aria-expanded') === 'true');
      return;
    }
    const more = target.closest('.ttd-more');
    if (more) {
      const cell = more.parentNode;
      const open = !cell.classList.contains('ttd-open');
      open ? expanded.add(cell.dataset.clamp) : expanded.delete(cell.dataset.clamp);
      cell.classList.toggle('ttd-open', open);
      more.textContent = open ? 'View less' : 'View more';
      return;
    }
    if (queuePress(view, target)) return;
    const other = target.closest('[data-go]');
    if (other) {
      window.TnaiThreads?.show?.(other.dataset.go);
      return;
    }
    const pullRequest = target.closest('[data-pr]');
    if (pullRequest) {
      // refused as a window by the main process, which gives the address to the user's browser
      window.open(pullRequest.dataset.pr, '_blank', 'noopener');
      return;
    }
    const worktree = target.closest('[data-worktree]');
    if (worktree) {
      window.TnaiWorktrees?.land?.(worktree.dataset.worktree, worktree);
      return;
    }
    const file = target.closest('[data-file]');
    if (file) {
      window.TnaiFileViewer?.open?.(file.dataset.file);
      return;
    }
    const dismiss = target.closest('[data-dismiss]');
    if (dismiss) window.TnaiTeam?.dismiss?.(view.paneId, dismiss.dataset.dismiss);
  }

  // ---------------------------------------------------------------- listening, only while mounted
  // Pushed events only, the same ones the old page drew from.
  const WINDOW_EVENTS = [
    'tnai:file-activity',
    'tnai:skill-activity',
    'tnai:skills-changed',
    'tnai:custom-agents-changed',
    'tnai:accounts-changed',
    'tnai:target-changed',
    'tnai:live-activity',
    'tnai:teams-changed',
    'tnai:held',
    'tnai:turn',

    // 108: a CLI's list of models arrived, so a model may now have its readable name
    'tnai:agent-model',

    // 35: a worktree was made, merged or discarded, or its counts changed
    'tnai:worktrees-changed',
    'visibilitychange',
  ];
  let stops = [];

  function onPanelClosed(event) {
    events.delete(event.detail?.paneId);
    schedule();
  }

  function startListening() {
    askRoot();
    const keepStop = stop => {
      if (typeof stop === 'function') stops.push(stop);
    };
    keepStop(agents.onChange(schedule));
    keepStop(window.TnaiTeam?.onChange?.(schedule));
    keepStop(window.TnaiAccounts?.onChange?.(schedule));
    WINDOW_EVENTS.forEach(name => {
      const target = name === 'visibilitychange' ? document : window;
      target.addEventListener(name, schedule);
      stops.push(() => target.removeEventListener(name, schedule));
    });
    window.addEventListener('tnai:terminal-pane-closed', onPanelClosed);
    window.addEventListener('tnai:turn', onTurn);
    stops.push(() => window.removeEventListener('tnai:turn', onTurn));

    // 153: a folder's git facts came in
    window.addEventListener('tnai:thread-changes', schedule);
    stops.push(() => window.removeEventListener('tnai:thread-changes', schedule));
    stops.push(() => window.removeEventListener('tnai:terminal-pane-closed', onPanelClosed));
    if (native?.agentEvents) {
      keepStop(
        native.agentEvents.on(event => {
          keepEvent(event);
          schedule();
        })
      );
      native.agentEvents
        .history()
        .then(list => {
          if (!views.size) return;
          (list || []).sort((first, second) => first.seq - second.seq).forEach(keepEvent);
          schedule();
        })
        .catch(() => {});
    }

    // A workspace that is renamed fires no event (07 only redraws its tabs), so the tabs are
    // watched, as the old page did: the Workspace row of Setup follows the new name at once.
    const tabs = document.querySelector('.terminal-workspace-tabs');
    if (tabs) {
      const tabsWatch = new MutationObserver(schedule);
      tabsWatch.observe(tabs, { childList: true, subtree: true, characterData: true });
      stops.push(() => tabsWatch.disconnect());
    }

    // The total counts minutes: one tick every half minute moves it. It reads a clock, it asks
    // nothing of any agent.
    const tick = setInterval(() => {
      if (document.hidden) return;
      const sessions = agents.sessions();
      views.forEach(view => {
        if (!view.root.offsetParent) return;
        paintTotal(
          view,
          sessions.find(session => session.paneId === view.paneId)
        );
      });
    }, 30000);
    stops.push(() => clearInterval(tick));
  }

  function stopListening() {
    stops.forEach(stop => stop());
    stops = [];
    events.clear();
    waiting = false;
  }

  // ---------------------------------------------------------------- mount and unmount
  function build(paneId) {
    const root = make('div', 'ttd');
    root.dataset.pane = paneId;

    // The card at the top: the state and how long it has run, then what it does now.
    const head = make('div', 'ttd-now');
    const words = make('div', 'ttd-now-words');
    const line = make('p', 'ttd-now-line');
    const state = make('b', 'ttd-state');
    const total = make('span', 'ttd-total');
    total.hidden = true;
    line.append(state, total);
    const doing = make('p', 'ttd-doing');
    words.append(line, doing);
    head.append(make('i', 'ttd-now-dot'), words);
    const quiet = make('p', 'ttd-note ttd-quiet');
    quiet.hidden = true;
    const gone = make('p', 'ttd-note ttd-gone', 'This thread’s agent is not open any more.');
    gone.hidden = true;
    const list = make('div', 'ttd-list');
    const sections = {};
    SECTIONS.forEach(([name, title]) => {
      const section = make('section', 'ttd-sec');
      section.dataset.sec = name;
      const head = make('button', 'ttd-head');
      head.type = 'button';
      head.dataset.name = name;
      head.setAttribute('aria-expanded', String(!folded.has(name)));
      const count = make('em');
      head.append(make('span', '', title), count);
      const body = make('div', 'ttd-body');
      body.hidden = folded.has(name);
      section.append(head, body);
      list.append(section);
      sections[name] = { section, head, body, count, key: null };
    });
    root.append(head, quiet, gone, list);
    return {
      paneId,
      root,
      head,
      state,
      doing,
      quiet,
      total,
      gone,
      list,
      sections,
      stale: false,
      fresh: true,
      totalMs: 0,
    };
  }

  function mount(host, paneId) {
    if (!host || !paneId) return false;
    unmount(host);
    const view = build(String(paneId));
    view.host = host;
    view.onPress = event => onPress(view, event);
    view.onToggle = event => {
      const key = event.target.dataset?.open;
      if (key) event.target.open ? openDetails.add(key) : openDetails.delete(key);
    };
    view.root.addEventListener('click', view.onPress);
    view.root.addEventListener('toggle', view.onToggle, true);
    host.append(view.root);

    // Hidden with its tab and shown again later: what changed meanwhile is drawn then.
    view.sizeWatch = new ResizeObserver(() => {
      if (view.stale) schedule();
    });
    view.sizeWatch.observe(view.root);
    if (!views.size) startListening();
    views.set(host, view);
    draw(view);
    return true;
  }

  function unmount(host) {
    const view = views.get(host);
    if (!view) return false;
    view.sizeWatch.disconnect();
    view.root.querySelectorAll('.ttd-clamp').forEach(span => clampWatch.unobserve(span));
    view.root.removeEventListener('click', view.onPress);
    view.root.removeEventListener('toggle', view.onToggle, true);
    view.root.remove();
    views.delete(host);
    if (!views.size) stopListening();
    return true;
  }

  window.TnaiThreadDetails = {
    // Draws the details of the agent in the terminal panel `paneId` into `host`, and keeps them
    // current until unmount(host). A second mount on the same host replaces the first.
    mount,
    unmount,

    // Draws a copy again now (all copies when no host is given).
    refresh(host) {
      const view = host ? views.get(host) : null;
      if (view) draw(view);
      else if (!host) views.forEach(draw);
    },

    // The color step of a total running time: 'ok', 'long' or 'over'.
    upTone,

    // For tests and for the part that wires this in: what is mounted, whether anything is being
    // listened to, how many section repaints happened so far, which sections are folded.
    state: () => ({
      mounted: [...views.values()].map(view => ({
        paneId: view.paneId,
        totalMs: view.totalMs,
        total: view.total.hidden ? '' : view.total.textContent,
        stale: view.stale,
      })),
      listening: stops.length > 0,
      draws: drawCount,
      folded: [...folded],
      sections: SECTIONS.map(([name]) => name),
    }),
  };
})();
