// Technically Not tools · desktop-check/tests/composer-remote-files.js — the composer's attachment
// chips with an agent on another computer as its target
// (src/scripts/27-composer-attachments.js forRemote, 11-agents-live.js, 116-remote-agents.js,
// 111-devices-page.js) in the real app with a throwaway profile. Nothing is paired: the remote
// state is made up and pushed as the main process pushes a real one, and the calls a prompt with
// files makes are answered by composer-remote-files.main.js, which also runs every file the page
// hands over through the app's real checkFile. FIRST THING THIS TEST ANSWERS: does the JPEG the
// page's canvas writes pass the strict walk the other computer holds (only the segments the review
// allows)? If not, every picture would be refused on the sender. Covered: the first Enter only says
// what would be sent and how big, the second sends; a picture is made small in the page (at most
// about 120 KB, long side at most 1,568) and a text file goes as it is; what cannot go is refused
// with its reason and the draft and chips stay; the line under the box follows files on their way;
// Esc stops them; the Devices list names a file that came with a prompt and offers "Show in
// folder". No agent CLI runs, nothing is sent anywhere.
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
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
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
const layout = document.querySelector('.layout'),
  R = window.tnaiNative.remote,
  A = window.TnaiAttachments;
const go = async view => {
  view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view);
  await until(() => layout.classList.contains(view + '-mode'));
  await frame();
};

// Another computer's agents stand in the thread list; the chosen one's detail in the thread's
// main area.
const farRows = () => [...window.TnaiThreads.slot('list').querySelectorAll('.tnt-th[data-remote]')],
  far = () => {
    const f = document.querySelector('.ap-agent.ap-far');
    return f && !f.hidden ? f : null;
  };
const btn = word =>
  [...(far()?.querySelectorAll('button') || [])].find(
    b => b.textContent.trim() === word && !b.hidden
  ) || null;
const input = document.getElementById('prompt'),
  sendB = document.getElementById('send'),
  chips = () => [...document.querySelectorAll('#attachmentList .attachment-chip')];
const hintEl = () => document.querySelector('.composer .tnai-route-hint');
const said = [];
{
  const t0 = window.toast;
  window.toast = m => {
    said.push(String(m));
    return typeof t0 === 'function' ? t0(m) : undefined;
  };
}
const type = text => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const ch = String.fromCodePoint;

// A picture that does not compress well (noise), so it has to be made smaller in steps; and a flat
// one that fits at once.
const picture = async (w, h, noisy) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(40,60,90)';
  g.fillRect(0, 0, w, h);
  if (noisy) {
    const d = g.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.random() * 255;
      d.data[i + 1] = Math.random() * 255;
      d.data[i + 2] = Math.random() * 255;
    }
    g.putImageData(d, 0, 0);
  }
  g.fillStyle = 'white';
  g.font = '48px sans-serif';
  g.fillText('Text in a screenshot', 40, 90);
  return new Promise(r => c.toBlob(r, 'image/png'));
};
const attach = files => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const el = document.getElementById('attachmentInput');
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const clearAll = async () => {
  A.clear();
  type('');
  await wait(60);
};

check(
  !!A &&
    typeof A.forRemote === 'function' &&
    typeof R.promptFiles === 'function' &&
    typeof R.stopFiles === 'function' &&
    typeof R.showFile === 'function' &&
    typeof window.TnaiRemoteAgents?.progress === 'function',
  'the page can prepare attachments for another computer, and the bridge has the three calls'
);
await main('install');
const real = (await R.state()).value,
  nowMs = Date.now();
const agents = [
  {
    id: 'p2',
    name: 'Moss',
    cli: 'Claude Code',
    status: 'idle',
    since: 0,
    sure: true,
    can: true,
    mark: 'm2',
  },
];
const pc = {
  id: 'sample-computer-1',
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
  canControl: true,
  canWatch: false,
  canStart: [],
  ops: [],
  finished: null,
  agents,
};
const state = more => ({
  ...real,
  on: true,
  computers: [pc],
  others: [],
  watching: [],
  sending: null,
  ...more,
});
await go('overview');
await main('show', state());
await until(() => farRows().length === 1);
await until(() => !window.TnaiDevices.quiet(), 3000);
farRows()[0].click();
await until(() => btn('Send composer tasks here'));
await until(() => !window.TnaiDevices.quiet(), 3000);
btn('Send composer tasks here').click();
check(
  !!(await until(() => window.TnaiRemoteAgents.target()?.agent === 'Moss')),
  "an agent on another computer is the composer's target"
);

// ---- 1. a big picture and a text file: the first Enter only says what would go ----
const bigPng = await picture(2400, 1500, true),
  note = '# Notes\nRun the tests, then fix the footer.\n';
attach([
  new File([bigPng], 'big shot.png', { type: 'image/png' }),
  new File([note], 'notes.md', { type: 'text/markdown' }),
]);
await until(() => chips().length === 2, 3000);
type('Look at this');
said.length = 0;
sendB.click();
const first = await until(() => said.find(s => /^Enter again sends /.test(s)), 20000);
let got = await main('got');

// Short on purpose: the toast shows one line for about two seconds (window run 1: a longer sentence
// was cut off after "…the text file n").
check(
  !!first &&
    /^Enter again sends 2 files \(\d+ KB, about \d+ (s|min)\) to Moss on Sample laptop\.$/.test(
      first
    ) &&
    first.length <= 80,
  'the first Enter says what would be sent, how big, about how long, and to whom: ' + first
);
check(
  got.prompts.length === 0 && input.value === 'Look at this' && chips().length === 2,
  'nothing left: the draft and both chips are still there, and the bridge was not called'
);
check(
  bigPng.size > 1024 * 1024,
  'the picture that was attached is far over the cap as it is (' +
    Math.round(bigPng.size / 1024) +
    ' KB), so the page had to make it small'
);
await shot('desktop-composer-remote-files-ask');

// ---- 2. the second Enter sends: what the page handed over ----
said.length = 0;
sendB.click();
await until(async () => (await main('got')).prompts.length === 1, 20000);
got = await main('got');
const p = got.prompts[0],
  pic = p?.files?.[0],
  txt = p?.files?.[1];
check(
  !!p &&
    p.peer === 'sample-computer-1' &&
    p.agentId === 'p2' &&
    p.text === 'Look at this' &&
    p.mark === 'm2' &&
    p.files.length === 2,
  "the second Enter, with the same draft and files, hands over the prompt, the row's mark and two files: " +
    JSON.stringify(p && { text: p.text, mark: p.mark, n: p.files.length })
);

// THE CHECK THE BUILD REPORT ASKED FOR FIRST: the canvas's JPEG against the strict walk.
check(
  !!pic && pic.kind === 'jpg' && pic.head.startsWith('ffd8ff') && pic.why === '',
  'FIRST THING TO TRY: the JPEG the page\'s canvas writes passes the strict walk the other computer holds (checkFile says "' +
    (pic && pic.why) +
    '"; its marks: ' +
    (pic && pic.marks.join(' ')) +
    ')'
);
check(
  !!pic &&
    pic.marks.every(m => ['e0', 'db', 'c0', 'c2', 'c4', 'dd', 'da', 'd9'].includes(m)) &&
    !pic.marks.includes('e1') &&
    !pic.marks.includes('e2') &&
    !pic.marks.includes('fe'),
  'it holds only the segments the review allows: no EXIF, no ICC profile, no comment'
);
check(
  !!pic && pic.bytes <= 120 * 1024 && pic.bytes > 2000,
  'the picture was made small in the page: ' +
    (pic && Math.round(pic.bytes / 1024)) +
    ' KB (at most about 120)'
);
check(
  !!txt &&
    txt.kind === 'txt' &&
    txt.why === '' &&
    txt.text === note &&
    txt.bytes === new TextEncoder().encode(note).length,
  'the text file goes as it is, as plain text'
);
check(
  !!(await until(() => said.some(s => s === 'Sent to Moss on Sample laptop with 2 files'))) &&
    input.value === '' &&
    !!(await until(() => chips().length === 0, 3000)),
  'once it left: the box is empty, the chips are gone, and it says so: ' + JSON.stringify(said)
);
{
  const sig = said.find(s => /^Enter again sends/.test(s));
  check(!sig, 'the second Enter did not ask again');
}

// ---- 3. the picture as the other computer would get it: long side and readable size ----
{
  A.clear();
  attach([new File([await picture(3000, 1200, false)], 'wide.png', { type: 'image/png' })]);
  await until(() => chips().length === 1, 3000);
  const r = await A.forRemote(),
    f = r?.files?.[0],
    bmp = f ? await createImageBitmap(new Blob([f.bytes], { type: 'image/jpeg' })) : null;
  check(
    !!r?.ok &&
      f.kind === 'jpg' &&
      !!bmp &&
      Math.max(bmp.width, bmp.height) <= 1568 &&
      Math.abs(bmp.width / bmp.height - 3000 / 1200) < 0.02 &&
      f.bytes.byteLength <= 120 * 1024,
    'a wide picture: long side at most 1,568 (' +
      (bmp && bmp.width + ' by ' + bmp.height) +
      '), its shape kept, at most about 120 KB'
  );
  const again = await A.forRemote();
  check(
    again.sig === r.sig && again.files[0].bytes === f.bytes,
    'prepared once for a chip: the second Enter sends exactly what the first one described'
  );
  await clearAll();
}

// ---- 4. what cannot go is refused with its reason; the draft and the chips stay; the bridge is
// never called ----
const refused = async (label, files, re) => {
  await clearAll();
  attach(files);
  await until(() => chips().length === files.length, 3000);
  type('Read this');
  said.length = 0;
  const before = (await main('got')).prompts.length;
  sendB.click();
  const words = await until(() => said.find(s => /^Not sent: /.test(s)), 8000),
    after = (await main('got')).prompts.length;
  check(
    !!words &&
      re.test(words) &&
      /Your prompt is still in the box\.$/.test(words) &&
      after === before &&
      input.value === 'Read this' &&
      chips().length === files.length,
    label + ': ' + words
  );
};
await refused(
  'review 18: a text with a tag character is refused in the page, with the reason',
  [new File(['Fix the page.' + ch(0xe0049) + ch(0xe0067)], 'hidden.txt', { type: 'text/plain' })],
  /characters nobody can see/
);
await refused(
  'a text with a direction override',
  [new File(['abc' + ch(0x202e) + 'def'], 'rtl.md', { type: 'text/markdown' })],
  /characters nobody can see/
);
await refused(
  'a file that is not plain text (a PDF)',
  [
    new File(
      [
        new Uint8Array([
          0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0xfe, 0x01,
        ]),
      ],
      'paper.pdf',
      { type: 'application/pdf' }
    ),
  ],
  /is not a picture or a plain text file/
);
await refused(
  'a text of more than 64 KB',
  [new File(['line of text\n'.repeat(6000)], 'long.log', { type: 'text/plain' })],
  /larger than 64 KB/
);
await refused(
  'a fourth attachment',
  [1, 2, 3, 4].map(i => new File(['note ' + i], 'n' + i + '.txt', { type: 'text/plain' })),
  /at most 3 attachments/
);
{
  await clearAll();
  attach([new File(['a note'], 'n.txt', { type: 'text/plain' })]);
  await until(() => chips().length === 1, 3000);
  type('');
  said.length = 0;
  sendB.click();
  const words = await until(() => said.find(s => /^Enter again sends|Not sent/.test(s)), 8000);
  if (/^Enter again sends/.test(words || '')) {
    said.length = 0;
    sendB.click();
  }
  const end = await until(() => said.find(s => /starts with a letter or a number/.test(s)), 8000);
  check(
    !!end && chips().length === 1,
    'attachments without words do not go to another computer: a prompt for it starts with a letter or a number: ' +
      end
  );
}

// ---- 5. the other computer's answers: refused, no reply, a file that did not arrive whole ----
for (const [word, re] of [
  ['file_refused', /did not take the file/],
  ['file_no_reply', /may need an update to take files/],
  ['file_failed', /did not arrive whole/],
  ['changed', /changed|closed/],
  ['busy', /already on their way/],
]) {
  await clearAll();
  attach([new File(['a note'], 'n.txt', { type: 'text/plain' })]);
  await until(() => chips().length === 1, 3000);
  type('Read this');
  await main('answer', word);
  said.length = 0;
  sendB.click();
  await until(() => said.some(s => /^Enter again sends/.test(s)), 8000);
  said.length = 0;
  sendB.click();
  const words = await until(
    () => said.find(s => /Your prompt is still in the box\.$/.test(s)),
    8000
  );
  check(
    !!words && re.test(words) && input.value === 'Read this' && chips().length === 1,
    'answered "' + word + '": said in words, the draft and the chip stay: ' + words
  );
}
await main('answer', 'asked');

// ---- 6. files on their way: the line under the box follows them, Esc stops them ----
{
  await clearAll();
  const base = hintEl()?.textContent || '';
  await main(
    'show',
    state({
      sending: { peer: 'sample-computer-1', agent: 'p2', file: 1, files: 2, piece: 10, pieces: 41 },
    })
  );
  check(
    !!(await until(
      () =>
        hintEl() &&
        !hintEl().hidden &&
        hintEl().textContent === 'Sending file 1 of 2 to Sample laptop: 24%',
      3000
    )),
    'the line under the box says which file and how far: ' + hintEl()?.textContent
  );
  await shot('desktop-composer-remote-files-sending');
  await main(
    'show',
    state({
      sending: { peer: 'sample-computer-1', agent: 'p2', file: 2, files: 2, piece: 2, pieces: 2 },
    })
  );
  check(
    !!(await until(
      () => hintEl().textContent === 'Sending file 2 of 2 to Sample laptop: 100%',
      3000
    )),
    'it follows the next file'
  );
  const stops0 = (await main('got')).stops;
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(
    !!(await until(async () => (await main('got')).stops === stops0 + 1, 3000)),
    'Esc in the prompt box stops files that are on their way'
  );
  await main('show', state({ sending: null }));
  check(
    !!(await until(() => !/^Sending file/.test(hintEl().textContent), 3000)),
    "when none travel the line is the route's own again: " +
      hintEl().textContent +
      ' (before: ' +
      base +
      ')'
  );
  const stops1 = (await main('got')).stops;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);
  check((await main('got')).stops === stops1, 'Esc with nothing on its way stops nothing');
}

// ---- 7. the other side's list: a file that came with a prompt is named, with "Show in folder"
// ----
{
  const NAME = 'ab12cd34-from-another-computer.jpg',
    t = Date.now();

  // The page asks the main process for its state when it opens (and once more: `refresh`), which in
  // this profile is "nothing paired": the made-up state is pushed after that, and pushed again if
  // the page's own answer came later (window run 1: pushed before the page opened, it was replaced
  // and the list was never drawn).
  const made = state({
    computers: [{ ...pc, control: true }],
    controlTotal: 2,
    controlLog: [
      {
        at: t,
        peer: pc.id,
        name: 'Sample laptop (…er-1)',
        agent: 'Wren',
        op: 'prompt',
        head: 'Look at this <b>please</b>',
        length: 26,
        more: 0,
        files: [
          { name: NAME, kind: 'jpg', bytes: 114688 },
          { name: 'ef56ab78-from-another-computer.txt', kind: 'txt', bytes: 300 },
        ],
      },
      {
        at: t - 60000,
        peer: pc.id,
        name: 'Sample laptop (…er-1)',
        agent: 'Wren',
        op: 'file',
        head: 'a picture, 112 KB',
        length: 17,
        more: 0,
      },
    ],
  });
  await go('devices');
  await wait(1200);
  const dev = document.querySelector('.dv-page') || document.body;
  const findLine = () =>
    [...dev.querySelectorAll('.dv-did li')].find(li => /sent Wren a prompt/.test(li.textContent));
  let line = null;
  for (let i = 0; i < 6 && !line; i++) {
    await main('show', made);
    line = await until(findLine, 1500);
  }
  const shows = line
    ? [...line.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Show in folder')
    : [];
  check(
    !!line &&
      /With a picture, 112 KB: ab12cd34-from-another-computer\.jpg/.test(line.textContent) &&
      /With a text file, 300 bytes: ef56ab78-from-another-computer\.txt/.test(line.textContent) &&
      shows.length === 2 &&
      !line.querySelector('b'),
    'the prompt\'s line names each file that came with it (what, how big, the name made here) with "Show in folder"; text stays text: ' +
      (line && line.textContent.slice(0, 200))
  );
  {
    const offer = [...dev.querySelectorAll('.dv-did li')].find(li =>
      /sent a file for Wren\. It waits here for its prompt/.test(li.textContent)
    );
    check(
      !!offer && offer.textContent.includes('a picture, 112 KB') && !offer.querySelector('button'),
      "the offer's own line says what was coming and how big, and has no button: " +
        (offer && offer.textContent.slice(0, 160))
    );
  }
  if (shows[0]) {
    shows[0].click();
    check(
      !!(await until(async () => (await main('got')).shown.includes(NAME), 3000)),
      'a press asks the main process to show that file, by its name alone'
    );
    check(
      shows[0].getAttribute('aria-label') === 'Show ' + NAME + ' in its folder' &&
        shows[0].getBoundingClientRect().height >= 20,
      'the button has a name for a screen reader and a height like its neighbors'
    );
    const textLeft = line.querySelector('span').getBoundingClientRect().left,
      inList = line.closest('.dv-did').getBoundingClientRect();
    check(
      shows.every(
        b =>
          b.getBoundingClientRect().left >= textLeft - 1 &&
          b.getBoundingClientRect().right <= inList.right + 1 &&
          b.closest('small')
      ),
      "each button sits in the line's text column, with the file it shows, inside the list (window run 1: it fell under the time)"
    );
  }
  await shot('desktop-devices-remote-files-list');
}

await main('show', { ...real, on: false, computers: [] });
await clearAll();
await go('overview');
return { ok, log };
