// Technically Not · 26-file-changes.js — Desktop app: Live AI change cards: a line diff (＋added
// −removed, who, when) of each change in a collapsible strip under the text; minimize / expand /
// close, consecutive changes by the same agent merge. Settings › General toggles the cards (22).
// `window.TnaiFileDiff` = { attach(host, path) → detach(), diff(before, after), cards(path) } for
// other file views.
(() => {
  const native = window.tnaiNative,
    files = window.TnaiProjectFiles;
  const live = !!(native?.fs?.onChanges && native.fs.read && native.fs.stat && files);

  // files larger than this get no cards (09 opens them view-only too)
  const MAX_BYTES = 2 * 1024 * 1024;

  // changed region larger than this: counted as all-removed + all-added, marked approximate
  const MAX_LINES = 20000;
  const MAX_D = 1500; // Myers edit-distance cap before falling back the same way
  const MERGE_MS = 20000; // a change by the same agent within this time merges into its latest card
  const MAX_CARDS = 20,
    PREVIEW = 8,
    FULL = 2000;

  // ---------------------------------------------------------------- line diff (Myers, common
  // prefix/suffix trimmed first)
  const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = text => {
    const a = normalize(text).split('\n');
    if (a.length && a[a.length - 1] === '') a.pop();
    return a;
  };

  function myers(A, B) {
    const ids = new Map(),
      id = s => {
        let v = ids.get(s);
        if (v === undefined) ids.set(s, (v = ids.size));
        return v;
      };
    const a = Int32Array.from(A, id),
      b = Int32Array.from(B, id),
      n = a.length,
      m = b.length,
      max = n + m,
      off = max + 1;
    const v = new Int32Array(2 * max + 3),
      trace = [];
    for (let d = 0; d <= max; d++) {
      if (d > MAX_D) return null;
      trace.push(v.slice(off - d, off + d + 1)); // values from step d-1, for k in [-d, d]
      for (let k = -d; k <= d; k += 2) {
        let x =
            k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
              ? v[off + k + 1]
              : v[off + k - 1] + 1,
          y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x++;
          y++;
        }
        v[off + k] = x;
        if (x >= n && y >= m) {
          const ops = [];
          let px = n,
            py = m;
          for (let e = d; e > 0; e--) {
            const V = trace[e],
              get = j => V[j + e],
              kk = px - py;
            const prevK = kk === -e || (kk !== e && get(kk - 1) < get(kk + 1)) ? kk + 1 : kk - 1,
              prevX = get(prevK),
              prevY = prevX - prevK;
            while (px > prevX && py > prevY) {
              ops.push('=');
              px--;
              py--;
            }
            if (px === prevX) {
              ops.push('+');
              py--;
            } else {
              ops.push('-');
              px--;
            }
          }
          while (px > 0 && py > 0) {
            ops.push('=');
            px--;
            py--;
          }
          return ops.reverse();
        }
      }
    }
    return null;
  }

  // → { added, removed, approximate, hunks: [{ lines: [{ t: '+'|'-', n, text }] }] } (n = new line
  // number for '+', old for '-').
  function diff(before, after) {
    const a = lines(before),
      b = lines(after);
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (
      suf < a.length - pre &&
      suf < b.length - pre &&
      a[a.length - 1 - suf] === b[b.length - 1 - suf]
    )
      suf++;
    const A = a.slice(pre, a.length - suf),
      B = b.slice(pre, b.length - suf);
    let ops = A.length + B.length > MAX_LINES ? null : myers(A, B);
    const approximate = !ops;
    if (!ops) ops = [...A.map(() => '-'), ...B.map(() => '+')];
    const hunks = [];
    let i = 0,
      j = 0,
      hunk = null,
      added = 0,
      removed = 0;
    for (const op of ops) {
      if (op === '=') {
        hunk = null;
        i++;
        j++;
        continue;
      }
      if (!hunk) hunks.push((hunk = { lines: [] }));
      if (op === '-') {
        hunk.lines.push({ t: '-', n: pre + i + 1, text: A[i] });
        i++;
        removed++;
      } else {
        hunk.lines.push({ t: '+', n: pre + j + 1, text: B[j] });
        j++;
        added++;
      }
    }

    // Within a hunk show removed lines before added ones, like a unified diff.
    hunks.forEach(h => {
      h.lines = [...h.lines.filter(l => l.t === '-'), ...h.lines.filter(l => l.t === '+')];
    });
    return { added, removed, approximate, hunks };
  }

  const inactive = { attach: () => () => {}, diff, cards: () => [] };
  if (!live) {
    window.TnaiFileDiff = inactive;
    return;
  }

  const style = document.createElement('style');
  style.textContent = `
.fd-strip{display:grid;grid-template-rows:auto minmax(0,1fr);position:relative;z-index:1;min-height:0;max-height:30vh;margin-top:8px;border:1px solid #e4e8df;border-radius:7px;background:#fbfcf9}
.fd-strip[hidden]{display:none}.fd-strip.collapsed{grid-template-rows:auto}.fd-strip.collapsed .fd-cards{display:none}
.fd-strip-head{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #eceee9;color:#8a8f84;font:9px var(--pg-sans)}
.fd-strip.collapsed .fd-strip-head{border-bottom:0}
.fd-strip-head button{padding:2px 5px;border:0;border-radius:4px;background:none;color:#6f7569;font:9px var(--pg-sans);cursor:pointer}.fd-strip-head button:hover{background:#eef0ea;color:#3f433b}
.fd-strip-toggle{font-weight:600!important;color:#4e5547!important}.fd-strip-head span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fd-cards{display:grid;align-content:start;gap:6px;min-height:0;overflow:auto;padding:6px}
.fd-card{border:1px solid #e6e9e1;border-radius:6px;background:#fff;overflow:hidden}
.fd-card>header{display:flex;align-items:center;gap:7px;padding:5px 6px 5px 8px;color:#80857b;font:9px var(--pg-sans)}
.fd-card[data-view=min]>header{cursor:pointer}
.fd-add{color:#4d7134;font:600 10px var(--pg-sans)}.fd-del{color:#a45750;font:600 10px var(--pg-sans)}
.fd-who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4e5547}.fd-who i{color:#9a9f94;font-style:normal}
.fd-card>header button{display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:none;color:#8f9489;font:11px/1 var(--pg-sans);cursor:pointer}
.fd-card>header button:hover{background:#eef0ea;color:#3f433b}
.fd-lines{border-top:1px solid #f0f2ec;font:10.5px/1.5 Consolas,'Cascadia Mono',Menlo,monospace}
.fd-card[data-view=min] .fd-lines{display:none}.fd-card[data-view=full] .fd-lines{max-height:26vh;overflow:auto}
.fd-line{display:grid;grid-template-columns:34px 12px minmax(0,1fr);white-space:pre}
.fd-line i{padding-right:6px;color:#aab0a3;font-style:normal;text-align:right;user-select:none}.fd-line b{font-weight:400;user-select:none}
.fd-line code{overflow:hidden;text-overflow:ellipsis;font:inherit}.fd-card[data-view=full] .fd-line code{overflow:visible}
.fd-line.add{background:#eef5e8;color:#3f6128}.fd-line.del{background:#f8eeec;color:#96483f}
.fd-hunk{padding:3px 8px;background:#f6f7f3;color:#a2a69c;font:9px var(--pg-sans)}
.fd-more{display:block;width:100%;padding:3px 8px;border:0;background:#f6f7f3;color:#6f7569;font:9px var(--pg-sans);text-align:left;cursor:pointer}.fd-more:hover{color:#3f433b}
`;
  document.head.append(style);

  const enabled = () => window.TnaiSettings?.get?.('liveAiChanges') ?? true;
  const ago = at => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    return s < 60
      ? s + 's ago'
      : s < 3600
        ? Math.floor(s / 60) + 'm ago'
        : Math.floor(s / 3600) + 'h ago';
  };

  // Which agent changed a file: 13 credits changes to the agent whose output names the file (or the
  // only one active). Inferred, and labelled so.
  function whoChanged(path) {
    const act = window.TnaiFileActivity,
      list = (window.TnaiAgents?.sessions?.() || []).filter(s =>
        act?.forPane?.(s.paneId)?.includes(path)
      );
    list.sort((x, y) => (act.now(y.paneId)?.at || 0) - (act.now(x.paneId)?.at || 0));
    const s = list[0];
    return s ? { key: s.paneId, name: s.name, agent: s.agent } : { key: '', name: '', agent: '' };
  }

  // ---------------------------------------------------------------- disk snapshots of watched
  // files path -> normalized text | null (unreadable, binary, too large, missing)
  const snaps = new Map();
  const watched = new Map(); // path -> number of attached views
  const chains = new Map(); // path -> promise: reads and diffs for one file run in order
  const enqueue = (path, fn) => {
    const p = (chains.get(path) || Promise.resolve()).then(fn).catch(error => console.error(error));
    chains.set(path, p);
    p.then(() => {
      if (chains.get(path) === p) chains.delete(path);
    });
    return p;
  };

  async function readText(path) {
    const st = await native.fs.stat(path);
    if (!st?.ok || st.value.size > MAX_BYTES) return null;
    const r = await native.fs.read(path, 0, st.value.size);
    if (!r?.ok) return null;
    const bytes = r.value;
    if (bytes.subarray(0, 8192).includes(0)) return null;
    try {
      return normalize(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).replace(/^﻿/, '');
    } catch {
      return null;
    }
  }
  const snapshot = path =>
    enqueue(path, async () => {
      const text = await readText(path);
      if (watched.has(path)) snaps.set(path, text);
    });

  function watch(path) {
    watched.set(path, (watched.get(path) || 0) + 1);
    if (!snaps.has(path)) snapshot(path);
  }

  function unwatch(path) {
    const n = (watched.get(path) || 1) - 1;
    if (n > 0) {
      watched.set(path, n);
      return;
    }
    watched.delete(path);
    snaps.delete(path);
    pruneCards();
  }

  // ---------------------------------------------------------------- cards
  const cards = new Map(); // path -> [card], newest first
  let seq = 0;

  // Cards stay for a file reopened soon (they are its change history), but only the newest
  // UNSEEN_PATHS files that no view shows keep their old+new text.
  const UNSEEN_PATHS = 20;

  function pruneCards() {
    const idle = [...cards]
      .filter(([p]) => !watched.has(p))
      .sort((a, b) => (b[1][0]?.at || 0) - (a[1][0]?.at || 0));
    for (const [p] of idle.slice(UNSEEN_PATHS)) cards.delete(p);
  }

  function record(path, before, after, who) {
    if (!enabled()) return;
    const list = cards.get(path) || [],
      top = list[0],
      now = Date.now();
    if (top && top.who.key === who.key && now - top.at < MERGE_MS) {
      Object.assign(top, { text: after, at: now, diff: diff(top.base, after) });
      if (!top.diff.added && !top.diff.removed) list.shift(); // the agent put it back as it was
    } else {
      const d = diff(before, after);
      if (!d.added && !d.removed) return;
      list.unshift({
        id: 'c' + ++seq,
        path,
        who,
        base: before,
        text: after,
        at: now,
        diff: d,
        view: 'compact',
      });
      list.length = Math.min(list.length, MAX_CARDS);
    }
    if (list.length) cards.set(path, list);
    else cards.delete(path);
    hosts.forEach(h => {
      if (h.path === path) render(h);
    });
  }

  const hosts = new Set();
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function cardEl(c) {
    const card = el('article', 'fd-card');
    card.dataset.card = c.id;
    card.dataset.view = c.view;
    const head = el('header');
    const who = el('span', 'fd-who');
    if (c.who.name) {
      who.append(c.who.name + ' ');
      who.append(el('i', '', '(inferred)'));
      who.title =
        c.who.name +
        (c.who.agent ? ' · ' + c.who.agent : '') +
        ' — inferred from its output and the file change';
    } else {
      who.textContent = 'Source unknown';
      who.title = 'Changed on disk; no running agent was matched to this change';
    }
    const time = el('time', '', ago(c.at));
    time.dataset.at = c.at;
    time.title = new Date(c.at).toLocaleTimeString();
    const btn = (act, text, title) => {
      const b = el('button', '', text);
      b.type = 'button';
      b.dataset.act = act;
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };
    head.append(
      el('b', 'fd-add', '＋' + c.diff.added),
      el('b', 'fd-del', '−' + c.diff.removed),
      who,
      time,
      btn('min', c.view === 'min' ? '▢' : '–', c.view === 'min' ? 'Show changes' : 'Minimize'),
      btn(
        'full',
        c.view === 'full' ? '↙' : '⤢',
        c.view === 'full' ? 'Show less' : 'Expand full diff'
      ),
      btn('close', '×', 'Close')
    );
    card.append(head);
    if (c.view === 'min') return card;
    const body = el('div', 'fd-lines'),
      limit = c.view === 'full' ? FULL : PREVIEW;
    let shown = 0,
      total = 0;
    c.diff.hunks.forEach((h, i) => {
      total += h.lines.length;
      if (shown >= limit) return;
      if (c.diff.hunks.length > 1 || i) body.append(el('div', 'fd-hunk', 'line ' + h.lines[0].n));
      for (const l of h.lines) {
        if (shown >= limit) break;
        const row = el('div', 'fd-line ' + (l.t === '+' ? 'add' : 'del'));
        row.append(
          el('i', '', l.n),
          el('b', '', l.t === '+' ? '+' : '−'),
          el('code', '', l.text || ' ')
        );
        body.append(row);
        shown++;
      }
    });
    if (total > shown) {
      const more = el(
        'button',
        'fd-more',
        total - shown + ' more changed lines' + (c.view === 'full' ? ' not shown' : ' · Expand')
      );
      more.type = 'button';
      if (c.view !== 'full') more.dataset.act = 'full';
      body.append(more);
    }
    if (c.diff.approximate)
      body.append(el('div', 'fd-hunk', 'Large change: shown as whole-block replace (approximate)'));
    card.append(body);
    return card;
  }

  function render(h) {
    const list = enabled() ? cards.get(h.path) || [] : [];
    h.strip.hidden = !list.length;
    if (!list.length) {
      h.strip.replaceChildren();
      return;
    }
    const head = el('header', 'fd-strip-head'),
      toggle = el(
        'button',
        'fd-strip-toggle',
        (h.collapsed ? '▸ ' : '▾ ') + 'Live changes · ' + list.length
      );
    toggle.type = 'button';
    toggle.dataset.act = 'strip';
    toggle.setAttribute('aria-expanded', String(!h.collapsed));
    const clear = el('button', '', 'Clear');
    clear.type = 'button';
    clear.dataset.act = 'clear';
    clear.title = 'Close all change cards for this file';
    head.append(toggle, el('span', '', 'What agents changed in this file, newest first'), clear);
    const box = el('div', 'fd-cards');
    box.append(...list.map(cardEl));
    h.strip.classList.toggle('collapsed', h.collapsed);
    h.strip.replaceChildren(head, box);
  }

  function renderPath(path) {
    hosts.forEach(h => {
      if (h.path === path) render(h);
    });
  }

  function attach(host, path, options = {}) {
    if (!host || !path) return () => {};
    const strip = el('section', 'fd-strip');
    strip.hidden = true;
    strip.dataset.path = path;
    strip.setAttribute('aria-label', 'Live changes to ' + path);
    if (options.before && options.before.parentNode === host)
      host.insertBefore(strip, options.before);
    else host.append(strip);
    const h = { host, path, strip, collapsed: false };
    strip.addEventListener('click', event => {
      const b = event.target.closest('[data-act]'),
        cardNode = event.target.closest('.fd-card');
      const list = cards.get(path) || [],
        c = cardNode && list.find(x => x.id === cardNode.dataset.card);
      if (!b) {
        if (c?.view === 'min') {
          c.view = 'compact';
          renderPath(path);
        }
        return;
      }
      const act = b.dataset.act;
      if (act === 'strip') {
        h.collapsed = !h.collapsed;
        render(h);
        return;
      }
      if (act === 'clear') {
        cards.delete(path);
        renderPath(path);
        return;
      }
      if (!c) return;
      if (act === 'close') {
        list.splice(list.indexOf(c), 1);
        if (!list.length) cards.delete(path);
      } else if (act === 'min') c.view = c.view === 'min' ? 'compact' : 'min';
      else if (act === 'full') c.view = c.view === 'full' ? 'compact' : 'full';
      renderPath(path);
    });
    hosts.add(h);
    watch(path);
    render(h);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      hosts.delete(h);
      strip.remove();
      unwatch(path);
    };
  }

  // Relative times ("2s ago") tick while cards are on screen.
  // Skipped while the window is hidden or minimized; ticks once as soon as it is shown again.
  const tickAgo = () => {
    if (document.hidden) return;
    hosts.forEach(h => {
      if (!h.strip.hidden)
        h.strip.querySelectorAll('time[data-at]').forEach(t => {
          t.textContent = ago(Number(t.dataset.at));
        });
    });
  };
  setInterval(tickAgo, 5000);
  document.addEventListener('visibilitychange', tickAgo);
  window.addEventListener('tnai:setting-changed', event => {
    if (event.detail?.key !== 'liveAiChanges') return;
    if (!event.detail.value) cards.clear();
    hosts.forEach(render);
  });

  // Another project became active (09): cards and snapshots described the old folder's files;
  // re-read what views still show.
  window.addEventListener('tnai:project-changed', () => {
    cards.clear();
    snaps.clear();
    [...watched.keys()].forEach(snapshot);
    hosts.forEach(render);
  });

  // ---------------------------------------------------------------- disk changes (pushed by
  // watch-service.js)
  native.fs.onChanges(batch => {
    // a lane (agent worktree) batch names files in the lane, not the open project-folder files
    if (!Array.isArray(batch) || batch[0]?.lane) return;
    const seen = new Set();

    // A folded batch (> 200 changes, watch-service) names folders instead of files: every watched
    // file under a reported folder counts as changed (a real diff decides). Folded: told by its
    // folder entries (dir: true), since IPC drops the array's own many/count properties.
    const changes =
      batch.many || batch.some(c => c?.dir)
        ? batch.flatMap(c =>
            c?.dir
              ? [...watched.keys()].filter(p => p.startsWith(c.path + '/')).map(p => ({ path: p }))
              : [c]
          )
        : batch;
    for (const c of changes) {
      if (!c || seen.has(c.path) || !watched.has(c.path)) continue;
      seen.add(c.path);

      // 13 handled this batch first, so its (inferred) credit is current
      const who = whoChanged(c.path);
      enqueue(c.path, async () => {
        const next = await readText(c.path),
          prev = snaps.get(c.path);
        if (!watched.has(c.path)) return;
        snaps.set(c.path, next);
        if (prev != null && next != null && prev !== next) record(c.path, prev, next, who);
      });
    }
  });

  window.TnaiFileDiff = {
    // Show live change cards for `path` inside `host` (appended; options.before = a child to insert
    // before). Returns detach().
    attach,
    diff,
    // Current cards for a file, newest first: [{ added, removed, who, inferred, at }].
    cards: path =>
      (cards.get(path) || []).map(c => ({
        added: c.diff.added,
        removed: c.diff.removed,
        who: c.who.name,
        inferred: !!c.who.name,
        at: c.at,
      })),
  };
})();
