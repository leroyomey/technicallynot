// Technically Not · 125-thread-limit.js: "Usage limit reached" in the thread it stops. Desktop app
// only.
//
// When the agent of the open thread is paused by a usage limit, one card stands in the thread's
// own row between the conversation and the prompt box (.tnt-asks, where the permission, held
// prompt and trust cards stand): which account, when it continues, and what the user can do:
// Resume now on another signed-in account (only when one is free), Resume at reset, Resume.
//
// Nothing here detects a limit or resumes by itself: 15 (TnaiAccounts.limitFor, switchPane)
// detects and switches, 72 (TnaiLimitResume) plans and resumes. No timer and no observer: the
// card is repainted on their events and when another thread is chosen.
//
// Look: the card is a .tnt-ask (src/styles/29-thread-view.css), no rules of its own.
// `window.TnaiThreadLimit` (`state`). Test: `thread-limit`.
(() => {
  'use strict';
  const accounts = window.TnaiAccounts;
  const resume = window.TnaiLimitResume;
  const threads = () => window.TnaiThreads;
  if (!window.tnaiNative?.pty || !accounts?.limitFor || !resume?.resumeNow) return;

  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  // A time today as "11:58 PM", another day with its date.
  function clock(ms) {
    const when = new Date(ms);
    const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (when.toDateString() === new Date().toDateString()) return time;
    return time + ' ' + when.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  let card = null;
  let busy = false;

  // What the card says for the open thread, or null when its agent is not paused.
  function read() {
    const paneId = threads()?.selected?.() || '';
    const limit = paneId ? accounts.limitFor(paneId) : null;
    if (!limit) return null;
    const plan = resume.pending().find(entry => entry.paneId === paneId) || null;
    const planned = !!plan?.scheduled;
    const when = planned && plan.timed ? clock(plan.due) : '';
    let status = 'Paused until you choose.';
    if (planned)
      status = when
        ? 'Continues by itself at ' + when + '.'
        : 'Continues by itself once the limit resets (checked every 30 minutes).';
    return {
      paneId,
      account: limit.accountLabel || '',
      next: limit.suggest === null || limit.suggest === undefined ? null : limit.suggest,
      nextLabel: limit.suggestLabel || 'another account',
      planned,
      when,
      status,
    };
  }

  function makeCard() {
    card = document.createElement('div');
    card.className = 'tnt-ask tnt-limit';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Usage limit reached');
    card.innerHTML =
      '<div class="tnt-ask-text"><b>Usage limit reached</b><p></p></div>' +
      '<div class="tnt-ask-acts">' +
      '<button type="button" class="tnt-ask-no" data-limit="now" title="Try to continue now. If the limit is still on, this card comes back.">Resume</button>' +
      '<button type="button" class="tnt-ask-no" data-limit="reset"></button>' +
      '<button type="button" class="tnt-ask-yes" data-limit="switch"></button>' +
      '</div>';
    card.addEventListener('click', event => {
      const button = event.target.closest('[data-limit]');
      if (button) act(button.dataset.limit);
    });
  }

  function paint() {
    const row = threads()?.slot?.('main')?.querySelector('.tnt-asks') || null;
    const state = row ? read() : null;
    if (!state) {
      card?.remove();
      return;
    }
    if (!card) makeCard();
    const reset = card.querySelector('[data-limit="reset"]');
    const other = card.querySelector('[data-limit="switch"]');
    card.querySelector('p').textContent =
      (state.account ? state.account + ' · ' : '') + state.status;
    reset.textContent = 'Resume at reset' + (state.when ? ' · ' + state.when : '');
    reset.setAttribute('aria-pressed', String(state.planned));
    reset.title = state.planned
      ? 'On: this agent continues by itself a minute after the limit resets'
      : 'Continue by itself a minute after the limit resets';
    other.hidden = state.next === null;
    other.textContent = 'Resume now on ' + state.nextLabel;
    other.title =
      'Restart this agent on an account that still has usage and continue its conversation';
    card.querySelectorAll('button').forEach(button => {
      button.disabled = busy;
    });
    if (card.parentElement !== row) row.prepend(card);
  }

  async function act(kind) {
    const state = read();
    if (!state || busy) return;
    if (kind === 'reset') {
      say(
        resume.schedule(state.paneId)
          ? 'It continues once the usage limit resets'
          : 'Nothing to resume.'
      );
    } else if (kind === 'now') {
      resume.resumeNow(state.paneId);
    } else if (kind === 'switch' && state.next !== null) {
      busy = true;
      paint();
      try {
        await accounts.switchPane(state.paneId, state.next);
      } finally {
        busy = false;
      }
    }
    paint();
  }

  [
    'tnai:account-limit',
    'tnai:account-limit-cleared',
    'tnai:accounts-changed',
    'tnai:limit-plan',
    'tnai:threads-select',
    'tnai:threads-shown',
    'tnai:thread-view',
  ].forEach(name => window.addEventListener(name, paint));

  window.TnaiThreadLimit = {
    // What the card shows right now, for the tests: null when no card stands.
    state: () => (card?.isConnected ? read() : null),
  };
})();
