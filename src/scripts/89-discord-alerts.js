/*
 * Technically Not · 89-discord-alerts.js — Settings › Agents › While agents work › Alerts to
 * Discord (row in 22's #agentsWorkCard, under 84; off by default): the user's own Discord webhook
 * gets a short message when an agent needs them, finishes, or seems stuck
 * (desktop/discord-alerts.js posts it; see there). The webhook address goes one way: typed here,
 * sent to main, shown back only masked. Browser build: the row shows grayed (12).
 */
(() => {
  'use strict';
  const native = window.tnaiNative?.discordAlerts;
  const card = document.getElementById('agentsWorkCard'),
    mount = card || document.getElementById('settingsPanel-agents');
  if (!mount) return;
  const esc = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const EVENTS = [
    ['needsYou', 'Needs you'],
    ['finished', 'Finished'],
    ['stuck', 'Seems stuck'],
  ];
  const html = `<label class="set-row tnai-discord-row"><span class="set-text"><b>Alerts to Discord</b><small title="A short message (agent, project, one line) goes to a Discord webhook you create in your own server or channel, so the Discord app on your phone buzzes. Sent only while the Technically Not window isn’t in front. The address stays on this PC, encrypted.">Your phone buzzes through your own Discord webhook.${native ? '' : ' Needs the Technically Not desktop app.'}</small></span><input type="checkbox" class="set-switch" data-discord="enabled"></label>
<div class="set-sub tnai-discord-sub off">
<div class="set-row"><span class="set-text"><b>Webhook</b><small>In Discord: channel settings › Integrations › Webhooks.</small></span><span class="set-ctl"><input type="text" class="set-input set-text-input" data-discord="url" placeholder="https://discord.com/api/webhooks/…" spellcheck="false" autocomplete="off"><button type="button" class="settings-keys-button" data-discord="save">Save</button></span></div>
<div class="set-row"><span class="set-text"><b>Send me</b></span><span class="set-chips">${EVENTS.map(([k, l]) => `<label class="set-chip"><input type="checkbox" data-discord-event="${k}">${l}</label>`).join('')}</span></div>
<div class="set-row"><span class="set-text"><b>Check it</b><small data-discord="status" aria-live="polite"></small></span><button type="button" class="settings-keys-button" data-discord="test">Send test</button></div>
</div>`;
  if (card) card.insertAdjacentHTML('beforeend', html);
  else {
    const set = document.createElement('section');
    set.className = 'set-group tnai-discord-set';
    set.innerHTML =
      '<header class="set-group-head"><div><h3>Alerts to Discord</h3><p>Get a phone alert when an agent needs you.</p></div></header><div class="set-card">' +
      html +
      '</div>';
    mount.append(set);
  }
  const q = sel => mount.querySelector(sel);
  const row = q('.tnai-discord-row'),
    sub = q('.tnai-discord-sub'),
    toggle = q('[data-discord=enabled]'),
    field = q('[data-discord=url]'),
    status = q('[data-discord=status]');
  if (!native) {
    row.classList.add('tnai-discord-alerts');
    sub.classList.add('tnai-discord-alerts');
    toggle.disabled = true;
    return;
  }

  let state = null,
    wantOn = false,
    note = '';
  const ago = at => {
    const m = Math.round((Date.now() - at) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : new Date(at).toLocaleString();
  };

  function paint() {
    if (!state) return;
    toggle.checked = state.enabled || wantOn;
    sub.classList.toggle('off', !toggle.checked);
    field.placeholder = state.set ? state.webhook : 'https://discord.com/api/webhooks/…';
    mount.querySelectorAll('[data-discord-event]').forEach(c => {
      c.checked = !!state.events[c.dataset.discordEvent];
    });
    q('[data-discord=test]').disabled = !state.set;
    status.textContent =
      note ||
      (state.unavailable
        ? state.unavailable
        : state.lastError
          ? 'Last error: ' + state.lastError
          : !state.set
            ? 'Paste your webhook address, then Save.'
            : state.lastSentAt
              ? 'Last alert sent ' + ago(state.lastSentAt) + '.'
              : 'Saved. Nothing sent yet.');
    note = '';
  }
  const apply = r => {
    if (r?.value) state = r.value;
    if (r && !r.ok && r.error) note = r.error;
    paint();
    return r;
  };
  const load = () =>
    native
      .get()
      .then(v => {
        state = v;
        paint();
      })
      .catch(() => {
        toggle.disabled = true;
        status.textContent = 'Couldn’t read this setting.';
      });
  load();
  window.addEventListener('tnai:settings-page-shown', load);

  toggle.addEventListener('change', () => {
    if (toggle.checked && !state?.set) {
      wantOn = true;
      paint();
      field.focus();
      return;
    } // saved together with the address
    wantOn = false;
    native
      .set({ enabled: toggle.checked })
      .then(apply)
      .catch(() => {
        note = 'Couldn’t save this setting.';
        load();
      });
  });
  const save = () => {
    const url = field.value.trim();
    if (!url) {
      note = state?.set
        ? 'The saved address stays. Paste a new one to replace it.'
        : 'Paste your webhook address first.';
      paint();
      return;
    }
    native
      .set({ webhookUrl: url, ...(wantOn ? { enabled: true } : {}) })
      .then(r => {
        if (r?.ok) {
          field.value = '';
          wantOn = false;
          note = 'Saved.';
        }
        apply(r);
      })
      .catch(() => {
        note = 'Couldn’t save the address.';
        paint();
      });
  };
  q('[data-discord=save]').addEventListener('click', save);
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  });
  sub.addEventListener('change', event => {
    const k = event.target.dataset?.discordEvent;
    if (!k) return;
    native
      .set({ events: { [k]: event.target.checked } })
      .then(apply)
      .catch(() => {
        note = 'Couldn’t save this setting.';
        load();
      });
  });
  q('[data-discord=test]').addEventListener('click', event => {
    const b = event.currentTarget;
    b.disabled = true;
    status.textContent = 'Sending…';
    native
      .test()
      .then(r => {
        if (r?.ok) note = 'Test sent. Check Discord.';
        apply(r);
      })
      .catch(() => {
        note = 'Couldn’t send the test.';
        paint();
      })
      .finally(() => {
        b.disabled = !state?.set;
      });
  });
})();
