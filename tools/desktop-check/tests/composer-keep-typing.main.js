/*
 * Technically Not tools · desktop-check/tests/composer-keep-typing.main.js — Main-process side of
 * composer-keep-typing.js: the fake claude CLI from agent-mesh.main.js (never the real one, no
 * credits).
 */
'use strict';
module.exports = (win, profile) => require('./agent-mesh.main.js')(win, profile);
