// Technically Not desktop · comparison-hint.js — a prompt that compares (user 2026-10-23: "detect
// comparisons from the user and automatically turning anything data related into clean graphs",
// mock docs/plans/design-concepts/data-charts.html).
//
// When the user's prompt compares, ranks, asks "how much" or asks how something changed, the agent
// is told once, with that prompt, to show the numbers of its answer as a chart block (the thread
// draws it: src/scripts/178-thread-charts.js). Nothing is added to the user's own words.
//
// Claude Code gets the line through its prompt hook (agent-hooks.js, UserPromptSubmit). Codex,
// Cursor Agent, OpenCode and Copilot CLI run no prompt hook, so they rely on the charts rule every
// agent loads (desktop/hidden-skills/46-charts.md), which says the same.
//
// Test: node tools/comparison-hint-test.js
'use strict';

// Words that ask for a comparison or for numbers side by side.
const ASKS = [
  /\bcompar(e|es|ed|ing|ison|isons)\b/i,
  /\bvs\.?(?=\s)|\bversus\b/i,
  /\bdifferences? between\b/i,
  /\bbefore and after\b/i,
  /\b(which|what)(\s+\w+){0,3}\s+(is|are|was|were|got|runs?|takes?)\s+(the\s+)?(faster|slower|bigger|smaller|larger|cheaper|costlier|heavier|lighter|longer|shorter|more|less|most|least|best|worst|biggest|smallest|largest|fastest|slowest|highest|lowest)\b/i,
  /\bhow\s+(much|many|big|fast|slow|long|large|often)\b/i,
  /\b(rank|ranked|ranking|top\s+\d+|bottom\s+\d+)\b/i,
  /\b(over time|trend|trends|growth|grew|shrank|history of)\b/i,
  /\bhow\s+(has|have|did)\b.{0,60}\bchange/i,
  /\b(chart|graph|plot|breakdown)\b/i,
];

// Prompts that are not the user's own question: an app notice or another agent's result.
const NOT_A_QUESTION = /^\s*(<task-notification>|\[from )/i;

// The longest prompt read; a pasted log or file is not a question about numbers.
const MAX_LENGTH = 4000;

// true when the prompt asks for a comparison
function asks(prompt) {
  const text = String(prompt || '');
  if (!text.trim() || text.length > MAX_LENGTH || NOT_A_QUESTION.test(text)) return false;

  // code blocks in the prompt are not the question
  const words = text.replace(/```[\s\S]*?```/g, ' ');
  return ASKS.some(pattern => pattern.test(words));
}

// The line for the agent, or '' when the prompt does not compare.
function forPrompt(prompt) {
  if (!asks(prompt)) return '';
  return (
    'Technically Not: this prompt asks for a comparison. If your answer has numbers that compare ' +
    '(sizes, speeds, counts, scores, prices, change over time), put them in a ```chart block as ' +
    'the charts rule says, beside the sentence that explains them; a series over time draws as a ' +
    'line. Skip the block when the answer has no such numbers, and never guess values.'
  );
}

module.exports = { asks, forPrompt };
