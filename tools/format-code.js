#!/usr/bin/env node

/*
 * Technically Not tools · format-code.js
 *
 * Formats the project's code so a person can read and edit it by hand: one statement on a line,
 * lines of at most 100 characters, long comments wrapped and put on their own lines above the
 * code they explain, and a blank line before each comment block and each function.
 *
 *   node tools/format-code.js                 format every code file of the project
 *   node tools/format-code.js desktop src     format only these folders or files
 *   node tools/format-code.js --check [...]   change nothing; list the files that are not
 *                                             formatted and exit with 1 when there is one
 *
 * What it does to a file, in order:
 *   1. Prettier with the project's settings (.prettierrc.json; .prettierignore lists what is
 *      left alone: vendored code, generated files, docs).
 *   2. JavaScript only: a comment that makes its line too long is wrapped; when it stands
 *      behind code it moves to its own lines above that code.
 *   3. JavaScript only: a blank line before a comment block and before a function or class.
 *
 * It never changes what the code does, and it proves that for every JavaScript file before
 * it writes: the old and the new text, with their comments taken out, must format to the same
 * text (so they are the same program), and the words of the comments must all still be there.
 * A file that fails the proof gets the plain Prettier result when that one passes, and is
 * otherwise left as it was; both cases are named at the end.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const prettier = require('prettier');

const ROOT = path.join(__dirname, '..');
const WIDTH = 100;
const JS = new Set(['.js', '.mjs', '.cjs']);
const OTHER = new Set(['.css', '.json']);

// Comments a tool reads: their place and their words must stay exactly as they are.
const DIRECTIVE =
  /^\s*(eslint|prettier-|@ts-|istanbul|c8 |jshint|global |globals |#region|#endregion|@license|@preserve|!)/;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const targets = args.filter(a => !a.startsWith('--'));

function listFiles() {
  const git = list =>
    execFileSync('git', list, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const all = (git(['ls-files']) + git(['ls-files', '--others', '--exclude-standard']))
    .split(/\r?\n/)
    .filter(Boolean);
  const wanted = targets.map(t => t.replace(/\\/g, '/').replace(/\/$/, ''));

  // git still lists a file that was deleted and not yet committed: there is nothing to format.
  return [...new Set(all)]
    .filter(f => JS.has(path.extname(f)) || OTHER.has(path.extname(f)))
    .filter(f => fs.existsSync(path.join(ROOT, f)))
    .filter(f => !wanted.length || wanted.some(t => f === t || f.startsWith(t + '/')))
    .sort();
}

// Tests in tools/desktop-check/tests and tools/browser-check/tests are the body of an async
// function: `await` and `return` stand at the top level, which Prettier's parser accepts.
async function parse(text, options) {
  const { ast } = await prettier.__debug.parse(text, options);
  return ast;
}

const startOf = node => (typeof node.start === 'number' ? node.start : node.range[0]);
const endOf = node => (typeof node.end === 'number' ? node.end : node.range[1]);

// Every template literal's place in the text: inside one, a line is part of a string.
function templateRanges(ast) {
  const ranges = [];
  const seen = new Set();
  (function walk(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'TemplateLiteral') ranges.push([startOf(node), endOf(node)]);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range' || key === 'comments' || key === 'tokens') continue;
      const value = node[key];
      if (value && typeof value === 'object') walk(value);
    }
  })(ast);
  return ranges;
}

const inside = (ranges, offset) => ranges.some(([a, b]) => offset > a && offset < b);

const wordsOf = comments =>
  [...comments]
    .sort((a, b) => startOf(a) - startOf(b))
    .map(c => c.value)
    .join(' ')
    .replace(/[\s*]+/g, ' ')
    .trim();

// What the parser read, without where it stood and without the comments: two texts with the
// same tree are the same program. The words inside strings and template literals are part of it.
const PLACE = new Set([
  'start',
  'end',
  'loc',
  'range',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'tokens',
  'parenStart',
  'trailingComma',
  'trailingCommaLoc',
  // How a string or number was written (its quotes, its brackets): its value is kept
  'extra',
]);
const tree = ast =>
  JSON.stringify(ast, (key, value) =>
    PLACE.has(key) || key.startsWith('__')
      ? undefined
      : typeof value === 'bigint'
        ? value + 'n'
        : key === 'flags' && typeof value === 'string'
          ? [...value].sort().join('') // a regular expression's flags: their order means nothing
          : Array.isArray(value)
            ? // A stray `;` in a list of statements does nothing, and Prettier drops it.
              value.filter(item => !item || item.type !== 'EmptyStatement')
            : value && typeof value === 'object'
              ? // The parser does not always list a node's keys in the same order.
                Object.fromEntries(
                  Object.keys(value)
                    .sort()
                    .map(k => [k, value[k]])
                )
              : value
  );

// The proof: same program, same comment words.
async function same(before, after, options) {
  const a = await parse(before, options);
  const b = await parse(after, options);
  if (tree(a) !== tree(b)) return 'the code is not the same';
  const wa = wordsOf(a.comments || []);
  const wb = wordsOf(b.comments || []);
  if (wa === wb) return '';
  const bag = s => s.split(' ').sort().join(' ');
  return bag(wa) === bag(wb) ? '' : 'the comments are not the same';
}

function wrap(words, indent) {
  const room = Math.max(40, WIDTH - indent.length - 3);
  const lines = [];
  let line = '';
  for (const word of words.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(line);
      line = word;
    } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines.map(l => indent + '// ' + l);
}

// Step 2. Works on text Prettier has already formatted, from the last line up, so the places
// of the comments above stay true.
async function moveComments(text, options) {
  const ast = await parse(text, options);
  const ranges = templateRanges(ast);
  const lines = text.split('\n');
  const lineStart = [0];
  for (let i = 0; i < lines.length; i++) lineStart.push(lineStart[i] + lines[i].length + 1);

  const byLine = new Map();
  for (const c of ast.comments || []) {
    const row = c.loc.start.line - 1;
    byLine.set(row, (byLine.get(row) || []).concat(c));
  }
  for (const row of [...byLine.keys()].sort((a, b) => b - a)) {
    const found = byLine.get(row);
    const c = found[0];
    const line = lines[row];
    const lastRow = c.loc.end.line - 1;

    // A block comment of several lines that stands alone (a file's header, a long note): when
    // one of its lines is too long, the whole comment is written again with a star on each line.
    if (
      found.length === 1 &&
      (c.type === 'CommentBlock' || c.type === 'Block') &&
      lastRow > row &&
      !/^[*!]/.test(c.value) &&
      !DIRECTIVE.test(c.value) &&
      !inside(ranges, lineStart[row]) &&
      !line.slice(0, startOf(c) - lineStart[row]).trim() &&
      !lines[lastRow].slice(endOf(c) - lineStart[lastRow]).trim() &&
      lines.slice(row, lastRow + 1).some(l => l.length > WIDTH)
    ) {
      const indent = line.match(/^\s*/)[0];
      const star = indent + ' *';
      const out = [indent + '/*'];
      let paragraph = '';
      const flush = () => {
        if (!paragraph) return;
        for (const l of wrap(paragraph, indent)) out.push(star + ' ' + l.slice(indent.length + 3));
        paragraph = '';
      };

      // A comment written with a star at the start of each line: that star is taken off first, so
      // it is not read as a list item (which turned a whole header into `* * text` lines).
      const valueLines = c.value.split('\n');
      const starred = valueLines
        .slice(1)
        .filter(l => l.trim())
        .every(l => /^\s*\*(\s|$)/.test(l));
      for (const textLine of valueLines) {
        let t = textLine.trim();
        if (starred) t = t.replace(/^\*(\s+|$)/, '');
        if (!t) {
          flush();
          if (out.length > 1 && out[out.length - 1] !== star) out.push(star);
        } else if (/^([-*•]|\d+[.)])\s/.test(t)) {
          flush();
          paragraph = t;
        } else paragraph = paragraph ? paragraph + ' ' + t : t;
      }
      flush();
      while (out[out.length - 1] === star) out.pop();
      out.push(indent + ' */');
      lines.splice(row, lastRow - row + 1, ...out);
      continue;
    }
    if (found.length !== 1 || c.loc.end.line !== c.loc.start.line || line.length <= WIDTH) continue;
    if (inside(ranges, lineStart[row]) || DIRECTIVE.test(c.value)) continue;
    const block = c.type === 'CommentBlock' || c.type === 'Block';
    if (block && /^[*!]/.test(c.value)) continue;
    const from = startOf(c) - lineStart[row];
    const to = endOf(c) - lineStart[row];
    const code = line.slice(0, from).trimEnd();
    if (line.slice(to).trim()) continue; // code follows the comment: it stays where it is
    const indent = line.match(/^\s*/)[0];

    // A long comment line is usually the start or middle of a paragraph that goes on in the
    // comment lines under it: the rest of that paragraph is wrapped with it, so no short line
    // is left in the middle. A list item or an empty comment line ends the paragraph.
    let words = c.value;
    let taken = 1;
    if (!block && !code.trim()) {
      for (let next = row + 1; next < lines.length; next++) {
        const more = lines[next].match(/^(\s*)\/\/ ?(.*)$/);
        if (!more || more[1] !== indent || !more[2].trim()) break;
        if (/^\s*([-*•]|\d+[.)]|[a-z]\))\s/.test(more[2]) || DIRECTIVE.test(more[2])) break;
        words += ' ' + more[2];
        taken++;
      }
    }
    const wrapped = wrap(words, indent);
    if (!wrapped.length) continue;
    lines.splice(row, taken, ...wrapped, ...(code.trim() ? [code] : []));
  }
  return lines.join('\n');
}

// Step 3.
async function blankLines(text, options) {
  const ast = await parse(text, options);
  const ranges = templateRanges(ast);
  const commentRows = new Set();
  for (const c of ast.comments || []) {
    for (let row = c.loc.start.line - 1; row <= c.loc.end.line - 1; row++) commentRows.add(row);
  }
  const lines = text.split('\n');
  const out = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cur = line.trim();
    const prev = i ? lines[i - 1].trim() : '';
    const startsComment = commentRows.has(i) && /^(\/\/|\/\*)/.test(cur);
    const startsFunction =
      /^(export\s+)?(default\s+)?(async\s+)?(function\b|class\b)/.test(cur) && !commentRows.has(i);
    const prevIsComment = i > 0 && commentRows.has(i - 1) && /^(\/\/|\/\*|\*)/.test(prev);
    const prevOpens = /[{([,:]$|=>$|[&|+\-*/?=<>!.]$/.test(prev);
    if (
      i > 0 &&
      (startsComment || startsFunction) &&
      prev &&
      !prevIsComment &&
      !prevOpens &&
      !inside(ranges, offset)
    ) {
      out.push('');
    }
    out.push(line);
    offset += line.length + 1;
  }
  return out.join('\n');
}

async function formatOne(file) {
  const full = path.join(ROOT, file);
  const raw = fs.readFileSync(full, 'utf8');
  const info = await prettier.getFileInfo(full, { ignorePath: path.join(ROOT, '.prettierignore') });
  if (info.ignored || !info.inferredParser) return { file, state: 'skipped' };
  const crlf = /\r\n/.test(raw);
  const before = raw.replace(/\r\n/g, '\n');
  const options = { ...(await prettier.resolveConfig(full)), filepath: full, endOfLine: 'lf' };

  let after;
  let note = '';
  const plain = await prettier.format(before, options);
  if (!JS.has(path.extname(file))) after = plain;
  else {
    let full3 = await prettier.format(await moveComments(plain, options), options);
    full3 = await prettier.format(await blankLines(full3, options), options);
    const why = await same(before, full3, options);
    if (!why) after = full3;
    else {
      const whyPlain = await same(before, plain, options);
      if (whyPlain) return { file, state: 'left', note: whyPlain };
      after = plain;
      note = 'only the plain formatting (' + why + ' after the comment step)';
    }
  }
  if (after === before) return { file, state: 'same', note };
  if (!checkOnly) fs.writeFileSync(full, crlf ? after.replace(/\n/g, '\r\n') : after);
  return { file, state: 'changed', note };
}

(async () => {
  const files = listFiles();
  const count = { changed: 0, same: 0, skipped: 0, left: 0 };
  const said = [];
  for (const file of files) {
    let result;
    try {
      result = await formatOne(file);
    } catch (error) {
      result = { file, state: 'left', note: String(error.message || error).split('\n')[0] };
    }
    count[result.state]++;
    if (result.state === 'left') said.push('LEFT AS IT WAS  ' + file + ': ' + result.note);
    else if (result.note) said.push('NOTE  ' + file + ': ' + result.note);
    else if (checkOnly && result.state === 'changed') said.push('not formatted  ' + file);
  }
  for (const line of said) console.log(line);
  console.log(
    (checkOnly ? 'Would change ' : 'Changed ') +
      count.changed +
      ', already formatted ' +
      count.same +
      ', left alone by .prettierignore ' +
      count.skipped +
      ', could not be formatted ' +
      count.left +
      ' (of ' +
      files.length +
      ' files).'
  );
  process.exitCode = count.left || (checkOnly && count.changed) ? 1 : 0;
})();
