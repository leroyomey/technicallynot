/*
 * Technically Not tools · desktop-check/tests/remote-two.main.js — TEST ONLY. Main-process side of
 * the two-app check (tools/desktop-check/remote-check.js). With TNAI_REMOTE_CHECK_PORT set it
 * listens on 127.0.0.1 for that script's commands: signIn writes this profile's device id and an
 * app session the local accounts server already knows (as its relay tests seed them), then lets
 * user-auth.js load and check it as after a restart. No browser, no real account. remote calls
 * window.tnaiNative.remote.<fn>(...) in the app's window: the same `remote:*` calls the Devices
 * page makes. names publishes a panel name to the roster through the window's own call (file 37
 * does this for real panels). raise posts a Claude Code-shaped PermissionRequest hook to the app's
 * hook server for that panel (as agent-permissions.main.js): a real "needs you" item. clear posts
 * the Stop hook that puts it away. project the open project folder; with a folder, opens it through
 * the window's own project switch. agents makes the roster answer with a given list of agents, each
 * in its project folder (a stand-in for running panels). quit stops any terminal first (so the
 * "still running" dialog cannot open) and quits the app the normal way. For full control
 * (proofs 9 to 21 of remote-check.js): standIn starts an agent
 * panel through the app's own `pty:start` call. What runs in it is a STAND-IN for Claude Code
 * (STAND_IN below, a plain Node script put first on PATH as `claude`): never the real CLI, no
 * model, no usage, and the user's sign-in is never touched. It records every byte it is sent, and
 * when a pasted prompt is followed by Enter it reports that it took the prompt (`standInSays`), as
 * the real CLI's prompt hook does, and once that it is ready. Everything else is the app's own: the
 * panel, the roster, the task record, the ticket, the delivery. shell starts a real PowerShell
 * panel the same way. roster the app's own roster again (after `agents`), plus the panels named in
 * `hand` listed as "a CLI typed by hand" (a stand-in for typing one into that PowerShell panel).
 * keys what the stand-in in a panel was sent (hex), panel/held/panels: what this computer's own
 * services say about its panels. detect, access, trust, trustOpen, workspace, close, restart: for a
 * start asked by the other computer (each is explained where it is defined). heard what this
 * computer was sent as a changed app would keep it: each agent row's ticket, the newest counter and
 * its age, and every reply to an operation. raw sends a message of the check's own making through
 * this app's trust gate. Both need this file loaded before the app's code: remote-check.js starts
 * the apps with `electron -r <this file>`. By hand (`remote-check.js hand`, TNAI_CHECK_BY_HAND
 * set): no stand-in and no tap. The agent CLIs are the real ones on this PC, started and used by
 * the person at the two windows; `place` puts this window on its half of the screen with its name
 * in the title, `page` opens a page by its nav item. The other commands that need the stand-in are
 * not for that mode. Without the variable it only answers `driven` with false.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, safeStorage } = require('electron');

// TEST ONLY, two-app check only. A changed app on a paired computer keeps what it was sent and
// sends what it likes; to play one, the check has to see the messages this app's list reader is
// handed and reach the way out through this app's trust gate. Both are inside remote-service.js,
// which takes `createRemoteApi` when it is first loaded, so this runs before the app's own code.
const tap = { send: null, rows: {}, known: {}, control: null, fresh: null, replies: [] };
const HAND = !!process.env.TNAI_CHECK_BY_HAND;
if (Number(process.env.TNAI_REMOTE_CHECK_PORT) && !HAND) {
  const apiMod = require('../../../desktop/remote-api.js'),
    real = apiMod.createRemoteApi;
  apiMod.createRemoteApi = o => {
    tap.send = o.send;
    const api = real(o),
      read = api.onMessage;
    api.onMessage = (from, obj) => {
      try {
        if (obj?.t === 'agents' && Array.isArray(obj.agents)) {
          if (obj.i === 0) tap.rows = {};
          for (const r of obj.agents)
            if (r && typeof r.id === 'string') {
              tap.rows[r.id] = r.to || '';
              if (r.to) tap.known[r.id] = r.to;
            }
        }
        if (obj?.t === 'control') tap.control = Array.isArray(obj.clis) ? obj.clis : null;
        if ((obj?.t === 'agents' || obj?.t === 'control') && Number.isInteger(obj.c))
          tap.fresh = { c: obj.c, at: Date.now() };
        if (obj?.t === 'prompted' || obj?.t === 'acted' || obj?.t === 'started')
          tap.replies.push({
            t: obj.t,
            n: obj.n,
            ok: obj.ok,
            word: obj.state ?? obj.why ?? (obj.ok === true ? 'started' : ''),
          });
      } catch {
        /* the tap never gets in the app's way */
      }
      return read(from, obj);
    };
    return api;
  };
}

// The stand-in for Claude Code (see `standIn` above). It answers the app's install and sign-in
// checks, then sits in raw mode like a CLI's input: every chunk it is sent goes to
// stand-in-keys.log as hex, something is printed for every chunk, and a bracketed paste followed by
// Enter is "a prompt it took".
const STAND_IN = `const fs = require('fs'), path = require('path'), http = require('http');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'stand-in@example.invalid', authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0);
const dir = process.env.TNAI_REMOTE_CHECK_PROFILE || '.', log = path.join(dir, 'stand-in-keys.log'), port = Number(process.env.TNAI_REMOTE_CHECK_PORT);
const who = { pid: process.pid, ppid: process.ppid };
const tell = (what, more) => { const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/' }, res => res.resume()); r.on('error', () => {}); r.end(JSON.stringify({ cmd: 'standInSays', args: { what, ...who, ...more } })); };
const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : 'none'; };
fs.appendFileSync(log, 'start ' + who.pid + ' ' + who.ppid + ' mode=' + at('--permission-mode') + '\\n');
process.stdout.write('STAND-IN agent (not a real CLI). Waiting for a prompt.\\r\\n> ');
// "Ready": the real CLI's connection to the app's own tool server says so.
setTimeout(() => tell('ready'), 400);
process.stdin.setRawMode?.(true); process.stdin.resume();
let buf = '';
process.stdin.on('data', d => {
  fs.appendFileSync(log, 'in ' + who.pid + ' ' + d.toString('hex') + '\\n');
  process.stdout.write('.');
  buf = (buf + d.toString('latin1')).slice(-20000);
  const m = /\\x1b\\[200~([\\s\\S]*?)\\x1b\\[201~[^\\r]*\\r/.exec(buf);
  if (m) { buf = ''; process.stdout.write('\\r\\nworking on it\\r\\n'); tell('took', { prompt: Buffer.from(m[1], 'latin1').toString('utf8') }); }
});
`;

module.exports = (win, profile) => {
  const port = Number(process.env.TNAI_REMOTE_CHECK_PORT);
  if (!port) return { driven: () => false };

  // The stand-in first on PATH as `claude`, and every folder that holds the real one taken off it
  // (the app prefers a claude.exe).
  const standInLog = path.join(
    process.env.TNAI_REMOTE_CHECK_PROFILE || profile,
    'stand-in-keys.log'
  );
  if (!HAND) {
    const bin = path.join(profile, 'stand-in-claude-bin'),
      home = path.join(profile, 'stand-in-claude-home');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(bin, 'stand-in-claude.js'), STAND_IN);
    if (process.platform === 'win32')
      fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0stand-in-claude.js" %*\r\n');
    else
      fs.writeFileSync(
        path.join(bin, 'claude'),
        '#!/bin/sh\nexec node "$(dirname "$0")/stand-in-claude.js" "$@"\n',
        { mode: 0o755 }
      );
    const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
    const real = dir =>
      path.resolve(dir).toLowerCase() !== bin.toLowerCase() &&
      ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'].some(f =>
        fs.existsSync(path.join(dir, f))
      );
    const strip = () => {
      process.env[key] = [
        bin,
        ...String(process.env[key] || '')
          .split(path.delimiter)
          .filter(
            dir => dir && path.resolve(dir).toLowerCase() !== bin.toLowerCase() && !real(dir)
          ),
      ].join(path.delimiter);
    };
    strip();
    process.env.CLAUDE_CONFIG_DIR = home;

    // The app widens PATH while it runs (agent-registry.js freshPath, for a CLI installed a minute
    // ago), which brings the real claude.exe back, and the app prefers an .exe: found 2026-10-09,
    // when a second look for the CLIs read the real one as "signed out". So the real one is taken
    // off again around every look, and a start of "Claude Code" that is not this stand-in is
    // refused outright: this check must never start the real CLI.
    const registry = require('../../../desktop/agent-registry.js');
    for (const fn of ['detectAll', 'installInfo']) {
      const own = registry[fn].bind(registry);
      registry[fn] = async (...a) => {
        strip();
        try {
          return await own(...a);
        } finally {
          strip();
        }
      };
    }
    const spec = registry.spec.bind(registry);
    registry.spec = async (id, mode, opts) => {
      if (id !== 'Claude Code') return spec(id, mode, opts);
      strip();
      const s = await spec(id, mode, opts);
      if (!JSON.stringify([s.file, s.args]).includes('stand-in-claude'))
        throw new Error('remote-check: this would start the real Claude Code, refused');
      return s;
    };
  }
  const userAuth = require('../../../desktop/user-auth.js');
  const hooks = require('../../../desktop/agent-hooks.js');
  const attention = require('../../../desktop/attention-service.js');
  const ptys = require('../../../desktop/pty-service.js');
  const files = require('../../../desktop/fs-service.js');
  const mesh = require('../../../desktop/agent-mesh.js');
  const turns = require('../../../desktop/agent-turns.js');
  const realState = mesh.state.bind(mesh),
    // the app's own roster, before `agents` or `roster` stands in for it
    realCliOf = mesh.cliOf.bind(mesh);
  const lifecycle = require('../../../desktop/agent-lifecycle.js');

  // Which stand-in process runs in which panel: its start line names its own process and its
  // parent, one of which is the panel's.
  const standIns = new Map(); // paneId -> { pid, mode: the --permission-mode it was started with }
  const startLines = () =>
    fs.existsSync(standInLog)
      ? fs
          .readFileSync(standInLog, 'utf8')
          .split('\n')
          .filter(l => l.startsWith('start '))
          .map(l => {
            const [, pid, ppid, mode] = l.split(' ');
            return {
              pid: Number(pid),
              ppid: Number(ppid),
              mode: String(mode || '').replace('mode=', ''),
            };
          })
      : [];
  const standOf = paneId => {
    if (!standIns.has(paneId)) {
      const s = ptys.list().find(x => x.paneId === paneId),
        hit =
          s &&
          startLines()
            .reverse()
            .find(l => l.pid === s.pid || l.ppid === s.pid);
      if (hit) standIns.set(paneId, { pid: hit.pid, mode: hit.mode });
    }
    return standIns.get(paneId) || null;
  };
  const paneOfProcess = (pid, ppid) =>
    ptys.list().find(s => s.pid === pid || s.pid === ppid)?.paneId || '';

  // The window publishes every panel's name in one list (file 37), so each call here sends all the
  // names this check has given.
  const named = new Map(),
    publishNames = () =>
      inWindow('window.tnaiNative.mesh.names(' + JSON.stringify([...named.values()]) + ')');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v || Date.now() > end) return v;
      await wait(50);
    }
  };
  const inWindow = code => win.webContents.executeJavaScript(code, true);
  const auth = () => {
    const s = userAuth.publicState();
    return {
      signedIn: s.signedIn,
      user: s.user?.email || '',
      problem: s.problem,
      locked: s.lock.locked,
      plan: s.plan?.plan || '',
    };
  };
  const itemsOf = paneId =>
    attention
      .list()
      .items.filter(it => it.paneId === paneId)
      .map(it => ({ id: it.id, kind: it.kind, detail: it.detail }));
  const post = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(
      r => r.text(),
      () => ''
    );
  let ready = false,
    end = null;

  // Another computer's agents in this window's thread list, and the detail of one in the thread's
  // main area on the Threads page (src/scripts/119, 138, 116-remote-agents.js), read and pressed as
  // its user would. what: 'read' says what the page shows (the groups and rows of other computers,
  // the open detail with the rows of its terminal box, the composer's hint and draft); 'select'
  // clicks that agent's row; 'press' presses the button of the open detail that carries those
  // words; 'send' types into the composer and presses Send; 'enter' presses Send once more. Runs
  // inside the window.
  const farAgentsInWindow = async ({ what, key, text }) => {
    const threads = window.TnaiThreads,
      list = threads?.slot?.('list') || null,
      main = threads?.slot?.('main') || null,
      wait = ms => new Promise(r => setTimeout(r, ms));
    const rows = () => [...(list?.querySelectorAll('.tnt-th[data-remote]') || [])],
      far = () => {
        const f = main?.querySelector(':scope > .tnh-view .ap-far');
        return f && !f.hidden && f.getClientRects().length ? f : null;
      };

    // A group is an "On COMPUTER" heading of the list; its computer is the first part of the key
    // of the row under it.
    const groups = () =>
      [...(list?.querySelectorAll('.tnt-proj') || [])]
        .filter(head => /^On /.test(head.querySelector('span')?.textContent || ''))
        .map(head => {
          let next = head.nextElementSibling;
          while (next && !next.dataset?.remote && !next.classList.contains('tnt-proj'))
            next = next.nextElementSibling;
          return {
            name: head.querySelector('span').textContent,
            computer: next?.dataset?.remote ? next.dataset.remote.split('\n')[0] : '',
          };
        });
    const input = document.querySelector(
        '.composer textarea, .composer [contenteditable], #prompt'
      ),
      send = document.getElementById('send');
    if (what === 'select') {
      const r = rows().find(x => x.dataset.remote === key);
      if (!r) return false;
      r.click();
      await wait(100);
      return window.TnaiRemoteAgents?.selected?.() === key;
    } // false inside the page's quiet time: a click there is no click
    if (what === 'enter') {
      if (!send) return false;
      send.click();
      await wait(300);
      return true;
    } // Send again, the draft as it is
    if (what === 'press') {
      const b = [...(far()?.querySelectorAll('button') || [])].find(
        x => x.textContent.trim() === text && !x.hidden && !x.disabled
      );
      if (!b) return false;
      b.click();
      await wait(100);
      return true;
    }
    if (what === 'send') {
      if (!input || !send) return false;
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(150);
      send.click();
      await wait(300);
      return true;
    }
    const f = far(),
      term = f?.querySelector('.ap-term');
    return {
      onPage: !!threads?.visible?.(),
      groups: groups(),
      rows: rows()
        .filter(r => !r.hidden)
        .map(r => ({
          key: r.dataset.remote,
          name: r.querySelector('b').textContent,
          tag: r.querySelector('.tnt-th-tool')?.textContent || '',
          selected: r.getAttribute('aria-selected') === 'true',
        })),
      detail: f
        ? {
            name: f.querySelector('h2').textContent,
            sub: f.querySelector('.ap-id small').textContent,
            view: term.dataset.view || '',
            note: term.querySelector('.ap-none')?.textContent || '',
            lines: [...(term.querySelector('.dv-screen')?.children || [])].map(r =>
              r.textContent.trimEnd()
            ),
            buttons: [...f.querySelectorAll('button')]
              .filter(b => !b.hidden)
              .map(b => b.textContent.trim()),
          }
        : null,
      hint:
        [...document.querySelectorAll('.composer .hints *')]
          .map(h => h.textContent)
          .find(t => /^On .+ → /.test(t)) || '',
      draft: input ? String(input.value ?? input.textContent ?? '') : null,
    };
  };

  // This window's Devices page, read and pressed as its user would (the own-relay check,
  // tools/desktop-check/own-relay-check.js). what: 'read' says what the page shows (this computer's
  // lines, the relay row, the other computers' cards, the open dialog); 'press' presses the button
  // with those words in the open dialog (scope 'dialog') or on this computer's card (scope 'me':
  // other pages of the app have buttons with the same words, so the whole window is never
  // searched); 'save' types into the dialog's fields, found by their labels, and presses that
  // button in the same step, so a repaint cannot empty the fields in between. Runs inside the
  // window.
  const devicesInWindow = async ({ what, scope, text, fields }) => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const words = node => (node ? node.textContent.trim() : '');
    const dialog = () => document.querySelector('.dv-dlg');
    const press = (root, label) => {
      const buttons = [...(root ? root.querySelectorAll('button') : [])];
      const button = buttons.find(b => words(b) === label && !b.disabled && !b.hidden);
      if (!button) return false;
      button.click();
      return true;
    };
    if (what === 'press') {
      const roots = { dialog: dialog(), me: document.querySelector('.dv-me') };
      const pressed = press(roots[scope] || null, text);
      await wait(150);
      return pressed;
    }
    if (what === 'save') {
      const box = dialog();
      if (!box) return false;
      for (const [label, value] of Object.entries(fields)) {
        const field = box.querySelector('input[aria-label=' + JSON.stringify(label) + ']');
        if (!field) return false;
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const pressed = press(box, text);
      await wait(150);
      return pressed;
    }
    const me = document.querySelector('.dv-me');
    const box = dialog();
    return {
      onPage: !!me,
      lines: [...(me ? me.querySelectorAll('.dv-now > p, .dv-owed > span') : [])].map(words),
      relay: words(document.querySelector('[data-relay] > span')),
      buttons: [...(me ? me.querySelectorAll('button') : [])].map(words),
      // every button of the Devices page, also when this computer's card is not drawn (connecting
      // off)
      pageButtons: [...document.querySelectorAll('.dv-page button')].map(words),
      cards: [...document.querySelectorAll('.dv-pc[data-pc]')].map(card => ({
        id: card.dataset.pc,
        name: words(card.querySelector('h3')),
        paired: !card.classList.contains('dv-ask'),
        state: words(card.querySelector('.dv-state')),
        says: words(card.querySelector('.dv-now')),
      })),
      dialog: box
        ? {
            title: words(box.querySelector('#dvDlgTitle')),
            text: [...box.querySelectorAll('p')].map(words).filter(Boolean),
            buttons: [...box.querySelectorAll('button')].map(words),
          }
        : null,
    };
  };
  const cmds = {
    devices: ({ what = 'read', scope = 'me', text = '', fields = {} } = {}) =>
      inWindow(
        '(' +
          devicesInWindow +
          ')(' +
          JSON.stringify({ what: String(what), scope: String(scope), text: String(text), fields }) +
          ')'
      ),
    ping: () => ({
      ready,
      pid: process.pid,
      userData: app.getPath('userData'),
      version: app.getVersion(),
    }),
    async signIn({ token, deviceId, user }) {
      fs.writeFileSync(userAuth._test.deviceFile(), JSON.stringify({ id: deviceId }) + '\n');
      fs.writeFileSync(
        userAuth._test.accountFile(),
        safeStorage
          .encryptString(
            JSON.stringify({ token, rotatedAt: Date.now(), user, pass: '', checkedAt: 0 })
          )
          .toString('base64'),
        { mode: 0o600 }
      );
      userAuth._test.restart();
      await userAuth._test.check();
      return { ...auth(), device: userAuth.thisDevice().id };
    },
    auth,
    remote: ({ fn, args = [] }) =>
      inWindow(
        'window.tnaiNative.remote[' +
          JSON.stringify(String(fn)) +
          '](...' +
          JSON.stringify(args) +
          ')'
      ),
    names: ({ list }) => inWindow('window.tnaiNative.mesh.names(' + JSON.stringify(list) + ')'),
    async raise({ paneId, command }) {
      await hooks.launchOptions(paneId, 'Claude Code');
      post(hooks.endpoint(paneId).hook, {
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command },
      }); // held open until answered
      await until(() => itemsOf(paneId).length);
      return itemsOf(paneId);
    },
    async clear({ paneId }) {
      await post(hooks.endpoint(paneId).hook, { hook_event_name: 'Stop' });
      await until(() => !itemsOf(paneId).length);
      return itemsOf(paneId);
    },
    // The open project folder, or with `dir` that folder made a listed project and opened through
    // the window's own `fs:switch` call. ui: through the page's own project switch instead (what
    // the user's click on a project does), so the top bar and the file rail follow too; → the
    // folder the page then says is open.
    async project({ dir, ui = false } = {}) {
      if (!dir) return files.root();
      const file = path.join(app.getPath('userData'), 'project-folder.json'),
        saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(
        file,
        JSON.stringify({
          root: saved.root,
          projects: [...new Set([...(saved.projects || []), saved.root, dir].filter(Boolean))],
        })
      );
      await files.loadRoot();
      if (ui)
        return inWindow(
          'window.TnaiProjects.switchTo(' +
            JSON.stringify(dir) +
            ').then(() => window.TnaiProjects.active())'
        );
      return inWindow('window.tnaiNative.fs.switchTo(' + JSON.stringify(dir) + ')');
    },
    // Stand-in for running agent panels (a real one needs a signed-in agent CLI): the roster the
    // app reads its agents from answers with these, each in its project folder. Everything after
    // that is the app's own: the list, each project's key, sending and listing.
    agents({ list }) {
      mesh.state = async () => ({
        panes: list.map(p => ({
          paneId: p.paneId,
          provider: p.cli,
          project: p.project,
          hand: false,
          startedAt: Date.now(),
        })),
      });
      return inWindow(
        'window.tnaiNative.mesh.names(' +
          JSON.stringify(list.map(p => ({ paneId: p.paneId, name: p.name, agent: p.cli }))) +
          ')'
      );
    },
    // ---- full control (proofs 9 to 16) ----
    // An agent panel started through the app's own `pty:start`; its process must be the stand-in,
    // or it is stopped at once and this fails.
    async standIn({ paneId, name }) {
      const r = await inWindow(
        'window.tnaiNative.pty.start(' +
          JSON.stringify({ paneId, agent: 'Claude Code', mode: 'run', name, cols: 100, rows: 30 }) +
          ')'
      );
      if (!r?.ok || !(await until(() => standOf(paneId), 20000))) {
        try {
          ptys.stop(paneId);
        } catch {
          /* not running */
        }
        throw new Error(
          'the stand-in did not start in that panel: ' +
            (r?.error?.message || 'no start line (was another program started?)')
        );
      }
      named.set(paneId, { paneId, name, agent: 'Claude Code' });
      await publishNames();
      const s = ptys.list().find(x => x.paneId === paneId);
      return {
        pid: s?.pid || 0,
        agent: s?.agent,
        mode: s?.mode,
        command: String(r.value?.commandLine || '').slice(0, 200),
      };
    },
    async shell({ paneId }) {
      const r = await inWindow(
        'window.tnaiNative.pty.start(' +
          JSON.stringify({ paneId, agent: 'Terminal', mode: 'run', cols: 100, rows: 30 }) +
          ')'
      );
      if (!r?.ok) throw new Error('no PowerShell panel: ' + (r?.error?.message || '?'));
      return { pid: ptys.list().find(x => x.paneId === paneId)?.pid || 0 };
    },
    roster({ hand = [] } = {}) {
      mesh.state = async () => {
        const real = await realState();
        return {
          panes: [
            ...real.panes,
            ...hand.map(p => ({
              paneId: p,
              provider: 'Claude Code',
              project: files.root(),
              hand: true,
              startedAt: Date.now(),
            })),
          ],
        };
      };
      mesh.cliOf = id => (hand.includes(id) ? 'Claude Code' : realCliOf(id));
      for (const p of hand)
        named.set(p, { paneId: p, name: 'Typed by hand', agent: 'Claude Code' });
      return publishNames();
    },
    // A stand-in reports, for the panel its process runs in: "took" a prompt (what the real CLI's
    // prompt hook tells the app), or "ready" (what the real CLI's connection to the app's tool
    // server tells it: a `tools/list` call).
    standInSays({ what, pid, ppid, prompt }) {
      const paneId = paneOfProcess(Number(pid), Number(ppid)),
        at = paneId && hooks.endpoint(paneId);
      if (!at) return false;
      if (what === 'took')
        post(at.hook, { hook_event_name: 'UserPromptSubmit', prompt: String(prompt || '') });
      if (what === 'ready') post(at.mcp, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      return true;
    },
    // Every byte the stand-in in that panel was sent, as hex (all stand-ins without a panel id).
    keys({ paneId } = {}) {
      const me = paneId ? standOf(paneId) : null;
      if (paneId && !me) return '';
      return (fs.existsSync(standInLog) ? fs.readFileSync(standInLog, 'utf8').split('\n') : [])
        .filter(l => l.startsWith('in ') && (!me || l.startsWith('in ' + me.pid + ' ')))
        .map(l => l.split(' ')[2])
        .join('');
    },
    // ---- a start from the other computer (proofs 16 and up) ----
    // Every panel with a process: what runs there, the level its stand-in was started with, and
    // whether this computer counts it as started from another computer. remote: how many such
    // panels it counts in all (stopped ones too).
    panels: () => ({
      remote: lifecycle.remoteOpen(),
      list: ptys.list().map(s => ({
        paneId: s.paneId,
        agent: s.agent,
        mode: s.mode,
        running: s.running === true,
        standIn: standOf(s.paneId),
        remote: lifecycle.remoteStarted(s.paneId),
        busy: turns.busy(s.paneId),
      })),
    }),
    wasRemote: ({ paneId }) => lifecycle.remoteStarted(paneId),
    // ---- a picture and a text file with a prompt (the proof
    // before the reports proof) ---- On the sending computer, in its own window, as its user would:
    // two chips are attached (a picture drawn on a canvas, larger than the cap, and a text file),
    // the page prepares them (src/scripts/27-composer-attachments.js forRemote: the picture is made
    // small by the page's canvas) and they go through the window's own call `remote.promptFiles`. →
    // what was handed over (kind, size and SHA-256 of each) and how the call ended. Nothing here is
    // a stand-in but the picture's content. The stand-in agent a proof started for itself is ended
    // (the terminal service's own stop, as the stop button's).
    stopPanel({ paneId }) {
      try {
        return ptys.stop(String(paneId)) === true;
      } catch {
        return false;
      }
    },
    // It only starts them: pieces go at most one every 1.5 seconds, so a picture of about 120 KB
    // takes a minute and more, longer than one call of the check waits (20 s). `sentFiles` says how
    // it ended, or null while files still travel.
    sentFiles: () => inWindow('window.__tnaiSentFiles || null'),
    sendFiles: ({ peer, agentId, text, mark, note = '# Notes\nRun the tests.\n' }) =>
      inWindow(`(() => { window.__tnaiSentFiles = null; (async () => {
      const A = window.TnaiAttachments, R = window.tnaiNative.remote; if (!A || !A.forRemote || !R.promptFiles) return { error: 'no attachments for another computer in this build' };
      // A screen-like picture: a flat ground, and one block of detail that makes the PNG large (over the cap as drawn) while the
      // JPEG the page makes of it stays well under 120 KB, so its pieces take well under a minute of this check's eleven.
      const c = document.createElement('canvas'); c.width = 2200; c.height = 1400; const g = c.getContext('2d'); g.fillStyle = 'rgb(36,40,66)'; g.fillRect(0, 0, c.width, c.height);
      const d = g.createImageData(700, 500); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 7) % 251; d.data[i + 1] = (i * 13) % 241; d.data[i + 2] = (i >> 6) % 239; d.data[i + 3] = 255; } g.putImageData(d, 100, 300);
      g.fillStyle = 'white'; g.font = '60px sans-serif'; g.fillText('A picture for the other computer', 60, 120);
      const png = await new Promise(r => c.toBlob(r, 'image/png'));
      A.clear(); const dt = new DataTransfer(); dt.items.add(new File([png], 'two-copies.png', { type: 'image/png' })); dt.items.add(new File([${JSON.stringify(String(note))}], 'notes.md', { type: 'text/markdown' }));
      const input = document.getElementById('attachmentInput'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 40 && A.count() < 2; i++) await new Promise(r => setTimeout(r, 50));
      const made = await A.forRemote(); if (!made || made.ok !== true) { A.clear(); return { error: (made && made.words) || 'not prepared', original: png.size }; }
      const hex = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('');
      const files = []; for (const f of made.files) files.push({ kind: f.kind, bytes: f.bytes.byteLength, sha: await hex(f.bytes) });
      const r = await R.promptFiles(${JSON.stringify(String(peer))}, ${JSON.stringify(String(agentId))}, ${JSON.stringify(String(text))}, ${JSON.stringify(String(mark))}, made.files);
      A.clear();
      return { original: png.size, words: made.words, files, sent: r && r.ok !== false ? (r.value ? r.value.sent : r.sent) : 'refused: ' + ((r && r.error && r.error.code) || '?'), n: r && r.value ? r.value.n : '' };
    })().then(r => { window.__tnaiSentFiles = r; }, e => { window.__tnaiSentFiles = { error: String((e && e.message) || e) }; }); return { started: true }; })()`),
    // On the receiving computer: the files this computer saved from another computer (the name form
    // attachment-service.js makes), newest first, each with its size and SHA-256. Read from its
    // attachments folder; nothing is opened as a picture.
    cameFiles() {
      const dir = require('../../../desktop/attachment-service.js').dir(),
        out = [];
      let days = [];
      try {
        days = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      } catch {
        return out;
      }
      for (const day of days)
        for (const name of fs.readdirSync(path.join(dir, day))) {
          if (!/^[0-9a-f]{8}-from-another-computer\.(png|jpg|txt)$/.test(name)) continue;
          const file = path.join(dir, day, name),
            b = fs.readFileSync(file);
          out.push({
            name,
            path: file,
            bytes: b.length,
            sha: require('crypto').createHash('sha256').update(b).digest('hex'),
            at: fs.statSync(file).mtimeMs,
          });
        }
      return out.sort((a, b) => b.at - a.at);
    },
    // What this computer's own window reads from that panel's terminal right now, row by row
    // (src/scripts/115-remote-view.js `read`, the same reading the live view hands over): for the
    // live view's proof, which compares it with the picture on the other computer.
    screenText: ({ paneId }) =>
      inWindow(
        '(() => { const v = window.TnaiAgents.views().filter(x => x.paneId === ' +
          JSON.stringify(String(paneId)) +
          ' && x.term); const t = (v.find(x => x.where === "Terminal page panel") || v[0])?.term; return t && window.TnaiRemoteView ? window.TnaiRemoteView.read(t).lines.map(l => String(l[0]).trimEnd()) : null; })()'
      ),
    // A panel's process is ended and the panel is started again by this computer's own window call
    // (`pty:start`), as when its user presses Enter in a stopped panel or the app resumes it: with
    // the access level and, for a resume, the conversation given.
    async restart({ paneId, access, resumeId = '' }) {
      try {
        ptys.stop(paneId);
      } catch {
        /* nothing runs there */
      }
      await until(() => !ptys.list().some(s => s.paneId === paneId && s.running), 5000);
      standIns.delete(paneId);
      const r = await inWindow(
        'window.tnaiNative.pty.start(' +
          JSON.stringify({
            paneId,
            agent: 'Claude Code',
            mode: 'run',
            access,
            resumeId,
            ownedByUser: true,
            cols: 100,
            rows: 30,
          }) +
          ')'
      );
      if (r?.ok) await until(() => standOf(paneId), 20000);
      return {
        ok: r?.ok === true,
        error: r?.error?.message || '',
        running: ptys.list().some(s => s.paneId === paneId && s.running),
        mode: standOf(paneId)?.mode || '',
      };
    },
    // The CLIs this computer's own check finds (the window's call): the stand-in answers for
    // `claude`.
    async detect() {
      const all = await inWindow('window.tnaiNative.agents.detect()');
      return (Array.isArray(all) ? all : [])
        .filter(a => a.installed)
        .map(a => a.id + (a.loggedIn === false ? ' (signed out)' : ''));
    },
    // This project's access level for new agents, set as the user does it (the composer's Access
    // menu); → the level the window holds.
    async access({ level }) {
      return inWindow(`(async () => { const L = window.TnaiLiveTasks, sel = document.querySelector('.composer .tnai-pick[data-pick="access"] select'); if (!sel) return 'no Access menu';
        L.setTarget(null); L.newAgent('Claude Code'); for (let i = 0; i < 60 && sel.disabled; i++) await new Promise(r => setTimeout(r, 100));
        sel.value = ${JSON.stringify(String(level))}; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200)); return window.TnaiLaunchPrefs.access(); })()`);
    },
    trustOpen: async () =>
      ((await inWindow('window.tnaiNative.trust.pending()')) || []).map(q => ({
        paneId: q.paneId,
        title: q.title,
        body: q.body,
      })),
    // "Trust this folder?" questions open on this computer, answered as its user would (the
    // window's own call). → how many were open.
    async trust({ yes = true } = {}) {
      const open = await inWindow('window.tnaiNative.trust.pending()');
      for (const q of open || [])
        await inWindow(
          'window.tnaiNative.trust.answer(' + JSON.stringify(q.id) + ', ' + (yes === true) + ')'
        );
      return (open || []).length;
    },
    // The active workspace: its panels, every workspace that has one, and whether a full one would
    // open another. fill: add empty panels until it holds the limit (they count as taken for 15 s,
    // as a panel just made for a start does).
    async workspace({ fill = false } = {}) {
      return inWindow(`(() => { const lim = window.TnaiPaneLimit; if (${fill === true}) for (let i = 0; i < 20 && lim.count() < lim.max; i++) window.TnaiNewTerminalPane({ quiet: true });
        const all = [...document.querySelectorAll('.terminal-pane')]; return { count: lim.count(), max: lim.max, panes: all.length, workspaces: new Set(all.map(p => p.dataset.workspaceId)).size, wouldOverflow: !!window.TnaiTerminalWorkspaces?.canOverflow?.() }; })()`);
    },
    // The user closes a panel on this computer (the window's own call for it).
    close: ({ paneId }) =>
      inWindow('window.tnaiNative.pty.forget(' + JSON.stringify(String(paneId)) + ')'),
    panel({ paneId }) {
      const s = ptys.list().find(x => x.paneId === paneId);
      let alive = false;
      try {
        alive = !!s?.pid && (process.kill(s.pid, 0), true);
      } catch (e) {
        alive = e.code === 'EPERM';
      }
      return {
        listed: !!s,
        running: s?.running === true,
        pid: s?.pid || 0,
        alive,
        busy: turns.busy(paneId),
        items: itemsOf(paneId).map(it => it.kind),
      };
    },
    alive({ pid }) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return e.code === 'EPERM';
      }
    },
    held: () =>
      attention
        .list()
        .held.filter(h => h.remote)
        .map(h => ({ paneId: h.paneId, from: h.from, why: h.why })),
    heard: () => ({
      rows: { ...tap.rows },
      known: { ...tap.known },
      control: tap.control,
      fresh: tap.fresh ? { c: tap.fresh.c, ms: Date.now() - tap.fresh.at } : null,
      replies: tap.replies.slice(),
    }),
    // By hand: this window on the left or right half of the main screen (never under the app's
    // smallest width), named in its title (the taskbar and Alt+Tab show it; the page's own title
    // changes are kept off it).
    place({ side, title }) {
      const a = require('electron').screen.getPrimaryDisplay().workArea,
        w = Math.min(a.width, Math.max(Math.floor(a.width / 2), win.getMinimumSize()[0] || 0));
      if (win.isMaximized()) win.unmaximize();
      win.setBounds({
        x: side === 'right' ? a.x + a.width - w : a.x,
        y: a.y,
        width: w,
        height: a.height,
      });
      win.on('page-title-updated', e => e.preventDefault());
      win.setTitle(String(title));
      return win.getBounds();
    },
    farAgents: ({ what = 'read', key = '', text = '' } = {}) =>
      inWindow(
        '(' +
          farAgentsInWindow +
          ')(' +
          JSON.stringify({ what: String(what), key: String(key), text: String(text) }) +
          ')'
      ),
    // This window loads its page again, as after a crash of the page or a reload: for the proof
    // that a view does not outlive it.
    reload: () =>
      new Promise(resolve => {
        win.webContents.once('did-finish-load', () => resolve(true));
        win.webContents.reload();
      }),
    // 'threads' opens the Threads page; any other view goes by the hidden old navigation's route
    // for it (devices: the Devices page).
    page: ({ view }) =>
      inWindow(
        view === 'threads'
          ? `(() => { window.TnaiThreads?.open(); return !!window.TnaiThreads; })()`
          : `(() => { const nav = document.querySelector('.side-item[data-view=${JSON.stringify(String(view))}]'); nav?.click(); return !!nav; })()`
      ),
    // A task and its end in a panel, told to this app as the real CLI's hooks tell them (the
    // stand-in has no model): the prompt it took, then the stop with its final message. For proof
    // 23 (a finished task's result crossing over).
    async finish({ paneId, task, answer }) {
      const at = hooks.endpoint(paneId);
      await post(at.hook, { hook_event_name: 'UserPromptSubmit', prompt: String(task) });
      await post(at.hook, { hook_event_name: 'Stop', last_assistant_message: String(answer) });
      return true;
    },
    // A picture of this window as it is now, into tools/browser-check/out (so whoever set the two
    // windows up can look before handing over).
    async shot({ name }) {
      const file = path.join(
        __dirname,
        '..',
        '..',
        'browser-check',
        'out',
        'desktop-' + String(name).replace(/[^\w-]/g, '') + '.png'
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      return file;
    },
    raw({ to, msg }) {
      if (!tap.send)
        throw new Error(
          'this app was not started with the tap (electron -r tests/remote-two.main.js)'
        );
      return tap.send(String(to), msg) === true;
    },
    async quit() {
      const running = () => ptys.list().filter(s => s.running).length;
      if (running()) {
        ptys.stopAll();
        await until(() => !running(), 3000);
      }

      // a terminal that will not stop: leave without the close dialog
      const how = running() ? 'exit' : 'quit';
      setTimeout(() => (how === 'quit' ? app.quit() : app.exit(0)), 50);
      return how;
    },
  };

  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', d => {
      text += d;
    });
    req.on('end', async () => {
      let out;
      try {
        const { cmd, args } = JSON.parse(text || '{}');
        if (!Object.hasOwn(cmds, cmd)) throw new Error('unknown command');
        out = { ok: true, value: await cmds[cmd](args || {}) };
      } catch (e) {
        out = { ok: false, error: String(e?.message || e) };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out ?? null));
    });
  });
  server.on('error', e =>
    console.log('remote-two: control port ' + port + ' failed: ' + e.message)
  );
  server.listen(port, '127.0.0.1');
  app.on('before-quit', () => {
    try {
      server.close();
      server.closeAllConnections?.();
    } catch {
      /* going anyway */
    }
    end?.(true);
  });

  return {
    driven: () => {
      ready = true;
      return true;
    },
    untilEnd: () =>
      new Promise(r => {
        end = r;
      }),
  };
};
