/*
 * Technically Not · 150-composer-stop.js
 *
 * Desktop only: Stop in the prompt box. While the agent the prompt box is aimed at works (11
 * `TnaiLiveTasks.target`, the open thread on the Threads page), a stop button stands before Send.
 * A press opens a menu of two rows, the thread's own "..." menu in small (`.tnt-menu`, 137):
 *
 *   Stop where it is — the agent's current step is interrupted (one Esc, as in its CLI screen);
 *     its session, conversation and work so far stay, and it waits for the next prompt.
 *   Cancel prompt and edit it — the same interrupt, and the words last sent to it come back into
 *     the prompt box (in front of anything already typed there) to change and send again.
 *
 * The keys are pressed by the main process (desktop/user-interrupt.js, `agents.interrupt`). When
 * Claude Code had not started its reply it put the prompt back into its own input; main clears that
 * input, and the words come back to the prompt box after either row, since nothing was done yet.
 *
 * The button wears the look of the prompt box's pop-out button (`.tnai-composer-stop` beside
 * `.tnai-composer-pop` in 07; 44 by 44 under touch in 36). Nothing runs while no agent works: it
 * follows pushed changes only (10's `data-status`, `tnai:target-changed`).
 * `window.TnaiComposerStop`.
 */

(() => {
  'use strict';
  if (!window.tnaiNative?.agents) return;

  // Only an agent at work: a plain shell is 'running' the whole time it is open.
  const WORKING = new Set(['working']);

  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(session => session.paneId === paneId) || null;
  const panelOf = paneId =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');
  const nameOf = paneId => sessionOf(paneId)?.name || 'The agent';

  // The agent the prompt box sends to, when it is one that works right now.
  function workingTarget() {
    const paneId = window.TnaiLiveTasks?.target?.() || '';
    if (!paneId) return '';
    const session = sessionOf(paneId);
    if (!session?.running) return '';
    const status = panelOf(paneId)?.dataset.status || session.status || '';
    return WORKING.has(status) ? paneId : '';
  }

  // ---------- the button ----------
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tnai-composer-stop';
  button.hidden = true;
  button.innerHTML = icon('square-stop', 16);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  // Just before Send, or before ＋ New agent, which stays right next to Send (11). The prompt box
  // may stand in the pop-out window (38), so Send is looked for in the button's own document.
  function place() {
    const doc = button.isConnected ? button.ownerDocument : document;
    const send = doc.getElementById('send');
    if (!send?.parentNode) return;
    const before = send.previousElementSibling;
    const anchor = before?.classList.contains('tnai-new-agent') ? before : send;
    if (button.nextElementSibling !== anchor) anchor.parentNode.insertBefore(button, anchor);
  }

  let shownFor = '';

  function paint() {
    place();
    const paneId = workingTarget();
    shownFor = paneId;
    button.hidden = !paneId;
    if (!paneId) {
      close();
      return;
    }
    const label = 'Stop ' + nameOf(paneId) + ', or cancel its prompt';
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  // ---------- the menu ----------
  let menu = null;
  const ROWS = [
    { id: 'stop', label: 'Stop where it is', icon: 'square-stop' },
    { id: 'cancel', label: 'Cancel prompt and edit it', icon: 'pencil' },
  ];

  function build() {
    const doc = button.ownerDocument;
    if (menu && menu.ownerDocument === doc) return;
    menu?.remove();
    menu = doc.createElement('div');
    menu.className = 'tnt-menu tnt-menu-thread';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Stop');
    menu.replaceChildren(
      ...ROWS.map(row => {
        const rowButton = doc.createElement('button');
        rowButton.type = 'button';
        rowButton.className = 'tnt-menu-row';
        rowButton.setAttribute('role', 'menuitem');
        rowButton.dataset.row = row.id;
        rowButton.innerHTML = icon(row.icon, 16) + '<span></span>';
        rowButton.querySelector('span').textContent = row.label;
        return rowButton;
      })
    );
    doc.body.append(menu);
    menu.addEventListener('click', onRowPress);
    menu.addEventListener('keydown', onKey);
  }

  const isOpen = () => !!menu && !menu.hidden;
  const rowButtons = () => [...menu.querySelectorAll('.tnt-menu-row')];

  function open() {
    if (isOpen() || !shownFor) return;
    build();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    window.TnaiFloat?.attach(button, menu, { placement: 'top-end', offset: 6 });
    rowButtons()[0]?.focus({ preventScroll: true });
    button.ownerDocument.defaultView.addEventListener('pointerdown', onOutsidePress, true);
  }

  function close(returnFocus) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    window.TnaiFloat?.detach?.(menu);
    menu.ownerDocument.defaultView.removeEventListener('pointerdown', onOutsidePress, true);
    if (returnFocus && button.isConnected && !button.hidden) button.focus({ preventScroll: true });
  }

  function onOutsidePress(event) {
    if (menu.contains(event.target) || button.contains(event.target)) return;
    close();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    const buttons = rowButtons();
    const at = buttons.indexOf(event.target.ownerDocument.activeElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (at - 1 + buttons.length) % buttons.length;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus({ preventScroll: true });
  }

  function onRowPress(event) {
    const row = event.target.closest('.tnt-menu-row')?.dataset.row;
    if (!row) return;
    const paneId = shownFor;
    close();
    if (paneId) stopAgent(paneId, row === 'cancel');
  }

  button.addEventListener('click', () => (isOpen() ? close(true) : open()));

  // ---------- the stop ----------
  // The words go in front of a draft already in the box, as 71's Cancel does.
  function backToBox(text) {
    const input =
      button.ownerDocument.getElementById('prompt') || document.getElementById('prompt');
    if (!input || !text) return false;
    input.value = input.value.trim() ? text + '\n' + input.value : text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(text.length, text.length);
    return true;
  }

  // The words last sent to that agent from the prompt box, as the user wrote them (11 `record`).
  function lastPrompt(paneId) {
    const text = window.TnaiLiveTasks?.get?.(paneId)?.text || '';
    return text === '(attachments only)' ? '' : text;
  }

  const stopping = new Set();

  async function stopAgent(paneId, cancel) {
    if (stopping.has(paneId)) return;
    stopping.add(paneId);
    const name = nameOf(paneId);
    const text = lastPrompt(paneId);
    let result = null;
    try {
      result = await window.tnaiNative.agents.interrupt(paneId);
    } catch {
      result = null;
    } finally {
      stopping.delete(paneId);
    }
    if (!result?.ok) {
      say(
        result?.state === 'not-running'
          ? name + ' is not running.'
          : name + ' could not be stopped.'
      );
      return;
    }

    // Claude Code had not begun: the prompt was never worked on, so it is back in the box either
    // way. Its attachment chips come back first (27 takeSent), so the words' @1… still point at
    // them and a draft already in the box has its own @N shifted past them.
    const back = cancel || result.state === 'restored';
    const chips = back ? window.TnaiAttachments?.takeSent?.(paneId) || 0 : 0;
    const putBack = back && (backToBox(text) || chips > 0);
    if (putBack && result.state === 'restored')
      say(name + ' had not started · your prompt is back in the box');
    else if (putBack) say('Stopped ' + name + ' · your prompt is back in the box to edit');
    else if (cancel) say('Stopped ' + name + ' · its last prompt is not known here');
    else say('Stopped ' + name + ' where it was · it waits for your next prompt');
  }

  // ---------- following the target and its status ----------
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;

    // a timer, not a frame: a window in the background gets no frames, and Stop must still go
    setTimeout(() => {
      queued = false;
      paint();
    }, 0);
  };
  window.addEventListener('tnai:target-changed', schedule);
  window.TnaiAgents?.onChange?.(schedule);

  // 10 writes a panel's status as data-status only when it changes, wherever the panel stands.
  // Only that attribute is watched: a terminal's own output never wakes this.
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-status'],
  });
  schedule();

  // ---------- Escape right after a send: take the prompt back ----------
  // Within UNDO_MS of a send from the prompt box, Escape in the empty prompt box cancels that
  // prompt and puts it back in the box. A prompt still held for a busy agent (71) is only taken
  // back, so the agent's current work goes on; one already delivered is cancelled the way "Cancel
  // prompt and edit it" does (the interrupt above). With text in the box, or later than UNDO_MS,
  // Escape does what it did before.
  const UNDO_MS = 10000;
  let lastSend = null;
  window.addEventListener('tnai:prompt-sent', event => {
    const paneId = event.detail?.paneId;
    if (paneId) lastSend = { paneId, at: Date.now(), text: lastPrompt(paneId) };
  });

  // The held prompt that is this send, or null.
  function heldSend(send) {
    const held = window.TnaiNeedsYou?.heldFor?.(send.paneId) || [];
    return held.find(item => !item.from && item.text === send.text) || null;
  }

  function takeBack(send) {
    const held = heldSend(send);
    if (held) {
      window.TnaiNeedsYou.takeHeld(held.id, true);
      return;
    }
    stopAgent(send.paneId, true);
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const input = event.target;
    if (!input || input.id !== 'prompt' || input.value.trim()) return;
    const send = lastSend;
    if (!send || Date.now() - send.at > UNDO_MS || !sessionOf(send.paneId)) return;
    event.preventDefault();
    lastSend = null;
    takeBack(send);
  });

  window.TnaiComposerStop = {
    target: () => shownFor,
    stop: paneId => stopAgent(paneId, false),
    cancel: paneId => stopAgent(paneId, true),
    // tests: the send Escape would take back now, or null
    undoable: () => (lastSend && Date.now() - lastSend.at <= UNDO_MS ? { ...lastSend } : null),
  };
})();
