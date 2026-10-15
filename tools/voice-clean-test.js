/*
 * Technically Not tools · voice-clean-test.js — Plain Node check of the speech engine's text
 * clean-up (`clean` in desktop/voice-service.js): a sentence the decoder looped comes back once,
 * with its lead-in and without the copy cut off at the end, while normal speech, a sentence said
 * twice and short repeated words stay as they were. No engine, no window.
 * Run: node tools/voice-clean-test.js (exit code 1 on a failure).
 */
'use strict';
const { clean } = require('../desktop/voice-service');

const cases = [
  // a real clip, as the engine returned it
  [
    "All right, if you're done, summarize, make notes and docs, and then close, if you're no longer needed. If you're done, summarize, make notes and docs, and then close, if you're no longer needed. If you're done, summarize, make notes and docs, and then close, if you're no longer needed. If you're done, summarize, make notes and docs, and then close, if you're no longer needed. If you're done, summarize, make notes and docs, and then close, if you're no longer needed. If you're done, summarize,",
    "All right, if you're done, summarize, make notes and docs, and then close, if you're no longer needed.",
  ],
  // three exact copies, no lead-in, nothing cut off
  ['Fix the scroll bar. Fix the scroll bar. Fix the scroll bar.', 'Fix the scroll bar.'],
  // the loop sits after other sentences, and something else follows it
  [
    'Open the settings. Then check the voice key please. Then check the voice key please. Then check the voice key please. Thanks.',
    'Open the settings. Then check the voice key please. Thanks.',
  ],
  // two copies with something after them: a person may say a sentence twice, kept
  [
    'Make it bigger, much bigger. Make it bigger, much bigger. And blue.',
    'Make it bigger, much bigger. Make it bigger, much bigger. And blue.',
  ],
  // a long sentence twice in a row, with more after it: the decoder looped once, folded
  [
    'Open the thread view and keep the report on screen until I have read it. Open the thread view and keep the report on screen until I have read it. Then run the tests.',
    'Open the thread view and keep the report on screen until I have read it. Then run the tests.',
  ],
  // a long sentence twice after a lead-in, nothing after it: one copy with its lead-in
  [
    'Okay, check every voice setting and tell me which ones still use the old model. Check every voice setting and tell me which ones still use the old model.',
    'Okay, check every voice setting and tell me which ones still use the old model.',
  ],
  // the old rule still folds a clip that is only "X. X."
  ['Run the tests again. Run the tests again.', 'Run the tests again.'],
  // short sentences repeated are left alone
  ['Yes. Yes. Yes. Do it.', 'Yes. Yes. Yes. Do it.'],
  // normal speech, version numbers included, is unchanged
  [
    'Ship 0.3.72 when the tests pass. Then tell me what changed.',
    'Ship 0.3.72 when the tests pass. Then tell me what changed.',
  ],
  // the stock phrase for near-silence still comes back empty
  ['Thanks for watching!', ''],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = clean(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + JSON.stringify(input.slice(0, 60)));
  if (!ok)
    console.log(
      '     expected ' + JSON.stringify(expected) + '\n     got      ' + JSON.stringify(got)
    );
}
console.log(failed ? failed + ' of ' + cases.length + ' failed' : cases.length + ' passed');
process.exitCode = failed ? 1 : 0;
