// Technically Not tools · desktop-check/tests/agent-mesh-three.main.js — Main-process side of the
// agent-mesh-three test: the same fake `claude` / `codex` CLIs and PATH as agent-mesh.main.js (one
// copy of the stand-ins, in that file), set up fresh for this test's own app run.
'use strict';

module.exports = require('./agent-mesh.main');
