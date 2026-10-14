// Technically Not tools · desktop-check/tests/custom-agents.js — Custom agents: import SKILL.md
// files, create a named Claude Code agent with them, deploy (--plugin-dir + --append-system-prompt,
// no prompt sent), name clashes, live rename, attach a skill to a running agent, Codex = name only.
// Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const rejects = async fn => {
  try {
    await fn();
    return '';
  } catch (error) {
    return error.message;
  }
};
const C = window.TnaiCustomAgents,
  S = window.TnaiSkills,
  G = window.TnaiAgents,
  N = window.tnaiNative.skills;
const ptyOf = async paneId => (await window.tnaiNative.pty.list()).find(s => s.paneId === paneId);

check(!!C && !!S, 'TnaiCustomAgents and TnaiSkills present');
await G.detect(true);

// Starter agents (Builder, Fixer, Reviewer; seeding is covered by skill-save-check.js) are removed
// first, so the counts below hold only this test's agents.
for (const a of C.list().filter(
  x =>
    ['Builder', 'Fixer', 'Reviewer'].includes(x.name) &&
    x.scope === 'personal' &&
    !x.skillIds.length
))
  await C.remove(a.id);
check(
  !C.list().some(x => ['Builder', 'Fixer', 'Reviewer'].includes(x.name)),
  'starter agents can be removed'
);

// Import: one valid SKILL.md, one without frontmatter (Technically Not adds it and warns).
const imported = await S.import({
  files: [
    {
      name: 'SKILL.md',
      text: '---\nname: review-helper\ndescription: Reviews a diff for bugs before it is committed.\n---\n# Review helper\nRead the diff, list risks.\n',
    },
    {
      name: 'tidy-imports.md',
      text: '# Tidy Imports\nKeep imports sorted and remove unused ones.\n',
    },
  ],
});
check(imported.imported.length === 2 && !imported.errors.length, 'two SKILL.md files imported');
check(
  imported.imported.find(s => s.id === 'tidy-imports')?.warnings.length > 0,
  'missing frontmatter reported as a warning'
);
check(S.list().filter(s => s.source === 'imported').length >= 2, 'library lists imported skills');
check(
  S.list().some(s => s.source === 'user'),
  'your Claude skills (~/.claude/skills) listed as source user'
);

// Create a Claude Code custom agent with both skills.
const agent = await C.create({
  name: '  Nova Test ',
  base: 'Claude Code',
  role: 'Careful reviewer',
  skillIds: ['review-helper', 'tidy-imports'],
});
check(agent?.name === 'Nova Test', 'name kept exactly as typed (trimmed)');
check(
  /already exists/.test(await rejects(() => C.create({ name: 'nova test', base: 'Claude Code' }))),
  'duplicate name rejected (case-insensitive), never auto-suffixed'
);
const paneTitle = window.TnaiAgents.sessions()[0]?.name;
if (paneTitle)
  check(
    /terminal panel/.test(await rejects(() => C.create({ name: paneTitle, base: 'Claude Code' }))),
    'name of an open thread (“' + paneTitle + '”) rejected'
  );
const valid = await N.validate(agent.id);
check(valid.ok && valid.value.ok, 'claude plugin validate accepts the agent plugin folder');
if (!valid.value?.ok) log.push('     validate: ' + JSON.stringify(valid).slice(0, 400));

// Deploy: a real Claude Code session with the plugin and identity prompt. No prompt is sent.
const t0 = Date.now();
const deployed = await C.deploy(agent.id);
check(deployed?.ok, 'deployed (' + (Date.now() - t0) + ' ms)');
const paneId = deployed?.paneId;
const first = await until(async () => {
  const s = await ptyOf(paneId);
  return s?.running && s;
});
check(first?.customAgentId === agent.id, 'pty session carries customAgentId');
check(
  /--plugin-dir/.test(first?.commandLine || '') &&
    /--append-system-prompt/.test(first?.commandLine || ''),
  'launched with --plugin-dir and --append-system-prompt'
);
check(
  /Nova Test/.test(first?.appendPrompt || ''),
  'identity prompt (its --append-system-prompt-file) names the agent'
);
await wait(5000);
const alive = await ptyOf(paneId);
const screen = ((await window.tnaiNative.pty.replay(paneId))?.buffer || '')
  .replace(/\[[0-9;?]*[ -\/]*[@-~]|\][^]*/g, '')
  .replace(/\s+/g, ' ');
check(
  alive?.running,
  'Claude Code with the plugin still running after 5 s' +
    (alive?.running ? '' : ' (exit ' + alive?.exitCode + ')')
);
log.push('     claude screen: ' + JSON.stringify(screen.slice(-300)));
check(
  window.TnaiThreadList.thread(paneId)?.name === 'Nova Test',
  'its thread has the custom name in the thread list (' +
    window.TnaiThreadList.thread(paneId)?.name +
    ')'
);
check(
  G.sessions().find(s => s.paneId === paneId)?.name === 'Nova Test',
  'TnaiAgents session name is the custom name'
);

// Rename live.
await C.rename(agent.id, 'Nova Renamed');
check(
  !!(await until(() => window.TnaiThreadList.thread(paneId)?.name === 'Nova Renamed', 3000)),
  'rename updates the thread list live (' + window.TnaiThreadList.thread(paneId)?.name + ')'
);
check(
  G.sessions().find(s => s.paneId === paneId)?.name === 'Nova Renamed',
  'rename updates the session name live'
);

// Attach a skill to the running agent: Technically Not never restarts it by itself; a note offers
// Restart now, which restarts it in the same pane.
await S.import({
  files: [
    {
      name: 'SKILL.md',
      text: '---\nname: commit-notes\ndescription: Writes commit notes.\n---\nSummarize the change.\n',
    },
  ],
});
const attached = await C.attach(agent.id, ['commit-notes']);
const note = document.querySelector('.tnai-restart-note');
check(
  attached.restart?.pending &&
    attached.restart.paneId === paneId &&
    !note.hidden &&
    /applies on next start/.test(note.textContent),
  'attach does not restart the running agent · "applies on next start" note shown'
);
await wait(800);
check(
  (await ptyOf(paneId))?.pid === first?.pid,
  'same process still running after attach (no auto-restart)'
);
note.querySelector('[data-act="restart"]').click();
const second = await until(async () => {
  const s = await ptyOf(paneId);
  return s?.running && s.pid !== first?.pid && s;
});
check(
  !!second && second.customAgentId === agent.id,
  'same pane restarted as the same custom agent (new pid)'
);
check(
  C.get(agent.id).skillIds.includes('commit-notes') && (await N.validate(agent.id)).value?.ok,
  'plugin rebuilt with the new skill and still valid'
);

// Codex: name only, skills refused.
const codex = await C.create({ name: 'Codex Helper', base: 'Codex', skillIds: ['review-helper'] });
check(
  codex.supportsSkills === false && codex.skillIds.length === 0,
  'Codex custom agent created with no skills (not supported per session)'
);
check(
  /cannot load skills/.test(await rejects(() => C.attach(codex.id, ['review-helper']))),
  'attaching a skill to a Codex agent is refused with a note'
);

// UI: the strip and the New agent panel.
window.TnaiThreads.open();
await wait(300);
const stripToggle = document.getElementById('customAgentsToggle');
if (stripToggle.getAttribute('aria-pressed') === 'true') {
  stripToggle.click();
  await wait(100);
}
check(
  !stripToggle.hidden && document.querySelector('.tnai-custom-strip').hidden,
  'Custom agents strip closed, header toggle shown'
);
stripToggle.click();
await wait(100);
check(stripToggle.getAttribute('aria-pressed') === 'true', 'header toggle opens the strip');
check(
  !!(await until(
    () =>
      document.querySelectorAll('.tnai-custom-strip:not([hidden]) .tnai-custom-row').length === 2,
    3000
  )),
  'Custom agents strip lists both agents'
);
document.getElementById('newCustomAgent').click();
await wait(150);
const panel = document.querySelector('.tnai-custom-panel');
check(!panel.hidden, 'New agent panel opens');
panel.querySelector('[data-f="name"]').value = 'Draft Agent';
panel.querySelector('[data-f="library"]').value = 'review-helper';
panel.querySelector('[data-f="library"]').dispatchEvent(new Event('change'));
check(
  /review-helper/.test(panel.querySelector('[data-f="chosen"]').textContent),
  'library skill added to the new agent'
);
panel.querySelector('[data-f="base"]').value = 'Codex';
panel.querySelector('[data-f="base"]').dispatchEvent(new Event('change'));
check(
  !panel.querySelector('[data-f="skillNote"]').hidden &&
    panel.querySelector('[data-act="files"]').disabled,
  'choosing Codex disables skills with a note'
);
panel.querySelector('[data-f="base"]').value = 'Claude Code';
panel.querySelector('[data-f="base"]').dispatchEvent(new Event('change'));
document.querySelector('#agentPage').scrollTop = 0;
await wait(600);
console.log('TNAI_SHOT:custom-agents-panel');
await wait(500);
const scopeSelect = panel.querySelector('[data-f="scope"]');
check(
  !!scopeSelect &&
    scopeSelect.value === 'personal' &&
    !!scopeSelect.querySelector('[value="project"]'),
  'New agent panel has Save to: Personal · This project'
);
panel.querySelector('[data-act="cancel"]').click();

// Project agents (the seeded project folder is open): saved in .tnai/agents.json, tagged Project,
// Auto-start + Copy to personal on the row.
const strip = document.querySelector('.tnai-custom-strip');
check(
  !!strip.querySelector('[data-act="start-all"]'),
  'Start all button in the Custom agents strip header'
);
strip.querySelector('[data-act="close-strip"]').click();
await wait(100);
check(
  strip.hidden && stripToggle.getAttribute('aria-pressed') === 'false',
  '× closes the Custom agents strip'
);
stripToggle.click();
await wait(100);
check(
  /^Personal · /.test(
    strip.querySelector('.tnai-custom-row[data-agent="' + codex.id + '"] small')?.textContent || ''
  ),
  'personal agent tagged Personal'
);
check(
  /already exists/.test(
    await rejects(() => C.create({ name: 'codex helper', base: 'Claude Code', scope: 'project' }))
  ),
  'project agent name clash with a personal agent refused'
);
const proj = await C.create({
  name: 'Project Scout',
  base: 'Claude Code',
  scope: 'project',
  skillIds: ['review-helper'],
});
check(proj.scope === 'project', 'project agent created');
const saved = await window.tnaiNative.fs.read('.tnai/agents.json', 0, 1e6);
const savedText = saved?.ok ? new TextDecoder().decode(saved.value) : '';
check(
  /Project Scout/.test(savedText) && !/accountId/.test(savedText),
  '.tnai/agents.json holds the agent without an account id'
);
await until(() => strip.querySelector('.tnai-custom-row[data-agent="' + proj.id + '"]'), 3000);
const projRow = strip.querySelector('.tnai-custom-row[data-agent="' + proj.id + '"]');
check(
  /^Project · /.test(projRow?.querySelector('small')?.textContent || ''),
  'project agent tagged Project'
);
check(
  !!projRow?.querySelector('[data-act="autostart"]') &&
    /Copy to personal/.test(projRow?.textContent || ''),
  'project row has Auto-start and Copy to personal'
);
check(
  /Copy to project/.test(
    strip.querySelector('.tnai-custom-row[data-agent="' + codex.id + '"]')?.textContent || ''
  ),
  'personal row has Copy to project'
);
await C.setAutoStart(proj.id, true);
check(C.get(proj.id).autoStart === true, 'Auto-start stored with the project agent');
await C.remove(proj.id);
check(!C.get(proj.id), 'project agent deleted');

// Cleanup.
G.stop(paneId);
await wait(500);
await C.remove(agent.id);
await C.remove(codex.id);
for (const id of ['review-helper', 'tidy-imports', 'commit-notes']) await S.remove(id);

// the starter skills Technically Not seeds stay in the library
const mine = ['review-helper', 'tidy-imports', 'commit-notes'];
check(
  !C.list().length && !S.list().some(s => s.source === 'imported' && mine.includes(s.id)),
  'agents and imported skills removed'
);
return { ok, log };
