// Technically Not tools · desktop-check/tests/composer-mentions.js — Composer @mentions (50): "@"
// opens the running-agent picker (filter, arrows, Enter picks without sending, Esc), a prompt with
// @Name goes only to that pane (real pty write), two mentions go to both, a picked file (click) and
// folder (arrows + Tab) insert "@src/app.js " / "@src/ " and the sent text ends with "[Mentioned
// file: src/app.js] [Mentioned folder: src/]", an unknown @name or an email never routes. Two
// PowerShell panes, no agent CLI, no credits.
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
  L = window.TnaiLiveTasks;
const sends = [],
  realSend = G.send;
let forward = true;
G.send = (paneId, text) => {
  sends.push({ paneId, text });
  return forward ? realSend.call(G, paneId, text) : true;
};
const panes = [];
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
  for (let i = 0; i < 2; i++) panes.push((await window.TnaiTest.open('Terminal'))?.paneId);
  await until(() => panes.every(id => G.sessions().find(s => s.paneId === id && s.running)), 15000);
  const [A, B] = panes.map(id => G.sessions().find(s => s.paneId === id));
  check(A && B && A.name !== B.name, 'two running PowerShell panes: ' + A?.name + ', ' + B?.name);
  window.TnaiRoute?.('overview');
  await wait(200);

  type('@');
  await wait(50);
  let menu = document.querySelector('.tnai-at-menu');
  check(
    !!menu &&
      [A, B].every(s =>
        [...menu.querySelectorAll('.tnai-at-row b')].some(b => b.textContent === s.name)
      ),
    '"@" opens the picker with both running agents'
  );
  const box = document.querySelector('.composer .composebox').getBoundingClientRect(),
    mb = menu?.getBoundingClientRect();
  check(
    mb && mb.bottom <= box.top + 1 && mb.top >= 0,
    'picker sits above the composer, inside the window'
  );
  console.log('TNAI_SHOT:composer-mentions');
  key('Escape');
  await wait(30);
  check(!document.querySelector('.tnai-at-menu') && p.value === '@', 'Esc closes the picker');

  type('@' + A.name.slice(0, 3));
  await wait(50);
  const rows = [...document.querySelectorAll('.tnai-at-menu .tnai-at-row b')].map(
    b => b.textContent
  );
  check(rows[0] === A.name, 'typing after @ filters (' + rows.join(', ') + ')');
  key('Enter');
  await wait(50);
  check(
    p.value === '@' + A.name + ' ' && !sends.length && !document.querySelector('.tnai-at-menu'),
    'Enter picks "@' + A.name + ' " and does not send'
  );

  type('@' + A.name + ' echo tnai-mention-one');
  await wait(80);
  check(
    new RegExp('→ ' + A.name).test(document.querySelector('.tnai-route-hint')?.textContent || ''),
    'route hint shows the mentioned agent: ' +
      document.querySelector('.tnai-route-hint')?.textContent
  );
  key('Enter');
  await until(() => sends.length);
  await wait(200);
  check(
    sends.length === 1 && sends[0].paneId === A.paneId && sends[0].text === 'echo tnai-mention-one',
    'send goes to ' + A.name + ' only, mention stripped: ' + JSON.stringify(sends)
  );
  check(
    p.value === '' && /tnai-mention-one/.test(L.get(A.paneId)?.text || ''),
    'prompt cleared, task recorded on ' + A.name
  );

  forward = false;
  sends.length = 0;
  type('@' + A.name + ', @' + B.name + ': compare notes');
  await wait(30);
  key('Enter');
  await until(() => sends.length >= 2);
  await wait(100);
  check(
    sends.length === 2 &&
      sends.some(
        x => x.paneId === A.paneId && /\] compare notes$/.test(x.text) && x.text.includes(B.name)
      ) &&
      sends.some(x => x.paneId === B.paneId && x.text.includes(A.name)),
    'two mentions: each gets it, told who else did: ' + JSON.stringify(sends)
  );

  // Files and folders (seeded project: README.md, src/app.js): picked from the same picker,
  // readable token, project-relative ref on send.
  sends.length = 0;
  type('@app');
  await until(() => document.querySelector('.tnai-at-menu .tnai-at-row[data-kind=file]'));
  let fileRow = [...document.querySelectorAll('.tnai-at-menu .tnai-at-row[data-kind=file]')].find(
    r => r.title === 'src/app.js'
  );
  check(
    !!fileRow &&
      /Files and folders/.test(document.querySelector('.tnai-at-menu')?.textContent || ''),
    '"@app" lists src/app.js under Files and folders'
  );
  fileRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(50);
  check(
    p.value === '@src/app.js ' && !document.querySelector('.tnai-at-menu'),
    'click inserts "@src/app.js ": ' + JSON.stringify(p.value)
  );
  type(p.value + '@sr');
  await until(() => document.querySelector('.tnai-at-menu .tnai-at-row[data-kind=folder]'));
  const rowsNow = [...document.querySelectorAll('.tnai-at-menu .tnai-at-row')];
  const folderIndex = rowsNow.findIndex(r => r.dataset.kind === 'folder' && r.title === 'src/');
  check(folderIndex >= 0, '"@sr" lists the src/ folder');
  for (let i = 0; i < folderIndex; i++) key('ArrowDown');
  key('Tab');
  await wait(50);
  check(
    p.value === '@src/app.js @src/ ',
    'arrows + Tab insert "@src/ ": ' + JSON.stringify(p.value)
  );
  type('@' + A.name + ' look at @src/app.js and @src/');
  await wait(30);
  check(
    window.TnaiMentions.route(p.value)?.targets?.[0]?.paneId === A.paneId,
    'agent + file mentions still route to ' + A.name
  );
  key('Enter');
  await until(() => sends.length);
  await wait(100);
  check(
    sends.length === 1 &&
      sends[0].paneId === A.paneId &&
      sends[0].text ===
        'look at @src/app.js and @src/ [Mentioned file: src/app.js] [Mentioned folder: src/]',
    'sent text carries the paths: ' + JSON.stringify(sends)
  );
  sends.length = 0;
  check(!window.TnaiMentions.refs('@src/app.js'), 'picked files reset after send');

  sends.length = 0;
  type('@Zzqxv hello');
  await wait(30);
  key('Enter');
  await wait(300);
  check(!sends.length && p.value === '@Zzqxv hello', 'unknown @name: not sent, text kept');
  check(
    !window.TnaiMentions.route('mail me at a@' + A.name + '.com') &&
      !window.TnaiMentions.route('use @media and @types/node'),
    'emails, @media mid-text and @scope/pkg are not mentions'
  );
  check(
    window.TnaiMentions.route('please ask @' + B.name + ' about it')?.targets?.[0]?.paneId ===
      B.paneId &&
      window.TnaiMentions.strip('please ask @' + B.name + ' about it') ===
        'please ask ' + B.name + ' about it',
    'mid-text mention routes, name kept as plain text'
  );
  type('');
  await wait(30);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
G.send = realSend;
panes.forEach(id => id && G.stop(id));
await wait(300);
return { ok, log };
