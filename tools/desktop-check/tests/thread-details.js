// Technically Not tools · desktop-check/tests/thread-details.js — an agent's details as a part
// beside its thread (139, window.TnaiThreadDetails), mounted into a host 380 px wide in the
// Threads page's side column. No prompt is sent to any agent.
// Part 1, a PowerShell thread: the total running time is shown and grows; every section heading
// is there; an empty section says so in one line; the facts equal what window.TnaiAgents reports;
// queued prompts pushed the way the app pushes them are listed, and Send now, Edit and Remove do
// what the old page's did; folding hides a section.
// Part 2, a real Claude Code session (started, never prompted) with made-up content: Claude
// Code's own hook messages for a task with three sub-agents, files, skills and a custom agent
// stood in for, a second agent on the same files. Every section shows exactly what was made up,
// long names end in "…", nothing overlaps, every action is pressed once, and the total's three
// color steps are drawn on the running session.
// Part 3: the same in Light with the contrast of every text measured, the host at 320 and 460 px,
// a low window and the smallest window, a renamed workspace, and unmount.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const team = window.TnaiTeam;
const details = () => window.TnaiThreadDetails;
const sessionOf = paneId => agents.sessions().find(session => session.paneId === paneId);
const opened = [];
const realNow = Date.now;
const host = document.createElement('div');
const parked = [];
const undo = [];
let sideWasOpen = true;

// Pictures are named "<test>-<what>": the runner saves its own last picture under the test's name.
const shot = async name => {
  await wait(450);
  console.log('TNAI_SHOT:thread-details-' + name);
  await wait(700);
};

// Replaces a function of one of the app's objects for the length of the test.
const standIn = (object, name, replacement) => {
  const original = object[name];
  object[name] = replacement;
  undo.push(() => {
    object[name] = original;
  });
};

// A turn as desktop/agent-turns.js pushes it, with the prompts the CLI has queued.
const turnOf = (paneId, queued, endedAt) => ({
  paneId,
  agent: 'Terminal',
  source: 'claude-transcript',
  startedAt: realNow() - 5000,
  endedAt: endedAt || 0,
  endedBy: endedAt ? 'stop' : '',
  tokens: null,
  task: 'x',
  result: '',
  queued,
});

// Held prompts as desktop/attention-service.js pushes them: [id, text, from].
const heldOf = (paneId, list) => ({
  items: [],
  held: list.map(([id, text, from]) => ({
    id,
    paneId,
    preview: text,
    text,
    at: realNow(),
    from,
    waitDraft: !!from,
    why: 'busy',
  })),
});

// ---- measuring what is on screen ----
let root = null;
const section = name => root.querySelector('.ttd-sec[data-sec="' + name + '"]');
const body = name => section(name).querySelector('.ttd-body');
const head = name => section(name).querySelector('.ttd-head');
const fact = (name, label) =>
  [...body(name).querySelectorAll('dd')]
    .find(cell => cell.dataset.fact === label)
    ?.querySelector('.ttd-clamp')?.textContent;
const shown = node => node.getClientRects().length > 0;
const texts = (name, selector) =>
  [...body(name).querySelectorAll(selector)].map(node => node.textContent);

// Elements that reach past the host's left or right edge.
function pastTheEdge() {
  const edge = host.getBoundingClientRect();
  return [...root.querySelectorAll('*')].filter(node => {
    if (!shown(node)) return false;
    const box = node.getBoundingClientRect();
    if (!(box.right > edge.right + 0.5 || box.left < edge.left - 0.5)) return false;

    // the cut-off end of a one-line text (a long command in its colors) is not on screen: a box
    // between it and the host that clips its content and itself fits is what is seen
    for (let up = node.parentElement; up && up !== root; up = up.parentElement) {
      const upBox = up.getBoundingClientRect();
      if (
        getComputedStyle(up).overflowX !== 'visible' &&
        upBox.right <= edge.right + 0.5 &&
        upBox.left >= edge.left - 0.5
      )
        return false;
    }
    return true;
  });
}

// Pairs of neighbors (children of one parent) whose boxes lie over each other.
function overlaps() {
  const found = [];
  [root, ...root.querySelectorAll('*')].forEach(parent => {
    // the lines of one drawn icon lie over each other by design
    if (parent.closest('svg')) return;
    const boxes = [...parent.children]
      .filter(shown)
      .map(child => [child, child.getBoundingClientRect()])
      .filter(([, box]) => box.width > 0 && box.height > 0);
    boxes.forEach(([first, one], index) => {
      boxes.slice(index + 1).forEach(([second, two]) => {
        const wide = Math.min(one.right, two.right) - Math.max(one.left, two.left);
        const high = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
        if (wide > 1 && high > 1)
          found.push(
            (first.className || first.tagName) + ' over ' + (second.className || second.tagName)
          );
      });
    });
  });
  return found;
}

// A text that does not fit its one line and is cut with "…" inside the host.
const cutWithDots = node =>
  !!node &&
  node.scrollWidth > node.clientWidth &&
  getComputedStyle(node).textOverflow === 'ellipsis' &&
  node.getBoundingClientRect().right <= host.getBoundingClientRect().right + 0.5;

const sidewaysAndOverlap = label => {
  const past = pastTheEdge();
  const lying = overlaps();

  // words that run out of their own box lie over what stands beside it (a time in a column too
  // narrow for it did: the boxes did not overlap, the words did)
  const spilled = [...root.querySelectorAll('*')].filter(
    node =>
      shown(node) &&
      [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) &&
      node.clientWidth > 0 &&
      getComputedStyle(node).overflowX === 'visible' &&
      node.scrollWidth > node.clientWidth + 1
  );
  check(
    !spilled.length,
    label +
      ': no words run out of their own box' +
      (spilled.length
        ? ' (' +
          (spilled[0].className || spilled[0].tagName) +
          ' "' +
          spilled[0].textContent.slice(0, 30) +
          '")'
        : '')
  );
  check(
    root.scrollWidth <= root.clientWidth && host.scrollWidth <= host.clientWidth && !past.length,
    label +
      ': nothing reaches past the host sideways (' +
      Math.round(host.getBoundingClientRect().width) +
      ' px' +
      (past.length ? ', past the edge: ' + past[0].className : '') +
      ')'
  );
  check(!lying.length, label + ': nothing overlaps' + (lying.length ? ' (' + lying[0] + ')' : ''));
};

// The part scrolls inside its host, and the page itself does not scroll.
const scrollsInside = (label, slot) => {
  const page = document.scrollingElement;
  const rootBox = root.getBoundingClientRect();
  const limit = Math.min(slot ? slot.getBoundingClientRect().bottom : Infinity, window.innerHeight);
  check(
    root.scrollHeight > root.clientHeight &&
      rootBox.bottom <= limit + 1 &&
      page.scrollHeight <= window.innerHeight + 1 &&
      page.scrollWidth <= window.innerWidth + 1,
    label +
      ': the sections scroll inside the host and the page does not (' +
      root.scrollHeight +
      ' in ' +
      root.clientHeight +
      ' px, ends at ' +
      Math.round(rootBox.bottom) +
      ' of ' +
      Math.round(limit) +
      ')'
  );
};

// ---- contrast of a text against the ground it stands on ----
const colorOf = text => {
  const parts = /rgba?\(([^)]+)\)/.exec(text || '');
  if (!parts) return null;
  const numbers = parts[1].split(/[\s,/]+/).map(Number);
  return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers[3] ?? 1 };
};
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

// The ground behind an element: its ancestors' fills laid over the page's own color.
function groundOf(node) {
  const layers = [];
  for (let at = node; at; at = at.parentElement) {
    const fill = colorOf(getComputedStyle(at).backgroundColor);
    if (fill && fill.a > 0) layers.push(fill);
    if (fill && fill.a === 1) break;
  }
  let ground = { r: 255, g: 255, b: 255, a: 1 };
  layers.reverse().forEach(layer => {
    ground = over(layer, ground);
  });
  return ground;
}
const light = color => {
  const part = value => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(color.r) + 0.7152 * part(color.g) + 0.0722 * part(color.b);
};

// Every element of the part with words of its own, with its contrast; the lowest first.
function contrasts() {
  const rows = [];
  root.querySelectorAll('*').forEach(node => {
    const hasWords = [...node.childNodes].some(
      child => child.nodeType === 3 && child.textContent.trim()
    );
    const inkOwn = colorOf(getComputedStyle(node).color);
    if (!hasWords || !shown(node) || !inkOwn) return;
    const ground = groundOf(node);
    const ink = over(inkOwn, ground);
    const high = Math.max(light(ink), light(ground));
    const low = Math.min(light(ink), light(ground));
    const groundText = [ground.r, ground.g, ground.b].map(Math.round).join(' ');
    rows.push([
      (high + 0.05) / (low + 0.05),
      (node.className || node.tagName) + ' on ' + groundText,
      node.textContent,
    ]);
  });
  return rows.sort((one, two) => one[0] - two[0]);
}
const contrastCheck = label => {
  const rows = contrasts();
  const lowest = rows[0];
  check(
    rows.length > 20 && lowest[0] >= 4.5,
    label +
      ': every text has a contrast of 4.5 or more (' +
      rows.length +
      ' texts, the lowest ' +
      lowest[0].toFixed(2) +
      ' on ' +
      lowest[1] +
      ' "' +
      String(lowest[2]).slice(0, 30) +
      '")'
  );
};

try {
  await agents.detect(true);

  // drawn while covered by other windows, or the part waits to draw until shown (.main.js awake)
  await main('awake');
  await main('size', 1440, 900);
  for (let count = 0; count < 2; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made?.paneId) opened.push(made.paneId);
    await wait(300);
  }
  const [first, second] = opened;
  check(
    opened.length === 2 &&
      !!(await until(() => sessionOf(first)?.running && sessionOf(second)?.running, 20000)),
    'setup: two PowerShell threads are open and running'
  );
  check(typeof details()?.mount === 'function', 'window.TnaiThreadDetails is there');

  // ---- the host: 380 px wide, in the side column of the Threads page when it is on screen ----
  threads.show(first);
  sideWasOpen = !!threads.side?.();
  threads.side?.(true);
  await wait(500);
  const slot = threads.slot('side');
  const inSlot = !!slot && shown(slot) && slot.clientWidth >= 300;
  host.style.cssText =
    'display:flex;flex-direction:column;box-sizing:border-box;width:380px;max-width:100%;' +
    'min-height:0;height:100%;flex:1;padding-top:14px;';
  if (inSlot) {
    // what the column shows steps aside for the length of the test, and comes back at its end
    [...slot.children].forEach(child => {
      parked.push([child, child.style.display]);
      child.style.display = 'none';
    });
    slot.append(host);
  } else {
    host.style.cssText += 'position:fixed;top:60px;right:0;bottom:0;z-index:50;flex:none;';
    document.body.append(host);
  }
  log.push('note the host stands ' + (inSlot ? 'in the side column' : 'on the page'));

  // Opens a thread and keeps the host the one thing in the side column: choosing a thread can
  // close the column or fill it again with its own parts.
  const openThread = async paneId => {
    threads.show(paneId);
    threads.side?.(true);
    await wait(450);
    if (!inSlot) return;
    [...slot.children].forEach(child => {
      if (child === host || parked.some(([kept]) => kept === child)) {
        if (child !== host) child.style.display = 'none';
        return;
      }
      parked.push([child, child.style.display]);
      child.style.display = 'none';
    });
    if (host.parentElement !== slot) slot.append(host);
  };

  // =================================================================== part 1: a PowerShell thread
  const layout = document.querySelector('.layout');
  check(details().mount(host, first) === true, 'mount returns true');
  root = host.querySelector('.ttd');
  check(
    !!root && !layout.classList.contains('agents-mode') && details().state().listening,
    'it is drawn and listening while the old Agents page is not shown'
  );
  let total = root.querySelector('.ttd-total');
  const before = total.textContent;
  check(
    !total.hidden && /^(<1m|\d+m)$/.test(before) && details().state().mounted[0].totalMs > 0,
    'the total running time is shown (' + before + ')'
  );
  check((total.dataset.age || '') === '', 'a plain terminal has no color step');
  Date.now = () => realNow() + 7 * 60000;
  window.dispatchEvent(new CustomEvent('tnai:target-changed'));
  const grown = await until(() => /^(7|8)m$/.test(total.textContent), 3000);
  Date.now = realNow;
  check(!!grown, 'it grows with the clock (' + before + ' to ' + total.textContent + ')');

  const headings = [...root.querySelectorAll('.ttd-sec > .ttd-head > span')].map(
    span => span.textContent
  );
  const wanted = [
    'Queued prompts',
    'Now',
    // the thread's work on its branch (153, built 2026-10-16)
    'Changes',
    'Sub-agents',
    'Recent activity',
    'Working with',
    'Files it is touching now',
    'Skills',
    'Setup',
  ];
  check(
    headings.join('|') === wanted.join('|'),
    'every section heading is there, in order (' + headings.join(', ') + ')'
  );
  const notEmpty = ['queue', 'team', 'timeline', 'with', 'files', 'skills'].filter(name => {
    const notes = body(name).querySelectorAll('.ttd-note');
    return !(
      section(name).hasAttribute('data-empty') &&
      body(name).children.length === 1 &&
      notes.length === 1 &&
      notes[0].textContent.length > 10
    );
  });
  check(
    !notEmpty.length,
    'an empty section says so in one line (' +
      (notEmpty.join(', ') || 'all six: "' + body('queue').textContent + '"') +
      ')'
  );
  const plain = sessionOf(first);
  check(
    (fact('setup', 'Connection') || '').startsWith(window.tnaiShell()) &&
      !!plain.cwd &&
      fact('setup', 'Folder') === plain.cwd &&
      (fact('setup', 'Model') || '') === (window.TnaiAgentModel?.text?.(plain) || '') &&
      /^Live since /.test(fact('now', 'Process') || ''),
    'the facts are the ones window.TnaiAgents reports (' +
      fact('setup', 'Connection') +
      ', ' +
      fact('setup', 'Folder') +
      ', ' +
      fact('now', 'Process') +
      ')'
  );

  // ---- queued prompts: the CLI's own, then the ones Technically Not holds ----
  const longText =
    'Queued follow-up: ' + 'also check the narrow layout and keep the calm look. '.repeat(8);
  await main(
    'emit',
    'agent:turn',
    turnOf(first, [
      { text: longText, at: 1 },
      { text: 'Second queued prompt', at: 2 },
    ])
  );
  const rows = () => [...body('queue').querySelectorAll('li')];
  check(
    !!(await until(() => rows().length === 2, 3000)) &&
      head('queue').querySelector('em').textContent === '2' &&
      !!rows()[0].querySelector('.ttd-q-note') &&
      !rows()[0].querySelector('.ttd-q-acts'),
    'two prompts the agent has queued are listed with their count: a remark, no buttons'
  );
  const item = () => rows()[0].querySelector('.ttd-q-item');
  const oneLine = item().getBoundingClientRect().height;
  check(cutWithDots(item().querySelector('span')), 'a long prompt is one line ending in "…"');
  item().click();
  await wait(150);
  check(
    item().getAttribute('aria-expanded') === 'true' &&
      item().getBoundingClientRect().height > oneLine * 2,
    'a press shows the full prompt (' +
      Math.round(oneLine) +
      ' to ' +
      Math.round(item().getBoundingClientRect().height) +
      ' px)'
  );
  item().click();
  await wait(150);
  check(
    Math.abs(item().getBoundingClientRect().height - oneLine) < 2,
    'a second press shows one line again'
  );
  await main(
    'emit',
    'attention:change',
    heldOf(first, [
      ['held-t1', 'My held prompt', null],
      ['held-t2', '[from Claude Code · Sable] agent message', 'Claude Code · Sable'],
    ])
  );
  const actions = row =>
    [...row.querySelectorAll('.ttd-q-acts button')].map(button => button.textContent).join(' · ');
  check(
    !!(await until(() => rows().length === 4, 3000)) &&
      actions(rows()[2]) === 'Send now · Edit · Remove' &&
      actions(rows()[3]) === 'Send now · Remove',
    'held prompts follow with Send now, Edit and Remove; an agent’s message has no Edit'
  );
  sidewaysAndOverlap('queued prompts');

  // The three buttons do what the old page's did (its test: agents-terminal).
  const prompt = document.getElementById('prompt');
  prompt.value = '';
  window.TnaiLiveTasks?.setTarget?.(second);
  rows()[2].querySelector('[data-q="edit"]').click();
  check(
    !!(await until(() => rows().length === 3 && prompt.value === 'My held prompt', 3000)) &&
      window.TnaiLiveTasks.target() === first,
    'Edit takes it out of the queue and puts it in the prompt box, aimed at this agent (' +
      JSON.stringify(prompt.value) +
      ')'
  );
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  rows()[2].querySelector('[data-q="remove"]').click();
  check(
    !!(await until(() => rows().length === 2, 3000)) && prompt.value === '',
    'Remove drops an agent’s message; nothing goes into the prompt box'
  );
  await main('emit', 'attention:change', heldOf(first, [['held-t3', 'Send me now', null]]));
  await until(() => rows().length === 3, 3000);
  rows()[2]?.querySelector('[data-q="send"]')?.click();
  check(!!(await until(() => rows().length === 2, 3000)), 'Send now takes it off the held list');

  // ---- folding ----
  head('setup').click();
  await wait(150);
  check(
    head('setup').getAttribute('aria-expanded') === 'false' &&
      !shown(body('setup')) &&
      details().state().folded.includes('setup'),
    'folding Setup hides its content'
  );
  head('setup').click();
  await wait(150);
  check(
    head('setup').getAttribute('aria-expanded') === 'true' && shown(body('setup')),
    'a second press shows it again'
  );

  // ================================================== part 2: a Claude Code session, made-up
  // content A real Claude Code session with Technically Not's hooks (the way the test agent-team
  // starts it). The folder is new to Claude Code, so the trust question is answered first.
  const since = realNow();
  const leadStart = team.startLead();
  const ask = await until(async () => (await native.trust.pending())?.[0], 30000);
  if (ask) await native.trust.answer(ask.id, true);
  const lead = (await leadStart)?.paneId || '';
  if (lead) opened.push(lead);
  const connected = !!lead && (await team.whenReady(lead, since, 45000));
  check(connected, 'setup: a Claude Code session runs and is connected (no prompt is sent)');
  const keptRetire = team.retireAfter;
  team.retireAfter = 600000;
  undo.push(() => {
    team.retireAfter = keptRetire;
  });

  // Claude Code's own hook messages for a task with three sub-agents: one running and editing,
  // one finished with its output, one that never reports that it started.
  const endpoint = await native.agentEvents.endpoint(lead);
  const hook = message =>
    window.TnaiTest.request(endpoint.hook, {
      method: 'POST',
      body: JSON.stringify({ session_id: 's', transcript_path: 't', cwd: 'c', ...message }),
    });
  const longTask =
    'Check every page of the app at every window size and write down what does not fit, ' +
    'with the name of the file that owns it and a picture of each case';
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Add a dark mode toggle' });
  const spawn = (id, description, text) =>
    hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: id,
      tool_input: { description, prompt: text, subagent_type: 'general-purpose' },
    });
  await spawn('tu1', 'Build dark mode toggle', 'Add a toggle in settings that switches the theme.');
  await spawn('tu2', 'Document dark mode', 'Summary: Writes the dark mode help page.\nWrite it.');
  await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag2', agent_type: 'general-purpose' });
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_use_id: 'e1',
    agent_id: 'ag1',
    agent_type: 'general-purpose',
    tool_input: { file_path: 'src/settings.js' },
  });
  await hook({
    hook_event_name: 'SubagentStop',
    agent_id: 'ag2',
    agent_type: 'general-purpose',
    agent_transcript_path: 'x',
    last_assistant_message: 'Added a Dark mode section to docs/USER_GUIDE.md.',
  });
  await hook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: 'tu2',
    tool_input: {},
    tool_response: {
      status: 'completed',
      content: [
        { type: 'text', text: 'Added a Dark mode section to docs/USER_GUIDE.md.\nagentId: ag2' },
      ],
    },
  });
  await spawn('tu3', longTask, 'Look at everything.');
  await until(() => team.get(lead)?.subs?.length === 3, 5000);

  // Files, skills and a custom agent, stood in for at the app's own read points (as the test
  // session-skills does for skills): the part reads them there each time it draws.
  const longFile =
    'src/components/settings/appearance/a-very-long-file-name-that-does-not-fit-in-a-row.js';
  const longSkill = 'plug:a-very-long-skill-name-that-cannot-fit-in-the-width-of-the-side-column';
  const filesMadeUp = {
    [lead]: ['src/app.js', longFile, 'docs/notes.md'],
    [second]: [longFile, 'src/app.js', 'README.md'],
  };
  const fileActivity = window.TnaiFileActivity;
  const stamp = realNow();
  standIn(fileActivity, 'forPane', paneId => filesMadeUp[paneId] || []);
  standIn(fileActivity, 'now', paneId =>
    paneId === lead ? { verb: 'editing', path: 'src/app.js', at: stamp } : null
  );
  standIn(fileActivity, 'skills', paneId =>
    paneId === lead
      ? [
          { name: 'made-up-skill', at: stamp },
          { name: longSkill, at: stamp },
        ]
      : []
  );
  const realCustom = window.TnaiCustomAgents.forPane;
  standIn(window.TnaiCustomAgents, 'forPane', paneId =>
    paneId === lead
      ? { name: 'Reviewer', base: 'Claude Code', skillIds: ['made-up-skill', 'second-skill'] }
      : realCustom.call(window.TnaiCustomAgents, paneId)
  );

  await openThread(lead);
  log.push(
    'note the column with the lead open: ' +
      (inSlot ? Math.round(slot.getBoundingClientRect().width) + ' px wide' : 'not used') +
      ', the Threads page shown ' +
      threads.visible()
  );
  details().mount(host, lead);
  root = host.querySelector('.ttd');
  total = root.querySelector('.ttd-total');
  await until(() => body('team').querySelectorAll('.ttd-sub').length === 3, 5000);
  await wait(300);
  const session = sessionOf(lead);
  log.push(
    'note the lead: ' +
      (team.get(lead)?.subs || []).map(one => one.key + ':' + one.status).join(' ') +
      ' · part on screen ' +
      shown(root) +
      ' · stale ' +
      details().state().mounted[0]?.stale +
      ' · says "' +
      body('team').textContent.slice(0, 80) +
      '"'
  );

  // ---- every section shows exactly what was made up ----
  const subs = [...body('team').querySelectorAll('.ttd-sub')];
  const sub = key => subs.find(node => node.dataset.key === key);
  const alias = key => team.get(lead).subs.find(one => one.key === key)?.alias || '';
  check(
    subs.map(node => node.dataset.key + ':' + node.dataset.status).join(' ') ===
      'tu1:running tu2:done tu3:starting',
    'Sub-agents: three, running, done and starting (' +
      subs.map(node => node.dataset.key + ':' + node.dataset.status).join(' ') +
      ')'
  );
  check(
    sub('tu1').querySelector('.ttd-sub-head span').textContent ===
      alias('tu1') + ' · Build dark mode toggle' &&
      /^Running since /.test(sub('tu1').querySelector('small').textContent) &&
      sub('tu1').querySelector('[data-fact="Now"] .ttd-clamp').textContent ===
        'Editing settings.js' &&
      sub('tu1').querySelector('[data-fact="Tool calls"] .ttd-clamp').textContent === '1',
    'the running one: its name and task, since when, what it does now, its tool calls (' +
      sub('tu1').textContent.slice(0, 90) +
      ')'
  );
  const parts = [...sub('tu2').querySelectorAll('details')];
  check(
    /^Done · /.test(sub('tu2').querySelector('small').textContent) &&
      sub('tu2').querySelector(':scope > .ttd-note').textContent ===
        'Writes the dark mode help page.' &&
      parts.map(part => part.querySelector('summary').textContent).join('|') ===
        'Full task from the lead|Output' &&
      /USER_GUIDE/.test(parts[1].querySelector('pre').textContent) &&
      parts.every(part => !part.open),
    'the finished one: its summary line, and its task and output folded under it'
  );
  parts[1].querySelector('summary').click();
  await wait(200);
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_use_id: 'e2',
    agent_id: 'ag1',
    agent_type: 'general-purpose',
    tool_input: { file_path: 'src/theme.js' },
  });
  const stayedOpen = await until(
    () =>
      body('team').querySelector('[data-fact="Now"] .ttd-clamp')?.textContent ===
        'Reading theme.js' &&
      body('team').querySelector('[data-open="tu2:output"]')?.open &&
      shown(body('team').querySelector('[data-open="tu2:output"] pre')),
    4000
  );
  check(!!stayedOpen, 'an opened Output stays open while the section is redrawn by a new step');

  const activity = [...body('timeline').querySelectorAll('li')].map(
    row => row.querySelector('b').textContent + ' | ' + row.querySelector('span').textContent
  );
  check(
    activity[0] === alias('tu1') + ' · Read | src/theme.js' &&
      activity.includes(alias('tu1') + ' · Edit | src/settings.js') &&
      activity.includes('Started sub-agent | Build dark mode toggle') &&
      activity.includes('Started sub-agent | ' + longTask) &&
      activity.includes('Prompt | Add a dark mode toggle') &&
      activity.some(line => /^Sub-agent finished \| Added a Dark mode section/.test(line)),
    'Recent activity: the made-up steps, the newest first (' + activity.length + ' rows)'
  );
  check(
    cutWithDots(
      [...body('timeline').querySelectorAll('li span')].find(span => span.textContent === longTask)
    ),
    'a long step is one line ending in "…"'
  );

  // Readable steps (the approved mock, details-readability.html): a command without its
  // "cd <folder>;" in code colors, a run of edits of one file as one row that says how many.
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'b1',
    tool_input: { command: 'cd "/c/some/folder"; node tools/format-code.js src/app.js' },
  });
  for (const id of ['w1', 'w2', 'w3'])
    await hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: id,
      tool_input: { file_path: 'src/styles/app.css' },
    });
  const editRow = await until(
    () =>
      [...body('timeline').querySelectorAll('li[data-step="edit"]')].find(
        row =>
          row.querySelector('span').textContent === 'src/styles/app.css' &&
          row.querySelector('.ttd-times')?.textContent === '3 times'
      ),
    6000
  );
  const runRow = [...body('timeline').querySelectorAll('li[data-step="run"]')].find(row =>
    /format-code\.js/.test(row.querySelector('span').textContent)
  );
  check(
    !!runRow &&
      !/^cd /.test(runRow.querySelector('span').textContent) &&
      runRow.querySelector('.ttd-c-cmd')?.textContent === 'node' &&
      !!runRow.querySelector('.ttd-step svg'),
    'a command reads without its "cd …;", in code colors, with its kind icon (' +
      (runRow?.querySelector('span').textContent || 'no row') +
      ')'
  );
  check(
    editRow?.querySelector('.ttd-times')?.textContent === '3 times' &&
      editRow.querySelector('.ttd-file-name')?.textContent === 'app.css' &&
      getComputedStyle(editRow.querySelector('.ttd-step')).color !==
        getComputedStyle(editRow).color,
    'three edits of one file are one row that says "3 times", the name first, the kind in color (' +
      [...body('timeline').querySelectorAll('li[data-step="edit"]')]
        .map(
          row =>
            row.querySelector('span').textContent +
            ' ' +
            (row.querySelector('.ttd-times')?.textContent || '1')
        )
        .join(', ') +
      ')'
  );

  const withRows = [...body('with').querySelectorAll('.ttd-link')].map(row => [
    row.tagName,
    row.querySelector('span').textContent,
    row.querySelector('small').textContent,
  ]);
  const secondName = sessionOf(second).name;
  check(
    withRows.length === 3 &&
      withRows[0].join('|') ===
        'DIV|' + alias('tu1') + ' · Build dark mode toggle|its sub-agent · running' &&
      withRows[1].join('|') ===
        'DIV|' + alias('tu3') + ' · ' + longTask + '|its sub-agent · starting' &&
      withRows[2].join('|') ===
        'BUTTON|' +
          secondName +
          ' · ' +
          window.tnaiShell() +
          '|a-very-long-file-name-that-does-not-fit-in-a-row.js, app.js' &&
      /^Inferred: /.test(body('with').querySelector('.ttd-note').textContent),
    'Working with: its two live sub-agents, and the other agent with the files they share, said to be inferred (' +
      withRows
        .map(row => row[1])
        .join(' / ')
        .slice(0, 120) +
      ')'
  );
  const withNodes = [...body('with').querySelectorAll('.ttd-link')];
  check(
    withNodes[0].querySelector('small').scrollWidth <=
      withNodes[0].querySelector('small').clientWidth &&
      withNodes[1].querySelector('small').scrollWidth <=
        withNodes[1].querySelector('small').clientWidth,
    'a sub-agent’s state is never cut ("' + withRows[1][2] + '")'
  );
  check(
    cutWithDots(withNodes[1].querySelector('span')) &&
      cutWithDots(withNodes[2].querySelector('small')),
    'a long sub-agent task and a long list of shared files end in "…"'
  );

  const fileRows = [...body('files').querySelectorAll('button.ttd-link')];
  check(
    fileRows.map(row => row.dataset.file).join('|') === filesMadeUp[lead].join('|') &&
      /^editing · /.test(fileRows[0].querySelector('small').textContent) &&
      fileRows[1].querySelector('small').textContent === '' &&
      cutWithDots(fileRows[1].querySelector('span')),
    'Files: the three made-up files in order, the latest action on its file, the long name ending in "…"'
  );

  const chips = [...body('skills').querySelectorAll('.ttd-chip')].map(
    chip => chip.textContent + ':' + chip.dataset.state + ':' + chip.title.replace(/ since .*/, '')
  );
  check(
    chips.join('|') ===
      'made-up-skill:in-use:Attached to Reviewer|second-skill:attached:Attached to Reviewer|' +
        longSkill +
        ':in-use:In use' &&
      cutWithDots([...body('skills').querySelectorAll('.ttd-chip span')].pop()),
    'Skills: one attached and in use, one attached, one picked up by itself with its long name ending in "…" (' +
      chips.length +
      ')'
  );
  const dots = [...body('skills').querySelectorAll('.ttd-chip > i')].map(
    dot => getComputedStyle(dot).backgroundColor
  );
  check(
    dots[0] === dots[2] && dots[0] !== dots[1],
    'a skill in use has another dot than one only attached (' + dots[0] + ' / ' + dots[1] + ')'
  );

  check(
    (fact('setup', 'Connection') || '').startsWith('Claude Code') &&
      fact('setup', 'Custom agent') === 'Reviewer · based on Claude Code' &&
      fact('setup', 'Folder') === session.cwd &&
      (fact('setup', 'Model') || '') === (window.TnaiAgentModel?.text?.(session) || '') &&
      /^(Saved|Not saved)/.test(fact('setup', 'Conversation') || '') &&
      fact('setup', 'Workspace') ===
        window.TnaiTerminalWorkspaces.list().find(
          workspace => workspace.id === window.TnaiTerminalWorkspaceByPane[lead]
        )?.name,
    'Setup: the tool, the custom agent, the folder, the model where known, the workspace (' +
      fact('setup', 'Connection') +
      ' · ' +
      (fact('setup', 'Model') || 'no model yet') +
      ' · ' +
      fact('setup', 'Workspace') +
      ')'
  );
  check(
    /^(Using |Editing [^\\/\s]+$|Running|Reading|Writing|Searching|Looking|Starting|Updating|2 sub-agents running)/.test(
      root.querySelector('.ttd-doing')?.textContent || ''
    ) && !/[\\/]/.test(root.querySelector('.ttd-doing')?.textContent || ''),
    'Now: what it does, in short words with no full path, in the card at the top, comes from the freshest signal (' +
      root.querySelector('.ttd-doing')?.textContent +
      ')'
  );
  check(
    fact('now', 'Task') === 'Add a dark mode toggle',
    'Now: the task is the prompt without the app’s mark (' + fact('now', 'Task') + ')'
  );
  sidewaysAndOverlap('filled, 380 px');
  contrastCheck('Dark');
  await shot('filled-top');
  root.scrollTop = root.scrollHeight;
  await shot('filled-end');
  root.scrollTop = 0;

  // ---- the color step of the total, on the running session ----
  const hours = window.TnaiContextUpkeep?.prefs?.().age || 2;
  const tokenColor = name => {
    const probe = document.createElement('i');
    probe.style.color = 'var(' + name + ')';
    root.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const steps = [];
  for (const [part, age, token] of [
    [0.2, 'ok', '--pg-work-text'],
    [0.7, 'long', '--pg-wait'],
    [1.4, 'over', '--pg-err'],
  ]) {
    Date.now = () => realNow() + part * hours * 3600000;
    window.dispatchEvent(new CustomEvent('tnai:target-changed'));
    const drawn = await until(() => total.dataset.age === age, 2000);
    steps.push(
      !!drawn && getComputedStyle(total).color === tokenColor(token)
        ? age + ' ' + total.textContent
        : 'WRONG ' + age + ' (' + total.dataset.age + ', ' + getComputedStyle(total).color + ')'
    );
    if (age === 'over') {
      await wait(200);
      await (window.TnaiTest?.shot?.('thread-details-total-over') ?? wait(500));
    }
    Date.now = realNow;
  }
  window.dispatchEvent(new CustomEvent('tnai:target-changed'));
  check(
    steps.every(step => !step.startsWith('WRONG')) && /over/.test(total.title + steps[2]),
    'the running session’s total is drawn green, yellow and red at ' +
      hours +
      ' h (' +
      steps.join(', ') +
      ')'
  );
  await until(() => total.dataset.age === 'ok', 2000);

  // ---- every other action, pressed once ----
  const opens = [];
  standIn(window.TnaiFileViewer, 'open', file => opens.push(file));
  fileRows[1].click();
  check(
    opens.join() === longFile,
    'a press on a file opens that file (the viewer was asked for ' + opens.join() + ')'
  );
  const stuck = body('team').querySelector('[data-dismiss="tu3"]');
  const stuckLeft = stuck?.getBoundingClientRect().left || 0;
  const rowsLeft = stuck?.parentNode.querySelector('details').getBoundingClientRect().left || -9;
  check(
    !!stuck &&
      !body('team').querySelector('[data-dismiss="tu1"], [data-dismiss="tu2"]') &&
      Math.abs(stuckLeft - rowsLeft) <= 1,
    'only the sub-agent stuck on Starting has Remove, in line with its other rows (' +
      Math.round(stuckLeft) +
      ' and ' +
      Math.round(rowsLeft) +
      ')'
  );
  stuck?.click();
  check(
    !!(await until(() => body('team').querySelectorAll('.ttd-sub').length === 2, 3000)) &&
      !team.get(lead).subs.some(one => one.key === 'tu3'),
    'Remove takes the stuck sub-agent away'
  );
  window.TnaiLiveTasks?.setTarget?.(lead);
  const taskLong = 'Rewrite the whole settings page. '.repeat(14).trim();
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] ' + taskLong });
  const more = await until(
    () =>
      [...body('now').querySelectorAll('dd[data-over]')].find(cell => cell.dataset.fact === 'Task'),
    4000
  );
  const clampHeight = more?.querySelector('.ttd-clamp').getBoundingClientRect().height || 0;
  more?.querySelector('.ttd-more').click();
  await wait(150);
  check(
    !!more &&
      more.querySelector('.ttd-more').textContent === 'View less' &&
      more.querySelector('.ttd-clamp').getBoundingClientRect().height > clampHeight + 10,
    'a long task shows three lines and "View more" shows all of it (' +
      Math.round(clampHeight) +
      ' to ' +
      Math.round(more?.querySelector('.ttd-clamp').getBoundingClientRect().height || 0) +
      ' px)'
  );
  body('with').querySelector('button.ttd-link').click();
  check(
    !!(await until(() => threads.selected() === second, 3000)) && threads.visible(),
    'a press on the other agent opens its thread'
  );
  await openThread(lead);

  // ---- the model, once it is known ----
  // A session's model reaches the window with its turn (desktop/agent-turns.js reads it from the
  // CLI's own record; 42 keeps it, 108 names it). The turn is pushed as the app pushes it.
  const noModelYet = fact('setup', 'Model') || '';
  await main('emit', 'agent:turn', {
    ...turnOf(lead, []),
    agent: 'Claude Code',
    model: 'claude-opus-5-5',
    effort: 'high',
  });
  const modelShown = await until(() => fact('setup', 'Model'), 3000);
  const modelCell = [...body('setup').querySelectorAll('dd')].find(
    cell => cell.dataset.fact === 'Model'
  );
  check(
    noModelYet === '' &&
      !!modelShown &&
      /^Opus 5\.5/.test(modelShown) &&
      modelShown === window.TnaiAgentModel.text(sessionOf(lead)) &&
      modelCell.querySelector('.ttd-clamp').title === window.TnaiAgentModel.tip(sessionOf(lead)),
    'Setup shows the model as soon as a turn names it, as the thread’s top row does ("' +
      noModelYet +
      '" to "' +
      modelShown +
      '")'
  );
  root.scrollTop = root.scrollHeight;
  await shot('model');
  root.scrollTop = 0;

  // ---- a renamed workspace ----
  const workspaces = window.TnaiTerminalWorkspaces;
  const workspaceId = window.TnaiTerminalWorkspaceByPane[lead];
  const oldName = workspaces.list().find(workspace => workspace.id === workspaceId).name;
  const repaints = details().state().draws;
  workspaces.rename(workspaceId, 'Renamed for the test');
  const renamed = await until(() => fact('setup', 'Workspace') === 'Renamed for the test', 3000);
  workspaces.rename(workspaceId, oldName);
  check(
    !!renamed && details().state().draws > repaints,
    'a renamed workspace shows its new name at once, with no other event (' +
      fact('setup', 'Workspace') +
      ')'
  );
  await until(() => fact('setup', 'Workspace') === oldName, 3000);

  // ====================================================== part 3: Light, sizes, unmount
  const look = window.TnaiTheme?.get?.() === 'light' ? 'light' : 'dark';
  window.TnaiTheme?.set('light');
  await wait(500);
  check(window.TnaiTheme?.get?.() === 'light', 'the look is Light for the next pictures');
  contrastCheck('Light');
  sidewaysAndOverlap('Light');
  root.scrollTop = 0;
  await shot('light-top');
  root.scrollTop = root.scrollHeight;
  await shot('light-end');
  root.scrollTop = 0;
  window.TnaiTheme?.set(look);
  await wait(400);

  for (const width of [320, 460]) {
    host.style.width = width + 'px';
    await wait(350);
    sidewaysAndOverlap('host ' + width + ' px');
    scrollsInside('host ' + width + ' px', inSlot ? slot : null);
    await shot('host-' + width);
  }
  host.style.width = '380px';
  await main('size', 1440, 720);
  await wait(300);
  sidewaysAndOverlap('low window 1440 x 720');
  scrollsInside('low window 1440 x 720', inSlot ? slot : null);
  await shot('low');
  const [minWidth, minHeight] = await main('minimum');
  await main('size', minWidth, minHeight);
  await openThread(lead);
  check(
    shown(root) && host.getBoundingClientRect().width >= 300,
    'smallest window ' +
      minWidth +
      ' x ' +
      minHeight +
      ': the part is on screen (' +
      Math.round(host.getBoundingClientRect().width) +
      ' px wide)'
  );
  sidewaysAndOverlap('smallest window');
  scrollsInside('smallest window', inSlot ? slot : null);
  await shot('smallest');
  await main('size', 1440, 900);
  await wait(300);

  // ---- a second mount replaces the first; unmount ends everything ----
  details().mount(host, second);
  check(
    host.querySelectorAll('.ttd').length === 1 &&
      host.querySelector('.ttd').dataset.pane === second &&
      details().state().mounted.length === 1,
    'a mount on the same host replaces the copy'
  );
  check(details().unmount(host) === true, 'unmount returns true');
  const drawsBefore = details().state().draws;
  await main('emit', 'agent:turn', turnOf(second, [{ text: 'After the unmount', at: 9 }]));
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'e9',
    tool_input: { file_path: 'after-the-unmount.js' },
  });
  window.dispatchEvent(new CustomEvent('tnai:live-activity'));
  workspaces.rename(workspaceId, 'Renamed after the unmount');
  await wait(600);
  workspaces.rename(workspaceId, oldName);
  check(
    !host.children.length &&
      !details().state().listening &&
      !details().state().mounted.length &&
      details().state().draws === drawsBefore,
    'after unmount nothing is listened to and nothing is drawn (' +
      (details().state().draws - drawsBefore) +
      ' repaints)'
  );
  check(details().unmount(host) === false, 'a second unmount does nothing');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
Date.now = realNow;

// what the test pushed and stood in for is taken back, and the side column gets its own content
for (const restore of undo.reverse()) restore();
for (const paneId of opened)
  await main('emit', 'agent:turn', turnOf(paneId, [], realNow())).catch(() => {});
await main('emit', 'attention:change', { items: [], held: [] }).catch(() => {});
window.TnaiThreadDetails?.unmount(host);
host.remove();
for (const [child, display] of parked) child.style.display = display;
if (!sideWasOpen) threads.side?.(false);
if (window.TnaiTheme?.get?.() === 'light') window.TnaiTheme.set('dark');
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log };
