/*
 * Technically Not · 109-fit-rows.js — Nothing half-shown in a row of controls
 * (the context label was cut in a terminal panel
 * header about 500 px wide, once "in preview", a shell count and the Skills group shared the row).
 * The header's step-downs are widths written by hand (11-terminal-purple.css: 560, 470, 390, 280
 * px), right for the items it had then; every item added since can overflow it. This is the net
 * under them: when a watched row's content does not fit, its items leave whole, lowest rank first,
 * until it fits, and come back when there is room. A small "⋯" mark then sits before the status,
 * and its tip lists what is out, so nothing is lost (the status tip already carries the context,
 * 10). Where a row fits, nothing here changes anything. Rows: the terminal panel header
 * (.terminal-pane-head). Order of leaving: context label, the "in preview" mark, the shell count,
 * the Skills group, then the status text (its dot stays). The name, the avatar, the connection and
 * the status dot never leave; the name may end in "…" as before. No timer: one ResizeObserver and
 * one MutationObserver per row, both silent unless its size or content changes, and one pass per
 * animation frame. The buttons shown on hover are fitted the same way (TOOLS below).
 * `window.TnaiFit` (`scan`, `fit(row)`, `out(row)`, `folded(row)`, `unranked(row)`). Look:
 * 11-terminal-purple.css. Test `header-fit`.
 */
(() => {
  const SLACK = 1;

  // Highest first: what leaves first. `el` finds the item in the row; `cls` is a class on the row
  // that a style rule answers to.
  const STEPS = [
    {
      name: 'context',
      el: row => row.querySelector(':scope>.terminal-context-state'),
      text: el => el.textContent.trim(),
    },
    {
      name: 'in preview',
      cls: 'tnai-fit-nomark',
      on: row => !!row.closest('#terminalView.tp-on .terminal-pane.tp-owner'),
      text: () => 'in preview',
    },
    {
      name: 'shells',
      el: row => row.querySelector(':scope>.tnai-bg-chip'),
      text: el => el.textContent.trim(),
    },
    { name: 'skills', el: row => row.querySelector(':scope>.tn-skl'), text: () => 'Skills' },
    {
      name: 'status text',
      cls: 'tnai-fit-dot',
      on: row => !!row.querySelector(':scope>.terminal-pane-state>span')?.textContent.trim(),
      text: row => row.querySelector(':scope>.terminal-pane-state>span')?.textContent.trim() || '',
    },
  ];

  // The mark "(name) is watching" (115) is one of the header's own parts: it never leaves;
  // in a tight row it shows its short form (11). The header's own parts and
  // the items the steps above handle. Anything else in the row is an item nobody ranked.
  const KNOWN =
    '.agent-avatar, .terminal-pane-av, .terminal-pane-title, .terminal-provider-select, .terminal-agent-select, .terminal-context-state, .tnai-ctx, .tnai-bg-chip, .tnai-rv-chip, .tn-skl, .terminal-pane-state, .terminal-pane-tools, .tnai-fit-more, .tnai-rename-input, input, select';

  // The buttons that show when a panel is hovered (.terminal-pane-tools; they were cut,
  // hidden or unevenly spaced in a small panel). First to fold first; `keep` never folds. Every
  // button a script puts in a panel header is listed here: one that is not folds before any other
  // and fails the `header-fit` test by name (`unranked`). A row is always fitted as if it were
  // hovered, so hovering moves the status left and nothing else. What folds is behind a "⋯" button
  // in the same group, which opens it as a menu.
  const TOOLS = [
    { name: 'Clear output', q: 'button[title="Clear output"]' },
    { name: 'Compact', q: 'button[data-compact], button[title^="Compact"]' },
    { name: 'Rename', q: '[data-tnai-rename]' },
    { name: 'Show all digests', q: '[data-tnai-dg-back]' },
    { name: 'Maximize', q: '[data-tnai-max]', keep: true },
    { name: 'Close', q: 'button[title="Close terminal"]', keep: true },
  ];
  const TOOLS_PAD = 6,
    // 11-terminal-purple.css: the group's left padding once it is in the row; the name's least
    // width in a tight row
    NAME_MIN = 24;
  const watched = new WeakMap(); // row -> { key, ro, mo }
  const shown = el => !!el && el.getClientRects().length > 0;
  const cutText = el => shown(el) && el.scrollWidth > el.clientWidth + SLACK;
  const toolsOf = row => row.querySelector(':scope>.terminal-pane-tools');
  const menuOf = row => row.querySelector(':scope>.terminal-pane-tools>.tnai-fit-menu');
  const rank = b => TOOLS.findIndex(t => b.matches(t.q));
  const unranked = row =>
    [...(toolsOf(row)?.children || [])].filter(
      b => !b.classList.contains('tnai-fit-menu') && rank(b) < 0
    );

  // The row does not fit: its content is wider than it, or a part that may shrink has started to
  // cut its own text.
  function cut(row) {
    // Measured from the items' own boxes, not the row's scrollWidth: a status dot's glow ring
    // reaches a few pixels past its box and would count as overflow in a row that fits.
    const style = getComputedStyle(row),
      box = row.getBoundingClientRect(),
      edge = box.right - (parseFloat(style.paddingRight) || 0) + SLACK,
      tools = toolsOf(row);
    let floating = false;
    for (const c of row.children) {
      if (!shown(c)) continue;
      if (getComputedStyle(c).position === 'absolute') {
        if (c === tools) floating = true;
        continue;
      }

      // The buttons slide in over 0.3 s: their place in the row counts, not where the slide has
      // them now. No slack for them: the last button ends exactly at the row's padding, hovered or
      // not.
      if (
        c === tools
          ? c.getBoundingClientRect().right - new DOMMatrix(getComputedStyle(c).transform).m41 >
            edge - SLACK + 0.05
          : c.getBoundingClientRect().right > edge
      )
        return true;
    }
    const skl = row.querySelector(':scope>.tn-skl'),
      state = row.querySelector(':scope>.terminal-pane-state>span'),
      title = row.querySelector(':scope>.terminal-pane-title');
    if (cutText(skl) || cutText(state)) return true;

    // Not hovered, the buttons float over the row's end and take no room. Fitted as if hovered: the
    // free room in the row (the auto margin before the status, or before our mark) has to hold
    // them, so nothing leaves or is cut at the moment of a hover.
    if (floating) {
      const ts = getComputedStyle(tools),
        inRow =
          tools.offsetWidth -
          (parseFloat(ts.paddingLeft) || 0) -
          (parseFloat(ts.paddingRight) || 0);
      const lead = shown(more(row)) ? more(row) : row.querySelector(':scope>.terminal-pane-state');
      if (inRow > 0 && lead) {
        let free = parseFloat(getComputedStyle(lead).marginLeft) || 0;
        if (row.classList.contains('tnai-fit-tight') && shown(title))
          free += Math.max(0, title.offsetWidth - NAME_MIN); // there the name gives way
        if (row.classList.contains('tnai-fit-swap') && lead === more(row))
          free +=
            // hovered, our mark makes way for the menu button
            Math.floor(lead.getBoundingClientRect().width) + (parseFloat(style.columnGap) || 0);

        // no slack here: the last button ends exactly 12 px from the edge
        if (inRow + TOOLS_PAD + (parseFloat(style.columnGap) || 0) > free) return true;
      }
    }

    // The name may end in "…", but not while its "in preview" mark is still on: the mark would be
    // the part that is cut.
    return cutText(title) && !row.classList.contains('tnai-fit-nomark') && STEPS[1].on(row);
  }
  const more = row => row.querySelector(':scope>.tnai-fit-more');

  function reset(row) {
    row.querySelectorAll('.tnai-fit-out').forEach(el => el.classList.remove('tnai-fit-out'));
    row.classList.remove('tnai-fit-nomark', 'tnai-fit-dot', 'tnai-fit-tight', 'tnai-fit-swap');
    more(row)?.remove();
    menuOf(row)?.remove();
  }

  // ---- The menu behind the "⋯" button: one line for each folded button; choosing a line presses
  // that button. Its two listeners exist only while it is open.
  let menu = null; // { row, list }
  const outOf = row =>
    (more(row)?.title || '')
      .replace(/^Not shown at this width: /, '')
      .split('; ')
      .filter(Boolean);
  const label = b => {
    const t = TOOLS[rank(b)];
    return t
      ? typeof t.name === 'function'
        ? t.name(b)
        : t.name
      : (b.getAttribute('aria-label') || b.title || b.textContent || 'Action')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
  };
  const folded = row => [...(toolsOf(row)?.querySelectorAll(':scope>.tnai-fit-out') || [])];

  function closeMenu(focus) {
    if (!menu) return;
    const { row, list } = menu;
    menu = null;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.TnaiFloat?.detach?.(list);
    list.remove();
    const b = menuOf(row);
    b?.setAttribute('aria-expanded', 'false');
    if (focus) b?.focus({ preventScroll: true });
  }

  function onDown(e) {
    if (menu && !menu.list.contains(e.target) && !e.target.closest?.('.tnai-fit-menu')) closeMenu();
  }

  function onKey(e) {
    if (!menu) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const lines = [...menu.list.querySelectorAll('button:not(:disabled)')];
    if (!lines.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = lines.indexOf(document.activeElement);
    lines[
      e.key === 'ArrowDown' ? (at + 1) % lines.length : at <= 0 ? lines.length - 1 : at - 1
    ].focus();
  }

  // One more line, after the folded buttons and only in a panel whose terminal names a snapshot
  // clip (113): it plays the latest one in the view-only file window, as the clip's link and the
  // command palette do. It is a line of the menu only: the row and its buttons do not change, and
  // no menu button appears because of it.
  function clipLine(row) {
    const pane = row.closest('.terminal-pane'),
      clips = window.TnaiClips;
    if (!pane || !clips?.latest) return [];
    const term = window.TnaiAgents?.views?.().find(
      v => v.term.element && pane.contains(v.term.element)
    )?.term;
    if (!term || !clips.latest(term)) return [];
    const line = document.createElement('button');
    line.type = 'button';
    line.setAttribute('role', 'menuitem');
    line.textContent = 'Play the latest clip shown in this terminal';
    line.addEventListener('click', () => {
      closeMenu();
      clips.playLatest(term);
    });
    return [line];
  }

  function fillMenu(row, list) {
    // Under the buttons, as plain lines: the items that are out (what the mark's tip lists, and the
    // status text when only its dot shows).
    const gone = outOf(row);
    if (row.classList.contains('tnai-fit-dot')) {
      const t = STEPS[4].text(row);
      if (t && !gone.includes(t)) gone.push(t);
    }
    const notes = (gone.length ? ['Not shown at this width', ...gone] : []).map(t => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    });
    list.replaceChildren(
      ...folded(row).map(b => {
        const line = document.createElement('button');
        line.type = 'button';
        line.setAttribute('role', 'menuitem');
        line.textContent = label(b);
        line.disabled = !!b.disabled || b.getAttribute('aria-disabled') === 'true';

        // why it is off; an enabled line says what it does
        if (line.disabled) line.title = b.title || b.getAttribute('aria-label') || '';
        line.addEventListener('click', () => {
          closeMenu();
          b.click();
        });
        return line;
      }),
      ...clipLine(row),
      ...notes
    );
  }

  function openMenu(row, button, byKey) {
    closeMenu();
    const list = document.createElement('div');
    list.className = 'tnai-fit-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', 'More actions for this terminal');
    fillMenu(row, list);
    document.body.append(list);
    button.setAttribute('aria-expanded', 'true');
    window.TnaiFloat?.attach(button, list, { placement: 'bottom-end' });
    menu = { row, list };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    if (byKey) list.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function menuButton(row) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tnai-fit-menu';
    b.title = 'More actions';
    b.setAttribute('aria-label', 'More actions');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.innerHTML = window.TnaiIcon?.('ellipsis', { size: 14 }) || '⋯';
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (menu?.row === row) closeMenu();
      else openMenu(row, b, e.detail === 0);
    });
    return b;
  }

  // The fit from scratch below reads the layout after each thing it folds, and during a window drag
  // every such read lays the page out again: run on each step for each row it took 4.5 to 4.9 s of
  // a 5.5 s drag once the hover buttons made most rows have something out (resize-drag, 2026-10-06:
  // freezes of 660 to 715 ms). So the frame pass never calls it. While sizes or texts change it
  // measures every row once, then folds one more thing in each row that is too full (`foldNext`, no
  // measuring), and goes on in the next frame. The fit from scratch runs once a row has been still
  // for 200 ms, the rows one after the other; it is what brings things back and what decides the
  // final state.
  let stagger = 0;

  function settleSoon(row) {
    const w = watched.get(row);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(
      () => {
        w.timer = 0;
        if (row.isConnected) fit(row);
      },
      200 + (stagger++ % 8) * 24
    );
  }
  const isClean = row =>
    !more(row) &&
    !row.classList.contains('tnai-fit-nomark') &&
    !row.classList.contains('tnai-fit-dot') &&
    !row.classList.contains('tnai-fit-tight') &&
    !row.querySelector('.tnai-fit-out, .tnai-fit-menu');

  // One more thing out, in the order of the fit below, decided from the row's nodes and classes
  // alone. False: nothing is left to fold.
  function foldNext(row) {
    const tools = toolsOf(row);
    if (tools) {
      const left = [...tools.children]
        .filter(
          b =>
            !b.classList.contains('tnai-fit-out') &&
            !b.classList.contains('tnai-fit-menu') &&
            !TOOLS[rank(b)]?.keep
        )
        .sort((a, b) => rank(a) - rank(b));
      if (left.length > (menuOf(row) ? 0 : 1)) {
        if (!menuOf(row)) {
          const first =
              tools.querySelector(':scope>[data-tnai-max]') ||
              tools.querySelector(':scope>button[title="Close terminal"]'),
            button = menuButton(row);
          if (first) first.before(button);
          else tools.append(button);
        }
        left[0].classList.add('tnai-fit-out');
        return true;
      }
    }
    const say = text => {
      if (!text) return;
      let mark = more(row);
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'tnai-fit-more';
        mark.textContent = '⋯';
        mark.setAttribute('role', 'img');
        (row.querySelector(':scope>.terminal-pane-state') || row.lastElementChild).before(mark);
        if (menuOf(row)) row.classList.add('tnai-fit-swap');
      }
      const tip = (mark.title ? mark.title + '; ' : 'Not shown at this width: ') + text;
      mark.title = tip;
      mark.setAttribute('aria-label', tip);
    };
    for (const el of [...row.children].reverse()) {
      if (el.matches(KNOWN) || el.hidden || el.classList.contains('tnai-fit-out')) continue;
      el.classList.add('tnai-fit-out');
      say(
        (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/s+/g, ' ')
          .slice(0, 40)
      );
      return true;
    }
    for (const step of STEPS) {
      const el = step.el?.(row);
      if (
        step.el
          ? !el || el.hidden || el.classList.contains('tnai-fit-out')
          : !step.on(row) || row.classList.contains(step.cls)
      )
        continue;
      if (el) el.classList.add('tnai-fit-out');
      else row.classList.add(step.cls);

      // the status tip already says the status text
      if (step !== STEPS[4]) say(step.text(el || row));
      return true;
    }
    if (row.classList.contains('tnai-fit-tight')) return false;
    row.classList.add('tnai-fit-tight');
    return true;
  }

  function fit(row, known) {
    // known: the row's key when the caller just built it for the width in w.cw
    const w = watched.get(row);
    if (!row.isConnected || !row.clientWidth) return [];

    // Nothing is out and the row fits (the usual case): one measure and no write. The reset, the
    // key's width read after it and the same data-fit-out written again made every header lay out
    // twice on each step of a window drag (measured 2026-10-05).
    const clean = isClean(row);
    if (clean && !cut(row)) {
      // Nothing was written since the caller built its key, so at the same width it is this key:
      // building it again read every item's text a second time per header on each step of a drag
      // (key: 85 ms of a drag in stress-switch, 2026-10-05).
      if (w) {
        const cw = row.clientWidth;
        w.key = typeof known === 'string' && cw === w.cw ? known : key(row, cw);
        w.cw = cw;
      }
      if (row.dataset.fitOut !== '0') row.dataset.fitOut = '0';
      return [];
    }
    if (w) w.busy = true;
    const held = menuOf(row),
      // an open menu and the focus survive a refit
      hadFocus = !!held && document.activeElement === held;
    if (!clean) reset(row);
    const out = [];

    // The buttons fold first, into their menu: the items of the row are on screen all the time, the
    // buttons only under the pointer. One candidate is not worth a menu button of the same width.
    const tools = toolsOf(row),
      cand = !tools
        ? []
        : [...tools.children]
            .filter(shown)
            .map(b => [rank(b), b])
            .filter(([i]) => i < 0 || !TOOLS[i].keep)
            .sort((a, b) => a[0] - b[0])
            .map(x => x[1]);
    if (cand.length > 1 && (clean || cut(row))) {
      const fresh = !menuOf(row),
        button = menuOf(row) || menuButton(row),
        first =
          tools.querySelector(':scope>[data-tnai-max]') ||
          tools.querySelector(':scope>button[title="Close terminal"]');
      if (fresh) {
        if (first) first.before(button);
        else tools.append(button);
      } // its width counts from the first fold on
      let n = 0;
      for (const b of cand) {
        if (!cut(row)) break;
        b.classList.add('tnai-fit-out');
        n++;
      }
      if (fresh && !n) button.remove();
      else if (fresh && hadFocus) button.focus({ preventScroll: true });
    }
    if (cut(row)) {
      const mark = more(row) || document.createElement('span');
      mark.className = 'tnai-fit-more';
      mark.textContent = '⋯';
      mark.setAttribute('role', 'img');
      if (!mark.isConnected)
        // its width counts from the first step on
        (row.querySelector(':scope>.terminal-pane-state') || row.lastElementChild).before(mark);

      // One "⋯" in a header: hovered, the menu button stands in for this
      // mark and its menu lists what the tip lists.
      if (menuOf(row)) row.classList.add('tnai-fit-swap');

      // An item this file does not know leaves before any it does, last in the row first: a chip
      // added later can never break the row.
      for (const el of [...row.children].reverse()) {
        if (!cut(row)) break;
        if (el === mark || !shown(el) || el.matches(KNOWN)) continue;
        el.classList.add('tnai-fit-out');
        const text = (el.getAttribute('aria-label') || el.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        if (text) out.push(text);
      }
      for (const step of STEPS) {
        if (!cut(row)) break;
        const el = step.el?.(row);
        if (step.el ? !shown(el) : !step.on(row) || row.classList.contains(step.cls)) continue;
        const text = step.text(el || row);
        if (el) el.classList.add('tnai-fit-out');
        else row.classList.add(step.cls);
        if (text) out.push(text);
      }

      // Only the status text left (the status tip already says it, with the context): no mark
      // needed for that alone.
      const said = out.filter(
        t => t !== STEPS[4].text(row) || !row.classList.contains('tnai-fit-dot')
      );
      if (!said.length) {
        mark.remove();
        row.classList.remove('tnai-fit-swap');
      } else {
        const tip = 'Not shown at this width: ' + said.join('; ');
        mark.title = tip;
        mark.setAttribute('aria-label', tip);
      }

      // Still short with everything out (a panel near its 200 px minimum): the name gives way down
      // to a few letters and the buttons take their small size, so Close, Maximize and the menu
      // button are whole.
      if (cut(row)) row.classList.add('tnai-fit-tight');
    }
    if (menu?.row === row) {
      const button = menuOf(row);
      if (button) {
        button.setAttribute('aria-expanded', 'true');
        fillMenu(row, menu.list);
        window.TnaiFloat?.attach(button, menu.list, { placement: 'bottom-end', fade: false });
      } else closeMenu();
    }
    if (w) {
      w.cw = row.clientWidth;
      w.key = key(row, w.cw);
      requestAnimationFrame(() => {
        w.busy = false;
      });
    }
    if (row.dataset.fitOut !== String(out.length)) row.dataset.fitOut = String(out.length);
    return out;
  }

  // What a fit depends on: the row's width and the text of its items (not our own mark).
  // The buttons count by what decides which of them show: how many there are, and the grid's and
  // the panel's state (Grid view, maximized, density, an opened digest, a second panel for
  // Maximize). Nothing here is measured.
  const toolsKey = row => {
    const t = toolsOf(row),
      g = row.closest('.terminal-workspace-grid'),
      p = row.parentElement;
    return (
      (t ? t.childElementCount - (menuOf(row) ? 1 : 0) : 0) +
      (g ? ':' + g.className + ':' + (g.dataset.density || '') + ':' + g.childElementCount : '') +
      (p?.classList.contains('tnai-dg-open') ? ':open' : '')
    );
  };
  const key = (row, width = row.clientWidth) =>
    width +
    '|' +
    [...row.children]
      .filter(
        c => !c.classList.contains('tnai-fit-more') && !c.classList.contains('terminal-pane-tools')
      )
      .map(c => c.className.replace(/\s*tnai-fit-out/, '') + ':' + c.textContent.length)
      .join(',') +
    '|' +
    (STEPS[1].on(row) ? 1 : 0) +
    '|' +
    toolsKey(row);

  // The row's width is read only after its ResizeObserver reported a size change (`sized`), else
  // the last one is used: a header whose text changes many times a second (status, context) forced
  // a layout here on every page, also for rows that are not shown (measured 2026-10-05).
  let queued = 0;
  const dirty = new Set();

  function later(row) {
    dirty.add(row);
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      const rows = [...dirty],
        todo = [];
      dirty.clear();
      for (const r of rows) {
        const w = watched.get(r);
        if (!w || !r.isConnected) continue;
        if (w.sized) {
          w.sized = false;
          w.cw = r.clientWidth;
        }
        if (!w.cw) continue;
        const k = key(r, w.cw);
        if (k !== w.key) todo.push([r, w, k]);
      }

      // Reads for every row first, then the writes: a read after a write lays the page out again.
      const full = todo.filter(([r, w, k]) => {
        const clean = isClean(r),
          over = cut(r);
        if (clean && !over) {
          w.key = k;
          return false;
        }
        w.key = over ? '' : k;
        settleSoon(r);
        return over;
      });
      for (const [r, w] of full) {
        w.busy = true;
        if (foldNext(r)) later(r);
        else w.key = key(r, w.cw);
      }
      if (full.length)
        requestAnimationFrame(() => {
          for (const [, w] of full) w.busy = false;
        });
    });
  }

  function watch(row) {
    if (watched.has(row)) return;
    const w = { key: '', busy: false, sized: true, cw: 0, timer: 0 };
    w.ro = new ResizeObserver(() => {
      w.sized = true;
      later(row);
    });
    w.ro.observe(row);
    w.mo = new MutationObserver(() => {
      if (!w.busy) later(row);
    });
    w.mo.observe(row, { childList: true, subtree: true, characterData: true });
    const pane = row.closest('.terminal-pane');

    // "in preview" comes and goes with a class on the panel
    if (pane) w.mo.observe(pane, { attributes: true, attributeFilter: ['class'] });
    watched.set(row, w);
    later(row);

    // A new panel changes its neighbours' buttons with no change of their width (Maximize shows
    // from the second panel on).
    row
      .closest('.terminal-workspace-grid')
      ?.querySelectorAll(':scope>.terminal-pane>.terminal-pane-head')
      .forEach(r => {
        if (r !== row && watched.has(r)) later(r);
      });
  }

  function scan() {
    document.querySelectorAll('.terminal-pane>.terminal-pane-head').forEach(watch);
  }

  // New panels: the same pushes 106 uses for its chips (no polling).
  let scanQueued = 0;
  const scanSoon = () => {
    if (!scanQueued)
      scanQueued = requestAnimationFrame(() => {
        scanQueued = 0;
        scan();
      });
  };
  window.TnaiAgents?.onChange?.(scanSoon);
  ['tnai:team-changed', 'tnai:terminal-pane-closed', 'tnai:terminal-pane-renamed'].forEach(n =>
    window.addEventListener(n, scanSoon)
  );

  // Not a watcher on the whole Terminal page: terminal rows change constantly there. A panel's
  // header gets its items when its session starts or changes, which is what onChange reports; a
  // panel with no connection has nothing that can overflow.
  scanSoon();

  window.TnaiFit = {
    scan,
    fit,
    unranked,
    folded: row => folded(row).map(label),
    out: row =>
      (more(row)?.title || '')
        .replace(/^Not shown at this width: /, '')
        .split('; ')
        .filter(Boolean),
  };
})();
