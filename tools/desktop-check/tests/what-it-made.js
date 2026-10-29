// Technically Not tools · desktop-check/tests/what-it-made.js — "What it made" in the "Worked for"
// block that ends a task (src/scripts/170-what-it-made.js), from a made-up Claude Code transcript
// (what-it-made.main.js writes it, the files it names and a stand-in local site). The panel runs
// agent-mesh's fake `claude` (a plain Node script, put first on PATH by the .main.js), never the
// real Claude Code: nothing is spent, and the test no longer stalls while a real CLI starts (up to
// 405 s, bug sweep 2026-10-28 item 12). The app still names the panel's session, so the made-up
// transcript stands where the app reads it. Checked here: the head says
// "made N things, changed M files"; New holds the site, the picture it wrote and the one a command
// made as small pictures, the document and the data file as chips, and leaves out a picture a
// command only named; Changed is one chip that opens the file list and "Open Changes"; a data file
// is drawn as a bar chart, a document as its text, a picture large; a preview keeps its fixed
// height; the site says running while it answers and stopped once it does not, with "Start it
// again" only where the app can do it; the older task folds to one line and opens on a press; with
// "Open Live preview by itself" on, the site opens beside the thread in the side column's Live
// preview tab, marked "opened by itself"; the setting stands in Settings › Agents. Pictures:
// what-it-made-(1440|1024)-(dark|light), what-it-made-chart, what-it-made-beside. Returns {ok,
// log}.
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
const made = window.TnaiWhatItMade;
let pane = '';

// The fake CLI's screen, replayed into a scratch terminal: only to see that it started (its first
// line says "FAKE-claude start"). It asks nothing, so there is no question to answer.
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
  until(async () => /FAKE-claude start/.test((await replayed(paneId)).join('\n')), 15000);

// ---------- the files and the made-up conversation ----------
function picture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const paint = canvas.getContext('2d');
  paint.fillStyle = color;
  paint.fillRect(0, 0, 320, 200);
  return canvas.toDataURL('image/png').split(',')[1];
}
const CSV = 'month,sales\nJan,120\nFeb,180\nMar,90\n';
const DOC = '# Pricing\n\nThree plans, billed monthly or yearly.\n';
let step = 0;
const stamp = offset => new Date(Date.now() + offset).toISOString();
const use = (name, input, offset = 0) => ({
  type: 'assistant',
  timestamp: stamp(offset),
  message: {
    id: 'msg_use_' + ++step,
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't' + step, name, input }],
  },
});
const gave = (id, result) => ({
  type: 'user',
  timestamp: stamp(0),
  toolUseResult: result,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});
const say = (id, text) => ({
  type: 'assistant',
  timestamp: stamp(0),
  message: { id, role: 'assistant', content: [{ type: 'text', text }] },
});
const prompt = text => ({
  type: 'user',
  timestamp: stamp(0),
  message: { role: 'user', content: text },
});
const worked = ms => ({
  type: 'system',
  subtype: 'turn_duration',
  durationMs: ms,
  timestamp: stamp(0),
});
const created = content => ({ type: 'create', content, structuredPatch: [] });

function transcript(folder, site) {
  step = 0;
  return [
    prompt('Add a pricing page with three plans.'),
    use('Write', { file_path: folder + '/notes.md', content: 'notes' }),
    gave('t1', created('notes')),
    say('msg_say_1', 'The pricing page is in.'),
    worked(220000),
    prompt('Make it match the new look, with a hero picture and the sales chart.'),
    use('Write', { file_path: folder + '/PRICING.md', content: DOC }),
    gave('t2', created(DOC)),
    use('Write', { file_path: folder + '/sales.csv', content: CSV }),
    gave('t3', created(CSV)),
    use('Write', { file_path: folder + '/hero.png', content: '' }),
    gave('t4', created('')),
    use('Edit', { file_path: folder + '/app.js', old_string: 'a', new_string: 'b' }),
    gave('t5', {
      structuredPatch: [{ lines: ['-a', '+b', '+c'] }],
    }),
    use('Bash', { command: 'magick ' + folder + '/hero.png ' + folder + '/made.png' }, -1500),
    gave('t6', { stdout: 'done', stderr: '' }),
    use('Bash', { command: 'magick ' + folder + '/old.png -resize 50% x.txt' }, 600000),
    gave('t7', { stdout: '', stderr: '' }),
    use('Bash', { command: 'npm run dev', run_in_background: true }),
    gave('t8', { stdout: '  VITE ready\n  ➜  Local:   ' + site + '\n', stderr: '' }),
    say('msg_say_2', 'Done: the cards use the new tokens, the hero picture is in, and the chart.'),
    worked(372000),
  ];
}

const blockList = () => [
  ...(threads.slot('main')?.querySelectorAll('.tnt-talk .tnt-talk-list .tnt-made') || []),
];
const press = async node => {
  node.click();
  await wait(400);
};

try {
  check(!!made?.block, 'the "What it made" script is loaded');
  made.set({ show: true, autoOpen: true });
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
  const site = await main('site', true);
  const folder = await main('writeFiles', pane, {
    'notes.md': { text: 'notes' },
    'PRICING.md': { text: DOC },
    'sales.csv': { text: CSV },
    'hero.png': { base64: picture('#3a8f6b') },
    'made.png': { base64: picture('#b5533c') },
    'old.png': { base64: picture('#555555') },
    'app.js': { text: 'b\nc\n' },
  });
  check(!!folder && !!site, 'the files and a stand-in site are there');
  check(
    !!(await main('writeTranscript', pane, transcript(folder, site))),
    'a made-up transcript stands where the app looks'
  );
  await main('size', 1440, 900);
  threads.open();
  threads.select(pane);
  const both = await until(
    () => (view().shown() === pane && blockList().length === 2 ? blockList() : null),
    15000
  );
  check(!!both, 'both tasks end with a "What it made" block');
  if (!both) {
    // what the thread holds instead, so a failure says where it stopped
    const slot = threads.slot('main');
    log.push(
      'note shown=' +
        view().shown() +
        ' pane=' +
        pane +
        ' talk lists=' +
        (slot?.querySelectorAll('.tnt-talk .tnt-talk-list').length || 0) +
        ' worked blocks=' +
        (slot?.querySelectorAll('.tnt-worked').length || 0) +
        ' made blocks=' +
        (slot?.querySelectorAll('.tnt-made').length || 0) +
        ' all made=' +
        document.querySelectorAll('.tnt-made').length +
        ' text=' +
        JSON.stringify((slot?.querySelector('.tnt-talk-list')?.textContent || '').slice(0, 300))
    );
  }
  if (!both) throw new Error('no block: nothing more can be looked at');
  const [older, newest] = both;

  // ---- the head, and the older task folded ----
  const head = newest.querySelector('.tnt-made-head');
  check(
    /Worked for 6m 12s/.test(head?.textContent) &&
      /made 5 things, changed 4 files/.test(head?.textContent),
    'the head says what it made: "' + head?.textContent.trim() + '"'
  );
  check(
    older.dataset.folded === 'true' && older.querySelector('.tnt-made-body').hidden,
    'the older task is folded to one line'
  );
  check(newest.dataset.folded === 'false', 'the newest task is open');

  // ---- the groups (feature 14, mock info-layout.html "Proposed": a group per kind with its
  // count; documents and data as rows, pictures and the site as small cards, the changed files
  // last) ----
  const cards = () => [
    ...newest.querySelectorAll('.tnt-made-group > .tnt-made-row, .tnt-made-cards .tnt-made-thumb'),
  ];
  const names = () =>
    cards().map(card => card.querySelector(':scope > b, .tnt-made-wtext b')?.textContent || '');
  await until(() => !names().includes('old.png') && names().length === 5, 6000);
  check(
    JSON.stringify([...names()].sort()) ===
      JSON.stringify(['PRICING.md', 'Site', 'hero.png', 'made.png', 'sales.csv']),
    'every new thing is in a group: ' +
      names().join(', ') +
      ' (a picture a command only named is left out)'
  );
  const groupWords = [...newest.querySelectorAll('.tnt-made-group > .tnt-made-ghead')].map(
    groupHead =>
      groupHead.querySelector('span').textContent + ' ' + groupHead.querySelector('em').textContent
  );
  check(
    groupWords.join(' | ') === 'Documents 1 | Data 1 | Pictures 2 | Sites 1 | Changed files 4',
    'the groups name their kind and count: ' + groupWords.join(' | ')
  );
  check(
    !!(await until(
      () =>
        !!cards()
          .find(card => /PRICING/.test(card.textContent))
          ?.querySelector('small')?.textContent,
      6000
    )),
    "a document's row shows its title"
  );
  const changes = newest.querySelector('.tnt-made-group[data-kind="changes"]');
  check(
    !!changes?.querySelector(':scope > .tnt-files') && !newest.querySelector('.tnt-made-chip'),
    'the changed files are the last group, no pill'
  );

  // ---- previews ----
  const preview = newest.querySelector('.tnt-made-preview');
  const csvChip = cards().find(card => /sales\.csv/.test(card.textContent));
  await press(csvChip);
  const bars = await until(() => preview.querySelectorAll('.tnt-made-chart rect').length, 6000);
  check(bars === 3, 'a data file is drawn as a bar of its number column: ' + bars + ' bars');
  check(/Open the data/.test(preview.textContent), 'and offers "Open the data"');
  const body = preview.querySelector('.tnt-made-pbody');
  check(
    body && getComputedStyle(body).maxHeight === '260px',
    'a preview keeps its fixed height (260 px)'
  );
  newest.scrollIntoView({ block: 'center' });
  await shot('what-it-made-chart');

  await press(cards().find(card => /PRICING/.test(card.textContent)));
  check(
    !!(await until(() => /Three plans/.test(preview.textContent), 6000)),
    'a document shows its text, with "Open in Files": ' + /Open in Files/.test(preview.textContent)
  );

  await press(cards().find(card => /hero\.png/.test(card.textContent)));
  check(
    !!(await until(() => preview.querySelector('img.tnt-made-image')?.naturalWidth > 0, 6000)),
    'a picture shows large, with "Open large"'
  );

  check(
    changes?.querySelectorAll(':scope > .tnt-files > .tnt-file').length === 4 &&
      /Open Changes/.test(changes.querySelector('.tnt-made-ghead')?.textContent || ''),
    'the changed files group lists the files, with "Open Changes" on its head'
  );

  // ---- the site ----
  const siteThumb = newest.querySelector('.tnt-made-group[data-kind="site"] .tnt-made-thumb');
  check(
    !!(await until(() => /running/.test(siteThumb.textContent), 6000)),
    'the site says running while it answers: "' + siteThumb.textContent + '"'
  );
  await press(siteThumb);
  check(
    !!(await until(() => /Open in Live preview/.test(preview.textContent), 4000)),
    'a running site offers "Open in Live preview"'
  );
  await main('site', false);
  await press(siteThumb);
  await press(siteThumb);
  check(
    !!(await until(() => /stopped/.test(preview.textContent), 6000)),
    'once nothing answers it says stopped'
  );
  check(!/Stop it/.test(preview.textContent), 'a server the app did not start offers no "Stop it"');

  // ---- opened by itself beside the thread ----
  const sideState = window.TnaiThreadSide?.state?.();
  check(
    sideState?.shown && sideState.tab === 'preview',
    'with the setting on the site opened beside the thread: ' + JSON.stringify(sideState)
  );
  const note = document.querySelector('.tnt-sidepreview .tnt-made-beside-note');
  check(
    /opened by itself/.test(note?.textContent || ''),
    'marked "opened by itself": "' + note?.textContent + '"'
  );
  await shot('what-it-made-beside');
  window.TnaiThreadSide?.close();

  // ---- the older task opens on a press ----
  await press(older.querySelector('.tnt-made-head'));
  check(older.dataset.folded === 'false', 'a press opens the older task');
  await press(older.querySelector('.tnt-made-head'));

  // ---- looks and sizes ----
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ])
    for (const look of ['dark', 'light']) {
      await main('size', width, height);
      window.TnaiTheme?.set(look);
      await wait(500);
      newest.scrollIntoView({ block: 'center' });
      const box = newest.getBoundingClientRect();
      const list = newest.closest('.tnt-talk-list').getBoundingClientRect();
      check(
        box.left >= list.left - 1 && box.right <= list.right + 1,
        width + ' ' + look + ': the block stays inside the conversation'
      );
      await shot('what-it-made-' + width + '-' + look);
    }
  window.TnaiTheme?.set('dark');

  // ---- the setting ----
  const group = document.querySelector('.tnt-made-set');
  check(
    !!group &&
      /Show what it made after each task/.test(group.textContent) &&
      /Open Live preview by itself/.test(group.textContent),
    'the two switches stand in Settings › Agents'
  );
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
made?.set({ show: true, autoOpen: false });
await main('cleanup').catch(() => {});
agents.sessions().forEach(session => agents.stop(session.paneId));
await until(() => !agents.sessions().some(session => session.running), 10000);
await wait(300);
return { ok, log };
