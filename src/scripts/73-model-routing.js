/*
 * Technically Not · 73-model-routing.js — Desktop only: a model or agent CLI named in the prompt
 * ("use Opus 5.5 to …", "have Codex fix …", "Sonnet: …", "@opus", "run this on gpt-5.5 high") sends
 * the task to it. An idle running agent of that CLI already on that model gets it; otherwise a new
 * agent of that CLI starts on that model (46 TnaiLaunchPrefs.once) and gets the task right away.
 * Only names from each CLI's own model list (desktop agent-registry.js, via
 * tnaiNative.agents.models) count, and only where the prompt asks for them: a verb before the name,
 * the prompt's opening ("Codex: …"), or "@". A plain mention ("fix the Codex detection bug") is
 * left alone. 11 route() asks this right after @mentions (50 leaves an @word that names a model to
 * it); the route hint shows the pick, and clicking it ignores the name for this prompt.
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents,
    live = window.TnaiLiveTasks;
  if (!native?.agents?.models || !agents || !live) return;

  // the CLIs the composer can start (11 START_AGENTS)
  const CLIS = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

  // Cursor Agent only when the prompt says "cursor agent", not the bare word "cursor" (IDE/tooling
  // mentions stay on Claude/Codex Auto).
  const CLI_NAMES = {
    'Claude Code': ['claude code', 'claude'],
    Codex: ['codex'],
    'Cursor Agent': ['cursor agent'],
    OpenCode: ['opencode', 'open code'],
  };

  // Model families that are really CLI or app words never select a model by themselves: Cursor
  // groups models as "cursor", "claude" and "composer", so "start a Cursor Agent sub-agent" or "use
  // the composer" picked a Cursor model. Full labels ("Composer 2.5", "Grok 4.6") still work.
  const RESERVED = new Set([
    'claude',
    'code',
    'codex',
    'cursor',
    'agent',
    'composer',
    'opencode',
    'auto',
  ]);
  const EFFORT_WORDS = {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    'extra high': 'xhigh',
    max: 'max',
    ultra: 'ultra',
  };

  // Each CLI's model list (the main process caches it too), asked again when used 10+ min after the
  // last load, so a model a CLI update, the account or the server list adds becomes a name here
  // without a restart.
  const catalogs = {};
  let loadedAt = 0;
  const load = () =>
    Promise.all(
      CLIS.filter(id => agents.info().find(a => a.id === id)?.installed).map(id =>
        native.agents.models(id).then(
          r => {
            if (r || !catalogs[id]) {
              catalogs[id] = r || { models: [], efforts: [] };
              cache = null;
            }
          },
          () => {}
        )
      )
    ).finally(() => {
      loadedAt = Date.now();
    });
  const ready = agents.detect
    ? agents
        .detect()
        .then(load)
        .catch(() => {})
    : Promise.resolve();
  const refresh = () => {
    if (loadedAt && Date.now() - loadedAt > 10 * 60e3) {
      loadedAt = Date.now();
      load().catch(() => {});
    }
  };

  // OpenCode's list follows its saved credentials: when its sign-in state changes (a sign-in panel
  // ended), its names are read again at once.
  let openCodeSign = null;
  agents.onChange?.(() => {
    const a = agents.info().find(x => x.id === 'OpenCode'),
      sign = a ? [a.installed, a.loggedIn, a.account].join('|') : '';
    if (openCodeSign !== null && sign !== openCodeSign && catalogs.OpenCode)
      native.agents.models('OpenCode').then(
        r => {
          if (r) {
            catalogs.OpenCode = r;
            cache = null;
          }
        },
        () => {}
      );
    openCodeSign = sign;
  });

  // ---------- names ----------
  let cache = null; // the name list of the loaded catalogs (a test may pass its own)
  const namesOf = cats => (cats === catalogs ? (refresh(), (cache ||= names(cats))) : names(cats));
  const norm = s =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  // "opus 5 5" matches "Opus 5.5", "opus-5.5", "opus5.5"; digits stay apart ("opus 55" is not 5.5).
  // "/", "@" and "~" join the parts of an OpenCode id, so a full id as typed ("opencode/gpt-5.5",
  // "cloudflare-workers-ai/@cf/meta/…") is its own name.
  const pattern = n =>
    n
      .split(' ')
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .reduce(
        (re, t, i, all) =>
          (i
            ? re +
              (/\d/.test(all[i - 1].slice(-1)) && /\d/.test(t[0]) ? '[\\s._-]+' : '[\\s._\\/@~-]*')
            : '') + t,
        ''
      );
  const versionOf = id =>
    (id.match(/\d+(?:\.\d+)*/g) || [])
      .filter(n => n.length < 8)
      .flatMap(n => n.split('.').map(Number));
  const newer = (a, b) => {
    const x = versionOf(a.id),
      y = versionOf(b.id);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) > (y[i] ?? -1);
    return a.label.length < b.label.length;
  };

  // Every name a prompt may use: each model's id and label (Claude's also as "claude <label>"), a
  // family name for its newest model, each CLI's own name.
  function names(cats) {
    const out = [];
    for (const agent of CLIS) {
      const models = cats[agent]?.models || [];
      for (const m of models) {
        const labels = new Set([norm(m.id), norm(m.label)]);
        if (agent === 'Claude Code') labels.add(norm('claude ' + m.label));
        labels.forEach(n => n && /[a-z]/.test(n) && out.push({ n, agent, model: m }));
      }
      const families = new Map();

      // OpenCode groups its models by provider ("anthropic", "openrouter"), which is no model
      // family: its family word is the model's own `family` ("claude-sonnet", "gpt"), for the
      // newest by release date that is not deprecated.
      const oc = agent === 'OpenCode',
        later = (m, old) =>
          oc && m.released && old.released ? m.released > old.released : newer(m, old);
      models.forEach(m => {
        const f = norm(oc ? m.family : m.group);
        if (oc && m.deprecated) return;
        if (f.length > 2 && !CLI_NAMES[agent].includes(f) && !RESERVED.has(f))
          families.set(f, families.has(f) && !later(m, families.get(f)) ? families.get(f) : m);
      });
      families.forEach((m, f) => out.push({ n: f, agent, model: m, family: true }));
      CLI_NAMES[agent].forEach(n => out.push({ n, agent, model: null }));
    }
    return out.map(x => ({
      ...x,
      re: new RegExp('(?<![\\w.])' + pattern(x.n) + '(?![\\w]|\\.\\d)', 'gi'),
    }));
  }

  // A name counts when the prompt asks for it: a strong verb (fillers allowed between), a weak one
  // for models only, the opening, or "@".
  const FILL =
    '(?:(?:a|an|the|new|fresh|another|one|of|me|us|it|this|that|task|to|over|agent|model)\\s+)*';
  const STRONG = new RegExp(
    '\\b(?:use|have|let|ask|deploy|spin\\s+up|assign|give|hand|send|route|switch)\\s+' + FILL + '$',
    'i'
  );

  // "run the codex tests" is not a request for Codex: after these verbs a bare CLI name needs "to",
  // "and", "agent", "for", "on", "instead" or the end after it.
  const LOOSE = new RegExp('\\b(?:get|start|launch|run|pick|choose|put)\\s+' + FILL + '$', 'i');
  const CLI_END = /^\s*(?:$|[.,:;!?)]|(?:to|and|agent|for|on|instead)\b)/i;
  const WEAK = new RegExp('\\b(?:with|using|via|on|by)\\s+' + FILL + '$', 'i');

  function asked(text, at, end, isModel) {
    const before = text.slice(0, at);
    if (/(^|[\s(\["'“‘,;])@$/.test(before)) return true;
    if (!before.trim()) return /^\s*(?:[:,—–-]|\s+agent\b)/i.test(text.slice(end));
    return (
      STRONG.test(before) ||
      (LOOSE.test(before) && (isModel || CLI_END.test(text.slice(end)))) ||
      (isModel && WEAK.test(before))
    );
  }

  // null, or { agent, model (id, '' = the CLI only), label, effort, cliOnly, phrase }.
  function detect(text, cats = catalogs) {
    if (!text) return null;
    const hits = [];
    for (const x of namesOf(cats))
      for (const m of text.matchAll(x.re))
        if (asked(text, m.index, m.index + m[0].length, !!x.model))
          hits.push({ ...x, at: m.index, end: m.index + m[0].length });
    if (!hits.length) return null;

    // A CLI the prompt asks for narrows the models to it ("deploy a Cursor agent with Sonnet"); the
    // most specific name wins, earliest on a tie.
    const cliWords = hits.filter(h => !h.model).map(h => h.agent);
    const models = hits.filter(h => h.model && (!cliWords.length || cliWords.includes(h.agent)));
    const pool = models.length ? models : hits.filter(h => !h.model);
    if (!pool.length) return null;
    const best = pool.sort(
      (a, b) =>
        (b.family ? 0 : 1) - (a.family ? 0 : 1) ||
        b.n.length - a.n.length ||
        a.at - b.at ||
        CLIS.indexOf(a.agent) - CLIS.indexOf(b.agent)
    )[0];
    let effort = '';
    if (best.model) {
      const levels = best.model.efforts?.length
        ? best.model.efforts
        : cats[best.agent]?.efforts || [];
      const e = text
        .slice(best.end)
        .match(/^[\s,·(-]*(minimal|low|medium|high|xhigh|extra[\s-]high|max|ultra)\b/i);
      const level = e && EFFORT_WORDS[norm(e[1])];
      if (level && levels.includes(level)) effort = level;
    }
    return {
      agent: best.agent,
      model: best.model?.id || '',
      label: best.model ? best.model.label || best.model.id : best.agent,
      effort,
      cliOnly: !best.model,
      phrase: text.slice(best.at, best.end),
    };
  }
  const known = word => {
    const n = norm(word);
    return !!n && namesOf(catalogs).some(x => x.n === n);
  };

  // ---------- routing (11 route() asks this after @mentions) ----------
  let ignored = ''; // the name the user clicked away for this prompt
  const same = (a, b) => {
    const x = norm(a),
      y = norm(b);
    return !!x && !!y && (x === y || x.endsWith(' ' + y) || y.endsWith(' ' + x));
  };
  const modelOf = s =>
    window.TnaiTurns?.get?.(s.paneId)?.model ||
    window.TnaiLaunchPrefs?.pane?.(s.paneId, s.agent)?.model ||
    '';
  const idle = s => s.status !== 'working' && !window.TnaiTeam?.busy?.(s.paneId);

  function route(text, opts = {}) {
    const d = detect(text);
    if (!d || (ignored && norm(d.phrase) === ignored)) return null;
    const what = d.cliOnly
      ? d.agent
      : d.agent + ' · ' + d.label + (d.effort ? ' · ' + d.effort + ' effort' : '');
    const tail = ' · named in your prompt (click to ignore)';
    const reuse =
      !opts.forceNew &&
      agents
        .sessions()
        .find(
          s =>
            s.running &&
            s.mode !== 'login' &&
            s.agent === d.agent &&
            !s.customAgentId &&
            !s.ownedByUser &&
            !window.TnaiGraph?.node?.(s.paneId)?.parentId &&
            idle(s) &&
            (d.cliOnly || same(modelOf(s), d.model))
        );
    if (reuse)
      return {
        kind: 'direct',
        chosen: reuse,
        lead: reuse.agent === 'Claude Code' && !!window.TnaiTeam,
        picked: true,
        model: d,
        label: '→ ' + reuse.name + ' · ' + what + tail,
      };
    if (!window.TnaiTeam)
      return {
        kind: 'blocked',
        model: d,
        why: 'Starting ' + d.agent + ' needs the Technically Not desktop app.',
        label: '',
      };
    const opt = (live.startOptions?.() || []).filter(o => o.agent === d.agent);
    if (!opt.length) {
      const a = agents.info().find(x => x.id === d.agent);
      const why =
        d.agent +
        (a?.installed
          ? ' is not signed in. Start a thread with it to sign in'
          : ' is not installed. Install it') +
        ', or take ' +
        d.phrase +
        ' out of your prompt (or click the hint to ignore it).';
      return {
        kind: 'blocked',
        model: d,
        why,
        label: '→ ' + what + ' · ' + (a?.installed ? 'not signed in' : 'not installed'),
      };
    }
    const acct = opt.find(o => o.key === live.startPick?.()) || opt[0];
    const r = {
      kind: 'new',
      model: d,
      start: {
        agent: d.agent,
        accountId: acct.accountId,
        label: acct.label + (d.cliOnly ? '' : ' on ' + d.label),
      },
      label: '→ new ' + what + tail,
    };

    // Ctrl+Enter / New agent: the new pane opens in the active terminal workspace and the page
    // stays.
    return opts.forceNew || opts.here
      ? { ...r, explicit: true, agent: d.agent, accountId: acct.accountId }
      : r;
  }

  // Clicking the hint while it shows a named model ignores that name until the prompt is sent or
  // cleared.
  const hint = document.querySelector('.tnai-route-hint'),
    promptEl = document.getElementById('prompt');
  hint?.addEventListener('click', () => {
    const d = !ignored && detect(promptEl?.value || '');
    if (!d) return;
    ignored = norm(d.phrase);
    live.paintRoute?.();
    window.toast?.('Ignoring “' + d.phrase + '” for this prompt');
  });
  promptEl?.addEventListener('input', () => {
    if (!promptEl.value.trim()) ignored = '';
  });
  ready.then(() => live.paintRoute?.());

  window.TnaiModelRoute = { detect, route, known, ready };
})();
