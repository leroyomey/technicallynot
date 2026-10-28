/*
 * Technically Not · 184-command-cards.js — CLI commands answered as cards in the thread (user
 * 2026-10-28: "why can't we just create visual representations of everything a CLI offers commands
 * wise? ... a usage graph ... daily, weekly, limit usages ... and any other commands", and "if a
 * user checks usage under claude thread, it visually shows exact usage from claude but in a better
 * visual representation").
 *
 * A prompt that is only one of these commands is not sent to the CLI: Claude Code answers /usage,
 * /status and /context with a panel on its own screen that waits for a key, so the thread showed
 * nothing and looked stuck. The app answers them itself, from the same numbers the CLI shows:
 * - /usage (also /cost, /stats): the plan's usage windows under the CLI's own names ("Current
 *   session", "Current week (all models)", "Current week (Opus)" …) with % used and reset time,
 *   from the same source the CLI reads (80 `TnaiPlanLimits`: Anthropic's usage answer for Claude
 *   Code, the rate limits Codex reports); then the tokens used per day on this PC, today, 7 days
 *   and a 14-day line (`tnaiNative.usage.stats`, the numbers of Settings › Usage);
 * - /context: how full the conversation is, of the model's window, as the CLI reported it (76
 *   `TnaiContextWarning.level`, the numbers of the amber chip), with a Compact button;
 * - /status: the tool, model, effort, plan, account and folder of this thread, and its context and
 *   shortest usage window in one line each.
 * A tool that does not report a number says so; nothing is guessed. The card goes into the
 * conversation at once (122 calls `place`, also on `tnai:command-card`) and has Refresh. A new
 * command is one entry in COMMANDS and its card function in CARDS.
 */
(() => {
  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // the command as typed → its card
  const COMMANDS = {
    '/usage': 'usage',
    '/cost': 'usage',
    '/stats': 'usage',
    '/context': 'context',
    '/status': 'status',
  };

  // paneId → cards asked for and not yet put into that conversation
  const waiting = new Map();

  // The card a prompt asks for, or '' when the prompt is not one of these commands.
  function kindOf(text) {
    const command = String(text || '')
      .trim()
      .toLowerCase();
    return COMMANDS[command] || '';
  }

  // ---------- numbers and words ----------
  // a day's tokens, counted as Settings › Usage counts them (59 `used`)
  const dayTokens = day => (day?.input || 0) + (day?.output || 0) + (day?.cacheWrite || 0);

  const short = count => {
    if (count >= 1e9) return (count / 1e9).toFixed(1) + 'B';
    if (count >= 1e6) return (count / 1e6).toFixed(1) + 'M';
    if (count >= 1e3) return Math.round(count / 1e3) + 'k';
    return String(Math.round(count));
  };

  // A usage window under the name the CLI itself gives it (Claude Code's /usage, Codex's /status).
  function windowName(span) {
    if (span.key === 'five_hour') return 'Current session';
    if (span.key === 'seven_day') return 'Current week (all models)';
    if (span.model) return 'Current week (' + span.model + ')';
    if (span.minutes >= 10080) return 'Weekly limit';
    if (span.minutes >= 60) return Math.round(span.minutes / 60) + 'h limit';
    return span.minutes + ' min limit';
  }

  function resetWords(at) {
    if (!at) return '';
    const when = new Date(at);
    const sameDay = when.toDateString() === new Date().toDateString();
    const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return 'resets ' + time;
    return 'resets ' + when.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
  }

  const levelOf = used => (used >= 95 ? 'full' : used >= 80 ? 'high' : 'ok');

  const sessionOf = paneId =>
    safe(() => window.TnaiAgents.sessions().find(item => item.paneId === paneId), null);

  const limitsOf = session =>
    safe(() => window.TnaiPlanLimits?.get?.(session?.agent || '', session?.accountId || ''), null);

  // one bar: a name, the share used, and a note after it
  function barRow(name, used, note) {
    const row = make('div', 'tcc-limit');
    row.dataset.level = levelOf(used);
    const track = make('span', 'tcc-track');
    const fill = make('i');
    fill.style.width = Math.max(2, Math.min(100, used)) + '%';
    track.append(fill);
    row.append(
      make('span', 'tcc-limit-name', name),
      track,
      make('b', 'tcc-limit-used', Math.round(used) + '%'),
      make('small', 'tcc-limit-reset', note || '')
    );
    return row;
  }

  const part = label => {
    const node = make('div', 'tcc-part');
    node.append(make('div', 'tcc-label', label));
    return node;
  };

  // ---------- /usage ----------
  function limitsPart(session) {
    const reading = limitsOf(session);
    const agent = session?.agent || '';
    const node = part('Plan usage' + (reading?.plan ? ' · ' + reading.plan : ''));
    const windows = (reading?.windows || [])
      .slice()
      .sort((a, b) => a.minutes - b.minutes || (a.model ? 1 : 0) - (b.model ? 1 : 0));
    if (!windows.length) {
      const why =
        agent === 'Claude Code' || agent === 'Codex'
          ? reading?.detail
            ? 'No reading: ' + reading.detail + '. Refresh asks again.'
            : 'No reading yet. Refresh asks again.'
          : (agent || 'This tool') + ' does not report plan usage to Technically Not.';
      node.append(make('p', 'tcc-none', why));
      return node;
    }
    for (const span of windows)
      node.append(barRow(windowName(span), span.used || 0, resetWords(span.resetsAt)));
    if (reading?.at) {
      const age = new Date(reading.at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });
      node.append(make('small', 'tcc-age', 'Read from ' + agent + ' at ' + age));
    }
    return node;
  }

  function tokensPart(stats) {
    const node = part('Tokens used on this PC');
    const days = (stats?.days || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!days.length) {
      node.append(make('p', 'tcc-none', 'No token records were found on this PC.'));
      return node;
    }
    const today = new Date().toISOString().slice(0, 10);
    const todayTokens = dayTokens(days.find(day => day.date === today));
    const lastSeven = days.slice(-7).reduce((sum, day) => sum + dayTokens(day), 0);
    const figures = make('div', 'tcc-figures');
    for (const [label, value] of [
      ['Today', todayTokens],
      ['Last 7 days', lastSeven],
    ]) {
      const figure = make('div', 'tcc-figure');
      figure.append(make('b', '', short(value)), make('small', '', label));
      figures.append(figure);
    }
    node.append(figures);

    // the last 14 days as a line, drawn by the thread charts (178) like any chart in a reply
    const lines = days.slice(-14).map(day => {
      const date = new Date(day.date + 'T00:00:00');
      const name = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return name + ': ' + (dayTokens(day) / 1e6).toFixed(2);
    });
    const block =
      '```chart\ntitle: Tokens per day\nunit: M tokens\ntype: line\n' + lines.join('\n') + '\n```';
    const holder = make('div', 'tcc-chart');
    const drawn = safe(() => window.TnaiThreadCharts?.fill?.(holder, block, words => words), false);
    if (drawn) node.append(holder);
    return node;
  }

  async function usageBody(paneId) {
    const session = sessionOf(paneId);
    const stats = await Promise.resolve(window.tnaiNative?.usage?.stats?.()).catch(() => null);
    return [limitsPart(session), tokensPart(stats)];
  }

  // ---------- /context ----------
  function contextPart(paneId) {
    const node = part('Context');

    // the size the CLI reported and its model's window, as 76 `level` reads them (read here too,
    // since `level` says nothing while size warnings are switched off)
    const reported = safe(() => window.TnaiTurns?.get?.(paneId)?.context, null);
    const size = {
      tokens: reported?.tokens || 0,
      win:
        reported?.window || safe(() => window.TnaiContextUpkeep?.limits?.(paneId)?.window, 0) || 0,
    };
    if (!size.tokens) {
      const agent = sessionOf(paneId)?.agent || 'This tool';
      node.append(
        make('p', 'tcc-none', agent + ' has not reported how full this conversation is yet.')
      );
      return node;
    }
    const used = size.win > 0 ? (size.tokens / size.win) * 100 : 0;
    const note = size.win > 0 ? short(size.tokens) + ' of ' + short(size.win) + ' tokens' : '';
    if (size.win > 0) node.append(barRow('This conversation', used, note));
    else
      node.append(
        make('p', 'tcc-none', short(size.tokens) + ' tokens; the window size is not known.')
      );
    node.append(
      make(
        'small',
        'tcc-age',
        'Every message sends all of it again. /compact shortens it to a summary.'
      )
    );
    return node;
  }

  async function contextBody(paneId) {
    return [contextPart(paneId)];
  }

  // ---------- /status ----------
  async function statusBody(paneId) {
    const session = sessionOf(paneId);
    const turn = safe(() => window.TnaiTurns?.get?.(paneId), null);
    const reading = limitsOf(session);
    const facts = part('This thread');
    const list = make('dl', 'tcc-facts');
    const add = (name, value) => {
      if (!value) return;
      list.append(make('dt', '', name), make('dd', '', value));
    };
    add('Tool', session?.agent);
    add('Model', turn?.model || session?.model);
    add('Effort', turn?.effort);
    add('Plan', reading?.plan);
    add('Account', session?.accountLabel || session?.accountId || 'Default');
    add('Folder', session?.cwd);
    facts.append(list);

    // the two things that stop work: context and the shortest usage window
    const nodes = [facts, contextPart(paneId)];
    const shortest = (reading?.windows || []).slice().sort((a, b) => a.minutes - b.minutes)[0];
    if (shortest) {
      const usage = part('Plan usage');
      usage.append(barRow(windowName(shortest), shortest.used || 0, resetWords(shortest.resetsAt)));
      nodes.push(usage);
    }
    return nodes;
  }

  const CARDS = {
    usage: { title: 'Usage', body: usageBody },
    context: { title: 'Context', body: contextBody },
    status: { title: 'Status', body: statusBody },
  };

  // ---------- the card ----------
  function cardOf(kind, command, paneId) {
    const about = CARDS[kind];
    const card = make('div', 'tcc-card');
    card.dataset.kind = kind;
    const head = make('div', 'tcc-head');
    const agent = sessionOf(paneId)?.agent || '';
    head.append(
      make('code', 'tcc-command', command),
      make('b', 'tcc-title', about.title + (agent ? ' · ' + agent : ''))
    );
    const refresh = make('button', 'tcc-refresh', 'Refresh');
    refresh.type = 'button';
    head.append(refresh);
    const body = make('div', 'tcc-body');
    body.append(make('p', 'tcc-none', 'Reading…'));
    card.append(head, body);

    const draw = async () => {
      refresh.disabled = true;
      const nodes = await about
        .body(paneId)
        .catch(() => [make('p', 'tcc-none', 'Could not read it.')]);
      body.replaceChildren(...nodes);
      refresh.disabled = false;
    };
    refresh.addEventListener('click', async () => {
      await Promise.resolve(window.TnaiPlanLimits?.refresh?.()).catch(() => null);
      draw();
    });
    draw();
    return card;
  }

  // ---------- asking and placing ----------
  // 11: the user sent a prompt; true when it was one of these commands and is answered here
  function answer(paneId, text) {
    const kind = kindOf(text);
    if (!kind || !paneId) return false;
    const list = waiting.get(paneId) || [];
    list.push({
      kind,
      command: String(text || '')
        .trim()
        .toLowerCase(),
    });
    waiting.set(paneId, list);
    window.dispatchEvent(new CustomEvent('tnai:command-card', { detail: { paneId } }));
    return true;
  }

  // 122: put the cards that wait for this conversation into it
  function place(state, add) {
    if (state?.sub) return;
    const list = waiting.get(state?.paneId);
    if (!list?.length) return;
    waiting.delete(state.paneId);
    for (const item of list) add(cardOf(item.kind, item.command, state.paneId));
  }

  window.TnaiCommandCards = { kindOf, answer, place, windowName };
})();
