/*
 * Technically Not · 84-chrome-browser.js — Settings › Agents › While agents work › Use Claude in
 * Chrome: whether Claude Code agents Technically Not starts get Claude in Chrome (claude
 * `--chrome`) and Technically Not's hidden rule for using it
 * (desktop/hidden-skills/47-chrome-browser.md), so they can work in the user's own Chrome with its
 * sign-ins. Off by default (the user opts in); off adds nothing, so the CLI's own setting decides.
 * Needs the Claude in Chrome extension (link in the row). Agents started after a change get the new
 * setting. Desktop app only.
 */
(() => {
  'use strict';
  const native = window.tnaiNative?.agentRules;

  // A row in Settings › Agents › While agents work (#agentsWorkCard, 22), under Write skills (63);
  // its own group only if that card is missing.
  const card = document.getElementById('agentsWorkCard'),
    mount = card || document.getElementById('settingsPanel-agents');
  if (!native || !mount) return;
  const row = `<label class="set-row tnai-chrome-browser-row"><span class="set-text"><b>Use Claude in Chrome</b><small title="Claude Code agents can open pages, fill forms and read sites in your Chrome, signed in as you. They ask before signing in, paying or posting.">Claude Code agents can work in your Chrome. Needs the <a href="https://claude.ai/chrome" target="_blank" rel="noopener">Claude in Chrome extension</a>. Applies to new agents.</small></span><input type="checkbox" class="set-switch" data-rule="browser-use"></label>`;
  if (card) card.insertAdjacentHTML('beforeend', row);
  else {
    const set = document.createElement('section');
    set.className = 'set-group tnai-chrome-browser-set';
    set.innerHTML =
      '<header class="set-group-head"><div><h3>Claude in Chrome</h3><p>Let Claude Code agents use your Chrome.</p></div></header><div class="set-card">' +
      row +
      '</div>';
    mount.append(set);
  }
  const input = mount.querySelector('input[data-rule="browser-use"]');
  native
    .get()
    .then(flags => {
      input.checked = flags?.['browser-use'] === true;
    })
    .catch(() => {
      input.disabled = true;
    });
  input.addEventListener('change', () => {
    native
      .set({ 'browser-use': input.checked })
      .then(flags => {
        input.checked = flags?.['browser-use'] === true;
      })
      .catch(() => {
        input.checked = !input.checked;
        window.toast?.('Could not save the Use Claude in Chrome setting.');
      });
  });
})();
