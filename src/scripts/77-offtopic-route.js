/*
 * Technically Not · 77-offtopic-route.js — When the composer is about to hand a prompt to a lead
 * agent that is busy with a task (11 route kind 'fold'), and the prompt shares no words with that
 * task, the user is asked where it goes instead of the agent guessing: "Start a sub-agent" (the
 * lead delegates it and keeps its own work), "New agent" (a fresh lead in a new panel), or "Send
 * anyway" (the old fold-in). The check is local and deterministic (word overlap after dropping
 * filler words), and deliberately cautious: short prompts, prompts that point back ("also", "this",
 * "same"…) or share any meaningful word with the busy task are never asked about. Escape / Cancel
 * keeps the draft.
 */
(() => {
  const STOP = new Set(
    (
      'the and for with that this from have your you are was were will would should could into onto about just then than them they ' +
      'there their what when where which while also make made need want like more some other only very really please thanks thank can not but all any ' +
      "one two its it's i'm don't does did doing done get got let use using used add fix new now how why who way does our out off too see look check"
    ).split(' ')
  );
  const CUE =
    /\b(also|too|instead|same|again|as well|that one|this one|while you'?re at it|continue|keep going|above|earlier|previous)\b/i;
  const stem = w => w.replace(/(ing|ed|es|s)$/, '');
  const words = text =>
    new Set(
      (
        String(text || '')
          .toLowerCase()
          .match(/[a-z0-9][a-z0-9'-]{2,}/g) || []
      )
        .filter(w => !STOP.has(w))
        .map(stem)
        .filter(w => w.length >= 3)
    );

  // True only when the prompt clearly starts something else: enough words on both sides and none
  // shared.
  function unrelated(task, prompt) {
    if (!task || !prompt || CUE.test(prompt)) return false;
    const a = words(task),
      b = words(prompt);
    if (a.size < 3 || b.size < 4) return false;
    for (const w of b) if (a.has(w)) return false;
    return true;
  }

  let overlay = null,
    settle = null;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'tnai-ws-close-overlay tnai-offtopic-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<section class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiOffTopicTitle" aria-describedby="tnaiOffTopicBody">' +
      '<h2 id="tnaiOffTopicTitle"></h2><p id="tnaiOffTopicBody"></p>' +
      '<div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel" data-pick="">Cancel</button>' +
      '<button type="button" class="tnai-ws-close-cancel" data-pick="send">Send anyway</button>' +
      '<button type="button" class="tnai-ws-close-cancel" data-pick="new">New agent</button>' +
      '<button type="button" class="tnai-ws-close-confirm" data-pick="sub">Start a sub-agent</button></div></section>';
    document.body.append(overlay);
    overlay.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) settle?.(b.dataset.pick || null);
      else if (e.target === overlay) settle?.(null);
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle?.(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const btns = [...overlay.querySelectorAll('button:not([hidden])')],
        i = btns.indexOf(document.activeElement);
      e.preventDefault();
      btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
    });
  }

  // Resolves 'sub' | 'new' | 'send', or null when the user cancels. canNew=false hides "New agent"
  // (Build lead, full workspace, browser build).
  function ask({ name, task, canNew }) {
    if (!overlay) build();
    settle?.(null);
    overlay.querySelector('h2').textContent = name + ' is busy with something else';
    overlay.querySelector('p').textContent =
      'It\'s working on "' +
      String(task).slice(0, 140) +
      '". This prompt looks unrelated. Where should it go?' +
      ' A sub-agent runs it alongside, under ' +
      name +
      '; a new agent takes it in its own panel.';
    overlay.querySelector('[data-pick="new"]').hidden = !canNew;
    const back = document.activeElement;
    overlay.hidden = false;
    overlay.querySelector('[data-pick="sub"]').focus();
    return new Promise(resolve => {
      settle = pick => {
        settle = null;
        overlay.hidden = true;
        try {
          if (back?.isConnected) back.focus();
        } catch {}
        resolve(pick);
      };
    });
  }

  // A cold agent (11: idle longer than its prompt cache lives, `after` in words: "an hour" or "5
  // minutes", with a big context): its prompt cache has expired, so the next prompt re-reads the
  // whole context at full price. The same dialog offers a compact first or a fresh agent; Send
  // anyway sends as before. Resolves 'compact' | 'new' | 'send', or null (Cancel keeps the draft).
  let cold = null,
    settleCold = null;

  function askCold({ name, tokens, idleMin, after = 'an hour', canNew }) {
    if (!cold) {
      cold = document.createElement('div');
      cold.className = 'tnai-ws-close-overlay tnai-offtopic-overlay';
      cold.hidden = true;
      cold.innerHTML =
        '<section class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiColdTitle" aria-describedby="tnaiColdBody">' +
        '<h2 id="tnaiColdTitle"></h2><p id="tnaiColdBody"></p>' +
        '<div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel" data-pick="">Cancel</button>' +
        '<button type="button" class="tnai-ws-close-cancel" data-pick="send">Send anyway</button>' +
        '<button type="button" class="tnai-ws-close-cancel" data-pick="new">New agent</button>' +
        '<button type="button" class="tnai-ws-close-confirm" data-pick="compact">Compact first</button></div></section>';
      document.body.append(cold);
      cold.addEventListener('click', e => {
        const b = e.target.closest('[data-pick]');
        if (b) settleCold?.(b.dataset.pick || null);
        else if (e.target === cold) settleCold?.(null);
      });
      cold.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          settleCold?.(null);
          return;
        }
        if (e.key !== 'Tab') return;
        const btns = [...cold.querySelectorAll('button:not([hidden])')],
          i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      });
    }
    settleCold?.(null);
    const h = idleMin >= 120 ? Math.floor(idleMin / 60) + ' hours' : idleMin + ' minutes';
    cold.querySelector('h2').textContent = name + ' has been idle for ' + h;
    cold.querySelector('p').textContent =
      'It holds ' +
      tokens +
      ' tokens of context, and after ' +
      after +
      ' idle the whole context is read again at full price with the next prompt.' +
      ' Compact first pays that read once to shrink it, so later prompts cost less, then sends your prompt; a new agent skips it and starts fresh with a short handoff from ' +
      name +
      '.';
    cold.querySelector('[data-pick="new"]').hidden = !canNew;
    const back = document.activeElement;
    cold.hidden = false;
    cold.querySelector('[data-pick="compact"]').focus();
    return new Promise(resolve => {
      settleCold = pick => {
        settleCold = null;
        cold.hidden = true;
        try {
          if (back?.isConnected) back.focus();
        } catch {}
        resolve(pick);
      };
    });
  }

  window.TnaiOffTopic = { unrelated, ask, askCold };
})();
