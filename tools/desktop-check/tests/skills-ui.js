// Technically Not tools · desktop-check/tests/skills-ui.js — Skills page (replaces Context):
// grouped library, drag a skill onto a custom agent, Apply menu, live "in use" from agent output on
// the page, clears on idle; the hidden old grid of 11 builds no cards. No prompt is sent to any
// agent. Returns {ok, log}.
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
    await wait(25);
  }
  return null;
};
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const layout = document.querySelector('.layout'),
  page = document.getElementById('skillsPage');
const DRAG = 'application/x-tnai-skill';

// Nav: Skills replaces Context and routes to its own page.
const nav = document.querySelector('.side-item[data-ai-tool="skills"]');
check(
  !!nav &&
    /Skills/.test(nav.textContent) &&
    !document.querySelector('.side-item[data-ai-tool="context"]'),
  'nav shows Skills, not Context'
);
nav.click();
await frame();
check(
  layout.classList.contains('skills-mode') &&
    !!page.offsetParent &&
    nav.classList.contains('active'),
  'Skills page shown, nav active'
);
check(!document.getElementById('agentPage').offsetParent, 'agent tree hidden on Skills page');
check(
  !!window.TnaiSkills && !!window.TnaiCustomAgents && !!window.TnaiSkillsUI,
  'TnaiSkills, TnaiCustomAgents, TnaiSkillsUI present'
);

// Import a skill (same path the file picker uses) -> Imported group row.
await window.TnaiSkills.import({
  files: [
    {
      name: 'SKILL.md',
      text: '---\nname: test-skill\ndescription: Checks that Technically Not shows skills in use.\n---\nSay hello.\n',
    },
  ],
});

// The Imported group may be capped: show all of it.
const more = await until(
  () => page.querySelector('.skills-group button[data-act="toggle-group"][data-source="imported"]'),
  3000
);
if (more && /Show all/.test(more.textContent)) {
  more.click();
  await frame();
}
const row = await until(() =>
  page.querySelector('.skills-group .skill-row[data-skill-id="test-skill"]')
);
check(!!row, 'imported skill listed');
check(
  [...page.querySelectorAll('.skill-row')].every(r =>
    /Last used|Not used since|Not used yet|In use/.test(
      r.querySelector('.sk-foot')?.textContent || ''
    )
  ),
  'every skill row shows when it was last used'
);
check(
  /Imported into Technically Not/.test(
    row?.closest('.skills-group')?.querySelector('header')?.textContent || ''
  ),
  'listed under Imported into Technically Not'
);
check(
  [...page.querySelectorAll('.skills-group>header b')]
    .map(b => b.textContent)
    .join('|')
    .startsWith('Imported into Technically Not|From this project|Your Claude skills'),
  'groups: Imported / Project / Your Claude skills (no Built in group)'
);

// Starter skills Technically Not ships are public library skills: listed as Imported, on for every
// session by default, can be turned off and removed. skills-ui.main.js left an old unchanged
// Technically Not copy of ground-truth (Technically Not updates it) and a user-edited copy of
// failure-memory (Technically Not keeps it).
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const starterRow = await until(() =>
  page.querySelector('.skill-row[data-skill-id="ground-truth"]')
);
check(
  !!starterRow &&
    starterRow.draggable &&
    !!starterRow.querySelector('[data-act="remove"]') &&
    !!starterRow.querySelector('[data-act="apply"]') &&
    !!starterRow.querySelector('[data-everywhere]'),
  'starter skill listed as a normal skill: Apply, Remove, "Every session" on'
);
check(
  !page.querySelector('[data-skill-id^="builtin:"]') &&
    !window.TnaiSkills.list().some(
      k => k.source === 'builtin' || /tnai report/i.test(k.name + k.description)
    ),
  'no built-in/hidden Technically Not skill on the page'
);
const loaded = await main('launch').catch(() => []),
  gt = loaded.find(k => k.id === 'ground-truth'),
  fm = loaded.find(k => k.id === 'failure-memory');
check(
  !!gt && !/Old text/.test(gt.text),
  'an unchanged Technically Not copy is updated to the shipped version'
);
check(!!fm && /User edit/.test(fm.text), 'a starter copy the user changed is kept as is');
{
  const starters = [
    'agent-efficiency',
    'ground-truth',
    'failure-memory',
    'durable-data-design',
    'safe-file-split',
  ]; // desktop/builtin-skills (low-usage-sessions merged into agent-efficiency, 2026-09-25)
  check(
    starters.every(id => loaded.some(k => k.id === id)) &&
      !loaded.some(k => k.id === 'low-usage-sessions'),
    'every session loads the starter skills (' + loaded.length + ' loaded)'
  );
}
check(
  loaded.some(k => k.id === 'my-own-skill'),
  'an extra account also gets the user’s own Claude skills (~/.claude/skills)'
);
starterRow.querySelector('[data-act="apply"]').click();
const everyItem = [...document.querySelectorAll('.tnai-skill-menu button')].find(b =>
  /Every session/.test(b.textContent)
);
check(!!everyItem && /✓ on/.test(everyItem.textContent), 'Apply menu: Every session ✓ on');
everyItem?.click();
check(
  !!(await until(
    () => window.TnaiSkills.list().find(k => k.id === 'ground-truth')?.everywhere === false,
    5000
  )),
  'turned off for every session'
);
await window.TnaiSkills.everywhere('ground-truth', true);
check(
  window.TnaiSkills.list().find(k => k.id === 'ground-truth')?.everywhere === true,
  'turned back on'
);
await window.TnaiSkills.remove('safe-file-split');
await window.TnaiSkills.refresh();
check(
  !window.TnaiSkills.list().some(k => k.id === 'safe-file-split'),
  'a starter skill can be removed and is not added back'
);

// A custom agent appears as a drop target; drag-drop attaches the skill.
const agent = await window.TnaiCustomAgents.create({
  name: 'Skill Tester',
  base: 'Claude Code',
  skillIds: [],
});
const target = await until(() =>
  page.querySelector('.skills-target[data-agent-id="' + agent.id + '"][data-accept="1"]')
);
check(!!target, 'custom agent listed as a drop target');
const dt = new DataTransfer();
dt.setData(DRAG, 'test-skill');
page
  .querySelector('.skill-row[data-skill-id="test-skill"]')
  .dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
target.dispatchEvent(
  new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
);
check(target.classList.contains('drop-ok'), 'drop target highlights on dragover');
target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
page.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
check(
  !!(await until(
    () => window.TnaiCustomAgents.get(agent.id)?.skillIds?.includes('test-skill'),
    5000
  )),
  'drop attached the skill to the agent'
);
check(
  !!(await until(
    () =>
      /Skill Tester/.test(
        page.querySelector('.skill-row[data-skill-id="test-skill"] .skill-agents')?.textContent ||
          ''
      ),
    3000
  )),
  'skill row shows which agent has it'
);

// Apply menu lists the agent with a check mark.
page.querySelector('.skill-row[data-skill-id="test-skill"] [data-act="apply"]').click();
check(
  /Skill Tester[\s\S]*✓/.test(document.querySelector('.tnai-skill-menu')?.textContent || ''),
  'Apply menu shows the agent as added'
);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(!document.querySelector('.tnai-skill-menu'), 'Escape closes the Apply menu');

// An agent's own skill list stays open while skills are picked, one after another;
// a click outside or Escape closes it.
{
  const menuEl = () => document.querySelector('.tnai-skill-menu'),
    rowOf = name =>
      [...document.querySelectorAll('.tnai-skill-menu button')].find(
        b => b.querySelector('span')?.textContent === name
      );
  const hasSkill = id => !!window.TnaiCustomAgents.get(agent.id)?.skillIds?.includes(id);
  page.querySelector('.skills-target[data-agent-id="' + agent.id + '"]').click();
  check(
    /✓ added/.test(rowOf('test-skill')?.textContent || ''),
    'an agent’s skill list opens with its skill marked added'
  );
  rowOf('ground-truth')?.click();
  check(!!(await until(() => hasSkill('ground-truth'), 5000)), 'a pick in the list adds the skill');
  check(
    !!menuEl() &&
      !!(await until(() => /✓ added/.test(rowOf('ground-truth')?.textContent || ''), 3000)),
    'the list stays open and the row says added'
  );
  rowOf('failure-memory')?.click();
  check(
    !!(await until(() => hasSkill('failure-memory'), 5000)) && !!menuEl(),
    'a second pick straight after: added, list still open'
  );
  rowOf('ground-truth')?.click();
  check(
    !!(await until(() => !hasSkill('ground-truth'), 5000)) &&
      !!menuEl() &&
      !!(await until(() => !/✓/.test(rowOf('ground-truth')?.textContent || '✓'), 3000)),
    'pressing an added row again removes it, list still open'
  );
  rowOf('failure-memory')?.click();
  await until(() => !hasSkill('failure-memory'), 5000);
  await frame();
  await frame();
  await wait(200);
  const r = menuEl()?.getBoundingClientRect();
  check(
    !!r && r.width > 100 && r.left >= 0 && r.top >= 0 && r.left < innerWidth,
    'the list is still in place after the page redrew under it' +
      (r ? ' (' + Math.round(r.left) + ', ' + Math.round(r.top) + ')' : '')
  );
  await shot('skills-agent-list-open');
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  check(!menuEl(), 'a click outside the list closes it');
  page.querySelector('.skills-target[data-agent-id="' + agent.id + '"]').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(!menuEl(), 'Escape closes it');
}

// An agent saves a skill (`tnai skill save`): it is on for every session, so the user is told:
// a bell notice, and a "New · agent-written" mark on its card until its
// details were opened. A skill the user imported gets neither.
{
  const ID = 'agent-made-skill',
    STORE = 'tnai.skills.agent-new.v1',
    stored = () => {
      try {
        return JSON.parse(localStorage.getItem(STORE) || '[]');
      } catch {
        return [];
      }
    };
  const cardOf = () => page.querySelector('.skill-row[data-skill-id="' + ID + '"]'),
    mark = () => cardOf()?.querySelector('.sk-kw .new');
  const notice = () =>
    document.querySelector('.tnai-bell-pop [data-item="notice:skill-saved:' + ID + '"]');
  const saved = await main('agentSave', ID).catch(error => ({ error: error.message }));
  check(
    saved?.id === ID && saved.everywhere === true,
    'an agent saved a skill; it is on for every session (' + JSON.stringify(saved) + ')'
  );
  check(
    !!(await until(mark, 5000)) &&
      mark().textContent === 'New · agent-written' &&
      /agent saved this skill/.test(mark().title),
    'its card says "New · agent-written" (' + (mark()?.textContent || 'no mark') + ')'
  );
  check(stored().includes(ID), 'the mark is kept for the next start of the app');
  check(
    !page.querySelector('.skill-row[data-skill-id="test-skill"] .sk-kw .new') &&
      page.querySelectorAll('.sk-kw .new').length === 1,
    'only that card is marked, not a skill the user imported'
  );
  {
    const word = [...cardOf().querySelectorAll('.sk-kw span')].find(s => s !== mark()),
      a = mark().getBoundingClientRect(),
      b = word?.getBoundingClientRect(),
      row = cardOf().getBoundingClientRect();
    check(
      !!b &&
        Math.abs(a.top - b.top) < 0.6 &&
        Math.abs(a.height - b.height) < 0.6 &&
        a.right <= b.left &&
        a.left >= row.left &&
        a.right <= row.right,
      'the mark sits in the keyword row, on one line with the keywords and inside the card (top ' +
        a.top.toFixed(1) +
        ' / ' +
        b?.top.toFixed(1) +
        ', height ' +
        a.height.toFixed(1) +
        ' / ' +
        b?.height.toFixed(1) +
        ')'
    );
  }
  window.TnaiNextActions.openBell(true);
  check(
    !!(await until(notice, 3000)) &&
      notice().textContent.includes('An agent saved the skill “' + ID + '”'),
    'the bell has a notice for it: ' + (notice()?.querySelector('.n-who b')?.textContent || 'none')
  );
  await shot('skills-agent-new');
  if (notice()?.dataset.act === 'expand') notice().click();
  const openBtn = await until(() => notice()?.querySelector('button[data-act="notice"]'), 2000);
  check(
    !!openBtn && openBtn.textContent === 'Open' && /every new session/.test(notice().textContent),
    'opened, the notice says it loads in every new session and has an Open button'
  );
  openBtn?.click();
  check(
    !!(await until(
      () => page.querySelector('.sk-detail:not([hidden])')?.dataset.skillId === ID,
      3000
    )) && layout.classList.contains('skills-mode'),
    'Open shows that skill’s details on the Skills page'
  );
  check(
    !!(await until(() => cardOf() && !mark(), 3000)) && !stored().includes(ID),
    'once opened the mark is gone, for good'
  );
  window.TnaiNextActions.openBell(true);
  check(!notice(), 'and its bell notice is gone');
  window.TnaiNextActions.openBell(false);
  window.TnaiSkillsUI.select('');
  await window.TnaiSkills.remove(ID);
  await window.TnaiSkills.refresh();
}

// A running thread that prints Skill(test-skill) marks the skill in use.
const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
check(
  !!(await until(() => window.TnaiAgents.sessions().find(s => s.paneId === paneId && s.running))),
  'shell started'
);
await wait(2500);
nav.click();
await frame();
const plainTarget = await until(
  () => page.querySelector('.skills-target[data-pane-id="' + paneId + '"][data-accept="0"]'),
  3000
);
check(!!plainTarget, 'plain running pane listed but refuses skills');
let t0 = Date.now();
window.TnaiAgents.send(
  paneId,
  /Windows/.test(navigator.userAgent)
    ? 'Write-Output ("Skill(" + "test-skill)")'
    : 'echo "Skill(""test-skill)"'
);
check(
  !!(await until(() => page.querySelector('.skill-row[data-skill-id="test-skill"].in-use'), 3000)),
  'Skills page marks test-skill in use (' + (Date.now() - t0) + ' ms after send, incl. shell run)'
);
const used = window.TnaiFileActivity.skills(paneId);
check(
  used.some(u => u.name === 'test-skill'),
  'TnaiFileActivity.skills(pane) reports it'
);
await shot('skills-page');

// (The old Overview cards of 11 that showed skill chips and took skill drops are no longer built
// while their grid is off screen, which it always is in the thread design.)
window.TnaiThreads.open();
await wait(300);
check(
  !document.querySelector('.tnai-card[data-pane="' + paneId + '"]'),
  'the hidden old grid builds no card for the agent'
);

// Deploy the custom agent (Claude Code starts with its skill; nothing is sent).
const deployed = await window.TnaiCustomAgents.deploy(agent.id);
check(!!deployed?.ok, 'custom agent deployed');

t0 = Date.now();
check(
  !!(await until(() => !window.TnaiFileActivity.skills(paneId).length, 12000)),
  'shell pane in-use clears after it goes idle (' + (Date.now() - t0) + ' ms)'
);
nav.click();
check(
  !!(await until(
    () =>
      page.querySelector('.skill-row[data-skill-id="test-skill"]') &&
      !page.querySelector('.skill-row.in-use'),
    3000
  )),
  'Skills page row no longer in use'
);
if (deployed?.paneId)
  log.push(
    '     claude pane skills: ' +
      JSON.stringify(window.TnaiFileActivity.skills(deployed.paneId)) +
      ' · status ' +
      window.TnaiAgents.sessions().find(s => s.paneId === deployed.paneId)?.status
  );

if (deployed?.paneId) window.TnaiAgents.stop(deployed.paneId);
window.TnaiAgents.stop(paneId);
await wait(400);
return { ok, log };
