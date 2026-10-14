/*
 * Technically Not · 75-report-highlight.js — Desktop app only: makes the "Technically Not report"
 * block an agent ends its task with stand out in every terminal view (Terminal page panels, Build
 * panels, Agents page mirror). The heading gets a soft green tint and accent green text; each item
 * row (wrapped text included) gets its label's own soft tint and the "Did:" / "Changed:" / … label
 * its own color (Did green, Changed teal, Decided purple, Remains tan,
 * Next blue); the rest of the text keeps the CLI's own colors (file names stay blue). Status
 * sections in a reply ("Already done:", "Where we stopped:", "Still open:") get their own text
 * color: done green, stopped yellow, open purple, and steps the user must
 * do ("Your turn:", "Need your help:") rose, and a notice the user must
 * not miss ("Heads up:") amber text on a soft amber row, the Remains colors (before,
 * a suggestion to compact sat in a reply as plain text and was missed). Drawn with
 * xterm decorations over the text, so the pty output and the saved session stay untouched. Each
 * item on the Ideas/Decide/Next lines (not Remains/Found/Blockers/Untested) is a link: a click puts
 * "Ideas 2: <item>" into that same terminal's input (never the composer, which could route it to
 * another agent) in one go, so nothing is seen being typed,
 * and does NOT send it: the user can add to it and presses Enter.
 * A "↑ Report ↓" pill at the bottom right of each terminal (10's Latest look) jumps
 * between report headings. Each agent CLI lays a reply out its own way
 * (bullet mark, indent, empty rows, normal or full screen); the shapes this file must read are the
 * fixtures in desktop-check report-highlight, one real reply per CLI. 10-live-terminals calls
 * TnaiReportHighlight.attach(term) for each terminal it creates.
 */
(() => {
  // The report jump pill reuses 10's .tnai-term-latest look; only its place (bottom right, clear of
  // the centred Latest) and its two buttons are new.
  const css = document.createElement('style');
  css.textContent =
    '.tnai-term-latest.tnai-report-nav{left:auto;right:18px;transform:none;display:flex;align-items:center;gap:2px;padding:0 3px}' +
    '.tnai-term-latest.tnai-report-nav[hidden]{display:none}.tnai-report-nav>span{padding:0 2px}.tnai-report-nav>button{height:18px;min-width:18px;padding:0 4px;border:0;border-radius:9px;background:none;color:inherit;font:inherit;cursor:pointer}' +
    '.tnai-report-nav>button:hover:not(:disabled){background:color-mix(in srgb,currentColor 12%,transparent)}.tnai-report-nav>button:disabled{opacity:.35;cursor:default}' +
    // Unread (below): the same pill in the accent, the color the bell's unread count has; its word
    // becomes the way to that report. Same size in both states.
    '.tnai-term-latest.tnai-report-nav.tnai-report-unread{color:var(--pg-accent);border-color:var(--pg-accent)}.tnai-report-unread>span{cursor:pointer;border-radius:9px}' +
    '.tnai-report-unread>span:hover{background:color-mix(in srgb,currentColor 12%,transparent)}';
  document.head.append(css);
  const HEADING = /^[^A-Za-z]*\**\s*Technically Not report\s*\**:?\s*$/i;
  const LABEL =
    /^(\s*[-•*·]\s+\**)((?:Did|Found|Changed|Decided|Decide|Remains|Untested|Resolved|Blockers|Next|Ideas):)/;

  // Status sections: done green, stopped yellow, still open purple.
  // Heading = the line starts with one of these words and ends there or with a colon (bold markers
  // and a "●" reply bullet allowed), so ordinary sentences don't match. Steps the user must do
  // themselves ("Your turn:", "Need your help:") get a fourth color, rose,
  // so "do this" stands apart from the rest of a reply.
  const SECTION =
    /^(\s*(?:[●⏺•]\s+)?\**)((already done|done|what'?s done|what i did|what changed|changes made|completed|finished|where we stopped|where we left off|where things stand|current status|on pause|paused|in progress|still open|open|open items|remaining|what'?s left|left to do|still to do|to ?do|next steps|your turn|your part|your steps|need your help|what you need to do|what'?s next|heads up|notice|important)\s*\**\s*:?\**)(?=\s|$)/i;
  const SECTION_KIND = w =>
    /heads up|notice|important/i.test(w)
      ? 'notice'
      : /^your |your help|you need/i.test(w)
        ? 'you'
        : /done|did|changed|changes|completed|finished/i.test(w)
          ? 'done'
          : /stopped|left off|stand|status|pause|progress/i.test(w)
            ? 'stopped'
            : 'open';
  const ITEM = /^\s*(?:[-•*·]|\d+[.)])\s+\S/;

  // Check lists (a list written like a report, "- Fixed: …" / "- Matches:
  // …", sat in a reply as plain text): a list item that starts with one of these five labels gets
  // the label word colored and nothing else, no row tint, so a real report still looks different. A
  // fixed set, capital first letter and a colon, so ordinary bullets and sentences stay plain.
  const CHECK =
    /^(\s*(?:[-•*·]|\d+[.)])\s+\**)((Fixed|Matches|Missed|Not verified|Does not apply)\**:)/;
  const CHECK_KIND = {
    Fixed: 'fixed',
    Matches: 'fixed',
    Missed: 'partly',
    'Not verified': 'partly',
    'Does not apply': 'idle',
  };

  // lines above the end re-read on every pass: CLIs redraw their live area in place
  const RESCAN_TAIL = 80;

  // A list shown again with outcomes (desktop/hidden-skills/42-fix-odds.md):
  // a table with the columns "#", "Issue", "Outcome", "How we know". The four outcome
  // words get the status colors the app already has, as text color only, when the word is all its
  // Outcome cell holds. Shapes read from one real reply each (2026-10-05): Claude Code, Cursor
  // Agent and OpenCode draw cell borders (│) and a rule between rows, and Cursor Agent breaks
  // "Still failing" over two rows of its cell; Codex draws no borders, only columns and rule rows.
  const TABLE_HEAD = /#.*\bIssue\b.*\bOutcome\b.*\bHow we know\b/i;

  // a row of rule characters only (OpenCode's first column is one cell wide: "┌─┬────")
  const TABLE_RULE = /^(?=.*[─━═-]{3})[\s─━═│┃|┌┬┐├┼┤└┴┘╭╮╰╯+:-]+$/;
  const TABLE_SEP = /^[│┃|]$/;
  const OUTCOME = {
    fixed: 'fixed',
    partly: 'partly',
    'still failing': 'failing',
    'not started': 'idle',
  };

  // The same list as numbered blocks (blocks re-wrap at any width, a
  // table breaks in a narrower view): under each issue a line "- Outcome: <word>". The word is
  // colored only when it is one of the four and all the line holds after the label.
  const OUTCOME_LINE =
    /^(\s*(?:(?:[-•*·]|\d+[.)])\s+)?\**Outcome\**:\**\s+)(Fixed|Partly|Still failing|Not started)\**\s*$/i;
  const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);

  // Each label kind has its own color, matching the report summary cards (49-context-data: sage
  // Did, sky Found/Next, teal Changed, plum Decided/Decide, amber Remains/Ideas, error Blockers).
  // Light = those --ac-* tokens; dark = brighter text on a dim tinted row.
  const KINDS = {
    did: ['#4f7a45', '#e8f1e2', '#9cc48a', '#22301f'],
    found: ['#4a7196', '#e6eef6', '#8fb3d6', '#1f2a36'],
    changed: ['#3b7571', '#e2f0ee', '#7fbfb9', '#1c2f2d'],
    decided: ['#7a5a8c', '#f0e9f4', '#b99ccc', '#2c2233'],
    // the light tone is a step darker than the summary cards' amber: on the thread's off-white
    // card the lighter one read at 4.3 to 1 (desktop test thread-readable)
    remains: ['#7f5d1f', '#f6eedd', '#d0a868', '#33291a'],
    blockers: ['#9a4a3e', '#f6e6e2', '#e08b7d', '#36211d'],
  };
  const KIND_OF = {
    did: 'did',
    resolved: 'did',
    found: 'found',
    next: 'found',
    changed: 'changed',
    decided: 'decided',
    decide: 'decided',
    remains: 'remains',
    untested: 'remains',
    ideas: 'remains',
    blockers: 'blockers',
  };
  const colorsFor = term => {
    const bg = hex(term.options.theme?.background) || '#fbfcf9',
      n = parseInt(bg.slice(1), 16);
    const dark = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128;
    const kinds = {};
    for (const k in KINDS) {
      const c = KINDS[k];
      kinds[k] = dark ? { fg: c[2], row: c[3] } : { fg: c[0], row: c[1] };
    }
    const sections = dark
      ? { done: '#9cc48a', stopped: '#e3c35a', open: '#c3a0ec', you: '#ee9ab4' }
      : { done: '#3f7a36', stopped: '#786000', open: '#7446a8', you: '#9a5268' };
    sections.notice = kinds.remains.fg;

    // Outcome words: the done green, the Remains amber and the Blockers red of this file, and the
    // app's idle gray (05-status-colors: --st-idle-fg, --st-idle-dot).
    const outcomes = {
      fixed: sections.done,
      partly: kinds.remains.fg,
      failing: kinds.blockers.fg,
      idle: dark ? '#b5b9b0' : '#62685d',
    };
    return {
      ...(dark ? { row: '#223020', accent: '#a9d08a' } : { row: '#e5eedb', accent: '#3d6b28' }),
      kinds,
      sections,
      outcomes,
    };
  };
  const kindOf = (colors, label) =>
    colors.kinds[KIND_OF[label.replace(/:$/, '').toLowerCase()]] || {
      fg: colors.accent,
      row: colors.row,
    };

  // The same colors for the report card in a thread's Readable view (122), from this one list so
  // the two cannot drift: custom properties on the page, the light set and the dark set
  // (`--rp-did`, `--rp-found` and so on for the label kinds, `--rp-section-done` and so on for the
  // status sections, `--rp-outcome-fixed` and so on for the outcome words).
  const paletteRule = (selector, dark) => {
    const colors = colorsFor({ options: { theme: { background: dark ? '#000000' : '#ffffff' } } });
    const lines = [];
    for (const kind in colors.kinds) {
      lines.push('--rp-' + kind + ':' + colors.kinds[kind].fg);
      lines.push('--rp-' + kind + '-row:' + colors.kinds[kind].row);
    }
    for (const kind in colors.sections)
      lines.push('--rp-section-' + kind + ':' + colors.sections[kind]);
    for (const kind in colors.outcomes)
      lines.push('--rp-outcome-' + kind + ':' + colors.outcomes[kind]);
    return selector + '{' + lines.join(';') + '}';
  };
  const palette = document.createElement('style');
  palette.textContent = paletteRule('html', false) + paletteRule("html[data-theme='dark']", true);

  // 32 rewrites the rules of every sheet that is not marked as written for both looks: unmarked,
  // the dark set was taken out and the light colors showed on the dark card (3 to 1).
  palette.setAttribute('data-pg', '');
  document.head.append(palette);

  // What a line is, for a view that draws a reply as a page instead of terminal rows.
  const readLine = line => {
    const text = String(line || '');
    const outcome = text.match(OUTCOME_LINE);
    if (outcome) return { outcome: OUTCOME[outcome[2].toLowerCase()], word: outcome[2] };
    const section = text.match(SECTION);
    if (section && (/:\**$/.test(section[2]) || !text.slice(section[0].length).trim()))
      return { section: SECTION_KIND(section[3]) };
    return null;
  };

  function attach(term) {
    // from: a marker on the line the last pass ended at, not a line number. A CLI that clears the
    // terminal and prints its whole transcript again (Claude Code after a panel resize) made a
    // number stale, so only the last RESCAN_TAIL lines were read and every report above lost its
    // colors. The marker moves with the buffer and is gone when its line is cleared or trimmed,
    // which re-reads from the top.
    let decos = [],
      from = null,
      timer = 0,
      colors = colorsFor(term),
      block = null;
    const drop = line => {
      decos = decos.filter(d =>
        d.marker.isDisposed || d.marker.line >= line ? (d.dispose(), false) : true
      );
    };

    // Each painted row remembers its block's first painted row (block = null before a block), so a
    // rescan that starts inside a block can move back to that block's heading instead of dropping
    // the rows below the rescan line and never finding their heading again.
    const blockStart = line =>
      decos.reduce(
        (top, d) =>
          d.tnaiBlock && !d.tnaiBlock.isDisposed && !d.marker.isDisposed && d.marker.line >= line
            ? Math.min(top, d.tnaiBlock.line)
            : top,
        line
      );

    function paint(buf, line, opts) {
      const marker = term.registerMarker(line - (buf.baseY + buf.cursorY));
      if (!marker) return;
      const d = term.registerDecoration({ marker, layer: 'bottom', ...opts });
      if (d) {
        decos.push(d);
        d.tnaiBlock = block || (block = marker);
      } else marker.dispose();
      return d;
    }

    // (Scrollbar report marks removed: no green lines in the terminals.)
    // Status sections in an agent's reply ("Already done:", "Where we stopped:", "Still open:" …):
    // the heading, its own line and its list items (wrapped rows included) get the section's text
    // color. Ends at a blank line not followed by an item, or the next heading.
    function section(buf, text, i, end) {
      const t = text(i),
        m = t.match(SECTION);
      if (!m || !(/:\**$/.test(m[2]) || !t.slice(m[0].length).trim())) return 0;
      const kind = SECTION_KIND(m[3]),
        fg = colors.sections[kind],
        rows = [[i, m[1].length]];
      let j = i + 1;
      for (; j < end; j++) {
        const s = text(j);
        if (!s.trim()) {
          const n = text(j + 1);
          if (j + 1 < end && ITEM.test(n)) continue;
          break;
        }
        if (HEADING.test(s) || SECTION.test(s) || /^\s*[>❯│┃╭╰─┌├└]/.test(s) || TABLE_HEAD.test(s))
          break;
        if (ITEM.test(s)) {
          rows.push([j, s.length - s.trimStart().length]);
          continue;
        }
        if (buf.getLine(j)?.isWrapped || /^\s/.test(s)) {
          rows.push([j, s.length - s.trimStart().length]);
          continue;
        }
        break;
      }
      block = null;
      if (kind === 'notice')
        rows.forEach(([r]) =>
          paint(buf, r, { width: term.cols, backgroundColor: colors.kinds.remains.row })
        ); // a notice also gets a row tint, so it is seen while scrolling
      rows.forEach(([r, x]) => {
        const w = text(r).trimEnd().length - x;
        if (w > 0) paint(buf, r, { x, width: w, foregroundColor: fg });
      });
      return j;
    }

    // An outcome table: the header row names the four columns; in each row under it the Outcome
    // cell's text is joined over the rows the CLI broke it into (a row starts where the first
    // column has its number, and at a rule), and colored only when the whole cell is one of the
    // four words. Columns are read as terminal cells, so wide characters in the Issue text do not
    // shift them. Returns the row after the table.
    function table(buf, text, i, end) {
      if (!TABLE_HEAD.test(text(i))) return 0;
      const cellsOf = r => {
        const row = buf.getLine(r),
          cell = buf.getNullCell(),
          a = [];
        for (let x = 0; row && x < term.cols; x++) {
          const c = row.getCell(x, cell);
          a.push(c && c.getWidth() ? c.getChars() || ' ' : '');
        }
        return a;
      };
      const head = cellsOf(i),
        xs = [];
      let s = '';
      head.forEach((ch, x) => {
        for (let k = 0; k < ch.length; k++) {
          s += ch[k];
          xs.push(x);
        }
      });
      const at = re => {
        const m = re.exec(s);
        return m ? xs[m.index] : -1;
      };
      const xi = at(/\bIssue\b/i),
        xo = at(/\bOutcome\b/i),
        xh = at(/\bHow we know\b/i);
      const edge = x => x < 0 || TABLE_SEP.test(head[x]) || !head[x].trim();
      if (
        xi < 0 ||
        xo <= xi ||
        xh <= xo ||
        !(TABLE_SEP.test(head[xo - 1]) || (edge(xo - 1) && edge(xo - 2)))
      )
        return 0; // "Outcome" must be a cell of its own
      let L = xo,
        R = xh - 1,
        bordered = false;
      for (let x = xo - 1; x >= 0 && (TABLE_SEP.test(head[x]) || !head[x].trim()); x--)
        if (TABLE_SEP.test(head[x])) {
          L = x + 1;
          bordered = true;
          break;
        }
      for (let x = xo + 7; x < xh; x++)
        if (TABLE_SEP.test(head[x])) {
          R = x - 1;
          break;
        }
      let j = i + 1,
        acc = [],
        any = false;
      const flush = () => {
        const kind =
          OUTCOME[
            acc
              .map(f => f[2])
              .join(' ')
              .toLowerCase()
          ];
        if (kind) {
          if (!any) {
            any = true;
            block = null;
            paint(buf, i, { x: xo, width: 1 });
          } // nothing drawn: the header row is where a later pass starts this table again
          acc.forEach(([r, x, , w]) =>
            paint(buf, r, { x, width: w, foregroundColor: colors.outcomes[kind] })
          );
        }
        acc = [];
      };
      for (; j < end && j - i < 400; j++) {
        const row = text(j);
        if (!row.trim()) break;
        if (TABLE_RULE.test(row)) {
          flush();
          continue;
        }
        const c = cellsOf(j);
        if (bordered && !TABLE_SEP.test(c[L - 1] || '')) break; // not a row of this table

        // a new row: its number sits in the first column
        if (/[0-9a-z]/i.test(c.slice(0, xi).join(''))) flush();
        let a = L,
          b = Math.min(R, c.length - 1);
        while (a <= b && !c[a].trim()) a++;
        while (b >= a && !c[b].trim()) b--;
        if (a <= b)
          acc.push([
            j,
            a,
            c
              .slice(a, b + 1)
              .join('')
              .replace(/\s+/g, ' '),
            b - a + 1,
          ]);
      }
      flush();
      return j;
    }

    function scan() {
      timer = 0;
      if (!firstAt) firstAt = Date.now();

      // A full-screen CLI (the alternate screen: OpenCode, and Claude Code when it runs as a
      // background session, which ignores the classic-renderer setting; seen 2026-10-03, every
      // report in that panel went plain) redraws its one screen in place, so a painted row can hold
      // other text a moment later: there the whole screen is read again on every pass. It is only
      // as tall as the panel.
      const buf = term.buffer.active,
        alt = buf.type !== 'normal';
      const end = buf.length,
        last = from && !from.isDisposed ? from.line : 0,
        start = alt ? 0 : blockStart(Math.max(0, Math.min(last, end) - RESCAN_TAIL));
      drop(start);
      from?.dispose();
      from = term.registerMarker(0) || null; // the cursor's line: every row below it is still empty

      // Each row's text is read once per pass: a row was translated up to three times (heading,
      // table and section tests).
      const seen = new Map(),
        text = i => {
          let t = seen.get(i);
          if (t === undefined) seen.set(i, (t = buf.getLine(i)?.translateToString(true) ?? ''));
          return t;
        };
      for (let i = start; i < end; i++) {
        if (!HEADING.test(text(i))) {
          const next = table(buf, text, i, end) || section(buf, text, i, end);
          if (next) i = next - 1;
          else {
            const m = text(i).match(CHECK),
              o = !m && text(i).match(OUTCOME_LINE);
            if (m) {
              block = null;
              paint(buf, i, {
                x: m[1].length,
                width: m[2].length,
                foregroundColor: colors.outcomes[CHECK_KIND[m[3]]],
              });
            } // a check-list label: the word only
            else if (o) {
              block = null;
              paint(buf, i, {
                x: o[1].length,
                width: o[2].length,
                foregroundColor: colors.outcomes[OUTCOME[o[2].toLowerCase()]],
              });
            } // a numbered block's outcome: the word only
          }
          continue;
        }
        const rows = [[i, colors.row]],
          labels = [];
        let j = i + 1,
          seenLabel = false,
          kind = null;
        if (j < end && !text(j).trim()) j++; // a blank line under the heading is part of the block
        for (; j < end; j++) {
          const t = text(j),
            m = t.match(LABEL);
          if (m) {
            seenLabel = true;
            kind = kindOf(colors, m[2]);
            rows.push([j, kind.row]);
            labels.push([j, m[1].length, m[2].length, kind.fg]);
            continue;
          }
          if (seenLabel && t.trim() && (buf.getLine(j)?.isWrapped || /^\s/.test(t))) {
            rows.push([j, kind.row]);
            continue;
          } // wrapped item text: its label's color

          // Codex draws an empty row between the report's lines (seen in codex-cli 0.160.0,
          // 2026-10-05: only "Did" was colored): the block goes on while the next row is a report
          // line. The empty row itself stays plain, like the one under the heading.
          if (seenLabel && !t.trim() && j + 1 < end && LABEL.test(text(j + 1))) continue;
          break;
        }
        if (!seenLabel) continue;
        block = null;
        rows.forEach(([r, bg]) => paint(buf, r, { width: term.cols, backgroundColor: bg }));
        const head = text(i),
          hd = paint(buf, i, {
            x: head.length - head.trimStart().length,
            width: Math.max(1, head.trim().length),
            foregroundColor: colors.accent,
          });
        if (hd) hd.tnaiHead = true;
        if (!alt)
          note(
            buf,
            i,
            rows
              .map(([r]) => text(r))
              .join('')
              .replace(/\s+/g, '')
              .slice(0, 400)
          );
        labels.forEach(([r, x, w, fg]) => paint(buf, r, { x, width: w, foregroundColor: fg }));
        i = j - 1;
      }
      passes++;
      syncNav();
    }

    // Unread reports (a finished report was pushed out of view by the
    // next turn, a held `tnai send` typed in at task end or the finish check, before the user read
    // it). A report counts as read once its heading was on screen for DWELL_MS in a view that is
    // shown, in a focused window; inferred, the app cannot know what the user looked at. One that
    // leaves the screen before that lights the pill (.tnai-report-unread), and a click on its word
    // goes there. Reports are known by their text without spaces, so a CLI that prints its whole
    // conversation again (Claude Code after a resize) keeps each one's state; a report still being
    // written is followed by its heading's marker. What the first pass finds, and the passes of the
    // HISTORY_MS after it, is a restored session's old output: read.
    const DWELL_MS = 3000,
      HISTORY_MS = 2000,
      KNOWN_MAX = 300,
      known = new Map();
    let passes = 0,
      firstAt = 0;
    const alive = e => !!e.marker && !e.marker.isDisposed;

    function note(buf, line, sig) {
      let e = known.get(sig);
      for (const [k, o] of known)
        if (k !== sig && alive(o) && o.marker.line === line) {
          known.delete(k);
          if (e) {
            clearTimeout(o.timer);
            o.marker.dispose();
          } else e = o;
          break;
        } // the same report, longer now
      if (!e) e = { seen: !passes || Date.now() - firstAt < HISTORY_MS, marker: null, timer: 0 };
      if (!e.seen && !alive(e))
        e.marker = term.registerMarker(line - (buf.baseY + buf.cursorY)) || null;
      known.delete(sig);
      known.set(sig, e); // newest last
      if (known.size > KNOWN_MAX) {
        const [k, o] = known.entries().next().value;
        clearTimeout(o.timer);
        o.marker?.dispose();
        known.delete(k);
      }
    }
    const onScreen = e => {
      const b = term.buffer.active,
        l = e.marker.line;
      return l >= b.viewportY && l < b.viewportY + term.rows;
    };
    const watching = () => !away() && !!term.element?.ownerDocument.hasFocus();
    const unread = () =>
      [...known.values()]
        .filter(e => !e.seen && alive(e))
        .sort((a, b) => a.marker.line - b.marker.line);

    function syncUnread() {
      let off = false;
      for (const e of unread()) {
        if (!onScreen(e)) {
          clearTimeout(e.timer);
          e.timer = 0;
          off = true;
          continue;
        }
        if (e.timer || !watching()) continue;
        e.timer = setTimeout(() => {
          e.timer = 0;
          if (!e.seen && alive(e) && onScreen(e) && watching()) {
            e.seen = true;
            e.marker.dispose();
          }
        }, DWELL_MS);
      }
      if (nav.classList.contains('tnai-report-unread') === off) return;
      nav.classList.toggle('tnai-report-unread', off);
      const word = nav.querySelector('span');
      word.title = off ? 'A report you have not seen is out of view. Click to go to it' : '';
    }

    // A view that is not on screen is not read (every view with output was, 150 ms after each
    // write): the pass is owed (stale) and runs at once when the view is shown again, in the same
    // task as xterm's own wake-up, so its first redraw already has the colors. Shown is told by an
    // IntersectionObserver (no forced layout), made in the element's own window: a pop-out's
    // terminals live in its document. A minimized main window counts as not shown too. Until the
    // observer has answered, the view counts as shown.
    let shown = true,
      stale = false,
      seenDoc = null,
      io = null;
    const away = () => !shown || (seenDoc === document && document.hidden);
    const wake = () => {
      if (stale && !away()) {
        stale = false;
        clearTimeout(timer);
        scan();
      }
    };

    function watch() {
      const el = term.element,
        doc = el?.ownerDocument;
      if (!doc || doc === seenDoc) return;
      io?.disconnect();
      seenDoc = doc;
      shown = true;
      io = new (doc.defaultView || window).IntersectionObserver(list => {
        shown = list[list.length - 1].isIntersecting;
        wake();
      });
      io.observe(el);
    }
    const soon = () => {
      watch();
      if (away()) {
        stale = true;
        return;
      }
      if (!timer) timer = setTimeout(scan, 150);
    };
    wakes.set(term, wake);

    // Read now, not 150 ms on: for a terminal the app has just written whole (a stopped session's
    // screen laid out for a new width, 10 reflowSaved). While a divider is dragged that happens
    // many times a second, each one drops the colors, and a pass 150 ms later never caught up:
    // the report's band and its button were gone for the whole drag.
    scansNow.set(term, () => {
      if (away()) {
        stale = true;
        return;
      }
      clearTimeout(timer);
      scan();
    });
    const all = () => {
      drop(0);
      from?.dispose();
      from = null;
      soon();
    };
    term.onWriteParsed(soon);
    term.onResize(all); // rows were painted at the old width; wrapped lines move
    term.buffer.onBufferChange(all);
    links(term);

    // Report jump: "↑ Report ↓" at the bottom right, same look as 10's "↓
    // Latest", once the terminal holds a report. ↑ puts the previous report heading above the
    // view's top line at the top; ↓ the next one below it (the newest output when none is left, or
    // when the next one is already on the last screen, which cannot scroll higher). Made on first
    // use: attach() runs before term.open(), when the terminal has no element yet.
    let nav = null;

    function ensureNav() {
      if (nav || !term.element) return nav;
      nav = term.element.ownerDocument.createElement('div');
      nav.className = 'tnai-term-latest tnai-report-nav';
      nav.hidden = true;
      nav.innerHTML =
        '<button type="button" data-dir="-1" title="Previous Technically Not report" aria-label="Previous Technically Not report">↑</button><span>Report</span><button type="button" data-dir="1" title="Next Technically Not report" aria-label="Next Technically Not report">↓</button>';

      // keep the terminal's focus and selection
      nav.addEventListener('mousedown', e => e.preventDefault());
      nav.addEventListener('click', e => {
        if (e.target.closest('span') && nav.classList.contains('tnai-report-unread')) {
          // the oldest unread report out of view: go to it, and it is read
          const u = unread().find(x => !onScreen(x));
          if (!u) return;
          const line = u.marker.line;
          u.seen = true;
          u.marker.dispose();
          if (line > term.buffer.active.baseY) term.scrollToBottom();
          else term.scrollToLine(line);
          return syncNav();
        }
        const dir = +e.target.closest('button[data-dir]')?.dataset.dir;
        if (!dir) return;
        const b = term.buffer.active,
          top = b.viewportY,
          list = heads();
        const to = dir < 0 ? list.filter(h => h < top).pop() : list.find(h => h > top);
        if (to === undefined) {
          if (dir > 0) term.scrollToBottom();
        } else if (to > b.baseY) term.scrollToBottom();
        else term.scrollToLine(to);
        syncNav();
      });
      term.element.append(nav);
      return nav;
    }

    function heads() {
      return [
        ...new Set(decos.filter(d => d.tnaiHead && !d.marker.isDisposed).map(d => d.marker.line)),
      ].sort((a, b) => a - b);
    }

    function syncNav() {
      if (!ensureNav()) return;
      const b = term.buffer.active,
        list = b.type === 'normal' ? heads() : [];
      nav.hidden = !list.length;
      if (!list.length) return;
      const [up, down] = nav.querySelectorAll('button');
      up.disabled = !list.some(h => h < b.viewportY);
      down.disabled = b.viewportY >= b.baseY;
      syncUnread();
    }
    term.onScroll(syncNav);
    term.buffer.onBufferChange(syncNav);
    looks.set(term, syncNav);
    unreads.set(term, () => unread().map(e => e.marker.line));
    recolors.set(term, () => {
      colors = colorsFor(term);
      all();
    });
    painted.set(term, () =>
      decos
        .filter(d => !d.marker.isDisposed)
        .map(d => ({
          line: d.marker.line,
          x: d.options.x || 0,
          width: d.options.width,
          fg: d.options.foregroundColor,
          bg: d.options.backgroundColor,
        }))
    );
  }

  // Clickable report items: each item on a report's Ideas / Decide / Next
  // line (items split at "; ", Decide options at " | N. ") is a link: hover underlines it, a click
  // pastes "Ideas 2: <item text>" into this terminal's own input in one go (term.paste; user
  // request 2026-09-29: no text visibly typed) without submitting it (the
  // user may add to it first, then presses Enter). A drag still selects text (xterm links ignore
  // drags). Only answers and follow-ups are links: Remains, Found,
  // Blockers and Untested are things the agent already knows.
  const LINK_SECS = { ideas: 'ideas', decide: 'decide', next: 'next' };

  function links(term) {
    // One item row plus its wrapped/indented continuation rows, as text with each character's cell
    // ({ x, y } 1-based, width).
    function itemAt(buf, y) {
      const line = r => buf.getLine(r)?.translateToString(true) ?? '';
      let s = y;
      while (
        s > 0 &&
        s > y - 30 &&
        !LABEL.test(line(s)) &&
        line(s).trim() &&
        (buf.getLine(s)?.isWrapped || /^\s/.test(line(s)))
      )
        s--;
      const m = line(s).match(LABEL);
      if (!m || !LINK_SECS[m[2].slice(0, -1).toLowerCase()]) return null;

      // the rows above lead up to the report heading (one blank line under it allowed)
      let h = s - 1;
      while (
        h >= 0 &&
        h > s - 60 &&
        !HEADING.test(line(h)) &&
        (LABEL.test(line(h)) ||
          (line(h).trim() && (buf.getLine(h)?.isWrapped || /^\s/.test(line(h)))) ||
          (!line(h).trim() && h > 0 && line(h - 1).trim() && !HEADING.test(line(h - 1))))
      )
        h--; // an empty row between two report lines (Codex)
      if (h >= 0 && !line(h).trim()) h--;

      // A Decide line written outside the block (in the reply above the heading, where
      // its options could not be clicked) is a decision all the same, once its numbered options are
      // on it (checked below); every other label counts only inside a block.
      const stray = h < 0 || !HEADING.test(line(h));
      if (stray && LINK_SECS[m[2].slice(0, -1).toLowerCase()] !== 'decide') return null;
      let e = s;
      while (
        e + 1 < buf.length &&
        e - s < 30 &&
        !LABEL.test(line(e + 1)) &&
        line(e + 1).trim() &&
        (buf.getLine(e + 1)?.isWrapped || /^\s/.test(line(e + 1)))
      )
        e++;
      if (y > e) return null;
      let text = '',
        at = [];
      for (let r = s; r <= e; r++) {
        const row = buf.getLine(r),
          cell = buf.getNullCell();
        if (!row) continue;
        const cells = [];
        for (let x = 0; x < term.cols; x++) {
          const c = row.getCell(x, cell);
          if (!c || !c.getWidth()) continue;
          cells.push({ ch: c.getChars() || ' ', x: x + 1, y: r + 1, w: c.getWidth() });
        }
        while (cells.length && cells[cells.length - 1].ch === ' ') cells.pop();
        if (r > s && !row.isWrapped) {
          while (cells.length && cells[0].ch === ' ') cells.shift();
          text += ' ';
          at.push(at[at.length - 1]);
        }
        for (const c of cells)
          for (let k = 0; k < c.ch.length; k++) {
            text += c.ch[k];
            at.push(c);
          }
      }
      if (stray && !/\|\s*\d+[.)]\s*\S/.test(text)) return null;
      return {
        sec: LINK_SECS[m[2].slice(0, -1).toLowerCase()],
        text,
        at,
        start: m[0].length,
        rows: [s + 1, e + 1],
      };
    }
    const tip = (on, label) => {
      if (term.element) term.element.title = on ? label : '';
    };

    // Every clicked item ends with " / " (it replaced the " — " put in front
    // of a second click): whatever comes next, another click or the user's own words, starts after
    // it, so nothing runs together and no space has to be typed.
    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const buf = term.buffer.active;

        // A full-screen CLI that asked for mouse reports (OpenCode) gets every click itself, so its
        // items are no links; one that did not (Codex) has them like the normal screen.
        if (buf.type !== 'normal' && term.modes.mouseTrackingMode !== 'none')
          return callback(undefined);
        const it = itemAt(buf, lineNumber - 1);
        if (!it) return callback(undefined);
        const body = it.text.slice(it.start),
          parts = [];
        const dec =
          it.sec === 'decide' && body.split('|')[0].match(/\bDecision\s+(\d+)\s+of\s+\d+/i);
        if (it.sec === 'decide') {
          for (const m of body.matchAll(/\|\s*(\d+)[.)]\s*([^|]+)/g))
            parts.push({ n: +m[1], i: m.index + m[0].indexOf(m[2]), t: m[2].replace(/\s+$/, '') });

          // Only the options are links, never the question (the same day the
          // question had been made one: "i should only be able to click the decisions"; a click on
          // it put in an empty "Decision N: / " that was sent by mistake twice).
        } else {
          let i = 0,
            n = 0;
          for (const seg of body.split(';')) {
            const t = seg.trim();
            if (t) parts.push({ n: ++n, i: i + seg.indexOf(t), t });
            i += seg.length + 1;
          }
        }
        const out = parts
          .map(p => {
            const a = it.start + p.i,
              b = a + p.t.length - 1,
              s = it.at[a],
              e = it.at[b];
            if (!s || !e) return null;

            // A numbered decision ("Decide: Decision 2 of 3: …") names itself, so answers to
            // several decisions don't all read "Decide 1".
            const label = dec
              ? 'Decision ' + dec[1] + ', option ' + p.n
              : it.sec[0].toUpperCase() + it.sec.slice(1) + ' ' + p.n;
            return {
              range: { start: { x: s.x, y: s.y }, end: { x: e.x + e.w - 1, y: e.y } },
              text: p.t,
              decorations: { pointerCursor: true, underline: true },
              hover: () => tip(true, 'Put ' + label + ' in this terminal input (Enter sends it)'),
              leave: () => tip(false),
              activate: () => {
                tip(false);

                // A paste counts as typing and jumps the view to the newest line (10). A click on
                // an option keeps the view where the user is reading, so the next decision can be
                // clicked without scrolling back up: the view stays
                // where the reader is in the terminal.
                const b = term.buffer.active,
                  at = b.viewportY,
                  away = at < b.baseY;
                term.paste(
                  label + ': ' + p.t.replace(/\s*\((?:fit \d+%|recommended)\)\s*$/i, '') + ' / '
                );
                term.focus();
                if (away) term.scrollToLine(at);
              },
            };
          })
          .filter(l => l && l.range.start.y <= lineNumber && l.range.end.y >= lineNumber);
        callback(out.length ? out : undefined);
      },
    });
  }

  // Theme switch: 10 sets each open terminal's new theme on the same event; repaint after it with
  // the matching tint.
  const recolors = new WeakMap(),
    painted = new WeakMap(),
    wakes = new WeakMap(),
    scansNow = new WeakMap(),
    looks = new WeakMap(),
    unreads = new WeakMap(),
    terms = new Set();

  // back in the window: a report on screen starts counting as looked at
  window.addEventListener('focus', () => terms.forEach(ref => looks.get(ref.deref() || {})?.()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) terms.forEach(ref => wakes.get(ref.deref() || {})?.());
  }); // window restored: passes owed while minimized
  window.addEventListener('tnai:theme-changed', () =>
    setTimeout(
      () =>
        terms.forEach(ref => {
          const t = ref.deref();
          if (!t) return terms.delete(ref);
          recolors.get(t)?.();
        }),
      0
    )
  );
  window.TnaiReportHighlight = {
    // 10: the colors of a terminal whose screen was just written whole, without the usual wait
    scanNow: term => scansNow.get(term)?.(),

    // 122: the kind of a report label ("Did" → "did", "Next" → "found"), '' for an unknown one
    labelKind: label =>
      KIND_OF[
        String(label || '')
          .replace(/:$/, '')
          .trim()
          .toLowerCase()
      ] || '',

    // 122: a status section heading, or an "Outcome: Fixed" line, or null
    readLine,
    attach: term => {
      attach(term);
      terms.add(new WeakRef(term));
    },
    // tests (desktop-check report-highlight): what is tinted right now
    painted: term => painted.get(term)?.() || [],
    // tests: the buffer lines of the report headings not yet read
    unread: term => unreads.get(term)?.() || [],
  };
})();
