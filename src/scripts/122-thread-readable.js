/*
 * Technically Not · 122-thread-readable.js — the thread layout's Readable view: a thread as its
 * conversation. Desktop app only; draws into
 * the pane 120 gives it, and does nothing while the thread layout is off, its page is hidden, or
 * the open thread is shown as its terminal.
 *
 * Everything shown is read from the tool's own record of the conversation, by the main process
 * (desktop/thread-log.js, one reader per tool; Claude Code so far): your prompt as a bubble, the
 * agent's words, each action as a quiet line (the file with its line counts, or the command with
 * what it gave back), a question the agent asks, how long the task took with the files it changed,
 * and the Technically Not report as a card whose Decide options are buttons. Nothing is guessed.
 * The one line that is not from the record is the last one while the agent works ("Working · …"):
 * it is the list's own line (119) and says "inferred" when it is.
 *
 * Reading is asked for, never polled: when the thread opens, and when the app pushes that the
 * session did something (a task started or ended, 42; a tool call, the CLI's hooks). Only what was
 * added since the last read comes back. A thread keeps at most MAX_BLOCKS blocks on screen; of a
 * long old conversation the main process reads only the end, and the pane says so.
 *
 * Answering in place: a tool permission is the app's own card in the row under the thread (121); a
 * report's decision goes through the app's own decision flow (49 `TnaiContext.decide`); a question
 * the agent asks with its own tool is answered in the terminal, one press away, until its keys
 * have been measured on the real CLI.
 *
 * Look: src/styles/30-thread-readable.css. `window.TnaiThreadReadable` (`can`, `state`). Tests:
 * `node tools/thread-log-test.js` (the reader), desktop tests `thread-readable` and `real-thread`.
 */
(() => {
  'use strict';
  const native = window.tnaiNative;
  const threads = () => window.TnaiThreads;

  // The tools whose conversation the main process can read (desktop/thread-log.js READERS).
  const READABLE = new Set(['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent']);
  const MAX_BLOCKS = 400;
  const KEEP_THREADS = 4;
  const READ_GAP_MS = 120;
  const REPORT_MARK = /^[ \t]*Technically Not report[ \t]*$/m;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const duration = ms =>
    safe(() => window.TnaiTurns?.format?.duration?.(ms), '') || Math.round(ms / 1000) + 's';
  const markdown = text => {
    const html = safe(() => window.TnaiResults?.markdown?.(text), '');
    if (html) return html;

    // without the app's markdown the words are shown as plain text
    const plain = make('p', '', text);
    return plain.outerHTML;
  };

  // Lines added and removed, as the mock writes them: "+18 −3". A side with nothing is left out.
  const countNodes = (added, removed) => {
    const nodes = [];
    if (added || !removed) nodes.push(make('u', '', '+' + (added || 0)));
    if (removed) nodes.push(make('s', '', '−' + removed));
    return nodes;
  };

  // ---------- one thread's state ----------
  // paneId -> { paneId, list, next, reading, wanted, acts, files, cut, readable, found, topic,
  // live, first }, least recently shown first
  const states = new Map();
  let open = null;

  // the conversations on screen now: the open thread's, and a helper's beside it (123)
  const shown = new Set();
  const SEPARATOR = String.fromCharCode(0);

  // `sub`: a sub-agent of the panel's agent, whose own conversation this is ('' = the agent's).
  function stateFor(paneId, sub = '') {
    const key = paneId + SEPARATOR + sub;
    let state = states.get(key);
    if (state) {
      states.delete(key);
      states.set(key, state);
      return state;
    }
    state = {
      key,
      paneId,
      sub,
      host: null,
      list: make('div', 'tnt-talk-list'),
      next: -1,
      reading: false,
      wanted: false,
      timer: 0,
      acts: new Map(),
      says: new Map(),
      seen: new Set(),
      files: new Map(),
      cut: false,
      found: true,
      topic: '',
      first: true,
      live: make('div', 'tnt-live'),
      empty: make('div', 'tnt-talk-empty'),
    };
    state.live.hidden = true;
    state.live.innerHTML = '<i></i><span></span><em hidden>· inferred</em>';
    states.set(key, state);
    for (const [id, old] of states) {
      if (states.size <= KEEP_THREADS) break;
      if (id !== key && !shown.has(old)) states.delete(id);
    }
    return state;
  }

  // ---------- drawing ----------
  const END_GAP = 48;
  const gapToEnd = host => host.scrollHeight - host.scrollTop - host.clientHeight;

  // Whether the reader was at the newest line when the pane last scrolled. A pane that gets
  // lower (a question's card opens under the conversation) or a conversation that grows moves
  // the end away without a scroll, and a reader who was at the end is still "at the end": new
  // lines after that were otherwise never followed again.
  const atEnd = new WeakMap();
  const paneSized = new ResizeObserver(entries =>
    entries.forEach(({ target }) => {
      if (atEnd.get(target)) target.scrollTop = target.scrollHeight;
    })
  );

  function watchEnd(host) {
    if (atEnd.has(host)) return;
    atEnd.set(host, true);
    host.addEventListener('scroll', () => atEnd.set(host, gapToEnd(host) < END_GAP), {
      passive: true,
    });
    paneSized.observe(host);
  }
  const nearBottom = ({ host }) => !host || atEnd.get(host) === true || gapToEnd(host) < END_GAP;
  const toBottom = ({ host }) => {
    if (!host) return;
    host.scrollTop = host.scrollHeight;

    // Blocks out of view are not laid out (30: content-visibility), so the height above is partly
    // a guess. Once the last blocks are drawn the real end is known: go there again.
    requestAnimationFrame(() => {
      if (host.isConnected) host.scrollTop = host.scrollHeight;
    });
  };

  // Blocks stand in order above the live line, which is always last.
  function addBlock(state, node) {
    state.list.insertBefore(node, state.live);
    const blocks = state.list.children;

    // the cap: the oldest blocks leave, and the pane says that it shows the end only
    let removed = false;
    while (blocks.length - 1 > MAX_BLOCKS) {
      blocks[0].remove();
      removed = true;
    }
    if (removed) {
      state.cut = true;

      // an action whose line left the screen can no longer get its result
      for (const [id, known] of state.acts) if (!known.line.isConnected) state.acts.delete(id);
    }
    return node;
  }

  function addYou(state, entry) {
    state.files = new Map();

    // a question still open when the user writes again is an earlier one: it can no longer be
    // answered from here
    state.list.querySelectorAll('.tnt-askbox[data-state="open"]').forEach(box => {
      box.dataset.state = 'answered';
      box.querySelector('.tnt-ask-go').hidden = true;
      box.querySelector('.tnt-ask-done').hidden = false;
    });
    if (entry.text) addBlock(state, make('div', 'tnt-you', entry.text));
    addAdded(state, entry, 'tnt-added tnt-added-you');
  }

  function addFrom(state, entry) {
    const block = make('div', 'tnt-from');
    block.append(make('small', '', 'From ' + entry.who), make('div', '', entry.text));
    addBlock(state, block);
    addAdded(state, entry, 'tnt-added');
  }

  // What the app wrote around a prompt before sending it (the reader keeps it apart, as `added`)
  // is one quiet line under the words; a press shows it. The bubble holds what the user typed,
  // so a long note of the app never stands in it under a one-word prompt.
  function addAdded(state, entry, className) {
    if (!entry.added?.length) return;
    const block = make('div', className);
    const press = make('button', 'tnt-added-press');
    press.type = 'button';
    press.setAttribute('aria-expanded', 'false');
    press.innerHTML =
      '<span>Technically Not added context</span>' +
      (safe(() => window.TnaiIcon?.('chevron-right', { size: 14 }), '') || '');
    press.title = 'What the app wrote around this prompt before it sent it. Press to read it';
    const text = make('div', 'tnt-added-text', entry.added.join('\n\n'));
    text.hidden = true;
    press.addEventListener('click', () => {
      text.hidden = !text.hidden;
      press.setAttribute('aria-expanded', String(!text.hidden));
    });
    block.append(press, text);
    addBlock(state, block);
  }

  // Status sections in a reply ("Done:", "Where we stopped:", "Still open:", "Your turn:",
  // "Heads up:") and the outcome word of an "Outcome: Fixed" line get the colors they have in
  // the terminal. 75 says what a line is; this only marks the nodes.
  function colorReply(block) {
    const read = window.TnaiReportHighlight?.readLine;
    if (!read) return;
    block.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6').forEach(node => {
      const firstLine = node.textContent.trim().split(/\r?\n/)[0];
      const found = safe(() => read(firstLine), null);
      if (!found) return;
      if (found.section) {
        node.dataset.section = found.section;

        // a heading on its own line colors the list under it too
        const list = node.nextElementSibling;
        if (node.tagName !== 'LI' && list && /^(UL|OL)$/.test(list.tagName))
          list.dataset.section = found.section;
        return;
      }

      // the outcome word alone: the last text in the line that ends with it
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let last = null;
      while (walker.nextNode()) if (walker.currentNode.data.trim()) last = walker.currentNode;
      const at = last ? last.data.toLowerCase().lastIndexOf(found.word.toLowerCase()) : -1;
      if (at < 0) return;
      const word = last.splitText(at);
      word.splitText(found.word.length);
      const mark = make('span', 'tnt-outcome', word.data);
      mark.dataset.outcome = found.outcome;
      word.replaceWith(mark);
    });
  }

  function addNote(state, text) {
    addBlock(state, make('div', 'tnt-note', text));
  }

  // The report agents end a task with: its lines as a card. A "- Decide:" line is a question with
  // its options; the buttons are wired by paintDecisions.
  function reportCard(text) {
    const card = make('section', 'tnt-report');
    card.append(make('h3', '', 'Technically Not report'));
    let decision = 0;
    for (const raw of text.split(/\r?\n/)) {
      const row = /^\s*-\s*([A-Za-z][A-Za-z ]{1,24}):\s*(.*)$/.exec(raw);
      if (!row) continue;
      const label = row[1].trim();
      const body = row[2].trim();
      if (!body) continue;
      if (/^Decide$/i.test(label)) {
        const parts = body.split(/\s*\|\s*/);
        const ask = make('div', 'tnt-decide');
        ask.dataset.decision = String(decision++);
        ask.append(make('b', '', parts[0]));
        const options = make('div', 'tnt-decide-options');
        parts.slice(1).forEach((part, index) => {
          const button = make('button', '', part.replace(/^\d+\.\s*/, ''));
          button.type = 'button';
          button.dataset.option = String(index);
          button.disabled = true;
          options.append(button);
        });
        ask.append(options);
        card.append(ask);
        continue;
      }
      const line = make('div', 'tnt-report-row');
      line.dataset.label = label.toLowerCase();

      // The label's color is the one it has in the terminal (75 owns the list of kinds).
      const kind = safe(() => window.TnaiReportHighlight?.labelKind?.(label), '');
      if (kind) line.dataset.kind = kind;
      const items = make('ul');
      body.split(/;\s+/).forEach(item => items.append(make('li', '', item)));
      line.append(make('span', '', label), items);
      card.append(line);
    }
    return card;
  }

  function addSay(state, entry) {
    const mark = REPORT_MARK.exec(entry.text);
    const words = (mark ? entry.text.slice(0, mark.index) : entry.text).trim();
    const report = mark ? entry.text.slice(mark.index + mark[0].length) : '';

    // Words that come again under the same id have grown (a tool that records them while they are
    // written): the same block is updated in place, and its report is added once it is there.
    // The report grows line by line too, and a "- Decide:" line comes last, after an empty line:
    // the card is built again whenever the report's text has changed, or the decision the thread
    // waits on would never be drawn.
    const known = entry.id ? state.says.get(entry.id) : null;
    if (known) {
      if (known.words !== words) {
        known.words = words;
        known.block.innerHTML = markdown(words);
        colorReply(known.block);
      }
      if (report && known.report !== report) {
        const card = reportCard(report);
        if (known.card?.isConnected) known.card.replaceWith(card);
        else known.block.after(card);
        known.card = card;
        known.report = report;
        paintDecisions(state);
      }
      return;
    }
    const block = make('div', 'tnt-say');
    block.innerHTML = words ? markdown(words) : '';
    colorReply(block);
    block.hidden = !words;
    addBlock(state, block);
    let card = null;
    if (report) {
      card = addBlock(state, reportCard(report));
      paintDecisions(state);
    }
    if (entry.id) state.says.set(entry.id, { block, card, words, report });
  }

  // ---------- actions ----------
  // Actions are quiet lines in the reading face: a small icon for the kind, the reader's own verb,
  // and the thing by its name, so a command's output never runs off the edge as raw terminal
  // lines inside the conversation. A file is shown by
  // its name, with its path on hover; a command by its name, with the whole command and what it
  // printed behind a press. Nothing is invented: every word is the reader's or the record's.
  const icon = (name, size) => safe(() => window.TnaiIcon?.(name, { size }), '') || '';
  const times = count => count + ' times';

  // verb (as the readers write it) → its icon, how its thing is shown, and its group's heading
  const VERBS = {
    Read: { icon: 'file-text', file: true, folds: true, many: n => 'Read ' + n + ' files' },
    'Read the skill': {
      icon: 'file-text',
      code: true,
      folds: true,
      many: n => 'Read ' + n + ' skills',
    },
    Edited: { icon: 'pencil', file: true, many: n => 'Edited ' + n + ' files' },
    Wrote: { icon: 'pencil', file: true, many: n => 'Wrote ' + n + ' files' },
    Deleted: { icon: 'pencil', file: true, many: n => 'Deleted ' + n + ' files' },
    Ran: { icon: 'terminal', command: true, many: n => 'Ran ' + n + ' commands' },
    'Searched for': { icon: 'search', folds: true, many: n => 'Searched ' + times(n) },
    'Looked for files': { icon: 'search', folds: true, many: n => 'Looked for files ' + times(n) },
    'Searched the web for': {
      icon: 'search',
      folds: true,
      many: n => 'Searched the web ' + times(n),
    },
    Opened: { icon: 'eye', folds: true, many: n => 'Opened ' + n + ' pages' },
    'Updated its checklist': {
      icon: 'circle-check',
      folds: true,
      many: n => 'Updated its checklist ' + times(n),
    },
  };
  const OTHER_VERB = { icon: 'square-terminal', many: (n, verb) => verb + ' · ' + n };
  const kindOf = verb => {
    const kind = VERBS[verb] || OTHER_VERB;
    return { ...kind, code: kind.code || kind.file || kind.command };
  };

  // Results a line says in a word of the reader's own; anything else a command printed is
  // behind the press.
  const QUIET_RESULTS = new Set(['Runs in the background', 'Interrupted']);

  // Programs whose first argument says what was run ("npm test", "git status").
  const RUNNERS = new Set(
    'npm npx pnpm yarn node git tnai python py cargo dotnet go gh docker powershell pwsh bash sh'.split(
      ' '
    )
  );
  const baseName = path =>
    String(path || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || String(path || '');

  // How an action's thing is shown on its line: a file by its name, a command by its name.
  function shownName(entry, kind) {
    const what = entry.what || '';
    if (kind.file) return baseName(what);
    if (!kind.command) return what;
    const words = (entry.full || what).trim().split(/\s+/);
    const first = baseName(words[0]);
    const second = words[1] || '';
    if (RUNNERS.has(first.toLowerCase()) && /^[\w./\\:-]+$/.test(second) && !second.startsWith('-'))
      return first + ' ' + baseName(second);
    return first;
  }

  // A sub-agent the lead started with its own tool has a record of its own. In the lead's
  // conversation it is a card; a press opens the helper's conversation beside the lead's (123).
  const startsHelper = (state, entry) =>
    !state.sub && (entry.tool === 'Agent' || entry.tool === 'Task') && READABLE.has('Claude Code');

  function addHelper(state, entry) {
    const card = make('button', 'tnt-helper');
    card.type = 'button';
    card.dataset.state = 'running';
    card.dataset.sub = entry.id;
    card.title = 'Open this helper’s own conversation beside this one';
    card.innerHTML =
      '<i class="tnt-helper-dot"></i><span class="tnt-helper-text"><b></b><small></small></span>' +
      '<span class="tnt-helper-open"></span>';
    card.querySelector('b').textContent = entry.what || 'Sub-agent';
    card.querySelector('small').textContent = 'Helper · working';
    card.querySelector('.tnt-helper-open').innerHTML =
      safe(() => window.TnaiIcon?.('chevron-right', { size: 16 }), '') || '';
    card.addEventListener('click', () =>
      window.dispatchEvent(
        new CustomEvent('tnai:thread-helper', {
          detail: { paneId: state.paneId, sub: entry.id, title: entry.what || 'Sub-agent' },
        })
      )
    );
    addBlock(state, card);
    state.acts.set(entry.id, { line: card, entry });
  }

  function addAct(state, entry) {
    if (state.acts.has(entry.id)) return;
    if (startsHelper(state, entry)) {
      addHelper(state, entry);
      return;
    }
    let block = state.live.previousElementSibling;
    if (!block?.classList.contains('tnt-did')) block = addBlock(state, make('div', 'tnt-did'));

    // Actions of one kind that follow each other are one group under a heading with a count.
    let group = block.lastElementChild;
    if (group?.dataset.verb !== entry.verb) {
      group = make('div', 'tnt-grp');
      group.dataset.verb = entry.verb;
      const head = make('button', 'tnt-grp-head');
      head.type = 'button';
      head.innerHTML =
        icon(kindOf(entry.verb).icon, 14) + '<span></span>' + icon('chevron-right', 14);
      head.addEventListener('click', () => {
        if (group.dataset.folds !== 'true') return;
        group.dataset.open = String(group.dataset.open !== 'true');
        head.setAttribute('aria-expanded', group.dataset.open);
      });
      group.append(head, make('div', 'tnt-grp-list'));
      block.append(group);
    }
    const kind = kindOf(entry.verb);
    const shown = shownName(entry, kind);
    const line = make('div', 'tnt-act');
    line.dataset.state = 'running';
    line.innerHTML = icon(kind.icon, 14);
    const what = make(kind.code ? 'code' : 'span', 'tnt-act-what', shown);

    // a name that was shortened says the whole of it on hover
    if (entry.what && shown !== entry.what) what.title = entry.what;
    line.append(make('span', 'tnt-act-verb', entry.verb), what);
    line.append(make('span', 'tnt-act-counts'), make('span', 'tnt-act-result'));

    // What stands behind a press: the whole command, what it printed, why it failed.
    const open = make('button', 'tnt-act-open');
    open.type = 'button';
    open.hidden = true;
    open.innerHTML = icon('chevron-right', 14);
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-label', 'Show the whole of it');
    const more = make('pre', 'tnt-act-more');
    more.hidden = true;
    line.append(open);
    line.addEventListener('click', () => {
      if (open.hidden || String(window.getSelection())) return;
      more.hidden = !more.hidden;
      open.setAttribute('aria-expanded', String(!more.hidden));
    });
    group.lastElementChild.append(line, more);
    const known = { line, entry, more, open };
    state.acts.set(entry.id, known);
    paintMore(known, null);
    paintGroup(group);
  }

  // The group's heading: shown from two actions on ("Read 3 files"). A group of things that were
  // only looked at folds behind its heading; one that changed something or ran something stays
  // open, since its lines carry results.
  function paintGroup(group) {
    const lines = group.querySelectorAll('.tnt-act');
    const kind = kindOf(group.dataset.verb);
    const many = lines.length > 1;
    const head = group.firstElementChild;
    group.dataset.many = String(many);
    group.dataset.folds = String(many && !!kind.folds);
    if (group.dataset.folds !== 'true') delete group.dataset.open;
    else if (!group.dataset.open) group.dataset.open = 'false';
    head.hidden = !many;
    if (group.dataset.folds === 'true') head.setAttribute('aria-expanded', group.dataset.open);
    else head.removeAttribute('aria-expanded');
    const failed = group.querySelectorAll('.tnt-act[data-state="failed"]').length;
    const words =
      kind.many(lines.length, group.dataset.verb) + (failed ? ' · ' + failed + ' failed' : '');
    const label = head.querySelector('span');
    if (label.textContent !== words) label.textContent = words;
  }

  // The text behind a press on an action: every part comes from the tool's own record.
  function paintMore(known, result) {
    const { entry, more, open } = known;
    const parts = [];
    const command = entry.full || '';
    if (entry.note) parts.push(entry.note);
    if (command && (command !== known.line.querySelector('.tnt-act-what').textContent || result))
      parts.push('$ ' + command);
    const printed = result ? result.more || result.text || '' : '';
    if (printed && !QUIET_RESULTS.has(printed)) parts.push(printed);
    const text = parts.join('\n\n');
    if (more.textContent !== text) more.textContent = text;
    open.hidden = !text;
    if (!text) more.hidden = true;
  }

  function addResult(state, entry) {
    const known = state.acts.get(entry.id);
    if (!known) return;
    const { line } = known;
    line.dataset.state = entry.failed ? 'failed' : 'done';
    if (line.classList.contains('tnt-helper')) {
      // the lead's record says the helper was started in the background, or what it came back with
      line.dataset.state = entry.failed ? 'failed' : entry.text ? 'running' : 'done';
      line.querySelector('small').textContent =
        'Helper · ' +
        (entry.failed ? 'failed' : entry.text ? entry.text.toLowerCase() : 'finished');
      return;
    }
    if (line.classList.contains('tnt-askbox')) {
      line.dataset.state = 'answered';
      line.querySelector('.tnt-ask-go').hidden = true;
      line.querySelector('.tnt-ask-done').hidden = false;
      return;
    }
    const counts = line.querySelector('.tnt-act-counts');

    // a result that comes again is shown again, and counted for the task's files only once
    const again = known.closed;
    known.closed = true;
    if (entry.added != null || entry.removed != null)
      counts.replaceChildren(...countNodes(entry.added, entry.removed));
    if (!again && (entry.added != null || entry.removed != null)) {
      const file = known.entry.what;
      const sum = state.files.get(file) || { added: 0, removed: 0, created: false };
      sum.added += entry.added || 0;
      sum.removed += entry.removed || 0;
      sum.created = sum.created || !!entry.created;
      state.files.set(file, sum);
    }

    // The line says the outcome in a word; what the action printed is behind a press.
    const word = entry.failed
      ? 'failed'
      : QUIET_RESULTS.has(entry.text)
        ? entry.text.toLowerCase()
        : '';
    line.querySelector('.tnt-act-result').textContent = word;
    paintMore(known, entry);
    const group = line.closest('.tnt-grp');
    if (group) paintGroup(group);
  }

  // A question the agent asks with its own tool: the one amber surface in the conversation.
  // Answering from the box: the choice's number is typed into the tool's terminal, where the tool
  // shows the question as a numbered menu. Measured on the real Claude Code 2.1.296 (desktop test
  // real-thread-ask, 2026-10-11): the number alone answers, no Enter is needed, so none is sent.
  // Only while the session runs and the question is the open one; never for a helper's question,
  // which is its lead's to see.
  function pressChoice(state, box, index) {
    const runs = safe(
      () => window.TnaiAgents.sessions().some(s => s.paneId === state.paneId && s.running),
      false
    );
    if (!runs || box.dataset.state !== 'open') return;
    box.dataset.state = 'sent';
    box.dataset.by = 'number';
    box.querySelectorAll('.tnt-ask-option').forEach(button => {
      button.disabled = true;
    });
    native.pty.write(state.paneId, String(index + 1));
  }

  function addAsk(state, entry) {
    const box = make('section', 'tnt-askbox');
    box.dataset.state = 'open';
    const canPress = !!entry.press && !state.sub && entry.questions[0]?.options.length <= 9;
    entry.questions.forEach(item => {
      box.append(make('b', '', item.question));
      if (!item.options.length) return;
      if (canPress) {
        const options = make('div', 'tnt-ask-options');
        item.options.forEach((option, index) => {
          const button = make('button', 'tnt-ask-option', option);
          button.type = 'button';
          button.addEventListener('click', () => pressChoice(state, box, index));
          options.append(button);
        });
        box.append(options);
        return;
      }
      const options = make('ul');
      item.options.forEach(option => options.append(make('li', '', option)));
      box.append(options);
    });
    const go = make('button', 'tnt-ask-go', 'Answer on the CLI screen');
    go.type = 'button';
    go.title = 'The tool shows this question as a menu on its own screen';
    go.addEventListener('click', () => {
      // from a helper's conversation beside the lead, the terminal is that agent's own thread
      if (threads().selected() !== state.paneId) threads().select(state.paneId);
      window.TnaiThreadView?.setMode('term');
    });
    const done = make('small', 'tnt-ask-done', 'Answered');
    done.hidden = true;
    box.append(go, done);
    addBlock(state, box);
    state.acts.set(entry.id, { line: box, entry });
  }

  // The end of a task: how long it took, and the files it changed with their line counts.
  function addWorked(state, entry) {
    const block = make('div', 'tnt-worked');

    // a tool that does not record how long a task took only says that it ended
    block.append(make('span', '', entry.ms ? 'Worked for ' + duration(entry.ms) : 'Finished'));
    if (state.files.size) {
      let added = 0;
      let removed = 0;
      const files = make('div', 'tnt-files');
      for (const [file, sum] of state.files) {
        added += sum.added;
        removed += sum.removed;
        const row = make('div', 'tnt-file');
        row.append(
          make('code', '', file),
          make('em', '', sum.created ? 'new' : ''),
          ...countNodes(sum.added, sum.removed)
        );
        files.append(row);
      }
      const head = make('div', 'tnt-files-head');
      head.append(
        make(
          'b',
          '',
          state.files.size + (state.files.size === 1 ? ' changed file' : ' changed files')
        ),
        ...countNodes(added, removed)
      );
      files.prepend(head);
      block.append(files);
    }
    addBlock(state, block);
    state.files = new Map();
  }

  function addEntries(state, entries) {
    for (const entry of entries) {
      // an entry with an id of its own is drawn once; words, actions and results look after
      // themselves, because they may change
      const changing = entry.kind === 'say' || entry.kind === 'act' || entry.kind === 'result';
      if (entry.id && !changing) {
        const key = entry.kind + ' ' + entry.id;
        if (state.seen.has(key)) continue;
        state.seen.add(key);
      }
      if (entry.kind === 'you') addYou(state, entry);
      else if (entry.kind === 'from') addFrom(state, entry);
      else if (entry.kind === 'say') addSay(state, entry);
      else if (entry.kind === 'act') addAct(state, entry);
      else if (entry.kind === 'result') addResult(state, entry);
      else if (entry.kind === 'ask') addAsk(state, entry);
      else if (entry.kind === 'worked') addWorked(state, entry);
      else if (entry.kind === 'note') addNote(state, entry.text);
      else if (entry.kind === 'title') state.topic = entry.text;
    }
  }

  // ---------- the report's decisions, through the app's own flow (49) ----------
  // Only the newest report can still be answered, and only the decision the app holds open for it;
  // every other option is shown as text.
  function paintDecisions(state) {
    // a helper's report is its lead's to read: its options are never buttons here
    if (state.sub) return;
    const cards = state.list.querySelectorAll('.tnt-report');
    const newest = cards[cards.length - 1];
    const context = window.TnaiContext;
    const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
    const report = turn?.endedAt
      ? safe(() => context?.entryFor(state.paneId, turn.startedAt), null)
      : null;
    const openChoice = report ? safe(() => context.openChoice(report), null) : null;
    cards.forEach(card => {
      card.querySelectorAll('.tnt-decide').forEach(ask => {
        const live =
          card === newest && !!openChoice && String(openChoice.n) === ask.dataset.decision;
        ask.dataset.open = String(live);
        ask.querySelectorAll('button').forEach(button => {
          button.disabled = !live;
          button.onclick = live
            ? () => {
                context.decide(report.id + '#' + openChoice.n, Number(button.dataset.option));
                paintDecisions(state);
              }
            : null;
        });
      });
    });
  }

  // ---------- the top of the pane, and the live line ----------
  // A helper of an OpenCode thread stays empty for good: OpenCode writes no record of a
  // sub-agent's own conversation. The note then says so and where its work can be read, where
  // "nothing to show yet" would have the user wait for something that never comes. Asked only
  // for an empty helper view, so the list of sessions is not read at every repaint.
  function helperHasNoRecord(state) {
    if (!state.sub) return false;
    const session = safe(
      () => window.TnaiAgents.sessions().find(one => one.paneId === state.paneId),
      null
    );
    return session?.agent === 'OpenCode';
  }

  function paintFrame(state) {
    let text = '';
    if (!state.found) text = 'Nothing has been said in this thread yet. Type its first task below.';
    else if (state.list.children.length === 1 && !state.reading && !state.first)
      text = helperHasNoRecord(state)
        ? 'OpenCode keeps no separate record of a helper’s conversation. Its task, tool calls and output are in the Details tab.'
        : 'This conversation has nothing to show yet.';
    state.empty.textContent = text;
    state.empty.hidden = !text;
    let note = state.list.querySelector(':scope > .tnt-cut');
    if (state.cut && !note) {
      note = make(
        'div',
        'tnt-note tnt-cut',
        'This is the end of a long conversation. The earlier part is on the CLI screen.'
      );
      state.list.prepend(note);
    }
    const topic = document.querySelector('.tnt-view .tnt-head-topic');
    if (topic && open === state && topic.textContent !== state.topic)
      topic.textContent = state.topic;
  }

  // The last line while the agent works: the list's own line for this thread (119).
  function paintLive(state) {
    const thread = safe(() => window.TnaiThreadList?.thread(state.paneId), null);

    // Whether a task runs is a fact the tool reports (42); the status read from its output lags a
    // few seconds behind and calls a fresh, idle session "working". So the line shows only while
    // a reported task runs, or while the thread needs the user.
    const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
    const running = !!turn?.startedAt && !turn.endedAt;
    const show =
      !state.sub && !!thread && (thread.tone === 'needs' || (running && thread.tone === 'work'));
    state.live.hidden = !show;
    if (!show) return;
    state.live.dataset.tone = thread.tone;
    const words = [thread.label, thread.now].filter(Boolean);
    state.live.querySelector('span').textContent = [...new Set(words)].join(' · ');
    state.live.querySelector('em').hidden = !thread.inferred;
  }

  // ---------- reading ----------
  async function read(state) {
    if (state.reading) {
      state.wanted = true;
      return;
    }
    state.reading = true;
    state.wanted = false;
    let part = null;
    try {
      part = await native.threadLog.read(state.paneId, state.next, state.sub);
    } catch {}
    state.reading = false;
    if (part) {
      const stick = nearBottom(state);
      if (part.reset) {
        state.list.replaceChildren(state.live);
        state.acts.clear();
        state.says.clear();
        state.seen.clear();
        state.files = new Map();
        state.cut = false;
      }
      state.found = part.found !== false;
      if (part.cut) state.cut = true;
      if (part.next > 0 || part.reset) state.next = part.next;
      addEntries(state, part.entries || []);
      const first = state.first;
      state.first = false;
      paintFrame(state);
      paintLive(state);
      if (stick || first) toBottom(state);
    }
    if (state.wanted) request(state);
  }

  // Many pushes in one moment are one read.
  function request(state) {
    if (!state || state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = 0;
      if (shown.has(state)) read(state);
    }, READ_GAP_MS);
  }

  // A repaint of the last lines (the live line, a decision that opens) can make the conversation a
  // little taller. A reader who was at the newest line stays there.
  function repaint(paint) {
    if (!open) return;
    const stick = nearBottom(open);
    paint(open);
    if (stick) toBottom(open);
  }

  // ---------- the last lines of a task ----------
  // A tool can write a task's answer and its length a moment after it reported the end. The main
  // process tells when a record that is a file has grown (thread-log.js, `threadLog:changed`), and
  // that is what brings those lines in. This is the guard beside it, for a record that is not a
  // file (OpenCode) and for a file whose change the system reports late: after a reported end the
  // record is asked for again a few times, and no more once the task's end row is there.
  const END_TRIES_MS = [900, 2500, 6000];
  const hasEndRow = state => {
    let last = state.list.lastElementChild;
    if (last === state.live) last = last.previousElementSibling;
    return !!last?.classList.contains('tnt-worked');
  };

  function followEnd(state) {
    if (state.sub) return;
    (state.endTimers || []).forEach(clearTimeout);
    state.endTimers = END_TRIES_MS.map(ms =>
      setTimeout(() => {
        if (shown.has(state) && !hasEndRow(state)) request(state);
      }, ms)
    );
  }

  // ---------- showing, and only while a conversation is on screen ----------
  let stops = [];

  function listen() {
    if (stops.length) return;
    const onTurn = event => {
      const paneId = event.detail?.paneId;
      const mine = [...shown].filter(state => state.paneId === paneId);
      if (!mine.length) return;
      mine.forEach(request);
      const ended = safe(() => window.TnaiTurns?.get?.(paneId)?.endedAt, 0);
      if (ended) mine.forEach(followEnd);
      if (open?.paneId === paneId) repaint(paintDecisions);
    };

    // a conversation on screen has grown in its record: read what is new
    const offChange = native.threadLog?.onChange?.(what => {
      for (const state of shown)
        if (what?.paneId === state.paneId && (what.sub || '') === (state.sub || '')) request(state);
    });
    if (typeof offChange === 'function') stops.push(offChange);
    const onPainted = () => repaint(paintLive);
    window.addEventListener('tnai:turn', onTurn);
    window.addEventListener('tnai:threads-painted', onPainted);
    stops.push(
      () => window.removeEventListener('tnai:turn', onTurn),
      () => window.removeEventListener('tnai:threads-painted', onPainted)
    );
    const offEvents = native.agentEvents?.on?.(event => {
      for (const state of shown) if (event?.paneId === state.paneId) request(state);
    });
    if (typeof offEvents === 'function') stops.push(offEvents);

    // a report was filed or a decision marked: the newest report's buttons follow
    const offContext = native.context?.onChange?.(() =>
      setTimeout(() => repaint(paintDecisions), 300)
    );
    if (typeof offContext === 'function') stops.push(offContext);
  }

  function unlisten() {
    if (shown.size) return;
    stops.forEach(stop => safe(stop, null));
    stops = [];
  }

  // Puts one conversation into a pane and starts reading it.
  function mount(host, paneId, sub = '') {
    const state = stateFor(paneId, sub);
    for (const other of shown) if (other.host === host && other !== state) unmount(host);
    state.host = host;
    watchEnd(host);
    shown.add(state);
    if (!state.live.parentNode) state.list.append(state.live);
    if (host.firstElementChild !== state.empty || host.lastElementChild !== state.list)
      host.replaceChildren(state.empty, state.list);
    listen();
    paintFrame(state);
    paintLive(state);
    toBottom(state);
    request(state);

    // put on screen right after its task ended: the end's last lines may still be on their way
    if (safe(() => window.TnaiTurns?.get?.(paneId)?.endedAt, 0)) followEnd(state);
    return state;
  }

  function unmount(host) {
    for (const state of [...shown])
      if (state.host === host) {
        shown.delete(state);
        state.host = null;
      }
    unlisten();
  }

  // The open thread's own conversation, in the pane 120 gives (its event says which and where).
  let mainHost = null;

  function show(detail) {
    const want = detail?.mode === 'read' && detail.paneId ? detail.paneId : '';
    mainHost = detail?.host || mainHost;
    if (!want || !native?.threadLog) {
      open = null;
      if (mainHost) unmount(mainHost);
      return;
    }
    open = mount(mainHost, want);
  }
  window.addEventListener('tnai:thread-view', event => show(event.detail));
  window.addEventListener('tnai:threads-hidden', () => show(null));
  window.addEventListener('tnai:threads-removed', () => {
    show(null);
    [...shown].forEach(state => unmount(state.host));
    states.clear();
  });

  const describe = state =>
    state
      ? {
          paneId: state.paneId,
          sub: state.sub,
          blocks: state.list.children.length - 1,
          next: state.next,
          cut: state.cut,
          found: state.found,
          topic: state.topic,
        }
      : null;

  window.TnaiThreadReadable = {
    can: tool => !!native?.threadLog && READABLE.has(tool),
    state: () => describe(open),

    // one more conversation on screen (123: a helper's, beside the lead's)
    mount: (host, paneId, sub) => describe(mount(host, paneId, sub)),
    unmount,
  };
})();
