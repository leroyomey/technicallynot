/*
 * Technically Not tools · desktop-check/notices-check.js — App notices for a working agent
 * (desktop/agent-notices.js) in plain Node: held notices come out together at the next tool call
 * and are not typed; one no tool call took is typed after the wait; the rest are typed when the
 * task ends; a closed panel drops them; panels stay apart. Run: node
 * tools/desktop-check/notices-check.js (~0.3 s).
 */
'use strict';
const notices = require('../../desktop/agent-notices');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const typed = [];
  const type = (pane, text) => () => {
    typed.push([pane, text]);
    return Promise.resolve();
  };

  check(notices.take('A') === '', 'nothing held: the tool call gets no note');
  notices.hold('A', 'first notice', type('A', 'first notice'), 80);
  notices.hold('A', 'second notice', type('A', 'second notice'), 80);
  notices.hold('B', 'for B', type('B', 'for B'), 80);
  const note = notices.take('A');
  check(
    /first notice/.test(note) && /second notice/.test(note) && !/for B/.test(note),
    "the next tool call gets every notice held for that panel, and no other panel's"
  );
  check(/not a new task/.test(note), 'the note says it is not a new task');
  check(notices.take('A') === '', 'a notice is handed over once');
  await sleep(160);
  check(
    typed.length === 1 && typed[0][0] === 'B',
    'a notice no tool call took is typed in after the wait; the ones handed over are never typed (typed: ' +
      JSON.stringify(typed) +
      ')'
  );
  check(notices._test.size('B') === 0, 'a typed notice is no longer held');

  typed.length = 0;
  notices.hold('A', 'at task end', type('A', 'at task end'), 5000);
  notices.flush('A');
  check(
    typed.length === 1 && notices.take('A') === '',
    'the task ended: what is still held is typed in at once, and not handed over again'
  );

  typed.length = 0;
  notices.hold('A', 'panel closes', type('A', 'panel closes'), 60);
  notices.forget('A');
  await sleep(120);
  check(
    typed.length === 0 && notices.take('A') === '',
    "a closed panel's notices are dropped, not typed"
  );

  notices.hold(
    'A',
    'bad fallback',
    () => {
      throw new Error('boom');
    },
    20
  );
  await sleep(60);
  check(notices._test.size('A') === 0, 'a fallback that throws does not keep the notice or crash');
  check(
    !notices.hold('', 'x', () => {}) && !notices.hold('A', '', () => {}),
    'no panel or no text holds nothing'
  );

  console.log(ok ? 'NOTICES CHECK PASS' : 'NOTICES CHECK FAIL');
  process.exit(ok ? 0 : 1);
})();
