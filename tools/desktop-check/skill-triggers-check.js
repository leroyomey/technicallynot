// Logic check for desktop/skill-triggers.js (plain Node): node
// tools/desktop-check/skill-triggers-check.js
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  assert = require('assert');
const t = require('../../desktop/skill-triggers');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-skill-triggers-'));
const skill = (dir, name, body) => {
  const d = path.join(root, dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), body);
};
skill(
  '.claude/skills',
  'tnai-modern-ui',
  '---\nname: tnai-modern-ui\ndescription: >-\n  Modern UI rules.\nkeywords: css, button, dark mode\n---\nbody'
);
skill(
  '.claude/skills',
  'tnai-agent-orchestration',
  '---\nname: tnai-agent-orchestration\ndescription: Agents.\n---\n'
);
skill('.agents/skills', 'secret', '---\nname: secret-ui\ndescription: x\ntnai-hidden: true\n---\n');
try {
  const names = p => t.match(p, root).map(s => s.name);
  assert.deepStrictEqual(names('Fix the UI spacing'), ['tnai-modern-ui'], 'name word matches');
  assert.deepStrictEqual(
    names('rebuild the guide'),
    [],
    'whole words only (no "ui" inside "build"/"guide")'
  );
  assert.deepStrictEqual(
    names('add a Dark Mode toggle'),
    ['tnai-modern-ui'],
    'multi-word keyword, any case'
  );
  assert.deepStrictEqual(
    names('the agent is slow'),
    [],
    'stop-listed name word alone does not match'
  );
  assert.deepStrictEqual(
    names('orchestration of UI'),
    ['tnai-agent-orchestration', 'tnai-modern-ui'].sort(),
    'several matches'
  );
  assert.ok(!names('secret ui').includes('secret-ui'), 'hidden skills never match');

  // Only the user's own words count: attachment labels, pasted addresses and the app's own notices
  // are left out.
  assert.deepStrictEqual(
    names('[Image #1] what is this [Image: source: C:\\shots\\css button.png]'),
    [],
    'attachment labels are not matched'
  );
  assert.deepStrictEqual(
    names('[TN.ai] Screenshot 1 — [Attached image: C:\\shots\\dark mode css.png]'),
    [],
    'attached image paths are not matched'
  );
  assert.deepStrictEqual(
    names('look at https://example.com/css/button here'),
    [],
    'a pasted address is not matched'
  );
  assert.deepStrictEqual(
    names('[from Technically Not] src/css/button.css, which you hold (file lock), changed on disk'),
    [],
    "the app's own notices are not matched"
  );
  assert.deepStrictEqual(
    names('[Image #2] fix the css'),
    ['tnai-modern-ui'],
    "the user's words beside an attachment still match"
  );
  skill(
    '.claude/skills',
    'pics',
    '---\nname: pics\ndescription: Pictures.\nkeywords: image, images, photo\n---\n'
  );
  assert.deepStrictEqual(
    t.forPromptWith('resize these images, each image', root).strong,
    [],
    'one word in two forms is one hit, not two'
  );
  assert.deepStrictEqual(
    t.forPromptWith('resize the image in this photo', root).strong,
    ['pics'],
    'two different words still make it required'
  );
  fs.rmSync(path.join(root, '.claude/skills/pics'), { recursive: true, force: true });
  assert.strictEqual(t.forPrompt('nothing here', root), '');
  assert.ok(
    /tnai-modern-ui \(matched: css\) — Modern UI rules\. \[\.claude\/skills\/tnai-modern-ui\/SKILL\.md\]/.test(
      t.forPrompt('tweak the css', root)
    ),
    'hook text'
  );

  // Library skills on for every session (outside the project): matched too, full path shown, a
  // project skill of the same name wins.
  skill(
    'lib',
    'web-deploy',
    '---\nname: web-deploy\ndescription: Deploy sites.\nkeywords: hosting\n---\n'
  );
  skill('lib', 'tnai-modern-ui', '---\nname: tnai-modern-ui\ndescription: Library copy.\n---\n');
  const lib = ['web-deploy', 'tnai-modern-ui'].map(n => path.join(root, 'lib', n, 'SKILL.md'));
  assert.deepStrictEqual(
    t.match('pick a hosting plan', root, lib).map(s => s.name),
    ['web-deploy'],
    'library skill keyword'
  );
  assert.deepStrictEqual(
    t.match('the UI', root, lib).map(s => s.description),
    ['Modern UI rules.'],
    'project copy wins over a library skill of the same name'
  );
  const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-skill-lib-'));
  try {
    assert.ok(
      t.forPrompt('deploy it', libRoot, lib).includes('[' + lib[0].replace(/\\/g, '/') + ']'),
      'library skill shows its full path'
    );
  } finally {
    fs.rmSync(libRoot, { recursive: true, force: true });
  }
  assert.deepStrictEqual(
    t.match('deploy it', root).map(s => s.name),
    [],
    'no library skills passed, none matched'
  );
  assert.deepStrictEqual(
    t.match('Fix the UI', root, [], new Set(['tnai-modern-ui'])),
    [],
    'a skill already read this session is not suggested again'
  );

  // `paths:` globs: a file the session opens offers the skill that owns it, once.
  skill(
    '.claude/skills',
    'tnai-verification',
    '---\nname: tnai-verification\ndescription: Checks.\npaths: tools/, src/scripts/*-check.js, "**/*.test.js"\n---\n'
  );
  const owns = f => t.forFile(f, root).names;
  assert.deepStrictEqual(
    owns(path.join(root, 'tools', 'a', 'b.js')),
    ['tnai-verification'],
    'bare folder = everything under it (absolute path)'
  );
  assert.deepStrictEqual(
    owns('src/scripts/9-check.js'),
    ['tnai-verification'],
    '* inside one folder'
  );
  assert.deepStrictEqual(owns('src/scripts/x/9-check.js'), [], '* does not cross folders');
  assert.deepStrictEqual(
    owns('deep/er/x.test.js'),
    ['tnai-verification'],
    '**/ any depth, quoted glob'
  );
  assert.deepStrictEqual(
    owns(path.join(os.tmpdir(), 'elsewhere.js')),
    [],
    'files outside the project own nothing'
  );
  assert.deepStrictEqual(
    t.forFile('tools/x.js', root, [], new Set(['tnai-verification'])).names,
    [],
    'skip set'
  );
  assert.ok(
    /^Skill that owns tools\/x\.js\. Read it before you change this file/.test(
      t.forFile('tools/x.js', root).text
    ),
    'file hook text'
  );

  // The file hook keeps the project's skill list between tool calls; a changed skill file (the
  // watcher's batch, or the session's own Read/Edit of a SKILL.md) makes the next call scan again,
  // so a new `paths:` counts at once.
  skill(
    '.claude/skills',
    'docs-owner',
    '---\nname: docs-owner\ndescription: Docs.\npaths: docs/\n---\n'
  );
  t.changed([{ path: 'src/app.js', type: 'change' }]);
  assert.deepStrictEqual(
    owns('docs/a.md'),
    [],
    'a change elsewhere keeps the kept list (the new skill is not scanned yet)'
  );
  t.changed([{ path: '.claude\\skills\\docs-owner\\SKILL.md', type: 'rename' }]);
  assert.deepStrictEqual(
    owns('docs/a.md'),
    ['docs-owner'],
    'a watcher batch with a skill file: scanned again'
  );
  fs.writeFileSync(
    path.join(root, '.claude/skills/docs-owner/SKILL.md'),
    '---\nname: docs-owner\ndescription: Docs.\npaths: notes/\n---\n'
  );
  assert.deepStrictEqual(
    owns('.claude/skills/docs-owner/SKILL.md'),
    [],
    'the hook for a SKILL.md itself scans again'
  );
  assert.deepStrictEqual(
    [owns('docs/a.md'), owns('notes/a.md')],
    [[], ['docs-owner']],
    'and the edited `paths:` count from then on'
  );
  fs.rmSync(path.join(root, '.claude/skills/docs-owner'), { recursive: true, force: true });
  t.changed();

  // skill-stats: suggested / read / verdicts, per session.
  const st = require('../../desktop/skill-stats');
  st.init({ dir: root });
  st.offered('p1', ['tnai-verification']);
  st.tool('p1', { tool_name: 'Skill', tool_input: { skill: 'project:tnai-verification' } });
  st.tool('p1', {
    tool_name: 'Read',
    tool_input: { file_path: 'C:\\x\\.claude\\skills\\tnai-verification\\SKILL.md' },
  });
  st.prompted('p1', "No, that's not what I asked");
  st.prompted('p1', 'thanks'); // nothing read since the last prompt: no verdict
  assert.deepStrictEqual(
    (({ suggested, read, corrected, approved }) => ({ suggested, read, corrected, approved }))(
      st.of('TNAI-verification')
    ),
    { suggested: 1, read: 1, corrected: 1, approved: 0 },
    'counts'
  );
  assert.ok(
    st.readIn('p1').has('tnai-verification') && st.known('p1').has('tnai-verification'),
    'session sets'
  );
  assert.strictEqual(st._test.verdict('thanks, works now'), 'approved');
  assert.strictEqual(
    st._test.verdict("thanks but it still doesn't work"),
    'corrected',
    'a correction wins'
  );
  assert.strictEqual(st._test.verdict('add a button'), '', 'a new task says nothing');

  // The finish check: a skill the task was told to read (2+ keywords, or an edited file it owns)
  // and didn't is held once per task.
  const strong = p => t.forPromptWith(p, root).strong;
  assert.deepStrictEqual(
    strong('change the css of that button'),
    ['tnai-modern-ui'],
    'two keywords: required'
  );
  assert.deepStrictEqual(strong('tweak the css'), [], 'one keyword: offered, not required');
  assert.deepStrictEqual(
    t.forPromptWith('nothing here', root).strong,
    [],
    'no match: nothing required'
  );
  st.prompted('p2', 'change the css of that button');
  st.require('p2', strong('change the css of that button'));
  assert.deepStrictEqual(st.hold('p2'), ['tnai-modern-ui'], 'not read: held, with the name');
  assert.deepStrictEqual(st.hold('p2'), [], 'held once per task only');
  assert.strictEqual(st.of('tnai-modern-ui').held, 1, 'the hold is counted');
  st.prompted('p2', 'now the dark mode button');
  st.require('p2', ['tnai-modern-ui']);
  st.tool('p2', { tool_name: 'Skill', tool_input: { skill: 'tnai-modern-ui' } });
  assert.deepStrictEqual(st.hold('p2'), [], 'read during the task: not held');
  st.prompted('p3', 'edit a tool');

  // what agent-hooks.js does after an edit of an owned file
  st.require('p3', t.forFile('tools/x.js', root, [], st.readIn('p3')).names);
  assert.deepStrictEqual(
    st.hold('p3'),
    ['tnai-verification'],
    'edited a file a skill owns without reading the skill: held'
  );
  st.prompted('p3', 'next task');
  assert.deepStrictEqual(st.hold('p3'), [], 'a new task starts with nothing required');
  const hooks = fs.readFileSync(path.join(__dirname, '../../desktop/agent-hooks.js'), 'utf8');
  assert.ok(
    /hook_event_name === 'Stop'\s*&&\s*!msg\.stop_hook_active\s*&&\s*!msg\.agent_id/.test(hooks) &&
      /decision: 'block'/.test(hooks),
    'agent-hooks holds a Stop once, never a stop that already follows a hold or a sub-agent'
  );
  assert.ok(
    hooks.indexOf("decision: 'block'") < hooks.indexOf('turns.claudeHook(paneId, msg)'),
    'a held Stop is answered before the turn is recorded as ended'
  );
  st.flush();
  assert.strictEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'skill-stats.json'), 'utf8')).skills[
      'tnai-verification'
    ].read,
    1,
    'saved to disk'
  );
  console.log('OK: skill-triggers');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
