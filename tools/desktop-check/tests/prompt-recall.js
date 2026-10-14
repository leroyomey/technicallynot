/*
 * Technically Not tools · desktop-check/tests/prompt-recall.js — Prompt recall and park in the
 * composer (src/scripts/114-prompt-recall.js). Keys are real KeyboardEvents on the composer; "sent"
 * is told the way 11 tells it. prompt-recall.after.js checks both lists after a reload. Run:
 * .\tools\desktop-check\check.ps1 -Test prompt-recall
 */
const log = [],
  t = (name, pass, extra) => {
    log.push((pass ? 'ok   ' : 'FAIL ') + name + (extra ? ' · ' + extra : ''));
    return pass;
  };
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(800);
const box = document.getElementById('prompt'),
  R = window.TnaiPromptRecall;
if (!box || !R) return { ok: false, log: ['no composer or no TnaiPromptRecall'] };
const key = (k, extra = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  box.dispatchEvent(e);
  return e.defaultPrevented;
};
const type = text => {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const S = { ctrlKey: true };
localStorage.removeItem('tnai.prompt-recall.v1');
localStorage.removeItem('tnai.prompt-park.v1');

type('');
t('Arrow Up with nothing sent is left alone', key('ArrowUp') === false && box.value === '');
R.sent('first');
R.sent('second\nline two');
R.sent('third');
R.sent('   ');
R.sent('x'.repeat(20001));
t('three kept, blank and over-long left out', R.list().length === 3);
type('draft');
t('Arrow Up in a box with text is left alone', key('ArrowUp') === false && box.value === 'draft');
type('');
t('Arrow Up shows the newest', key('ArrowUp') === true && box.value === 'third', box.value);
key('ArrowUp');
t('again, the one before (two lines)', box.value === 'second\nline two');
key('ArrowUp');
key('ArrowUp');
t('stops at the oldest', box.value === 'first');
key('ArrowDown');
key('ArrowDown');
t('Arrow Down goes forward', box.value === 'third');
key('ArrowDown');
t('past the newest, the box is empty', box.value === '');
key('ArrowUp');
key('ArrowLeft');
t(
  'another key makes it a draft: Arrow Up is left alone',
  key('ArrowUp') === false && box.value === 'third'
);
type('');
key('ArrowUp');
type('third and more');
t('typing makes it a draft', key('ArrowDown') === false && box.value === 'third and more');
type('');
R.sent('first');
key('ArrowUp');
t(
  'a prompt sent again moves to the newest place',
  box.value === 'first' && R.list().join('|') === 'second\nline two|third|first'
);
type('');

t(
  'Ctrl+S in an empty box with nothing parked changes nothing',
  key('s', S) === true && box.value === '' && R.parked().length === 0
);
type('parked one');
key('s', S);
t(
  'Ctrl+S parks the draft and empties the box',
  box.value === '' && R.parked().join('|') === 'parked one'
);
await wait(450);
t('the kept draft (16) is gone too', !localStorage.getItem('tnai.draft.composer.v1'));
type('second park');
key('s', S);
type('');
key('s', S);
t(
  'the newest parked one comes back first',
  box.value === 'second park' && R.parked().join('|') === 'parked one'
);
type('');
const A = window.TnaiAttachments;
A.add([new File(['hello'], 'note.txt', { type: 'text/plain' })]);
await wait(300);
const had = A.count();
type('with a file');
key('s', S);
const hidden = A.count();
type('');
key('s', S);
t(
  'attachment chips are parked and come back with the text',
  had > 0 && hidden === 0 && A.count() === had && box.value === 'with a file',
  'had ' + had + ', parked ' + hidden + ', back ' + A.count()
);
A.clear();
type('');
for (let i = 0; i < 6; i++) {
  type('p' + i);
  key('s', S);
}
t(
  'a sixth park is refused and the text stays in the box',
  R.parked().length === 5 && box.value === 'p5'
);
type('');
for (let i = 0; i < 4; i++) {
  key('s', S);
  type('');
}
t(
  'left for the reload: one parked prompt and three sent',
  R.parked().join('|') === 'parked one' && R.list().length === 3
);
return { ok: log.every(l => l.startsWith('ok')), log, reload: true };
