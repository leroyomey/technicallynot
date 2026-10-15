/*
 * Technically Not tools · desktop-check/tests/composer-report-items.js — Report items in the
 * composer (50): "@i" lists the chosen agent's latest report Ideas in the picker;
 * "@Ideas 1 … @Decide 1" goes to that agent with "[Report item: …]" for each; an item the report
 * doesn't have blocks the send. The report is a stubbed TnaiContext entry, so no real agent report
 * is needed.
 */
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
    await wait(50);
  }
  return null;
};
const G = window.TnaiAgents,
  C = window.TnaiContext;
const sends = [],
  realSend = G.send,
  realEntries = C.entries;
G.send = (paneId, text) => {
  sends.push({ paneId, text });
  return true;
};
let pane, host;
try {
  const p = document.getElementById('prompt');
  const key = k =>
    p.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = v => {
    p.focus();
    p.value = v;
    p.setSelectionRange(v.length, v.length);
    p.dispatchEvent(new Event('input', { bubbles: true }));
  };
  pane = (await window.TnaiTest.open('Terminal'))?.paneId;
  const A = await until(() => G.sessions().find(s => s.paneId === pane && s.running), 15000);
  check(!!A, 'a running PowerShell panel: ' + A?.name);
  C.entries = () => [
    {
      id: 'abcd1234',
      paneId: pane,
      name: A.name,
      at: Date.now(),
      summary: {
        ideas: ['Add dark charts', 'Export to CSV'],
        next: ['Ship it'],
        choices: {
          question: 'Which first?',
          options: [{ label: 'Charts', recommended: true }, { label: 'CSV' }],
        },
      },
    },
  ];

  // the prompt box under the open thread on the Threads page (the old Overview is gone)
  window.TnaiThreads.open();
  await wait(200);

  type('@i');
  await wait(50);
  const rows = [...document.querySelectorAll('.tnai-at-menu .tnai-at-row[data-kind=report] b')].map(
    b => b.textContent
  );
  check(
    rows[0] === '@Ideas 1 · Add dark charts' && rows[1] === '@Ideas 2 · Export to CSV',
    '"@i" lists the report ideas: ' + rows.join(' | ')
  );
  check(
    [...document.querySelectorAll('.tnai-at-menu h4')].some(
      h => h.textContent === 'From ' + A.name + '’s report'
    ),
    'picker names whose report it is'
  );
  console.log('TNAI_SHOT:composer-report-items');
  const first = [...document.querySelectorAll('.tnai-at-menu .tnai-at-row')].findIndex(
    r => r.dataset.kind === 'report'
  );
  for (let i = 0; i < first; i++) key('ArrowDown');
  key('Enter');
  await wait(30);
  check(p.value === '@Ideas 1 ', 'Enter inserts "@Ideas 1 ": ' + JSON.stringify(p.value));

  type('@' + A.name + ' @Ideas 1 lets do that @Decide 1');
  await wait(30); // a PowerShell panel is never auto-picked: address it
  check(
    window.TnaiMentions.route(p.value)?.kind === 'mention',
    'report words are not refused as unknown agents'
  );
  sends.length = 0;
  key('Enter');
  await until(() => sends.length, 3000);
  const sent = sends[0]?.text || '';
  check(sends[0]?.paneId === pane, 'sent to the agent whose report it is');
  check(
    sent.includes(
      '[Report item: Ideas 1 from ' + A.name + '’s report abcd1234: "Add dark charts"]'
    ) &&
      sent.includes(
        '[Report item: Decide 1 from ' +
          A.name +
          '’s report abcd1234: decision on "Which first?": go with Charts]'
      ),
    'the agent gets both items: ' + sent.slice(0, 240)
  );

  sends.length = 0;
  type('@Ideas 5 do it');
  await wait(30);
  const r = window.TnaiMentions.route(p.value);
  check(
    r?.kind === 'blocked' && /no @Ideas 5/.test(r.why),
    'a missing item blocks the send: ' + r?.why
  );
  key('Enter');
  await wait(300);
  check(!sends.length && p.value === '@Ideas 5 do it', 'missing item: not sent, text kept');
  check(
    !window.TnaiMentions.route('use @media and @types/node'),
    'plain @words mid-text stay text'
  );
  type('');
  await wait(30);

  // A click on a report item in a terminal (75) sends "<Section> <n>: <text>" to that terminal
  // (term.paste for a terminal with no panel, as here; 75 changed from the composer reference
  // before the purple redesign).
  host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:40px;top:40px;width:760px;height:300px;z-index:99999;background:#fbfcf9';
  document.body.append(host);
  const { term, fit } = await G.createTerm();
  term.open(host);
  fit.fit();
  const pasted = [];
  term.onData(d => pasted.push(d));
  await new Promise(r =>
    term.write(
      [
        '',
        '  Technically Not report',
        '  - Did: stuff',
        '  - Ideas: Export to CSV (fit 70%); Add dark charts (fit 80%)',
        '  - Decide: Which first? | 1. Charts (recommended) | 2. CSV',
        '',
      ].join('\r\n'),
      r
    )
  );
  await wait(300);
  const screen = host.querySelector('.xterm-screen'),
    sr = screen.getBoundingClientRect(),
    cw = sr.width / term.cols,
    ch = sr.height / term.rows;
  const buf = term.buffer.active,
    rowOf = t => {
      for (let i = 0; i < buf.length; i++)
        if (buf.getLine(i).translateToString(true).includes(t)) return i - buf.viewportY;
      return -1;
    };
  const clickAt = async (row, col) => {
    const o = {
      clientX: sr.left + (col + 0.5) * cw,
      clientY: sr.top + (row + 0.5) * ch,
      bubbles: true,
      button: 0,
    };
    screen.dispatchEvent(new MouseEvent('mousemove', o));
    await wait(250);
    screen.dispatchEvent(new MouseEvent('mousedown', o));
    screen.dispatchEvent(new MouseEvent('mouseup', o));
    screen.dispatchEvent(new MouseEvent('click', o));
    await wait(100);
  };
  const ideasRow = rowOf('- Ideas:'),
    ideasLine = buf.getLine(ideasRow + buf.viewportY).translateToString(true);
  await clickAt(ideasRow, ideasLine.indexOf('Add dark') + 2);
  check(
    pasted.join('').includes('Ideas 2: Add dark charts'),
    'clicking "Add dark charts" sends it numbered by its place in the printed line (Ideas 2): ' +
      JSON.stringify(pasted.join(''))
  );
  const decRow = rowOf('- Decide:'),
    decLine = buf.getLine(decRow + buf.viewportY).translateToString(true);
  await clickAt(decRow, decLine.indexOf('CSV') + 1);
  check(
    pasted.join('').includes('Decide 2: CSV'),
    'clicking a Decide option sends Decide 2: ' + JSON.stringify(pasted.join(''))
  );
  const sentBefore = pasted.join('');
  await clickAt(rowOf('- Did:'), 6);
  check(pasted.join('') === sentBefore, 'Did items are not links');
  type('');
  await wait(30);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
G.send = realSend;
C.entries = realEntries;
if (pane) G.stop(pane);
host?.remove();
await wait(300);
return { ok, log };
