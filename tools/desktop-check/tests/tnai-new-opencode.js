/*
 * Technically Not tools · desktop-check/tests/tnai-new-opencode.js — `tnai new opencode "task"`
 * from a plain PowerShell panel (desktop/agent-mesh.js spawnThenDeliver → 47 reopen/whenReady →
 * prompt-submit.js) with the FAKE `opencode` of tnai-new-opencode.main.js (never the real CLI): it
 * is silent ~1.9 s after starting and drops input sent before its screen is drawn, like OpenCode
 * 1.18 on Windows. Regression: 47 counted that startup silence as "ready", the task was pasted into
 * nothing and the new OpenCode panel sat with an empty input. The task must arrive and be submitted
 * with no keypress, and the sender must get no "Not started"/"Not delivered" note. Returns {ok,
 * log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
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
const N = window.tnaiNative,
  G = window.TnaiAgents;
const strip = s =>
  String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '');
const text = async paneId => strip((await N.pty.replay(paneId))?.buffer);
const session = paneId => G.sessions().find(s => s.paneId === paneId);
const windows = /Windows/.test(navigator.userAgent);

// Never let a real opencode get the task: the detected command must be this test's fake.
const { bin } = await main('paths');
const found = (await N.agents.detect()).find(a => a.id === 'OpenCode');
const norm = p =>
  String(p || '')
    .replace(/\\/g, '/')
    .toLowerCase();
check(
  found?.installed && norm(found.path).startsWith(norm(bin)),
  'OpenCode resolves to the fake: ' + (found?.path || 'not found')
);
if (!ok) return { ok, log };

const r = await window.TnaiTest.open('Terminal');
check(r?.ok, 'PowerShell panel opened');
const A = r.paneId;
await until(async () => (await text(A)).includes(windows ? '>' : '$'), 20000);
await until(() => Date.now() - (session(A)?.lastOutputAt || 0) > 1200, 8000);
const before = new Set(G.sessions().map(s => s.paneId));
const t0 = Date.now();
N.pty.write(A, 'tnai new opencode "reply with OPENCODE-NEW-OK"\r');
check(
  await until(
    async () => /starting it in a new panel/.test((await text(A)).replace(/\s+/g, ' ')),
    15000
  ),
  '`tnai new opencode` accepted'
);
const oc = await until(
  () => G.sessions().find(s => !before.has(s.paneId) && s.agent === 'OpenCode'),
  20000
);
check(!!oc, 'a new OpenCode panel opened' + (oc ? ' (' + oc.name + ')' : ''));
if (oc) {
  const got = await until(
    async () =>
      /FAKE-opencode got: "\[from [^\]]+\] reply with OPENCODE-NEW-OK"/.test(await text(oc.paneId)),
    45000
  );
  if (!got) log.push('   OpenCode tail: ' + JSON.stringify((await text(oc.paneId)).slice(-400)));
  check(
    got,
    'the task reached OpenCode and was submitted with no keypress (' + (Date.now() - t0) + ' ms)'
  );
}

// The sender's note comes once prompt-submit.js is done (a CLI that can't confirm gets its Enter
// retries first).
const notes =
  (await until(async () => {
    const n = (await N.agentEvents.history()).filter(e => e.paneId === A && e.kind === 'mesh-out');
    return n.length && n;
  }, 25000)) || [];

// 25 s, not 15: with this fake (it never shows a started task and prints nothing after the later
// Enters) prompt-submit.js runs every retry before it answers, 1.2 s + 3 × 1.5 s + 6 × 2 s = 17.7 s
// after the task arrived (measured 2026-10-06: the note came 23.2 s after the command).
check(
  notes.length && !notes.some(e => /Not (started|delivered)/.test(e.text || '')),
  'sender note: ' + (notes.map(e => e.text).join(' | ') || 'none')
);
if (oc) N.pty.write(oc.paneId, '\x03');

// --model / --effort (desktop/model-pick.js): names outside the CLI's own list are refused before
// any panel opens; a listed one reaches the CLI as its flag.
const count = () => G.sessions().filter(s => s.agent === 'OpenCode').length,
  had = count();
N.pty.write(A, 'tnai new opencode --effort high "x"\r');
check(
  await until(
    async () => /no separate effort setting/.test((await text(A)).replace(/\s+/g, ' ')),
    15000
  ),
  '`--effort` on OpenCode refused'
);
N.pty.write(A, 'tnai new opencode --model no-such-model "x"\r');
check(
  await until(
    async () =>
      /has no model "no-such-model"\. Its models: big-pickle \(opencode\/big-pickle\)/.test(
        (await text(A)).replace(/\s+/g, ' ')
      ),
    15000
  ),
  'unknown `--model` refused with the list'
);
check(count() === had, 'no panel opened for a refused pick');
const before2 = new Set(G.sessions().map(s => s.paneId));
N.pty.write(A, 'tnai new opencode --model big-pickle "reply with OPENCODE-MODEL-OK"\r');
check(
  await until(
    async () =>
      /OpenCode agent on big-pickle\. Technically Not is starting it/.test(
        (await text(A)).replace(/\s+/g, ' ')
      ),
    15000
  ),
  '`--model big-pickle` accepted'
);
const oc2 = await until(
  () => G.sessions().find(s => !before2.has(s.paneId) && s.agent === 'OpenCode'),
  20000
);
check(!!oc2, 'a second OpenCode panel opened');
if (oc2) {
  check(
    await until(
      async () =>
        /FAKE-opencode args: \[[^\]]*"-m","opencode\/big-pickle"/.test(await text(oc2.paneId)),
      30000
    ),
    'it started with -m opencode/big-pickle'
  );
  check(
    await until(
      async () =>
        /FAKE-opencode got: "\[from [^\]]+\] reply with OPENCODE-MODEL-OK"/.test(
          await text(oc2.paneId)
        ),
      45000
    ),
    'its task arrived'
  );
  N.pty.write(oc2.paneId, '\x03');
}

// --name: the user's own name for the new agent, shown exactly (not a picked one).
const before3 = new Set(G.sessions().map(s => s.paneId));
N.pty.write(A, 'tnai new opencode --name "bug reporter" "reply with OPENCODE-NAME-OK"\r');
check(
  await until(
    async () =>
      /OpenCodeagentnamedbugreporter\.Technically/.test((await text(A)).replace(/\s+/g, '')),
    15000
  ),
  '`--name "bug reporter"` accepted'
);
const oc3 = await until(
  () => G.sessions().find(s => !before3.has(s.paneId) && s.agent === 'OpenCode'),
  20000
);
check(
  oc3?.name === 'bug reporter',
  'the new panel is named exactly "bug reporter" (' + (oc3?.name || 'none') + ')'
);
if (oc3) {
  check(
    await until(
      async () =>
        /FAKE-opencode got: "\[from [^\]]+\] reply with OPENCODE-NAME-OK"/.test(
          await text(oc3.paneId)
        ),
      45000
    ),
    'its task arrived'
  );
  N.pty.write(oc3.paneId, '\x03');
}
await wait(300);
return { ok, log };
