/*
 * Technically Not tools · desktop-check/tests/real-first-char.main.js — Main-process side of
 * real-first-char: the app's own submit with paste on (prompt-submit.js, the same module instance
 * main.js uses), what it did, which CLI this run is for, and a free OpenCode model.
 */
'use strict';
module.exports = () => {
  const submit = require('../../../desktop/prompt-submit'),
    registry = require('../../../desktop/agent-registry');
  const FREE = /^opencode\/(big-pickle|.*-free)$/;
  return {
    which: () => String(process.env.TNAI_PROBE_CLI || ''),
    submit: (paneId, text) => submit.submit(String(paneId), String(text), { paste: true }),
    did: paneId => submit.did(paneId),
    async pick() {
      const cat = await registry.models('OpenCode').catch(() => null),
        ids = (cat?.models || []).map(m => m.id);
      return ids.find(i => i === 'opencode/big-pickle') || ids.find(i => FREE.test(i)) || '';
    },
  };
};
