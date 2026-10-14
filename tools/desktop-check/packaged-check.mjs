/*
 * Technically Not tools · desktop-check/packaged-check.mjs — Checks the BUILT app over DevTools:
 * bridge, agent sign-in detection, a live terminal panel running the default shell and echoing a
 * command (or, when the build's plan lock is on and the profile is signed out, that the lock
 * refuses a new panel). Exits 1 on a failure. Windows: run through packaged-check.ps1 (it launches
 * dist/win-unpacked/TechnicallyNot.ai.exe and passes the DevTools port). Any OS (CI on
 * macOS/Linux): node packaged-check.mjs --exe <app executable> [--no-sandbox] — launches it itself
 * with a throwaway profile and a free port, then stops it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wait = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2),
  exeAt = argv.indexOf('--exe');
let port = Number(argv[0]),
  app = null,
  profile = null;
if (exeAt >= 0) {
  port = await new Promise(r => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  profile = mkdtempSync(join(tmpdir(), 'tnai-packaged-check-'));

  // Linux CI only: an unpacked build's chrome-sandbox isn't setuid there
  const extra = argv.includes('--no-sandbox') ? ['--no-sandbox'] : [];
  app = spawn(
    argv[exeAt + 1],
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...extra],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  app.on('exit', code => console.log('app exited with ' + code));
}
if (!port) {
  console.error(
    'usage: node packaged-check.mjs <devtools port> | --exe <app executable> [--no-sandbox]'
  );
  process.exit(2);
}
const finish = code => {
  try {
    app?.kill('SIGKILL');
  } catch {}
  setTimeout(() => {
    if (profile)
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    process.exit(code);
  }, 500);
};

let targets = [];
for (let i = 0; i < 60; i++) {
  try {
    targets = await (
      await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })
    ).json();
    if (targets.find(t => t.type === 'page')) break;
  } catch {}
  await wait(500);
}
const page = targets.find(t => t.type === 'page');
if (!page) {
  console.error('FAIL: the app opened no page on DevTools port ' + port);
  finish(1);
  await wait(2000);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const evaluate = expr =>
  new Promise(r => {
    const n = ++id;
    pending.set(n, r);
    ws.send(
      JSON.stringify({
        id: n,
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true },
      })
    );
  }).then(
    m =>
      m.result?.exceptionDetails
        ? 'threw: ' +
          (m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text)
        : (m.result?.result?.value ?? JSON.stringify(m.error || m))

    // a thrown error is read first: with returnByValue its value is {} (0.3.63: the x64 Mac check
    // printed only "{}")
  );
await wait(2500);

// The shell is PowerShell on Windows and $SHELL (bash/zsh) elsewhere; each gets a command whose
// output only appears once it is evaluated.
const result = await evaluate(`(async()=>{
 const w=ms=>new Promise(r=>setTimeout(r,ms)); const out=[]; const win=/Windows/.test(navigator.userAgent);
 out.push('bridge='+!!window.tnaiNative+' agents='+!!window.TnaiAgents+' label='+document.querySelector('.tnai-version')?.textContent);
 const d=await TnaiAgents.detect(true); out.push('signedIn='+[...d.values()].filter(a=>a.loggedIn).map(a=>a.id).join(','));
 await TnaiAuth.ready(); const lock=TnaiAuth.state().lock||{};
 if(lock.locked){ const r=await tnaiNative.pty.start({paneId:'pkg-lock-'+Date.now(),agent:'Terminal',mode:'run',cols:80,rows:24}); out.push('locked='+lock.reason+' refused='+(!r?.ok&&r?.error?.code==='locked')); return out.join(' | '); }
 document.querySelector('.side-item[data-view="terminal"]').click(); await w(300);
 document.getElementById('newTerminalWindow').click(); await w(300);
 document.querySelector('.terminal-provider-card[data-provider="Terminal"]').click(); await w(3000);
 out.push('xterm='+!!window.Terminal+' mounted='+!!document.querySelector('.tnai-xterm .xterm'));
 // The first start of a freshly built copy is slow (Windows reads every new program file once),
 // so the panel's shell gets up to 20 seconds before the check gives up on it.
 let s; for(let i=0;i<40&&!s;i++){ s=TnaiAgents.sessions().find(s=>s.running); if(!s) await w(500); }
 out.push('running='+!!s); if(!s) return out.join(' | ');
 TnaiAgents.send(s.paneId, win ? 'Write-Output ("PKG" + (5*5))' : 'echo "PKG$((5*5))"'); await w(2500);
 out.push('echo='+/PKG25/.test((await tnaiNative.pty.replay(s.paneId)).buffer));
 TnaiAgents.send(s.paneId, win ? 'tnai help; Write-Output ("TNX" + $LASTEXITCODE + "END")' : 'tnai help; echo "TNX$?END"'); await w(4000);
 out.push('tnai='+/TNX0END/.test((await tnaiNative.pty.replay(s.paneId)).buffer));
 await TnaiAgents.stop(s.paneId); return out.join(' | ');
})()`);
console.log(result);
ws.close();

// A release build with the plan lock on starts signed out in the throwaway profile: then the check
// is that the lock holds (main refuses a new panel).
// "tnai=true": the `tnai` command works inside the panel. In a build it runs through the stand-in
// files and the Node runtime the build ships, so this is the proof that those work when the app
// itself can no longer be started as Node.
const pass =
  /bridge=true/.test(result) &&
  ((/running=true/.test(result) && /echo=true/.test(result) && /tnai=true/.test(result)) ||
    (/locked=signed-out/.test(result) && /refused=true/.test(result)));
console.log('RESULT: ' + (pass ? 'PASS' : 'FAIL'));
finish(pass ? 0 : 1);
