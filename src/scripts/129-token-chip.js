// Technically Not · 129-token-chip.js — Desktop only: the top bar's Tokens/min chip
// (#pgTokChip). Every 3 seconds, while the window is not hidden, it adds up the tokens each
// agent's turn reports gained (42 `TnaiTurns`: input + output + cache writes), keeps the last 60
// seconds per panel, and shows the sum with a small line of the last 14 readings. Moved out of the
// old Overview (94-overview-purple.js) on 2026-10-12, the counting unchanged, so that file could
// go. "Your usual at this hour" (the usage history, 59's source) is asked for when the pointer
// first comes over the chip, at most every 10 minutes, and then named in the tooltip only (its
// faint band behind the line read as a drawing fault and was removed).
// `window.TnaiTokenChip` (`tokensPerMinute`). Look: src/styles/07-purple-glass.css.
(() => {
  const native = window.tnaiNative;
  const chip = document.getElementById('pgTokChip');
  if (!native || !chip) return;

  const SAMPLE_MS = 3000;

  // How many readings the small line shows.
  const POINTS = 14;

  // paneId → the turn it was last read in and that turn's tokens then
  const seen = new Map();

  // paneId → the gains of the last 60 seconds ({ at, gained })
  const recent = new Map();
  const readings = [];
  let perMinute = 0;
  let usual = 0;
  let usualAskedAt = 0;

  const short = count =>
    count >= 1e6
      ? (count / 1e6).toFixed(1) + 'M'
      : count >= 1000
        ? (count / 1000).toFixed(1) + 'k'
        : String(Math.round(count));

  const sessions = () => {
    try {
      return window.TnaiAgents?.sessions?.() || [];
    } catch {
      return [];
    }
  };

  const turnTokens = turn => {
    const tokens = turn?.tokens || {};
    return (tokens.input || 0) + (tokens.output || 0) + (tokens.cacheWrite || 0);
  };

  // The small line: a smooth curve through the readings with a soft fill under it and a dot on
  // the newest.
  function drawLine(svg, values, width, height) {
    if (!svg || !values.length) return;
    const top = Math.max(...values, 1e-9);
    const step = width / Math.max(1, values.length - 1);
    const points = values.map((value, index) => [
      index * step,
      height - 2 - (value / top) * (height - 4),
    ]);
    let path = 'M' + points[0][0].toFixed(1) + ',' + points[0][1].toFixed(1);
    for (let index = 1; index < points.length; index++) {
      const [x0, y0] = points[index - 1];
      const [x1, y1] = points[index];
      const middle = ((x0 + x1) / 2).toFixed(1);
      path += ` C${middle},${y0.toFixed(1)} ${middle},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    const last = points[points.length - 1];
    const color = 'currentColor';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML =
      `<defs><linearGradient id="tokChipFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${path} L${width},${height} L0,${height} Z" fill="url(#tokChipFill)"/>` +
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="1.5"/>` +
      `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="${color}"/>`;
  }

  function paint() {
    if (!window.TnaiTurns) return;
    if (!chip.querySelector('.v'))
      chip.innerHTML =
        '<span class="k">Tokens/min</span><span class="v"></span><svg aria-hidden="true"></svg>';
    const value = chip.querySelector('.v');
    const text = short(perMinute);
    if (value.textContent !== text) value.textContent = text;
    chip.title =
      "Tokens per minute across all agents (last 60 s, from each agent's turn reports: input + output + cache writes)" +
      (usual ? '\nYour usual at this hour: ' + short(usual) + '/min (last 30 days)' : '');
    drawLine(chip.querySelector('svg'), readings.length > 1 ? readings : [0, 0], 44, 14);

    // painted: the full look (a flag with no class; 83 takes the title off on hover, so the title
    // cannot mark it)
    chip.dataset.on = '1';
    chip.hidden = false;
  }

  function sample() {
    const now = Date.now();
    const list = sessions();
    let sum = 0;
    for (const session of list) {
      const turn = window.TnaiTurns?.get?.(session.paneId);
      const before = seen.get(session.paneId);
      let gained = 0;
      if (turn) {
        const total = turnTokens(turn);

        // a new turn counts whole, the same turn by what it grew; the first sight of a panel
        // counts nothing, since its tokens may be old
        gained = !before
          ? 0
          : before.start !== turn.startedAt
            ? total
            : Math.max(0, total - before.total);
        seen.set(session.paneId, { start: turn.startedAt, total });
      }
      const kept = (recent.get(session.paneId) || []).filter(entry => now - entry.at < 60e3);
      if (gained) kept.push({ at: now, gained });
      recent.set(session.paneId, kept);
      sum += kept.reduce((all, entry) => all + entry.gained, 0);
    }
    const open = new Set(list.map(session => session.paneId));
    for (const id of [...recent.keys()])
      if (!open.has(id)) {
        seen.delete(id);
        recent.delete(id);
      }
    perMinute = sum;
    readings.push(perMinute);
    if (readings.length > POINTS) readings.shift();
    paint();
  }

  // The usage history is read from disk by the main process: only when someone looks.
  chip.addEventListener('mouseenter', () => {
    if (!native.usage?.stats || Date.now() - usualAskedAt < 600e3) return;
    usualAskedAt = Date.now();
    native.usage
      .stats()
      .then(stats => {
        usual = (stats?.hours?.[new Date().getHours()] || 0) / 30 / 60;
        paint();
      })
      .catch(() => {});
  });

  setInterval(() => {
    if (!document.hidden) sample();
  }, SAMPLE_MS);

  window.TnaiTokenChip = { tokensPerMinute: () => perMinute };
  sample();
})();
