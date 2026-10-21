// Technically Not · 167-add-phone.js — "Add a phone" on the Devices page: the dialog that shows the
// code for the phone to scan and takes the six digits the phone then shows (phone-protocol.md
// section 3). The rules are in desktop/phone-pair.js and the block "pairing a phone" of
// desktop/remote-link.js; this file only shows where the run stands and hands the typed digits
// over. It reuses the Devices page's dialog look (dv-scrim, dv-dlg, dv-code, dv-acts, dv-btn).
// Opened only by a press on this computer: nothing from another device can open it.
(() => {
  const native = window.tnaiNative?.remote;

  // the open dialog and where the run stands: { box, opener, off, state, note }
  let open = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (label, cls, onClick) => {
    const b = el('button', 'dv-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  };

  // The main process answers every remote call as { ok, value } (remote-service.js `handle`): the
  // run's own answer is the value, null when the call itself failed.
  const valueOf = answer =>
    answer && answer.ok === true && answer.value && typeof answer.value === 'object'
      ? answer.value
      : null;

  // Why a run ended, as the dialog says it.
  const ENDED = {
    expired: 'The two minutes ran out. Nothing was paired.',
    locked: 'Three wrong codes. Adding a phone is stopped for ten minutes.',
    cancelled: 'Stopped. Nothing was paired.',
    out_of_order: 'The phone sent something out of turn, so pairing stopped. Nothing was paired.',
    handshake: 'The secure connection with the phone could not be made. Nothing was paired.',
    no_answer: 'The phone did not answer after the digits. Nothing was paired here; scan again.',
    already_paired:
      'This computer already knows that phone with another key. Forget it here first, then add it again.',
    not_stored: 'This computer could not save the phone. Nothing was paired.',
    not_ready: 'Several computers is not ready here. Turn it on first.',
  };

  // The code as a picture: one path of dark squares on white, drawn from the rows the main process
  // made (desktop/phone-qr.js). No text of the code is put in the page.
  function codePicture({ size, rows }) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    const side = size + 8;
    svg.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
    svg.setAttribute('width', '232');
    svg.setAttribute('height', '232');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Code for the phone to scan');
    svg.style.display = 'block';
    svg.style.margin = '4px auto';
    svg.style.borderRadius = '10px';
    const back = document.createElementNS(ns, 'rect');
    back.setAttribute('width', String(side));
    back.setAttribute('height', String(side));
    back.setAttribute('fill', '#fff');
    let d = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] === '1') d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
    });
    const dark = document.createElementNS(ns, 'path');
    dark.setAttribute('d', d);
    dark.setAttribute('fill', '#000');
    svg.append(back, dark);
    return svg;
  }

  // Six boxes for the digits, as the computer pairing dialog has them.
  function digitsInput(onFull) {
    const box = el('div', 'dv-code');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Six digits shown on the phone');
    for (let i = 0; i < 6; i++) {
      const inp = el('input');
      inp.inputMode = 'numeric';
      inp.maxLength = 1;
      inp.autocomplete = 'off';
      inp.setAttribute('aria-label', 'Digit ' + (i + 1));
      box.append(inp);
    }
    const all = [...box.children];
    const value = () => all.map(x => x.value).join('');
    box.oninput = e => {
      e.target.value = e.target.value.replace(/\D/g, '');
      if (e.target.value) e.target.nextElementSibling?.focus();
      if (value().length === 6) onFull(value());
    };
    box.onkeydown = e => {
      if (e.key === 'Backspace' && !e.target.value) e.target.previousElementSibling?.focus();
    };
    return box;
  }

  async function typed(code) {
    let r = null;
    try {
      r = valueOf(await native.phoneEnter(code));
    } catch {
      r = null;
    }
    if (!open) return;
    if (r && r.ok === false && r.left != null)
      open.note =
        'Those digits are not the ones the phone shows. ' +
        r.left +
        (r.left === 1 ? ' try' : ' tries') +
        ' left.';
    else open.note = '';
    paint(true);
  }

  // What the dialog shows for the run's state (state().phonePair, pushed by the main process).
  function paint(force) {
    if (!open) return;
    const s = open.state || { state: 'wait' };
    const key = s.state + '|' + (s.reason || '') + '|' + open.note;
    if (!force && key === open.key) return;
    open.key = key;
    const box = el('div', 'dv-dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'dvPhoneTitle');
    const title = el('h2', '', 'Add a phone');
    title.id = 'dvPhoneTitle';
    const acts = el('div', 'dv-acts');
    box.append(title);
    if (s.state === 'wait' && open.code) {
      box.append(
        el(
          'p',
          '',
          'On the phone, open Technically Not, then Computers, Scan a code. The code works once, for two minutes.'
        ),
        codePicture(open.code)
      );
    } else if (s.state === 'hs') {
      box.append(el('p', '', 'Phone found. Making the secure connection…'));
    } else if (s.state === 'enter') {
      box.append(el('p', '', 'Type the six digits the phone shows.'), digitsInput(typed));
      if (open.note) box.append(el('p', 'dv-hint dv-warn', open.note));
    } else if (s.state === 'confirming') {
      box.append(el('p', '', 'Digits right. Waiting for the phone to answer…'));
    } else if (s.state === 'done') {
      box.append(
        el(
          'p',
          '',
          'Phone added. It is listed with your computers; it sees what you allow there, and full control is its own switch, off until you turn it on.'
        )
      );
      acts.append(btn('Done', 'dv-pri', close));
    } else {
      box.append(el('p', '', ENDED[s.reason] || 'Pairing stopped. Nothing was paired.'));
      acts.append(btn('Close', 'dv-pri', close));
    }
    if (s.state !== 'done' && s.state !== 'ended') acts.append(btn('Cancel', '', close));
    box.append(acts);
    open.box.replaceChildren(box);
    (
      box.querySelector('input') ||
      box.querySelector('.dv-pri') ||
      box.querySelector('button')
    )?.focus({
      preventScroll: true,
    });
  }

  function close() {
    if (!open) return;
    const was = open;
    open = null;
    try {
      was.off?.();
    } catch {
      /* the listener was already gone */
    }

    // ends a run still under way, and lets the main process forget how the last one ended
    native.phoneCancel?.().catch(() => {});
    was.box.remove();
    if (was.opener?.isConnected) was.opener.focus({ preventScroll: true });
  }

  async function start(opener) {
    if (open || !native?.phonePair) return;
    const scrim = el('div', 'dv-scrim');
    scrim.onkeydown = e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.body.append(scrim);
    open = {
      box: scrim,
      opener,
      off: null,
      state: { state: 'wait' },
      note: '',
      code: null,
      key: '',
    };
    const mine = open;
    let r = null;
    try {
      r = valueOf(await native.phonePair());
    } catch {
      r = null;
    }
    if (open !== mine) return;
    if (!r || !r.code) {
      mine.state = { state: 'ended', reason: (r && r.ended) || 'not_ready' };
      return paint(true);
    }
    mine.code = r.code;

    // The main process pushes the whole remote state on every change; only the phone run is read.
    mine.off = native.on?.(st => {
      if (open !== mine || !st) return;
      const p = st.phonePair;
      if (p) mine.state = p;
      else if (mine.state.state !== 'wait') mine.state = { state: 'ended', reason: 'cancelled' };
      paint();
    });
    paint(true);
  }

  window.TnaiAddPhone = { open: start };
})();
