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

// The line a press on a result item writes under its follow-up (src/scripts/49-context-data.js
// `toComposer`), so the agent can read the result in full.
const FULL_RESULT_LINE = /^Full result: `tnai context show [0-9a-f]+`$/;

// Where a follow-up came from: " from Rook’s result 8b1f0a8e" (or "Follow up on Rook’s result
// 8b1f0a8e"), then maybe " (task: …)".
const SOURCE = /(?: from |^Follow up on )[^\n"]{1,120}?['’]s result [0-9a-f]{6,}\b/;

// The end of the source: past " (task: …)", whose task can hold brackets of its own (a task that
// was itself a follow-up), so the brackets are counted rather than matched by a pattern.
function sourceEnd(line, start) {
  if (!line.startsWith(' (task: ', start)) return start;
  let depth = 0;
  for (let index = start + 1; index < line.length; index++) {
    if (line[index] === '(') depth++;
    if (line[index] === ')') depth--;
    if (depth === 0) return index + 1;
  }
  return start;
}

// One line a press on a result item wrote, as the user means it: a decision shows only the
// choice, a follow-up loses where it came from. Null when the line is not one of them.
function tidyFollowUpLine(line) {
  const decision = /^Decision on "/.exec(line);
  const followUp = /^(Fix this issue|Continue|Try this suggestion|Follow up on)\b/.exec(line);
  if (!decision && !followUp) return null;
  const source = SOURCE.exec(line);
  let questionEnd = -1;
  let restStart = -1;
  if (source) {
    const end = sourceEnd(line, source.index + source[0].length);
    if (!line.startsWith(': ', end)) return null;
    questionEnd = source.index;
    restStart = end + 2;
  } else if (decision) {
    questionEnd = line.indexOf('": ');
    restStart = questionEnd + 3;
  }
  if (questionEnd < 0) return null;
  const rest = line.slice(restStart);
  if (followUp) {
    const label = followUp[1] === 'Follow up on' ? 'Follow up' : followUp[1];
    return rest ? label + ': ' + rest : label;
  }

  // The question ends at its closing quote, just before the source or the ": ".
  const closing = source ? questionEnd - 1 : questionEnd;
  if (line[closing] !== '"') return null;

  // "Decision on "Decision 1 of 2: …"": the number tells several answers apart, so it stays.
  const question = line.slice(decision[0].length, closing);
  const number = /^(Decision \d+ of \d+):/.exec(question);
  const choice = rest.replace(/^go with /, '');
  return number ? number[1] + ': ' + choice : choice;
}

// The follow-ups and decisions a press on a result item wrote, shown as the user means them; the
// lines as they were sent are kept apart, like the rest of what the app adds.
function tidyFollowUps(words) {
  const removed = [];
  const lines = words.split('\n').filter(line => {
    if (!FULL_RESULT_LINE.test(line.trim())) return true;
    removed.push(line.trim());
    return false;
  });
  const shown = lines.map(line => {
    const tidy = tidyFollowUpLine(line.trim());
    if (tidy === null) return line;
    removed.push(line.trim());
    return tidy;
  });
  if (!removed.length) return { words, removed: [] };
  return {
    words: shown
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    removed: [removed.join('\n')],
  };
}

// A recorded prompt in two parts: what the user wrote, and what the app added around it, in the
// order it stood in the prompt.
function splitPrompt(text) {
  let words = String(text || '')
    // Claude Code wraps a long paste as <pasted_content id="…">…</pasted_content id="…">
    // (a nested one escaped as <\pasted_content …>): the wrapper is not the user's words.
    .replace(/<[\/\\]?(?:pasted_content|pasted_text)\b[^<>]*>/g, '')
    .trim()
    .replace(/^\[(?:TN\.ai|TechnicallyNot\.ai)\]\s*/, '')
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
  const followUps = tidyFollowUps(words);
  words = followUps.words;
  return { words, added: before.concat(followUps.removed, after.reverse()) };
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
