/*
 * Technically Not tools · desktop-check/tests/cli-screen-rules.js — (1) A full-width `────` rule
 * (Claude Code's input box) drawn at 120 columns and resized to 80 stays one row, cut to 80,
 * instead of reflowing onto a second row (restored stopped panels never redraw, and old input boxes
 * in the scrollback kept doubling). (2) One text size everywhere: a following view (10
 * ptySize.followFont) never grows past it in a big box and only shrinks when the program can't fit,
 * and small boxes get the same size. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;left:0;top:0;width:1100px;height:700px;z-index:9999;background:#fff';
document.body.append(box);
try {
  const { term, fit } = await window.TnaiAgents.createTerm();
  term.open(box);
  term.resize(120, 30);
  await wait(100);
  const rule = '─'.repeat(120);
  await new Promise(r =>
    term.write(['before', rule, '> type here', rule, '  ? for shortcuts', ''].join('\r\n'), r)
  );
  const rows = () => {
    const b = term.buffer.active,
      out = [];
    for (let i = 0; i < b.length; i++)
      out.push({ t: b.getLine(i).translateToString(true), w: b.getLine(i).isWrapped });
    return out;
  };
  const at120 = rows(),
    inputRow = at120.find(r => r.t.startsWith('> type here'));
  check(
    inputRow && !inputRow.w,
    'at 120 columns the input row under a full-width rule is its own line'
  );
  term.resize(80, 30);
  await wait(150);
  const at80 = rows().filter(r => r.t.trim()),
    ruleRows = at80.filter(r => /^─+$/.test(r.t));
  const shape = at80.map(r => (/^─+$/.test(r.t) ? 'RULE(' + r.t.length + ')' : r.t.slice(0, 12)));
  check(
    ruleRows.length === 2 && ruleRows.every(r => r.t.length === 80),
    'after a resize to 80 columns each rule is still one row, cut to 80: ' + JSON.stringify(shape)
  );
  check(
    JSON.stringify(shape) ===
      JSON.stringify(['before', 'RULE(80)', '> type here', 'RULE(80)', '  ? for shor']),
    'the input box keeps its shape: rule, input row, rule, footer'
  );
  term.resize(120, 30);
  await wait(150);
  check(
    rows().filter(r => /^─+$/.test(r.t)).length === 2,
    'made wider again, still two rule rows (not re-joined)'
  );
  term.dispose();

  // Following view: the program is 80×20, the box fits far more at the base size, so the text grows
  // (at most 1.5×) and still fits.
  const follow = window.TnaiAgents.ptySize?.followFont;
  check(typeof follow === 'function', 'ptySize.followFont is available');
  if (follow) {
    const { term: t2, fit: f2 } = await window.TnaiAgents.createTerm();
    t2.open(box);
    f2.fit();
    await wait(100);
    const base = t2.options.fontSize;
    follow(t2, f2, 0, 80, 20);
    await wait(50);
    const d = f2.proposeDimensions();
    check(
      t2.options.fontSize === base,
      'a big box keeps the one text size, no grow (' + base + ' → ' + t2.options.fontSize + ' px)'
    );
    check(d && d.cols >= 80 && d.rows >= 20, '80×20 fits (' + d?.cols + '×' + d?.rows + ')');
    const small = document.createElement('div');
    small.style.cssText = 'width:300px;height:150px';
    box.append(small);
    check(
      window.TnaiAgents.compactFontFor(small) === base,
      'small boxes get the same text size as big ones (' +
        window.TnaiAgents.compactFontFor(small) +
        ' px)'
    );
    small.remove();
    box.style.width = '420px';
    box.style.height = '220px';
    await wait(100);
    follow(t2, f2, 0, 80, 20);
    await wait(50);
    const d2 = f2.proposeDimensions();
    check(
      t2.options.fontSize < base && d2.cols >= 80 && d2.rows >= 20,
      'a small box still shrinks the text until 80×20 fits (' +
        t2.options.fontSize +
        ' px, ' +
        d2.cols +
        '×' +
        d2.rows +
        ')'
    );
    t2.dispose();
  }
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
box.remove();
return { ok, log };
