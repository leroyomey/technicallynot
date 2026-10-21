// Technically Not · remote-typing — Desktop only: typing from this computer into the terminal it
// watches on another computer (the rules are desktop/remote-type.js; plan item 41 of
// docs/plans/multi-computer.md).
//
// - Where: the live picture of another computer's thread (116 draws it in the thread's main area
//   and calls `paint` here each time it draws). A "Type" button in the picture's bar, beside Keep
//   watching, shown only while the picture is live and that computer says this one may type there
//   (its own switch on its Devices page, off by default).
// - Typing is a mode the user enters on purpose: the button, then keys on the picture. It ends with
//   the button, when the picture loses focus, when another thread is opened, when the window is
//   hidden, when the view ends, and after a minute without a key. A click on the picture alone
//   never starts it.
// - What is sent: letters, Enter, Esc, Tab, Backspace, Delete, the arrows, Home, End, Page Up and
//   Page Down, Ctrl+C, and a paste (Ctrl+V). Shift+Tab and other Ctrl keys are not sent, and the
//   bar says so. The main process gathers keys into small batches and says how many wait.
// - What the bar says: the state of typing in its note slot (`em`), in plain words: typing, keys
//   waiting, and why keys were not typed (the screen there changed, no reply, too fast).
//
// window.TnaiRemoteTyping: `paint(o)` for 116, `stop()`. Test: `remote-typing` (window test,
// written, not yet run). Look: src/styles/40-thread-history.css.
(() => {
  'use strict';
  const native = window.tnaiNative?.remote;

  // browser, or a build without the feature
  if (!native?.type || !native.typePaste) return;

  // The browser's key names → the key names the main process knows (remote-type.js KEYS).
  const NAMED = {
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
  };
  const IDLE_MS = 60 * 1000;

  // what 116 drew last: { bar, screen, pc, ag, pcName, model }
  let shown = null;

  // the typing mode: { pcId, agId, mark, screen } while on
  let mode = null,
    idleTimer = 0,
    note = '';
  let button = null;

  const call = async (name, ...args) => {
    const r = await native[name](...args);
    if (r && r.ok === false) throw r.error || {};
    return r && typeof r === 'object' && 'value' in r ? r.value : r;
  };

  // Plain words for what the main process said.
  function words(t, agName, pcName) {
    if (!t) return '';
    if (t.on) {
      const wait = t.waiting > 0 ? ' · ' + t.waiting + ' waiting' : '';
      return 'Typing into ' + agName + ' on ' + pcName + wait;
    }
    const said = {
      stale: 'Not typed: the screen there changed. Look, then type again.',
      changed: 'Not typed: ' + agName + ' changed or closed on ' + pcName + '.',
      refused: 'Not typed: ' + pcName + ' did not take it.',
      failed: 'Not typed: it could not be written on ' + pcName + '.',
      no_reply: 'No word back from ' + pcName + ', so typing stopped. Nothing more was sent.',
      too_much: 'Too fast: those keys were not sent. Wait a moment, then type again.',
      ended_unsent: 'Typing stopped. Keys that were waiting were not sent.',
      off: pcName + ' no longer lets this computer type.',
    };
    return said[t.said] || '';
  }

  function setNote(text) {
    note = text;
    const em = shown?.bar?.querySelector(':scope > em');
    if (em && em.textContent !== text) em.textContent = text;
  }

  // The mode ends: nothing more is sent, and the main process ends its round.
  function stop(why = '') {
    if (!mode) return;
    const screen = mode.screen;
    mode = null;
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (screen) {
      delete screen.dataset.typing;
      screen.closest('.ap-term')?.removeAttribute('data-typing');
    }
    Promise.resolve(call('typeEnd')).catch(() => {});
    if (why) setNote(why);
    draw();
  }

  const idle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop('Typing stopped after a minute without a key.'), IDLE_MS);
  };

  // What one press sends, or a reason it is not sent.
  function itemOf(e) {
    const ctrl = e.ctrlKey && !e.getModifierState?.('AltGraph');
    if (e.key === 'Tab' && e.shiftKey) return { not: 'Shift+Tab is not sent to another computer.' };
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C'))
      return { item: 'CtrlC' };
    if (ctrl || e.metaKey) return null;
    if (Object.hasOwn(NAMED, e.key)) return { item: NAMED[e.key] };
    if ([...e.key].length === 1) return { item: { x: e.key } };
    return null;
  }

  function send(items) {
    const m = mode;
    if (!m) return;
    idle();
    Promise.resolve(call('type', m.pcId, m.agId, m.mark, items))
      .then(r => afterSend(r && r.state))
      .catch(() => afterSend('not_typing'));
  }

  function afterSend(state) {
    if (!mode) return;
    if (state === 'changed') stop('Not typed: that thread changed on the other computer.');
    else if (state === 'not_typing')
      stop('Not typed: watching is not on, or that computer does not let this one type.');
    else if (state === 'too_long') setNote('Not sent: a paste can be at most 1,500 characters.');
  }

  function onKey(e) {
    if (!mode || e.currentTarget !== mode.screen || e.isComposing) return;
    const ctrl = e.ctrlKey && !e.getModifierState?.('AltGraph');

    // Ctrl+V: the paste event below sends it
    if (ctrl && (e.key === 'v' || e.key === 'V')) return;
    const r = itemOf(e);
    if (!r) {
      if (ctrl || e.metaKey) {
        e.preventDefault();
        setNote('Only Ctrl+C and Ctrl+V are sent to another computer.');
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (r.not) {
      setNote(r.not);
      return;
    }
    send([r.item]);
  }

  function onPaste(e) {
    if (!mode || e.currentTarget !== mode.screen) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const m = mode;
    idle();
    Promise.resolve(call('typePaste', m.pcId, m.agId, m.mark, text))
      .then(r => afterSend(r && r.state))
      .catch(() => afterSend('not_typing'));
  }

  function onLeave(e) {
    // focus moved within the picture's own box (the button itself is handled by its press)
    if (!mode || (e.relatedTarget && e.relatedTarget === button)) return;
    stop('Typing stopped when the picture lost focus.');
  }

  function start() {
    const o = shown;
    if (!o || !o.screen || !may(o)) return;
    mode = { pcId: o.pc.id, agId: o.ag.id, mark: o.ag.mark || '', screen: o.screen };
    if (!o.screen.dataset.tnaiTyping) {
      o.screen.dataset.tnaiTyping = '1';
      o.screen.addEventListener('keydown', onKey);
      o.screen.addEventListener('paste', onPaste);
      o.screen.addEventListener('focusout', onLeave);
    }
    o.screen.dataset.typing = '1';
    o.screen.closest('.ap-term')?.setAttribute('data-typing', '1');
    o.screen.focus({ preventScroll: true });
    idle();
    setNote('Typing into ' + o.ag.name + ' on ' + o.pcName + '. Keys go to that computer.');
    draw();
  }

  // May this computer type into what 116 shows now?
  const may = o =>
    !!o &&
    !!o.screen &&
    !!o.pc &&
    !!o.ag &&
    o.pc.canType === true &&
    o.ag.can === true &&
    !!o.ag.mark &&
    !!o.model &&
    o.model.state === 'on' &&
    o.model.peer === o.pc.id &&
    o.model.agent === o.ag.id;

  function draw() {
    const o = shown;
    if (!o || !o.bar) return;
    const ok = may(o);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ap-font';
      button.dataset.act = 'type';
      button.addEventListener('click', e => {
        e.stopPropagation();
        if (mode) stop('Typing stopped.');
        else start();
      });
    }
    if (button.parentElement !== o.bar) o.bar.append(button);
    button.hidden = !ok && !mode;
    const on = !!mode;
    const label = on ? 'Stop typing' : 'Type';
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute('aria-pressed', String(on));
    button.title = on
      ? 'Stop sending keys to ' + o.pcName
      : 'Type into ' + o.ag.name + ' on ' + o.pcName + ', as if you sat at that computer';
    const em = o.bar.querySelector(':scope > em');
    if (em && em.textContent !== note) em.textContent = note;
  }

  window.TnaiRemoteTyping = {
    // 116 drew the picture of another computer's thread: the button and the mode follow it.
    paint(o) {
      const before = shown;
      shown = o && o.bar ? o : null;

      // another thread, another picture, or the view is no longer live: the mode ends
      if (
        mode &&
        (!shown ||
          shown.pc?.id !== mode.pcId ||
          shown.ag?.id !== mode.agId ||
          (shown.ag?.mark || '') !== mode.mark ||
          shown.screen !== mode.screen ||
          !may(shown))
      )
        stop(
          shown && shown.model && shown.model.state !== 'on'
            ? 'Typing stopped: watching ended.'
            : ''
        );

      // what the main process says of typing, for this very agent
      const t =
        shown && shown.model && shown.model.agent === shown.ag?.id ? shown.model.typing : null;
      if (t && (t.on || t.said)) {
        const w = words(t, shown.ag.name, shown.pcName);
        if (w && (t.on || !before || t.at !== before.model?.typing?.at)) note = w;
      }
      if (!shown) note = '';
      draw();
    },
    stop: () => stop(''),
  };

  // the window went out of view: typing ends with the view
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('Typing stopped when the window was hidden.');
  });
})();
