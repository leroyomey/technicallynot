/*
 * Technically Not · 49-context-data.js — Desktop app only: window side of desktop/agent-context.js,
 * the shared project context (data only, no panel). Every finished agent task is a summarized entry
 * (did / found / changed / decided / remains / blockers / next / ideas, plus an open decision in
 * summary.choices) with the files it touched and which agents it was shared with. Pushed
 * (`context:changed`), never polled. window.TnaiContextState: one shared, debounced read of the
 * native state (used by 11, 51, 53, 54). window.TnaiContext (entries, entryFor, summaryFor,
 * refresh, toComposer, decide):
 * - summaryFor / entryFor: the summary block in the Result view (44); entries: composer mentions
 * (50).
 * - decide(id, i, 'send'|'composer', text): answers a decision (11 cards, 51, 94); toComposer: puts
 * a result item into the composer (51).
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.context) return;

  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // Report `code` as inline code, not raw backticks.
  const rich = text => esc(text).replace(/`([^`\n]+)`/g, '<code class="tnai-ic">$1</code>');
  const KEYS = [
    ['did', 'Did'],
    ['found', 'Found'],
    ['changed', 'Changed'],
    ['decided', 'Decided'],
    ['remains', 'Remains'],
    ['untested', 'Untested'],
    ['blockers', 'Blockers'],
    ['next', 'Next'],
    ['ideas', 'Ideas'],
  ];
  const MARKED = {
    done: 'Done',
    dismissed: 'Dismissed',
    sent: 'Moved to composer',
    answered: 'Answered',
    auto: 'Resolved automatically (inferred)',
    superseded: 'Superseded by a later result (inferred)',
    merged: 'Merged into a newer item (inferred)',
    stale: 'Parked: older than 3 days, not mentioned since (inferred)',
    deleted: 'Deleted',
  };
  let data = { project: '', entries: [], marks: {}, notes: [], auto: true, brief: '' };
  const markKey = (id, k, i) => id + ':' + k + ':' + i;
  const marked = key => data.marks?.[key];

  // A report with several "- Decide:" lines: summary.choices is the first, the others are in its
  // `more` (agent-context.js). Each has its own mark key (<id>:choices:<n>). openChoice: the first
  // one not yet answered / dismissed ({ …decision, n }), so one decision row steps through them in
  // order.
  const decisionsOf = e => {
    const c = e?.summary?.choices;
    return c?.options?.length ? [c, ...(c.more || [])] : [];
  };
  const answered = new Set(),
    // answered: mark keys answered here, before the mark comes back from main (a second click never
    // answers one twice); held: result id → answers waiting for the report's other decisions
    // (decide)
    held = new Map();
  const openChoice = (e, isMarked) => {
    const all = decisionsOf(e),
      n = all.findIndex(
        (_, i) =>
          !(isMarked || marked)(markKey(e.id, 'choices', i)) &&
          !answered.has(markKey(e.id, 'choices', i))
      );
    return n < 0 ? null : { ...all[n], n };
  };

  // Leftovers of the removed Project context panel (per-viewer conveniences only).
  try {
    ['tnai.context-seen.v1', 'tnai.context-record.v1'].forEach(k => localStorage.removeItem(k));
  } catch {}

  const style = document.createElement('style');
  style.textContent = `
.tnai-sum{display:grid;gap:4px;padding:8px 10px;border:1px solid #edf0ea;border-radius:6px;background:#fbfcf9;min-width:0}
.tnai-sum .s-row{display:grid;grid-template-columns:58px minmax(0,1fr);gap:8px;color:#3f453a;font:11px/1.45 var(--pg-sans);min-width:0}
.tnai-sum .s-row>span{color:#8a9084;font:9px/1.9 var(--pg-sans);letter-spacing:.05em;text-transform:uppercase}
.tnai-sum .s-row>div{min-width:0;overflow-wrap:anywhere}
.tnai-sum .s-row[data-k=blockers]>div{color:#8f5a3a}
.tnai-sum .s-row ul{margin:0;padding-left:14px}.tnai-sum .s-row li{margin:1px 0}
.tnai-sum .s-row ol{margin:0;padding-left:16px}
.tnai-sum .s-files{display:flex;flex-wrap:wrap;gap:4px}
.tnai-sum code{padding:0 4px;border-radius:3px;background:#f1f3ee;color:#4a5142;font:10px Consolas,monospace}
.tnai-sum .s-foot{margin-top:2px;color:#8a9084;font:10px/1.4 var(--pg-sans)}
.tnai-sum .s-row[data-k]>span{color:var(--sk,#8a9084);font-weight:600}
.tnai-sum .s-row[data-k=did]{--sk:var(--ac-sage-fg)}
.tnai-sum .s-row[data-k=found]{--sk:var(--ac-sky-fg)}
.tnai-sum .s-row[data-k=changed]{--sk:var(--ac-teal-fg)}
.tnai-sum .s-row[data-k=decided]{--sk:var(--ac-plum-fg)}
.tnai-sum .s-row[data-k=remains]{--sk:var(--ac-amber-fg)}
.tnai-sum .s-row[data-k=blockers]{--sk:var(--st-error-fg)}
.tnai-sum .s-row[data-k=next]{--sk:var(--ac-sky-fg)}
.tnai-sum .s-row[data-k=ideas]{--sk:var(--ac-amber-fg)}
.tnai-sum .s-row[data-k=choices]{--sk:var(--ac-plum-fg)}
.tnai-sum .s-done{color:#9aa093;text-decoration:line-through}
code.tnai-ic{padding:0 4px;border:1px solid #edf0ea;border-radius:4px;background:#fbfcf9;color:#5b6353;font:.92em/1.4 Consolas,monospace;overflow-wrap:anywhere}
.tnai-rec{margin-left:5px;padding:0 6px;border-radius:8px;background:var(--ac-sage-bg);color:var(--ac-sage-fg);font:600 9px/15px var(--pg-sans);white-space:nowrap}
.tnai-result .r-label{margin:2px 0 -3px;color:#8a9084;font:9px var(--pg-sans);letter-spacing:.05em;text-transform:uppercase}
`;
  document.head.append(style);

  // ---------- Data ----------
  // Shared read of the native context state for 49, 51 and 54, which all refresh on the same
  // context:changed: calls within 150 ms share one read, and a call made while a read is in flight
  // gets the next read (so it never sees state from before its change). Treat as read-only.
  let stateWaiting = null,
    stateInFlight = null;
  window.TnaiContextState = () =>
    stateWaiting ||
    (stateWaiting = (async () => {
      await new Promise(r => setTimeout(r, 150));
      try {
        await stateInFlight;
      } catch {}
      stateWaiting = null;
      return (stateInFlight = native.context.state());
    })());

  const entryFor = (paneId, startedAt) =>
    data.entries.find(e => e.paneId === paneId && e.startedAt === startedAt) || null;

  async function refresh() {
    try {
      data = (await window.TnaiContextState()) || data;
    } catch {}
    const next = data.brief || '';

    // a report that does not change the picture does not redraw the Result summary
    if (next === shownBrief) return;
    shownBrief = next;
    paintBriefs();
    window.TnaiResults?.repaint?.();
  }

  // ---------- Summary block (Result view) ----------
  // Items the user resolved stay in the result's own summary, struck through.
  function list(items, id, k) {
    const one = (x, i) => {
      const m = id && marked(markKey(id, k, i));
      return m
        ? '<span class="s-done" title="' +
            esc(MARKED[m.state] || 'Resolved') +
            '">' +
            rich(x) +
            '</span>'
        : rich(x);
    };

    // one item keeps its bullet too, so every section reads the same
    return '<ul>' + items.map((x, i) => '<li>' + one(x, i) + '</li>').join('') + '</ul>';
  }

  function shared(e) {
    const got = (e.delivered || []).map(x => x.name),
      wait = (e.queued || []).map(x => x.name);
    return (
      (got.length ? 'Shared with ' + got.join(', ') : '') +
        (wait.length
          ? (got.length ? ' · ' : '') +
            'queued for ' +
            wait.join(', ') +
            ' (they get it at their next step)'
          : '') || 'Not needed by another agent yet; any agent can look it up with tnai context.'
    );
  }

  function summary(e) {
    const box = document.createElement('div');
    box.className = 'tnai-sum';
    const s = e.summary || {};
    let html = '';
    for (const [k, label] of KEYS) {
      if (k === 'changed' && e.edited?.length) {
        const files =
          e.edited
            .slice(0, 12)
            .map(f => '<code>' + esc(f) + '</code>')
            .join('') +
          (e.edited.length > 12 ? '<code>+' + (e.edited.length - 12) + '</code>' : '');
        html +=
          '<div class="s-row" data-k="changed"><span>' +
          label +
          '</span><div><div class="s-files">' +
          files +
          '</div>' +
          (s.changed?.length ? list(s.changed) : '') +
          '</div></div>';
        continue;
      }
      if (s[k]?.length)
        html +=
          '<div class="s-row" data-k="' +
          k +
          '"><span>' +
          label +
          '</span><div>' +
          list(s[k], e.id, k) +
          '</div></div>';
    }
    decisionsOf(e).forEach((c, n) => {
      // the report's decisions in order, each with its own state
      const m = marked(markKey(e.id, 'choices', n));
      html +=
        '<div class="s-row" data-k="choices"><span>Decide</span><div' +
        (m ? ' class="s-done" title="' + esc(MARKED[m.state] || 'Resolved') + '"' : '') +
        '>' +
        esc(c.question) +
        (c.extracted ? ' <small>(extracted)</small>' : '') +
        '<ol>' +
        c.options
          .map(
            o =>
              '<li>' +
              esc(o.label) +
              (o.recommended ? '<span class="tnai-rec">Recommended</span>' : '') +
              '</li>'
          )
          .join('') +
        '</ol></div></div>';
    });
    if (!html)
      html =
        '<div class="s-row"><span>Did</span><div>No summary could be taken from the answer; read the full answer.</div></div>';
    box.innerHTML =
      html +
      '<p class="s-foot">' +
      esc(
        (e.reported
          ? 'From the agent’s report'
          : 'Extracted from the answer (the agent gave no report)') +
          ' · ' +
          shared(e)
      ) +
      '</p>';
    return box;
  }

  // The Result summary is the standing brief once the project has one (phase 2). Same block, same
  // type.
  const BRIEF_KIND = {
    'Goal:': 'decided',
    'Now:': 'next',
    'Proven:': 'did',
    'Open:': 'remains',
    'One next:': 'blockers',
    'Crossings:': 'found',
    'Since last look:': 'ideas',
  };
  const hasBrief = () => /\n(?:Now|Proven|Open|One next):/.test(data.brief || '');

  function standingBrief(text) {
    const box = document.createElement('div');
    box.className = 'tnai-sum';
    box.dataset.brief = text;
    let html = '',
      head = '',
      items = [];
    const flush = () => {
      if (!head || !items.length) {
        head = '';
        items = [];
        return;
      }
      const k = BRIEF_KIND[head] || 'did',
        label = head.replace(/:$/, '');
      html +=
        '<div class="s-row" data-k="' +
        k +
        '"><span>' +
        esc(label) +
        '</span><div><ul>' +
        items.map(x => '<li>' + rich(x) + '</li>').join('') +
        '</ul></div></div>';
      head = '';
      items = [];
    };
    for (const line of String(text).split('\n')) {
      if (!line || line === 'Standing brief') continue;
      if (line.startsWith('Goal: ')) {
        flush();
        head = 'Goal:';
        items = [line.slice(6)];
        flush();
        continue;
      }
      if (BRIEF_KIND[line]) {
        flush();
        head = line;
        continue;
      }
      if (line.startsWith('- ') && head) items.push(line.slice(2));
    }
    flush();
    box.innerHTML =
      html + '<p class="s-foot">Standing brief · from reports, locks and who is working</p>';
    return box;
  }

  function summaryFor(paneId, startedAt) {
    if (hasBrief()) return standingBrief(data.brief);
    const e = entryFor(paneId, startedAt);
    return e ? summary(e) : null;
  }

  // An open Result view updates in place. The same brief text keeps its node.
  let shownBrief = '';

  function paintBriefs() {
    if (!hasBrief()) return;
    document.querySelectorAll('.tnai-result').forEach(box => {
      const have = box.querySelector(':scope > .tnai-sum');
      if (have?.dataset.brief === data.brief) return;
      const next = standingBrief(data.brief);
      if (have) {
        have.replaceWith(next);
        return;
      }
      const body = box.querySelector('.r-body');
      if (!body) return;
      let label = box.querySelector(':scope > .r-label');
      if (!label) {
        label = document.createElement('p');
        label.className = 'r-label';
        label.textContent = 'Full answer';
        box.insertBefore(label, body);
      }
      box.insertBefore(next, label);
    });
  }

  // ---------- Composer and decisions ----------
  // Puts a result item into the composer as an editable follow-up naming its result id, so the
  // receiving agent can pull it in full (`tnai context show ID`).
  function toComposer(id, text, kind, question) {
    const e = data.entries.find(x => x.id === id),
      prompt = document.getElementById('prompt');
    if (!e || !prompt) return false;
    const src =
      e.name +
      '’s result ' +
      e.id +
      (e.task
        ? ' (task: ' + (window.TnaiResults?.cleanTask?.(e.task) || e.task).slice(0, 120) + ')'
        : '');
    const line =
      kind === 'issues'
        ? 'Fix this issue from ' + src + ': ' + text
        : kind === 'next'
          ? 'Continue from ' + src + ': ' + text
          : kind === 'ideas'
            ? 'Try this suggestion from ' + src + ': ' + text
            : kind === 'choices'
              ? 'Decision on "' +
                (question || e.summary?.choices?.question || '') +
                '" from ' +
                src +
                ': go with ' +
                text
              : kind === 'reply'
                ? 'Decision on "' +
                  (question || e.summary?.choices?.question || '') +
                  '" from ' +
                  src +
                  ': ' +
                  text
                : 'Follow up on ' + src + ': ';
    const add = line + '\nFull result: `tnai context show ' + e.id + '`';
    prompt.value = prompt.value.trim() ? prompt.value.replace(/\s+$/, '') + '\n\n' + add : add;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const pop = window.TnaiComposerPopout;
    if (pop?.isOut()) pop.window()?.focus();
    prompt.focus();

    // a whole result: the caret waits after "…: "
    const caret = kind ? prompt.value.length : prompt.value.lastIndexOf('\nFull result:');
    prompt.setSelectionRange(caret, caret);
    return true;
  }

  const sessionOf = e => window.TnaiAgents?.sessions?.().find(s => s.paneId === e.paneId);

  // Answer a decision with option i: typed into the asking agent's panel (only while it runs), or
  // put in the composer. Either marks it answered. i === 'other' answers with the user's own words
  // instead of an option.
  const choiceMessage = (c, o) =>
    'Decision on "' + c.question + '": ' + (o.own ? o.label : 'go with ' + o.label + '.');

  // id: the result's id, or "<id>#<n>" for decision n of a report with several; without n it is the
  // first one still open. The message names the decision by its question, so the agent knows which
  // one the answer is for.
  function decide(id, i, how, text) {
    const [eid, nth] = String(id).split('#');
    id = eid;
    const e = data.entries.find(x => x.id === id),
      n = nth === undefined ? (openChoice(e)?.n ?? 0) : +nth,
      key = markKey(id, 'choices', n);
    const c = decisionsOf(e)[n],
      own = i === 'other' && String(text || '').trim();
    if (!c || answered.has(key)) return false;
    const o = own ? { label: own, own: true } : c?.options?.[+i];
    if (!o) return false;
    const say = m => {
      try {
        toast(m);
      } catch {}
    };
    if (how === 'send') {
      const s = sessionOf(e);
      if (!s?.running) {
        say(e.name + ' is not running. Use → Composer to send the choice to another agent.');
        return false;
      }

      // Several decisions in one report go to the agent as one message, once the last is answered:
      // an agent that got the first answer alone would start working, and the row for the next
      // decision would be gone before the user could answer it. Kept in memory only and not marked
      // until sent, so a reload forgets a half-answered report instead of calling an unsent answer
      // "answered".
      const all = decisionsOf(e),
        kept = held.get(id) || new Map();
      kept.set(n, { text: choiceMessage(c, o), label: o.label });
      if (all.some((_, j) => !kept.has(j) && !marked(markKey(id, 'choices', j)))) {
        held.set(id, kept);
        answered.add(key);
        say('Kept: ' + o.label + '. Answer the next decision; ' + e.name + ' gets them together.');

        // the cards' decision row moves on to the next one
        window.dispatchEvent(new CustomEvent('tnai:live-activity'));
        return true;
      }
      const parts = [...kept].sort((a, b) => a[0] - b[0]);
      if (!window.TnaiAgents.send(s.paneId, parts.map(p => p[1].text).join(' '))) {
        kept.delete(n);
        say(e.name + ' stopped before the choice could be sent.');
        return false;
      }
      held.delete(id);
      window.TnaiLiveTasks?.record?.(
        s.paneId,
        'Decision: ' + parts.map(p => p[1].label).join(' · '),
        s.name + ' (' + s.agent + ')'
      );
      say('Sent to ' + e.name + ': ' + parts.map(p => p[1].label).join(' · '));
      const keys = parts.map(p => markKey(id, 'choices', p[0]));
      keys.forEach(k => answered.add(k));

      // by then the marks are back from main (an Undo there opens one again)
      setTimeout(() => keys.forEach(k => answered.delete(k)), 5000);
      native.context.mark(keys.length > 1 ? keys : key, 'answered').catch(() => {});
      return true;
    }
    if (!toComposer(id, o.label, o.own ? 'reply' : 'choices', c.question)) return false;
    answered.add(key);
    setTimeout(() => answered.delete(key), 5000);
    native.context.mark(key, 'answered').catch(() => {});
    return true;
  }

  // ---------- Live updates ----------
  native.context.onChange(refresh);

  // A changed file deleted (or restored): re-read the state so the changed files stay true to the
  // disk.
  native.fs?.onChanges?.(changes => {
    if (!Array.isArray(changes) || changes.many || changes.overflow) {
      if (data.entries.length) refresh();
      return;
    } // too many changes to list: re-read once
    const listed = new Set(
      data.entries
        .slice(0, 40)
        .flatMap(e => e.edited || [])
        .map(f => f.toLowerCase())
    );
    if (changes.some(c => c.type === 'rename' && listed.has(String(c.path).toLowerCase())))
      refresh();
  });
  window.addEventListener('tnai:project-changed', refresh);
  refresh();

  window.TnaiContext = {
    entries: () => data.entries.slice(),
    entryFor,
    summaryFor,
    refresh,
    toComposer,
    decide,
    decisionsOf,
    openChoice,
  };
})();
