/*
 * Technically Not tools · desktop-check/preview-route-check.js — `tnai preview URL [device]` end to
 * end in plain Node: the real tnai shim (desktop/agent-shim.js) talks to the real agent mesh
 * (desktop/agent-mesh.js, fake terminal list), which checks the address, that a server answers,
 * picks the device view from package.json, and pushes `preview:show` to a stub renderer that
 * answers like 31 does. No CLI, agent or window runs. Usage: node
 * tools/desktop-check/preview-route-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-preview-route-'));
const userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project'),
  sub = path.join(project, 'apps', 'web'),
  outside = path.join(tmp, 'outside');

// a stood-in agent worktree of the project
const laneDir = path.join(userData, 'worktrees', 'abc', 'terminal-1a2b3c');
[userData, sub, outside, laneDir].forEach(d => fs.mkdirSync(d, { recursive: true }));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => userData } } : load(req, ...rest);
const mesh = require('../../desktop/agent-mesh');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const pkg = (dir, deps) =>
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', dependencies: deps })
  );
const SHIM = path.join(__dirname, '..', '..', 'desktop', 'agent-shim.js');

(async () => {
  const shown = [],
    shots = [];
  let answer = { ok: true, where: 'the Live preview page was opened for the user' };

  // Stub renderer: records each push and answers like 31's showRequest.
  mesh.init(
    (channel, payload) => {
      if (channel === 'preview:show') {
        shown.push(payload);
        setImmediate(() => mesh.previewShown(payload.id, answer));
      }
    },
    {
      ptys: { list: () => [], replay: () => null },
      projects: async () => [project],
      hooks: { note() {} },
      worktrees: {
        known: dir => path.resolve(dir).toLowerCase() === laneDir.toLowerCase(),
        forPane: id =>
          id === 'pane-lane' ? { cwd: laneDir, branch: 'tnai/terminal-1a2b3c' } : null,
      },
      shot: {
        take: async o => {
          shots.push(o);
          return {
            file: path.join(userData, 'attachments', 'shots', 'shot-test.png'),
            width: o.width,
            height: o.height,
            loading: false,
          };
        },
      },
    }
  );
  const addEnv = await mesh.prepare('pane-1', project, project);
  const env = { ...process.env };
  delete env.TNAI_PREVIEW_PORT;
  addEnv(env);
  check(
    !('TNAI_PREVIEW_PORT' in env),
    'a project-folder pane gets no TNAI_PREVIEW_PORT (unchanged)'
  );
  const tnai = (cwd, ...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd, env, windowsHide: true },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );
  const server = http.createServer((_q, res) => res.end('ok'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://localhost:' + server.address().port + '/';

  let r = await tnai(project, 'preview', 'https://example.com/');
  check(
    r.code === 1 && /addresses on this computer only/.test(r.out) && !shown.length,
    'a non-local address is refused and nothing is pushed'
  );
  r = await tnai(project, 'preview', 'http://localhost:1/');
  check(
    r.code === 1 && /Nothing answers at http:\/\/localhost:1\//.test(r.out) && !shown.length,
    'no server listening: refused with "start the dev server first"'
  );
  r = await tnai(project, 'preview', url, 'watch');
  check(
    r.code === 1 && /phone, tablet, desktop or auto/.test(r.out),
    'an unknown device view is refused'
  );

  pkg(project, { expo: '^51.0.0', react: '18' });
  r = await tnai(sub, 'preview', url);
  check(
    r.code === 0 &&
      /Phone view \(picked from package.json: expo is a mobile app framework\)/.test(r.out),
    "auto: Expo project (package.json above the caller's folder) → Phone: " + r.out.trim()
  );
  check(
    shown.at(-1)?.url === url &&
      shown.at(-1)?.device === 'phone' &&
      path.resolve(shown.at(-1)?.project || '') === path.resolve(project),
    'pushed preview:show { url, device: phone, project } to the window'
  );
  check(
    /the Live preview page was opened/.test(r.out),
    "the window's answer is passed back to the agent"
  );

  // 31's longest answer (the user is on another page) reaches the agent whole: it was cut at 80
  // characters, "…so the preview w." (bug sweep 2026-10-28, item 13, seen by a real agent)
  const longWhere =
    'the user got a bell notice with Open; they are on another page, so the preview was not forced on screen';
  answer = { ok: true, where: longWhere };
  r = await tnai(project, 'preview', url, 'desktop');
  check(
    r.code === 0 && r.out.includes(longWhere + '.'),
    "the window's long answer reaches the agent whole: " + r.out.trim()
  );
  answer = {
    ok: false,
    error: 'the user has another project open in Technically Not (' + 'C:\\x'.repeat(30) + ')',
  };
  r = await tnai(project, 'preview', url, 'desktop');
  check(
    r.code === 1 && r.out.includes('C:\\x'.repeat(30) + ')'),
    "a long refusal (another project's path) reaches the agent whole"
  );
  answer = { ok: true, where: 'the Live preview page was opened for the user' };

  pkg(sub, { vite: '5', react: '18' });
  r = await tnai(sub, 'preview', url.replace('localhost', '127.0.0.1'));
  check(
    r.code === 0 &&
      shown.at(-1)?.device === 'desktop' &&
      /Desktop view \(picked from package.json: no mobile app framework\)/.test(r.out),
    'auto: nearest package.json (a plain web app) → Desktop'
  );
  pkg(sub, { electron: '30' });
  r = await tnai(sub, 'preview', url);
  check(
    r.code === 0 && /Electron app, only its web page shows here/.test(r.out),
    'Electron project: says only its web page shows, not its own window'
  );
  r = await tnai(sub, 'preview', url, 'tablet');
  check(
    r.code === 0 &&
      shown.at(-1)?.device === 'tablet' &&
      /Tablet view \(chosen by the agent\)/.test(r.out),
    'explicit device view wins'
  );

  answer = { ok: false, error: 'the user has another project open in Technically Not' };
  r = await tnai(project, 'preview', url);
  check(
    r.code === 1 && /Not shown: the user has another project open/.test(r.out),
    'the window refusing is reported as not shown'
  );

  // `tnai shot preview [URL] [device]`: the window answers which page and viewport (never changing
  // the screen); the capture (stubbed here) gets them.
  const nap = () => new Promise(r => setTimeout(r, 2100));
  answer = {
    ok: true,
    where: url,
    shot: { url, device: 'phone', w: 393, h: 852, preset: 'i15', label: 'iPhone 15/16' },
  };
  r = await tnai(project, 'shot', 'preview', 'https://example.com/');
  check(
    r.code === 1 && /addresses on this computer only/.test(r.out) && !shots.length,
    'shot: a non-local address is refused, nothing captured'
  );
  r = await tnai(project, 'shot', 'preview', url, 'watch');
  check(r.code === 2 && !shots.length, 'shot: an unknown extra word is a usage error');
  let n0 = shown.length;
  r = await tnai(project, 'shot', 'preview');
  check(
    r.code === 0 &&
      shown.at(-1)?.shot === true &&
      shown.at(-1)?.url === '' &&
      shown.at(-1)?.paneId === 'pane-1' &&
      shown.length === n0 + 1,
    'shot without URL: asks the window { shot, paneId } for the page'
  );
  check(
    shots.at(-1)?.url === url &&
      shots.at(-1)?.width === 393 &&
      shots.at(-1)?.height === 852 &&
      shots.at(-1)?.preset === 'i15',
    'shot: captured at the viewport and preset the window gave: ' + JSON.stringify(shots.at(-1))
  );
  check(
    /Screenshot of http:\/\/localhost:\d+\/ · Phone · iPhone 15\/16 · 393×852 viewport/.test(
      r.out
    ) &&
      /shot-test\.png/.test(r.out) &&
      /Image 393×852 px/.test(r.out),
    'shot: prints page, device, viewport, path and image size: ' + r.out.trim().split('\n')[0]
  );
  r = await tnai(project, 'shot', 'preview', url);
  check(
    r.code === 1 && /One screenshot every 2 seconds/.test(r.out) && shots.length === 1,
    'shot: a second shot within 2 s is refused (rate limit)'
  );
  await nap();
  r = await tnai(project, 'shot', 'preview', 'tablet', url.replace('localhost', '127.0.0.1'));
  check(
    r.code === 0 &&
      shown.at(-1)?.device === 'tablet' &&
      shown.at(-1)?.url === url.replace('localhost', '127.0.0.1') &&
      shots.length === 2,
    'shot: device and URL in either order are passed to the window'
  );
  await nap();
  answer = { ok: false, error: 'no Live preview tab with a page to capture' };
  r = await tnai(project, 'shot', 'preview');
  check(
    r.code === 1 && /No screenshot: no Live preview tab/.test(r.out) && shots.length === 2,
    'shot: the window finding no page is reported'
  );
  await nap();
  answer = {
    ok: true,
    where: 'http://localhost:1/',
    shot: { url: 'http://localhost:1/', device: 'desktop', w: 1280, h: 800, preset: '', label: '' },
  };
  r = await tnai(project, 'shot', 'preview');
  check(
    r.code === 1 && /Nothing answers at http:\/\/localhost:1\//.test(r.out) && shots.length === 2,
    'shot: no server listening is refused before capturing'
  );
  await nap();
  answer = {
    ok: true,
    where: 'x',
    shot: { url: 'https://example.com/', device: 'desktop', w: 1280, h: 800 },
  };
  r = await tnai(project, 'shot', 'preview');
  check(
    r.code === 1 && shots.length === 2,
    'shot: a non-local page from the window is never captured'
  );

  // `tnai preview close [URL]`: no server needed (it may already be stopped); the window says which
  // tabs it closed.
  server.close();
  answer = { ok: true, where: url };
  r = await tnai(project, 'preview', 'close');
  check(
    r.code === 0 &&
      shown.at(-1)?.close === true &&
      shown.at(-1)?.url === '' &&
      shown.at(-1)?.paneId === 'pane-1' &&
      /Closed in Technically Not's Live preview: /.test(r.out),
    'close without URL: pushes { close, paneId } even with the server stopped: ' + r.out.trim()
  );
  r = await tnai(project, 'preview', 'close', url);
  check(
    r.code === 0 && shown.at(-1)?.close === true && shown.at(-1)?.url === url,
    'close URL: pushes that address'
  );
  r = await tnai(project, 'preview', 'close', 'https://example.com/');
  check(
    r.code === 1 && /addresses on this computer only/.test(r.out) && shown.at(-1)?.url === url,
    'close with a non-local address is refused, nothing pushed'
  );
  answer = { ok: false, error: 'no Live preview tab opened by you' };
  r = await tnai(project, 'preview', 'close');
  check(
    r.code === 1 && /Not closed: no Live preview tab opened by you/.test(r.out),
    "the window finding none of the agent's tabs is reported"
  );

  // A pane in its own worktree (lane): a free port of its own for its dev server, and its preview
  // tab is labeled with the worktree.
  const laneEnv = { ...process.env };
  (await mesh.prepare('pane-lane', laneDir, project))(laneEnv);
  const lanePort = Number(laneEnv.TNAI_PREVIEW_PORT);
  check(
    lanePort > 0 && lanePort !== Number(new URL(url).port),
    'a worktree pane gets TNAI_PREVIEW_PORT, a free port of its own: ' + lanePort
  );
  const laneServer = http.createServer((_q, res) => res.end('lane'));
  const listened = await new Promise(r => {
    laneServer.once('error', () => r(false));
    laneServer.listen(lanePort, '127.0.0.1', () => r(true));
  });
  check(listened, 'a dev server can listen on that port');
  answer = { ok: true, where: 'in the Live preview the user has on screen' };
  const laneUrl = 'http://localhost:' + lanePort + '/';
  r = await new Promise(resolve =>
    execFile(
      process.execPath,
      [SHIM, 'tnai', 'preview', laneUrl],
      { cwd: laneDir, env: laneEnv, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
    )
  );
  check(
    r.code === 0 &&
      shown.at(-1)?.url === laneUrl &&
      shown.at(-1)?.lane === 'tnai/terminal-1a2b3c' &&
      shown.at(-1)?.paneId === 'pane-lane' &&
      path.resolve(shown.at(-1)?.project || '') === path.resolve(project),
    'worktree pane: preview:show carries lane tnai/terminal-1a2b3c and the project'
  );
  check(
    /tab labeled with your worktree ⎇ terminal-1a2b3c/.test(r.out),
    'the agent is told its tab carries the worktree name: ' + r.out.trim()
  );
  check(
    !shown.filter(x => x.paneId === 'pane-1' && !x.shot && !x.close).some(x => x.lane),
    'project-folder pane previews carry no lane'
  );
  laneServer.close();

  // `tnai show FILE.html [device]` (desktop/show-file.js): one file of the project, pushed like a
  // preview address but marked with `file`; never a dev server.
  fs.writeFileSync(
    path.join(sub, 'chart.html'),
    '<!doctype html><link rel="stylesheet" href="style.css"><img src="data:image/gif;base64,AA"><script src="https://cdn.example/x.js"></script><a href="https://example.com/">link</a>'
  );
  fs.writeFileSync(path.join(outside, 'x.html'), '<p>outside</p>');
  fs.writeFileSync(path.join(laneDir, 'lane.html'), '<p>lane</p>');
  answer = { ok: true, where: 'in the Live preview the user has on screen' };
  r = await tnai(sub, 'show', 'chart.html', 'tablet');
  const pushed = shown.at(-1);
  check(
    r.code === 0 &&
      /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}\/chart\.html$/.test(pushed?.url || '') &&
      pushed.file === 'apps/web/chart.html' &&
      pushed.device === 'tablet',
    'show: pushes the page server address with file apps/web/chart.html and the device: ' +
      JSON.stringify({ url: pushed?.url, file: pushed?.file })
  );
  check(
    /Showing chart\.html/.test(r.out) &&
      /cut off/.test(r.out) &&
      /will NOT load.*style\.css, https:\/\/cdn\.example\/x\.js/.test(r.out) &&
      !/example\.com/.test(r.out) &&
      !/data:image/.test(r.out),
    'show: the answer names what will not load (the style sheet and the CDN script, not the data: picture or the link): ' +
      r.out.trim().split('\n').pop()
  );
  const listed = await tnai(project, 'server', 'list');
  check(!/\/s\//.test(listed.out), 'show: the page server is not recorded as a dev server');
  let n1 = shown.length;
  r = await tnai(sub, 'show', path.join(outside, 'x.html'));
  check(
    r.code === 1 &&
      /must be inside the project folder or your own worktree/.test(r.out) &&
      shown.length === n1,
    'show: a file outside the project is refused, nothing pushed'
  );
  r = await tnai(project, 'show', 'package.json');
  check(
    r.code === 1 && /only one \.html or \.htm file/.test(r.out) && shown.length === n1,
    'show: a file that is not HTML is refused'
  );
  r = await tnai(project, 'show', path.join(laneDir, 'lane.html'));
  check(
    r.code === 1 && shown.length === n1,
    'show: a project-folder pane cannot show a file of a worktree that is not its own'
  );
  r = await new Promise(resolve =>
    execFile(
      process.execPath,
      [SHIM, 'tnai', 'show', 'lane.html'],
      { cwd: laneDir, env: laneEnv, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
    )
  );
  check(
    r.code === 0 &&
      shown.at(-1)?.file === 'lane.html' &&
      shown.at(-1)?.lane === 'tnai/terminal-1a2b3c',
    'show: a worktree pane shows a file of its own worktree, tab labeled with the worktree: ' +
      r.out.trim().split('\n')[0]
  );
  r = await tnai(project, 'show');
  check(r.code === 2, 'show without a file is a usage error');

  const n = shown.length;
  r = await tnai(outside, 'preview', url);
  check(
    r.code === 1 && /not inside an open Technically Not project/.test(r.out) && shown.length === n,
    'a terminal outside every open project is refused'
  );

  mesh.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'preview-route-check: all ok' : 'preview-route-check: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
