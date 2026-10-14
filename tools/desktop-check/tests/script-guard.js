// Technically Not tools · desktop-check/tests/script-guard.js — the window runs script files only
// from the app's own code folders (desktop/script-guard.js).
// The app still loads everything it needs (its UI, the terminal library from
// node_modules), and a script file that sits elsewhere on the disk does not run, even though the
// page's own rule would let it. Returns {ok, log}.
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

// Adds a script tag and says what became of it: "ran" (the file was loaded; a script that throws
// still counts), "refused" (the request was cancelled or the file is missing) or "timeout".
const tryScript = src =>
  new Promise(resolve => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = () => resolve('ran');
    tag.onerror = () => resolve('refused');
    document.head.append(tag);
    setTimeout(() => resolve('timeout'), 5000);
  });

check(
  !!window.tnaiNative && !!window.TnaiAgents,
  'the app loaded with its bridge: its own scripts ran'
);

// the terminal library comes from node_modules, loaded when the first terminal is needed: a
// PowerShell thread, started and stopped again
let shellId = '';
try {
  shellId = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
} catch (error) {
  log.push('info ' + (error?.message || error));
}
check(
  !!(await until(() => typeof window.Terminal === 'function')),
  'the terminal library from node_modules loaded'
);
if (shellId) await window.TnaiAgents.stop(shellId);

// one of the app's own files again, under another address so it is asked for anew
const own = await tryScript('src/vendor/floating-ui/floating-ui.core.umd.min.js?again=1');
check(own === 'ran', "a script in the app's src folder runs: " + own);

// Files that exist on this disk outside the code folders. Without the guard both would load: to
// the page's own rule every file on the disk is "self".
const outside = await tryScript('tools/check-syntax.js');
check(outside === 'refused', "a script in the app's root but outside its code folders: " + outside);
const config = await tryScript('package.json');
check(config === 'refused', 'a file in the root asked for as a script: ' + config);

// the same through a full file: address, as injected markup would write it
const full = new URL('tools/check-syntax.js', location.href).href;
check(/^file:/.test(full), 'the page is a file: page (' + location.protocol + ')');
const byFullAddress = await tryScript(full);
check(byFullAddress === 'refused', 'the same file by its full address: ' + byFullAddress);

// ---- workers, module workers and import() ----
// A file that was refused never arrives; a file that arrived and then failed while running did
// arrive, which is what the guard must prevent. So each try tells the two apart: the worker files
// are probes that post a message when they run (script-guard.main.js), a worker's error event has
// a message only when the file ran and threw, and a refused import() fails with "Failed to fetch".
// Silence is not taken for either: the first run (2026-10-10) called a silent worker "ran", for
// the app's own file and the outside file alike.
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

// what kind Electron gave the request and what the guard answered, as text for a check's label
const kindOf = async mark => {
  const seen = await main('seen', mark);
  return seen.length ? seen.join(' | ') : 'the guard was not asked';
};

const tryWorker = (src, options) =>
  new Promise(resolve => {
    let worker;
    try {
      worker = new Worker(src, options);
    } catch (error) {
      resolve('refused (' + error.name + ')');
      return;
    }
    const end = outcome => {
      worker.terminate();
      resolve(outcome);
    };
    worker.onmessage = event => end('ran (' + event.data + ')');
    worker.onerror = event => {
      event.preventDefault();
      end(event.message ? 'ran and threw: ' + event.message : 'refused');
    };
    setTimeout(() => end('no sign in 4 s'), 4000);
  });
const tryImport = async src => {
  try {
    await import(src);
    return 'ran';
  } catch (error) {
    return /Failed to fetch/i.test(String(error && error.message))
      ? 'refused'
      : 'ran and threw: ' + (error && error.message);
  }
};
const arrived = outcome => outcome.startsWith('ran');
const ownFile = new URL('src/vendor/floating-ui/floating-ui.core.umd.min.js', location.href).href;

// Seen 2026-10-10 (Electron of that day): in this window no worker starts from a file on disk at
// all, the app's own folders included; there is no message, no error event, and the guard is not
// asked. The app uses no worker. So the tries from a code folder are notes, not checks: they say
// what happened, and the day one reads "ran" the lines for an outside file have their control.
const note = label => log.push('note ' + label);

const probe = await main('probes');
try {
  const ownWorker = await tryWorker(probe.inside + '?worker=1');
  note(
    "a worker from one of the app's code folders: " +
      ownWorker +
      ' [request: ' +
      (await kindOf('?worker=1')) +
      ']'
  );
  const outsideWorker = await tryWorker(probe.outside + '?worker=2');
  check(
    !arrived(outsideWorker),
    'a worker from outside the code folders does not run: ' +
      outsideWorker +
      ' [request: ' +
      (await kindOf('?worker=2')) +
      ']'
  );

  const ownModuleWorker = await tryWorker(probe.inside + '?moduleworker=1', { type: 'module' });
  note(
    "a module worker from one of the app's code folders: " +
      ownModuleWorker +
      ' [request: ' +
      (await kindOf('?moduleworker=1')) +
      ']'
  );
  const outsideModuleWorker = await tryWorker(probe.outside + '?moduleworker=2', {
    type: 'module',
  });
  check(
    !arrived(outsideModuleWorker),
    'a module worker from outside the code folders does not run: ' +
      outsideModuleWorker +
      ' [request: ' +
      (await kindOf('?moduleworker=2')) +
      ']'
  );
} finally {
  await main('clean');
}

const ownImport = await tryImport(ownFile + '?import=1');
check(
  arrived(ownImport),
  "import() of a file in the app's src folder arrives: " +
    ownImport +
    ' [request: ' +
    (await kindOf('?import=1')) +
    ']'
);
const outsideImport = await tryImport(full + '?import=2');
check(
  outsideImport === 'refused',
  'import() of a file outside the code folders: ' +
    outsideImport +
    ' [request: ' +
    (await kindOf('?import=2')) +
    ']'
);

return { ok, log };
