// Technically Not tools · desktop-check/tests/real-thread-ask.js — A REAL Claude Code agent (Haiku,
// one short prompt, a few cents) that asks the user a question with its own tool, answered from
// the question's box in the thread layout's Readable view (122). It measures which keys Claude
// Code's question menu takes: the box types the choice's number into the tool's terminal and adds
// Enter only if the question is still open a moment later; this test presses the second choice
// and reports whether the number alone answered, what the menu looked like, and that the agent
// went on with that answer. Run alone, with TNAI_CHECK_LIMIT_MS=400000. Picture: real-thread-ask.
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
const agents = window.TnaiAgents,
  native = window.tnaiNative,
  threads = window.TnaiThreads,
  view = () => window.TnaiThreadView;
let paneId = '';

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

try {
  threads.open();
  await until(() => threads.visible(), 5000);
  const before = new Set(agents.sessions().map(s => s.paneId));
  const opened = await agents.open('Claude Code');
  paneId =
    opened?.paneId ||
    (await until(() => agents.sessions().find(s => !before.has(s.paneId))))?.paneId ||
    '';
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running), 30000)),
    'Claude Code started'
  );
  check(!!(await ready()), 'Claude Code is ready for a prompt');
  agents.send(paneId, '/model haiku');
  await wait(2500);
  check(!!(await ready()), 'switched to Haiku');

  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(paneId);
  await until(() => view().shown() === paneId, 8000);
  const talk = threads.slot('main').querySelector('.tnt-talk');
  const prompt = document.getElementById('prompt');
  prompt.value =
    'Use the AskUserQuestion tool to ask me exactly one question, "Which color?", with the two ' +
    'options Red and Blue. After I answer, reply with only the color I chose.';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  document.getElementById('send').click();

  const box = await until(() => talk.querySelector('.tnt-askbox[data-state="open"]'), 90000);
  check(!!box, 'the question the agent asks is a box in the conversation');
  if (!box) throw new Error('no question box');
  const options = [...box.querySelectorAll('.tnt-ask-option')];
  check(
    options.length === 2 &&
      /Red/.test(options[0].textContent) &&
      /Blue/.test(options[1].textContent),
    'its choices are buttons: ' + options.map(o => '"' + o.textContent + '"').join(', ')
  );
  await wait(1500);
  note(
    'the menu in the terminal: ' +
      JSON.stringify(
        (await replayed())
          .map(r => r.trim())
          .filter(r => /Red|Blue|color|Enter|select|❯|\d\./i.test(r))
          .slice(0, 10)
          .map(r => r.slice(0, 80))
      )
  );
  console.log('TNAI_SHOT:real-thread-ask');
  await wait(700);

  // the second choice, pressed from the box
  options[1].click();
  const answered = await until(() => box.dataset.state === 'answered', 20000);
  check(!!answered, 'pressing "Blue" in the box answers the question in the tool');
  note('how it was answered: the ' + (box.dataset.by || 'keys are unknown'));
  const reply = await until(
    () => [...talk.querySelectorAll('.tnt-say')].find(block => /Blue/i.test(block.innerText)),
    60000
  );
  check(
    !!reply && !/Red/i.test(reply.innerText),
    'the agent goes on with that answer: "' +
      (reply?.innerText || 'no reply').trim().slice(0, 40) +
      '"'
  );
  check(!!(await until(() => talk.querySelector('.tnt-worked'), 30000)), 'and its task ends');
  note(
    'terminal after the answer: ' +
      JSON.stringify((agents.tail?.(paneId, 3) || []).map(r => r.slice(0, 70)))
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
if (paneId) {
  await agents.stop(paneId);
  await until(() => !agents.sessions().find(s => s.paneId === paneId)?.running, 10000);
}
return { ok, log };
