/*
 * Technically Not desktop · report-repeats.js — dead ends from agents' reports (user 2026-10-28,
 * idea 1 of learning from threads).
 *
 * Every agent ends a task with a Technically Not report; its "Found" and "Blockers" lines are kept
 * per project by agent-context.js. When the same problem shows up in the reports of two or more
 * different tasks, and nobody marked it done, it is a lesson: the next agent should read what was
 * tried before trying it again. This file finds those groups (pure: entries in, groups out) and
 * says them in words; agent-context.js hands them to `tnai context` and, when the prompt is about
 * the same thing, to the agent with its prompt. Test: tools/report-repeats-test.js.
 */
'use strict';

// Reports this many days back.
const DAYS = 45;

// Two items are the same problem when their words overlap this much (shared / all) and share at
// least this many words.
const SAME_SHARE = 0.5;
const SAME_WORDS = 3;

// A prompt is about a problem when it shares this many of the problem's words.
const PROMPT_WORDS = 2;

// The most groups given at once.
const MOST = 4;

// The words of an item that say what it is about: lower case, four letters or more, without
// common words.
const COMMON = new Set(
  (
    'that this with from have when then them they there their what which while into after before ' +
    'still only also does done were been being would could should about again every other than ' +
    'just more most some such fix fixed fails failed check checks test tests first last once time ' +
    'times make made need needs works work working agent agents task tasks file files line lines'
  ).split(' ')
);

function wordsOf(text) {
  return [
    ...new Set(
      (
        String(text || '')
          .toLowerCase()
          .match(/[a-z][a-z0-9_.-]{3,}/g) || []
      ).filter(word => !COMMON.has(word))
    ),
  ];
}

// "<issue> → fix: <how> (fix NN%)": the issue part only.
const issueOf = item =>
  String(item || '')
    .split(/\s+(?:→|->)\s+fix\s*:/i)[0]
    .trim();

function same(a, b) {
  const shared = a.filter(word => b.includes(word)).length;
  const all = new Set([...a, ...b]).size;
  return shared >= SAME_WORDS && all > 0 && shared / all >= SAME_SHARE;
}

// entries: agent-context.js results ({ id, name, at, chatter, summary: { found, blockers } });
// isMarked(id, kind, index): true when that item was marked claimed or done. Groups of the same
// problem from at least two different results, most often first.
function find(entries, isMarked = () => false, now = Date.now()) {
  const groups = [];
  for (const entry of entries || []) {
    if (!entry || entry.chatter || now - (entry.at || 0) > DAYS * 864e5) continue;
    for (const kind of ['blockers', 'found']) {
      (entry.summary?.[kind] || []).forEach((item, index) => {
        if (isMarked(entry.id, kind, index)) return;
        const issue = issueOf(item);
        const words = wordsOf(issue);
        if (words.length < SAME_WORDS) return;
        const group = groups.find(candidate => same(candidate.words, words));
        if (group) {
          group.results.add(entry.id);
          if ((entry.at || 0) > group.last.at)
            group.last = { name: entry.name || '', at: entry.at };
        } else {
          groups.push({
            issue,
            words,
            results: new Set([entry.id]),
            last: { name: entry.name || '', at: entry.at || 0 },
          });
        }
      });
    }
  }
  return groups
    .filter(group => group.results.size >= 2)
    .map(group => ({
      issue: group.issue,
      words: group.words,
      count: group.results.size,
      last: group.last,
    }))
    .sort((a, b) => b.count - a.count || b.last.at - a.last.at)
    .slice(0, MOST);
}

const dateOf = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// One group in words.
const line = group =>
  'came up in ' +
  group.count +
  ' task reports: ' +
  group.issue +
  ' (last: ' +
  (group.last.name || 'an agent') +
  ', ' +
  dateOf(group.last.at) +
  ')';

// For `tnai context` (every CLI).
function contextText(groups) {
  if (!groups.length) return '';
  return (
    "\nCame up again and again in agents' reports (read what was tried with `tnai context TOPIC` before trying it again):\n" +
    groups.map(group => '  - ' + line(group).replace(/^came up/, 'Came up')).join('\n')
  );
}

// The groups a prompt is about.
function matching(groups, prompt) {
  const words = wordsOf(prompt);
  return groups.filter(
    group => group.words.filter(word => words.includes(word)).length >= PROMPT_WORDS
  );
}

// With a prompt: the groups it is about, each once per session (`said`: a Set kept per session).
function promptText(groups, prompt, said) {
  const fresh = matching(groups, prompt).filter(group => !said.has(group.issue));
  fresh.forEach(group => said.add(group.issue));
  if (!fresh.length) return '';
  return (
    'Technically Not: this task touches a problem that ' +
    fresh.map(line).join('; and one that ') +
    '. Read what was tried (`tnai context TOPIC`, then `tnai context show ID`) before trying the same approach again.'
  );
}

module.exports = { find, contextText, promptText, matching, issueOf, wordsOf, DAYS };
