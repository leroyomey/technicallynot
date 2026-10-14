/*
 * Technically Not · 63-write-skills.js — Settings › Agents › While agents work › Write skills:
 * whether agents Technically Not starts may save reusable procedures as skills (a project skill in
 * .claude/skills, or a Technically Not library skill via `tnai skill save`). The switch adds or
 * drops Technically Not's hidden rule for it (desktop/hidden-skills/60-write-skills.md); agents
 * started after a change get the new setting. Desktop app only.
 */
(() => {
  'use strict';
  const native = window.tnaiNative?.agentRules;

  // A row in Settings › Agents › While agents work (#agentsWorkCard, 22); its own group only if
  // that card is missing.
  const card = document.getElementById('agentsWorkCard'),
    mount = card || document.getElementById('settingsPanel-agents');
  if (!native || !mount) return;
  const row = `<label class="set-row tnai-write-skills-row"><span class="set-text"><b>Write skills</b><small title="About this project as a project skill (.claude/skills), or a general habit to your Skills page, where you decide if it runs for every session.">Save reusable procedures as skills. Applies to new agents.</small></span><input type="checkbox" class="set-switch" data-rule="write-skills"></label>`;
  if (card) card.insertAdjacentHTML('beforeend', row);
  else {
    const set = document.createElement('section');
    set.className = 'set-group tnai-write-skills-set';
    set.innerHTML =
      '<header class="set-group-head"><div><h3>Skills</h3><p>Let agents save what they learn for next time.</p></div></header><div class="set-card">' +
      row +
      '</div>';
    mount.append(set);
  }
  const input = mount.querySelector('input[data-rule="write-skills"]');
  native
    .get()
    .then(flags => {
      input.checked = flags?.['write-skills'] !== false;
    })
    .catch(() => {
      input.disabled = true;
    });
  input.addEventListener('change', () => {
    native
      .set({ 'write-skills': input.checked })
      .then(flags => {
        input.checked = flags?.['write-skills'] !== false;
      })
      .catch(() => {
        input.checked = !input.checked;
        window.toast?.('Could not save the Write skills setting.');
      });
  });
})();
