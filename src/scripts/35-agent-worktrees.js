// Technically Not · 35-agent-worktrees.js — Desktop app only: per-agent git worktrees. "Own
// worktree" option in the connection picker (06) for a git project with commits (10 passes it to
// pty:start via `take`), and the same checkbox beside the composer's New agent pickers (46);
// reattach: the picker also offers "Continue in ⎇ <branch>" for up to 3 free worktrees (no panel
// holds them; worktree-service free()). The worktree shows as a ⎇ badge on its terminal panel ("⎇
// <name> · N files · M commits ahead", counts push-refreshed). land(paneIdOrBranch, anchor) opens a
// small popover (TnaiFloat) at the ⎇ button of the agent's Agent Tree row (94), its focus view head
// (99) or the panel badge: branch, commits to merge, +/− lines, uncommitted changes (never merged),
// and Merge (into the project folder's current branch; refusals and conflicts shown in the popover)
// / Keep working / Discard (Yes / No inside the popover, then the worktree and its branch are
// removed). Worktrees no panel holds (tnai/*, free()) are listed at the bottom of that popover
// (Open switches it to that one) and reached from the Agent Tree's ? menu ("⎇ N worktrees without a
// panel", in 94's tools slot, only while there are any). Push updates only (git:changed);
// `tnai:worktrees-changed` after each list read. want(pane) is the one opt-in decision every start
// path uses (true, or { branch } to continue in a free worktree). window.TnaiWorktrees (want, take,
// land, refresh, panes, list).
(() => {
  const native = window.tnaiNative;
  if (!native?.git?.worktrees) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const style = document.createElement('style');
  style.textContent = `
.wt-option{display:flex;align-items:flex-start;gap:9px;margin:0 0 12px;padding:9px 11px;border:1px solid #e3e7de;border-radius:8px;background:#fff;color:#444a3f;font:10px/1.45 var(--pg-sans);cursor:pointer}
.wt-option[hidden]{display:none}.wt-option.wt-continue{margin-top:-6px}.wt-option input{margin:1px 0 0;accent-color:#6f8a55}.wt-option b{display:block;font:600 11px var(--pg-sans);color:#3f453a}.wt-option small{color:#858a80;font:9px/1.45 var(--pg-sans)}
.wt-compose{position:relative;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex:none;height:24px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:var(--white);color:var(--muted);font:inherit;font-size:11px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .18s ease,border-color .18s ease,color .18s ease}.wt-compose[hidden]{display:none}
.wt-compose input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}.wt-compose>svg{flex:none}
.wt-compose:hover{background:color-mix(in srgb,var(--ink) 4%,var(--white));border-color:color-mix(in srgb,var(--ink) 14%,var(--line));color:var(--ink)}
.wt-compose.on{background:color-mix(in srgb,var(--green) 9%,var(--white));border-color:color-mix(in srgb,var(--green) 35%,var(--line));color:var(--green)}
.wt-compose:has(input:focus-visible){outline:var(--pg-ring,2px) solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:1px}
@media (prefers-reduced-motion:reduce){.wt-compose{transition:none}}
.wt-badge{flex:none;display:inline-flex;max-width:230px;overflow:hidden;padding:2px 6px;border:1px solid #dfe6d5;border-radius:9px;background:#f3f6ee;color:#4f6b3a;font:8px var(--pg-sans);text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.wt-badge:hover{background:#eaf1e2}.wt-badge:focus-visible{outline:var(--pg-ring,2px) solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:1px}
.wt-badge>span{overflow:hidden;text-overflow:ellipsis}.wt-badge>.wt-name{flex:0 100 auto;min-width:1.7em}.wt-badge>.wt-badge-counts{flex:none} /* a narrow header shortens the name first (the full branch is in the title); ⎇ always stays */
`;
  document.head.append(style);

  // ---- Connection picker: opt-in "Own worktree" (reset each time the picker opens) ----
  let pending = null; // { agent, at } from the last card click with the option checked
  const launcher = document.querySelector('.terminal-launcher'),
    overlay = launcher?.closest('.terminal-launcher-overlay');
  const option = el('label', 'wt-option');
  option.hidden = true;
  option.innerHTML =
    '<input type="checkbox" id="wtOwn"><span><b>Own worktree</b><small>Start in a separate folder on a new branch (tnai/…) from the current commit, so several agents can edit at once. Merge or remove it from the agent’s row on Overview (⎇ button).</small></span>';
  const box = option.querySelector('input');
  if (launcher) launcher.querySelector('.terminal-launcher-grid')?.before(option);

  // Reattach: "Continue in ⎇ <branch>" rows (the same option style) for free worktrees, newest
  // first; the agent picked below starts in that folder on that branch.
  const continues = [];
  let freeToken = 0;

  async function paintContinues(keep) {
    const my = ++freeToken;
    let free = [];
    if (launcher && repoReady())
      try {
        const r = await native.git.worktreeFree?.('');
        free = Array.isArray(r) ? r.slice(0, 3) : [];
      } catch {}
    if (my !== freeToken) return;

    // a repaint after the git refresh keeps the choice
    const was = keep ? continues.find(r => r.querySelector('input').checked)?.dataset.branch : '';
    continues.splice(0).forEach(n => n.remove());
    let at = option;
    for (const w of free) {
      const row = el('label', 'wt-option wt-continue');
      row.dataset.branch = w.branch;
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!was && w.branch === was;
      const text = el('span');
      text.append(
        el('b', '', 'Continue in ⎇ ' + w.branch),
        el(
          'small',
          '',
          (w.agent ? w.agent + '’s' : 'An') +
            ' earlier worktree, no panel now. The agent you pick below starts in it, on that branch, instead of a new one. Its work stays until you merge or discard it from the agent’s row on Overview (⎇ button).'
        )
      );
      row.append(input, text);
      at.after(row);
      at = row;
      continues.push(row);
    }
  }
  const boxes = () => [box, ...continues.map(r => r.querySelector('input'))];
  launcher?.addEventListener('change', event => {
    if (event.target.checked && boxes().includes(event.target))
      boxes().forEach(b => {
        if (b !== event.target) b.checked = false;
      });
  }); // one choice at a time
  if (overlay)
    new MutationObserver(() => {
      if (!overlay.hidden) {
        box.checked = false;
        option.hidden = !repoReady();
        paintContinues();
        loadRepo().then(() => {
          option.hidden = !repoReady();
          paintContinues(true);
        });
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  launcher?.addEventListener(
    'click',
    event => {
      const card = event.target.closest('.terminal-provider-card');
      if (!card || card.disabled) return;
      const cont = continues.find(r => r.isConnected && r.querySelector('input').checked);
      pending = cont
        ? { agent: card.dataset.provider, at: Date.now(), branch: cont.dataset.branch }
        : box.checked && !option.hidden
          ? { agent: card.dataset.provider, at: Date.now() }
          : null;
    },
    true
  );

  // For the agent just picked in the picker (consumed once): true with Own worktree on, { branch }
  // with a Continue in ⎇ … row on, else false.
  function take(agent) {
    const p = pending;
    if (!p || p.agent !== agent || Date.now() - p.at > 15000) return false;
    pending = null;
    return p.branch ? { branch: p.branch } : true;
  }

  // ---- Composer New agent: the same opt-in, a checkbox beside the Agent · Model · Effort pickers
  // (46), shown while New agent is on ----
  const compose = el('label', 'wt-compose');
  compose.hidden = true;
  compose.innerHTML =
    '<input type="checkbox" id="wtCompose">' +
    window.TnaiIcon('folder-git-2', { size: 12 }) +
    // styled like the picker pills beside it (46); the real checkbox covers the pill
    '<span>Own worktree</span>';
  compose.title =
    'Own worktree: the new agent works in a separate copy of the project on its own branch (tnai/…), so it can edit alongside other agents without touching their files. Its sub-agents work there too. Merge or discard its work from its thread: Details, the ⎇ row under Setup.';
  const composeBox = compose.querySelector('input');
  const paintOn = () => compose.classList.toggle('on', composeBox.checked);
  composeBox.addEventListener('change', paintOn);

  function paintCompose() {
    // 46 builds the pickers after this file
    if (!compose.isConnected) document.querySelector('.composer .tnai-pickers')?.append(compose);
    const on = !!window.TnaiLiveTasks?.newAgent?.() && repoReady();
    compose.hidden = !on;
    if (!on) composeBox.checked = false;
    paintOn(); // one choice per New agent send (11 turns New agent off after it)
  }
  window.addEventListener('tnai:new-agent-changed', paintCompose);

  // The one place every start path asks whether a pane starts in its own worktree (10 start →
  // pty:start `worktree`). Opt-in: false unless the caller passed worktree: true, the composer's
  // box is checked (from: 'composer', 19), or the picker option was on for this agent. Sub-agents
  // are decided in main by tnai_delegate's `worktree` (inherit / own / none); a restarted pane
  // keeps its worktree in main either way.
  function want(pane = {}) {
    if (pane.mode === 'login' || pane.subagentOf) return false;
    if (pane.worktree?.branch) return { branch: String(pane.worktree.branch) };
    if (pane.worktree === true) return true;
    if (pane.from === 'composer') return composeBox.checked && !compose.hidden;
    return take(pane.agent);
  }

  // ---- Pane badges: paneId → branch (from the desktop records; refreshed on git:changed) + the
  // worktree's counts: "⎇ <name> · Nf · M↑" (short, so it fits a narrow header; the tooltip spells
  // it out) ----
  let panes = {},
    // counts: branch → { changes, commits } from the last worktrees list (push-refreshed)
    counts = {};
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  function paintBadges() {
    const started = new Map(
      (window.TnaiAgents?.sessions?.() || []).map(s => [s.paneId, s.worktree || ''])
    ); // pty:start's answer, before git:changed reloads panes
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const branch = panes[pane.dataset.paneId] || started.get(pane.dataset.paneId) || '';
      let badge = pane.querySelector('.wt-badge');
      if (!branch) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = el('span', 'wt-badge');
        badge.setAttribute('role', 'button');
        badge.tabIndex = 0;
        badge.append(el('span', 'wt-name'), el('span', 'wt-badge-counts'));
        pane.querySelector('.terminal-pane-title')?.after(badge);
      }
      const c = counts[branch] || {},
        extra = [
          c.changes ? plural(c.changes, 'file') : '',
          c.commits ? plural(c.commits, 'commit') + ' ahead' : '',
        ]
          .filter(Boolean)
          .join(' · ');
      const short = [c.changes ? c.changes + 'f' : '', c.commits ? c.commits + '↑' : '']
        .filter(Boolean)
        .join(' · ');
      const name = '⎇ ' + branch.replace(/^tnai\//, ''),
        tail = short ? ' · ' + short : '';
      if (
        badge.dataset.branch === branch &&
        badge.firstChild.textContent === name &&
        badge.lastChild.textContent === tail
      )
        return;
      badge.dataset.branch = branch;
      badge.firstChild.textContent = name;
      badge.lastChild.textContent = tail;
      badge.title =
        'Own git worktree · branch ' +
        branch +
        (extra ? ' · ' + extra : '') +
        ' · click to merge, keep working or discard it';
    });
  }

  async function loadPanes() {
    try {
      panes = (await native.git.worktreePanes()) || {};
    } catch {
      panes = {};
    }
    paintBadges();
    loadFree();
  }

  // Worktrees no panel holds (worktree-service free(): records only, no git calls): the ⎇ popover
  // lists them so they can be landed too, and the three-dots menu (124) has a row "Worktrees
  // without a panel" while there are any (`free()`; the old Overview's own button went with it).
  let freeList = [];

  async function loadFree() {
    let r = [];
    try {
      r = await native.git.worktreeFree('');
    } catch {}
    freeList = (Array.isArray(r) ? r : []).filter(w => /^tnai\//.test(w.branch || ''));
    if (at && !at.busy) paintPop();
  }
  const setCounts = value => {
    counts = {};
    for (const w of value?.items || [])
      counts[w.branch] = { changes: w.changes, commits: w.commits };
    paintBadges();
  };

  // The worktree list (counts for the badges, facts for land()): one read at a time; an event
  // during it reads once more.
  let list = null,
    countsBusy = false,
    countsAgain = false;
  const changedEvent = () => window.dispatchEvent(new CustomEvent('tnai:worktrees-changed'));

  async function loadCounts() {
    if (!Object.keys(panes).length && !document.querySelector('.wt-badge')) {
      counts = {};
      list = null;
      changedEvent();
      return;
    }
    if (countsBusy) {
      countsAgain = true;
      return;
    }
    countsBusy = true;
    try {
      const res = await native.git.worktrees();
      list = res.ok ? res.value : null;
      setCounts(list);
    } catch {
    } finally {
      countsBusy = false;
    }
    changedEvent();
    if (countsAgain) {
      countsAgain = false;
      loadCounts();
    }
  }

  // Click (or Enter/Space) on a badge: that worktree's Merge / Keep working / Discard popover, at
  // the badge.
  const badgeOf = target => target.closest?.('.terminal-pane .wt-badge');
  document.addEventListener('click', event => {
    const b = badgeOf(event.target);
    if (b?.dataset.branch) land(b.dataset.branch, b);
  });
  document.addEventListener('keydown', event => {
    const b = event.key === 'Enter' || event.key === ' ' ? badgeOf(event.target) : null;
    if (b?.dataset.branch) {
      event.preventDefault();
      land(b.dataset.branch, b);
    }
  });
  window.TnaiAgents?.onChange?.(paintBadges);
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    if (id) native.git.worktreeRelease(id);
  }); // also a sub-agent sharing its lead's worktree (main's sharedLanes)

  // ---- land(paneIdOrBranch, anchor): a small popover at the ⎇ button of an agent's Agent Tree row
  // (94), its focus view head (99) or its panel badge ---- Shows the branch, commits to merge into
  // the project folder's current branch, +/− lines and uncommitted changes (never merged), then
  // Merge (worktree-service merge: --no-ff; refusals and conflicts are shown here), Keep working
  // (closes) or Discard (asks Yes / No inside the popover first).
  const pop = el('div', 'pgo-qpop wt-pop');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Agent worktree');
  document.body.append(pop);

  // { branch, anchor, item, current, busy, confirm, note: { text, kind }, done } while the popover
  // is open
  let at = null;
  const broken = w => w.missing || (w.branchMissing && !w.detached);
  const branchOf = key =>
    panes[key] ||
    (window.TnaiAgents?.sessions?.() || []).find(s => s.paneId === key)?.worktree ||
    String(key || '');

  function button(label, act, cls, title, disabled) {
    const b = el('button', 'pgo-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.dataset.act = act;
    if (title) b.title = title;
    b.disabled = !!disabled;
    return b;
  }

  function paintPop() {
    if (!at) return;
    const w = at.item,
      into = at.current || 'the current branch';
    const head = el('h4', '', '⎇ ' + at.branch);
    head.title = w?.dir || at.branch;
    const body = [head];
    if (!w && !at.done && !at.note) body.push(el('p', 'note', 'Reading the worktree…'));
    else if (w && !at.done) {
      const facts = el('p', 'wt-facts');
      if (w.missing) facts.textContent = 'Its folder is missing. Discard cleans it up.';
      else if (w.branchMissing && !w.detached)
        facts.textContent = 'Its branch was deleted outside Technically Not. Discard cleans it up.';
      else {
        facts.append(
          el(
            'span',
            '',
            w.commits
              ? plural(w.commits, 'commit') + ' to merge into ' + into
              : 'Nothing to merge into ' + into + ' yet'
          )
        );
        if (w.commits)
          facts.append(
            el('span', 'wt-add', '+' + (w.added || 0)),
            el('span', 'wt-del', '−' + (w.removed || 0))
          );
      }
      body.push(facts);
      if (w.changes && !broken(w)) {
        const one = w.changes === 1;
        body.push(
          el(
            'p',
            'note',
            plural(w.changes, 'uncommitted change') +
              ' in the worktree ' +
              (one ? 'is' : 'are') +
              ' not merged (only commits are). Commit ' +
              (one ? 'it' : 'them') +
              ' in the worktree to include ' +
              (one ? 'it' : 'them') +
              '.'
          )
        );
      }
    }
    if (at.confirm) {
      const lost = [
        w?.changes ? plural(w.changes, 'uncommitted change') : '',
        w?.commits ? plural(w.commits, 'unmerged commit') : '',
      ]
        .filter(Boolean)
        .join(' and ');
      body.push(
        el(
          'p',
          'wt-ask',
          'Discard ⎇ ' +
            at.branch +
            '?' +
            (lost
              ? ' Its ' + lost + ' are deleted with it.'
              : ' Its folder and branch are removed.')
        )
      );
    }
    if (at.note)
      body.push(el('p', 'wt-note' + (at.note.kind ? ' ' + at.note.kind : ''), at.note.text));
    const row = el('div', 'qa');
    if (at.done) row.append(button('Close', 'keep'));
    else if (at.confirm)
      row.append(
        button(
          'Yes',
          'discard-yes',
          'stop',
          'Remove the worktree folder and delete its branch',
          at.busy
        ),
        button('No', 'discard-no', '', 'Keep the worktree', at.busy)
      );
    else {
      const canMerge = !!w && !broken(w) && !!w.commits && !!at.current;
      row.append(
        button(
          'Merge',
          'merge',
          'pri',
          !at.current
            ? 'HEAD is detached in the project folder'
            : canMerge
              ? 'Merge ' +
                plural(w.commits, 'commit') +
                ' into ' +
                at.current +
                ' with a merge commit'
              : 'No commits to merge yet',
          at.busy || !canMerge
        ),
        button('Keep working', 'keep', '', 'Close · nothing changes'),
        button(
          'Discard',
          'discard',
          'stop',
          w?.running
            ? 'A thread is running in this worktree · stop it first'
            : 'Remove this worktree (asks first)',
          at.busy || !w || w.running
        )
      );
    }
    body.push(row);
    const others = freeList.filter(f => f.branch !== at.branch);
    if (others.length) {
      const grp = el('div', 'grp');
      grp.append(el('div', 'who', 'Worktrees without a panel'));
      for (const f of others) {
        const qi = el('div', 'qi'),
          tx = el('span', 'tx', '⎇ ' + f.branch);
        tx.title = (f.agent ? f.agent + '’s worktree · ' : '') + (f.dir || f.branch);
        const go = button(
          'Open',
          'go',
          '',
          'Show Merge / Keep working / Discard for ' + f.branch,
          at.busy
        );
        go.dataset.branch = f.branch;
        qi.append(tx, go);
        grp.append(qi);
      }
      body.push(grp);
    }
    pop.replaceChildren(...body);
  }

  async function readItem() {
    const branch = at?.branch;
    const res = await native.git.worktrees().catch(() => null);
    if (!at || at.branch !== branch) return;
    if (res?.ok) {
      list = res.value;
      setCounts(list);
      changedEvent();
    }
    at.current = res?.ok ? res.value.current : '';
    at.item = res?.ok ? res.value.items.find(i => i.branch === branch) || null : null;
    if (!at.item && !at.done)
      at.note = {
        text: res?.ok
          ? 'This worktree no longer exists.'
          : res?.error?.message || 'Could not read the worktree.',
        kind: 'error',
      };
    paintPop();
  }

  function closePop() {
    if (!at) return;
    const anchor = at.anchor;
    at = null;
    pop.hidden = true;
    window.TnaiFloat?.detach(pop);
    if (pop.contains(document.activeElement) && anchor?.isConnected) anchor.focus();
  }

  function land(key, anchor) {
    const branch = branchOf(key);
    if (!branch) return;
    if (at && at.branch === branch) {
      closePop();
      return;
    } // a second click on its ⎇ button closes it (94 may have repainted the row: a new button)
    show(branch, anchor);
  }

  function show(branch, anchor) {
    at = {
      branch,
      anchor,
      item: list?.items?.find(i => i.branch === branch) || null,
      current: list?.current || '',
      busy: false,
      confirm: false,
      note: null,
      done: false,
    };
    pop.hidden = false;
    paintPop();
    if (anchor) window.TnaiFloat?.attach(anchor, pop, { placement: 'bottom-end' });
    pop.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    readItem();
  }

  async function act(kind) {
    if (!at || at.busy) return;
    const branch = at.branch;
    if (kind === 'keep') return closePop();
    if (kind.startsWith('go:')) {
      show(kind.slice(3), at.anchor);
      return;
    }
    if (kind === 'discard' || kind === 'discard-no') {
      at.confirm = kind === 'discard';
      at.note = null;
      return paintPop();
    }
    at.busy = true;
    at.note = {
      text: kind === 'merge' ? 'Merging ' + branch + '…' : 'Removing ' + branch + '…',
      kind: '',
    };
    paintPop();
    let res;
    try {
      res =
        kind === 'merge'
          ? await native.git.worktreeMerge(branch)
          : await native.git.worktreeRemove(branch, { discard: true, deleteBranch: true });
    } catch (error) {
      res = { ok: false, error: { message: error.message } };
    }
    if (!at || at.branch !== branch) return;
    at.busy = false;
    at.confirm = false;
    if (!res.ok)
      // a dirty project folder, a conflict (the merge was aborted), a running panel…
      at.note = { text: res.error.message, kind: 'error' };
    else if (kind === 'merge') {
      const v = res.value,
        kept = v.uncommitted
          ? ' ' + plural(v.uncommitted, 'uncommitted change') + ' stayed in the worktree.'
          : '';
      at.note = {
        text:
          (v.upToDate
            ? v.into + ' already has every commit from ' + branch + '.'
            : 'Merged ' + plural(v.merged, 'commit') + ' into ' + v.into + '.') + kept,
        kind: 'ok',
      };
    } else {
      at.done = true;
      at.item = null;
      at.note = {
        text:
          'Removed ⎇ ' +
          branch +
          (res.value.branchDeleted ? ' and its branch.' : ' · its branch was kept.'),
        kind: 'ok',
      };
    }
    paintPop();
    await loadPanes();
    await readItem();
  }
  pop.addEventListener('click', event => {
    const b = event.target.closest('button[data-act]');
    if (b && !b.disabled) act(b.dataset.act === 'go' ? 'go:' + b.dataset.branch : b.dataset.act);
  });
  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && at) {
        event.stopPropagation();
        closePop();
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    event => {
      if (
        at &&
        !pop.contains(event.target) &&
        !event.target.closest?.('[data-a="land"], .wt-badge, .tnt-menu-row, [data-worktree]')
      )
        closePop();
    },
    true
  ); // an ⎇ button's own click toggles in land()

  // Repo facts for the Own worktree options (a git project with commits, on a branch): git:status,
  // read again on every git:changed.
  let repo = null;
  const repoReady = () => !!(repo?.repo && !repo.initial && !repo.detached);

  async function loadRepo() {
    try {
      const r = await native.git.status();
      repo = r?.ok ? r.value : null;
    } catch {
      repo = null;
    }
    paintCompose();
  }

  native.git.onChanged(async () => {
    loadRepo();
    await loadPanes();
    loadCounts();
    if (at && !at.busy) readItem();
  });
  loadRepo();
  loadPanes().then(loadCounts);
  window.TnaiWorktrees = {
    want,
    take,
    land,
    refresh: () => Promise.all([loadRepo(), loadPanes().then(loadCounts)]),
    panes: () => ({ ...panes }),

    // The worktree a panel works in, for the thread's Details (139): its branch and how much is
    // on it, or null when the panel works in the project folder itself.
    of(paneId) {
      const session = (window.TnaiAgents?.sessions?.() || []).find(one => one.paneId === paneId);
      const branch = panes[paneId] || session?.worktree || '';
      if (!branch) return null;
      const count = counts[branch] || {};
      return { branch, changes: count.changes || 0, commits: count.commits || 0 };
    },
    list: () => list,
    free: () => freeList.slice(),
  };
})();
