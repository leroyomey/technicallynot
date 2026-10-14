/*
 * Technically Not · tools/desktop-check/voice-hints-check.js — plain Node check of the voice word
 * hints (desktop/voice-service.js): the prompt Whisper gets, and the guard against plain speech
 * written as a made-up file name (the fault: "no bloated fake numbers" came back as
 * "node_bloated_fake_numbers.node_bloated_fake_numbers."). No engine, no microphone. Run: node
 * tools/desktop-check/voice-hints-check.js
 */
'use strict';
const { buildPrompt, inventedName } = require('../../desktop/voice-service');

let failed = 0;
const check = (name, ok) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) failed++;
};
const HINTS = [
  'Bench',
  'node_modules',
  'RELEASE_QUEUE.md',
  'RELEASE_QUEUE',
  'voice-service.js',
  'voice-service',
];

check(
  'the reported text is caught',
  inventedName('node_bloated_fake_numbers.node_bloated_fake_numbers.', HINTS)
);
check(
  'one made-up name inside a sentence is caught',
  inventedName('Please make sure there are no bloated fake_numbers on the page.', HINTS)
);
check('plain speech is left alone', !inventedName('No bloated fake numbers.', HINTS));
check(
  'a hinted file name is left alone',
  !inventedName('Open RELEASE_QUEUE.md, then node_modules.', HINTS)
);
check(
  'a hinted name is matched without its case',
  !inventedName('Add it to release_queue.', HINTS)
);
check(
  'hyphens, dots and numbers alone are not names',
  !inventedName('Open voice-service.js at version 0.3.61, e.g. side-by-side.', HINTS)
);
check('an underscore name with no hints at all is caught', inventedName('fake_numbers', []));
check('empty text is fine', !inventedName('', HINTS) && !inventedName(null, null));
check(
  'the prompt still carries the hints',
  buildPrompt(HINTS).endsWith('voice-service.js, voice-service.') &&
    buildPrompt(HINTS).startsWith('Technically Not,')
);

console.log(failed ? failed + ' check(s) failed' : 'voice-hints-check: all passed');
process.exit(failed ? 1 : 0);
