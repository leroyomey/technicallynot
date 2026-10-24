/*
 * Technically Not · 181-step-viewer.js — a step of the agent's work beside the thread (user
 * 2026-10-23: "NESTING is really hard to navigate ... allow the user to view the information, and
 * slide the nested ... information that the AI is doing", mock
 * docs/plans/design-concepts/step-viewer.html).
 *
 * In the conversation a run of actions is one flat list (59-step-viewer.css takes the group
 * headings and the box that scrolled under a line away). A press on a step, or Enter on it, slides
 * it in beside the thread through 179 (`openNode`, the same column a page or a chart uses): its
 * name, where it is in the run ("2 of 4") and how it ended, then the whole command or file and
 * what it printed, in full, with no box of its own to scroll. The arrows in its bar, or Up / Down
 * while no text box or terminal has the keyboard, move to the previous / next step of the same
 * run; the same step pressed again, the bar's icon or Esc push it back. A step still running
 * fills in as its output arrives.
 *
 * 122 keeps each step's facts on its line (`line.tntStep`: entry, its text box `more`).
 * window.TnaiStepViewer = { open(line), close(), shown() }. Test: node tools/step-viewer-test.js
 */
(() => {
  'use strict';

  const KEY = 'step:';

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, size = 16) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  // the line of the step beside the thread, and what watches its output
  let current = null;
  let outputWatch = null;

  // the view drawn last, swapped in place when the step's output grows
  let drawn = null;

  // The steps of the run a line is in, in order.
  const stepsOf = line =>
    [...(line.closest('.tnt-did') || line.parentElement).querySelectorAll('.tnt-act')].filter(
      step => step.tntStep
    );

  // What the step was on: a file, a command, or what it searched for.
  function whatOf(known) {
    const entry = known.entry || {};
    const verb = entry.verb || '';
    const label = /^(Read|Edited|Wrote|Deleted)/.test(verb)
      ? 'File'
      : verb === 'Ran'
        ? 'Command'
        : 'What';
    return { label, text: entry.full || entry.what || '' };
  }

  // What it printed, without the command again (122 writes it as "$ command" in the same box).
  function outputOf(known) {
    const entry = known.entry || {};
    const command = '$ ' + (entry.full || '');
    return String(known.more?.textContent || '')
      .split('\n\n')
      .filter(part => part !== command)
      .join('\n\n');
  }

  const ending = line =>
    line.dataset.state === 'failed'
      ? 'Failed'
      : line.dataset.state === 'running'
        ? 'Running'
        : line.querySelector('.tnt-act-result')?.textContent || 'Done';

  const titleOf = known =>
    (
      (known.entry?.verb || '') +
      ' ' +
      (known.line.querySelector('.tnt-act-what')?.textContent || '')
    ).trim();

  // The view in the column: its bar (previous, next, where it is, how it ended), then the whole of
  // it.
  function draw(line) {
    const known = line.tntStep;
    const steps = stepsOf(line);
    const at = steps.indexOf(line);
    const box = make('div', 'tsv');
    const bar = make('div', 'tsv-bar');
    const previous = make('button', 'tsv-move tsv-prev');
    previous.type = 'button';
    previous.innerHTML = icon('chevron-down');
    previous.setAttribute('aria-label', 'Previous step');
    previous.title = 'Previous step (Up)';
    previous.disabled = at <= 0;
    previous.addEventListener('click', () => move(-1));
    const next = make('button', 'tsv-move');
    next.type = 'button';
    next.innerHTML = icon('chevron-down');
    next.setAttribute('aria-label', 'Next step');
    next.title = 'Next step (Down)';
    next.disabled = at < 0 || at >= steps.length - 1;
    next.addEventListener('click', () => move(1));
    const where = make('span', 'tsv-where', at + 1 + ' of ' + steps.length);
    const end = make('span', 'tsv-end', ending(line));
    end.dataset.state = line.dataset.state || '';
    bar.append(previous, next, where, end);

    const what = whatOf(known);
    box.append(bar, make('p', 'tsv-label', what.label), make('pre', 'tsv-code', what.text));
    const printed = outputOf(known);
    if (printed) {
      box.append(make('p', 'tsv-label', 'Output'), make('pre', 'tsv-code tsv-out', printed));
    }
    return box;
  }

  function mark(line) {
    document.querySelectorAll('.tnt-act.tnt-act-on').forEach(other => {
      other.classList.remove('tnt-act-on');
      other.removeAttribute('aria-current');
    });
    if (line) {
      line.classList.add('tnt-act-on');
      line.setAttribute('aria-current', 'true');
    }
  }

  function show(line) {
    const split = window.TnaiPreviewSplit;
    const known = line?.tntStep;
    if (!known || !split?.openNode) return false;
    const opened = split.openNode(
      KEY + (known.entry?.id || ''),
      titleOf(known),
      () => (drawn = draw(line)),
      'step'
    );
    if (!opened) return false;
    current = line;
    mark(line);

    // a step still running fills in as its output arrives: only its own view is drawn again, the
    // column stays where it is
    outputWatch?.disconnect();
    if (typeof MutationObserver === 'function') {
      outputWatch = new MutationObserver(() => {
        if (current !== line || !drawn?.isConnected) return;
        const fresh = draw(line);
        drawn.replaceWith(fresh);
        drawn = fresh;
      });
      if (known.more) {
        outputWatch.observe(known.more, { childList: true, characterData: true, subtree: true });
      }
      outputWatch.observe(line, { attributes: true, attributeFilter: ['data-state'] });
    }
    return true;
  }

  // A press on a step: open it beside the thread, or push it back when it is the one shown.
  function open(line) {
    if (!line?.tntStep || !window.TnaiPreviewSplit?.openNode) return false;
    if (current === line && shown()) {
      close();
      return true;
    }
    return show(line);
  }

  function close() {
    if (shown()) window.TnaiPreviewSplit.close();
  }

  const shown = () => String(window.TnaiPreviewSplit?.shown?.() || '').startsWith(KEY);

  function move(by) {
    if (!current) return;
    const steps = stepsOf(current);
    const to = steps[steps.indexOf(current) + by];
    if (to) {
      show(to);
      to.scrollIntoView?.({ block: 'nearest' });
    }
  }

  // Something else took the column (a page, a chart) or it was pushed back: the line lets go.
  window.addEventListener('tnai:split-changed', event => {
    if (String(event.detail?.key || '').startsWith(KEY)) return;
    current = null;
    outputWatch?.disconnect();
    mark(null);
  });

  // Up / Down walk the steps while one is beside the thread; Enter on a step line opens it.
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (event.key === 'Enter' && target?.classList?.contains('tnt-act') && target.tntStep) {
      event.preventDefault();
      open(target);
      return;
    }
    if (!shown() || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

    // text boxes, terminals and the thread list (its arrows switch threads, 175) keep their keys
    if (target?.closest?.('input, textarea, select, [contenteditable="true"], .xterm, .tnt-list')) {
      return;
    }
    event.preventDefault();
    move(event.key === 'ArrowUp' ? -1 : 1);
  });

  window.TnaiStepViewer = { open, close, shown };
})();
