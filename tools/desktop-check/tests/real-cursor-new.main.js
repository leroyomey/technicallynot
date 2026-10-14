/*
 * Technically Not tools · desktop-check/tests/real-cursor-new.main.js — Main-process side of
 * real-cursor-new: what prompt-submit.js did with the last prompt it put into a pane (how many
 * Enters, what stopped the retries, the last thing counted as typed).
 */
'use strict';
module.exports = () => {
  const submit = require('../../../desktop/prompt-submit'); // the same module instance main.js uses
  return { did: paneId => submit.did(paneId) };
};
