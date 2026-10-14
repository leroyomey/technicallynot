// Technically Not tools · desktop-check/tests/shot-notes.js — Per-attachment prompts
// (68-shot-notes.js): "@1" + Space opens a card tinted in attachment 1's colour, Enter saves and
// returns the caret to the composer, the chip shows the note; "@2" gets a different colour and
// saves on click-away; saving takes "@N" out of the draft; Esc cancels and keeps it; saving a note
// empty drops it; apply() + TnaiShotRefs.organize put each note under its own screenshot while the
// rest stays general. Sends nothing. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const A = window.TnaiAttachments,
  S = window.TnaiShotNotes,
  prompt = document.getElementById('prompt');
try {
  check(!!A && !!S, 'TnaiAttachments and TnaiShotNotes loaded');
  const png = color => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 40, 30);
    return new Promise(r => c.toBlob(r, 'image/png'));
  };
  A.clear();
  prompt.value = '';
  prompt.dispatchEvent(new Event('input'));
  A.add([
    new File([await png('#294c3d')], 'a.png', { type: 'image/png' }),
    new File([await png('#c97568')], 'b.png', { type: 'image/png' }),
  ]);
  await wait(150);
  const card = () => document.querySelector('.tnai-shot-note');
  const type = async s => {
    prompt.focus();
    for (const ch of s) {
      const c = prompt.selectionStart;
      prompt.value = prompt.value.slice(0, c) + ch + prompt.value.slice(c);
      prompt.setSelectionRange(c + 1, c + 1);
      prompt.dispatchEvent(
        new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true })
      );
    }
    await wait(60);
  };
  const key = (el, k) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  await type('fix the header @1');
  check(!card(), 'no card before the space');
  await type(' ');
  check(
    !!card() &&
      card().dataset.tint === 'sky' &&
      document.activeElement === card().querySelector('textarea'),
    '"@1 " opens a sky-tinted card with focus in it'
  );
  card().querySelector('textarea').value = 'make the button blue';
  key(card().querySelector('textarea'), 'Enter');
  await wait(60);
  const chip1 = document.querySelectorAll('#attachmentList .attachment-chip')[0];
  check(
    !card() && document.activeElement === prompt && prompt.selectionStart === prompt.value.length,
    'Enter saves, caret back at the end of the composer'
  );
  check(
    prompt.value === 'fix the header ',
    'saving takes "@1" out of the draft: ' + JSON.stringify(prompt.value)
  );
  check(
    chip1.classList.contains('has-note') &&
      /make the button blue/.test(chip1.querySelector('.shot-note-pill')?.textContent || ''),
    'chip 1 shows the note'
  );

  await type('and tidy spacing @2 ');
  check(
    !!card() && card().dataset.tint === 'plum',
    '"@2 " opens a card in a different colour (plum)'
  );
  const noteBox = card().querySelector('textarea');
  noteBox.value = 'remove this banner';
  prompt.focus();

  // A test window that is not the active one moves the caret without telling the box it left:
  // the event a real click away brings is sent by hand then.
  if (!document.hasFocus()) noteBox.dispatchEvent(new FocusEvent('blur'));
  await wait(60);
  check(!card() && S.notes().size === 2, 'clicking away saves the second note');

  await type(' @2 ');
  card().querySelector('textarea').value = 'changed my mind';
  key(card().querySelector('textarea'), 'Escape');
  await wait(60);
  check(
    !card() && [...S.notes().values()].includes('remove this banner'),
    'Esc cancels without changing the note'
  );
  prompt.value = prompt.value.replace(/ @2 $/, '');
  prompt.dispatchEvent(
    new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true })
  );

  const items = A.list().map(a => ({ id: a.id }));
  const applied = S.apply(prompt.value, items);
  check(
    applied === 'fix the header and tidy spacing\n@1 make the button blue\n@2 remove this banner',
    'apply(): ' + JSON.stringify(applied)
  );
  const organized = window.TnaiShotRefs.organize(applied, [
    { n: 1, ref: '[Attached image: A]', image: true },
    { n: 2, ref: '[Attached image: B]', image: true },
  ]);
  check(
    organized ===
      'fix the header and tidy spacing\n\nScreenshot 1 — [Attached image: A]\nmake the button blue\n\nScreenshot 2 — [Attached image: B]\nremove this banner',
    'organized prompt: ' + JSON.stringify(organized)
  );

  // Sending: the chips leave the composer at once (27 beginSend), and dispatch reads the notes only
  // after saving the files. The notes must survive that wait (a failed send brings them back on the
  // chips); a sent attachment's note goes after the send.
  const snap = A.beginSend();
  await wait(60);
  check(
    S.apply('fix the header', snap.items) ===
      'fix the header\n@1 make the button blue\n@2 remove this banner',
    'notes survive the chips leaving at send: ' +
      JSON.stringify(S.apply('fix the header', snap.items))
  );
  snap.restore();
  await wait(60);
  check(
    S.notes().size === 2 &&
      document.querySelectorAll('#attachmentList .attachment-chip.has-note').length === 2,
    'a failed send puts the chips back with their notes'
  );
  S.open(1);
  await wait(30);
  card().querySelector('textarea').value = '';
  key(card().querySelector('textarea'), 'Enter');
  await wait(60);
  check(
    S.notes().size === 1 &&
      !document
        .querySelectorAll('#attachmentList .attachment-chip')[0]
        .classList.contains('has-note'),
    'saving note 1 empty drops it and the chip pill'
  );

  // Nested: "@1 " typed inside note 2 stacks card 1 on top in its own colour; Enter there returns
  // to note 2, which keeps "@1" as a pointer.
  S.open(2);
  await wait(30);
  const ta2 = card().querySelector('textarea');
  ta2.value = '';
  ta2.focus();
  for (const ch of 'agents stuck, refer to @1 ') {
    const c = ta2.selectionStart;
    ta2.value = ta2.value.slice(0, c) + ch + ta2.value.slice(c);
    ta2.setSelectionRange(c + 1, c + 1);
    ta2.dispatchEvent(
      new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true })
    );
  }
  await wait(60);
  const cards = [...document.querySelectorAll('.tnai-shot-note')];
  check(
    cards.length === 2 &&
      cards[1].dataset.tint === 'sky' &&
      cards[0].dataset.tint === 'plum' &&
      document.activeElement === cards[1].querySelector('textarea'),
    '"@1 " inside note 2 stacks a sky card on the plum one, focused'
  );
  check(
    cards[1].getBoundingClientRect().bottom <= cards[0].getBoundingClientRect().top + 1,
    'the stacked card sits above the note it came from'
  );
  cards[1].querySelector('textarea').value = 'the stuck row';
  key(cards[1].querySelector('textarea'), 'Enter');
  await wait(60);
  check(
    document.querySelectorAll('.tnai-shot-note').length === 1 &&
      document.activeElement === ta2 &&
      ta2.value === 'agents stuck, refer to @1 ',
    'Enter in the stacked card returns to note 2 with "@1" kept'
  );
  ta2.value += 'if needed';
  key(ta2, 'Enter');
  await wait(60);
  const kinds = A.list().map(a => ({ id: a.id, kind: a.kind }));
  const nestedOut = S.apply('fix it', kinds);
  check(
    nestedOut === 'fix it\n@1 the stuck row\n@2 agents stuck, refer to Screenshot 1 if needed',
    'apply() sends the pointer as "Screenshot 1": ' + JSON.stringify(nestedOut)
  );
  const org2 = window.TnaiShotRefs.organize(nestedOut, [
    { n: 1, ref: '[A]', image: true },
    { n: 2, ref: '[B]', image: true },
  ]);
  check(
    /Screenshot 2 — \[B\]\nagents stuck, refer to Screenshot 1 if needed$/.test(org2),
    'organize keeps note 2 whole: ' + JSON.stringify(org2)
  );
  A.add([new File([await png('#888')], 'c.png', { type: 'image/png' })]);
  await wait(100);
  S.open(3);
  await wait(30);
  card().querySelector('textarea').value = 'see @2 too';
  key(card().querySelector('textarea'), 'Enter');
  await wait(60);
  A.remove(A.list()[0].id);
  await wait(100);
  check(
    [...S.notes().values()].includes('see @1 too') &&
      [...S.notes().values()].includes('agents stuck, refer to (removed attachment) if needed'),
    'removing chip 1 renumbers pointers inside notes: ' + JSON.stringify([...S.notes().values()])
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
A?.clear();
prompt.value = '';
prompt.dispatchEvent(new Event('input'));
return { ok, log };
