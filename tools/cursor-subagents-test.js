/*
 * Technically Not tools · cursor-subagents-test.js — Cursor Agent's chat lookup with sub-agent
 * records (desktop/cursor-store.js findChat, transcript, chatExists), plain Node, no CLI.
 *
 * A home folder of its own holds Cursor's layout as seen on this PC (2026-10-28):
 * agent-transcripts/<chatId>/<chatId>.jsonl for a chat, with its sub-agents in
 * agent-transcripts/<chatId>/subagents/<subagentId>.jsonl, and one folder that holds only a
 * subagents folder. The pane's chat must be the real parent chat, never the sub-agent-only folder,
 * and a sub-agent's id is never a chat of its own.
 *
 * Usage: node tools/cursor-subagents-test.js. Exit code 1 when a check fails.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// A home of its own, so cursor-store.js never reads the user's real ~/.cursor.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-cursor-subagents-'));
process.env.USERPROFILE = home;
process.env.HOME = home;
const cursorStore = require('../desktop/cursor-store');

let failed = 0;
const check = (condition, label) => {
  console.log((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) failed++;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const line = object => JSON.stringify(object) + '\n';

const cwd = path.join(home, 'work', 'My Project');
const base = path.join(home, '.cursor', 'projects', cursorStore.slug(cwd), 'agent-transcripts');

// A sub-agent record in the new place: <chatId>/subagents/<subagentId>.jsonl
function writeSubagent(chatId, subagentId) {
  const folder = path.join(base, chatId, 'subagents');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, subagentId + '.jsonl'),
    line({ role: 'user', message: { content: [{ type: 'text', text: 'Explore the code' }] } })
  );
}

// A chat's own record: <chatId>/<chatId>.jsonl
function writeChat(chatId) {
  fs.mkdirSync(path.join(base, chatId), { recursive: true });
  fs.writeFileSync(
    path.join(base, chatId, chatId + '.jsonl'),
    line({
      role: 'user',
      message: { content: [{ type: 'text', text: '<user_query>\nFix the bug\n</user_query>' }] },
    })
  );
}

(async () => {
  try {
    const startedAt = Date.now();

    // Made first: a folder with only sub-agent records, as one on this PC (no <chatId>.jsonl).
    const orphan = 'aaaaaaaa-0000-4000-8000-000000000001';
    writeSubagent(orphan, 'aaaaaaaa-0000-4000-8000-0000000000a1');
    await wait(40);

    // Then the pane's real chat, with a sub-agent of its own.
    const parent = 'bbbbbbbb-0000-4000-8000-000000000002',
      child = 'bbbbbbbb-0000-4000-8000-0000000000b1';
    writeChat(parent);
    writeSubagent(parent, child);

    const found = cursorStore.findChat(startedAt, cwd);
    check(found === parent, "the pane's chat is the parent with its own record: " + found);

    const afterTaken = cursorStore.findChat(startedAt, cwd, new Set([parent]));
    check(
      afterTaken === '',
      'with the parent taken, a folder of sub-agent records alone is not a chat: ' +
        JSON.stringify(afterTaken)
    );

    const file = cursorStore.transcript(cwd, parent);
    check(
      file === path.join(base, parent, parent + '.jsonl'),
      "the transcript read is the parent's own file, not a sub-agent's: " +
        path.relative(base, file)
    );
    check(
      cursorStore.chatExists(cwd, parent) && !cursorStore.chatExists(cwd, child),
      'the parent can be resumed; a sub-agent id is not a chat of its own'
    );

    // The sub-agent-only folder gets its own record later (a chat whose first line came late):
    // from then on it is a chat like any other.
    writeChat(orphan);
    const late = cursorStore.findChat(startedAt, cwd, new Set([parent]));
    check(late === orphan, 'once its own record is written, that folder is found: ' + late);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})();
