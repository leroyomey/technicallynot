/*
 * Technically Not · 27-composer-attachments.js — Desktop app only: the composer's ＋ (upload an
 * image or file, paste a screenshot, drop files). Chips show a thumbnail, name, size and ×. On send
 * (11 dispatch) uploads are saved in Technically Not's own folder (desktop/attachment-service.js)
 * and referenced on the same line, e.g. " [Attached image: C:\…\shot.png] [Attached file:
 * src/app.js]". beginSend() clears the chips the instant send happens (same moment as the prompt
 * text), keeping the data to save/send; prepare(list) then does the actual save. Also handles long
 * pasted plain text: it collapses to a placeholder token, e.g. "[Pasted text #1 +42 lines]", kept
 * in memory keyed by its number; 11 dispatch expands each token to <pasted_text
 * n="…">…</pasted_text> for the agent while the collapsed token stays the recorded task title.
 * Exposes window.TnaiAttachments and window.TnaiPastedText.
 */
// @N references (pure, also loaded in browser mode for tests): "@1 make it blue @2 remove this"
// puts each instruction with its attachment (N = the chip number). window.TnaiShotRefs = { tokens,
// organize, renumber }.
(() => {
  // "@N" at the start or after a space/bracket/quote, not followed by more of a word/path ("@1."
  // ends a sentence, "@1.5" is not a ref).
  const RE = /(^|[\s(\[{"'“‘,;])@(\d{1,2})(?!\w|[.\-/\\]\w)/g;

  function tokens(text) {
    text = String(text || '');
    const masked = [...text.matchAll(/<pasted_text\b[\s\S]*?<\/pasted_text>/g)].map(m => [
      m.index,
      m.index + m[0].length,
    ]); // pasted content is never parsed
    return [...text.matchAll(RE)]
      .map(m => {
        const start = m.index + m[1].length;
        return { start, end: start + 1 + m[2].length, n: +m[2] };
      })
      .filter(t => !masked.some(([a, b]) => t.start >= a && t.start < b));
  }

  // shots: [{ n, ref: "[Attached image: …]", image }] in chip order; tail: text appended after the
  // general part (" [Mentioned file: …]"). Returns null when the text has no @N for an existing
  // attachment (the caller then sends as before); an unknown @N stays literal text.
  function organize(text, shots, tail = '') {
    text = String(text || '');
    shots = shots || [];
    const byN = new Map(shots.map(s => [s.n, s])),
      refs = tokens(text).filter(t => byN.has(t.n));
    if (!refs.length) return null;
    const sections = new Map();
    refs.forEach((t, i) => {
      const seg = text
        .slice(t.end, refs[i + 1]?.start ?? text.length)
        .replace(/^[\s:,;\-–—]+/, '')
        .trim();
      if (!sections.has(t.n)) sections.set(t.n, []);
      if (seg) sections.get(t.n).push(seg);
    });

    // attachments with no @N: appended as before
    const leftover = shots.filter(s => !sections.has(s.n)).map(s => s.ref);
    const head = (
      [text.slice(0, refs[0].start).trim(), ...leftover].filter(Boolean).join(' ') + (tail || '')
    ).trim();
    const parts = head ? [head] : [];
    [...sections.keys()]
      .sort((a, b) => a - b)
      .forEach(n => {
        const s = byN.get(n);
        parts.push(
          (s.image ? 'Screenshot ' : 'Attachment ') +
            n +
            ' — ' +
            s.ref +
            '\n' +
            (sections.get(n).join('\n') || '(no specific instructions)')
        );
      });
    return parts.join('\n\n');
  }

  // Attachment `removed` (1-based) left: its @N becomes "(removed attachment)", higher @N shift
  // down to follow their chips.
  function renumber(text, removed) {
    let out = String(text || '');
    tokens(out)
      .reverse()
      .forEach(t => {
        if (t.n < removed) return;
        out =
          out.slice(0, t.start) +
          (t.n === removed ? '(removed attachment)' : '@' + (t.n - 1)) +
          out.slice(t.end);
      });
    return out;
  }

  // `by` attachments were put back ahead of the current ones (a failed send): every @N moves up by
  // `by` to follow its chip.
  function shift(text, by) {
    let out = String(text || '');
    tokens(out)
      .reverse()
      .forEach(t => {
        out = out.slice(0, t.start) + '@' + (t.n + by) + out.slice(t.end);
      });
    return out;
  }
  window.TnaiShotRefs = { tokens, organize, renumber, shift };
})();
(() => {
  const native = window.tnaiNative;
  const button = document.getElementById('attachFiles'),
    input = document.getElementById('attachmentInput'),
    list = document.getElementById('attachmentList');
  const box = document.querySelector('.composebox'),
    prompt = document.getElementById('prompt');

  // browser mode: ＋ stays disabled (12-inactive-ui.js)
  if (!native?.attachments || !button || !input || !list || !box) return;

  const MAX_COUNT = 8,
    MAX_BYTES = 20 * 1024 * 1024;
  const IMAGE = /\.(png|jpe?g|gif|webp)$/i,
    VIDEO = /\.(webm|mp4)$/i;
  const TEXT =
    /\.(pdf|txt|md|markdown|json|csv|tsv|log|xml|ya?ml|toml|ini|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|cs|cpp|cc|c|h|hpp|php|sh|ps1|bat|sql|swift|vue|svelte)$/i;
  const MIME_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const size = bytes =>
    bytes < 1024
      ? bytes + ' B'
      : bytes < 1048576
        ? Math.round(bytes / 1024) + ' KB'
        : (bytes / 1048576).toFixed(1) + ' MB';

  // Items: { id, kind: 'image'|'file', name, size, file (upload), url (thumbnail), saved (absolute
  // path once saved) }.
  let items = [],
    seq = 0;

  // Pasted screenshots get the saved file a short unique time-based name, but the chip shows an
  // even shorter "Screenshot N" label so the chip stays narrow; N is the chip number (the same N as
  // "@N" in the prompt), so it follows removals. The full saved name is still in the chip's title
  // tooltip. clipLine: the clipboard's text when files are pasted. A Technically Not clip
  // (desktop/snapshot-service.js) is on the clipboard as its video file plus one line naming that
  // video and its frames; the video becomes a chip and the line is what the agent gets (it reads
  // the frames).
  function add(fileList, source = 'upload', clipLine = '') {
    const refused = [];
    for (let file of [...fileList]) {
      let name = file.name || '';
      let label = '',
        shot = false;
      if (
        source === 'paste' &&
        VIDEO.test(name) &&
        /^\[Attached clip: [^\r\n]+\]$/.test(clipLine) &&
        clipLine.includes(name)
      ) {
        if (items.length >= MAX_COUNT) {
          refused.push(name + ' (at most ' + MAX_COUNT + ' attachments)');
          continue;
        }
        clipItem(name, file.size, clipLine);
        continue;
      }
      if (!/\.\w+$/.test(name) && MIME_EXT[file.type])
        name = (name || 'image') + MIME_EXT[file.type];
      if (source === 'paste' && /^image\.\w+$/i.test(name)) {
        name = 'shot-' + new Date().toTimeString().slice(0, 8).replace(/:/g, '') + name.slice(5);
        shot = true;

        // for a refusal message; the chip computes its own (labelOf)
        label = 'Screenshot ' + (items.length + 1);
      }
      if (items.length >= MAX_COUNT) {
        refused.push((label || name) + ' (at most ' + MAX_COUNT + ' attachments)');
        continue;
      }
      if (!IMAGE.test(name) && !TEXT.test(name)) {
        refused.push((label || name) + ' (only images, PDFs, and text or code files)');
        continue;
      }
      if (file.size > MAX_BYTES) {
        refused.push((label || name) + ' (larger than 20 MB)');
        continue;
      }
      if (!file.size) {
        refused.push((label || name) + ' (empty)');
        continue;
      }
      const image = IMAGE.test(name);
      items.push({
        id: 'a' + ++seq,
        kind: image ? 'image' : 'file',
        name,
        shot,
        size: file.size,
        file,
        url: image ? URL.createObjectURL(file) : '',
      });
    }
    render();
    if (refused.length) say('Not attached: ' + refused.join('; '));
    return refused.length === 0;
  }

  // A pasted clip: one chip with its first frame and a play mark (the frame is asked from the main
  // process once, 113), its length from the line.
  function clipItem(name, bytes, line) {
    const item = {
      id: 'a' + ++seq,
      kind: 'clip',
      name,
      shot: false,
      size: bytes,
      url: '',
      ref: line,
      secs: Number(/: ([0-9]+) s /.exec(line)?.[1]) || 0,
    };
    items.push(item);
    window.TnaiClips?.info(line).then(clip => {
      if (clip?.still && !item.url) {
        item.url = clip.still;
        if (items.includes(item)) render();
      }
    });
  }

  // The clip's line pasted as text (no video file on the clipboard: PowerShell could not copy it,
  // or not Windows): the same chip instead of the line in the prompt.
  function addClipLine(line) {
    const name = /([0-9a-f]{8}-clip[.]webm)[\]]$/.exec(line)?.[1];
    if (!name) return false;
    if (items.length >= MAX_COUNT)
      say('Not attached: ' + name + ' (at most ' + MAX_COUNT + ' attachments)');
    else {
      clipItem(name, 0, line);
      render();
    }
    return true;
  }
  const labelOf = (item, i) =>
    item.shot ? 'Screenshot ' + (i + 1) : item.kind === 'clip' ? 'Clip ' + (i + 1) : item.name;

  function remove(id) {
    const at = items.findIndex(i => i.id === id),
      item = items[at];
    if (item?.url) URL.revokeObjectURL(item.url);
    items = items.filter(i => i.id !== id);
    render();

    // The chips renumber, so "@N" in the draft follows them (window.TnaiShotRefs above).
    if (at >= 0 && prompt && window.TnaiShotRefs) {
      const before = prompt.value,
        next = window.TnaiShotRefs.renumber(before, at + 1);
      if (next !== before) {
        const c = Math.max(
          0,
          (prompt.selectionStart ?? before.length) + next.length - before.length
        );
        prompt.value = next;
        prompt.setSelectionRange(c, c);
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  function clear() {
    items.forEach(i => i.url && URL.revokeObjectURL(i.url));
    items = [];
    render();
  }

  // On send: the chips must disappear the same instant the prompt text does (11 dispatch clears
  // both together), not only after the attachments are saved/sent. This hides them immediately but
  // keeps the data for prepare(); commit() (send succeeded) revokes the thumbnail URLs, restore()
  // (send failed) puts the chips back. inFlight: ids of attachments being sent (hidden, not
  // removed), so 68's per-attachment notes survive until apply() reads them.
  const inFlight = new Set();

  function beginSend() {
    const snapshot = items;
    items = [];
    snapshot.forEach(i => inFlight.add(i.id));
    render();
    let settled = false;
    const settle = () => {
      settled = true;
      snapshot.forEach(i => inFlight.delete(i.id));
    };
    return {
      items: snapshot,
      commit() {
        if (settled) return;
        settle();
        snapshot.forEach(i => i.url && URL.revokeObjectURL(i.url));
      },
      restore() {
        if (settled) return;
        settle();
        putBack(snapshot);
      },
    };
  }

  // A failed send's chips come back first (they were attached first, and the draft 11 puts back
  // numbers them @1…), then the ones attached meanwhile; like add(), past MAX_COUNT the latest
  // arrivals are refused with the same message. A new draft typed meanwhile keeps pointing at its
  // chips: its @N shift up (or read "(removed attachment)" if refused).
  function putBack(snapshot) {
    const fit = Math.max(0, MAX_COUNT - snapshot.length),
      dropped = items.slice(fit);
    dropped.forEach(i => i.url && URL.revokeObjectURL(i.url));
    const labels = dropped.map((item, j) => labelOf(item, snapshot.length + fit + j));
    items = snapshot.concat(items.slice(0, fit));
    render();
    if (prompt && window.TnaiShotRefs && snapshot.length) {
      const before = prompt.value;
      let next = before;
      for (let n = fit + dropped.length; n > fit; n--) next = window.TnaiShotRefs.renumber(next, n);
      next = window.TnaiShotRefs.shift(next, snapshot.length);
      if (next !== before) {
        const c = Math.max(
          0,
          (prompt.selectionStart ?? before.length) + next.length - before.length
        );
        prompt.value = next;
        prompt.setSelectionRange(c, c);
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (labels.length)
      say(
        'Not attached: ' +
          labels.map(l => l + ' (at most ' + MAX_COUNT + ' attachments)').join('; ')
      );
  }

  function render() {
    list.replaceChildren(
      ...items.map((item, i) => {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        chip.dataset.id = item.id;
        chip.dataset.kind = item.kind;
        const clip = item.kind === 'clip',
          about = clip
            ? item.secs
              ? item.secs + ' s'
              : item.size
                ? size(item.size)
                : ''
            : size(item.size);
        chip.title =
          i +
          1 +
          '. ' +
          item.name +
          (about ? ' · ' + about : '') +
          (clip ? ' · click to play' : '');

        // Numbered in send order, so "screenshot 2" in the prompt matches the second attachment the
        // agent gets.
        const num = document.createElement('b');
        num.className = 'attachment-num';
        num.textContent = i + 1;
        chip.append(num);
        if (clip) {
          // The picture is the play button: Enter or a click plays the clip in the view-only file
          // window (113). A clip whose frame is not known shows the mark alone.
          const play = document.createElement('button');
          play.type = 'button';
          play.className = 'attachment-play';
          play.setAttribute('aria-label', 'Play ' + labelOf(item, i));
          if (item.url) {
            const img = document.createElement('img');
            img.src = item.url;
            img.alt = '';
            play.append(img);
          }
          play.insertAdjacentHTML('beforeend', window.TnaiIcon?.('play', { size: 14 }) || '');
          chip.addEventListener('click', event => {
            event.stopPropagation();
            window.TnaiClips?.play(item.ref);
          });
          chip.append(play);
        } else if (item.url) {
          const img = document.createElement('img');
          img.src = item.url;
          img.alt = '';
          chip.append(img);
        } else {
          const icon = document.createElement('i');
          icon.textContent = '▤';
          chip.append(icon);
        }

        // Pasted screenshots show a short "Screenshot N" label instead of their long saved file
        // name; the full name is in the title above.
        const name = document.createElement('span');
        name.className = 'attachment-name';
        name.textContent = labelOf(item, i);
        const meta = document.createElement('small');
        meta.textContent = about;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'attachment-remove';
        x.textContent = '×';
        x.title = 'Remove ' + item.name;
        x.addEventListener('click', event => {
          event.stopPropagation();
          remove(item.id);
        });
        chip.append(name, meta, x);
        return chip;
      })
    );
    box.classList.toggle('has-attachments', items.length > 0);
  }

  // On send: saves uploads (once; a failed send keeps them saved) and returns the single-line
  // reference text. Takes the snapshot from beginSend() — items already left the visible list by
  // the time this runs.
  async function prepare(list) {
    const refs = [];
    for (const item of list) {
      if (item.ref) {
        refs.push(item.ref);
        continue;
      } // a pasted clip: already saved, its line names the video and frames
      if (!item.saved) {
        let result;
        try {
          result = await native.attachments.save(item.name, await item.file.arrayBuffer());
        } catch (error) {
          result = { ok: false, error };
        }
        if (!result?.ok)
          return {
            error:
              'Could not save ' + item.name + ': ' + (result?.error?.message || 'unknown error'),
          };
        item.saved = result.value;
      }
      refs.push(
        '[Attached ' + (item.kind === 'image' ? 'image' : 'file') + ': ' + item.saved + ']'
      );
    }

    // shots ({ n: chip number, ref, image }) feed window.TnaiShotRefs.organize when the prompt uses
    // @N.
    const flat = refs.map(r => r.replace(/[\r\n]+/g, ' '));
    return {
      refs: flat.length ? ' ' + flat.join(' ') : '',
      shots: flat.map((ref, i) => ({ n: i + 1, ref, image: list[i].kind === 'image' })),
    };
  }

  // ---- for an agent on another computer
  // (desktop/remote-files.js holds the rules and checks again) ---- Pictures are made small here,
  // in the page, never in the main process: drawn on a canvas and written as JPEG, long side at
  // most 1,568, until at most about 120 KB (three qualities at each size, then the next smaller
  // size). A text file goes as it is when it is plain text of at most 64 KB without characters
  // nobody can see. Anything else is refused with the reason. Nothing is sent here: 11 shows
  // `words` first and sends at the next Enter. → { ok: true, files: [{ kind: 'jpg' | 'txt', bytes:
  // ArrayBuffer }], words, sig } | { ok: false, words }.
  const FAR_PICTURE = 120 * 1024,
    FAR_TEXT = 64 * 1024,
    FAR_TOTAL = 300 * 1024,
    FAR_COUNT = 3;

  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    try {
      let lastW = 0;
      for (const side of [1568, 1280, 1024, 800, 640, 480]) {
        const k = Math.min(1, side / Math.max(bmp.width, bmp.height)),
          w = Math.max(1, Math.round(bmp.width * k)),
          h = Math.max(1, Math.round(bmp.height * k));
        if (w === lastW) continue;
        lastW = w; // a picture smaller than this step: already tried at its own size
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.fillStyle = 'white';
        g.fillRect(0, 0, w, h);
        g.drawImage(bmp, 0, 0, w, h); // JPEG has no see-through: white under it
        for (const q of [0.86, 0.72, 0.58]) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', q));
          if (blob && blob.size <= FAR_PICTURE) return blob;
        }
      }
    } finally {
      bmp.close?.();
    }
    return null;
  }

  // The canvas's JPEG holds more than the other computer takes: Chromium adds a color profile (an
  // APP2 segment; seen in the first window run, 2026-10-10). Kept are only the segments
  // desktop/remote-files.js checkJpeg allows: start, APP0, the tables, the frame header, restart
  // interval, the scans, end. Every other APPn and a comment are dropped. The picture's own bytes
  // are not touched and nothing is decoded; the canvas is sRGB, which is what a picture without a
  // profile is read as. The check on both computers stays as strict as it was: this makes what is
  // sent plain, it does not widen what is taken. b: Uint8Array. → the bytes to send, or null when
  // this is not a JPEG that can be walked (it is then sent as it is and refused).
  function plainJpeg(b) {
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    const keep = [b.subarray(0, 2)];
    let o = 2;
    for (;;) {
      if (o + 2 > b.length || b[o] !== 0xff) return null;
      const m = b[o + 1];
      if (m === 0xd9) {
        keep.push(b.subarray(o, o + 2));
        break;
      } // the end: nothing after it is kept
      if (o + 4 > b.length) return null;
      const end = o + 2 + ((b[o + 2] << 8) | b[o + 3]);
      if (end < o + 4 || end > b.length) return null;
      let stop = end;
      if (m === 0xda) {
        // a scan: its own bytes run to the next mark; FF 00 and the restart marks are part of them
        while (stop + 1 < b.length) {
          if (b[stop] !== 0xff) {
            stop++;
            continue;
          }
          const x = b[stop + 1];
          if (x === 0x00 || (x >= 0xd0 && x <= 0xd7)) {
            stop += 2;
            continue;
          }
          if (x === 0xff) {
            stop++;
            continue;
          }
          break;
        }
      }
      if (
        m === 0xe0 ||
        m === 0xdb ||
        m === 0xc0 ||
        m === 0xc2 ||
        m === 0xc4 ||
        m === 0xdd ||
        m === 0xda
      )
        keep.push(b.subarray(o, stop));

      // not a segment this may drop: left whole for the strict check to refuse
      else if (!((m >= 0xe1 && m <= 0xef) || m === 0xfe)) return null;
      o = stop;
    }
    const out = new Uint8Array(keep.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of keep) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  } // end plainJpeg

  function textWhy(buf) {
    let s;
    try {
      s = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
    } catch {
      return 'is not a picture or a plain text file';
    }
    const body = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
    if (!body.trim()) return 'is empty';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(body))
      return 'is not a picture or a plain text file';
    if (/[\u{E0000}-\u{E007F}]/u.test(body) || /(?![\u200c\u200d])\p{Cf}/u.test(body))
      return 'holds characters nobody can see'; // hidden marks or text-direction marks
    return '';
  }

  async function forRemote() {
    // The toast shows one line for two seconds: the reason comes first and stays short (window run
    // 1: the longer wording was cut off).
    const list = items.slice(),
      no = why => ({ ok: false, words: 'Not sent: ' + why + '. Your prompt is still in the box.' });
    if (list.length > FAR_COUNT)
      return no('at most 3 attachments go with one prompt to another computer');
    const files = [],
      parts = [];
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i],
        label = labelOf(item, i);
      if (item.kind === 'clip' || !item.file)
        return no(label + ' is a screen recording, which does not go to another computer');
      if (!item.far) {
        // made once for a chip: the second Enter sends exactly what the first one described
        if (item.kind === 'image') {
          let blob = null;
          try {
            blob = await shrink(item.file);
          } catch {
            blob = null;
          }
          if (!blob) return no(label + ' could not be made small enough (120 KB)');
          const raw = await blob.arrayBuffer(),
            plain = plainJpeg(new Uint8Array(raw));
          item.far = { kind: 'jpg', bytes: plain ? plain.buffer : raw };
        } else {
          if (item.file.size > FAR_TEXT) return no(label + ' is larger than 64 KB');
          const buf = await item.file.arrayBuffer(),
            why = textWhy(buf);
          if (why) return no(label + ' ' + why);
          item.far = { kind: 'txt', bytes: buf };
        }
      }
      files.push({ kind: item.far.kind, bytes: item.far.bytes });
      total += item.far.bytes.byteLength;
      parts.push(
        (item.far.kind === 'txt' ? 'the text file ' : 'the picture ') +
          label +
          ' (' +
          size(item.far.bytes.byteLength) +
          ')'
      );
    }
    if (total > FAR_TOTAL) return no('together the attachments are over 300 KB');

    // 3,000 bytes a piece, 40 pieces a minute
    const secs = Math.max(2, Math.round(Math.ceil(total / 3000) * 1.5));

    // words: how many, how big as sent, about how long: short, because the toast shows one line
    // (each file's name is on its chip).
    return {
      ok: true,
      files,
      words:
        files.length +
        (files.length === 1 ? ' file' : ' files') +
        ' (' +
        size(total) +
        ', about ' +
        (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s') +
        ')',
      each: parts,
      sig: list.map(x => x.id + ':' + x.far.bytes.byteLength).join(','),
    };
  }

  // ＋ menu.
  let menu = null;

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  // The menu opens in whichever window holds the composer (Technically Not's, or its pop-out from
  // 38), with close-on-outside-click/Esc there.
  const watched = new WeakSet();

  function watch(doc) {
    if (watched.has(doc)) return;
    watched.add(doc);
    doc.addEventListener(
      'pointerdown',
      event => {
        if (menu && !menu.contains(event.target) && event.target !== button) closeMenu();
      },
      true
    );
    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu) closeMenu();
    });
  }

  function openMenu() {
    closeMenu();
    const doc = button.ownerDocument;
    watch(doc);
    menu = doc.createElement('div');
    menu.className = 'tnai-attach-menu';
    menu.setAttribute('role', 'menu');
    const item = (label, action, disabled, tip) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = !!disabled;
      if (tip) b.title = tip;
      b.addEventListener('click', () => {
        closeMenu();
        action();
      });
      menu.append(b);
    };
    item('Upload image or file…', () => input.click());
    const hint = doc.createElement('p');
    hint.textContent =
      'Screenshots: paste with ' +
      window.tnaiKeys('Ctrl+V') +
      ' or drop them on the prompt. Up to 8 files, 20 MB each.';
    menu.append(hint);
    doc.body.append(menu);

    // Above the ＋ when it fits, else below it: TnaiFloat (100) flips and keeps it placed (also when
    // 38 grows a short pop-out).
    menu.style.overflow = 'auto';
    window.TnaiFloat?.attach(button, menu, { placement: 'top-start' });
  }
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    menu ? closeMenu() : openMenu();
  });
  watch(document);
  input.addEventListener('change', () => {
    if (input.files.length) add(input.files);
    input.value = '';
  });

  // Paste (clipboard images/files) into the prompt, and drop onto the composer. A long plain-text
  // paste collapses to a placeholder token instead of filling the composer; the full text is kept
  // in memory keyed by the token's number (window.TnaiPastedText, used by 11 dispatch to expand it
  // back for the agent).
  const PASTE_CHAR_LIMIT = 800,
    PASTE_LINE_LIMIT = 8;
  let pasted = {},
    pastedSeq = 0;

  function pasteToken(n, lines) {
    return '[Pasted text #' + n + ' +' + lines + ' line' + (lines === 1 ? '' : 's') + ']';
  }

  function insertPastedText(text, lines) {
    const n = ++pastedSeq,
      token = pasteToken(n, lines);
    pasted[n] = { text, token };
    const start = prompt.selectionStart ?? prompt.value.length,
      end = prompt.selectionEnd ?? prompt.value.length;
    prompt.value = prompt.value.slice(0, start) + token + prompt.value.slice(end);
    const caret = start + token.length;
    prompt.setSelectionRange(caret, caret);
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Deleting a token drops its stored text; an empty draft resets the numbering for the next one.
  prompt?.addEventListener('input', () => {
    for (const n of Object.keys(pasted))
      if (!prompt.value.includes(pasted[n].token)) delete pasted[n];
    if (!Object.keys(pasted).length) pastedSeq = 0;
  });

  // A token is one unit: Backspace/Delete touching it (or inside it) first selects the whole token,
  // and only the next press deletes it, so one stray key never breaks a token and silently drops
  // its pasted text.
  prompt?.addEventListener('keydown', event => {
    if (
      (event.key !== 'Backspace' && event.key !== 'Delete') ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    )
      return;
    const a = prompt.selectionStart,
      b = prompt.selectionEnd,
      v = prompt.value;
    for (const { token } of Object.values(pasted)) {
      for (let at = v.indexOf(token); at >= 0; at = v.indexOf(token, at + 1)) {
        const end = at + token.length;
        if (a === at && b === end) return; // already selected: this press deletes it
        const touches =
          a === b
            ? event.key === 'Backspace'
              ? a > at && a <= end
              : a >= at && a < end
            : a < end && b > at;
        if (touches) {
          event.preventDefault();
          prompt.setSelectionRange(at, end);
          return;
        }
      }
    }
  });

  // Every paste in the app is told to the main process (desktop/attachment-service.js): a snapshot
  // clip it names, by its line or by its pasted video file, is in use from then on and kept; a clip
  // that was never pasted is deleted there once the clipboard no longer names it. Only a clip's own
  // line or file name crosses, never the pasted text. `TnaiAttachments.pasted(text)` is also called
  // by a terminal panel's paste (10).
  const clipPasted = text => {
    try {
      native.attachments.pasted?.(
        (
          String(text || '').match(/\[Attached clip: [^\r\n]+\]|[0-9a-f]{8}-clip\.webm/g) || []
        ).join('\n')
      );
    } catch {}
  };
  const pastedHere = event =>
    clipPasted(
      [
        event.clipboardData?.getData('text/plain') || '',
        ...[...(event.clipboardData?.files || [])].map(f => f.name || ''),
      ].join('\n')
    );
  document.addEventListener('paste', pastedHere, true);
  prompt?.addEventListener('paste', event => {
    if (prompt.ownerDocument !== document) pastedHere(event);
  }); // the composer in its pop-out (38)
  prompt?.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) {
      // The new chip narrows the prompt; keep the caret, selection and scroll exactly where the
      // user was typing.
      event.preventDefault();
      const { selectionStart: a, selectionEnd: b, selectionDirection: dir, scrollTop } = prompt;
      const keep = () => {
        if (prompt.ownerDocument.activeElement !== prompt) prompt.focus({ preventScroll: true });
        prompt.setSelectionRange(a, b, dir);
        prompt.scrollTop = scrollTop;
      };

      // A paste that holds files carries no text (Chromium leaves it out), so a clip's line is read
      // from the clipboard itself.
      const reader = files.some(f => VIDEO.test(f.name || ''))
        ? prompt.ownerDocument.defaultView?.navigator.clipboard
        : null;
      if (reader?.readText)
        reader
          .readText()
          .catch(() => '')
          .then(line => {
            add(files, 'paste', String(line || '').trim());
            keep();
          });
      else add(files, 'paste');
      keep();
      requestAnimationFrame(keep);
      return;
    }
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    if (/^[\[]Attached clip: [^\r\n]+[\]]$/.test(text.trim()) && addClipLine(text.trim())) {
      event.preventDefault();
      return;
    }
    const lines = text.split(/\r\n|\r|\n/).length;

    // short paste: default insertion
    if (text.length <= PASTE_CHAR_LIMIT && lines <= PASTE_LINE_LIMIT) return;
    const eol = s =>
      String(s || '')
        .replace(/\r\n?/g, '\n')
        .trimEnd();

    // copied from a Technically Not terminal (10): paste it plain
    if (window.TnaiTerminalCopy && eol(text) === eol(window.TnaiTerminalCopy)) return;
    event.preventDefault();
    insertPastedText(text, lines);
  });

  // Expands every placeholder token in `text` to its full pasted content, delimited so the agent
  // knows it is pasted content; a token with no stored text (e.g. a restored draft after a restart)
  // is left as-is.
  function expandPastedText(text) {
    if (!text) return text;
    for (const n of Object.keys(pasted)) {
      const entry = pasted[n];
      if (text.includes(entry.token))
        text = text
          .split(entry.token)
          .join('<pasted_text n="' + n + '">' + entry.text + '</pasted_text>');
    }
    return text;
  }
  window.TnaiPastedText = { expand: expandPastedText, count: () => Object.keys(pasted).length };
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  box.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    box.classList.add('drop-target');
  });
  box.addEventListener('dragleave', event => {
    if (!box.contains(event.relatedTarget)) box.classList.remove('drop-target');
  });
  box.addEventListener('drop', event => {
    box.classList.remove('drop-target');
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    add(event.dataTransfer.files, 'drop');
  });

  window.TnaiAttachments = {
    add,
    remove,
    clear,
    prepare,
    beginSend,
    forRemote,
    pasted: clipPasted,
    sending: id => inFlight.has(id),
    count: () => items.length,
    list: () =>
      items.map((item, i) => ({
        id: item.id,
        n: i + 1,
        kind: item.kind,
        name: item.name,
        label: labelOf(item, i),
        size: item.size,
        path: item.path,
        saved: item.saved,
      })),
  };
})();
