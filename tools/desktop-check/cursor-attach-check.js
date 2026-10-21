/*
 * Technically Not tools · desktop-check/cursor-attach-check.js — a Cursor Agent chat read at a
 * panel start (desktop/agent-turns.js attachCursor), in plain Node, no CLI and no model call. A
 * resumed chat is read whole once to show its last task; that read must not hold the main loop
 * (it opened and read the whole file at once, many MB for a long chat). Checks: no file opened at
 * once by the start, the last task shown as history, then a follow-up prompt and its end read
 * live, including Cursor's way of writing the next prompt over its turn_ended line.
 * Usage: node tools/desktop-check/cursor-attach-check.js [a saved Cursor chat .jsonl to measure]
 * (the chat is copied to a temporary folder and only sizes and times are printed, never its
 * text). Exit code 1 when a check fails.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// A home of its own, so cursor-store.js finds the chat here and never the user's real ~/.cursor.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-cursor-attach-'));
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
const turns = require('../../desktop/agent-turns');
const cursorStore = require('../../desktop/cursor-store');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(test, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await wait(10);
  }
  return test();
}

// Files opened at once (blocking the main loop), counted around the panel start.
const counted = { sync: 0 },
  openSync = fs.openSync;
fs.openSync = (...args) => {
  counted.sync++;
  return openSync(...args);
};

const userLine = text =>
  JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: '<user_query>\n' + text + '\n</user_query>' }] },
  });
const answerLine = text =>
  JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text }] } });
const endLine = JSON.stringify({ type: 'turn_ended', status: 'success' });

// A long chat when none is given: 2,000 tasks, each with a long answer (about 4 MB).
function syntheticChat() {
  const lines = [];
  const filler = 'x'.repeat(1800);
  for (let i = 1; i <= 2000; i++) {
    lines.push(userLine('Task number ' + i));
    lines.push(answerLine('Working on ' + i + ' ' + filler));
    lines.push(answerLine('Answer ' + i));
    lines.push(endLine);
  }
  return lines.join('\n') + '\n';
}

// What the reader shows of a task, without its clock times (taken at the moment of the read).
const shown = t =>
  t &&
  JSON.stringify({
    agent: t.agent,
    task: t.task,
    result: t.result,
    endedBy: t.endedBy || '',
    ended: !!t.endedAt,
    history: !!t.history,
    tokens: t.tokens ?? null,
  });

(async () => {
  turns.init(() => {});
  const cwd = path.join(tmp, 'project');
  const chatId = 'chat-attach-check';
  const dir = path.join(
    tmp,
    '.cursor',
    'projects',
    cursorStore.slug(cwd),
    'agent-transcripts',
    chatId
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, chatId + '.jsonl');
  const given = process.argv[2];
  if (given) fs.copyFileSync(given, file);
  else fs.writeFileSync(file, syntheticChat());
  const size = fs.statSync(file).size;
  check(cursorStore.transcript(cwd, chatId) === file, 'the chat is found in the test home');

  // 1. The panel starts on a resumed chat: nothing is read at once.
  const P = 'cursor-attach-1';
  const get = () => turns.state().find(t => t.paneId === P);
  counted.sync = 0;
  const t0 = performance.now();
  turns.started(P, 'Cursor Agent', '', chatId, cwd);
  const held = performance.now() - t0;
  const opened = counted.sync;
  console.log(
    `     chat ${(size / 1e6).toFixed(2)} MB · main loop held by the panel start ${held.toFixed(
      1
    )} ms · files opened at once ${opened}`
  );
  check(opened === 0, 'the panel start opens no file at once: ' + opened);
  const t1 = performance.now();
  check(await until(() => !!get()), 'the last task of the chat is shown');
  console.log(`     last task in after ${(performance.now() - t1 + held).toFixed(1)} ms`);
  const last = get();
  console.log(
    '     shown: ' + require('crypto').createHash('sha1').update(shown(last)).digest('hex')
  );
  if (!given) {
    check(
      last.task === 'Task number 2000' && last.result === 'Answer 2000',
      'it is the chat’s last task with its answer'
    );
    check(last.endedBy === 'stop' && last.history, 'ended, marked as history (not a new end)');
  }
  check(turns.canConfirm(P, 'Cursor Agent'), 'the reader is live after the history');

  // 2. A follow-up prompt: Cursor takes its turn_ended line out and writes the prompt in its place
  // (cursor-agent 2026.10.01), so the reader must start that line again.
  if (!given) {
    const text = fs.readFileSync(file, 'utf8');
    const cut = text.slice(0, text.length - endLine.length - 1);
    fs.writeFileSync(file, cut + userLine('Follow up') + '\n');
    check(
      await until(() => get()?.task === 'Follow up'),
      'the follow-up prompt starts a live task'
    );
    const live = get();
    check(!live.endedAt && !live.history, '…running, not history');
    fs.appendFileSync(file, answerLine('Followed up') + '\n' + endLine + '\n');
    check(await until(() => !!get()?.endedAt), 'its turn_ended ends it');
    check(
      get().result === 'Followed up' && get().endedBy === 'stop' && !get().history,
      '…with its answer, as a real end'
    );
  }

  // 3. The process ends while the history is still being read: nothing is attached afterwards.
  if (!given) {
    const Q = 'cursor-attach-2';
    turns.started(Q, 'Cursor Agent', '', chatId, cwd);
    turns.fromPty('pty:exit', { paneId: Q });
    turns.forget(Q);
    await wait(300);
    check(!turns.canConfirm(Q, 'Cursor Agent'), 'a panel gone during the read gets no reader');
  }

  turns.forget(P);
  await wait(50);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
