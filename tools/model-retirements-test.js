/*
 * Technically Not · model-retirements-test.js — fails when a model list the app offers still names
 * a model its vendor retired or deprecated, or when a saved pick of one would start on it.
 * Reads desktop/model-retirements.js (the list of retired ids and their successors) and checks:
 * - the built-in CLAUDE_MODELS in desktop/agent-registry.js and the public
 *   models/claude.json name no retired or deprecated id;
 * - every successor is a model those two lists offer;
 * - currentClaudeModel swaps retired ids and aliases for their successor and leaves current ids;
 * - Claude Code's start arguments go through currentClaudeModel.
 * Plain Node, no window, no network. Run: node tools/model-retirements-test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const retirements = require(path.join(root, 'desktop', 'model-retirements.js'));

let failures = 0;

function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures++;
}

// The built-in list, read from the registry's source (requiring the registry would start its
// background checks).
const registrySource = fs.readFileSync(path.join(root, 'desktop', 'agent-registry.js'), 'utf8');
const builtInBlock = /const CLAUDE_MODELS = \[([\s\S]*?)\n\];/.exec(registrySource);
check(!!builtInBlock, 'CLAUDE_MODELS found in desktop/agent-registry.js');
const builtInIds = builtInBlock
  ? [...builtInBlock[1].matchAll(/\['(claude-[a-z0-9-]+)'/g)].map(m => m[1])
  : [];
check(builtInIds.length > 0, 'CLAUDE_MODELS has rows (' + builtInIds.length + ')');

// The public list the app reads once an hour. It sits in the template folder here and at
// models/claude.json in the public copy, which has no template folder.
const templateFile = path.join(root, 'tools', 'public-copy', 'files', 'models', 'claude.json');
const publicFile = fs.existsSync(templateFile)
  ? templateFile
  : path.join(root, 'models', 'claude.json');
const publicIds = JSON.parse(fs.readFileSync(publicFile, 'utf8')).models.map(m => m.id);
check(publicIds.length > 0, 'public models/claude.json has rows (' + publicIds.length + ')');

// No list offers a retired or deprecated model.
for (const [name, ids] of [
  ['CLAUDE_MODELS', builtInIds],
  ['public models/claude.json', publicIds],
]) {
  const stale = ids.filter(retirements.isRetiredClaude);
  check(
    !stale.length,
    name + ' offers no retired or deprecated model' + (stale.length ? ': ' + stale.join(', ') : '')
  );
}

// The two lists carry the same rows (the built-in one is the fallback of the public one).
check(
  builtInIds.join(',') === publicIds.join(','),
  'CLAUDE_MODELS and the public list have the same ids in the same order'
);

// Every successor, followed to its end, is a model the app offers.
for (const id of Object.keys(retirements.CLAUDE_RETIRED)) {
  const next = retirements.currentClaudeModel(id);
  check(builtInIds.includes(next), id + ' -> ' + next + ' (offered)');
}

// Aliases, the 1M ending and current ids.
check(
  retirements.currentClaudeModel('claude-opus-4-1') === 'claude-opus-4-8',
  'alias claude-opus-4-1 -> claude-opus-4-8'
);
check(
  retirements.currentClaudeModel('claude-sonnet-4-20250514[1m]') === 'claude-sonnet-5-5[1m]',
  'a [1m] ending is kept on the successor'
);
check(
  retirements.currentClaudeModel('claude-opus-5-5') === 'claude-opus-5-5',
  'a current id is left as it is'
);
check(retirements.currentClaudeModel('opus') === 'opus', 'a family alias is left as it is');
check(retirements.currentClaudeModel('') === '', 'no pick stays no pick');

// Claude Code's start arguments swap a saved pick.
check(
  /pickArgs: o => \[\s*\.\.\.\(o\.model \? \['--model', currentClaudeModel\(o\.model\)\]/.test(
    registrySource
  ),
  "Claude Code's pickArgs passes the model through currentClaudeModel"
);

console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
process.exit(failures ? 1 : 0);
