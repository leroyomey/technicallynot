/*
 * Technically Not · 59-usage-stats.js — Desktop app only: Settings › Usage (#tnaiUsageMount in
 * #settingsPanel-usage, 22). Token usage read from window.tnaiNative.usage.stats()
 * (desktop/usage-stats.js: Claude Code + Codex log files and OpenCode's database on this PC). Real
 * data only; nothing is drawn without it. Layout (a dashboard, the Settings caps are lifted for it;
 * container queries in src/styles/20-usage-accounts-purple.css):
 * - hero card: Today / 7 days / 30 days (change vs the period before, count-up once) beside a uPlot
 * area chart of the last 30 days with a dashed 7-day average; hover reads out the day's tokens,
 * turns and sessions;
 * - This week vs. last week: uPlot, same weekday one week apart (last week dashed);
 * - Busiest hours: a d3 radial clock (24 arc bars, d3.scaleRadial), hover a bar → the centre reads
 * that hour;
 * - Where tokens went: a d3 donut of models (top 5 + other) ringed by the per-CLI split, hover →
 * centre readout, legend beside it;
 * - Top projects (bars scaled with d3.scaleLinear) and Sessions (count, turns, longest, cache hit
 * rate as a d3 arc gauge, with its verdict in words and the re-read change under it).
 * Libraries: uPlot + a d3 subset (src/vendor/, credited in tools/third-party-notices.js)
 * are loaded on first show only, so app start doesn't pay for them. Performance: stats load when
 * the Usage section is first shown (not on app start, no polling; Refresh re-reads). Charts are
 * rebuilt only when the numbers change, resized on a debounced ResizeObserver, recolored when the
 * accent changes; no timers while idle. Updated/Refresh sit in the section head.
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.usage?.stats) return;
  const mount = document.getElementById('tnaiUsageMount');
  if (!mount) return;

  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const fmtTok = n =>
    window.TnaiTurns?.format?.tokens
      ? window.TnaiTurns.format.tokens(Math.max(0, Math.round(n || 0)))
      : String(Math.max(0, Math.round(n || 0)));
  const fmtFull = n => new Intl.NumberFormat().format(Math.max(0, Math.round(n || 0)));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CLI_LABEL = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    'cursor-agent': 'Cursor',
    'gemini-cli': 'Gemini CLI',
    droid: 'Droid',
    opencode: 'OpenCode',
    'github-copilot': 'GitHub Copilot',
  };
  const cliName = c => CLI_LABEL[c] || c;

  // ---- vendored chart libraries, loaded once on first show (classic scripts; no CDN) ----
  let libs = null;
  const addScript = src =>
    new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error('Could not load ' + src));
      document.head.append(s);
    });

  function loadLibs() {
    if (!libs)
      libs = (async () => {
        if (!document.querySelector('link[data-uplot-css]')) {
          const l = document.createElement('link');
          l.rel = 'stylesheet';
          l.href = 'src/vendor/uplot/uPlot.min.css';
          l.dataset.pg = '';
          l.dataset.uplotCss = '';
          document.head.append(l);
        }
        await Promise.all([
          window.uPlot ? 0 : addScript('src/vendor/uplot/uPlot.iife.min.js'),
          window.d3?.scaleRadial ? 0 : addScript('src/vendor/d3/d3-charts.min.js'),
        ]);
      })().catch(err => {
        libs = null;
        throw err;
      });
    return libs;
  }

  // ---- numbers from days[] (oldest first, zero-filled, 90 days) ----
  const used = d => (d?.input || 0) + (d?.output || 0) + (d?.cacheWrite || 0);
  const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
  const tail = (arr, n, offset = 0) => {
    const end = Math.max(0, arr.length - offset),
      start = Math.max(0, end - n);
    return arr.slice(start, end);
  };
  const dayOf = d => new Date(d.date + 'T00:00:00');
  const shortDate = d => dayOf(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hourName = h => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

  function change(curr, prev) {
    if (prev <= 0)
      return curr > 0
        ? '<small class="uz-chg" title="No data for the period before to compare">New</small>'
        : '<small class="uz-chg">—</small>';
    const d = Math.round(((curr - prev) / prev) * 100),
      dir = d > 0 ? 'up' : d < 0 ? 'down' : '';

    // past +999% a multiple says more
    const text = d > 999 ? Math.round(curr / prev) + '×' : Math.abs(d) + '%';
    return `<small class="uz-chg ${dir}" title="${esc(fmtFull(curr))} tokens vs ${esc(fmtFull(prev))} in the period before">${d > 0 ? '↑' : d < 0 ? '↓' : '·'} ${text}</small>`;
  }

  // ---- colors for the canvas charts (SVG uses the CSS tokens directly) ----
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const rgba = (rgb, a) => (rgb.includes(',') ? `rgba(${rgb},${a})` : `rgb(${rgb} / ${a})`);

  function palette() {
    const rgb = cssVar('--pg-accent-rgb') || '167,139,250';
    return {
      rgb,
      accent: cssVar('--pg-accent'),
      accent2: cssVar('--pg-accent-2'),
      text3: cssVar('--pg-text-3'),
      text4: cssVar('--pg-text-4'),
      line: cssVar('--pg-line'),
      panel: cssVar('--pg-panel-solid') || '#15121f',
      mono: cssVar('--pg-mono') || 'monospace',
    };
  }

  // ---- markup ----
  const card = (area, title, help, body, meta = '') =>
    `<section class="uz-card" data-area="${area}"><header class="uz-card-head"><div><h3>${esc(title)}</h3>${help ? `<p>${esc(help)}</p>` : ''}</div>${meta}</header>${body}</section>`;
  const legend = items =>
    `<div class="uz-legend">${items.map(([cls, text]) => `<span><i class="${cls}"></i>${esc(text)}</span>`).join('')}</div>`;

  function heroHtml(days) {
    const today = days[days.length - 1],
      yest = days[days.length - 2];
    const kpis = [
      ['Today', used(today), used(yest), 'vs. yesterday'],
      ['Last 7 days', sum(tail(days, 7), used), sum(tail(days, 7, 7), used), 'vs. the 7 before'],
      [
        'Last 30 days',
        sum(tail(days, 30), used),
        sum(tail(days, 30, 30), used),
        'vs. the 30 before',
      ],
    ];
    const last30 = tail(days, 30),
      peak = last30.reduce((a, d) => (used(d) > used(a) ? d : a), last30[0] || {});
    const meta = used(peak)
      ? `<small class="uz-meta">Peak <b>${fmtTok(used(peak))}</b> on ${esc(shortDate(peak))}</small>`
      : '';
    return `<section class="uz-card uz-hero" data-area="hero"><div class="uz-kpis">${kpis.map(([label, tok, prev, vs], i) => `<div class="uz-kpi" data-k="${i}" title="Input + output + cache-written tokens, ${esc(vs)}"><span>${esc(label)}</span><b data-count="${Math.round(tok)}">${fmtTok(tok)}</b>${change(tok, prev)}</div>`).join('')}</div>
<div class="uz-hero-chart"><header class="uz-card-head"><div><h3>Daily usage</h3><p>Last 30 days · input + output + cache-written tokens.</p></div>${meta}</header>${legend(
      [
        ['uz-sw-a', 'Tokens'],
        ['uz-sw-avg', '7-day average'],
      ]
    )}<div class="uz-plot" data-plot="daily"><div class="uz-tip" hidden></div></div></div></section>`;
  }

  function wowHtml(days) {
    const thisWeek = tail(days, 7),
      lastWeek = tail(days, 7, 7);
    const a = sum(thisWeek, used),
      b = sum(lastWeek, used);
    const meta = `<small class="uz-meta">${change(a, b)}</small>`;
    return card(
      'wow',
      'This week vs. last week',
      'Same weekday, one week apart.',
      legend([
        ['uz-sw-a', 'This week'],
        ['uz-sw-prev', 'Last week'],
      ]) + '<div class="uz-plot" data-plot="wow"><div class="uz-tip" hidden></div></div>',
      meta
    );
  }

  // Busiest hours: 24 arc bars around a clock face, length on a radial scale (area ∝ tokens).
  function hoursHtml(hours) {
    const d3 = window.d3,
      max = Math.max(0, ...hours),
      total = sum(hours, v => v);
    if (!total)
      return card(
        'hrs',
        'Busiest hours',
        'Local time, last 30 days.',
        '<p class="uz-state">No turns in the last 30 days.</p>'
      );
    const R0 = 58,
      R1 = 106,
      y = d3
        .scaleRadial()
        .domain([0, max])
        .range([R0 + 2, R1]),
      step = (Math.PI * 2) / 24;
    const arc = d3
      .arc()
      .innerRadius(R0)
      .padAngle(0.035)
      .padRadius(R0 + 30)
      .cornerRadius(3);
    const peakH = hours.indexOf(max);
    const bars = hours
      .map((v, h) => {
        const a = { startAngle: h * step, endAngle: (h + 1) * step };
        const k = v / max,
          fill = `color-mix(in oklch, var(--pg-accent-2) ${Math.round(28 + k * 72)}%, var(--pg-accent-soft))`;
        return `<path class="uz-hr-track" d="${arc.outerRadius(R1)(a)}"/><path class="uz-hr${h === peakH ? ' peak' : ''}" data-h="${h}" data-v="${v}" style="fill:${fill}" d="${arc.outerRadius(v ? y(v) : R0 + 2)(a)}"><title>${esc(hourName(h))} · ${esc(fmtFull(v))} tokens</title></path>`;
      })
      .join('');
    const ticks = [0, 6, 12, 18]
      .map(h => {
        const ang = h * step - Math.PI / 2,
          r = R1 + 12;
        return `<text class="uz-hr-tick" x="${(Math.cos(ang) * r).toFixed(1)}" y="${(Math.sin(ang) * r).toFixed(1)}">${esc(hourName(h))}</text>`;
      })
      .join('');
    const center = `<g class="uz-center"><text class="uz-c-big" y="-1">${esc(hourName(peakH))}</text><text class="uz-c-small" y="16">busiest · ${esc(fmtTok(max))}</text></g>`;
    return card(
      'hrs',
      'Busiest hours',
      'Local time, last 30 days.',
      `<div class="uz-svgwrap"><svg class="uz-radial" viewBox="-130 -130 260 260" role="img" aria-label="Tokens by hour of day, busiest at ${esc(hourName(peakH))}"><g class="uz-bloom">${bars}</g>${ticks}${center}</svg></div>`
    );
  }

  // Where tokens went: models donut (top 5 + other), the CLI split as a thin outer ring.
  function modelsHtml(models) {
    const d3 = window.d3,
      total = sum(models, m => m.tokens);
    if (!total)
      return card(
        'mod',
        'Where tokens went',
        'By model and tool, from the logs on this PC.',
        '<p class="uz-state">No model usage recorded yet.</p>'
      );
    const top = models.slice(0, 5),
      rest = sum(models.slice(5), m => m.tokens);
    const slices = top.map((m, i) => ({
      name: m.model,
      sub: cliName(m.cli),
      tokens: m.tokens,
      turns: m.turns,
      color: `color-mix(in oklch, var(--pg-accent-2) ${100 - i * 19}%, var(--pg-accent-soft))`,
    }));
    if (rest > 0)
      slices.push({
        name: 'Other models',
        sub: models.length - 5 + ' more',
        tokens: rest,
        color: 'var(--pg-text-4)',
      });
    const byCli = new Map();
    for (const m of models) byCli.set(m.cli, (byCli.get(m.cli) || 0) + m.tokens);
    const clis = [...byCli].sort((a, b) => b[1] - a[1]).map(([cli, tokens]) => ({ cli, tokens }));
    const pie = d3
      .pie()
      .sort(null)
      .value(s => s.tokens)
      .padAngle(0.018);
    const arc = d3.arc().innerRadius(64).outerRadius(96).cornerRadius(4),
      ring = d3.arc().innerRadius(103).outerRadius(107).cornerRadius(2);
    const share = t => Math.round((t / total) * 100);
    const segs = pie(slices)
      .map(
        (a, i) =>
          `<path class="uz-seg" data-i="${i}" style="fill:${a.data.color}" d="${arc(a)}"><title>${esc(a.data.name)} · ${esc(fmtFull(a.data.tokens))} tokens · ${share(a.data.tokens)}%</title></path>`
      )
      .join('');
    const ringSegs = d3
      .pie()
      .sort(null)
      .value(c => c.tokens)
      .padAngle(0.03)(clis)
      .map(
        a =>
          `<path class="uz-cli" data-cli="${esc(a.data.cli)}" d="${ring(a)}"><title>${esc(cliName(a.data.cli))} · ${share(a.data.tokens)}%</title></path>`
      )
      .join('');
    const center = `<g class="uz-center"><text class="uz-c-big" y="-2">${esc(fmtTok(total))}</text><text class="uz-c-small" y="16">tokens</text></g>`;
    const rows = slices
      .map(
        (s, i) =>
          `<li data-i="${i}" title="${esc(s.name)} · ${esc(fmtFull(s.tokens))} tokens${s.turns ? ' · ' + s.turns + ' turn' + (s.turns === 1 ? '' : 's') : ''}"><i style="background:${s.color}"></i><span><b>${esc(s.name)}</b><small>${esc(s.sub)}</small></span><em>${share(s.tokens)}%</em></li>`
      )
      .join('');
    const split = clis
      .map(
        c =>
          `<span><i class="uz-cli-sw" data-cli="${esc(c.cli)}"></i>${esc(cliName(c.cli))} ${share(c.tokens)}%</span>`
      )
      .join('');
    const data = encodeURIComponent(
      JSON.stringify(slices.map(s => [s.name, fmtTok(s.tokens), share(s.tokens)]))
    );
    return card(
      'mod',
      'Where tokens went',
      'By model, ringed by tool. Logs from about the last 3 months.',
      `<div class="uz-mod"><div class="uz-svgwrap"><svg class="uz-donut" viewBox="-115 -115 230 230" role="img" aria-label="Token share by model" data-slices="${data}" data-total="${esc(fmtTok(total))}"><g class="uz-spin">${segs}${ringSegs}</g>${center}</svg></div><div class="uz-mod-side"><ol class="uz-mod-list">${rows}</ol><div class="uz-split">${split}</div></div></div>`
    );
  }

  function projectsHtml(projects, total30) {
    if (!projects.length)
      return card(
        'prj',
        'Top projects',
        'Last 30 days, by the folder the agent ran in.',
        '<p class="uz-state">No project usage recorded yet.</p>'
      );
    const x = window.d3
      .scaleLinear()
      .domain([0, projects[0].tokens || 1])
      .range([0, 100]);
    const rows = projects
      .map(
        (p, i) =>
          `<li style="--i:${i}" title="${esc(p.name)} · ${esc(fmtFull(p.tokens))} tokens"><span class="uz-rank">${i + 1}</span><b>${esc(p.name)}</b><span class="uz-bar"><i style="--w:${Math.max(1.5, x(p.tokens)).toFixed(1)}%"></i></span><em>${fmtTok(p.tokens)}</em><small>${total30 ? Math.round((p.tokens / total30) * 100) + '%' : ''}</small></li>`
      )
      .join('');
    return card(
      'prj',
      'Top projects',
      'Last 30 days, by the folder the agent ran in.',
      `<ol class="uz-prj">${rows}</ol>`
    );
  }

  // Sessions: the numbers, and the cache hit rate as a half-arc gauge.
  // The gauge in words, so that the reader knows whether the number is good or bad: a
  // verdict on the rate as it is shown, and the re-read amount against the 30 days before (days[]
  // carries cacheRead per day). No verdict without cache numbers, no trend without an earlier
  // period.
  const VERDICTS = [
    [
      90,
      'good',
      'Good',
      'cache is working',
      '90% or more of the context your agents sent again came from the cache, which is billed at a fraction of fresh input. Nothing to fix here.',
    ],
    [
      70,
      'fair',
      'Fair',
      'some sent fresh',
      '70 to 89% of the context your agents sent again came from the cache. Agents picked up after a long idle time, and many short sessions, send more of it fresh at full price.',
    ],
    [
      0,
      'low',
      'Low',
      'much sent fresh',
      'Less than 70% of the context your agents sent again came from the cache, so much of it was billed at full price. Usual causes: agents picked up after a long idle time, and many short sessions.',
    ],
  ];

  function sessionsHtml(s, cache, days) {
    const d3 = window.d3,
      rate = Math.max(0, Math.min(1, cache.hitRate || 0));
    const v =
      cache.read || cache.write || rate ? VERDICTS.find(x => Math.round(rate * 100) >= x[0]) : null;
    const verdict = v
      ? `<small class="uz-verdict ${v[1]}" title="${esc(v[4])}"><b>${v[2]}</b> · ${v[3]}</small>`
      : '';
    const readPrev = sum(tail(days, 30, 30), d => d.cacheRead || 0);
    const trend =
      readPrev > 0
        ? `<small class="uz-reread" title="Cached context re-read in the last 30 days against the 30 days before. Every turn re-reads the whole conversation, so shorter conversations (/compact or /clear between tasks) and fewer agents at once lower it.">Re-read ${change(cache.read, readPrev)} on last month</small>`
        : '';
    const base = d3
      .arc()
      .innerRadius(58)
      .outerRadius(70)
      .cornerRadius(6)
      .startAngle(-Math.PI / 2);
    const gauge = `<svg class="uz-gauge" viewBox="-80 -78 160 90" role="img" aria-label="Cache hit rate ${Math.round(rate * 100)}%"><path class="uz-g-track" d="${base.endAngle(Math.PI / 2)()}"/><path class="uz-g-fill" d="${base.endAngle(-Math.PI / 2 + Math.PI * rate)()}"/><text class="uz-c-big" y="-10">${Math.round(rate * 100)}%</text><text class="uz-c-small" y="6">cache hit rate</text></svg>`;
    const avg = s.count ? Math.round(s.avgTurns * 10) / 10 : 0;
    const facts = [
      ['Sessions', String(s.count || 0), 'last 30 days'],
      ['Turns per session', String(avg), 'average'],
      [
        'Longest session',
        (s.longest?.turns || 0) + ' turns',
        'peak context ' + fmtTok(s.longest?.peakContext || 0),
      ],
    ];
    return card(
      'ses',
      'Sessions',
      'Last 30 days.',
      `<div class="uz-ses"><dl>${facts.map(([k, v, n]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}<small>${esc(n)}</small></dd></div>`).join('')}</dl><div class="uz-gauge-wrap" title="Share of context re-read from cache instead of sent fresh, last 30 days">${gauge}${verdict}<small>${esc(fmtTok(cache.read))} re-read · ${esc(fmtTok(cache.write))} written</small>${trend}</div></div>`
    );
  }

  // ---- uPlot charts ----
  const plots = [];

  function destroyPlots() {
    while (plots.length) plots.pop().u.destroy();
  }

  function sizeOf(el) {
    const r = el.getBoundingClientRect();
    return { width: Math.max(0, Math.floor(r.width)), height: Math.max(120, Math.floor(r.height)) };
  }
  const spline = () => (window.uPlot.paths.spline ? window.uPlot.paths.spline() : undefined);

  function niceMax(max) {
    if (!(max > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max))),
      m = max / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  function baseOpts(pal, size, xAxis) {
    const font = '500 10.5px ' + pal.mono;
    return {
      ...size,
      padding: [10, 10, 0, 2],
      legend: { show: false },
      select: { show: false },
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: { size: 9, width: 2, stroke: () => pal.accent2, fill: () => pal.panel },
      },
      scales: { y: { range: (u, min, max) => [0, niceMax(max)] } },
      axes: [
        {
          stroke: pal.text4,
          font,
          grid: { show: false },
          ticks: { show: false },
          gap: 6,
          size: 26,
          ...xAxis,
        },
        {
          stroke: pal.text4,
          font,
          grid: { stroke: pal.line, width: 1, dash: [2, 5] },
          ticks: { show: false },
          size: 46,
          gap: 4,
          space: 34,
          values: (u, vals) => vals.map(v => fmtTok(v)),
        },
      ],
    };
  }
  const gradFill = (pal, top, bottom) => u => {
    const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    g.addColorStop(0, rgba(pal.rgb, top));
    g.addColorStop(1, rgba(pal.rgb, bottom));
    return g;
  };

  // Hover readout: one small glass box that follows the cursor (transform only, so hover stays at
  // 60 fps).
  function tipper(host, html) {
    const tip = host.querySelector('.uz-tip');
    return u => {
      const i = u.cursor.idx;
      if (i == null || u.cursor.left < 0) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = html(i);
      tip.hidden = false;
      const x = u.valToPos(u.data[0][i], 'x') + u.over.offsetLeft,
        w = tip.offsetWidth,
        W = host.clientWidth;
      tip.style.transform = `translate(${Math.round(Math.min(Math.max(0, x - w / 2), W - w))}px,0)`;
    };
  }

  function buildPlots(stats) {
    destroyPlots();
    const U = window.uPlot,
      pal = palette(),
      days = stats.days || [];
    const dailyHost = body.querySelector('[data-plot=daily]'),
      wowHost = body.querySelector('[data-plot=wow]');
    if (dailyHost) {
      const last30 = tail(days, 30),
        off = days.length - last30.length;
      const xs = last30.map(d => dayOf(d).getTime() / 1000),
        ys = last30.map(used);
      const avg = last30.map((d, i) => {
        const w = days.slice(Math.max(0, off + i - 6), off + i + 1);
        return sum(w, used) / (w.length || 1);
      });
      const opts = baseOpts(pal, sizeOf(dailyHost), {
        space: 70,
        values: (u, vals) =>
          vals.map(v =>
            new Date(v * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          ),
      });
      opts.scales.x = { time: true };
      opts.series = [
        {},
        {
          stroke: pal.accent2,
          width: 2,
          fill: gradFill(pal, 0.42, 0.02),
          paths: spline(),
          points: { show: false },
        },
        { stroke: pal.text3, width: 1.25, dash: [4, 4], paths: spline(), points: { show: false } },
      ];
      opts.hooks = {
        setCursor: [
          tipper(dailyHost, i => {
            const d = last30[i];
            return `<b>${esc(dayOf(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</b><span>${esc(fmtFull(used(d)))} tokens</span><small>${d.turns || 0} turn${d.turns === 1 ? '' : 's'} · ${d.sessions || 0} session${d.sessions === 1 ? '' : 's'} · 7-day avg ${esc(fmtTok(avg[i]))}</small>`;
          }),
        ],
      };
      plots.push({ host: dailyHost, u: new U(opts, [xs, ys, avg], dailyHost) });
    }
    if (wowHost) {
      const thisWeek = tail(days, 7),
        lastWeek = tail(days, 7, 7);
      const xs = thisWeek.map((d, i) => i),
        names = thisWeek.map(d => dayOf(d).toLocaleDateString(undefined, { weekday: 'short' }));
      const a = thisWeek.map(used),
        b = thisWeek.map((d, i) => (lastWeek.length === 7 ? used(lastWeek[i]) : null));
      const opts = baseOpts(pal, sizeOf(wowHost), {
        space: 30,
        values: (u, vals) => vals.map(v => names[v] ?? ''),
      });
      opts.scales.x = { time: false, range: [-0.25, 6.25] };
      opts.series = [
        {},
        {
          stroke: pal.accent2,
          width: 2.25,
          fill: gradFill(pal, 0.3, 0.01),
          paths: spline(),
          points: { show: true, size: 6, width: 0, fill: pal.accent2 },
        },
        {
          stroke: pal.text3,
          width: 1.5,
          dash: [5, 4],
          paths: spline(),
          points: { show: true, size: 5, width: 0, fill: pal.text3 },
        },
      ];
      opts.hooks = {
        setCursor: [
          tipper(wowHost, i => {
            const cur = a[i],
              prev = b[i];
            return `<b>${esc(names[i])}</b><span>${esc(fmtFull(cur))} this week</span><small>${prev == null ? 'No data a week before' : esc(fmtFull(prev)) + ' a week before'}</small>`;
          }),
        ],
      };
      plots.push({ host: wowHost, u: new U(opts, [xs, a, b], wowHost) });
    }
  }

  // Resize: debounced, and only when a chart's box really changed (a hidden panel reports 0 and is
  // skipped).
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const p of plots) {
        const s = sizeOf(p.host);
        if (s.width && (s.width !== p.u.width || s.height !== p.u.height)) p.u.setSize(s);
      }
    }, 140);
  });
  ro.observe(mount);

  // Accent picked → recolor the canvas charts (SVG follows the CSS tokens by itself).
  new MutationObserver(() => {
    if (plots.length && lastStats) buildPlots(lastStats);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });

  // ---- SVG hover: the centre of the radial and the donut reads out the hovered part ----
  function wireSvg() {
    const radial = body.querySelector('.uz-radial');
    if (radial) {
      const big = radial.querySelector('.uz-c-big'),
        small = radial.querySelector('.uz-c-small'),
        rest = [big.textContent, small.textContent];
      radial.addEventListener('pointerover', e => {
        const p = e.target.closest('.uz-hr');
        if (!p) return;
        big.textContent = hourName(+p.dataset.h);
        small.textContent = fmtTok(+p.dataset.v) + ' tokens';
      });
      radial.addEventListener('pointerleave', () => {
        [big.textContent, small.textContent] = rest;
      });
    }
    const donut = body.querySelector('.uz-donut'),
      list = body.querySelector('.uz-mod-list');
    if (donut) {
      const slices = JSON.parse(decodeURIComponent(donut.dataset.slices)),
        big = donut.querySelector('.uz-c-big'),
        small = donut.querySelector('.uz-c-small');
      const show = i => {
        donut.classList.toggle('hovering', i != null);
        list?.classList.toggle('hovering', i != null);
        body
          .querySelectorAll('.uz-seg.on,.uz-mod-list li.on')
          .forEach(el => el.classList.remove('on'));
        if (i == null) {
          big.textContent = donut.dataset.total;
          small.textContent = 'tokens';
          return;
        }
        body
          .querySelectorAll(`.uz-seg[data-i="${i}"],.uz-mod-list li[data-i="${i}"]`)
          .forEach(el => el.classList.add('on'));
        big.textContent = slices[i][2] + '%';
        small.textContent =
          slices[i][0].length > 18 ? slices[i][0].slice(0, 17) + '…' : slices[i][0];
      };
      const over = e => {
        const t = e.target.closest('[data-i]');
        if (t) show(+t.dataset.i);
      };
      donut.addEventListener('pointerover', over);
      list?.addEventListener('pointerover', over);
      donut.addEventListener('pointerleave', () => show(null));
      list?.addEventListener('pointerleave', () => show(null));
    }
  }

  // Count the three totals up once when the page first draws (a rolling number, then it stops).
  function countUp() {
    if (reduced()) return;
    const els = [...body.querySelectorAll('.uz-kpi b[data-count]')],
      t0 = performance.now(),
      D = 700;
    const step = now => {
      const k = Math.min(1, (now - t0) / D),
        e = 1 - Math.pow(1 - k, 3);
      els.forEach(el => {
        el.textContent = fmtTok(+el.dataset.count * e);
      });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function emptyHtml(sources) {
    const where = (sources || []).map(s => `${cliName(s.cli)}: ${s.root}`).join(' · ');
    return `<p class="uz-state">No agent logs found on this PC yet. Usage shows up after your first Claude Code, Codex or OpenCode session.${where ? `<small>${esc(where)}</small>` : ''}</p>`;
  }

  let drawnKey = '';

  function render(stats) {
    if (!(stats.sources || []).some(s => s.found)) {
      destroyPlots();
      drawnKey = '';
      body.innerHTML = emptyHtml(stats.sources);
      return;
    }
    const key = JSON.stringify([
      stats.days,
      stats.models,
      stats.hours,
      stats.projects,
      stats.sessions,
      stats.cache,
    ]);
    if (key === drawnKey) return; // same numbers: keep what is drawn
    const first = !drawnKey;
    drawnKey = key;
    destroyPlots();
    const days = stats.days || [],
      total30 = sum(tail(days, 30), used);
    body.innerHTML =
      heroHtml(days) +
      wowHtml(days) +
      hoursHtml(stats.hours || new Array(24).fill(0)) +
      modelsHtml(stats.models || []) +
      projectsHtml(stats.projects || [], total30) +
      sessionsHtml(
        stats.sessions || { count: 0, avgTurns: 0, longest: {} },
        stats.cache || { read: 0, write: 0, hitRate: 0 },
        days
      );
    body.classList.remove('uz-enter');
    void body.offsetWidth;
    body.classList.add('uz-enter');
    buildPlots(stats);
    wireSvg();
    if (first) countUp();
  }

  mount.innerHTML = `<div class="tnai-usage-head"><span>Updated <span data-updated>—</span></span><button type="button" class="button" data-act="refresh">Refresh</button></div><div class="uz-body"></div>`;
  const body = mount.querySelector('.uz-body'),
    refreshBtn = mount.querySelector('[data-act=refresh]'),
    updatedEl = mount.querySelector('[data-updated]');
  mount
    .closest('.settings-panel')
    ?.querySelector('.settings-section-head')
    ?.append(mount.querySelector('.tnai-usage-head'));
  const ago = at => {
    const s = Math.max(0, (Date.now() - at) / 1000);
    return s < 45
      ? 'just now'
      : s < 3600
        ? Math.round(s / 60) + ' min ago'
        : new Date(at).toLocaleString();
  };

  let loading = false,
    loaded = false,
    lastStats = null;

  async function load() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
    if (!loaded) body.innerHTML = '<p class="uz-state uz-loading">Loading token usage…</p>';
    try {
      const [stats] = await Promise.all([native.usage.stats(), loadLibs()]);
      lastStats = stats;
      loaded = true;
      render(stats);
      updatedEl.textContent = ago(stats.generatedAt || Date.now());
    } catch (err) {
      destroyPlots();
      drawnKey = '';
      body.innerHTML = `<p class="uz-state">Could not read token usage.<small>${esc(err?.message || String(err))}</small></p>`;
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  }
  refreshBtn.addEventListener('click', load);

  // Loads only when Settings › Usage is actually shown (22 toggles `hidden` on its panels; it also
  // un-hides the saved tab while Settings is closed).
  const panel = mount.closest('.settings-panel');
  if (panel) {
    const layoutEl = document.querySelector('.layout');
    const onShown = () => {
      if (panel.hidden || !layoutEl?.classList.contains('settings-mode')) return;
      if (!loaded) load();
      else if (lastStats) {
        const t = lastStats.generatedAt || Date.now(),
          d = new Date(t);
        if (Date.now() - t > 300000 || d.toDateString() !== new Date().toDateString())
          load(); // a day behind after midnight otherwise ("Today", "vs. yesterday")
        else updatedEl.textContent = ago(t);
      }
    };
    new MutationObserver(onShown).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('tnai:settings-page-shown', onShown);
    onShown();
  }
})();
