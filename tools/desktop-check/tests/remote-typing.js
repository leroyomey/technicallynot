// Technically Not tools · desktop-check/tests/remote-typing.js — typing into another computer's
// watched terminal (src/scripts/166-remote-typing.js, the mark in 115, the full-control text in
// 111; plan item 41) in the real app with a throwaway profile. Nothing is paired: the state and the
// live picture are made up by this test and handed over the way the main process would
// (remote-typing.main.js), and the typing calls are stand-ins that write down what was sent.
// Covered: no Type button without the other computer's word; the button with it; the mode on
// (pressed, outlined, the picture focused); letters, Enter, Ctrl+C and a paste are sent, Shift+Tab
// and other Ctrl keys are not and the bar says so; the main process's words in the bar; the mode
// ends when the view ends; the Devices card names typing under full control (no switch of its own,
// rule 13) and its question shows the sentence; the notice where keys land. Pictures:
// remote-typing-(1440|1024)-(dark|light). Returns {ok, log}. Written 2026-10-21 with the batch and
// not run yet (the lead runs the window tests once).
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
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  await wait(400);
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

const threads = window.TnaiThreads;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;
const listSlot = () => threads.slot('list');
const host = () => threads.slot('main')?.querySelector(':scope > .tnh-view');
const far = () => {
  const box = host()?.querySelector('.ap-far');
  return box && onScreen(box) ? box : null;
};
const typeButton = () => far()?.querySelector('.ap-term-tools button[data-act=type]') || null;

// The live screen's bar. The conversation (152) stands above it with the same parts, so it is told
// apart by its own section class.
const LIVE = '.ap-term-sec:not(.ap-talk-sec)';
const note = () => far()?.querySelector(LIVE + ' .ap-term-tools > em')?.textContent || '';
const screen = () => far()?.querySelector('.ap-term .dv-screen') || null;
const remoteRows = () => [...listSlot().querySelectorAll('.tnt-th[data-remote]')];
const rowNamed = name => remoteRows().find(row => row.querySelector('b').textContent === name);
const pressRow = async name => {
  await until(() => !window.TnaiDevices.quiet(), 3000);
  rowNamed(name).click();
};
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}
const key = (target, init) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

const nowMs = Date.now();
const PC = 'sample-computer-1';
const farAgents = [
  {
    id: 'p1',
    name: 'Wren',
    cli: 'Claude Code',
    status: 'idle',
    since: 0,
    sure: true,
    can: true,
    mark: 'm1',
  },
];
const computer = (more = {}) => ({
  id: PC,
  name: 'Sample laptop',
  since: nowMs,
  online: true,
  session: true,
  state: 'live',
  heard: nowMs,
  detail: true,
  update: false,
  asks: [],
  keepsAsking: 0,
  items: [],
  elsewhere: 0,
  project: null,
  answer: false,
  control: false,
  commands: false,
  watchable: false,
  typeable: false,
  canControl: true,
  canWatch: true,
  canType: false,
  canStart: [],
  ops: [],
  finished: null,
  agents: farAgents,
  ...more,
});
const picture = {
  cols: 40,
  rows: 3,
  cut: 0,
  at: nowMs,
  incomplete: false,
  lines: [
    { t: 'PS C:\\work> ', r: [] },
    { t: '', r: [] },
    { t: '', r: [] },
  ],
};
const model = more => ({
  peer: PC,
  agent: 'p1',
  name: 'Wren',
  state: 'on',
  why: '',
  until: nowMs + 9 * 60000,
  left: 100,
  picture,
  ...more,
});

try {
  check(!!window.TnaiRemoteTyping?.paint, 'the typing box and its hook in 116 exist');
  const real = (await window.tnaiNative.remote.state()).value;
  const state = (pc, more = {}) => ({
    ...real,
    on: true,
    computers: [pc],
    others: [],
    watching: [],
    typed: [],
    ...more,
  });
  const push = async value => {
    await main('show', value);
    await wait(250);
  };
  await main('install');
  await main('size', 1440, 900);
  await main('spy');
  await main('typeStub');
  threads.open();
  await until(() => threads.visible(), 5000);

  // ---- without the other computer's word: no Type button ----
  await push(state(computer()));
  await until(() => remoteRows().length === 1, 5000);
  await pressRow('Wren');
  await until(() => far(), 5000);
  await main('view', model());
  await until(() => screen(), 5000);
  check(!onScreen(typeButton()), 'no Type button while that computer does not let this one type');

  // ---- with it ----
  await push(state(computer({ canType: true })));
  await main('view', model());
  const button = await until(() => (onScreen(typeButton()) ? typeButton() : null), 4000);
  check(!!button && button.textContent === 'Type', 'the Type button is in the picture’s bar');
  button?.click();
  await frame();
  check(
    typeButton()?.getAttribute('aria-pressed') === 'true' &&
      typeButton()?.textContent === 'Stop typing',
    'pressed, it reads Stop typing'
  );
  check(document.activeElement === screen(), 'the picture has the focus');
  check(
    !!far()?.querySelector('.ap-term[data-typing]'),
    'the picture’s box is outlined while typing'
  );
  check(/Typing into Wren on Sample laptop/.test(note()), 'the bar says where keys go: ' + note());
  for (const look of ['dark', 'light'])
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
    ]) {
      await main('size', width, height);
      document.documentElement.dataset.theme = look;
      await shot('remote-typing-' + width + '-' + look);
    }
  await main('size', 1440, 900);
  screen()?.focus({ preventScroll: true });

  // ---- keys ----
  key(screen(), { key: 'l' });
  key(screen(), { key: 's' });
  key(screen(), { key: 'Enter' });
  key(screen(), { key: 'c', ctrlKey: true });
  key(screen(), { key: 'ArrowUp' });
  const sent = await until(async () => {
    const calls = (await main('typed')).filter(c => c.ch === 'remote:type');
    return calls.length >= 5 ? calls : null;
  }, 4000);
  check(
    !!sent &&
      JSON.stringify(sent.map(c => c.args[3])) ===
        JSON.stringify([[{ x: 'l' }], [{ x: 's' }], ['Enter'], ['CtrlC'], ['Up']]) &&
      sent.every(c => c.args[0] === PC && c.args[1] === 'p1' && c.args[2] === 'm1'),
    'letters, Enter, Ctrl+C and an arrow are sent for that agent with its mark: ' +
      JSON.stringify(sent && sent.map(c => c.args))
  );
  const before = (await main('typed')).length;
  key(screen(), { key: 'Tab', shiftKey: true });
  await wait(200);
  check(
    (await main('typed')).length === before && /Shift\+Tab is not sent/.test(note()),
    'Shift+Tab is not sent, and the bar says so'
  );
  key(screen(), { key: 'a', ctrlKey: true });
  await wait(200);
  check(
    (await main('typed')).length === before && /Only Ctrl\+C and Ctrl\+V/.test(note()),
    'another Ctrl key is not sent, and the bar says so'
  );
  const data = new DataTransfer();
  data.setData('text/plain', 'npm test');
  screen().dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
  );
  const pasted = await until(async () =>
    (await main('typed')).find(c => c.ch === 'remote:typePaste')
  );
  check(!!pasted && pasted.args[3] === 'npm test', 'a paste is sent as one paste');

  // ---- the main process's words ----
  await main('view', model({ typing: { on: false, said: 'stale', at: Date.now(), waiting: 0 } }));
  await wait(250);
  check(/the screen there changed/.test(note()), 'a stale word is said in the bar: ' + note());

  // ---- the view ends: the mode ends ----
  await main('view', model({ state: 'ended', why: 'closed' }));
  await until(() => typeButton()?.getAttribute('aria-pressed') !== 'true', 3000);
  check(
    typeButton()?.getAttribute('aria-pressed') !== 'true' &&
      !far()?.querySelector('.ap-term[data-typing]') &&
      (await main('typed')).some(c => c.ch === 'remote:typeEnd'),
    'the view ended: typing ended, the outline went, the main process was told'
  );

  // ---- where the keys land (this computer as the typed one) ----
  await push(
    state(computer(), {
      typed: [
        { panelId: 'no-such-panel', peer: PC, name: 'Sample laptop (…er-1)', at: Date.now() },
      ],
    })
  );
  check(
    said.some(s => /Sample laptop \(…er-1\) is typing into/.test(s)),
    'a notice says which computer types here'
  );
  const views = window.TnaiAgents?.views?.() || [];
  if (views.length)
    check(
      !document.querySelector('.tnai-rt-mark'),
      'no mark on a terminal that was not typed into'
    );

  // ---- the Devices card: typing is part of full control (rule 13), no switch of its own ----
  // The page reads the service's own state when it opens (off in this profile), so the made-up one
  // is pushed once it is open, as the service pushes a change.
  const page = () => document.getElementById('devicesPage');
  window.TnaiRoute('devices');
  await until(() => page()?.querySelector('.dv-off, .dv-card'), 4000);
  await push(state(computer({ control: true, watchable: true, typeable: false })));
  const cardText = await until(() => {
    const text = page()?.textContent || '';
    return /permission questions included/.test(text) ? text : null;
  }, 5000);
  check(!!cardText, 'the full-control text names typing, with what it can do');
  check(
    !page()?.querySelector('[aria-label^="Let Sample laptop type"]'),
    'there is no typing switch of its own'
  );
  check(
    !!page()?.querySelector('[data-notype]'),
    'a full-control grant from before the typing sentence says how to allow typing'
  );
  await push(state(computer({ control: true, watchable: true, typeable: true })));
  await wait(250);
  check(!page()?.querySelector('[data-notype]'), 'a grant that includes typing says nothing more');
  await push(state(computer({ control: false })));
  const full = await until(
    () => page()?.querySelector('[aria-label^="Give Sample laptop full control"]'),
    3000
  );
  full?.click();
  const asked = await until(() => {
    const d = [...document.querySelectorAll('.dv-dlg')].find(onScreen);
    return d && /full control/.test(d.textContent) ? d : null;
  }, 3000);
  check(
    !!asked && /type into the terminal it watches/.test(asked.textContent),
    'the full-control question shows the typing sentence'
  );
  [...(asked?.querySelectorAll('button') || [])].find(b => b.textContent === 'Cancel')?.click();
  await push({ ...real, on: false, computers: [] });
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
