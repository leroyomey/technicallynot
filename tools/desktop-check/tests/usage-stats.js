/*
 * Technically Not tools · desktop-check/tests/usage-stats.js — Settings › Usage
 * (59-usage-stats.js), against real fixture logs written by usage-stats.main.js (TNAI_USAGE_ROOTS,
 * read by desktop/usage-stats.js): the tab loads only when opened (not before), shows Today's exact
 * token total, models ranked, sessions and the charts (purple .uz dashboard); Refresh re-reads
 * without changing the numbers. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const tok = n => window.TnaiTurns?.format?.tokens?.(n) ?? String(n);
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

try {
  check(!!window.tnaiNative?.usage?.stats, 'window.tnaiNative.usage.stats() bridge is present');

  // `recent` holds 1440 per-minute buckets covering the last 24 h, equal to the fixture turns in
  // that window. (The old Overview's Token flow graph that read them is deleted with the Overview.)
  const st = await window.tnaiNative.usage.stats(),
    rc = st.recent || {};
  const fx = [
    [0, 9, 3500],
    [0, 10, 201800],
    [0, 11, 1900],
    [1, 9, 1200],
  ].map(([d, h, n]) => {
    const t = new Date();
    t.setDate(t.getDate() - d);
    t.setHours(h, 0, 0, 0);
    return [t.getTime(), n];
  });
  const want24 = fx
    .filter(([t]) => t >= rc.start && t < rc.start + 1440 * rc.stepMs)
    .reduce((a, [, n]) => a + n, 0);
  const got24 = (rc.tokens || []).reduce((a, n) => a + n, 0);
  check(
    rc.tokens?.length === 1440 && rc.stepMs === 60000 && got24 === want24,
    'usage stats carry 24 h of per-minute tokens over the last 24 h: ' +
      got24 +
      ' (want ' +
      want24 +
      ')'
  );
  window.TnaiSettings.open('accounts');
  await wait(150); // start on a different tab so Usage really loads on open, not on app start

  const mount = document.getElementById('tnaiUsageMount'),
    panelEl = document.getElementById('settingsPanel-usage');
  check(!!mount, 'Usage tab exists and mounts #tnaiUsageMount (desktop build)');
  check(
    !mount.querySelector('.tnai-usage-tiles') && !mount.querySelector('.tnai-usage-state'),
    'Usage content is not built before its tab is opened'
  );

  // The saved tab is Usage but Settings is closed (what 22 does at every launch): still nothing is
  // read.
  window.TnaiRoute?.('overview');
  await wait(50);
  document
    .getElementById(document.getElementById('settingsPanel-usage').getAttribute('aria-labelledby'))
    .click();
  await wait(200);
  check(
    !mount.querySelector('.tnai-usage-tiles') && !mount.querySelector('.tnai-usage-state'),
    'Usage tab selected while Settings is closed does not read logs'
  );

  window.TnaiSettings.open('usage');
  await wait(50);

  // Purple dashboard (59 .uz-*, 2026-09-29): hero KPIs + daily chart, week vs week, busiest hours,
  // where tokens went, top projects, sessions.
  const hero = await until(
    () => mount.querySelectorAll('.uz-kpi').length === 3 && mount.querySelector('.uz-hero'),
    8000
  );
  check(
    !!hero,
    'Usage tab loads its stats once opened: 3 KPIs (Today / Last 7 days / Last 30 days) and the daily chart'
  );

  // = 207200 (input+output+cache-write; cache-read apart)
  const todayTok = 1000 + 500 + 2000 + (1200 + 600 + 200000) + (1000 + 400 + 500);
  const todayKpi = () =>
    [...mount.querySelectorAll('.uz-kpi')].find(k =>
      /Today/.test(k.querySelector('span')?.textContent || '')
    );
  check(
    todayKpi()?.querySelector('b')?.dataset.count === String(todayTok),
    'Today KPI holds the exact total: ' +
      todayTok +
      ' (got ' +
      todayKpi()?.querySelector('b')?.dataset.count +
      ', shows ' +
      todayKpi()?.querySelector('b')?.textContent +
      ')'
  );
  const mod = mount.querySelector('.uz-card[data-area="mod"]')?.textContent || '';
  const at = n => mod.indexOf(n);
  check(
    at('claude-opus-5-5') >= 0 &&
      at('gpt-5-codex') > at('claude-opus-5-5') &&
      at('claude-sonnet-5') > at('gpt-5-codex'),
    'Where tokens went: models ranked highest first (opus, codex, sonnet)'
  );
  check(
    /Claude Code/.test(mod) && /Codex/.test(mod),
    'per-CLI split names both Claude Code and Codex'
  );
  const ses = [...mount.querySelectorAll('.uz-ses dl > div')].find(d =>
    /Sessions/.test(d.querySelector('dt')?.textContent || '')
  );
  check(
    /^3/.test(ses?.querySelector('dd')?.textContent || ''),
    'Sessions shows the session count: 3 (got ' + ses?.querySelector('dd')?.textContent + ')'
  );

  // The cache gauge in words: 192,550 re-read of 403,450 sent again = 48%, so "Low" in the error
  // color; 192,550 against 100,000 forty days ago = up 93%.
  const wrap = mount.querySelector('.uz-gauge-wrap'),
    verdict = wrap?.querySelector('.uz-verdict'),
    reread = wrap?.querySelector('.uz-reread');
  const errColor = (() => {
    const p = document.createElement('i');
    p.style.color = 'var(--pg-err)';
    wrap.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  })();
  check(
    /48%/.test(wrap?.querySelector('.uz-c-big')?.textContent || '') &&
      verdict?.classList.contains('low') &&
      /^Low · /.test(verdict.textContent) &&
      getComputedStyle(verdict.querySelector('b')).color === errColor &&
      !!verdict.title,
    'cache gauge says in words what its 48% means: "' +
      verdict?.textContent +
      '" in the error color, with a tooltip'
  );
  check(
    /^Re-read ↑ 93% on last month$/.test(reread?.textContent || '') && !!reread?.title,
    'under it, the re-read amount against the 30 days before: "' + reread?.textContent + '"'
  );
  const wr = wrap.getBoundingClientRect(),
    lines = [...wrap.querySelectorAll(':scope > small')].map(el => el.getBoundingClientRect());
  check(
    lines.length === 3 &&
      lines.every(
        (r, i) =>
          r.left >= wr.left - 0.5 &&
          r.right <= wr.right + 0.5 &&
          Math.abs((r.left + r.right) / 2 - (wr.left + wr.right) / 2) <= 1 &&
          (!i || r.top >= lines[i - 1].bottom) &&
          r.height === lines[0].height
      ),
    'the three lines under the gauge are centered, inside its column, one row each and do not overlap (' +
      lines.map(r => Math.round(r.width) + '×' + Math.round(r.height)).join(', ') +
      ' in ' +
      Math.round(wr.width) +
      ')'
  );
  wrap.scrollIntoView({ block: 'center' });
  await wait(1300);
  console.log('TNAI_SHOT:usage-stats-gauge');
  await wait(450); // the Sessions card is under the fold
  check(
    !!mount.querySelector('[data-plot="daily"]') &&
      !!mount.querySelector('[data-plot="wow"]') &&
      !!mount.querySelector('.uz-card[data-area="prj"], .uz-prj'),
    'daily and week-vs-week charts and Top projects are drawn'
  );
  const pg = document.getElementById('settingsPage');
  check(
    pg.scrollWidth <= pg.clientWidth + 1 && mount.scrollWidth <= mount.clientWidth + 1,
    'no sideways overflow at 1440×900'
  );
  console.log('TNAI_SHOT:usage-stats');
  await wait(450);
  await main('size', 1024, 768);
  await wait(600);
  check(
    pg.scrollWidth <= pg.clientWidth + 1 && mount.scrollWidth <= mount.clientWidth + 1,
    'no sideways overflow at 1024×768'
  );
  console.log('TNAI_SHOT:usage-stats-1024');
  await wait(450);
  await main('size', 1440, 900);
  await wait(400);

  // Refresh re-reads without breaking the numbers.
  const before = todayKpi()?.querySelector('b')?.dataset.count,
    refresh = document.querySelector('#settingsPanel-usage [data-act=refresh]');
  refresh.click();
  await until(() => refresh.textContent === 'Refreshing…');
  await until(() => refresh.textContent === 'Refresh', 5000);
  const after = todayKpi()?.querySelector('b')?.dataset.count;
  check(
    after === before,
    'Refresh re-reads the same fixture logs and shows the same Today total (' +
      before +
      ' → ' +
      after +
      ')'
  );
  const updatedText =
    document.querySelector('#settingsPanel-usage [data-updated]')?.textContent || '';
  check(!!updatedText && updatedText !== '—', '"Updated …" time is shown: ' + updatedText);

  // Opening the tab again: fresh numbers are kept as they are; numbers older than 5 minutes (or
  // from another day) are read again by themselves.
  let reads = 0;
  const seen = new MutationObserver(() => {
    if (/Refreshing/.test(refresh.textContent)) reads++;
  });
  seen.observe(refresh, { childList: true, characterData: true, subtree: true });
  window.TnaiSettings.open('accounts');
  await wait(200);
  window.TnaiSettings.open('usage');
  await wait(600);
  check(
    reads === 0,
    'reopening Usage with fresh numbers does not read the logs again (reads: ' + reads + ')'
  );
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60000;
    window.TnaiSettings.open('accounts');
    await wait(200);
    window.TnaiSettings.open('usage');
    check(
      !!(await until(() => reads >= 1, 4000)),
      'reopening Usage 6 minutes later reads the logs again by itself (reads: ' + reads + ')'
    );
  } finally {
    Date.now = realNow;
  }
  await until(() => refresh.textContent === 'Refresh', 5000);
  seen.disconnect();
  check(
    todayKpi()?.querySelector('b')?.dataset.count === before,
    '…and the Today total is still right afterwards'
  );
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
