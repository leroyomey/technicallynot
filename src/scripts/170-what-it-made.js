// Technically Not · 170-what-it-made.js — Desktop only: "What it made". The "Worked for" block that
// ends a task in the conversation (122 `addWorked`) also says what the task made and lets each
// thing be looked at in place, without asking the agent to show it (user 2026-10-21, mock
// docs/plans/design-concepts/what-it-made.html, round 2).
//
// - Found by the app from the conversation's own entries (desktop/thread-log-*.js, so every CLI
//   with a reader): a file the agent wrote whole ("Wrote", "Made an image") that is a picture, a
//   video, a document, a data file or a page; a picture, video, document or data file a part of a
//   command writes (`>`, a copy or move target, `sed -i`, Set-Content, a known writer) and that
//   changed while it ran, unless another panel held its file lock then (inferred from the file's
//   change time, said so on hover); a site
//   it showed or claimed (`tnai preview URL`, `tnai server claim URL`) or a local address a command
//   printed, and Live preview's own record of which agent showed which address (31 `tabs`).
// - The block's head says "Worked for 6m 12s · made 3 things, changed 4 files". Under it one
//   neutral surface with a group per kind and its count (user 2026-10-28 chose "Proposed" in
//   docs/plans/design-concepts/info-layout.html): Documents and Data as rows (name, then title or
//   row count), Pictures, Pages and Sites as small cards, and Changed files last (the file list
//   122 drew, and "Open Changes" for Details › Changes). A task that made
//   nothing keeps its block as it was.
// - A press previews in place, under the row or the group's cards, at a fixed height (49 px of
//   fade at the foot), with one button for
//   the full view: a site → Live preview; a picture → Open large (159's layer); a video → the
//   computer's own player (the window's content rules play no video); a document → the Files tab;
//   a data file → a bar or line of its first number column, or a table, and "Open the data".
// - A site says whether it answers now (asked once when drawn or pressed, never on a timer):
//   running (green dot, address, which agent) or stopped (grey). "Stop it" and "Start it again" go
//   through Live preview's own server path (31 `stop`, `start`, `addScript`), only where that path
//   can do it: a server the app started itself, or the project's own dev script.
// - Only the newest block that made something is open; older ones fold to one line.
// - Settings › Agents, "What agents made": "Show what it made after each task" (on) and "Open Live
//   preview by itself when an agent starts a site" (off). With the second on, a site an agent
//   starts while you watch opens beside the thread in the side column's Live preview tab (131),
//   marked "opened by itself", one tab per address.
//
// window.TnaiWhatItMade (note, result, block, prefs, set, and for the test: find, sitesIn,
// readTable, chartOf, recordLocks, heldByOther). Look: src/styles/51-what-it-made.css. Tests: node
// tools/what-it-made-test.js, desktop test `what-it-made`.
(() => {
  'use strict';
  const native = window.tnaiNative;

  // ---------- the kinds of things a task makes ----------
  const KINDS = [
    ['picture', /\.(png|jpe?g|webp|gif|svg)$/i],
    ['video', /\.(mp4|webm|mov|m4v)$/i],
    ['document', /\.(md|markdown|txt|rst|adoc)$/i],
    ['data', /\.(csv|tsv|json)$/i],
    ['page', /\.html?$/i],
  ];
  const kindOf = file => (KINDS.find(([, test]) => test.test(String(file || ''))) || [''])[0];

  // the kinds a command can make: a file written by a command ends in one of these
  const FILE_FROM_COMMAND = /\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|m4v|md|txt|csv|tsv|json)$/i;
  const MAX_FROM_COMMAND = 6;

  // `tnai preview URL` and `tnai server claim URL`, as typed in any shell
  const SITE_COMMAND =
    /\btnai(?:\.cmd|\.exe)?\s+(?:preview|server\s+claim)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/i;
  const LOCAL_ADDRESS =
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(?:\/[^\s"'<>)\]]*)?/gi;

  const unquote = text => String(text || '').replace(/^["']|["']$/g, '');
  const baseName = file =>
    String(file || '')
      .split(/[\\/]/)
      .pop();

  // An address as Live preview keeps it: its origin and path, no trailing dot or comma.
  function cleanAddress(raw) {
    const text = String(raw || '').replace(/[.,;:]+$/, '');
    try {
      const address = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'http://' + text);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) return '';

      // the app's own local addresses are not a site the agent made: its hook server
      // (/hook/<key>, written in every agent's settings) and the pages `tnai show` serves
      // (/s/<key>/, a design card's job, 159) (learned 2026-10-21: the hook address showed as
      // "Site running")
      if (/^\/(hook|s)\/[0-9a-f]{16,}/i.test(address.pathname)) return '';
      return address.origin + (address.pathname === '/' ? '/' : address.pathname);
    } catch {
      return '';
    }
  }

  // An action entry → what it made: [{ kind, file, how, since }] and sites [{ url, how }].
  // `how`: 'wrote' (the agent's own write), 'made' (a command changed it, inferred), 'showed'.
  function find(entry) {
    const made = [];
    if (!entry || entry.kind !== 'act') return made;
    const verb = String(entry.verb || '');
    const what = String(entry.what || '');
    if (verb === 'Wrote' || verb === 'Made an image') {
      // a patch of several files names them joined by ", " (thread-log-codex.js)
      for (const part of what.split(/,\s+/)) {
        const file = part.trim();
        const kind = kindOf(file) || (verb === 'Made an image' ? 'picture' : '');
        if (kind) made.push({ kind, file, how: 'wrote', since: 0 });
      }
      return made;
    }
    if (verb !== 'Ran') return made;
    const command = String(entry.full || what);

    // A file a command made can only be told by its change time: a command without a recorded
    // start time adds none. Only a file a part of the command writes counts (writtenBy): a file
    // it only reads, searches or checks is not made by it (learned 2026-10-28: `cd …; grep …
    // ISSUES.md` showed ISSUES.md as made, because only the first word was judged).
    if (!entry.at) return made;
    const seen = new Set();
    for (const file of writtenBy(command)) {
      if (seen.has(file.toLowerCase()) || seen.size >= MAX_FROM_COMMAND) continue;
      seen.add(file.toLowerCase());
      made.push({ kind: kindOf(file), file, how: 'made', since: entry.at });
    }
    return made;
  }

  // ---------- which files a command writes ----------
  // Every agent CLI's shell commands arrive here as typed (bash, PowerShell, cmd; Codex's and
  // OpenCode's wrapped in `bash -lc` or `powershell -Command`). A command is cut into its parts
  // (`;`, `&&`, `||`, `|`, a new line) and each part is judged on its own.

  // programs that only read, search, list, check or remove: a file they name is not written
  // (a redirect `> file` after them still is)
  const READERS = new Set(
    (
      'cat type less more head tail ls dir stat file git rm del erase rmdir rd remove-item ri ' +
      'get-content gc get-item gi get-childitem gci test-path start start-process explorer code ' +
      'grep egrep fgrep rg ag findstr find select-string sls awk gawk wc sort uniq diff cmp fc ' +
      'comm cut tr nl od xxd hexdump md5sum sha256sum certutil get-filehash where where.exe which ' +
      'where-object select-object foreach-object measure-object format-table format-list echo ' +
      'printf write-host write-output cd chdir set-location sl pushd popd jq yq tnai tnai.cmd ' +
      'gh npm pnpm yarn exit true false sleep start-sleep test'
    ).split(' ')
  );

  // programs whose files are all written (sed -i and perl -i are judged by their flag)
  const TOUCHERS = new Set('touch tee tee-object'.split(' '));

  // PowerShell cmdlets that write the file in -Path / -FilePath / -LiteralPath or their first
  // plain argument
  const CONTENT_WRITERS = new Set(
    'set-content sc add-content ac out-file new-item ni export-csv export-clixml'.split(' ')
  );

  // copy and move: the last plain argument (or -Destination) is the one written
  const COPIERS = new Set(
    'cp copy copy-item cpi mv move move-item mi ren rename rename-item rni xcopy'.split(' ')
  );

  // tools whose last plain argument is the file they write
  const LAST_IS_OUTPUT = new Set('ffmpeg magick convert'.split(' '));

  // a shell that runs a script given after -c / -Command / /c: the script is judged instead
  const SHELLS = new Set('bash sh zsh dash pwsh powershell cmd'.split(' '));
  const SCRIPT_FLAG = /^(?:-l?c|-lc|-command|-c|\/c|\/k)$/i;

  // flags that name the file a program writes, in any program
  const OUTPUT_FLAG =
    /^(?:-o|--out|--output|--outfile|--out-file|-outfile|-out|-destination|--target)$/i;

  // a redirect into one of these writes no file
  const NO_FILE = /^(?:\/dev\/null|\$null|nul|null)$/i;

  // The words of one part, quotes taken off, with what each redirect points at:
  // { words: [...], written: [...files after > or >>] }.
  function wordsOf(part) {
    const words = [];
    const written = [];
    let word = '';
    let quoted = false;
    let target = false;
    const finish = () => {
      if (word || quoted) {
        if (target) {
          if (!NO_FILE.test(word)) written.push(word);
        } else words.push(word);
        target = false;
      }
      word = '';
      quoted = false;
    };
    for (let index = 0; index < part.length; index++) {
      const char = part[index];
      if (char === '"' || char === "'") {
        const end = part.indexOf(char, index + 1);
        const stop = end < 0 ? part.length : end;
        word += part.slice(index + 1, stop);
        quoted = true;
        index = stop;
      } else if (/\s/.test(char)) finish();
      else if (char === '>') {
        // `2>`, `*>` and `&>` name a stream, not a word; `>&1` copies a stream and writes no file
        if (/^(?:\d|\*|&)$/.test(word) && !quoted) word = '';
        finish();
        if (part[index + 1] === '>') index++;
        if (part[index + 1] === '&') {
          index++;
          while (/[\d-]/.test(part[index + 1] || '')) index++;
          continue;
        }
        target = true;
      } else if (char === '<') {
        // what a command reads from is not written; a here-document's word is not a file
        finish();
        while (part[index + 1] === '<' || part[index + 1] === '-') index++;
        word = '';
        target = false;
        const rest = part.slice(index + 1).match(/^\s*("[^"]*"|'[^']*'|\S+)/);
        if (rest) index += rest[0].length;
      } else word += char;
    }
    finish();
    return { words, written };
  }

  // The parts of a command: cut at `;`, `&&`, `||`, `|` and new lines outside quotes. A
  // here-document's lines and a PowerShell here-string are text, never parts.
  function partsOf(command) {
    const parts = [];
    let part = '';
    let heredoc = '';
    const text = String(command || '');
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const pair = text.slice(index, index + 2);
      if (char === '"' || char === "'") {
        const end = text.indexOf(char, index + 1);
        const stop = end < 0 ? text.length : end;
        part += text.slice(index, stop + 1);
        index = stop;
      } else if (pair === "@'" || pair === '@"') {
        const end = text.indexOf('\n' + pair[1] + '@', index + 2);
        const stop = end < 0 ? text.length : end + 2;
        part += pair[1] + text.slice(index + 2, stop - 1).replace(/[\r\n]/g, ' ') + pair[1];
        index = stop;
      } else if (pair === '<<' && !heredoc) {
        const word = text.slice(index + 2).match(/^-?\s*(["']?)(\w+)\1/);
        if (word) heredoc = word[2];
        part += char;
      } else if (char === '\n' || char === ';' || pair === '&&' || pair === '||' || char === '|') {
        if (pair === '&&' || pair === '||') index++;
        parts.push(part);
        part = '';

        // the lines of a here-document, up to its closing word, are skipped
        if (char === '\n' && heredoc) {
          const close = new RegExp('^[ \\t]*' + heredoc + '[ \\t]*$', 'm');
          const after = text.slice(index + 1);
          const found = close.exec(after);
          index = found ? index + 1 + found.index + found[0].length : text.length;
          heredoc = '';
        }
      } else part += char;
    }
    parts.push(part);
    return parts.map(each => each.trim()).filter(Boolean);
  }

  // The plain arguments of a part (no flags, and no value of a PowerShell -Name value pair).
  const SWITCHES = /^-(?:force|nonewline|append|recurse|confirm(?::\S*)?|whatif|passthru)$/i;

  function plainArguments(args) {
    const plain = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (/^-/.test(arg)) {
        // a PowerShell parameter takes the next word as its value unless it is a switch
        if (/^-[A-Za-z]{2,}$/.test(arg) && !SWITCHES.test(arg)) index++;
        continue;
      }
      plain.push(arg);
    }
    return plain;
  }

  // The value of a named parameter: -Path x, -Path:x.
  function namedValue(args, names) {
    for (let index = 0; index < args.length; index++) {
      const [name, inline] = args[index].split(/:(.*)/s);
      if (!names.test(name)) continue;
      if (inline) return inline;
      if (args[index + 1]) return args[index + 1];
    }
    return '';
  }

  // The files one part writes.
  function writtenByPart(part, depth) {
    const { words, written } = wordsOf(part);
    const out = [...written];

    // leading `NAME=value`, the call operator `&`, and `sudo` / `time` / `env` are not the program
    while (words.length && /^(?:[A-Za-z_]\w*=.*|&|sudo|time|env|command|exec)$/.test(words[0]))
      words.shift();
    if (!words.length) return out;
    const program = String(words[0].split(/[\\/]/).pop() || '')
      .toLowerCase()
      .replace(/\.(?:exe|cmd|bat|ps1)$/, '');
    const args = words.slice(1);
    const plain = plainArguments(args);
    if (SHELLS.has(program)) {
      const flag = args.findIndex(arg => SCRIPT_FLAG.test(arg));
      if (flag >= 0 && args[flag + 1] && depth < 3)
        out.push(...writtenBy(args.slice(flag + 1).join(' '), depth + 1));
      return out;
    }
    if (program === 'sed' || program === 'perl') {
      // only an in-place edit writes the files it names; `sed -n` and a plain sed only read
      if (args.some(arg => /^(?:-[a-z]*i\S*|--in-place\S*)$/i.test(arg))) out.push(...plain);
      return out;
    }
    if (READERS.has(program)) return out;

    // `-o file`, `--output file`, `-OutFile file`: the program writes that file, whatever it is
    const outputFlag = namedValue(args, OUTPUT_FLAG);
    if (outputFlag) out.push(outputFlag);
    if (TOUCHERS.has(program)) out.push(...plain);
    else if (CONTENT_WRITERS.has(program))
      out.push(namedValue(args, /^-(?:path|filepath|literalpath)$/i) || plain[0] || '');
    else if (COPIERS.has(program))
      out.push(namedValue(args, /^-destination$/i) || (plain.length > 1 ? plain.at(-1) : ''));
    else if (LAST_IS_OUTPUT.has(program)) out.push(plain.at(-1) || '');
    else {
      // any other program (a script it runs, a renderer): a picture or a video it names may be
      // its output; a document or data file it names is far more often what it reads
      out.push(...plain.filter(arg => /^(?:picture|video)$/.test(kindOf(arg))));
    }
    return out;
  }

  // The files a whole command writes, of the kinds a command can make, in the order named.
  function writtenBy(command, depth = 0) {
    const files = [];
    for (const part of partsOf(command))
      for (const file of writtenByPart(part, depth))
        if (file && FILE_FROM_COMMAND.test(file) && !files.includes(file)) files.push(file);
    return files;
  }

  // The sites in an action and its result: what it showed or claimed, and a local address a
  // command printed (a dev server says where it listens).
  function sitesIn(entry, result) {
    const sites = [];
    if (!entry || entry.verb !== 'Ran') return sites;
    const command = String(entry.full || entry.what || '');
    const shown = SITE_COMMAND.exec(command);
    const url = shown ? cleanAddress(unquote(shown[1])) : '';
    if (url) sites.push({ url, how: 'showed' });
    const printed = result ? String(result.more || result.text || '') : '';
    LOCAL_ADDRESS.lastIndex = 0;
    for (let match; (match = LOCAL_ADDRESS.exec(printed));) {
      const found = cleanAddress(match[0]);
      if (found && !sites.some(site => site.url === found))
        sites.push({ url: found, how: 'started' });
      if (sites.length >= 3) break;
    }
    return sites;
  }

  // ---------- a data file as a table, and the honest chart of it ----------
  function splitLine(line, separator) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === separator) {
        cells.push(cell.trim());
        cell = '';
      } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  // text and the file's name → { head: [names], rows: [[cells]] } or null
  function readTable(text, name) {
    const source = String(text || '');
    if (/\.json$/i.test(name)) {
      let value = null;
      try {
        value = JSON.parse(source);
      } catch {
        return null;
      }
      if (value && !Array.isArray(value) && typeof value === 'object') {
        const list = Object.values(value).find(Array.isArray);
        value = list || Object.entries(value).map(([key, item]) => ({ name: key, value: item }));
      }
      if (!Array.isArray(value) || !value.length) return null;
      if (value.every(item => typeof item === 'number'))
        return { head: ['value'], rows: value.map(item => [String(item)]) };
      const objects = value.filter(
        item => item && typeof item === 'object' && !Array.isArray(item)
      );
      if (!objects.length) return null;
      const head = [...new Set(objects.flatMap(item => Object.keys(item)))].slice(0, 12);
      const cellOf = item =>
        item == null ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item);
      return { head, rows: objects.map(item => head.map(key => cellOf(item[key]))) };
    }
    const separator = /\.tsv$/i.test(name) ? '\t' : ',';
    const lines = source.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return null;
    const head = splitLine(lines[0], separator);
    const rows = lines.slice(1).map(line => splitLine(line, separator));
    return { head, rows };
  }

  const asNumber = cell => {
    const text = String(cell ?? '')
      .replace(/[,$€£%\s]/g, '')
      .trim();
    if (!text || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(text)) return null;
    return Number(text);
  };

  // A table → what to draw: { type: 'bar' | 'line', label, values: [{ name, value }] } for the
  // first column where every cell is a number, or { type: 'table' } when there is none.
  function chartOf(table) {
    if (!table?.rows?.length) return { type: 'table' };
    const width = table.head.length;
    for (let column = 0; column < width; column++) {
      const values = table.rows.map(row => asNumber(row[column]));
      if (!values.every(value => value != null)) continue;

      // a column of growing whole numbers 1, 2, 3 … is a row number, not a measure
      const counts = values.every((value, index) => value === index + 1 || value === index);
      if (counts && table.rows.length > 2) continue;
      const nameColumn = table.head.findIndex((_, index) =>
        table.rows.some(row => asNumber(row[index]) == null)
      );
      return {
        type: table.rows.length > 24 ? 'line' : 'bar',
        label: table.head[column] || 'value',
        values: table.rows.map((row, index) => ({
          name: nameColumn >= 0 ? String(row[nameColumn] || '') : String(index + 1),
          value: values[index],
        })),
      };
    }
    return { type: 'table' };
  }

  // ---------- files other panels held (file-locks.js, read only) ----------
  // folded project-relative file → [{ paneId, from, to }]; `to` is 0 while the lock is held.
  // A lock is taken by an agent's edit, so a hold that reaches past a command's start means that
  // agent may have changed the file then.
  const holds = new Map();
  const HOLD_KEEP_MS = 6 * 3600 * 1000;
  const SINCE_SLACK_MS = 3000;
  const foldPath = file =>
    String(file || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .toLowerCase();

  function recordLocks(list) {
    const now = Date.now();
    const current = new Set();
    for (const lock of Array.isArray(list) ? list : []) {
      if (!lock?.file || !lock.paneId) continue;
      const key = foldPath(lock.file);
      current.add(key + '\n' + lock.paneId);
      const known = holds.get(key) || [];
      if (!known.some(hold => hold.paneId === lock.paneId && !hold.to))
        known.push({ paneId: lock.paneId, from: Number(lock.at) || now, to: 0 });
      holds.set(key, known);
    }

    // a hold that is no longer listed ended now; ended holds are kept a few hours
    for (const [key, known] of holds) {
      for (const hold of known)
        if (!hold.to && !current.has(key + '\n' + hold.paneId)) hold.to = now;
      const kept = known.filter(hold => !hold.to || now - hold.to < HOLD_KEEP_MS);
      kept.length ? holds.set(key, kept) : holds.delete(key);
    }
  }

  // Did another panel hold this file since `since`? A bare name is the project's own file; a
  // path matches the lock's file by its end.
  function heldByOther(paneId, file, since) {
    const name = foldPath(file);
    for (const [key, list] of holds) {
      const same = name.includes('/')
        ? name === key || name.endsWith('/' + key) || key.endsWith('/' + name)
        : name === key;
      if (!same) continue;
      const other = hold =>
        hold.paneId !== paneId && (!hold.to || hold.to >= Number(since || 0) - SINCE_SLACK_MS);
      if (list.some(other)) return true;
    }
    return false;
  }

  // the browser page and builds without the bridge: only the pure part is there (the test)
  if (!native?.made || !native?.designs || !window.TnaiAgents) {
    window.TnaiWhatItMade = { find, sitesIn, readTable, chartOf, kindOf, recordLocks, heldByOther };
    return;
  }

  // ---------- the settings ----------
  const STORE = 'tnai.what-it-made.v1';
  const DEFAULTS = { show: true, autoOpen: false };
  let prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object')
      prefs = { show: saved.show !== false, autoOpen: saved.autoOpen === true };
  } catch {}

  function savePrefs() {
    try {
      const own = Object.fromEntries(
        Object.entries(prefs).filter(([key, value]) => value !== DEFAULTS[key])
      );
      if (Object.keys(own).length) localStorage.setItem(STORE, JSON.stringify(own));
      else localStorage.removeItem(STORE);
    } catch {}
  }

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, size = 14) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  const lp = () => window.TnaiLivePreview || null;
  const loadedAt = Date.now();

  // ---------- what one task made, gathered while its actions are drawn ----------
  // state (122's, one per conversation) → { made: [items], sites: [sites] } of the task now running
  const tasks = new WeakMap();
  const taskOf = state => {
    let task = tasks.get(state);
    if (!task) {
      task = { made: [], sites: [] };
      tasks.set(state, task);
    }
    return task;
  };

  function addSite(state, task, site, at) {
    if (task.sites.some(other => other.url === site.url)) return;
    task.sites.push(site);

    // a site an agent starts while the user watches may open by itself (the setting)
    if (prefs.autoOpen && at && at >= loadedAt && Date.now() - at < 120000)
      openBeside(state, site.url);
  }

  // 122: an action was drawn
  function note(state, entry) {
    if (!state || state.sub) return;
    const task = taskOf(state);
    for (const item of find(entry)) {
      const same = task.made.find(other => other.file.toLowerCase() === item.file.toLowerCase());
      if (!same) task.made.push(item);
      else if (item.how === 'wrote') Object.assign(same, { how: 'wrote', since: 0 });
    }
    for (const site of sitesIn(entry, null)) addSite(state, task, site, entry.at);
  }

  // 122: an action's result came (a dev server prints where it listens)
  function result(state, entry, outcome) {
    if (!state || state.sub || !outcome) return;
    const task = taskOf(state);
    for (const site of sitesIn(entry, outcome)) addSite(state, task, site, entry.at || outcome.at);
  }

  // ---------- the block ----------
  // conversation state → the blocks that made something, oldest first
  const blocks = new WeakMap();

  // the sites drawn in blocks, so a change of Live preview's record reaches each of them
  const drawnSites = new Set();

  const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);

  // 122: the "Worked for" block of a task that ended is built and about to be added
  function block(state, entry, node) {
    const task = tasks.get(state);
    tasks.delete(state);
    if (!prefs.show || !task || !node || state.sub) return false;
    const files = node.querySelector(':scope > .tnt-files');

    // every file of the list 122 drew counts as changed, so the head and the chip say one number
    const changed = files ? files.querySelectorAll('.tnt-file').length : 0;
    if (!task.made.length && !task.sites.length) return false;
    const view = { state, task, node, files, changed, open: '' };
    draw(view);
    const list = blocks.get(state) || [];
    list.push(view);
    blocks.set(state, list);
    list.forEach((other, index) => fold(other, index < list.length - 1));
    checkMade(view);
    return true;
  }

  function headWords(view) {
    const things = view.task.made.length + view.task.sites.length;
    const parts = ['made ' + plural(things, 'thing', 'things')];
    if (view.changed) parts.push('changed ' + plural(view.changed, 'file', 'files'));
    return ' · ' + parts.join(', ');
  }

  // The groups of the block, in this order (user 2026-10-28 chose "Proposed" in
  // docs/plans/design-concepts/info-layout.html): one neutral surface, a group per kind with its
  // count, the kind's color only in the group's small icon (51). Documents and data are rows; a
  // picture, a page and a site keep a small card (179's split icon sits on page and site cards).
  // The changed files are the last group (changesGroup).
  const GROUPS = [
    { kind: 'document', icon: 'file-text', rows: true },
    { kind: 'data', icon: 'table', rows: true },
    { kind: 'picture', icon: 'image' },
    { kind: 'page', icon: 'app-window' },
    { kind: 'site', icon: 'globe' },
  ];

  // a video stands in the pictures' group
  const groupKind = item => (item.kind === 'video' ? 'picture' : item.kind);

  function groupItems(view, kind) {
    if (kind === 'site') return view.task.sites;
    return view.task.made.filter(item => groupKind(item) === kind);
  }

  function groupName(kind, items) {
    if (kind === 'document') return 'Documents';
    if (kind === 'data') return 'Data';
    if (kind === 'page') return 'Pages';
    if (kind === 'site') return 'Sites';
    const videos = items.filter(item => item.kind === 'video').length;
    if (!videos) return 'Pictures';
    return videos === items.length ? 'Videos' : 'Pictures and videos';
  }

  // Each group's name and count from what is left in it; a group left empty goes.
  function countGroups(view) {
    for (const [kind, group] of view.groups) {
      const items = groupItems(view, kind);
      if (!items.length) {
        group.box.remove();
        view.groups.delete(kind);
        continue;
      }
      group.name.textContent = groupName(kind, items);
      group.count.textContent = String(items.length);
    }
  }

  // One group's box: its head (icon, name, count) and what follows it.
  function groupBox(kind, iconName) {
    const box = make('section', 'tnt-made-group');
    box.dataset.kind = kind;
    const head = make('div', 'tnt-made-ghead');
    head.innerHTML = icon(iconName, 14);
    const name = make('span');
    const count = make('em');
    head.append(name, count);
    box.append(head);
    return { box, head, name, count };
  }

  // One thing of a group: a row for a document or data file, a small card for the rest.
  function partFor(view, kind, item) {
    if (kind === 'site') return withSplit(siteThumb(view, item), () => item.url, 'Site');
    if (kind === 'page')
      return withSplit(fileThumb(view, item), () => pageUrl(view, item), baseName(item.file));
    if (kind === 'picture') return fileThumb(view, item);
    return textRow(view, item);
  }

  function draw(view) {
    const { node } = view;
    node.classList.add('tnt-made');
    const first = node.firstElementChild;
    const worked = first?.textContent || 'Finished';
    const head = make('button', 'tnt-made-head');
    head.type = 'button';
    head.innerHTML = icon('chevron-right', 14);
    head.append(make('span', '', worked), make('em', '', headWords(view)));
    head.addEventListener('click', () => fold(view, view.node.dataset.folded !== 'true'));
    view.head = head;

    // The head line, then one surface with a group per kind (GROUPS) and the changed files last.
    const top = make('div', 'tnt-made-top');
    top.append(head, make('span', 'tnt-made-grow'));
    first ? first.replaceWith(top) : node.prepend(top);
    Object.assign(view, { first, top, thumbs: new Map(), groups: new Map() });

    const body = make('div', 'tnt-made-body');
    const groups = make('div', 'tnt-made-groups');
    for (const { kind, icon: iconName, rows } of GROUPS) {
      const items = groupItems(view, kind);
      if (!items.length) continue;
      const group = groupBox(kind, iconName);
      const holder = rows ? group.box : make('div', 'tnt-made-cards');
      for (const item of items) {
        const part = partFor(view, kind, item);
        if (kind !== 'site') view.thumbs.set(item, part);
        holder.append(part);
      }
      if (!rows) group.box.append(holder);
      view.groups.set(kind, group);
      groups.append(group.box);
    }
    countGroups(view);
    if (view.files) groups.append(changesGroup(view));
    body.append(groups);
    view.preview = make('div', 'tnt-made-preview');
    view.preview.hidden = true;
    body.append(view.preview);
    node.append(body);
    view.body = body;
  }

  function fold(view, folded) {
    view.node.dataset.folded = String(folded);
    view.head.setAttribute('aria-expanded', String(!folded));
    view.head.title = folded ? 'An earlier task: press to see what it made' : 'Fold what it made';
    view.body.hidden = folded;
  }

  // ---------- the parts of the block ----------
  const pressable = (className, title, onPress) => {
    const press = make('button', className);
    press.type = 'button';
    press.title = title;
    press.setAttribute('aria-pressed', 'false');
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  };

  function toggle(view, key, press, fill) {
    const same = view.open === key;
    view.node
      .querySelectorAll('[aria-pressed="true"]')
      .forEach(other => other.setAttribute('aria-pressed', 'false'));
    if (same) {
      view.open = '';
      view.preview.hidden = true;
      view.preview.replaceChildren();
      return;
    }
    view.open = key;
    press.setAttribute('aria-pressed', 'true');

    // in place: under a pressed row, or under the cards of the pressed card's group
    (press.closest('.tnt-made-cards') || press).after(view.preview);
    view.preview.hidden = false;
    view.preview.replaceChildren(make('p', 'tnt-made-none', 'Opening…'));
    fill(view.preview);
  }

  function previewTop(name, meta, actions) {
    const top = make('div', 'tnt-made-ptop');
    const title = make('b', '', name);
    title.title = name;
    top.append(title, meta, make('span', 'tnt-made-grow'), ...actions);
    return top;
  }

  const action = (label, onPress) => {
    const press = make('button', 'tnt-made-act', label);
    press.type = 'button';
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  };

  const HOW = {
    wrote: 'written by the agent',
    made: 'made by a command it ran (inferred: the file changed while the command ran)',
  };

  function fileThumb(view, item) {
    const name = baseName(item.file);
    const thumb = pressable('tnt-made-thumb', name + ' · ' + HOW[item.how], press =>
      toggle(view, 'file ' + item.file, press, box => fillFile(view, item, box))
    );
    const picture = make('i', 'tnt-made-tpic');
    picture.innerHTML = icon(
      item.kind === 'video' ? 'play' : item.kind === 'page' ? 'file-text' : 'eye',
      18
    );
    const kind = item.kind === 'video' ? 'video' : item.kind === 'page' ? 'page' : 'picture';
    thumb.dataset.kind = kind;
    thumb.append(picture, cardWords(name, item.how === 'made' ? 'made by a command' : '', kind));
    if (view.state.paneId) loadThumb(view, item, thumb, picture);
    return thumb;
  }

  // the icon of each kind's tile; the tile and the badge take the kind's tint (51)
  const KIND_ICON = {
    document: 'file-text',
    picture: 'image',
    video: 'play',
    page: 'app-window',
    site: 'globe',
    data: 'table',
  };

  // A card's words under its picture: the kind's tile, the name, one fact, and the kind as a small
  // badge (user 2026-10-23 chose "Proposed" in docs/plans/design-concepts/made-chips.html).
  function cardWords(name, fact, kind) {
    const words = make('span', 'tnt-made-words');
    const tile = make('span', 'tnt-made-tile');
    tile.innerHTML = icon(KIND_ICON[kind] || 'file', 16);
    words.append(tile);
    const text = make('span', 'tnt-made-wtext');
    const title = make('b', '', name);
    title.title = name;
    text.append(title);
    if (fact) text.append(make('small', '', fact));
    words.append(text, make('em', 'tnt-made-kind', kind));
    return words;
  }

  // A document or data file as a row: its name, then its title (a document's first line) or its
  // row count (a CSV or TSV), read once the row is near the screen. A press opens its first lines
  // in place under the row (toggle, fillText).
  function textRow(view, item) {
    const name = baseName(item.file);
    const row = pressable('tnt-made-row', name + ' · ' + HOW[item.how], press =>
      toggle(view, 'file ' + item.file, press, box => fillFile(view, item, box))
    );
    row.dataset.kind = item.kind === 'data' ? 'data' : 'document';
    const fact = make('small', '', item.how === 'made' ? 'made by a command' : '');
    row.append(make('b', '', name), fact);
    row.tntMadeLoad = () =>
      native.made
        .text(view.state.paneId, item.file)
        .then(found => {
          if (!found?.ok) {
            if (item.how === 'made') dropThing(view, item, row);
            else row.dataset.gone = 'true';
            return;
          }
          const lines = String(found.text || '')
            .split(/\r?\n/)
            .filter(line => line.trim());
          if (!lines.length) return;
          if (/\.(csv|tsv)$/i.test(item.file))
            fact.textContent = plural(Math.max(0, lines.length - 1), 'row', 'rows');
          else if (item.kind !== 'data')
            fact.textContent = lines[0].replace(/^#+\s*/, '').slice(0, 120);
        })
        .catch(() => {});
    if (view.state.paneId) nearScreen.observe(row);
    return row;
  }

  // the small picture, asked once the block is near the screen (as 159's cards)
  const nearScreen = new IntersectionObserver(
    entries =>
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        nearScreen.unobserve(target);
        target.tntMadeLoad?.();
      }),
    { rootMargin: '600px 0px' }
  );

  function loadThumb(view, item, thumb, picture) {
    thumb.tntMadeLoad = () => {
      const paneId = view.state.paneId;
      const ask =
        item.kind === 'picture'
          ? native.designs.picture(paneId, item.file, { since: item.since })
          : item.kind === 'page'
            ? native.designs.page(paneId, item.file, { shot: true })
            : native.made.check(paneId, item.file, item.since);
      Promise.resolve(ask)
        .then(found => {
          if (!found?.ok) {
            // a file a command only named, or one that is gone, is not something it made
            if (item.how === 'made') dropThing(view, item, thumb);
            else thumb.dataset.gone = 'true';
            return;
          }
          if (found.image) {
            const image = make('img');
            image.alt = '';
            image.src = found.image;
            picture.replaceChildren(image);
          }
        })
        .catch(() => {});
    };
    nearScreen.observe(thumb);
  }

  // A thing a command only named is let go: its card leaves, the head says the new count, and a
  // block left with nothing goes back to the plain "Worked for" line it was.
  function dropThing(view, item, thumb) {
    const list = view.task.made;
    if (list.includes(item)) list.splice(list.indexOf(item), 1);
    (thumb || view.thumbs?.get(item))?.remove();
    if (view.groups) countGroups(view);
    if (view.head) view.head.lastElementChild.textContent = headWords(view);
    if (list.length || view.task.sites.length || view.top?.parentNode !== view.node) return;
    view.node.classList.remove('tnt-made');
    delete view.node.dataset.folded;
    view.first ? view.top.replaceWith(view.first) : view.top.remove();

    // the file list goes back where 122 put it, out of the group that leaves with the body
    if (view.files) {
      view.files.hidden = false;
      view.body.before(view.files);
    }
    view.body.remove();
    const views = blocks.get(view.state) || [];
    if (views.includes(view)) views.splice(views.indexOf(view), 1);
    views.forEach((other, index) => fold(other, index < views.length - 1));
  }

  // Each thing a command made is checked as soon as the block is drawn, not when its card comes
  // near the screen, so the head's count is true at once: the file must have changed since the
  // command started (made:check), and no other panel may have held a file lock on it since then
  // (another agent's edit is not this command's).
  function checkMade(view) {
    const paneId = view.state.paneId;
    for (const item of [...view.task.made]) {
      if (item.how !== 'made') continue;
      if (heldByOther(paneId, item.file, item.since)) {
        dropThing(view, item);
        continue;
      }
      Promise.resolve(native.made.check(paneId, item.file, item.since))
        .then(found => {
          if (!found?.ok) dropThing(view, item);
        })
        .catch(() => {});
    }
  }

  const readLocks = () =>
    Promise.resolve(safe(() => native.locks?.list?.(), null))
      .then(recordLocks)
      .catch(() => {});
  readLocks();
  safe(() => native.locks?.onChange?.(readLocks), null);

  // The changed files as the block's last group: 122's own file list moved in whole; its head
  // line is said by the group's head instead (51).
  function changesGroup(view) {
    const group = groupBox('changes', 'git-branch');
    group.name.textContent = 'Changed files';
    group.count.textContent = String(view.changed);
    group.head.append(make('span', 'tnt-made-grow'));

    // the added and removed line counts 122 drew in the list's own head, in the diff colors (51)
    view.files
      .querySelectorAll(':scope > .tnt-files-head > :is(u, s)')
      .forEach(part => group.head.append(part.cloneNode(true)));
    group.head.append(action('Open Changes', () => openChanges()));
    view.files.hidden = false;
    group.box.append(view.files);
    return group.box;
  }

  function openChanges() {
    const side = window.TnaiThreadSide;
    if (!side) return;
    side.open('details');
    requestAnimationFrame(() =>
      document
        .querySelector('.tnt-sidedetails [data-sec="changes"]')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    );
  }

  // ---------- one file's preview ----------
  function fillFile(view, item, box) {
    const name = baseName(item.file);
    const how = make(
      'span',
      'tnt-made-meta',
      item.how === 'made' ? 'made by a command, inferred' : ''
    );
    if (item.kind === 'picture') return fillPicture(view, item, box, name, how);
    if (item.kind === 'page') return fillPage(view, item, box, name, how);
    if (item.kind === 'video') return fillVideo(view, item, box, name, how);
    return fillText(view, item, box, name, how);
  }

  function fillPicture(view, item, box, name, how) {
    const open = action('Open large', press =>
      window.TnaiThreadDesigns?.openLarge?.({
        kind: 'picture',
        state: view.state,
        item,
        opener: press,
      })
    );
    native.designs
      .picture(view.state.paneId, item.file, { since: item.since, large: true })
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (found?.ok && found.image) {
          const image = make('img', 'tnt-made-image');
          image.alt = name;
          image.src = found.image;
          body.append(image);
        } else body.append(make('p', 'tnt-made-none', 'This file is no longer there.'));
        box.replaceChildren(previewTop(name, how, [open]), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // ---------- 179: a page or site beside the thread ----------
  // The address a page file is served at (desktop/thread-designs.js `page`), asked when pressed.
  const pageUrl = (view, item) =>
    native.designs
      .page(view.state.paneId, item.file)
      .then(found => (found?.ok && found.url) || '')
      .catch(() => '');
  const withSplit = (card, getUrl, title) =>
    safe(() => window.TnaiPreviewSplit?.cell?.(card, getUrl, title), null) || card;
  const splitButton = (getUrl, title) =>
    safe(() => window.TnaiPreviewSplit?.button?.(getUrl, title), null);

  function fillPage(view, item, box, name, how) {
    const split = splitButton(() => pageUrl(view, item), name);
    const open = action('Open large', press =>
      window.TnaiThreadDesigns?.openLarge?.({
        kind: 'page',
        state: view.state,
        item,
        opener: press,
      })
    );
    native.designs
      .page(view.state.paneId, item.file, { shot: true })
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (found?.ok && found.image) {
          const image = make('img', 'tnt-made-image');
          image.alt = 'The page ' + name + ', small and still';
          image.src = found.image;
          body.append(image);
        } else
          body.append(
            make(
              'p',
              'tnt-made-none',
              found?.ok ? 'Open it large to see it.' : 'This file is no longer there.'
            )
          );
        box.replaceChildren(previewTop(name, how, split ? [split, open] : [open]), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // The window plays no video (its content rules have no media source), so a video opens in the
  // computer's own player.
  function fillVideo(view, item, box, name, how) {
    const open = action('Play on this PC', () => native.fs?.openOnPc?.(item.file));
    native.made
      .check(view.state.paneId, item.file, item.since)
      .then(found => {
        const body = make('div', 'tnt-made-pbody tnt-made-video');
        body.innerHTML = icon('play', 22);
        body.append(
          make(
            'p',
            'tnt-made-none',
            found?.ok
              ? 'A video of ' + sizeWords(found.size) + '. It plays in your own video player.'
              : 'This file is no longer there.'
          )
        );
        box.replaceChildren(previewTop(name, how, found?.ok ? [open] : []), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  const sizeWords = bytes =>
    bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';

  function fillText(view, item, box, name, how) {
    const label = item.kind === 'data' ? 'Open the data' : 'Open in Files';
    const open = action(label, () => {
      window.TnaiThreadSide?.open?.('files');
      window.TnaiThreadSide?.showFile?.(item.file);
    });
    native.made
      .text(view.state.paneId, item.file)
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (!found?.ok) body.append(make('p', 'tnt-made-none', 'This file is no longer there.'));
        else if (item.kind === 'data') body.append(dataView(found.text, name));
        else {
          const page = make('div', 'tnt-made-doc');
          const markdown = window.TnaiResults?.markdown;
          if (/\.(md|markdown)$/i.test(name) && typeof markdown === 'function')
            page.innerHTML = markdown(found.text);
          else page.append(make('pre', '', found.text));
          body.append(page);
        }
        box.replaceChildren(previewTop(name, how, found?.ok ? [open] : []), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // ---------- a data file drawn ----------
  const SVG = 'http://www.w3.org/2000/svg';
  const svgNode = (tag, attributes) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };

  function dataView(text, name) {
    const table = readTable(text, name);
    if (!table)
      return make('p', 'tnt-made-none', 'Not a table this view can read. Open the data to see it.');
    const chart = chartOf(table);
    if (chart.type === 'table') return tableView(table);
    const holder = make('figure', 'tnt-made-chart');
    const values = chart.values.slice(0, 200);
    const low = Math.min(0, ...values.map(point => point.value));
    const high = Math.max(...values.map(point => point.value), low + 1);
    const width = 600;
    const height = 180;
    const svg = svgNode('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': chart.label + ' of ' + name,
    });
    const yOf = value => height - ((value - low) / (high - low)) * (height - 8);
    if (chart.type === 'bar') {
      const step = width / values.length;
      values.forEach((point, index) => {
        const top = yOf(Math.max(point.value, 0));
        const bottom = yOf(Math.min(point.value, 0));
        const bar = svgNode('rect', {
          x: index * step + step * 0.15,
          y: top,
          width: Math.max(1, step * 0.7),
          height: Math.max(1, bottom - top),
          rx: 3,
        });
        bar.append(svgNode('title', {}));
        bar.firstChild.textContent = point.name + ': ' + point.value;
        svg.append(bar);
      });
    } else {
      const step = width / Math.max(1, values.length - 1);
      const points = values.map((point, index) => index * step + ',' + yOf(point.value)).join(' ');
      svg.append(svgNode('polyline', { points, fill: 'none', 'stroke-width': 2 }));
    }
    const caption = make(
      'figcaption',
      '',
      chart.label + ' · ' + plural(chart.values.length, 'row', 'rows')
    );
    holder.append(svg, caption);
    return holder;
  }

  function tableView(table) {
    const grid = make('table', 'tnt-made-table');
    const headRow = make('tr');
    table.head.slice(0, 8).forEach(name => headRow.append(make('th', '', name)));
    grid.append(headRow);
    table.rows.slice(0, 12).forEach(row => {
      const line = make('tr');
      table.head.slice(0, 8).forEach((_, index) => line.append(make('td', '', row[index] ?? '')));
      grid.append(line);
    });
    return grid;
  }

  // ---------- a site ----------
  // Live preview's own record of an address: its tab, the agent that showed it, and whether the
  // app itself runs the server (a script tab).
  function tabFor(url, paneId) {
    const tabs = safe(() => lp()?.tabs?.() || [], []);
    return (
      tabs.find(tab => tab.url && cleanAddress(tab.url) === url) ||
      tabs.find(
        tab =>
          tab.kind === 'script' && tab.byPane === paneId && tab.url && cleanAddress(tab.url) === url
      ) ||
      null
    );
  }

  const agentName = paneId =>
    safe(
      () => window.TnaiAgents.sessions().find(session => session.paneId === paneId)?.name || '',
      ''
    );

  function siteThumb(view, site) {
    const thumb = pressable('tnt-made-thumb', 'The site at ' + site.url, press =>
      toggle(view, 'site ' + site.url, press, box => fillSite(view, site, box))
    );

    // no still picture of a running site exists, so the card draws a browser's frame with the
    // site's own address in it, never a made-up page
    const picture = make('i', 'tnt-made-tsite');
    const bar = make('span', 'tnt-made-tbar');
    bar.append(make('span', '', shortAddress(site.url)));
    const middle = make('span', 'tnt-made-tmid');
    middle.innerHTML = icon('monitor-play', 22);
    picture.append(bar, middle);
    thumb.dataset.kind = 'site';
    const words = cardWords('Site', '', 'site');
    const state = make('small', '');
    words.querySelector('.tnt-made-wtext').append(state);
    thumb.append(picture, words);
    site.paint = () => paintSiteState(view, site, state);
    site.thumb = thumb;
    drawnSites.add(site);
    site.paint();
    return thumb;
  }

  // running or stopped, asked of the computer once per paint (a press, a change of Live preview)
  function siteRunning(site, paneId) {
    const tab = tabFor(site.url, paneId);
    if (tab?.kind === 'script')
      return Promise.resolve({ running: tab.state === 'running' || tab.state === 'starting', tab });
    return native.made
      .alive(site.url)
      .then(running => ({ running: running === true, tab }))
      .catch(() => ({ running: false, tab }));
  }

  function paintSiteState(view, site, holder) {
    siteRunning(site, view.state.paneId).then(({ running }) => {
      site.running = running;
      const who = agentName(view.state.paneId);
      const dot = make('span', running ? 'tnt-made-live' : 'tnt-made-stopped');
      holder.replaceChildren(
        dot,
        running ? 'running · ' + shortAddress(site.url) + (who ? ' · ' + who : '') : 'stopped'
      );
    });
  }

  const shortAddress = url =>
    String(url)
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

  function fillSite(view, site, box) {
    siteRunning(site, view.state.paneId).then(({ running, tab }) => {
      const who = agentName(view.state.paneId);
      const meta = make('span', 'tnt-made-meta');
      meta.append(
        make('span', running ? 'tnt-made-live' : 'tnt-made-stopped'),
        running ? 'running · ' + shortAddress(site.url) + (who ? ' · ' + who : '') : 'stopped'
      );
      const actions = [];
      const scripts = safe(() => lp()?.scripts?.() || [], []);
      if (running && tab?.kind === 'script')
        actions.push(
          action('Stop it', () =>
            lp()
              .stop(tab.id)
              .then(() => again())
          )
        );
      if (!running && (tab?.kind === 'script' || scripts.length))
        actions.push(
          action('Start it again', () => {
            const id = tab?.kind === 'script' ? tab.id : lp().addScript(scripts[0].name);
            Promise.resolve(lp().start(id)).then(() => again());
          })
        );
      if (running) {
        // 179: the site beside the thread
        const split = splitButton(() => site.url, 'Site');
        if (split) actions.push(split);
        actions.push(action('Open in Live preview', () => toLivePreview(site.url)));
      }
      const body = make('div', 'tnt-made-pbody tnt-made-site');
      body.append(
        make(
          'p',
          'tnt-made-none',
          running
            ? 'It answers at ' + shortAddress(site.url) + '. Open it in Live preview to use it.'
            : scripts.length || tab?.kind === 'script'
              ? 'Nothing answers at ' +
                shortAddress(site.url) +
                ' now. Start it again runs the project’s own ' +
                (tab?.script || scripts[0]?.name || 'dev') +
                ' script.'
              : 'Nothing answers at ' +
                shortAddress(site.url) +
                ' now. The agent can start it again.'
        )
      );
      box.replaceChildren(previewTop('Site', meta, actions), body);
    });
    const again = () => {
      site.paint?.();
      if (view.open === 'site ' + site.url) fillSite(view, site, box);
    };
  }

  function toLivePreview(url) {
    const preview = lp();
    if (!preview) return;
    const added = preview.addUrl(url);
    if (added?.ok && added.id) preview.select(added.id);
    window.TnaiLivePreviewPage?.open?.();
  }

  // ---------- Live preview beside the thread, opened by itself ----------
  let beside = null;
  const besideFor = new Set();

  function openBeside(state, url) {
    const preview = lp();
    const side = window.TnaiThreadSide;
    if (!preview?.mount || !side?.preview) return;
    const added = preview.addUrl(url);
    if (!added?.ok) return;
    preview.select(added.id);
    if (!beside) {
      beside = make('div', 'tnt-made-beside');
      beside.append(make('p', 'tnt-made-beside-note'));
      const host = make('div', 'tnt-made-beside-body');
      beside.append(host);
      preview.mount(host, { browser: true });
    }
    const who = agentName(state.paneId);
    beside.firstChild.textContent =
      shortAddress(url) + ' · opened by itself' + (who ? ' · ' + who + '’s site' : '');
    besideFor.add(url);
    side.preview(beside, true);
  }

  // Live preview's record changed (a server started or stopped): the sites that are drawn say it
  // (a site whose block left the page is let go here)
  lp()?.onChange?.(() => {
    for (const site of drawnSites) {
      if (!site.thumb?.isConnected) drawnSites.delete(site);
      else site.paint?.();
    }
  });

  // ---------- Settings › Agents ----------
  function settingsGroup() {
    const mount =
      document.getElementById('agentsColB') || document.getElementById('settingsPanel-agents');
    if (!mount) return;
    const group = make('section', 'set-group tnt-made-set');
    group.innerHTML =
      '<header class="set-group-head"><div><h3>What agents made</h3><p>Sites, pictures, videos, documents, charts and changes, found from the agent’s own record.</p></div></header>' +
      '<div class="set-card">' +
      '<label class="set-row"><span class="set-text"><b>Show what it made after each task</b><small>In the "Worked for" line that ends a task: what is new, and what changed.</small></span><input type="checkbox" class="set-switch" data-made="show"></label>' +
      '<label class="set-row"><span class="set-text"><b>Open Live preview by itself when an agent starts a site</b><small>Off at first. The site opens beside the thread, marked "opened by itself".</small></span><input type="checkbox" class="set-switch" data-made="autoOpen"></label>' +
      '</div>';
    const sync = () =>
      group.querySelectorAll('[data-made]').forEach(box => {
        box.checked = prefs[box.dataset.made] === true;
      });
    group.addEventListener('change', event => {
      const key = event.target.dataset.made;
      if (!key) return;
      prefs[key] = event.target.checked;
      savePrefs();
      sync();
    });
    sync();
    mount.append(group);
  }
  settingsGroup();

  window.TnaiWhatItMade = {
    note,
    result,

    // 122: the user's prompt begins a new task
    prompt: state => tasks.delete(state),
    block,
    prefs: () => ({ ...prefs }),
    set(patch) {
      for (const key of Object.keys(DEFAULTS)) if (key in patch) prefs[key] = patch[key] === true;
      savePrefs();
    },
    find,
    sitesIn,
    readTable,
    chartOf,
    kindOf,
    recordLocks,
    heldByOther,
  };
})();
