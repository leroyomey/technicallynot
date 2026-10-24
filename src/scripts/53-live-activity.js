// Technically Not · 53-live-activity.js — Desktop app only: what every agent is doing right now on
// Overview. Overview's header working/waiting counts are clickable (the "Live activity" band on the
// Agents page, its feed and its counts row, was removed 2026-10-07; the last 30
// events are still kept for Overview's Activity list, 94), and `doing(paneId)` for the cards' "Now"
// line (11). Only pushed, real sources: Claude Code hook events (agent:event), turns + tokens +
// queued prompts (agent:turn), permission prompts (agent:permission), finished results
// (context:changed), pane start/exit (TnaiAgents.onChange), and other CLIs' file activity (13,
// marked inferred). `window.TnaiLiveFeed` (items, note, doing, asking).
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  const page = document.getElementById('agentPage');
  if (!native?.agentEvents || !agents || !page) return;
  const header = page.querySelector('.agent-page-header');
  if (!header) return;

  const MAX = 30,
    HOUR = 3600000;
  const items = []; // newest first: { id, at, paneId, name, agent, text, kind, inferred }

  // paneId -> { tool, detail, at } latest lead tool call of the open Claude Code turn
  const current = new Map();
  const perms = new Map(); // permission id -> { paneId, tool, detail, at }

  // paneId -> { at, text, options, inferred } a question waiting for the user's answer
  const asks = new Map();
  const turns = new Map(); // paneId|startedAt -> { paneId, startedAt, endedAt, tokens, queued }
  const lastTurn = new Map(); // paneId -> key of its latest turn
  const running = new Map(); // paneId -> running (pane start/exit)
  const fileSeen = new Map(); // paneId -> at of the last file action taken from 13

  // CLIs whose tool steps arrive without prompt / stop events (desktop/agent-hooks.js onStep:
  // OpenCode's plugin): their open turn (desktop/agent-turns.js) is what "busy" means for the Now
  // line, and their file rows come from the steps, not from 13's reading of the output.
  const STEP_TURN = new Set(['OpenCode']);
  const stepped = new Set(); // paneIds of such a CLI that have sent a step
  let entries = [],
    lastSeq = 0,
    root = '',
    nextId = 1;

  // ---------- words ----------
  const clip = (s, n = 90) => {
    s = String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const rel = p => {
    const f = String(p || '').replace(/\\/g, '/'),
      r = root.replace(/\\/g, '/').replace(/\/$/, '');
    return r && f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : f;
  };
  const used = k => (k ? (k.input || 0) + (k.cacheWrite || 0) + (k.output || 0) : 0);
  const fmtTok = n => window.TnaiTurns?.format?.tokens?.(n) || String(n);
  const fmtDur = ms => window.TnaiTurns?.format?.duration?.(ms) || Math.round(ms / 1000) + 's';
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  // One tool call in words: [present participle for the card, present tense for the feed].
  function toolWords(tool, detail) {
    const d = clip(
      /^(Edit|MultiEdit|Write|Read|NotebookEdit)$/.test(tool) ? rel(detail) : detail,
      80
    );
    const pick =
      {
        Edit: ['Editing', 'edits'],
        MultiEdit: ['Editing', 'edits'],
        NotebookEdit: ['Editing', 'edits'],
        Write: ['Writing', 'writes'],
        Read: ['Reading', 'reads'],
        Bash: ['Running', 'runs:'],
        PowerShell: ['Running', 'runs:'],
        Grep: ['Searching for', 'searches for'],
        Glob: ['Looking for files', 'looks for files'],
        WebFetch: ['Fetching', 'fetches'],
        WebSearch: ['Searching the web for', 'searches the web for'],
        Skill: ['Using skill', 'uses skill'],
        TodoWrite: ['Updating its plan', 'updates its plan'],
        Agent: ['Starting a sub-agent', 'starts a sub-agent'],
        Task: ['Starting a sub-agent', 'starts a sub-agent'],
      }[tool] ||
      (/^mcp__tnai__tnai_/.test(tool)
        ? ['Coordinating agents', 'coordinates agents: ' + tool.replace(/^mcp__tnai__/, '')]
        : ['Using ' + tool, 'uses ' + tool]);
    const withDetail = tool !== 'TodoWrite' && d;
    return [pick[0] + (withDetail ? ' ' + d : ''), pick[1] + (withDetail ? ' ' + d : '')];
  }

  // ---------- names ----------
  // agents.sessions() builds every session afresh (a DOM read each); one feed render asks it per
  // row several times, so it is read once per task.
  let sessMemo = null;
  const allSessions = () => {
    if (!sessMemo) {
      sessMemo = agents.sessions();
      queueMicrotask(() => {
        sessMemo = null;
      });
    }
    return sessMemo;
  };
  const sessionOf = paneId => allSessions().find(s => s.paneId === paneId);
  const paneTitle = paneId =>
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"] .terminal-pane-title'
      )
      ?.textContent.trim() || '';
  const subName = (paneId, agentId) => {
    if (!agentId) return '';
    const s = window.TnaiTeam?.get?.(paneId)?.subs?.find(x => x.agentId === agentId);
    return s?.alias || s?.description || 'sub-agent';
  };

  // ---------- feed ----------
  function add(paneId, text, kind = 'info', extra = {}) {
    const s = sessionOf(paneId);
    const item = {
      ...extra,
      id: nextId++,
      at: extra.at || Date.now(),
      paneId,
      name: s?.name || paneTitle(paneId),
      agent: s?.agent || extra.agent || '',
      text,
      kind,
    };
    const top = items[0];
    if (
      top &&
      top.paneId === paneId &&
      top.text === text &&
      top.sub === item.sub &&
      item.at - top.at < 5000
    )
      return; // same thing twice in a row
    items.unshift(item);
    items.sort((a, b) => b.at - a.at);
    if (items.length > MAX) items.length = MAX;
  }

  // Claude Code hook events (desktop/agent-hooks.js), in order; 19 has already applied the same
  // event, so sub-agent names are known.
  function onEvent(e, replay) {
    if (!e?.paneId || (e.seq && e.seq <= lastSeq)) return;
    if (e.seq) lastSeq = e.seq;
    const at = e.at || Date.now(),
      sub = e.agentId ? subName(e.paneId, e.agentId) : '';
    const opts = { at, sub, agent: 'Claude Code' };
    switch (e.kind) {
      case 'prompt':
        if (!e.agentId) {
          current.set(e.paneId, { tool: '', detail: '', at });
          setAsk(e.paneId, null, replay);
        }
        add(
          e.paneId,
          'got a task: ' +
            clip(
              window.TnaiResults?.cleanTask?.(e.text) ??
                String(e.text || '').replace(/^\[(?:TN|TechnicallyNot)\.ai\]\s*/, ''),
              110
            ),
          'work',
          opts
        );
        break;
      case 'tool': {
        if (!e.agentId) {
          current.set(e.paneId, { tool: e.tool, detail: e.detail, at });
          setAsk(e.paneId, null, replay);
        }
        if (!stepped.has(e.paneId) && STEP_TURN.has(sessionOf(e.paneId)?.agent))
          stepped.add(e.paneId);
        add(
          e.paneId,
          toolWords(e.tool, e.detail)[1],
          /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(e.tool) ? 'edit' : 'work',
          opts
        );
        break;
      }
      case 'spawn':
        add(e.paneId, 'starts a sub-agent: ' + clip(e.description || e.type, 80), 'work', opts);
        break;
      case 'sub-stop':
        add(e.paneId, 'finished its part', 'done', opts);
        break;
      case 'sub-note':
        add(
          e.paneId,
          /fail|error|kill/i.test(e.status || '')
            ? 'a sub-agent failed'
            : 'a background sub-agent reported back',
          /fail|error|kill/i.test(e.status || '') ? 'error' : 'done',
          opts
        );
        break;
      case 'ask': {
        // Claude Code's multiple-choice picker (AskUserQuestion) is on screen in its terminal
        const q = (e.questions || [])[0] || {},
          more = (e.questions || []).length - 1;
        const text =
          clip(q.question || 'a question', 120) + (more > 0 ? ' (+' + more + ' more)' : '');
        setAsk(e.paneId, { at, text, options: q.options || [], inferred: false }, replay);
        add(e.paneId, 'asks you: ' + text, 'wait', opts);
        break;
      }
      case 'ask-done':
        if (asks.get(e.paneId) && !asks.get(e.paneId).inferred) {
          setAsk(e.paneId, null, replay);
          add(e.paneId, 'got your answer', 'info', opts);
        }
        break;

      // a turn that ended on a question waits for the user's reply (inferred from its last words)
      case 'stop':
        current.delete(e.paneId);
        setAsk(
          e.paneId,
          e.question ? { at, text: clip(e.question, 120), options: [], inferred: true } : null,
          replay
        );
        if (e.question)
          add(e.paneId, 'asks you: ' + clip(e.question, 110), 'wait', { ...opts, inferred: true });
        break; // "finished" comes from its turn (duration + tokens)
      case 'mesh-in':
        add(
          e.paneId,
          'got a message from ' + (e.from || 'another agent') + ': ' + clip(e.text, 80),
          'info',
          { at }
        );
        break;
      case 'mesh-out':
        if (/^Not delivered/.test(e.text || ''))
          add(
            e.paneId,
            'could not message ' +
              (e.to || 'an agent') +
              ': ' +
              clip(e.text.replace(/^Not delivered:\s*/, ''), 60),
            'error',
            { at }
          );
        break;
    }
  }

  function setAsk(paneId, ask, replay) {
    if (!ask && !asks.has(paneId)) return;
    ask ? asks.set(paneId, ask) : asks.delete(paneId);

    // cards (11) and the Agents page (25) say it waits for you
    if (!replay) window.dispatchEvent(new CustomEvent('tnai:live-activity'));
  }
  native.agentEvents.on(e => onEvent(e));
  native.agentEvents
    .history()
    .then(list => (list || []).sort((a, b) => a.seq - b.seq).forEach(e => onEvent(e, true)))
    .catch(() => {})
    .finally(() => {
      for (const s of agents.sessions()) {
        const a = asks.get(s.paneId);
        if (a && (!s.running || (s.startedAt && a.at < s.startedAt))) asks.delete(s.paneId);
      } // replayed questions of a stopped/earlier process
      window.dispatchEvent(new CustomEvent('tnai:live-activity'));
    });

  // Turns (desktop/agent-turns.js): start (CLIs without a prompt hook), finish with duration +
  // tokens, prompts queued meanwhile.
  function onTurn(t, initial) {
    if (!t?.paneId) return;
    if (t.cleared) {
      lastTurn.delete(t.paneId);
      return;
    }
    const key = t.paneId + '|' + t.startedAt,
      prev = turns.get(key);
    turns.set(key, {
      paneId: t.paneId,
      startedAt: t.startedAt,
      endedAt: t.endedAt || 0,
      tokens: used(t.tokens),
      queued: (t.queued || []).length,
    });
    lastTurn.set(t.paneId, key);

    // A CLI without a prompt event: its open turn is the start of "Thinking", until its first step
    // of this turn arrives.
    if (!t.endedAt && STEP_TURN.has(t.agent)) {
      const c = current.get(t.paneId);
      if (!c || c.at < t.startedAt)
        current.set(t.paneId, { tool: '', detail: '', at: t.startedAt });
    }

    // Claude Code sends no Stop hook on an interrupt (Esc) or exit: the ended turn clears the
    // card's Now line (and a question it was waiting on).
    if (t.endedAt) {
      const c = current.get(t.paneId);
      if (c && c.at <= t.endedAt) current.delete(t.paneId);
      const a = asks.get(t.paneId);
      if (a && t.endedBy && t.endedBy !== 'stop' && a.at <= t.endedAt)
        setAsk(t.paneId, null, initial);
    }
    if (!initial) {
      if (!prev && !t.endedAt && t.source !== 'claude-transcript')
        add(t.paneId, 'started a task' + (t.task ? ': ' + clip(t.task, 100) : ''), 'work');
      if (!t.endedAt && (t.queued || []).length > (prev?.queued || 0)) {
        const q = t.queued[t.queued.length - 1];
        add(
          t.paneId,
          'has a prompt queued: ' + clip(q?.text, 80) + ' (' + t.queued.length + ' waiting)',
          'wait'
        );
      }
      if (t.endedAt && !prev?.endedAt) {
        const tok = used(t.tokens),
          took = fmtDur(t.endedAt - t.startedAt);
        add(
          t.paneId,
          (t.endedBy === 'stop' ? 'finished · took ' : 'stopped after ') +
            took +
            (tok ? ' · ' + fmtTok(tok) + ' tokens' : ''),
          t.endedBy === 'stop' ? 'done' : 'error',
          { turn: key, at: t.endedAt }
        );
      }
    }
    for (const [k, v] of turns)
      if (v.endedAt && Date.now() - v.endedAt > HOUR && lastTurn.get(v.paneId) !== k)
        turns.delete(k);
  }
  native.agentTurns?.on(t => onTurn(t));
  native.agentTurns
    ?.state()
    .then(list => (list || []).forEach(t => onTurn(t, true)))
    .catch(() => {});

  // Permission prompts (45 shows the card; this counts them and puts them in the feed).
  function onPermission(p, initial) {
    if (!p?.id) return;
    if (p.done) {
      const was = perms.get(p.id);
      perms.delete(p.id);
      if (was) {
        add(was.paneId, 'got an answer about ' + (was.tool || 'a tool'), 'info');
        window.dispatchEvent(new CustomEvent('tnai:live-activity'));
      }
      return;
    }
    if (perms.has(p.id)) return;
    perms.set(p.id, {
      paneId: p.paneId,
      tool: p.tool || 'a tool',
      detail: p.detail || '',
      at: p.at || Date.now(),
    });

    // the agent's card says it waits for you (11 asks doing())
    window.dispatchEvent(new CustomEvent('tnai:live-activity'));
    if (!initial || Date.now() - (p.at || 0) < HOUR)
      add(
        p.paneId,
        'needs your OK for ' + (p.tool || 'a tool') + (p.detail ? ': ' + clip(p.detail, 70) : ''),
        'wait',
        { at: p.at || Date.now(), perm: p.id }
      );
  }
  native.permissions?.on(p => onPermission(p));
  native.permissions
    ?.pending()
    .then(list => (list || []).forEach(p => onPermission(p, true)))
    .catch(() => {});

  // Finished results: next steps / blockers from the shared project context
  // (desktop/agent-context.js), matched to the turn that wrote them.
  const loadContext = () =>
    Promise.resolve(window.TnaiContextState?.() ?? native.context?.state())
      .then(s => {
        entries = s?.entries || [];
      })
      .catch(() => {});
  native.context?.onChange(loadContext);
  loadContext();

  function resultNote(item) {
    if (!item.turn) return '';
    const [paneId, startedAt] = [item.paneId, +item.turn.split('|').pop()];
    const e = entries.find(x => x.paneId === paneId && x.startedAt === startedAt),
      s = e?.summary;
    if (!s) return '';
    if (s.blockers?.length) return ' · blocked';
    if (s.next?.length) return ' · ' + plural(s.next.length, 'next step');
    return '';
  }

  // Pane start/exit (10 pushes session changes); other CLIs' file actions from 13 (inferred from
  // their output).
  let seeded = false; // the first look only records what already runs

  function onSessions() {
    sessMemo = null;
    const seen = new Set();
    for (const s of agents.sessions()) {
      seen.add(s.paneId);
      const was = running.get(s.paneId),
        now = !!s.running;
      if (seeded ? (was ?? false) !== now : was !== undefined && was !== now) {
        if (now) {
          if (was !== undefined || !s.startedAt || Date.now() - s.startedAt < 15000)
            add(s.paneId, 'started' + (s.agent ? ' · ' + s.agent : ''), 'info');
        } else {
          const why = (s.exitText || 'exited')
            .replace(/^Exited/, 'stopped')
            .replace(/^Stopped by/, 'stopped by');
          add(
            s.paneId,
            s.exitCode ? why : 'exited',
            s.exitCode && !why.startsWith('stopped by') ? 'error' : 'info'
          );
        }
      }
      running.set(s.paneId, now);
      if (!now) current.delete(s.paneId);

      // A question belongs to the process that asked it: gone once it stops, or when a newer
      // process runs in the pane (restart/resume).
      const ask = asks.get(s.paneId);
      if (ask && (!now || (s.startedAt && ask.at < s.startedAt))) setAsk(s.paneId, null);
    }
    for (const id of [...running.keys()])
      if (!seen.has(id)) {
        running.delete(id);
        current.delete(id);
        fileSeen.delete(id);
        stepped.delete(id);
        setAsk(id, null);
      }
    seeded = true;
  }
  agents.onChange(onSessions);
  onSessions();
  window.addEventListener('tnai:file-activity', () => {
    for (const s of agents.sessions()) {
      if (
        !s.running ||
        s.agent === 'Claude Code' ||
        s.agent === 'Terminal' ||
        stepped.has(s.paneId)
      )
        // Claude Code reports its tools exactly (hooks above); so does a CLI that sends steps
        continue;
      const a = window.TnaiFileActivity?.now?.(s.paneId);
      if (!a || a.at === fileSeen.get(s.paneId)) continue;
      const first = !fileSeen.has(s.paneId);
      fileSeen.set(s.paneId, a.at);
      if (!first || Date.now() - a.at < 5000)
        add(s.paneId, String(a.verb || 'touches').toLowerCase() + ' ' + rel(a.path), 'edit', {
          inferred: true,
          at: a.at,
        });
    }
  });
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    current.delete(id);
    running.delete(id);
    setAsk(id, null);
  });
  const loadRoot = () =>
    native.fs
      ?.root?.()
      .then(r => {
        root = r || '';
      })
      .catch(() => {});
  window.addEventListener('tnai:project-changed', () => {
    loadRoot();
  });
  loadRoot(); // rows re-check which project is shown (elsewhere)

  // ---------- what a card's "Now" line says (11 asks on every card update) ----------
  function doing(paneId) {
    const s = sessionOf(paneId);
    if (!s?.running) return null;
    const perm = [...perms.values()]
      .filter(p => p.paneId === paneId)
      .sort((a, b) => a.at - b.at)[0];
    if (perm)
      return {
        text:
          'Waiting for your OK · ' + perm.tool + (perm.detail ? ' ' + clip(perm.detail, 60) : ''),
        since: perm.at,
        tone: 'waiting',
        tip:
          (s.agent === 'OpenCode' ? 'OpenCode' : 'Claude Code') +
          ' asked to use ' +
          perm.tool +
          ' and waits for your answer (the card bottom right, or its CLI screen)',
      };
    const ask = asks.get(paneId);
    if (ask) {
      const choices = ask.options.map((o, i) => i + 1 + ' ' + o).join(' · ');
      return {
        text: 'Waiting for your answer · ' + ask.text + (choices ? ' · ' + choices : ''),
        since: ask.at,
        tone: 'waiting',
        ask: true,
        tip:
          (ask.inferred
            ? 'Its last message ended with a question (inferred from its words).'
            : 'Claude Code shows a multiple-choice question on its CLI screen.') +
          ' Open its CLI screen to answer' +
          (choices ? ' (type the option number).' : '.'),
      };
    }
    const c = current.get(paneId);
    const step = STEP_TURN.has(s.agent),
      // its latest turn, when this CLI's busy is its open turn
      open = step && turns.get(lastTurn.get(paneId));
    if (
      !c ||
      !(step ? open && !open.endedAt && c.at >= open.startedAt : window.TnaiTeam?.busy?.(paneId))
    )
      return null;
    if (!c.tool)
      return {
        text: 'Thinking',
        since: c.at,
        tip: step
          ? s.agent + ' took the task and has not called a tool yet (from its own session record)'
          : 'Claude Code took the task and has not called a tool yet (from its hooks)',
      };

    // In plain words (183: "Running a test"), with the folder a command runs in and the call as
    // the tool reported it, which the thread list and the Working line keep as their tip.
    const plain = window.TnaiPlainWords?.step?.(c.tool, c.detail);
    return {
      text: plain?.text || toolWords(c.tool, c.detail)[0],
      folder: plain?.folder || '',
      raw: plain?.raw || toolWords(c.tool, c.detail)[0],
      since: c.at,
      tip:
        'Latest tool call from ' +
        (step ? s.agent + '’s step events' : 'Claude Code’s hooks') +
        ', started ' +
        fmtDur(Date.now() - c.at) +
        ' ago',
    };
  }

  // ---------- view ----------
  const style = document.createElement('style');
  style.textContent = `
.tnai-live-metrics .agent-metric[data-status]{cursor:pointer}.tnai-live-metrics .agent-metric[data-status]:hover b{text-decoration:underline}
.tnai-card.tnai-flash{animation:tnaiFlash 1.2s ease-out 1}
@keyframes tnaiFlash{0%,40%{box-shadow:0 0 0 3px #c7a24e66}}
.tnai-card[data-perm] .c-now{color:#9a7a30!important}
.tnai-card[data-ask] .c-now::before{content:'Your answer';display:inline-block;margin-right:5px;padding:0 5px;border-radius:3px;background:#f6ecd4;color:#8a6a22;font:600 8px/14px var(--pg-sans);vertical-align:1px}
`;
  document.head.append(style);

  const who = item =>
    (sessionOf(item.paneId)?.name || item.name || paneTitle(item.paneId) || 'Agent') +
    (item.sub ? ' › ' + item.sub : '');
  const lineOf = item =>
    who(item) + ' ' + item.text + resultNote(item) + (item.inferred ? ' (inferred)' : '');

  // ---------- clicks ----------
  const openAgent = paneId => {
    if (!paneId) return;
    window.TnaiLiveTasks?.setTarget?.(paneId);

    // Its thread; the Threads page itself when it has none (its panel was closed).
    if (!window.TnaiThreads?.show?.(paneId)) window.TnaiThreads?.open?.();
  };

  // Show these agents: flash their cards in the Overview tree, or open the first one's thread
  // when the tree isn't on screen.
  function showPanes(paneIds) {
    const cards = paneIds
      .map(id => page.querySelector('.tnai-card[data-pane="' + CSS.escape(id) + '"]'))
      .filter(Boolean);
    if (!cards.length || !page.offsetParent) {
      openAgent(paneIds[0]);
      return;
    }
    cards[0].scrollIntoView({ block: 'nearest' });
    cards.forEach(card => {
      card.classList.remove('tnai-flash');
      void card.offsetWidth;
      card.classList.add('tnai-flash');
    });
    setTimeout(() => cards.forEach(card => card.classList.remove('tnai-flash')), 1300);
  }
  header.addEventListener('click', event => onPulse(event.target));
  const TONE_OF = {
    working: 'working',
    waiting: 'waiting',
    'waiting-agents': 'waiting-agents',
    'needs-you': 'needs-you',
    error: 'error',
  };

  function onPulse(target) {
    const metric = target.closest('.tnai-live-metrics .agent-metric[data-status]');
    if (metric && TONE_OF[metric.dataset.status]) {
      const ids = agents
        .sessions()
        .filter(
          s =>
            s.status === metric.dataset.status ||
            (metric.dataset.status === 'working' && s.status === 'background')
        )
        .map(s => s.paneId);
      if (ids.length) showPanes(ids);
      return true;
    }
    return false;
  }

  // asking: 10's status() asks it per pane inside agents.sessions(), so a pane with no question
  // answers before building every session.
  window.TnaiLiveFeed = {
    items: () => items.map(item => ({ ...item, line: lineOf(item) })),
    note: (paneId, text) => add(paneId, clip(text, 160), 'info'),
    doing,
    asking: paneId => (asks.has(paneId) && sessionOf(paneId)?.running && asks.get(paneId)) || null,
  };
})();
