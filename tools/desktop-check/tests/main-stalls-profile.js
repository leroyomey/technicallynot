/*
 * Technically Not tools · desktop-check/tests/main-stalls-profile.js — What fills the main
 * process's unnamed stalls (docs/ISSUES.md, "Stalls at start that are not process starts"). A
 * measurement, not a gate: six PowerShell threads print a modest stream, two stand-in Claude Code
 * threads (agent-mesh.main.js's fake CLI, no credits) get a line now and then, the main side pushes
 * an ordinary flow of hook events, turns and file writes, and the user's moves are played: another
 * thread shown every 5 s, All threads and back every 30 s. The main process is profiled the whole
 * time; every busy stretch of 80 ms or more is printed with its kinds of work (JS, Electron's own
 * "(program)", garbage collection) and its functions, beside the run's stalls.log lines. About 4
 * min.
 */
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (condition, label) => {
  log.push((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 30000);
  });
const agents = window.TnaiAgents;
const seconds = 180;

try {
  window.TnaiThreads.open();
  await wait(800);
  await main('profileStart');

  // Six PowerShell threads and two stand-in Claude Code threads.
  const shells = [];
  for (let count = 0; count < 6; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (
      made?.paneId &&
      (await until(() => agents.sessions().find(s => s.paneId === made.paneId)?.running))
    )
      shells.push(made.paneId);
  }
  check(shells.length === 6, '6 PowerShell threads running');
  const fakes = [];
  for (let count = 0; count < 2; count++) {
    const made = await window.TnaiTest.startThread({ tool: 'Claude Code', waitMs: 10000 }).catch(
      () => null
    );
    if (made?.paneId) fakes.push(made.paneId);
  }
  check(fakes.length === 2, '2 stand-in Claude Code threads running');

  // About 20 lines a second per shell, for the whole run.
  const escape = '$([char]27)';
  const loop =
    `$end=(Get-Date).AddSeconds(${seconds + 10}); $i=0; while((Get-Date) -lt $end){ $i++; ` +
    `Write-Host "${escape}[32m● Working${escape}[0m step $i · ${escape}[36m$(Get-Random)${escape}[0m"; ` +
    `Start-Sleep -Milliseconds 50 }`;
  shells.forEach(id => agents.send(id, loop));
  const all = [...shells, ...fakes];
  await main('flow', all, seconds * 1000);

  // The user's moves.
  const startedAt = Date.now();
  let step = 0;
  while (Date.now() - startedAt < seconds * 1000) {
    step++;
    window.TnaiThreads.show(all[step % all.length]);
    if (step % 2 === 0) fakes.forEach(id => agents.send(id, 'note ' + step));
    if (step % 6 === 0) {
      await window.TnaiTest.openAllThreads();
      await wait(2500);
      window.TnaiThreads.open();
    }
    await wait(5000);
  }

  const result = await main('profileStop');
  log.push(
    'profile: ' +
      result.sampledMs +
      ' ms sampled, ' +
      result.busyMs +
      ' ms busy, saved ' +
      result.saved,
    'busy stretches of 80 ms or more: ' + result.stretches.length
  );
  for (const stretch of result.stretches)
    log.push(
      '--- ' +
        stretch.at +
        ' ' +
        stretch.ms +
        ' ms (JS ' +
        stretch.js +
        ', program ' +
        stretch.program +
        ', gc ' +
        stretch.gc +
        ')',
      '  self: ' + stretch.self.join(' | '),
      '  in: ' + stretch.entries.join(' | '),
      '  stack: ' + stretch.stack.join(' < ')
    );
  log.push('stalls.log lines of this run: ' + result.stalls.length, ...result.stalls);

  all.forEach(id => agents.stop(id));
  await until(() => !agents.sessions().some(session => session.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
