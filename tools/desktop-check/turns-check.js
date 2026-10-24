/*
 * Technically Not tools · desktop-check/turns-check.js — Queued prompts + task clock
 * (desktop/agent-turns.js) in plain Node, from simulated pane writes, Claude Code hook payloads,
 * transcript lines and a Codex rollout. Claude Code 2.x fires its prompt hook at SUBMIT time while
 * the task runs: the prompt stays queued until the running task stops (then it runs as the next
 * task, merged) or the transcript's queue-operation "remove" says it was absorbed mid-turn; Esc
 * clears; a CLI that fires the hook at start still works; the task-ended cleanup; Codex
 * user_message. No CLI runs. Usage: node tools/desktop-check/turns-check.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const turns = require('../../desktop/agent-turns');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-turns-'));
const tx = path.join(tmp, 'session.jsonl');
fs.writeFileSync(tx, '');
const refused = [];
turns.init(() => {}, { spawnRefused: (paneId, id) => refused.push(paneId + ':' + id) });
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'p1';
const get = (id = P) => turns.state().find(t => t.paneId === id);
const queued = (id = P) => (get(id)?.queued || []).length;

// Files opened at once (blocking) during a hook, counted: a tool call's hook must open none
// (stalls.log 2026-10-07: 44 stalls of 150 to 430 ms).
const calls = { sync: 0 },
  openSync = fs.openSync;
fs.openSync = (...a) => {
  calls.sync++;
  return openSync(...a);
};
const hook = h => {
  calls.sync = 0;
  return turns.claudeHook(P, { transcript_path: tx, ...h });
};
const send = (text, id = P) => {
  turns.wrote(id, '\x1b[200~' + text + '\x1b[201~');
  turns.wrote(id, '\r');
};
const ONE = '[TN.ai] [New task while you work on "count"] ... ONE',
  TWO = '[TN.ai] [New task while you work on "count"] ... TWO';

(async () => {
  turns.started(P, 'Claude Code', '', '');

  // 1. The measured sequence: prompt hooks for queued prompts ~150 ms after each is sent, while the
  // first task runs.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Count from 1 to 700' });
  const start = get().startedAt;
  await wait(20);
  send(ONE);
  check(queued() === 1, 'sent while running → 1 queued');

  // The queue shows only the user's words, never the app's wrapper (screenshot 2026-10-24).
  const shownP = 'p-shown';
  turns.started(shownP, 'Claude Code', '', '');
  turns.claudeHook(shownP, {
    transcript_path: tx,
    hook_event_name: 'UserPromptSubmit',
    prompt: '[TN.ai] Busy',
  });
  send(
    '[TN.ai] [New task while you work on "<agent-message from="a8f8">"] If it belongs to that work, fold it in. New task: Why square designs?',
    shownP
  );
  check(
    get(shownP)?.queued?.[0]?.text === 'Why square designs?',
    'queued prompt shows only the user words: ' + JSON.stringify(get(shownP)?.queued?.[0]?.text)
  );
  await wait(150);
  hook({ hook_event_name: 'UserPromptSubmit', prompt: ONE });
  check(
    queued() === 1,
    'prompt hook at submit time keeps it queued (was removed ~15 ms after it was added)'
  );
  send(TWO);
  await wait(150);
  hook({ hook_event_name: 'UserPromptSubmit', prompt: TWO });
  check(
    queued() === 2 && get().startedAt === start && /700/.test(get().task) && !get().endedAt,
    'both queued; task clock, task text unchanged: ' + queued()
  );
  await wait(20);
  hook({ hook_event_name: 'Stop', last_assistant_message: '1 2 3 … 700' });
  const t2 = get();
  check(
    queued() === 0 &&
      !t2.endedAt &&
      t2.startedAt > start &&
      /ONE/.test(t2.task) &&
      /TWO/.test(t2.task),
    'running task stops → queued prompts run as the next task (merged), queue 0: ' +
      JSON.stringify(t2.task).slice(-40)
  );
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ONE\n\nTWO' });
  check(
    get().endedAt && get().result === 'ONE\n\nTWO' && queued() === 0,
    'the follow-up task ends with its own answer'
  );

  // 2. Absorbed between tool calls: the transcript's queue-operation "remove" takes it; Stop then
  // starts nothing.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Refactor the footer' });
  send('THREE');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'THREE' });
  check(queued() === 1, 'third prompt queued');
  fs.appendFileSync(
    tx,
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'THREE' }) +
      '\n' +
      JSON.stringify({
        type: 'queue-operation',
        operation: 'remove',
        content: 'THREE',
        reason: 'absorbed_mid_turn',
      }) +
      '\n'
  );
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  check(
    calls.sync === 0,
    "a tool call's hook reads no file at once, the main process is not held (" +
      calls.sync +
      ' opens)'
  );

  // a tool call's hook reads the transcript off the main loop; only a task's end reads at once
  await wait(60);
  check(
    queued() === 0 && !get().endedAt,
    'transcript "remove" (absorbed mid-turn) takes it; the task goes on'
  );
  const t3 = get().startedAt;
  fs.appendFileSync(
    tx,
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      effort: 'xhigh',
      perTurnEffort: 'xhigh',
      message: {
        id: 'msg_eff1',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 4,
          cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 0 },
        },
      },
    }) + String.fromCharCode(10)
  );
  hook({ hook_event_name: 'Stop', last_assistant_message: 'done' });
  check(
    get().context?.cacheTtlMs === 300000,
    'Claude Code reply that wrote a 5-minute cache: the lifetime is on the context (' +
      get().context?.cacheTtlMs +
      ')'
  );
  check(
    get().effort === 'xhigh' && get().effortAt > 0 && get().model === 'claude-opus-5-5',
    'Claude Code reply: its real effort and model are on the turn (' + get().effort + ')'
  );
  check(
    get().endedAt && get().startedAt === t3,
    'Stop after an absorbed prompt starts no follow-up task'
  );

  // 2b. A refused Agent launch (no PostToolUse/SubagentStart): its error tool_result in the lead's
  // transcript reports it, once; another tool's error and an accepted Agent call don't.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Launch helpers' });
  const J = o => JSON.stringify(o) + '\n',
    use = (id, name) =>
      J({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
  const res = (id, err) =>
    J({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            is_error: !!err,
            content: err ? 'Permission denied' : 'ok',
          },
        ],
      },
    });
  fs.appendFileSync(
    tx,
    use('ag_no', 'Agent') +
      use('ag_ok', 'Agent') +
      use('bash_no', 'Bash') +
      res('ag_no', true) +
      res('ag_ok') +
      res('bash_no', true) +
      res('ag_no', true)
  );
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  await wait(60);
  check(
    refused.join() === P + ':ag_no',
    'refused Agent launch reported once from the transcript; accepted call and Bash error not (' +
      refused.join() +
      ')'
  );
  hook({ hook_event_name: 'Stop', last_assistant_message: 'done' });

  // 3. Esc pulls queued prompts back: queue cleared, no follow-up task.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Write tests' });
  send('FOUR');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'FOUR' });
  turns.wrote(P, '\x1b');
  check(queued() === 0, 'Esc clears the queue');
  const t4 = get().startedAt;
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  check(get().endedAt && get().startedAt === t4, 'no follow-up task after Esc');

  // 4. A <task-notification> (sub-agent hand-back) while running is not a waiting prompt.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Lead task' });
  const t5 = get().startedAt;
  hook({
    hook_event_name: 'UserPromptSubmit',
    prompt: '<task-notification>\n<status>completed</status>\n</task-notification>',
  });
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  check(
    get().endedAt && get().startedAt === t5 && /Lead task/.test(get().task),
    'task-notification keeps the task and starts no follow-up'
  );

  // 5. A CLI that fires the prompt hook only when it starts the prompt: queued until then, taken by
  // that hook.
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Old-style task' });
  send('FIVE');
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  check(queued() === 1 && get().endedAt, 'no hook yet: still queued after Stop');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'FIVE' });
  check(
    queued() === 0 && !get().endedAt && get().task === 'FIVE',
    'its hook after Stop starts it and takes it from the queue'
  );

  // 6. Codex: user_message takes a queued prompt; a task_started while running keeps the clock.
  const home = path.join(tmp, 'codex'),
    day = path.join(home, 'sessions', '2026', '09', '24');
  fs.mkdirSync(day, { recursive: true });
  const roll = path.join(day, 'rollout-x-cdx1.jsonl');
  fs.writeFileSync(roll, '');
  const ev = (type, extra = {}) =>
    JSON.stringify({
      type: 'event_msg',
      timestamp: new Date().toISOString(),
      payload: { type, ...extra },
    }) + '\n';
  turns.started('c1', 'Codex', home, 'cdx1');
  fs.appendFileSync(roll, ev('task_started') + ev('user_message', { message: 'Codex task' }));
  await wait(400);
  const cs = get('c1')?.startedAt;
  send('SIX', 'c1');
  check(queued('c1') === 1, 'Codex: queued while running');
  fs.appendFileSync(roll, ev('task_started') + ev('user_message', { message: 'SIX' }));
  await wait(400);
  check(
    queued('c1') === 0 && get('c1')?.startedAt === cs,
    'Codex: user_message takes it, clock kept'
  );

  // 6a. Codex's own plan window (real rate_limits shape, 2026-09-27): a task's share = rise of
  // used_percent in the same window; shared = another Codex panel on the same account worked at the
  // same time.
  const rl = used => ({
    rate_limits: {
      limit_id: 'codex',
      primary: { used_percent: used, window_minutes: 300, resets_at: 1792167931 },
      secondary: null,
      plan_type: 'plus',
    },
  });
  fs.appendFileSync(
    roll,
    ev('token_count', rl(40)) +
      ev('token_count', rl(43.5)) +
      ev('task_complete', { last_agent_message: 'done' })
  );
  await wait(400);
  const p1 = get('c1')?.plan;
  check(
    p1 &&
      p1.used === 3.5 &&
      p1.window === 300 &&
      p1.plan === 'plus' &&
      p1.left === 56.5 &&
      p1.shared === false,
    'Codex: task plan share from rate_limits: ' + JSON.stringify(p1)
  );
  const roll3 = path.join(day, 'rollout-x-cdx2.jsonl');
  fs.writeFileSync(roll3, '');
  turns.started('c2', 'Codex', home, 'cdx2');
  fs.appendFileSync(
    roll,
    ev('task_started') + ev('user_message', { message: 'SEVEN' }) + ev('token_count', rl(50))
  );
  fs.appendFileSync(
    roll3,
    ev('task_started') + ev('user_message', { message: 'other' }) + ev('token_count', rl(51))
  );
  await wait(400);
  fs.appendFileSync(
    roll,
    ev('token_count', rl(55)) + ev('task_complete', { last_agent_message: 'done' })
  );
  await wait(400);
  check(
    get('c1')?.plan?.shared === true && get('c1').plan.used === 5,
    'Codex: a task while another Codex panel on the same account works is marked shared'
  );
  turns.forget('c2');

  // 6b. Codex 0.155.1 (real rollout of 2026-09-24, trimmed): session_meta line ~19 KB
  // (base_instructions) so the 4 KB head read is not whole JSON, no user_message events (prompts
  // are item_completed UserMessage items), queued prompts absorbed into the running turn.
  const store = require('../../desktop/session-store');
  const now = new Date(),
    since = Date.now();
  const day2 = path.join(
    home,
    'sessions',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  );
  const cwd = path.join(
    tmp,
    'Temp',
    'claude',
    'C--Users-someone-OneDrive-Desktop-Project-Tnai',
    '50fe8f16-01d3-4fa5-baf6-5aa77f8242ae',
    'scratchpad',
    'proj'
  );
  const sid = '01a0d627-c141-77b1-9c91-40ea93e4fde9',
    tid = '01a0d628-ed4f-7431-a788-6211f0292ea9';
  const line = (type, payload) =>
    JSON.stringify({ timestamp: new Date().toISOString(), ordinal: 0, type, payload }) + '\n';
  const um = text =>
    line('event_msg', {
      type: 'item_completed',
      thread_id: sid,
      turn_id: tid,
      item: { type: 'UserMessage', id: 'u', content: [{ type: 'text', text, text_elements: [] }] },
    });
  fs.mkdirSync(day2, { recursive: true });
  const roll2 = path.join(day2, 'rollout-2026-09-24T19-22-04-' + sid + '.jsonl');
  await wait(50);
  turns.started('c2', 'Codex', home, '');
  fs.writeFileSync(
    roll2,
    line('session_meta', {
      session_id: sid,
      id: sid,
      timestamp: new Date().toISOString(),
      cwd,
      runtime_workspace_roots: [cwd],
      originator: 'codex-tui',
      cli_version: '0.155.1',
      source: 'cli',
      base_instructions: { text: 'You are Codex. '.repeat(1250) },
    }) +
      line('event_msg', { type: 'task_started', turn_id: tid, model_context_window: 258400 }) +
      line('turn_context', { turn_id: tid, cwd, model: 'gpt-6-luna' }) +
      um(
        'Without running any commands, count from 1 to 400 in your reply, one number per line, then write DONE.'
      )
  );
  const found = await store.findCodexSession(since, cwd, home);
  check(found === sid, 'Codex 0.155.1: session found from a 19 KB session_meta line: ' + found);
  turns.fromPty('pty:session', { paneId: 'c2', sessionId: found });
  await wait(100);
  const c2 = get('c2');
  check(
    c2 && !c2.endedAt && /count from 1 to 400/.test(c2.task) && c2.model === 'gpt-6-luna',
    'Codex 0.155.1: turn tracked with task text and model'
  );
  send('Next, reply with the word ONE.', 'c2');
  send('Then reply with the word TWO.', 'c2');
  check(queued('c2') === 2, 'Codex 0.155.1: 2 queued while running');
  fs.appendFileSync(
    roll2,
    line('event_msg', {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 21274, cached_input_tokens: 1792, output_tokens: 805 },
        last_token_usage: { input_tokens: 21274 },
        model_context_window: 258400,
      },
    }) +
      um('Next, reply with the word ONE.') +
      um('Then reply with the word TWO.')
  );
  await wait(400);
  check(
    queued('c2') === 0 &&
      get('c2')?.startedAt === c2.startedAt &&
      get('c2')?.tokens?.output === 805,
    'Codex 0.155.1: UserMessage items take the queued prompts, clock kept, tokens'
  );
  fs.appendFileSync(
    roll2,
    line('event_msg', { type: 'task_complete', turn_id: tid, last_agent_message: 'ONE' })
  );
  await wait(400);
  check(
    get('c2')?.endedAt && get('c2')?.result === 'ONE',
    'Codex 0.155.1: task_complete ends it with the result'
  );
  turns.forget('c2');

  // 7. Task ended and the CLI started nothing: cleared after a few seconds.
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Last task' });
  send('SEVEN');
  turns.forget('c1');
  hook({ hook_event_name: 'Stop', last_assistant_message: 'ok' });
  check(queued() === 1, 'queued right after Stop (no hook fired for it)');
  await wait(5300);
  check(queued() === 0, 'cleared 5 s after the task ended with nothing started');

  // 8. Sub-agents carried into the next task: a working one moves along; one silent for 30+ min
  // (killed by a usage limit, no SubagentStop) stays behind.
  const P8 = 'p8',
    tx8 = path.join(tmp, 's8.jsonl');
  fs.writeFileSync(tx8, '');
  const hook8 = h => turns.claudeHook(P8, { transcript_path: tx8, ...h });
  turns.started(P8, 'Claude Code', '', '');
  hook8({ hook_event_name: 'UserPromptSubmit', prompt: 'lead task' });
  for (const id of ['live', 'dead']) {
    const f = path.join(tmp, 'agent-' + id + '.jsonl');
    fs.writeFileSync(
      f,
      JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'sub task ' + id },
      }) + '\n'
    );
    hook8({ hook_event_name: 'PreToolUse', agent_id: id, agent_transcript_path: f });
  }
  const old = new Date(Date.now() - 45 * 60e3);
  fs.utimesSync(path.join(tmp, 'agent-dead.jsonl'), old, old);
  hook8({ hook_event_name: 'StopFailure' });
  hook8({ hook_event_name: 'UserPromptSubmit', prompt: 'after the limit' });
  const subs8 = Object.keys(get(P8)?.subLog || {});
  check(
    subs8.includes('live') && !subs8.includes('dead'),
    'next task carries the working sub-agent, not the one silent 45 min: ' + subs8.join(',')
  );
  turns.forget(P8);

  // 9. Esc right after a prompt, before any reply (Claude Code puts the prompt back and writes
  // nothing, no Stop hook): the task ends instead of ticking "Working" forever; a later hook from
  // that task opens it again; Esc on a task that already replied ends nothing.
  const P9 = 'p9',
    tx9 = path.join(tmp, 's9.jsonl');
  fs.writeFileSync(tx9, '');
  const hook9 = h => turns.claudeHook(P9, { transcript_path: tx9, ...h });
  turns.started(P9, 'Claude Code', '', '');
  hook9({ hook_event_name: 'UserPromptSubmit', prompt: 'Remains 1: something' });
  turns.wrote(P9, '\x1b');
  await wait(1800);
  check(
    get(P9)?.endedAt && get(P9).endedBy === 'interrupted',
    'instant Esc before any reply ends the task: ' + get(P9)?.endedBy
  );
  hook9({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  check(
    !get(P9).endedAt,
    'a hook from the same task after that opens it again (the Esc only closed a menu)'
  );
  fs.appendFileSync(
    tx9,
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        id: 'msg_r9',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    }) + '\n'
  );
  hook9({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} });
  turns.wrote(P9, '\x1b');
  await wait(1800);
  check(
    !get(P9).endedAt,
    'Esc on a task that already replied waits for the CLI (interrupt line / Stop), ends nothing itself'
  );
  hook9({ hook_event_name: 'Stop', last_assistant_message: 'done' });
  check(
    get(P9).endedAt && get(P9).endedBy === 'stop' && get(P9).result === 'done',
    'its Stop still ends it with the answer'
  );
  turns.forget(P9);

  // 10. Steps from the agent's own checklist: Claude Code TodoWrite, TaskCreate/TaskUpdate (real
  // response shape), sub-agents ignored; Codex update_plan.
  const P10 = 'p10',
    tx10 = path.join(tmp, 's10.jsonl');
  fs.writeFileSync(tx10, '');
  const hook10 = h => turns.claudeHook(P10, { transcript_path: tx10, ...h });
  turns.started(P10, 'Claude Code', '', '');
  hook10({ hook_event_name: 'UserPromptSubmit', prompt: 'build it' });
  check(get(P10).steps === null, 'no checklist: no steps');
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TodoWrite',
    tool_input: {
      todos: [
        { content: 'Read', activeForm: 'Reading the code', status: 'completed' },
        { content: 'Build', activeForm: 'Building the feature', status: 'in_progress' },
        { content: 'Test', status: 'pending' },
      ],
    },
  });
  let sp = get(P10).steps;
  check(
    sp && sp.index === 2 && sp.total === 3 && sp.done === 1 && sp.text === 'Building the feature',
    'TodoWrite: step 2 of 3 with its own words: ' + JSON.stringify(sp)
  );
  hook10({
    hook_event_name: 'PostToolUse',
    agent_id: 'sub1',
    tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'Sub step', status: 'in_progress' }] },
  });
  check(
    get(P10).steps.text === 'Building the feature',
    "a sub-agent's checklist does not replace the main one"
  );
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TodoWrite',
    tool_input: {
      todos: [
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'completed' },
      ],
    },
  });
  check(get(P10).steps === null, 'every step done: nothing shown');
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskCreate',
    tool_input: { subject: 'Audit docs', activeForm: 'Auditing docs' },
    tool_response: { task: { id: '1', subject: 'Audit docs' } },
  });
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskCreate',
    tool_input: { subject: 'Fix links' },
    tool_response: { task: { id: '2', subject: 'Fix links' } },
  });
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskUpdate',
    tool_input: { taskId: '1', status: 'completed' },
    tool_response: { success: true, taskId: '1' },
  });
  hook10({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskUpdate',
    tool_input: { taskId: '2', status: 'in_progress' },
    tool_response: { success: true, taskId: '2' },
  });
  sp = get(P10).steps;
  check(
    sp && sp.total === 4 && sp.index === 4 && sp.text === 'Fix links',
    'TaskCreate/TaskUpdate added to the list: ' + JSON.stringify(sp)
  );
  hook10({ hook_event_name: 'Stop', last_assistant_message: 'done' });
  check(get(P10).steps === null, 'task ended: no steps');
  turns.forget(P10);
  const roll10 = path.join(day, 'rollout-x-cdx10.jsonl');
  fs.writeFileSync(roll10, '');
  turns.started('c10', 'Codex', home, 'cdx10');
  const plan = steps =>
    JSON.stringify({
      type: 'response_item',
      timestamp: new Date().toISOString(),
      payload: {
        type: 'function_call',
        name: 'update_plan',
        arguments: JSON.stringify({ plan: steps }),
        call_id: 'c',
      },
    }) + '\n';
  fs.appendFileSync(
    roll10,
    ev('task_started') +
      ev('user_message', { message: 'plan it' }) +
      plan([
        { step: 'Find the bug', status: 'completed' },
        { step: 'Fix it', status: 'in_progress' },
        { step: 'Test', status: 'pending' },
      ])
  );
  await wait(400);
  sp = get('c10')?.steps;
  check(
    sp && sp.index === 2 && sp.total === 3 && sp.text === 'Fix it',
    'Codex update_plan: step 2 of 3: ' + JSON.stringify(sp)
  );
  turns.forget('c10');

  // 11. Sub-agents' tokens without holding the main process: a tool call's hook opens no file at
  // once however many sub-agents run; every sub-agent's tokens still arrive (its own watcher and
  // hooks); a read that is still under way when the task stops is not counted twice and not on the
  // next task.
  const P11 = 'p11',
    dir11 = path.join(tmp, 's11'),
    tx11 = path.join(dir11, 'lead.jsonl');
  fs.mkdirSync(dir11);
  fs.writeFileSync(tx11, '');
  const hook11 = h => {
    calls.sync = 0;
    return turns.claudeHook(P11, { transcript_path: tx11, ...h });
  };
  const use11 = (id, n) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        id,
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: n, output_tokens: 1 },
      },
    }) + '\n';
  turns.started(P11, 'Claude Code', '', '');
  hook11({ hook_event_name: 'UserPromptSubmit', prompt: 'lead with six sub-agents' });
  const subFile = i => path.join(dir11, 'agent-s' + i + '.jsonl');
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(subFile(i), use11('s' + i + 'a', 100));
    hook11({
      hook_event_name: 'SubagentStart',
      agent_id: 's' + i,
      agent_transcript_path: subFile(i),
    });
  }
  await wait(60);
  for (let i = 0; i < 6; i++) fs.appendFileSync(subFile(i), use11('s' + i + 'b', 10));
  hook11({
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: {},
    agent_id: 's0',
    agent_transcript_path: subFile(0),
  });
  check(
    calls.sync === 0,
    "a sub-agent's tool call with six sub-agents running opens no file at once (" +
      calls.sync +
      '; it was one per running sub-agent plus the lead)'
  );
  await wait(250);
  const st11 = get(P11).subTokens;
  check(
    Object.keys(st11).length === 6 && Object.values(st11).every(v => v === 112),
    "every sub-agent's tokens arrive without a hook of its own (its watcher): " +
      JSON.stringify(st11)
  );
  send('NEXT', P11);
  hook11({ hook_event_name: 'UserPromptSubmit', prompt: 'NEXT' });
  fs.appendFileSync(tx11, use11('lead1', 1000));
  fs.appendFileSync(subFile(1), use11('s1c', 5));

  // its read is under way…
  hook11({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} });

  // …when the task stops and the waiting prompt starts the next one
  hook11({ hook_event_name: 'Stop', last_assistant_message: 'first done' });
  check(
    calls.sync === 7,
    "a task's end reads the lead and every running sub-agent at once, in order (" +
      calls.sync +
      ' opens)'
  );
  const next11 = get(P11);
  check(
    /NEXT/.test(next11.task) && !next11.endedAt && next11.tokens === null,
    'the next task starts with no tokens of the task before it: ' + JSON.stringify(next11.tokens)
  );
  await wait(250);
  check(
    get(P11).tokens === null && get(P11).subTokens.s1 === 118,
    'the read that was under way adds nothing to the next task; a sub-agent carried along keeps its own count (' +
      JSON.stringify(get(P11).tokens) +
      ', ' +
      get(P11).subTokens.s1 +
      ')'
  );
  turns.forget(P11);

  // 12. A prompt sent while the reply is being written (Claude Code 2.1.x, read from a real log of
  // 2026-10-10): the CLI starts it at once (a "dequeue" with no text, then the prompt's own record)
  // and fires no Stop for the reply before it. The one Stop that follows ends the work: no task is
  // left running that the CLI never started.
  const P12 = 'p12',
    tx12 = path.join(tmp, 'twelve.jsonl');
  fs.writeFileSync(tx12, '');
  const hook12 = h => turns.claudeHook(P12, { transcript_path: tx12, ...h });
  const write12 = records =>
    fs.appendFileSync(tx12, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  turns.started(P12, 'Claude Code', '', '');
  hook12({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the test windows' });
  const start12 = get(P12).startedAt;
  await wait(5);
  hook12({ hook_event_name: 'UserPromptSubmit', prompt: 'What are you doing.' });
  write12([
    { type: 'queue-operation', operation: 'enqueue', content: 'What are you doing.' },
    { type: 'queue-operation', operation: 'dequeue' },
    { type: 'user', message: { role: 'user', content: 'What are you doing.' } },
  ]);
  hook12({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
  await wait(250);
  check(
    !!get(P12).endedAt && get(P12).startedAt === start12 && get(P12).endedBy === 'stop',
    'a waiting prompt the CLI already started is not started again at the Stop: the task is over (' +
      (get(P12).endedAt ? 'ended' : 'still running: "' + get(P12).task + '"') +
      ')'
  );
  await wait(5);
  hook12({ hook_event_name: 'UserPromptSubmit', prompt: 'Whats next.' });
  check(
    get(P12).startedAt > start12 && /Whats next/.test(get(P12).task) && !get(P12).endedAt,
    'the prompt after it starts its own task instead of waiting behind one that never ran'
  );
  hook12({ hook_event_name: 'Stop', last_assistant_message: 'This.' });
  check(!!get(P12).endedAt, '…and that task ends at its Stop');

  // A note of the CLI's own (a held finish) is a user record too: it takes no waiting prompt, which
  // still starts the next task at the Stop.
  await wait(5);
  hook12({ hook_event_name: 'UserPromptSubmit', prompt: 'Count the files' });
  hook12({ hook_event_name: 'UserPromptSubmit', prompt: 'Then list them' });
  write12([
    { type: 'user', message: { role: 'user', content: 'Stop hook feedback: read the skill.' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  ]);
  hook12({ hook_event_name: 'Stop', last_assistant_message: '12 files.' });
  check(
    /Then list them/.test(get(P12).task) && !get(P12).endedAt,
    'a prompt still waiting at the Stop starts the next task, as before'
  );
  turns.forget(P12);

  turns.forget(P);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
