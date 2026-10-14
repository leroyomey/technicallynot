// Technically Not tools · desktop-check/tests/thread-helpers.js — the thread layout's Readable view
// and its helpers (122, 123) in the real app, with NO prompt sent to any agent (no usage). A real
// Claude Code panel is started and left at its empty prompt; thread-helpers.main.js writes a
// made-up transcript where the app looks for that session's record, pushes a graph state that
// makes this panel the helper of a PowerShell "lead", and takes a file lock another agent asks for.
//
// What it shows: a long conversation is capped at 400 blocks and says so; a question the agent
// asks with its own tool is the amber box with its choices and a way to the terminal; a helper in
// a panel of its own is set in under its lead in the list, "1 helper" stands in the lead's top row,
// the side island shows the helper's own conversation, a second press opens it as its own thread;
// a held file names its holder and who waits; in a narrow window the side island takes the
// thread's place and closing it brings the thread back. Pictures: thread-helpers-question,
// thread-helpers-side, thread-helpers-narrow. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents,
  native = window.tnaiNative,
  threads = window.TnaiThreads,
  view = () => window.TnaiThreadView;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 1) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
let lead = '',
  helper = '';

// The helper's screen, replayed into a scratch terminal: only to answer Claude Code's folder-trust
// question and to see that it reached its empty prompt.
async function replayed(paneId) {
  const r = await native.pty.replay(paneId);
  if (!r?.buffer) return [];
  const vt = new window.Terminal({
    cols: r.cols || 120,
    rows: r.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => vt.write(r.buffer, done));
  const b = vt.buffer.active,
    rows = [];
  for (let y = 0; y < vt.rows; y++)
    rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
  vt.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await replayed(paneId),
      text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const sel = rows.find(r => r.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(sel) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

// A made-up conversation in the shapes of a real Claude Code transcript: more blocks than the view
// keeps, then an action, then a question that was not answered.
const says = count =>
  Array.from({ length: count }, (_, i) => ({
    type: 'assistant',
    timestamp: new Date(Date.UTC(2026, 9, 11, 12, 0, i % 60)).toISOString(),
    message: {
      id: 'msg_' + i,
      model: 'claude-haiku-5-5',
      role: 'assistant',
      content: [{ type: 'text', text: 'Step ' + (i + 1) + ' of the made-up conversation.' }],
    },
  }));
const TRANSCRIPT = [
  { type: 'user', message: { role: 'user', content: '[TN.ai] Tidy the settings page.' } },
  ...says(430),
  {
    type: 'assistant',
    message: {
      id: 'msg_a',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'settings.js' } }],
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  },
  {
    type: 'assistant',
    message: {
      id: 'msg_b',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'AskUserQuestion',
          input: {
            questions: [
              {
                question: 'Which layout should the page keep?',
                options: [{ label: 'Two columns' }, { label: 'One column' }],
              },
            ],
          },
        },
      ],
    },
  },
];

try {
  threads.open();
  await until(() => threads.visible(), 5000);

  // ---- a PowerShell "lead", and a real Claude Code that gets no prompt ----
  const before = new Set(agents.sessions().map(s => s.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  lead =
    opened?.paneId ||
    (await until(() => agents.sessions().find(s => !before.has(s.paneId))))?.paneId ||
    '';
  await until(() => agents.sessions().find(s => s.paneId === lead && s.running), 15000);
  const withLead = new Set(agents.sessions().map(s => s.paneId));
  const second = await window.TnaiTest.open('Claude Code');
  helper =
    second?.paneId ||
    (await until(() => agents.sessions().find(s => !withLead.has(s.paneId))))?.paneId ||
    '';
  const running = await until(
    () => agents.sessions().find(s => s.paneId === helper && s.running),
    30000
  );
  if (!running || !(await ready(helper))) {
    note(
      'Claude Code did not start or reach its prompt on this PC: the made-up conversation was not visited'
    );
    return { ok, log };
  }
  const record = await main('record', helper);
  check(
    record.agent === 'Claude Code' && !!record.sessionId,
    'a Claude Code panel is at its empty prompt; no prompt is sent to it in this test'
  );
  const file = await main('writeTranscript', helper, TRANSCRIPT);
  check(!!file, 'a made-up transcript stands where the app looks for this session');

  // ---- A: the helper's own thread: the cap and the question ----
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(helper);
  const island = threads.slot('main'),
    talk = island.querySelector('.tnt-talk'),
    list = () => talk.querySelector('.tnt-talk-list');
  const ask = await until(
    () => (view().shown() === helper ? list()?.querySelector('.tnt-askbox') : null),
    12000
  );
  check(
    view().mode() === 'read' && !!ask,
    'its thread opens as its conversation, read from that record'
  );
  if (ask) {
    const blocks = list().children.length - 1,
      cut = list().querySelector('.tnt-cut');
    check(
      blocks <= 401 && blocks >= 390 && shown(cut) && cut === list().firstElementChild,
      'a long conversation keeps 400 blocks and says at its top that this is its end (' +
        blocks +
        ' blocks; "' +
        (cut?.textContent || '') +
        '")'
    );
    check(
      !list().querySelector('.tnt-you') && /Step 430 /.test(list().textContent),
      'the oldest blocks left (the prompt of the start is gone), the newest stayed'
    );
    check(
      /Which layout should the page keep\?/.test(ask.textContent) &&
        /Two columns/.test(ask.textContent) &&
        /One column/.test(ask.textContent) &&
        ask.dataset.state === 'open',
      'the question the agent asks is a box with its words and its choices'
    );
    const amber = getComputedStyle(ask).boxShadow;
    check(/inset/.test(amber), 'it is the amber surface (an inset edge in the "needs you" color)');
    const a = box(ask),
      l = box(list());
    check(
      near(a.left, l.left) && near(a.right, l.right) && a.bottom <= box(talk).bottom + 1,
      'it stands in the reading column and is in sight at the end of the conversation'
    );
    const read = [...list().querySelectorAll('.tnt-act')].find(line =>
      /Read/.test(line.textContent)
    );
    check(
      !!read && read.dataset.state === 'done' && /settings\.js/.test(read.textContent),
      'the action before it is a quiet line: "' + (read?.textContent || 'none').trim() + '"'
    );
    await shot('thread-helpers-question');

    // One small change anywhere must not make the window work out every style again. A rule of
    // the old Terminal page did (a :has() in front of a rule that fits any element): 10.5 ms a
    // change with this conversation open, which froze the window for seconds whenever a terminal
    // on the DOM renderer measured its text. Measured after the fix, 2026-10-13: 2.2 ms.
    {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;top:-50000px;visibility:hidden;white-space:pre';
      document.body.append(probe);
      const from = performance.now();
      for (let turn = 0; turn < 50; turn++) {
        probe.textContent = 'x'.repeat(turn + 1);
        void probe.offsetWidth;
      }
      const each = (performance.now() - from) / 50;
      probe.remove();
      check(
        each < 5,
        'a small change with the long conversation open costs ' + each.toFixed(2) + ' ms (limit 5)'
      );
    }
    ask.querySelector('.tnt-ask-go').click();
    check(
      !!(await until(() => view().mode() === 'term' && view().term(), 6000)),
      '"Answer on the CLI screen" shows the CLI screen of the thread'
    );
    view().setMode('read');
    await until(() => view().mode() === 'read', 3000);
  }

  // ---- B: the graph says the PowerShell panel started this one in a panel of its own ----
  const now = Date.now();
  const node = (id, paneId, parentId, parentPaneId, name) => ({
    id,
    paneId,
    parentId,
    parentPaneId,
    name,
    purpose: 'Stand-in for the test',
    task: '',
    status: 'working',
    persistent: !parentId,
    depth: parentId ? 1 : 0,
    createdAt: now,
    doneAt: 0,
    report: '',
    closesAt: 0,
    root: !parentId,
  });

  await main('graph', {
    settings: { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 },
    nodes: [node('root-1', lead, '', '', 'Lead'), node('node-1', helper, 'root-1', lead, 'Helper')],
  });
  const kid = await until(
    () =>
      threads.slot('list').querySelector('.tnt-th.tnt-kid[data-pane="' + CSS.escape(helper) + '"]'),
    6000
  );
  check(
    !!kid,
    'in the list the helper is set in under its lead (the list: ' +
      [...threads.slot('list').querySelectorAll('.tnt-proj, .tnt-th')]
        .map(row =>
          row.classList.contains('tnt-proj')
            ? '[' + row.textContent + ']'
            : (row.classList.contains('tnt-kid') ? '> ' : '') + row.querySelector('b')?.textContent
        )
        .join(' | ') +
      ')'
  );
  threads.select(lead);
  await until(() => view().shown() === lead, 5000);
  const button = await until(() => {
    const b = island.querySelector('.tnt-helpers-btn');
    return shown(b) ? b : null;
  }, 6000);
  check(
    !!button && /1 helper/.test(button.textContent),
    'the top row of the lead says "' + (button?.textContent || 'nothing') + '"'
  );
  check(
    view().mode() === 'term' && !shown(island.querySelector('.tnt-seg')),
    'the lead, a plain terminal, has its terminal only and no Readable switch'
  );

  // a file the lead holds, and another agent that asked for it
  const leadName = island.querySelector('h1').textContent;
  const locked = await main(
    'lock',
    record.cwd,
    'notes.txt',
    { paneId: lead, name: leadName, provider: 'Terminal' },
    { paneId: 'pane-outside', name: 'Quill', provider: 'Codex' }
  );
  const sharedRow = await until(() => {
    const row = island.querySelector('.tnt-shared');
    return shown(row) && /notes\.txt/.test(row.textContent) ? row : null;
  }, 5000);
  check(
    locked.taken &&
      locked.refused &&
      !!sharedRow &&
      sharedRow.textContent.includes(leadName) &&
      /Quill waits/.test(sharedRow.textContent),
    'a held file stands under the top row with its holder and who waits: "' +
      (sharedRow?.textContent || 'no row').replace(/\s+/g, ' ').trim() +
      '"'
  );

  button?.click();
  const side = threads.slot('side');
  const sideTalk = await until(() => {
    const found = side.querySelector('.tnt-side-talk .tnt-talk-list');
    return shown(side) && found?.querySelector('.tnt-askbox') ? found : null;
  }, 10000);
  check(!!sideTalk, 'a press opens the side island with the own conversation of the helper');
  const chip = side.querySelector('.tnt-side-chip');
  check(
    !!chip && chip.getAttribute('aria-selected') === 'true' && /Claude Code/.test(chip.textContent),
    'the helper is the chosen chip: "' + (chip?.textContent || '') + '"'
  );
  {
    const m = box(island),
      s = box(side),
      area = box(document.querySelector('.layout'));
    check(
      shown(island) &&
        near(s.left - m.right, 12) &&
        near(area.right - s.right, 12) &&
        document.documentElement.scrollWidth <= innerWidth + 1,
      'lead and helper stand side by side on the 12 px spacing, nothing past the window'
    );
  }
  await shot('thread-helpers-side');

  // ---- C: a narrow window ----
  const was = await main('minimum'),
    start = await main('content');
  await main('setMinimum', 600, 400);
  await main('size', 900, 700);
  await frame();
  await wait(900);
  check(
    shown(side) &&
      !shown(island) &&
      !shown(document.querySelector('footer.composer')) &&
      shown(threads.slot('list')),
    'at 900 wide the side island takes the place of the thread; the list stays (' +
      innerWidth +
      ' px)'
  );
  {
    const s = box(side),
      l = box(threads.slot('list')),
      area = box(document.querySelector('.layout'));
    check(
      near(s.left - l.right, 12) &&
        near(area.right - s.right, 12) &&
        near(area.bottom - s.bottom, 12) &&
        document.documentElement.scrollWidth <= innerWidth + 1,
      'on the same spacing, nothing past the window (' + n(s.width) + ' wide)'
    );
  }
  await shot('thread-helpers-narrow');
  side.querySelector('.tnt-side-head button').click();
  await wait(400);
  check(
    !shown(side) && shown(island) && shown(document.querySelector('footer.composer')),
    'closing it brings the thread and the prompt box back'
  );
  await main('size', start[0], start[1]);
  await main('setMinimum', was[0], was[1]);
  await frame();
  await wait(900);

  // ---- D: a second press on the chip opens the helper as its own thread ----
  button?.click();
  const again = await until(
    () => (shown(side) ? side.querySelector('.tnt-side-chip') : null),
    5000
  );
  again?.click();
  check(
    !!(await until(() => threads.selected() === helper && view().shown() === helper, 5000)),
    'a second press on its chip opens the helper as its own thread'
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
await main('unlock', lead).catch(() => {});
await main('cleanup').catch(() => {});
for (const paneId of [helper, lead])
  if (paneId) {
    await agents.stop(paneId);
    await until(() => !agents.sessions().find(s => s.paneId === paneId)?.running, 8000);
  }
return { ok, log };
