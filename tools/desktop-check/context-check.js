/*
 * Technically Not tools · desktop-check/context-check.js — Shared project context
 * (desktop/agent-context.js) in plain Node with the real agent-lifecycle.js and a fake terminal: a
 * finished task becomes an entry (the agent's "Technically Not report" parsed, else extracted and
 * marked so), files from edit hooks, raw answer and terminal output stored apart; the entry is
 * queued only for live agents whose work overlaps it, delivered once (mid-task tool call or next
 * prompt), latest per agent only, never back to its author; unrelated prompts get nothing; `tnai
 * context` lists, searches and shows; `tnai context brief` prints the standing brief from three
 * fixture reports; automatic upkeep resolves covered items (Undo sticks), supersedes an agent's
 * restated items and flags deleted changed files; decisions ("- Decide:" line or an extracted 2–4
 * option question, recommended first). No CLI runs. Usage: node
 * tools/desktop-check/context-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-context-'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => tmp }, shell: { openPath: async () => '' } }
    : load(req, ...rest);
const lifecycle = require('../../desktop/agent-lifecycle');
const context = require('../../desktop/agent-context');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const root = path.join(tmp, 'proj');
const events = [];
lifecycle.init(() => {}, { canResume: () => true, root: () => root });
context.init((channel, payload) => events.push([channel, payload]), {
  root: () => root,
  ptys: {
    replay: paneId => ({ buffer: '\x1b[32mPS> build ok\x1b[0m\r\nlog of ' + paneId + '\n' }),
  },
});

const start = (paneId, name, agent = 'Claude Code') =>
  lifecycle.started({ paneId, agent, name, root, cwd: root, sessionId: 'sess-' + paneId });
const S = () => context._test.project(),
  // entries / marks are updated at once; files and state() are async
  tick = () => new Promise(r => setTimeout(r, 30));
(async () => {
  let clock = Date.now() - 60000;

  function turn(paneId, task, result, agent = 'Claude Code') {
    const startedAt = ++clock;
    const t = { paneId, agent, startedAt, endedAt: 0, task, result: '' };
    lifecycle.onTurn(t);
    context.onTurn(t);
    return {
      finish: () => {
        const done = { ...t, endedAt: ++clock, endedBy: 'stop', result };
        lifecycle.onTurn(done);
        context.onTurn(done);
      },
    };
  }
  const prompt = (paneId, text) => {
    const h = { hook_event_name: 'UserPromptSubmit', prompt: text };
    lifecycle.prompted(paneId, text);
    context.hook(paneId, h);
    return context.forPrompt(paneId, text);
  };
  const edit = (paneId, file) =>
    context.hook(paneId, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(root, file) },
    });

  start('A', 'Nova');
  start('B', 'Kai');
  start('C', 'Lee', 'Codex');

  // B works on the login form; C on something unrelated.
  prompt('B', 'Add validation to the login form in src/login-form.js');
  const tb = turn('B', 'Add validation to the login form in src/login-form.js', '');
  edit('B', 'src/login-form.js');
  turn('C', 'Write the release notes for the billing export', '');

  // A finishes auth work that touches the same file, with a Technically Not report.
  prompt('A', 'Fix the session expiry bug in auth');
  const ta = turn('A', 'Fix the session expiry bug in auth', '');
  edit('A', 'src/auth/session.js');
  edit('A', 'src/login-form.js');
  ta.finish.call(null);

  // (turn() captured result '' — finish again with a real answer)
  const answer =
    'Fixed the expiry check.\n\n```js\nconst noisy = 1;\n```\n\nTechnically Not report\n- Did: fixed session expiry; login form now refreshes the token\n- Found: tokens were compared in seconds vs milliseconds\n- Changed: session.js uses ms everywhere\n- Remains: none\n- Blockers: e2e tests not run\n- Next: run the auth e2e suite\n';
  const t2 = {
    paneId: 'A',
    agent: 'Claude Code',
    startedAt: ++clock,
    endedAt: 0,
    task: 'Fix the session expiry bug in auth',
  };
  lifecycle.onTurn(t2);
  context.onTurn(t2);
  edit('A', 'src/auth/session.js');
  edit('A', 'src/login-form.js');
  const done2 = { ...t2, endedAt: ++clock, endedBy: 'stop', result: answer };
  lifecycle.onTurn(done2);
  context.onTurn(done2);

  await tick();
  const st = await context.state();
  const e = st.entries[0];
  check(
    st.entries.length === 1,
    'a finished task with an empty answer makes no entry; one with an answer makes one (' +
      st.entries.length +
      ')'
  );
  check(
    e &&
      e.reported &&
      e.summary.did[0].startsWith('fixed session expiry') &&
      e.summary.found.length === 1 &&
      !e.summary.remains,
    'the Technically Not report is parsed ("none" dropped)'
  );
  check(
    e && e.summary.blockers[0] === 'e2e tests not run' && e.errors,
    'blockers are kept and flagged'
  );
  check(
    e && e.edited.includes('src/auth/session.js') && e.edited.includes('src/login-form.js'),
    'files come from the edit hooks, relative to the project'
  );
  check(
    e &&
      e.hasLog &&
      fs
        .readFileSync(
          path.join(
            tmp,
            'agent-context',
            fs.readdirSync(path.join(tmp, 'agent-context'))[0],
            e.id + '.log'
          ),
          'utf8'
        )
        .includes('PS> build ok'),
    'terminal output is stored apart, without colour codes'
  );
  check(
    context.raw(e.id).text.includes('const noisy = 1'),
    'the full answer is kept apart, code and all'
  );
  check(
    e &&
      e.queued.some(x => x.name === 'Kai') &&
      !e.queued.some(x => x.name === 'Lee') &&
      !e.queued.some(x => x.name === 'Nova'),
    'queued for Kai (same file) only: not for unrelated Lee, not for its author'
  );

  // Kai, mid-task, gets it at its next tool call; exactly once.
  const mid = context.forTool('B');
  check(
    /Technically Not project context/.test(mid) &&
      mid.includes('Nova') &&
      mid.includes('src/login-form.js') &&
      !mid.includes('noisy'),
    'Kai gets the summary at its next tool call (no raw output)'
  );
  check(context.forTool('B') === '', '…and only once');
  check(
    S().entries[0].delivered.some(x => x.name === 'Kai' && x.how === 'tool'),
    'delivery is recorded (shown as "Shared with Kai")'
  );
  check(context.forTool('C') === '', 'Lee gets nothing mid-task');
  check(prompt('C', 'Polish the release notes wording') === '', 'an unrelated prompt gets nothing');
  check(
    prompt('A', 'Now clean up the session code') === '',
    'the author never gets its own result'
  );

  // A new agent asking about related work gets it with its prompt.
  start('D', 'Rio');
  const p = prompt('D', 'Add a remember-me option to the login form (src/login-form.js)');
  check(
    /Technically Not project context/.test(p) && p.includes('Next: run the auth e2e suite'),
    'a related new prompt gets the relevant summary'
  );
  check(
    prompt('D', 'And update src/login-form.js styles too') === '',
    'never the same entry twice to one agent'
  );

  // A newer result by the same agent supersedes: only its latest is offered.
  const t3 = {
    paneId: 'A',
    agent: 'Claude Code',
    startedAt: ++clock,
    endedAt: 0,
    task: 'Session expiry follow-up in src/login-form.js',
  };
  lifecycle.onTurn(t3);
  context.onTurn(t3);
  lifecycle.onTurn({
    ...t3,
    endedAt: ++clock,
    endedBy: 'stop',
    result:
      'I updated src/login-form.js to show an expiry warning. The e2e suite still fails on CI because the browser is missing. You should install Chromium in CI next.',
  });
  context.onTurn({
    ...t3,
    endedAt: clock,
    endedBy: 'stop',
    result:
      'I updated src/login-form.js to show an expiry warning. The e2e suite still fails on CI because the browser is missing. You should install Chromium in CI next.',
  });
  const e3 = S().entries[0];
  check(
    e3 && !e3.reported && e3.summary.did && e3.summary.blockers?.length && e3.summary.next?.length,
    'without a report the summary is extracted (and marked as extracted)'
  );
  start('E', 'Sol');
  const p2 = prompt('E', 'Work on the login form expiry warning in src/login-form.js');
  check(
    (p2.match(/• Nova/g) || []).length === 1 && p2.includes('expiry warning'),
    'only the latest result per agent is offered'
  );

  // tnai context (any CLI).
  const list = context.query('C', root, []);
  check(
    list.ok &&
      list.text.includes('Nova') &&
      /Known issues/.test(list.text) &&
      /Open \/ recommended next/.test(list.text),
    '`tnai context` lists results, known issues and next steps'
  );
  check(
    list.text
      .split('\n')
      .filter(l => l.startsWith('• '))
      .every(l => l.length <= 360),
    '…each result line kept short'
  );
  check(
    context.query('C', root, ['--all']).text.includes('Nova') &&
      !context.query('C', root, ['--all']).text.startsWith('No finished work matches'),
    '`tnai context --all` lists them (not a topic search)'
  );
  check(
    context.query('C', root, ['billing']).text.startsWith('No finished work matches'),
    '`tnai context TOPIC` searches'
  );
  check(context.query('C', root, ['login-form.js']).text.includes('Nova'), '…by file name too');
  const show = context.query('C', root, ['show', e.id]);
  check(
    show.ok && show.text.includes('# Final answer') && /Full terminal output/.test(show.text),
    '`tnai context show ID` gives the full answer and where the terminal output is'
  );
  check(!context.query('C', root, ['show', 'zzzz']).ok, 'an unknown id is refused');
  check(context.remove(e.id) && !S().entries.some(x => x.id === e.id), 'a result can be removed');
  check(
    events.some(([c]) => c === 'context:changed'),
    'changes are pushed to the window'
  );

  // Suggestions, marks and project notes (kept per project).
  const { parseReport, ideasSection } = context._test;
  check(
    parseReport(
      'x\n\nTechnically Not report\n- Did: a thing\n- Ideas: add dark mode; cache the list'
    ).summary.ideas.join('|') === 'add dark mode|cache the list',
    'report "Ideas:" line becomes suggestions'
  );
  check(
    parseReport('x\n\nTechnically Not report\n- Did: a thing\n- Next: ship it').summary.next[0] ===
      'ship it',
    'the "Technically Not report" block is parsed (old "Technically Not report" still is, above)'
  );
  check(
    !parseReport(
      'x\n\nTechnically Not report\n- Did: a thing\n- Blockers: none (the usual harmless line)'
    ).summary.blockers &&
      parseReport('x\n\nTechnically Not report\n- Did: a\n- Blockers: none of the tests ran')
        .summary.blockers?.length === 1,
    'report "Blockers: none (…)" is no blocker; "none of the tests ran" still is'
  );

  // Decisions: the "- Decide:" report line, the extracted fallback (recommended moved to #1), and
  // numbered lists that are not decisions.
  const { extractChoices } = context._test;
  const dc = parseReport(
    'x\n\nTechnically Not report\n- Did: compared two caches\n- Decide: Which cache should we keep? | 1. Memory cache (recommended) — fastest, no disk | 2. Disk cache — survives restarts'
  )?.summary?.choices;
  check(
    dc &&
      dc.question === 'Which cache should we keep?' &&
      dc.options.length === 2 &&
      dc.options[0].label === 'Memory cache' &&
      dc.options[0].detail === 'fastest, no disk' &&
      dc.options[0].recommended &&
      !dc.options[1].recommended &&
      !dc.extracted,
    'report "Decide:" line → question + options, #1 recommended, detail split off'
  );

  // A "- Decide:" line written above the heading instead of inside the block is
  // the same decision; one inside the block wins.
  const dcStray = parseReport(
    'I looked at both.\n\n- Decide: Which store do we keep? | 1. Memory (recommended) | 2. Disk\n\nTechnically Not report\n- Did: compared two stores'
  );
  check(
    dcStray?.summary?.choices?.question === 'Which store do we keep?' &&
      dcStray.summary.choices.options.length === 2 &&
      dcStray.summary.choices.options[0].recommended &&
      !dcStray.summary.choices.extracted,
    'a "Decide:" line above the report heading is read as the decision'
  );
  const dcBoth = parseReport(
    '- Decide: Old question? | 1. A (recommended) | 2. B\n\nTechnically Not report\n- Did: x\n- Decide: New question? | 1. C (recommended) | 2. D'
  )?.summary?.choices;
  check(
    dcBoth?.question === 'New question?',
    'a "Decide:" line inside the block wins over one above it'
  );
  const dcNone = parseReport(
    'Example:\n```\n- Decide: Quoted? | 1. A (recommended) | 2. B\n```\n- Decide: a line with no options\n\nTechnically Not report\n- Did: x'
  )?.summary;
  check(
    dcNone && !dcNone.choices,
    'a quoted "Decide:" line in fenced code, and one without options, are not decisions'
  );
  const dc2 = parseReport(
    'Technically Not report\n- Did: a\n- Decide: Pick a router | 1. Hash router | 2. History router (recommended)'
  )?.summary?.choices;
  check(
    dc2?.options[0].label === 'History router' &&
      dc2.options[0].recommended &&
      dc2.options[1].label === 'Hash router',
    'report: the recommended option is moved to #1'
  );
  const ex = extractChoices(
    'I looked at the storage layer.\n\nWhich approach do you want?\n\n1. **SQLite** — one file, easy backups\n2. **Postgres** — scales, needs a server\n3. **Keep JSON files** (Recommended) — no migration, fine at this size\n4. **IndexedDB** — browser only\n\nTell me and I will continue.'
  );
  check(
    ex &&
      ex.extracted &&
      ex.question === 'Which approach do you want?' &&
      ex.options.length === 4 &&
      ex.options[0].label === 'Keep JSON files' &&
      ex.options[0].recommended &&
      ex.options[0].detail === 'no migration, fine at this size' &&
      ex.options[1].label === 'SQLite' &&
      ex.options.filter(o => o.recommended).length === 1,
    'extracted: a 4-option question, recommended reordered to #1, labelled extracted'
  );
  check(
    !extractChoices(
      'Done.\n\nChanges:\n1. Added the toggle\n2. Fixed the footer (recommended by the linter)\n3. Updated the README'
    ) &&
      !extractChoices('Which one?\n1. Alpha\n2. Beta\n3. Gamma') &&
      !extractChoices('Should I go on?\n1. A (recommended)\n2. B\n3. C\n4. D\n5. E'),
    'not decisions: a change list without a question, a question with no recommended option, more than 4 options'
  );
  const t6 = {
    paneId: 'C',
    agent: 'Codex',
    startedAt: ++clock,
    endedAt: 0,
    task: 'Pick a storage layer',
  };
  lifecycle.onTurn(t6);
  context.onTurn(t6);
  const d6 = {
    ...t6,
    endedAt: ++clock,
    endedBy: 'stop',
    result:
      'Before I go on, which do you prefer?\n\n1. SQLite — one file\n2. Keep JSON files (recommended) — no migration\n\nLet me know.',
  };
  lifecycle.onTurn(d6);
  context.onTurn(d6);
  const e6 = S().entries.find(e => e.task === 'Pick a storage layer');
  check(
    e6?.summary?.choices?.options?.[0]?.label === 'Keep JSON files' &&
      !(e6.summary.next || [])
        .concat(e6.summary.ideas || [])
        .some(x => /JSON files|SQLite/.test(x)),
    'a finished answer asking for a decision stores summary.choices, and its options are not also next steps'
  );
  check(
    context.setMark(e6.id + ':choices:0', 'answered') &&
      S().marks[e6.id + ':choices:0']?.state === 'answered' &&
      !context.setMark(e6.id + ':choices:1', 'answered'),
    'a decision is marked answered as a whole'
  );
  check(context.setMark(e6.id + ':choices:0', ''), 'and Undo clears it');
  check(
    /Decisions waiting on the user/.test(context.query('', root, []).text),
    '`tnai context` lists open decisions'
  );
  context.remove(e6.id);
  check(
    ideasSection('Done.\n\n## Suggestions\n- Add a retry button\n2. Log slow calls\n\nBye').join(
      '|'
    ) === 'Add a retry button|Log slow calls',
    'a Suggestions heading with bullets becomes suggestions'
  );
  const t4 = {
    paneId: 'C',
    agent: 'Codex',
    startedAt: ++clock,
    endedAt: 0,
    task: 'Billing export notes',
  };
  lifecycle.onTurn(t4);
  context.onTurn(t4);
  context.onTurn({
    ...t4,
    endedAt: ++clock,
    endedBy: 'stop',
    result:
      'Wrote the notes.\n\nIdeas:\n- Export as CSV too\n\nTechnically Not report\n- Did: wrote notes\n- Blockers: billing API docs missing\n- Ideas: add a changelog page',
  });
  const e4 = S().entries[0];
  check(
    e4.summary.ideas?.join('|') === 'Export as CSV too|add a changelog page',
    'report ideas and listed ideas are merged'
  );
  check(
    /billing API docs missing/.test(context.query('B', root, []).text),
    'an open issue shows in `tnai context`'
  );
  check(
    context.setMark(e4.id + ':blockers:0', 'done') &&
      S().marks[e4.id + ':blockers:0'].state === 'done',
    'an issue can be marked done'
  );
  check(
    !/billing API docs missing/.test(context.query('B', root, []).text),
    '…and leaves what agents see'
  );
  check(
    !context.setMark(e4.id + ':did:0', 'done') && !context.setMark('nope:ideas:0', 'done'),
    'only issues, next steps and ideas of a real result can be marked'
  );
  check(
    context.setMark(e4.id + ':blockers:0', '') && !S().marks[e4.id + ':blockers:0'],
    'Undo clears the mark'
  );
  const ck = e4.id + ':blockers:0';
  check(
    context.query('B', root, ['mark', 'claimed', ck]).ok &&
      S().claims[ck]?.agent === 'Kai' &&
      !S().marks[ck],
    'an agent can claim an open issue, which stays open'
  );
  check(
    /billing API docs missing \(.*claimed by Kai/.test(context.query('C', root, []).text),
    '…and other agents see who claimed it'
  );
  check(
    !context.query('C', root, ['mark', 'claimed', ck]).ok && S().claims[ck].agent === 'Kai',
    '…and cannot take it over'
  );
  check(
    context.query('B', root, ['mark', 'undo', ck]).ok && !S().claims[ck],
    'undo releases a claim'
  );
  context.query('B', root, ['mark', 'claimed', ck]);
  context.setMark(ck, 'done');
  check(!S().claims[ck] && context.setMark(ck, ''), 'marking done ends the claim');

  // Real claims: enforced against other agents, not against the user/UI, and tied to the claimant's
  // live instance.
  check(context.query('B', root, ['mark', 'claimed', ck]).ok, 'Kai claims it again');
  const denied = context.query('C', root, ['mark', 'done', ck]);
  check(
    !denied.ok &&
      /Claimed by Kai/.test(denied.error) &&
      /tnai send Kai/.test(denied.error) &&
      !S().marks[ck],
    "a different agent's `mark done` on a live claim is refused, naming the claimant"
  );
  check(
    !context.query('C', root, ['mark', 'undo', ck]).ok && S().claims[ck]?.agent === 'Kai',
    "undo by a non-claimant does not release someone else's claim"
  );
  check(
    context.query('B', root, ['mark', 'done', ck]).ok &&
      S().marks[ck]?.state === 'done' &&
      !S().claims[ck],
    'the claimant itself can still mark its own claim done'
  );
  check(
    context.setMark(ck, ''),
    '(reset via the window/UI path, which is never blocked by a claim)'
  );
  check(context.query('B', root, ['mark', 'claimed', ck]).ok, 'Kai claims it once more');
  lifecycle.closed('B');
  check(
    context.query('C', root, ['mark', 'done', ck]).ok && S().marks[ck]?.state === 'done',
    "a claim ends as soon as the claimant's agent is no longer live, not only after 2 h"
  );
  context.setMark(ck, '');

  // Two live agents with one name are two claimants (app-3 #11): compared by instance id.
  start('TW1', 'Twin');
  start('TW2', 'Twin');
  check(context.query('TW1', root, ['mark', 'claimed', ck]).ok, 'one Twin claims it');
  check(
    !context.query('TW2', root, ['mark', 'claimed', ck]).ok &&
      !context.query('TW2', root, ['mark', 'done', ck]).ok &&
      !context.query('TW2', root, ['mark', 'undo', ck]).ok &&
      S().claims[ck] &&
      !S().marks[ck],
    '…and the other agent named Twin can neither take it, mark it done nor release it'
  );
  check(
    context.query('TW1', root, ['mark', 'done', ck]).ok && S().marks[ck]?.state === 'done',
    '…while the Twin that claimed it can mark it done'
  );
  context.setMark(ck, '');
  lifecycle.exited('TW1');
  lifecycle.exited('TW2');
  check(
    context.addNote('Keep the UI design as it is') && S().notes.length === 1,
    'a project note can be added'
  );
  start('F', 'Rho');
  const pn = prompt('F', 'Unrelated thing');
  check(
    /Project notes \(goals[\s\S]*Keep the UI design/.test(pn),
    'an agent gets the project notes with its next prompt'
  );
  check(!/Project notes/.test(prompt('F', 'Another unrelated thing')), '…once per change');
  check(
    /Keep the UI design/.test(context.query('C', root, []).text),
    'notes are in `tnai context`'
  );
  const cur = context.setNote('current', 'Current build: 1');
  check(
    cur &&
      context.setNote('current', 'Current build: 2') === cur &&
      S().notes.length === 2 &&
      S().notes[1].text === 'Current build: 2',
    'a keyed note is replaced in place, not added twice'
  );
  check(
    context.removeNote(cur) && context.removeNote(S().notes[0].id) && !S().notes.length,
    'a note can be removed'
  );
  context.remove(e4.id);
  check(
    !Object.keys(S().marks).some(k => k.startsWith(e4.id)),
    'removing a result drops its marks'
  );

  // Automatic upkeep (inferred): a later result that covers an open item resolves it; Undo sticks;
  // the same agent's newer items supersede; deleted files flagged.
  const finish = (paneId, task, result, files = [], agent) => {
    const t = { paneId, agent: agent || 'Claude Code', startedAt: ++clock, endedAt: 0, task };
    lifecycle.onTurn(t);
    context.onTurn(t);
    files.forEach(f => edit(paneId, f));
    const d = { ...t, endedAt: ++clock, endedBy: 'stop', result };
    lifecycle.onTurn(d);
    context.onTurn(d);
    return S().entries[0];
  };
  start('G', 'Ada');
  start('H', 'Bo');
  const ada = finish(
    'G',
    'Billing export',
    'Done.\n\nTechnically Not report\n- Did: started the export\n- Remains: wire the export button to the billing API\n- Next: run the billing export tests\n- Blockers: export crashes on empty invoices',
    ['src/billing/export.js']
  );
  const K = (k, i = 0) => ada.id + ':' + k + ':' + i,
    M = k => S().marks[K(k)];
  check(
    S().auto === true && !M('remains') && !M('next'),
    'upkeep is on by default; nothing resolved yet'
  );
  finish(
    'C',
    'Polish release notes',
    'Technically Not report\n- Did: polished the release notes wording',
    [],
    'Codex'
  );
  check(!M('remains') && !M('next') && !M('blockers'), 'an unrelated result resolves nothing');
  const bo = finish(
    'H',
    'Hook up billing export',
    'Technically Not report\n- Did: wired the export button to the billing API; ran the billing export tests, all pass',
    ['src/billing/export.js']
  );
  check(
    M('remains')?.state === 'auto' &&
      M('remains').by === bo.id &&
      M('next')?.state === 'auto' &&
      /same file src\/billing\/export\.js/.test(M('next').why),
    'a later result covering remains + next resolves them automatically (by, why)'
  );
  check(!M('blockers'), '…but not the blocker it does not cover');
  check(
    !/wire the export button/.test(context.query('C', root, []).text),
    'auto-resolved items leave what agents see'
  );
  check(!context.setMark(K('ideas'), 'auto'), 'automatic states cannot be set by hand');
  check(context.setMark(K('remains'), '') && !M('remains'), 'Undo clears the automatic mark');
  finish(
    'H',
    'Billing export again',
    'Technically Not report\n- Did: wired the export button to the billing API again',
    ['src/billing/export.js']
  );
  check(!M('remains'), '…and it sticks: a later covering result does not re-apply it');
  check(
    context.setAuto(false) && S().auto === false && !M('next'),
    'turning upkeep off drops automatic marks'
  );
  check(
    context.setAuto(true) && M('next')?.state === 'auto' && !M('remains'),
    'turning it on re-derives them, still honouring Undo'
  );
  finish(
    'G',
    'Billing export CSV',
    'Technically Not report\n- Did: looked at CSV output\n- Remains: add a CSV download\n- Blockers: export still crashes on empty invoices',
    ['src/billing/csv.js']
  );
  check(
    M('blockers')?.state === 'superseded' && M('remains')?.state !== 'auto',
    'the same agent restating its blocker supersedes the older one'
  );
  fs.mkdirSync(path.join(root, 'src/billing'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/billing/export.js'), '');
  const miss = async () => (await context.state()).entries.find(x => x.id === bo.id).missing;
  check(
    (await miss()).length === 0 &&
      (await context.state()).entries[0].missing.includes('src/billing/csv.js'),
    'changed files missing on disk are flagged, present ones are not'
  );
  fs.rmSync(path.join(root, 'src/billing/export.js'));

  // no watcher in plain Node
  context._test.fsChanged([{ type: 'rename', path: 'src/billing/export.js' }]);
  check(
    (await miss()).includes('src/billing/export.js'),
    '…and a deleted one is flagged when the state is rebuilt'
  );
  context.remove(bo.id);
  check(
    !Object.values(S().marks).some(m => m.by === bo.id),
    'removing a result drops the automatic marks it caused'
  );

  // A weaker overlap only hints ("possibly done by", item stays open); an agent's "- Resolved: KEY"
  // line marks it done, credited to that result.
  const nyx = finish(
    'G',
    'Top bar look',
    'Technically Not report\n- Did: looked at the top bar\n- Next: a small Reset demo link in the top bar'
  );
  const ind = finish(
    'H',
    'Landing demo',
    'Technically Not report\n- Did: added a Reset button to the landing page embedded demo',
    ['landing/demo.js']
  );
  const nk = nyx.id + ':next:0';
  check(
    S().maybe[nk]?.by === ind.id &&
      !S().marks[nk] &&
      /possibly done by/.test(context.query('C', root, []).text),
    'a partial overlap labels the item "possibly done by" and keeps it open'
  );
  const res = finish(
    'C',
    'Unrelated feature',
    'Technically Not report\n- Did: shipped the feature\n- Resolved: ' + nk,
    [],
    'Codex'
  );
  check(
    S().marks[nk]?.state === 'done' &&
      S().marks[nk].by === res.id &&
      S().marks[nk].agent &&
      !res.summary.resolved,
    'an explicit Resolved key marks it done by that result'
  );

  // Consolidation (desktop/context-digest.js): chatter folded, restated items merged, old items
  // parked, old results rolled into a digest.
  const nAck = S().entries.length;
  finish('H', '[from Claude Code · Ada] Ack: will do', 'Ack, noted.');
  check(
    S().entries.length === nAck && !context.query('C', root, []).text.includes('Ack, noted.'),
    'a relayed ack is not stored while upkeep is on, so it never enters `tnai context`'
  );
  check(
    !finish('C', 'Tidy wording', 'Technically Not report\n- Did: tidied the wording', [], 'Codex')
      .chatter,
    '…but a short reported result is kept (Codex has no edit hooks)'
  );
  const n1 = finish(
    'G',
    'Docs pass',
    'Technically Not report\n- Did: read docs\n- Next: add a retry button to the upload dialog'
  );
  const n2 = finish(
    'H',
    'Upload polish',
    'Technically Not report\n- Did: styled upload\n- Remains: the upload dialog needs a retry button'
  );
  const MK = key => S().marks[key];
  check(
    MK(n1.id + ':next:0')?.state === 'merged' &&
      MK(n1.id + ':next:0').by === n2.id &&
      !MK(n2.id + ':remains:0'),
    'an open item a newer result restates is merged into the newest'
  );
  start('I', 'Orin');
  fs.mkdirSync(path.join(root, 'src/legacy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/legacy/exporter.js'), '');
  const now0 = clock;
  clock = Date.now() - 5 * 864e5;
  const old = finish(
    'I',
    'Legacy exporter cleanup',
    'Technically Not report\n- Did: removed the legacy exporter\n- Next: delete the legacy exporter config flag',
    ['src/legacy/exporter.js']
  );
  clock = now0;
  const sk = old.id + ':next:0';
  check(
    MK(sk)?.state === 'stale',
    'an open item older than 3 days that nothing mentioned since is parked'
  );
  const dg = (await context.state()).digest;
  check(
    old.rolled &&
      dg?.count >= 1 &&
      dg.clusters.some(
        c =>
          c.label === 'exporter' &&
          c.entries.includes(old.id) &&
          c.files.includes('src/legacy/exporter.js') &&
          c.did.includes('removed the legacy exporter')
      ),
    'a result older than 2 days is rolled into the digest, grouped by its file'
  );
  const cx = context.query('C', root, []).text;
  check(
    /Earlier work, consolidated/.test(cx) &&
      !cx.includes('• Orin (') &&
      !cx.includes('delete the legacy exporter config flag'),
    '`tnai context` shows the digest in its place; parked items leave the open lists'
  );
  check(
    context.query('C', root, ['exporter']).text.includes(old.id),
    '`tnai context TOPIC` still finds a rolled result'
  );
  check(
    !prompt('E', 'Clean up src/legacy/exporter.js').includes(old.id),
    'rolled results are not delivered automatically'
  );
  check(context.setMark(sk, '') && !MK(sk), 'Undo un-parks an item');
  finish('C', 'Other work', 'Technically Not report\n- Did: other work', [], 'Codex');
  check(!MK(sk), '…and it stays open');
  check(
    context.setAuto(false) && !S().digest && !S().entries.some(x => x.rolled || x.chatter),
    'turning upkeep off unfolds everything'
  );
  const keptAck = finish(
    'H',
    '[from Claude Code · Ada] Ack while upkeep is off',
    'Ack, noted while off.'
  );
  check(keptAck && !keptAck.chatter, 'with upkeep off that same ack is stored');
  check(
    context.setAuto(true) &&
      S().digest?.count >= 1 &&
      S().entries.find(x => x.id === keptAck.id).chatter,
    '…and turning it on consolidates again and folds the stored ack'
  );

  // Very old open items are parked too (no 14-day cutoff); a decision nobody answered is parked
  // once the same agent reports again.
  const t0 = clock;
  clock = Date.now() - 20 * 864e5;
  const ancient = finish(
    'I',
    'Ancient importer work',
    'Technically Not report\n- Did: started the importer\n- Next: wire the quarterly importer retries',
    []
  );
  clock = t0;
  check(
    MK(ancient.id + ':next:0')?.state === 'stale',
    'an open item older than 14 days is parked as well'
  );
  start('J', 'Wren');
  const ask = finish(
    'J',
    'Pick a store',
    'Technically Not report\n- Did: compared stores\n- Decide: Which store? | 1. Memory (recommended) | 2. Disk',
    []
  );
  check(!MK(ask.id + ':choices:0'), 'a fresh decision stays open');
  finish(
    'J',
    'Tidy the store tests',
    'Technically Not report\n- Did: tidied the store tests in src/store.test.js',
    ['src/store.test.js']
  );
  check(
    MK(ask.id + ':choices:0')?.state === 'stale' &&
      /reported again/.test(MK(ask.id + ':choices:0').why),
    'an unanswered decision is parked once the same agent reports a later result'
  );

  // Agents keep the top current: `tnai context note …` and `tnai context mark …` (never a
  // decision).
  const na = context.query('J', root, ['note', 'add', 'Current build: 0.3.15 build 20']);
  check(
    na.ok && S().notes.some(n => n.text === 'Current build: 0.3.15 build 20' && n.by === 'Wren'),
    '`tnai context note add` adds a note that names the agent'
  );
  check(
    /Current build/.test(context.query('J', root, ['note', 'list']).text),
    '`tnai context note list` lists them'
  );
  const nid = S().notes.find(n => n.by === 'Wren').id;
  check(
    context.query('J', root, ['note', 'remove', nid]).ok && !S().notes.some(n => n.id === nid),
    '`tnai context note remove` removes one'
  );
  const multi = finish(
    'J',
    'Queue work',
    'Technically Not report\n- Did: queued\n- Remains: retry the flaky queue test\n- Next: document the queue flags',
    []
  );
  const mk = context.query('J', root, ['mark', 'done', multi.id]);
  check(
    mk.ok &&
      MK(multi.id + ':remains:0')?.state === 'done' &&
      MK(multi.id + ':next:0')?.agent === 'Wren',
    '`tnai context mark done RESULTID` marks all its open items and names the agent'
  );
  check(
    context.query('J', root, ['mark', 'undo', multi.id + ':next:0']).ok &&
      !MK(multi.id + ':next:0'),
    '`tnai context mark undo KEY` puts one back'
  );
  start('K', 'Lark');
  const ask2 = finish(
    'K',
    'Another choice',
    'Technically Not report\n- Did: looked\n- Decide: Ship now? | 1. Yes (recommended) | 2. No',
    []
  );
  check(
    !context.query('J', root, ['mark', 'dismissed', ask2.id + ':choices:0']).ok &&
      !MK(ask2.id + ':choices:0'),
    'agents cannot mark a decision'
  );
  check(
    context.setMark(multi.id + ':remains:0,' + multi.id + ':next:0', 'dismissed') === 2,
    'the window marks several keys in one call'
  );

  // Several "- Decide:" lines in one report (numbered, with or without an empty line before each):
  // every one is kept, the first as summary.choices and the others in its `more`; each is marked on
  // its own; a report with one decision reads as before.
  const TWO =
    'Technically Not report\n- Did: compared\n- Decide: Decision 1 of 3: Which store? | 1. Memory (recommended) | 2. Disk\n- Decide: Decision 2 of 3: Ship today? | 1. No | 2. Yes (recommended)\n- Decide: Decision 3 of 3: Keep the old file? | 1. Keep (recommended) | 2. Delete';
  const many = parseReport(TWO)?.summary?.choices,
    spaced = parseReport(TWO.replace(/\n- Decide/g, '\n\n- Decide'))?.summary?.choices;
  check(
    many?.question === 'Decision 1 of 3: Which store?' &&
      many.more?.length === 2 &&
      many.more[0].question === 'Decision 2 of 3: Ship today?' &&
      many.more[0].options[0].label === 'Yes' &&
      many.more[0].options[0].recommended &&
      many.more[1].question === 'Decision 3 of 3: Keep the old file?' &&
      !many.more[0].more,
    'three "Decide:" lines in a report → three decisions in order (' +
      [many?.question, ...(many?.more || []).map(c => c.question)].join(' | ') +
      ')'
  );
  check(
    JSON.stringify(spaced) === JSON.stringify(many),
    'an empty line before each "Decide:" line gives the same three decisions'
  );
  check(dc && !('more' in dc), 'a report with one decision has no `more`');
  const strayTwo = parseReport(
    '- Decide: Decision 1 of 2: A or B? | 1. A (recommended) | 2. B\n\n- Decide: Decision 2 of 2: C or D? | 1. C (recommended) | 2. D\n\nTechnically Not report\n- Did: x'
  )?.summary?.choices;
  check(
    strayTwo?.question === 'Decision 1 of 2: A or B?' &&
      strayTwo.more?.[0]?.question === 'Decision 2 of 2: C or D?',
    'two "Decide:" lines above the report heading are both kept'
  );
  start('M', 'Moss');
  const ask3 = finish('M', 'Three choices', TWO, []);
  const waiting = () =>
    (context.query('', root, []).text.match(/Decisions waiting on the user[^]*?(?=\n[A-Z]|$)/) || [
      '',
    ])[0];
  check(
    /Decision 1 of 3/.test(waiting()) &&
      /Decision 2 of 3/.test(waiting()) &&
      /Decision 3 of 3/.test(waiting()),
    '`tnai context` lists all three open decisions'
  );
  check(
    context.setMark(ask3.id + ':choices:1', 'answered') &&
      MK(ask3.id + ':choices:1')?.state === 'answered' &&
      !MK(ask3.id + ':choices:0') &&
      !MK(ask3.id + ':choices:2') &&
      !context.setMark(ask3.id + ':choices:3', 'answered'),
    'decision 2 is marked answered on its own; a fourth does not exist'
  );
  check(
    /Decision 1 of 3/.test(waiting()) &&
      !/Decision 2 of 3/.test(waiting()) &&
      /Decision 3 of 3/.test(waiting()),
    'the answered one leaves `tnai context`, the other two stay'
  );
  finish(
    'M',
    'Tidy after the choices',
    'Technically Not report\n- Did: tidied the choice notes in src/choices.md',
    ['src/choices.md']
  );
  check(
    MK(ask3.id + ':choices:0')?.state === 'stale' &&
      MK(ask3.id + ':choices:1')?.state === 'answered' &&
      MK(ask3.id + ':choices:2')?.state === 'stale',
    'once the agent reports again, each unanswered decision is parked and the answered one keeps its state'
  );

  const ut = finish(
    'K',
    'Untested line',
    'Technically Not report\n- Did: patched\n- Untested: the CLI update path → try: install the build and update once',
    []
  );
  check(
    ut.summary?.untested?.[0]?.startsWith('the CLI update path') && !ut.summary?.remains,
    'an Untested line is parsed as its own kind, not Remains'
  );

  // Standing brief: three finished reports, two agents still working, one file in common. No model,
  // nothing drawn.
  for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) lifecycle.exited(id);
  const locks = require('../../desktop/file-locks');
  start('V', 'Vale');
  start('M', 'Gem');
  start('N', 'Nia');
  const vale = finish(
    'V',
    'Fix the valve seal in src/valve.js',
    'Technically Not report\n- Did: fixed the valve seal\n- Changed: valve.js uses the new seat\n',
    ['src/valve.js']
  );
  const gem = finish(
    'M',
    'Draw the gauge in src/gauge.js',
    'Technically Not report\n- Did: drew the gauge\n- Remains: the needle still sticks\n',
    ['src/gauge.js']
  );
  const nia = finish(
    'N',
    'Write the notes page',
    'Technically Not report\n- Did: wrote the notes page\n- Untested: the notes page → try: open it\n- Decide: Publish the notes page? | 1. Yes (recommended) | 2. Not yet\n',
    []
  );
  lifecycle.exited('N');
  prompt('M', 'Keep going on the gauge needle');
  {
    const startedAt = ++clock;
    const t = {
      paneId: 'M',
      agent: 'Claude Code',
      startedAt,
      endedAt: 0,
      task: 'Keep going on the gauge needle',
      result: '',
    };
    lifecycle.onTurn(t);
    context.onTurn(t);
  }
  check(
    locks.acquire(root, 'src/gauge.js', { paneId: 'M', name: 'Gem', provider: 'Claude Code' }).ok,
    'Gem holds the gauge file'
  );
  prompt('V', 'Check the gauge needle in src/gauge.js');
  {
    const startedAt = ++clock;
    const t = {
      paneId: 'V',
      agent: 'Claude Code',
      startedAt,
      endedAt: 0,
      task: 'Check the gauge needle in src/gauge.js',
      result: '',
    };
    lifecycle.onTurn(t);
    context.onTurn(t);
  }
  const fields = context._test.briefFields();
  check(
    fields.proven.some(
      s => /fixed the valve seal/.test(s) && /src\/valve.js/.test(s) && /Vale/.test(s)
    ) &&
      fields.proven.some(s => /drew the gauge/.test(s) && /src\/gauge.js/.test(s)) &&
      fields.proven.some(s => /wrote the notes page/.test(s) && /Nia/.test(s)),
    "proven keeps each report's Did and the files the edit hook recorded (" +
      vale.id +
      ', ' +
      gem.id +
      ', ' +
      nia.id +
      ')'
  );
  check(
    fields.open.some(o => o.kind === 'remains' && /needle still sticks/.test(o.text)) &&
      fields.open.some(o => o.kind === 'untested' && /notes page/.test(o.text)) &&
      fields.open.some(o => o.kind === 'decide' && /Publish the notes page/.test(o.text)),
    'open keeps remains, untested and the unanswered decision'
  );
  check(
    /Publish the notes page/.test(fields.oneNext),
    'one next is the newest unanswered decision, not a blocker'
  );
  check(
    fields.now.length === 2 &&
      fields.now.some(n => n.name === 'Vale' && n.state === 'working') &&
      fields.now.some(n => n.name === 'Gem' && n.files.includes('src/gauge.js')) &&
      !fields.now.some(n => n.name === 'Nia'),
    'now is only the live agents, with the lock named (' +
      fields.now.map(n => n.name + ':' + n.state).join(', ') +
      ')'
  );
  check(
    fields.crossings.some(s =>
      /Vale and Gem share src\/gauge.js \(inferred\)|Gem and Vale share src\/gauge.js \(inferred\)/.test(
        s
      )
    ),
    'a shared file is a crossing, labeled inferred'
  );
  check(
    fields.goal === 'Check the gauge needle in src/gauge.js',
    'the goal is the newest task that is not a follow-up (' + fields.goal + ')'
  );
  const first = context.query('V', root, ['brief']).text;
  check(
    /^Standing brief/.test(first) &&
      /Now:/.test(first) &&
      /Proven:/.test(first) &&
      /Open:/.test(first) &&
      /One next:/.test(first) &&
      /Since last look:/.test(first) &&
      /first look/.test(first),
    'tnai context brief prints the standing brief, and the first look says so'
  );
  const capped = (first.split('Crossings:')[0] || first)
    .split('\n')
    .filter(l => l.startsWith('- ')).length;
  check(
    capped <= 8 && /fixed the valve seal|drew the gauge|wrote the notes page/.test(first),
    'the four headings stay within eight lines (' + capped + ')'
  );
  const second = context.query('V', root, ['brief']).text;
  check(
    !/Since last look:/.test(second),
    'a second look with nothing new leaves Since last look out'
  );
  const shown = await context.state();
  const shownAgain = await context.state();
  check(
    shown.brief === shownAgain.brief &&
      /Standing brief/.test(shown.brief) &&
      /fixed the valve seal/.test(shown.brief) &&
      /Now:/.test(shown.brief),
    'the Result summary brief stays the same text when nothing new arrived'
  );

  // Over the cap (200 entries) the oldest entry is dropped, and its marks, claims, kept and maybe
  // keys go with it; a kept entry loses nothing.
  {
    const p = S(),
      at = Date.now() - 40 * 864e5;
    while (p.entries.length < 200) {
      const id = 'f' + String(p.entries.length).padStart(7, '0');
      p.entries.push({
        id,
        at,
        startedAt: at,
        name: 'Old',
        agent: 'Codex',
        paneId: 'old',
        task: 'old filler',
        summary: { next: ['old step'] },
        files: [],
        edited: [],
        keywords: [],
        delivered: [],
        queued: [],
        chatter: true,
      });
    }
    const last = p.entries.at(-1).id,
      stays = p.entries.at(-2).id,
      key = id => id + ':next:0';
    for (const id of [last, stays]) {
      p.marks[key(id)] = { state: 'done', at };
      p.claims[key(id)] = { agent: 'Old', at };
      p.kept[key(id)] = at;
      p.maybe[key(id)] = { by: 'x', name: 'Old', at };
    }
    const size = k => Object.keys(p[k]).length,
      before = ['marks', 'claims', 'kept', 'maybe'].map(size);
    prompt('B', 'Repaint the harbor crane model in tools/crane.js');
    edit('B', 'tools/crane.js');
    turn(
      'B',
      'Repaint the harbor crane model in tools/crane.js',
      'Painted.\n\nTechnically Not report\n- Did: repainted the harbor crane model\n- Changed: tools/crane.js'
    ).finish();
    const maps = ['marks', 'claims', 'kept', 'maybe'];
    check(
      p.entries.length === 200 &&
        !p.entries.some(e => e.id === last) &&
        p.entries.some(e => e.id === stays),
      'over the cap the oldest entry is dropped (' + p.entries.length + ')'
    );
    check(
      maps.every(k => !(key(last) in p[k])),
      "the dropped entry's marks, claims, kept and maybe keys are deleted with it"
    );
    check(
      maps.every(k => key(stays) in p[k]),
      'a kept entry keeps all four'
    );
    check(
      maps.every((k, i) => size(k) >= before[i] - 1),
      'nothing else was deleted (' + before.join(',') + ' → ' + maps.map(size).join(',') + ')'
    );

    // The window gets the marks and maybe keys of the results it is sent, all of them and no others
    // (it reads them through those results only).
    const sent = await context.state(),
      ids = new Set(sent.entries.map(e => e.id)),
      of = k => k.slice(0, k.indexOf(':'));
    const whole = m =>
      Object.keys(p[m])
        .filter(k => ids.has(of(k)))
        .every(k => k in sent[m]) && Object.keys(sent[m]).every(k => ids.has(of(k)) && k in p[m]);
    check(
      sent.entries.length === 80 &&
        whole('marks') &&
        whole('maybe') &&
        !(key(stays) in sent.marks) &&
        key(stays) in p.marks,
      'the window state carries the marks and maybe keys of its ' +
        sent.entries.length +
        ' results only (' +
        Object.keys(sent.marks).length +
        ' of ' +
        size('marks') +
        ' marks)'
    );
  }

  console.log(ok ? '\nAll context checks passed.' : '\nSome context checks FAILED.');
  await new Promise(r => setTimeout(r, 400)); // debounced saves / async writes still landing
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
  process.exit(ok ? 0 : 1);
})();
