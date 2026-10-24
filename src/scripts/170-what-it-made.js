// Technically Not · 170-what-it-made.js — Desktop only: "What it made". The "Worked for" block that
// ends a task in the conversation (122 `addWorked`) also says what the task made and lets each
// thing be looked at in place, without asking the agent to show it (user 2026-10-21, mock
// docs/plans/design-concepts/what-it-made.html, round 2).
//
// - Found by the app from the conversation's own entries (desktop/thread-log-*.js, so every CLI
//   with a reader): a file the agent wrote whole ("Wrote", "Made an image") that is a picture, a
//   video, a document, a data file or a page; a picture, video, document or data file a command
//   named and changed while it ran (inferred from the file's change time, said so on hover); a site
//   it showed or claimed (`tnai preview URL`, `tnai server claim URL`) or a local address a command
//   printed, and Live preview's own record of which agent showed which address (31 `tabs`).
// - The block's head says "Worked for 6m 12s · made 3 things, changed 4 files". Under it New (the
//   site, pictures and videos as small pictures, documents and data as chips) and Changed (the code
//   changes as one chip that opens the file list 122 already drew, and Details › Changes). A task
//   that made nothing keeps its block as it was.
// - A press previews in place at a fixed height (49 px of fade at the foot), with one button for
//   the full view: a site → Live preview; a picture → Open large (159's layer); a video → the
//   computer's own player (the window's content rules play no video); a document → the Files tab;
//   a data file → a bar or line of its first number column, or a table, and "Open the data".
// - A site says whether it answers now (asked once when drawn or pressed, never on a timer):
//   running (green dot, address, which agent) or stopped (grey). "Stop it" and "Start it again" go
//   through Live preview's own server path (31 `stop`, `start`, `addScript`), only where that path
//   can do it: a server the app started itself, or the project's own dev script.
// - Only the newest block that made something is open; older ones fold to one line.
// - Settings › Agents, "What agents made": "Show what it made after each task" (on) and "Open Live
//   preview by itself when an agent starts a site" (off). With the second on, a site an agent
//   starts while you watch opens beside the thread in the side column's Live preview tab (131),
//   marked "opened by itself", one tab per address.
//
// window.TnaiWhatItMade (note, result, block, prefs, set, and for the test: find, sitesIn,
// readTable, chartOf). Look: src/styles/51-what-it-made.css. Tests: node
// tools/what-it-made-test.js, desktop test `what-it-made`.
(() => {
  'use strict';
  const native = window.tnaiNative;

  // ---------- the kinds of things a task makes ----------
  const KINDS = [
    ['picture', /\.(png|jpe?g|webp|gif|svg)$/i],
    ['video', /\.(mp4|webm|mov|m4v)$/i],
    ['document', /\.(md|markdown|txt|rst|adoc)$/i],
    ['data', /\.(csv|tsv|json)$/i],
    ['page', /\.html?$/i],
  ];
  const kindOf = file => (KINDS.find(([, test]) => test.test(String(file || ''))) || [''])[0];

  // a file named in a command: plain characters ending in one of the kinds' extensions
  const FILE_IN_COMMAND =
    /(?:^|[\s"'=(,])((?:[A-Za-z]:)?[\w./\\-]+\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|m4v|md|txt|csv|tsv|json))\b/gi;

  // commands that only look at, move or remove a file (as 159): a file they name was not made
  const LOOKS_ONLY =
    /^\s*(?:cat|type|less|more|head|tail|ls|dir|stat|file|git|rm|del|erase|Remove-Item|Get-Content|Get-Item|Get-ChildItem|Test-Path|start|explorer|code)\b/i;
  const MAX_FROM_COMMAND = 6;

  // `tnai preview URL` and `tnai server claim URL`, as typed in any shell
  const SITE_COMMAND =
    /\btnai(?:\.cmd|\.exe)?\s+(?:preview|server\s+claim)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/i;
  const LOCAL_ADDRESS =
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}(?:\/[^\s"'<>)\]]*)?/gi;

  const unquote = text => String(text || '').replace(/^["']|["']$/g, '');
  const baseName = file =>
    String(file || '')
      .split(/[\\/]/)
      .pop();

  // An address as Live preview keeps it: its origin and path, no trailing dot or comma.
  function cleanAddress(raw) {
    const text = String(raw || '').replace(/[.,;:]+$/, '');
    try {
      const address = new URL(/^[a-z]+:\/\//i.test(text) ? text : 'http://' + text);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) return '';

      // the app's own local addresses are not a site the agent made: its hook server
      // (/hook/<key>, written in every agent's settings) and the pages `tnai show` serves
      // (/s/<key>/, a design card's job, 159) (learned 2026-10-21: the hook address showed as
      // "Site running")
      if (/^\/(hook|s)\/[0-9a-f]{16,}/i.test(address.pathname)) return '';
      return address.origin + (address.pathname === '/' ? '/' : address.pathname);
    } catch {
      return '';
    }
  }

  // An action entry → what it made: [{ kind, file, how, since }] and sites [{ url, how }].
  // `how`: 'wrote' (the agent's own write), 'made' (a command changed it, inferred), 'showed'.
  function find(entry) {
    const made = [];
    if (!entry || entry.kind !== 'act') return made;
    const verb = String(entry.verb || '');
    const what = String(entry.what || '');
    if (verb === 'Wrote' || verb === 'Made an image') {
      // a patch of several files names them joined by ", " (thread-log-codex.js)
      for (const part of what.split(/,\s+/)) {
        const file = part.trim();
        const kind = kindOf(file) || (verb === 'Made an image' ? 'picture' : '');
        if (kind) made.push({ kind, file, how: 'wrote', since: 0 });
      }
      return made;
    }
    if (verb !== 'Ran') return made;
    const command = String(entry.full || what);

    // A file a command made can only be told by its change time: a command without a recorded
    // start time adds none, and one that only looks at files adds none.
    if (!entry.at || LOOKS_ONLY.test(command)) return made;
    const seen = new Set();
    FILE_IN_COMMAND.lastIndex = 0;
    for (let match; (match = FILE_IN_COMMAND.exec(command));) {
      const file = match[1];
      if (seen.has(file.toLowerCase()) || seen.size >= MAX_FROM_COMMAND) continue;
      seen.add(file.toLowerCase());
      made.push({ kind: kindOf(file), file, how: 'made', since: entry.at });
    }
    return made;
  }

  // The sites in an action and its result: what it showed or claimed, and a local address a
  // command printed (a dev server says where it listens).
  function sitesIn(entry, result) {
    const sites = [];
    if (!entry || entry.verb !== 'Ran') return sites;
    const command = String(entry.full || entry.what || '');
    const shown = SITE_COMMAND.exec(command);
    const url = shown ? cleanAddress(unquote(shown[1])) : '';
    if (url) sites.push({ url, how: 'showed' });
    const printed = result ? String(result.more || result.text || '') : '';
    LOCAL_ADDRESS.lastIndex = 0;
    for (let match; (match = LOCAL_ADDRESS.exec(printed));) {
      const found = cleanAddress(match[0]);
      if (found && !sites.some(site => site.url === found))
        sites.push({ url: found, how: 'started' });
      if (sites.length >= 3) break;
    }
    return sites;
  }

  // ---------- a data file as a table, and the honest chart of it ----------
  function splitLine(line, separator) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') {
          cell += '"';
          index++;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === separator) {
        cells.push(cell.trim());
        cell = '';
      } else cell += char;
    }
    cells.push(cell.trim());
    return cells;
  }

  // text and the file's name → { head: [names], rows: [[cells]] } or null
  function readTable(text, name) {
    const source = String(text || '');
    if (/\.json$/i.test(name)) {
      let value = null;
      try {
        value = JSON.parse(source);
      } catch {
        return null;
      }
      if (value && !Array.isArray(value) && typeof value === 'object') {
        const list = Object.values(value).find(Array.isArray);
        value = list || Object.entries(value).map(([key, item]) => ({ name: key, value: item }));
      }
      if (!Array.isArray(value) || !value.length) return null;
      if (value.every(item => typeof item === 'number'))
        return { head: ['value'], rows: value.map(item => [String(item)]) };
      const objects = value.filter(
        item => item && typeof item === 'object' && !Array.isArray(item)
      );
      if (!objects.length) return null;
      const head = [...new Set(objects.flatMap(item => Object.keys(item)))].slice(0, 12);
      const cellOf = item =>
        item == null ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item);
      return { head, rows: objects.map(item => head.map(key => cellOf(item[key]))) };
    }
    const separator = /\.tsv$/i.test(name) ? '\t' : ',';
    const lines = source.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return null;
    const head = splitLine(lines[0], separator);
    const rows = lines.slice(1).map(line => splitLine(line, separator));
    return { head, rows };
  }

  const asNumber = cell => {
    const text = String(cell ?? '')
      .replace(/[,$€£%\s]/g, '')
      .trim();
    if (!text || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(text)) return null;
    return Number(text);
  };

  // A table → what to draw: { type: 'bar' | 'line', label, values: [{ name, value }] } for the
  // first column where every cell is a number, or { type: 'table' } when there is none.
  function chartOf(table) {
    if (!table?.rows?.length) return { type: 'table' };
    const width = table.head.length;
    for (let column = 0; column < width; column++) {
      const values = table.rows.map(row => asNumber(row[column]));
      if (!values.every(value => value != null)) continue;

      // a column of growing whole numbers 1, 2, 3 … is a row number, not a measure
      const counts = values.every((value, index) => value === index + 1 || value === index);
      if (counts && table.rows.length > 2) continue;
      const nameColumn = table.head.findIndex((_, index) =>
        table.rows.some(row => asNumber(row[index]) == null)
      );
      return {
        type: table.rows.length > 24 ? 'line' : 'bar',
        label: table.head[column] || 'value',
        values: table.rows.map((row, index) => ({
          name: nameColumn >= 0 ? String(row[nameColumn] || '') : String(index + 1),
          value: values[index],
        })),
      };
    }
    return { type: 'table' };
  }

  // the browser page and builds without the bridge: only the pure part is there (the test)
  if (!native?.made || !native?.designs || !window.TnaiAgents) {
    window.TnaiWhatItMade = { find, sitesIn, readTable, chartOf, kindOf };
    return;
  }

  // ---------- the settings ----------
  const STORE = 'tnai.what-it-made.v1';
  const DEFAULTS = { show: true, autoOpen: false };
  let prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object')
      prefs = { show: saved.show !== false, autoOpen: saved.autoOpen === true };
  } catch {}

  function savePrefs() {
    try {
      const own = Object.fromEntries(
        Object.entries(prefs).filter(([key, value]) => value !== DEFAULTS[key])
      );
      if (Object.keys(own).length) localStorage.setItem(STORE, JSON.stringify(own));
      else localStorage.removeItem(STORE);
    } catch {}
  }

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, size = 14) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  const lp = () => window.TnaiLivePreview || null;
  const loadedAt = Date.now();

  // ---------- what one task made, gathered while its actions are drawn ----------
  // state (122's, one per conversation) → { made: [items], sites: [sites] } of the task now running
  const tasks = new WeakMap();
  const taskOf = state => {
    let task = tasks.get(state);
    if (!task) {
      task = { made: [], sites: [] };
      tasks.set(state, task);
    }
    return task;
  };

  function addSite(state, task, site, at) {
    if (task.sites.some(other => other.url === site.url)) return;
    task.sites.push(site);

    // a site an agent starts while the user watches may open by itself (the setting)
    if (prefs.autoOpen && at && at >= loadedAt && Date.now() - at < 120000)
      openBeside(state, site.url);
  }

  // 122: an action was drawn
  function note(state, entry) {
    if (!state || state.sub) return;
    const task = taskOf(state);
    for (const item of find(entry)) {
      const same = task.made.find(other => other.file.toLowerCase() === item.file.toLowerCase());
      if (!same) task.made.push(item);
      else if (item.how === 'wrote') Object.assign(same, { how: 'wrote', since: 0 });
    }
    for (const site of sitesIn(entry, null)) addSite(state, task, site, entry.at);
  }

  // 122: an action's result came (a dev server prints where it listens)
  function result(state, entry, outcome) {
    if (!state || state.sub || !outcome) return;
    const task = taskOf(state);
    for (const site of sitesIn(entry, outcome)) addSite(state, task, site, entry.at || outcome.at);
  }

  // ---------- the block ----------
  // conversation state → the blocks that made something, oldest first
  const blocks = new WeakMap();

  // the sites drawn in blocks, so a change of Live preview's record reaches each of them
  const drawnSites = new Set();

  const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);

  // 122: the "Worked for" block of a task that ended is built and about to be added
  function block(state, entry, node) {
    const task = tasks.get(state);
    tasks.delete(state);
    if (!prefs.show || !task || !node || state.sub) return false;
    const files = node.querySelector(':scope > .tnt-files');

    // every file of the list 122 drew counts as changed, so the head and the chip say one number
    const changed = files ? files.querySelectorAll('.tnt-file').length : 0;
    if (!task.made.length && !task.sites.length) return false;
    const view = { state, task, node, files, changed, open: '' };
    draw(view);
    const list = blocks.get(state) || [];
    list.push(view);
    blocks.set(state, list);
    list.forEach((other, index) => fold(other, index < list.length - 1));
    return true;
  }

  function headWords(view) {
    const things = view.task.made.length + view.task.sites.length;
    const parts = ['made ' + plural(things, 'thing', 'things')];

    // with the file list, the count is the pill at the right of the line, so it is said once
    if (view.changed && !view.files) parts.push('changed ' + plural(view.changed, 'file', 'files'));
    return ' · ' + parts.join(', ');
  }

  function draw(view) {
    const { node } = view;
    node.classList.add('tnt-made');
    const first = node.firstElementChild;
    const worked = first?.textContent || 'Finished';
    const head = make('button', 'tnt-made-head');
    head.type = 'button';
    head.innerHTML = icon('chevron-right', 14);
    head.append(make('span', '', worked), make('em', '', headWords(view)));
    head.addEventListener('click', () => fold(view, view.node.dataset.folded !== 'true'));
    view.head = head;

    // Round 3 (user 2026-10-21: "presentation for this is terrible"; mock
    // docs/plans/design-concepts/what-it-made-r3.html): the head line with the changed files as one
    // pill at its right, then every new thing as a card across the width that shows what it is.
    const top = make('div', 'tnt-made-top');
    top.append(head, make('span', 'tnt-made-grow'));
    if (view.files) {
      top.append(changesChip(view));
      view.files.hidden = true;
    }
    first ? first.replaceWith(top) : node.prepend(top);

    const body = make('div', 'tnt-made-body');
    const grid = make('div', 'tnt-made-grid');
    for (const site of view.task.sites)
      grid.append(withSplit(siteThumb(view, site), () => site.url, 'Site'));
    for (const item of view.task.made) {
      if (item.kind === 'page')
        grid.append(
          withSplit(fileThumb(view, item), () => pageUrl(view, item), baseName(item.file))
        );
      else if (item.kind === 'picture' || item.kind === 'video') grid.append(fileThumb(view, item));
      else grid.append(textThumb(view, item));
    }
    if (grid.childElementCount) body.append(grid);
    view.preview = make('div', 'tnt-made-preview');
    view.preview.hidden = true;
    body.append(view.preview);
    node.append(body);
    view.body = body;
  }

  function fold(view, folded) {
    view.node.dataset.folded = String(folded);
    view.head.setAttribute('aria-expanded', String(!folded));
    view.head.title = folded ? 'An earlier task: press to see what it made' : 'Fold what it made';
    view.body.hidden = folded;
  }

  // ---------- the parts of the block ----------
  const pressable = (className, title, onPress) => {
    const press = make('button', className);
    press.type = 'button';
    press.title = title;
    press.setAttribute('aria-pressed', 'false');
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  };

  function toggle(view, key, press, fill) {
    const same = view.open === key;
    view.node
      .querySelectorAll('[aria-pressed="true"]')
      .forEach(other => other.setAttribute('aria-pressed', 'false'));
    if (same) {
      view.open = '';
      view.preview.hidden = true;
      view.preview.replaceChildren();
      return;
    }
    view.open = key;
    press.setAttribute('aria-pressed', 'true');
    view.preview.hidden = false;
    view.preview.replaceChildren(make('p', 'tnt-made-none', 'Opening…'));
    fill(view.preview);
  }

  function previewTop(name, meta, actions) {
    const top = make('div', 'tnt-made-ptop');
    const title = make('b', '', name);
    title.title = name;
    top.append(title, meta, make('span', 'tnt-made-grow'), ...actions);
    return top;
  }

  const action = (label, onPress) => {
    const press = make('button', 'tnt-made-act', label);
    press.type = 'button';
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  };

  const HOW = {
    wrote: 'written by the agent',
    made: 'made by a command it ran (inferred: the file changed while the command ran)',
  };

  function fileThumb(view, item) {
    const name = baseName(item.file);
    const thumb = pressable('tnt-made-thumb', name + ' · ' + HOW[item.how], press =>
      toggle(view, 'file ' + item.file, press, box => fillFile(view, item, box))
    );
    const picture = make('i', 'tnt-made-tpic');
    picture.innerHTML = icon(
      item.kind === 'video' ? 'play' : item.kind === 'page' ? 'file-text' : 'eye',
      18
    );
    const kind = item.kind === 'video' ? 'video' : item.kind === 'page' ? 'page' : 'picture';
    thumb.dataset.kind = kind;
    thumb.append(picture, cardWords(name, item.how === 'made' ? 'made by a command' : '', kind));
    if (view.state.paneId) loadThumb(view, item, thumb, picture);
    return thumb;
  }

  // the icon of each kind's tile; the tile and the badge take the kind's tint (51)
  const KIND_ICON = {
    document: 'file-text',
    picture: 'image',
    video: 'play',
    page: 'app-window',
    site: 'globe',
    data: 'table',
  };

  // A card's words under its picture: the kind's tile, the name, one fact, and the kind as a small
  // badge (user 2026-10-23 chose "Proposed" in docs/plans/design-concepts/made-chips.html).
  function cardWords(name, fact, kind) {
    const words = make('span', 'tnt-made-words');
    const tile = make('span', 'tnt-made-tile');
    tile.innerHTML = icon(KIND_ICON[kind] || 'file', 16);
    words.append(tile);
    const text = make('span', 'tnt-made-wtext');
    const title = make('b', '', name);
    title.title = name;
    text.append(title);
    if (fact) text.append(make('small', '', fact));
    words.append(text, make('em', 'tnt-made-kind', kind));
    return words;
  }

  // A document or data file as a card: its own first lines where a picture would be, read once
  // the card is near the screen.
  function textThumb(view, item) {
    const name = baseName(item.file);
    const kind = item.kind === 'data' ? 'data' : 'document';
    const thumb = pressable('tnt-made-thumb', name + ' · ' + HOW[item.how], press =>
      toggle(view, 'file ' + item.file, press, box => fillFile(view, item, box))
    );
    const picture = make('i', 'tnt-made-ttext');
    picture.innerHTML = icon(item.kind === 'data' ? 'chart-pie' : 'file-text', 18);
    thumb.dataset.kind = kind;
    thumb.append(picture, cardWords(name, item.how === 'made' ? 'made by a command' : '', kind));
    thumb.tntMadeLoad = () =>
      native.made
        .text(view.state.paneId, item.file)
        .then(found => {
          if (!found?.ok) {
            if (item.how === 'made') thumb.remove();
            else thumb.dataset.gone = 'true';
            return;
          }
          const lines = String(found.text || '')
            .split(/\r?\n/)
            .filter(line => line.trim())
            .slice(0, 12);
          if (!lines.length) return;
          const first = make('b', '', lines[0].replace(/^#+\s*/, '').slice(0, 80));
          const rest = make('span', '', lines.slice(1).join('\n'));
          picture.replaceChildren(first, rest);
        })
        .catch(() => {});
    if (view.state.paneId) nearScreen.observe(thumb);
    return thumb;
  }

  // the small picture, asked once the block is near the screen (as 159's cards)
  const nearScreen = new IntersectionObserver(
    entries =>
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        nearScreen.unobserve(target);
        target.tntMadeLoad?.();
      }),
    { rootMargin: '600px 0px' }
  );

  function loadThumb(view, item, thumb, picture) {
    thumb.tntMadeLoad = () => {
      const paneId = view.state.paneId;
      const ask =
        item.kind === 'picture'
          ? native.designs.picture(paneId, item.file, { since: item.since })
          : item.kind === 'page'
            ? native.designs.page(paneId, item.file, { shot: true })
            : native.made.check(paneId, item.file, item.since);
      Promise.resolve(ask)
        .then(found => {
          if (!found?.ok) {
            // a file a command only named, or one that is gone, is not something it made
            if (item.how === 'made') thumb.remove();
            else thumb.dataset.gone = 'true';
            return;
          }
          if (found.image) {
            const image = make('img');
            image.alt = '';
            image.src = found.image;
            picture.replaceChildren(image);
          }
        })
        .catch(() => {});
    };
    nearScreen.observe(thumb);
  }

  function changesChip(view) {
    const count = view.changed;
    const chip = pressable('tnt-made-chip', 'The files this task changed', press =>
      toggle(view, 'changes', press, box => {
        // the added and removed line counts 122 drew in the list's own head
        const counts = make('span', 'tnt-made-meta');
        view.files
          .querySelectorAll(':scope > .tnt-files-head > :not(b)')
          .forEach(part => counts.append(part.cloneNode(true)));
        const top = previewTop(plural(count, 'file changed', 'files changed'), counts, [
          action('Open Changes', () => openChanges()),
        ]);
        view.files.hidden = false;
        const holder = make('div', 'tnt-made-pbody');
        holder.append(view.files);
        box.replaceChildren(top, holder);
      })
    );
    chip.innerHTML = icon('git-branch');
    chip.append(make('span', '', plural(count, 'file changed', 'files changed')));

    // the added and removed line counts beside the words, in the diff colors (51)
    view.files
      .querySelectorAll(':scope > .tnt-files-head > :is(u, s)')
      .forEach(part => chip.append(part.cloneNode(true)));
    return chip;
  }

  function openChanges() {
    const side = window.TnaiThreadSide;
    if (!side) return;
    side.open('details');
    requestAnimationFrame(() =>
      document
        .querySelector('.tnt-sidedetails [data-sec="changes"]')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    );
  }

  // ---------- one file's preview ----------
  function fillFile(view, item, box) {
    const name = baseName(item.file);
    const how = make(
      'span',
      'tnt-made-meta',
      item.how === 'made' ? 'made by a command, inferred' : ''
    );
    if (item.kind === 'picture') return fillPicture(view, item, box, name, how);
    if (item.kind === 'page') return fillPage(view, item, box, name, how);
    if (item.kind === 'video') return fillVideo(view, item, box, name, how);
    return fillText(view, item, box, name, how);
  }

  function fillPicture(view, item, box, name, how) {
    const open = action('Open large', press =>
      window.TnaiThreadDesigns?.openLarge?.({
        kind: 'picture',
        state: view.state,
        item,
        opener: press,
      })
    );
    native.designs
      .picture(view.state.paneId, item.file, { since: item.since, large: true })
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (found?.ok && found.image) {
          const image = make('img', 'tnt-made-image');
          image.alt = name;
          image.src = found.image;
          body.append(image);
        } else body.append(make('p', 'tnt-made-none', 'This file is no longer there.'));
        box.replaceChildren(previewTop(name, how, [open]), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // ---------- 179: a page or site beside the thread ----------
  // The address a page file is served at (desktop/thread-designs.js `page`), asked when pressed.
  const pageUrl = (view, item) =>
    native.designs
      .page(view.state.paneId, item.file)
      .then(found => (found?.ok && found.url) || '')
      .catch(() => '');
  const withSplit = (card, getUrl, title) =>
    safe(() => window.TnaiPreviewSplit?.cell?.(card, getUrl, title), null) || card;
  const splitButton = (getUrl, title) =>
    safe(() => window.TnaiPreviewSplit?.button?.(getUrl, title), null);

  function fillPage(view, item, box, name, how) {
    const split = splitButton(() => pageUrl(view, item), name);
    const open = action('Open large', press =>
      window.TnaiThreadDesigns?.openLarge?.({
        kind: 'page',
        state: view.state,
        item,
        opener: press,
      })
    );
    native.designs
      .page(view.state.paneId, item.file, { shot: true })
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (found?.ok && found.image) {
          const image = make('img', 'tnt-made-image');
          image.alt = 'The page ' + name + ', small and still';
          image.src = found.image;
          body.append(image);
        } else
          body.append(
            make(
              'p',
              'tnt-made-none',
              found?.ok ? 'Open it large to see it.' : 'This file is no longer there.'
            )
          );
        box.replaceChildren(previewTop(name, how, split ? [split, open] : [open]), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // The window plays no video (its content rules have no media source), so a video opens in the
  // computer's own player.
  function fillVideo(view, item, box, name, how) {
    const open = action('Play on this PC', () => native.fs?.openOnPc?.(item.file));
    native.made
      .check(view.state.paneId, item.file, item.since)
      .then(found => {
        const body = make('div', 'tnt-made-pbody tnt-made-video');
        body.innerHTML = icon('play', 22);
        body.append(
          make(
            'p',
            'tnt-made-none',
            found?.ok
              ? 'A video of ' + sizeWords(found.size) + '. It plays in your own video player.'
              : 'This file is no longer there.'
          )
        );
        box.replaceChildren(previewTop(name, how, found?.ok ? [open] : []), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  const sizeWords = bytes =>
    bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';

  function fillText(view, item, box, name, how) {
    const label = item.kind === 'data' ? 'Open the data' : 'Open in Files';
    const open = action(label, () => {
      window.TnaiThreadSide?.open?.('files');
      window.TnaiThreadSide?.showFile?.(item.file);
    });
    native.made
      .text(view.state.paneId, item.file)
      .then(found => {
        const body = make('div', 'tnt-made-pbody');
        if (!found?.ok) body.append(make('p', 'tnt-made-none', 'This file is no longer there.'));
        else if (item.kind === 'data') body.append(dataView(found.text, name));
        else {
          const page = make('div', 'tnt-made-doc');
          const markdown = window.TnaiResults?.markdown;
          if (/\.(md|markdown)$/i.test(name) && typeof markdown === 'function')
            page.innerHTML = markdown(found.text);
          else page.append(make('pre', '', found.text));
          body.append(page);
        }
        box.replaceChildren(previewTop(name, how, found?.ok ? [open] : []), body);
      })
      .catch(() => box.replaceChildren(make('p', 'tnt-made-none', 'This file could not be read.')));
  }

  // ---------- a data file drawn ----------
  const SVG = 'http://www.w3.org/2000/svg';
  const svgNode = (tag, attributes) => {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };

  function dataView(text, name) {
    const table = readTable(text, name);
    if (!table)
      return make('p', 'tnt-made-none', 'Not a table this view can read. Open the data to see it.');
    const chart = chartOf(table);
    if (chart.type === 'table') return tableView(table);
    const holder = make('figure', 'tnt-made-chart');
    const values = chart.values.slice(0, 200);
    const low = Math.min(0, ...values.map(point => point.value));
    const high = Math.max(...values.map(point => point.value), low + 1);
    const width = 600;
    const height = 180;
    const svg = svgNode('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': chart.label + ' of ' + name,
    });
    const yOf = value => height - ((value - low) / (high - low)) * (height - 8);
    if (chart.type === 'bar') {
      const step = width / values.length;
      values.forEach((point, index) => {
        const top = yOf(Math.max(point.value, 0));
        const bottom = yOf(Math.min(point.value, 0));
        const bar = svgNode('rect', {
          x: index * step + step * 0.15,
          y: top,
          width: Math.max(1, step * 0.7),
          height: Math.max(1, bottom - top),
          rx: 3,
        });
        bar.append(svgNode('title', {}));
        bar.firstChild.textContent = point.name + ': ' + point.value;
        svg.append(bar);
      });
    } else {
      const step = width / Math.max(1, values.length - 1);
      const points = values.map((point, index) => index * step + ',' + yOf(point.value)).join(' ');
      svg.append(svgNode('polyline', { points, fill: 'none', 'stroke-width': 2 }));
    }
    const caption = make(
      'figcaption',
      '',
      chart.label + ' · ' + plural(chart.values.length, 'row', 'rows')
    );
    holder.append(svg, caption);
    return holder;
  }

  function tableView(table) {
    const grid = make('table', 'tnt-made-table');
    const headRow = make('tr');
    table.head.slice(0, 8).forEach(name => headRow.append(make('th', '', name)));
    grid.append(headRow);
    table.rows.slice(0, 12).forEach(row => {
      const line = make('tr');
      table.head.slice(0, 8).forEach((_, index) => line.append(make('td', '', row[index] ?? '')));
      grid.append(line);
    });
    return grid;
  }

  // ---------- a site ----------
  // Live preview's own record of an address: its tab, the agent that showed it, and whether the
  // app itself runs the server (a script tab).
  function tabFor(url, paneId) {
    const tabs = safe(() => lp()?.tabs?.() || [], []);
    return (
      tabs.find(tab => tab.url && cleanAddress(tab.url) === url) ||
      tabs.find(
        tab =>
          tab.kind === 'script' && tab.byPane === paneId && tab.url && cleanAddress(tab.url) === url
      ) ||
      null
    );
  }

  const agentName = paneId =>
    safe(
      () => window.TnaiAgents.sessions().find(session => session.paneId === paneId)?.name || '',
      ''
    );

  function siteThumb(view, site) {
    const thumb = pressable('tnt-made-thumb', 'The site at ' + site.url, press =>
      toggle(view, 'site ' + site.url, press, box => fillSite(view, site, box))
    );

    // no still picture of a running site exists, so the card draws a browser's frame with the
    // site's own address in it, never a made-up page
    const picture = make('i', 'tnt-made-tsite');
    const bar = make('span', 'tnt-made-tbar');
    bar.append(make('span', '', shortAddress(site.url)));
    const middle = make('span', 'tnt-made-tmid');
    middle.innerHTML = icon('monitor-play', 22);
    picture.append(bar, middle);
    thumb.dataset.kind = 'site';
    const words = cardWords('Site', '', 'site');
    const state = make('small', '');
    words.querySelector('.tnt-made-wtext').append(state);
    thumb.append(picture, words);
    site.paint = () => paintSiteState(view, site, state);
    site.thumb = thumb;
    drawnSites.add(site);
    site.paint();
    return thumb;
  }

  // running or stopped, asked of the computer once per paint (a press, a change of Live preview)
  function siteRunning(site, paneId) {
    const tab = tabFor(site.url, paneId);
    if (tab?.kind === 'script')
      return Promise.resolve({ running: tab.state === 'running' || tab.state === 'starting', tab });
    return native.made
      .alive(site.url)
      .then(running => ({ running: running === true, tab }))
      .catch(() => ({ running: false, tab }));
  }

  function paintSiteState(view, site, holder) {
    siteRunning(site, view.state.paneId).then(({ running }) => {
      site.running = running;
      const who = agentName(view.state.paneId);
      const dot = make('span', running ? 'tnt-made-live' : 'tnt-made-stopped');
      holder.replaceChildren(
        dot,
        running ? 'running · ' + shortAddress(site.url) + (who ? ' · ' + who : '') : 'stopped'
      );
    });
  }

  const shortAddress = url =>
    String(url)
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

  function fillSite(view, site, box) {
    siteRunning(site, view.state.paneId).then(({ running, tab }) => {
      const who = agentName(view.state.paneId);
      const meta = make('span', 'tnt-made-meta');
      meta.append(
        make('span', running ? 'tnt-made-live' : 'tnt-made-stopped'),
        running ? 'running · ' + shortAddress(site.url) + (who ? ' · ' + who : '') : 'stopped'
      );
      const actions = [];
      const scripts = safe(() => lp()?.scripts?.() || [], []);
      if (running && tab?.kind === 'script')
        actions.push(
          action('Stop it', () =>
            lp()
              .stop(tab.id)
              .then(() => again())
          )
        );
      if (!running && (tab?.kind === 'script' || scripts.length))
        actions.push(
          action('Start it again', () => {
            const id = tab?.kind === 'script' ? tab.id : lp().addScript(scripts[0].name);
            Promise.resolve(lp().start(id)).then(() => again());
          })
        );
      if (running) {
        // 179: the site beside the thread
        const split = splitButton(() => site.url, 'Site');
        if (split) actions.push(split);
        actions.push(action('Open in Live preview', () => toLivePreview(site.url)));
      }
      const body = make('div', 'tnt-made-pbody tnt-made-site');
      body.append(
        make(
          'p',
          'tnt-made-none',
          running
            ? 'It answers at ' + shortAddress(site.url) + '. Open it in Live preview to use it.'
            : scripts.length || tab?.kind === 'script'
              ? 'Nothing answers at ' +
                shortAddress(site.url) +
                ' now. Start it again runs the project’s own ' +
                (tab?.script || scripts[0]?.name || 'dev') +
                ' script.'
              : 'Nothing answers at ' +
                shortAddress(site.url) +
                ' now. The agent can start it again.'
        )
      );
      box.replaceChildren(previewTop('Site', meta, actions), body);
    });
    const again = () => {
      site.paint?.();
      if (view.open === 'site ' + site.url) fillSite(view, site, box);
    };
  }

  function toLivePreview(url) {
    const preview = lp();
    if (!preview) return;
    const added = preview.addUrl(url);
    if (added?.ok && added.id) preview.select(added.id);
    window.TnaiLivePreviewPage?.open?.();
  }

  // ---------- Live preview beside the thread, opened by itself ----------
  let beside = null;
  const besideFor = new Set();

  function openBeside(state, url) {
    const preview = lp();
    const side = window.TnaiThreadSide;
    if (!preview?.mount || !side?.preview) return;
    const added = preview.addUrl(url);
    if (!added?.ok) return;
    preview.select(added.id);
    if (!beside) {
      beside = make('div', 'tnt-made-beside');
      beside.append(make('p', 'tnt-made-beside-note'));
      const host = make('div', 'tnt-made-beside-body');
      beside.append(host);
      preview.mount(host, { browser: true });
    }
    const who = agentName(state.paneId);
    beside.firstChild.textContent =
      shortAddress(url) + ' · opened by itself' + (who ? ' · ' + who + '’s site' : '');
    besideFor.add(url);
    side.preview(beside, true);
  }

  // Live preview's record changed (a server started or stopped): the sites that are drawn say it
  // (a site whose block left the page is let go here)
  lp()?.onChange?.(() => {
    for (const site of drawnSites) {
      if (!site.thumb?.isConnected) drawnSites.delete(site);
      else site.paint?.();
    }
  });

  // ---------- Settings › Agents ----------
  function settingsGroup() {
    const mount =
      document.getElementById('agentsColB') || document.getElementById('settingsPanel-agents');
    if (!mount) return;
    const group = make('section', 'set-group tnt-made-set');
    group.innerHTML =
      '<header class="set-group-head"><div><h3>What agents made</h3><p>Sites, pictures, videos, documents, charts and changes, found from the agent’s own record.</p></div></header>' +
      '<div class="set-card">' +
      '<label class="set-row"><span class="set-text"><b>Show what it made after each task</b><small>In the "Worked for" line that ends a task: what is new, and what changed.</small></span><input type="checkbox" class="set-switch" data-made="show"></label>' +
      '<label class="set-row"><span class="set-text"><b>Open Live preview by itself when an agent starts a site</b><small>Off at first. The site opens beside the thread, marked "opened by itself".</small></span><input type="checkbox" class="set-switch" data-made="autoOpen"></label>' +
      '</div>';
    const sync = () =>
      group.querySelectorAll('[data-made]').forEach(box => {
        box.checked = prefs[box.dataset.made] === true;
      });
    group.addEventListener('change', event => {
      const key = event.target.dataset.made;
      if (!key) return;
      prefs[key] = event.target.checked;
      savePrefs();
      sync();
    });
    sync();
    mount.append(group);
  }
  settingsGroup();

  window.TnaiWhatItMade = {
    note,
    result,

    // 122: the user's prompt begins a new task
    prompt: state => tasks.delete(state),
    block,
    prefs: () => ({ ...prefs }),
    set(patch) {
      for (const key of Object.keys(DEFAULTS)) if (key in patch) prefs[key] = patch[key] === true;
      savePrefs();
    },
    find,
    sitesIn,
    readTable,
    chartOf,
    kindOf,
  };
})();
