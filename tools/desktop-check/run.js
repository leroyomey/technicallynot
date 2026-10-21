// Technically Not tools · desktop-check/run.js — Loaded by desktop/main.js only when TNAI_SELFTEST
// is set: isolated profile + seeded project folder, runs a renderer test, prints its log, saves a
// screenshot, exits.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

// The runner reads this process's output through pipes; a failed write there (EAGAIN/EPIPE while
// check.js is busy or gone) must not become an uncaught exception with a native error dialog on the
// user's screen.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});

const testFile = path.resolve(__dirname, 'tests', process.env.TNAI_SELFTEST + '.js');
const out = path.resolve(__dirname, '..', 'browser-check', 'out');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-desktop-check-'));

// TNAI_CHECK_PROJECT=repo (check.ps1 -RealProject): the project is a throwaway copy of this repo
// (working tree as it is now, plus .git), so a test meets a real code base (file tree, watcher,
// git, agents reading real code). The copy lives in the test profile; this repo is never touched.
const realProject = process.env.TNAI_CHECK_PROJECT === 'repo';
const project = path.join(profile, realProject ? 'tnai-copy' : 'sample-project');

// Test windows keep rendering when other apps cover them (Windows occlusion would pause frames,
// e.g. xterm drawing in a pop-out).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Fresh profile each run, with a connected project folder seeded on disk.
app.setPath('userData', path.join(profile, 'user-data'));

// A test never writes into the user's real Codex home or ~/.agents/skills, whichever launcher
// started it (check.ps1 sets neither): Codex's profile file (agent-registry.js codexProfile) and
// the skill copies (skill-service.js syncHomeSkills) go into this run's profile. Otherwise a test
// can leave the real profile's live-steps hook pointing at a deleted temp folder.
// real-* tests send a real prompt and keep the real Codex sign-in.
if (!process.env.CODEX_HOME && !/^real-/.test(process.env.TNAI_SELFTEST))
  process.env.CODEX_HOME = path.join(profile, 'codex-home');
if (!process.env.TNAI_HOME_SKILLS_DIR)
  process.env.TNAI_HOME_SKILLS_DIR = path.join(profile, 'home-skills');
if (realProject) {
  const repo = path.resolve(__dirname, '..', '..');
  const list = require('child_process')
    .execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    })
    .split('\0')
    .filter(Boolean);
  for (const f of list) {
    const src = path.join(repo, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(project, f)), { recursive: true });
    fs.copyFileSync(src, path.join(project, f));
  } // deleted-but-tracked files are skipped
  fs.cpSync(path.join(repo, '.git'), path.join(project, '.git'), { recursive: true });
  console.log(
    'Technically Not check project: copy of this repo (' + list.length + ' files) at ' + project
  );
} else {
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'README.md'), '# Sample\r\nline two\r\n');
  fs.writeFileSync(path.join(project, 'src', 'app.js'), 'console.log("hi");\n');
}
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(
  path.join(app.getPath('userData'), 'project-folder.json'),
  JSON.stringify({ root: project })
);

// Every terminal this run starts, so the way out can end each one and wait for its exit. A test
// app used to leave with terminals still open: node-pty's exit-wait thread then woke during the
// process teardown and failed its own assert (conpty.cc line 106, remove_pty_baton), which opens a
// "Microsoft Visual C++ Runtime Library · Assertion failed" box on the user's screen, or the app
// crashed after RESULT: PASS.
const openTerminals = new Set();
let startedTerminals = 0,
  terminalWatchError = '';
try {
  const nodePty = require(
    require.resolve('node-pty', {
      paths: [path.resolve(__dirname, '..', '..', 'desktop')],
    })
  );
  const spawnTerminal = nodePty.spawn;
  nodePty.spawn = (...args) => {
    const proc = spawnTerminal(...args);
    const entry = { proc };
    entry.exited = new Promise(resolve => {
      proc.onExit(() => {
        openTerminals.delete(entry);
        resolve();
      });
    });
    openTerminals.add(entry);
    startedTerminals++;
    return proc;
  };
} catch (error) {
  terminalWatchError = error.message;
}

// Ends every terminal the app still has (one at a time, as the app closes panels) and waits until
// each has exited, at most `limitMs`; a terminal still open then is killed directly and waited for
// briefly. Answers how many were still open at the start and how many never exited.
async function endTerminals(limitMs) {
  const before = openTerminals.size;
  if (!before) return { before, left: 0 };
  try {
    const ptys = require('../../desktop/pty-service');
    ptys.unwarm();
    for (const session of ptys.list()) ptys.stop(session.paneId);
  } catch {}
  const allExited = () => Promise.all([...openTerminals].map(entry => entry.exited));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await Promise.race([allExited(), wait(limitMs)]);
  for (const entry of openTerminals)
    try {
      entry.proc.kill();
    } catch {}
  await Promise.race([allExited(), wait(2000)]);

  // The exit-wait thread finishes just after it reports the exit: give it a moment to end.
  await wait(200);
  return { before, left: openTerminals.size };
}

// TNAI_CHECK_BY_HAND (the two-window try, `remote-check.js hand`): a person uses this window, so
// nothing is answered for them and the app draws as it does installed (no test renderer, no
// terminal grid). Everything else of a test run stays: the throwaway profile.
const byHand = !!process.env.TNAI_CHECK_BY_HAND;

// Runs inside the test window (it is sent there as source text, so it can use nothing of this
// file). It gives the tests `window.TnaiTest`:
//
// - `await TnaiTest.startThread({ tool, name, show, waitMs, ...options })` starts a session as a
//   thread, the way "New thread" does (a panel underneath, then the tool in it, without leaving
//   the page), waits until it runs and answers `{ paneId, session }`; it throws with the reason
//   when the tool does not start. `tool` is named as the provider list names it ('Terminal' is
//   PowerShell). `show: true` also opens that thread on the Threads page. `waitMs` is how long
//   to wait for it to run (20 s). Every other option goes to the app's own start (accountId,
//   customAgentId, mode, worktree, ...).
// - `await TnaiTest.open(tool, options)` is the same start for a test that wants the answer and
//   not a throw: `{ ok, paneId, error }`, what `TnaiAgents.open` answers. (`TnaiAgents.open`
//   itself presses the old navigation and the old picker, so a test never calls it.)
// - `await TnaiTest.openAllThreads()` opens the All threads page as the three-dots menu does and
//   answers true once it shows the threads.
// - `TnaiTest.sawTerminalPage()` is true when the old Terminal page was on screen in this test.
// - `await TnaiTest.request(url, { method, body, headers })` sends an HTTP request from the main
//   process and answers `{ ok, status, text, error }` (status 0 when nothing answered). A test
//   uses it in place of `fetch`: the app's policy (index.html, `connect-src` none since
//   2026-10-21) lets the page itself connect nowhere, so a test that stands in for a CLI's hook
//   or reads a dev server must not do it from the page.
function pageTestHelper() {
  const SEEN_KEY = 'tnai.test.saw-terminal-page';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (read, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = read();
      if (value) return value;
      await wait(50);
    }
    return null;
  };

  // ---------- the old Terminal page ----------
  // The page of terminal panels and "All threads" share one route. The route's class without
  // All threads' own class is the old page. It is read a moment after a change of the classes,
  // because All threads puts its class on right after the route's.
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {}
  const noteIfOldPage = () => {
    const layout = document.querySelector('.layout');
    if (seen || !layout) return;
    if (!layout.classList.contains('terminal-mode') || layout.classList.contains('tat-on')) return;
    seen = true;
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {}
    console.log('TNAI_SAW_TERMINAL_PAGE');
  };
  const watchLayout = () => {
    const layout = document.querySelector('.layout');
    if (!layout) return;
    new MutationObserver(() => setTimeout(noteIfOldPage, 30)).observe(layout, {
      attributes: true,
      attributeFilter: ['class'],
    });
    setTimeout(noteIfOldPage, 30);
  };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', watchLayout, { once: true });
  else watchLayout();
  if (seen) console.log('TNAI_SAW_TERMINAL_PAGE');

  // ---------- starting a thread ----------
  // The same two steps as the prompt box's New agent: a panel underneath (an empty one is filled
  // first), then the tool started in it. The page shown does not change. Answers what the app's
  // own start answers: { ok, paneId, error }.
  async function open(tool = 'Terminal', { name, ...options } = {}) {
    // The app's scripts may still be loading when a test's first line runs.
    const ready = await until(() => window.TnaiNewTerminalPane && window.TnaiAgents?.openIn, 10000);
    if (!ready) return { ok: false, error: 'the app has no way to start a thread yet' };
    const wantedName = name ?? window.TnaiPaneNames?.pick?.() ?? '';
    const record = window.TnaiNewTerminalPane({ name: wantedName, quiet: true, reuseEmpty: true });
    if (!record) return { ok: false, error: 'no room for another thread' };
    await wait(0);
    const answer = await window.TnaiAgents.openIn(record.id, tool, {
      name: record.name || wantedName,
      ...options,
    });
    return { ...answer, paneId: record.id };
  }

  async function startThread({ tool = 'Terminal', show, waitMs, ...options } = {}) {
    const limit = waitMs || 20000;
    const opened = await open(tool, options);
    if (!opened.paneId || opened.ok === false)
      throw new Error('startThread: ' + tool + ' did not start: ' + (opened.error || 'no reason'));
    const paneId = opened.paneId;
    const running = () =>
      window.TnaiAgents.sessions().find(session => session.paneId === paneId && session.running);
    const session = await until(running, limit);
    if (!session)
      throw new Error('startThread: ' + tool + ' was not running after ' + limit / 1000 + ' s');
    if (show) {
      await until(() => window.TnaiThreadList?.thread?.(paneId), 5000);
      window.TnaiThreads?.show?.(paneId);
    }
    return { paneId, session };
  }

  // ---------- the All threads page ----------
  // Opened as the three-dots menu's "All threads" row opens it. True once the page shows the
  // threads; false when it did not within the time (the old Terminal page would be noted above).
  async function openAllThreads(ms = 6000) {
    window.TnaiRoute('terminal');
    return !!(await until(() => window.TnaiAllThreads?.on, ms));
  }

  // ---------- pictures ----------
  // Saves desktop-NAME.png and answers true once the main process has written it (false after
  // 10 s). A test that switches the look or closes something right after a picture waits for this:
  // with a fixed wait, a stalled main process took "Light" pictures after the switch back to Dark
  // (learned 2026-10-14).
  const savedShots = new Map();
  window.__tnaiShotSaved = name => {
    savedShots.get(name)?.(true);
    savedShots.delete(name);
  };

  function shot(name, ms = 10000) {
    return new Promise(resolve => {
      savedShots.set(name, resolve);
      console.log('TNAI_SHOT:' + name);
      setTimeout(() => resolve(false), ms);
    });
  }

  // ---------- requests sent by the main process ----------
  const requests = new Map();
  let requestCount = 0;
  window.__tnaiRequestDone = (id, answer) => {
    requests.get(id)?.(answer);
    requests.delete(id);
  };

  function request(url, options = {}) {
    return new Promise(resolve => {
      requestCount += 1;
      requests.set(requestCount, resolve);
      console.log('TNAI_REQUEST:' + JSON.stringify({ id: requestCount, url, options }));
    });
  }

  window.TnaiTest = {
    open,
    startThread,
    openAllThreads,
    shot,
    request,
    sawTerminalPage: () => seen,
  };
}

module.exports = win => {
  // Each time the window is minimized during the run: the second it happened and how. A call to
  // win.minimize() is the window's own Minimize button (66 asks main for it) or a test; anything
  // else came from outside (the taskbar, a key, another program). The result prints it as "note
  // window minimized …", so a failed size, layout or picture check shows how the window was put
  // away (learned 2026-10-14: a real mouse moved onto new test windows and clicked their Minimize
  // button about 1.8 s after they appeared, and the size guard below then stopped the test).
  const runStart = Date.now();
  const minimizedAt = [];
  let minimizeCalled = false;
  const minimizeNow = win.minimize.bind(win);
  win.minimize = () => {
    minimizeCalled = true;
    minimizeNow();
  };
  win.on('minimize', () => {
    const second = ((Date.now() - runStart) / 1000).toFixed(1) + ' s';
    minimizedAt.push(
      second + (minimizeCalled ? ' (its Minimize button or the test)' : ' (from outside)')
    );
    minimizeCalled = false;
  });

  // Child dialogs (desktop prompt) are answered automatically: 'Named by test'.
  // Other windows (pop-outs) have no form and are left alone.
  // A test's .main.js can set global.__tnaiKeepPrompts to inspect a prompt window instead
  // (dialog-audit).
  app.on('browser-window-created', (_e, child) => {
    if (child !== win && !global.__tnaiKeepPrompts && !byHand)
      child.webContents.once(
        'did-finish-load',
        () =>
          !child.isDestroyed() &&
          child.webContents
            .executeJavaScript(
              "{const form=document.querySelector('form');if(form){form.querySelector('input').value='Named by test';form.requestSubmit()}}"
            )
            .catch(() => {})
      );
  });

  // Terminals use xterm's DOM renderer in tests, which read screen text from .xterm-rows; the app
  // uses WebGL (10 useWebgl), which draws on a canvas. Lag tests measure the real renderer:
  // RENDERER_TESTS keep WebGL.
  const RENDERER_TESTS = [
    'resize-smooth',
    'real-agent-lag',
    'typing-lag',
    'perf-latency',
    'perf-page-switch',
    'perf-background-switch',
    'own-terminal-look',
    'snap-sizes',
    'window-move-perf',
    'resize-drag',
  ];

  // Also kept in the throwaway profile's localStorage, so after a test reloads the window, panes
  // restored early already see it. A native confirm/alert blocks the page until someone clicks it
  // on the user's screen (once, code-highlight left a dirty draft and 09's "Discard unsaved
  // changes?" popped up mid-run). Tests answer them: confirm → OK, logged; a test may stub its own
  // instead.
  if (!byHand)
    win.webContents.on('dom-ready', () =>
      win.webContents
        .executeJavaScript(
          "window.confirm = m => { console.log('info native confirm answered OK: ' + m); return true; }; window.alert = m => console.log('info native alert: ' + m);"
        )
        .catch(() => {})
    );
  if (!byHand && !RENDERER_TESTS.includes(process.env.TNAI_SELFTEST))
    win.webContents.on('dom-ready', () =>
      win.webContents
        .executeJavaScript(
          "window.__tnaiDomRenderer = true; try { localStorage.setItem('tnai.test.dom-renderer', '1'); } catch {}"
        )
        .catch(() => {})
    );

  // What every window test may call (`window.TnaiTest`), put into the page at each load. The
  // function below runs in the page, not here: it is sent as its own source text.
  if (!byHand)
    win.webContents.on('dom-ready', () =>
      win.webContents.executeJavaScript('(' + pageTestHelper + ')()').catch(() => {})
    );

  // The page says once when the old Terminal page was on screen; the answer is kept here, so it
  // outlasts a reload of the window.
  let sawTerminalPage = false;
  win.webContents.on('console-message', event => {
    if (event.message === 'TNAI_SAW_TERMINAL_PAGE') sawTerminalPage = true;
  });

  // TNAI_CSP_REPORT="<policy>": the window's page also gets that policy in report-only mode (as a
  // response header, which works for a page opened from disk; a <meta> cannot be report-only).
  // Nothing is blocked by it; every violation is listed once at the end as a "csp" line, so a
  // stricter policy can be tried on every page a test walks before it is switched on.
  // Electron keeps one header listener per session, so during such a run the Live preview's own
  // header listener (desktop/main.js) is not in place: walk preview frames in a normal run.
  const cspViolations = new Set();
  if (process.env.TNAI_CSP_REPORT) {
    win.webContents.session.webRequest.onHeadersReceived(
      { urls: ['file://*/*'] },
      (details, done) => {
        if (details.resourceType !== 'mainFrame') return done({});
        const responseHeaders = { ...(details.responseHeaders || {}) };
        responseHeaders['Content-Security-Policy-Report-Only'] = [process.env.TNAI_CSP_REPORT];
        done({ responseHeaders });
      }
    );
  }

  // Every run: something the app's own policy (index.html) refused in the app's page fails the
  // test with a "FAIL the app's policy refused" line, so a change that needs a new kind of source
  // is caught by any test that reaches it (the policy is strict since 2026-10-21). Only the app's
  // own page and its pop-outs count: a Live preview or `tnai show` frame has its own policy.
  const cspRefused = new Set();
  const noteViolation = (event, ownPage) => {
    if (!/Content Security Policy/.test(event.message)) return;
    const text = event.message.split('. ')[0].slice(0, 400);
    if (/report-only/i.test(event.message)) cspViolations.add(text);
    else if (ownPage) cspRefused.add(text);
  };
  const isOwnPage = (contents, event) =>
    (!event.frame || event.frame === contents.mainFrame) &&
    /^(file:|about:blank)/.test(contents.getURL() || 'about:blank');
  win.webContents.on('console-message', event =>
    noteViolation(event, isOwnPage(win.webContents, event))
  );

  // A pop-out (a blank child window the app fills) takes the opener's policy and reports in its
  // own console.
  app.on('browser-window-created', (_event, child) => {
    if (child === win) return;
    child.webContents.on('console-message', event =>
      noteViolation(event, isOwnPage(child.webContents, event))
    );
  });

  // Every test sees the app as a user does: sessions are threads, and the route 'terminal' is
  // the All threads page. (Until 2026-10-13 the runner put most tests on a plain grid of terminal
  // panels, 105's mode `terminals`; no test asks for it any more, and one that puts the old
  // Terminal page on screen fails by the guard above.)
  const lines = [];

  // A test may have tests/<name>.main.js, loaded here in the main process (fake servers, test
  // hooks). The renderer test calls its methods by logging
  // `TNAI_MAIN:{"id":..,"cmd":..,"args":[..]}`; the result {ok, value|error} goes to
  // window.__tnaiMainDone[id](result).
  const mainFile = testFile.replace(/\.js$/, '.main.js');
  const mainApi = fs.existsSync(mainFile) ? require(mainFile)(win, profile) : null;
  let windowPutAway = false;
  if (mainApi)
    win.webContents.on('console-message', async event => {
      if (!event.message.startsWith('TNAI_MAIN:')) return;
      const { id, cmd, args } = JSON.parse(event.message.slice(10));
      let result;
      try {
        result = { ok: true, value: await mainApi[cmd](...(args || [])) };
      } catch (error) {
        result = { ok: false, error: error.message };
      }

      // A window the user minimized or hid during the run takes no new size and its page keeps
      // its old width, so every layout check after a `size` step would fail for no fault of the
      // app (the window reads 0 x 0 while the page keeps its old size). The size call fails here
      // with one line naming the window's state, and the test stops there. The window is never
      // restored for the test: the user put it away.
      if (cmd === 'size' && result.ok && !win.isDestroyed()) {
        const [contentWidth, contentHeight] = win.getContentSize();
        const lost = win.isMinimized() || !win.isVisible() || !contentWidth || !contentHeight;
        if (lost) {
          const state =
            (win.isMinimized() ? 'minimized' : 'not minimized') +
            ', ' +
            (win.isVisible() ? 'shown' : 'hidden') +
            ', ' +
            contentWidth +
            ' x ' +
            contentHeight;
          const text =
            'the window did not take ' +
            (args || []).join(' x ') +
            ' (' +
            state +
            '): it was minimized or hidden from outside, so its layout cannot be measured; run the test again and leave its window as it is';
          lines.push('FAIL WINDOW PUT AWAY: ' + text);
          windowPutAway = true;
          result = { ok: false, error: text };
        }
      }
      win.webContents
        .executeJavaScript(
          'window.__tnaiMainDone?.[' +
            JSON.stringify(id) +
            ']?.(' +
            JSON.stringify(result ?? null) +
            ')'
        )
        .catch(() => {});
    });

  // `TnaiTest.request` logs `TNAI_REQUEST:{"id":..,"url":..,"options":{..}}`; the request goes out
  // from here and its answer to window.__tnaiRequestDone(id, answer).
  win.webContents.on('console-message', async event => {
    if (!event.message.startsWith('TNAI_REQUEST:')) return;
    const { id, url, options = {} } = JSON.parse(event.message.slice('TNAI_REQUEST:'.length));
    let answer;
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
      });
      answer = { ok: response.ok, status: response.status, text: await response.text() };
    } catch (error) {
      answer = { ok: false, status: 0, text: '', error: error.message };
    }
    if (win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(
        'window.__tnaiRequestDone?.(' + JSON.stringify(id) + ',' + JSON.stringify(answer) + ')'
      )
      .catch(() => {});
  });

  // A test can log `TNAI_SHOT:<name>` to save a screenshot of the current page; `await
  // TnaiTest.shot(name)` does that and waits until the file is written. A frame is asked for first,
  // because a window that draws no frames hands capturePage its last one (learned 2026-10-14).
  win.webContents.on('console-message', async event => {
    const m = /^TNAI_SHOT:(\w[\w-]*)$/.exec(event.message);
    if (!m || win.isDestroyed()) return;
    try {
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 150));
      const img = await win.webContents.capturePage();
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'desktop-' + m[1] + '.png'), img.toPNG());
      if (win.isDestroyed()) return;
      win.webContents
        .executeJavaScript('window.__tnaiShotSaved?.(' + JSON.stringify(m[1]) + ')')
        .catch(() => {});
    } catch {}
  });

  // Real OS-level input: a test logs `TNAI_INPUT:{"id":..,"events":[{type:'mouseDown',x,y,..}]}`
  // with CSS-px page coordinates; they are scaled by the page zoom into window coordinates, sent
  // with sendInputEvent ~16 ms apart, then window.__tnaiInputDone[id]() resolves the test's wait.
  win.webContents.on('console-message', async event => {
    if (!event.message.startsWith('TNAI_INPUT:')) return;
    const { id, events } = JSON.parse(event.message.slice(11)),
      zoom = win.webContents.getZoomFactor();

    // Keyboard events ({type:'keyDown'|'char'|'keyUp', keyCode, modifiers}) have no coordinates and
    // go to the focused element.
    for (const e of events) {
      const mouse = e.type.startsWith('mouse'),
        input = mouse ? { ...e, x: Math.round(e.x * zoom), y: Math.round(e.y * zoom) } : { ...e };
      delete input.wait;
      if (e.type === 'mouseMove' && e.down) {
        delete input.down;
        input.modifiers = ['leftButtonDown'];
      }
      if (mouse && e.type !== 'mouseMove') {
        input.button = 'left';
        input.clickCount = e.clickCount ?? 1;
      }
      win.webContents.sendInputEvent(input);
      await new Promise(r => setTimeout(r, e.wait ?? 16));
    }
    win.webContents
      .executeJavaScript('window.__tnaiInputDone?.[' + JSON.stringify(id) + ']?.()')
      .catch(() => {});
  });

  // `TNAI_MEDIA:dark|light|system` sets the OS color scheme the page sees (prefers-color-scheme),
  // for Match system checks.
  win.webContents.on('console-message', event => {
    const m = /^TNAI_MEDIA:(dark|light|system)$/.exec(event.message);
    if (m) require('electron').nativeTheme.themeSource = m[1];
  });
  win.webContents.on('console-message', event => {
    if (event.level === 'error')
      lines.push(
        'CONSOLE ERROR: ' + event.message + ' @ ' + event.sourceId + ':' + event.lineNumber
      );
  });

  // One way out, used by a finished test and by the time limit: screenshot, log, RESULT line, exit.
  let phase = 'waiting for the window to load',
    finished = false;
  const finish = async code => {
    if (finished) return;
    finished = true;
    try {
      fs.mkdirSync(out, { recursive: true });
      const img = await Promise.race([
        win.webContents.capturePage(),
        new Promise(r => setTimeout(r, 5000)),
      ]);
      if (img)
        fs.writeFileSync(
          path.join(out, 'desktop-' + process.env.TNAI_SELFTEST + '.png'),
          img.toPNG()
        );
    } catch {}

    // Terminals end before the app does (see openTerminals); the time limit leaves 15 s, so this
    // waits at most 6 s plus 2 s for a direct kill.
    const terminals = await endTerminals(6000);
    if (process.env.TNAI_CSP_REPORT)
      lines.push(
        'note csp report-only: ' + cspViolations.size + ' different violations',
        ...[...cspViolations].map(text => 'csp  ' + text)
      );
    if (cspRefused.size) {
      lines.push(...[...cspRefused].map(text => "FAIL the app's policy refused: " + text));
      code = 1;
    }
    if (minimizedAt.length)
      lines.push('note window minimized during the run at ' + minimizedAt.join(', '));
    lines.push(
      'Terminals: ' +
        (terminalWatchError
          ? 'not watched (' + terminalWatchError + ')'
          : startedTerminals + ' started') +
        ', at the end ' +
        terminals.before +
        ' open, ' +
        (terminals.before - terminals.left) +
        ' ended' +
        (terminals.left ? ', ' + terminals.left + ' never exited' : '')
    );
    process.stdout.write(lines.join('\n') + '\nRESULT: ' + (code ? 'FAIL' : 'PASS') + '\n');
    try {
      win.destroy();
    } catch {}
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
    app.exit(code);
  };

  // Time limit from check.js: a stuck test says where it stopped (phase, console errors so far,
  // screenshot) 15 s before check.js kills the app.
  const limitMs = Number(process.env.TNAI_CHECK_LIMIT_MS);
  if (limitMs > 0)
    setTimeout(
      () => {
        lines.push(
          'RUNNER TIMEOUT after ' +
            Math.round((limitMs - 15000) / 1000) +
            ' s, stuck while: ' +
            phase
        );
        finish(1);
      },
      Math.max(1000, limitMs - 15000)
    ).unref();
  win.webContents.once('did-finish-load', async () => {
    let code = 1;
    try {
      const body = fs.readFileSync(testFile, 'utf8');
      phase = 'running ' + path.basename(testFile);
      let result = await win.webContents.executeJavaScript(
        '(async () => {' + body + '\n})()',
        true
      );
      lines.push(...(result?.log || []));

      // A test that returns {reload: true} continues in tests/<name>.after.js after the window
      // reloads (persistence checks); that one may return {reload: true} again → <name>.after2.js.
      for (const suffix of ['.after.js', '.after2.js']) {
        const after = testFile.replace(/\.js$/, suffix);
        if (!(result?.ok && result.reload && fs.existsSync(after))) break;
        const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
        phase = 'reloading the window before ' + path.basename(after);
        win.webContents.reload();
        await loaded;
        lines.push('--- after reload');
        phase = 'running ' + path.basename(after);
        result = await win.webContents.executeJavaScript(
          '(async () => {' + fs.readFileSync(after, 'utf8') + '\n})()',
          true
        );
        lines.push(...(result?.log || []));
      }
      code = result?.ok && !windowPutAway ? 0 : 1;

      // The page reports the old Terminal page a moment after it shows: give a last report the
      // time to arrive before the answer is read.
      await new Promise(resolve => setTimeout(resolve, 150));
      if (sawTerminalPage) {
        lines.push('FAIL the old Terminal page was shown');
        code = 1;
      }
    } catch (error) {
      lines.push('RUNNER ERROR: ' + (error.stack || error.message));
    }
    finish(code);
  });
};
