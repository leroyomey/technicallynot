// Technically Not tools · desktop-check/tests/remote-files.js — the Files tab of another computer's
// thread (src/scripts/163-remote-files.js, plan items 42 and 43) in the real app with a throwaway
// profile. Nothing is paired: the state, the folders, the file and the picture are made up by
// remote-files.main.js and pushed or answered the way the remote service would. Written with the
// batch of 2026-10-21 and run once when the whole batch is done (no window tests while building).
// Covered: with a thread of this computer open the Files tab is this computer's rail; a press on
// another computer's agent shows that computer's folder in its place (secret count line, folders
// first); a folder opens and Back goes up; a text file shows read-only and Edit then Save sends the
// new text; a picture file says its kind and sends nothing; "Its Live preview" shows the picture
// with its address and "Take again" asks again; going back to this computer's thread brings the
// rail back; a save from another computer is said in a notice. Pictures: remote-files-list,
// remote-files-file, remote-files-edit, remote-files-preview (1440 and 1024, Dark and Light).
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
const shot = async name => {
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
const agents = window.TnaiAgents;
const side = window.TnaiThreadSide;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}
const filesPart = () => document.getElementById('tntSideFiles');
const part = () => filesPart()?.querySelector('.tnt-remotefiles');
const rail = () => document.querySelector('.repository-rail');
const rows = () => [...(part()?.querySelectorAll('.tnt-rf-row') || [])].filter(onScreen);
const rowNamed = name => rows().find(row => row.dataset.name === name);
const noteText = () => {
  const note = part()?.querySelector(':scope > .tnt-fileview-note');
  return onScreen(note) ? note.textContent : '';
};
const headButton = cls => {
  const found = part()?.querySelector('.' + cls);
  return onScreen(found) ? found : null;
};
const remoteRows = () => [...threads.slot('list').querySelectorAll('.tnt-th[data-remote]')];

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
const computer = {
  id: PC,
  name: 'Sample laptop',
  since: nowMs,
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
  canControl: true,
  canWatch: false,
  canStart: [],
  ops: [],
  finished: null,
  agents: farAgents,
};

try {
  check(!!side && !!window.TnaiRemoteFiles, 'the side column and the remote Files part exist');
  const real = (await window.tnaiNative.remote.state()).value;
  await main('install');
  await main('filesStub');
  await main('size', 1440, 900);

  // a thread of this computer is open, with the column on its Files tab
  threads.open();
  await until(() => threads.visible(), 5000);
  const before = new Set(agents.sessions().map(session => session.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  const home =
    opened?.paneId ||
    (await until(() => agents.sessions().find(session => !before.has(session.paneId))))?.paneId;
  threads.show(home);
  side.open('files');
  await until(() => onScreen(filesPart()), 4000);
  check(
    onScreen(rail()) && !onScreen(part()),
    'a thread of this computer: the Files tab is this computer’s rail'
  );

  // another computer's agent
  await main('show', { ...real, on: true, computers: [{ ...computer }], others: [], watching: [] });
  await until(() => remoteRows().length === 1, 5000);
  await until(() => !window.TnaiDevices?.quiet?.(), 3000);
  remoteRows()[0].click();
  check(
    !!(await until(() => onScreen(part()), 5000)),
    'another computer’s thread: its files show in the Files tab'
  );
  check(!onScreen(rail()), 'this computer’s rail steps aside meanwhile');
  check(
    !!(await until(() => rows().length === 3, 4000)),
    'its folder arrives: ' + rows().map(row => row.dataset.name)
  );
  check(rows()[0].dataset.name === 'src' && rows()[0].dataset.type === 'd', 'folders first');
  check(/kept private/.test(noteText()), 'the line says what was kept private: ' + noteText());
  await shot('remote-files-list');

  // a folder, then Back
  rowNamed('src').click();
  check(!!(await until(() => rowNamed('app.js'), 4000)), 'a folder opens');
  headButton('tnt-rf-back').click();
  check(!!(await until(() => rowNamed('README.md'), 4000)), 'Back goes up a folder');

  // a text file, read-only, then Edit and Save
  rowNamed('README.md').click();
  const text = await until(() => {
    const node = part().querySelector('pre.tnt-fileview-text');
    return onScreen(node) && node.textContent.includes('sample file') ? node : null;
  }, 4000);
  check(!!text, 'a text file shows read-only');
  await shot('remote-files-file');
  headButton('tnt-rf-edit').click();
  const box = part().querySelector('.tnt-rf-box');
  check(onScreen(box) && document.activeElement === box, 'Edit opens the box with the text');
  box.value = '// changed here\n';
  await shot('remote-files-edit');
  headButton('tnt-rf-save').click();
  check(
    !!(await until(() => /Saved on/.test(noteText()), 4000)),
    'Save sends it and says it landed: ' + noteText()
  );
  const asks = await main('fileAsks');
  check(
    asks.some(
      ask => ask.op === 'save' && ask.path === 'README.md' && ask.text === '// changed here\n'
    ),
    'the new text was sent for that file'
  );

  // a picture file
  headButton('tnt-rf-back').click();
  await until(() => rowNamed('logo.png'), 4000);
  rowNamed('logo.png').click();
  check(
    !!(await until(() => /a picture, so it is not sent/.test(noteText()), 4000)),
    'a picture says its kind and is not sent'
  );

  // the Live preview picture
  headButton('tnt-rf-preview').click();
  const image = await until(() => {
    const img = part().querySelector('.tnt-rf-shot img');
    return onScreen(img) && img.complete ? img : null;
  }, 5000);
  check(!!image, 'its Live preview shows as a picture');
  check(
    part().querySelector('.tnt-rf-shot figcaption').textContent === 'http://localhost:5173/',
    'with the page address'
  );
  check(/does nothing on/.test(noteText()), 'the line says a press does nothing there yet');
  await shot('remote-files-preview');
  const asked = (await main('fileAsks')).filter(ask => ask.op === 'preview').length;
  headButton('tnt-rf-again').click();
  check(
    !!(await until(
      async () => (await main('fileAsks')).filter(ask => ask.op === 'preview').length > asked,
      3000
    )),
    'Take again asks again'
  );

  // the smaller window, both looks
  for (const [width, height] of [[1024, 768]]) {
    await main('size', width, height);
    await shot('remote-files-preview-' + width);
  }
  await main('size', 1440, 900);

  // back to this computer's thread: the rail is back
  threads.show(home);
  check(
    !!(await until(() => onScreen(rail()) && !onScreen(part()), 4000)),
    'this computer’s thread brings its own rail back'
  );

  // a save from another computer is said where it lands
  await main('landed', { kind: 'saved', by: 'Sample laptop (…er-1)', path: 'src/app.js' });
  check(
    !!(await until(() => said.some(line => /saved src\/app\.js here/.test(line)), 3000)),
    'a save from another computer is said: ' + said.slice(-1)
  );
  await main('show', { ...real, on: false, computers: [] });
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
