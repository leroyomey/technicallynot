/*
 * Technically Not desktop · git-guard.js — Refuses agent shell commands that would throw away or
 * set aside uncommitted work in the project's shared working tree (after
 * a sub-agent's `git stash` briefly took every other agent's unsaved changes away mid-task). Every
 * agent, sub-agent and the user's own edits share one folder, so one agent's `git stash`, `git
 * reset --hard`, `git checkout -- .`, `git restore`, `git clean -f` or branch switch changes files
 * other agents and the user are working on. agent-hooks.js asks guard(command) on Claude Code's
 * PreToolUse for Bash/PowerShell (sub-agents included) and denies with the reason; CLIs without
 * per-tool hooks follow hidden-skills/35-coordination.md. The user can still run these commands in
 * a terminal panel. Check: node tools/desktop-check/git-guard-check.js
 */
'use strict';

// The command is read the way a shell reads it (app-3 #2 and #8): quoted
// text is one word and never starts a command, and a command starts at the beginning, after ; & |
// && || or a line break, after ( { $( or a backtick, and after do / then / else. git is then looked
// for as that command (bare, quoted or a path ending in git or git.exe), or behind a wrapper (cmd
// /c, bash -c, powershell -Command, env, xargs, sudo…), whose quoted arguments are read as commands
// themselves. Bash and PowerShell disagree on the escape character (\ or `), so the text is read
// both ways and refused if either reading is refused. A text filter is never complete. Known to
// pass: a script file or another program that runs git (node -e, python), a command built from a
// variable (`git $x`), an alias from the user's git config, an encoded PowerShell command. The
// hidden coordination rule still applies.
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!']);
const SHELLS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
  'wsl',
]);
const WRAPPERS = new Set([
  ...SHELLS,
  'eval',
  'iex',
  'invoke-expression',
  'start-process',
  'sudo',
  'doas',
  'command',
  'builtin',
  'exec',
  'env',
  'xargs',
  'time',
  'nohup',
  'nice',
  'timeout',
  'stdbuf',
  'watch',
  'find',
  'parallel',
  'start',
  'call',
  'winpty',
  'busybox',
]);
const VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--attr-source',
]); // git options followed by a separate value
const base = t =>
  t
    .toLowerCase()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(?:exe|cmd|bat)$/, '');
const HERE_STRING = /[ \t]*\r?\n/y,
  HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|((?:\\?[\w.+-])+))/y;

// The commands in a shell text: a list of commands, each a list of words { t: text without its
// quotes, q: had a quoted part }. ps: read it as PowerShell (escape character `, here-strings)
// instead of a POSIX shell (escape character \, `…` runs a command). asText: src is the inside of a
// double-quoted text, where only $(…) and `…` are commands.
function parse(src, ps, asText) {
  const segs = [],
    docs = [],
    n = src.length;
  let i = 0;
  const nested = (text, t) => {
    for (const s of parse(text, ps, t)) segs.push(s);
  };
  const lineEnd = () => {
    const e = src.indexOf('\n', i);
    return e < 0 ? n : e;
  };

  function text(done) {
    let out = '';
    while (i < n && !done()) {
      const c = src[i];
      if (c === (ps ? '`' : '\\') && i + 1 < n) {
        out += src[i + 1];
        i += 2;
      } else if (c === '$' && src[i + 1] === '(') {
        i += 2;
        commands(true);
      } else if (c === '`' && !ps && src.indexOf('`', i + 1) > 0) {
        const e = src.indexOf('`', i + 1);
        nested(src.slice(i + 1, e));
        i = e + 1;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  // untilParen: stop after the `)` that closes the `$(` this was called for.
  function commands(untilParen) {
    let seg = [],
      word = null,
      depth = 0,
      lineFrom = segs.length;
    const add = (s, q) => {
      word = word || { t: '', q: false, braces: 0 };
      word.t += s;
      word.q = word.q || !!q;
    };
    const endWord = () => {
      if (word) seg.push(word);
      word = null;
    };
    const endSeg = () => {
      endWord();
      if (seg.length) segs.push(seg);
      seg = [];
    };
    while (i < n) {
      const c = src[i],
        d = src[i + 1];
      if (c === '\n') {
        i++;
        endSeg();

        // Heredoc bodies are data, not commands, unless a shell on that line reads them; a body
        // whose end line is missing is not one.
        const fed =
          docs.length && segs.slice(lineFrom).some(s => s.some(w => SHELLS.has(base(w.t))));
        for (const doc of docs.splice(0)) {
          let at = i,
            end = -1;
          while (at < n && end < 0) {
            const le = src.indexOf('\n', at),
              stop = le < 0 ? n : le;
            if (src.slice(at, stop).trim() === doc.delim) end = at;
            at = stop + 1;
          }
          if (end < 0) continue;
          const body = src.slice(i, end);
          i = Math.min(n, at);
          if (fed) nested(body);
          else if (!doc.raw) nested(body, true);
        }
        lineFrom = segs.length;
        continue;
      }
      if (c === '\r' || c === ' ' || c === '\t') {
        i++;
        endWord();
        continue;
      }
      if (c === (ps ? '`' : '\\')) {
        // the escape character: the next character is plain text, and a line break after it
        // continues the line
        if (d === '\n' || (d === '\r' && src[i + 2] === '\n')) {
          i += d === '\n' ? 2 : 3;
          continue;
        }
        if (d !== undefined) add(d);
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        endSeg();
        continue;
      }
      if (c === "'") {
        const e = src.indexOf("'", i + 1);
        add(src.slice(i + 1, e < 0 ? n : e), true);
        i = e < 0 ? n : e + 1;
        continue;
      }
      if (
        ps &&
        c === '@' &&
        (d === "'" || d === '"') &&
        ((HERE_STRING.lastIndex = i + 2), HERE_STRING.test(src))
      ) {
        // PowerShell here-string
        if (d === "'") {
          const e = src.indexOf("\n'@", i);
          add(src.slice(i + 2, e < 0 ? n : e), true);
          i = e < 0 ? n : e + 3;
        } else {
          i += 2;
          add(
            text(() => src.startsWith('\n"@', i)),
            true
          );
          i += 3;
        }
        continue;
      }
      if (c === '"') {
        i++;
        add(
          text(() => src[i] === '"'),
          true
        );
        i++;
        continue;
      }
      if (c === '#' && !word) {
        // a comment; what follows a separator in it is still read (cmd.exe has no # comments)
        const e = lineEnd(),
          cut = src.slice(i, e).search(/[;&|]/);
        if (cut >= 0) nested(src.slice(i + cut, e));
        i = e;
        continue;
      }
      if (c === '<' && d === '<') {
        if (src[i + 2] === '<') {
          add('<<<');
          i += 3;
          continue;
        }
        HEREDOC.lastIndex = i;
        const h = HEREDOC.exec(src);
        if (h) {
          docs.push({
            delim: h[2] ?? h[3] ?? h[4].replace(/\\/g, ''),
            raw: h[4] === undefined || h[4].includes('\\'),
          });
          i = HEREDOC.lastIndex;
          endWord();
          continue;
        }
      }
      if (c === '(') {
        i++;
        endSeg();
        depth++;
        continue;
      }
      if (c === ')') {
        i++;
        endSeg();
        if (untilParen && !depth) return;
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (c === '{' && d === '}') {
        add('{}');
        i += 2;
        continue;
      } // the placeholder of find -exec and xargs -I
      if (c === '{' && !word) {
        i++;
        endSeg();
        continue;
      }
      if (c === '{') {
        word.braces++;
        add(c);
        i++;
        continue;
      } // ${name} and stash@{0} stay one word
      if (c === '}' && word?.braces) {
        word.braces--;
        add(c);
        i++;
        continue;
      }
      if (c === '}' || c === ';' || c === '|') {
        i++;
        endSeg();
        continue;
      }
      if (c === '&' && src[i - 1] !== '>' && d !== '>') {
        i++;
        endSeg();
        continue;
      }
      add(c);
      i++;
    }
    endSeg();
  }

  if (asText) text(() => false);
  else commands(false);
  return segs;
}

// Why this git command would lose or hide uncommitted work, or '' when it is safe. git accepts a
// long option cut short (--har), so a long option matches by prefix.
function reason(sub, args) {
  const cut = a => {
    const o = a.split('=')[0];
    return o.length > 2 && o.startsWith('--') ? o : null;
  };
  const has = (...f) =>
    args.some(
      a =>
        f.includes(a) ||
        f.some(
          x =>
            (x.endsWith('=') && a.startsWith(x)) ||
            (x.startsWith('--') && cut(a) && x.startsWith(cut(a)))
        )
    );
  const short = letter => args.some(a => new RegExp('^-[a-z]*' + letter, 'i').test(a));
  switch (sub) {
    case 'stash': {
      const op = args.find(a => !a.startsWith('-')) || 'push';
      if (['list', 'show', 'create'].includes(op)) return '';
      if (['apply', 'pop', 'branch'].includes(op))
        return 'writes stashed changes over the files other agents and the user are editing';
      return op === 'drop' || op === 'clear'
        ? 'deletes stashed work for good'
        : "takes every uncommitted change in the project away, including other agents' and the user's unsaved work";
    }
    case 'reset':
      return has('--hard', '--merge', '--keep')
        ? 'throws away uncommitted changes in the shared folder'
        : '';
    case 'checkout': {
      if (has('-b', '-B', '--orphan'))
        return has('-f', '--force') ? 'throws away uncommitted changes in the shared folder' : '';
      if (has('--', '.', '-f', '--force', '-p', '--patch', '--ours', '--theirs') || args.length)
        return 'replaces files (or the whole branch) under other agents and the user';
      return '';
    }
    case 'switch':
      return has('-c', '-C', '--create', '--force-create', '--orphan') &&
        !has('--discard-changes', '-f', '--force')
        ? ''
        : 'switches the branch under other agents and the user';
    case 'restore':
      return args.length &&
        args.every(a => (a.startsWith('-') ? ['--staged', '-S'].includes(a) : true)) &&
        has('--staged', '-S') &&
        !has('--worktree', '-W')
        ? ''
        : 'replaces files with an older version, discarding uncommitted changes';
    case 'clean':
      return short('f') || has('--force')
        ? 'deletes untracked files other agents or the user may have just made'
        : '';
    case 'checkout-index':
      return short('f') || has('--force')
        ? 'writes older versions over files other agents and the user are editing'
        : '';
    case 'read-tree':
      return short('u') || has('--reset')
        ? 'replaces files in the shared folder, discarding uncommitted changes'
        : '';
    case 'rebase':
    case 'merge':
    case 'pull':
    case 'cherry-pick':
    case 'revert':
    case 'am':
      return has('--abort', '--quit')
        ? 'resets files in the shared folder'
        : has('--autostash')
          ? "sets every uncommitted change in the project aside while it runs, including other agents' and the user's unsaved work"
          : '';
    default:
      return '';
  }
}

// The refusal for the words after `git` (global options, then the subcommand and its arguments), or
// ''.
function gitCommand(w, depth) {
  let k = 0;
  for (; k < w.length && w[k].startsWith('-'); k++) {
    if (!VALUE_OPTS.has(w[k])) continue;

    // an alias made on the command line is read as what it stands for
    const alias = w[k] === '-c' && /^alias\.[^=]+=(.*)$/is.exec(w[k + 1] || '');
    const r = !alias
      ? ''
      : alias[1].startsWith('!')
        ? guard(alias[1].slice(1), depth + 1)
        : gitCommand(alias[1].trim().split(/\s+/), depth + 1);
    if (r) return r;
    k++;
  }
  if (k >= w.length) return '';
  const sub = w[k].toLowerCase(),
    args = w.slice(k + 1);
  if (sub === 'submodule' && args.includes('foreach')) {
    // runs the rest as a command
    const rest = args.slice(args.indexOf('foreach') + 1);
    while (rest[0]?.startsWith('-')) rest.shift();
    return guard(rest.join(' '), depth + 1);
  }
  const why = reason(sub, args);
  return !why
    ? ''
    : 'Technically Not blocked `git ' +
        sub +
        '`: it ' +
        why +
        '. This project folder is shared with other agents and the user, so agents never stash, reset, check out, restore or clean files in it. ' +
        'To see an old version use `git show HEAD:path/to/file` (write it to a scratch file outside the project), to try something apart use your own git worktree, and to undo only your own edit, edit the file back. ' +
        'If the user really wants this command, tell them to run it themselves in their own terminal (the Terminal tab beside a thread).';
}

// The refusal for one command (a list of words), or ''.
function command(seg, depth) {
  let k = 0;
  while (
    k < seg.length &&
    (/^\w+=/.test(seg[k].t) || (!seg[k].q && KEYWORDS.has(seg[k].t.toLowerCase())))
  )
    k++;
  if (k >= seg.length) return '';
  const name = base(seg[k].t),
    rest = seg.slice(k + 1);
  if (name === 'git')
    return gitCommand(
      rest.map(w => w.t),
      depth
    );
  if (!WRAPPERS.has(name)) return '';
  for (let j = 0; j < rest.length; j++) {
    // a wrapper runs what follows it: git as a later word, or a quoted command line
    const r =
      base(rest[j].t) === 'git'
        ? gitCommand(
            rest.slice(j + 1).map(w => w.t),
            depth
          )
        : rest[j].q && /\s/.test(rest[j].t.trim())
          ? guard(rest[j].t, depth + 1)
          : '';
    if (r) return r;
  }
  return '';
}

// The reason to refuse this shell command, or ''.
function guard(text, depth = 0) {
  if (depth > 4) return '';
  const src = String(text || '');
  for (const ps of [false, true])
    for (const seg of parse(src, ps)) {
      const r = command(seg, depth);
      if (r) return r;
    }
  return '';
}

module.exports = { guard };
