/*
 * Technically Not desktop · cursor-store.js — Cursor Agent's own transcript of each chat
 * (cursor-agent 2026.09.18): ~/.cursor/projects/<folder
 * slug>/agent-transcripts/<chatId>/<chatId>.jsonl, one JSON line per event:
 * {"role":"user",message.content[].text} starts a task, {"role":"assistant",...} is its text,
 * {"type":"turn_ended","status"} ends it. The slug is the working folder with every run of other
 * characters than letters/digits as "-" (drive letter case varies, so it is matched ignoring case).
 * pty-service.js finds a pane's chat here; agent-turns.js follows its transcript.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = () => path.join(os.homedir(), '.cursor', 'projects');
const slug = cwd =>
  String(cwd || '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

function projectDir(cwd) {
  const want = slug(cwd);
  try {
    const hit = fs.readdirSync(root()).find(n => n.toLowerCase() === want);
    return hit ? path.join(root(), hit) : '';
  } catch {
    return '';
  }
}

// The chat Cursor Agent started in this folder since the pane started (not one another pane already
// has). Cursor sets no id Technically Not can choose at launch, so the folder + time is the match;
// two Cursor panes started in the same folder in the same second could swap (inferred).
function findChat(startedAt, cwd, taken = new Set()) {
  const dir = projectDir(cwd);
  if (!dir) return '';
  const base = path.join(dir, 'agent-transcripts');
  let names = [];
  try {
    names = fs.readdirSync(base);
  } catch {
    return '';
  }
  return (
    names
      .filter(n => !taken.has(n))
      .map(n => {
        try {
          return [n, fs.statSync(path.join(base, n)).birthtimeMs];
        } catch {
          return [n, 0];
        }
      })
      .filter(([, at]) => at >= (startedAt || 0) - 2000)
      .sort((a, b) => a[1] - b[1])[0]?.[0] || ''
  );
}

function transcript(cwd, chatId) {
  const dir = projectDir(cwd);
  return dir && chatId ? path.join(dir, 'agent-transcripts', chatId, chatId + '.jsonl') : '';
}

// The user's words without the <timestamp>/<user_query> wrapping Cursor adds.
function userText(j) {
  const s = (j?.message?.content || []).map(c => c?.text || '').join('');
  const q = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(s);
  return (q ? q[1] : s.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '')).trim();
}
const assistantText = j =>
  (j?.message?.content || [])
    .filter(c => c?.type === 'text')
    .map(c => c.text || '')
    .join('')
    .trim();

// A chat Cursor can resume (`--resume <chatId>`): its transcript is on disk.
const chatExists = (cwd, chatId) => {
  const f = transcript(cwd, chatId);
  try {
    return !!f && fs.statSync(f).isFile();
  } catch {
    return false;
  }
};
module.exports = { findChat, transcript, chatExists, userText, assistantText, slug };
