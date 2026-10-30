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
  const READABLE = new Set(['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent', 'Mistral Vibe']);
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
      queued: make('div', 'tnt-queued'),
      jump: jumpBar(),
    };
    state.live.hidden = true;

    // the bar moves while the CLI runs a built-in command such as a compact (158)
    state.live.innerHTML =
      '<i></i><span></span><em hidden>· inferred</em><b class="tnt-live-bar" hidden></b>';
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
      if (atEnd.get(target))
        followTo(
          target,
          [...shown].find(state => state.host === target)
        );
    })
  );

  // The conversation itself can grow with no scroll and no new lines: a block out of view is
  // taken as 56 px high until it is drawn (30: content-visibility), and the newest blocks are
  // drawn one frame after a thread is opened. The end then moved down by their real height
  // (770 px, measured 2026-10-14, thread-open-end), and an opened thread showed older lines.
  // A reader at the end follows the conversation's own growth too.
  const listOwner = new WeakMap();
  const listSized = new ResizeObserver(entries =>
    entries.forEach(({ target }) => {
      const state = listOwner.get(target);
      const host = state?.host;
      if (host && atEnd.get(host)) followTo(host, state);
    })
  );

  function watchGrowth(state) {
    if (listOwner.has(state.list)) return;
    listOwner.set(state.list, state);
    listSized.observe(state.list);
  }

  // A press that sends the reader up the conversation (186, a mark of the scrollbar map) scrolls
  // smoothly, and its first frames are still near the end: a new line then pulled the view back
  // to the end (learned 2026-10-28). Until that scroll ends the reader is away from the end.
  const leaving = new WeakMap();

  // goal: where that scroll stops (scrollTop)
  function leaveEnd(host, goal) {
    leaving.set(host, goal);
    atEnd.set(host, false);
  }

  // Following the end sets the scroll place itself, so a "scroll ended" of the last new line can
  // still come after the press: the jump is over only once the view is away from the end or at its
  // goal, or when the reader scrolls on their own.
  function jumpOver(host) {
    if (!leaving.has(host)) return;
    const goal = leaving.get(host);
    const atGoal = typeof goal !== 'number' || Math.abs(host.scrollTop - goal) <= 2;
    if (gapToEnd(host) < END_GAP && !atGoal) return;
    leaving.delete(host);
    atEnd.set(host, gapToEnd(host) < END_GAP);
  }

  function watchEnd(host) {
    if (atEnd.has(host)) return;
    atEnd.set(host, true);
    host.addEventListener(
      'scroll',
      () => {
        atEnd.set(host, !leaving.has(host) && gapToEnd(host) < END_GAP);
        for (const state of shown) if (state.host === host) readPast(state);
      },
      { passive: true }
    );
    host.addEventListener('scrollend', () => jumpOver(host), { passive: true });
    for (const own of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
      host.addEventListener(own, () => leaving.delete(host), { passive: true });
    paneSized.observe(host);
  }

  // A report that came in while the reader was at the newest line is "held": following the end
  // stops at its top, so the next turn (a held message typed in, a short follow-up report) does not
  // push it out of view before it is read. The reader's own scrolling past it, "Latest", a prompt
  // they send or opening the thread again lets the end be followed as before.
  const REPORT_GAP = 8;

  function holdTop(state) {
    const card = state?.holdReport;
    if (!card?.isConnected || !state.host) return Infinity;
    const host = state.host;
    const top = card.getBoundingClientRect().top - host.getBoundingClientRect().top;
    return Math.max(0, host.scrollTop + top - REPORT_GAP);
  }

  // Goes to the newest line, or as far as a held report's top.
  function followTo(host, state) {
    host.scrollTop = Math.min(host.scrollHeight, holdTop(state));
  }

  // The reader scrolled to the end with the held report's top above the view: it was read past.
  function readPast(state) {
    if (!state.holdReport || gapToEnd(state.host) >= END_GAP) return;
    if (state.holdReport.getBoundingClientRect().top < state.host.getBoundingClientRect().top)
      state.holdReport = null;
  }
  const nearBottom = ({ host }) =>
    !host || (!leaving.has(host) && (atEnd.get(host) === true || gapToEnd(host) < END_GAP));
  const toBottom = state => {
    const host = state.host;
    if (!host) return;

    // the user's own way to the end ("Latest", a sent prompt) ends a jump up the conversation
    leaving.delete(host);
    followTo(host, state);

    // Blocks out of view are not laid out (30: content-visibility), so the height above is partly
    // a guess. Once the last blocks are drawn the real end is known: go there again.
    requestAnimationFrame(() => {
      if (host.isConnected) followTo(host, state);
    });
  };

  // ---------- getting around a long conversation ----------
  // "Latest" floats at the conversation's bottom left while the reader is away from the newest
  // line. A reader at the end does not see it. (A "Last report" button beside it was removed: the
  // user found it useless.)
  function jumpBar() {
    const bar = make('div', 'tnt-jump');
    const button = make('button', 'tnt-jump-btn', 'Latest');
    button.type = 'button';
    button.dataset.jump = 'latest';
    button.hidden = true;
    bar.append(button);
    bar.addEventListener('click', event => {
      const kind = event.target.closest('[data-jump]')?.dataset.jump;
      const state = [...shown].find(each => each.jump === bar);
      if (kind !== 'latest' || !state?.host) return;
      state.holdReport = null;
      atEnd.set(state.host, true);
      toBottom(state);
      paintJump(state);
    });
    return bar;
  }

  // The newest report card of a conversation, or null (the view holds on it while the next turn
  // follows; holdReport below).
  const lastReport = state => {
    const cards = state.list.querySelectorAll('.tnt-report');
    return cards[cards.length - 1] || null;
  };

  // Whether the reader needs "Latest" now. Read on scroll, at most once a frame.
  function paintJump(state) {
    if (!state.host) return;
    const [toLatest] = state.jump.children;
    toLatest.hidden = nearBottom(state);
  }

  const jumpFrames = new WeakMap();

  function jumpLater(state) {
    if (!state.host || jumpFrames.get(state)) return;
    jumpFrames.set(
      state,
      requestAnimationFrame(() => {
        jumpFrames.delete(state);
        paintJump(state);
      })
    );
  }

  // ---------- prompts waiting for a busy agent ----------
  // A prompt sent while the agent works is held by the app and given to it when its task ends
  // (71 `heldFor`, desktop/attention-service.js). Until then it stands at the end of the
  // conversation, marked as waiting, with the same Send now, Edit and Remove as the thread's
  // Details tab, so the queue is seen where the user looks. Prompts the
  // CLI already took into its own queue come first, marked "With the agent", without buttons:
  // nothing can change them any more (the same rule as Details).
  const WAIT_WORDS = {
    busy: 'Waiting · it gets this when its task ends',
    compact: 'Waiting · it gets this when compacting ends',
    queue: 'Waiting · after the prompts before it',
    question: 'Waiting · until its question is answered',
    draft: 'Waiting · until its input is empty',
  };

  // the prompts the CLI took while its turn runs (42 `TnaiTurns`), as Details lists them
  function takenFor(paneId) {
    const turn = safe(() => window.TnaiTurns?.get?.(paneId), null);
    const running = safe(
      () => window.TnaiAgents.sessions().some(s => s.paneId === paneId && s.running),
      false
    );
    return turn && !turn.endedAt && running ? turn.queued || [] : [];
  }

  function queuedButton(name, label, title) {
    const button = make('button', 'tnt-queued-act', label);
    button.type = 'button';
    button.dataset.q = name;
    button.title = title;
    return button;
  }

  function heldBubble(entry) {
    const bubble = make('div', 'tnt-you tnt-you-queued', entry.text);
    bubble.dataset.held = entry.id;
    bubble.append(make('small', 'tnt-queued-note', WAIT_WORDS[entry.why] || WAIT_WORDS.busy));
    const actions = make('span', 'tnt-queued-acts');
    actions.append(
      queuedButton(
        'send',
        'Send now',
        'Send it to the agent now, while it works: it takes it between steps or right after its task'
      )
    );

    // a message from another agent or computer is not the user's own words to edit
    if (!entry.from && !entry.remote)
      actions.append(
        queuedButton(
          'edit',
          'Edit',
          'Take it out of the queue and put it back in the prompt box to change it'
        )
      );
    actions.append(
      queuedButton(
        'remove',
        'Remove',
        entry.from
          ? 'Remove this message: it is not delivered, and its sender is told'
          : 'Remove this message: it is not sent'
      )
    );
    bubble.append(actions);
    return bubble;
  }

  function takenBubble(prompt) {
    const bubble = make('div', 'tnt-you tnt-you-queued', prompt.text);
    const note = make('small', 'tnt-queued-note', 'With the agent · it takes this next');
    note.title = 'Already handed to the agent: it takes it next. It can no longer be changed here.';
    bubble.append(note);
    return bubble;
  }

  function paintQueued(state) {
    const held = state.sub ? [] : safe(() => window.TnaiNeedsYou?.heldFor?.(state.paneId), []);
    const taken = state.sub ? [] : takenFor(state.paneId);
    state.queued.replaceChildren(...taken.map(takenBubble), ...held.map(heldBubble));
    state.queued.hidden = !held.length && !taken.length;

    // one listener per box: Send now, Edit and Remove work as in the Details tab (139 queuePress)
    if (state.queued.dataset.wired) return;
    state.queued.dataset.wired = '1';
    state.queued.addEventListener('click', event => {
      const button = event.target.closest('button[data-q]');
      const id = button?.closest('[data-held]')?.dataset.held;
      if (!id) return;
      const needsYou = window.TnaiNeedsYou;
      if (button.dataset.q === 'send') {
        needsYou?.sendHeld?.(id);
        return;
      }

      // Edit puts the user's own words back in the prompt box, aimed at this agent
      if (button.dataset.q === 'edit') window.TnaiLiveTasks?.setTarget?.(state.paneId);
      needsYou?.takeHeld?.(id, button.dataset.q === 'edit');
    });
  }

  // Blocks stand in order above the live line, which is always last.
  function addBlock(state, node) {
    // 176: a line that comes in while the thread is open rises in (not the first read's lines)
    if (!state.first && !state.redrawing) node.classList.add('tnt-fresh');
    state.list.insertBefore(node, state.live);
    jumpLater(state);
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

  // A page or picture the last actions made comes as a card before what follows them (159).
  // A workflow's card (171) waits for the same moments.
  const placeDesigns = state => {
    safe(() => window.TnaiThreadDesigns?.place?.(state, node => addBlock(state, node)), null);
    safe(() => window.TnaiWorkflowCard?.place?.(state, node => addBlock(state, node)), null);
    safe(() => window.TnaiCommandCards?.place?.(state, node => addBlock(state, node)), null);
  };

  function addYou(state, entry) {
    placeDesigns(state);
    state.files = new Map();

    // a new turn: the replies a long answer may fold among start again (foldTurn)
    state.turnSays = [];

    // 170: a new prompt starts a new task, so nothing of one that ended without its "Worked for"
    // line goes into the next task's block
    safe(() => window.TnaiWhatItMade?.prompt?.(state), null);

    // a question still open when the user writes again is an earlier one: it can no longer be
    // answered from here
    state.list.querySelectorAll('.tnt-askbox[data-state="open"]').forEach(box => {
      box.dataset.state = 'answered';
      box.querySelector('.tnt-ask-go').hidden = true;
      box.querySelector('.tnt-ask-done').hidden = false;
    });

    // pictures attached to the prompt: tiles inside the prompt's own bubble, under its words, so
    // the words and the picture read as one message (182; user 2026-10-28: they "look like
    // seperate chats even though they were one prompt")
    const tiles = safe(() => window.TnaiAgentMessages?.pictures?.(state, entry), null);
    if (entry.text || tiles) {
      // 172: a day line when the day changes, and the prompt's time under it
      safe(() => window.TnaiTimes?.day?.(state, entry.at, node => addBlock(state, node)), null);
      const bubble = make('div', 'tnt-you', entry.text || '');
      if (tiles) {
        bubble.classList.add('tnt-you-pics');
        bubble.append(tiles);
      }
      addBlock(state, bubble);
      safe(() => window.TnaiTimes?.stamp?.(state, entry.at, true, bubble), null);
    }
    addAdded(state, entry, 'tnt-added tnt-added-you');
  }

  function addFrom(state, entry) {
    // 182 draws it as a card that says who wrote to whom; the plain bubble if 182 is missing
    const card = safe(() => window.TnaiAgentMessages?.from?.(state, entry, markdown), null);
    const block = card || make('div', 'tnt-from');
    if (!card) block.append(make('small', '', 'From ' + entry.who), make('div', '', entry.text));
    addBlock(state, block);
    addAdded(state, entry, 'tnt-added');
  }

  // A helper's report handed back to its lead (desktop/thread-log-claude.js): a card (182).
  function addReport(state, entry) {
    const card = safe(() => window.TnaiAgentMessages?.report?.(state, entry, markdown), null);
    if (card) addBlock(state, card);
    else addFrom(state, { ...entry, who: 'a helper' });
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
  // ---------- copying a code block ----------
  // Every code block in a reply gets a copy icon in its top right corner, faint until the pointer
  // is over the block (user, 2026-10-19: "ways for the user to select all or copy the text
  // inside"; place 1 of docs/plans/design-concepts/code-copy.html). A press copies the whole block,
  // also the part of a long line out of view; the icon turns to a check and "Copied" fades in.
  // Ctrl+A after a press inside a block selects only that block.
  const COPIED_MS = 1400;

  function selectAllIn(code) {
    const range = document.createRange();
    range.selectNodeContents(code);
    const picked = window.getSelection();
    picked.removeAllRanges();
    picked.addRange(range);
  }

  async function copyBlock(button, code) {
    let done = false;
    try {
      await navigator.clipboard.writeText(code.textContent);
      done = true;
    } catch {
      // The clipboard can refuse a page that does not have the keyboard: the block's text is
      // selected and copied the older way instead.
      selectAllIn(code);
      done = safe(() => document.execCommand('copy'), false);
    }
    if (!done) return;
    const said = button.nextElementSibling;

    // a class, not a :has() rule: the fade under "Copied" costs no style check on other changes
    const box = button.parentElement;
    button.dataset.done = '';
    button.innerHTML = icon('check', 15);
    said.dataset.on = '';
    box?.classList.add('tnt-code-copied');
    clearTimeout(button.copiedTimer);
    button.copiedTimer = setTimeout(() => {
      delete button.dataset.done;
      delete said.dataset.on;
      box?.classList.remove('tnt-code-copied');
      button.innerHTML = icon('copy', 15);
    }, COPIED_MS);
  }

  // A block holding one `PS> command` line (hidden skill 50: a command the user runs). The
  // "PS> " mark is not part of the command, so it is taken out of the block: copying gives the
  // command alone (user 2026-10-28: "When copying these commands it doesnt work cuz PS> is
  // there"). A "PowerShell" button above the block says what it is and runs it in a PowerShell
  // thread, the same as a clicked `PS>` line in a terminal (90).
  const PS_LINE = /^[ \t]*PS>[ \t]+(\S[^\n]*?)[ \t]*\n?$/;

  function addShellButton(box, code) {
    const found = PS_LINE.exec(code.textContent);
    if (!found) return;
    const command = found[1];
    code.textContent = command;
    const run = window.TnaiPowerShellLink?.run;
    const shell = make(run ? 'button' : 'span', 'tnt-code-shell');
    shell.innerHTML = icon('terminal', 13) + '<span>PowerShell</span>';
    if (run) {
      shell.type = 'button';
      shell.title = 'Run this command in a PowerShell thread';
      shell.addEventListener('click', () => run(command));
    }
    box.prepend(shell);
    box.classList.add('tnt-code-ps');
  }

  function addCopyButtons(block) {
    block.querySelectorAll(':scope pre').forEach(pre => {
      if (pre.parentElement?.classList.contains('tnt-code')) return;
      const code = pre.querySelector('code') || pre;
      const box = make('div', 'tnt-code');
      pre.replaceWith(box);
      pre.tabIndex = 0;
      const button = make('button', 'tnt-code-copy');
      button.type = 'button';
      button.setAttribute('aria-label', 'Copy');
      button.title = 'Copy';
      button.innerHTML = icon('copy', 15);
      const said = make('span', 'tnt-code-said', 'Copied');
      said.setAttribute('aria-live', 'polite');
      box.append(pre, button, said);
      addShellButton(box, code);
      button.addEventListener('click', () => copyBlock(button, code));
      pre.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          selectAllIn(code);
        }
      });
    });
  }

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

  // ---------- folds the reader opens (feature 14) ----------
  // The thread's information layout (user 2026-10-28 chose "Proposed" in
  // docs/plans/design-concepts/info-layout.html): a report shows its "Did" lines and its decisions
  // on top of the answer, and a long answer shows its first lines. What the reader opened stays
  // open, kept by the tool's own id of the reply, which no other conversation has.
  const OPENED_STORE = 'tnai.thread.opened.v1';
  const OPENED_MAX = 400;
  let opened = [];
  try {
    const saved = JSON.parse(localStorage.getItem(OPENED_STORE) || '[]');
    if (Array.isArray(saved))
      opened = saved.filter(key => typeof key === 'string').slice(-OPENED_MAX);
  } catch {}

  const isOpened = key => !!key && opened.includes(key);

  function setOpened(key, open) {
    if (!key) return;
    opened = opened.filter(other => other !== key);
    if (open) opened.push(key);
    opened = opened.slice(-OPENED_MAX);
    try {
      localStorage.setItem(OPENED_STORE, JSON.stringify(opened));
    } catch {}
  }

  // The quiet button under a fold: "Show all · 31 more lines", "Full report · Found, Changed".
  function unfoldButton(label, more) {
    const press = make('button', 'tnt-unfold');
    press.type = 'button';
    press.innerHTML = icon('chevron-down', 14);
    press.append(make('span', '', label), make('em', '', more));
    return press;
  }

  function paintUnfold(press, open, label, more) {
    press.setAttribute('aria-expanded', String(open));
    press.querySelector('span').textContent = open ? 'Show less' : label;
    press.querySelector('em').textContent = open ? '' : more;
  }

  // A press that opens or closes a fold keeps the view where the reader is (tnai-threads step 6):
  // the conversation grows, and a reader at the end would otherwise be pulled to the new end.
  function keepView(node) {
    for (const state of shown)
      if (state.host && state.list.contains(node)) atEnd.set(state.host, false);
  }

  // A report on top of its answer: the "Did" lines and the decisions show, "Full report" opens the
  // other lines in place. A report with no "Did" line, or nothing else, shows whole as before.
  function foldReport(card, id, open) {
    const rows = [...card.querySelectorAll(':scope > .tnt-report-row')];
    const rest = rows.filter(row => row.dataset.label !== 'did');
    if (!rest.length || rest.length === rows.length) return;
    const more = '· ' + rest.map(row => row.firstElementChild.textContent).join(', ');
    const press = unfoldButton('Full report', more);
    const key = id ? 'report ' + id : '';
    const paint = show => {
      card.dataset.folded = String(!show);
      paintUnfold(press, show, 'Full report', more);
    };
    press.addEventListener('click', () => {
      const show = card.dataset.folded === 'true';
      keepView(card);
      paint(show);
      setOpened(key, show);
    });
    card.tntUnfold = paint;
    paint(open || isOpened(key));
    card.append(press);
  }

  // The report agents end a task with: its lines as a card. A "- Decide:" line is a question with
  // its options; the buttons are wired by paintDecisions.
  // `at`: when the report was written, in the tool's record (49 `findDecision` tells this report's
  // saved result from an older one that asked the same question). `id`: the reply's id, which
  // keeps "Full report" open once opened; `open`: the card it replaces was open.
  function reportCard(text, at, id, open) {
    const card = make('section', 'tnt-report');
    if (at) card.dataset.at = String(at);
    card.append(make('h3', '', 'Technically Not report'));

    // 172: when the report was written, at the head's right end
    safe(() => window.TnaiTimes?.onReport?.(card, at), null);
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

        // The question as written is kept for matching and answering (49); an "(after Decision
        // N: why)" mark is shown as its own line under it instead (paintDecisions).
        ask.dataset.question = parts[0];
        const first = safe(() => window.TnaiContext?.dependsOn?.(parts[0]), null);
        const shown = first
          ? parts[0].replace(/\s*\(\s*after\s+Decision\s+\d+[^)]*\)/i, '')
          : parts[0];
        ask.append(make('b', '', shown));
        if (first) {
          ask.dataset.after = String(first.number);
          const note = make(
            'small',
            'tnt-decide-after',
            'Best answered after Decision ' + first.number + (first.why ? ': ' + first.why : '')
          );
          note.hidden = true;
          ask.append(note);
        }
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

    // the "Did" lines first: a decision is written after the other lines, so the rows it hides
    // stand above it and open in place
    foldReport(card, id, open);
    return card;
  }

  // ---------- a long answer, folded (feature 14) ----------
  // Only once its turn has ended (a "Worked for" line, or a report), so words still being written
  // never fold. The height is reckoned from the words, not measured: a reply out of view is not
  // laid out (content-visibility), so its measured height would be a guess, and a fold must not
  // jump.
  const FOLD_PX = 300;
  const FOLD_OVER_PX = 380;
  const LINE_PX = 21.7;
  const CODE_LINE_PX = 19.4;
  const CHAR_PX = 7.2;
  const READ_PX = 760;

  // About how tall a reply's Markdown is drawn at this width (30: 14 px text at 1.55, code at
  // 12.5 px, a heading's room, the space between paragraphs).
  function answerHeight(words, width) {
    const perLine = Math.max(24, Math.floor((width - 24) / CHAR_PX));
    let height = 0;
    let inCode = false;
    for (const line of String(words || '').split(/\r?\n/)) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        height += 12;
        continue;
      }
      if (inCode) height += CODE_LINE_PX;
      else if (!line.trim()) height += 10;
      else if (/^\s*#{1,6}\s/.test(line)) height += 30;
      else if (/^\s*\|/.test(line)) height += 30;
      else height += Math.ceil(line.length / perLine) * LINE_PX;
    }
    return height;
  }

  // the reply each folded block belongs to, for a match that Find (173) must show
  const foldOf = new WeakMap();

  function paintAnswer(said, open) {
    said.open = open;
    said.block.classList.toggle('tnt-say-folded', !open);
    paintUnfold(said.unfold, open, 'Show all', '· ' + said.more);
  }

  function foldAnswer(state, said) {
    said.settled = true;
    const block = said.block;
    if (!block.isConnected) return;
    const width = Math.min(state.list.clientWidth || READ_PX, READ_PX);
    const height = block.hidden ? 0 : answerHeight(said.words, width);
    if (height <= FOLD_OVER_PX) {
      said.unfold?.remove();
      said.unfold = null;
      block.classList.remove('tnt-say-folded');
      return;
    }
    said.more = Math.max(1, Math.round((height - FOLD_PX) / LINE_PX)) + ' more lines';
    if (!said.unfold) {
      said.unfold = unfoldButton('Show all', '');
      said.unfold.addEventListener('click', () => {
        const show = block.classList.contains('tnt-say-folded');
        keepView(block);
        paintAnswer(said, show);
        setOpened(said.id ? 'answer ' + said.id : '', show);
      });

      // right under the words, before the reply's time line (172)
      block.after(said.unfold);
      foldOf.set(block, said);
    }
    paintAnswer(said, said.open ?? isOpened(said.id ? 'answer ' + said.id : ''));
  }

  // The turn's replies, once it ended.
  function foldTurn(state) {
    for (const said of state.turnSays || []) foldAnswer(state, said);
    state.turnSays = [];
  }

  // 173: a match inside a folded answer or a folded report opens it first, so it can be seen.
  function reveal(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const block = element?.closest?.('.tnt-say-folded');
    const said = block && foldOf.get(block);
    if (said) paintAnswer(said, true);
    const card = element?.closest?.('.tnt-report[data-folded="true"]');
    if (card?.tntUnfold) card.tntUnfold(true);
  }

  // A reply's words: with a chart block or a table of numbers, 178 draws them with their chart
  // cards; otherwise as before.
  function drawWords(block, words) {
    const drawn =
      !!words && safe(() => !!window.TnaiThreadCharts?.fill?.(block, words, markdown), false);
    if (!drawn) block.innerHTML = words ? markdown(words) : '';
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
        drawWords(known.block, words);
        colorReply(known.block);
        addCopyButtons(known.block);

        // an answer already folded is reckoned again with its new words
        if (known.settled) foldAnswer(state, known);
      }
      if (report && known.report !== report) {
        const wasOpen = known.card?.dataset.folded === 'false';
        const card = reportCard(report, entry.at, entry.id, wasOpen);

        // feature 14: the report stands on top of the answer it ends
        if (known.card?.isConnected) known.card.replaceWith(card);
        else known.block.before(card);
        known.card = card;
        known.report = report;
        paintDecisions(state);

        // a report ends the turn (Copilot's record has no "Worked for" line)
        foldTurn(state);
      }
      return;
    }
    if (words) placeDesigns(state);

    // 172: a day line when the day changes
    if (words)
      safe(() => window.TnaiTimes?.day?.(state, entry.at, node => addBlock(state, node)), null);
    const block = make('div', 'tnt-say');
    drawWords(block, words);
    colorReply(block);
    addCopyButtons(block);
    block.hidden = !words;
    addBlock(state, block);

    // 172: the reply's time under it (none in the same minute as the last time shown), and its
    // Copy button, which copies the reply's words as they are when pressed
    const wordsNow = () => (entry.id ? state.says.get(entry.id)?.words : '') || words;
    if (words) safe(() => window.TnaiTimes?.stamp?.(state, entry.at, false, block, wordsNow), null);
    let card = null;
    if (report) {
      // feature 14: the report stands on top of the answer it ends (a "Did" line and the
      // decisions; "Full report" opens the rest)
      card = reportCard(report, entry.at, entry.id, false);
      if (!state.first && !state.redrawing) card.classList.add('tnt-fresh');
      state.list.insertBefore(card, block);
      paintDecisions(state);
    }
    const said = { block, card, words, report, id: entry.id || '' };
    if (entry.id) state.says.set(entry.id, said);
    state.turnSays = [...(state.turnSays || []), said];
    if (report) foldTurn(state);
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

    // 172: since when it works
    const since = safe(() => window.TnaiTimes?.helperWords?.(entry.at, 0), '');
    card.querySelector('small').textContent = 'Helper · working' + (since ? ' · ' + since : '');
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
    if (!block?.classList.contains('tnt-did')) block = addBlock(state, runBlock());

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

    // a step takes the keyboard: Enter opens it beside the thread (181)
    line.tabIndex = 0;
    line.title = 'Open this step beside the thread';
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
      if (String(window.getSelection())) return;

      // the step slides in beside the thread with all of it (181, user 2026-10-23); without 181
      // its text opens under the line as before
      if (window.TnaiStepViewer?.open?.(line)) return;
      if (open.hidden) return;
      more.hidden = !more.hidden;
      open.setAttribute('aria-expanded', String(!more.hidden));
    });
    group.lastElementChild.append(line, more);
    const known = { line, entry, more, open };
    line.tntStep = known;
    state.acts.set(entry.id, known);
    safe(() => window.TnaiThreadDesigns?.note?.(state, entry, node => addBlock(state, node)), null);
    safe(() => window.TnaiWorkflowCard?.note?.(state, entry, node => addBlock(state, node)), null);

    // 170: what the task made, shown in its "Worked for" block
    safe(() => window.TnaiWhatItMade?.note?.(state, entry), null);
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
    if (group.parentElement?.classList.contains('tnt-did')) paintRun(group.parentElement);
  }

  // ---------- a run of actions, folded behind one line ----------
  // The actions between two of the agent's sentences are one run. From two actions on, the run
  // folds behind one line that sums it up ("Ran 3 commands, read 1 file · 1 failed"); a press
  // opens it to the groups and lines as before, a second press folds it again.
  function runBlock() {
    const block = make('div', 'tnt-did');
    const head = make('button', 'tnt-grp-head tnt-run-head');
    head.type = 'button';
    head.hidden = true;
    head.innerHTML = icon('square-terminal', 14) + '<span></span>' + icon('chevron-right', 14);
    head.addEventListener('click', () => {
      block.dataset.open = String(block.dataset.open !== 'true');
      head.setAttribute('aria-expanded', block.dataset.open);
    });
    block.append(head);
    return block;
  }

  // "Ran 1 commands" → "Ran 1 command", "1 times" → "once"; later parts start in lower case.
  function runPart(text, index) {
    const one = text.replace(/^(.+ 1 \w+?)s$/, '$1').replace(/ 1 times$/, ' once');
    return index ? one.charAt(0).toLowerCase() + one.slice(1) : one;
  }

  function paintRun(block) {
    const head = block.querySelector(':scope > .tnt-run-head');
    if (!head) return;
    const groups = [...block.querySelectorAll(':scope > .tnt-grp')];
    const lines = block.querySelectorAll(':scope > .tnt-grp .tnt-act');
    const folds = lines.length > 1;
    block.dataset.run = String(folds);
    head.hidden = !folds;
    if (!folds) {
      delete block.dataset.open;
      head.removeAttribute('aria-expanded');
      return;
    }
    if (!block.dataset.open) block.dataset.open = 'false';
    head.setAttribute('aria-expanded', block.dataset.open);

    // One group says the same as the run's line: its own heading steps aside and its lines show
    // as soon as the run opens. Several groups keep their headings, a step in from the run's line.
    const single = groups.length === 1;
    block.dataset.single = String(single);
    groups.forEach(group => {
      const many = group.querySelectorAll('.tnt-act').length > 1;
      group.firstElementChild.hidden = single || !many;
      if (single && group.dataset.folds === 'true') {
        group.dataset.open = 'true';
        group.dataset.openedByRun = 'true';
      } else if (!single && group.dataset.openedByRun) {
        // a second kind came: the first group folds behind its own heading again
        group.dataset.open = 'false';
        delete group.dataset.openedByRun;
      }
    });

    // counts per kind, in the order the kinds first came
    const counts = new Map();
    lines.forEach(line => {
      const verb = line.closest('.tnt-grp').dataset.verb;
      counts.set(verb, (counts.get(verb) || 0) + 1);
    });
    const parts = [...counts].map(([verb, count], index) =>
      runPart(kindOf(verb).many(count, verb), index)
    );
    const failed = block.querySelectorAll('.tnt-act[data-state="failed"]').length;
    const words = parts.join(', ') + (failed ? ' · ' + failed + ' failed' : '');
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

      // 172: its start, and its end once it came back ("since 9:36 AM" while it still runs)
      const ended = line.dataset.state === 'running' ? 0 : entry.at;
      const when = safe(() => window.TnaiTimes?.helperWords?.(known.entry.at, ended), '');
      line.querySelector('small').textContent =
        'Helper · ' +
        (entry.failed ? 'failed' : entry.text ? entry.text.toLowerCase() : 'finished') +
        (when ? ' · ' + when : '');
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

    // 170: a command's output can name the site it started
    if (!again) safe(() => window.TnaiWhatItMade?.result?.(state, known.entry, entry), null);

    // 171: a workflow's run id comes with its result
    safe(() => window.TnaiWorkflowCard?.result?.(state, known.entry, entry), null);
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
    placeDesigns(state);
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

    // 170: what the task made, under the same line (the block stays as it was when it made
    // nothing)
    safe(() => window.TnaiWhatItMade?.block?.(state, entry, block), false);

    // 187: where the task's time went and what it cost, in the same block
    safe(() => window.TnaiTaskTime?.block?.(state, entry, block), null);
    addBlock(state, block);
    state.files = new Map();

    // the task ended: its long answers fold now (feature 14)
    foldTurn(state);
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

      // 187: every entry of a task, for its time bar and cost when the task ends
      safe(() => window.TnaiTaskTime?.note?.(state, entry), null);
      if (entry.kind === 'you') addYou(state, entry);
      else if (entry.kind === 'from') addFrom(state, entry);
      else if (entry.kind === 'report') addReport(state, entry);
      else if (entry.kind === 'say') addSay(state, entry);
      else if (entry.kind === 'act') addAct(state, entry);
      else if (entry.kind === 'result') addResult(state, entry);
      else if (entry.kind === 'ask') addAsk(state, entry);
      else if (entry.kind === 'worked') addWorked(state, entry);
      else if (entry.kind === 'note') {
        // 171: a background task's end can be a workflow's
        safe(() => window.TnaiWorkflowCard?.notice?.(state, entry), null);
        addNote(state, entry.text);

        // a compact line ends the thread's "Compacting" line (158)
        safe(() => window.TnaiCliBusy?.noted?.(state.paneId, entry), null);
      } else if (entry.kind === 'title') state.topic = entry.text;
    }

    // a prompt of the user's may answer a report's decision in its own words: marked once a batch
    if (entries.some(entry => entry.kind === 'you' && entry.text)) paintDecisions(state);

    // a task that has ended (or a past conversation, which has no task) shows what its last
    // actions made, even with no words after them
    const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
    if (!turn || turn.endedAt) placeDesigns(state);
  }

  // ---------- a decision answered in the user's own words ----------
  // A decision can be answered by typing ("Decision 1 of 2: Yes, as a proposal") as well as by a
  // press. Typed answers are marked as chosen the same way, so scrolling back shows what was
  // decided. Only the user's sent prompts between this report and the next one are read, and an
  // answer counts only when it names exactly one of the options.
  const plainWords = text =>
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // The user's prompts that follow a report card, up to the next report.
  function promptsAfter(card) {
    const texts = [];
    let node = card?.nextElementSibling;
    while (node && !node.classList.contains('tnt-report')) {
      const sent = node.classList.contains('tnt-you') && !node.classList.contains('tnt-you-queued');
      if (sent) texts.push(node.textContent || '');
      node = node.nextElementSibling;
    }
    return texts.join('\n');
  }

  // The option an answer names: by its number ("2", "option 2"), or by its words, the start of
  // either one matching the other, without "(recommended)" or the reason after a dash.
  function optionNamed(answer, labels) {
    const text = String(answer)
      .replace(/^go with\s+/i, '')
      .replace(/[.\s]+$/, '');
    const numbered = /^(?:option\s+)?(\d+)\.?(?:\s|$)/i.exec(text);
    if (numbered) return labels[Number(numbered[1]) - 1] || '';
    const said = plainWords(text);
    if (said.length < 2) return '';
    const matches = labels.filter(label => {
      const core = plainWords(label.replace(/\(recommended\)/i, '').split(/\s+[—–-]\s+/)[0]);
      return !!core && (said.startsWith(core) || core.startsWith(said));
    });
    return matches.length === 1 ? matches[0] : '';
  }

  // The option the user's own words chose for this decision, or ''. Two forms are read: the one a
  // press writes ('Decision on "<question>": go with <option>') and the numbered one a person
  // types ("Decision 2 of 3: <option>" or "Decision 2: <option>"). Each answer runs to the end of
  // its line or to the next "Decision".
  function typedChoice(ask, labels) {
    const card = ask.closest('.tnt-report');
    const said = promptsAfter(card);
    if (!said) return '';
    const question = questionOf(ask);
    const asks = card.querySelectorAll('.tnt-decide').length;
    const ownNumber = /^decision\s+(\d+)\b/i.exec(question);
    const number = ownNumber
      ? ownNumber[1]
      : asks > 1
        ? String(Number(ask.dataset.decision) + 1)
        : '';
    const asked = plainWords(question);
    let chosen = '';

    // the pressed form, matched on the question's first words (a message may shorten it)
    const quoted = /Decision on "([\s\S]*?)"[^\n]*?: go with ([^\n]*?)(?=\s*Decision\b|\n|$)/g;
    for (const match of said.matchAll(quoted)) {
      const named = plainWords(match[1]);
      const same =
        !!named && (asked.startsWith(named.slice(0, 40)) || named.startsWith(asked.slice(0, 40)));
      if (same) chosen = optionNamed(match[2], labels) || chosen;
    }

    // the typed form, only at the start of a line or a sentence (not inside a quoted question)
    const typed =
      /(?:^|\n|[.!?]\s+)Decision\s+(\d+)(?:\s+of\s+\d+)?\s*:\s*([^\n]*?)(?=\s*Decision\b|\n|$)/g;
    if (number) {
      for (const match of said.matchAll(typed)) {
        if (match[1] === number) chosen = optionNamed(match[2], labels) || chosen;
      }
    }
    return chosen;
  }

  // ---------- the report's decisions, through the app's own flow (49) ----------
  // Every decision stays pressable until it is answered, however old, and whether the agent works
  // or not: pressing one sends the answer by itself (49 `decideInThread`, 149): to the agent the
  // option hands the work to, else to this agent, held while it works (paintQueued); the prompt
  // box only when nobody can take it. Once answered, its options are text, and the one the user
  // pressed stays marked as chosen.
  // True only while a decision button's press is being handled (see the button below).
  let pressingDecision = false;

  const reportTime = node => Number(node.closest('.tnt-report')?.dataset.at) || 0;

  // A decision's question as the agent wrote it (reportCard keeps it; the bold line may be shorter)
  const questionOf = ask => ask.dataset.question || ask.firstChild?.textContent || '';

  function paintDecisions(state) {
    // a helper's report is its lead's to read: its options are never buttons here
    if (state.sub) return;
    const context = window.TnaiContext;
    state.list.querySelectorAll('.tnt-report .tnt-decide').forEach(ask => {
      const question = questionOf(ask);
      const since = reportTime(ask);
      const found = safe(() => context?.findDecision?.(state.paneId, question, since), null);
      const labels = [...ask.querySelectorAll('button')].map(button => button.textContent);
      const chosen =
        safe(() => context?.choiceFor?.(state.paneId, question, since), '') ||
        safe(() => typedChoice(ask, labels), '');
      const live = !!context?.decideInThread && !(found && found.done) && !chosen;
      ask.dataset.open = String(live);
      ask.querySelectorAll('button').forEach(button => {
        const label = button.textContent;
        const picked = !!chosen && label === chosen;
        button.disabled = !live;
        button.classList.toggle('tnt-decide-chosen', picked);
        button.setAttribute('aria-pressed', String(picked));
        button.title = picked ? 'You chose this' : '';
        button.onclick = live
          ? () => {
              // A press keeps the view where the user is reading, so several decisions can be
              // pressed in a row: the answer it sends is not "a prompt sent" for the view, which
              // would move to the newest line (only a typed prompt does that).
              pressingDecision = true;
              try {
                context.decideInThread(
                  state.paneId,
                  question,
                  Number(button.dataset.option),
                  label,
                  since
                );
              } finally {
                pressingDecision = false;
              }
              paintDecisions(state);
            }
          : null;
      });
    });
    paintAfter(state);
  }

  // Every answer is sent the moment it is pressed, in any order (49 `decide`). Only a decision the
  // agent marked "(after Decision N: why)" says it is best answered after decision N, and only
  // while both are still open: once either is answered the line goes. It is advice, never a lock:
  // its buttons stay pressable (user, 2026-10-28: "only show these warnings and labels if it
  // actually matters").
  function paintAfter(state) {
    state.list.querySelectorAll('.tnt-report .tnt-decide[data-after]').forEach(ask => {
      const note = ask.querySelector(':scope > .tnt-decide-after');
      if (!note) return;
      const wanted = Number(ask.dataset.after);

      // decision N is the one numbered N, or else the report's N-th decision
      const numberOf = other =>
        safe(() => window.TnaiContext.decisionNumber(questionOf(other)), 0) ||
        Number(other.dataset.decision) + 1;
      const first = [...ask.closest('.tnt-report').querySelectorAll('.tnt-decide')].find(
        other => other !== ask && numberOf(other) === wanted
      );
      note.hidden = !(first && first.dataset.open === 'true' && ask.dataset.open === 'true');
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
  // What the live line is made from, as one short text. The thread list repaints often with
  // nothing changed; when this text is the same as at the last paint, the line is left alone.
  function liveInputs(state) {
    const thread = safe(() => window.TnaiThreadList?.thread(state.paneId), null);
    const turn = safe(() => window.TnaiTurns?.get?.(state.paneId), null);
    const running = !!turn?.startedAt && !turn.endedAt;
    const key = thread
      ? [
          state.sub ? 1 : 0,
          thread.tone,
          thread.status,
          running ? 1 : 0,
          thread.label,
          thread.now,
          thread.nowFolder || '',
          thread.nowRaw || '',
          thread.inferred ? 1 : 0,
          thread.busy ? thread.busy.words + thread.busy.clock : '',
        ].join('|')
      : '';
    return { thread, turn, running, key };
  }

  function paintLive(state) {
    // Whether a task runs is a fact the tool reports (42); the status read from its output lags a
    // few seconds behind and calls a fresh, idle session "working". So the line shows only while
    // a reported task runs, or while the thread needs the user. Between two replies the agent can
    // still be busy: tasks it started in the background, or helpers it waits on (10 reads both from
    // the tool's hooks, exact). The line stays then, so a thread that picks up again by itself a
    // few seconds later never looked finished.
    const { thread, running, key } = liveInputs(state);
    state.liveKey = key;
    const between = thread?.status === 'background' || thread?.status === 'waiting-agents';
    const show =
      !state.sub &&
      !!thread &&
      (thread.tone === 'needs' ||
        thread.tone === 'agents' ||
        (thread.tone === 'work' && (running || between)) ||
        !!thread.busy);
    state.live.hidden = !show;
    if (!show) return;
    state.live.dataset.tone = thread.tone;

    // A built-in command such as a compact (158): its own words, how long it runs, and the bar.
    const busy = thread.busy;
    const words = busy ? [busy.words, busy.clock] : [thread.label, thread.now].filter(Boolean);
    const span = state.live.querySelector('span');
    span.textContent = [...new Set(words)].join(' · ');

    // the folder a command runs in as a chip, the command as reported as the tip (183)
    if (!busy && thread.nowFolder) {
      const chip = make('code', 'tnt-live-folder', thread.nowFolder);
      span.append(' in ', chip);
    }
    span.title = !busy && thread.nowRaw ? thread.nowRaw : '';
    state.live.querySelector('em').hidden = !thread.inferred;
    state.live.querySelector('.tnt-live-bar').hidden = !busy;

    // 176: the task's clock and the agent's checklist on this line
    safe(() => window.TnaiLiveProgress?.paint?.(state), null);
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
      const reportsBefore = state.list.querySelectorAll('.tnt-report').length;
      if (part.reset) {
        state.list.replaceChildren(state.live);
        state.acts.clear();
        state.says.clear();
        state.seen.clear();
        state.files = new Map();
        state.cut = false;

        // 172: the day and time lines start again with the conversation
        state.timesDay = 0;
        state.timesLast = '';
      }
      state.found = part.found !== false;
      if (part.cut) state.cut = true;
      if (part.next > 0 || part.reset) state.next = part.next;

      // a whole redraw is not news: its lines do not rise in (176)
      state.redrawing = !!part.reset;
      addEntries(state, part.entries || []);
      state.redrawing = false;
      const first = state.first;
      state.first = false;
      paintFrame(state);
      paintLive(state);

      // a new report while the reader follows the end: held in view (holdTop)
      if (part.reset || first) state.holdReport = null;
      else if (stick && state.list.querySelectorAll('.tnt-report').length > reportsBefore)
        state.holdReport = lastReport(state);

      // 177: new lines under "New since you left" are read from that line, not from the end
      const held = safe(() => !!window.TnaiSinceYouLeft?.hold?.(state), false);
      if (!held && (stick || first)) toBottom(state);
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
    if (open) repaintOne(open, paint);
  }

  function repaintOne(state, paint) {
    if (!state.host) return;
    const stick = nearBottom(state);
    paint(state);
    if (stick) toBottom(state);
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

      // the CLI took a waiting prompt, or its turn ended: the queue at the end follows
      mine.forEach(paintQueued);
      const ended = safe(() => window.TnaiTurns?.get?.(paneId)?.endedAt, 0);
      if (ended) mine.forEach(followEnd);

      // every conversation of this thread on screen, the open one and an All threads card alike
      mine.forEach(state => repaintOne(state, paintDecisions));
    };

    // a conversation on screen has grown in its record: read what is new
    const offChange = native.threadLog?.onChange?.(what => {
      for (const state of shown)
        if (what?.paneId === state.paneId && (what.sub || '') === (state.sub || '')) request(state);
    });
    if (typeof offChange === 'function') stops.push(offChange);

    // The thread list repaints for any small change; the live line is redrawn (and the conversation
    // measured twice) only when what it shows has changed.
    const onPainted = () => {
      if (open && liveInputs(open).key === open.liveKey) return;
      repaint(paintLive);
    };
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

    // A report was filed or a decision marked: the reports' buttons follow, in every conversation
    // on screen, once 49 has read the new results (its own event; a fixed wait after the change
    // could come before the read and leave the buttons as they were until some later event).
    const onContextData = () => {
      for (const state of shown) repaintOne(state, paintDecisions);
    };
    window.addEventListener('tnai:context-data', onContextData);
    stops.push(() => window.removeEventListener('tnai:context-data', onContextData));
  }

  function unlisten() {
    if (shown.size) return;
    stops.forEach(stop => safe(stop, null));
    stops = [];
  }

  // The jump buttons follow the reader's scrolling in each pane (one listener a pane, for whichever
  // conversation it shows).
  const jumpWatched = new WeakSet();

  function watchJump(host) {
    if (jumpWatched.has(host)) return;
    jumpWatched.add(host);
    host.addEventListener(
      'scroll',
      () => {
        for (const state of shown) if (state.host === host) jumpLater(state);
      },
      { passive: true }
    );
  }

  // A prompt held or delivered (71): the waiting prompts at the end of each conversation follow.
  window.addEventListener('tnai:held', () => {
    for (const state of shown) {
      paintQueued(state);
      if (nearBottom(state)) toBottom(state);
    }
  });

  // The user sent a prompt to a thread (11): that conversation goes to its newest line, so the
  // prompt and what follows are in view.
  // A command the app answered itself (184, e.g. /usage): its card goes in at once, at the end of
  // every view of that conversation, and the view follows it like a sent prompt.
  window.addEventListener('tnai:command-card', event => {
    for (const state of shown)
      if (state.paneId === event.detail?.paneId && state.host && !state.sub) {
        safe(() => window.TnaiCommandCards?.place?.(state, node => addBlock(state, node)), null);
        atEnd.set(state.host, true);
        toBottom(state);
      }
  });

  window.addEventListener('tnai:prompt-sent', event => {
    // sent by a decision press (paintDecisions): the view stays where the user is reading
    if (pressingDecision) return;
    for (const state of shown)
      if (state.paneId === event.detail?.paneId && state.host) {
        state.holdReport = null;
        atEnd.set(state.host, true);
        toBottom(state);
        jumpLater(state);
      }
  });

  // Puts one conversation into a pane and starts reading it.
  // Places that asked for a thread living in its own window (162): host → paneId, mounted again
  // when it comes back (retry).
  const refused = new Map();

  function mount(host, paneId, sub = '') {
    // A conversation is in one place at a time (mounting moves it). A thread in its own window
    // keeps it there; another place (the open thread, an All threads card) says where it is.
    const away = !sub && safe(() => !!window.TnaiThreadPopout?.elsewhere?.(paneId, host), false);
    if (away) {
      for (const other of [...shown]) if (other.host === host) unmount(host);
      refused.set(host, paneId);
      safe(() => window.TnaiThreadPopout.placeholder(host, paneId), null);
      return null;
    }
    refused.delete(host);
    const state = stateFor(paneId, sub);

    // Moving into a thread's own window: the place it leaves says where it went.
    const left = state.host;
    if (left && left !== host && safe(() => !!window.TnaiThreadPopout?.isHost?.(host), false)) {
      shown.delete(state);
      refused.set(left, paneId);
      safe(() => window.TnaiThreadPopout.placeholder(left, paneId), null);
    }
    for (const other of shown) if (other.host === host && other !== state) unmount(host);
    state.host = host;
    watchEnd(host);
    watchGrowth(state);
    shown.add(state);

    // 177: back in a thread that got something new: "New since you left" where it starts
    safe(() => window.TnaiSinceYouLeft?.arrive?.(state), null);
    if (!state.live.parentNode) state.list.append(state.live);
    const parts = [state.empty, state.list, state.queued, state.jump];
    if (parts.some((part, at) => host.children[at] !== part) || host.children.length !== 4)
      host.replaceChildren(...parts);
    watchJump(host);
    listen();
    paintFrame(state);
    paintLive(state);
    paintQueued(state);

    // the cards were painted when they were drawn, maybe in another pane: what was decided since
    paintDecisions(state);

    // the pane is shared by every thread: where the reader was in the last one says nothing here
    state.holdReport = null;
    atEnd.set(host, true);
    toBottom(state);
    jumpLater(state);
    request(state);

    // put on screen right after its task ended: the end's last lines may still be on their way
    if (safe(() => window.TnaiTurns?.get?.(paneId)?.endedAt, 0)) followEnd(state);
    return state;
  }

  function unmount(host) {
    refused.delete(host);
    for (const state of [...shown])
      if (state.host === host) {
        // 177: where the reader was when this thread left the view
        safe(() => window.TnaiSinceYouLeft?.leave?.(state), null);
        shown.delete(state);
        state.host = null;
        listSized.unobserve(state.list);
        listOwner.delete(state.list);
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

    // the copy icon on every code block of a drawn reply (152: another computer's conversation)
    copyButtons: block => addCopyButtons(block),
    unmount,

    // 186: the scrollbar map sends the reader up the conversation; following the newest line
    // waits until the reader scrolls back to the end
    leaveEnd,

    // 173: a Find match inside a folded answer or report opens that fold first (feature 14)
    reveal,

    // a reply's height as the fold reckons it (for tools/info-layout-check.js)
    answerHeight,

    // A thread back from its own window (162): every place that asked for it shows it again.
    retry(paneId) {
      for (const [host, wanted] of [...refused])
        if (wanted === paneId && host.isConnected) {
          const state = mount(host, paneId);
          if (host === mainHost) open = state;
        } else if (!host.isConnected) refused.delete(host);
    },

    // Runs `send` (a press that sends a prompt for the user, such as a thread action of 154)
    // without moving the conversation to its newest line: the view stays where the user reads.
    quietly(send) {
      pressingDecision = true;
      try {
        return send();
      } finally {
        pressingDecision = false;
      }
    },
  };
})();
