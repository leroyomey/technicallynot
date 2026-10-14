/*
 * Technically Not tools · desktop-check/tests/real-cursor-status.main.js — Main-process side of
 * real-cursor-status: what Cursor Agent's own chat transcript holds right now, read straight from
 * disk (not through the app's watcher), and what agent-turns.js says about the pane.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
module.exports = () => {
  const turns = require('../../../desktop/agent-turns'); // the same module instance main.js uses
  const root = path.join(os.homedir(), '.cursor', 'projects');
  let dir = '';

  // The throwaway project's folder in Cursor's store: the one with a chat made since the test
  // began.
  function find(since) {
    if (dir) return dir;
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      return '';
    }
    for (const n of names) {
      if (!/tnai-desktop-check/i.test(n)) continue;
      const base = path.join(root, n, 'agent-transcripts');
      try {
        if (fs.statSync(base).birthtimeMs >= since - 5000) return (dir = base);
      } catch {}
    }
    return '';
  }
  const kind = line => {
    let j = null;
    try {
      j = JSON.parse(line);
    } catch {
      return 'partial';
    }
    if (j.role === 'user') return 'user';
    if (j.role === 'assistant')
      return (j.message?.content || []).some(c => c?.type === 'tool_use')
        ? 'assistant+tool'
        : 'assistant';
    return String(j.type || 'other') + (j.status ? ':' + j.status : '');
  };
  return {
    // { busy, file: { size, mtime, kinds: [...] } | null } — kinds = one word per transcript line,
    // in file order.
    peek(paneId, since) {
      const out = { busy: turns.busy(paneId), file: null };
      const base = find(since);
      if (!base) return out;
      let chats = [];
      try {
        chats = fs.readdirSync(base);
      } catch {
        return out;
      }
      for (const id of chats) {
        const f = path.join(base, id, id + '.jsonl');
        try {
          const st = fs.statSync(f),
            text = fs.readFileSync(f, 'utf8');
          out.file = {
            size: st.size,
            mtime: Math.round(st.mtimeMs),
            kinds: text
              .split('\n')
              .filter(l => l.trim())
              .map(kind),
          };
        } catch {}
      }
      return out;
    },
  };
};
