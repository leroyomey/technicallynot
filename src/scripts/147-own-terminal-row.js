// Technically Not · 147-own-terminal-row.js — Desktop only: the row of controls over the user's own
// terminal (136), and the Ports line under it.
//
// - The shell's name is also its picker where this computer has more than one shell: a press on
//   it lists them (PowerShell, PowerShell 7, Command Prompt, Git Bash, WSL, each only when it is
//   installed). Choosing one restarts the terminal with it, after the same question as Restart.
// - The row: the shell's name and the folder the shell stands in, then three icon buttons.
//   PowerShell says where it stands with every prompt (136 `folder`), so the row follows `cd`;
//   a shell that does not say keeps the folder it started in, and its tip says "started in".
// Clear takes away what is drawn (the shell is told nothing). Restart ends the shell and starts a
// new one in the same place; it asks first while the shell runs, because the app cannot tell a
// shell waiting at its prompt from a quiet server running in it. Fill puts the terminal in the open
// thread's place and back.
// - Ports: one line that unfolds (closed until pressed) to the addresses on this computer that
//   Live preview knows for this project (31): the servers it started itself, with their state,
//   and addresses added by hand or by an agent, which the app did not start. Each opens in Live
//   preview. The app has no other list of local servers in the window; nothing is scanned.
//
// The parts are built into 136's box. Look: src/styles/35-thread-side.css. Test:
// `own-terminal-row`.
(() => {
  'use strict';
  const own = window.TnaiOwnTerminal;
  if (!own?.root) return;

  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const setText = (node, value) => {
    if (node.textContent !== value) node.textContent = value;
  };
  const setAttr = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const escapeHtml = value =>
    String(value).replace(
      /[&<>"']/g,
      found => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[found]
    );
  const normal = path =>
    String(path || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');

  // ---------- the row ----------
  const row = document.createElement('div');
  row.className = 'tnt-ownterm-row';
  row.innerHTML =
    '<label class="tnt-ownterm-shellbox"><span class="tnt-ownterm-shell"></span>' +
    icon('chevron-down', 14) +
    '<select aria-label="Shell of your terminal" title="Choose the shell of your terminal">' +
    '</select></label><span class="tnt-ownterm-folder"></span>' +
    '<button type="button" data-do="clear" aria-label="Clear what is on screen" ' +
    'title="Clear what is on screen">' +
    icon('trash-2', 16) +
    '</button>' +
    '<button type="button" data-do="restart" aria-label="Restart the shell" ' +
    'title="Restart the shell">' +
    icon('rotate-cw', 16) +
    '</button>' +
    '<button type="button" data-do="fill"></button>';
  const shellName = row.querySelector('.tnt-ownterm-shell');
  const shellBox = row.querySelector('.tnt-ownterm-shellbox');
  const shellPick = shellBox.querySelector('select');
  const folderName = row.querySelector('.tnt-ownterm-folder');
  const fillButton = row.querySelector('[data-do="fill"]');

  // The folder as a person would say it: the project's name, and the way down from it.
  function folderWords(folder) {
    const full = normal(folder);
    const root = normal(window.TnaiProjects?.active?.());
    if (!full) return '';
    const inside = root && full.toLowerCase().startsWith(root.toLowerCase());
    if (!inside) return full;
    const projectName = root.split('/').pop();
    return projectName + full.slice(root.length);
  }

  function paintRow() {
    const session = own.session();
    paintShell();
    const now = own.folder?.() || '';
    setText(folderName, folderWords(now || session?.cwd));
    setAttr(
      folderName,
      'title',
      now ? 'This shell is in ' + now : session?.cwd ? 'This shell started in ' + session.cwd : ''
    );
    const filled = own.filled();
    const words = filled
      ? 'Put the terminal back in its column'
      : 'Fill the thread’s place with the terminal';
    setAttr(fillButton, 'aria-label', words);
    setAttr(fillButton, 'title', words);
    setAttr(fillButton, 'aria-pressed', String(filled));
    const wanted = filled ? 'minimize-2' : 'maximize-2';
    if (fillButton.dataset.icon !== wanted) {
      fillButton.dataset.icon = wanted;
      fillButton.innerHTML = icon(wanted, 16);
    }
  }

  // The shell's name, and the list to choose from where there is more than one.
  let shellsKey = '';

  function paintShell() {
    const list = own.shells?.() || [];
    const now = own.shell?.() || '';
    const chosen = list.find(shell => shell.id === now);
    setText(shellName, chosen?.name || window.tnaiShell?.() || 'Shell');
    const key = JSON.stringify(list);
    if (key !== shellsKey) {
      shellsKey = key;
      shellPick.replaceChildren(
        ...list.map(shell => {
          const option = document.createElement('option');
          option.value = shell.id;
          option.textContent = shell.name;
          return option;
        })
      );
    }
    if (now && shellPick.value !== now) shellPick.value = now;
    shellBox.classList.toggle('tnt-ownterm-oneshell', list.length < 2);
  }

  // Asked inside the terminal's own box, by the app's question box (11). True when the user said
  // yes, or when no shell runs and there is nothing to lose.
  async function mayEnd(title, okWord) {
    const session = own.session();
    const ask = window.TnaiPanelConfirm;
    if (!session?.running || !ask) return true;
    return !!(await ask(own.root(), {
      title,
      body: 'The shell ends, and with it anything that is still running in it. A new one starts in the same folder.',
      ok: okWord,
      danger: true,
    }));
  }

  async function restart() {
    if (await mayEnd('Restart the shell?', 'Restart')) await own.restart();
  }

  // Another shell was chosen in the list: it takes the terminal after the question, or the list
  // goes back to the shell that runs.
  shellPick.addEventListener('change', async () => {
    const next = shellPick.value;
    const name = shellPick.selectedOptions[0]?.textContent || 'this shell';
    if (next === own.shell()) return;
    if (await mayEnd('Switch to ' + name + '?', 'Switch')) await own.setShell(next);
    paintShell();
  });

  row.addEventListener('click', event => {
    const pressed = event.target.closest('button[data-do]');
    if (!pressed) return;
    if (pressed.dataset.do === 'clear') own.clear();
    else if (pressed.dataset.do === 'restart') restart();
    else if (pressed.dataset.do === 'fill') own.fill();
  });

  // ---------- Ports ----------
  const ports = document.createElement('div');
  ports.className = 'tnt-ownterm-ports';
  ports.innerHTML =
    '<button type="button" class="tnt-ownterm-ports-head" aria-expanded="false" ' +
    'aria-controls="tntOwnTermPorts"><span>Ports</span><em></em>' +
    icon('chevron-right', 14) +
    '</button><div class="tnt-ownterm-ports-list" id="tntOwnTermPorts" hidden></div>';
  const portsHead = ports.querySelector('.tnt-ownterm-ports-head');
  const portsCount = ports.querySelector('em');
  const portsList = ports.querySelector('.tnt-ownterm-ports-list');

  // The addresses Live preview knows for this project, each with what the app really knows of it.
  function knownPorts() {
    const preview = window.TnaiLivePreview;
    if (!preview?.tabs) return [];
    return preview
      .tabs()
      .filter(tab => tab.url)
      .map(tab => ({
        id: tab.id,
        address: tab.url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        words:
          tab.kind === 'url'
            ? 'not started by Technically Not'
            : (tab.script ? tab.script + ' · ' : '') +
              (tab.state === 'running'
                ? 'running'
                : tab.state === 'starting'
                  ? 'starting'
                  : 'not running'),
      }));
  }

  let portsKey = '';

  function paintPorts() {
    const list = knownPorts();
    setText(portsCount, String(list.length));
    const key = JSON.stringify(list);
    if (key === portsKey) return;
    portsKey = key;
    portsList.innerHTML = list.length
      ? list
          .map(
            port =>
              '<div class="tnt-ownterm-port"><span class="tnt-ownterm-port-address">' +
              escapeHtml(port.address) +
              '</span><span class="tnt-ownterm-port-words">' +
              escapeHtml(port.words) +
              '</span><button type="button" data-port="' +
              escapeHtml(port.id) +
              '" aria-label="Open ' +
              escapeHtml(port.address) +
              ' in Live preview" title="Open in Live preview">' +
              icon('monitor-play', 16) +
              '</button></div>'
          )
          .join('')
      : '<p class="tnt-ownterm-note">Live preview knows no address on this computer for this ' +
        'project yet. A web address printed in the terminal opens there with a press.</p>';
  }

  portsHead.addEventListener('click', () => {
    const open = portsHead.getAttribute('aria-expanded') !== 'true';
    portsHead.setAttribute('aria-expanded', String(open));
    portsList.hidden = !open;
    if (open) paintPorts();
  });
  portsList.addEventListener('click', event => {
    const pressed = event.target.closest('button[data-port]');
    if (!pressed) return;
    window.TnaiLivePreview?.select?.(pressed.dataset.port);
    const show = () => window.TnaiLivePreviewPage?.open();

    // a change of page fades, as from the menu (124)
    if (window.TnaiMotion) window.TnaiMotion.swap(show, 'page');
    else show();
  });

  // ---------- built in, and kept current while it is on screen ----------
  own.root().prepend(row, ports);
  const onScreen = () => row.getClientRects().length > 0;
  const repaint = () => {
    if (!onScreen()) return;
    paintRow();
    paintPorts();
  };
  window.TnaiAgents?.onChange?.(repaint);
  window.TnaiLivePreview?.onChange?.(repaint);
  [
    'tnai:own-terminal-view',
    'tnai:own-terminal-fill',
    'tnai:own-terminal-shells',
    'tnai:own-terminal-folder',
    'tnai:project-changed',
  ].forEach(name =>
    window.addEventListener(name, () => {
      paintRow();
      paintPorts();
    })
  );
  paintRow();
  paintPorts();

  window.TnaiOwnTerminalRow = { ports: knownPorts };
})();
