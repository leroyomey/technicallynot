/*
 * Technically Not desktop · skill-overlap.js — Finds skills about the same topic (several UI
 * skills, two usage-discipline skills) so agents merge them instead of piling up near-duplicates.
 * Used by `tnai skill save` (refuses a near-duplicate unless --distinct), `tnai skill overlaps`
 * (agent-mesh.js) and the Skills page's "Overlaps" badge (skill-service.js listSkills). Scope is
 * decided by the caller: Technically Not library skills and the project's skills, compared only
 * within the same scope (a general library skill is never merged into a project skill); never the
 * user's ~/.claude/skills or Technically Not's hidden program skills. Plain Node, no I/O.
 *
 * How "same topic" is decided (explainable on purpose, so the answer can say why):
 * - topic terms = the name's words (minus the `tnai` prefix and filler) + the `keywords:` list,
 * lightly stemmed (ads -> ad, hooks -> hook)
 * - terms = topic terms of each skill found in the other (its terms or its description words) / 2 ×
 * the smaller term count (0..1)
 * - text = shared description words / description words of the smaller skill (content words, 4+
 * letters) (the smaller count is taken as at least 2 terms / 4 description words, so a tiny skill
 * cannot score high on one word)
 * - paths = the two skills name the same `paths:` glob (they own the same files) score = 0.5 ×
 * terms + 0.5 × text + 0.15 per shared path (max 0.3). Two skills overlap when score ≥ THRESHOLD
 * and they share at least 2 distinct words, so one common word never links two skills. Groups are
 * the connected pairs. A match is a candidate, not a verdict: the agent reads both and keeps skills
 * apart that split one area into distinct jobs (hidden-skills/60-write-skills.md).
 */
'use strict';

// set on this project's 22 skills + the library: catches the two UI skills that both own
// src/styles/** and the two usage-discipline skills; the medium-split media skills mostly stay
// apart
const THRESHOLD = 0.25;
const GENERIC = new Set([
  'tnai',
  'skill',
  'skills',
  'the',
  'and',
  'for',
  'with',
  'of',
  'to',
  'a',
  'an',
  'new',
  'best',
  'practices',
  'technically',
  'not',
]);
const STOP = new Set([
  'about',
  'after',
  'also',
  'always',
  'anything',
  'before',
  'being',
  'both',
  'change',
  'changes',
  'changing',
  'does',
  'each',
  'every',
  'from',
  'have',
  'into',
  'just',
  'keep',
  'keeps',
  'make',
  'makes',
  'more',
  'most',
  'must',
  'only',
  'other',
  'over',
  'same',
  'should',
  'some',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'what',
  'when',
  'whenever',
  'where',
  'which',
  'while',
  'will',
  'with',
  'without',
  'your',
  'technically',
  'skill',
  'skills',
  'holds',
  'use',
  'using',
  'used',
  'any',
  'all',
  'how',
  'its',
  'needed',
  'need',
  'needs',
  'like',
  'such',
  'rather',
  'instead',
  'read',
  'work',
  'working',
  'user',
  'users',
  'asked',
  'already',
  'first',
  'next',
  'last',
  'still',
  'even',
  'there',
  'here',
]);

// ads -> ad, hooks -> hook, stories -> story; short words and -ss stay.
const stem = w =>
  w.length > 4 && w.endsWith('ies')
    ? w.slice(0, -3) + 'y'
    : w.length > 3 && w.endsWith('s') && !w.endsWith('ss')
      ? w.slice(0, -1)
      : w;
const words = text =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const list = value =>
  String(value || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s =>
      s
        .trim()
        .toLowerCase()
        .replace(/^(['"])(.*)\1$/, '$2')
    )
    .filter(Boolean);

// { name, description, keywords, paths } (strings, as in the frontmatter) -> the features compared.
function features(skill) {
  const nameWords = words(skill.name)
    .filter(w => w.length > 1 && !GENERIC.has(w))
    .map(stem);
  const terms = new Set(nameWords);
  for (const k of list(skill.keywords)) terms.add(words(k).map(stem).join(' '));
  terms.delete('');
  const text = new Set(
    words(skill.description)
      .filter(w => w.length >= 4 && !STOP.has(w))
      .map(stem)
  );
  const paths = new Set(list(skill.paths).map(p => p.replace(/\\/g, '/').replace(/^\.\//, '')));
  return { terms, text, paths };
}

const shared = (a, b) => [...a].filter(x => b.has(x));

// Share of the smaller set, counted as at least `floor` items, so a two-word description does not
// reach 50% on one word.
const ratio = (n, a, b, floor) => Math.min(1, n / Math.max(floor, Math.min(a.size, b.size)));

// { score, terms: [shared terms], text: [shared description words], paths: [shared globs] }
function compare(a, b) {
  const fa = a._f || features(a),
    fb = b._f || features(b);

  // A topic term also counts when the other skill's description says it (e.g. a skill named for
  // "usage" and another whose description says "usage").
  const found = (t, f) => f.terms.has(t) || t.split(' ').every(w => f.text.has(w));
  const aIn = [...fa.terms].filter(t => found(t, fb)),
    bIn = [...fb.terms].filter(t => found(t, fa));
  const terms = [...new Set([...aIn, ...bIn])],
    text = shared(fa.text, fb.text),
    paths = shared(fa.paths, fb.paths);
  const termRatio = Math.min(
    1,
    (aIn.length + bIn.length) / (2 * Math.max(2, Math.min(fa.terms.size, fb.terms.size)))
  );
  const score =
    0.5 * termRatio +
    0.5 * ratio(text.length, fa.text, fb.text, 4) +
    Math.min(0.3, 0.15 * paths.length);

  // one word shared as a term and in the description counts once
  const distinct = new Set([...terms.flatMap(t => t.split(' ')), ...text]).size;
  return { score: Math.round(score * 100) / 100, terms, text, paths, distinct };
}
const overlapping = r => r.score >= THRESHOLD && r.distinct >= 2;

// Why two skills overlap, in one short line for an agent or a tooltip.
function reason(r) {
  return (
    [
      r.terms.length ? 'shared topic words: ' + r.terms.slice(0, 6).join(', ') : '',
      r.text.length ? 'description words: ' + r.text.slice(0, 6).join(', ') : '',
      r.paths.length ? 'same files: ' + r.paths.join(', ') : '',
    ]
      .filter(Boolean)
      .join('; ') +
    ' (score ' +
    r.score +
    ')'
  );
}

const scopeOf = s => s.scope || s.source || '';

// Skills (same scope only) that overlap `skill`, best first: [{ skill, ...compare, why }]. `skill`
// itself (same path or same name) is left out.
function against(skill, skills) {
  const f = { ...skill, _f: features(skill) };
  return skills
    .filter(
      s =>
        scopeOf(s) === scopeOf(skill) && s.name !== skill.name && (!s.path || s.path !== skill.path)
    )
    .map(s => ({ skill: s, ...compare(f, s) }))
    .filter(overlapping)
    .map(r => ({ ...r, why: reason(r) }))
    .sort((x, y) => y.score - x.score);
}

// Overlap groups among `skills`: [{ scope, skills: [skill...], pairs: [{ a, b, score, why }] }],
// biggest first. Pairs are compared within one scope.
function groups(skills) {
  const all = skills.map(s => ({ ...s, _f: features(s) }));
  const parent = all.map((_, i) => i),
    find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      if (scopeOf(all[i]) !== scopeOf(all[j])) continue;
      const r = compare(all[i], all[j]);
      if (!overlapping(r)) continue;
      pairs.push({ i, j, a: all[i].name, b: all[j].name, score: r.score, why: reason(r) });
      parent[find(i)] = find(j);
    }
  const byRoot = new Map();
  for (const p of pairs) {
    const root = find(p.i);
    if (!byRoot.has(root)) byRoot.set(root, { members: new Set(), pairs: [] });
    const g = byRoot.get(root);
    g.members.add(p.i).add(p.j);
    g.pairs.push(p);
  }
  const strip = ({ _f, ...s }) => s;
  return [...byRoot.values()]
    .map(g => ({
      scope: scopeOf(all[[...g.members][0]]),
      skills: [...g.members].map(i => strip(all[i])),
      pairs: g.pairs
        .sort((x, y) => y.score - x.score)
        .map(({ a, b, score, why }) => ({ a, b, score, why })),
    }))
    .sort((x, y) => y.skills.length - x.skills.length);
}

module.exports = { THRESHOLD, features, compare, against, groups, reason };
