// Technically Not · 36-app-updates.js — Desktop app: automatic updates (desktop/updater.js). A new
// version shows only in the notification bell (60 posts it; its count turns purple), whose action
// opens the update / restart dialog here with What's new. Settings › Updates: status, Check for
// updates, and the per-user choices (check automatically, notify, download automatically).
(() => {
  const native = window.tnaiNative?.update;
  if (!native) return;
  let state = { status: 'off' },
    installWhenReady = false,
    userCheck = false;

  const style = document.createElement('style');
  style.textContent = `
.tnai-update-notes{max-height:min(40vh,260px);overflow:auto;margin:14px 0 0;padding:10px 12px;border:1px solid #e5e8e0;border-radius:8px;background:#fff;color:#4e5547;font:11px/1.5 var(--pg-sans);white-space:pre-wrap}
.tnai-updates-panel [data-update=check][aria-busy=true]::before{content:'';display:inline-block;width:9px;height:9px;margin-right:6px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-1px;animation:tnaiUpdSpin .8s linear infinite}
@keyframes tnaiUpdSpin{to{transform:rotate(360deg)}}
.tnai-update-overlay .tnai-ws-close-modal{width:min(520px,calc(100vw - 48px))}
.tnai-update-overlay .tnai-update-notes{overflow-wrap:anywhere}
.tnai-update-line{position:relative}.tnai-update-line.gap{height:.6em}
.tnai-update-line[data-kind]{padding-left:16px;margin:3px 0}
.tnai-update-line[data-kind]>i{position:absolute;left:2px;top:.5em;width:7px;height:7px;border-radius:50%;background:var(--pg-text-4,currentColor)}
.tnai-update-line>em{font-style:normal;font-weight:600}
.tnai-update-line[data-kind=fix]{--k:var(--pg-work,#3fa66a)}.tnai-update-line[data-kind=new]{--k:var(--pg-accent-2,#a78bfa)}.tnai-update-line[data-kind=changed]{--k:var(--pg-ready,#5aa0f0)}.tnai-update-line[data-kind=removed]{--k:var(--pg-wait,#e0a23c)}
.tnai-update-line[data-kind]:not([data-kind=other])>i{background:var(--k)}.tnai-update-line[data-kind]:not([data-kind=other])>em{color:var(--k)}`;
  document.head.append(style);

  const prefs = () => ({
    autoCheck: true,
    notify: true,
    autoDownload: false,
    ...(state.prefs || {}),
  });
  const name = s =>
    'Technically Not ' + s.next + (s.nextBuild ? ' (build ' + s.nextBuild + ')' : '');
  const notSetUp = s => ['unconfigured', 'dev', 'off', 'manual'].includes(s.status);
  const describe = s =>
    ({
      manual:
        'This Mac version cannot update itself yet: it is not signed by Apple. Download new versions from the releases page on GitHub.',
      unconfigured:
        'Automatic updates are not set up yet. Once a release feed is configured, Technically Not checks for new versions and offers to install them.',
      dev: 'This copy runs from source, so it updates when the project files change. Automatic updates apply to the installed app.',
      idle: 'Automatic checks are off. Use Check for updates to look for a new version.',
      checking: 'Checking for updates…',
      current:
        'Technically Not is up to date (v' +
        s.version +
        ').' +
        (s.checkedAt ? ' Last checked ' + new Date(s.checkedAt).toLocaleTimeString() + '.' : ''),
      available: name(s) + ' is available.',
      downloading: 'Downloading ' + name(s) + '… ' + (s.percent || 0) + '%',
      ready: name(s) + ' is downloaded. Restart Technically Not to finish updating.',
      error: s.message || 'Update check failed.',
      off: 'Automatic updates are off.',
    })[s.status] || '';

  // What's new: the release notes (the release tag message) in the app's dialog, plus a link to the
  // releases page of the public repository, where every release is listed.
  const whatsNew = () => confirmRestart();

  function render() {
    const offered = ['available', 'downloading', 'ready'].includes(state.status);
    const mount = document.getElementById('tnaiUpdatesMount');
    if (!mount) return;
    if (!mount.firstChild) {
      const toggle = (key, title, text) =>
        `<label class="set-row"><span class="set-text"><b>${title}</b><small>${text}</small></span><input type="checkbox" class="set-switch" data-update-pref="${key}"></label>`;
      mount.innerHTML =
        '<div class="tnai-updates-panel"><section class="set-group"><header class="set-group-head"><div><h3>Version</h3></div></header><div class="set-card"><div class="set-row"><span class="set-text"><b class="tnai-updates-version"></b><small class="tnai-updates-status"></small></span>' +
        '<div class="tnai-updates-actions"><button type="button" class="button" data-update="notes" hidden>What’s new</button><button type="button" class="button" data-update="restart" hidden>Restart to update</button><button type="button" class="button" data-update="check">Check for updates</button></div></div></div></section>' +
        '<section class="set-group"><header class="set-group-head"><div><h3>Preferences</h3></div></header><div class="set-card tnai-updates-prefs">' +
        toggle(
          'autoCheck',
          'Check for updates automatically',
          'When Technically Not starts and every 4 hours.'
        ) +
        toggle(
          'notify',
          'Notify me when an update is available',
          'Shows the new version and build in the notification bell, with a link to what is new.'
        ) +
        toggle(
          'autoDownload',
          'Download updates automatically',
          'Downloads and verifies a new version in the background. It installs only when you restart Technically Not or close it.'
        ) +
        '</div><p class="set-foot">Updates are verified before they install. Nothing installs while Technically Not is running unless you choose Restart to update.</p>' +
        (window.tnaiNative?.openNotices
          ? '<p class="set-foot">© 2026 Technically Not LLC. Technically Not is open source under the MIT licence and uses open-source software by others. <a href="#" data-update="notices">Open-source notices</a></p>'
          : '') +
        '</section></div>';
      mount.addEventListener('click', e => {
        const b = e.target.closest('[data-update]');
        if (!b) return;
        if (b.dataset.update === 'notices') {
          e.preventDefault();
          window.tnaiNative.openNotices().catch(() => {});
          return;
        }
        b.dataset.update === 'check'
          ? checkNow()
          : b.dataset.update === 'notes'
            ? whatsNew()
            : confirmRestart();
      });
      mount.addEventListener('change', e => {
        const i = e.target.closest('[data-update-pref]');
        if (i)
          native
            .setPrefs({ [i.dataset.updatePref]: i.checked })
            .then(apply)
            .catch(() => {});
      });
    }
    mount.querySelector('.tnai-updates-version').textContent =
      'Technically Not v' + state.version + (state.build ? ' (build ' + state.build + ')' : '');
    mount.querySelector('.tnai-updates-status').textContent = describe(state);
    const check = mount.querySelector('[data-update="check"]');
    check.disabled =
      notSetUp(state) || ['checking', 'available', 'downloading', 'ready'].includes(state.status);
    check.setAttribute('aria-busy', String(state.status === 'checking'));
    check.textContent =
      state.status === 'checking'
        ? 'Checking for updates…'
        : state.status === 'manual'
          ? 'Updates by download only'
          : notSetUp(state)
            ? 'Updates not set up'
            : 'Check for updates';
    check.title = check.disabled && notSetUp(state) ? describe(state) : '';
    mount.querySelector('[data-update="notes"]').hidden = !offered || !state.notes;
    const restart = mount.querySelector('[data-update="restart"]');
    restart.hidden = !['available', 'ready'].includes(state.status);
    restart.textContent = state.status === 'available' ? 'Update now' : 'Restart to update';
    const p = prefs();
    mount.querySelectorAll('[data-update-pref]').forEach(i => {
      i.checked = !!p[i.dataset.updatePref];
      i.disabled = notSetUp(state);
    });
  }

  function confirmRestart() {
    const running = (window.TnaiAgents?.sessions?.() || []).filter(s => s.running).length;
    const overlay = document.createElement('div');
    overlay.className = 'tnai-ws-close-overlay tnai-update-overlay';
    overlay.innerHTML = `<div class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiUpdateTitle"><h2 id="tnaiUpdateTitle"></h2><p></p><div class="tnai-update-notes" hidden></div><div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel">Later</button><button type="button" class="tnai-ws-close-confirm">Restart now</button></div></div>`;
    const offer = state.status !== 'ready',
      canAct = ['available', 'ready'].includes(state.status);
    overlay.querySelector('h2').textContent = !canAct
      ? 'What’s new in ' + name(state)
      : offer
        ? 'Update to ' + name(state) + '?'
        : 'Restart to update to ' + name(state) + '?';
    overlay.querySelector('.tnai-ws-close-confirm').textContent = offer
      ? 'Update now'
      : 'Restart now';
    overlay.querySelector('.tnai-ws-close-confirm').hidden = !canAct;
    overlay.querySelector('p').textContent = !canAct
      ? state.notes
        ? ''
        : 'No release notes were published for this version.'
      : (running
          ? running +
            ' running terminal' +
            (running === 1 ? '' : 's') +
            ' will stop; agent conversations can be resumed afterwards. '
          : '') +
        'Unsaved file edits are kept as drafts. ' +
        (offer
          ? 'Technically Not downloads and verifies the update, then restarts to install it.'
          : 'Technically Not reopens when the update is installed.');
    const notes = overlay.querySelector('.tnai-update-notes');
    if (state.notes) {
      // Release notes are written with **bold**, `code` and "- " bullets: show them formatted,
      // never as raw marks.
      notes.hidden = false;

      // Each change is one line, colored by its kind so the list can be skimmed:
      // the kind comes from the line's first word (Fixed, New, Added, Removed,
      // Changed, Improved…) or, without one, from its wording ("no longer" = a fix, "now" = a
      // change).
      const firstWord = s => (/^([A-Za-z]+)\b[:,]?/.exec(s) || [''])[0];
      const kindOf = s => {
        const w = firstWord(s).replace(/[:,]$/, '').toLowerCase();
        return /^fix(ed|es)?$/.test(w)
          ? 'fix'
          : /^(new|add(ed|s)?)$/.test(w)
            ? 'new'
            : /^(removed?|gone|dropped)$/.test(w)
              ? 'removed'
              : /^(changed?|improved?|faster|better|updated?)$/.test(w)
                ? 'changed'
                : /\bno longer\b|\bfixed\b/i.test(s)
                  ? 'fix'
                  : /\bnow\b/i.test(s)
                    ? 'changed'
                    : '';
      };
      const KIND = { fix: 'Fixed', new: 'New', changed: 'Changed', removed: 'Removed' };
      const LEAD =
        /^(fix(ed|es)?|new|add(ed|s)?|removed?|gone|dropped|changed?|improved?|faster|better|updated?)[:,]?$/i;
      const inline = (host, text) =>
        text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).forEach(part => {
          const tag = /^\*\*[^*\n]+\*\*$/.test(part) ? 'b' : /^`[^`\n]+`$/.test(part) ? 'code' : '';
          if (!tag) {
            host.append(part);
            return;
          }
          const el = document.createElement(tag);
          el.textContent = tag === 'b' ? part.slice(2, -2) : part.slice(1, -1);
          host.append(el);
        });
      notes.replaceChildren();

      // Always kind by kind (all fixed items together, all new
      // items together): New, Changed, Removed, Fixed, then lines with no kind, whatever
      // order the release was written in. The order goes by a line's first word only
      // (tools/release-notes.js, the same rule the ship tool and the website's changelog use);
      // lines inside a kind keep their order. The text can hold several releases ("Version 9.9.9",
      // its changes, a gap, "Version 9.9.8", ...): each unbroken run of changes is ordered by
      // itself, and every other line (a version heading, a gap, a closing sentence) stays exactly
      // where it is.
      const isChange = r => /^[ \t]*[-*][ \t]+/.test(r);
      const orderOf = r => {
        const w = firstWord(r.replace(/^[ \t]*[-*][ \t]+/, ''))
          .replace(/[:,]$/, '')
          .toLowerCase();
        return /^(new|add(ed|s)?)$/.test(w)
          ? 0
          : /^(changed?|improved?|faster|better|updated?)$/.test(w)
            ? 1
            : /^(removed?|gone|dropped)$/.test(w)
              ? 2
              : /^fix(ed|es)?$/.test(w)
                ? 3
                : 4;
      };
      const ordered = [];
      let run = [];
      const flush = () => {
        [0, 1, 2, 3, 4].forEach(k =>
          run.forEach(r => {
            if (orderOf(r) === k) ordered.push(r);
          })
        );
        run = [];
      };
      String(state.notes)
        .split(/\r?\n/)
        .forEach(r => {
          if (isChange(r)) run.push(r);
          else {
            flush();
            ordered.push(r);
          }
        });
      flush();
      ordered.forEach(raw => {
        const bullet = /^[ \t]*[-*][ \t]+/.test(raw),
          text = raw.replace(/^[ \t]*[-*][ \t]+/, ''),
          line = document.createElement('div');
        line.className = 'tnai-update-line';
        if (bullet) {
          const kind = kindOf(text),
            lead = firstWord(text),
            dot = document.createElement('i');
          line.dataset.kind = kind || 'other';
          dot.title = KIND[kind] || 'Other change';
          line.append(dot);
          if (LEAD.test(lead)) {
            const em = document.createElement('em');
            em.textContent = lead;
            line.append(em);
            inline(line, text.slice(lead.length));
          } else inline(line, text);
        } else {
          if (!text.trim()) line.classList.add('gap');
          inline(line, text);
        }
        notes.append(line);
      });
    }

    // The link goes to the releases page of the public repository, which the updater names in its
    // state; while no repository is set there is no page to open, so no link is shown.
    const releasesPage = /^https:\/\/github\.com\//.test(state.releasesUrl || '')
      ? state.releasesUrl
      : '';
    if (canAct && releasesPage && /^\d+\.\d+\.\d+$/.test(state.version || '')) {
      const more = document.createElement('p'),
        link = document.createElement('a');
      link.href = releasesPage;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'See everything new since v' + state.version;
      more.append(link);
      notes.after(more);
    }
    const close = () => overlay.remove();
    overlay.querySelector('.tnai-ws-close-cancel').onclick = close;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
    overlay.querySelector('.tnai-ws-close-confirm').onclick = async () => {
      if (offer) {
        installWhenReady = true;
        close();
        apply(await native.download());
        return;
      }
      (await restartNow()) || close();
    };
    document.body.append(overlay);
    (canAct
      ? overlay.querySelector('.tnai-ws-close-confirm')
      : overlay.querySelector('.tnai-ws-close-cancel')
    ).focus();
  }

  // A check the user asked for (Settings or the command palette) always ends with a visible result.
  // check() answers with the state from before the request, so only a state that means "no check
  // will run" is applied here; the result arrives as an update event.
  const checkNow = async () => {
    userCheck = true;
    apply({ ...state, status: 'checking' });
    const s = await native.check();
    if (s && !['current', 'error', 'available', 'checking', 'idle'].includes(s.status)) {
      userCheck = false;
      apply(s);
    } else
      setTimeout(() => {
        if (state.status === 'checking')
          native
            .state()
            .then(apply)
            .catch(() => {});
      }, 20000); // no event came (the check never started)
  };
  const restartNow = async () => {
    window.dispatchEvent(new Event('beforeunload'));
    const went = await native.install();
    if (went === true) return true;
    if (went !== 'declined') window.toast?.('The update is no longer ready');
    return false;
  }; // 'declined': agents were working and the user chose Not now (main.js)
  const apply = s => {
    const was = state.status;
    state = s || state;
    render();
    if (state.status === 'error') installWhenReady = false;
    if (userCheck && ['current', 'error'].includes(state.status)) {
      userCheck = false;
      window.toast?.(
        state.status === 'current'
          ? 'Technically Not is up to date (v' + state.version + ').'
          : describe(state)
      );
    }
    if (userCheck && state.status === 'available') userCheck = false;
    if (state.status === 'ready' && was !== 'ready' && installWhenReady) {
      if (installWhenReady !== 'bell' || !busy()) restartNow();
      else installWhenReady = false;
    } // otherwise the bell (60) says it is ready
  };
  native.onState(apply);
  native
    .state()
    .then(apply)
    .catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);

  // download(): fetch + verify without installing (the self-test uses it; Update now also installs
  // once ready). The bell's Update button (60): no dialog; downloads, verifies and restarts to
  // install, or restarts now when already downloaded. Like a CLI update (60), it waits while an
  // agent is working: a restart would stop it mid-task. An agent that
  // starts working during the download holds the restart too; the bell then offers Restart to
  // update.
  const busy = () => {
    const n = (window.TnaiAgents?.sessions?.() || []).filter(s =>
      ['working', 'starting'].includes(s.status)
    ).length;
    if (n)
      window.toast?.(
        (n === 1 ? '1 agent is' : n + ' agents are') +
          ' working. Update when ' +
          (n === 1 ? 'it finishes' : 'they finish') +
          ': restarting would stop ' +
          (n === 1 ? 'it.' : 'them.')
      );
    return n > 0;
  };
  const updateNow = async () => {
    if (busy()) return;
    if (state.status === 'ready') return restartNow();
    if (state.status !== 'available') return;
    installWhenReady = 'bell';
    apply(await native.download());
  };
  window.TnaiUpdates = {
    state: () => state,
    confirmRestart,
    updateNow,
    checkNow,
    whatsNew,
    setPrefs: async patch => apply(await native.setPrefs(patch)),
    download: async () => apply(await native.download()),
  };
})();
