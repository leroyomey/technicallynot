/*
 * Technically Not · 71-needs-you.js — Desktop only: agents stopped on a question for the user
 * (tnaiNative.attention, pushed by main: a tool permission, a numbered menu, a prompt left unsent
 * in the CLI's input, folder trust). window.TnaiNeedsYou gives 10 the pane status "needs-you" + its
 * label; a "N need you" chip in the composer's activity line (hidden at 0; agents waiting on a
 * decision count too) and Ctrl+Shift+J jump to the oldest (decisions after main's questions); a
 * notice above the composer says when a sent prompt is held by main until the question is answered
 * (Go to it · Send anyway · Cancel) or was left unsent (Press Enter for it). New items chime (the
 * sound setting), prefix the window title "(N) " and ask main for a Windows notification (shown
 * only while the window is unfocused); once more after 45 s unanswered. No attention API: no-op.
 */
(() => {
  const attention = window.tnaiNative?.attention,
    pty = window.tnaiNative?.pty;
  if (!attention) return;

  const byPane = new Map(); // paneId -> items, oldest first
  let items = [],
    held = [],
    decided = []; // decided: paneIds waiting only on a decision (paintChip)
  const heldText = new Map(); // heldId -> the composer's own words, put back on Cancel
  const heldInfo = new Map(); // heldId -> { reason, detail } from the submit result
  const lastSent = new Map(); // paneId -> when a prompt was last sent to it (10 send)
  window.addEventListener('tnai:terminal-pane-closed', e => lastSent.delete(e.detail?.paneId));
  const seen = new Set(),
    timers = new Map(),
    reminded = new Set();
  let notice = null; // { type: 'held' | 'unsent', paneId, heldId?, error? }

  const session = paneId => window.TnaiAgents?.sessions?.().find(s => s.paneId === paneId);
  const nameOf = paneId =>
    session(paneId)?.name ||
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"] .terminal-pane-title'
      )
      ?.textContent.trim() ||
    'The agent';
  const toolOf = item =>
    item.tool ||
    String(item.detail || '')
      .trim()
      .split(/[\s:·(]/)[0] ||
    'a tool';
  const reason = item =>
    !item
      ? ''
      : item.kind === 'permission'
        ? 'asks to use ' + toolOf(item)
        : item.kind === 'menu'
          ? 'asking a question' + (item.inferred === false ? '' : ' (inferred)')
          : item.kind === 'unsent'
            ? 'prompt not sent — press Enter'
            : item.kind === 'trust'
              ? 'folder trust'
              : 'waiting on you';
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  // ---------- chip in the composer's activity line ----------
  const style = document.createElement('style');
  style.textContent = `
.tnai-needs-chip{margin-left:auto;display:inline-flex;align-items:center;padding:2px 9px;font:inherit;font-size:11px;line-height:17px;cursor:pointer;white-space:nowrap}
.tnai-needs-chip[hidden]{display:none}
.tnai-needs-chip .dot{flex:none}
.tnai-needs-chip:hover{filter:brightness(.97)}
.tnai-needs-chip:focus-visible{outline:var(--pg-ring,2px) solid var(--green);outline-offset:1px}
.tnai-needs-chip.tnai-urgent{animation:stPulse 1.4s ease-in-out 4}
.tnai-perm.tnai-held .tnai-perm-desc{color:var(--ink)}`;
  document.head.append(style);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'status tnai-needs-chip';
  chip.hidden = true;
  chip.innerHTML = '<i class="dot"></i><span></span>';
  chip.addEventListener('click', event => {
    event.stopPropagation();
    jumpOldest();
  }); // the activity line itself opens the Threads page
  document.getElementById('activityToggle')?.append(chip);

  // ---------- held / unsent notice above the composer (the permission card's look, 45) ----------
  const card = document.createElement('div');
  card.className = 'tnai-perm tnai-held';
  card.hidden = true;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML =
    '<div class="tnai-perm-head"><b></b><span class="tnai-perm-tool"></span><span class="tnai-perm-count"></span></div><div class="tnai-perm-desc"></div><div class="tnai-perm-actions"></div>';
  document.body.append(card);
  const [cardName, cardTag, cardCount] = card.querySelector('.tnai-perm-head').children;
  const cardDesc = card.querySelector('.tnai-perm-desc'),
    cardActions = card.querySelector('.tnai-perm-actions');

  function place() {
    if (card.hidden) return;

    // Just above the docked composer, or above the permission card (45) when that shows too.
    const perm = [...document.querySelectorAll('.tnai-perm:not(.tnai-held)')].find(
      el => !el.hidden
    );
    const top = perm
      ? perm.getBoundingClientRect().top
      : document.querySelector('.composer')?.getBoundingClientRect().top;
    card.style.bottom =
      top > 0 && top < innerHeight - 40
        ? Math.round(innerHeight - top + (perm ? 8 : 12)) + 'px'
        : '';
  }
  const button = (text, act, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset.act = act;
    if (cls) b.className = cls;
    return b;
  };

  // The card's buttons are made once per kind of card and then left alone. The card is painted
  // again whenever the keyboard moves (refocus below) and on every push from main, and pressing a
  // button moves the keyboard to it: buttons made anew between the press and the release never
  // got their click, so "Go to it" did nothing.
  let actionsKind = '';
  const showActions = (kind, make) => {
    if (actionsKind === kind) return;
    actionsKind = kind;
    cardActions.replaceChildren(...make());
  };

  // A `tnai send` message waiting for the text the user is typing in that same panel right now
  // (it would point at the very panel the user is in): no card, the
  // "unsent text" is their own prompt and the message still sends once they send or clear it. The
  // card shows once they leave that panel. Every view of the agent counts (the
  // card kept coming while they typed to the agent outside the Terminal page): the Agents page
  // view, the Overview focus view and Build panels have their own terminal (10 views).
  const typingIn = paneId => {
    const at = document.activeElement;
    if (!at) return false;
    if (at.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId === paneId) return true;
    return (window.TnaiAgents?.views?.() || []).some(
      v => v.paneId === paneId && v.term.element?.contains(at)
    );
  };

  // A prompt held only because its agent is still working gets no card
  // either: it is not waiting on the user. It shows in that agent's queue on the Agents page (25),
  // with Send now, Edit and Remove.
  const waiting = h => h.why === 'busy' || h.why === 'queue';
  const quiet = h => waiting(h) || (h.waitDraft && typingIn(h.paneId));
  const heldChanged = () => window.dispatchEvent(new CustomEvent('tnai:held'));

  function paintNotice() {
    const shown = held.filter(h => !quiet(h));
    if (notice?.type === 'held' && !shown.some(h => h.id === notice.heldId))
      notice = shown[0] ? { type: 'held', paneId: shown[0].paneId, heldId: shown[0].id } : null;
    if (!notice && shown[0])
      notice = { type: 'held', paneId: shown[0].paneId, heldId: shown[0].id };
    card.hidden = !notice;
    if (!notice) return;
    const name = nameOf(notice.paneId);
    cardName.textContent = name;
    if (notice.type === 'held') {
      const item = byPane.get(notice.paneId)?.[0],
        info = heldInfo.get(notice.heldId) || {};
      const why = item ? reason(item) : info.reason || info.detail || 'a question in its terminal';
      cardTag.textContent = 'Prompt held';
      cardCount.textContent = held.length > 1 ? held.length + ' held' : '';
      const heldOne = held.find(h => h.id === notice.heldId),
        mesh = heldOne?.from; // a `tnai send` message held for the user's unsent text in that input

      // A prompt sent from the user's other computer (attention-service.js marks it `remote`) is
      // named as that, never as "your prompt": the person at this computer did not write it.
      cardDesc.textContent = heldOne?.remote
        ? item
          ? name +
            ' is waiting on you (' +
            why +
            ') — a prompt from ' +
            mesh +
            ' is held and sends when you answer.'
          : name +
            ' has unsent text in its input — a prompt from ' +
            mesh +
            ' is held and sends when you send or clear that text.'
        : mesh && !item
          ? name +
            ' has unsent text in its input — a message from ' +
            mesh +
            ' is held and sends when you send or clear that text.'
          : name +
            ' is waiting on you (' +
            why +
            ') — your prompt is held and sends when you answer.';
      showActions('held', () => [
        button('Go to it', 'go', 'allow'),
        button('Send anyway', 'send'),
        button('Cancel', 'cancel', 'later'),
      ]);
    } else {
      cardTag.textContent = 'Not sent';
      cardCount.textContent = '';
      cardDesc.textContent =
        name +
        ' did not start the message' +
        (notice.error ? ': ' + notice.error : '.') +
        ' It is still in its input.';
      showActions('unsent', () => [
        button('Press Enter for it', 'enter', 'allow'),
        button('Go to it', 'go'),
        button('Dismiss', 'dismiss', 'later'),
      ]);
    }
    place();
  }
  const composerBack = text => {
    const input = document.getElementById('prompt');
    if (!input || !text) return;
    input.value = input.value.trim() ? text + '\n' + input.value : text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  cardActions.addEventListener('click', async event => {
    const act = event.target.closest('button[data-act]')?.dataset.act,
      n = notice;
    if (!act || !n) return;
    if (act === 'go') {
      jump(n.paneId);
      return;
    }
    if (act === 'dismiss') {
      notice = null;
      paintNotice();
      return;
    }
    if (act === 'enter') {
      notice = null;
      paintNotice();
      try {
        await pty?.write(n.paneId, '\r');
      } catch {}
      return;
    }
    const id = n.heldId;
    notice = null;
    if (act === 'send') sendHeld(id);
    else if (act === 'cancel') takeHeld(id, true);
  });
  const drop = heldId => {
    held = held.filter(h => h.id !== heldId);
    heldChanged();
  };

  // Send a held prompt now (it goes to the CLI, which takes it or keeps it in its own queue), or
  // take it out: back into the composer (the user's own prompt, to edit or after Cancel) or dropped
  // (Remove; an agent's message is never put into the composer).
  async function sendHeld(id) {
    const paneId = held.find(h => h.id === id)?.paneId;
    drop(id);
    paintNotice();
    try {
      const r = await attention.sendHeldNow(id);
      if (r?.state === 'not-submitted') notSubmitted(paneId, r.error);
    } catch (e) {
      say('Could not send the held prompt: ' + (e?.message || e));
    }
  }

  async function takeHeld(id, back) {
    const h = held.find(x => x.id === id);
    let text = heldText.get(id);
    drop(id);
    paintNotice();
    try {
      const got = await attention.cancelHeld(id);
      text = text || (typeof got === 'string' ? got : got?.text) || '';
    } catch {}
    text = text || (h?.from ? '' : h?.text) || '';
    heldText.delete(id);
    heldInfo.delete(id);
    if (back && text && !h?.from) {
      composerBack(text);
      say('Held prompt cancelled · it is back in the composer');
    } else
      say(
        h?.from
          ? 'Held message from ' + h.from + ' removed · not delivered'
          : 'Held prompt removed · not sent'
      );
  }
  const notSubmitted = (paneId, error) => {
    notice = { type: 'unsent', paneId, error: error || '' };
    paintNotice();
  };
  addEventListener('resize', place);
  const refocus = () => {
    if (held.some(h => h.waitDraft)) setTimeout(paintNotice, 0);
  }; // the card above follows which panel has the keyboard
  document.addEventListener('focusin', refocus);
  document.addEventListener('focusout', refocus);

  // ---------- jump ----------
  // Opens only that agent's terminal panel: maximized in its grid (21), the others wait as chips
  // below (Restore / Esc bring the grid back). Maximized first, while the Terminal page may still
  // be hidden: showing it then lays out and refits one terminal, not every panel in the grid and
  // then this one again for the maximize. Already maximized: left as it is (never toggled back to
  // the grid). The composer target is set after the page switch: setTarget renders the agent tree
  // at once, which on a shown Overview measures every card (forced layouts) just before the page is
  // left; hidden, that render measures nothing.
  function jump(paneId) {
    if (!paneId) return;
    const pane = document.querySelector(
      '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]'
    );
    if (pane && !pane.classList.contains('tnai-max-pane'))
      window.TnaiTerminalGrid?.maximize?.(paneId);
    if (window.TnaiLiveTasks?.focusPane)
      window.TnaiLiveTasks.focusPane(paneId); // its terminal, spotlighted and focused (11)
    else if (!window.TnaiThreads?.show?.(paneId)) window.TnaiThreads?.open?.();
    window.TnaiLiveTasks?.setTarget?.(paneId);
  }
  const oldest = () => items.slice().sort((a, b) => (a.since || 0) - (b.since || 0))[0];

  // Agents waiting only on a decision (a picker question or an open "- Decide:" line; no item from
  // main): their status is already needs-you (10).
  const deciders = () =>
    (window.TnaiAgents?.sessions?.() || [])
      .filter(s => s.status === 'needs-you' && !byPane.has(s.paneId))
      .map(s => s.paneId);

  // Main's questions first (oldest), then the decisions.
  const jumpOldest = () => {
    const paneId = oldest()?.paneId || deciders()[0];
    if (paneId) jump(paneId);
    else say('No agent needs you right now');
  };

  // Capture phase: before a focused terminal (xterm would send Ctrl+J to the program).
  addEventListener(
    'keydown',
    event => {
      if (
        !window.tnaiPlatform.mod(event) ||
        !event.shiftKey ||
        event.altKey ||
        window.tnaiPlatform.otherMod(event) ||
        event.key.toLowerCase() !== 'j'
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      jumpOldest();
    },
    true
  );

  // ---------- window title "(N) " ----------
  const titleEl = document.querySelector('title');
  const paintTitle = () => {
    const n = items.length + decided.length,
      base = document.title.replace(/^\(\d+\) /, ''),
      want = (n ? '(' + n + ') ' : '') + base;
    if (document.title !== want) document.title = want;
  };
  if (titleEl)
    new MutationObserver(paintTitle).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });

  // ---------- escalation ----------
  const tell = item =>
    Promise.resolve()
      .then(() =>
        attention.notify({
          paneId: item.paneId,
          title: nameOf(item.paneId) + ' needs you',
          body: item.detail || reason(item),
        })
      )
      .catch(() => {});

  function escalate(item) {
    // "I thought it was starting": nudge at once
    const urgent = Date.now() - (lastSent.get(item.paneId) || 0) < 20000;
    const fire = () => {
      if (!byPane.has(item.paneId) || !items.some(i => i.id === item.id)) return;

      // respects the Notification sounds setting (Settings › Agents; stored by 03)
      window.TnaiNotify?.play();
      tell(item);
      if (urgent && !(notice?.type === 'held' && notice.paneId === item.paneId))
        say(
          nameOf(item.paneId) +
            ' needs you · ' +
            reason(item) +
            ' · ' +
            window.tnaiKeys('Ctrl+Shift+J') +
            ' to go there'
        );
    };

    // a menu that flickers past isn't worth a chime
    const t = { first: setTimeout(fire, urgent ? 0 : 3000) };
    t.remind = setTimeout(() => {
      if (!items.some(i => i.id === item.id) || reminded.has(item.id)) return;
      reminded.add(item.id);
      chip.classList.remove('tnai-urgent');
      void chip.offsetWidth;
      chip.classList.add('tnai-urgent');
      tell(item);
    }, 45000);
    timers.set(item.id, t);
  }

  // ---------- "unsent text" checked against the screen ----------
  // Main counts the user's unsent text from their keys (attention-service.js); a miscount left a
  // message held for an input that was empty. Claude Code draws its input
  // as a "❯" row between two rule lines; when that row holds nothing but dim text (its placeholder
  // or a suggestion) in every view built for the agent, twice over 1.2 s, main is told and drops
  // the count. Anything else on screen (text, a second input row, bash mode's other marker, another
  // CLI, no view built) changes nothing: the message stays held.
  const RULE = /^[─━]{8,}$/;

  function boxEmpty(term) {
    const buf = term?.buffer?.active;
    if (!buf || buf.type !== 'normal') return false;
    const text = y => buf.getLine(y)?.translateToString(true).trim() ?? '';
    for (let y = buf.baseY + term.rows - 1; y > buf.baseY; y--) {
      if (!/^❯(\s|$)/.test(text(y))) continue;
      if (!RULE.test(text(y - 1)) || !RULE.test(text(y + 1))) return false;
      for (let x = 1, line = buf.getLine(y); x < term.cols; x++) {
        const c = line.getCell(x);
        if (c && c.getChars().trim() && !c.isDim()) return false;
      }
      return true;
    }
    return false;
  }
  const readsEmpty = paneId => {
    if (window.TnaiAgents?.sessions?.().find(s => s.paneId === paneId)?.agent !== 'Claude Code')
      return false;
    const terms = (window.TnaiAgents.views?.() || [])
      .filter(v => v.paneId === paneId && v.term.element)
      .map(v => v.term);
    return terms.length > 0 && terms.every(boxEmpty);
  };
  const emptyChecks = new Map(); // paneId -> timer of its second read

  function checkDrafts() {
    for (const paneId of new Set(held.filter(h => h.why === 'draft').map(h => h.paneId))) {
      if (emptyChecks.has(paneId) || !readsEmpty(paneId)) continue;
      emptyChecks.set(
        paneId,
        setTimeout(() => {
          emptyChecks.delete(paneId);
          if (held.some(h => h.paneId === paneId && h.why === 'draft') && readsEmpty(paneId))
            Promise.resolve(attention.inputEmpty?.(paneId)).catch(() => {});
        }, 1200)
      );
    }
  }

  function apply(state, initial) {
    items = Array.isArray(state?.items)
      ? state.items.slice().sort((a, b) => (a.since || 0) - (b.since || 0))
      : [];
    const pushedHeld = Array.isArray(state?.held) ? state.held : [];

    // A held prompt this window just saw from its submit result stays until main's list catches up
    // with it.
    held = pushedHeld.concat(
      held.filter(h => h.local && !pushedHeld.some(p => p.id === h.id) && Date.now() - h.at < 3000)
    );
    byPane.clear();
    for (const item of items) {
      if (!byPane.has(item.paneId)) byPane.set(item.paneId, []);
      byPane.get(item.paneId).push(item);
    }
    for (const item of items)
      if (!seen.has(item.id)) {
        seen.add(item.id);
        if (!initial) escalate(item);
      }
    for (const [id, t] of timers)
      if (!items.some(i => i.id === id)) {
        clearTimeout(t.first);
        clearTimeout(t.remind);
        timers.delete(id);
      }

    // An item that left the list is forgotten: a screen-read question, folder trust and an unsent
    // prompt have one id per panel (`menu:<panel>`), so the next one in that panel is new again and
    // chimes, notifies and reminds (only the first one per panel did).
    for (const id of seen)
      if (!items.some(i => i.id === id)) {
        seen.delete(id);
        reminded.delete(id);
      }
    paintChip();
    paintNotice();
    heldChanged();
    checkDrafts();

    // pane headers, cards and counts change now, not on the next tick (10)
    window.TnaiAgents?.repaint?.();
  }

  // The chip, the title count and Ctrl+Shift+J count main's items plus agents waiting on a
  // decision.
  function paintChip() {
    decided = deciders();
    const n = items.length + decided.length;
    chip.hidden = !n;
    if (!items.length) chip.classList.remove('tnai-urgent');
    const text = n + (n === 1 ? ' needs you' : ' need you');
    if (chip.lastChild.textContent !== text) chip.lastChild.textContent = text;
    const first = oldest(),
      go = ' · click or ' + window.tnaiKeys('Ctrl+Shift+J') + ' to go there';
    const title = first
      ? 'Oldest: ' +
        nameOf(first.paneId) +
        ' · ' +
        reason(first) +
        (first.inferred ? ' (inferred)' : '') +
        go
      : decided.length
        ? nameOf(decided[0]) + ' · ' + window.TnaiNeedsYou.label(decided[0]) + go
        : '';
    if (chip.title !== title) chip.title = title;
    paintTitle();
  }

  // Decisions come and go with agent status (10 notifies when a status changes, 51/53 repaint it),
  // not with main's pushes.
  window.TnaiAgents?.onChange?.(paintChip);

  // 53 asking and 51 deciding read agents.sessions(), whose status() (10) calls has() here: the
  // nested read skips the decision instead of recursing without end (a stack overflow broke every
  // sessions() call while a pane ran).
  let deciding = false;
  const decision = paneId => {
    if (deciding) return '';
    deciding = true;
    try {
      const ask = window.TnaiLiveFeed?.asking?.(paneId);
      if (ask && !ask.inferred) return ask.text;
      const c = window.TnaiNextActions?.deciding?.(paneId);
      return c
        ? String(c.question || 'pick an option')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 90)
        : '';
    } finally {
      deciding = false;
    }
  };

  // ---------- API for 10 ----------
  window.TnaiNeedsYou = {
    // Also a decision the agent waits on: Claude Code's multiple-choice picker (53 asking, not the
    // inferred "ended on a question") or its report's unanswered "- Decide:" line (51 deciding).
    // Items from main (permission, menu, trust, unsent) win the label.
    has: paneId => byPane.has(paneId) || !!decision(paneId),
    label: paneId =>
      byPane.has(paneId) || !decision(paneId)
        ? 'Needs you · ' + reason(byPane.get(paneId)?.[0])
        : 'Needs your decision · ' + decision(paneId),
    items: () => items.slice(),
    sent: paneId => lastSent.set(paneId, Date.now()),
    held({ paneId, heldId, reason: why, detail, userText }) {
      if (!heldId) return;
      heldText.set(heldId, userText);
      heldInfo.set(heldId, { reason: why, detail });
      if (!held.some(h => h.id === heldId))
        held.push({
          id: heldId,
          paneId,
          preview: String(userText || '').slice(0, 80),
          text: String(userText || ''),
          why,
          at: Date.now(),
          local: true,
        });
      if (why === 'busy' || why === 'queue')
        say(
          nameOf(paneId) +
            ' is still working · your message waits at the end of its thread (send now, edit or remove)'
        );
      else notice = { type: 'held', paneId, heldId };
      paintNotice();
      heldChanged();
    },
    // 25's queue list: the prompts held here for one agent, oldest first, and what can be done with
    // each.
    heldFor: paneId =>
      held
        .filter(h => h.paneId === paneId)
        .map(h => ({
          id: h.id,
          text: heldText.get(h.id) || h.text || h.preview || '',
          from: h.from || '',
          why: h.why || '',
          ...(h.remote ? { remote: true } : null),
        })), // remote: sent from the user's other computer
    sendHeld,
    takeHeld,
    boxEmpty, // tests
    notSubmitted,
    jump,
    jumpOldest,
  };

  attention.on?.(state => apply(state, false));
  attention.onDelivered?.(({ heldId, paneId, result, from } = {}) => {
    drop(heldId);
    heldText.delete(heldId);
    heldInfo.delete(heldId);
    if (notice?.heldId === heldId) notice = null;
    const name = nameOf(paneId);
    if (result?.state === 'cancelled') {
      paintNotice();
      return;
    }
    if (result?.state === 'expired')
      say(
        'Held message from ' +
          (from || 'an agent') +
          ' not delivered to ' +
          name +
          ': ' +
          (result.error || 'it waited too long')
      );
    else if (result?.state === 'gone') say('Held prompt dropped: ' + name + ' stopped');
    else if (result?.state === 'not-submitted')
      notice = { type: 'unsent', paneId, error: result.error || '' };
    else say((from ? 'Held message from ' + from : 'Held prompt') + ' sent to ' + name);
    paintNotice();
  });
  attention.onJump?.(({ paneId } = {}) => jump(paneId));
  Promise.resolve(attention.list?.())
    .then(state => {
      if (state) apply(state, true);
    })
    .catch(() => {});
})();
