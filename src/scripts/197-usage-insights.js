/*
 * Technically Not · 197-usage-insights.js — Desktop app only: Settings › Insights
 * (#tnaiInsightsMount in #settingsPanel-insights, 22), the section right after Usage. Built from
 * the approved mockup docs/plans/design-concepts/usage-insights.html (round B7; user 2026-10-21:
 * "ways to compare on a day basis ... recommend to the user how to improve overall token usage
 * without adding in too much information", then "Yes, all three sections"). Three parts:
 * - Compare: two days, or a day against the usual for its weekday (the average of the four same
 * weekdays before it): one line naming the biggest difference, then total, by hour, by model and by
 * project side by side;
 * - A day up close: the last 90 days as a calendar, a press shows that day's hours, the threads
 * that used the most, the cache share and its busiest five hours;
 * - Ways to use fewer tokens: at most three, from the last 7 days, each with its estimate and the
 * threads it is about. Real data only (window.tnaiNative.usage.insights(),
 * desktop/usage-insights.js). How close a past day came to the 5-hour limit is not recorded
 * anywhere, so that row stays grayed out (12). Loads when the section is first shown, never on a
 * timer. Styles: src/styles/69-usage-insights.css.
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.usage?.insights) return;
  const mount = document.getElementById('tnaiInsightsMount');
  if (!mount) return;

  // ---------- small helpers ----------

  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const fmt = n => {
    const value = Math.max(0, Math.round(n || 0));
    if (window.TnaiTurns?.format?.tokens) return window.TnaiTurns.format.tokens(value);
    if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return Math.round(value / 1e3) + 'k';
    return String(value);
  };

  const icon = name => (window.TnaiIcon ? window.TnaiIcon(name, { size: 16 }) : '');

  const CLI_LABEL = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    opencode: 'OpenCode',
  };

  const dateOf = date => new Date(date + 'T12:00:00');
  const dayName = date =>
    dateOf(date).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  const weekdayName = date => dateOf(date).toLocaleDateString(undefined, { weekday: 'long' });

  // 0 → "12 am", 14 → "2 pm"
  const hourName = hour => {
    const h = ((hour % 24) + 24) % 24;
    return (h % 12 || 12) + (h < 12 ? ' am' : ' pm');
  };

  // a time in ms → "4:10 pm", written the way hourName writes hours
  const clockName = ms => {
    const d = new Date(ms);
    const h = d.getHours();
    return (
      (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + (h < 12 ? ' am' : ' pm')
    );
  };

  const percent = share => Math.round((share || 0) * 100) + '%';
  const sumOf = list => list.reduce((sum, value) => sum + value, 0);

  // ---------- state ----------

  let data = null;
  let loading = false;
  let pickedDay = -1;
  const titles = new Map();
  const asked = new Set();

  // ---------- the frame ----------

  mount.innerHTML =
    '<div class="tnai-usage-head ins-head"><span>Updated <span data-updated>—</span></span>' +
    '<button type="button" class="button" data-act="refresh">Refresh</button></div>' +
    '<div class="ins-body"></div>';
  const body = mount.querySelector('.ins-body');
  const refreshButton = mount.querySelector('[data-act=refresh]');
  const updatedLabel = mount.querySelector('[data-updated]');
  mount
    .closest('.settings-panel')
    ?.querySelector('.settings-section-head')
    ?.append(mount.querySelector('.ins-head'));

  function frameHtml() {
    return (
      '<section class="uz-card ins-sec" data-sec="compare">' +
      '<h3>Compare <em>· two days, or a day against your usual</em></h3>' +
      '<div class="ins-pick">' +
      '<label><i class="ins-swatch ins-a"></i><span class="ins-hide">First day</span><select class="set-input" data-pick="a"></select></label>' +
      '<span>against</span>' +
      '<label><i class="ins-swatch ins-b"></i><span class="ins-hide">Second day</span><select class="set-input" data-pick="b"></select></label>' +
      '</div>' +
      '<p class="ins-lead" data-lead></p>' +
      '<div class="ins-grid" data-cards></div>' +
      '</section>' +
      '<section class="uz-card ins-sec" data-sec="day">' +
      '<h3>A day up close <em>· the last 90 days, darker is more</em></h3>' +
      '<div class="ins-cal" role="group" aria-label="The last 90 days" data-cal></div>' +
      '<div class="ins-callegend" aria-hidden="true">Less <i style="--p:8%"></i><i style="--p:35%"></i><i style="--p:65%"></i><i style="--p:100%"></i> More</div>' +
      '<div class="ins-day" data-day></div>' +
      '</section>' +
      '<section class="uz-card ins-sec" data-sec="tips">' +
      '<h3>Ways to use fewer tokens <em>· at most three, from your last 7 days</em></h3>' +
      '<div class="ins-tips" data-tips></div>' +
      '<p class="ins-note">Savings are estimates from your own numbers, not promises. The first two read Claude Code’s logs, the third the tasks this app measured; Codex and OpenCode count in the totals. Cursor Agent and Copilot CLI keep no token logs this app can read.</p>' +
      '</section>'
    );
  }

  // ---------- Compare ----------

  // The average of the (up to) four same weekdays before day `at`; null when there are none.
  function usualFor(at) {
    const same = [];
    for (let i = at - 7; i >= 0 && same.length < 4; i -= 7) same.push(data.days[i]);
    if (!same.length) return null;
    const average = key => {
      const out = {};
      for (const day of same)
        for (const [name, value] of Object.entries(day[key]))
          out[name] = (out[name] || 0) + value / same.length;
      return out;
    };
    const used = same.filter(day => day.total > 0);
    return {
      usual: true,
      date: data.days[at].date,
      total: sumOf(same.map(day => day.total)) / same.length,
      hours: Array.from(
        { length: 24 },
        (_, h) => sumOf(same.map(day => day.hours[h])) / same.length
      ),
      models: average('models'),
      projects: average('projects'),
      cacheShare: used.length ? sumOf(used.map(day => day.cacheShare)) / used.length : 0,
    };
  }

  function fillPicks() {
    const pickA = body.querySelector('[data-pick=a]');
    const pickB = body.querySelector('[data-pick=b]');
    const last = data.days.length - 1;
    pickA.innerHTML = '';
    pickB.innerHTML = '';
    for (let at = last; at > last - 14 && at >= 0; at--) {
      const tag = at === last ? ' (today)' : at === last - 1 ? ' (yesterday)' : '';
      pickA.add(new Option(dayName(data.days[at].date) + tag, String(at)));
      pickB.add(new Option(dayName(data.days[at].date) + tag, String(at)));
    }
    pickB.prepend(new Option('Your usual day', 'usual'));
    pickA.value = String(last);
    pickB.value = usualFor(last) ? 'usual' : String(Math.max(0, last - 1));
    pickA.onchange = paintCompare;
    pickB.onchange = paintCompare;
  }

  // The key with the largest (a − b), or '' when none is larger.
  function largestGap(mapA, mapB) {
    let best = '';
    let gap = 0;
    for (const key of new Set([...Object.keys(mapA), ...Object.keys(mapB)])) {
      const value = (mapA[key] || 0) - (mapB[key] || 0);
      if (value > gap) {
        gap = value;
        best = key;
      }
    }
    return best;
  }

  // The three hours where a used the most more than b: their first hour, or -1.
  function busiestGap(hoursA, hoursB) {
    let best = -1;
    let gap = 0;
    for (let start = 0; start <= 21; start++) {
      let value = 0;
      for (let h = start; h < start + 3; h++) value += hoursA[h] - hoursB[h];
      if (value > gap) {
        gap = value;
        best = start;
      }
    }
    return best;
  }

  function leadHtml(a, b, bName) {
    const aName = '<b>' + esc(dayName(a.date)) + '</b>';
    if (!a.total) return aName + ' has no token use recorded.';
    if (!(b.total > 0))
      return (
        aName +
        ' used <b>' +
        fmt(a.total) +
        '</b> tokens; ' +
        esc(bName) +
        ' has none to compare with.'
      );
    const ratio = a.total / b.total;
    let how = 'about the same as ';
    if (ratio >= 1.1) how = '<b>' + ratio.toFixed(1) + '× more</b> than ';
    else if (ratio <= 0.9) how = '<b>' + Math.round((1 - ratio) * 100) + '% less</b> than ';
    let words = '.';
    if (ratio >= 1.3) {
      const model = largestGap(a.models, b.models);
      const project = largestGap(a.projects, b.projects);
      const start = busiestGap(a.hours, b.hours);
      const parts = [];
      if (model) parts.push(esc(model));
      if (project) parts.push('in ' + esc(project));
      if (start >= 0) parts.push('between ' + hourName(start) + ' and ' + hourName(start + 3));
      if (parts.length) words = ', mostly ' + parts.join(' ') + '.';
    } else if (ratio <= 0.77) {
      const project = largestGap(b.projects, a.projects);
      if (project) words = ', the drop mostly in ' + esc(project) + '.';
    }
    return (
      aName +
      ' used <b>' +
      fmt(a.total) +
      '</b> tokens, ' +
      how +
      esc(bName) +
      ' (' +
      fmt(b.total) +
      ')' +
      words
    );
  }

  // 24 columns, one bar per series in each; `series` is a list of [class, hours].
  function hoursHtml(series, tip) {
    const top = Math.max(1, ...series.flatMap(([, hours]) => hours));
    let columns = '';
    for (let h = 0; h < 24; h++) {
      const bars = series
        .map(
          ([cls, hours]) =>
            '<i class="' +
            cls +
            '" style="height:' +
            ((hours[h] / top) * 100).toFixed(1) +
            '%"></i>'
        )
        .join('');
      columns += '<div title="' + esc(tip(h)) + '">' + bars + '</div>';
    }
    return (
      '<div class="ins-hours">' +
      columns +
      '</div>' +
      '<div class="ins-axis"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div>'
    );
  }

  // Rows of paired bars: the four largest names of either side, widths against the largest value.
  function pairRowsHtml(mapA, mapB, bLabel) {
    const names = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])]
      .map(name => [name, mapA[name] || 0, mapB[name] || 0])
      .sort((x, y) => Math.max(y[1], y[2]) - Math.max(x[1], x[2]))
      .slice(0, 4);
    if (!names.length) return '<p class="ins-empty">Nothing recorded.</p>';
    const top = Math.max(1, ...names.map(([, x, y]) => Math.max(x, y)));
    return (
      '<div class="ins-rows">' +
      names
        .map(
          ([name, x, y]) =>
            '<div title="' +
            esc(name + ': ' + fmt(x) + ' against ' + fmt(y) + ' ' + bLabel) +
            '">' +
            '<span>' +
            esc(name) +
            '</span>' +
            '<span class="ins-pair"><i class="ins-a" style="width:' +
            ((x / top) * 100).toFixed(1) +
            '%"></i>' +
            '<i class="ins-b" style="width:' +
            ((y / top) * 100).toFixed(1) +
            '%"></i></span>' +
            '<small>' +
            fmt(x) +
            '</small></div>'
        )
        .join('') +
      '</div>'
    );
  }

  function paintCompare() {
    const pickA = body.querySelector('[data-pick=a]');
    const pickB = body.querySelector('[data-pick=b]');
    const atA = Number(pickA.value);
    const a = data.days[atA];

    // the usual follows the first day's weekday
    const usualOption = pickB.querySelector('option[value=usual]');
    const usual = usualFor(atA);
    usualOption.textContent = 'Your usual ' + weekdayName(a.date);
    usualOption.disabled = !usual;
    if (pickB.value === 'usual' && !usual) pickB.value = String(Math.max(0, atA - 1));

    const b = pickB.value === 'usual' ? usual : data.days[Number(pickB.value)];
    const bName = b.usual ? 'your usual ' + weekdayName(a.date) : dayName(b.date);
    const bLabel = b.usual ? 'on your usual ' + weekdayName(a.date) : 'on ' + dayName(b.date);

    body.querySelector('[data-lead]').innerHTML = leadHtml(a, b, bName);
    const hourTip = h =>
      hourName(h) + ': ' + fmt(a.hours[h]) + ' against ' + fmt(b.hours[h]) + ' ' + bLabel;
    body.querySelector('[data-cards]').innerHTML =
      '<div class="ins-card"><h4>Total</h4>' +
      '<div class="ins-big"><b>' +
      fmt(a.total) +
      '</b><span>against ' +
      fmt(b.total) +
      '</span></div>' +
      '<p class="ins-sub">From cache: ' +
      percent(a.cacheShare) +
      ' against ' +
      percent(b.cacheShare) +
      '</p></div>' +
      '<div class="ins-card"><h4>By hour</h4>' +
      hoursHtml(
        [
          ['ins-a', a.hours],
          ['ins-b', b.hours],
        ],
        hourTip
      ) +
      '</div>' +
      '<div class="ins-card"><h4>By model</h4>' +
      pairRowsHtml(a.models, b.models, bLabel) +
      '</div>' +
      '<div class="ins-card"><h4>By project</h4>' +
      pairRowsHtml(a.projects, b.projects, bLabel) +
      '</div>';
  }

  // ---------- A day up close ----------

  function paintCalendar() {
    const calendar = body.querySelector('[data-cal]');
    const most = Math.max(1, ...data.days.map(day => day.total));
    let html = '';
    for (let i = 0; i < data.days[0].weekday; i++) html += '<span></span>';
    data.days.forEach((day, at) => {
      const share = day.total > 0 ? Math.round(8 + (day.total / most) * 92) : 0;
      const label = dayName(day.date) + ': ' + fmt(day.total) + ' tokens';
      html +=
        '<button type="button" data-at="' +
        at +
        '" style="--p:' +
        share +
        '%" title="' +
        esc(label) +
        '" aria-label="' +
        esc(label) +
        '" aria-pressed="false" tabindex="-1"></button>';
    });
    calendar.innerHTML = html;

    // when the weeks do not fit, today (the right end) is what shows first
    calendar.scrollLeft = calendar.scrollWidth;
    calendar.onclick = event => {
      const button = event.target.closest('button[data-at]');
      if (button) paintDay(Number(button.dataset.at));
    };

    // arrows move by a day (up and down) or a week (left and right), as the grid reads
    calendar.onkeydown = event => {
      const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = Math.min(data.days.length - 1, Math.max(0, pickedDay + step));
      paintDay(next);
      calendar.querySelector('button[data-at="' + next + '"]')?.focus({ preventScroll: true });
    };
  }

  // its first prompt, else its project, else its tool
  const threadName = thread =>
    titles.get(thread.id) || thread.project || CLI_LABEL[thread.cli] || thread.cli;

  function threadsHtml(day) {
    const top = day.threads.slice(0, 4);
    if (!top.length) return '<p class="ins-empty">No threads this day.</p>';
    const most = Math.max(1, top[0].tokens);

    // two threads with no title in one project would read the same: the second gets "(2)"
    const seen = new Map();
    const names = top.map(thread => {
      const name = threadName(thread);
      const count = (seen.get(name) || 0) + 1;
      seen.set(name, count);
      return count > 1 ? name + ' (' + count + ')' : name;
    });
    return (
      '<div class="ins-rows ins-rows-wide">' +
      top
        .map(
          (thread, at) =>
            '<div title="' +
            esc(
              names[at] +
                ' (' +
                (CLI_LABEL[thread.cli] || thread.cli) +
                '): ' +
                fmt(thread.tokens) +
                ' tokens'
            ) +
            '">' +
            '<span>' +
            esc(names[at]) +
            '</span>' +
            '<span class="ins-pair"><i class="ins-a" style="width:' +
            ((thread.tokens / most) * 100).toFixed(1) +
            '%"></i></span>' +
            '<small>' +
            fmt(thread.tokens) +
            '</small></div>'
        )
        .join('') +
      '</div>'
    );
  }

  // Claude Code threads are named by their first prompt, asked for once per thread.
  async function askTitles(day) {
    const ids = day.threads
      .slice(0, 4)
      .filter(thread => thread.cli === 'claude-code' && !asked.has(thread.id))
      .map(thread => thread.id);
    if (!ids.length || !native.usage.titles) return;
    ids.forEach(id => asked.add(id));
    try {
      for (const row of await native.usage.titles(ids))
        if (row.title) titles.set(row.id, row.title);
    } catch {
      return;
    }
    if (data.days[pickedDay] === day) {
      const card = body.querySelector('[data-threads]');
      if (card) card.innerHTML = '<h4>The threads that used the most</h4>' + threadsHtml(day);
    }
  }

  function cacheCardHtml(day) {
    const peak = day.peak || { tokens: 0, start: 0 };
    const busiest = peak.tokens
      ? 'Busiest 5 hours: ' +
        fmt(peak.tokens) +
        ' tokens, ' +
        clockName(peak.start) +
        ' to ' +
        clockName(peak.start + 5 * 3600e3) +
        '.'
      : 'No busy hours this day.';
    return (
      '<div class="ins-card"><h4>From cache, and the 5-hour limit</h4>' +
      '<p class="ins-line">' +
      (day.total
        ? percent(day.cacheShare) + ' of the input came from cache (cheaper).'
        : 'Nothing read this day.') +
      '</p>' +
      '<p class="ins-line">' +
      busiest +
      '</p>' +
      '<div class="ins-limit-off" title="The agent tools report only the current limit reading, so how close a past day came is not known.">' +
      '<p class="ins-line">Closest to the 5-hour limit: not recorded</p>' +
      '<div class="ins-meter"><i></i></div></div></div>'
    );
  }

  function paintDay(at) {
    pickedDay = at;
    const day = data.days[at];
    body.querySelectorAll('[data-cal] button').forEach(button => {
      const on = Number(button.dataset.at) === at;
      button.setAttribute('aria-pressed', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    const hourTip = h => hourName(h) + ': ' + fmt(day.hours[h]) + ' tokens';
    body.querySelector('[data-day]').innerHTML =
      '<div class="ins-grid">' +
      '<div class="ins-card"><h4><b>' +
      esc(dayName(day.date)) +
      '</b> · ' +
      fmt(day.total) +
      ' tokens</h4>' +
      hoursHtml([['ins-a', day.hours]], hourTip) +
      '</div>' +
      '<div class="ins-card" data-threads><h4>The threads that used the most</h4>' +
      threadsHtml(day) +
      '</div>' +
      cacheCardHtml(day) +
      '</div>';
    askTitles(day);
  }

  // ---------- Ways to use fewer tokens ----------

  const TIP_WORDS = {
    compact: tip => ({
      icon: 'gauge',
      title: 'Compact long conversations earlier',
      why:
        tip.cases +
        ' threads grew past 150k tokens of conversation. Each answer re-reads the whole conversation, so its size is paid again every turn.',
      how: 'Compacting at about 100k',
      of: 'of what those threads re-read',
    }),
    breaks: tip => ({
      icon: 'clock',
      title: 'Breaks cost a full re-read',
      why:
        tip.cases +
        ' answers came after a break of more than 5 minutes, when the saved copy of the conversation (the cache) had run out, and read the whole conversation at full price.',
      how: 'A short wrap-up before a long break, or a new thread after it',
      of: 'of last week',
    }),
    model: tip => ({
      icon: 'sparkles',
      title: 'A smaller model for small jobs',
      why:
        tip.cases +
        ' short tasks (under 2 minutes) ran on ' +
        tip.model +
        '. A smaller model such as Sonnet handles quick questions like these and counts less against your plan.',
      how: 'Picking Sonnet for quick questions',
      of: 'of last week’s measured tasks',
    }),
  };

  function tipThreadsHtml(tip) {
    return tip.threads
      .map(thread => {
        const name = thread.tasks
          ? thread.title + ' · ' + thread.tasks + (thread.tasks === 1 ? ' task' : ' tasks')
          : thread.title ||
            [thread.project, CLI_LABEL[thread.cli] || thread.cli].filter(Boolean).join(' · ');
        return '<li><span>' + esc(name) + '</span><small>' + fmt(thread.tokens) + '</small></li>';
      })
      .join('');
  }

  function paintTips() {
    const host = body.querySelector('[data-tips]');
    if (!data.tips.length) {
      host.innerHTML =
        '<p class="ins-empty">Nothing stands out in your last 7 days: no conversation grew past 150k, few answers re-read after a break, and few short tasks ran on the largest model.</p>';
      return;
    }
    host.innerHTML = data.tips
      .map((tip, at) => {
        const words = TIP_WORDS[tip.key](tip);
        const save = '~' + Math.max(1, Math.round(tip.share * 100)) + '%';
        return (
          '<div class="ins-tip"><i>' +
          icon(words.icon) +
          '</i>' +
          '<div><b>' +
          esc(words.title) +
          '</b><p>' +
          esc(words.why) +
          '</p><small>' +
          esc(words.how) +
          '</small>' +
          '<ul class="ins-tip-list" id="insTip' +
          at +
          '" hidden>' +
          tipThreadsHtml(tip) +
          '</ul></div>' +
          '<div class="ins-save"><strong>' +
          save +
          '</strong>' +
          esc(words.of) +
          ' (estimate)' +
          '<button type="button" class="ins-more" aria-expanded="false" aria-controls="insTip' +
          at +
          '">See the threads</button></div></div>'
        );
      })
      .join('');
    host.onclick = event => {
      const button = event.target.closest('.ins-more');
      if (!button) return;
      const list = document.getElementById(button.getAttribute('aria-controls'));
      const open = list.hidden;
      list.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Hide the threads' : 'See the threads';
    };
  }

  // ---------- drawing and loading ----------

  function render() {
    const found = (data.sources || []).some(source => source.found);
    if (!found || !data.days?.length) {
      body.innerHTML =
        '<p class="uz-state">No agent logs found on this PC yet. Insights show up after your first Claude Code, Codex or OpenCode session.</p>';
      return;
    }
    body.innerHTML = frameHtml();
    fillPicks();
    paintCompare();
    paintCalendar();
    let start = data.days.length - 1;
    while (start > 0 && !data.days[start].total) start--;
    paintDay(start);
    paintTips();
  }

  const ago = at => {
    const seconds = Math.max(0, (Date.now() - at) / 1000);
    if (seconds < 45) return 'just now';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
    return new Date(at).toLocaleString();
  };

  async function load() {
    if (loading) return;
    loading = true;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Refreshing…';
    if (!data) body.innerHTML = '<p class="uz-state uz-loading">Reading your token use…</p>';
    try {
      data = await native.usage.insights();
      render();
      updatedLabel.textContent = ago(data.generatedAt || Date.now());
    } catch (error) {
      data = null;
      body.innerHTML =
        '<p class="uz-state">Could not read token use.<small>' +
        esc(error?.message || String(error)) +
        '</small></p>';
    } finally {
      loading = false;
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh';
    }
  }
  refreshButton.addEventListener('click', load);

  // Loads only when Settings › Insights is shown (22 toggles `hidden` on its panels); again when
  // the numbers are over 5 minutes old or from another day.
  const panel = mount.closest('.settings-panel');
  if (!panel) return;
  const layout = document.querySelector('.layout');
  const onShown = () => {
    if (panel.hidden || !layout?.classList.contains('settings-mode')) return;
    if (!data) return load();
    const at = data.generatedAt || Date.now();
    if (Date.now() - at > 300000 || new Date(at).toDateString() !== new Date().toDateString())
      load();
    else updatedLabel.textContent = ago(at);
  };
  new MutationObserver(onShown).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('tnai:settings-page-shown', onShown);
  onShown();

  window.TnaiUsageInsights = {
    load,
    state: () => ({ loaded: !!data, day: pickedDay, tips: data?.tips?.length || 0 }),
  };
})();
