// Test of desktop/remote-browse.js: node tools/remote-browse-test.js (plain Node; also run it in
// Electron's Node). Another computer's project files: the path rule, the secrets that never leave,
// the kinds that are never sent, the lock holder, the packing, and both ends joined in memory over
// a stand-in link (list, read, cut, save, changed, locked, hidden, project, limits, a switch that
// goes off mid-answer, out-of-order pieces). The files are a stand-in map; nothing touches the
// disk, opens a window or starts a CLI.
'use strict';
const crypto = require('crypto');
const browse = require('../desktop/remote-browse.js');
const {
  createBrowseAnswerer,
  createBrowseAsker,
  safePath,
  isSecret,
  kindOf,
  looksBinary,
  hiddenCount,
  holderOf,
  pieces,
  packEntries,
  shapeEntry,
  hashOf,
  FILE_MAX,
  PIECE_BYTES,
  ASKS_MIN,
  SAVES_MIN,
} = browse;
const { MAX_PLAIN } = require('../desktop/remote-noise.js');

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const settleAll = async () => {
  for (let step = 0; step < 20; step++) await settle();
};

// ---------- a stand-in project and link ----------
const KEY = 'a'.repeat(40);

function world(options = {}) {
  let clock = 1000;
  const files = new Map(options.files || []);
  const folders = new Map(options.folders || [['', []]]);
  const heldLocks = options.locks || [];
  let right = true;
  let roomLeft = 70;
  const wire = [];
  const saved = [];
  const timers = [];
  const answerer = createBrowseAnswerer({
    now: () => clock,
    may: () => right,
    openKey: () => (options.key === undefined ? KEY : options.key),
    caseBlind: true,
    list: async path => {
      if (!folders.has(path)) throw new Error('ENOENT');
      return folders.get(path);
    },
    stat: async path => {
      if (!files.has(path)) throw new Error('ENOENT');
      return { size: files.get(path).length };
    },
    read: async (path, max) => files.get(path).subarray(0, max),
    write: async (path, bytes) => {
      files.set(path, Buffer.from(bytes));
      return true;
    },
    locks: () => heldLocks,
    send: (peerId, obj) => {
      const copy = JSON.parse(JSON.stringify(obj));
      if (Buffer.byteLength(JSON.stringify(copy)) > MAX_PLAIN) wire.push({ tooBig: true });
      wire.push({ to: peerId, obj: copy });
      return true;
    },
    room: () => roomLeft,
    onSaved: (peerId, path) => saved.push(path),

    // The real path, as fs-service and realpathSync.native would give it: options.links maps a
    // name (a short name, a link, a junction) to where it really leads; anything else is itself
    // while it exists.
    real: async path => {
      const links = options.links || {};
      if (Object.hasOwn(links, path)) return links[path];
      return files.has(path) || folders.has(path) ? path : null;
    },
  });
  const asker = createBrowseAsker({
    now: () => clock,
    key: () => KEY,
    timers: {
      set: (fn, ms) => {
        const handle = { fn, at: clock + ms };
        timers.push(handle);
        return handle;
      },
      clear: handle => {
        handle.fn = null;
      },
    },
    send: (peerId, obj) => {
      const copy = JSON.parse(JSON.stringify(obj));
      if (Buffer.byteLength(JSON.stringify(copy)) > MAX_PLAIN) wire.push({ tooBig: true });
      if (options.dropFromWatcher) return true;
      answerer.receive('watcher', options.mangle ? options.mangle(copy) : copy);
      return true;
    },
  });

  // answers go back to the watcher when `deliver` runs
  const deliver = async () => {
    await settleAll();
    while (wire.length) {
      const item = wire.shift();
      if (item.obj) asker.receive('target', item.obj);
    }
  };
  return {
    answerer,
    asker,
    files,
    wire,
    saved,
    deliver,
    tick: ms => {
      clock += ms;
      for (const handle of timers) if (handle.fn && handle.at <= clock) handle.fn();
    },
    setRight: value => (right = value),
    setRoom: value => (roomLeft = value),
    sent: () => wire.length,
  };
}

(async () => {
  // ---------- the path rule ----------
  check('path: the project folder', safePath('') === '');
  check('path: a plain file', safePath('src/app.js') === 'src/app.js');
  for (const bad of [
    '..',
    'a/../b',
    './a',
    '/etc/passwd',
    'C:/x',
    'C:\\x',
    'a\\b',
    'a//b',
    'a/',
    'a/.',
    'con',
    'src/NUL.txt',
    'name.',
    'name ',
    'a\u0000b',
    'a\nb',
    'x'.repeat(401),
    'a/' + 'b'.repeat(121),
    'file:stream',
    'a?b',
    null,
    42,
  ])
    check('path refused: ' + JSON.stringify(bad), safePath(bad) === null);
  check(
    'path refused: a direction mark',
    safePath('a' + String.fromCharCode(0x202e) + 'b') === null
  );

  // ---------- secrets ----------
  for (const secret of [
    '.env',
    '.env.local',
    'app/.env.production',
    '.git/config',
    '.ssh/id_rsa',
    'id_ed25519.pub',
    'certs/server.pem',
    'server.key',
    '.npmrc',
    'credentials.json',
    'deploy/.aws/credentials',
    '.tnai/agents.json',
    'secrets/token.txt',
    'secret.yaml',
    'infra/terraform.tfstate',
    'service-account-prod.json',
  ])
    check('hidden: ' + secret, isSecret(secret));
  for (const plain of ['src/env.js', 'environment.md', 'docs/keys.md', 'README.md', 'keyboard.js'])
    check('not hidden: ' + plain, !isSecret(plain));

  // ---------- kinds ----------
  check('kind: code is text', kindOf('a.js') === 'text' && kindOf('Makefile') === 'text');
  check('kind: a picture', kindOf('logo.PNG') === 'picture');
  check('kind: a PDF', kindOf('CP_575_G.pdf') === 'PDF');
  check('kind: a program', kindOf('tool.exe') === 'program');
  check('bytes: text', !looksBinary(Buffer.from('hello é')));
  check('bytes: a zero byte', looksBinary(Buffer.from([65, 0, 66])));
  check('bytes: not UTF-8', looksBinary(Buffer.from([0xc3, 0x28, 0x41, 0x42, 0x43])));
  const euro = Buffer.from('ab€');
  check('bytes: a character cut at the end is still text', !looksBinary(euro.subarray(0, 4)));
  check(
    'hidden characters counted',
    hiddenCount('a' + String.fromCodePoint(0x202e, 0xe0041) + 'b') === 2
  );
  check('hidden characters: none in plain text', hiddenCount('plain → text') === 0);

  // ---------- the lock holder ----------
  const locks = [{ file: 'Src/App.js', name: 'Wren' }];
  check('lock: holder found, case blind', holderOf(locks, 'src/app.js', true) === 'Wren');
  check('lock: case kept elsewhere', holderOf(locks, 'src/app.js', false) === '');
  check('lock: other file free', holderOf(locks, 'src/other.js', true) === '');
  check(
    'lock: backslash path',
    holderOf([{ file: 'src\\a.js', name: 'X' }], 'src/a.js', true) === 'X'
  );

  // ---------- packing ----------
  const big = crypto.randomBytes(FILE_MAX);
  const list = pieces(big);
  check(
    'pieces: every piece fits one message',
    list.every(
      data =>
        Buffer.byteLength(JSON.stringify({ t: 'fssave', n: 'f'.repeat(16), i: 99, data })) <=
        MAX_PLAIN
    )
  );
  check('pieces: join back', Buffer.concat(list.map(d => Buffer.from(d, 'base64'))).equals(big));
  check('pieces: size per piece', PIECE_BYTES > 2500 && PIECE_BYTES < MAX_PLAIN);
  const many = [];
  for (let at = 0; at < 500; at++)
    many.push(['file-' + 'x'.repeat(60) + at + '.js', 'f', 10, 'text']);
  const packed = packEntries(many);
  check('entries: at most 4 parts', packed.parts.length <= 4);
  check(
    'entries: each part fits',
    packed.parts.every(
      part =>
        Buffer.byteLength(
          JSON.stringify({
            t: 'fs',
            n: 'f'.repeat(16),
            i: 0,
            parts: 4,
            op: 'list',
            path: 'p'.repeat(400),
            hidden: 99999,
            more: 99999,
            entries: part,
          })
        ) <= MAX_PLAIN
    )
  );
  check('entries: the rest is counted', packed.more + packed.parts.flat().length === 500);
  check(
    'entry shape: ok',
    JSON.stringify(shapeEntry(['a.js', 'f', 3, 'text'])) === '["a.js","f",3,"text"]'
  );
  check('entry shape: a slash refused', shapeEntry(['a/b', 'f', 3, 'text']) === null);
  check('entry shape: dot-dot refused', shapeEntry(['..', 'd', -1, '']) === null);
  check(
    'entry shape: unknown kind reads binary',
    shapeEntry(['a', 'f', 1, 'weird'])[3] === 'binary'
  );
  check('entry shape: wrong length', shapeEntry(['a', 'f', 1]) === null);

  // ---------- both ends: a list ----------
  {
    const w = world({
      folders: [
        [
          '',
          [
            { name: 'src', kind: 'directory' },
            { name: 'README.md', kind: 'file' },
            { name: '.env', kind: 'file' },
            { name: '.git', kind: 'directory' },
            { name: 'logo.png', kind: 'file' },
          ],
        ],
      ],
    });
    check('list asked', w.asker.listFolder('target', '').state === 'asked');
    await w.deliver();
    const got = w.asker.get('target').list;
    check('list shown', got && got.state === 'shown');
    check('list: folders first', got.entries[0][0] === 'src' && got.entries[0][1] === 'd');
    check('list: secrets left out and counted', got.entries.length === 3 && got.hidden === 2);
    check(
      'list: a picture is listed with its kind',
      got.entries.some(e => e[0] === 'logo.png' && e[3] === 'picture')
    );
  }

  // ---------- read, cut, binary, hidden, missing ----------
  {
    const long = Buffer.from('x'.repeat(FILE_MAX + 500));
    const w = world({
      files: [
        ['src/a.js', Buffer.from('const a = 1;\n')],
        ['src/long.txt', long],
        ['src/bin.dat', Buffer.from([1, 2, 0, 3])],
        ['.env', Buffer.from('KEY=1')],
        ['logo.png', Buffer.from([1])],
      ],
    });
    w.asker.readFile('target', 'src/a.js');
    await w.deliver();
    let file = w.asker.get('target').file;
    check(
      'read: the text arrives',
      file.state === 'shown' && file.text === 'const a = 1;\n' && !file.cut
    );
    w.asker.readFile('target', 'src/long.txt');
    await w.deliver();
    file = w.asker.get('target').file;
    check(
      'read: a long file is cut at 40 KB',
      file.state === 'shown' && file.cut === true && file.text.length === FILE_MAX
    );
    w.tick(60000);
    w.asker.readFile('target', 'src/bin.dat');
    await w.deliver();
    check(
      'read: bytes that are not text are not sent',
      w.asker.get('target').file.state === 'binary'
    );
    w.asker.readFile('target', 'logo.png');
    await w.deliver();
    check(
      'read: a picture by name is not sent',
      w.asker.get('target').file.state === 'binary' && w.asker.get('target').file.kind === 'picture'
    );
    w.asker.readFile('target', '.env');
    await w.deliver();
    check('read: a secret is refused as hidden', w.asker.get('target').file.state === 'hidden');
    w.asker.readFile('target', 'nope.txt');
    await w.deliver();
    check('read: missing', w.asker.get('target').file.state === 'missing');
    check(
      'read: a bad path is never sent',
      w.asker.readFile('target', '../x').state === 'bad_path'
    );
  }

  // ---------- another project open there ----------
  {
    const w = world({ key: 'b'.repeat(40), files: [['a.txt', Buffer.from('hi')]] });
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    check(
      'project: another project open there is refused',
      w.asker.get('target').file.state === 'project'
    );
  }

  // ---------- save: ok, changed, locked, cut, hidden characters ----------
  {
    const w = world({
      files: [
        ['src/a.js', Buffer.from('one\n')],
        ['src/held.js', Buffer.from('held\n')],
      ],
      locks: [{ file: 'src/held.js', name: 'Wren (Claude Code)' }],
    });
    check(
      'save before a read is refused here',
      w.asker.save('target', 'src/a.js', 'x').state === 'not_read'
    );
    w.asker.readFile('target', 'src/a.js');
    await w.deliver();
    check('save asked', w.asker.save('target', 'src/a.js', 'two\n').state === 'asked');
    await w.deliver();
    check('save: saved', w.asker.get('target').save.state === 'saved');
    check('save: the file holds the new text', w.files.get('src/a.js').toString() === 'two\n');
    check('save: this computer was told where it landed', w.saved[0] === 'src/a.js');
    check('save: the held file is the new version', w.asker.get('target').file.text === 'two\n');

    // the next edit starts from the saved version: its base matches
    w.asker.save('target', 'src/a.js', 'three\n');
    await w.deliver();
    check(
      'save: a second save from the saved version',
      w.files.get('src/a.js').toString() === 'three\n'
    );

    // the file changed on the target meanwhile
    w.files.set('src/a.js', Buffer.from('changed there\n'));
    w.asker.save('target', 'src/a.js', 'four\n');
    await w.deliver();
    check('save: refused when the file changed', w.asker.get('target').save.state === 'changed');
    check(
      'save: nothing written over it',
      w.files.get('src/a.js').toString() === 'changed there\n'
    );

    // a file an agent holds
    w.tick(61000);
    w.asker.readFile('target', 'src/held.js');
    await w.deliver();
    w.asker.save('target', 'src/held.js', 'mine\n');
    await w.deliver();
    const s = w.asker.get('target').save;
    check(
      'save: locked with the holder named',
      s.state === 'locked' && s.holder === 'Wren (Claude Code)'
    );
    check('save: the held file is untouched', w.files.get('src/held.js').toString() === 'held\n');
  }
  {
    const w = world({ files: [['a.txt', Buffer.from('plain\n')]] });
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    w.asker.save('target', 'a.txt', 'pla' + String.fromCharCode(0x202e) + 'in\n');
    await w.deliver();
    check(
      'save: added direction marks are refused',
      w.asker.get('target').save.state === 'refused'
    );
    check('save: refused text not written', w.files.get('a.txt').toString() === 'plain\n');
  }
  {
    const w = world({ files: [['long.txt', Buffer.from('y'.repeat(FILE_MAX + 1))]] });
    w.asker.readFile('target', 'long.txt');
    await w.deliver();
    check(
      'save: a cut file cannot be saved',
      w.asker.save('target', 'long.txt', 'short').state === 'not_read'
    );
  }
  {
    // a big save in many pieces arrives whole
    const text = 'z'.repeat(FILE_MAX - 10);
    const w = world({ files: [['b.txt', Buffer.from('b')]] });
    w.asker.readFile('target', 'b.txt');
    await w.deliver();
    w.asker.save('target', 'b.txt', text);
    await w.deliver();
    check('save: a 40 KB text in pieces', w.files.get('b.txt').toString() === text);
    check(
      'save: over 40 KB refused here',
      w.asker.save('target', 'b.txt', 'q'.repeat(FILE_MAX + 1)).state === 'large'
    );
  }
  {
    // pieces out of order or changed on the way
    const w = world({
      files: [['c.txt', Buffer.from('c')]],
      mangle: obj => (obj.t === 'fssave' && obj.i === 1 ? { ...obj, i: 2 } : obj),
    });
    w.asker.readFile('target', 'c.txt');
    await w.deliver();
    w.asker.save('target', 'c.txt', 'new');
    await w.deliver();
    check(
      'save: a piece out of order fails',
      w.asker.get('target').save.state === 'failed' && w.files.get('c.txt').toString() === 'c'
    );
  }
  {
    const w = world({
      files: [['d.txt', Buffer.from('d')]],
      mangle: obj =>
        obj.t === 'fssave' && obj.i === 1
          ? { ...obj, data: Buffer.from('evil').toString('base64') }
          : obj,
    });
    w.asker.readFile('target', 'd.txt');
    await w.deliver();
    w.asker.save('target', 'd.txt', 'good');
    await w.deliver();
    check(
      'save: bytes changed on the way fail the hash',
      w.asker.get('target').save.state === 'failed' && w.files.get('d.txt').toString() === 'd'
    );
  }

  // ---------- review of item 47: H1, files that run commands are never saved ----------
  for (const runs of [
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.codex/config.toml',
    '.cursor/mcp.json',
    '.opencode/plugin.js',
    'opencode.json',
    'opencode.jsonc',
    '.mcp.json',
    '.vscode/tasks.json',
    '.idea/workspace.xml',
    '.husky/pre-commit',
    '.githooks/post-checkout',
    'lefthook.yml',
    '.lefthook-local.yml',
    '.pre-commit-config.yaml',
    '.envrc',
    '.github/workflows/ci.yml',
    'app/.vscode/tasks.json',
  ])
    check('runs commands, never saved: ' + runs, browse.runsCommands(runs));
  for (const plain of ['src/app.js', '.github/README.md', 'docs/claude.md', 'vscode.md'])
    check('may be saved: ' + plain, !browse.runsCommands(plain));
  for (const path of [
    '.claude/settings.json',
    '.vscode/tasks.json',
    '.mcp.json',
    '.envrc',
    '.github/workflows/ci.yml',
  ]) {
    const w = world({ files: [[path, Buffer.from('{}\n')]] });
    w.asker.readFile('target', path);
    await w.deliver();
    check('H1: ' + path + ' can still be read', w.asker.get('target').file.state === 'shown');
    check(
      'H1: ' + path + ' is marked read-only for the window',
      w.asker.get('target').file.readOnly === true
    );
    w.asker.save('target', path, '{"hooks":{"PreToolUse":[{"command":"calc"}]}}\n');
    await w.deliver();
    check(
      'H1: a save of ' + path + ' is refused and nothing written',
      w.asker.get('target').save.state === 'guarded' && w.files.get(path).toString() === '{}\n'
    );
  }
  {
    // a link inside the project to a file that runs commands is refused by its real path
    const w = world({
      files: [['notes.json', Buffer.from('{}')]],
      links: { 'notes.json': '.claude/settings.json' },
    });
    w.asker.readFile('target', 'notes.json');
    await w.deliver();
    w.asker.save('target', 'notes.json', '{"hooks":1}');
    await w.deliver();
    check(
      'H1: a link to .claude/settings.json is refused by its real path',
      w.asker.get('target').save.state === 'guarded'
    );
  }

  // ---------- review of item 47: M1, short names, links and junctions to secrets ----------
  check(
    'M1: a short name is never taken',
    safePath('GIT~1/config') === null && safePath('TNAI~1/agents.json') === null
  );
  check('M1: a tilde without a digit is fine', safePath('backup~old.txt') === 'backup~old.txt');
  check('M1: .dev.vars is a secret', isSecret('.dev.vars') && isSecret('worker/.dev.vars'));
  check('M1: *.tfvars is a secret', isSecret('prod.tfvars') && isSecret('infra/dev.tfvars.json'));

  // ---------- review 23, L4: root CP* files and tax notices are never listed ----------
  check(
    'L4: a root CP* file is hidden',
    isSecret('CP_575_G.pdf') && isSecret('CPanything.txt') && isSecret('CP575')
  );
  check(
    'L4: a tax notice named the IRS way is hidden anywhere',
    isSecret('docs/cp575.pdf') && isSecret('tax/CP_2000.pdf') && isSecret('a/CP-575 letter.png')
  );
  check(
    'L4: other names are not',
    !isSecret('docs/CPU.md') && !isSecret('cpp/main.cpp') && !isSecret('cpu-notes.md')
  );
  {
    const w = world({
      folders: [
        [
          '',
          [
            { name: 'CP_575_G.pdf', kind: 'file' },
            { name: 'README.md', kind: 'file' },
          ],
        ],
      ],
    });
    w.asker.listFolder('target', '');
    await w.deliver();
    const got = w.asker.get('target').list;
    check(
      'L4: the list leaves the CP file out and counts it',
      got && got.entries.length === 1 && got.entries[0][0] === 'README.md' && got.hidden === 1
    );
  }
  {
    const w = world({
      files: [
        ['readme-link.txt', Buffer.from('KEY=secret')],
        ['data/notes.txt', Buffer.from('KEY=secret')],
      ],
      links: { 'readme-link.txt': '.env', 'data/notes.txt': '.git/config', outside: null },
      folders: [
        ['', []],
        ['data', []],
      ],
    });
    w.asker.readFile('target', 'readme-link.txt');
    await w.deliver();
    check(
      'M1: a link to .env is refused by its real path',
      w.asker.get('target').file.state === 'hidden'
    );
    w.tick(61000);
    w.asker.readFile('target', 'data/notes.txt');
    await w.deliver();
    check(
      'M1: a junction into .git is refused by its real path',
      w.asker.get('target').file.state === 'hidden'
    );
  }
  {
    // no real path known (outside the project, or the dependency missing): nothing is read
    const w = world({ files: [['a.txt', Buffer.from('a')]], links: { 'a.txt': null } });
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    check('M1: no real path, nothing read', w.asker.get('target').file.state === 'missing');
  }
  {
    // the file is swapped for a link to a secret between the read of the version and the write
    let calls = 0;
    const w = world({ files: [['b.txt', Buffer.from('b')]] });
    w.asker.readFile('target', 'b.txt');
    await w.deliver();
    const answerer = createBrowseAnswerer({
      may: () => true,
      openKey: () => KEY,
      stat: async () => ({ size: 1 }),
      read: async () => Buffer.from('b'),
      write: async () => {
        throw new Error('must not write');
      },
      real: async () => (++calls === 1 ? 'b.txt' : '.env'),
      send: (peerId, obj) => {
        answered.push(obj);
        return true;
      },
      room: () => 70,
    });
    const answered = [];
    const bytes = Buffer.from('new');
    answerer.receive('x', {
      t: 'fssave',
      n: 'd'.repeat(16),
      i: 0,
      parts: 2,
      p: KEY,
      path: 'b.txt',
      base: hashOf(Buffer.from('b')),
      size: bytes.length,
      hash: hashOf(bytes),
    });
    answerer.receive('x', { t: 'fssave', n: 'd'.repeat(16), i: 1, data: bytes.toString('base64') });
    await settleAll();
    check(
      'M1: a link put in place before the write is refused',
      answered.some(obj => obj.state === 'refused') && calls === 2
    );
  }
  {
    const path = require('path');
    check(
      'real path: inside',
      browse.realRelative('C:\\p', 'C:\\p\\.git\\config', path.win32) === '.git/config'
    );
    check('real path: the root', browse.realRelative('C:\\p', 'C:\\p', path.win32) === '');
    check('real path: outside', browse.realRelative('C:\\p', 'C:\\other\\x', path.win32) === null);
    check(
      'real path: another drive',
      browse.realRelative('C:\\p', 'D:\\p\\x', path.win32) === null
    );
    check('real path: posix', browse.realRelative('/p', '/p/a/b', path.posix) === 'a/b');
  }

  // ---------- the right ----------
  {
    const w = world({ files: [['a.txt', Buffer.from('a')]] });
    w.setRight(false);
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    check('right off: nothing answered', w.asker.get('target').file.state === 'asked');
    w.tick(31000);
    check(
      'right off: the watcher reads no answer',
      w.asker.get('target').file.state === 'no_answer'
    );
  }
  {
    // the switch goes off while the read waits for the disk: nothing leaves
    const w = world({ files: [['a.txt', Buffer.from('a')]] });
    w.asker.readFile('target', 'a.txt');
    w.setRight(false);
    await w.deliver();
    check('right off mid-job: nothing sent', w.asker.get('target').file.state === 'asked');
  }
  {
    // the session ends mid-job
    const w = world({ files: [['a.txt', Buffer.from('a')]] });
    w.asker.readFile('target', 'a.txt');
    w.answerer.endFor('watcher');
    await w.deliver();
    check('session end mid-job: nothing sent', w.asker.get('target').file.state === 'asked');
  }

  // ---------- limits ----------
  {
    const w = world({ files: [['a.txt', Buffer.from('a')]] });
    let answered = 0;
    for (let at = 0; at < ASKS_MIN + 10; at++) {
      w.asker.readFile('target', 'a.txt');
      await w.deliver();
      if (w.asker.get('target').file.state !== 'asked') answered++;
    }
    check(
      'limit: at most ' + ASKS_MIN + ' asks a minute answered',
      answered <= ASKS_MIN && answered > 0
    );
    w.tick(61000);
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    check('limit: a new minute answers again', w.asker.get('target').file.state === 'shown');
  }
  {
    const w = world({ files: [['a.txt', Buffer.from('a')]] });
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    let saves = 0;
    for (let at = 0; at < SAVES_MIN + 4; at++) {
      w.asker.save('target', 'a.txt', 'v' + at);
      await w.deliver();
      if (w.asker.get('target').save.state === 'saved') saves++;
    }
    check('limit: at most ' + SAVES_MIN + ' saves a minute', saves === SAVES_MIN);
  }
  {
    const w = world({ files: [['a.txt', Buffer.from('a'.repeat(30000))]] });
    w.setRoom(3);
    w.asker.readFile('target', 'a.txt');
    await w.deliver();
    check(
      'room: an answer that cannot finish says busy',
      w.asker.get('target').file.state === 'busy'
    );
  }
  {
    // the target is handed messages of every wrong shape: nothing throws
    const w = world({});
    let threw = false;
    try {
      for (const bad of [
        null,
        1,
        'x',
        {},
        { t: 'fsask' },
        { t: 'fsask', n: 'zz' },
        { t: 'fssave', i: 5 },
        { t: 'fssave', n: 'f'.repeat(16), i: 0, parts: 9999 },
      ])
        w.answerer.receive('watcher', bad);
      w.answerer.receive('', { t: 'fsask' });
      w.answerer.receive('__proto__', { t: 'fsask', n: 'a'.repeat(16), op: 'list', path: '' });
    } catch {
      threw = true;
    }
    await settleAll();
    check('shapes: nothing a message does throws', !threw);
    check(
      'every message the two sides sent fits one sealed message',
      !w.wire.some(item => item.tooBig)
    );
  }
  {
    // an answer for a number nobody asked with is dropped
    const w = world({});
    check(
      'watcher: an answer it did not ask for is dropped',
      w.asker.receive('target', { t: 'fs', n: 'c'.repeat(16), state: 'saved' }) === false
    );
    w.asker.drop();
    check('watcher: drop leaves nothing', w.asker.get('target').list === null);
  }
  check(
    'hash helper',
    hashOf(Buffer.from('a')) === crypto.createHash('sha256').update('a').digest('hex')
  );

  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('ERROR ' + (error.stack || error));
  process.exit(1);
});
