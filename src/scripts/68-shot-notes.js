/*
 * Technically Not · 68-shot-notes.js — Desktop only: a prompt inside the prompt for each
 * attachment. Typing "@N" then Space in the composer (or picking "@N" in the @ picker, 50) opens a
 * small card above the composer, tinted in that attachment's own colour, for the instructions that
 * apply to attachment N only. Enter (or clicking away) saves it and puts the caret back after "@N "
 * in the composer; Shift+Enter is a new line; Esc cancels. Saving takes the "@N " that opened the
 * card back out of the draft, so the note lives only on that attachment's chip, in the same colour
 * (click it to edit; saving it empty drops it; removing the chip drops it). Notes are keyed by
 * attachment id, so they follow the chips when they renumber. On send (11 dispatch) apply() removes
 * any leftover "@N" of a noted attachment from the general text and appends "@N <note>", so 27
 * TnaiShotRefs.organize puts every note under its own screenshot. Notes nest: "@M" + Space inside a
 * note stacks M's card on top (its own colour, stepped right); Enter/Esc there go back to the note
 * below, "@M" stays in that note as a pointer and is sent as "Screenshot M". window.TnaiShotNotes =
 * { apply, open, notes }
 */
(() => {
  const prompt = document.getElementById('prompt'),
    list = document.getElementById('attachmentList'),
    box = document.querySelector('.composebox');
  const files = () => window.TnaiAttachments;

  // browser mode: attachments are off (27)
  if (!window.tnaiNative?.attachments || !prompt || !list || !box) return;

  const PALETTE = ['sky', 'plum', 'amber', 'teal', 'rose', 'clay', 'slate', 'sage'];
  const tint = n => PALETTE[(n - 1) % PALETTE.length];
  const notes = new Map(); // attachment id → note text
  let ids = []; // chip ids in order at the last decorate(), to see which number a removed chip had
  const byN = n =>
    files()
      ?.list()
      .find(a => a.n === n);

  const style = document.createElement('style');
  style.textContent = `
.tnai-shot-note{position:fixed;z-index:62;width:min(460px,calc(100vw - 32px));display:grid;gap:7px;padding:10px 11px 11px;border-radius:9px;background:var(--sb);border:1px solid color-mix(in srgb,var(--sf) 30%,transparent);border-left:3px solid var(--sf);box-shadow:0 10px 35px #20211f1c}
.tnai-shot-note header{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--sf)}
.tnai-shot-note header img{width:28px;height:28px;object-fit:cover;border-radius:4px;background:#fff;box-shadow:0 0 0 1px color-mix(in srgb,var(--sf) 25%,transparent)}
.tnai-shot-note header b{font-weight:650}.tnai-shot-note header small{margin-left:auto;color:color-mix(in srgb,var(--sf) 75%,#858780);font-size:10px}
.tnai-shot-note textarea{resize:none;width:100%;min-height:34px;max-height:120px;border:1px solid color-mix(in srgb,var(--sf) 25%,transparent);border-radius:7px;background:#fff;padding:8px 9px;font:13px/1.45 inherit;font-family:inherit;color:#343630;outline:0}
.tnai-shot-note textarea:focus{border-color:color-mix(in srgb,var(--sf) 60%,transparent)}
.composebox .attachment-chip[data-tint] .attachment-num{color:var(--sf)}
.composebox .attachment-chip.has-note{border-color:color-mix(in srgb,var(--sf) 40%,transparent);background:var(--sb)}
.attachment-chip .shot-note-pill{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;border-radius:4px;background:#fff;color:var(--sf);font:inherit;font-size:10px;padding:3px 6px;cursor:pointer}
.attachment-chip .shot-note-pill:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--sf) 40%,transparent)}`;
  document.head.append(style);

  const setTint = (el, n) => {
    const t = tint(n);
    el.dataset.tint = t;
    el.style.setProperty('--sf', `var(--ac-${t}-fg)`);
    el.style.setProperty('--sb', `var(--ac-${t}-bg)`);
  };

  // Chips: 27 render() rebuilds them, so decorate after every change (colour per number, saved note
  // as a pill).
  function decorate() {
    const all = files()?.list() || [];

    // Chip removed → its note goes too. A chip hidden because it is being sent (27 beginSend) keeps
    // its note: dispatch reads it after saving the attachments, and a failed send puts the chip
    // back with it (dropping it here sent "(no instructions)", 2026-09-27).
    for (const id of notes.keys())
      if (!all.some(a => a.id === id) && !files()?.sending?.(id)) notes.delete(id);

    // A removed chip renumbers the others: "@N" pointers inside notes follow them like the draft's
    // do (27 remove).
    ids
      .map((id, i) => [id, i + 1])
      .filter(([id]) => !all.some(a => a.id === id) && !files()?.sending?.(id))
      .reverse()
      .forEach(([, at]) => {
        for (const [id, v] of notes) notes.set(id, window.TnaiShotRefs?.renumber(v, at) ?? v);
      });
    ids = all.map(a => a.id);
    list.querySelectorAll('.attachment-chip').forEach(chip => {
      const a = all.find(x => x.id === chip.dataset.id);
      if (!a) return;
      setTint(chip, a.n);
      const note = notes.get(a.id);
      chip.classList.toggle('has-note', !!note);
      let pill = chip.querySelector('.shot-note-pill');
      if (!note) {
        pill?.remove();
        return;
      }
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'shot-note-pill';
        pill.addEventListener('click', e => {
          e.stopPropagation();
          const cur = files()
            ?.list()
            .find(x => x.id === chip.dataset.id);
          if (cur) open(cur.n);
        });
        chip.querySelector('.attachment-remove')?.before(pill) ?? chip.append(pill);
      }
      pill.textContent = '✎ ' + note;
      pill.title = '@' + a.n + ' instructions: ' + note + '\n(click to edit)';
    });
  }
  new MutationObserver(() => {
    if (!decorating) {
      decorating = true;
      queueMicrotask(() => {
        decorate();
        decorating = false;
      });
    }
  }).observe(list, { childList: true });
  let decorating = false;

  // Cards stack: "@M " typed inside a note opens M's card on top of it (each in its own
  // attachment's colour), so one prompt can hold notes that point at other attachments ("…refer to
  // @3"). stack[0] came from the composer; the top card has the focus.
  const stack = [];
  const top = () => stack[stack.length - 1];

  function close(save, refocus = true) {
    const card = stack.pop();
    if (!card) return;
    const { el, id, n, caret, from } = card;
    const field = from || prompt;
    let c = Math.min(caret, field.value.length);
    if (save) {
      const v = el.querySelector('textarea').value.trim();
      if (v) {
        notes.set(id, v);

        // The "@N " that opened this card from the composer has done its job: the note shows on the
        // chip, so the draft doesn't keep the tag. Inside a note it stays: there "@3" is a pointer
        // ("refer to @3"), sent as "Screenshot 3" (apply below).
        const m = !from && new RegExp('(^|\\s)@' + n + ' ?$').exec(prompt.value.slice(0, c));
        if (m) {
          const start = m.index + m[1].length;
          prompt.value = prompt.value.slice(0, start) + prompt.value.slice(c);
          c = start;
        }
      } else notes.delete(id);
    }
    el.remove();
    decorate();
    if (refocus) {
      field.focus();
      field.setSelectionRange(c, c);
    }
  }
  const closeAll = save => {
    while (stack.length) close(save, stack.length === 1);
  };

  function open(n, from = null) {
    const a = byN(n);
    if (!a) return false;
    const already = stack.findIndex(k => k.id === a.id);
    if (already >= 0) {
      while (stack.length > already + 1) close(true, false);
      const t = top().el.querySelector('textarea');
      t.focus();
      return true;
    }
    if (!from) closeAll(true);
    const parent = from && top();
    const el = document.createElement('section');
    el.className = 'tnai-shot-note';
    el.setAttribute('aria-label', 'Instructions for attachment ' + n);
    setTint(el, n);
    el.style.zIndex = 62 + stack.length;
    const thumb = list.querySelector(`.attachment-chip[data-id="${CSS.escape(a.id)}"] img`)?.src;
    el.innerHTML = `<header>${thumb ? '<img alt="">' : ''}<b></b><small>Enter to save · Esc to cancel</small></header><textarea rows="1" spellcheck="true"></textarea>`;
    if (thumb) el.querySelector('img').src = thumb;
    el.querySelector('b').textContent =
      '@' + n + ' · ' + a.label + (parent ? ' · in @' + parent.n : '');
    const ta = el.querySelector('textarea');
    ta.placeholder =
      a.kind === 'image'
        ? 'What should change in this screenshot?'
        : 'What should be done with this file?';
    ta.value = notes.get(a.id) || '';
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(120, ta.scrollHeight + 2) + 'px';
      place();
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('input', e => nested(e, ta, n));
    ta.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      }
    });

    // Clicking back into a lower card saves and closes the ones stacked on it.
    el.addEventListener('focusin', () => {
      const i = stack.findIndex(k => k.el === el);
      while (i >= 0 && stack.length > i + 1) close(true, false);
    });

    // Voice (70) into this note: letting go of the voice key or mic is not the end of the note;
    // only Enter / Esc / a later click away close it. Focus moving to another card of the stack is
    // not "away".
    ta.addEventListener('blur', () =>
      setTimeout(() => {
        if (
          !stack.some(k => k.el === el) ||
          document.activeElement?.closest?.('.tnai-shot-note') ||
          stack.some(k => k.el.querySelector('textarea').classList.contains('tnai-voice-target'))
        )
          return;
        closeAll(true);
      }, 0)
    );
    document.body.append(el);
    stack.push({
      el,
      id: a.id,
      n,
      from,
      caret: (from || prompt).selectionStart ?? (from || prompt).value.length,
      place,
    });

    // Each card sits above the one it came from, stepped right so the colours of the stack stay
    // visible.
    function place() {
      const i = stack.findIndex(k => k.el === el),
        below = i > 0 ? stack[i - 1].el.getBoundingClientRect() : null,
        r = box.getBoundingClientRect();
      const left = Math.max(16, Math.min(r.left + 40 + i * 18, innerWidth - el.offsetWidth - 16));
      el.style.left = left + 'px';
      el.style.top = Math.max(8, (below ? below.top : r.top) - el.offsetHeight - 8) + 'px';
      stack[i + 1]?.place();
    }
    grow();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return true;
  }
  const REF_TYPED = /(^|[\s(\[{"'“‘,;])@(\d{1,2}) $/;

  // "@M" + Space typed in a note opens M's card on top (not the note's own number).
  function nested(event, ta, own) {
    if (event.inputType !== 'insertText' || event.data !== ' ') return;
    const m = REF_TYPED.exec(ta.value.slice(0, ta.selectionStart));
    if (m && +m[2] !== own && byN(+m[2])) setTimeout(() => open(+m[2], ta), 0);
  }

  // "@N" + Space typed in the composer opens that attachment's card.
  prompt.addEventListener('input', event => {
    if (event.inputType !== 'insertText' || event.data !== ' ') return;
    const c = prompt.selectionStart,
      m = REF_TYPED.exec(prompt.value.slice(0, c));

    // after 50's picker has reacted to the same keystroke
    if (m && byN(+m[2])) setTimeout(() => open(+m[2]), 0);
  });
  addEventListener('resize', () => stack[0]?.place());

  // Send (11): noted "@N" leave the general text and come back at the end as "@N <note>", in chip
  // order.
  function apply(text, items) {
    text = String(text || '');
    items = items || [];

    // "@M" inside a note is a pointer, not a new section: it goes out as "Screenshot M" /
    // "Attachment M" (organize's own headings), so organize doesn't cut the note in two at it.
    const word = m => (items[m - 1]?.kind === 'image' ? 'Screenshot ' : 'Attachment ') + m;
    const inner = note =>
      (window.TnaiShotRefs?.tokens(note) || [])
        .reverse()
        .reduce(
          (s, t) => (t.n <= items.length ? s.slice(0, t.start) + word(t.n) + s.slice(t.end) : s),
          note
        );
    const noted = items
      .map((it, i) => ({ n: i + 1, note: notes.get(it.id) }))
      .filter(x => x.note)
      .map(x => ({ ...x, note: inner(x.note) }));
    if (!noted.length) return text;
    const drop = new Set(noted.map(x => x.n));
    let out = text;
    (window.TnaiShotRefs?.tokens(out) || []).reverse().forEach(t => {
      if (drop.has(t.n)) out = out.slice(0, t.start) + out.slice(t.end);
    });
    out = out.replace(/[ \t]{2,}/g, ' ').trim();
    return out + noted.map(x => '\n@' + x.n + ' ' + x.note).join('');
  }
  window.TnaiShotNotes = { apply, open, notes: () => new Map(notes) };
})();
