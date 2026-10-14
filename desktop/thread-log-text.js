/*
 * Technically Not desktop · thread-log-text.js — What the thread log's readers share
 * (desktop/thread-log.js): clipping text, showing a path from the project folder on, and turning a
 * prompt as a tool recorded it into what the user wrote. The app adds its own mark to a prompt and
 * agents send each other messages through the same input, so a recorded prompt is not always the
 * user's own words: the mark is taken off, and a message from another agent is its own kind.
 */
'use strict';

const PROMPT_MAX = 8000;

const clip = (value, max) => {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) + '…' : text;
};
const oneLine = (value, max) =>
  clip(
    String(value || '')
      .trim()
      .split(/\r?\n/)[0],
    max
  );

// A path inside the session's working folder is shown from that folder on.
function shortPath(file, cwd) {
  const plain = value =>
    String(value || '')
      .replace(/^file:\/\/\//, '')
      .replace(/\\/g, '/');
  const full = plain(file);
  const base = plain(cwd).replace(/\/+$/, '');
  if (base && full.toLowerCase().startsWith(base.toLowerCase() + '/'))
    return full.slice(base.length + 1);
  return full;
}

// What the app itself writes around a prompt before it sends it (src/scripts/11-agents-live.js
// `submit`, 101-session-skills.js `note`). Each is matched by its own fixed words, so nothing
// the user typed in square brackets is ever taken for one. Before the user's words:
const ADDED_BEFORE = [
  // the agent gets its own earlier result back
  /^\[This task builds on your own earlier result, from "[\s\S]*?"\]\s*/,

  // another agent is busy in the project
  /^\[[^\]\n]{1,200} is busy in this project[^\]]*\]\s*/,

  // a task sent to an agent that is working, with what to do about it
  /^\[New task(?:, unrelated to your current work on| while you work on) "[\s\S]*?"\][\s\S]*?New task:\s*/,

  // a task handed over from an agent near its context limit, or from a retired one
  /^\[TN\.ai handoff:[^\]]*\]\s*/,
];

// After the user's words:
const ADDED_AFTER = [
  // the skills attached to the agent's session
  /(?:^|\n\n)\((?:Skills attached to you for this (?:session|task only): |The skills? )[^\n]*\)\s*$/,

  // the agents that are not working right now, for a lead to reuse
  /(?:^|\n\n)\[Technically Not: [\s\S]*\]\s*$/,
];

// A recorded prompt in two parts: what the user wrote, and what the app added around it, in the
// order it stood in the prompt.
function splitPrompt(text) {
  let words = String(text || '')
    .replace(/^\s*\[(?:TN\.ai|TechnicallyNot\.ai)\]\s*/, '')
    .trim();
  const before = [];
  const after = [];
  const take = (patterns, into) => {
    let found = true;
    while (found) {
      found = false;
      for (const pattern of patterns) {
        const hit = pattern.exec(words);
        if (!hit) continue;
        into.push(hit[0].trim());
        words = (words.slice(0, hit.index) + words.slice(hit.index + hit[0].length)).trim();
        found = true;
      }
    }
  };
  take(ADDED_BEFORE, before);
  take(ADDED_AFTER, after);
  return { words, added: before.concat(after.reverse()) };
}

// A recorded prompt as entries: the user's words, a message another agent sent with `tnai send`,
// a note for an interrupt, or nothing when only the app's mark was there. What the app added
// around the words is kept beside them (`added`), never inside them.
function promptEntries(text, at) {
  const raw = String(text || '');
  if (/^\s*\[Request interrupted by user/.test(raw))
    return [{ kind: 'note', text: 'You interrupted it', at }];
  const { words, added } = splitPrompt(raw);
  if (!words && !added.length) return [];
  const extra = added.length ? { added: added.map(part => clip(part, PROMPT_MAX)) } : {};
  const from = /^\[from ([^\]]{1,120})\]\s*/.exec(words);
  if (from)
    return [
      {
        kind: 'from',
        who: from[1],
        text: clip(words.slice(from[0].length), PROMPT_MAX),
        ...extra,
        at,
      },
    ];
  return [{ kind: 'you', text: clip(words, PROMPT_MAX), ...extra, at }];
}

module.exports = { clip, oneLine, shortPath, promptEntries, splitPrompt };
