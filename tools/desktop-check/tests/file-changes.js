// Technically Not tools · desktop-check/tests/file-changes.js — Project-wide native file search,
// TnaiFileTabs list/onChange (24), live AI change cards (26: counts, lines, minimize/expand/close)
// on an attached host as the Build File viewer uses them, Settings toggle off hides cards. Agent
// edits are simulated by a real PowerShell thread writing files (no agent CLI, no credits). The
// rail search and editor parts went with the File repository page (purple redesign). Returns {ok,
// log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const rail = path => document.querySelector('.repo-real-tree [data-real-path="' + path + '"]');
const text = () => document.querySelector('.repo-editor:not([hidden]) .repo-editor-text');
const activeName = () => document.querySelector('.file-tab.active>span')?.textContent;
const native = window.tnaiNative,
  F = window.TnaiProjectFiles,
  T = window.TnaiFileTabs,
  D = window.TnaiFileDiff;
let paneId = '';

try {
  await until(() => rail('README.md'));

  // A real shell thread stands in for an agent: 13 credits the file changes to it (inferred),
  // like any agent CLI.
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  paneId = started.paneId;
  check(!!started.session?.running, 'shell started as a thread');
  const name = window.TnaiAgents.sessions().find(s => s.paneId === paneId).name;
  await wait(2500);
  const agent = cmd => window.TnaiAgents.send(paneId, cmd);
  const windows = /Windows/.test(navigator.userAgent); // off Windows the panel shell is bash
  agent(
    windows
      ? "New-Item -ItemType Directory -Force deep/inner, node_modules/pkg | Out-Null; Set-Content deep/inner/needle-target.txt 'needle inside'; Set-Content node_modules/pkg/needle-skip.txt 'x'; Set-Content src/long.js -Value (1..200 | % { \"line $_\" })"
      : "mkdir -p deep/inner node_modules/pkg; echo 'needle inside' > deep/inner/needle-target.txt; echo x > node_modules/pkg/needle-skip.txt; seq -f 'line %g' 1 200 > src/long.js"
  );
  check(
    !!(await until(
      async () =>
        (await native.fs.stat('src/long.js'))?.value?.size > 1000 &&
        (await native.fs.stat('deep/inner/needle-target.txt'))?.ok
    )),
    'shell wrote the test files'
  );

  // 1. Search the whole project by name.
  const r = await native.fs.search('NEEDLE', 200),
    paths = r.value?.results.map(x => x.path) || [];
  check(
    r.ok &&
      paths.includes('deep/inner/needle-target.txt') &&
      !paths.some(p => p.startsWith('node_modules/')),
    'native search: case-insensitive, finds nested file, skips node_modules (' +
      paths.join(', ') +
      ')'
  );
  check(
    ((await native.fs.search('ndltrg', 50)).value?.results || []).some(
      x => x.name === 'needle-target.txt'
    ),
    'native search: fuzzy match on the name'
  );

  // (The rail search, the editor's reload-in-place and "Changed on disk" bar went with the File
  // repository page in the purple redesign.) TnaiFileTabs (24): the open-file tabs list/API.
  const events = [];
  const off = T.onChange(list => events.push(list));
  T.add();
  T.open('src/long.js');
  check(
    !!(await until(() => T.list().some(t => t.path === 'src/long.js' && t.active))) &&
      events.length > 0,
    'TnaiFileTabs: add + open fire onChange; list() has {id,path,active}'
  );
  off();

  // Live change cards (26) on a host attached the way a file view does.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:20px;top:20px;width:640px;z-index:9999;background:#fff';
  document.body.append(host);
  const detach = D.attach(host, 'src/long.js');
  await wait(400);
  agent(
    windows
      ? "$c = Get-Content src/long.js; Set-Content src/long.js -Value ($c[0..8] + 'new a','new b' + $c[12..199] + 'tail 1','tail 2','tail 3')"
      : 'c=$(cat src/long.js); { echo "$c" | sed -n 1,9p; printf \'new a\nnew b\n\'; echo "$c" | sed -n 13,200p; printf \'tail 1\ntail 2\ntail 3\n\'; } > src/long.js'
  );
  const card = await until(() => {
    const c = D.cards('src/long.js')[0];
    return c && c.added === 5 && c.removed === 3 ? host.querySelector('.fd-card') : null;
  });
  check(!!card, 'card counts ＋5 −3 (' + JSON.stringify(D.cards('src/long.js')) + ')');
  if (card) {
    const head = card.querySelector('header').textContent;
    check(
      /＋5/.test(head) &&
        /−3/.test(head) &&
        head.includes(name) &&
        /\(inferred\)/.test(head) &&
        /ago/.test(head),
      'card header: ' + head.replace(/[–⤢×▢↙]/g, '').trim()
    );
    const adds = [...card.querySelectorAll('.fd-line.add code')].map(e => e.textContent),
      dels = [...card.querySelectorAll('.fd-line.del code')].map(e => e.textContent);
    check(
      adds.join() === 'new a,new b,tail 1,tail 2,tail 3' &&
        dels.join() === 'line 10,line 11,line 12',
      'added lines green, removed lines red: +' + adds + ' −' + dels
    );
    console.log('TNAI_SHOT:file-diff');
    await wait(600);
    card.querySelector('[data-act=min]').click();
    const min = host.querySelector('.fd-card');
    check(min?.dataset.view === 'min' && !min.querySelector('.fd-lines'), 'minimize → header only');
    min.querySelector('header').click();
    check(host.querySelector('.fd-card')?.dataset.view === 'compact', 'click header → restored');
    host.querySelector('.fd-card [data-act=full]').click();
    check(
      host.querySelector('.fd-card')?.dataset.view === 'full' &&
        host.querySelectorAll('.fd-card .fd-line').length === 8,
      'expand → full diff'
    );
    host.querySelector('.fd-card [data-act=close]').click();
    check(!host.querySelector('.fd-card') && !D.cards('src/long.js').length, 'close → card gone');
  }

  // Settings toggle off: no cards.
  window.TnaiSettings.open('files');
  await wait(200);
  const toggle = document.querySelector('#settingsPanel-general input[data-pref=liveAiChanges]');
  check(
    !!toggle?.offsetParent && toggle.checked,
    'Settings › General toggle shown (the old section id "files" still opens it), on by default'
  );

  // General (2026-10-09: Appearance, Files and Terminal in one section): its groups sit under each
  // other with the same edges and equal gaps, and the old pages are gone.
  {
    const gs = [...document.querySelectorAll('#settingsPanel-general .set-group')].map(g =>
        g.getBoundingClientRect()
      ),
      tabs = window.TnaiSettings.tabs();
    const gaps = gs.slice(1).map((g, i) => Math.round((g.top - gs[i].bottom) * 10) / 10);

    // a wide window puts the groups in columns
    const sideBySide = gs.length > 1 && gs[1].top < gs[0].bottom;
    console.log('TNAI_SHOT:settings-general');
    await wait(500);
    check(
      gs.length >= 2 &&
        !!document.querySelector('#settingsPanel-general input[name=tnaiAccent]') &&
        !tabs.some(t => ['files', 'terminal', 'appearance'].includes(t)) &&
        tabs.includes('general') &&
        (sideBySide ||
          (gs.every(
            g => Math.abs(g.left - gs[0].left) <= 0.5 && Math.abs(g.right - gs[0].right) <= 0.5
          ) &&
            gaps.every(g => g > 0 && Math.abs(g - gaps[0]) <= 0.5))),
      'Settings › General holds the accent color and ' +
        (gs.length - 1) +
        ' more group(s); sections ' +
        tabs.join(', ') +
        '; group gaps ' +
        JSON.stringify(gaps) +
        (sideBySide ? ' (in columns)' : '')
    );
  }
  toggle.click();
  await wait(100);
  check(
    localStorage.getItem('tnai.live-ai-changes.v1') === 'off' && !D.cards('src/long.js').length,
    'toggle off persisted, cards cleared'
  );
  agent(
    windows
      ? "Add-Content src/long.js 'agent line three'"
      : "echo 'agent line three' >> src/long.js"
  );
  await wait(1500);
  check(!host.querySelector('.fd-card') && !D.cards('src/long.js').length, 'toggle off: no cards');
  window.TnaiSettings.set('liveAiChanges', true);
  check(
    toggle.checked && localStorage.getItem('tnai.live-ai-changes.v1') === 'on',
    'toggle back on'
  );
  detach();
  check(!host.querySelector('.fd-strip'), 'detach() removes the strip');
  host.remove();
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
if (paneId) {
  window.TnaiAgents.stop(paneId);
  await wait(300);
}
return { ok, log };
