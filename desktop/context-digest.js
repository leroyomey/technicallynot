/*
 * Technically Not desktop · context-digest.js — Consolidation of the shared project context
 * (agent-context.js), so old results from old agents never pile up. INFERRED and deterministic (no
 * model calls); part of automatic upkeep (per project `auto`): runs on every new result, when a
 * project's context is loaded, after a removal and when upkeep is turned on. Turning upkeep off
 * unfolds everything (flags and digest dropped, automatic marks dropped by agent-context.js).
 * CHATTER (`e.chatter`): a result with no edited files and no decision that is a relayed message /
 * task notification (answer < 1500 chars), or a short unreported answer (< 600 chars) naming no
 * file, with nothing found / decided / open. Folded: left out of the lists, of delivery and of
 * `tnai context`. While upkeep is on, a new result that is empty coordination (that shape, and also
 * no report and no Changed / Found / Decided / open line; the extracted first sentence does not
 * count) is not stored at all (`dropAsChatter`); one stored while upkeep was off is still only
 * flagged here. MERGED: an open item (blockers / remains / next / ideas) that a newer result
 * restates (2+ shared significant words, >= 70% of the smaller item) is marked { state: 'merged',
 * by, into, why }: only the newest wording stays open. STALE: an open item older than 3 days
 * (however old) that no later result restates or names in its task is parked { state: 'stale', why
 * }; so is a decision nobody answered once the same agent reported a later result, or after 3 days.
 * ROLLED (`e.rolled`): results past the newest 10 (chatter not counted) or older than 1 day go into
 * `p.digest`: clusters of results that edited the same files (union-find over edited files, else
 * mentioned files, else the top keyword; hub files edited by many results link nothing), each with
 * its files (deleted ones dropped by state()), merged did / changed and decided lines (a restated
 * line keeps the newest wording), agents, span and how many open items it holds; those leave the
 * open lists (they come from recent results only). Automatic delivery skips rolled results; `tnai
 * context` shows the digest in their place and `tnai context TOPIC` still searches them. Undo of
 * merged / stale sticks like any automatic mark (`kept`).
 */
'use strict';
const path = require('path');

const RECENT = 10,
  ROLL_DAYS = 1,
  STALE_DAYS = 3,
  SIMILAR = 0.7,
  CLUSTERS = 30;
const OPEN_KINDS = ['blockers', 'remains', 'next', 'ideas'];
const RELAY_RE =
  /^\s*(\[from\b|<task-notification>|<agent-message\b|\[Subagent hand-back\]|Sub-agent report:|\[(?:TN|TechnicallyNot)\.ai\] Sub-agent\b)/i;
const DAY = 864e5;

function isChatter(e) {
  const s = e.summary || {};
  if ((e.edited || []).length || s.choices) return false;
  if (RELAY_RE.test(e.task || '')) return e.chars < 1500;
  const substance = ['found', 'decided', ...OPEN_KINDS].some(k => s[k]?.length);

  // Codex and others have no edit hooks: a report or a named file is work
  return e.chars < 600 && !substance && !e.reported && !(e.files || []).length;
}

// Not stored while upkeep is on. The extracted first sentence ("Did") does not count: every short
// answer has one. A report, a named file, a decision, or a Changed / Found / Decided / open line
// stays, even on a relay.
function dropAsChatter(e) {
  if (!isChatter(e) || e.reported) return false;
  const s = e.summary || {};
  return !['changed', 'found', 'decided', ...OPEN_KINDS].some(k => s[k]?.length);
}

// h: { sig, shareOf, markKey, keywords, agentKey }
function consolidate(p, h) {
  if (!p.auto) {
    for (const e of p.entries) {
      delete e.chatter;
      delete e.rolled;
    }
    p.digest = null;
    return;
  }
  const now = Date.now(),
    similar = (A, B) => {
      const n = h.shareOf(A, B).length;
      return n >= 2 && n / Math.min(A.size, B.size) >= SIMILAR;
    };
  for (const e of p.entries) {
    if (isChatter(e)) e.chatter = true;
    else delete e.chatter;
  }
  const real = p.entries.filter(e => !e.chatter);

  // Merged and stale open items (newest first, so a newer wording wins).
  const kept = []; // { W, key, e } open items already seen in newer results
  const taskSig = new Map(real.map(e => [e, h.sig(e.task)]));
  for (const e of real) {
    // every result: an old open item must still be parked, however old
    for (const k of OPEN_KINDS)
      (e.summary?.[k] || []).forEach((item, i) => {
        const key = h.markKey(e.id, k, i);
        if (p.marks[key] || p.kept[key]) return;
        const W = h.sig(item);
        if (W.size < 2) return;
        const newer = kept.find(x => x.e !== e && similar(W, x.W));
        if (newer) {
          p.marks[key] = {
            state: 'merged',
            by: newer.e.id,
            into: newer.key,
            at: newer.e.at,
            why:
              'restated by ' + newer.e.name + ': ' + h.shareOf(W, newer.W).slice(0, 4).join(', '),
          };
          return;
        }
        if (
          now - e.at > STALE_DAYS * DAY &&
          !real.some(x => x.at > e.at && h.shareOf(W, taskSig.get(x)).length / W.size >= SIMILAR)
        ) {
          p.marks[key] = {
            state: 'stale',
            at: now,
            why: 'open for more than ' + STALE_DAYS + ' days; no later result restated or named it',
          };
          return;
        }
        kept.push({ W, key, e });
      });
  }

  // Unanswered decisions: parked once the same agent reported a later (real) result, or after
  // STALE_DAYS.
  real.forEach((e, i) => {
    if (!e.summary?.choices) return;
    const later = real.slice(0, i).find(x => h.agentKey(x) === h.agentKey(e));
    [e.summary.choices, ...(e.summary.choices.more || [])].forEach((_, n) => {
      // each decision of the report on its own key
      const key = h.markKey(e.id, 'choices', n);
      if (p.marks[key] || p.kept[key]) return;
      if (later)
        p.marks[key] = {
          state: 'stale',
          by: later.id,
          at: later.at,
          why: e.name + ' reported again since; answer it there if it still matters',
        };
      else if (now - e.at > STALE_DAYS * DAY)
        p.marks[key] = {
          state: 'stale',
          at: now,
          why: 'waiting for more than ' + STALE_DAYS + ' days',
        };
    });
  });

  // Rolled results and the digest.
  const rolled = real.filter((e, i) => i >= RECENT || now - e.at > ROLL_DAYS * DAY);
  for (const e of real) delete e.rolled;
  for (const e of rolled) e.rolled = true;
  const chatter = p.entries.length - real.length;
  p.digest =
    rolled.length || chatter
      ? {
          count: rolled.length,
          chatter,
          from: rolled.length ? rolled[rolled.length - 1].at : 0,
          to: rolled[0]?.at || 0,
          clusters: clusters(p, rolled, h, similar),
        }
      : null;
}

function clusters(p, list, h, similar) {
  const parent = new Map(),
    find = x => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
  const add = x => {
    if (!parent.has(x)) parent.set(x, x);
    return x;
  };

  // Hub files (docs, index.html, … edited by many results) would chain unrelated work into one
  // cluster: they link only a result that has no other file.
  const own = e => (e.edited?.length ? e.edited : (e.files || []).slice(0, 3)),
    freq = new Map();
  for (const e of list)
    for (const f of new Set(own(e).map(x => x.toLowerCase()))) freq.set(f, (freq.get(f) || 0) + 1);
  const hub = f => freq.get(f.toLowerCase()) > Math.max(3, list.length * 0.15);
  const linkFiles = e => {
    const all = own(e),
      plain = all.filter(f => !hub(f));
    return plain.length ? plain : all.slice(0, 1);
  };
  const keysOf = e => {
    const fl = linkFiles(e);
    return (fl.length ? fl : ['kw:' + ((e.keywords || [])[0] || 'general')]).map(f =>
      add(f.toLowerCase())
    );
  };
  for (const e of list) {
    const ks = keysOf(e);
    for (const k of ks.slice(1)) parent.set(find(k), find(ks[0]));
  }
  const groups = new Map();
  for (const e of list) {
    const g = find(keysOf(e)[0]);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(e);
  }
  const stem = f =>
    path
      .basename(f)
      .replace(/\.\w+$/, '')
      .replace(/^\d+[-_]/, '');
  const merge = (items, max) => {
    const out = [];
    for (const x of items) {
      const W = h.sig(x);
      if (!out.some(o => (W.size >= 2 && similar(W, o.W)) || o.x === x)) out.push({ x, W });
      if (out.length >= max) break;
    }
    return out.map(o => o.x);
  };
  return [...groups.values()]
    .map(es => {
      const count = new Map();
      for (const e of es)
        // hubs after the cluster's own files
        for (const f of own(e)) count.set(f, (count.get(f) || 0) + (hub(f) ? 0.5 : 1));
      const files = [...count]
        .sort((a, b) => b[1] - a[1])
        .map(([f]) => f)

        // no disk checks here (main thread, maybe a synced folder): state() drops deleted ones
        // asynchronously
        .slice(0, 12);
      const stems = [
        ...new Set((files.some(f => !hub(f)) ? files.filter(f => !hub(f)) : files).map(stem)),
      ];
      const kw = es.flatMap(e => e.keywords || []);
      return {
        id: es[0].id,
        label: stems.length
          ? stems.slice(0, 2).join(' · ') + (stems.length > 2 ? ' +' + (stems.length - 2) : '')
          : kw[0] || 'general',
        files,
        did: merge(
          es.flatMap(e => [].concat(e.summary?.did || [], e.summary?.changed || [])),
          4
        ),
        decided: merge(
          es.flatMap(e => e.summary?.decided || []),
          3
        ),
        open: es.reduce(
          (n, e) =>
            n +
            OPEN_KINDS.reduce(
              (m, k) =>
                m + (e.summary?.[k] || []).filter((_, i) => !p.marks[h.markKey(e.id, k, i)]).length,
              0
            ),
          0
        ),
        agents: [...new Set(es.map(e => e.name))],
        entries: es.map(e => e.id),
        from: es[es.length - 1].at,
        to: es[0].at,
      };
    })
    .sort((a, b) => b.to - a.to)
    .slice(0, CLUSTERS);
}

// For `tnai context`: the digest as a few lines.
function text(p, ago) {
  const d = p.digest;
  if (!d?.clusters?.length) return '';
  return (
    '\nEarlier work, consolidated from ' +
    d.count +
    ' older results (`tnai context TOPIC` searches them, `tnai context show ID` opens one):\n' +
    d.clusters
      .slice(0, 8)
      .map(
        c =>
          '  - ' +
          c.label +
          ': ' +
          (c.did.slice(0, 2).join('; ') || 'no summary') +
          (c.decided.length ? ' | Decided: ' + c.decided[0] : '') +
          ' (' +
          c.agents.slice(0, 3).join(', ') +
          ', ' +
          ago(c.to) +
          ', e.g. result ' +
          c.id +
          ')'
      )
      .join('\n')
  );
}

module.exports = { consolidate, text, isChatter, dropAsChatter, RECENT, ROLL_DAYS, STALE_DAYS };
