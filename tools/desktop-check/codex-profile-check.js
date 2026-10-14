// Plain Node: Codex's profile file as Technically Not writes it (agent-registry.js codexProfile),
// in a throwaway CODEX_HOME. The live-steps hook is added with the panel's step URL in the
// environment, and what Codex saved after the user's review (`[hooks.state…]`) survives a change of
// the work rules and a launch without a panel server. No CLI is started.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const registry = require('../../desktop/agent-registry');
let ok = true;
const check = (pass, text) => {
  console.log((pass ? 'ok   ' : 'FAIL ') + text);
  if (!pass) ok = false;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-codex-profile-'));
const home = path.join(root, 'codex-home'),
  hooks = path.join(root, 'agent-hooks');
fs.mkdirSync(hooks, { recursive: true });
const rulesFile = path.join(hooks, 'work-rules.md'),
  mcpConfig = path.join(hooks, 'p.mcp.json');
const step = path.join(hooks, process.platform === 'win32' ? 'codex-step.cmd' : 'codex-step');
const token = 'c'.repeat(32);
fs.writeFileSync(rulesFile, 'rules\n');
fs.writeFileSync(
  mcpConfig,
  JSON.stringify({ mcpServers: { tnai: { type: 'http', url: 'http://127.0.0.1:5/mcp/' + token } } })
);
const profile = path.join(home, 'tnai.config.toml');
const read = () => fs.readFileSync(profile, 'utf8');
const opts = extra => ({
  accountDir: home,
  workRules: 'First rules.',
  rulesFile,
  mcpConfig,
  ...extra,
});

// 1. No step script yet: rules only, no hook, no step URL.
let r = registry.handArgs('Codex', opts());
check(
  r.args.join(' ').startsWith('-p tnai') && !/hooks\./.test(read()) && !r.env.TNAI_STEP_URL,
  'without the step script: profile has the rules only, no step URL'
);

// 2. With the script: one PreToolUse hook naming it, and the panel's step URL.
fs.writeFileSync(step, '');
r = registry.handArgs('Codex', opts());
check(
  /\[\[hooks\.PreToolUse\.hooks\]\]\ntype = "command"\ncommand = /.test(read()) &&
    read().includes(JSON.stringify(step)),
  'with the step script: the profile holds one PreToolUse command hook naming it'
);
check(
  r.env.TNAI_STEP_URL === 'http://127.0.0.1:5/step/' + token,
  'step URL in the environment: ' + r.env.TNAI_STEP_URL
);
check(!/trusted_hash/.test(read()), 'Technically Not writes no trust entry itself');

// 3. What Codex appends after the user's review stays when the work rules change.
const state =
  "\n[hooks.state]\n\n[hooks.state.'" +
  profile +
  ':pre_tool_use:0:0\']\ntrusted_hash = "sha256:test"\nenabled = true\n';
fs.appendFileSync(profile, state);
registry.handArgs('Codex', opts({ workRules: 'Second rules.' }));
check(
  read().includes('Second rules.') && !read().includes('First rules.') && read().endsWith(state),
  'changed work rules: new rules written, the review section kept as it was'
);

// 4. A launch without a panel server leaves the hook and its review alone, and sets no step URL.
r = registry.handArgs('Codex', opts({ mcpConfig: '', workRules: 'Third rules.' }));
check(
  read().includes('Third rules.') &&
    /\[\[hooks\.PreToolUse\]\]/.test(read()) &&
    read().endsWith(state) &&
    !r.env.TNAI_STEP_URL,
  'no panel server: hook and review kept, no step URL'
);

// 5. Writing the same thing again changes nothing.
const before = read();
registry.handArgs('Codex', opts({ workRules: 'Third rules.' }));
check(
  read().split('[[hooks.PreToolUse]]').length === 2 && read().split('[hooks.state]').length === 2,
  'a second launch adds no second hook or review section'
);
check(
  read().includes('Third rules.') && read().length === before.length,
  'same rules again: file unchanged in size'
);

fs.rmSync(root, { recursive: true, force: true });
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
