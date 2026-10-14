// Technically Not tools · desktop-check/tests/own-terminal-marks.js — the command marks of the
// user's own terminal (136; the shell is told to send them by agent-registry.js, as a start
// argument, with no change to the user's profile). Checked: nothing of the marks or of what
// sets them up is printed in the terminal; a command that works gets a quiet dot at the right
// end of its row; a program that ends with code 3 gets a dot in the error color whose tip names
// the code; a command that fails with no code of its own says "failed" and does not repeat the
// old code; an empty Enter adds no dot; the saved command history of the shell holds none of the
// set-up lines. Picture: own-terminal-marks-dots. Returns {ok, log}.
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
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const own = () => window.TnaiOwnTerminal;
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const dots = () => [...document.querySelectorAll('.tnt-ownterm-host .tnt-ownterm-mark')];
const failed = () => dots().filter(dot => dot.classList.contains('tnt-ownterm-mark-failed'));
let ownId = '';

try {
  await until(() => threads?.visible());
  window.TnaiThreadSide.open('terminal');
  ownId = (await until(() => own().paneId(), 15000)) || '';
  await until(() => session(ownId)?.running, 20000);
  const term = await until(() => own().term(), 10000);
  await until(() => textOf(term).trim().length > 0, 30000);
  await wait(2500);
  check(
    !/133;|__tnai|EncodedCommand|function global:prompt/.test(textOf(term)),
    'nothing of the marks or of what sets them up is printed in the terminal'
  );
  check(dots().length === 0, 'before any command there is no dot');

  // ---- a command that works ----
  term.input("Write-Host ('mark' + '-one')\r", true);
  await until(() => textOf(term).includes('mark-one'), 15000);
  const first = await until(() => (dots().length === 1 ? dots()[0] : null), 8000);
  check(
    !!first && !failed().length && first.title === 'This command ended well',
    'a command that works gets one quiet dot (tip: "' + (first?.title || 'no dot') + '")'
  );
  const hostBox = document.querySelector('.tnt-ownterm-host').getBoundingClientRect();
  const dotBox = first?.getBoundingClientRect();
  check(
    !!dotBox && dotBox.right <= hostBox.right + 1 && dotBox.right > hostBox.right - 40,
    'it stands at the right end of the row, inside the terminal (' +
      Math.round(hostBox.right - (dotBox?.right || 0)) +
      ' px from its edge)'
  );

  // ---- a program that ends with a code ----
  term.input('cmd /c exit 3\r', true);
  const bad = await until(() => (failed().length === 1 ? failed()[0] : null), 15000);
  check(
    !!bad && bad.title === 'This command failed (exit code 3)',
    'a program that ends with code 3 gets a dot in the error color (tip: "' +
      (bad?.title || 'no dot') +
      '")'
  );
  const quiet = getComputedStyle(first, '::after').backgroundColor;
  const loud = bad ? getComputedStyle(bad, '::after').backgroundColor : '';
  check(!!loud && loud !== quiet, 'the two dots differ in color (' + quiet + ' and ' + loud + ')');

  // ---- the same code a second time is named again ----
  term.input('cmd /c exit 3\r', true);
  await until(() => failed().length === 2, 15000);
  const again = failed().find(dot => dot !== bad);
  check(
    !!again && again.title === 'This command failed (exit code 3)',
    'a program that ends with the same code again has its code named again (tip: "' +
      (again?.title || 'no dot') +
      '")'
  );

  // ---- a failure with no code of its own ----
  term.input('Get-Item C:\\no-such-file-for-this-test\r', true);
  await until(() => failed().length === 3, 15000);
  const plainFail = failed().find(dot => dot !== bad && dot !== again);
  check(
    !!plainFail && plainFail.title === 'This command failed',
    'a command that fails with no code of its own says so and does not repeat the old code (tip: "' +
      (plainFail?.title || 'no dot') +
      '")'
  );

  // ---- an empty Enter ----
  const before = dots().length;
  term.input('\r', true);
  await wait(1500);
  check(dots().length === before, 'an empty Enter adds no dot (' + before + ' dots)');
  console.log('TNAI_SHOT:own-terminal-marks-dots');
  await wait(700);
  window.TnaiTheme.set('light');
  await wait(600);

  // ---- in Light the shell's plain output can be read ----
  // Measured, because a picture of a covered window can show a fade half done. The row of
  // "mark-one" is plain output in the terminal's own text color.
  const light = value => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  const brightness = color => {
    const [red, green, blue] = (color.match(/[\d.]+/g) || []).map(Number);
    return 0.2126 * light(red) + 0.7152 * light(green) + 0.0722 * light(blue);
  };
  const contrast = (one, two) => {
    const [low, high] = [brightness(one), brightness(two)].sort((a, b) => a - b);
    return (high + 0.05) / (low + 0.05);
  };
  const ground = () => {
    const probe = document.createElement('i');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--tnt-island');
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  };
  const outputRow = () =>
    [...document.querySelectorAll('.tnt-ownterm-host .xterm-rows > div')].find(
      row => row.textContent.trim() === 'mark-one'
    );
  const rowColor = () => {
    const row = outputRow();
    return row ? getComputedStyle(row.querySelector('span') || row).color : '';
  };
  const readable = await until(() => rowColor() && contrast(rowColor(), ground()) >= 4.5, 6000);
  check(
    !!readable,
    'in Light the shell’s plain output reads at 4.5 to 1 or more on the island (' +
      rowColor() +
      ' on ' +
      ground() +
      ', ' +
      (rowColor() ? contrast(rowColor(), ground()).toFixed(1) : 'no row') +
      ' to 1)'
  );
  console.log('TNAI_SHOT:own-terminal-marks-light');
  await wait(700);
  window.TnaiTheme.set('dark');
  await wait(300);

  // ---- the shell's own history ----
  term.input(
    "$h = @(Get-History | Where-Object CommandLine -match ('__tn' + 'ai')).Count; Write-Host ('hist' + '=' + $h)\r",
    true
  );
  const counted = await until(() => (textOf(term).match(/hist=(\d+)/) || [])[1], 15000);
  check(
    counted === '0',
    'the shell’s history holds none of the set-up lines (' + counted + ' found)'
  );

  // what the arrow-up key recalls is the saved history of typed lines
  term.input(
    "$s = @(Get-Content (Get-PSReadLineOption).HistorySavePath -Tail 200 | Where-Object { $_ -match ('__tn' + 'aiSeen') }).Count; Write-Host ('saved' + '=' + $s)\r",
    true
  );
  const saved = await until(() => (textOf(term).match(/saved=(\d+)/) || [])[1], 15000);
  check(
    saved === '0',
    'and the saved history of typed lines holds none either (' + saved + ' found)'
  );

  // The row's folder follows the shell: PowerShell says where it stands with every prompt.
  {
    const own = window.TnaiOwnTerminal;
    const folderEl = () => document.querySelector('.tnt-ownterm-folder');
    const slashes = text => String(text || '').replace(/\\/g, '/');
    const started = slashes(own.session()?.cwd);
    check(
      !!(await until(() => slashes(own.folder()).toLowerCase() === started.toLowerCase(), 8000)) &&
        /^This shell is in /.test(folderEl()?.title || ''),
      'the shell says where it stands, and the row’s tip names it (' +
        own.folder() +
        ' | ' +
        folderEl()?.title +
        ')'
    );
    term.input('cd src\r', true);
    check(
      !!(await until(
        () =>
          /\/src$/.test(slashes(own.folder())) &&
          /\/src$/.test(slashes(folderEl()?.textContent)) &&
          /^This shell is in .*src$/.test(folderEl()?.title || ''),
        10000
      )),
      'after "cd src" the row names the new folder (' +
        folderEl()?.textContent +
        ' | ' +
        folderEl()?.title +
        ')'
    );
    term.input('cd ..\r', true);
    check(
      !!(await until(() => slashes(own.folder()).toLowerCase() === started.toLowerCase(), 10000)) &&
        !/src$/.test(folderEl()?.textContent || ''),
      'and after "cd .." it is back at the project’s folder (' + folderEl()?.textContent + ')'
    );
    check(
      !/133;|Cwd=/.test(textOf(term)),
      'nothing of the folder’s mark is drawn in the terminal as text'
    );
  }
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
if (ownId) await agents.stop(ownId).catch(() => {});
await wait(2500);
return { ok, log };
