// Technically Not · 34-user-auth.js — The Technically Not account and the plan lock. Top-bar
// account control (Sign in / avatar + menu: account, plan line such as "Pro" or "No active
// subscription", Subscribe or Manage subscription, Check subscription, Sign out), the sign-in
// dialog (Continue with Google or GitHub in the browser, or email + password with an authenticator
// code when the account has one; which installed browser opens Google/GitHub (Windows, remembered
// per viewer; Default browser otherwise), waiting-for-browser with Copy sign-in link, errors; over
// the account's computer limit, a list of its computers with Sign out and continue on each), and
// the full-window lock shown while the desktop process says the app is locked (signed out, no
// subscription, plan not confirmed): Sign in, Subscribe, Check again, Sign out. The desktop process
// (desktop/user-auth.js) talks to the accounts server, verifies the signed plan pass and refuses
// new panels while locked; this file only sees public state. In a browser, sign-in is shown as
// unavailable and nothing locks. window.TnaiAuth { session, state, onChange, signIn, signInEmail,
// signOut, cancel, check, open, openSite, replaceDevice, ready }.
(() => {
  const top = document.querySelector('.top-right');
  if (!top) return;
  const native = window.tnaiNative?.auth || null;
  const GOOGLE_ICON =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const GITHUB_ICON =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#1f1f1f" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  const PROVIDER_NAMES = { google: 'Google', github: 'GitHub' };
  const esc = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const mask = s => (window.tnaiMaskEmails || String)(s || '');

  // display name hidden too (01), only initials show
  const maskName = s => (window.tnaiMaskName || String)(s || '');
  const day = sec =>
    new Date(sec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // ---------- State ----------
  const OFF = 'Sign-in works in the Technically Not desktop app.';
  let state = {
    // Accounts switched off in this build (the desktop process says so). The desktop app starts
    // from "off", so the sign-in control never shows for a moment before the first answer.
    off: !!native,
    available: false,
    reason: native ? '' : OFF,
    google: { available: false, reason: native ? '' : OFF },
    github: { available: false, reason: native ? '' : OFF },
    signedIn: false,
    user: null,
    plan: null,
    lock: { enforced: false, locked: false },
    checking: false,
    problem: '',
    flow: null,
  };
  const listeners = new Set();
  const publicSession = () => ({
    signedIn: !!state.signedIn,
    user: state.user ? { ...state.user, providers: [...(state.user.providers || [])] } : null,
    plan: state.plan ? { ...state.plan } : null,
    locked: !!state.lock?.locked,
  });

  // A window that STARTED locked had its startup reads (projects, files, git, skills, agent CLIs…)
  // refused by the desktop process, so once it unlocks it reloads to load them for real. A lock
  // later in the session doesn't reload (unsaved edits stay). Tests set __tnaiNoUnlockReload.
  let firstNative = true,
    startedLocked = false,
    toldPastDue = false;

  function setState(next) {
    if (!next) return;
    if (native && firstNative) {
      firstNative = false;
      startedLocked = !!next.lock?.locked;
    }
    const before = JSON.stringify(publicSession());
    state = next;
    renderControl();
    renderLock();
    if (!overlay.hidden) renderDialog();

    // A failed payment is said once per app start (and again if it comes back after being paid);
    // the account menu keeps the line and the button.
    if (!pastDue()) toldPastDue = false;
    else if (!toldPastDue) {
      toldPastDue = true;
      toastSafe(
        'Your payment didn’t go through. Update your card' +
          cardBy() +
          ' to keep building: account menu › Update card.'
      );
    }
    if (JSON.stringify(publicSession()) !== before)
      listeners.forEach(fn => {
        try {
          fn(publicSession());
        } catch (e) {
          console.warn(e);
        }
      });
    if (startedLocked && !next.lock?.locked) {
      startedLocked = false;
      if (window.__tnaiNoUnlockReload) window.__tnaiUnlockReload = true;
      else location.reload();
    }
  }
  const refresh = async () => {
    if (!native) return state;
    const r = await native.state();
    if (r?.ok) setState(r.value);
    return state;
  };

  // One line about the plan, for the account menu and the lock.
  function planLine() {
    const p = state.plan;
    if (!state.signedIn) return null;
    if (!p)
      return {
        text: state.checking ? 'Checking your plan…' : 'Plan not confirmed yet',
        note: state.problem,
      };
    if (!p.current)
      return {
        text: 'Plan not confirmed since ' + day(p.expires),
        note: state.problem || 'Reconnect to check your subscription.',
      };
    const offline = state.problem ? ' · offline, confirmed until ' + day(p.expires) : '';

    // kept for good once a founder yearly plan was active
    const founder = p.founder ? ' · ★ Founder' : '';
    if (p.plan === 'none') return { text: 'No active subscription' + founder, note: state.problem };
    return {
      text:
        (p.plan === 'team' ? 'Team' : 'Pro') +
        founder +
        (pastDue() ? ' · payment problem, update your card' + cardBy() : '') +
        offline,
      note: '',
    };
  }
  const paid = () => state.plan?.current && state.plan.plan !== 'none';

  // A failed payment keeps the plan for 7 days (the server's graceEnds): the plan line, the menu
  // button and one toast name the date.
  const pastDue = () => paid() && state.plan.status === 'past_due';
  const cardBy = () => (state.plan?.graceEnds ? ' by ' + day(state.plan.graceEnds) : '');

  // ---------- Top-bar control ----------
  const control = document.createElement('div');
  control.className = 'tnai-user';
  control.id = 'tnaiUser';
  top.append(control);
  const initials = u =>
    (
      (u?.name || u?.email || '?')
        .trim()
        .split(/[\s@._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(s => s[0])
        .join('') || '?'
    ).toUpperCase();
  let menuOpen = false;

  function renderControl() {
    // Accounts switched off: the control stays in the page, hidden, and takes no room in the bar.
    control.hidden = !!(native && state.off);
    if (control.hidden) {
      menuOpen = false;
      control.innerHTML = '';
      return;
    }
    const u = state.user;
    if (!state.signedIn || !u) {
      menuOpen = false;
      control.innerHTML = `<button type="button" class="tnai-user-signin" data-auth="open" title="${state.flow ? 'Signing in…' : 'Sign in to Technically Not'}"${state.flow ? ' aria-busy="true"' : ''}>${window.TnaiIcon('user')}<span class="pg-sr">${state.flow ? 'Signing in…' : 'Sign in'}</span></button>`;
      return;
    }
    const line = planLine();
    control.innerHTML = `<button type="button" class="avatar tnai-user-avatar" data-auth="menu" aria-haspopup="menu" aria-expanded="${menuOpen}" title="${esc(u.name ? maskName(u.name) : mask(u.email))}">${esc(initials(u))}</button>
<div class="tnai-user-menu" role="menu"${menuOpen ? '' : ' hidden'}>
<div class="tnai-user-menu-head"><span class="avatar">${esc(initials(u))}</span><div><b>${esc(u.name ? maskName(u.name) : mask(u.email) || 'Technically Not account')}</b><small>${esc(u.name ? mask(u.email) : '')}</small></div></div>
<div class="tnai-user-menu-label">Plan</div><div class="tnai-user-plan" data-plan>${esc(line?.text || '')}${line?.note ? `<small>${esc(line.note)}</small>` : ''}${state.weakStorage ? '<small data-weak-storage>No system keyring: this sign-in is saved without strong protection. Install GNOME Keyring or KWallet to protect it.</small>' : ''}</div>
<button type="button" class="tnai-user-item" data-auth="site" data-site="${paid() ? 'account' : 'subscribe'}" role="menuitem">${pastDue() ? 'Update card' : paid() ? 'Manage subscription' : 'Subscribe to Pro'}</button>
<button type="button" class="tnai-user-item" data-auth="check" role="menuitem"${state.checking ? ' disabled' : ''}>${state.checking ? 'Checking…' : 'Check subscription'}</button>
<button type="button" class="tnai-user-item tnai-user-signout" data-auth="signout" role="menuitem">Sign out</button></div>`;
    placeMenu();
  }
  const placeMenu = () => {
    const m = control.querySelector('.tnai-user-menu');
    if (m && !m.hidden)
      window.TnaiFloat?.attach(control.querySelector('[data-auth=menu]'), m, {
        placement: 'bottom-end',
        offset: 8,
      });
  };
  const setMenu = open => {
    menuOpen = open;
    const m = control.querySelector('.tnai-user-menu');
    if (m) m.hidden = !open;
    placeMenu();
    control.querySelector('[data-auth=menu]')?.setAttribute('aria-expanded', String(open));
  };
  control.addEventListener('click', event => {
    const b = event.target.closest('[data-auth]');
    if (!b || b.disabled) return;
    if (b.dataset.auth === 'open') open(state.flow ? 'waiting' : 'choose');
    else if (b.dataset.auth === 'menu') setMenu(!menuOpen);
    else if (b.dataset.auth === 'site') {
      setMenu(false);
      openSite(b.dataset.site);
    } else if (b.dataset.auth === 'check') check();
    else if (b.dataset.auth === 'signout') {
      setMenu(false);
      signOut();
    }
  });
  document.addEventListener('click', event => {
    if (menuOpen && !control.contains(event.target)) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuOpen) setMenu(false);
  });

  // ---------- Sign-in dialog ----------
  const overlay = document.createElement('div');
  overlay.className = 'tnai-auth-overlay';
  overlay.hidden = true;
  document.body.append(overlay);
  let view = 'choose',
    status = null,
    needCode = false,
    draftEmail = '',
    waitingFor = 'google'; // status: { kind: 'info'|'error', text }
  let browsers = [],
    // installed browsers for "Open Google and GitHub in" (Windows); the Copy sign-in link button
    // just worked
    copied = false;
  const BROWSER_KEY = 'tnai.signin-browser.v1';
  const pickedBrowser = () => {
    let id = '';
    try {
      id = localStorage.getItem(BROWSER_KEY) || '';
    } catch {}
    return browsers.some(b => b.id === id) ? id : '';
  };
  let devices = [],
    deviceLimit = 0,
    // over the computer limit: the account's computers (oldest first), the one being signed out
    replacing = '';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }),
    rtfAlways = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });

  function lastUsed(sec) {
    if (!(sec > 0)) return 'last used: not known';
    const s = Math.max(0, Date.now() / 1000 - sec);
    if (s < 60) return 'last used just now';
    const [n, unit] =
      s < 3600
        ? [s / 60, 'minute']
        : s < 86400
          ? [s / 3600, 'hour']
          : s < 30 * 86400
            ? [s / 86400, 'day']
            : s < 365 * 86400
              ? [s / (30 * 86400), 'month']
              : [s / (365 * 86400), 'year'];
    return (
      'last used ' +
      (unit === 'month' || unit === 'year' ? rtfAlways : rtf).format(-Math.floor(n), unit)
    ); // "1 month ago", never "last used last month"
  }

  function renderDialog() {
    let body = '';
    if (view === 'devices') {
      const rows = devices
        .map(
          d =>
            `<li class="tnai-auth-wait"><span class="tnai-auth-device-name"><b>${esc(d.name)}</b><small>${esc(lastUsed(d.lastSeen))}</small></span><span class="tnai-auth-actions"><button type="button" class="tnai-auth-primary" data-auth-act="replace" data-device="${esc(d.id)}" aria-label="Sign out ${esc(d.name)} and continue"${replacing ? ' disabled' : ''}>${replacing === d.id ? 'Signing out…' : 'Sign out and continue'}</button></span></li>`
        )
        .join('');
      body = `<h2 id="tnaiAuthTitle">Sign out a computer</h2><p>This account is already signed in on ${deviceLimit} computers. Sign out one to use it here:</p>
<ul class="tnai-auth-devices" aria-label="Computers signed in to this account">${rows}</ul>
<div class="tnai-auth-status ${status ? esc(status.kind) : ''}" role="alert"${status ? '' : ' hidden'}>${esc(status?.text || '')}</div>
<div class="tnai-auth-actions"><button type="button" class="tnai-auth-secondary" data-auth-act="back"${replacing ? ' disabled' : ''}>Cancel</button></div>`;
    } else if (view === 'code') {
      const busy = !!state.flow;
      body = `<h2 id="tnaiAuthTitle">Enter your authenticator code</h2><p>This account has two-step sign-in turned on. Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
<form class="tnai-auth-email" data-auth-code novalidate>
<label class="tnai-signin-field"><span>Authenticator or recovery code</span><input name="code" maxlength="64" autocomplete="one-time-code" spellcheck="false" placeholder="6 digits"></label>
<div class="tnai-auth-status ${status ? esc(status.kind) : ''}" role="alert"${status ? '' : ' hidden'}>${esc(status?.text || '')}</div>
<div class="tnai-auth-actions"><button type="button" class="tnai-auth-secondary" data-auth-act="back"${busy ? ' disabled' : ''}>Cancel</button><button type="submit" class="tnai-auth-primary"${busy ? ' disabled' : ''}>${busy ? 'Checking…' : 'Continue'}</button></div>
</form>`;
    } else if (view === 'waiting') {
      const name = PROVIDER_NAMES[state.flow?.provider || waitingFor] || 'Google';
      body = `<h2 id="tnaiAuthTitle">Continue in your browser</h2><p>Finish signing in with ${name} in the browser window Technically Not opened. Technically Not waits up to 5 minutes.</p>
<div class="tnai-auth-wait" role="status"><span class="tnai-auth-spin"></span><span>Waiting for ${name}…</span></div>
<p class="tnai-auth-hint">Signed in to ${name} in a different browser? Copy the link and paste it there.</p>
<div class="tnai-auth-actions"><button type="button" class="tnai-auth-secondary" data-auth-act="copy">${copied ? 'Link copied' : 'Copy sign-in link'}</button><button type="button" class="tnai-auth-secondary" data-auth-act="cancel">Cancel</button></div>`;
    } else {
      const g = state.google || {},
        gh = state.github || {},
        off = !native || !state.available,
        busy = !!state.flow;
      body = `<h2 id="tnaiAuthTitle">Sign in to Technically Not</h2><p>Use the account you made on technicallynot.ai.</p>
<div class="tnai-auth-buttons"><button type="button" class="tnai-auth-provider" data-provider="google"${!g.available || busy ? ' disabled' : ''}>${GOOGLE_ICON}<span>Continue with Google</span></button>${!g.available && g.reason ? `<div class="tnai-auth-unavailable" data-unavailable="google">${esc(g.reason)}</div>` : ''}<button type="button" class="tnai-auth-provider" data-provider="github"${!gh.available || busy ? ' disabled' : ''}>${GITHUB_ICON}<span>Continue with GitHub</span></button>${!gh.available && gh.reason && gh.reason !== g.reason ? `<div class="tnai-auth-unavailable" data-unavailable="github">${esc(gh.reason)}</div>` : ''}</div>
${browsers.length > 1 ? `<label class="tnai-auth-browser"><span>Open Google and GitHub in</span><select data-auth-browser${busy ? ' disabled' : ''}><option value="">Default browser</option>${browsers.map(b => `<option value="${esc(b.id)}"${b.id === pickedBrowser() ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
<div class="tnai-auth-or">or with email</div>
<form class="tnai-auth-email" data-auth-form novalidate>
<label class="tnai-signin-field"><span>Email</span><input name="email" type="email" maxlength="254" autocomplete="username" spellcheck="false" value="${esc(draftEmail)}"${off ? ' disabled' : ''}></label>
<label class="tnai-signin-field"><span>Password</span><input name="password" type="password" maxlength="256" autocomplete="current-password"${off ? ' disabled' : ''}></label>
${needCode ? '<label class="tnai-signin-field"><span>Authenticator code</span><input name="totp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits"></label>' : ''}
<div class="tnai-auth-status ${status ? esc(status.kind) : ''}" role="alert"${status ? '' : ' hidden'}>${esc(status?.text || '')}</div>
<div class="tnai-auth-actions"><button type="button" class="tnai-auth-secondary" data-auth-act="signup"${native ? '' : ' disabled'}>Create an account</button><button type="submit" class="tnai-auth-primary"${off || busy ? ' disabled' : ''}>${busy && state.flow?.provider === 'email' ? 'Signing in…' : 'Sign in'}</button></div>
</form>
<p class="tnai-auth-note">${native ? (state.available ? 'Google and GitHub open in your web browser; Technically Not never sees those passwords.' : esc(state.reason)) : OFF}</p>`;
    }
    const active = overlay.contains(document.activeElement) ? document.activeElement : null,
      focused = active?.name || '';
    const focusedAct = active?.dataset?.authAct
      ? `[data-auth-act="${active.dataset.authAct}"]${active.dataset.device ? `[data-device="${CSS.escape(active.dataset.device)}"]` : ''}`
      : '';
    const typed = Object.fromEntries(
      [...overlay.querySelectorAll('input')].map(i => [i.name, i.value])
    );
    overlay.innerHTML = `<section class="tnai-auth-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiAuthTitle" data-view="${view}"><div class="tnai-auth-logo">a</div><button type="button" class="tnai-auth-x" data-auth-act="close" aria-label="Close" title="Close (Esc)">×</button>${body}</section>`;
    for (const input of overlay.querySelectorAll('input'))
      if (typed[input.name] !== undefined && !input.value) input.value = typed[input.name];
    if (focused) overlay.querySelector(`input[name="${focused}"]`)?.focus();
    else if (focusedAct) overlay.querySelector(focusedAct)?.focus();
  }

  function open(nextView = 'choose') {
    view = nextView;
    if (nextView === 'choose') {
      status = null;
      needCode = false;
    }
    overlay.hidden = false;
    renderDialog();
    refresh();
    loadBrowsers();
    (
      overlay.querySelector('input[name=email]:not(:disabled)') ||
      overlay.querySelector('.tnai-auth-provider:not(:disabled)') ||
      overlay.querySelector('[data-auth-act]')
    )?.focus();
  }

  async function loadBrowsers() {
    const r = await native?.browsers?.();
    if (!r?.ok || !Array.isArray(r.value)) return;
    const same = JSON.stringify(r.value) === JSON.stringify(browsers);
    browsers = r.value;
    if (!same && !overlay.hidden && view === 'choose') renderDialog();
  }

  async function copyLink() {
    const r = await native?.copyLink?.();
    if (!r?.ok) {
      toastSafe(r?.error?.message || 'Couldn’t copy the sign-in link.');
      return;
    }
    copied = true;
    if (view === 'waiting' && !overlay.hidden) renderDialog();
    setTimeout(() => {
      copied = false;
      if (view === 'waiting' && !overlay.hidden) renderDialog();
    }, 2500);
  }
  const close = () => {
    if (view === 'waiting' || view === 'devices' || view === 'code') native?.cancel();
    if (view === 'devices' || view === 'code') view = 'choose';
    overlay.hidden = true;
    overlay.innerHTML = '';
    lockFocus();
  };

  // Back to the sign-in choices from the computer list (the unused ticket is dropped in the desktop
  // process).
  function backToChoices(nextStatus = null) {
    if ((view === 'devices' || view === 'code') && !nextStatus) native?.cancel();
    view = 'choose';
    status = nextStatus;
    needCode = false;
    devices = [];
    replacing = '';
    if (overlay.hidden) overlay.hidden = false;
    renderDialog();
    (
      overlay.querySelector('input[name=email]:not(:disabled)') ||
      overlay.querySelector('.tnai-auth-provider:not(:disabled)')
    )?.focus();
  }
  overlay.addEventListener('click', event => {
    if (event.target === overlay) return close();
    const provider = event.target.closest('.tnai-auth-provider:not(:disabled)');
    if (provider) return signIn(provider.dataset.provider);
    const act = event.target.closest('[data-auth-act]:not(:disabled)')?.dataset.authAct;
    if (act === 'close') close();
    else if (act === 'cancel') native?.cancel();
    else if (act === 'copy') copyLink();
    else if (act === 'signup') openSite('signup');
    else if (act === 'replace') replaceDevice(event.target.closest('[data-device]').dataset.device);
    else if (act === 'back') backToChoices();
  });
  overlay.addEventListener('change', event => {
    if (event.target.matches('[data-auth-browser]'))
      try {
        localStorage.setItem(BROWSER_KEY, event.target.value);
      } catch {}
  });
  overlay.addEventListener('submit', event => {
    event.preventDefault();
    const f = event.target;
    if (f.matches('[data-auth-code]')) return verifyCode(f.code.value);
    signInEmail({ email: f.email.value, password: f.password.value, totp: f.totp?.value || '' });
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  const toastSafe = text => {
    try {
      window.toast?.(text);
    } catch {}
  };

  async function handle(result) {
    await refresh();
    if (!result?.ok) {
      view = 'choose';
      status = {
        kind: 'error',
        text: result?.error?.message || 'Sign-in failed. Please try again.',
      };
      if (result?.error?.code === 'totp-required') needCode = true;
      if (!overlay.hidden) {
        renderDialog();
        overlay.querySelector(needCode ? 'input[name=totp]' : 'input[name=password]')?.focus();
      }
      return { status: 'error', error: result?.error };
    }
    const v = result.value;
    if (v.status === 'signed-in') {
      overlay.hidden = true;
      overlay.innerHTML = '';
      view = 'choose';
      status = null;
      needCode = false;
      toastSafe(
        v.notice ||
          'Signed in as ' +
            (state.user?.name ? maskName(state.user.name) : mask(state.user?.email) || 'you') +
            '.'
      );
    } else if (v.status === 'totp-required') {
      // Google/GitHub on an account with an authenticator app: the desktop process keeps the
      // ticket; the code finishes it (verifyCode).
      view = 'code';
      status = null;
      overlay.hidden = false;
      renderDialog();
      overlay.querySelector('input[name=code]')?.focus();
      return v;
    } else if (v.status === 'device-limit') {
      // Over the account's computer limit: list them; picking one signs it out and finishes this
      // sign-in (replaceDevice).
      view = 'devices';
      devices = v.devices || [];
      deviceLimit = v.limit || devices.length;
      replacing = '';
      status = null;
      overlay.hidden = false;
      renderDialog();
      overlay.querySelector('[data-auth-act=replace]')?.focus();
      return v;
    } else if (v.status === 'cancelled') {
      view = 'choose';
      status = { kind: 'info', text: v.message || 'Sign-in cancelled. Nothing was changed.' };
      if (!overlay.hidden) renderDialog();
    }
    lockFocus();
    return v;
  }

  async function replaceDevice(deviceId) {
    if (!native || view !== 'devices' || replacing)
      return { status: 'error', error: { code: 'busy', message: '' } };
    replacing = String(deviceId);
    status = null;
    renderDialog();
    const result = await native.replaceDevice(replacing);
    replacing = '';
    const code = result?.error?.code;
    if (!result?.ok && !['invalid-ticket', 'unknown-device', 'not-configured'].includes(code)) {
      // Offline or a server problem: the ticket may still be good, so stay on the list.
      await refresh();
      status = {
        kind: 'error',
        text: result?.error?.message || 'That didn’t work. Please try again.',
      };
      renderDialog();
      overlay
        .querySelector(`[data-auth-act=replace][data-device="${CSS.escape(String(deviceId))}"]`)
        ?.focus();
      return { status: 'error', error: result?.error };
    }
    if (!result?.ok) {
      await refresh();
      backToChoices({ kind: 'error', text: result.error.message });
      return { status: 'error', error: result.error };
    }
    return handle(result);
  }

  async function signIn(provider = 'google') {
    if (!Object.hasOwn(PROVIDER_NAMES, provider)) throw new Error('Unknown provider: ' + provider);
    if (!native) {
      open();
      return { status: 'error', error: { code: 'not-configured', message: OFF } };
    }
    await refresh();
    if (!state[provider]?.available) {
      open();
      status = {
        kind: 'error',
        text: state[provider]?.reason || PROVIDER_NAMES[provider] + ' sign-in is not available.',
      };
      renderDialog();
      return { status: 'error', error: { code: 'not-configured', message: status.text } };
    }

    // a sign-in started from the lock screen, before the dialog listed them
    if (!browsers.length) await loadBrowsers();
    waitingFor = provider;
    copied = false;
    open('waiting');
    return handle(await native.signIn(provider, pickedBrowser()));
  }

  async function signInEmail(input) {
    if (!native) {
      open();
      return { status: 'error', error: { code: 'not-configured', message: OFF } };
    }
    draftEmail = String(input?.email || '');
    if (overlay.hidden) open();
    status = null;
    renderDialog();
    return handle(await native.signInEmail(input));
  }

  async function verifyCode(code) {
    if (!native || view !== 'code' || state.flow)
      return { status: 'error', error: { code: 'busy', message: '' } };
    status = null;
    renderDialog();
    const result = await native.verifyCode(code);
    if (!result?.ok && result?.error?.code !== 'invalid-ticket') {
      // Wrong code, offline or rate-limited: the ticket is still good, so stay on the code step.
      await refresh();
      status = {
        kind: 'error',
        text: result?.error?.message || 'That didn’t work. Please try again.',
      };
      if (!overlay.hidden) {
        renderDialog();
        overlay.querySelector('input[name=code]')?.select();
      }
      return { status: 'error', error: result?.error };
    }
    return handle(result);
  }

  async function signOut() {
    if (!native) return { status: 'signed-out' };
    const r = await native.signOut();
    await refresh();
    const v = r?.ok ? r.value : null;
    toastSafe(
      v && !v.revoked
        ? 'Signed out on this PC. The server couldn’t be told (offline?); the sign-in ends there when it expires.'
        : 'Signed out of Technically Not.'
    );
    return v || { status: 'error', error: r?.error };
  }

  async function check() {
    if (!native) return state;
    const r = await native.check();
    if (r?.ok) setState(r.value);
    return state;
  }

  async function openSite(which) {
    if (!native) {
      window.open(
        'https://technicallynot.ai/' +
          (which === 'signup' ? 'signin' : which === 'account' ? 'account' : 'pricing'),
        '_blank',
        'noopener'
      );
      return null;
    }
    const r = await native.open(which);
    if (!r?.ok) toastSafe(r?.error?.message || 'Couldn’t open the website.');
    return r?.value || null;
  }

  // ---------- Lock (desktop, only when the build enforces a plan) ----------
  const lock = document.createElement('div');
  lock.className = 'tnai-auth-overlay tnai-lock-overlay';
  lock.hidden = true;
  document.body.append(lock);
  const TITLES = {
    'signed-out': 'Sign in to Technically Not',
    'no-plan': 'Subscribe to keep building',
    expired: 'Reconnect to check your subscription',
    offline: 'Reconnect to check your subscription',
    checking: 'Checking your subscription',
    clock: 'Your PC clock is behind',
    'update-required': 'Update Technically Not',
    unverified: 'Your subscription couldn’t be confirmed',
    payment: 'Your payment didn’t go through',
    device: 'This computer was signed out',
  };

  // Plan lapse: a lock while signed in (`lapsed`)
  // can be set aside with Keep reading, so projects, files, summaries and open permission prompts
  // stay usable; main still refuses prompts, new panels and typing, and a refused one
  // (auth:refused) or a new lock reason brings the lock back. lapse.closeAt: when open PowerShell
  // panels close (plan-lapse.js).
  let reading = '',
    lapse = { closeAt: 0, panes: [] },
    lockOn = false;
  const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function renderLock() {
    const l = state.lock || {},
      locked = !!(native && l.locked);
    if (!locked || !l.lapsed || reading !== l.reason) reading = '';

    // The lock went on (any reason): one event, 'tnai:lock', on which open pop-outs dock (23 Build
    // panels, 38 composer). Nothing is stopped.
    if (locked && !lockOn) {
      lockOn = true;
      window.dispatchEvent(new CustomEvent('tnai:lock'));
    } else if (!locked) lockOn = false;
    const on = locked && !reading;
    document.body.classList.toggle('tnai-locked', on);
    if (!on) {
      if (!lock.hidden) {
        lock.hidden = true;
        lock.innerHTML = '';
      }
      return;
    }
    const line = planLine(),
      u = state.user;

    // A lapse shows Keep reading instead of Quit (the window's × still quits), so the row keeps its
    // four buttons.
    const quit =
      window.tnaiNative?.frame?.control && !l.lapsed
        ? `<button type="button" class="tnai-auth-secondary" data-lock="quit">Quit</button>`
        : '';
    const read = l.lapsed
      ? `<button type="button" class="tnai-auth-secondary" data-lock="read">Keep reading</button>`
      : '';

    // One button that fixes this reason: Subscribe, Update card, or Check again (clock, offline,
    // expired, unverified, update).
    const checkBtn = cls =>
      `<button type="button" class="${cls}" data-lock="check"${state.checking ? ' disabled' : ''}>${state.checking ? 'Checking…' : 'Check again'}</button>`;
    const fix =
      l.reason === 'no-plan'
        ? `<button type="button" class="tnai-auth-primary" data-lock="subscribe">Subscribe</button>`
        : l.reason === 'payment'
          ? `<button type="button" class="tnai-auth-primary" data-lock="account">Update card</button>`
          : checkBtn('tnai-auth-primary');
    const buttons =
      quit +
      (state.signedIn
        ? `<button type="button" class="tnai-auth-secondary" data-lock="signout">Sign out</button>${/data-lock="check"/.test(fix) ? '' : checkBtn('tnai-auth-secondary')}${read}${fix}`
        : `<button type="button" class="tnai-auth-secondary" data-lock="subscribe">See plans</button>${read}<button type="button" class="tnai-auth-primary" data-lock="signin">Sign in</button>`);
    const note = l.lapsed
      ? 'Agents that are working finish their current task. Your projects and files stay readable: choose Keep reading to look at them. New prompts, agents and terminals start again once this is fixed.' +
        (lapse.closeAt > Date.now() && lapse.panes?.length
          ? ' Open PowerShell threads close at ' + hhmm(lapse.closeAt) + '.'
          : '')
      : 'Threads that were already running keep running. New agents and terminals start once the app is unlocked.';
    const focused = lock.contains(document.activeElement)
      ? document.activeElement.dataset.lock
      : '';
    lock.innerHTML = `<section class="tnai-auth-modal tnai-lock" role="dialog" aria-modal="true" aria-labelledby="tnaiLockTitle" data-reason="${esc(l.reason)}"><div class="tnai-auth-logo">a</div>
<h2 id="tnaiLockTitle">${esc(TITLES[l.reason] || 'Technically Not is locked')}</h2><p data-lock-message>${esc(l.message)}</p>
${u ? `<div class="tnai-auth-status info" data-lock-account>Signed in as ${esc(u.name ? maskName(u.name) + ' · ' + mask(u.email) : mask(u.email))}${line?.text ? ' · ' + esc(line.text) : ''}${state.problem ? '<br>' + esc(state.problem) : ''}</div>` : ''}
<p class="tnai-auth-note" data-lock-note>${esc(note)}</p>
<div class="tnai-auth-actions">${buttons}</div></section>`;
    lock.hidden = false;
    (
      (focused && lock.querySelector(`[data-lock="${focused}"]`)) ||
      (overlay.hidden ? lock.querySelector('.tnai-auth-primary') : null)
    )?.focus();
  }
  lock.addEventListener('click', event => {
    const act = event.target.closest('[data-lock]:not(:disabled)')?.dataset.lock;
    if (act === 'signin') open();
    else if (act === 'subscribe') openSite(state.signedIn ? 'subscribe' : 'pricing');
    else if (act === 'account') openSite('account');
    else if (act === 'read') {
      reading = state.lock?.reason || '';
      renderLock();
    } else if (act === 'check') check();
    else if (act === 'signout') signOut();

    // same close as the window's × (warns if terminals run)
    else if (act === 'quit') window.tnaiNative.frame.control('close').catch(() => {});
  });

  // While locked, focus and keys stay in the lock or the sign-in dialog (the window buttons still
  // work).
  const inDialogs = el => !!el?.closest?.('.tnai-lock-overlay,.tnai-auth-overlay,.win-ctrls');
  const lockFocus = () => {
    if (!lock.hidden && overlay.hidden && !inDialogs(document.activeElement))
      lock.querySelector('button')?.focus();
  };
  document.addEventListener('focusin', event => {
    if (!lock.hidden && !inDialogs(event.target)) lockFocus();
  });
  window.addEventListener(
    'keydown',
    event => {
      if (!lock.hidden && !inDialogs(event.target)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        lockFocus();
      }
    },
    true
  );

  if (native) {
    native.onChange(next => setState(next));
    native.onNotice(n => toastSafe(n?.message || ''));
    native.onLapse?.(next => {
      lapse = next || { closeAt: 0, panes: [] };
      if (!lock.hidden) renderLock();
    });
    native.onRefused?.(() => {
      if (reading) {
        reading = '';
        renderLock();
      }
    });
  }
  renderControl();
  refresh();

  window.TnaiAuth = {
    session: publicSession,
    state: () => JSON.parse(JSON.stringify(state)),
    onChange: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signIn,
    signInEmail,
    signOut,
    check,
    openSite,
    replaceDevice,
    cancel: () => native?.cancel(),
    open: () => open(),
    ready: refresh,
  };
})();
