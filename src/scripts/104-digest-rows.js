/*
 * Technically Not · 104-digest-rows — Terminal page digest rows.
 * Desktop only. In a workspace with 5
 * or more panels, a connected panel the user is not using shows a digest in place of its terminal:
 * its task, what it is doing now, its last result (or its question, or its error) and the newest
 * lines of its screen. Clicking a digest opens that terminal on the left half; the others stay
 * digests on the right, in the same order. The Back button in the open panel's header, or Esc
 * outside a terminal, shows all digests again. Automatic, with the Digest switch in the toolbar to
 * turn it off (`tnai.terminal-digest.v1`). Every value is real: the same sources as the Overview
 * cards (11), with "inferred" where 11 says so. A digested panel's terminal box is hidden
 * (display:none), so it never resizes its pty; it fits again when opened (10 watchFit). Look:
 * src/styles/11-terminal-purple.css. `window.TnaiDigest` (enabled, setEnabled, open, close, min).
 */
(() => {
  const agents = window.TnaiAgents,
    view = document.getElementById('terminalView'),
    content = view?.querySelector('.terminal-content');
  if (!window.tnaiNative || !agents || !content) return;
  const MIN = 5,
    KEY = 'tnai.terminal-digest.v1',
    BUSY = new Set(['working', 'background', 'waiting-agents', 'starting']);
  let enabled = true;
  try {
    enabled = localStorage.getItem(KEY) !== 'off';
  } catch {}
  const opened = new WeakMap(),
    wasOn = new WeakSet(),
    seenLive = new WeakSet(),
    watched = new WeakSet(); // grid → open paneId; grids and panes already handled
  let lastPointer = null,
    lastPointerAt = 0;

  const gridPanes = grid => [...grid.querySelectorAll(':scope>.terminal-pane')];
  const gridOf = pane =>
    pane?.parentElement?.classList.contains('terminal-workspace-grid') ? pane.parentElement : null;
  const activeGrid = () =>
    content.querySelector('.terminal-workspace-view:not([hidden]) .terminal-workspace-grid');
  const paneById = id =>
    content.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]');
  const toggle = (el, name, on) => {
    if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
  };
  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setTip = (el, text) => {
    if (el.title !== text) el.title = text;
  };
  const clip = (text, n) => (text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text);
  const plain = text =>
    clip(
      String(text)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_`#>]+/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      220
    );

  // ---------- which panels are digests ----------
  function sync(grid) {
    const panes = gridPanes(grid);
    const on = enabled && panes.length >= MIN && !grid.classList.contains('tnai-maxed');
    let openId = on ? opened.get(grid) || null : null;

    // The panel the user is in stays a terminal: when digests first apply to this grid, and when a
    // panel they just used gets its connection.
    const using = pane =>
      pane.contains(document.activeElement) ||
      (pane === lastPointer && Date.now() - lastPointerAt < 10000);
    if (on)
      panes.forEach(pane => {
        if (!pane.classList.contains('tnai-live')) return;
        if ((!wasOn.has(grid) || !seenLive.has(pane)) && using(pane)) openId = pane.dataset.paneId;
        seenLive.add(pane);
      });
    if (
      openId &&
      !panes.some(pane => pane.dataset.paneId === openId && pane.classList.contains('tnai-live'))
    )
      openId = null;
    if (on) {
      wasOn.add(grid);
      if (openId) opened.set(grid, openId);
      else opened.delete(grid);
    } else wasOn.delete(grid);
    toggle(grid, 'tnai-dg-grid', on);
    toggle(grid, 'tnai-dg-focus', on && !!openId);
    const rows = String(Math.max(1, Math.ceil((panes.length - 1) / 2)));
    if (grid.style.getPropertyValue('--dg-rows') !== rows)
      grid.style.setProperty('--dg-rows', rows);
    panes.forEach(pane => {
      const isOpen = on && pane.dataset.paneId === openId,
        digest = on && !isOpen && pane.classList.contains('tnai-live');
      toggle(pane, 'tnai-dg-open', isOpen);
      toggle(pane, 'tnai-dg-on', digest);
      if (digest) ensureDigest(pane);
      if (isOpen) ensureBack(pane);
    });
    schedule();
  }
  const syncAll = () => content.querySelectorAll('.terminal-workspace-grid').forEach(sync);

  function ensureDigest(pane) {
    if (pane.querySelector(':scope>.tnai-dg')) return;
    const box = document.createElement('div');
    box.className = 'tnai-dg';
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.innerHTML =
      '<p class="tnai-dg-task"><span class="tnai-dg-k">Task</span><span class="tnai-dg-v"></span></p>' +
      '<p class="tnai-dg-now"><span class="tnai-dg-k">Now</span><span class="tnai-dg-v"></span><span class="tnai-dg-inf" hidden> · inferred</span></p>' +
      '<p class="tnai-dg-last" hidden></p><div class="tnai-dg-tailbox"><pre class="tnai-dg-tail" title="The newest lines of this terminal"></pre></div>';
    (pane.querySelector('.terminal-pane-head') || pane.firstElementChild)?.after(box);
  }

  function ensureBack(pane) {
    const tools = pane.querySelector('.terminal-pane-tools');
    if (!tools || tools.querySelector('[data-tnai-dg-back]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.tnaiDgBack = '';
    button.title = 'Show all digests again (Esc)';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = window.TnaiIcon('layout-grid', { size: 14 });
    const max = tools.querySelector('[data-tnai-max]');
    max ? max.before(button) : tools.prepend(button);
  }

  // ---------- what a digest says (the Overview card's sources, 11 updateCard) ----------
  // The words for one session, also used by the Terminal page's agent list (105): { task, taskTip,
  // now, nowRaw, nowFolder, nowTip, inferred, last, tone, why }.
  function describe(pane, s) {
    const id = s.paneId,
      sent = window.TnaiLiveTasks?.get?.(id),
      title = window.TnaiLiveTasks?.title?.(s);
    const task =
      title ||
      (sent?.text && (window.TnaiResults?.cleanTask?.(sent.text) || sent.text)) ||
      (s.agent === 'Terminal' ? window.tnaiShell() + ' · no agent task' : 'No task yet');
    const taskTip =
      task +
      '\n\n' +
      (title
        ? 'Task summary the CLI set as its terminal title'
        : sent
          ? 'The last task Technically Not sent to this agent'
          : 'Nothing sent yet');

    const doing = s.running ? window.TnaiLiveFeed?.doing?.(id) : null,
      asking = doing?.tone === 'waiting';
    const needs = s.status === 'needs-you' ? window.TnaiNeedsYou?.label?.(id) || 'Needs you' : '';
    const action = window.TnaiFileActivity?.now?.(id),
      fresh = action && Date.now() - action.at < 120000;
    let now,
      tip,
      inferred = false;

    // The call as the tool reported it and the folder a command runs in (53, 183): the thread list
    // and the Working line show the plain words and keep this raw text as their tip.
    let raw = '',
      folder = '';
    if (doing && !asking) {
      now = doing.text;
      raw = doing.raw || '';
      folder = doing.folder || '';
      tip = doing.tip || '';
      inferred = /inferred/i.test(tip);
    } else if (!s.running) {
      now = s.exitText || 'Not running';
      tip = s.exitText
        ? 'Why the process ended, from its exit code'
        : 'No process is running in this panel';
    } else if (needs || asking) {
      now = 'Waiting for you';
      tip = 'Stopped on a question for you';
    } else if (fresh) {
      const plain = window.TnaiPlainWords?.file?.(action.verb, action.path);
      now =
        plain?.text ||
        action.verb.charAt(0).toUpperCase() + action.verb.slice(1) + ' ' + action.path;
      raw = plain?.raw || '';
      inferred = s.agent !== 'Claude Code';
      tip =
        'Latest file this agent touched (from Claude Code’s hook events, or inferred from other CLIs’ output)';
    } else if (s.status === 'working') {
      now = 'Printing output';
      inferred = true;
      tip = 'The process printed output in the last few seconds (inferred from terminal output)';
    } else if (s.status === 'waiting') {
      now = 'Quiet, probably waiting for you';
      inferred = true;
      tip = 'Running, but it has printed nothing for a few seconds (inferred from terminal output)';
    } else {
      now = pane.querySelector('.terminal-pane-state span')?.textContent.trim() || s.status;
      tip = 'The status shown in this panel’s header';
    }
    const result = window.TnaiResults?.get?.(id);
    let text = '',
      tone = '',
      why = '';
    if (needs) {
      text = needs;
      tone = 'ask';
      why = 'Open its terminal to answer.';
    } else if (asking) {
      text = doing.text;
      tone = 'ask';
      why = doing.tip || '';
    } else if (s.status === 'error' || s.error) {
      text = s.error || s.exitText || 'Error';
      tone = 'bad';
      why = 'Why this session stopped';
    } else if (result?.result) {
      text = plain(result.result);
      why = 'The final answer of its last finished task';
    }
    return {
      task,
      taskTip,
      now,
      nowRaw: raw,
      nowFolder: folder,
      nowTip: tip,
      inferred,
      last: text,
      tone,
      why,
    };
  }

  function paint(pane, s) {
    const box = pane.querySelector(':scope>.tnai-dg');
    if (!box || !s) return;
    const q = sel => box.querySelector(sel),
      d = describe(pane, s),
      last = q('.tnai-dg-last');
    setText(q('.tnai-dg-task>.tnai-dg-v'), d.task);
    setTip(q('.tnai-dg-task'), d.taskTip);
    setText(q('.tnai-dg-now>.tnai-dg-v'), d.now);
    q('.tnai-dg-inf').hidden = !d.inferred;
    setTip(q('.tnai-dg-now'), d.now + '\n' + d.nowTip);
    last.hidden = !d.last;
    setText(last, d.last);
    if (last.dataset.tone !== d.tone) last.dataset.tone = d.tone;
    setTip(last, d.last ? d.last + '\n\n' + d.why : '');
    setText(q('.tnai-dg-tail'), (agents.tail?.(s.paneId, 6) || []).join('\n'));
    setTip(box, 'Open ' + (s.name || 'this terminal'));
  }

  // One repaint a frame at most; a slow tick only while a digested panel is busy and the page is
  // shown (nothing runs while idle).
  let queued = 0,
    tick = 0;

  function update() {
    queued = 0;
    clearTimeout(tick);
    tick = 0;

    // The Terminal page is on screen when the layout is in terminal-mode (08): asking the page's
    // box here laid the page out before every repaint (3.6 s of a fast agent switch run,
    // 2026-10-05).
    const grid = activeGrid();
    if (
      !grid?.classList.contains('tnai-dg-grid') ||
      !view.closest('.layout')?.classList.contains('terminal-mode')
    )
      return;
    const sessions = new Map(agents.sessions().map(s => [s.paneId, s]));
    let busy = false;
    grid.querySelectorAll(':scope>.tnai-dg-on').forEach(pane => {
      const s = sessions.get(pane.dataset.paneId);
      paint(pane, s);
      if (s && BUSY.has(s.status)) busy = true;
    });
    if (busy) tick = setTimeout(schedule, 2000);
  }

  function schedule() {
    if (!queued) queued = requestAnimationFrame(update);
  }
  let trailing = 0;
  agents.onChange(() => {
    schedule();
    if (!trailing)
      trailing = setTimeout(() => {
        trailing = 0;
        schedule();
      }, 1500);
  }); // a finished task's result lands just after its status

  // ---------- open one, back to all ----------
  function open(paneId) {
    const pane = paneById(paneId),
      grid = gridOf(pane);
    if (!grid?.classList.contains('tnai-dg-grid') || !pane.classList.contains('tnai-live'))
      return false;
    opened.set(grid, paneId);
    sync(grid);
    return true;
  }

  function close(grid = activeGrid()) {
    if (!grid?.classList.contains('tnai-dg-focus')) return false;
    opened.delete(grid);
    sync(grid);
    return true;
  }
  const openFrom = box => {
    const pane = box.closest('.terminal-pane');
    if (open(pane.dataset.paneId)) pane.querySelector('.tnai-xterm textarea')?.focus();
  };
  content.addEventListener(
    'pointerdown',
    e => {
      lastPointer = e.target.closest?.('.terminal-pane') || null;
      lastPointerAt = Date.now();
    },
    { capture: true, passive: true }
  );
  content.addEventListener('click', e => {
    const back = e.target.closest('[data-tnai-dg-back]'),
      box = e.target.closest('.tnai-dg');
    if (back) {
      e.stopPropagation();
      close(gridOf(back.closest('.terminal-pane')));
    } else if (box) openFrom(box);
  });
  content.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.classList?.contains('tnai-dg')) return;
    e.preventDefault();
    openFrom(e.target);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || !view.getClientRects().length) return;
    if (e.target.closest?.('.xterm,input,textarea,select,[contenteditable]')) return;
    if (close()) e.preventDefault();
  });

  // ---------- watch: panels added or closed, a connection started, maximize (21), workspace shown
  // ----------
  const changed = new MutationObserver(records =>
    new Set(
      records.map(r => (r.target.classList.contains('terminal-pane') ? gridOf(r.target) : r.target))
    ).forEach(grid => grid && sync(grid))
  );

  function watch() {
    content.querySelectorAll('.terminal-workspace-grid').forEach(grid => {
      if (!watched.has(grid)) {
        watched.add(grid);
        changed.observe(grid, { childList: true, attributes: true, attributeFilter: ['class'] });
      }
      gridPanes(grid).forEach(pane => {
        if (!watched.has(pane)) {
          watched.add(pane);
          changed.observe(pane, { attributes: true, attributeFilter: ['class'] });
        }
      });
    });
    syncAll();
  }
  new MutationObserver(watch).observe(content, { childList: true, subtree: false });
  new MutationObserver(records => {
    if (records.some(r => r.target.classList?.contains('terminal-workspace-grid'))) watch();
  }).observe(content, { childList: true, subtree: true });

  // the page or a workspace is shown again: digests catch up
  new ResizeObserver(schedule).observe(content);

  // ---------- the switch (toolbar, before A− / A+) ----------
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'digestToggle';
  button.className = 'terminal-tool';
  button.textContent = 'Digest';

  function paintButton() {
    button.setAttribute('aria-pressed', String(enabled));
    button.title =
      'Digest rows are ' +
      (enabled ? 'on' : 'off') +
      ': in a workspace with ' +
      MIN +
      ' or more terminals, the ones you are not using show their task, what they are doing and their last result instead of the terminal. Click to turn ' +
      (enabled ? 'off' : 'on') +
      '.';
  }

  function setEnabled(on) {
    enabled = !!on;
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {}
    paintButton();
    syncAll();
  }
  button.onclick = () => setEnabled(!enabled);
  const fontDown = document.getElementById('fontDown');
  if (fontDown) fontDown.before(button);
  else view.querySelector('.terminal-tools')?.append(button);
  paintButton();
  watch();

  window.TnaiDigest = {
    enabled: () => enabled,
    setEnabled,
    open,
    close: () => close(),
    min: MIN,
    sync: syncAll,
    describe,
  };
})();
