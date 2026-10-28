// Technically Not tools · desktop-check/tests/persistence.after.js — Runs after persistence.js
// reloads the window: the stopped thread's saved output (on its CLI screen) and the composer draft
// come back. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const paneId = sessionStorage.getItem('tnai.test.pane');

// The draft is the open thread's (16, since 2026-10-22): it comes into the box once 120 says which
// thread is open after the reload, a moment after the page loads, so this waits for it as the
// checks below do (learned 2026-10-28: the 0.3.76 release run checked at once and failed). Should
// another thread open first, the draft waits with its own thread, where the thread list shows it.
const DRAFT = 'draft that must survive';
const draftBack = await until(() => {
  if (document.getElementById('prompt')?.value === DRAFT) return 'in the prompt box';
  let owners = [];
  try {
    const stored = JSON.parse(localStorage.getItem('tnai.draft.threads.v1') || '{}');
    owners = Object.keys(stored).filter(owner => stored[owner] === DRAFT);
  } catch {}
  const shown = owners.find(owner => window.TnaiDrafts?.of?.(owner) === DRAFT);
  return shown ? 'kept with its thread, which is not the open one' : null;
}, 8000);
check(!!draftBack, 'composer draft restored after reload (' + (draftBack || 'lost') + ')');

// The stopped shell is back as a thread, restored from its saved record: its CLI screen shows the
// old output as a saved screen with the line that says what Enter does, and nothing auto-started.
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;
check(
  !!(await until(() => window.TnaiThreadList?.thread?.(paneId), 8000)),
  'the stopped shell has its row in the thread list after reload'
);
threads.show(paneId);
await until(() => view().shown() === paneId, 6000);
if (view().mode() !== 'term') view().setMode('term');
const island = threads.slot('main');
const text = () => {
  const term = view().term();
  if (!term || view().shown() !== paneId) return '';
  const rows = [];
  for (let y = 0; y < term.buffer.active.length; y++)
    rows.push(term.buffer.active.getLine(y)?.translateToString(true) || '');
  return rows.join(' ');
};
check(
  !!(await until(() => /AFTER10/.test(text()), 8000)),
  'saved output shown on the thread CLI screen after reload'
);
const note = island.querySelector('.tnt-term-note');
const offer = () => (note && !note.hidden ? note.textContent : '') + ' ' + text();
check(
  !!(await until(() => /press\s*Enter\s*(\(or\s*just\s*Enter\)\s*)?to\s/i.test(offer()), 4000)),
  'the thread offers Enter to redraw, resume or start: "' + (note?.textContent || '') + '"'
);
check(
  !(await window.tnaiNative.pty.list()).some(s => s.paneId === paneId && s.running),
  'saved session not auto-started'
);
console.log('TNAI_SHOT:persistence-pane');
await wait(400);

console.log('TNAI_SHOT:persistence-draft');
await wait(400);
return { ok, log };
