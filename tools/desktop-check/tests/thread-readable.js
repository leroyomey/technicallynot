// Technically Not tools · desktop-check/tests/thread-readable.js — how a thread's Readable view
// draws a conversation (src/scripts/122-thread-readable.js), from a made-up Claude Code transcript
// (thread-readable.main.js writes it where the app looks; a real Claude Code panel is started and
// gets no prompt, so nothing is spent). The view must read as a conversation, with the report in
// its colors and no raw terminal lines in it. Checked here:
// the prompt bubble holds only the user's words, with what the app added behind one quiet line;
// actions are grouped lines in the reading face with nothing cut by an ellipsis, and a command's
// whole text and output are behind a press; the report's labels, the status sections and the
// outcome words have the terminal's colors, readable in Dark and in Light; and nothing runs off
// the side at 1440, 1280, the smallest window and a low one. Pictures: thread-readable-dark,
// -light, -dark-1280, -dark-small, -light-small, -dark-low. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
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
const shown = el => !!el && el.getClientRects().length > 0;
const n = v => Math.round(v * 10) / 10;
let pane = '';

// Claude Code's screen, replayed into a scratch terminal: only to answer its folder-trust
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

// ---------- the made-up conversation ----------
const NOTE =
  '[Technically Not: agents not working right now in this project: Ash (Claude Code, left over from the last Technically Not session, last task: "Claude Code"). You lead: first decide which of them this task needs. When unsure, leave it.]';
const COMMAND = 'Get-Date -Format "yyyy-MM-dd HH:mm"; npm run posts -- --left';
const PRINTED = '2026-10-12 00:19\nStill allowed today: 2 posts, 10 replies.';
let step = 0;
const use = (name, input) => ({
  type: 'assistant',
  message: {
    id: 'msg_use_' + ++step,
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't' + step, name, input }],
  },
});
const gave = (id, more = {}, toolUseResult) => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...more }],
  },
  ...(toolUseResult ? { toolUseResult } : {}),
});
const TRANSCRIPT = [
  { type: 'user', message: { role: 'user', content: '[TN.ai] test\n\n' + NOTE } },
  use('Read', { file_path: 'docs/notes/morning-brief.md' }),
  gave('t1'),
  use('Read', { file_path: 'docs/guide/setup-notes.md' }),
  gave('t2'),
  use('Read', { file_path: 'src/scripts/a-very-long-folder-name/another-long-folder/cart.js' }),
  gave('t3'),
  use('Bash', { command: COMMAND, description: 'What is left today' }),
  gave('t4', {}, { stdout: PRINTED, stderr: '' }),
  use('Bash', { command: 'npm test', description: 'Run the tests' }),
  gave('t5', { is_error: true }, { stdout: '14 passed\n2 failed, 12 passed', stderr: '' }),
  use('Edit', { file_path: 'src/cart.js' }),
  gave('t6', {}, { structuredPatch: [{ lines: ['+a', '+b', '+c', '-d', ' e'] }], type: 'update' }),
  {
    type: 'assistant',
    message: {
      id: 'msg_say',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Test received.\n\nDone:\n- read the brief\n- ran the tests\n\nWhere we stopped:\n- two tests fail\n\nStill open:\n- the footer\n\nYour turn:\n1. Reload the dev copy.\n\nHeads up: the old build stops working tomorrow.\n\n**1 · the cart total**\n- Outcome: Fixed\n- How we know: the test passes\n\n**2 · the footer**\n- Outcome: Still failing\n- How we know: seen\n\n**3 · the header**\n- Outcome: Partly\n\n**4 · the menu**\n- Outcome: Not started\n\nTechnically Not report\n- Did: answered the test message; checked the morning brief\n- Found: two tests fail\n- Changed: src/cart.js\n- Decided: left the three idle agents open\n- Remains: the footer\n- Untested: the header on a phone\n- Blockers: none of the checks ran\n- Next: fix the two tests\n- Ideas: a test for the footer',
        },
      ],
    },
  },
];

// ---------- colors ----------
const rgba = text => {
  const m = String(text).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(/[,\s/]+/).filter(Boolean);
  return [Number(r), Number(g), Number(b), Number(a)];
};

// What color a custom property is, as the page computes it.
const probe = document.createElement('span');
probe.style.display = 'none';
document.body.append(probe);
const colorOf = value => {
  probe.style.color = '';
  probe.style.color = value;
  return rgba(getComputedStyle(probe).color);
};
const sameColor = (a, b) => !!a && !!b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 1);

// The ground an element's text is read on: its own and its ancestors' fills, laid over each other.
function groundOf(el) {
  const layers = [];
  for (let node = el; node; node = node.parentElement) {
    const fill = rgba(getComputedStyle(node).backgroundColor);
    if (fill && fill[3] > 0) layers.push(fill);
    if (fill && fill[3] >= 1) break;
  }
  let ground = document.documentElement.dataset.theme === 'dark' ? [0, 0, 0] : [255, 255, 255];
  layers.reverse().forEach(([r, g, b, a]) => {
    ground = [r, g, b].map((v, i) => v * a + ground[i] * (1 - a));
  });
  return ground;
}
const light = ([r, g, b]) => {
  const part = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b);
};
const contrast = el => {
  const text = rgba(getComputedStyle(el).color);
  const a = light(text),
    b = light(groundOf(el));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

try {
  threads.open();
  await until(() => threads.visible(), 5000);
  const opened = await window.TnaiTest.open('Claude Code');
  pane = opened?.paneId || (await until(() => agents.sessions()[0]))?.paneId || '';
  const running = await until(
    () => agents.sessions().find(s => s.paneId === pane && s.running),
    30000
  );
  if (!running || !(await ready(pane))) {
    log.push(
      'note Claude Code did not start or reach its prompt on this PC: the made-up conversation was not visited'
    );
    return { ok, log };
  }
  const file = await main('writeTranscript', pane, TRANSCRIPT);
  check(!!file, 'a made-up transcript stands where the app looks for this session');
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(pane);
  const island = threads.slot('main');
  const list = () => island.querySelector('.tnt-talk .tnt-talk-list');
  const card = await until(
    () => (view().shown() === pane ? list()?.querySelector('.tnt-report') : null),
    12000
  );
  check(view().mode() === 'read' && !!card, 'the thread opens as its conversation, with a report');
  if (!card) throw new Error('no report card: nothing more can be looked at');

  // ---- in a wide window the prompt box is as wide as the conversation, edge on edge ----
  {
    await main('size', 1920, 1000);
    await new Promise(done => setTimeout(done, 900));
    const talkBox = list().getBoundingClientRect();
    const promptBox = document.querySelector('footer.composer .composebox').getBoundingClientRect();
    const islandBox = island.getBoundingClientRect();
    const round = value => Math.round(value * 10) / 10;
    check(
      Math.abs(talkBox.left - promptBox.left) <= 1 &&
        Math.abs(talkBox.right - promptBox.right) <= 1,
      'wide window: the conversation (' +
        round(talkBox.left) +
        ' to ' +
        round(talkBox.right) +
        ') and the prompt box (' +
        round(promptBox.left) +
        ' to ' +
        round(promptBox.right) +
        ') share their edges, in an island ' +
        round(islandBox.left) +
        ' to ' +
        round(islandBox.right)
    );
    await shot('thread-readable-wide');
    await main('size', 1440, 900);
    await new Promise(done => setTimeout(done, 900));
  }

  // ---- the prompt bubble: the user's words, and what the app added behind one line ----
  const bubble = list().querySelector('.tnt-you');
  const added = list().querySelector('.tnt-added');
  const press = added?.querySelector('.tnt-added-press');
  const addedText = added?.querySelector('.tnt-added-text');
  check(
    bubble?.textContent === 'test',
    'the bubble shows what the user typed and nothing else: "' + bubble?.textContent + '"'
  );
  check(
    shown(press) &&
      press.getAttribute('aria-expanded') === 'false' &&
      !shown(addedText) &&
      added.previousElementSibling === bubble,
    'under it one quiet line says the app added something: "' + press?.textContent.trim() + '"'
  );
  press?.click();
  check(
    shown(addedText) &&
      addedText.textContent === NOTE &&
      press.getAttribute('aria-expanded') === 'true',
    'a press shows the whole of what the app added'
  );
  press?.click();
  check(!shown(addedText), 'and a second press puts it away');

  // ---- actions: grouped lines in the reading face ----
  const groups = [...list().querySelectorAll('.tnt-grp')];
  const heads = groups.map(g =>
    shown(g.querySelector('.tnt-grp-head')) ? g.querySelector('.tnt-grp-head').textContent : ''
  );
  check(
    groups.map(g => g.dataset.verb).join() === 'Read,Ran,Edited' &&
      heads.join('|') === 'Read 3 files|Ran 2 commands · 1 failed|',
    'actions of one kind are one group with a count; a single action has no heading: "' +
      heads.join('" | "') +
      '"'
  );
  const [reads, runs, edits] = groups;
  const readLines = [...reads.querySelectorAll('.tnt-act')];
  check(
    reads.dataset.folds === 'true' && readLines.every(line => !shown(line)),
    'three files that were only read fold behind their heading'
  );
  reads.querySelector('.tnt-grp-head').click();
  const names = readLines.map(line => line.querySelector('.tnt-act-what').textContent);
  check(
    readLines.every(shown) &&
      names.join() === 'morning-brief.md,setup-notes.md,cart.js' &&
      readLines[2].querySelector('.tnt-act-what').title.endsWith('another-long-folder/cart.js'),
    'a press shows them, each file by its name alone with its path on hover: ' + names.join(', ')
  );
  const mono = el => /mono/i.test(getComputedStyle(el).fontFamily);
  const runLines = [...runs.querySelectorAll('.tnt-act')];
  const allLines = [...list().querySelectorAll('.tnt-act')];
  check(
    !mono(reads.querySelector('.tnt-grp-head')) &&
      allLines.every(line => !mono(line) && mono(line.querySelector('.tnt-act-what'))),
    'the lines are in the reading face; only a name is in the code face'
  );
  check(
    runLines.every(shown) &&
      runLines.map(line => line.querySelector('.tnt-act-what').textContent).join() ===
        'Get-Date,npm test' &&
      runLines.map(line => line.querySelector('.tnt-act-result').textContent).join() === ',failed',
    'a command is its name and a word for a failure: ' +
      runLines.map(line => line.textContent.replace(/\s+/g, ' ').trim()).join(' | ')
  );
  const cut = [...list().querySelectorAll('.tnt-did *')].filter(el => {
    const style = getComputedStyle(el);
    return shown(el) && (style.textOverflow === 'ellipsis' || el.scrollWidth > el.clientWidth + 1);
  });
  check(
    !cut.length && !/…/.test(list().querySelector('.tnt-did').textContent),
    'nothing in the actions is cut with an ellipsis or runs off its line (' + cut.length + ')'
  );
  const more = runLines[0].nextElementSibling;
  const open = runLines[0].querySelector('.tnt-act-open');
  check(
    shown(open) && !shown(more) && !!open.getAttribute('aria-label'),
    'the command has a small button for the rest, closed at first'
  );
  open.click();
  check(
    shown(more) &&
      more.textContent.includes('$ ' + COMMAND) &&
      more.textContent.includes(PRINTED) &&
      more.textContent.includes('What is left today') &&
      open.getAttribute('aria-expanded') === 'true',
    'a press shows the whole command, its description and everything it printed'
  );
  check(
    shown(edits.querySelector('.tnt-act')) &&
      edits.querySelector('.tnt-act-verb').textContent === 'Edited' &&
      edits.querySelector('.tnt-act-what').textContent === 'cart.js' &&
      /\+3/.test(edits.querySelector('.tnt-act-counts').textContent),
    'an edit still shows its lines added and removed: ' +
      edits.textContent.replace(/\s+/g, ' ').trim()
  );

  // ---- the report, the status sections and the outcome words: the terminal's colors ----
  const rows = [...card.querySelectorAll('.tnt-report-row')];
  const WANT = {
    did: 'did',
    found: 'found',
    changed: 'changed',
    decided: 'decided',
    remains: 'remains',
    untested: 'remains',
    blockers: 'blockers',
    next: 'found',
    ideas: 'remains',
  };
  const say = list().querySelector('.tnt-say');
  const sections = ['done', 'stopped', 'open', 'you', 'notice'].map(kind =>
    say.querySelector('[data-section="' + kind + '"]')
  );
  const outcomes = [...say.querySelectorAll('.tnt-outcome')];
  check(
    rows.map(row => row.dataset.label).join() === Object.keys(WANT).join() &&
      rows.every(row => row.dataset.kind === WANT[row.dataset.label]),
    'each report label has the kind it has in the terminal: ' +
      rows.map(row => row.dataset.label + ' ' + row.dataset.kind).join(', ')
  );
  check(
    sections.every(Boolean) &&
      outcomes.map(mark => mark.dataset.outcome + ' ' + mark.textContent).join() ===
        'fixed Fixed,failing Still failing,partly Partly,idle Not started',
    'the five status sections and the four outcome words are marked (' +
      outcomes.map(mark => mark.textContent).join(', ') +
      ')'
  );

  // In each look: every colored word has the color of its --rp-* property and reads at 4.5 to 1.
  async function colors(look) {
    window.TnaiTheme.set(look);
    await wait(500);
    const wrong = [];
    const weak = [];
    const see = (el, property, name) => {
      if (!sameColor(rgba(getComputedStyle(el).color), colorOf('var(' + property + ')')))
        wrong.push(name);
      const ratio = contrast(el);
      if (ratio < 4.5) weak.push(name + ' ' + n(ratio));
    };
    rows.forEach(row => see(row.firstElementChild, '--rp-' + row.dataset.kind, row.dataset.label));
    sections.forEach(el => see(el, '--rp-section-' + el.dataset.section, el.dataset.section));
    outcomes.forEach(el => see(el, '--rp-outcome-' + el.dataset.outcome, el.textContent));
    const kinds = new Set(rows.map(row => getComputedStyle(row.firstElementChild).color));
    check(
      !wrong.length && kinds.size === 6,
      look +
        ': every label, section and outcome word has its own color from the one list (' +
        kinds.size +
        ' label colors' +
        (wrong.length ? '; wrong: ' + wrong.join(', ') : '') +
        ')'
    );
    check(
      !weak.length,
      look +
        ': each of them reads at 4.5 to 1 or better' +
        (weak.length ? ' (' + weak.join(', ') + ')' : '')
    );
    const quiet = [bubble, press, reads.querySelector('.tnt-grp-head'), runLines[0], more]
      .filter(shown)
      .map(el => n(contrast(el)));
    check(
      quiet.every(ratio => ratio >= 4.5),
      look +
        ': the bubble, the added line and the action lines read at 4.5 to 1 (' +
        quiet.join(', ') +
        ')'
    );
  }

  // Nothing of the conversation runs off the side, at each window size.
  const talk = island.querySelector('.tnt-talk');
  const fits = where => {
    const outside = [...list().querySelectorAll('*')].filter(el => {
      if (!shown(el)) return false;
      const b = el.getBoundingClientRect(),
        t = talk.getBoundingClientRect();
      return b.right > t.right + 1 || b.left < t.left - 1;
    });
    check(
      talk.scrollWidth <= talk.clientWidth + 1 && !outside.length,
      where +
        ' (page ' +
        innerWidth +
        ' by ' +
        innerHeight +
        '): the conversation fits its column, nothing runs off the side (' +
        outside.length +
        ')'
    );
  };

  await colors('dark');
  fits('1440 by 900');
  talk.scrollTop = 0;
  await shot('thread-readable-dark');
  talk.scrollTop = talk.scrollHeight;
  await shot('thread-readable-dark-end');
  await colors('light');
  await shot('thread-readable-light-end');
  talk.scrollTop = 0;
  await shot('thread-readable-light');

  const was = await main('minimum'),
    start = await main('content');
  window.TnaiTheme.set('dark');
  await main('size', 1280, 800);
  await wait(500);
  fits('1280 by 800');
  await shot('thread-readable-dark-1280');
  await main('size', 1440, 680);
  await wait(500);
  fits('a low window, 1440 by 680');
  await shot('thread-readable-dark-low');
  await main('size', 768, 680);
  await wait(900);
  fits('the smallest window, 768 by 680');
  await shot('thread-readable-dark-small');
  window.TnaiTheme.set('light');
  await wait(500);
  talk.scrollTop = talk.scrollHeight;
  await shot('thread-readable-light-small');
  window.TnaiTheme.set('dark');
  await main('size', start[0], start[1]);
  await main('setMinimum', was[0], was[1]);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
probe.remove();
await main('cleanup').catch(() => {});
agents.sessions().forEach(s => agents.stop(s.paneId));
await until(() => !agents.sessions().some(s => s.running), 10000);
await wait(300);
return { ok, log };
