/*
 * Technically Not desktop · cli-updates.js — Newer versions of the installed agent CLIs: compares
 * each CLI's `--version` with the latest release on the npm registry
 * (registry.npmjs.org/<package>/latest), 90 s after start and every 6 h; results kept in memory and
 * pushed as `cli-updates:state` (the bell shows them, 60). The bell's Update runs the command in a
 * Terminal panel (60-bell-notices.js). Only CLIs with an `npm` package and `update` command in
 * agent-registry.js RELEASES are checked; Cursor Agent has no npm version Technically Not can read.
 */
'use strict';
const agents = require('./agent-registry');

// the developer self-test switch, never on in a release build; `release` makes the build ignore
// the test registry variable below
const { selfTest, release } = require('./build-info');

// id → npm package, and the CLI's own update command (run in a visible Terminal panel when the user
// presses Update): every CLI with an `npm` package in agent-registry.js RELEASES, so a new CLI is
// added there once.
const CLIS = agents
  .releases()
  .filter(r => r.npm && r.update)
  .map(r => ({ id: r.id, pkg: r.npm, cmd: r.update }));
const FIRST = 90 * 1000,
  EVERY = 6 * 60 * 60 * 1000; // a registry can't push to this PC, so Technically Not asks rarely
const REGISTRY = (!release && process.env.TNAI_NPM_REGISTRY) || 'https://registry.npmjs.org/';

const semver = text =>
  (String(text || '').match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1, 4).map(Number);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
};

let state = { checkedAt: 0, updates: [] },
  send = () => {},
  timer = null,
  running = null;

async function latest(pkg) {
  const res = await fetch(REGISTRY + pkg.replace('/', '%2f') + '/latest', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('npm registry answered ' + res.status);
  return String((await res.json()).version || '');
}

async function checkOne(cli) {
  const installed = semver(await agents.version(cli.id).catch(() => ''));
  if (installed.length !== 3) return null; // not installed, or no readable version
  const next = await latest(cli.pkg).catch(() => '');
  const want = semver(next);
  return want.length === 3 && newer(want, installed)
    ? { id: cli.id, installed: installed.join('.'), latest: want.join('.'), command: cli.cmd }
    : null;
}

function check() {
  running ||= Promise.all(CLIS.map(checkOne))
    .then(list => {
      state = { checkedAt: Date.now(), updates: list.filter(Boolean) };
      send(state);
      return state;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

function init(push) {
  send = push;

  // tests never reach the real registry
  if (selfTest && !process.env.TNAI_NPM_REGISTRY) return;
  timer = setTimeout(function tick() {
    check().catch(() => {});
    timer = setTimeout(tick, EVERY);
  }, FIRST);
  timer.unref?.();
}

module.exports = {
  init,
  check,
  state: () => state,
  stop: () => clearTimeout(timer),
  _newer: newer,
  _semver: semver,
};
