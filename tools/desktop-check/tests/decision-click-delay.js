// Technically Not tools · desktop-check/tests/decision-click-delay.js — a report's decision buttons
// can be pressed the moment the report is drawn, in All threads and in the single thread (user,
// 2026-10-15: "won't let me click ... then randomly it'll free it up"). The case: an agent asks a
// question, the user answers it, and the agent asks the same question again in its next report.
// The new card took the older answered result (or the older remembered press) for its own, so its
// buttons stayed off until some later event painted the card again (122 `paintDecisions`, 49
// `findDecision`, `choiceFor`).
//
// A real Claude Code panel is started and gets no prompt (nothing is spent): its conversation is a
// made-up transcript (decision-click-delay.main.js writes it where the app looks), the project's
// saved results are stood in for in the window (`TnaiContextState`), and the "context changed"
// push comes from the main process. Answers are caught at `TnaiAgents.send`, so nothing reaches
// the CLI. Presses are real mouse input. Checked:
// 1. All threads: the report that re-asks an answered question arrives at the end of a turn; a
//    real press on its first option at once sends the answer.
// 2. Its saved result arrives a moment later: the card stays answered with that option.
// 3. The single thread: the same question asked a third time, after a press on the second card;
//    a real press at once sends the answer.
// 4. All threads: a decision answered elsewhere (its result marked) turns to answered on the card
//    without anything else happening.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(50);
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

// Real mouse events through Chromium's input pipeline (run.js sends them one after another).
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++callId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    setTimeout(() => {
      if (window.__tnaiInputDone[id]) {
        log.push('info input ' + id + ' timed out');
        resolve();
      }
    }, 10000);
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const context = window.TnaiContext;
const all = () => window.TnaiAllThreads;
let pane = '';

// Claude Code's screen, replayed into a scratch terminal: only to answer its folder-trust
// question and to see that it reached its empty prompt.
async function replayed(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const screen = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => screen.write(replay.buffer, done));
  const buffer = screen.buffer.active;
  const rows = [];
  for (let y = 0; y < screen.rows; y++)
    rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '');
  screen.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await replayed(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const selected = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(selected) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

// ---------- the made-up conversation ----------
const QUESTION = "Is Deep-Sea Salvage's design approved?";
const APPROVE = 'Approve and move on to Observatory';
const CHANGE = 'Change it first (tell me what)';
const OTHER_QUESTION = 'Which table art goes first?';
const iso = ms => new Date(ms).toISOString();
let messageCount = 0;
const report = (at, question, first, second) => ({
  type: 'assistant',
  timestamp: iso(at),
  message: {
    id: 'msg_report_' + ++messageCount,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text:
          'The design is ready.\n\nTechnically Not report\n- Did: drew the machine\n\n- Decide: ' +
          question +
          ' | 1. ' +
          first +
          ' (recommended) | 2. ' +
          second,
      },
    ],
  },
});
const prompt = (at, text) => ({
  type: 'user',
  timestamp: iso(at),
  message: { role: 'user', content: text },
});
const answerText = (question, label) => 'Decision on "' + question + '": go with ' + label + '.';

// ---------- the saved results, stood in for ----------
// A result as desktop/agent-context.js saves one for a report with one decision.
const result = (id, at, question, first, second) => ({
  id,
  turnKey: '',
  at,
  startedAt: at - 5000,
  name: 'Pinball',
  agent: 'Claude Code',
  paneId: pane,
  subagent: '',
  task: 'design the next machine',
  summary: {
    choices: {
      question,
      options: [
        { label: first, detail: '', recommended: true },
        { label: second, detail: '', recommended: false },
      ],
      more: [],
    },
  },
  reported: true,
  edited: [],
  files: [],
  areas: [],
  keywords: [],
  errors: [],
  chars: 0,
  log: '',
  delivered: [],
  queued: [],
});
const realState = window.TnaiContextState;
const madeUp = { entries: [], marks: {} };
const pushContext = () => main('contextChanged');

// What paintDecisions decides for a card's first decision, read the way it reads it.
const partsOf = ask => {
  const question = ask.firstChild?.textContent || '';
  const since = Number(ask.closest('.tnt-report')?.dataset.at) || 0;
  const found = context.findDecision(pane, question, since);
  return (
    'found ' +
    (found ? found.id + (found.done ? ' (answered)' : ' (open)') : 'none') +
    ', chosen "' +
    context.choiceFor(pane, question, since) +
    '", report time ' +
    (since ? 'known' : 'unknown')
  );
};

// A real press on a decision's first option the moment its card is drawn: what lies under the
// pointer, whether the button is on, and whether the answer went out.
const sent = [];

async function pressAtOnce(ask, where) {
  const button = ask.querySelector('button');
  button.scrollIntoView({ block: 'center' });
  const box = button.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const under = document.elementFromPoint(x, y);
  log.push(
    'info ' +
      where +
      ': under the pointer ' +
      (under === button ? 'the button' : under?.className || under?.tagName || 'nothing') +
      ', disabled ' +
      button.disabled +
      ', ' +
      partsOf(ask)
  );
  const before = sent.length;
  const pressedAt = performance.now();
  await realInput([
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y },
    { type: 'mouseUp', x, y },
  ]);
  const went = await until(() => sent.length > before, 1500);
  check(
    !!went && sent[sent.length - 1].text.includes(APPROVE),
    where +
      ': a real press the moment the card is drawn sends the answer' +
      (went ? ' (' + Math.round(performance.now() - pressedAt) + ' ms)' : ' (nothing was sent)')
  );
}
const lastAsk = list => [...list.querySelectorAll('.tnt-report .tnt-decide')].pop();

const realSend = agents.send;
try {
  threads.open();
  await until(() => threads.visible(), 5000);
  const opened = await window.TnaiTest.open('Claude Code');
  pane = opened?.paneId || (await until(() => agents.sessions()[0]))?.paneId || '';
  const running = await until(
    () => agents.sessions().find(session => session.paneId === pane && session.running),
    30000
  );
  if (!running || !(await ready(pane))) {
    log.push(
      'note Claude Code did not start or reach its prompt on this PC: the made-up conversation was not visited'
    );
    return { ok, log };
  }

  // the answers stop here: nothing reaches the CLI
  agents.send = (paneId, text, options) => {
    sent.push({ paneId, text, options });
    return true;
  };
  window.TnaiContextState = async () => {
    const real = (await realState()) || {};
    return {
      ...real,
      entries: [...madeUp.entries, ...(real.entries || [])],
      marks: { ...(real.marks || {}), ...madeUp.marks },
    };
  };

  // Ten minutes ago the agent asked, its result was saved, and the user answered it.
  const now = Date.now();
  const askedAt = now - 600000;
  madeUp.entries = [result('dcd-first', askedAt + 1500, QUESTION, APPROVE, CHANGE)];
  madeUp.marks = { 'dcd-first:choices:0': { state: 'answered', at: askedAt + 60000 } };
  await pushContext();
  const file = await main('writeTranscript', pane, [
    prompt(askedAt - 30000, '[TN.ai] design the next machine'),
    report(askedAt, QUESTION, APPROVE, CHANGE),
    prompt(askedAt + 60000, answerText(QUESTION, CHANGE)),
  ]);
  check(!!file, 'setup: a made-up transcript stands where the app looks for this session');
  await main('size', 1440, 900);

  // ---- 1. All threads: the same question asked again at the end of a turn ----
  check(!!(await window.TnaiTest.openAllThreads()), 'setup: All threads is open');
  all().show(pane);
  const cardList = () =>
    document.querySelector(
      '#terminalView .tat-card[data-pane="' + pane + '"] .tat-body .tnt-talk-list'
    );
  const firstAsk = await until(() => cardList()?.querySelector('.tnt-report .tnt-decide'));
  check(
    !!firstAsk && firstAsk.querySelector('button').disabled,
    'setup: the first, answered report shows on the card with its buttons off'
  );
  await main('appendTranscript', pane, [report(Date.now(), QUESTION, APPROVE, CHANGE)]);
  const secondAsk = await until(() => {
    const asks = cardList()?.querySelectorAll('.tnt-report .tnt-decide');
    return asks?.length === 2 ? asks[1] : null;
  });
  if (!secondAsk) throw new Error('the second report was not drawn on the card');
  await pressAtOnce(secondAsk, 'All threads');

  // ---- 2. its saved result arrives a moment later ----
  madeUp.entries = [result('dcd-second', Date.now(), QUESTION, APPROVE, CHANGE), ...madeUp.entries];
  await pushContext();
  await wait(900);
  const secondSince = Number(secondAsk.closest('.tnt-report').dataset.at) || 0;
  check(
    !!context.findDecision(pane, QUESTION, secondSince)?.done,
    'All threads: the answer sent before its result was saved marks that result answered once it is read'
  );
  const secondButtons = [...secondAsk.querySelectorAll('button')];
  check(
    secondButtons.every(button => button.disabled) &&
      secondButtons[0].classList.contains('tnt-decide-chosen'),
    'All threads: once its saved result arrives the card stays answered, the pressed option marked (' +
      partsOf(secondAsk) +
      ')'
  );

  // ---- 3. the single thread: the question asked a third time ----
  madeUp.marks['dcd-second:choices:0'] = { state: 'answered', at: Date.now() };
  await pushContext();
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(pane);
  const island = threads.slot('main');
  const threadList = () => island.querySelector('.tnt-talk .tnt-talk-list');
  await until(() => threadList()?.querySelectorAll('.tnt-report .tnt-decide').length === 2);

  // the user reads the thread a moment before the agent's next report
  await wait(1500);
  await main('appendTranscript', pane, [
    prompt(Date.now() - 4000, answerText(QUESTION, APPROVE)),
    report(Date.now(), QUESTION, APPROVE, CHANGE),
  ]);
  const thirdAsk = await until(() => {
    const asks = threadList()?.querySelectorAll('.tnt-report .tnt-decide');
    return asks?.length === 3 ? asks[2] : null;
  });
  if (!thirdAsk) throw new Error('the third report was not drawn in the thread');
  await pressAtOnce(thirdAsk, 'Single thread');

  // ---- 4. All threads: a decision answered elsewhere turns to answered on the card ----
  check(!!(await window.TnaiTest.openAllThreads()), 'setup: All threads is open again');
  all().show(pane);
  await until(() => cardList()?.querySelectorAll('.tnt-report .tnt-decide').length === 3);
  await main('appendTranscript', pane, [
    report(Date.now(), OTHER_QUESTION, 'The sea first', 'The stars first'),
  ]);
  const fourthAsk = await until(() => {
    const asks = cardList()?.querySelectorAll('.tnt-report .tnt-decide');
    return asks?.length === 4 ? asks[3] : null;
  });
  check(
    !!fourthAsk && !fourthAsk.querySelector('button').disabled,
    'All threads: a new question with no saved result yet can be pressed'
  );
  madeUp.entries = [
    result('dcd-other', Date.now(), OTHER_QUESTION, 'The sea first', 'The stars first'),
    ...madeUp.entries,
  ];
  madeUp.marks['dcd-other:choices:0'] = { state: 'answered', at: Date.now() };
  await pushContext();
  const turnedOff = await until(() => fourthAsk?.querySelector('button').disabled, 2000);
  check(
    !!turnedOff,
    'All threads: answered elsewhere (its result marked), the card turns to answered by itself (' +
      (fourthAsk ? partsOf(fourthAsk) : 'no card') +
      ')'
  );
  check(lastAsk(cardList()) === fourthAsk, 'setup: the newest decision is the one looked at');

  // ---- 5. All threads: a shorter question that an older, longer one contains ----
  // (user, 2026-10-19: "What next?" could not be pressed; hours before, the user had pressed
  // "Start Scrapyard" for "Decision 2 of 2: What next?", and 0.3.73 took that press, of any age,
  // for this card's answer, so every button stayed off and none was marked.)
  const OLD_QUESTION = 'Decision 2 of 2: What next?';
  const SHORT_QUESTION = 'What next?';
  const choices = JSON.parse(localStorage.getItem('tnai.decision-choices.v1') || '{}');
  choices[pane + '\ndecision 2 of 2 what next'] = {
    paneId: pane,
    question: OLD_QUESTION,
    label: 'Start Scrapyard, the next new machine',
    at: Date.now() - 3 * 3600000,
  };
  localStorage.setItem('tnai.decision-choices.v1', JSON.stringify(choices));
  await wait(1100);
  await main('appendTranscript', pane, [report(Date.now(), SHORT_QUESTION, APPROVE, CHANGE)]);
  const fifthAsk = await until(() => {
    const asks = cardList()?.querySelectorAll('.tnt-report .tnt-decide');
    return asks?.length === 5 ? asks[4] : null;
  });
  if (!fifthAsk) throw new Error('the fifth report was not drawn on the card');
  check(
    !fifthAsk.querySelector('button').disabled,
    'All threads: an older press for a longer question that contains this one does not turn its buttons off (' +
      partsOf(fifthAsk) +
      ')'
  );
  await pressAtOnce(fifthAsk, 'All threads, shorter question');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
} finally {
  agents.send = realSend;
  window.TnaiContextState = realState;

  // the made-up older press of step 5 goes again
  try {
    const kept = JSON.parse(localStorage.getItem('tnai.decision-choices.v1') || '{}');
    delete kept[pane + '\ndecision 2 of 2 what next'];
    localStorage.setItem('tnai.decision-choices.v1', JSON.stringify(kept));
  } catch {}
}
await pushContext().catch(() => {});
await main('cleanup').catch(() => {});
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 10000);
await wait(300);
return { ok, log };
