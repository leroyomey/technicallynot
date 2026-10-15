/*
 * Technically Not · model-retirements.js — the one list of model ids their vendor has retired or
 * deprecated, each with the successor the vendor names. Two readers:
 * - desktop/agent-registry.js leaves these ids out of Claude Code's model list (the built-in
 *   CLAUDE_MODELS and the public `models/claude.json`), so the picker never offers them;
 * - Claude Code's start arguments swap a saved pick of one of them (the composer's last pick, a
 *   panel's own model, a favorite) for its successor, so a saved choice never starts an agent on a
 *   model whose requests fail.
 * The other CLIs (Codex, OpenCode, Cursor Agent, Copilot) read their model list from the CLI
 * itself, so a model their vendor retires drops out by itself and needs no row here.
 * Keep it up to date: look at it with every CLI update and before every release.
 * Test: `node tools/model-retirements-test.js`.
 */

'use strict';

// Read 2026-10-14 from https://platform.claude.com/docs/en/about-claude/model-deprecations.
// state: 'retired' (requests fail) or 'deprecated' (still answers until `retires`).
// `successor` is the replacement that page names for the model.
const CLAUDE_RETIRED = {
  'claude-sonnet-4-5-20250929': {
    state: 'deprecated',
    retires: '2026-11-30',
    successor: 'claude-sonnet-5-5',
  },
  'claude-opus-4-1-20250805': {
    state: 'retired',
    retires: '2026-08-05',
    successor: 'claude-opus-4-8',
  },
  'claude-opus-4-20250514': {
    state: 'retired',
    retires: '2026-06-15',
    successor: 'claude-opus-4-8',
  },
  'claude-sonnet-4-20250514': {
    state: 'retired',
    retires: '2026-06-15',
    successor: 'claude-sonnet-5-5',
  },
  'claude-3-7-sonnet-20250219': {
    state: 'retired',
    retires: '2026-02-19',
    successor: 'claude-sonnet-5-5',
  },
  'claude-3-5-haiku-20241022': {
    state: 'retired',
    retires: '2026-02-19',
    successor: 'claude-haiku-4-5-20251001',
  },
  'claude-3-haiku-20240307': {
    state: 'retired',
    retires: '2026-04-20',
    successor: 'claude-haiku-4-5-20251001',
  },
  'claude-3-5-sonnet-20241022': {
    state: 'retired',
    retires: '2025-10-28',
    successor: 'claude-sonnet-5-5',
  },
  'claude-3-5-sonnet-20240620': {
    state: 'retired',
    retires: '2025-10-28',
    successor: 'claude-sonnet-5-5',
  },
  'claude-3-opus-20240229': {
    state: 'retired',
    retires: '2026-01-05',
    successor: 'claude-opus-4-8',
  },
};

// The short names (aliases) of the dated ids above, which Claude Code's --model also takes.
const CLAUDE_ALIASES = {
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-1': 'claude-opus-4-1-20250805',
  'claude-opus-4-0': 'claude-opus-4-20250514',
  'claude-sonnet-4-0': 'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest': 'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-3-opus-latest': 'claude-3-opus-20240229',
};

// The retirement row of a Claude id or alias, or null when the model is current. A "[1m]" ending
// (the 1M context window in Claude Code) is not part of the id.
function claudeRetirement(id) {
  const bare = String(id || '').replace(/\[[^\]]*\]$/, '');
  const dated = CLAUDE_ALIASES[bare] || bare;
  return CLAUDE_RETIRED[dated] || null;
}

// True when the id must not be offered in a model list.
const isRetiredClaude = id => !!claudeRetirement(id);

// The id to start Claude Code with: the successor for a retired or deprecated id (followed to the
// end, in case a successor is itself retired later), the id unchanged otherwise. The "[1m]" ending
// is kept, so a saved pick keeps its context window.
function currentClaudeModel(id) {
  let model = String(id || '');
  const ending = /\[[^\]]*\]$/.exec(model)?.[0] || '';

  // at most a few hops: the list is short, and a loop in it must not hang a start
  for (let hop = 0; hop < 5; hop++) {
    const row = claudeRetirement(model);
    if (!row) break;
    model = row.successor + ending;
  }
  return model;
}

module.exports = {
  CLAUDE_RETIRED,
  CLAUDE_ALIASES,
  claudeRetirement,
  isRetiredClaude,
  currentClaudeModel,
};
