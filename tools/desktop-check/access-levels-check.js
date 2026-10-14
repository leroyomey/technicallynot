// Plain Node: the access levels as agent-registry.js builds them.
// For every CLI at every level, spec() is built and the arguments it adds over "CLI default" are
// compared with the plan's table; capabilities() must report the same levels. Also: a resumed
// session and an unknown level word add nothing, a level a CLI has no flag for is refused with the
// reason, and Technically Not's own tool settings (rules) stay at every level. No CLI is started
// and no prompt is sent; the rules files go to a throwaway folder.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const registry = require('../../desktop/agent-registry');
let ok = true;
const check = (pass, text) => {
  console.log((pass ? 'ok   ' : 'FAIL ') + text);
  if (!pass) ok = false;
};

// The plan's table: the arguments each level adds; null = the CLI has no flag for it (greyed out).
const TABLE = {
  'Claude Code': {
    ask: ['--permission-mode', 'manual'],
    edits: ['--permission-mode', 'acceptEdits'],
    auto: ['--permission-mode', 'auto'],
    full: ['--permission-mode', 'bypassPermissions'],
    plan: ['--permission-mode', 'plan'],
  },
  Codex: {
    ask: ['-a', 'on-request'],
    edits: null,
    auto: ['--approve-for-me'],
    full: ['--dangerously-bypass-approvals-and-sandbox'],
    plan: ['-s', 'read-only'],
  },
  'Cursor Agent': {
    ask: [],
    edits: null,
    auto: ['--auto-review'],
    full: ['--force'],
    plan: ['--mode', 'plan'],
  },
  // Ask first and Allow edits add no flag: they are `permission` rules in its session config
  // (checked further down), as is Plan only's command rule.
  OpenCode: { ask: [], edits: [], auto: null, full: ['--auto'], plan: ['--agent', 'plan'] },
  'Gemini CLI': {
    ask: ['--approval-mode', 'default'],
    edits: ['--approval-mode', 'auto_edit'],
    auto: null,
    full: ['--approval-mode', 'yolo'],
    plan: ['--approval-mode', 'plan'],
  },
  Antigravity: {
    ask: [],
    edits: ['--mode', 'accept-edits'],
    auto: null,
    full: ['--dangerously-skip-permissions'],
    plan: ['--mode', 'plan'],
  },
  'GitHub Copilot': {
    ask: [],
    edits: null,
    auto: null,
    full: ['--allow-all-tools'],
    plan: ['--mode', 'plan'],
  },
  Droid: { ask: null, edits: null, auto: null, full: null, plan: null },
};
const LEVELS = ['ask', 'edits', 'auto', 'full', 'plan'];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-access-'));
const home = path.join(root, 'account'),
  hooks = path.join(root, 'agent-hooks'),
  plugin = path.join(root, 'plugin');
[home, hooks, plugin].forEach(d => fs.mkdirSync(d, { recursive: true }));
const rulesFile = path.join(hooks, 'work-rules.md'),
  mcpConfig = path.join(hooks, 'p.mcp.json');
fs.writeFileSync(rulesFile, 'rules\n');
fs.writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: { tnai: { type: 'http', url: 'http://127.0.0.1:5/mcp/' + 'a'.repeat(32) } },
  })
);
const base = {
  accountDir: home,
  sessionId: '11111111-2222-3333-4444-555555555555',
  workRules: 'Rules.',
  rulesFile,
  rulesPlugin: plugin,
  mcpConfig,
};

// A .cmd launch is one command string for cmd.exe, each word quoted with ^^^" (agent-registry.js
// cmdArg); undo that so both forms are plain words that two specs can be compared by (no word here
// holds a ^ of its own).
const words = spec =>
  spec.verbatim
    ? String(spec.args[spec.args.length - 1])
        .split(' ')
        .map(w => w.replace(/\^/g, '').replace(/^"+|"+$/g, ''))
    : spec.args.map(String);

// What `b` adds to `a`: the words between their common start and common end.
function added(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { gone: a.slice(s, a.length - e), extra: b.slice(s, b.length - e) };
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const toolBits = {
  Codex: 'default_tools_approval_mode=approve',
  'Cursor Agent': '--approve-mcps',
  'GitHub Copilot': '--allow-tool=tnai',
};

(async () => {
  const caps = registry.capabilities();
  for (const [id, row] of Object.entries(TABLE)) {
    const cap = caps.find(c => c.id === id)?.access;
    const want = ['default', ...['ask', 'edits', 'auto', 'full', 'plan'].filter(l => row[l])];
    check(
      !!cap && same(cap.levels, want),
      id +
        ': capabilities levels ' +
        JSON.stringify(cap?.levels) +
        (cap && same(cap.levels, want) ? '' : ' (want ' + JSON.stringify(want) + ')')
    );
    LEVELS.filter(l => !row[l]).forEach(l =>
      check(
        !!cap?.why?.[l],
        id + ': ' + l + ' greyed with a reason: "' + (cap?.why?.[l] || '') + '"'
      )
    );

    let def;
    try {
      def = await registry.spec(id, 'run', { ...base, access: 'default' });
    } catch (e) {
      console.log(
        'skip ' + id + ': ' + e.message + ' (spec not built; capabilities checked above)'
      );
      continue;
    }
    const dw = words(def);
    for (const level of LEVELS) {
      if (!row[level]) {
        let refused = '';
        try {
          await registry.spec(id, 'run', { ...base, access: level });
        } catch (e) {
          refused = e.message;
        }
        check(
          !!refused && refused.includes(cap.why[level]),
          id + ' ' + level + ': refused, "' + refused + '"'
        );
        continue;
      }
      const w = words(await registry.spec(id, 'run', { ...base, access: level }));
      const d = added(dw, w);
      check(
        !d.gone.length && same(d.extra, row[level]),
        id +
          ' ' +
          level +
          ': adds ' +
          JSON.stringify(d.extra) +
          (d.gone.length ? ' and drops ' + JSON.stringify(d.gone) : '')
      );
      if (toolBits[id])
        check(
          w.join(' ').includes(toolBits[id]),
          id + ' ' + level + ": Technically Not's tools still allowed (" + toolBits[id] + ')'
        );
    }
    if (id === 'OpenCode') {
      const env =
        (await registry.spec(id, 'run', { ...base, access: 'full' })).env.OPENCODE_CONFIG_CONTENT ||
        '';
      check(
        /"tnai":\{"type":"remote"/.test(env),
        "OpenCode full: Technically Not's MCP server still in its session config"
      );

      // The levels that are config: what each puts in the session config, and that the other levels
      // and a resumed session put nothing there.
      const cfg = async o =>
        JSON.parse(
          (await registry.spec(id, 'run', { ...base, ...o })).env.OPENCODE_CONFIG_CONTENT || '{}'
        );

      // The names in the app's own list, read from its text. `filter(Boolean)`: the list may end
      // with a comma, and what follows the last comma is not a name.
      const safe =
        (fs
          .readFileSync(path.join(__dirname, '../../desktop/agent-hooks.js'), 'utf8')
          .match(/const SAFE_TNAI = \[([^\]]*)\]/) || [])[1]
          ?.split(',')
          .map(s => s.trim().replace(/^'|'$/g, ''))
          .filter(Boolean) || [];
      const wantBash = {
        '*': 'ask',
        ...Object.fromEntries(
          safe.flatMap(c => [
            ['tnai ' + c, 'allow'],
            ['tnai ' + c + ' *', 'allow'],
          ])
        ),
      };
      const ask = await cfg({ access: 'ask' }),
        edits = await cfg({ access: 'edits' }),
        plan = await cfg({ access: 'plan' });
      check(
        safe.length > 5 && same(ask.permission, { edit: 'ask', bash: wantBash, 'tnai_*': 'allow' }),
        'OpenCode ask: edits ask, commands ask, the ' +
          safe.length +
          ' read-only tnai commands of agent-hooks.js SAFE_TNAI and the tnai tools allowed'
      );
      check(
        Object.keys(ask.permission?.bash || {})[0] === '*',
        'OpenCode ask: the catch-all command rule comes first (its last matching rule wins)'
      );
      check(
        same(edits.permission, { bash: wantBash, 'tnai_*': 'allow' }),
        'OpenCode edits: commands ask, no edit rule (its default allows edits)'
      );
      check(
        same(plan.permission, { 'tnai_*': 'allow' }) &&
          same(plan.agent, { plan: { permission: { bash: wantBash } } }),
        'OpenCode plan: its plan agent asks before commands, the tnai tools allowed'
      );
      for (const c of [ask, edits, plan])
        check(
          c.mcp?.tnai?.type === 'remote' && same(c.instructions, [rulesFile]),
          "OpenCode: the work rules and Technically Not's MCP server stay beside the permission rules"
        );

      // A resumed OpenCode session gets its level again: the rules are launch config, which the
      // conversation does not carry, so without them it would run at OpenCode's own defaults (they
      // allow everything).
      const rAsk = await cfg({ access: 'ask', resumeId: 'abc123' }),
        rEdits = await cfg({ access: 'edits', resumeId: 'abc123' }),
        rPlan = await cfg({ access: 'plan', resumeId: 'abc123' });
      check(
        same(rAsk.permission, ask.permission) &&
          same(rEdits.permission, edits.permission) &&
          same(rPlan.agent, plan.agent),
        'OpenCode resumed at ask, edits, plan: the same permission rules as a fresh session'
      );
      const r0 = words(
        await registry.spec(id, 'run', { ...base, resumeId: 'abc123', access: 'default' })
      );
      for (const l of ['plan', 'full']) {
        const d = added(
          r0,
          words(await registry.spec(id, 'run', { ...base, resumeId: 'abc123', access: l }))
        );
        check(
          !d.gone.length && same(d.extra, row[l]),
          'OpenCode resumed at ' + l + ': adds ' + JSON.stringify(d.extra)
        );
      }
      check(
        r0.includes('--session') && r0.includes('abc123'),
        'OpenCode resumed: the session is still named (' + r0.slice(-2).join(' ') + ')'
      );
      for (const o of [
        { access: 'default' },
        { access: 'full' },
        { access: 'default', resumeId: 'abc123' },
        { access: 'full & calc' },
      ]) {
        const c = await cfg(o);
        check(
          !c.permission && !c.agent,
          'OpenCode ' + JSON.stringify(o) + ': no permission rules added'
        );
      }

      // Effort (agent-registry.js OPENCODE_EFFORT_ON), both states of the switch. The link's
      // effort() is replaced, so nothing is called for real.
      const linkMod = require('../../desktop/opencode-link'),
        pickMod = require('../../desktop/model-pick'),
        realEffort = linkMod.effort,
        calls = [];
      linkMod.effort = (...a) => {
        calls.push(a);
        return true;
      };
      try {
        check(registry.openCodeEffort.shipped === true, 'OpenCode effort: the switch ships ON');
        const m = (await registry.models(id)).models.find(x => x.variants?.length),
          plainModel = (await registry.models(id)).models.find(x => !x.variants?.length);
        if (!m)
          console.log(
            'skip OpenCode effort: this OpenCode lists no model with effort levels (ids only, or not installed)'
          );
        else
          for (const on of [false, true]) {
            registry.openCodeEffort.set(on);
            calls.length = 0;
            const state = 'OpenCode effort, switch ' + (on ? 'ON' : 'OFF') + ': ',
              level = m.variants[0],
              run = { model: m.id, variant: level };
            const c = await cfg({ model: m.id, effort: level, serverPort: 45678 });
            if (on)
              check(
                same(c.agent, { build: run, plan: run }) &&
                  calls.length === 1 &&
                  same(calls[0], [45678, m.id, level, m.variants]),
                state +
                  'the model and level go into the session config for both primary agents, and the link is asked once: ' +
                  JSON.stringify(calls[0])
              );
            else
              check(
                !c.agent && !calls.length,
                state + 'nothing in the session config, the link is never asked'
              );
            calls.length = 0;
            const junk = [
              await cfg({ model: m.id, effort: 'zzzz', serverPort: 45678 }),
              await cfg({ effort: level, serverPort: 45678 }),
              ...(plainModel
                ? [await cfg({ model: plainModel.id, effort: level, serverPort: 45678 })]
                : []),
            ];
            check(
              junk.every(x => !x.agent) && !calls.length,
              state +
                'a level the model does not have, a level with no model' +
                (plainModel ? ', a model with no levels' : '') +
                ': nothing added, the link not asked'
            );
            const both = await cfg({ model: m.id, effort: level, access: 'plan' });
            check(
              on
                ? same(both.agent?.plan, { permission: plan.agent.plan.permission, ...run }) &&
                    same(both.agent?.build, run) &&
                    !calls.length
                : same(both.agent, plan.agent),
              state +
                'with Plan only the plan agent keeps its command rule' +
                (on ? ' beside the level; no link port, so the link is not asked' : '')
            );

            // Plain Node has no link (it is started by the app), so no level is listed in either
            // state; the reason differs.
            const cat = await registry.models(id);
            check(
              !cat.models.some(x => x.efforts?.length) &&
                cat.effortWhy === (on ? 'nolink' : 'off') &&
                !cat.effortNote,
              state + 'without the link no model lists a level, reason "' + cat.effortWhy + '"'
            );
            const refused = (await pickMod.resolve(id, m.id, level)).error || '';
            check(
              on
                ? /^OpenCode has no separate effort setting here: .*link to OpenCode is off/.test(
                    refused
                  )
                : refused === 'OpenCode has no separate effort setting.',
              state + 'an agent asking for it is refused: "' + refused + '"'
            );
          }

        // With the link available (the installed OpenCode is a tested version): levels are listed
        // only with the switch on, and an agent's pick is taken.
        registry.openCodeEffort.set(true);
        linkMod.init({ version: () => registry.version(id) });
        const up = await linkMod.launch('tnai-access-check');
        if (!m || !up)
          console.log(
            'skip OpenCode effort with the link: ' +
              (m
                ? 'the link is not available for this OpenCode version'
                : 'no model with effort levels')
          );
        else {
          const cat = await registry.models(id),
            listed = cat.models.find(x => x.id === m.id);
          check(
            same(listed.efforts, m.variants) &&
              !!cat.effortNote &&
              !cat.effortWhy &&
              cat.models.filter(x => !x.variants?.length).every(x => !x.efforts),
            'OpenCode effort, switch ON and the link available: ' +
              m.id +
              ' lists ' +
              JSON.stringify(listed.efforts) +
              ', a model with no levels lists none, the hover sentence is there'
          );
          const took = await pickMod.resolve(id, m.id, m.variants[m.variants.length - 1]),
            no = (await pickMod.resolve(id, m.id, 'zzzz')).error || '',
            none = plainModel
              ? (await pickMod.resolve(id, plainModel.id, m.variants[0])).error || ''
              : 'has no effort levels';
          check(
            took.effort === m.variants[m.variants.length - 1] &&
              /has no effort "zzzz"/.test(no) &&
              /has no effort levels/.test(none),
            'OpenCode effort: an agent gets a level the model has (' +
              took.effort +
              ') and is refused one it lacks or a model with none: "' +
              none +
              '"'
          );
          registry.openCodeEffort.set(false);
          const off = await registry.models(id);
          check(
            !off.models.some(x => x.efforts?.length) && off.effortWhy === 'off',
            'OpenCode effort, switch OFF and the link available: still no level listed'
          );
        }
        linkMod.close('tnai-access-check');
      } finally {
        registry.openCodeEffort.set();
        linkMod.effort = realEffort;
      }
      const bare = JSON.parse(
        (await registry.spec(id, 'run', { accountDir: home, access: 'ask' })).env
          .OPENCODE_CONFIG_CONTENT || '{}'
      );
      check(
        same(bare.permission, ask.permission) && !bare.instructions,
        'OpenCode ask with the work rules off: the permission rules are still sent'
      );
    }

    // A resumed session keeps the CLI's own access; words that are not a level add nothing.
    const top = LEVELS.filter(l => row[l] && row[l].length).pop();
    if (top && id !== 'OpenCode') {
      // OpenCode's resumed session gets its level again (checked above)
      const r0 = words(
        await registry.spec(id, 'run', { ...base, resumeId: 'abc123', access: 'default' })
      );
      const r1 = words(
        await registry.spec(id, 'run', { ...base, resumeId: 'abc123', access: top })
      );
      check(same(r0, r1), id + ': a resumed session at ' + top + ' adds nothing');
    }
    for (const junk of ['--yolo', 'full & calc', 'FULL', 'bypassPermissions']) {
      const w = words(await registry.spec(id, 'run', { ...base, access: junk }));
      check(same(dw, w), id + ': access "' + junk + '" adds nothing');
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(ok ? 'PASS access levels' : 'FAILED access levels');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(e);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
