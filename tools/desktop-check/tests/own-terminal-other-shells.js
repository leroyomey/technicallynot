// Technically Not tools · desktop-check/tests/own-terminal-other-shells.js — what the shells
// other than PowerShell tell the user's own terminal (136; agent-registry.js gives each one a
// variable at its start, never a change to its profile). For every such shell found on this
// computer the terminal is switched to it, then: nothing of the marks is printed as text; the
// row's folder is the project's folder and follows `cd src`; and, for the shells that can say
// how a command ended (Git Bash, WSL), a command that works gets a quiet dot and one that fails
// a dot in the error color. Command Prompt cannot say how a command ended: it gets no dot. A
// shell that is not on this computer is named in the log and not checked. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const own = () => window.TnaiOwnTerminal;
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const dots = () => [...document.querySelectorAll('.tnt-ownterm-host .tnt-ownterm-mark')];
const failed = () => dots().filter(dot => dot.classList.contains('tnt-ownterm-mark-failed'));
const folderEl = () => document.querySelector('.tnt-ownterm-folder');
const slashes = text => String(text || '').replace(/\\/g, '/');

// What each shell is asked, and whether it can say how a command ended.
const SHELLS = [
  { id: 'cmd', name: 'Command Prompt', works: 'ver', fails: '', saysResult: false },
  { id: 'gitbash', name: 'Git Bash', works: 'true', fails: 'false', saysResult: true },
  { id: 'wsl', name: 'WSL', works: 'true', fails: 'false', saysResult: true },
];
let ownId = '';

async function tryShell(shell) {
  const before = session(ownId)?.startedAt;
  await own().setShell(shell.id);
  const started = await until(
    () => session(ownId)?.running && session(ownId).startedAt !== before,
    30000
  );
  check(!!started, shell.name + ': the terminal runs it');
  if (!started) return;
  const term = await until(() => own().term(), 10000);
  await until(() => textOf(term).trim().length > 0, 30000);

  // The first prompt says where the shell stands. A Linux shell names the project's folder its
  // own way when the folder is not on a Windows drive, so the end of the folder is compared.
  const project = slashes(session(ownId)?.cwd).toLowerCase();
  const lastPart = project.split('/').filter(Boolean).pop();
  const told = await until(() => own().folder(), 25000);
  check(
    !!told && slashes(told).toLowerCase().replace(/\/$/, '').endsWith(lastPart),
    shell.name + ': it says where it stands, the project’s folder (' + (told || 'nothing') + ')'
  );
  if (!told) {
    log.push(
      'note ' + shell.name + ' said nothing: its profile may set the prompt variable itself'
    );
    return;
  }
  term.input('cd src\r', true);
  check(
    !!(await until(
      () =>
        /\/src\/?$/.test(slashes(own().folder())) &&
        /src$/.test(folderEl()?.textContent || '') &&
        /^This shell is in /.test(folderEl()?.title || ''),
      15000
    )),
    shell.name + ': after "cd src" the row names the new folder (' + folderEl()?.textContent + ')'
  );

  // the dot of "cd src" has come by now; dots of the shell before stay in the terminal, so
  // what this shell adds is counted from here
  await wait(1500);
  const dotsBefore = dots().length;
  const failedBefore = failed().length;
  term.input(shell.works + '\r', true);
  if (shell.saysResult) {
    check(
      !!(await until(
        () => dots().length === dotsBefore + 1 && failed().length === failedBefore,
        15000
      )),
      shell.name + ': a command that works gets a quiet dot (' + dots().length + ')'
    );
    term.input(shell.fails + '\r', true);
    check(
      !!(await until(() => failed().length === failedBefore + 1, 15000)),
      shell.name +
        ': a command that fails gets a dot in the error color (' +
        (failed().pop()?.title || 'none') +
        ')'
    );
    term.input('\r', true);
    await wait(1200);
    check(
      dots().length === dotsBefore + 2,
      shell.name + ': an empty Enter adds no dot (' + dots().length + ')'
    );
  } else {
    await wait(2000);
    check(
      dots().length === dotsBefore,
      shell.name + ': it cannot say how a command ended, so no dot is drawn (' + dots().length + ')'
    );
  }
  check(
    !/133;|Cwd=|__tnai/.test(textOf(term)),
    shell.name + ': nothing of the marks is printed in the terminal as text'
  );
  await wait(400);
  console.log('TNAI_SHOT:own-terminal-shell-' + shell.id);
  await wait(700);
}

try {
  await until(() => threads?.visible());
  window.TnaiThreadSide.open('terminal');
  ownId = (await until(() => own().paneId(), 15000)) || '';
  await until(() => session(ownId)?.running, 20000);
  const found = (await until(() => (own().shells().length ? own().shells() : null), 15000)) || [];
  log.push('note shells found on this computer: ' + found.map(shell => shell.name).join(', '));
  for (const shell of SHELLS) {
    if (found.some(one => one.id === shell.id)) await tryShell(shell);
    else log.push('note ' + shell.name + ' is not on this computer: not checked');
  }

  // back to the usual shell, so the choice does not stay with the test's project
  await own().setShell('powershell');
  await wait(1500);
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
if (ownId) await agents.stop(ownId).catch(() => {});
await wait(2500);
return { ok, log };
