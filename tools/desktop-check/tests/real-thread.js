/*
 * Technically Not tools · desktop-check/tests/real-thread.js — A REAL Claude Code agent (Haiku, one
 * short prompt, a few cents of the user's usage) inside the thread layout (118 to 122). This is the
 * place where the trial build of 2026-10-08 failed, so it is run for real, never with a stand-in.
 *
 * It starts Claude Code in a terminal panel (answers the folder-trust question for the throwaway
 * project), switches it to Haiku, opens its thread and sends one prompt through the prompt box: a
 * long reply, one sub-agent, then a file to write, which makes Claude Code ask for permission.
 *
 * The thread opens as its conversation (Readable, 122): your prompt as a bubble, the reply, the
 * actions as lines with the file and its line counts, the permission question as the app's card
 * in the row under the thread (answered there), the task's length and its changed file. Then the
 * same thread as its CLI screen, reached through the row "CLI screen" of the thread's "..." menu
 * (137): the full-screen CLI at the view's size, its input box at the
 * bottom, a window resize with no second copy of the reply. Then it stops the session and reloads
 * the window: real-thread.after.js looks at the restored, stopped session. Run with a longer limit:
 * TNAI_CHECK_LIMIT_MS=600000. Pictures: real-thread-ready, -needs-you, -done, -terminal.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 15000) => {
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
  view = () => window.TnaiThreadView,
  readable = () => window.TnaiThreadReadable;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 1) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
let paneId = '';

// The session's screen, replayed into a scratch terminal: used only to see the trust question and
// the first prompt mark, before the thread is open.
async function replayed() {
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
const ready = () =>
  until(async () => {
    if (!agents.sessions().find(s => s.paneId === paneId)?.running)
      throw new Error('Claude Code exited: ' + (await replayed()).join(' | ').slice(-400));
    const rows = await replayed(),
      text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const sel = rows.find(r => r.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(sel) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return (
      /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text) &&
      !/Esc to interrupt/i.test(text)
    );
  }, 60000);

// The thread's terminal view: the rows on screen, and every row with its history.
const screenRows = term => {
  const b = term.buffer.active,
    rows = [];
  for (let y = 0; y < term.rows; y++)
    rows.push(b.getLine(b.viewportY + y)?.translateToString(true) || '');
  return rows;
};
const allRows = term => {
  const b = term.buffer.active,
    rows = [];
  for (let y = 0; y < b.length; y++) rows.push(b.getLine(y)?.translateToString(true) || '');
  return rows;
};
const lastWritten = rows => {
  let last = -1;
  rows.forEach((row, index) => {
    if (row.trim()) last = index;
  });
  return last;
};
const numbersIn = text => {
  const found = new Set(text.match(/\b\d{1,3}\b/g) || []);
  return Array.from({ length: 120 }, (_, i) => String(i + 1)).filter(x => found.has(x)).length;
};
const rowOf = () =>
  threads
    .slot('list')
    ?.querySelector('.tnt-th[data-pane="' + CSS.escape(paneId) + '"]:not(.tnt-sub)');
const send = async text => {
  const prompt = document.getElementById('prompt');
  prompt.value = text;
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  document.getElementById('send').click();
};

try {
  threads.open();
  await until(() => threads.visible(), 5000);

  // The level "Ask" for new agents (Settings › Agents, 46), so that writing a file asks for
  // permission whatever the user's own Claude Code setting is.
  {
    const access = document.querySelector('#agentsWorkCard .tnai-access-row select');
    if (access) {
      access.value = 'ask';
      access.dispatchEvent(new Event('change', { bubbles: true }));
    }
    check(access?.value === 'ask', 'new agents start with access "Ask"');
  }

  // ---- start a real Claude Code, as a thread ----
  paneId = (await window.TnaiTest.open('Claude Code')).paneId;
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running), 20000)),
    'Claude Code started'
  );
  check(!!(await ready()), 'Claude Code is ready for a prompt');
  agents.send(paneId, '/model haiku');
  await wait(2500);
  check(!!(await ready()), 'switched to Haiku');

  // ---- A: the thread opens as its conversation ----
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(paneId);
  check(!!(await until(() => view().shown() === paneId, 8000)), 'its thread is open');
  const island = threads.slot('main'),
    talk = island.querySelector('.tnt-talk'),
    list = () => talk.querySelector('.tnt-talk-list'),
    blocks = sel => [...(list()?.querySelectorAll(':scope > ' + sel) || [])];

  // A row of the thread's own "..." menu (137), pressed the way a user does. The Readable /
  // Terminal switch is gone: the tool's own screen is the row "CLI screen", and from there the
  // row "Back to the conversation" (their ids: screen, conversation).
  const menuRow = async id => {
    island.querySelector('.tnt-head-menu')?.click();
    const row = await until(
      () =>
        document.querySelector(
          '.tnt-menu-thread:not([hidden]) .tnt-menu-row[data-row="' + id + '"]'
        ),
      3000
    );
    row?.click();
    return !!row;
  };
  check(
    view().mode() === 'read' && shown(talk) && !shown(island.querySelector('.tnt-term')),
    'a Claude Code thread opens as Readable: the conversation shows, the terminal does not'
  );
  check(
    !island.querySelector('.tnt-seg') &&
      shown(island.querySelector('.tnt-head-menu')) &&
      window.TnaiThreadMore.rows().some(row => row.id === 'screen'),
    'the top row has no Readable / Terminal switch; its "..." menu has the row "CLI screen"'
  );
  check(
    !shown(island.querySelector('[data-tnai-font]')),
    'the text-size buttons of the terminal are not shown beside a conversation'
  );
  await until(() => readable().state()?.paneId === paneId && list(), 6000);
  await wait(800);
  note(
    'before the first prompt the pane holds ' +
      JSON.stringify(readable().state()) +
      ': "' +
      (talk.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) +
      '"'
  );
  check(
    window.TnaiLiveTasks.target() === paneId,
    'the prompt box is aimed at the thread (' + window.TnaiLiveTasks.target() + ')'
  );
  const row = rowOf();
  check(
    !!row &&
      /Claude Code/.test(row.querySelector('small').textContent) &&
      row.querySelector('.tnt-face')?.dataset.face?.startsWith('desktop'),
    'its row names the tool and shows the desktop character (' +
      (row?.querySelector('.tnt-face')?.dataset.face || '') +
      ')'
  );
  await shot('real-thread-ready');

  // ---- B: one prompt through the prompt box ----
  const PROMPT =
    'Do these three things in order. 1) Without using any tools, count from 1 to 120 in your ' +
    'reply, each number on a line of its own. 2) Use the Agent tool once: a sub-agent whose whole ' +
    'task is to reply with the word OK. 3) Create a file named thread-check.txt that contains the ' +
    'word OK. In the Technically Not report at the end of your reply, include this line exactly: ' +
    '- Decide: Keep thread-check.txt? | 1. Keep it (recommended) | 2. Delete it';
  await send(PROMPT);
  const started = await until(() => {
    const t = window.TnaiTurns.get(paneId);
    return t?.startedAt && !t.endedAt ? t : null;
  }, 40000);
  check(!!started, 'the prompt reached Claude Code and its task runs');
  const bubble = await until(() => blocks('.tnt-you').pop(), 20000);
  check(
    !!bubble && bubble.textContent === PROMPT,
    'your prompt is in the conversation as you wrote it, without the mark the app adds: "' +
      (bubble?.textContent || '').slice(0, 60) +
      '…"'
  );
  if (bubble) {
    const b = box(bubble),
      l = box(list());
    check(
      near(b.right, l.right) && b.left > l.left + 20,
      'as a bubble on the right of the reading column (ends ' +
        n(l.right - b.right) +
        ' from its edge, starts ' +
        n(b.left - l.left) +
        ' in)'
    );
  }
  {
    const live = await until(() => {
      const el = list().querySelector('.tnt-live');
      return shown(el) ? el : null;
    }, 10000);
    check(
      !!live && live === list().lastElementChild,
      'while it works the last line says so: "' + (live?.textContent || '').trim() + '"'
    );
  }

  // a sub-agent row in the list, if Haiku starts one (noted, not failed)
  let sawSub = false;
  const needs = await until(() => {
    if (threads.slot('list').querySelector('.tnt-th.tnt-sub')) sawSub = true;
    return window.TnaiNeedsYou.has(paneId);
  }, 120000);
  note(
    sawSub
      ? 'a sub-agent row showed under the thread in the list'
      : 'no sub-agent row was seen in the list'
  );

  // ---- C: the permission question, answered in place ----
  check(!!needs, 'Claude Code asks for permission and the app counts it as "Needs you"');
  if (needs) {
    await wait(700);
    const first = threads.slot('list').querySelector('.tnt-proj');
    check(
      rowOf()?.dataset.tone === 'needs' && /Needs you/.test(first?.textContent || ''),
      'the row is amber and stands first under "Needs you"'
    );
    const state = island.querySelector('.tnt-head-state');
    check(
      state.dataset.tone === 'needs',
      'the top row says so: "' + state.textContent.trim() + '"'
    );
    const card = document.querySelector('.tnai-perm:not(.tnai-held)');
    check(shown(card), 'the permission card of the app is on screen');
    if (shown(card)) {
      const c = box(card),
        m = box(island),
        t = box(talk),
        p = box(document.querySelector('footer.composer'));
      check(
        getComputedStyle(card).position === 'static' && !!card.closest('.tnt-asks'),
        'it stands in the thread island, in the row for questions (not floating)'
      );
      check(
        t.bottom <= c.top + 0.5 && c.bottom <= m.bottom + 0.5 && c.bottom <= p.top + 0.5,
        'under the conversation and above the prompt box, over neither: conversation ends ' +
          n(t.bottom) +
          ', card ' +
          n(c.top) +
          ' to ' +
          n(c.bottom) +
          ', prompt box starts ' +
          n(p.top)
      );
    }
    const writing = await until(
      () =>
        blocks('.tnt-did')
          .flatMap(d => [...d.querySelectorAll('.tnt-act')])
          .find(a => /Wrote/.test(a.textContent) && /thread-check\.txt/.test(a.textContent)),
      8000
    );
    check(
      !!writing && writing.dataset.state === 'running',
      'the conversation already shows what it waits to do: "' +
        (writing?.textContent || '').trim() +
        '" (' +
        (writing?.dataset.state || 'no line') +
        ')'
    );
    await shot('real-thread-needs-you');
    const allow = [...card.querySelectorAll('button')].find(b => /Allow once/.test(b.textContent));
    allow?.click();
    check(
      !!allow &&
        !!(await until(
          () =>
            !window.TnaiNeedsYou.has(paneId) ||
            !/asks to use/.test(window.TnaiNeedsYou.label(paneId)),
          15000
        )) &&
        !shown(card),
      'Allow once on that card answers it: the permission question is gone'
    );
  }

  // ---- D: the finished task, read from the record Claude Code keeps ----
  const worked = await until(() => blocks('.tnt-worked').pop(), 120000);
  check(
    !!worked && /^Worked for \d/.test(worked.textContent),
    'the task ends with "' + (worked?.querySelector('span')?.textContent || 'no row') + '"'
  );
  await wait(1200);
  {
    const said = blocks('.tnt-say')
        .map(b => b.innerText)
        .join('\n'),
      count = numbersIn(said);
    check(count === 120, 'the reply is there in full: ' + count + ' of the 120 numbers');
    const acts = blocks('.tnt-did').flatMap(d => [...d.querySelectorAll('.tnt-act')]),
      sub = list().querySelector('.tnt-helper'),
      wrote = acts.find(
        a => /Wrote/.test(a.textContent) && /thread-check\.txt/.test(a.textContent)
      );
    check(
      !!sub,
      'the sub-agent the lead started is a card in its conversation: "' +
        (sub?.textContent || 'none').trim() +
        '"'
    );
    check(
      !!wrote &&
        wrote.dataset.state === 'done' &&
        /\+1/.test(wrote.querySelector('.tnt-act-counts').textContent),
      'the file it wrote is a line with its line count: "' +
        (wrote?.textContent || 'none').trim() +
        '"'
    );
    const files = worked?.querySelector('.tnt-files');
    check(
      !!files &&
        /1 changed file/.test(files.textContent) &&
        /thread-check\.txt/.test(files.textContent),
      'the changed-files card lists it: "' +
        (files?.textContent || 'none').replace(/\s+/g, ' ').trim() +
        '"'
    );
    const report = blocks('.tnt-report').pop();
    note(
      report
        ? 'the reply ended with a Technically Not report, shown as a card: "' +
            report.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) +
            '"'
        : 'the reply had no Technically Not report this time'
    );
    note(
      'the title the tool gave the conversation: "' +
        (island.querySelector('.tnt-head-topic')?.textContent || '') +
        '"'
    );
    const l = box(list()),
      t = box(talk);
    check(
      near(l.left - t.left, t.right - l.right, 1),
      'the reading column stands in the middle of the island (' +
        n(l.left - t.left) +
        ' / ' +
        n(t.right - l.right) +
        ', ' +
        n(l.width) +
        ' wide)'
    );
    check(
      talk.scrollHeight > talk.clientHeight &&
        talk.scrollTop + talk.clientHeight >= talk.scrollHeight - 3,
      'the conversation is longer than the pane (' +
        talk.scrollHeight +
        ' of ' +
        talk.clientHeight +
        ') and stands at its newest line'
    );
    check(
      t.bottom <= box(document.querySelector('footer.composer')).top + 0.5 &&
        talk.scrollWidth <= talk.clientWidth + 1,
      'it ends above the prompt box and nothing is cut sideways'
    );

    // A report that asks a decision keeps the thread on "Needs you" until it is answered (the
    // app's own rule, 71); without one the thread is simply finished.
    const asksDecision = !!blocks('.tnt-report').pop()?.querySelector('.tnt-decide');
    const live = list().querySelector('.tnt-live');
    const want = asksDecision ? 'needs' : 'ready';
    check(
      !!(await until(() => rowOf()?.dataset.tone === want, 15000)),
      'the row turns to ' +
        (asksDecision ? '"Needs you": the report asks a decision' : 'finished') +
        ' (tone ' +
        (rowOf()?.dataset.tone || 'none') +
        ', "' +
        window.TnaiNeedsYou.label(paneId) +
        '")'
    );
    check(
      asksDecision ? /Needs you/.test(live.textContent) : !shown(live),
      asksDecision
        ? 'and the last line of the conversation says so: "' + live.textContent.trim() + '"'
        : 'the "working" line is gone once the task has ended'
    );
  }

  // ---- D2: the report's decision, answered in place ----
  // The model was asked to end with a Decide line. If it did, its options are buttons once the
  // app has filed the report, and a press answers through the app's own decision flow (49): the
  // answer goes to this agent as its next prompt (one more short reply on Haiku).
  {
    const decide = await until(
      () => blocks('.tnt-report').pop()?.querySelector('.tnt-decide'),
      3000
    );
    if (!decide)
      note('the reply had no Decide line this time: answering a decision was not visited');
    else {
      check(
        /Keep thread-check\.txt\?/.test(decide.querySelector('b').textContent) &&
          decide.querySelectorAll('button').length === 2,
        'the report asks its decision as a question with two options: "' +
          decide.textContent.replace(/\s+/g, ' ').trim() +
          '"'
      );
      const live = await until(() => decide.dataset.open === 'true', 20000);
      check(!!live, 'once the app has filed the report the options can be pressed');
      if (live) {
        const bubbles = blocks('.tnt-you').length;
        decide.querySelector('button').click();

        // The app's decision flow writes the answer into the prompt box, so the user can add a
        // word before sending it.
        const prompt = document.getElementById('prompt');
        const written = await until(() => /Keep it/.test(prompt.value), 5000);
        check(
          !!written && /Decision on "Keep thread-check\.txt\?"/.test(prompt.value),
          'a press writes the answer into the prompt box: "' + prompt.value.slice(0, 70) + '…"'
        );
        document.getElementById('send').click();
        const answer = await until(() => {
          const all = blocks('.tnt-you');
          return all.length > bubbles ? all[all.length - 1] : null;
        }, 30000);
        check(
          !!answer && /Keep it/.test(answer.textContent),
          'Send hands it to this agent and it shows as your next message: "' +
            (answer?.textContent || 'nothing arrived').slice(0, 90) +
            '"'
        );
        check(
          decide.dataset.open !== 'true',
          'the decision can no longer be pressed a second time'
        );
        const again = await until(() => blocks('.tnt-worked').length > 1, 90000);
        check(!!again, 'the agent takes the answer and its next task ends');
        await wait(1200);
      }
    }
  }
  const blocksDone = list().children.length;
  await shot('real-thread-done');

  // ---- D3: the lead and its helper, side by side; the files they hold ----
  {
    const card = list().querySelector('.tnt-helper');
    const side = threads.slot('side');
    check(!shown(side), 'the side island is closed until a helper is opened');
    card?.click();
    const helperTalk = await until(() => {
      const found = side.querySelector('.tnt-side-talk .tnt-talk-list');
      return shown(side) && found?.querySelector('.tnt-say') ? found : null;
    }, 12000);
    check(!!helperTalk, 'a press on the card opens the helper beside the lead');
    if (helperTalk) {
      check(
        !!helperTalk.querySelector('.tnt-from') &&
          /OK/.test(helperTalk.querySelector('.tnt-say').innerText),
        'with its own conversation, read from its own record: what its lead asked ("' +
          helperTalk
            .querySelector('.tnt-from')
            .textContent.replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60) +
          '") and what it answered ("' +
          helperTalk.querySelector('.tnt-say').innerText.trim().slice(0, 30) +
          '")'
      );
      check(
        shown(talk) && blocks('.tnt-you').length > 0,
        'the conversation of the lead is still on screen beside it'
      );
      const chip = side.querySelector('.tnt-side-chip[aria-selected="true"]');
      check(
        !!chip,
        'the helper is the chosen one in the side island: "' + (chip?.textContent || '') + '"'
      );
      const l = box(threads.slot('list')),
        m = box(island),
        s = box(side),
        p = box(document.querySelector('footer.composer')),
        area = box(document.querySelector('.layout'));
      check(
        near(m.left - l.right, 12) &&
          near(s.left - m.right, 12) &&
          near(area.right - s.right, 12) &&
          near(area.bottom - s.bottom, 12) &&
          near(s.top, m.top),
        'three islands on one spacing: ' +
          n(m.left - l.right) +
          ', ' +
          n(s.left - m.right) +
          ', ' +
          n(area.right - s.right) +
          ' to the edge, ' +
          n(area.bottom - s.bottom) +
          ' under the side'
      );
      check(
        near(p.left, m.left) && near(p.right, m.right) && s.width >= 300 && m.width >= 300,
        'the prompt box stays under the lead only; both conversations have room (' +
          n(m.width) +
          ' and ' +
          n(s.width) +
          ' wide)'
      );
      check(
        document.documentElement.scrollWidth <= innerWidth + 1 &&
          helperTalk.scrollWidth <= side.clientWidth,
        'nothing reaches past the window or is cut in the side island'
      );
      await shot('real-thread-helper');
    }

    // the files the thread holds, and who holds them
    const sharedRow = island.querySelector('.tnt-shared');
    const held = (await native.locks.list()).filter(lock => lock.paneId === paneId);
    if (!held.length)
      note('the app holds no file lock for this thread now: the shared files row was not visited');
    else
      check(
        shown(sharedRow) &&
          /thread-check\.txt/.test(sharedRow.textContent) &&
          sharedRow.textContent.includes(island.querySelector('h1').textContent),
        'the files this thread holds stand under its top row with who holds them: "' +
          sharedRow.textContent.replace(/\s+/g, ' ').trim() +
          '"'
      );
    side.querySelector('.tnt-side-head button')?.click();
    await wait(300);
    check(
      !shown(side) && near(box(document.querySelector('.layout')).right - box(island).right, 12),
      'closing the side island gives the lead its full width back'
    );
  }

  // ---- E: the same thread as its CLI screen, through the menu row ----
  check(await menuRow('screen'), 'the "..." menu opens and has the row "CLI screen"');
  const term = await until(() => {
    const t = view().mode() === 'term' ? view().term() : null;
    return t?.element && shown(t.element) && box(t.element).height > 40 ? t : null;
  }, 12000);
  check(!!term && !shown(talk), 'CLI screen shows the real terminal in place of the conversation');
  if (!term) throw new Error('no terminal in the thread');
  const host = () => island.querySelector('.tnt-term-host');
  check(
    !!(await until(
      () => /manual mode on|\? for shortcuts|shift\+tab/i.test(screenRows(term).join('\n')),
      12000
    )),
    'it shows the screen of Claude Code itself'
  );
  const sized = await until(() => {
    const size = agents.ptySize.get(paneId);
    return size && size.cols === term.cols && size.rows === term.rows ? size : null;
  }, 8000);
  check(!!sized, 'the session takes the size of the view (' + term.cols + ' x ' + term.rows + ')');
  check(numbersIn(allRows(term).join('\n')) >= 110, 'with the whole reply in its history');
  {
    const settled = await until(() => lastWritten(screenRows(term)) >= term.rows - 6, 12000);
    check(
      !!settled,
      'the input box of Claude Code is at the bottom of the view (last written row ' +
        (lastWritten(screenRows(term)) + 1) +
        ' of ' +
        term.rows +
        ')'
    );
    const screen = box(host().querySelector('.xterm-screen')),
      h = box(host());
    check(
      screen.width > h.width * 0.9 && screen.bottom <= h.bottom + 1,
      'the terminal fills its box (' + n(screen.width) + ' of ' + n(h.width) + ' wide)'
    );
  }
  await shot('real-thread-terminal');

  // a window resize: Claude Code redraws, and no second copy of the reply may stay
  const count = () =>
    allRows(term).filter(r => /(^|[^\d])117([^\d]|$)/.test(r) && !/count from 1/i.test(r)).length;
  const before = count(),
    was = await main('minimum'),
    start = await main('content');
  await main('setMinimum', 600, 400);
  await main('size', 1100, 700);
  await frame();
  await wait(3500);
  const narrow = { cols: term.cols, rows: term.rows, copies: count() };
  await main('size', start[0], start[1]);
  await main('setMinimum', was[0], was[1]);
  await frame();
  await wait(3500);
  check(
    before === 1 && narrow.copies <= 1 && count() <= 1,
    'the line "117" is in the terminal once before (' +
      before +
      '), at 1100 x 700 (' +
      narrow.copies +
      ', ' +
      narrow.cols +
      ' x ' +
      narrow.rows +
      ') and back (' +
      count() +
      ')'
  );
  {
    const size = agents.ptySize.get(paneId);
    check(
      lastWritten(screenRows(term)) >= term.rows - 6 &&
        size.cols === term.cols &&
        size.rows === term.rows,
      'after the resize the input box is at the bottom and the session has the size of the view'
    );
  }

  // back to the conversation: the same blocks, nothing read twice
  check(
    await menuRow('conversation'),
    'while the CLI screen shows, the menu has the row "Back to the conversation"'
  );
  await until(() => view().mode() === 'read' && shown(talk), 4000);
  await wait(900);
  check(
    list().children.length === blocksDone && !shown(island.querySelector('.tnt-term')),
    'Back to the conversation brings it back as it was: ' +
      list().children.length +
      ' blocks (' +
      blocksDone +
      ' before), nothing twice'
  );

  // ---- F: stop it and reload the window (real-thread.after.js) ----
  await agents.stop(paneId);
  await until(() => !agents.sessions().find(s => s.paneId === paneId)?.running, 10000);
  check(
    !!(await until(
      () => rowOf()?.querySelector('.tnt-face')?.dataset.face?.endsWith('asleep'),
      6000
    )),
    'stopped: its character falls asleep'
  );
  localStorage.setItem('tnai.test.real-thread-pane', paneId);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
  if (paneId) agents.stop(paneId);
}
return { ok, log, reload: true };
