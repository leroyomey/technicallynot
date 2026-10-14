// Technically Not · 146-own-terminal-links.js — Desktop only: what can be pressed in the output of
// the user's own terminal (136).
//
// - A file of the project, written relative to the folder the shell is in or to the project
//   folder, or as a full path inside the project, with or without `:line` behind it: a press
//   opens it in the Files tab's reader (131), at that line.
// - A web address on this computer (http://localhost:PORT, 127.0.0.1, [::1]): a press opens it in
//   Live preview (31 takes the address, 65 is the page).
// - Any other web address: a press opens it in the system's browser, the way every outside link
//   of the app does (a new window is refused by the main process, which hands the address to the
//   system).
//
// A path is a link only when that file is there: every candidate is asked of the file service
// once and the answer kept for a few seconds. Text that only looks like a path stays plain text.
//
// `window.TnaiOwnTerminalLinks`: `at(term, row)` gives the links of one screen row (a promise of
// a list of { text, kind, range, activate }), which is also what the terminal is given.
// Test: `own-terminal-links`.
(() => {
  'use strict';
  const native = window.tnaiNative;
  if (!native?.fs?.stat) return;

  const normal = path =>
    String(path || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '');

  // ---------- one line of output, with where each character stands ----------
  // A long line is broken over several rows of the screen. The rows are put together again, so a
  // path or an address that was broken at the edge is still found whole.
  function lineAround(term, row) {
    const buffer = term.buffer.active;
    let first = row;
    while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;
    let last = row;
    while (buffer.getLine(last + 1)?.isWrapped) last += 1;
    let text = '';
    const cells = [];
    for (let at = first; at <= last; at++) {
      const line = buffer.getLine(at);
      if (!line) break;
      for (let column = 0; column < line.length; column++) {
        const cell = line.getCell(column);
        const width = cell?.getWidth() ?? 1;

        // the second half of a wide character has no text of its own
        if (width === 0) continue;
        const chars = cell?.getChars() || ' ';
        for (let unit = 0; unit < chars.length; unit++) cells.push({ x: column + 1, y: at + 1 });
        text += chars;
      }
    }
    return { text, cells };
  }

  // ---------- what looks like an address or a path ----------
  const ADDRESS = /https?:\/\/[^\s"'<>`]+/g;
  const PATH =
    /(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@~+-]+[\\/])*[\w.@~+-]+\.[A-Za-z0-9]{1,10}(?::\d+)?/g;

  // The end of a sentence or a closing bracket behind an address is not part of it.
  const trimEnd = found => found.replace(/[.,;:!?)\]}'"]+$/, '');

  // ---------- is this path a file of the project? ----------
  const projectRoot = () => {
    try {
      return normal(window.TnaiProjects?.active?.());
    } catch {
      return '';
    }
  };

  // The folder the shell is in, when the app knows it and it is inside the project.
  function shellFolder(paneId) {
    try {
      const session = window.TnaiAgents.sessions().find(one => one.paneId === paneId);
      return normal(session?.cwd);
    } catch {
      return '';
    }
  }

  // "a/./b/../c" → "a/c"; null when the path leaves the folder it starts in.
  function tidy(path) {
    const parts = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) return null;
        parts.pop();
      } else parts.push(part);
    }
    return parts.join('/');
  }

  // The ways a written path can be meant, each as a path relative to the project folder.
  function candidates(written, paneId) {
    const root = projectRoot();
    const path = normal(written);
    if (!root || !path) return [];
    const inRoot = full => {
      const lower = full.toLowerCase();
      const base = root.toLowerCase();
      return lower.startsWith(base + '/') ? tidy(full.slice(root.length + 1)) : null;
    };
    if (/^[A-Za-z]:\//.test(path)) return [inRoot(path)].filter(Boolean);

    // A path from the root of a drive or of a Unix system is not a file of the project.
    if (path.startsWith('/')) return [];
    const list = [];
    const folder = shellFolder(paneId);
    if (folder) list.push(inRoot(folder + '/' + path));
    list.push(tidy(path));
    return [...new Set(list.filter(Boolean))];
  }

  // Asked once per path, the answer kept for a few seconds: moving the pointer over a row asks
  // for the row's links again and again.
  const KEEP_MS = 5000;
  const known = new Map();

  function isFile(rel) {
    const kept = known.get(rel);
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.answer;
    const answer = native.fs
      .stat(rel)
      .then(result => !!result?.ok && typeof result.value?.size === 'number')
      .catch(() => false);
    known.set(rel, { at: Date.now(), answer });
    if (known.size > 400) known.delete(known.keys().next().value);
    return answer;
  }

  async function fileOf(written, paneId) {
    for (const rel of candidates(written, paneId)) {
      if (await isFile(rel)) return rel;
    }
    return '';
  }

  // ---------- what a press does ----------
  function openFile(rel, line) {
    const side = window.TnaiThreadSide;
    if (!side?.showFile) return;
    side.open('files');
    side.showFile(rel, null, line);
  }

  function openAddress(address) {
    const preview = window.TnaiLivePreview;
    const local = !!preview?.localUrl?.(address);
    if (local && preview.addUrl(address)?.ok && window.TnaiLivePreviewPage?.open) {
      const show = () => window.TnaiLivePreviewPage.open();

      // a change of page fades, as from the menu (124)
      if (window.TnaiMotion) window.TnaiMotion.swap(show, 'page');
      else show();
      return 'preview';
    }

    // refused as a window by the main process, which gives the address to the system's browser
    window.open(address, '_blank', 'noopener');
    return 'browser';
  }

  // ---------- the links of one row ----------
  const rangeOf = (cells, start, end) => ({
    start: { x: cells[start].x, y: cells[start].y },
    end: { x: cells[end - 1].x, y: cells[end - 1].y },
  });

  async function at(term, row) {
    const { text, cells } = lineAround(term, row);
    if (!text.trim()) return [];
    const links = [];
    const taken = [];
    for (const match of text.matchAll(ADDRESS)) {
      const address = trimEnd(match[0]);
      const end = match.index + address.length;
      taken.push([match.index, match.index + match[0].length]);
      const local = !!window.TnaiLivePreview?.localUrl?.(address);
      links.push({
        text: address,
        kind: local ? 'preview' : 'browser',
        range: rangeOf(cells, match.index, end),
        activate: () => openAddress(address),
      });
    }
    for (const match of text.matchAll(PATH)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      const numbered = /^(.*?):(\d+)$/.exec(match[0]);
      const written = numbered ? numbered[1] : match[0];
      const line = numbered ? Number(numbered[2]) : 0;
      const rel = await fileOf(written, term.tnaiPaneId || '');
      if (!rel) continue;
      links.push({
        text: match[0],
        kind: 'file',
        file: rel,
        line,
        range: rangeOf(cells, start, end),
        activate: () => openFile(rel, line),
      });
    }

    // only what touches the row that was asked for
    return links.filter(link => link.range.start.y <= row + 1 && link.range.end.y >= row + 1);
  }

  // ---------- given to the terminal ----------
  function attach(term) {
    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        at(term, lineNumber - 1).then(
          links =>
            callback(
              links.length
                ? links.map(link => ({
                    range: link.range,
                    text: link.text,
                    decorations: { underline: true, pointerCursor: true },
                    activate: () => link.activate(),
                  }))
                : undefined
            ),
          () => callback(undefined)
        );
      },
    });
  }

  window.addEventListener('tnai:own-terminal-view', event => {
    if (event.detail?.term) attach(event.detail.term);
  });

  window.TnaiOwnTerminalLinks = { at };
})();
