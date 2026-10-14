/*
 * Technically Not tools · desktop-check/stress-main-check.js — Main process under many concurrent
 * agents, in plain Node (no Electron, no CLI, no prompt): the real agent-hooks.js / agent-turns.js
 * / agent-lifecycle.js / agent-context.js / agent-graph.js wired as main.js wires them, the real
 * agent-mesh.js socket, watch-service.js on a temp tree and pty-service.js with real PowerShell
 * panes. Load comes from a worker thread (its own event loop), so the main loop's lag is the app's
 * own: N simulated Claude Code sessions post hook events (prompts, tool calls, sub-agents
 * start/stop, Stop) while their transcripts grow; N panes call `tnai agents/read/send`; thousands
 * of file writes; panes printing fast. Reports event-loop delay (p50/p99/max), IPC messages and
 * bytes per channel and per second, heap growth; FAILS on dropped or misordered hook events, a
 * missing mesh reply, or pty output above ~70 batches/s. Usage: node
 * tools/desktop-check/stress-main-check.js [agents=30] [--skip-pty]
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!isMainThread) return void worker();

const Module = require('module');
const { monitorEventLoopDelay } = require('perf_hooks');
const N = Math.max(2, Number(process.argv.find(a => /^\d+$/.test(a))) || 30);
const SKIP_PTY = process.argv.includes('--skip-pty');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-stress-'));
const root = path.join(tmp, 'proj');
fs.mkdirSync(root);
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? {
        app: {
          getPath: () => path.join(tmp, 'user'),
          whenReady: () => new Promise(() => {}),
          on: () => {},
        },
        shell: { openPath: async () => '' },
        dialog: {},
      }
    : load(req, ...rest);
fs.mkdirSync(path.join(tmp, 'user'));

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// IPC to the window, counted per channel (messages and JSON bytes), and the agent:event order per
// pane.
let counts = new Map();
const events = new Map(); // paneId -> [kind…]

function toWindow(channel, payload) {
  const c = counts.get(channel) || { n: 0, bytes: 0 };
  c.n++;
  c.bytes += JSON.stringify(payload ?? null).length;
  counts.set(channel, c);
  if (channel === 'agent:event') {
    if (!events.has(payload.paneId)) events.set(payload.paneId, []);
    events.get(payload.paneId).push(payload);
  }
}

const turns = require('../../desktop/agent-turns');
const hooks = require('../../desktop/agent-hooks');
const lifecycle = require('../../desktop/agent-lifecycle');
const context = require('../../desktop/agent-context');
const graph = require('../../desktop/agent-graph');
const mesh = require('../../desktop/agent-mesh');
const watch = require('../../desktop/watch-service');

// Fake terminals for mesh + context: running Claude Code sessions with ~300 KB of scrollback each.
const scroll = Array.from(
  { length: 4000 },
  (_, i) => '\x1b[32mline ' + i + '\x1b[0m ' + 'x'.repeat(60) + '\r\n'
).join('');
const fakePtys = {
  list: () =>
    [...Array(N).keys()].map(i => ({
      paneId: 'p' + i,
      agent: 'Claude Code',
      mode: 'run',
      running: true,
      startedAt: 1,
      lastOutputAt: Date.now(),
      pid: 1000 + i,
    })),
  replay: () => ({ buffer: scroll }),
};
turns.init((channel, payload) => {
  toWindow(channel, payload);
  if (channel === 'agent:turn') {
    lifecycle.onTurn(payload);
    context.onTurn(payload);
    graph.onTurn(payload);
  }
});
hooks.init(toWindow, { root: () => root });
graph.init(toWindow, { ptys: fakePtys, submit: async () => ({ ok: true, state: 'sent' }) });
lifecycle.init(toWindow, { canResume: () => true, root: () => root });
context.init(toWindow, { ptys: fakePtys, root: () => root });
watch.init(toWindow);
mesh.init(toWindow, {
  ptys: fakePtys,
  submit: async () => {
    await wait(5);
    return { ok: true, state: 'sent' };
  },
  hooks,
  lifecycle,
  context,
  registry: null,
  skills: null,
  projects: async () => [root],
});

// Runs one load phase: the worker drives it, the main loop is measured.
async function phase(name, job, extra = () => {}) {
  counts = new Map();
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  if (global.gc) global.gc();
  const heap0 = process.memoryUsage().heapUsed,
    t0 = Date.now();
  const result = await new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: job });
    w.once('message', resolve);
    w.once('error', reject);
  });
  await extra(result);
  await wait(400); // batches and debounced sends land
  h.disable();
  const secs = (Date.now() - t0) / 1000,
    ms = v => (v / 1e6).toFixed(1);
  const heap = ((process.memoryUsage().heapUsed - heap0) / 1048576).toFixed(1);
  console.log(
    `\n== ${name}: ${secs.toFixed(1)} s, loop delay p50 ${ms(h.percentile(50))} / p99 ${ms(h.percentile(99))} / max ${ms(h.max)} ms, heap +${heap} MB`
  );
  for (const [ch, c] of [...counts].sort((a, b) => b[1].n - a[1].n))
    console.log(
      `   ${ch.padEnd(18)} ${String(c.n).padStart(6)} msgs  ${(c.n / secs).toFixed(0).padStart(5)}/s  ${(c.bytes / 1048576).toFixed(2)} MB`
    );
  return { result, counts, secs, max: h.max / 1e6, p99: h.percentile(99) / 1e6 };
}

(async () => {
  console.log(`${N} simulated agents · temp ${tmp}`);

  // ---- 1. Hooks + turns + lifecycle + context + graph ----
  const panes = {};
  for (let i = 0; i < N; i++) {
    const id = 'p' + i;
    lifecycle.started({
      paneId: id,
      agent: 'Claude Code',
      name: 'Agent ' + i,
      cwd: root,
      sessionId: 'sess-' + i,
    });
    turns.started(id, 'Claude Code', '', 'sess-' + i, root);
    await hooks.launchOptions(id, 'Claude Code');
    panes[id] = hooks.endpoint(id).hook;
  }
  const TOOLS = 40,
    SUBS = 3;
  const r1 = await phase(
    'hooks: ' +
      N +
      ' Claude Code sessions × (prompt, ' +
      TOOLS +
      ' tool calls, ' +
      SUBS +
      ' sub-agents, stop)',
    { kind: 'hooks', panes, dir: tmp, tools: TOOLS, subs: SUBS }
  );
  const expected = [
    'prompt',
    ...Array(SUBS)
      .fill(['sub-start', ...Array((TOOLS / SUBS) | 0).fill('tool'), 'sub-stop'])
      .flat(),
    ...Array(TOOLS).fill('tool'),
    'stop',
  ];
  let dropped = 0,
    misordered = 0;
  for (const id of Object.keys(panes)) {
    const got = events.get(id) || [];
    if (got.length !== expected.length) dropped += Math.abs(expected.length - got.length);
    if (
      got.some((e, i) => i && e.seq <= got[i - 1].seq) ||
      got.map(e => e.kind).join() !== expected.join()
    )
      misordered++;
  }
  check(
    r1.result.errors === 0,
    `every hook POST answered (${r1.result.posts} posts, ${r1.result.errors} errors, ${(r1.result.posts / r1.secs).toFixed(0)}/s)`
  );
  check(
    !dropped && !misordered,
    `no dropped / misordered agent:event (dropped ${dropped}, panes misordered ${misordered})`
  );
  const endedAll = turns.state().filter(t => t.endedAt).length;
  check(endedAll === N, `every task ended with its Stop (${endedAll}/${N})`);
  const turnMsgs = r1.counts.get('agent:turn')?.n || 0,
    life = r1.counts.get('lifecycle:state')?.n || 0;
  console.log(
    `   per hook event: agent:turn ${(turnMsgs / r1.result.posts).toFixed(2)}, lifecycle:state ${(life / r1.result.posts).toFixed(2)}`
  );

  // ---- 2. Agent mesh: tnai agents / read / send from every pane at once ----
  const tokens = {};
  for (let i = 0; i < N; i++) {
    const envFn = await mesh.prepare('p' + i, root, root);
    const env = {};
    envFn(env);
    tokens['p' + i] = env.TNAI_PANE_TOKEN;
    if (i === 0) tokens.port = Number(env.TNAI_MESH_PORT);
  }
  mesh.setNames([...Array(N).keys()].map(i => ({ paneId: 'p' + i, name: 'Agent ' + i })));
  const r2 = await phase('mesh: ' + N + ' panes × 20 mixed tnai agents/read/send', {
    kind: 'mesh',
    tokens,
    n: N,
    each: 20,
    cwd: root,
  });
  check(
    r2.result.errors === 0 && r2.result.replies === N * 20,
    `every mesh request answered ok (${r2.result.replies}/${N * 20}, ${r2.result.errors} errors, ${r2.result.badReads} wrong tnai read texts, slowest ${r2.result.slowest} ms)`
  );

  // ---- 3. File watcher: thousands of rapid writes ----
  watch.start(root);
  await wait(200);
  const FILES = 4000;
  const r3 = await phase('watcher: ' + FILES + ' writes in 40 folders', {
    kind: 'files',
    root,
    files: FILES,
  });
  const fsMsgs = r3.counts.get('fs:changes')?.n || 0;
  check(
    fsMsgs > 0 && fsMsgs < FILES / 10,
    `fs:changes batched (${fsMsgs} messages for ${FILES} writes)`
  );
  watch.stop();

  // ---- 4. pty output bursts: real PowerShell panes printing fast ----
  if (!SKIP_PTY) {
    const ptys = require('../../desktop/pty-service');
    ptys.init(toWindow);
    const P = Math.min(N, 12);
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    for (let i = 0; i < P; i++)
      await ptys.start({ paneId: 'pty' + i, agent: 'Terminal', cwd: root, cols: 120, rows: 30 });
    await wait(1500);
    counts = new Map();
    h.reset();
    const t0 = Date.now();
    for (let i = 0; i < P; i++) ptys.write('pty' + i, '1..40000 | % { "row $_ " + ("y" * 80) }\r');
    await wait(5000);
    h.disable();
    const secs = (Date.now() - t0) / 1000,
      d = counts.get('pty:data') || { n: 0, bytes: 0 };
    console.log(
      `\n== pty: ${P} panes, ${secs.toFixed(1)} s, loop delay p50 ${(h.percentile(50) / 1e6).toFixed(1)} / p99 ${(h.percentile(99) / 1e6).toFixed(1)} / max ${(h.max / 1e6).toFixed(1)} ms`
    );
    console.log(
      `   pty:data ${d.n} msgs ${(d.n / secs).toFixed(0)}/s ${(d.bytes / 1048576).toFixed(2)} MB`
    );
    check(
      d.n / secs < 70 && d.bytes > 1e5,
      `pty output batched across panes (${(d.n / secs).toFixed(0)} msgs/s, ${(d.bytes / 1048576).toFixed(1)} MB)`
    );
    ptys.stopAll();
    await wait(1500);
  }

  hooks.stop();
  mesh.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '\nPASS' : '\nFAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});

// ---------- Load generator (worker thread) ----------
async function worker() {
  const http = require('http'),
    net = require('net');
  const job = workerData;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  let errors = 0,
    posts = 0;
  const post = (url, body) =>
    new Promise(resolve => {
      const data = JSON.stringify(body),
        u = new URL(url);
      const req = http.request(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          agent,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(data),
          },
        },
        res => {
          res.resume();
          res.on('end', () => {
            posts++;
            if (res.statusCode !== 200) errors++;
            resolve();
          });
        }
      );
      req.on('error', () => {
        errors++;
        resolve();
      });
      req.end(data);
    });
  const usage = (id, n) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        id,
        model: 'claude-test',
        role: 'assistant',
        content: [
          { type: 'text', text: 'step ' + n + ' ' + 'z'.repeat(300) },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/f' + n + '.js' } },
        ],
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000 },
      },
    }) + '\n';

  if (job.kind === 'hooks') {
    await Promise.all(
      Object.entries(job.panes).map(async ([paneId, url]) => {
        const tx = path.join(job.dir, paneId + '.jsonl');
        fs.writeFileSync(tx, ''); // one folder, as Claude Code keeps a project's transcripts
        const base = { session_id: paneId, transcript_path: tx, cwd: job.dir };
        await post(url, {
          ...base,
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Build feature ' + paneId,
        });
        let m = 0;
        for (let s = 0; s < job.subs; s++) {
          const agent_id = 'a' + s,
            file = path.join(job.dir, paneId + '-sub' + s + '.jsonl');
          fs.writeFileSync(
            file,
            JSON.stringify({ type: 'user', message: { role: 'user', content: 'sub task ' + s } }) +
              '\n'
          );
          const sub = {
            ...base,
            agent_id,
            agent_type: 'general-purpose',
            agent_transcript_path: file,
          };
          await post(url, { ...sub, hook_event_name: 'SubagentStart' });
          for (let k = 0; k < ((job.tools / job.subs) | 0); k++) {
            fs.appendFileSync(file, usage(paneId + 's' + s + 'm' + k, k));
            await post(url, {
              ...sub,
              hook_event_name: 'PreToolUse',
              tool_name: 'Read',
              tool_input: { file_path: 'src/s' + k + '.js' },
            });
            await post(url, {
              ...sub,
              hook_event_name: 'PostToolUse',
              tool_name: 'Read',
              tool_input: { file_path: 'src/s' + k + '.js' },
              tool_response: 'ok',
            });
          }
          await post(url, {
            ...sub,
            hook_event_name: 'SubagentStop',
            last_assistant_message: 'sub ' + s + ' done',
          });
        }
        for (let k = 0; k < job.tools; k++) {
          fs.appendFileSync(tx, usage(paneId + 'm' + m++, k));
          await post(url, {
            ...base,
            hook_event_name: 'PreToolUse',
            tool_name: 'Edit',
            tool_input: { file_path: path.join(job.dir, 'proj', 'f' + k + '.js') },
          });
          await post(url, {
            ...base,
            hook_event_name: 'PostToolUse',
            tool_name: 'Edit',
            tool_input: { file_path: path.join(job.dir, 'proj', 'f' + k + '.js') },
            tool_response: 'ok',
          });
        }
        await post(url, {
          ...base,
          hook_event_name: 'Stop',
          last_assistant_message:
            'Done with ' + paneId + '.\n\nTechnically Not report\n- Did: built it',
        });
      })
    );
    return parentPort.postMessage({ posts, errors });
  }
  if (job.kind === 'mesh') {
    let replies = 0,
      slowest = 0,
      badReads = 0;
    const call = msg =>
      new Promise(resolve => {
        const t0 = Date.now(),
          s = net.connect(job.tokens.port, '127.0.0.1');
        let buf = '';
        s.setEncoding('utf8');
        s.on('data', d => {
          buf += d;
        });
        s.on('error', () => {
          errors++;
          resolve();
        });
        s.on('close', () => {
          slowest = Math.max(slowest, Date.now() - t0);
          try {
            const r = JSON.parse(buf);
            if (!r.ok) errors++;
            else if (
              msg.op === 'read' &&
              (r.text.split('\n').length !== 200 || !/\nline 3999 x+$/.test(r.text))
            )
              badReads++;
            else replies++;
          } catch {
            errors++;
          }
          resolve();
        });
        s.write(JSON.stringify(msg) + '\n');
      });
    const ops = ['agents', 'read', 'send'];
    await Promise.all(
      [...Array(job.n).keys()].map(async i => {
        const token = job.tokens['p' + i];
        await Promise.all(
          [...Array(job.each).keys()].map(k => {
            // Always another pane: the mesh never lists or reaches the sender itself (small N used
            // to wrap onto self).
            const op = ops[k % 3],
              to = 'Agent ' + ((i + 1 + (k % (job.n - 1))) % job.n);
            return call({
              token,
              cwd: job.cwd,
              op,
              ...(op === 'read'
                ? { from: to, lines: 200 }
                : op === 'send'
                  ? { to, text: 'hello ' + k }
                  : {}),
            });
          })
        );
      })
    );
    return parentPort.postMessage({ replies, errors, slowest, badReads });
  }
  if (job.kind === 'files') {
    for (let d = 0; d < 40; d++)
      fs.mkdirSync(path.join(job.root, 'dir' + d, 'deep'), { recursive: true });
    for (let i = 0; i < job.files; i++) {
      fs.writeFileSync(path.join(job.root, 'dir' + (i % 40), 'deep', 'f' + i + '.txt'), 'x' + i);
      if (i % 200 === 0) await new Promise(r => setTimeout(r, 5));
    }
    return parentPort.postMessage({});
  }
}
