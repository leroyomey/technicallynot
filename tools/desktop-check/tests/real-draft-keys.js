/*
 * Technically Not tools · desktop-check/tests/real-draft-keys.js — Which keys make the unsent text
 * Technically Not counts from the keys (attention-service.js draftKeys) differ from what a REAL
 * Claude Code shows in its input (the fault: "Prompt held" for an agent whose input
 * was empty). One Claude Code on Haiku; no prompt is ever sent, so it uses no model usage. For each
 * case: keys go in the way the terminal sends them, then the input row on the CLI's screen (non-dim
 * text after the prompt marker) is compared with the counted draft. A case fails when the count
 * says "text" and the screen says "empty" (a phantom) or the other way round (a message could be
 * typed into real text).
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const G = window.TnaiAgents,
  N = window.tnaiNative;

// The panel's own terminal is the screen (a replay of saved output into a scratch terminal drew
// Claude Code's input box wrong in the first run: its redraws are relative to where the cursor
// was). dispose is a no-op here: the view stays.
async function vtOf(paneId) {
  const term = G.views().find(v => v.paneId === paneId && v.where === 'Terminal page panel')?.term;
  if (!term) return null;
  await new Promise(done => term.write('', done)); // everything received so far is parsed
  return { buffer: term.buffer, rows: term.rows, cols: term.cols, dispose() {} };
}

async function screen(paneId) {
  const vt = await vtOf(paneId);
  if (!vt) return '';
  const b = vt.buffer.active,
    rows = [];
  for (let y = 0; y < vt.rows; y++)
    rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
  vt.dispose();
  return rows.join('\n');
}

// What the input holds on screen: the non-dim text of the rows between the two rule lines around
// the prompt marker, or null when no input box shows.
async function input(paneId) {
  const vt = await vtOf(paneId);
  if (!vt) return null;
  const b = vt.buffer.active,
    text = y =>
      b
        .getLine(b.baseY + y)
        ?.translateToString(true)
        .trim() ?? '',
    rule = s => /^[─━]{8,}/.test(s);
  let out = null;
  for (let y = vt.rows - 1; y > 0 && out === null; y--) {
    if (!rule(text(y))) continue;
    let top = y - 1;
    while (top > 0 && !rule(text(top))) top--;
    if (top <= 0 || y - top < 2 || y - top > 12) continue;
    out = '';
    for (let r = top + 1; r < y; r++) {
      const line = b.getLine(b.baseY + r);
      for (let x = 0; x < vt.cols; x++) {
        const c = line.getCell(x);
        if (c && !c.isDim()) out += c.getChars() || ' ';
      }
      out += '\n';
    }
  }
  vt.dispose();
  return out === null ? null : out.replace(/^\s*[❯>!#]\s?/, '').trim();
}
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
let idleSince = 0;
const ready = (paneId, idle) => (
  (idleSince = 0),
  until(async () => {
    const ask = (await N.trust?.pending?.())?.find(a => !a.paneId || a.paneId === paneId);
    if (ask) {
      await N.trust.answer(ask.id, true);
      return false;
    }
    const text = await screen(paneId),
      rows = text.split('\n');
    if (
      /trust the files in this folder|project you created or one you trust|trust the contents of this directory|Trust this folder\?/i.test(
        text.replace(/\s+/g, ' ')
      )
    ) {
      const sel = rows.find(r => /^\s*[❯›]/.test(r)) || '';
      N.pty.write(paneId, /Yes|Trust and continue/i.test(sel) ? '\r' : '\x1b[B');
      await wait(1200);
      return false;
    }
    if (
      !idle.test(text) ||
      /esc to interrupt|enter to confirm|enter continue|esc skip/i.test(text)
    ) {
      idleSince = 0;
      return false;
    }
    idleSince = idleSince || Date.now();
    return Date.now() - idleSince > 2500;
  }, 60000)
);
const key = async (paneId, data, ms = 500) => {
  N.pty.write(paneId, data);
  await wait(ms);
};
let C = '';
try {
  window.TnaiLaunchPrefs?.once('Claude Code', { model: 'claude-haiku-4-5-20251001' });
  C = (await window.TnaiTest.open('Claude Code')).paneId;
  if (!(await until(() => G.sessions().find(s => s.paneId === C && s.running), 20000)))
    throw new Error('Claude Code did not start');
  if (
    !(await ready(
      C,
      /\? for shortcuts|shift\+tab to cycle|manual mode on|bypass permissions|accept edits|auto mode/i
    ))
  )
    throw new Error('Claude Code not ready: ' + (await screen(C)).slice(-400));
  log.push('ok   Claude Code ready, input reads ' + JSON.stringify(await input(C)));

  // Back to an empty input the CLI and the count agree on: Esc Esc (both clear), then long enough
  // that the next Esc is not its pair. A first Esc closes whatever menu the last case left open;
  // Ctrl+U takes text that is still there (Ctrl+C on an empty input would arm "exit"). Never Esc
  // Esc here: on an empty input it opens Rewind (seen in the first runs). The count is put back by
  // the app's own "input is empty" call.
  const reset = async () => {
    await key(C, '\x1b', 1300);
    for (let i = 0; i < 6 && (await input(C)) !== ''; i++) {
      await key(C, (await input(C)) === null ? '\x1b' : '\x15', 1300);
    }
    await wait(1700);
    await main('clear', C);
  };
  const rowsNow = async () =>
    (await screen(C))
      .split('\n')
      .map(l => l.trimEnd())
      .filter(Boolean)
      .slice(-7)
      .join(' ⏎ ')
      .slice(-420);
  const cases = [
    [
      'plain text (control: both say text)',
      async () => {
        await key(C, 'alpha beta');
      },
    ],
    [
      'Backspace over all of it (control: both empty)',
      async () => {
        await key(C, 'abc');
        await key(C, '\x7f\x7f\x7f');
      },
    ],
    [
      'Ctrl+Backspace x3 on three words (xterm sends \\b)',
      async () => {
        await key(C, 'one two three');
        await key(C, '\b', 300);
        await key(C, '\b', 300);
        await key(C, '\b', 300);
      },
    ],
    [
      'Ctrl+Backspace once on three words',
      async () => {
        await key(C, 'one two three');
        await key(C, '\b');
      },
    ],
    [
      'Esc, 1 s, Esc on text (slow double Esc)',
      async () => {
        await key(C, 'slow esc');
        await key(C, '\x1b', 1000);
        await key(C, '\x1b', 900);
      },
    ],
    [
      'Esc, 2 s, Esc on text',
      async () => {
        await key(C, 'two sec');
        await key(C, '\x1b', 2000);
        await key(C, '\x1b', 900);
      },
    ],
    [
      'Esc, 4 s, Esc on text',
      async () => {
        await key(C, 'four sec');
        await key(C, '\x1b', 4000);
        await key(C, '\x1b', 900);
      },
    ],
    [
      'Esc, a letter, Esc on text',
      async () => {
        await key(C, 'esc x esc');
        await key(C, '\x1b', 300);
        await key(C, 'x', 300);
        await key(C, '\x1b', 900);
      },
    ],
    [
      '"?" then a letter then Backspace',
      async () => {
        await key(C, '?', 700);
        await key(C, 'a', 500);
        await key(C, '\x7f', 700);
      },
    ],
    [
      'Ctrl+R, two letters, one Esc',
      async () => {
        await key(C, '\x12', 800);
        await key(C, 'zq', 600);
        await key(C, '\x1b', 1300);
      },
    ],
    [
      'Esc, 0.5 s, Esc on text',
      async () => {
        await key(C, 'half esc');
        await key(C, '\x1b', 500);
        await key(C, '\x1b', 900);
      },
    ],
    [
      'one Esc on text',
      async () => {
        await key(C, 'one esc');
        await key(C, '\x1b', 1300);
      },
    ],
    [
      'Ctrl+R then one Esc on an empty input',
      async () => {
        await key(C, '\x12', 800);
        await key(C, '\x1b', 1300);
      },
    ],
    [
      '"?" on an empty input (shortcuts)',
      async () => {
        await key(C, '?', 900);
      },
    ],
    [
      '"?" then Backspace',
      async () => {
        await key(C, '?', 700);
        await key(C, '\x7f', 700);
      },
    ],
    [
      '"/" then one Esc',
      async () => {
        await key(C, '/', 800);
        await key(C, '\x1b', 1300);
      },
    ],
    [
      '"!" then Backspace (bash mode and out)',
      async () => {
        await key(C, '!', 700);
        await key(C, '\x7f', 700);
      },
    ],
    [
      '"#" then Backspace',
      async () => {
        await key(C, '#', 700);
        await key(C, '\x7f', 700);
      },
    ],
    [
      '"@" then one Esc (file picker)',
      async () => {
        await key(C, '@', 900);
        await key(C, '\x1b', 1300);
      },
    ],
    // Known, not fixed: Home, End, Delete and the arrows are sent alone as escape codes, which
    // main.js does not pass to the count (pty:write).
    [
      'Home then Delete x3 on "abc"',
      async () => {
        await key(C, 'abc');
        await key(C, '\x1b[H', 300);
        await key(C, '\x1b[3~\x1b[3~\x1b[3~');
      },
      true,
    ],
    [
      'Ctrl+A then Ctrl+K on text',
      async () => {
        await key(C, 'kill line');
        await key(C, '\x01', 300);
        await key(C, '\x0b');
      },
    ],
    [
      'Ctrl+C on text',
      async () => {
        await key(C, 'ctrl c');
        await key(C, '\x03', 900);
      },
    ],
    [
      'Ctrl+Z on text',
      async () => {
        await key(C, 'ctrl z');
        await key(C, '\x1a', 900);
      },
    ],
    [
      'Ctrl+L on text',
      async () => {
        await key(C, 'ctrl l');
        await key(C, '\x0c', 900);
      },
    ],
    [
      'Ctrl+D on text',
      async () => {
        await key(C, 'ctrl d');
        await key(C, '\x04', 900);
      },
    ],
    [
      'Alt+Backspace x2 on two words',
      async () => {
        await key(C, 'two words');
        await key(C, '\x1b\x7f', 300);
        await key(C, '\x1b\x7f');
      },
    ],
    [
      'Ctrl+W x2 on two words',
      async () => {
        await key(C, 'two words');
        await key(C, '\x17', 300);
        await key(C, '\x17');
      },
    ],
    [
      'Shift+Tab (mode switch) on an empty input',
      async () => {
        await key(C, '\x1b[Z', 900);
      },
    ],
    [
      'Tab on an empty input',
      async () => {
        await key(C, '\t', 900);
      },
    ],
    [
      '"/he" then Tab then Backspace x3',
      async () => {
        await key(C, '/he', 700);
        await key(C, '\t', 700);
        await key(C, '\x7f\x7f\x7f', 700);
      },
    ],
    [
      'text, backslash, Enter (a new line, nothing sent)',
      async () => {
        await key(C, 'line one\\', 300);
        await key(C, '\r', 900);
      },
    ],
  ];
  for (const [name, run, known] of cases) {
    if (!G.sessions().find(s => s.paneId === C && s.running)) {
      ok = false;
      log.push('FAIL the CLI stopped before: ' + name);
      break;
    }
    await reset();
    const clean = await input(C),
      cleanDraft = await main('draft', C);
    await run();
    const shown = await input(C),
      counted = await main('draft', C);
    const real = shown === null ? null : shown.length > 0;
    const verdict =
      real === null
        ? 'no input box on screen'
        : real === counted
          ? 'agree'
          : counted
            ? 'PHANTOM: counted text, input empty'
            : 'MISSED: input has text, count empty';
    if (real !== null && real !== counted && !known) ok = false;
    log.push(
      (real === null || real === counted ? 'ok   ' : known ? 'known ' : 'FAIL ') +
        name +
        ' → ' +
        verdict +
        ' · screen ' +
        JSON.stringify(shown) +
        ' · counted ' +
        counted +
        (clean || cleanDraft
          ? ' · (before: screen ' + JSON.stringify(clean) + ', counted ' + cleanDraft + ')'
          : '')
    );
    if (real === null || real !== counted) log.push('       screen: ' + (await rowsNow()));
  }
} catch (error) {
  ok = false;
  log.push('FAIL error: ' + (error.stack || error.message));
}
if (C)
  try {
    G.stop(C);
  } catch {}
await wait(2500);
return { ok, log };
