// Technically Not · 165-remote-features.js — Desktop only: this week's thread features for another
// computer's threads (plan item 45, docs/plans/multi-computer.md list J), and that computer's
// CLIs' sign-in and usage, read-only.
//
// What it adds, each in an existing place and style:
// - The thread actions (154) in the other computer's thread: a "This thread's work" button in the
//   detail's buttons (116's `.ap-actions`), opening 137's menu with 154's actions and the user's
//   own prompts. A row sends its filled prompt to that agent as a prompt from this computer
//   (116 `promptShown`: the quiet time, the very agent shown, its mark), so it lands there marked
//   "[Sent from …]" and needs full control, like Follow up. Shown only while full control is on
//   and that agent's folder is a git repository.
// - Changes (153) in the same detail: that agent's branch, lines, commits, uncommitted files and
//   pull request, read-only, as that computer read them (no folder path, no link).
// - Its computer's CLIs: which are installed and signed in, and the plan usage gauges, read-only.
// - The "$" list (160) while that agent is the composer's target: the skills its CLI reads on
//   that computer (160 asks `picker`). No "/" list: a prompt for another computer must start
//   with a word, so a command is never sent.
// - The Board (157): its threads in Working, Needs you and Done today (`boardCards`); a press
//   opens the thread the way a press on its row of the thread list does (`openThread`).
//
// Left out, with the reason in the brief's report: design cards (159) and pop-out windows (162).
// The code copy button (122) in its conversation is 152's, through 122 `copyButtons`.
//
// Everything another computer tells this one is asked by its own call (`tnaiNative.remote.
// askFeature`, `feature`; desktop/remote-features.js), never part of the pushed state, and drawn
// as text only. window.TnaiRemoteFeatures = { paint, picker, boardCards, openThread }. Tests:
// `node tools/remote-features-test.js` (the rules), desktop `remote-features` (written, run by the
// lead once the batch is done).
(() => {
  'use strict';

  // ---------------------------------------------------------------- the words (no page needed)
  const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
  const CLOCK = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });

  // Changes, as 153 words them.
  function changesRows(c) {
    if (!c.repo) return [['Folder', 'Not a git repository']];
    const branch = c.detached
      ? 'No branch (detached)'
      : c.branch + (c.onBase ? ' · the default branch' : '');
    const lines = c.files
      ? '+' + c.added + ' −' + c.removed + ' · ' + plural(c.files, 'file')
      : 'No changes';
    let commits = '';
    if (c.onBase) commits = c.unpushed ? plural(c.unpushed, 'commit') + ' not pushed' : '';
    else if (c.base)
      commits =
        (c.ahead ? plural(c.ahead, 'commit') : 'None') +
        ' ahead of ' +
        c.base +
        (c.behind ? ' · ' + c.behind + ' behind' : '');
    const rows = [
      ['Branch', branch],
      ['Lines', lines],
      ['Commits', commits],
      ['Uncommitted', c.uncommitted ? plural(c.uncommitted, 'file') : 'None'],
    ];
    if (c.pr) {
      const checks = c.pr.checks || {};
      const state = c.pr.draft ? 'draft' : String(c.pr.state || '').toLowerCase();
      let words = '#' + c.pr.number + (c.pr.title ? ' ' + c.pr.title : '') + ' · ' + state;
      if (checks.total)
        words +=
          ' · checks ' +
          checks.passed +
          ' passed' +
          (checks.failed ? ', ' + checks.failed + ' failed' : '') +
          (checks.pending ? ', ' + checks.pending + ' running' : '');
      rows.push(['Pull request', words]);
    } else if (c.gh === 'none') rows.push(['Pull request', 'None for this branch']);
    return rows;
  }

  // One gauge: "5-hour: 40% used · starts over 3:10 PM".
  function gaugeWords(g) {
    const span =
      g.minutes === 300
        ? '5-hour'
        : g.minutes === 10080
          ? 'Weekly'
          : g.minutes >= 1440
            ? Math.round(g.minutes / 1440) + '-day'
            : Math.round(g.minutes / 60) + '-hour';
    return (
      span +
      (g.model ? ' ' + g.model : '') +
      ': ' +
      g.used +
      '% used' +
      (g.resetsAt ? ' · starts over ' + CLOCK.format(g.resetsAt) : '')
    );
  }

  function clisRows(v) {
    return (v.clis || []).map(c => {
      const sign = !c.installed
        ? 'Not installed'
        : c.signedIn === true
          ? 'Signed in'
          : c.signedIn === false
            ? 'Signed out'
            : 'Installed, sign-in not known';
      const parts = [sign + (c.plan ? ' · ' + c.plan : '')];
      for (const g of c.gauges || []) parts.push(gaugeWords(g));
      return [c.cli, parts.join(' · ')];
    });
  }

  // 154's words for a prompt's facts, from that computer's Changes (no link crosses, so a pull
  // request is named by its number).
  function fill(text, c) {
    const branch = c?.branch || 'the current branch';
    const base = c?.base || 'the default branch';
    const pull = c?.pr ? 'pull request #' + c.pr.number : 'the pull request of branch ' + branch;
    const words = { branch, base, pull };
    return String(text || '').replace(/\{(branch|base|pull)\}/g, (whole, name) => words[name]);
  }

  // The Board column of another computer's thread (156's words): working → Working, waiting on the
  // user → Needs you, its last task finished today → Done today, else none. Ready for review needs
  // this computer's own folder facts, so another computer's thread never stands there.
  const COLUMN = { working: 'work', needs: 'needs' };
  const sameDay = (a, b) => !!a && new Date(a).toDateString() === new Date(b).toDateString();
  const boardColumn = (ag, now) =>
    COLUMN[ag && ag.status] || (sameDay(ag && ag.done, now) ? 'done' : '');

  // For tools/remote-features-test.js (plain Node): the parts that hold no page.
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { changesRows, gaugeWords, clisRows, fill, boardColumn };
  if (typeof window === 'undefined') return;

  const native = window.tnaiNative?.remote;
  if (!native?.askFeature || !native?.feature || !native?.on) return;

  const SEP = '\n';
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);
  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // ---------------------------------------------------------------- what the other computer said

  // `${computer}\n${kind}\n${row}` → { state, at, value } as the main process holds it
  const held = new Map();
  const keyOf = (pc, kind, id) => pc + SEP + kind + SEP + (id || '');

  // Asks, at most as often as the main process lets (5 s per thing, one on its way).
  function ask(pc, kind, id) {
    Promise.resolve(native.askFeature(pc, kind, id || '')).catch(() => {});
  }

  // Reads what is held of one thing; `changed` when it differs from what was drawn.
  async function read(pc, kind, id) {
    let got = null;
    try {
      const r = await native.feature(pc, kind, id || '');
      got = r && r.ok !== false ? (r && 'value' in r ? r.value : r) : null;
    } catch {
      got = null;
    }
    const key = keyOf(pc, kind, id);
    const before = JSON.stringify(held.get(key) || null);
    if (got) held.set(key, got);
    return JSON.stringify(got || null) !== before;
  }
  const get = (pc, kind, id) => held.get(keyOf(pc, kind, id)) || null;

  // ---------------------------------------------------------------- the detail of its thread

  // What the detail shows now: { key, pc, ag, pcName, off }, and its box.
  let shown = null;
  let box = null;
  let ui = null;

  function ensure(host) {
    if (ui && ui.host === host) return ui;
    const actions = host.querySelector('.ap-actions');
    const side = host.querySelector('.ap-side');
    if (!actions || !side) return null;
    const work = make('button', '', "This thread's work");
    work.type = 'button';
    work.dataset.act = 'work';
    work.title = 'Commit, push, pull request or review: sent to this agent as a prompt';
    work.setAttribute('aria-haspopup', 'menu');
    work.hidden = true;
    actions.prepend(work);
    work.addEventListener('click', event => {
      event.stopPropagation();
      openWork(work);
    });
    const changesSec = make('section', 'ap-sec');
    changesSec.dataset.sec = 'changes';
    changesSec.append(make('h3', '', 'CHANGES'), make('div'));
    const clisSec = make('section', 'ap-sec');
    clisSec.dataset.sec = 'clis';
    clisSec.append(make('h3', '', 'ITS CLIS'), make('div'));
    side.append(changesSec, clisSec);
    ui = {
      host,
      work,
      changes: changesSec.lastChild,
      clis: clisSec.lastChild,
      changesSec,
      clisSec,
    };
    return ui;
  }

  const kvList = rows => {
    const dl = make('dl', 'ap-kv');
    for (const [name, value] of rows) {
      if (!value) continue;
      dl.append(make('dt', '', name), make('dd', '', value));
    }
    return dl;
  };

  // What a section says while nothing came yet, by the state of the ask.
  const WAITING = {
    asking: 'Asking {pc}…',
    busy: '{pc} is busy reading something else. Asking again in a moment.',
    none: '{pc} has nothing to show for this.',
    // that computer answers nothing while its "show details" switch is off for this one
    no_reply:
      '{pc} did not answer: it may not share details with this computer, or may need an update.',
  };

  function drawSection(node, sec, entry, rows, pcName) {
    let content;
    if (entry && entry.value) content = kvList(rows(entry.value));
    else
      content = make(
        'p',
        'ap-none',
        (WAITING[entry?.state] || WAITING.asking).replace('{pc}', pcName)
      );
    const sig = content.outerHTML;
    if (node.dataset.sig !== sig) {
      node.dataset.sig = sig;
      node.replaceChildren(content);
    }
    sec.hidden = false;
  }

  // One later ask per thing after that computer said "busy" (its main process allows one ask in 5
  // s).
  const AGAIN_MS = 6000;
  const againTimers = new Map();

  function again(t, kind, id) {
    const key = keyOf(t.pc.id, kind, id);
    if (againTimers.has(key)) return;
    againTimers.set(
      key,
      setTimeout(() => {
        againTimers.delete(key);
        if (shown && shown.key === t.key) ask(t.pc.id, kind, id);
      }, AGAIN_MS)
    );
  }

  // 116 calls this at the end of every paint of its detail: t = { key, pc, ag, pcName, off }.
  function paint(host, t) {
    if (!host || !t || !t.pc || !t.ag) return;
    const parts = ensure(host);
    if (!parts) return;
    const changed = !shown || shown.key !== t.key;
    shown = t;
    box = host;
    const pcId = t.pc.id;
    const agentId = t.ag.id;

    // a newly shown thread asks once; the answers come back through the pushed state
    if (changed) {
      ask(pcId, 'changes', agentId);
      ask(pcId, 'clis', '');

      // what the main process already holds from an earlier ask is drawn at once
      Promise.all([read(pcId, 'changes', agentId), read(pcId, 'clis', '')]).then(fresh => {
        if (fresh.some(Boolean) && shown === t) paint(box, t);
      });
    }

    // "busy" there: asked once more a little later, while this thread is still the one shown
    for (const [kind, id] of [
      ['changes', agentId],
      ['clis', ''],
    ])
      if (get(pcId, kind, id)?.state === 'busy') again(t, kind, id);
    const changes = get(pcId, 'changes', agentId);
    drawSection(parts.changes, parts.changesSec, changes, changesRows, t.pcName);
    drawSection(parts.clis, parts.clisSec, get(pcId, 'clis', ''), clisRows, t.pcName);

    // the work button: full control, and a git folder there
    const repo = !!changes?.value?.repo;
    parts.work.hidden = !(t.ag.can === true && repo);
    parts.work.disabled = !!t.off;
    parts.work.setAttribute(
      'aria-label',
      "This thread's work, for " + t.ag.name + ' on ' + t.pcName
    );
  }

  // ---------------------------------------------------------------- the thread actions

  async function sendAction(t, action) {
    const c = get(t.pc.id, 'changes', t.ag.id)?.value || null;
    const text = fill(action.prompt, c);

    // t: the thread the menu was opened for; 116 refuses when another one is shown now (L3)
    const answer = await safe(() => window.TnaiRemoteAgents?.promptShown?.(text, t), null);
    if (answer && answer.sent === 'asked')
      say(action.label + ' sent to ' + t.ag.name + ' on ' + t.pcName);
  }

  function openWork(anchor) {
    const t = shown;
    const more = window.TnaiThreadMore;
    const actions = safe(() => window.TnaiThreadActions?.prompts?.() || [], []);
    if (!t || !more?.openList || !actions.length) return;
    if (more.isOpen()) {
      const same = more.anchor?.() === anchor;
      more.close(same);
      if (same) return;
    }

    // a fresh branch for the next opening
    ask(t.pc.id, 'changes', t.ag.id);
    const c = get(t.pc.id, 'changes', t.ag.id)?.value || null;
    const icons = {
      commit: 'git-branch',
      push: 'git-branch',
      'pull-request': 'file-text',
      review: 'eye',
    };
    more.openList(anchor, t.key, {
      name: 'Actions for this thread’s work on ' + t.pcName,
      label: "This thread's work on " + t.pcName + (c?.branch ? ' · branch ' + c.branch : ''),
      rows: actions.map(action => ({
        id: action.id,
        label: action.label,
        icon: icons[action.id] || 'sparkles',
        go: () => sendAction(t, action),
      })),
    });
  }

  // ---------------------------------------------------------------- the "$" list (160)

  // While an agent of another computer is the composer's target: { label, rows } for 160, rows
  // null until that computer answered. null otherwise.
  let lastPickerAsk = '';

  function picker() {
    const target = safe(() => window.TnaiRemoteAgents?.target?.(), null);
    if (!target || !target.pc || !target.ag) return null;
    const pcId = target.pc.id;
    const agentId = target.ag.id;
    const key = keyOf(pcId, 'skills', agentId);
    if (lastPickerAsk !== key) {
      lastPickerAsk = key;
      ask(pcId, 'skills', agentId);
    } else if (!held.get(key)) read(pcId, 'skills', agentId).then(fresh => fresh && tell());
    const v = held.get(key)?.value || null;
    return {
      label: (target.ag.cli || 'its CLI') + ' on ' + target.computer,
      rows: v
        ? v.skills.map(s => ({
            name: s.insert,
            insert: s.insert,
            about: s.about,
            label: s.from === 'project' ? 'project skill' : 'skill on ' + target.computer,
          }))
        : null,
    };
  }
  const tell = () => window.dispatchEvent(new CustomEvent('tnai:remote-skills'));

  // ---------------------------------------------------------------- the Board (157)

  function boardCards() {
    const now = Date.now();
    const pcs = safe(() => window.TnaiRemoteAgents?.shown?.() || [], []);
    const out = [];
    for (const pc of pcs)
      for (const ag of pc.agents || []) {
        const column = boardColumn(ag, now);
        if (!column) continue;
        const tone = column === 'needs' ? 'needs' : column === 'work' ? 'work' : 'idle';
        const body =
          column === 'needs'
            ? 'Waiting on ' + pc.name + ' for you'
            : ag.task || (column === 'done' ? 'Finished' : '');
        out.push({
          column,
          html:
            `<article class="bd-card" tabindex="0" data-kind="remote" data-remote="${esc(ag.key)}">` +
            `<div class="bd-card-top"><i class="bd-dot" data-tone="${tone}"></i><b>${esc(ag.name)}</b></div>` +
            `<small class="bd-tool">${esc((ag.cli ? ag.cli + ' · ' : '') + 'on ' + pc.name)}</small>` +
            `<p>${esc(body)}</p></article>`,
        });
      }
    return out;
  }

  // Opens another computer's thread as a press on its row of the thread list does (138 takes
  // that press: it picks the agent and shows it in the main area).
  function openThread(key) {
    const frame = window.TnaiThreads;
    if (!frame) return;
    const press = () => {
      const rows = frame.slot?.('list')?.querySelectorAll('.tnt-th') || [];
      const row = [...rows].find(node => node.dataset.remote === key);
      if (row) row.click();
      return !!row;
    };
    if (frame.visible?.() && press()) return;

    // From another page the list is drawn a moment after the Threads page opens.
    frame.open?.();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!press()) say('That thread is no longer listed here.');
      })
    );
  }

  // ---------------------------------------------------------------- answers arriving

  // Each state push may carry a new answer: what is shown, and the "$" list's, are read again.
  native.on(() => {
    const t = shown;
    if (t && box?.isConnected && !box.hidden) {
      Promise.all([read(t.pc.id, 'changes', t.ag.id), read(t.pc.id, 'clis', '')]).then(fresh => {
        if (fresh.some(Boolean) && shown === t) paint(box, t);
      });
    }
    if (lastPickerAsk) {
      const [pcId, , agentId] = lastPickerAsk.split(SEP);
      read(pcId, 'skills', agentId).then(fresh => fresh && tell());
    }
  });

  window.TnaiRemoteFeatures = { paint, picker, boardCards, openThread };
})();
