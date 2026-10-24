/*
 * Messages between agents in a thread, drawn so they read easily (user 2026-10-24: "find better way
 * to color code and format the text inside helpers"; mocks docs/plans/design-concepts/
 * helper-brief.html and tab 1 and 6 of app-polish.html, both approved).
 *
 * - The task brief a helper got from its lead, and later "[from …]" messages: a card with a
 *   colored edge and a head that says who wrote to whom ("Lead → Ridge · Task brief"), the words
 *   drawn as markdown, a "Summary:" line as the headline, "Steps:" and the like as small section
 *   labels, long paths and web addresses as short chips (the whole text on hover), and a long
 *   brief folded.
 * - A helper's report handed back to its lead (Claude Code's <agent-message>, read in
 *   desktop/thread-log-claude.js): the same card in teal, "Sol → Lead · Helper report".
 * - Pictures attached to a prompt: small tiles under the user's words instead of their paths.
 *
 * 122 (the Readable view) calls `TnaiAgentMessages.from`, `.report` and `.pictures`; each returns
 * a node (or null), and 122 places it. Nothing here reads on its own or keeps state.
 */
(() => {
  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // A brief or report longer than this many lines folds after its first part.
  const FOLD_LINES = 18;

  // ---------- names ----------
  const sessionName = paneId =>
    safe(() => window.TnaiAgents.sessions().find(session => session.paneId === paneId)?.name, '') ||
    'Lead';

  // The helpers the lead's session knows (10 / 19): their call id, agent id and name.
  const subsOf = paneId => safe(() => window.TnaiTeam?.get?.(paneId)?.subs || [], []);

  const subName = sub => (sub ? sub.alias || sub.description || sub.type || '' : '');

  function helperName(paneId, key) {
    const sub = subsOf(paneId).find(
      item => key && (item.toolUseId === key || item.agentId === key || item.key === key)
    );
    return subName(sub) || 'Helper';
  }

  const timeOf = at => {
    if (!at) return '';
    return safe(
      () => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ''
    );
  };

  // ---------- the words ----------
  // A brief as markdown the renderer draws well: its "Summary:" line comes out as the headline,
  // and a short label alone on its line ("Steps:") or opening a paragraph ("Project: …") becomes a
  // small heading. Everything else is left as written.
  function shapeBrief(text) {
    const lines = String(text || '').split('\n');
    let headline = '';
    const first = lines.findIndex(line => line.trim());
    const summary = first >= 0 ? /^\s*Summary:\s*(.+)$/i.exec(lines[first]) : null;
    if (summary) {
      headline = summary[1].trim();
      lines.splice(first, 1);
    }
    const shaped = [];
    lines.forEach((line, index) => {
      const startsParagraph = index === 0 || !lines[index - 1].trim();
      const alone = /^([A-Z][\w'’ ()/-]{1,40}):\s*$/.exec(line);
      const opening =
        startsParagraph && /^([A-Z][\w'’()-]*(?: [\w'’()-]+){0,2}):\s+(\S.*)$/.exec(line);
      if (alone) shaped.push('', '### ' + alone[1], '');
      else if (opening && !/^https?$/i.test(opening[1]))
        shaped.push('', '### ' + opening[1], '', opening[2]);
      else shaped.push(line);
    });
    return { headline, words: shaped.join('\n').trim() };
  }

  // A report's first paragraph is its headline when it is short and plain words.
  function shapeReport(text) {
    const words = String(text || '').trim();
    const firstEnd = words.search(/\n\s*\n/);
    const first = (firstEnd < 0 ? words : words.slice(0, firstEnd)).trim();
    const plain = first && !/^([#>*\-`|]|\d+[.)]\s)/.test(first) && !/\n/.test(first);
    if (!plain || first.length > 240) return { headline: '', words };
    return {
      headline: first.replace(/\*\*/g, ''),
      words: firstEnd < 0 ? '' : words.slice(firstEnd),
    };
  }

  // Long paths and web addresses in the words become short chips: the file's name (or the
  // address's site), the whole text on hover. Code and code blocks are left as written.
  const WINDOWS_PATH = /[A-Za-z]:\\[^\s"'<>|*?]+/g;
  const WEB_ADDRESS = /https?:\/\/[^\s<>"')\]]+/g;
  const SLASH_PATH = /(?:\.{0,2}\/)?(?:[\w@.-]+\/){2,}[\w@.-]*/g;

  function shortName(whole) {
    if (/^https?:/i.test(whole)) {
      const address = safe(() => new URL(whole), null);
      if (!address) return whole;
      const last = address.pathname.split('/').filter(Boolean).pop() || '';
      return address.hostname.replace(/^www\./, '') + (last ? ' · ' + last : '');
    }
    const trimmed = whole.replace(/[\\/]+$/, '');
    const name = trimmed.split(/[\\/]/).pop() || whole;
    return /[\\/]$/.test(whole) ? name + '/' : name;
  }

  function chipFor(whole) {
    // a sentence's own full stop or comma after the path is not part of it
    const tail = /[.,;:]+$/.exec(whole)?.[0] || '';
    const path = tail ? whole.slice(0, -tail.length) : whole;
    const chip = make(
      'span',
      /^https?:/i.test(path) ? 'tam-chip tam-web' : 'tam-chip',
      shortName(path)
    );
    chip.title = path;
    chip.dataset.whole = path;
    return { chip, tail };
  }

  function chipPaths(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node =>
        node.parentElement?.closest('code, pre, .tam-chip')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    const pattern = new RegExp(
      [WEB_ADDRESS.source, WINDOWS_PATH.source, SLASH_PATH.source].join('|'),
      'g'
    );
    for (const node of texts) {
      const text = node.nodeValue;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const parts = document.createDocumentFragment();
      let from = 0;
      for (const match of text.matchAll(pattern)) {
        // a short "a/b/" is a word, not a path worth a chip
        if (match[0].length < 12) continue;

        // a Windows folder can hold spaces ("C:\Users\me\Pinball Unity"), so where it ends is a
        // guess: only a path ending in a file name or a backslash becomes a chip
        if (/^[A-Za-z]:\\/.test(match[0]) && !/(\.\w{1,6}|\\)[.,;:]*$/.test(match[0])) continue;
        parts.append(text.slice(from, match.index));
        const { chip, tail } = chipFor(match[0]);
        parts.append(chip, tail);
        from = match.index + match[0].length;
      }
      if (!from) continue;
      parts.append(text.slice(from));
      node.replaceWith(parts);
    }
  }

  // ---------- the card ----------
  function head({ who, to, kind, at, tone }) {
    const row = make('div', 'tam-head');
    const sender = make('span', 'tam-who');
    sender.append(make('b', 'tam-av', (who || '?').trim().charAt(0).toUpperCase()), who);
    row.append(sender);
    if (to) row.append(make('span', 'tam-arrow', '→'), make('span', 'tam-to', to));
    if (kind) row.append(make('span', 'tam-kind', kind));
    const time = timeOf(at);
    if (time) row.append(make('time', 'tam-time', time));
    row.dataset.tone = tone;
    return row;
  }

  function card({ who, to, kind, at, tone, headline, words, markdown, foldable }) {
    const box = make('div', 'tam-card');
    box.dataset.tone = tone;
    box.append(head({ who, to, kind, at, tone }));
    const body = make('div', 'tam-body tnt-say');
    if (headline) body.append(make('p', 'tam-headline', headline));
    if (words) body.insertAdjacentHTML('beforeend', markdown(words));
    safe(() => chipPaths(body), null);
    box.append(body);

    const lineCount = String(words || '').split('\n').length;
    if (foldable && lineCount > FOLD_LINES) {
      box.classList.add('tam-folded');
      const more = make('button', 'tam-more', 'Show all · ' + lineCount + ' lines');
      more.type = 'button';
      more.addEventListener('click', () => {
        const folded = box.classList.toggle('tam-folded');
        more.textContent = folded ? 'Show all · ' + lineCount + ' lines' : 'Fold';
      });
      box.append(more);
    }
    return box;
  }

  // A prompt from another agent: the brief a helper got from its lead (who "its lead"), or a
  // message sent with `tnai send` ("[from Lead]").
  function from(state, entry, markdown) {
    const brief = entry.who === 'its lead';
    const shaped = brief ? shapeBrief(entry.text) : { headline: '', words: entry.text };
    const thisThread = state.sub ? helperName(state.paneId, state.sub) : sessionName(state.paneId);
    const node = card({
      who: brief ? sessionName(state.paneId) : String(entry.who || 'Agent').replace(/^.*· /, ''),
      to: thisThread,
      kind: brief ? 'Task brief' : '',
      at: entry.at,
      tone: 'lead',
      headline: shaped.headline,
      words: shaped.words,
      markdown,
      foldable: true,
    });
    node.classList.add('tnt-from');
    return node;
  }

  // A helper's report handed back to its lead.
  function report(state, entry, markdown) {
    const sub = subsOf(state.paneId).find(item => item.agentId === entry.fromId);
    const shaped = shapeReport(entry.text);
    return card({
      who: subName(sub) || 'Helper',
      to: sessionName(state.paneId),
      kind: 'Helper report',
      at: entry.at,
      tone: 'helper',
      headline: shaped.headline,
      words: shaped.words,
      markdown,
      foldable: true,
    });
  }

  // ---------- pictures under a prompt ----------
  function openLarge(paneId, file, name) {
    const draw = host => {
      host.replaceChildren(make('p', 'tam-pic-wait', 'Loading the picture…'));
      Promise.resolve(window.tnaiNative?.designs?.picture?.(paneId, file, { large: true }))
        .then(found => {
          if (!found?.ok || !found.image) {
            host.replaceChildren(make('p', 'tam-pic-wait', 'The picture is no longer there.'));
            return;
          }
          const image = make('img', 'tam-pic-large');
          image.alt = name;
          image.src = found.image;
          host.replaceChildren(image);
        })
        .catch(() => null);
    };
    const split = window.TnaiPreviewSplit;
    if (split?.openNode) split.openNode('picture:' + file, name, draw, 'picture');
  }

  function pictures(state, entry) {
    if (!Array.isArray(entry.pictures) || !entry.pictures.length) return null;
    const row = make('div', 'tam-pics');
    for (const file of entry.pictures) {
      const name = shortName(file);
      const tile = make('button', 'tam-pic');
      tile.type = 'button';
      tile.title = file;
      const frame = make('span', 'tam-pic-frame');
      tile.append(frame, make('span', 'tam-pic-name', name));
      tile.addEventListener('click', () => openLarge(state.paneId, file, name));
      row.append(tile);
      Promise.resolve(window.tnaiNative?.designs?.picture?.(state.paneId, file, {}))
        .then(found => {
          if (!found?.ok || !found.image) {
            tile.dataset.gone = 'true';
            return;
          }
          const image = make('img');
          image.alt = '';
          image.src = found.image;
          frame.replaceChildren(image);
        })
        .catch(() => null);
    }
    return row;
  }

  window.TnaiAgentMessages = { from, report, pictures, shapeBrief, shapeReport, shortName };
})();
