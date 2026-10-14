/*
 * Technically Not tools · desktop-check/tests/skill-use.js — Skills get offered and counted end to
 * end: recorded Claude Code hook payloads go through the real hook server (skill-use.main.js). A
 * prompt's keywords suggest a skill; opening a file a skill owns (`paths:`) offers that skill once
 * per session; a skill already read is not suggested again; reads and the next prompt's verdict
 * (correction / approval) are counted; the Skills page row shows the counts. No CLI, no prompt, no
 * usage.
 */
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

const paneId = 'skill-use-test-pane';
const prompt = text => ({ hook_event_name: 'UserPromptSubmit', prompt: text });
const tool = (name, input) => ({
  hook_event_name: 'PostToolUse',
  tool_name: name,
  tool_input: input,
  tool_response: {},
});
const [p1, read1, read2, skillOwner, p2, skillSparkle, p3] = await main('play', paneId, [
  prompt('Add a sparkle button to the header'),
  tool('Read', { file_path: 'src/app.js' }),
  tool('Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }),
  tool('Skill', { skill: 'demo-owner' }),
  prompt("No, that's wrong: the sparkle button is broken"),
  tool('Skill', { skill: 'demo-sparkle' }),
  prompt('Thanks, works now. One more sparkle button in the footer'),
]);
check(
  /Skills that match this prompt[\s\S]*demo-sparkle \(matched: [^)]*sparkle button/.test(p1),
  'prompt keywords suggest the skill (read up front: 2 keywords)'
);
check(!/demo-owner/.test(p1), 'a skill with no matching keywords is not suggested for the prompt');
check(
  /Skill that owns src\/app\.js\. Read it before you change this file[\s\S]*demo-owner/.test(read1),
  'reading a file the skill owns offers that skill'
);
check(
  !/demo-owner/.test(read2),
  'the owning skill is offered once per session (not again on the Edit)'
);
check(!/demo-sparkle/.test(read1), 'a skill without paths is not offered for a file');
check(/demo-sparkle/.test(p2), 'a suggested skill the session has not read is suggested again');
check(!/demo-sparkle/.test(p3), 'a skill the session already read is not suggested again');
log.push(
  '     hook answers: ' +
    JSON.stringify({
      p1: p1.slice(0, 90),
      read1: read1.slice(0, 60),
      skillOwner,
      p3: p3.slice(0, 60),
    })
);

// The Skills page shows the counts: demo-owner offered 1, read 1, corrected 1; demo-sparkle
// suggested 2, read 1, approved 1 (tooltip).
const nav = document.querySelector('.side-item[data-ai-tool="skills"]');
nav.click();
await frame();
await window.TnaiSkills.refresh();
const page = document.getElementById('skillsPage');
const more = await until(
  () => page.querySelector('.skills-group button[data-act="toggle-group"][data-source="project"]'),
  1500
);
if (more && /Show all/.test(more.textContent)) {
  more.click();
  await frame();
}
const rowOf = name =>
  [...page.querySelectorAll('.skill-row')].find(
    r => r.querySelector('.skill-title b')?.textContent === name
  );

// Redesign: the health counts live in the detail panel's Health fact (18 .sk-detail dd), shown once
// the card is selected.
const badge = name => {
  const r = rowOf(name);
  if (!r) return null;
  if (r.getAttribute('aria-selected') !== 'true') r.click();
  return (page.querySelector('.sk-detail .sk-d-name')?.textContent || '').includes(name)
    ? [...page.querySelectorAll('.sk-detail dd')].find(d => /suggested/.test(d.textContent)) || null
    : null;
};
const owner = await until(() => badge('demo-owner'), 5000),
  sparkle = await until(() => badge('demo-sparkle'), 3000);
check(
  owner?.textContent === '1× suggested · 1× read · 1× corrected',
  'Skills page: owner row counts (' + owner?.textContent + ')'
);
check(
  sparkle?.textContent === '2× suggested · 1× read',
  'Skills page: sparkle row counts (' + sparkle?.textContent + ')'
);
check(
  /Corrected \/ approved[^:]*: 0 \/ 1/.test(sparkle?.title || ''),
  'approval counted and labeled as inferred in the tooltip'
);
check(
  /inferred/.test(owner?.title || '') && /other CLIs have no hooks/.test(owner?.title || ''),
  'tooltip says what is inferred and what is not counted'
);
console.log('TNAI_SHOT:skill-use');
await wait(600);

await main('done', paneId);
return { ok, log };
