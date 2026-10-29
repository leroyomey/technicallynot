/*
 * Technically Not tools · desktop-check/install-info-check.js — Checks what Usage & accounts offers
 * for a CLI that is not installed (agent-registry.js `installInfo`): every registered CLI has a way
 * in, npm ones need Node.js, the commands are the providers' own, and reading the PATH fresh never
 * drops or reorders a folder this run already had. Reads only; installs nothing. Run: node
 * tools/desktop-check/install-info-check.js
 */
'use strict';
const agents = require('../../desktop/agent-registry');
let failed = 0;
const check = (ok, text) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + text);
  if (!ok) failed++;
};

(async () => {
  // A stand-in for the user's folders: pnpm's and scoop's exist, Volta's and bun's do not. Only the
  // two that exist may be added, at the end.
  const fs = require('fs'),
    os = require('os'),
    path = require('path'),
    win32 = process.platform === 'win32';
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-install-info-')),
    pnpm = path.join(fake, 'local', 'pnpm'),
    scoop = path.join(fake, 'home', 'scoop', 'shims');
  fs.mkdirSync(pnpm, { recursive: true });
  fs.mkdirSync(scoop, { recursive: true });
  Object.assign(process.env, {
    APPDATA: path.join(fake, 'roaming'),
    LOCALAPPDATA: path.join(fake, 'local'),
    USERPROFILE: path.join(fake, 'home'),
  });
  const before = String(process.env.PATH || '').split(';');
  const info = await agents.installInfo();
  const after = String(process.env.PATH || '').split(';');
  check(
    before.every((dir, i) => after[i] === dir),
    'the PATH this run had is kept in place (' +
      before.length +
      ' folders, ' +
      (after.length - before.length) +
      ' added)'
  );
  const added = after.slice(before.length);
  check(
    !win32 || (added.includes(pnpm) && added.includes(scoop)),
    'tool folders that exist are added behind it (pnpm, scoop)'
  );

  // (The user's saved PATH may hold %USERPROFILE%-style entries, which expand to the stand-in here:
  // only the four tool folders are judged.)
  const missing = [
    path.join(fake, 'roaming', 'npm'),
    path.join(fake, 'local', 'Volta', 'bin'),
    path.join(fake, 'home', '.bun', 'bin'),
    path.join(fake, 'home', '.local', 'bin'),
  ];
  check(
    !added.some(dir => missing.includes(dir)),
    'tool folders that do not exist are not added (npm, Volta, bun, .local)'
  );
  await agents.installInfo();
  check(
    String(process.env.PATH || '').split(';').length === after.length,
    'a second read adds nothing twice'
  );
  try {
    fs.rmSync(fake, { recursive: true, force: true });
  } catch {}
  check(
    typeof info.node === 'boolean' && /^https:\/\/nodejs\.org\//.test(info.nodePage),
    'Node.js: found = ' + info.node + ', page ' + info.nodePage
  );
  const win = process.platform === 'win32';
  check(
    !win || /^winget install OpenJS\.NodeJS\.LTS;/.test(info.nodeCommand),
    'Node.js command on Windows: ' + (info.nodeCommand || '(none)')
  );
  for (const id of agents.ids()) {
    const how = info.tools[id];
    if (!how) {
      check(false, id + ' has no row in INSTALL');
      continue;
    }

    // A tool with no one-line installer (Mistral Vibe: uv, then `uv tool install`) has its page
    // only, and the tile offers no Install button.
    const fine = how.needsNode
      ? /^npm install -g (@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(how.command)
      : !win ||
        /^irm ('?)https:\/\/[^ ']+\1 \| iex$/.test(how.command) ||
        (!how.command && /^https:\/\//.test(how.page));
    check(
      fine && (!how.page || /^https:\/\//.test(how.page)),
      id + ': ' + (how.command || '(page only)') + (how.needsNode ? '  [needs Node.js]' : '')
    );
  }
  const release = Object.fromEntries(agents.releases().map(r => [r.id, r.npm]));
  check(
    Object.entries(info.tools).every(
      ([id, how]) => !how.needsNode || how.command === 'npm install -g ' + release[id]
    ),
    'an npm install names the same package the update bell watches'
  );
  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
})();
