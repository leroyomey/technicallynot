// Technically Not · 45-agent-permissions — Desktop only: Claude Code's tool-permission prompts
// (agent-hooks.js PermissionRequest), and OpenCode's on the same agent:permission event (from its
// own server), answered from Technically Not's window: a calm card bottom-right above the composer
// with the agent, tool, and command/path, and Allow once · Allow for session · Deny · Answer in
// terminal. Several prompts queue ("1 of 3").
(function () {
  const native = window.tnaiNative?.permissions;
  if (!native) return;

  const style = document.createElement('style');
  style.textContent = `
.tnai-perm{position:fixed;right:18px;bottom:128px;z-index:60;width:420px;max-width:calc(100vw - 36px);background:#fff;border:1px solid var(--line);border-radius:var(--surface-r);box-shadow:var(--shadow);padding:12px 14px;font-size:12px;color:var(--ink)}
.tnai-perm[hidden]{display:none}
.tnai-perm-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.tnai-perm-head b{font-weight:600}
.tnai-perm-count{margin-left:auto;color:var(--muted);font-size:11px}
.tnai-perm-tool{display:inline-block;padding:1px 7px;border-radius:10px;background:#eef3ee;color:var(--green);font-size:11px}
.tnai-perm-detail{margin:0 0 6px;padding:7px 9px;background:var(--paper);border:1px solid var(--line);border-radius:7px;font:11px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto}
.tnai-perm-desc{color:var(--muted);margin-bottom:6px}
.tnai-perm-actions{display:flex;gap:6px;margin-top:10px;white-space:nowrap}
.tnai-perm-actions button{height:30px;box-sizing:border-box;padding:0 10px;border-radius:7px;font:inherit;font-size:11px;border:1px solid var(--line);background:#fff;color:#444;cursor:pointer}
.tnai-perm-actions button:hover{background:#f6f6f2}
.tnai-perm-actions .allow{background:var(--green);border-color:var(--green);color:#fff}
.tnai-perm-actions .allow:hover{background:#335d4b}
.tnai-perm-actions .later{margin-left:auto;border-color:transparent;color:var(--muted)}`;
  document.head.appendChild(style);

  const card = document.createElement('div');
  card.className = 'tnai-perm';
  card.hidden = true;
  card.setAttribute('role', 'alertdialog');
  card.innerHTML =
    '<div class="tnai-perm-head"><b></b><span class="tnai-perm-tool"></span><span class="tnai-perm-count"></span></div>' +
    '<div class="tnai-perm-desc"></div><pre class="tnai-perm-detail"></pre>' +
    '<div class="tnai-perm-actions"><button class="allow" data-d="once">Allow once</button><button data-d="session">Allow for session</button><button data-d="deny">Deny</button><button class="later" data-d="terminal" title="Close this and answer on the agent\'s CLI screen">Answer on the CLI screen</button></div>';
  document.body.appendChild(card);

  const queue = []; // open prompts, oldest first
  const paneName = paneId =>
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"] .terminal-pane-title'
      )
      ?.textContent.trim() || paneId;

  // A click answers the prompt that is painted, never the one behind it (prompt A
  // ended by itself, the card repainted with B under the pointer and the click meant for A allowed
  // B). The card carries the painted prompt's id; when another prompt takes a card that was already
  // showing, its buttons take no click for SWAP_MS, long enough to see that the text changed.
  const SWAP_MS = 600;
  let painted = '',
    swapTimer = 0;
  const hold = on =>
    card.querySelectorAll('button[data-d]').forEach(b => {
      b.disabled = on;
    });

  function paint() {
    const p = queue[0];
    const swapped = !!p && !card.hidden && !!painted && painted !== p.id;
    card.hidden = !p;
    painted = p ? p.id : '';
    card.dataset.promptId = painted;
    if (swapped || !p) {
      clearTimeout(swapTimer);
      hold(swapped);
      if (swapped) swapTimer = setTimeout(() => hold(false), SWAP_MS);
    }
    if (!p) return;

    // Just above the docked composer, which grows with its text (46); popped out or hidden, the
    // default bottom applies.
    const top = document.querySelector('.composer')?.getBoundingClientRect().top;
    card.style.bottom =
      top > 0 && top < innerHeight - 40 ? Math.round(innerHeight - top + 12) + 'px' : '';
    card.querySelector('b').textContent = paneName(p.paneId) + ' asks to use';
    card.querySelector('.tnai-perm-tool').textContent = p.tool || 'a tool';
    card.querySelector('.tnai-perm-count').textContent =
      queue.length > 1 ? '1 of ' + queue.length : '';
    const desc = card.querySelector('.tnai-perm-desc');
    desc.textContent = p.description || '';
    desc.hidden = !p.description;
    const detail = card.querySelector('.tnai-perm-detail');
    detail.textContent = p.detail || '';
    detail.hidden = !p.detail;

    // What "for session" covers (agent-hooks.js sessionScope): the same command/host, the whole
    // tool, or nothing (chained shell commands).
    const session = card.querySelector('[data-d="session"]'),
      scope = p.sessionScope;
    session.hidden = scope == null;
    session.textContent = scope ? 'Allow “' + scope + '” for session' : 'Allow for session';
    session.title = scope
      ? 'Also allow ' +
        scope +
        (/^webfetch$/i.test(p.tool || '') ? '' : ' commands') +
        ' without asking until this session ends'
      : // OpenCode names its tools in lower case
        'Also allow ' + (p.tool || 'this tool') + ' without asking until this session ends';
  }

  function add(p) {
    if (!queue.some(q => q.id === p.id)) {
      queue.push(p);
      paint();
    }
  }

  function drop(id) {
    const i = queue.findIndex(q => q.id === id);
    if (i >= 0) {
      queue.splice(i, 1);
      paint();
    }
  }

  card.addEventListener('click', event => {
    const button = event.target.closest('button[data-d]');
    const p = queue[0];
    if (!button || button.disabled || !p || p.id !== card.dataset.promptId) return;

    // main confirms with a done event; an answer for a prompt that already ended is ignored there
    drop(p.id);
    native.answer(p.id, button.dataset.d);
  });

  native.on(event => (event.done ? drop(event.id) : add(event)));
  native.pending().then(
    list => (list || []).forEach(add),
    () => {}
  ); // prompts still open after a window reload
})();
