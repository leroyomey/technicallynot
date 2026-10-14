/*
 * Technically Not · 98-account-gauges.js — the Overview's AI accounts card as fuel gauges.
 * One lane per account (1–4): its CLI
 * tile, name and plan, then one horizontal gauge per limit window, Session (5-hour) first, then
 * Week (or the window's own length, e.g. Codex 30-day). Each gauge: % used (amber from 80, red from
 * 95), a tick for how much of the window has gone by (burn rate: fill past the tick = using faster
 * than time passes), and "resets in …". A stale reading is dimmed; hover says it is the last good
 * reading. Real data only: 94's rings() list (80 TnaiPlanLimits per 15 TnaiAccounts account). 94's
 * paintAccounts calls paint() on every render and once a second; the lanes are rebuilt only when
 * the accounts or windows change, otherwise values update in place (so bar widths animate). Look:
 * src/styles/17-account-gauges-purple.css.
 */
(() => {
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const winName = w =>
    w.minutes === 300
      ? 'Session'
      : w.minutes === 10080
        ? 'Week'
        : w.minutes % 1440 === 0
          ? w.minutes / 1440 + '-day'
          : Math.round(w.minutes / 60) + '-hour';
  const winLen = w =>
    w.minutes === 300
      ? '5-hour window'
      : w.minutes === 10080
        ? '7-day window'
        : winName(w) + ' window';
  const left = at => {
    const m = Math.max(0, Math.round((at - Date.now()) / 60000));
    if (m >= 2880) return Math.round(m / 1440) + 'd';
    if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    return m < 1 ? 'under 1m' : m + 'm';
  };
  const ago = at => {
    const s = Math.max(0, (Date.now() - at) / 1000);
    return s < 45
      ? 'just now'
      : s < 3600
        ? Math.round(s / 60) + ' min ago'
        : s < 86400
          ? Math.round(s / 3600) + ' h ago'
          : new Date(at).toLocaleString();
  };
  const level = p => (p >= 95 ? 'crit' : p >= 80 ? 'hot' : '');
  const NOTE = {
    noreading: 'Shows after this account’s next reply',
    expired: 'Sign-in needs a refresh (Settings › Accounts)',
  };

  // the windows a lane shows: Session first, then the rest (at most two, as the rings did)
  const winsOf = a => (a.ok ? [a.outer, a.inner].filter(Boolean) : []);

  // share of the window already gone (0–1), from its reset time; null when the reset time is
  // unknown
  const gone = w => {
    if (!w.resetsAt || !w.minutes) return null;
    const span = w.minutes * 60000;
    return Math.max(0, Math.min(1, 1 - (w.resetsAt - Date.now()) / span));
  };

  function gaugeTip(a, w) {
    const used = Math.round(w.used),
      g = gone(w);
    const lines = [winName(w) + ' · ' + winLen(w) + ': ' + used + '% used'];
    if (g != null) {
      lines.push(Math.round(g * 100) + '% of the window has gone by (the tick)');
      if (g > 0.05) {
        const pace = Math.round(used / g);
        lines.push(
          pace > 100
            ? 'At this pace it runs out before it resets'
            : 'At this pace: about ' + pace + '% by the reset'
        );
      }
      lines.push('Resets in ' + left(w.resetsAt));
    } else if (w.resetSinceReading) lines.push('Reset since the last reading');
    if (a.stale)
      lines.push(
        'Last good reading' + (a.at ? ', as of ' + ago(a.at) : '') + ': the latest check failed'
      );
    return lines.join('\n');
  }

  function laneHTML(a, i) {
    const ws = winsOf(a),
      tile = (a.nm || '?').trim()[0]?.toUpperCase() || '?';
    const acct = String(a.plan || '')
        .split(' · ')
        .slice(1)
        .join(' · '),
      stale = a.stale ? ' Last good reading' + (a.at ? ', as of ' + ago(a.at) : '') + '.' : '';
    const who = `<div class="ag-who"><span class="ag-ic" style="--c:${esc(a.col)}" aria-hidden="true">${esc(tile)}</span><div class="ag-nm"><b>${esc(a.nm)}</b><small>${esc(a.plan || '')}</small></div></div>`;
    const body = ws.length
      ? ws
          .map(
            (w, j) =>
              `<div class="ag-w ${w.minutes === 300 || j === 0 ? 's' : 'k'}" data-g="${i}-${j}"><span class="ag-l">${esc(winName(w))}</span><span class="ag-r"></span><span class="ag-p"></span><span class="ag-tr"><i class="ag-f"></i><i class="ag-m"></i></span></div>`
          )
          .join('')
      : `<div class="ag-note">${esc(NOTE[a.status] || 'Not available right now')}</div>`;
    return `<div class="ag-acct${a.stale ? ' stale' : ''}${ws.length ? '' : ' off'}" data-a="${i}" title="${esc(a.nm + (a.plan ? ' · ' + a.plan : '') + '.' + stale)}">${who}<div class="ag-wins">${body}${acct ? `<div class="ag-acc">${esc(acct)}</div>` : ''}</div></div>`;
  }

  // a.plan is "<Plan> plan · <account name or email>" (94 adds the account part when a CLI has 2+
  // accounts): the narrow card shows that account part under the gauges
  const key = list =>
    JSON.stringify(list.map(a => [a.nm, a.plan, a.status, a.stale, winsOf(a).map(w => w.minutes)]));

  function update(el, list) {
    list.forEach((a, i) =>
      winsOf(a).forEach((w, j) => {
        const g = el.querySelector(`[data-g="${i}-${j}"]`);
        if (!g) return;
        const used = Math.max(0, Math.min(100, Math.round(w.used))),
          t = gone(w),
          lv = level(used);
        const p = used + '%',
          r = w.resetsAt
            ? 'resets in ' + left(w.resetsAt)
            : w.resetSinceReading
              ? 'reset since reading'
              : '';
        if (g.children[2].textContent !== p) g.children[2].textContent = p;
        if (g.children[1].textContent !== r) g.children[1].textContent = r;
        if (g.dataset.lv !== lv) g.dataset.lv = lv;
        const f = g.querySelector('.ag-f'),
          m = g.querySelector('.ag-m');
        if (f.style.width !== used + '%') f.style.width = used + '%';
        m.hidden = t == null;
        if (t != null) m.style.left = (t * 100).toFixed(2) + '%';
        const tip = gaugeTip(a, w);
        if (g.title !== tip) g.title = tip;
      })
    );
  }
  const built = new WeakMap();
  const grown = new Set(); // list keys whose bars already grew in once

  function paint(el, list) {
    if (!el) return;
    if (!list.length) {
      if (built.get(el) !== 'empty') {
        built.set(el, 'empty');
        el.className = 'pgo-accts ag';
        el.innerHTML =
          '<div class="pgo-empty">No plan limits yet. Signed-in Claude Code and Codex accounts show their Session (5-hour) and Week use here (Settings › Accounts).</div>';
      }
      return;
    }
    const k = key(list);
    if (built.get(el) !== k) {
      built.set(el, k);
      el.className = 'pgo-accts ag ' + (list.length <= 2 ? 'roomy' : 'dense');
      el.style.setProperty('--n', list.length);
      el.innerHTML = list.map(laneHTML).join('');
      update(el, list);

      // A card rebuilt with the same accounts (Settings › Accounts re-renders twice on Check again)
      // keeps its bars: no second grow-in.
      const gk = list.map(a => a.nm).join('|'); // names only: the status changes while checking
      if (grown.has(gk)) return;
      grown.add(gk);

      // fill from empty: widths set above are replayed from 0 on the next frame, so every bar grows
      // in (reduced motion: 08 turns transitions off)
      const fills = [...el.querySelectorAll('.ag-f')],
        to = fills.map(f => f.style.width);
      fills.forEach(f => {
        f.style.width = '0%';
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          fills.forEach((f, n) => {
            f.style.width = to[n];
          })
        )
      );
      return;
    }
    update(el, list);
  }
  window.TnaiAcctGauges = { paint };
})();
