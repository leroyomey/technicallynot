// Technically Not tools · desktop-check/tests/thread-designs.js — a page and pictures the agent
// made, as a card in the thread's conversation (src/scripts/159-thread-designs.js), from a made-up
// Claude Code transcript (thread-designs.main.js writes it and the files it names; a real Claude
// Code panel is started and gets no prompt, so nothing is spent). Checked here: the card comes
// after the actions that made it and before the agent's next words; it names the page and says it
// was shown; the page is drawn small as a still picture, not a running frame; the two pictures sit
// under it with their names; Open large lays the page over the window in a walled frame and Esc
// closes it, giving the keyboard back; the card's sides are even and nothing runs off it at 1440,
// 1024 and the smallest window. Pictures: thread-designs-dark, -light, -dark-1024, -dark-small,
// -large. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (condition, label) => {
  log.push((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) ok = false;
};
const until = async (read, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
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
const view = () => window.TnaiThreadView;
const shown = element => !!element && element.getClientRects().length > 0;
const round = value => Math.round(value * 10) / 10;
let pane = '';

// Claude Code's screen, replayed into a scratch terminal: only to answer its folder-trust question
// and to see that it reached its empty prompt.
async function replayed(paneId) {
  const result = await native.pty.replay(paneId);
  if (!result?.buffer) return [];
  const terminal = new window.Terminal({
    cols: result.cols || 120,
    rows: result.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => terminal.write(result.buffer, done));
  const buffer = terminal.buffer.active;
  const rows = [];
  for (let y = 0; y < terminal.rows; y++)
    rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '');
  terminal.dispose();
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

// ---------- the files and the made-up conversation ----------
// A small picture drawn here, as PNG bytes.
function picture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const paint = canvas.getContext('2d');
  paint.fillStyle = color;
  paint.fillRect(0, 0, 320, 200);
  return canvas.toDataURL('image/png').split(',')[1];
}
const PAGE =
  '<!doctype html><html><body style="margin:0;font:16px sans-serif;background:#f4f1ea">' +
  '<header style="height:120px;background:#6d5bd0"></header>' +
  '<main style="padding:24px"><h1>Settings card</h1><p>One surface, one card.</p></main>' +
  '<script>document.body.dataset.ran = "yes";</script></body></html>';
let step = 0;
const use = (name, input) => ({
  type: 'assistant',
  message: {
    id: 'msg_use_' + ++step,
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't' + step, name, input }],
  },
});
const gave = id => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});
const say = (id, text) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content: [{ type: 'text', text }] },
});
const transcript = folder => [
  {
    type: 'user',
    message: { role: 'user', content: 'Can the settings page feel less like columns?' },
  },
  say('msg_say_1', 'Here is one way: one surface, one card.'),
  use('Write', { file_path: folder + '/settings-card.html', content: PAGE }),
  gave('t1'),
  use('Bash', { command: 'tnai show ' + folder + '/settings-card.html', description: 'Show it' }),
  gave('t2'),
  use('Write', { file_path: folder + '/one-surface.png', content: '' }),
  gave('t3'),
  use('Write', { file_path: folder + '/split-view.png', content: '' }),
  gave('t4'),
  say('msg_say_2', 'Want it built like this, or with the tabs on top?'),
];

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
  const folder = await main('writeFiles', pane, {
    'settings-card.html': { text: PAGE },
    'one-surface.png': { base64: picture('#3a8f6b') },
    'split-view.png': { base64: picture('#b5533c') },
  });
  check(!!folder, 'a page and two pictures stand in the session’s folder');
  const file = await main('writeTranscript', pane, transcript(folder));
  check(!!file, 'a made-up transcript stands where the app looks for this session');
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 4000);
  threads.select(pane);
  const island = threads.slot('main');
  const list = () => island.querySelector('.tnt-talk .tnt-talk-list');
  const card = await until(
    () => (view().shown() === pane ? list()?.querySelector('.tnt-design:not([hidden])') : null),
    12000
  );
  check(!!card, 'the conversation shows a design card');
  if (!card) throw new Error('no design card: nothing more can be looked at');

  // ---- where it sits, and what it says ----
  const says = [...list().querySelectorAll('.tnt-say')];
  const blocks = [...list().children];
  const at = blocks.indexOf(card);
  check(
    card.previousElementSibling?.classList.contains('tnt-did') &&
      card.nextElementSibling === says[1] &&
      at > blocks.indexOf(says[0]),
    'the card comes after the actions that made it and before the agent’s next words'
  );
  check(
    list().querySelectorAll('.tnt-design').length === 1,
    'a page written and then shown is one card'
  );
  const top = card.querySelector('.tnt-design-top');
  check(
    top?.querySelector('b')?.textContent === 'settings-card.html' &&
      top.querySelector('.tnt-design-how')?.textContent === '· a page it showed',
    'it names the page and says it was shown: "' + top?.textContent.replace(/\s+/g, ' ') + '"'
  );
  const buttons = [...card.querySelectorAll('.tnt-design-actions button')].map(b => b.textContent);
  check(buttons.join('|') === 'Open large|Live preview', 'its buttons: ' + buttons.join(', '));
  check(!card.querySelector('iframe'), 'nothing runs inside the card: no frame in it');
  const still = await until(() => {
    const image = card.querySelector('.tnt-design-frame img');
    return image?.complete && image.naturalWidth > 0 ? image : null;
  }, 20000);
  check(
    !!still && /^data:image\/jpeg;base64,/.test(still.src),
    'the page is drawn small as a still picture (' +
      (still ? still.naturalWidth + ' by ' + still.naturalHeight : 'none') +
      ')'
  );
  const shots = await until(() => {
    const row = [...card.querySelectorAll('.tnt-design-shot')];
    return row.length === 2 && row.every(each => each.querySelector('img')?.naturalWidth > 0)
      ? row
      : null;
  }, 10000);
  check(
    !!shots &&
      shots.map(each => each.querySelector('b').textContent).join() ===
        'one-surface.png,split-view.png',
    'the two pictures sit under it with their names'
  );

  // ---- measured: even sides, nothing off the card ----
  const fits = label => {
    const box = card.getBoundingClientRect();
    const listBox = list().getBoundingClientRect();
    const frameBox = card.querySelector('.tnt-design-frame').getBoundingClientRect();
    const topBox = top.getBoundingClientRect();
    const actionsBox = top.querySelector('.tnt-design-actions').getBoundingClientRect();
    const left = frameBox.left - box.left;
    const right = box.right - frameBox.right;
    check(
      Math.abs(left - right) <= 1.5 &&
        box.left >= listBox.left - 0.5 &&
        box.right <= listBox.right + 0.5 &&
        actionsBox.right <= topBox.right + 0.5 &&
        Math.abs(box.right - actionsBox.right - left) <= 1.5,
      label +
        ': the picture has ' +
        round(left) +
        ' and ' +
        round(right) +
        ' px at its sides, the buttons end ' +
        round(box.right - actionsBox.right) +
        ' px from the edge, and the card stays in the conversation'
    );
  };
  card.scrollIntoView({ block: 'center' });
  fits('1440 by 900');
  await shot('thread-designs-dark');
  window.TnaiTheme.set('light');
  await wait(400);
  await shot('thread-designs-light');
  window.TnaiTheme.set('dark');

  // ---- Open large: the page over the window, walled; Esc closes it ----
  const large = [...card.querySelectorAll('.tnt-design-actions button')][0];
  large.focus();
  large.click();
  const layerFrame = await until(
    () => document.querySelector('.tnt-design-layer[data-on="true"] iframe'),
    8000
  );
  check(
    !!layerFrame &&
      layerFrame.name === 'tnai-lp-design' &&
      /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}\/settings-card\.html$/.test(layerFrame.src),
    'Open large shows the page from the walled page server, in a preview frame: ' +
      (layerFrame?.src || 'none')
  );
  await wait(1200);
  await shot('thread-designs-large');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const closed = await until(() => !document.querySelector('.tnt-design-layer'), 3000);
  check(!!closed && document.activeElement === large, 'Esc closes it and gives the keyboard back');

  // ---- other window sizes ----
  const was = await main('minimum');
  const start = await main('content');
  await main('size', 1024, 768);
  await wait(600);
  card.scrollIntoView({ block: 'center' });
  fits('1024 by 768');
  await shot('thread-designs-dark-1024');
  await main('setMinimum', 768, 680);
  await main('size', 768, 680);
  await wait(900);
  card.scrollIntoView({ block: 'center' });
  fits('the smallest window, 768 by 680');
  await shot('thread-designs-dark-small');
  await main('size', start[0], start[1]);
  await main('setMinimum', was[0], was[1]);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
await main('cleanup').catch(() => {});
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 10000);
await wait(300);
return { ok, log };
