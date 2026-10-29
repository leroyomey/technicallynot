// Technically Not browser check · project-folder.head.js — runs after the shared empty desktop
// bridge (tools/browser-check/stand-in.js) and before the app's scripts. It puts in the bridge's
// `fs` part as a small project folder kept in memory, answering in the shapes desktop/main.js
// answers (`{ ok, value }`, and `root()` the folder's path or null), so 00's native handles and the
// rail (09) run as in the desktop app, on the thread layout. The folder picker answers this
// folder; which folder is open is kept in localStorage, so phase 2 (a reload in the same browser
// profile) finds it again, as the desktop process remembers it.
// (Before 2026-10-28 this stood in for the plain browser's own folder picker, which the browser
// build no longer reaches: in a plain browser the app only says it runs on the desktop.)
(() => {
  const FOLDER = 'C:\\Users\\someone\\demo-project';
  const OPEN_KEY = 'tnai.browser-check.open-folder';
  const encode = text => new TextEncoder().encode(text);

  // path → contents (a Uint8Array) for files, null for folders
  const tree = new Map([
    ['src', null],
    ['src/app.ts', encode('export const a = 1;\r\nexport const b = 2;\r\n')],
    ['README.md', encode('# Demo\n')],
    ['logo.png', new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13, 1, 2, 3])],
    ['latin1.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9])],
    ['big-folder', null],
  ]);
  for (let index = 0; index < 1003; index++) tree.set('big-folder/f' + index + '.txt', encode('x'));

  const isOpen = () => {
    try {
      return localStorage.getItem(OPEN_KEY) === FOLDER;
    } catch {
      return false;
    }
  };
  const ok = value => Promise.resolve({ ok: true, value });
  const fail = error => Promise.resolve({ ok: false, error });
  const parentOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const calls = [];

  const fs = {
    root: () => Promise.resolve(isOpen() ? FOLDER : null),
    pick: () => {
      calls.push('pick');
      try {
        localStorage.setItem(OPEN_KEY, FOLDER);
      } catch {}
      return ok(FOLDER);
    },
    forget: () => {
      try {
        localStorage.removeItem(OPEN_KEY);
      } catch {}
      return ok(true);
    },
    projects: () =>
      ok(
        isOpen()
          ? {
              active: FOLDER,
              projects: [{ path: FOLDER, name: 'demo-project', active: true, missing: false }],
            }
          : { active: '', projects: [] }
      ),
    lanes: () => Promise.resolve([]),
    list: rel => {
      const folder = String(rel || '');
      if (folder && tree.get(folder) !== null) return fail('Not a folder: ' + folder);
      const entries = [...tree.keys()]
        .filter(path => parentOf(path) === folder)
        .map(path => ({
          name: path.split('/').pop(),
          kind: tree.get(path) === null ? 'directory' : 'file',
        }));
      return ok(entries);
    },
    stat: rel => {
      const bytes = tree.get(String(rel || ''));
      if (!bytes) return fail('Not a file: ' + rel);
      return ok({ size: bytes.byteLength, lastModified: 1761600000000 });
    },
    read: (rel, start, end) => {
      const bytes = tree.get(String(rel || ''));
      if (!bytes) return fail('Not a file: ' + rel);
      return ok(bytes.slice(start || 0, end ?? bytes.byteLength));
    },

    // the whole-project file name search of the Files tab (24), as fs-service answers it
    search: query => {
      const words = String(query || '').toLowerCase();
      const results = [...tree.keys()]
        .filter(path => tree.get(path) !== null && path.split('/').pop().includes(words))
        .map(path => ({ name: path.split('/').pop(), path }));
      return ok({ results, truncated: false, total: results.length, timedOut: false, ms: 1 });
    },

    // the test checks that nothing writes into the folder
    write: rel => {
      calls.push('write ' + rel);
      return ok(true);
    },
  };
  window.__folder = { tree, calls, FOLDER };

  // every other fs call (onChanges, watching…) stays the empty stand-in's
  const empty = window.tnaiNative.fs;
  window.__standIn.use(
    'native.fs',
    new Proxy(fs, { get: (own, key) => (key in own ? own[key] : empty[key]) })
  );
})();
