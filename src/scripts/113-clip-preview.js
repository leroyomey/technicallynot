/*
 * Technically Not · 113-clip-preview.js — Desktop app only: a snapshot clip
 * (desktop/snapshot-clip.js: <8 hex>-clip.webm plus PNG frames in the attachments folder) shown as
 * a picture instead of a wall of text. window.TnaiClips:
 * - info(text): where the clip named in `text` is (by one of its file names), with its first frame
 * as a picture address; null when it is not on this PC. Asked once per clip.
 * - play(text): the clip in the view-only file window (desktop/file-viewer.js), sized to the clip.
 * The composer's clip chip (27) and a terminal link both use it.
 * - forTerminal(text, agent): the text a terminal panel pastes. For an agent CLI in SHORT (shown by
 * a real run to find and read the frames from it) a clip's line becomes "[Clip: 7 s, 8 frames in
 * order, <first frame> to <last frame's name>]", without the video's path; every other CLI gets the
 * line as it is.
 * - attach(term): in a terminal, a clip's file name is a link (10 calls this for every view).
 * Resting the pointer on it shows the first frame with a play mark (placed by TnaiFloat, never
 * takes the pointer, gone when the pointer leaves); a click plays the clip. Nothing is added to the
 * panel itself. A name the terminal wrapped over two rows is one link; a name a CLI broke itself
 * (its own input box) is not.
 * - latest(term), playLatest(term): xterm links cannot be reached with the keyboard, so the command
 * palette (39) offers "Play the latest clip shown in this terminal" for the terminal the user is in
 * (110's target). No key is added: in a terminal Ctrl+K stays the program's, so the palette is
 * opened from anywhere else (the composer, the top bar's button; Cmd+K on a Mac works in a terminal
 * too).
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.attachments?.clip) return; // browser mode, or an older desktop build

  const NAME = /[0-9a-f]{8}-clip(?:-[0-9]+)?[.](?:mp4|webm|png)/g;
  const idOf = text => (String(text || '').match(NAME) || [''])[0].slice(0, 8);

  const known = new Map(); // clip id -> Promise<{ id, video, frames, still } | null>
  const answered = new Map(); // clip id -> the answer once it is in (latest() must answer at once)

  function info(text) {
    const id = idOf(text);
    if (!id) return Promise.resolve(null);
    if (!known.has(id))
      known.set(
        id,
        Promise.resolve(native.attachments.clip(id + '-clip.webm'))
          .then(
            r => (r && r.video ? r : null),
            () => null
          )
          .then(r => {
            answered.set(id, r);
            return r;
          })
      );
    return known.get(id);
  }

  async function play(text) {
    hide();
    let result;
    try {
      result = await native.attachments.play(String(text || ''));
    } catch (error) {
      result = { ok: false, error };
    }
    if (!result?.ok && typeof toast === 'function')
      toast(result?.error?.message || 'This clip could not be played.');
    return !!result?.ok;
  }

  // The shorter pasted line. SHORT: Claude Code only (2026-10-07: a real run on Haiku named the
  // word on each of three frames from this line). Codex, Cursor Agent and OpenCode keep the full
  // line until a run shows the same for them (Limitations).
  const SHORT = new Set(['Claude Code']);
  const LINE =
    /\[Attached clip: ([0-9]+) s of screen recording as ([0-9]+) frames?(?: in order)?, ([^\r\n\]]+?)(?: to ([^\\\/\r\n\]]+))?; video [^\r\n\]]+\]/g;
  const shorten = text =>
    String(text || '').replace(
      LINE,
      (_all, secs, count, first, last) =>
        '[Clip: ' +
        secs +
        ' s, ' +
        count +
        (last ? ' frames in order, ' + first + ' to ' + last : ' frame, ' + first) +
        ']'
    );
  const forTerminal = (text, agent) => (SHORT.has(agent) ? shorten(text) : String(text || ''));

  // The still over a link: one element per window, shown at the pointer.
  let tip = null;

  function hide() {
    if (!tip) return;
    tip.hidden = true;
    tip.dataset.clip = '';
    window.TnaiFloat?.detach?.(tip);
  }

  function show(clip, event, owner) {
    if (!clip?.still || !event) return;
    const doc = owner?.ownerDocument || document;
    if (!tip || tip.ownerDocument !== doc) {
      tip?.remove();
      tip = doc.createElement('div');
      tip.className = 'tnai-clip-tip';
      tip.hidden = true;
      tip.setAttribute('role', 'tooltip');
      tip.innerHTML =
        '<span class="tnai-clip-still"><img alt=""><span class="tnai-clip-mark">' +
        (window.TnaiIcon?.('play', { size: 18 }) || '') +
        '</span></span><small>Click to play this clip</small>';
      doc.body.append(tip);
    }
    const img = tip.querySelector('img'),
      x = event.clientX,
      y = event.clientY;
    tip.dataset.clip = clip.id;
    const place = () => {
      if (tip.dataset.clip !== clip.id) return; // the pointer left before the picture was read
      tip.hidden = false;
      window.TnaiFloat?.attach(
        {
          contextElement: owner || doc.body,
          getBoundingClientRect: () => ({
            x,
            y,
            left: x,
            top: y,
            right: x,
            bottom: y,
            width: 0,
            height: 0,
          }),
        },
        tip,
        { placement: 'top', offset: 14 }
      );
    };
    if (img.getAttribute('src') === clip.still && img.complete && img.naturalWidth) return place();
    img.onload = place;
    img.onerror = hide;
    img.src = clip.still;
  }

  // The links of one terminal row (1-based, as xterm asks): every clip file name on it whose clip
  // is on this PC. A line the terminal wrapped is read as one (the rows xterm marks isWrapped, up
  // to WRAP_MAX of them), so a name that runs over a row end is one link whose range spans the
  // rows; each of its rows gets the same link when xterm asks for it.
  const WRAP_MAX = 12;

  async function links(term, y) {
    const buf = term.buffer.active;

    // A full-screen CLI that asked for mouse reports gets every click itself (as 75).
    if (buf.type !== 'normal' && term.modes.mouseTrackingMode !== 'none') return [];
    if (!buf.getLine(y - 1)) return [];
    let first = y - 1,
      last = y - 1;
    while (first > 0 && y - 1 - first < WRAP_MAX && buf.getLine(first)?.isWrapped) first--;
    while (last - (y - 1) < WRAP_MAX && buf.getLine(last + 1)?.isWrapped) last++;
    let text = '';
    const at = [],
      cell = buf.getNullCell();
    for (let r = first; r <= last; r++) {
      const row = buf.getLine(r),
        cells = [];
      for (let x = 0; x < term.cols; x++) {
        const c = row.getCell(x, cell);
        if (!c || !c.getWidth()) continue;
        cells.push({ ch: c.getChars(), x: x + 1 });
      }

      // cells never written at the end of a row that goes on below
      if (r < last) while (cells.length && !cells[cells.length - 1].ch) cells.pop();
      for (const c of cells) {
        const ch = c.ch || ' ';
        for (let k = 0; k < ch.length; k++) {
          text += ch[k];
          at.push({ x: c.x, y: r + 1 });
        }
      }
    }
    const out = [];
    for (const m of text.matchAll(NAME)) {
      const start = at[m.index],
        end = at[m.index + m[0].length - 1];
      if (y < start.y || y > end.y) continue; // on another row of this line
      const clip = await info(m[0]);
      if (!clip) continue;
      out.push({
        range: { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } },
        text: m[0],
        decorations: { pointerCursor: true, underline: true },
        hover: event => show(clip, event, term.element),
        leave: hide,
        activate: () => {
          play(m[0]);
        },
      });
    }
    return out;
  }

  // Without the mouse: the command palette (39) lists "Play the latest clip shown in this terminal"
  // for the terminal the user is in when one is named in it. latest(term): the file name of the
  // newest clip in the terminal's text (bottom up, wrapped rows joined, the last LOOK rows), ''
  // when there is none. It answers at once, so a clip not asked about yet counts (it is asked now,
  // and play() says so if it is gone); one known to be gone does not.
  const LOOK = 2000;

  function latest(term) {
    const buf = term?.buffer?.active;
    if (!buf) return '';
    for (let y = buf.length - 1; y >= 0 && buf.length - y <= LOOK; y--) {
      let text = buf.getLine(y)?.translateToString(true) || '',
        first = y;
      while (first > 0 && y - first < WRAP_MAX && buf.getLine(first)?.isWrapped) {
        first--;
        text = (buf.getLine(first)?.translateToString(false) || '') + text;
      }
      y = first;
      const names = text.match(NAME) || [];
      for (let i = names.length - 1; i >= 0; i--) {
        const id = names[i].slice(0, 8);
        if (!answered.has(id)) info(names[i]);
        if (answered.get(id) !== null) return names[i];
      }
    }
    return '';
  }
  const playLatest = term => {
    const name = latest(term);
    return name ? play(name) : Promise.resolve(false);
  };

  function attach(term) {
    term.registerLinkProvider({
      provideLinks(y, callback) {
        links(term, y).then(
          list => callback(list.length ? list : undefined),
          () => callback(undefined)
        );
      },
    });
  }

  window.TnaiClips = {
    info,
    play,
    idOf,
    shorten,
    forTerminal,
    attach,
    links,
    latest,
    playLatest,
    tip: () => tip,
    hide,
  };
})();
