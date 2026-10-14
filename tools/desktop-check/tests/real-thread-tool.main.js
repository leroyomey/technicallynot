// Technically Not tools · desktop-check/tests/real-thread-tool.main.js — main-process side of
// real-thread-tool.js: which agent tool the run is for, named in the environment so one test file
// serves Codex, OpenCode and Cursor Agent.
'use strict';
const TOOLS = ['Codex', 'OpenCode', 'Cursor Agent'];

module.exports = () => ({
  tool: () =>
    TOOLS.includes(process.env.TNAI_THREAD_TOOL) ? process.env.TNAI_THREAD_TOOL : 'Codex',
});
