/*
 * Technically Not tools · dead-style.js — Style rules that can no longer match, found and taken
 * out after a page or a feature was deleted.
 *
 *   node tools/dead-style.js --names ap-,tpg-,agentsPage           report only
 *   node tools/dead-style.js --names ap-,tpg-,agentsPage --write   take the rules out
 *   node tools/dead-style.js --compare <folder before> <folder after>
 *
 * `--names` takes the beginnings of class names and ids to look at (a whole name works too).
 * A name is alive when a script, index.html or the main process still writes it somewhere that
 * is not a selector: `class="ap-row"`, `el('div', 'ap-row')`. A name that only stands after a
 * dot or a hash (`querySelector('.ap-row')`, style text inside a script) is looked for, not
 * produced, so it counts as dead. Names a script joins from parts ('ap-' + kind) cannot be seen
 * this way: the report lists the scripts that do so, and those names are yours to check.
 *
 * A rule goes only when every selector of its list needs a dead name outside :not(), :is() and
 * :where(). A rule nested in such a rule goes with it, and an @media or @container block that
 * is left with nothing in it goes too. Lists that name a dead class beside live ones stay as
 * they are. Only the sheets in src/styles are changed; style text inside scripts is not read.
 *
 * The proof that nothing visible changed is yours to make: take the pictures of the window
 * tests before (`tools/browser-check/out`, copied to a folder), run with --write, run the same
 * tests again and compare with --compare. Live text (names, clocks, numbers) differs in a small
 * share of the pixels; a rule that was still drawing shows as a large share or a new size.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SHEETS = path.join(ROOT, 'src', 'styles');
const CODE_FOLDERS = ['src/scripts', 'desktop'];
const NAME_END = '(?![A-Za-z0-9_-])';
const escapeName = name => name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// Every file under a folder, without node_modules.
function filesUnder(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(full);
    return [full];
  });
}

// ---------- which names are dead ----------

// The names of the given beginnings that the sheets use, each with the sheets that use it.
function namesInSheets(sheetTexts, beginnings) {
  const family = new RegExp(
    '[.#]((?:' + beginnings.map(escapeName).join('|') + ')[A-Za-z0-9_-]*)',
    'g'
  );
  const found = new Map();
  for (const [file, text] of sheetTexts)
    for (const match of text.matchAll(family)) {
      if (!found.has(match[1])) found.set(match[1], new Set());
      found.get(match[1]).add(path.basename(file));
    }
  return found;
}

// The files that write the name somewhere that is not a selector.
function producersOf(name, codeTexts) {
  const written = new RegExp('(^|[^.#A-Za-z0-9_-])' + escapeName(name) + NAME_END);
  return codeTexts.filter(([, text]) => written.test(text)).map(([file]) => path.basename(file));
}

// Scripts that build a class name of one of the families from parts.
function joinersOf(beginnings, codeTexts) {
  const stems = beginnings.filter(part => part.endsWith('-')).map(escapeName);
  if (!stems.length) return [];
  const joined = new RegExp('[\'"`](?:' + stems.join('|') + ')(?:[\'"`]\\s*\\+|\\$\\{)');
  return codeTexts.filter(([, text]) => joined.test(text)).map(([file]) => path.basename(file));
}

// ---------- reading a sheet ----------

// The text with comments and strings blanked out, the same length, so that a brace or a comma
// inside them does not count.
function blankOut(text) {
  let out = '';
  for (let at = 0; at < text.length;) {
    if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(at, stop).replace(/[^\n]/g, ' ');
      at = stop;
    } else if (text[at] === '"' || text[at] === "'") {
      let close = at + 1;
      while (close < text.length && text[close] !== text[at]) close += text[close] === '\\' ? 2 : 1;
      out += text[at] + ' '.repeat(Math.max(0, close - at - 1)) + (text[close] || '');
      at = close + 1;
    } else out += text[at++];
  }
  return out;
}

// The selectors of a list, split at the commas that are not inside brackets.
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < prelude.length; at++) {
    if (prelude[at] === '(' || prelude[at] === '[') depth++;
    else if (prelude[at] === ')' || prelude[at] === ']') depth--;
    else if (prelude[at] === ',' && depth === 0) {
      parts.push(prelude.slice(from, at));
      from = at + 1;
    }
  }
  parts.push(prelude.slice(from));
  return parts.map(part => part.trim()).filter(Boolean);
}

// A selector without what stands inside :not(), :is() and :where(): a dead name in there does
// not stop the rule from matching.
function outsideOptionalParts(selector) {
  let out = '';
  for (let at = 0; at < selector.length;) {
    const opening = /^:(not|is|where)\(/.exec(selector.slice(at));
    if (!opening) {
      out += selector[at++];
      continue;
    }
    let depth = 0;
    let close = at + opening[0].length - 1;
    for (; close < selector.length; close++) {
      if (selector[close] === '(') depth++;
      else if (selector[close] === ')' && --depth === 0) break;
    }
    at = close + 1;
  }
  return out;
}

// The rules that stand directly in a stretch of a sheet (declarations are passed over), each
// with where its text starts, where its block opens and where it closes.
function rulesBetween(blanked, from, to) {
  const rules = [];
  let start = from;
  let depth = 0;
  for (let at = from; at < to; at++) {
    const char = blanked[at];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && char === ';') start = at + 1;
    else if (depth === 0 && char === '{') {
      let level = 0;
      let close = at;
      for (; close < to; close++) {
        if (blanked[close] === '{') level++;
        else if (blanked[close] === '}' && --level === 0) break;
      }
      rules.push({ start, open: at, close });
      at = close;
      start = close + 1;
    }
  }
  return rules;
}

// ---------- taking the dead rules out of one sheet ----------

// Answers { text, removed: [selector lists] }: the sheet without the rules that need a dead name.
function withoutDeadRules(sheet, deadNames) {
  const original = sheet.replace(/\r\n/g, '\n');
  if (!deadNames.length) return { text: original, removed: [] };
  const blanked = blankOut(original);
  const dead = new RegExp('[.#](?:' + deadNames.map(escapeName).join('|') + ')' + NAME_END);
  const needsDead = selector => dead.test(outsideOptionalParts(selector));
  const cuts = [];

  // The cut takes the comment that stands directly over the rule with it.
  function cut(rule) {
    const lead = blanked.slice(rule.start, rule.open);
    const selectorAt = rule.start + Math.max(0, lead.search(/\S/));
    const gap = original.slice(rule.start, selectorAt).lastIndexOf('\n\n');
    cuts.push({
      from: gap >= 0 ? rule.start + gap + 1 : rule.start,
      to: rule.close + 1,
      what: lead.trim().replace(/\s+/g, ' '),
    });
  }

  // True when the whole rule is to go. Rules inside a rule that stays are cut one by one.
  function isDead(rule) {
    const prelude = blanked.slice(rule.start, rule.open).trim();
    const inside = rulesBetween(blanked, rule.open + 1, rule.close);
    if (/^@(keyframes|font-face|property|counter-style)/.test(prelude)) return false;
    if (prelude.startsWith('@')) {
      const gone = inside.map(isDead);
      let rest = blanked.slice(rule.open + 1, rule.close);
      for (const kid of inside) rest = rest.replace(blanked.slice(kid.start, kid.close + 1), '');
      const emptied = inside.length > 0 && gone.every(Boolean) && !rest.trim();
      if (!emptied) inside.forEach((kid, index) => gone[index] && cut(kid));
      return emptied;
    }
    const selectors = splitSelectors(prelude);
    if (selectors.length > 0 && selectors.every(needsDead)) return true;
    for (const kid of inside) if (isDead(kid)) cut(kid);
    return false;
  }

  for (const rule of rulesBetween(blanked, 0, blanked.length)) if (isDead(rule)) cut(rule);
  cuts.sort((a, b) => b.from - a.from);
  let text = original;
  for (const one of cuts) text = text.slice(0, one.from) + text.slice(one.to);
  return {
    text: text.replace(/\n{3,}/g, '\n\n'),
    removed: cuts.map(one => one.what).reverse(),
  };
}

// ---------- comparing pictures ----------

// The pixels of an 8-bit RGB or RGBA PNG, read with Node's own zlib.
function readPng(file) {
  const data = fs.readFileSync(file);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const packed = [];
  while (at < data.length) {
    const size = data.readUInt32BE(at);
    const kind = data.toString('ascii', at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + size);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 6 && body[9] !== 2) || body[12] !== 0)
        throw new Error('not an 8-bit RGB or RGBA picture: ' + file);
      channels = body[9] === 6 ? 4 : 3;
    } else if (kind === 'IDAT') packed.push(body);
    at += 12 + size;
  }
  const raw = zlib.inflateSync(Buffer.concat(packed));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] = (raw[row + x] + unfilter(filter, left, up, upLeft)) & 255;
    }
  }
  return { width, height, channels, pixels };
}

// What a PNG row filter adds back to a byte (the five filters of the format).
function unfilter(filter, left, up, upLeft) {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter !== 4) return 0;
  const guess = left + up - upLeft;
  const toLeft = Math.abs(guess - left);
  const toUp = Math.abs(guess - up);
  const toUpLeft = Math.abs(guess - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

// How many pixels of two pictures of one size differ by more than a faint shade.
function differingPixels(one, other) {
  let count = 0;
  for (let pixel = 0; pixel < one.width * one.height; pixel++)
    for (let channel = 0; channel < 3; channel++) {
      const gap =
        one.pixels[pixel * one.channels + channel] - other.pixels[pixel * other.channels + channel];
      if (gap > 6 || gap < -6) {
        count++;
        break;
      }
    }
  return count;
}

function comparePictures(before, after) {
  const names = fs.readdirSync(before).filter(name => name.endsWith('.png'));
  const lines = [];
  let same = 0;
  for (const name of names) {
    if (!fs.existsSync(path.join(after, name))) {
      lines.push([Infinity, name + ': no picture after']);
      continue;
    }
    const one = readPng(path.join(before, name));
    const other = readPng(path.join(after, name));
    if (one.width !== other.width || one.height !== other.height) {
      lines.push([Infinity, name + ': another size']);
      continue;
    }
    const count = differingPixels(one, other);
    const share = (100 * count) / (one.width * one.height);
    if (!count) same++;
    else lines.push([share, name + ': ' + count + ' pixels (' + share.toFixed(2) + '%)']);
  }
  console.log(names.length + ' pairs, ' + same + ' identical');
  lines.sort((a, b) => b[0] - a[0]).forEach(([, line]) => console.log('  ' + line));
  return lines.some(([share]) => share === Infinity) ? 1 : 0;
}

// ---------- the command ----------

function run(beginnings, write) {
  const sheetFiles = filesUnder(SHEETS).filter(file => file.endsWith('.css'));
  const sheetTexts = sheetFiles.map(file => [file, fs.readFileSync(file, 'utf8')]);
  const codeFiles = CODE_FOLDERS.flatMap(folder => filesUnder(path.join(ROOT, folder)))
    .filter(file => file.endsWith('.js'))
    .concat(path.join(ROOT, 'index.html'));
  const codeTexts = codeFiles.map(file => [file, fs.readFileSync(file, 'utf8')]);

  const used = namesInSheets(sheetTexts, beginnings);
  const dead = [];
  console.log('ALIVE (name: who writes it)');
  for (const name of [...used.keys()].sort()) {
    const producers = [...new Set(producersOf(name, codeTexts))];
    if (producers.length) console.log('  ' + name + ': ' + producers.slice(0, 4).join(', '));
    else dead.push(name);
  }
  console.log('\nDEAD (name: sheets that still use it)');
  for (const name of dead) console.log('  ' + name + ': ' + [...used.get(name)].join(', '));
  const joiners = [...new Set(joinersOf(beginnings, codeTexts))];
  if (joiners.length)
    console.log('\nCHECK BY HAND: these scripts join such names from parts: ' + joiners.join(', '));

  let total = 0;
  console.log('');
  for (const [file, text] of sheetTexts) {
    const result = withoutDeadRules(text, dead);
    if (!result.removed.length) continue;
    total += result.removed.length;
    console.log(path.basename(file) + ': ' + result.removed.length + ' rule(s)');
    result.removed.forEach(what => console.log('   ' + what.slice(0, 110)));
    if (write) fs.writeFileSync(file, result.text);
  }
  console.log(
    '\n' +
      (write ? 'TAKEN OUT: ' : 'WOULD TAKE OUT: ') +
      total +
      ' rule(s). ' +
      (write
        ? 'Now run `node tools/format-code.js` on the changed sheets and compare the pictures.'
        : 'Nothing was changed; add --write to take them out.')
  );
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const at = name => args.indexOf(name);
  if (at('--compare') >= 0 && args[at('--compare') + 2])
    process.exit(comparePictures(args[at('--compare') + 1], args[at('--compare') + 2]));
  const beginnings = (args[at('--names') + 1] || '')
    .split(',')
    .map(part => part.trim().replace(/^[.#]/, ''))
    .filter(Boolean);
  if (at('--names') < 0 || !beginnings.length) {
    console.log(
      'Usage: node tools/dead-style.js --names ap-,tpg-,agentsPage [--write]\n' +
        '       node tools/dead-style.js --compare <folder before> <folder after>'
    );
    process.exit(2);
  }
  run(beginnings, args.includes('--write'));
}

module.exports = {
  namesInSheets,
  producersOf,
  joinersOf,
  splitSelectors,
  outsideOptionalParts,
  withoutDeadRules,
};
