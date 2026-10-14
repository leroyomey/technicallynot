// Technically Not · 05-terminal-pane-input-compaction.js — Per-pane input, terminal-mode layout,
// clear + local compact summary (tnai.terminal-context.v1)

(() => {
  const layout = document.querySelector('.layout'),
    view = document.getElementById('terminalView'),
    content = view?.querySelector('.terminal-content');
  if (!layout || !view || !content) return;
  const css = document.createElement('style');
  css.textContent =
    '.layout.terminal-mode~.composer{display:none!important}.layout.terminal-mode .terminal-view{grid-template-rows:42px minmax(0,1fr)!important}.layout.terminal-mode .terminal-toolbar{height:42px;padding:0 2px}.layout.terminal-mode .terminal-toolbar .terminal-sample-label,.layout.terminal-mode #openRuntimeLauncher{display:none!important}.terminal-provider-select{flex:none;max-width:142px;height:24px;padding:0 6px;border:1px solid var(--pg-line);border-radius:5px;background:var(--pg-panel);color:var(--pg-text-2);font:9px var(--pg-sans)}.terminal-pane[data-state=unavailable] .terminal-pane-state i{background:var(--pg-wait);box-shadow:none}.terminal-pane .terminal-context-state{color:var(--pg-text-3);font:8px var(--pg-sans);white-space:nowrap}.terminal-pane .terminal-output{font-family:"Cascadia Code","SFMono-Regular",Consolas,monospace}.terminal-pane .terminal-message{white-space:pre-wrap;overflow-wrap:anywhere}.terminal-pane .terminal-message-user{color:var(--pg-text)}.terminal-pane .terminal-message-system{color:var(--pg-ready)}.terminal-context-summary{margin:4px 0 12px;padding:10px 12px;border:1px solid var(--pg-line-2);border-radius:6px;background:var(--pg-panel-2);color:var(--pg-text-2);font:10px/1.55 var(--pg-sans);white-space:normal}.terminal-context-summary b{display:block;margin-bottom:4px;color:var(--pg-text);font-size:9px}.terminal-context-summary small{display:block;margin-top:6px;color:var(--pg-text-3);font-size:8px}.terminal-pane .terminal-input input{font-family:var(--pg-sans)}.terminal-pane .terminal-input.is-shell input{font-family:Consolas,monospace}.terminal-pane .terminal-input .input-prompt.is-ai{font-family:var(--pg-sans);font-size:12px}.terminal-pane .terminal-input button:disabled{opacity:.45;cursor:not-allowed}.terminal-pane .terminal-context-state.has-summary{color:var(--pg-ready)}.terminal-pane .terminal-agent-bind{display:none!important}@media(max-width:1120px){.terminal-provider-select{max-width:118px}.terminal-pane .terminal-context-state{display:none}}';
  document.head.append(css);
  const options = [
    ['', 'Choose connection…'],
    ['Claude Code', 'Claude Code'],
    ['Codex', 'Codex'],
    ['Cursor Agent', 'Cursor Agent'],
    ['Gemini CLI', 'Gemini CLI'],
    ['Droid', 'Droid'],
    ['OpenCode', 'OpenCode'],
    ['GitHub Copilot', 'GitHub Copilot'],
    ['DeepSeek Harness', 'DeepSeek Harness'],
    ['Grok Build', 'Grok Build'],
    ['Kimi Code', 'Kimi Code'],
    ['Antigravity', 'Antigravity'],
    ['Muse Code', 'Muse Code'],
    ['Terminal', 'Terminal · shell'],
  ];
  const storageKey = 'tnai.terminal-context.v1';
  let contextStore = {};
  try {
    contextStore = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch {}
  const toolbar = view.querySelector('.terminal-tools'),
    sampleLabel = toolbar?.querySelector('.terminal-sample-label');
  if (sampleLabel) sampleLabel.textContent = 'Choose a connection in each terminal';
  document.getElementById('agentRecipient')?.remove();

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(contextStore));
    } catch {}
  }
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (id && contextStore[id]) {
      delete contextStore[id];
      persist();
    }
  });

  function trim(text, max) {
    const value = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }

  function addLine(output, text, kind) {
    const row = document.createElement('div');
    row.className = 'output-line terminal-message ' + (kind || 'terminal-message-system');
    row.textContent = text;
    output.append(row);
    output.scrollTop = output.scrollHeight;
    return row;
  }

  function summaryFor(state) {
    if (!state.turns?.length) return state.summary || '';
    const recent = state.turns
      .slice(-5)
      .map(
        (turn, i) => (state.turns.length > 5 && i === 0 ? 'Recent request: ' : '') + trim(turn, 125)
      );
    const prior = state.summary ? trim(state.summary, 260) + ' · ' : '';
    return trim(prior + 'Recent requests: ' + recent.join(' · '), 620);
  }

  function showSummary(output, state, message) {
    output.replaceChildren();
    const meta = document.createElement('div');
    meta.className = 'output-meta';
    meta.innerHTML =
      '<span>Visible output cleared · compact context retained</span><span>Local · no model call</span>';
    output.append(meta);
    const card = document.createElement('div');
    card.className = 'terminal-context-summary';
    const title = document.createElement('b');
    title.textContent = state.summary
      ? 'Compact context · ' + (state.compactedTurns || 0) + ' turns summarized'
      : 'Fresh context';
    const text = document.createElement('span');
    text.textContent = state.summary || 'No earlier conversation to carry forward.';
    const note = document.createElement('small');
    note.textContent =
      message || 'The next prompt for this connection will include this short summary.';
    card.append(title, text, note);
    output.append(card);
  }

  function installPane(pane) {
    if (pane.dataset.contextReady === 'true') return;
    const id = pane.dataset.paneId;
    if (!id) return;
    pane.dataset.contextReady = 'true';
    let state = contextStore[id];
    if (!state || typeof state !== 'object')
      state = { provider: '', summary: '', turns: [], compactedTurns: 0 };
    state.provider = options.some(x => x[0] === state.provider) ? state.provider : '';
    state.turns = Array.isArray(state.turns) ? state.turns.slice(-10) : [];
    contextStore[id] = state;
    const head = pane.querySelector('.terminal-pane-head'),
      output = pane.querySelector('.terminal-output'),
      inputBox = pane.querySelector('.terminal-input'),
      input = inputBox?.querySelector('input'),
      run = inputBox?.querySelector('button');
    if (!head || !output || !inputBox || !input || !run) return;
    const oldSelect = head.querySelector('.terminal-agent-bind');
    const connection = document.createElement('select');
    connection.className = 'terminal-provider-select';
    connection.setAttribute('aria-label', 'Choose a connection for this terminal');
    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      connection.append(option);
    }
    connection.value = state.provider;
    if (oldSelect) oldSelect.replaceWith(connection);
    else head.insertBefore(connection, head.querySelector('.terminal-pane-state'));
    const contextBadge = document.createElement('span');
    contextBadge.className = 'terminal-context-state';
    contextBadge.title =
      'A new terminal starts with fresh context. Compacting keeps a short summary for this connection.';
    connection.after(contextBadge);
    const promptMark = inputBox.querySelector('.input-prompt');
    const av = document.createElement('span');
    av.className = 'agent-avatar terminal-pane-av';
    av.setAttribute('aria-hidden', 'true');
    head.prepend(av); /* profile tile (concept .av): CLI logo or first letter of the connection */
    function update() {
      const chosen = Boolean(state.provider);
      {
        const cli = (state.provider || '').trim().toLowerCase().replace(/\s+/g, '-');
        if (av.dataset.cli !== cli) {
          av.dataset.cli = cli;
          const mark = window.TnaiCliIcons?.svg?.(state.provider) || '';
          av.classList.toggle('has-ico', !!mark);
          if (mark) av.innerHTML = mark;
          else av.textContent = state.provider ? state.provider.charAt(0).toUpperCase() : '›';
        }
      }
      pane.dataset.state = chosen ? 'unavailable' : 'idle';
      const status = pane.querySelector('.terminal-pane-state span');
      if (status) status.textContent = chosen ? 'Not connected' : 'Choose connection';
      if (promptMark) {
        promptMark.textContent = state.provider === 'Terminal' ? '$' : '✦';
        promptMark.classList.toggle(
          'is-ai',
          Boolean(state.provider && state.provider !== 'Terminal')
        );
      }
      input.disabled = !chosen;
      run.disabled = !chosen;
      const shell = state.provider === 'Terminal';
      inputBox.classList.toggle('is-shell', shell);
      input.placeholder = !chosen
        ? 'Choose a connection first…'
        : shell
          ? 'Type a command…'
          : 'Message ' + state.provider + '…';
      input.setAttribute(
        'aria-label',
        !chosen
          ? 'Choose a connection first'
          : shell
            ? 'Command for this terminal'
            : 'Message for ' + state.provider
      );
      run.textContent = shell ? 'Run ↵' : 'Send ↵';
      contextBadge.textContent = state.summary ? 'Context · summary' : 'Context · fresh';
      contextBadge.classList.toggle('has-summary', Boolean(state.summary));
      run.title = chosen
        ? shell
          ? 'Queue command in this terminal'
          : 'Draft a message for ' + state.provider
        : 'Choose a connection first';
      if (status)
        status.parentElement.title =
          status.textContent +
          ' · ' +
          contextBadge.textContent; /* narrow panels: dot only, context in this tooltip (11) */
    }
    connection.onchange = () => {
      if (state.provider !== connection.value && state.turns.length) {
        state.summary = summaryFor(state);
        state.compactedTurns = (state.compactedTurns || 0) + state.turns.length;
        state.turns = [];
        addLine(
          output,
          'Conversation context condensed for the connection change.',
          'terminal-message-system'
        );
      }
      state.provider = connection.value;
      persist();
      update();
      if (state.provider)
        addLine(
          output,
          state.provider + ' selected · its runtime is not connected in this prototype.',
          'terminal-message-system'
        );
    };

    function submit() {
      const text = input.value.trim();
      if (!text || !state.provider) return;
      state.turns.push(text);
      state.turns = state.turns.slice(-10);
      persist();
      if (state.provider === 'Terminal') {
        addLine(output, '$ ' + text, 'terminal-message-user');
        addLine(
          output,
          'Not run · a local shell connection is not available in this prototype.',
          'terminal-message-system'
        );
      } else {
        addLine(output, 'You › ' + text, 'terminal-message-user');
        addLine(
          output,
          'Draft saved in this terminal · ' +
            state.provider +
            ' is not connected, so nothing was sent.',
          'terminal-message-system'
        );
      }
      const status = pane.querySelector('.terminal-pane-state span');
      if (status) status.textContent = 'Not connected';
      input.value = '';
      input.focus();
    }
    run.onclick = submit;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        submit();
      }
    });
    const clear = head.querySelector('.terminal-pane-tools button[title="Clear output"]');
    if (clear) {
      clear.title = 'Compact context and clear visible output';
      clear.setAttribute('aria-label', clear.title);
      clear.textContent = '↻';
      clear.onclick = e => {
        e.stopPropagation();
        if (state.turns.length) {
          state.summary = summaryFor(state);
          state.compactedTurns = (state.compactedTurns || 0) + state.turns.length;
          state.turns = [];
          persist();
        }
        showSummary(
          output,
          state,
          state.summary
            ? 'Summary will be carried into the next prompt for this connection.'
            : 'No earlier conversation to summarize; the next prompt starts fresh.'
        );
      };
    }
    if (pane.dataset.paneId === 'terminal-main') {
      const meta = output.querySelector('.output-meta');
      if (meta) {
        meta.replaceChildren();
        const left = document.createElement('span');
        left.textContent = 'No connection selected';
        const right = document.createElement('span');
        right.textContent = 'Choose a connection above';
        meta.append(left, right);
      }
      output.querySelectorAll('.output-line').forEach(line => line.remove());
      if (!state.provider) {
        const row = document.createElement('div');
        row.className = 'output-line dim';
        row.textContent = 'Choose a connection in this terminal to begin.';
        output.append(row);
      }
    } else {
      output.replaceChildren();
      const meta = document.createElement('div');
      meta.className = 'output-meta';
      meta.innerHTML =
        '<span>Terminal session · no runtime running</span><span>Choose a connection</span>';
      output.append(meta);
      addLine(
        output,
        'Choose a connection above to start this terminal.',
        'terminal-message-system'
      );
    }
    update();
    if (state.summary)
      showSummary(
        output,
        state,
        'This summary stays scoped to this terminal. New terminals start with fresh context.'
      );
  }
  content.querySelectorAll('.terminal-pane').forEach(installPane);
  const observer = new MutationObserver(records =>
    records.forEach(record =>
      record.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('.terminal-pane')) installPane(node);
        node.querySelectorAll?.('.terminal-pane').forEach(installPane);
      })
    )
  );
  observer.observe(content, { childList: true });
  document
    .querySelectorAll('.side-item[data-view=terminal]')
    .forEach(item =>
      item.addEventListener('click', () =>
        setTimeout(() => content.querySelectorAll('.terminal-pane').forEach(installPane), 0)
      )
    );
})();
