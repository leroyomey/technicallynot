// Test of the design cards in a thread's conversation: node tools/thread-designs-test.js
//
// Two halves. The window's half (src/scripts/159-thread-designs.js) runs in a Node sandbox with a
// small stand-in for the page: which conversation entries are designs, and where their cards go.
// The main process's half (desktop/thread-designs.js) runs on real files in a temporary folder:
// which files may be shown, a picture a command only named, and a page registered with the `tnai
// show` page server. No window opens and no CLI starts.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

// ---------- a small stand-in for the page ----------
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.parent = null;
    this.listeners = {};
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
  }
  replaceWith(node) {
    const list = this.parent?.children || [];
    const at = list.indexOf(this);
    if (at >= 0) {
      list[at] = node;
      node.parent = this.parent;
    }
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  querySelector(selector) {
    const name = selector.replace(/^\./, '');
    const walk = node => {
      for (const child of node.children) {
        if (String(child.className).split(' ').includes(name)) return child;
        const deeper = walk(child);
        if (deeper) return deeper;
      }
      return null;
    };
    return walk(this);
  }
  set innerHTML(_value) {}
  focus() {}
  get isConnected() {
    return true;
  }
}

function loadWindowHalf(native) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scripts', '159-thread-designs.js'),
    'utf8'
  );
  const window = {
    tnaiNative: native,
    addEventListener() {},
    matchMedia: () => ({ matches: true }),
  };
  const sandbox = {
    window,
    document: {
      createElement: tag => new FakeNode(tag),
      addEventListener() {},
      removeEventListener() {},
      body: new FakeNode('body'),
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    requestAnimationFrame: fn => fn(),
    setTimeout,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return window.TnaiThreadDesigns;
}

// ---------- the window's half: which entries are designs ----------
const designs = loadWindowHalf({ designs: {} });
const act = (verb, what, extra = {}) => ({ kind: 'act', id: 'a', verb, what, ...extra });
const files = list => list.map(item => item.kind + ':' + item.file + ':' + item.how).join(' | ');

check(
  'a page the agent wrote',
  files(designs.find(act('Wrote', 'mock/settings-card.html'))) ===
    'page:mock/settings-card.html:wrote'
);
check(
  'an edited page is part of a site, not a design',
  !designs.find(act('Edited', 'index.html')).length
);
check(
  'a picture the agent wrote',
  files(designs.find(act('Wrote', 'art/logo.svg'))) === 'picture:art/logo.svg:wrote'
);
check(
  'a Codex patch of several files',
  files(designs.find(act('Wrote', 'a.png, notes.md, b.html'))) ===
    'picture:a.png:wrote | page:b.html:wrote'
);
check(
  'tnai show, plain',
  files(designs.find(act('Ran', 'tnai show mock.html'))) === 'page:mock.html:showed'
);
check(
  'tnai show, quoted, with a device',
  files(designs.find(act('Ran', 'x', { full: 'tnai show "my mock.html" tablet' }))) ===
    'page:my mock.html:showed'
);
check(
  'tnai show inside a PowerShell line',
  files(designs.find(act('Ran', 'cd site; tnai.cmd show .\\out\\chart.html'))) ===
    'page:.\\out\\chart.html:showed'
);
check('tnai show of something else', !designs.find(act('Ran', 'tnai show notes.md')).length);
const made = designs.find(act('Ran', 'python plot.py --out charts/sales.png', { at: 5000 }));
check(
  'a picture a command names, with its start time',
  files(made) === 'picture:charts/sales.png:made' && made[0].since === 5000
);
check(
  'a command without a start time adds no picture',
  !designs.find(act('Ran', 'python plot.py --out charts/sales.png')).length
);
check(
  'a command that only looks at a picture',
  !designs.find(act('Ran', 'cat shot.png', { at: 1 })).length &&
    !designs.find(act('Ran', 'Get-Item shot.png', { at: 1 })).length
);
check(
  'Cursor Agent made an image',
  files(designs.find(act('Made an image', 'hero.png'))) === 'picture:hero.png:wrote'
);
check('a read is not a design', !designs.find(act('Read', 'mock.html')).length);
check('not an action', !designs.find({ kind: 'say', text: 'mock.html' }).length);

// ---------- the window's half: where the cards go ----------
const asked = [];
const placing = loadWindowHalf({
  designs: {
    page: (paneId, file) => {
      asked.push(file);
      return Promise.resolve({ ok: true, refs: [] });
    },
    picture: () => Promise.resolve({ ok: true }),
  },
});
const allText = node => node.textContent + ' ' + node.children.map(allText).join(' ');
const state = { paneId: 'p1' };
const placed = [];
const add = node => placed.push(node);
placing.note(state, act('Wrote', 'mock.html'), add);
placing.note(state, act('Ran', 'tnai show mock.html'), add);
placing.note(state, act('Read', 'other.html'), add);
check('nothing is placed while the actions go on', placed.length === 0);
placing.place(state, add);
check(
  'one card for a page written and then shown',
  placed.length === 1 && placed[0].dataset.kind === 'page'
);
check('the card says the page was shown', allText(placed[0]).includes('a page it showed'));
placing.place(state, add);
check('placing again adds nothing', placed.length === 1);
placing.note(state, act('Wrote', 'a.png'), add);
placing.note(state, act('Wrote', 'b.png'), add);
placing.place(state, add);
check(
  'pictures without a page share one card',
  placed.length === 2 && placed[1].dataset.kind === 'picture'
);

// ---------- the main process's half ----------
async function mainHalf() {
  const designsMain = require('../desktop/thread-designs');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-designs-'));
  const project = path.join(top, 'project');
  const outside = path.join(top, 'outside');
  fs.mkdirSync(path.join(project, 'mock'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, 'mock', 'card.html'), '<h1>Card</h1>');
  fs.writeFileSync(path.join(project, 'site.html'), '<script src="app.js"></script>');
  fs.writeFileSync(path.join(outside, 'secret.html'), '<h1>No</h1>');
  fs.writeFileSync(path.join(project, 'old.png'), 'not really a picture');
  const old = Date.now() / 1000 - 3600;
  fs.utimesSync(path.join(project, 'old.png'), old, old);
  fs.writeFileSync(path.join(project, 'new.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  let sessionCwd = project;
  designsMain.init({
    sessionOf: paneId => (paneId === 'p1' ? { cwd: sessionCwd } : null),
    worktreeOf: () => null,
    projectRoot: () => project,
    nameOf: () => 'Kestrel',
    toWindow: () => {},
  });

  const page = await designsMain.page('p1', 'mock/card.html', { shot: false });
  check('a page inside the folder', page.ok && page.name === 'card.html', JSON.stringify(page));
  check(
    'it gets a page server address',
    /^http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}\//.test(page.url || '')
  );
  const site = await designsMain.page('p1', 'site.html', { shot: false });
  check('a page that asks for other files says which', site.ok && site.refs.includes('app.js'));
  const away = await designsMain.page('p1', path.join(outside, 'secret.html'), { shot: false });
  check('a page outside the thread’s folders is refused', !away.ok);
  const climb = await designsMain.page('p1', '../outside/secret.html', { shot: false });
  check('a path that climbs out is refused', !climb.ok);
  const wrongKind = await designsMain.page('p1', 'old.png', { shot: false });
  check('a picture is not a page', !wrongKind.ok);
  const unknown = await designsMain.page('nobody', 'mock/card.html', { shot: false });
  check('a panel with no session falls back to the open project', unknown.ok);
  check(
    'a network path is refused',
    !designsMain.locate('p1', '\\\\server\\share\\a.html', designsMain.PAGE).ok
  );

  const recent = await designsMain.picture('p1', 'new.svg', {
    since: Date.now() - 1000,
    check: true,
  });
  check('a picture the command changed', recent.ok);
  const stale = await designsMain.picture('p1', 'old.png', {
    since: Date.now() - 1000,
    check: true,
  });
  check('a picture the command only named', !stale.ok);
  const written = await designsMain.picture('p1', 'old.png', { check: true });
  check('a picture the agent wrote needs no time', written.ok);
  const whole = await designsMain.picture('p1', 'new.svg', { large: true });
  check(
    'a picture whole, as a data address',
    /^data:image\/svg\+xml;base64,/.test(whole.image || '')
  );

  // a session started in the home folder shows nothing from it
  sessionCwd = os.homedir();
  const roots = designsMain.rootsOf('p1');
  check(
    'the home folder is never a root',
    !roots.some(root => path.resolve(root).toLowerCase() === os.homedir().toLowerCase())
  );
  require('../desktop/show-file').stop();
  fs.rmSync(top, { recursive: true, force: true });
}

mainHalf()
  .catch(error => check('main half ran', false, error?.stack || String(error)))
  .then(() => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
