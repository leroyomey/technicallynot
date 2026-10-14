// Technically Not tools · desktop-check/tests/cli-screen-tui-input.main.js — Main-process side of
// cli-screen-tui-input.js: writes a tiny fake TUI (raw-mode stdin, optional SGR mouse tracking)
// that appends every chunk it receives to a log file, and reads that log back.
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path');

const TUI = `const fs = require('fs'), log = process.argv[2], mouse = process.argv[3] === 'mouse';
fs.writeFileSync(log, '');
process.stdin.setRawMode(true); process.stdin.resume();
process.stdout.write('TUI ' + 'READY\\r\\n' + (mouse ? '\\x1b[?1000h\\x1b[?1006h' : ''));
process.stdin.on('data', d => {
  const s = d.toString('latin1'); fs.appendFileSync(log, JSON.stringify(s) + '\\n');
  if (s[0] === 'q') { process.stdout.write('\\x1b[?1000l\\x1b[?1006lTUI ' + 'DONE\\r\\n'); process.exit(0); }
});
`;

module.exports = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-tui-')),
    script = path.join(dir, 'tui.js'),
    log = path.join(dir, 'in.log');
  fs.writeFileSync(script, TUI);
  return {
    paths: () => ({ script, log }),
    // Every chunk the fake TUI received, in order.
    read: () => {
      try {
        return fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(l => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
};
