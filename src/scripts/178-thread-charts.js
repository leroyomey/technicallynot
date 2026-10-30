/*
 * Technically Not · 178-thread-charts.js — charts in threads (user 2026-10-23: "Our graphs need to
 * be built into the threads more like this", mock docs/plans/design-concepts/thread-charts.html).
 *
 * An agent writes a chart block in its reply, as plain text, so every agent CLI can:
 *
 * ```chart title: Page switch time unit: ms series: 0.3.74, 0.3.75 (optional; one or two) Threads:
 * 118, 84 ```
 *
 * and the thread draws it as a card: one series as bars in the user's accent, two side by side with
 * a legend (violet and aqua, checked with the dataviz validator in Dark and Light), Chart / Table
 * on each, the exact value on hover or keyboard focus. A Markdown table in a reply with a column of
 * numbers becomes the same card, opened on its table. The rule that tells agents when to write one
 * is desktop/hidden-skills/46-charts.md.
 *
 * Round 2 (user 2026-10-23: "automatically turning anything data related into clean graphs", mock
 * docs/plans/design-concepts/data-charts.html): a list of three or more "- Name: 84 MB" lines in
 * one unit becomes a chart too; a number table opens on Chart; items in order (versions, dates,
 * months, builds) draw as a line; and each card has 179's split icon, which pushes the card,
 * drawn again large, beside the thread. Code blocks other than chart stay text as written.
 *
 * 122 calls `fill(block, words, markdown)` before drawing a reply: it answers false when the words
 * hold no chart and no number table, and 122 then draws them exactly as before. Values are numbers
 * only; labels and titles are text (textContent), never HTML.
 *
 * Test: node tools/thread-charts-test.js
 */
(() => {
  'use strict';

  const MAX_ROWS = 30;
  const MAX_SERIES = 2;
  const KEYS = new Set(['title', 'unit', 'series', 'note', 'type']);

  // a list needs this many values in a row before it is drawn as a chart
  const MIN_LIST = 3;

  // a series in order is drawn as a line from this many points on
  const MIN_LINE = 4;

  // Labels that run in order (versions, years, dates, months, weeks, builds): such a series is
  // change over time, so it is drawn as a line. Every label must be of the same kind.
  const ORDERED = [
    /^v?\d+(\.\d+){1,3}$/i,
    /^(19|20)\d\d$/,
    /^\d{4}-\d{2}(-\d{2})?$/,
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s+\d{2,4})?$/i,
    /^((19|20)\d\d\s+)?q[1-4](\s+(19|20)?\d\d)?$/i,
    /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i,
    /^(week|wk|day|build|run|sprint|round|try|attempt|step|release)\s*#?\d+$/i,
    /^\d{1,2}:\d{2}(\s*[ap]m)?$/i,
  ];

  // 'line' or 'bars': what the agent asked for, else a line for a series in order
  function kindOf(rows, asked) {
    const want = String(asked || '').toLowerCase();
    if (want === 'line') return 'line';
    if (want === 'bar' || want === 'bars') return 'bars';
    if (rows.length < MIN_LINE) return 'bars';
    const labels = rows.map(row => String(row[0]).trim());
    return ORDERED.some(pattern => labels.every(label => pattern.test(label))) ? 'line' : 'bars';
  }

  // "1,234.5 ms" → 1234.5; anything else → NaN
  function number(text) {
    const clean = String(text || '')
      .trim()
      .replace(/^[^\d.-]+/, '')
      .replace(/[^\d.,-]+$/, '')
      .replace(/,(?=\d{3}\b)/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(clean)) return NaN;
    return Number(clean);
  }

  // ---------- reading ----------

  // A chart block's lines → { title, unit, note, series: [names], rows: [[label, v1, v2?]] } or
  // null
  function parseChart(lines) {
    const chart = { title: '', unit: '', note: '', series: [], rows: [] };
    for (const raw of lines) {
      const line = raw.trim();
      const at = line.lastIndexOf(':');
      if (!line || at <= 0) continue;
      const key = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim();
      const lower = key.toLowerCase();
      if (KEYS.has(lower)) {
        if (lower === 'series')
          chart.series = value
            .split(/\s*,\s*/)
            .filter(Boolean)
            .slice(0, MAX_SERIES);
        else chart[lower] = value.slice(0, 120);
        continue;
      }
      const values = (chart.series.length > 1 ? value.split(/\s*,\s*/) : [value]).map(number);
      if (!values.length || values.some(v => !Number.isFinite(v))) continue;
      if (chart.rows.length < MAX_ROWS)
        chart.rows.push([key.slice(0, 80), ...values.slice(0, MAX_SERIES)]);
    }
    if (!chart.rows.length) return null;
    const width = chart.rows[0].length - 1;
    if (chart.rows.some(row => row.length - 1 !== width)) return null;
    if (!chart.series.length && width === 1) chart.series = [''];
    chart.kind = kindOf(chart.rows, chart.type);
    return chart;
  }

  // One list line that is only a name and a value: "- node_modules: 412 MB", "1. **Lead** — 41
  // files (most)". Bold marks are taken off first. → { label, value, unit, said } or null
  const LIST_ITEM =
    /^\s*(?:[-*•+]|\d{1,2}[.)])\s+([^:—–]{1,60}?)\s*(?::|—|–|\s-\s)\s*([$€£]?\s?-?[\d,]*\.?\d+)\s*([A-Za-z%]{1,8})?\s*(?:\(([^()]{0,60})\))?\s*$/;

  function listItem(line) {
    const found = LIST_ITEM.exec(String(line).replace(/\*\*|__/g, ''));
    if (!found) return null;
    const value = number(found[2]);
    if (!Number.isFinite(value)) return null;
    const currency = /^[$€£]/.test(found[2].trim()) ? found[2].trim()[0] : '';
    const unit = currency || found[3] || '';
    const said =
      found[2].trim() + (found[3] ? ' ' + found[3] : '') + (found[4] ? ' (' + found[4] + ')' : '');
    return { label: found[1].trim(), value, unit, said };
  }

  // A line that ends with a colon right before a list or table names its chart: "Biggest folders:".
  function titleFrom(lead) {
    const line = String(lead || '').trim();
    if (!/:$/.test(line) || line.length > 80) return '';
    return line
      .replace(/[*_#`]/g, '')
      .replace(/:$/, '')
      .trim();
  }

  // Lines of a list of values → a chart, or null when they are fewer than MIN_LIST or mix units.
  // `lead` is the line before the list: "The five biggest folders:" names the chart.
  function parseList(items, lead) {
    if (items.length < MIN_LIST) return null;
    const unit = items[0].unit;
    if (items.some(item => item.unit.toLowerCase() !== unit.toLowerCase())) return null;
    const title = titleFrom(lead);
    const rows = items.slice(0, MAX_ROWS).map(item => [item.label.slice(0, 80), item.value]);
    return {
      title,
      unit,
      note: 'Drawn from the list in the reply',
      series: [''],
      rows,
      kind: kindOf(rows),
      table: {
        head: ['', 'Value'],
        rows: items.slice(0, MAX_ROWS).map(item => [item.label, item.said]),
      },
    };
  }

  // A Markdown table's lines → { head: [...], rows: [[...]] } with a numbers column, or null
  function parseTable(lines) {
    const cells = line =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());
    if (lines.length < 3 || !/^\s*\|?\s*:?-{2,}/.test(lines[1])) return null;
    const head = cells(lines[0]);
    const rows = lines
      .slice(2)
      .map(cells)
      .filter(row => row.length === head.length);
    if (!rows.length || head.length < 2) return null;
    const numeric = head
      .map((_, at) => at)
      .filter(at => at > 0 && rows.every(row => Number.isFinite(number(row[at]))));
    if (!numeric.length) return null;
    return { head, rows: rows.slice(0, MAX_ROWS), numeric: numeric.slice(0, MAX_SERIES) };
  }

  // The reply's words in parts: { kind: 'text' | 'chart' | 'table', ... }
  function split(words) {
    const lines = String(words || '').split(/\r?\n/);
    const parts = [];
    let text = [];
    const flushText = () => {
      if (text.length) parts.push({ kind: 'text', text: text.join('\n') });
      text = [];
    };
    for (let at = 0; at < lines.length; at++) {
      const line = lines[at];
      const fence = /^\s*(`{3,}|~{3,})\s*chart\s*$/i.exec(line);
      if (fence) {
        const body = [];
        let end = at + 1;
        while (end < lines.length && !lines[end].trim().startsWith(fence[1]))
          body.push(lines[end++]);
        const chart = end < lines.length ? parseChart(body) : null;
        if (chart) {
          flushText();
          parts.push({ kind: 'chart', chart });
          at = end;
          continue;
        }
      }

      // any other code block stays text as written, lists and tables inside it too
      const code = /^\s*(`{3,}|~{3,})/.exec(line);
      if (code) {
        let end = at + 1;
        while (end < lines.length && !lines[end].trim().startsWith(code[1])) end++;
        text.push(...lines.slice(at, end + 1));
        at = end;
        continue;
      }

      // a list of values: a name and a number on each line, all in one unit
      if (listItem(line)) {
        const items = [];
        let end = at;
        for (; end < lines.length; end++) {
          const item = listItem(lines[end]);
          if (!item) break;
          items.push(item);
        }
        const lead = [...text].reverse().find(earlier => earlier.trim()) || '';
        const chart = parseList(items, lead.trim());
        if (chart) {
          flushText();
          parts.push({ kind: 'chart', chart });
          at = end - 1;
          continue;
        }
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        let end = at;
        while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
        const table = parseTable(lines.slice(at, end));
        if (table) {
          const lead = [...text].reverse().find(earlier => earlier.trim()) || '';
          flushText();
          parts.push({ kind: 'table', table, title: titleFrom(lead) });
          at = end - 1;
          continue;
        }
      }
      text.push(line);
    }
    flushText();
    return parts;
  }

  // ---------- drawing ----------
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const shown = value =>
    Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);

  function tableOf(head, rows) {
    const table = make('table', 'tnt-chart-table');
    const top = table.insertRow();
    head.forEach(name => top.append(make('th', '', name)));
    rows.forEach(row => {
      const line = table.insertRow();
      row.forEach(
        cell => (line.insertCell().textContent = typeof cell === 'number' ? shown(cell) : cell)
      );
    });
    return table;
  }

  // The legend of two series: a colored key and each series' name.
  function legendOf(chart) {
    const legend = make('div', 'tnt-chart-legend');
    chart.series.forEach((name, at) => {
      const item = make('span', '');
      item.append(make('i', 'tnt-chart-key s' + (at + 1)), name);
      legend.append(item);
    });
    return legend;
  }

  function barsOf(chart) {
    const box = make('div', 'tnt-chart-bars');
    const two = chart.series.length > 1;
    if (two) box.append(legendOf(chart));
    const max = Math.max(...chart.rows.flatMap(row => row.slice(1).map(Math.abs))) || 1;
    const unit = chart.unit ? ' ' + chart.unit : '';
    for (const [label, ...values] of chart.rows) {
      const row = make('div', 'tnt-chart-row');
      row.tabIndex = 0;
      const said = two
        ? chart.series.map((name, at) => name + ' ' + shown(values[at]) + unit).join(' · ')
        : shown(values[0]) + unit;
      row.setAttribute('aria-label', label + ': ' + said);
      const top = make('div', 'tnt-chart-label');
      const right = make('span', '');
      if (two) {
        right.append(shown(values[0]) + ' → ');
        right.append(make('b', '', shown(values[1]) + unit));
      } else right.textContent = shown(values[0]) + unit;
      top.append(make('span', '', label), right);
      row.append(top);
      values.forEach((value, at) => {
        const track = make('div', 'tnt-chart-track');
        const fill = make('div', 'tnt-chart-fill' + (two ? ' s' + (at + 1) : ''));
        fill.style.width = Math.max(0.5, (Math.abs(value) / max) * 100) + '%';
        track.append(fill);
        row.append(track);
      });
      row.append(make('span', 'tnt-chart-tip', label + ': ' + said));
      box.append(row);
    }
    return box;
  }

  // A rounded scale top for a value: 1, 2, 2.5 or 5 times a power of ten.
  function niceTop(value) {
    if (!(value > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 2.5, 5, 10].find(each => value <= each * power);
    return step * power;
  }

  // A series in order as a line: a few faint grid lines, a 2 px line per series with its points,
  // the last value written at the line's end, and the exact value on hover or keyboard focus over
  // a column wider than the point.
  function lineOf(chart, big) {
    const box = make('div', 'tnt-chart-line');
    let drawnAt = 0;
    const paint = width => {
      drawnAt = width;
      box.replaceChildren(lineParts(chart, big, width));
    };
    paint(560);

    // drawn again at the card's real width, so its words stay at their own size when it is narrow
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        const width = Math.round(box.clientWidth);
        if (width >= 240 && Math.abs(width - drawnAt) > 8) paint(width);
      }).observe(box);
    }
    return box;
  }

  // The line chart's legend, picture and value tip, drawn for `width` pixels.
  function lineParts(chart, big, width) {
    const svgName = 'http://www.w3.org/2000/svg';
    const height = big ? 320 : 200;
    const left = 44;
    const top = 14;
    const bottom = 26;
    const two = chart.series.length > 1;
    const unit = chart.unit ? ' ' + chart.unit : '';

    // The last value of each line is written after its end point, so the room on the right is
    // as wide as the longest of those words (user 2026-10-29: "7.57 M tokens" ran past the
    // chart's edge with a fixed 56 px). About 6.6 px a letter at the label's 11.5 px, plus the
    // 8 px gap after the point; never more than a third of the chart.
    const endTexts = chart.series.map((_, index) => shown(chart.rows.at(-1)[index + 1]) + unit);
    const longest = Math.max(0, ...endTexts.map(text => text.length));
    const right = Math.min(Math.round(width / 3), Math.max(56, Math.ceil(longest * 6.6) + 14));
    const all = chart.rows.flatMap(row => row.slice(1));
    const high = niceTop(Math.max(0, ...all));
    const low = Math.min(...all) < 0 ? -niceTop(-Math.min(...all)) : 0;
    const count = chart.rows.length;
    const step = (width - left - right) / Math.max(1, count - 1);
    const xAt = at => left + at * step;
    const yAt = value => top + (1 - (value - low) / (high - low)) * (height - top - bottom);

    const box = document.createDocumentFragment();
    if (two) box.append(legendOf(chart));
    const svg = document.createElementNS(svgName, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      (chart.title || 'Chart') +
        ': ' +
        chart.rows
          .map(([label, ...values]) => label + ' ' + values.map(shown).join(' and ') + unit)
          .join(', ')
    );
    const draw = (tag, attributes, text) => {
      const node = document.createElementNS(svgName, tag);
      for (const name in attributes) node.setAttribute(name, attributes[name]);
      if (text != null) node.textContent = text;
      svg.append(node);
      return node;
    };

    // four grid lines with their values, and as many labels under the line as fit
    for (let line = 0; line <= 4; line++) {
      const value = low + ((high - low) / 4) * line;
      draw('line', {
        class: 'tnt-cl-grid',
        x1: left,
        x2: width - right,
        y1: yAt(value),
        y2: yAt(value),
      });
      draw(
        'text',
        { class: 'tnt-cl-axis', x: left - 8, y: yAt(value) + 4, 'text-anchor': 'end' },
        shown(value)
      );
    }
    const every = Math.ceil(count / Math.max(2, Math.floor((width - left - right) / 64)));
    chart.rows.forEach(([label], at) => {
      // every few labels, and always the last one; none just before it, where they would touch
      const last = at === count - 1;
      if (!last && (at % every || count - 1 - at < every)) return;
      draw(
        'text',
        { class: 'tnt-cl-axis', x: xAt(at), y: height - 6, 'text-anchor': 'middle' },
        String(label).slice(0, 12)
      );
    });
    const cross = draw('line', { class: 'tnt-cl-cross', y1: top, y2: height - bottom });

    // the lines, their points, and the last value of each at its end (moved apart when close)
    const ends = [];
    chart.series.forEach((_, index) => {
      const series = two ? ' s' + (index + 1) : '';
      const points = chart.rows.map((row, at) => xAt(at) + ' ' + yAt(row[index + 1]));
      draw('path', { class: 'tnt-cl-path' + series, d: 'M' + points.join(' L') });
      chart.rows.forEach((row, at) => {
        draw('circle', {
          class: 'tnt-cl-dot' + series,
          cx: xAt(at),
          cy: yAt(row[index + 1]),
          r: big ? 5 : 4,
        });
      });
      const last = chart.rows[count - 1][index + 1];
      ends.push({ y: yAt(last) + 4, text: endTexts[index] });
    });
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
      const middle = (ends[0].y + ends[1].y) / 2;
      const upper = ends[0].y <= ends[1].y ? 0 : 1;
      ends[upper].y = middle - 7;
      ends[1 - upper].y = middle + 7;
    }
    ends.forEach(end =>
      draw('text', { class: 'tnt-cl-end', x: xAt(count - 1) + 8, y: end.y }, end.text)
    );

    box.append(svg);
    const tip = make('span', 'tnt-chart-tip');
    box.append(tip);
    chart.rows.forEach(([label, ...values], at) => {
      const said = two
        ? chart.series.map((name, index) => name + ' ' + shown(values[index]) + unit).join(' · ')
        : shown(values[0]) + unit;
      const before = at ? chart.rows[at - 1][1] : null;

      // the change from the point before, with its unit and a real minus sign (user 2026-10-29:
      // "(-29.24)" with no unit read as an error)
      const difference = before == null ? 0 : values[0] - before;
      const sign = difference >= 0 ? '+' : '−';
      const change =
        !two && before != null ? ' (' + sign + shown(Math.abs(difference)) + unit + ')' : '';
      const hit = draw('rect', {
        class: 'tnt-cl-hit',
        x: xAt(at) - step / 2,
        y: top,
        width: step,
        height: height - top - bottom,
        tabindex: '0',
        'aria-label': label + ': ' + said + change,
      });
      const show = () => {
        cross.setAttribute('x1', xAt(at));
        cross.setAttribute('x2', xAt(at));
        cross.classList.add('on');
        tip.textContent = label + ': ' + said + change;
        tip.style.left = (xAt(at) / width) * 100 + '%';
        tip.style.top = (yAt(Math.max(...values)) / height) * 100 + '%';
        tip.classList.add('on');
      };
      const hide = () => {
        cross.classList.remove('on');
        tip.classList.remove('on');
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
    });
    return box;
  }

  // The name that tells the split icon which chart is beside the thread.
  const keyOf = chart => 'chart:' + JSON.stringify([chart.title, chart.unit, chart.rows]);

  // One card: its head with Chart / Table and the split icon, and the view picked. `big`: the card
  // drawn again beside the thread (179), larger and without its own split icon.
  function card(chart, startAs, big) {
    const node = make('figure', 'tnt-chart' + (big ? ' tnt-chart-big' : ''));
    const head = make('figcaption', 'tnt-chart-head');
    head.append(make('b', '', chart.title || 'Chart'));
    if (chart.unit) head.append(make('small', '', chart.unit));
    const switcher = make('span', 'tnt-chart-switch');
    const body = make('div', 'tnt-chart-body');
    const views = {
      chart: () => (chart.kind === 'line' ? lineOf(chart, big) : barsOf(chart)),
      table: () =>
        chart.table
          ? tableOf(chart.table.head, chart.table.rows)
          : tableOf(
              ['', ...(chart.series.length > 1 ? chart.series : [chart.unit || 'Value'])],
              chart.rows
            ),
    };
    const show = which => {
      body.replaceChildren(views[which]());
      [...switcher.children].forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.view === which))
      );
    };
    ['chart', 'table'].forEach(which => {
      const button = make('button', '', which === 'chart' ? 'Chart' : 'Table');
      button.type = 'button';
      button.dataset.view = which;
      button.addEventListener('click', () => show(which));
      switcher.append(button);
    });
    head.append(switcher);
    const split = window.TnaiPreviewSplit;
    if (!big && split?.chartButton) {
      head.append(
        split.chartButton(keyOf(chart), chart.title || 'Chart', () => card(chart, 'chart', true))
      );
    }
    node.append(head, body);
    if (chart.note) node.append(make('div', 'tnt-chart-note', chart.note));
    show(startAs);
    return node;
  }

  // A number table as a chart: its first one or two numbers columns, by its first column's names.
  // The table view shows every column the agent wrote, not only the numbers.
  function chartOfTable(table, title = '') {
    const rows = table.rows.map(row => [row[0], ...table.numeric.map(at => number(row[at]))]);
    const series = table.numeric.map(at => table.head[at]);
    return {
      title,
      unit: series.length === 1 ? series[0] : '',
      note: '',
      series,
      rows,
      kind: kindOf(rows),
      table,
    };
  }

  // 122's hook: draws the reply with its charts, or answers false to leave it as before.
  function fill(block, words, markdown) {
    const parts = split(words);
    if (!parts.some(part => part.kind !== 'text')) return false;
    block.replaceChildren();
    for (const part of parts) {
      if (part.kind === 'text') {
        if (!part.text.trim()) continue;
        const holder = document.createElement('div');
        holder.innerHTML = markdown(part.text);
        block.append(...holder.childNodes);
      } else if (part.kind === 'chart') block.append(card(part.chart, 'chart'));
      else block.append(card(chartOfTable(part.table, part.title), 'chart'));
    }
    return true;
  }

  window.TnaiThreadCharts = {
    fill,
    split,
    parseChart,
    parseTable,
    parseList,
    listItem,
    kindOf,
    chartOfTable,
    niceTop,
    number,
  };
})();
