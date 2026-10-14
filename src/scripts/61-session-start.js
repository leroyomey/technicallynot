/*
 * Technically Not · 61-session-start.js — Desktop only: on a new app launch whose last session left
 * agent panes, asks once: restore them (their saved output, Enter resumes the conversation), or
 * start clean (every pane closed, an empty workspace). Start clean never touches project context
 * (desktop/agent-context.js, per project folder) or the project folder; closed conversations stay
 * revivable in the agent lifecycle. A window reload is not a new launch: no question. Exposes
 * window.TnaiSessionStart ({ ready: Promise<'restore'|'clean'|'none'>, choice }); 10 restores panes
 * only after `ready`.
 */
(() => {
  const native = window.tnaiNative;
  let settle;
  const api = (window.TnaiSessionStart = {
    ready: new Promise(r => {
      settle = r;
    }),
    choice: '',
  });
  const finish = choice => {
    api.choice = choice;
    settle(choice);
  };
  if (!native?.pty) {
    finish('none');
    return;
  }

  // sessionStorage lives as long as this window: set on launch, still there after a reload, gone on
  // the next launch.
  const LAUNCH = 'tnai.session-launched';
  let reload = false;
  try {
    reload = !!sessionStorage.getItem(LAUNCH);
    sessionStorage.setItem(LAUNCH, '1');
  } catch {}

  const panes = () => [...document.querySelectorAll('.terminal-pane[data-pane-id]')];
  const withAgent = () => panes().filter(p => p.querySelector('.terminal-provider-select')?.value);

  // Start clean: each pane closes through its own × (04 drops it from the saved list; 10 ends and
  // forgets its session record and output).
  function startClean() {
    panes().forEach(p =>
      p.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.click()
    );
    finish('clean');
  }

  function ask(count) {
    const overlay = document.createElement('div');
    overlay.className = 'tnai-ws-close-overlay';
    overlay.innerHTML =
      '<section class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiSessionStartTitle" aria-describedby="tnaiSessionStartBody"><h2 id="tnaiSessionStartTitle">Restore your last session?</h2><p id="tnaiSessionStartBody"></p><div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel" data-choice="restore">Restore agents and conversations</button><button type="button" class="tnai-ws-close-confirm" data-choice="clean">Start clean (no agents)</button></div></section>';
    overlay.querySelector('p').textContent =
      count +
      (count === 1 ? ' agent was' : ' agents were') +
      ' open when Technically Not closed. Starting clean is usually best for a new session. What agents finished (shared context) and the project folder are kept either way.';
    const pick = choice => {
      overlay.remove();
      window.removeEventListener('keydown', onKey, true);
      if (choice === 'clean') startClean();
      else finish('restore');
    };
    overlay.addEventListener('click', event => {
      const choice = event.target.closest('[data-choice]')?.dataset.choice;
      if (choice) pick(choice);
    });

    // Modal: Tab cycles between the two buttons only; Escape picks the default (Start clean).
    // Capture phase, so nothing behind sees these keys.
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        pick('clean');
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const buttons = [...overlay.querySelectorAll('button')],
        i = buttons.indexOf(document.activeElement);
      buttons[(i + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    overlay.querySelector('.tnai-ws-close-confirm').focus(); // Start clean is the default (Enter)
  }

  async function decide() {
    const count = withAgent().length;
    if (reload || !count) return finish('none');
    let live = [];
    try {
      live = await native.pty.list();
    } catch {}

    // processes still up: this is the same app run, not a new launch
    if (live.some(s => s.running)) return finish('none');
    ask(count);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', decide, { once: true });
  else decide();
})();
