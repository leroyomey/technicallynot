// Technically Not tools · release-notes.js: the one rule for how a release's "What's new" list is
// ordered (all fixed items together, all new items
// together, all changed items together, instead of mixed). Every line of the notes is one
// change that starts with its kind ("- New: ...", "- Changed: ...", "- Faster: ...", "- Fixed:
// ..."). The list is always shown kind by kind, in this order: New, Changed (Changed, Improved,
// Faster, Better, Updated), Removed, Fixed, then anything with no kind. Inside a kind the lines
// keep the order they were written in. node tools/release-notes.js FILE prints the notes grouped
// node tools/release-notes.js --check FILE exit code 1 when the file is not grouped already, or a
// line has no kind (each is named) node tools/release-notes.js --write FILE rewrites the file
// grouped. The release script groups the notes with this before they become the release tag (the
// update dialog's text, the Discord changelog post, the commit body) and the website's changelog
// entry, so a mixed list cannot go out even when nobody ran the check. The two places that show
// notes group them again when they draw, with the same kinds and order, so an older release written
// mixed is shown grouped too: src/scripts/36-app-updates.js (the update dialog) and the website
// repo's changelog.js (the changelog page). Keep the three in step.
const ORDER = ['new', 'changed', 'removed', 'fix', 'other'];
const NAME = { new: 'New', changed: 'Changed', removed: 'Removed', fix: 'Fixed', other: 'no kind' };
const firstWord = s =>
  (/^([A-Za-z]+)\b[:,]?/.exec(s) || [''])[0].replace(/[:,]$/, '').toLowerCase();

// The kind of one change, from its first word only (the dialog also guesses from wording to pick a
// color; an order must not rest on a guess).
function kindOf(text) {
  const w = firstWord(
    String(text || '')
      .replace(/^[ \t]*[-*•][ \t]+/, '')
      .replace(/^\*\*|\*\*/g, '')
  );
  return /^fix(ed|es)?$/.test(w)
    ? 'fix'
    : /^(new|add(ed|s)?)$/.test(w)
      ? 'new'
      : /^(removed?|gone|dropped)$/.test(w)
        ? 'removed'
        : /^(changed?|improved?|faster|better|updated?)$/.test(w)
          ? 'changed'
          : 'other';
}

// A list of changes (strings, with or without their "- ") in the fixed order; the order inside a
// kind is kept.
const groupList = list => ORDER.flatMap(k => list.filter(x => kindOf(x) === k));

// Notes as text: lines before the first bullet stay on top, lines after the last stay below, the
// bullets between are grouped. A line that continues a bullet (indented, no "- " of its own)
// travels with it.
function group(text) {
  const lines = String(text || '')
      .replace(/\r/g, '')
      .split('\n'),
    isBullet = l => /^[ \t]*[-*•][ \t]+/.test(l);
  const first = lines.findIndex(isBullet);
  if (first < 0) return String(text || '').trim();
  let last = first;
  lines.forEach((l, i) => {
    if (isBullet(l)) last = i;
  });
  while (
    last + 1 < lines.length &&
    lines[last + 1].trim() &&
    !isBullet(lines[last + 1]) &&
    /^[ \t]/.test(lines[last + 1])
  )
    last++; // the last change's own indented lines
  const items = [];
  for (const l of lines.slice(first, last + 1)) {
    if (isBullet(l)) items.push(l);
    else if (l.trim() && items.length) items[items.length - 1] += '\n' + l;
  }
  return [...lines.slice(0, first), ...groupList(items), ...lines.slice(last + 1)]
    .join('\n')
    .trim();
}

// What is wrong with a notes text as written: [] when it is grouped and every change has a kind.
function problems(text) {
  const bullets = String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .filter(l => /^[ \t]*[-*•][ \t]+/.test(l)),
    out = [];
  bullets
    .filter(b => kindOf(b) === 'other')
    .forEach(b =>
      out.push(
        'no kind at its start (New, Changed, Faster, Removed, Fixed): ' + b.trim().slice(0, 90)
      )
    );
  let high = 0;
  for (const b of bullets) {
    const i = ORDER.indexOf(kindOf(b));
    if (i < high) {
      out.push(
        'out of order: a ' +
          NAME[kindOf(b)] +
          ' line comes after a later kind: ' +
          b.trim().slice(0, 90)
      );
      break;
    }
    high = i;
  }
  return out;
}
module.exports = { ORDER, NAME, kindOf, groupList, group, problems };

if (require.main === module) {
  const fs = require('fs'),
    args = process.argv.slice(2),
    file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node tools/release-notes.js [--check|--write] FILE');
    process.exit(1);
  }
  const text = fs.readFileSync(file, 'utf8');
  if (args.includes('--check')) {
    const p = problems(text);
    if (p.length) {
      console.log('Release notes are not grouped by kind (' + file + '):');
      p.forEach(x => console.log('  ' + x));
      console.log('Fix: node tools/release-notes.js --write ' + file);
      process.exit(1);
    }
    console.log('OK: grouped by kind (New, Changed, Removed, Fixed).');
  } else if (args.includes('--write')) {
    fs.writeFileSync(file, group(text) + '\n');
    console.log('Rewritten grouped: ' + file);
  } else console.log(group(text));
}
