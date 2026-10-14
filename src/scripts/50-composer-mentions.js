// Technically Not · 50-composer-mentions.js — Desktop only: @mentions in the composer. Typing "@"
// opens a picker (arrows, Enter/Tab, Esc, click) of running agents (name, CLI, working/idle dot)
// that inserts "@Name ", then the open file and the project files + folders matching the text after
// "@" (the confined main-process name search, fs:search with folders) that insert "@src/app.js " /
// "@src/scripts/ ". A picked file/folder stays readable in the text and 11 dispatch appends "
// [Mentioned file: src/app.js] [Mentioned folder: src/scripts/]" (project-relative, like 27's
// "[Attached file: …]"). A prompt that mentions running agents goes to exactly those agents (11
// route() asks `TnaiMentions.route` first, dispatch() sends to each), bypassing auto-routing;
// unknown or stopped names block the send with a toast. Report items: "@Ideas 1",
// "@Decide 1", "@Next", … (Decide, Ideas, Next, Blockers, Remains, Found) point at the latest
// Technically Not report of the picked/@mentioned/chosen agent (49 TnaiContext); the picker lists
// them, 11 dispatch appends "[Report item: …]" via refs(), a missing item blocks the send, and a
// sent prompt marks them (Decide answered, others sent). `window.TnaiMentions` (parse, route,
// message, strip, refs)
(() => {
  const agents = window.TnaiAgents,
    promptEl = document.getElementById('prompt');
  if (!window.tnaiNative || !agents || !promptEl) return;

  // ---------- parsing ----------
  // A mention is "@" at the start or after a space/bracket/quote (so a@b.com never counts),
  // followed by an agent name.
  const BEFORE = /[\s(\[{"'“‘,;]/;
  const live = s => s.running && s.mode !== 'login';
  const esc = v =>
    String(v).replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // Names that are agents but not running now: closed/stopped panes, custom agents, Technically
  // Not's pane-name pool. A mention of one is refused, not ignored.
  const realNames = () =>
    [
      ...agents.sessions().map(s => s.name),
      ...(window.TnaiCustomAgents?.list?.() || []).map(a => a.name),
    ].filter(Boolean);
  const knownNames = () => [...realNames(), ...(window.TnaiPaneNames?.list?.() || [])];

  // { mentions: [{start, end, session}], stopped: [name], unknown: [word], dup: [name], blockEnd }
  // — blockEnd is where the leading address ("@Nova, @Vega: …") ends. An unknown "@word" only
  // counts in that address position; elsewhere ("use @media") it stays text. Files/folders picked
  // in the picker for this prompt: token ("src/app.js", "src/scripts/", '"my dir/a.js"') → { path,
  // dir }. Only picked ones count, so a hand-typed "@thing" is never guessed to be a path.
  const picked = new Map();
  const tokenFor = (path, dir) => {
    const t = path + (dir ? '/' : '');
    return /\s/.test(t) ? '"' + t + '"' : t;
  };

  // Report items: "@Ideas 1 let's do that @Decide 1" points at items of
  // an agent's Technically Not report (49 TnaiContext entries). Whose report: the one picked in the
  // picker, else the latest report of the @mentioned or chosen agent, else the newest report. The
  // prompt keeps "@Ideas 1"; the agent also gets "[Report item: …]" with the item's text.
  const SECS = {
    decide: ['choices', 'Decide'],
    ideas: ['ideas', 'Ideas'],
    next: ['next', 'Next'],
    blockers: ['blockers', 'Blockers'],
    remains: ['remains', 'Remains'],
    untested: ['untested', 'Untested'],
    found: ['found', 'Found'],
  };
  const reportPicked = new Map(); // "ideas 1" → entry id, for items picked in the picker
  let pendingMarks = [];
  const reports = () =>
    (window.TnaiContext?.entries?.() || []).filter(e => !e.chatter && e.summary);

  function reportFor(p, key) {
    const all = reports(),
      id = key && reportPicked.get(key);
    const pane = p.mentions[0]?.session.paneId || window.TnaiLiveTasks?.target?.();
    return (
      (id && all.find(e => e.id === id)) ||
      (pane && all.find(e => e.paneId === pane)) ||
      all[0] ||
      null
    );
  }

  // The decision "@Decide" points at: of a report with several, the first not yet answered (49
  // openChoice), else the report's first.
  const openDecision = e =>
    window.TnaiContext?.openChoice?.(e) ||
    (e?.summary?.choices ? { ...e.summary.choices, n: 0 } : null);

  // The items of one report section: [{ n, text, key }] (key = 49's mark key).
  function sectionItems(e, sec) {
    if (!e) return [];
    if (sec === 'decide') {
      const c = openDecision(e);
      return (c?.options || []).map((o, i) => ({
        n: i + 1,
        text: o.label,
        key: e.id + ':choices:' + c.n,
      }));
    }
    return (e.summary[SECS[sec][0]] || []).map((t, i) => ({
      n: i + 1,
      text: String(t),
      key: e.id + ':' + SECS[sec][0] + ':' + i,
    }));
  }

  function parse(text) {
    const tokens = [...picked.keys()].sort((a, b) => b.length - a.length);
    const running = agents.sessions().filter(live);
    const names = [...new Set([...running.map(s => s.name), ...knownNames()])].sort(
      (a, b) => b.length - a.length
    );
    const real = new Set(realNames().map(n => n.toLowerCase()));
    const out = {
      mentions: [],
      stopped: [],
      unknown: [],
      dup: [],
      files: [],
      reports: [],
      blockEnd: 0,
    };
    for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
      if (i > 0 && !BEFORE.test(text[i - 1])) continue;
      const rest = text.slice(i + 1),
        low = rest.toLowerCase();
      const leading = /^[\s,;:]*$/.test(text.slice(out.blockEnd, i));
      const token = tokens.find(
        t => rest.startsWith(t) && !/[\w\-./\\]/.test(rest[t.length] || '')
      );
      if (token) {
        out.files.push({ start: i, end: i + 1 + token.length, ...picked.get(token) });
        i += token.length;
        continue;
      }
      const name = names.find(
        n => low.startsWith(n.toLowerCase()) && !/[\w-]/.test(rest[n.length] || '')
      );
      if (name) {
        const end = i + 1 + name.length,
          hits = running.filter(s => s.name.toLowerCase() === name.toLowerCase());
        if (hits.length === 1) out.mentions.push({ start: i, end, session: hits[0] });
        else if (hits.length > 1) out.dup.push(name);
        else if (leading || real.has(name.toLowerCase()))
          out.stopped.push(name); // a pool-only name ("@Echo") mid-text stays text
        else continue;
        if (leading) out.blockEnd = end;
        continue;
      }

      // "@Ideas", "@Ideas 2", "@Decide 1": an item of a Technically Not report (stays in the text;
      // refs() adds the item itself).
      const rw = /^([A-Za-z]+)(?:[ \t]+(\d{1,2})(?!\w))?/.exec(rest);
      if (rw && SECS[rw[1].toLowerCase()] && !/[\w-]/.test(rest[rw[0].length] || '')) {
        out.reports.push({
          start: i,
          end: i + 1 + rw[0].length,
          sec: rw[1].toLowerCase(),
          n: rw[2] ? +rw[2] : 0,
        });
        i += rw[0].length;
        continue;
      }
      const word = /^[A-Za-z][\w-]*/.exec(rest)?.[0];
      if (!word || !leading) continue;
      const next = rest[word.length] || '';
      if (next === '/' || next === '@' || (next === '.' && /\w/.test(rest[word.length + 1] || '')))
        continue; // @scope/pkg, handles, file names
      out.unknown.push(word);
      out.blockEnd = i + 1 + word.length;
    }
    return out;
  }

  // The prompt without its leading address, other mentions as plain names: "@Nova, ask @Vega about
  // it" → "ask Vega about it".
  function strip(text) {
    const p = parse(text);
    let t = text;
    p.mentions
      .filter(m => m.start >= p.blockEnd)
      .reverse()
      .forEach(m => {
        t = t.slice(0, m.start) + m.session.name + t.slice(m.end);
      });
    return t
      .slice(p.blockEnd)
      .replace(/^[\s,;:]+/, '')
      .trim();
  }

  // What one recipient gets: the stripped prompt; with several recipients, a first line saying who
  // else got it, so they can coordinate.
  function message(text, recipient, targets) {
    const body = strip(text);
    if (!body) return '';
    const others = (targets || [])
      .filter(s => s.paneId !== recipient.paneId)
      .map(s => s.name + ' (' + s.agent + ')');
    return others.length ? '[Sent to you and ' + others.join(', ') + ' together] ' + body : body;
  }
  const list = names => names.map(n => '@' + n).join(', ');

  // 11 route() asks this first. null = no mentions: the usual routing.
  function route(text) {
    if (!text || !text.includes('@')) return null;
    const p = parse(text);

    // "@opus", "@codex": a model or CLI, routed by 73
    p.unknown = p.unknown.filter(w => !window.TnaiModelRoute?.known?.(w));
    const missing = p.reports.filter(r => {
      const key = r.sec + (r.n ? ' ' + r.n : ''),
        items = sectionItems(reportFor(p, key), r.sec);
      return r.n ? !items[r.n - 1] : !items.length;
    });
    if (missing.length) {
      const e = reportFor(p),
        what = missing.map(r => '@' + SECS[r.sec][1] + (r.n ? ' ' + r.n : '')).join(', ');
      return {
        kind: 'blocked',
        why: e
          ? e.name + '’s last report has no ' + what + '. Type @ to pick an item from it.'
          : 'No agent report yet, so ' + what + ' points at nothing.',
        label: '→ ' + what + ' · not in the report',
      };
    }
    if (!p.mentions.length && !p.stopped.length && !p.unknown.length && !p.dup.length) return null;
    if (p.dup.length)
      return {
        kind: 'blocked',
        why:
          'Several running agents are named ' +
          list(p.dup) +
          '. Rename one (✎ on its terminal panel), then send again.',
        label: '→ ' + list(p.dup) + ' · name used twice',
      };

    // Stopped custom agents (17): Send starts them (11 calls TnaiCustomAgents.start for `deploy`),
    // the prompt stays for when they are ready.
    const custom = p.stopped.map(n =>
      (window.TnaiCustomAgents?.list?.() || []).find(a => a.name.toLowerCase() === n.toLowerCase())
    );
    if (p.stopped.length && custom.every(Boolean))
      return {
        kind: 'blocked',
        deploy: custom.map(a => a.id),
        why:
          'Starting ' +
          list(p.stopped) +
          ' · send again when ' +
          (p.stopped.length > 1 ? 'they are' : 'it is') +
          ' ready (your message is kept).',
        label:
          '→ ' +
          list(p.stopped) +
          ' · not running · Send starts ' +
          (p.stopped.length > 1 ? 'them' : 'it'),
      };
    if (p.stopped.length)
      return {
        kind: 'blocked',
        why:
          list(p.stopped) +
          (p.stopped.length > 1 ? ' are' : ' is') +
          ' not running. Start it first, or type @ to pick a running agent.',
        label: '→ ' + list(p.stopped) + ' · not running',
      };
    if (p.unknown.length) {
      const running = agents
        .sessions()
        .filter(live)
        .map(s => s.name);
      return {
        kind: 'blocked',
        why:
          'No agent is named ' +
          list(p.unknown) +
          '. ' +
          (running.length
            ? 'Running: ' + running.join(', ') + '. Type @ to pick one.'
            : 'No agent is running.') +
          ' To send it as plain text, don’t start the prompt with it.',
        label: '→ ' + list(p.unknown) + ' · no such agent',
      };
    }
    const targets = [...new Map(p.mentions.map(m => [m.session.paneId, m.session])).values()];
    const label =
      '→ ' +
      targets.map(s => s.name).join(', ') +
      (targets.length === 1 && targets[0].agent !== 'Claude Code' ? ' · ' + targets[0].agent : '') +
      ' · @mention';
    if (!strip(text) && !window.TnaiAttachments?.count?.())
      return {
        kind: 'blocked',
        why:
          'Write the message for ' + targets.map(s => s.name).join(', ') + ' after the @mention.',
        label,
      };
    return { kind: 'mention', targets, label };
  }

  // What 11 dispatch appends for the picked files/folders still in the prompt: " [Mentioned file:
  // src/app.js] [Mentioned folder: src/scripts/]". Report items add " [Report item: Ideas 1 from
  // Nova's report 1a2b3c4d: "…"]"; once the prompt is sent they are marked like 49 does (a Decide
  // option answers the decision, other items are marked sent).
  function refs(text) {
    pendingMarks = [];
    if (!text || (!picked.size && !text.includes('@'))) return '';
    const seen = new Set(),
      out = [],
      p = parse(text);
    for (const f of p.files) {
      const key = f.path + (f.dir ? '/' : '');
      if (!seen.has(key)) {
        seen.add(key);
        out.push('[Mentioned ' + (f.dir ? 'folder' : 'file') + ': ' + key + ']');
      }
    }
    for (const r of p.reports) {
      const key = r.sec + (r.n ? ' ' + r.n : ''),
        e = reportFor(p, key),
        items = sectionItems(e, r.sec),
        label = SECS[r.sec][1] + (r.n ? ' ' + r.n : '');
      const pick = r.n ? [items[r.n - 1]].filter(Boolean) : items;
      if (!pick.length || seen.has(e.id + key)) continue;
      seen.add(e.id + key);
      const src = ' from ' + e.name + '’s report ' + e.id,
        q = openDecision(e)?.question || '';
      out.push(
        '[Report item: ' +
          label +
          src +
          (r.sec === 'decide'
            ? r.n
              ? ': decision on "' + q + '": go with ' + pick[0].text
              : ': "' + q + '", options: ' + pick.map(x => x.n + '. ' + x.text).join('; ')
            : ': ' +
              (r.n ? '"' + pick[0].text + '"' : pick.map(x => x.n + '. ' + x.text).join('; '))) +
          ']'
      );
      if (r.sec === 'decide') {
        if (r.n) pendingMarks.push([pick[0].key, 'answered']);
      } else pick.forEach(x => pendingMarks.push([x.key, 'sent']));
    }
    return out.length ? ' ' + out.join(' ') : '';
  }
  window.TnaiMentions = { parse, route, message, strip, refs };

  // ---------- picker ----------
  const style = document.createElement('style');
  style.textContent = `
.tnai-at-menu{position:fixed;z-index:1000;width:300px;max-width:calc(100vw - 16px);overflow:auto;background:#fff;border:1px solid #e3e5de;border-radius:10px;box-shadow:0 16px 45px #20211f20;padding:6px;font:11px var(--pg-sans);color:#43463f}
.tnai-at-menu h4{margin:4px 8px 4px;font:600 9px var(--pg-sans);letter-spacing:.8px;text-transform:uppercase;color:#9a9d94}
.tnai-at-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;cursor:pointer}
.tnai-at-row[aria-selected=true]{background:#eef4e6}.tnai-at-row:hover{background:#f4f6f1}
.tnai-at-row>i{width:6px;height:6px;border-radius:50%;background:#c9cdc3}.tnai-at-row[data-status=working]>i{background:#82a95f}
.tnai-at-row b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tnai-at-row small{color:#8d9088;font-size:10px;white-space:nowrap}
.tnai-at-row[data-kind]>i{border-radius:2px;background:#dfe2da}.tnai-at-row[data-kind=folder]>i{background:#c9cdc3}
.tnai-at-row+h4,.tnai-at-empty+h4{margin-top:8px}
.tnai-at-empty{padding:6px 8px;color:#8d9088}`;
  document.head.append(style);

  const state = {
    el: null,
    items: [],
    index: 0,
    start: 0,
    query: '',
    files: [],
    searched: new Map(),
    token: 0,
    timer: 0,

    // Enter or Tab was pressed while the file search for the current "@" text still ran: the pick
    // waits for its results (see onKey).
    enterWaiting: false,

    // The user moved the highlight with the arrows since the last keystroke: that row is their
    // choice and Enter picks it at once.
    arrowed: false,
  };
  const keyOf = it =>
    it
      ? it.kind === 'report'
        ? 'r:' + it.entry + it.sec + it.n
        : it.kind === 'shot'
          ? 's:' + it.n
          : it.kind
            ? 'f:' + it.path + (it.kind === 'folder' ? '/' : '')
            : 'a:' + it.paneId
      : '';
  const statusText = s =>
    s.status === 'needs-you'
      ? 'needs you'
      : s.status === 'waiting-agents'
        ? 'waiting on agents'
        : s.status === 'background'
          ? 'working in background'
          : s.status === 'working'
            ? 'working'
            : s.status === 'starting'
              ? 'starting'
              : 'idle';

  function close() {
    state.el?.remove();
    state.el = null;
    state.items = [];
    state.files = [];
    state.searched.clear();
    state.token++;
    state.enterWaiting = false;
    state.arrowed = false;
    clearTimeout(state.timer);
  }

  // Placed by TnaiFloat (100) above the composer box (flips below when there is no room); render()
  // runs per keystroke, so no re-fade.
  const position = () =>
    window.TnaiFloat?.attach(promptEl.closest('.composebox') || promptEl, state.el, {
      placement: 'top-start',
      sameWidth: false,
      fade: false,
    });

  function render() {
    const doc = promptEl.ownerDocument; // the composer may be in its pop-out window (38)
    if (!state.el || state.el.ownerDocument !== doc) {
      state.el?.remove();
      state.el = doc.createElement('div');
      state.el.className = 'tnai-at-menu';
      state.el.setAttribute('role', 'listbox');

      // keep the caret in the prompt
      state.el.addEventListener('mousedown', event => event.preventDefault());
      state.el.addEventListener('click', event => {
        const row = event.target.closest('.tnai-at-row');
        if (row) pick(state.items[+row.dataset.i]);
      });
      doc.body.append(state.el);
    }
    const row = (it, i) =>
      it.kind === 'report'
        ? '<div class="tnai-at-row" role="option" data-i="' +
          i +
          '" data-kind="report" aria-selected="' +
          (i === state.index) +
          '" title="' +
          esc(
            '@' +
              SECS[it.sec][1] +
              (it.n ? ' ' + it.n : '') +
              ' · ' +
              it.text +
              ' (from ' +
              it.who +
              '’s report; the agent gets this item with your prompt)'
          ) +
          '"><i></i><b>' +
          esc('@' + SECS[it.sec][1] + (it.n ? ' ' + it.n : '') + ' · ' + it.text) +
          '</b><small>' +
          esc(it.who) +
          '</small></div>'
        : it.kind === 'shot'
          ? '<div class="tnai-at-row" role="option" data-i="' +
            i +
            '" data-kind="shot" aria-selected="' +
            (i === state.index) +
            '" title="' +
            esc(
              '@' +
                it.n +
                ' · ' +
                it.name +
                ': the text after @' +
                it.n +
                ' goes with this attachment'
            ) +
            '"><i></i><b>' +
            esc('@' + it.n + ' · ' + it.name) +
            '</b><small>' +
            (it.image ? 'image' : 'file') +
            '</small></div>'
          : it.kind
            ? '<div class="tnai-at-row" role="option" data-i="' +
              i +
              '" data-kind="' +
              it.kind +
              '" aria-selected="' +
              (i === state.index) +
              '" title="' +
              esc(it.path + (it.kind === 'folder' ? '/' : '')) +
              '"><i></i><b>' +
              esc(it.name + (it.kind === 'folder' ? '/' : '')) +
              '</b><small>' +
              esc(
                it.open
                  ? 'open file'
                  : it.path.includes('/')
                    ? it.path.slice(0, it.path.lastIndexOf('/') + 1)
                    : it.kind
              ) +
              '</small></div>'
            : '<div class="tnai-at-row" role="option" data-i="' +
              i +
              '" data-status="' +
              esc(it.status) +
              '" aria-selected="' +
              (i === state.index) +
              '" title="' +
              esc(it.name + ' · ' + it.agent + ' · ' + statusText(it)) +
              '"><i></i><b>' +
              esc(it.name) +
              '</b><small>' +
              esc(it.agent) +
              ' · ' +
              statusText(it) +
              '</small></div>';
    const rows = test => state.items.map((it, i) => (test(it) ? row(it, i) : '')).join('');
    const agentRows = rows(it => !it.kind),
      shotRows = rows(it => it.kind === 'shot'),
      fileRows = rows(it => it.kind === 'file' || it.kind === 'folder');
    const repRows = rows(it => it.kind === 'report'),
      repWho = state.items.find(it => it.kind === 'report')?.who;
    state.el.innerHTML =
      (agentRows || !state.query
        ? '<h4>Send to</h4>' +
          (agentRows ||
            '<div class="tnai-at-empty">No agent is running. Start one with New thread.</div>')
        : '') +
      (repRows ? '<h4>' + esc('From ' + repWho + '’s report') + '</h4>' + repRows : '') +
      (shotRows ? '<h4>Attachments</h4>' + shotRows : '') +
      (fileRows ? '<h4>Files and folders</h4>' + fileRows : '');
    position();
    state.el.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }

  // Project files and folders by name, through the confined main-process search (fs-service.js);
  // results cached per query while open.
  const projectOpen = () => !!(window.tnaiNative.fs?.search && window.TnaiProjects?.active?.());

  function searchFiles(q) {
    clearTimeout(state.timer);
    if (!q || !projectOpen() || state.searched.has(q)) return;
    const my = ++state.token;
    state.timer = setTimeout(async () => {
      let r;
      try {
        r = await window.tnaiNative.fs.search(q, 12, { dirs: true });
      } catch {
        r = null;
      }
      if (my !== state.token) return;
      state.searched.set(
        q,
        (r?.ok ? r.value.results : []).map(f => ({
          kind: f.dir ? 'folder' : 'file',
          path: f.path,
          name: f.name,
        }))
      );
      if (state.query !== q) return;
      update();
      if (state.enterWaiting) {
        state.enterWaiting = false;

        // nothing was chosen with the arrows: the top row of this query's list
        if (state.el && state.items.length) pick(state.items[0]);
        else close();
      }
    }, 120);
  }

  // The file search for the "@" text being typed has not answered yet.
  const searchRunning = () => !!state.query && projectOpen() && !state.searched.has(state.query);

  // A file or folder row kept from an earlier search while the new one runs (not the open file).
  const fromSearch = it => !!it && (it.kind === 'file' || it.kind === 'folder') && !it.open;

  // The "@query" right before the caret, if any. Paths are allowed in it ("@src/sc").
  function update() {
    const v = promptEl.value,
      c = promptEl.selectionStart;
    const m =
      c === promptEl.selectionEnd && /(^|[\s(\[{"'“‘,;])@([\w\-./\\]*)$/.exec(v.slice(0, c));
    if (!m) return close();
    const q = m[2].toLowerCase().replace(/\\/g, '/'),
      running = agents.sessions().filter(live);
    state.query = q;
    searchFiles(q);
    const agentItems = running
      .filter(s => s.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q) ||
          a.name.localeCompare(b.name)
      );
    const open = projectOpen() && window.TnaiProjectFiles?.current?.();
    const openItem =
      open && (!q || open.toLowerCase().includes(q))
        ? [{ kind: 'file', path: open, name: open.split('/').pop(), open: true }]
        : [];

    // While a new search runs, keep the last results that still match, so the list doesn't flicker.
    const done = state.searched.has(q);
    state.files = (
      done
        ? state.searched.get(q)
        : q
          ? state.files.filter(f =>
              (f.path + (f.kind === 'folder' ? '/' : '')).toLowerCase().includes(q)
            )
          : []
    ).filter(f => f.path !== open);

    // Attachments in the composer (27) as @1, @2…: the text after "@N" is that attachment's own
    // instruction (27 TnaiShotRefs).
    const shotItems = (window.TnaiAttachments?.list?.() || [])
      .filter(a => !q || String(a.n).startsWith(q) || a.label.toLowerCase().includes(q))
      .map(a => ({ kind: 'shot', n: a.n, name: a.label, image: a.kind === 'image' }));

    // Items of the latest report (the chosen/@mentioned agent's): "@i" lists Ideas, "@d" Decide
    // options…; a bare "@" shows Decide and Ideas.
    const rep = reportFor(parse(v)),
      repItems = !rep
        ? []
        : Object.keys(SECS)
            .filter(w => (q ? w.startsWith(q) : w === 'decide' || w === 'ideas'))
            .flatMap(w => {
              const its = sectionItems(rep, w);
              return [
                ...its,
                ...(q && its.length > 1 ? [{ n: 0, text: 'all ' + its.length }] : []),
              ].map(x => ({
                kind: 'report',
                sec: w,
                n: x.n,
                text: x.text,
                entry: rep.id,
                who: rep.name,
              }));
            })
            .slice(0, q ? 12 : 6);
    const items = [...agentItems, ...repItems, ...shotItems, ...openItem, ...state.files];

    // Nothing yet: wait for the search. A different "@" (caret moved) drops the old list, so Enter
    // can't replace text from the old one's start.
    if (!items.length && q) {
      if (done || !projectOpen()) close();
      else if (state.start !== c - m[2].length - 1) {
        state.items = [];
        state.start = c - m[2].length - 1;
      }
      return;
    }
    const current = keyOf(state.items[state.index]);
    state.items = items;
    state.start = c - m[2].length - 1;
    state.index = Math.max(
      0,
      items.findIndex(it => keyOf(it) === current)
    );
    render();
  }

  function pick(s) {
    if (!s) return close();
    let token = s.name;
    if (s.kind === 'shot') token = String(s.n);
    else if (s.kind === 'report') {
      token = SECS[s.sec][1] + (s.n ? ' ' + s.n : '');
      reportPicked.set(s.sec + (s.n ? ' ' + s.n : ''), s.entry);
    } else if (s.kind) {
      token = tokenFor(s.path, s.kind === 'folder');
      picked.set(token, { path: s.path, dir: s.kind === 'folder' });
    }
    const v = promptEl.value,
      c = promptEl.selectionStart,
      insert = '@' + token + ' ';
    promptEl.value = v.slice(0, state.start) + insert + v.slice(c).replace(/^ /, '');
    const caret = state.start + insert.length;
    promptEl.setSelectionRange(caret, caret);
    close();
    promptEl.focus();
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));

    // 68: the prompt for that attachment only
    if (s.kind === 'shot') window.TnaiShotNotes?.open(s.n);
  }

  // Runs in the window's capture phase, before 11's document-level Enter-to-send: while the picker
  // is open, Enter/Tab pick instead.
  function onKey(event) {
    if (!state.el || event.target !== promptEl || event.isComposing) return;
    const k = event.key,
      n = state.items.length;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (n) {
        state.index = (state.index + (k === 'ArrowDown' ? 1 : n - 1)) % n;
        state.arrowed = true;
        render();
      }
    } else if ((k === 'Enter' || k === 'Tab') && !event.shiftKey) {
      // The highlighted row may be an earlier query's result (or there is none yet): pick once
      // this query's search answers, so Enter never inserts a stale file.
      const highlighted = state.items[state.index];
      if (searchRunning() && !state.arrowed && (!n || fromSearch(highlighted)))
        state.enterWaiting = true;
      else if (n) pick(highlighted);
      else close();
    } else if (k === 'Escape') close();
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  let paintQueued = false;
  promptEl.addEventListener('input', () => {
    if (!promptEl.value) {
      // sent or cleared: the next prompt starts with no picked files; report items of a sent prompt
      // are marked
      picked.clear();
      reportPicked.clear();
      pendingMarks.forEach(([key, s]) =>
        window.tnaiNative.context?.mark?.(key, s)?.catch?.(() => {})
      );
    }
    pendingMarks = [];

    // typing after Enter: the waiting pick is dropped, the picker follows the new text
    state.enterWaiting = false;
    state.arrowed = false;
    update();
    if (!paintQueued) {
      paintQueued = true;
      requestAnimationFrame(() => {
        paintQueued = false;
        window.TnaiLiveTasks?.paintRoute?.();
      });
    }
  });
  promptEl.addEventListener('click', update);
  promptEl.addEventListener('blur', () =>
    setTimeout(() => {
      if (promptEl.ownerDocument.activeElement !== promptEl) close();
    }, 0)
  );

  function bind(doc) {
    doc.defaultView.addEventListener('keydown', onKey, true);
    doc.defaultView.addEventListener('resize', () => state.el && position());
  }
  bind(document);

  // The pop-out composer window (38) binds its document through 11's bindComposer; 46 wraps it the
  // same way.
  const tasks = window.TnaiLiveTasks,
    popBind = tasks?.bindComposer;
  if (popBind)
    tasks.bindComposer = doc => {
      popBind(doc);
      if (doc !== document) bind(doc);
    };
  agents.onChange(() => state.el && update());
})();
