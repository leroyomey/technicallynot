/*
 * Technically Not tools · desktop-check/tests/saved-lazy.after.js — After saved-lazy.js reloads
 * the window: the three saved sessions are reported as before but have no terminal built while
 * nothing shows them; Start builds one and resumes the conversation; opening a saved shell as
 * its thread shows its saved screen on the CLI screen; what TnaiAgents.sessions() says about
 * one is the same before and after. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
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
const G = window.TnaiAgents,
  N = window.tnaiNative;
const { ids = [], sessionId = '' } = JSON.parse(
  sessionStorage.getItem('tnai.test.saved-lazy') || '{}'
);
const [claude, ...shells] = ids;
const pane = id => document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]');
const of = id => G.sessions().find(s => s.paneId === id);
const built = id =>
  !!pane(id)?.querySelector('.xterm') ||
  G.views().some(v => v.paneId === id && v.where === 'Terminal page panel');

// A thread opened on its CLI screen, and the rows that screen holds (read from the terminal).
const threads = window.TnaiThreads,
  view = () => window.TnaiThreadView,
  island = threads.slot('main');
const showThread = async id => {
  threads.show(id);
  await until(() => view().shown() === id, 6000);
  if (view().mode() !== 'term') view().setMode('term');
  await until(() => view().shown() === id && view().term(), 8000);
};
const rows = id => {
  const term = view().shown() === id ? view().term() : null;
  if (!term) return '';
  const found = [];
  for (let y = 0; y < term.buffer.active.length; y++)
    found.push(term.buffer.active.getLine(y)?.translateToString(true) || '');
  return found.join('\n');
};
try {
  check(
    ids.length === 3 && !!(await until(() => ids.every(of), 15000)),
    'the three saved panels are in sessions() after the reload'
  );
  check(
    ids.every(id => pane(id) && !pane(id).offsetParent),
    'the panels underneath are not on screen'
  );
  await wait(1500); // anything that would build a terminal late has run
  check(
    ids.every(id => !built(id)),
    'no terminal was built for a hidden saved panel (' +
      ids.filter(built).length +
      ' of 3 built, ' +
      G.views().length +
      ' terminals in the app)'
  );
  check(
    ids.every(
      id => pane(id).classList.contains('tnai-live') && pane(id).dataset.status === of(id).status
    ),
    'each panel still shows as connected, with its status (' +
      ids.map(id => of(id).status).join(', ') +
      ')'
  );
  check(
    ids.every(id => of(id).saved === true && !of(id).running) &&
      of(claude).canResume === true &&
      shells.every(id => of(id).canResume === false),
    'saved, not running; the conversation can resume, the shells cannot'
  );
  check(
    of(claude).sessionId === sessionId && !!sessionId,
    'the saved conversation id is reported (' + of(claude).sessionId + ')'
  );
  const before = Object.fromEntries(ids.map(id => [id, JSON.stringify(of(id))]));
  for (const [i, id] of shells.entries())
    check(
      ((await N.pty.replay(id))?.buffer || '').includes('lazy-mark-' + (i + 1)),
      'shell ' + (i + 1) + ': its saved output is still on disk'
    );

  // Start (the Agents list, the composer and `tnai send` end in the same start) builds the terminal
  // of a hidden saved panel and resumes.
  await G.start(claude);
  check(
    !!(await until(
      async () =>
        ((await N.pty.replay(claude))?.buffer || '').includes(
          'FAKE-claude resumed=' + sessionId + ' .'
        ),
      15000
    )),
    'Start resumed the saved conversation (--resume ' + sessionId + ')'
  );
  check(
    built(claude) && of(claude).running === true,
    'the started panel has its terminal and runs'
  );
  check(
    shells.every(id => !built(id)),
    'the two panels still hidden have none'
  );

  // Shown: each saved shell, opened as its thread, gets a terminal on its CLI screen with its
  // saved screen and the line under it that says what it is.
  for (const [i, id] of shells.entries()) {
    await showThread(id);
    check(
      !!(await until(() => rows(id).includes('lazy-mark-' + (i + 1)), 10000)),
      'shell ' + (i + 1) + ': its thread shown, the CLI screen holds its saved screen'
    );
    const note = island.querySelector('.tnt-term-note');
    check(
      !!(await until(
        () =>
          (note && !note.hidden && /Saved screen/.test(note.textContent)) ||
          /Saved output from the last session|Technically Not closed while/.test(
            rows(id).replace(/\n/g, ' ')
          ),
        5000
      )),
      'shell ' +
        (i + 1) +
        ': the saved-screen line is under it ("' +
        (note?.textContent || '') +
        '")'
    );
    log.push(
      'info shell ' +
        (i + 1) +
        ': the panel underneath has ' +
        (built(id) ? 'a' : 'no') +
        ' terminal'
    );
    const now = JSON.stringify(of(id));
    if (
      !check(
        now === before[id],
        'shell ' + (i + 1) + ': sessions() says the same before and after its screen is shown'
      )
    )
      log.push('     before ' + before[id], '     after  ' + now);
  }
  await showThread(claude);
  check(
    !!(await until(() => rows(claude).includes('resumed=' + sessionId), 8000)),
    'the resumed thread shows its new run on its CLI screen'
  );
  await showThread(shells[0]);
  await until(() => rows(shells[0]).includes('lazy-mark-1'), 8000);
  G.stoppedInput(shells[0], '\r', view().term());
  check(
    !!(await until(() => of(shells[0])?.running === true, 15000)),
    'Enter on a shown saved screen starts it'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
for (const id of ids) G.stop(id);
await wait(500);
return { ok, log };
