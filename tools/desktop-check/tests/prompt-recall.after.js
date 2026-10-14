// Technically Not tools · desktop-check/tests/prompt-recall.after.js — After a reload: the sent
// prompts and the parked text prompt-recall.js left are still there.
const log = [],
  t = (name, pass, extra) => {
    log.push((pass ? 'ok   ' : 'FAIL ') + name + (extra ? ' · ' + extra : ''));
    return pass;
  };
await new Promise(r => setTimeout(r, 800));
const box = document.getElementById('prompt'),
  R = window.TnaiPromptRecall;
const key = (k, extra = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
  box.dispatchEvent(e);
  return e.defaultPrevented;
};
const type = text => {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
t(
  'sent prompts kept across the reload',
  R.list().join('|') === 'second\nline two|third|first',
  R.list().join('|')
);
t('parked text kept across the reload', R.parked().join('|') === 'parked one');
type('');
key('ArrowUp');
t('Arrow Up still shows the newest', box.value === 'first');
type('');
key('s', { ctrlKey: true });
t('Ctrl+S brings the parked prompt back', box.value === 'parked one' && R.parked().length === 0);
type('');
localStorage.removeItem('tnai.prompt-recall.v1');
localStorage.removeItem('tnai.prompt-park.v1');
return { ok: log.every(l => l.startsWith('ok')), log };
