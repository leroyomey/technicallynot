/*
 * Technically Not tools · desktop-check/tests/agent-soak.main.js — Main-process side of
 * agent-soak.js: writes a small output printer (node script, ~40 KB of Claude-Code-like lines in 50
 * ms chunks, then exits), plays one simulated Claude Code task per panel over HTTP to the real
 * desktop/agent-hooks.js server (prompt, tool calls, a sub-agent with its own transcript, Stop)
 * while its transcript file grows, and samples memory after a forced GC in both processes: renderer
 * heap / DOM nodes / listeners over DevTools, main heap, live handles, the per-pane stores (hook
 * history, turns, lifecycle), per-pane hook files and the app's child processes. No agent CLI runs
 * and no prompt reaches a model (no usage).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const v8 = require('v8');
const vm = require('vm');
const { app } = require('electron');

const PRINTER = `
const n = +process.argv[2] || 300; let i = 0;
const t = setInterval(() => {
  let s = '';
  for (let k = 0; k < 20 && i < n; k++, i++) s += '  \\x1b[32m\\u23bf\\x1b[0m  Read src/file-' + i + '.js \\x1b[2m(120 lines)\\x1b[0m output text for the simulated task\\r\\n';
  process.stdout.write(s); if (i >= n) { clearInterval(t); process.stdout.write('\\u23fa Done\\r\\n'); }
}, 50);
`;

module.exports = (win, profile) => {
  v8.setFlagsFromString('--expose_gc');
  const gc = vm.runInNewContext('gc');
  const hooks = require('../../../desktop/agent-hooks');
  const turns = require('../../../desktop/agent-turns');
  const lifecycle = require('../../../desktop/agent-lifecycle');
  const kids = require('./stress-soak.main.js')(win, profile);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-agent-soak-'));
  const printer = path.join(tmp, 'printer.js');
  fs.writeFileSync(printer, PRINTER);
  const dbg = () => {
    const d = win.webContents.debugger;
    if (!d.isAttached()) d.attach('1.3');
    return d;
  };
  const post = (url, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        res => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const line = (file, o) => fs.appendFileSync(file, JSON.stringify(o) + '\n');
  let n = 0;
  return {
    cycles: () => +process.env.TNAI_SOAK_CYCLES || 24,
    progress(s) {
      process.stdout.write('[agent-soak] ' + s + '\n');
      return true;
    },
    printer: () => printer,
    // One Claude Code task for the pane, as its hooks and transcript would show it.
    async turn(paneId, cycle) {
      await hooks.launchOptions(paneId, 'Claude Code');
      const url = hooks.endpoint(paneId)?.hook;
      if (!url) throw new Error('no hook endpoint for ' + paneId);
      const tx = path.join(tmp, paneId.replace(/[^\w-]/g, '_') + '-' + cycle + '.jsonl');
      fs.writeFileSync(tx, '');
      const sid = 'soak-' + paneId + '-' + cycle,
        base = { session_id: sid, transcript_path: tx, cwd: process.cwd() };
      const say = text =>
        line(tx, {
          type: 'assistant',
          uuid: 'u' + ++n,
          message: {
            id: 'msg_' + n,
            role: 'assistant',
            content: [{ type: 'text', text }],
            usage: { input_tokens: 400, output_tokens: 120, cache_creation_input_tokens: 50 },
          },
        });
      await post(url, {
        ...base,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Soak task ' + cycle + ': tidy the readme and check lib',
      });
      for (let k = 0; k < 6; k++) {
        const id = 'toolu_' + ++n,
          [tool, input] = [
            ['Read', { file_path: path.join(process.cwd(), 'README.md') }],
            ['Grep', { pattern: 'soak' }],
            ['Bash', { command: 'echo ' + k }],
          ][k % 3];
        say('Step ' + k + ' of the soak task');
        await post(url, {
          ...base,
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: id,
        });
        await post(url, {
          ...base,
          hook_event_name: 'PostToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: id,
          tool_response: 'ok ' + k,
        });
      }

      // A sub-agent with its own transcript.
      const agentId = 'a' + ++n,
        subDir = path.join(tx.replace(/\.jsonl$/, ''), 'subagents');
      fs.mkdirSync(subDir, { recursive: true });
      const subTx = path.join(subDir, 'agent-' + agentId + '.jsonl');
      line(subTx, {
        type: 'user',
        message: { role: 'user', content: 'Sub task for soak ' + cycle },
      });
      await post(url, {
        ...base,
        hook_event_name: 'SubagentStart',
        agent_id: agentId,
        agent_type: 'general-purpose',
      });
      for (let k = 0; k < 3; k++) {
        const id = 'toolu_' + ++n;
        line(subTx, {
          type: 'assistant',
          message: {
            id: 'msg_s' + n,
            role: 'assistant',
            content: [{ type: 'text', text: 'sub step ' + k }],
            usage: { input_tokens: 100, output_tokens: 30 },
          },
        });
        await post(url, {
          ...base,
          agent_id: agentId,
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: path.join(process.cwd(), 'README.md') },
          tool_use_id: id,
        });
        await post(url, {
          ...base,
          agent_id: agentId,
          hook_event_name: 'PostToolUse',
          tool_name: 'Read',
          tool_input: { file_path: path.join(process.cwd(), 'README.md') },
          tool_use_id: id,
          tool_response: 'ok',
        });
      }
      await post(url, {
        ...base,
        agent_id: agentId,
        hook_event_name: 'SubagentStop',
        agent_transcript_path: subTx,
      });
      say('All done for soak task ' + cycle);
      await wait(50);
      await post(url, {
        ...base,
        hook_event_name: 'Stop',
        last_assistant_message: 'Soak task ' + cycle + ' done.',
      });
      return true;
    },
    peek: ids => {
      const t = turns.state().filter(x => ids.includes(x.paneId));
      return {
        turns: t.length,
        ended: t.filter(x => x.endedAt).length,
        subs: t.reduce((n, x) => n + Object.keys(x.subs || x.subLogs || {}).length, 0),
        hookEvents: hooks.history().length,
      };
    },
    // Both processes after a forced GC.
    async sample() {
      const d = dbg();
      await d.sendCommand('HeapProfiler.enable').catch(() => {});
      await d.sendCommand('HeapProfiler.collectGarbage');
      await d.sendCommand('HeapProfiler.collectGarbage');
      gc();
      gc();
      const dom = await d.sendCommand('Memory.getDOMCounters'),
        heap = await d.sendCommand('Runtime.getHeapUsage');
      const mem = process.memoryUsage(),
        ls = lifecycle.state();
      let hookFiles = -1;
      try {
        hookFiles = fs.readdirSync(path.join(app.getPath('userData'), 'agent-hooks')).length;
      } catch {}
      const handles = {};
      for (const h of process._getActiveHandles()) {
        const k = h?.constructor?.name || '?';
        handles[k] = (handles[k] || 0) + 1;
      }
      const c = await kids.children();
      return {
        heapMB: Math.round((heap.usedSize / 1048576) * 10) / 10,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
        docs: dom.documents,
        mainHeapMB: Math.round((mem.heapUsed / 1048576) * 10) / 10,
        mainRssMB: Math.round(mem.rss / 1048576),
        handles: Object.values(handles).reduce((a, b) => a + b, 0),
        handlesBy: handles,
        requests: process._getActiveRequests().length,
        hookEvents: hooks.history().length,
        turns: turns.state().length,
        instances: ls.instances.length,
        tasks: ls.tasks.length,
        hookFiles,
        children: c.total,
        childrenBy: c.byName,
      };
    },
    cleanup() {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {}
      return true;
    },
  };
};
