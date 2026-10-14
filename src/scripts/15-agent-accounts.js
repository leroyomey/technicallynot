// Technically Not · 15-agent-accounts.js — Desktop app only: several accounts per agent CLI (e.g.
// three Claude emails), which one new sessions use, switching a running pane to another account
// (resuming its conversation), and usage-limit detection. Exposes window.TnaiAccounts; renders into
// #tnaiAccountsMount on the Settings page (22).
(() => {
  const native = window.tnaiNative;
  if (!native?.accounts) return;

  let data = []; // accounts:list result, one entry per CLI
  const limits = new Map(); // paneId -> { paneId, agent, accountId, text, at, startedAt }
  const listeners = new Set();
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const agentsApi = () => window.TnaiAgents;

  function changed() {
    listeners.forEach(fn => {
      try {
        fn();
      } catch {}
    });
    window.dispatchEvent(new CustomEvent('tnai:accounts-changed'));
    render();
  }

  // Refreshes can overlap (status checks take seconds); only the most recently issued one may
  // replace the list.
  let loading = false,
    issued = 0,
    addingFor = ''; // addingFor: the CLI whose card shows the inline add-account row

  // { agentId, accountId } whose card shows the inline API-key row (accountId '' = a new API-key
  // account)
  let keyFor = null;

  async function refresh(withStatus = true, force = false) {
    const seq = ++issued;
    if (withStatus) {
      loading = true;
      render();
    }
    const result = await native.accounts.list({ withStatus, force });
    if (seq !== issued) return data;
    loading = false;
    if (result?.ok) data = result.value;
    changed();
    return data;
  }

  // After a change: show it at once, then fill in sign-in states.
  const reload = () => refresh(false).then(() => refresh(true));
  const cli = agentId => data.find(d => d.agentId === agentId);
  const accountOf = (agentId, accountId) =>
    cli(agentId)?.accounts.find(a => a.id === (accountId || ''));

  // Emails are masked everywhere, Settings included (01 tnaiMaskEmails), so nobody who sees the
  // screen learns an address to sign in with.
  const mask = text => (window.tnaiMaskEmails || String)(text);

  // The Windows / macOS user folder name in an install path (tooltip) is personal too:
  // C:\Users\<name>\… → C:\Users\…\…
  const maskPath = path => String(path || '').replace(/([\\/](?:Users|home)[\\/])[^\\/]+/gi, '$1…');

  function label(agentId, accountId) {
    return mask(fullLabel(agentId, accountId));
  }

  function fullLabel(agentId, accountId) {
    const account = accountOf(agentId, accountId);
    if (!account) return accountId ? 'Unknown account' : 'Default account';
    const email = account.status?.email;
    return account.isDefault
      ? email || 'Default account'
      : account.label + (email ? ' · ' + email : '');
  }

  async function setActive(agentId, accountId) {
    const result = await native.accounts.setActive(agentId, accountId || '');
    if (!result.ok) {
      say(result.error.message);
      return false;
    }
    const entry = cli(agentId);
    if (entry) entry.active = result.value;
    changed();
    reload();
    return true;
  }

  // Adds an account folder, then runs the CLI's own sign-in in it (unless opts.signIn === false).
  // Without opts.label the sign-in dialog asks for the details.
  async function add(agentId, opts = {}) {
    if (opts.label === undefined) {
      openSignIn(agentId, { adding: true });
      return null;
    }
    const result = await native.accounts.add(agentId, opts.label);
    if (!result.ok) {
      say(result.error.message);
      return null;
    }
    await reload();
    if (result.value.note) say(result.value.note);
    if (opts.signIn !== false) await startLogin(agentId, result.value.id, opts.login);
    return result.value;
  }

  // ---- Sign-in: always the CLI's own login flow, which opens the provider's page in the system
  // browser (never inside Technically Not). ---- same rule as agent-registry.js
  const EMAIL = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}$/;
  const pendingLogins = new Map(); // login paneId -> { agentId, accountId }

  async function startLogin(agentId, accountId, login) {
    if (!agentsApi()?.open) {
      say('Start a thread with ' + agentId + ' to sign in.');
      return null;
    }
    const result = await agentsApi().open(agentId, {
      accountId: accountId || '',
      mode: 'login',
      login: login || null,
    });
    if (!result?.ok) {
      say('Could not start ' + agentId + ' sign-in' + (result?.error ? ': ' + result.error : ''));
      return result;
    }
    pendingLogins.set(result.paneId, { agentId, accountId: accountId || '' });
    const provider = cli(agentId)?.signIn?.provider;
    say(
      provider
        ? provider +
            '’s sign-in page opens in your browser · finish there and Technically Not picks it up'
        : 'Finish ' + agentId + ' sign-in in the new terminal panel'
    );
    return result;
  }

  // Sign-in state of one account: the accounts list for multi-account CLIs, the CLI detection for
  // single-account ones.
  function statusOf(agentId, accountId) {
    if (cli(agentId)?.supported) return accountOf(agentId, accountId)?.status || null;
    const info = (agentsApi()?.info() || []).find(a => a.id === agentId);
    return info
      ? { loggedIn: info.loggedIn, email: info.account || '', method: info.method || '' }
      : null;
  }

  // One re-check when a sign-in pane's process exits, then say who is signed in.
  async function afterLogin(paneIds) {
    await Promise.all([refresh(true, true), agentsApi()?.detect?.(true)]);
    for (const id of paneIds) {
      const p = pendingLogins.get(id);
      if (!p) continue;
      pendingLogins.delete(id);
      const st = statusOf(p.agentId, p.accountId),
        email = EMAIL.test(st?.email || '') ? st.email : '';
      say(
        st?.loggedIn
          ? p.agentId +
              ' signed in' +
              (email
                ? ' as ' + (window.tnaiMaskEmails || String)(email)
                : st.method
                  ? ' with ' + st.method
                  : '')
          : p.agentId + ' sign-in did not finish · try again from Settings → Accounts'
      );
    }
  }

  // Signed-in emails across every CLI and account, so one Gmail used on several providers shows as
  // one identity. Other sign-ins (no email reported) are listed apart.
  function identities(source = data, infos = agentsApi()?.info() || []) {
    const info = new Map(infos.map(a => [a.id, a])),
      byEmail = new Map(),
      other = [];
    for (const entry of source) {
      const rows = entry.supported
        ? entry.accounts.map(a => ({
            accountId: a.id,
            isDefault: !!a.isDefault,
            name: a.label,
            st: a.status,
          }))
        : [
            {
              accountId: '',
              isDefault: true,
              name: '',
              st: info.get(entry.agentId) && {
                loggedIn: info.get(entry.agentId).loggedIn,
                email: info.get(entry.agentId).account,
                method: info.get(entry.agentId).method,
              },
            },
          ];
      for (const r of rows) {
        if (r.st?.loggedIn !== true) continue;
        const use = {
          agentId: entry.agentId,
          accountId: r.accountId,
          account: r.isDefault ? '' : r.name || '',
          method: r.st.method || '',
        };
        const email = EMAIL.test(r.st.email || '') ? r.st.email.toLowerCase() : '';
        if (email) (byEmail.get(email) || byEmail.set(email, []).get(email)).push(use);
        else other.push(use);
      }
    }
    return {
      byEmail: [...byEmail]
        .map(([email, uses]) => ({ email, uses }))
        .sort((a, b) => b.uses.length - a.uses.length || a.email.localeCompare(b.email)),
      other,
    };
  }

  const dialog = document.createElement('div');
  dialog.className = 'tnai-ws-close-overlay tnai-signin-overlay';
  dialog.hidden = true;
  document.body.append(dialog);
  let dialogCtx = null;

  function closeSignIn() {
    dialog.hidden = true;
    dialog.innerHTML = '';
    dialogCtx = null;
  }

  // ctx: { adding } for a new account folder, { accountId } to sign in an existing one
  // (single-account CLIs: ''), or { switching } to sign a single-account CLI out and in as another
  // account (its `logout`, then `login`).
  function openSignIn(agentId, ctx = {}) {
    const entry = cli(agentId),
      s = entry?.signIn;
    if (!s) {
      startLogin(agentId, ctx.accountId || '');
      return;
    }
    const switching = !!ctx.switching && !!s.switchCommand;
    dialogCtx = {
      agentId,
      adding: !!ctx.adding,
      switching,
      accountId: ctx.accountId || '',
      label: ctx.label,
    };
    const open = switching
      ? (agentsApi()?.sessions() || []).filter(
          x => x.agent === agentId && x.mode !== 'login' && x.running
        ).length
      : 0;

    // named in the card's inline row: the dialog is sign-in consent only
    const named = ctx.adding && typeof ctx.label === 'string';
    const who = s.provider ? s.provider + '’s' : 'the provider’s';
    const emails = identities().byEmail.map(g => g.email);
    const chips =
      (s.email || (ctx.adding && !named)) && emails.length
        ? `<div class="tnai-signin-same"><span>${s.email ? 'Same email as your other agents' : 'Name it after'}</span>${emails.map(e => `<button type="button" data-signin-email="${esc(e)}">${esc(mask(e))}</button>`).join('')}</div>`
        : '';
    dialog.innerHTML = `<form class="tnai-ws-close-modal tnai-signin-modal" novalidate role="dialog" aria-modal="true" aria-labelledby="tnaiSignInTitle" data-agent="${esc(agentId)}">
<h2 id="tnaiSignInTitle">${esc(switching ? 'Switch ' + agentId + ' account' : ctx.adding ? 'Add a ' + agentId + ' account' + (named && ctx.label ? ' · ' + ctx.label : '') : 'Sign in to ' + agentId)}</h2>
<p>${
      switching
        ? `Technically Not runs <code>${esc(s.switchCommand)}</code> in a terminal panel: ${esc(agentId)} signs the current account out on this PC, then opens <b>${esc(who)} own sign-in page in your web browser</b> so you can sign in as another account. Technically Not never sees the credential.${open ? ` <b>${open} open ${esc(agentId)} panel${open > 1 ? 's were' : ' was'} started with the current account</b>; restart ${open > 1 ? 'them' : 'it'} after switching.` : ''}`
        : s.browser
          ? `Technically Not runs <code>${esc(s.command)}</code> in a terminal panel. It opens <b>${esc(who)} own sign-in page in your web browser</b>, not inside Technically Not, so your password and sign-in token go only to ${esc(s.provider)} and ${esc(agentId)}. If your account uses Gmail, choose Google on that page.`
          : `Technically Not runs <code>${esc(s.command)}</code> in a terminal panel. Pick the AI provider there; each provider then uses its own sign-in, and ${esc(agentId)} keeps the credential. Technically Not never sees it.`
    }</p>
${ctx.adding && !named ? '<label class="tnai-signin-field"><span>Name in Technically Not</span><input name="label" maxlength="60" autocomplete="off" placeholder="For example Work, or the email it uses"></label>' : ''}
${s.email ? `<label class="tnai-signin-field"><span>Email <small>optional</small></span><input name="email" type="email" maxlength="254" autocomplete="off" spellcheck="false" placeholder="you@gmail.com"><small>Filled in on ${esc(who)} page for you (<code>--email</code>).</small></label>` : ''}
${chips}
${s.methods.length ? `<fieldset class="tnai-signin-methods"><legend>How you sign in to ${esc(s.provider || agentId)}</legend>${s.methods.map((m, i) => `<label><input type="radio" name="method" value="${esc(m.id)}"${i ? '' : ' checked'}><span><b>${esc(m.label)}</b><small>${esc(m.detail)}</small></span></label>`).join('')}</fieldset>` : ''}
<p class="tnai-signin-error" role="alert" hidden></p>
<div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel">Cancel</button><button type="submit" class="tnai-ws-close-confirm">${esc(switching ? 'Sign out and switch' : s.provider ? 'Open ' + s.provider + ' sign-in' : 'Start sign-in')}</button></div></form>`;
    dialog.hidden = false;
    (
      dialog.querySelector('input:not([type=radio])') ||
      dialog.querySelector('.tnai-ws-close-confirm')
    ).focus();
  }
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('.tnai-ws-close-cancel')) {
      closeSignIn();
      return;
    }
    const chip = event.target.closest('[data-signin-email]');
    if (!chip) return;
    const email = dialog.querySelector('input[name=email]'),
      name = dialog.querySelector('input[name=label]');
    if (email) email.value = chip.dataset.signinEmail;
    if (name && !name.value.trim()) name.value = chip.dataset.signinEmail;
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSignIn();
  });
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    const ctx = dialogCtx;
    if (!ctx) return;
    const form = event.target,
      error = form.querySelector('.tnai-signin-error');
    const email = (form.elements.email?.value || '').trim(),
      method = form.elements.method?.value || '',
      label = (form.elements.label ? form.elements.label.value : ctx.label || '').trim();
    if (email && !EMAIL.test(email)) {
      error.textContent = 'Enter a plain email address, or leave it empty.';
      error.hidden = false;
      return;
    }
    const login = ctx.switching ? { email, method, switch: true } : { email, method };
    closeSignIn();
    if (ctx.adding) await add(ctx.agentId, { label: label || email, login });
    else await startLogin(ctx.agentId, ctx.accountId, login);
  });

  async function remove(agentId, accountId, opts = {}) {
    if (!accountId) return false;
    if (
      opts.confirm !== false &&
      !confirm(
        'Remove “' +
          label(agentId, accountId, true) +
          '” from Technically Not? Its sign-in folder is deleted; conversations shared with other accounts stay.'
      )
    )
      return false;
    const result = await native.accounts.remove(agentId, accountId);
    if (!result.ok) {
      say(result.error.message);
      return false;
    }
    await reload();
    say('Account removed');
    return result.value;
  }

  async function rename(agentId, accountId) {
    const name = prompt('Rename this account:', accountOf(agentId, accountId)?.label || '');
    if (!name) return;
    const result = await native.accounts.rename(agentId, accountId, name);
    if (!result.ok) say(result.error.message);
    else reload();
  }

  // Restarts the pane's CLI on another account and resumes its conversation when the CLI supports
  // it.
  async function switchPane(paneId, accountId) {
    const session = agentsApi()
      ?.sessions()
      .find(s => s.paneId === paneId);
    if (!session) {
      say('That session is no longer open.');
      return null;
    }
    if (!agentsApi().restart) {
      say('Switching a running session is not available in this build.');
      return null;
    }
    const result = await agentsApi().restart(paneId, { accountId: accountId || '', resume: true });
    if (!result?.ok) {
      say('Could not switch ' + session.name + ' to ' + label(session.agent, accountId));
      return result;
    }
    clearLimit(paneId, false);
    say(
      session.name +
        ' now uses ' +
        label(session.agent, accountId) +
        (result.resumed
          ? ' · conversation resumed'
          : ' · started fresh (no saved conversation to resume)')
    );
    changed();
    return result;
  }

  // ---- Usage-limit detection from the CLI's own messages ----
  const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

  // Claude Code, Codex; Gemini CLI ("Usage limit reached for <model>." dialog, "You have exhausted
  // your daily quota on this model."), Cursor Agent ("You’ve hit your usage limit", curly
  // apostrophe), OpenCode Go ("5 hour usage limit reached. It will reset in …").
  const LIMIT =
    /usage limit reached|(?:5-hour|weekly|session|opus|sonnet) limit reached|limit reached\s*[∙·•|]\s*resets|you['’]?ve hit your (?:usage )?limit|hit your usage limit|exhausted your daily quota on this model/gi;
  const QUOTE = /["'`“”‘’~*_]/;

  // The CLI's own limit line, not the phrase quoted in text an agent prints (docs, code, chat): a
  // quote or a markdown marker (~~strike~~, **bold**, _em_: a doc diff on screen) right before or
  // after it means a quote. cheap pre-check: every LIMIT form contains one of these words
  const LIMIT_HINT = /limit|quota/i;
  const limitMatch = text => {
    if (!LIMIT_HINT.test(text)) return null;
    for (const m of text.matchAll(LIMIT))
      if (!QUOTE.test(text[m.index - 1] || '') && !QUOTE.test(text[m.index + m[0].length] || ''))
        return m;
    return null;
  };

  // paneId -> last ~200 chars, so a phrase split across chunks still matches
  const tails = new Map();
  native.pty.onData(({ paneId, data: chunk }) => {
    const text =
      (tails.get(paneId) || '') +
      (chunk.includes('\x1b')
        ? window.TnaiPtyStrip
          ? window.TnaiPtyStrip.limits(chunk)
          : chunk.replace(ANSI, ' ')
        : chunk); // every ANSI form starts with ESC; 13 strips each chunk once for both
    tails.set(paneId, text.slice(-200));
    const match = limitMatch(text);
    if (!match) return;
    const session = agentsApi()
      ?.sessions()
      .find(s => s.paneId === paneId);
    if (!session?.running || limits.has(paneId)) return;
    const start = Math.max(text.lastIndexOf('\n', match.index) + 1, match.index - 60),
      end = text.indexOf('\n', match.index);
    const line = text
      .slice(start, end > 0 ? Math.min(end, match.index + 140) : match.index + 140)
      .replace(/\s+/g, ' ')
      .trim();
    const info = {
      paneId,
      agent: session.agent,
      accountId: session.accountId || '',
      text: line,
      at: Date.now(),
      startedAt: session.startedAt,
    };
    limits.set(paneId, info);
    window.dispatchEvent(new CustomEvent('tnai:account-limit', { detail: info }));
    say(
      session.name +
        ': ' +
        label(session.agent, info.accountId) +
        ' hit its usage limit' +
        (suggest(info) !== null ? ' · switch account to continue' : '')
    );
    changed();
  });

  // A limit belongs to one run of the pane; it clears when the pane restarts or closes.
  function clearStale() {
    const sessions = new Map((agentsApi()?.sessions() || []).map(s => [s.paneId, s]));
    let any = false;
    for (const [paneId, info] of limits) {
      const s = sessions.get(paneId);
      if (!s || s.startedAt !== info.startedAt || (s.accountId || '') !== info.accountId) {
        clearLimit(paneId, false);
        any = true;
      }
    }
    for (const paneId of tails.keys()) if (!sessions.has(paneId)) tails.delete(paneId);
    if (any) changed();
  }

  // The limit is over for this pane (69 auto-resume after the reset, a pane restart): the next
  // limit line is detected again, and 42's timer resumes.
  function clearLimit(paneId, notify = true, extra = {}) {
    if (!limits.delete(paneId)) return false;
    tails.delete(paneId);
    window.dispatchEvent(
      new CustomEvent('tnai:account-limit-cleared', { detail: { ...extra, paneId } })
    );
    if (notify) changed();
    return true;
  }

  // Another signed-in account of the same CLI that is not currently limited, or null.
  function suggest(info) {
    const limited = new Set(
      [...limits.values()].filter(l => l.agent === info.agent).map(l => l.accountId)
    );
    const candidate = (cli(info.agent)?.accounts || []).find(
      a => a.id !== info.accountId && !limited.has(a.id) && a.status?.loggedIn !== false
    );
    return candidate ? candidate.id : null;
  }

  function limitFor(paneId) {
    const info = limits.get(paneId);
    if (!info) return null;
    const next = suggest(info);
    return {
      ...info,
      accountLabel: label(info.agent, info.accountId),
      suggest: next,
      suggestLabel: next === null ? '' : label(info.agent, next),
    };
  }

  // ---- UI in #tnaiAccountsMount ----
  const style = document.createElement('style');
  style.textContent = `
.tnai-ws-close-modal.tnai-signin-modal{display:grid;gap:12px;width:min(480px,calc(100vw - 48px))}.tnai-signin-modal p{margin:0!important}.tnai-signin-modal .tnai-ws-close-actions{margin-top:8px}
.tnai-signin-modal code{padding:1px 4px;border-radius:4px;background:#eef1ea;color:#4e5547;font:10px Consolas,monospace}
.tnai-signin-field{display:grid;gap:5px;color:#4e5547;font:600 10px var(--pg-sans)}.tnai-signin-field small{color:#8d9288;font:400 9px var(--pg-sans)}
.tnai-signin-field input{height:30px;padding:0 9px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#3e4438;font:11px var(--pg-sans);outline:none}.tnai-signin-field input:focus{border-color:#bccaa9;box-shadow:0 0 0 3px #eef3e7}
.tnai-signin-same{display:flex;flex-wrap:wrap;align-items:center;gap:5px;color:#8d9288;font:9px var(--pg-sans)}.tnai-signin-same span{margin-right:2px}
.tnai-signin-same button{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:99px;background:#fff;color:#5b6353;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}.tnai-signin-same button:hover{background:#f2f4ee}
.tnai-signin-methods{display:grid;gap:5px;margin:0;padding:0;border:0}.tnai-signin-methods legend{margin-bottom:5px;padding:0;color:#4e5547;font:600 10px var(--pg-sans)}
.tnai-signin-methods label{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border:1px solid #eef0eb;border-radius:6px;background:#fff;cursor:pointer}.tnai-signin-methods label:has(:checked){border-color:#cfdcbf;background:#f4f8ef}
.tnai-signin-methods input{margin:1px 0 0;accent-color:#6f8c52}.tnai-signin-methods span{display:grid;gap:2px}.tnai-signin-methods b{color:#454a40;font:600 10px var(--pg-sans)}.tnai-signin-methods small{color:#8d9288;font:9px var(--pg-sans)}
.tnai-signin-error{color:#9a4a3c!important;font:10px var(--pg-sans)!important}
`;
  document.head.append(style);

  const pill = status =>
    status?.loggedIn === true
      ? ['ready', 'Signed in']
      : status?.loggedIn === false
        ? ['waiting', 'Sign-in required']
        : status
          ? ['ready', 'Installed']
          : ['idle', 'Checking…'];
  const NOTES = {
    'Cursor Agent':
      'Cursor Agent keeps one sign-in per ' +
      (window.tnaiPlatform.win
        ? 'PC (in %APPDATA%\\Cursor)'
        : window.tnaiPlatform.mac
          ? 'computer (in ~/Library/Application Support/Cursor)'
          : 'computer (in ~/.config/Cursor)') +
      ', so Technically Not cannot hold separate Cursor accounts. Use Switch account to sign out and sign in as another Cursor account.',
    OpenCode:
      'OpenCode stores provider credentials together with its sessions, so Technically Not uses it with one set of credentials.',
    Droid:
      'Droid signs in inside its own session; Technically Not cannot keep separate Droid accounts.',
  };

  // ＋ Add account opens an inline row in that CLI's card (name + Add/Cancel); Add then shows the
  // sign-in consent dialog.
  function addRow(entry) {
    const emails = identities().byEmail.map(g => g.email);
    return `<form class="tnai-acct-addrow" data-acct-form novalidate><label for="tnaiAcctAddName">Name for the new ${esc(entry.agentId)} account</label>
<div class="tnai-acct-addline"><input id="tnaiAcctAddName" name="label" maxlength="60" autocomplete="off" spellcheck="false" placeholder="For example Work, or the email it uses"><button type="submit" class="primary">Add</button><button type="button" data-acct="add-cancel">Cancel</button></div>
${emails.length ? `<div class="tnai-acct-addnames"><span>Name it after</span>${emails.map(e => `<button type="button" data-acct-name="${esc(e)}">${esc(mask(e))}</button>`).join('')}</div>` : ''}</form>`;
  }

  function openAddRow(agentId) {
    addingFor = agentId;
    render();
    document.getElementById('tnaiAcctAddName')?.focus();
  }

  function closeAddRow(focusButton) {
    const agentId = addingFor;
    addingFor = '';
    render();
    if (focusButton)
      document
        .querySelector(
          '#tnaiAccountsMount [data-cli="' + CSS.escape(agentId) + '"] [data-acct=add]'
        )
        ?.focus();
  }

  // ＋ Add API key / Replace key: an inline row with a password field. The key goes to the main
  // process once (accounts:addKey / setKey) and is never read back; only its last 4 characters are
  // shown (desktop/api-keys.js).
  const keyStore = () =>
    window.tnaiPlatform.win
      ? 'Windows'
      : window.tnaiPlatform.mac
        ? 'the macOS Keychain'
        : 'your system keyring';

  function keyRow(entry) {
    const k = entry.apiKey,
      replacing = !!keyFor.accountId;
    return `<form class="tnai-acct-addrow" data-acct-keyform novalidate><label for="tnaiAcctKey">${replacing ? 'New' : 'Your'} ${esc(k.provider)} API key</label>
<div class="tnai-acct-addline"><input id="tnaiAcctKey" name="key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(k.prefix)}…" aria-describedby="tnaiAcctKeyNote"><button type="submit" class="primary">${replacing ? 'Replace' : 'Add'}</button><button type="button" data-acct="key-cancel">Cancel</button></div>
<p class="tnai-acct-keynote" id="tnaiAcctKeyNote">Pay per use on your own ${esc(k.provider)} account. Kept encrypted by ${esc(keyStore())} on this ${window.tnaiPlatform.win ? 'PC' : 'computer'}; only this account’s agent panels get it, and Technically Not never sends it anywhere. <a href="${esc(k.keyUrl)}">Get a key</a></p>
<p class="tnai-acct-keyerror" role="alert" hidden></p></form>`;
  }

  function openKeyRow(agentId, accountId) {
    const k = cli(agentId)?.apiKey;
    if (!k) return;
    if (k.unavailable) {
      say(k.unavailable);
      return;
    }
    addingFor = '';
    keyFor = { agentId, accountId: accountId || '' };
    render();
    document.getElementById('tnaiAcctKey')?.focus();
  }

  function closeKeyRow(focusButton) {
    const was = keyFor;
    keyFor = null;
    render();
    if (focusButton && was)
      document
        .querySelector(
          '#tnaiAccountsMount [data-cli="' +
            CSS.escape(was.agentId) +
            '"] ' +
            (was.accountId
              ? '[data-account="' + CSS.escape(was.accountId) + '"] [data-acct=rekey]'
              : '[data-acct=addkey]')
        )
        ?.focus();
  }

  // Plan limits per account as 98's fuel gauges (Session / Week bars, time-gone tick, resets in),
  // the same painter as the Overview AI accounts card. The slot is in the markup only while 80 has
  // a reading or a status note for that account; paintGauges() fills it after every render.
  function gaugeItem(agentId, accountId) {
    const r = window.TnaiPlanLimits?.get?.(agentId, accountId);
    if (!r || r.status === 'signedout' || r.status === 'none') return null;
    const ws = (r.windows || []).slice().sort((x, y) => x.minutes - y.minutes);
    const outer = ws.find(w => w.minutes === 300) || ws[0] || null,
      inner = ws.find(w => w.minutes === 10080 && w !== outer) || ws.find(w => w !== outer) || null;
    return {
      agent: agentId,
      nm: label(agentId, accountId),
      col: '',
      plan: '',
      ok: r.status === 'ok',
      status: r.status,
      stale: !!r.stale,
      at: r.at || 0,
      outer,
      inner,
    };
  }
  const gaugeSlot = (agentId, accountId) =>
    window.TnaiAcctGauges && gaugeItem(agentId, accountId)
      ? `<div class="tnai-acct-gauge" data-g-agent="${esc(agentId)}" data-g-acct="${esc(accountId)}"><div></div></div>`
      : '';

  function paintGauges() {
    mountEl()
      ?.querySelectorAll('.tnai-acct-gauge')
      .forEach(slot => {
        const item = gaugeItem(slot.dataset.gAgent, slot.dataset.gAcct);
        if (item) window.TnaiAcctGauges.paint(slot.firstElementChild, [item]);
      });
  }

  // "resets in" and the time-gone tick move with the clock: repaint in place every 30 s, only while
  // the accounts are on screen (the chain stops at the first tick after the section is hidden and
  // restarts on the next render or when Settings opens).
  let gaugeTimer = 0;

  function tickGauges() {
    clearTimeout(gaugeTimer);
    gaugeTimer = 0;
    if (mountEl()?.offsetParent)
      gaugeTimer = setTimeout(() => {
        paintGauges();
        tickGauges();
      }, 30000);
  }
  window.addEventListener('tnai:settings-page-shown', () => requestAnimationFrame(tickGauges));
  document.addEventListener('click', event => {
    if (event.target.closest?.('#settingsTab-accounts'))
      requestAnimationFrame(() => {
        paintGauges();
        tickGauges();
      });
  });

  function cliCard(entry, info) {
    const installed = info ? info.installed : true;
    const rows = entry.supported
      ? entry.accounts
          .map(a => {
            const active = (entry.active || '') === a.id,
              isKey = a.kind === 'api-key',
              [tone, text] =
                isKey && a.status
                  ? a.status.loggedIn
                    ? ['ready', 'Key saved']
                    : ['waiting', 'Re-enter key']
                  : pill(a.status),
              unlinked = a.shared?.some(s => !s.linked);
            const about = isKey
              ? a.status?.apiKey
                ? 'Pay per use · key ending ' + a.status.apiKey.last4
                : a.status
                  ? 'The saved key can’t be read on this computer any more · enter it again'
                  : 'Pay per use on your own key'
              : (a.isDefault
                  ? 'The account ' + entry.agentId + ' uses normally'
                  : unlinked
                    ? 'Conversations are not shared with the default account'
                    : 'Conversations shared with your other ' + entry.agentId + ' accounts') +
                (a.status?.loggedIn && a.status.method ? ' · ' + a.status.method : '');

            // An account tile: who it is (name, what it is, sign-in state), its chips (plan, New
            // sessions), 98's gauges, then its actions along the foot.
            return `<div class="tnai-acct-row ac-acct${active ? ' active' : ''}${isKey ? ' key' : ''}" role="listitem" data-account="${esc(a.id)}" data-tone="${tone}">
<div class="ac-acct-top"><span class="ac-acct-ic" aria-hidden="true">${isKey ? KEY_IC : esc((label(entry.agentId, a.id) || '?').trim().charAt(0).toUpperCase())}</span><div class="tnai-acct-name"><b>${esc(label(entry.agentId, a.id))}</b><small>${esc(about)}</small></div></div>
<div class="tnai-acct-meta"><span class="agent-status-pill ${tone}"><i></i><span>${text}</span></span>${a.status?.plan && !isKey ? `<span class="tnai-acct-plan">${esc(a.status.plan)}</span>` : ''}${active ? '<span class="tnai-acct-active">New sessions</span>' : ''}</div>
${gaugeSlot(entry.agentId, a.id)}<div class="tnai-acct-actions">${active ? '' : '<button type="button" data-acct="use">Use for new sessions</button>'}${isKey ? `<button type="button" class="link" data-acct="rekey"${keyFor?.accountId === a.id ? ' disabled' : ''}>${a.status?.loggedIn === false ? 'Re-enter key' : 'Replace key'}</button>` : a.status?.loggedIn === false ? '<button type="button" data-acct="signin">Sign in</button>' : ''}${a.isDefault ? '' : (isKey ? '' : '<button type="button" class="link" data-acct="rename" title="Rename">Rename</button>') + '<button type="button" class="link" data-acct="remove" title="Remove from Technically Not">Remove</button>'}</div></div>`;
          })
          .join('')
      : '';
    const signedIn =
      info?.loggedIn === true
        ? ['ready', 'Signed in']
        : info?.loggedIn === false
          ? ['waiting', 'Sign-in required']
          : installed
            ? ['ready', 'Installed']
            : ['idle', 'Not installed'];

    // Only the version number ("2.1.3 (Claude Code)", "codex-cli 0.40.0", "2025.09.18-7ae6800" →
    // v2.1.3 …); the raw line and install path stay in the tooltip.
    const number = (info?.version || '').match(/\d+(?:\.\d+)+/)?.[0] || '';
    const where =
        info && installed ? (number ? 'v' + number : info.version ? '' : info.command) : '',
      path = installed ? info?.path || '' : '';
    const tip = [info?.version, maskPath(path)].filter(Boolean).join(' · ');
    const signedInNote =
      info?.loggedIn === true && info.account ? 'Signed in as ' + mask(info.account) : '';
    const more = NOTES[entry.agentId]
      ? `<details data-note="${esc(entry.agentId)}"${openNotes.has(entry.agentId) ? ' open' : ''}><summary>More about ${esc(entry.agentId)} accounts</summary>${esc(NOTES[entry.agentId])}</details>`
      : '';
    const avatar =
      window.TnaiCliIcons?.avatar(entry.agentId) ||
      `<span class="agent-avatar">${esc(entry.agentId.charAt(0))}</span>`;

    // Not installed: a small tile in the strip at the end of the section.
    // Install runs the provider's own command in a PowerShell terminal panel the user can watch
    // (90); a CLI that comes through npm offers Node.js first while npm is not found. The link
    // opens the provider's install page. Nothing to offer: the tile stays a name.
    if (!installed) {
      const how = install?.tools?.[entry.agentId],
        needNode = !!how?.needsNode && !install.node,
        cmd = needNode ? install.nodeCommand : how?.command,
        page = needNode ? install.nodePage : how?.page;
      const get = how
        ? `${cmd && window.TnaiPowerShellLink?.run ? `<button type="button" data-acct="install" title="${esc('Runs in a PowerShell terminal panel: ' + cmd)}">${needNode ? 'Install Node.js' : 'Install'}</button>` : ''}${page ? `<a class="link" href="${esc(page)}" target="_blank" rel="noreferrer">${needNode ? 'Node.js page' : 'Provider page'}</a>` : ''}`
        : '';
      return `<article class="tnai-cli missing" role="listitem" data-cli="${esc(entry.agentId)}"><div class="tnai-cli-head">${avatar}<div class="tnai-cli-identity"><b>${esc(entry.agentId)}</b><small>${needNode ? 'Needs Node.js first' : 'Not installed'}</small></div></div>${get ? `<div class="tnai-acct-actions">${get}</div>` : ''}</article>`;
    }
    const count = entry.supported
      ? entry.accounts.length + ' account' + (entry.accounts.length === 1 ? '' : 's')
      : '';

    // Installed: the tool's identity column (logo, name, version, state, tool actions) beside its
    // accounts as tiles. Adding an account or an API key is a dashed button in the last cell of the
    // row (both stacked there), which turns into the inline form while it is open.
    const adding = entry.supported && addingFor === entry.agentId,
      keying = !!entry.apiKey && keyFor?.agentId === entry.agentId;
    const ghost = (act, title, sub) =>
      `<button type="button" class="ac-ghost" data-acct="${act}"><span class="ac-ghost-ic" aria-hidden="true">${window.TnaiIcon ? window.TnaiIcon('plus', { size: 16 }) : '＋'}</span><b>${title}</b><small>${sub}</small></button>`;
    const tiles =
      (entry.supported
        ? rows
        : `<div class="ac-acct ac-single" role="listitem"><div class="ac-acct-top"><span class="ac-acct-ic" aria-hidden="true">${esc(entry.agentId.charAt(0))}</span><div class="tnai-acct-name"><b>${signedInNote ? esc(signedInNote) : info?.loggedIn === false ? 'Not signed in' : 'One sign-in on this ' + (window.tnaiPlatform.win ? 'PC' : 'computer')}</b><small>${esc(entry.agentId)} keeps one sign-in, managed by the tool itself.</small></div></div><div class="tnai-acct-meta"><span class="agent-status-pill ${signedIn[0]}"><i></i><span>${signedIn[1]}</span></span></div>${more ? `<div class="tnai-acct-note">${more}</div>` : ''}</div>`) +
      (adding || keying || entry.supported || entry.apiKey
        ? '<div class="ac-adds">' +
          (adding
            ? addRow(entry)
            : entry.supported
              ? ghost('add', 'Add account', 'Another email or plan')
              : '') +
          (keying
            ? keyRow(entry)
            : entry.apiKey
              ? ghost('addkey', 'Add an API key', 'Pay per use')
              : '') +
          '</div>'
        : '');
    return `<article class="tnai-cli ac-tool" role="listitem" data-cli="${esc(entry.agentId)}" data-tone="${signedIn[0]}">
<div class="tnai-cli-head ac-id">${avatar}<div class="tnai-cli-identity"><b>${esc(entry.agentId)}</b><small title="${esc(tip)}">${esc(where)}</small></div>
<div class="ac-id-state">${entry.supported ? `<span class="agent-status-pill ready"><i></i><span>${count}</span></span>` : `<span class="agent-status-pill ${signedIn[0]}"><i></i><span>${signedIn[1]}</span></span>`}</div>
<span class="tnai-acct-tools">${!entry.supported && info?.loggedIn === false ? '<button type="button" class="primary" data-acct="signin">Sign in</button>' : ''}${!entry.supported && info?.loggedIn === true && entry.signIn?.switchCommand ? '<button type="button" data-acct="switch">Switch account</button>' : ''}<button type="button" data-acct="start">Start session</button></span></div>
<div class="tnai-acct-list ac-accts" role="list" aria-label="${esc(entry.agentId)} accounts">${tiles}</div></article>`;
  }
  const KEY_IC =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.2" cy="10.8" r="2.7"/><path d="m7.2 8.8 6-6M11.2 4.8l1.6 1.6M9.6 6.4l1.4 1.4"/></svg>';

  // Expanded "More about …" notes stay open when the card is rebuilt (toggle does not bubble, so
  // listen in capture).
  const openNotes = new Set();
  document.addEventListener(
    'toggle',
    event => {
      const note = event.target.closest?.('#tnaiAccountsMount details[data-note]');
      if (!note) return;
      note.open ? openNotes.add(note.dataset.note) : openNotes.delete(note.dataset.note);
    },
    true
  );

  // How a missing CLI is installed and whether Node.js is there (main `agents:install`); asked for
  // when the first not-installed tile is drawn.
  let install = null,
    installAsked = false;
  const loadInstall = async () => {
    installAsked = true;
    try {
      const r = await native.agents?.install?.();
      if (r?.tools) {
        install = r;
        render();
      }
    } catch {}
  };

  function mountEl() {
    return document.getElementById('tnaiAccountsMount');
  }

  // Called on every session change (a pane turning Working / Waiting too): the markup is rebuilt
  // only when it differs.
  let renderedHtml = '';

  function render() {
    const mount = mountEl();
    if (!mount) return;
    const info = new Map((agentsApi()?.info() || []).map(a => [a.id, a]));
    const total = data.filter(d => d.supported).reduce((n, d) => n + d.accounts.length, 0);
    const isIn = entry => {
      const i = info.get(entry.agentId);
      return i ? i.installed : true;
    };
    const present = data.filter(isIn),
      missing = data.filter(e => !isIn(e));
    if (missing.length && !installAsked) loadInstall();
    const signedIn = present.filter(
      e => info.get(e.agentId)?.loggedIn === true || e.accounts?.some(a => a.status?.loggedIn)
    ).length;
    const pc = window.tnaiPlatform.win ? 'PC' : 'computer';

    // Head: a one-line promise + three counts (tools, accounts, signed in) and Check again; then
    // one card per installed tool, then the not-installed strip.
    const html = `<header class="tnai-acct-head ac-head"><div class="ac-head-tx"><small>Add every account you use and switch when one runs out. Each tool signs in through its provider’s own page in your browser, so Technically Not never sees passwords or sign-in tokens. API keys stay encrypted on this ${pc}.</small></div>
<div class="ac-stats" aria-live="polite"><span><b>${present.length}</b>tool${present.length === 1 ? '' : 's'}</span><span><b>${total}</b>account${total === 1 ? '' : 's'}</span><span><b>${signedIn}</b>signed in</span></div><span class="tnai-acct-head-actions"><span>${loading ? 'Checking…' : ''}</span><button type="button" data-acct="refresh"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.2 2.4v3.2H10"/></svg>Check again</button></span></header>
<div class="tnai-acct-grid ac-tools" role="list">${data.length ? present.map(entry => cliCard(entry, info.get(entry.agentId))).join('') : '<p class="tnai-acct-note ac-loading">Checking accounts…</p>'}</div>
${missing.length ? `<section class="ac-missing" aria-label="Not installed"><h3>Not installed <small>Install one and it shows up here with its accounts.</small></h3><div class="ac-missing-list" role="list">${missing.map(entry => cliCard(entry, info.get(entry.agentId))).join('')}</div></section>` : ''}`;
    if (html === renderedHtml && mount.firstChild) {
      paintGauges();
      return;
    }
    renderedHtml = html;

    // Text being typed in an inline row (account name, API key) and a shown key error survive the
    // rebuild.
    const kept = ['tnaiAcctAddName', 'tnaiAcctKey']
      .map(id => mount.querySelector('#' + id))
      .filter(Boolean)
      .map(el => ({
        id: el.id,
        value: el.value,
        focused: document.activeElement === el,
        start: el.selectionStart,
        end: el.selectionEnd,
      }));
    const error = mount.querySelector('.tnai-acct-keyerror:not([hidden])')?.textContent || '';
    mount.innerHTML = html;
    for (const k of kept) {
      const input = mount.querySelector('#' + k.id);
      if (!input) continue;
      input.value = k.value;
      if (k.focused) {
        input.focus({ preventScroll: true });
        try {
          input.setSelectionRange(k.start, k.end);
        } catch {}
      }
    }
    const errorEl = error && mount.querySelector('.tnai-acct-keyerror');
    if (errorEl) {
      errorEl.textContent = error;
      errorEl.hidden = false;
    }
    paintGauges();
    tickGauges();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#tnaiAccountsMount button[data-acct]');
    if (!button) return;
    const act = button.dataset.acct,
      agentId = button.closest('[data-cli]')?.dataset.cli,
      accountId = button.closest('[data-account]')?.dataset.account || '';

    // Check again: the PATH is read fresh first (loadInstall, main `installInfo`), so a CLI
    // installed a minute ago is found.
    if (act === 'refresh') {
      refresh(true, true);
      loadInstall().then(() => agentsApi()?.detect?.(true));
      render();
    }
    if (act === 'install') {
      const how = install?.tools?.[agentId],
        needNode = !!how?.needsNode && !install.node,
        cmd = needNode ? install.nodeCommand : how?.command;
      if (cmd && window.TnaiPowerShellLink?.run) {
        window.TnaiPowerShellLink.run(cmd);
        say(
          (needNode ? 'Installing Node.js' : 'Installing ' + agentId) +
            ' in a PowerShell thread. When it finishes, press Check again on Usage & accounts' +
            (needNode ? ', then Install.' : '.')
        );
      }
    }
    if (act === 'use')
      setActive(agentId, accountId).then(
        ok => ok && say('New ' + agentId + ' sessions use ' + label(agentId, accountId))
      );
    if (act === 'add') {
      keyFor = null;
      openAddRow(agentId);
    }
    if (act === 'addkey') openKeyRow(agentId, '');
    if (act === 'rekey') openKeyRow(agentId, accountId);
    if (act === 'key-cancel') closeKeyRow(true);
    if (act === 'add-cancel') closeAddRow(true);
    if (act === 'rename') rename(agentId, accountId);

    // Remove asks inside the card (no browser confirm box, matching the Skills page): the action
    // row turns into a short question.
    if (act === 'remove') {
      const row = button.closest('.tnai-acct-actions');
      if (!row) {
        remove(agentId, accountId);
        return;
      }
      const q = document.createElement('div');
      q.className = 'tnai-acct-confirm';
      q.setAttribute('role', 'alertdialog');
      q.innerHTML =
        '<span>Remove “' +
        esc(label(agentId, accountId, true)) +
        '”? Its sign-in folder is deleted; shared conversations stay.</span><button type="button" class="danger" data-acct="remove-yes">Remove</button><button type="button" data-acct="remove-no">Keep</button>';
      row.replaceChildren(q);
      q.querySelector('[data-acct="remove-no"]').focus();
    }
    if (act === 'remove-yes') remove(agentId, accountId, { confirm: false });
    if (act === 'remove-no') render();
    if (act === 'signin') openSignIn(agentId, { accountId });
    if (act === 'switch') openSignIn(agentId, { switching: true });
    if (act === 'start') {
      if (agentsApi()?.open)
        agentsApi().open(agentId, {
          accountId: accountId || cli(agentId)?.active || '',
          mode: 'run',
        });
      else say('Start a thread with ' + agentId + ' to start it.');
    }
  });
  document.addEventListener('click', event => {
    const chip = event.target.closest('#tnaiAccountsMount [data-acct-name]');
    if (!chip) return;
    const input = document.getElementById('tnaiAcctAddName');
    if (input) {
      input.value = chip.dataset.acctName;
      input.focus();
    }
  });
  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && event.target.closest?.('.tnai-acct-addrow')) {
        event.stopPropagation();
        event.target.closest('[data-acct-keyform]') ? closeKeyRow(true) : closeAddRow(true);
      }
    },
    true
  );
  document.addEventListener('submit', async event => {
    const form = event.target.closest?.('#tnaiAccountsMount form[data-acct-keyform]');
    if (!form) return;
    event.preventDefault();
    const target = keyFor,
      key = form.elements.key.value.trim();
    if (!target) return;
    const fail = message => {
      const el = mountEl()?.querySelector('.tnai-acct-keyerror');
      if (el) {
        el.textContent = message;
        el.hidden = false;
      }
      mountEl()?.querySelector('#tnaiAcctKey')?.focus();
    };
    if (!key) {
      fail('Paste your API key first.');
      return;
    }
    form.querySelectorAll('button,input').forEach(el => {
      el.disabled = true;
    });
    const result = target.accountId
      ? await native.accounts.setKey(target.agentId, target.accountId, key)
      : await native.accounts.addKey(target.agentId, '', key);
    mountEl()
      ?.querySelectorAll('[data-acct-keyform] button,[data-acct-keyform] input')
      .forEach(el => {
        el.disabled = false;
      });
    if (!result.ok) {
      fail(result.error.message);
      return;
    }
    const field = mountEl()?.querySelector('#tnaiAcctKey');
    if (field) field.value = '';
    keyFor = null;
    await reload();
    say(
      target.accountId
        ? target.agentId + ' API key replaced'
        : target.agentId +
            ' API key added · choose “Use for new sessions” on it, or switch to it when a plan runs out'
    );
  });
  document.addEventListener('submit', event => {
    const form = event.target.closest?.('#tnaiAccountsMount form[data-acct-form]');
    if (!form) return;
    event.preventDefault();
    const agentId = addingFor,
      name = form.elements.label.value.trim();
    if (!agentId) return;
    closeAddRow(false);
    if (cli(agentId)?.signIn) openSignIn(agentId, { adding: true, label: name });
    else add(agentId, { label: name });
  });

  // Sign-in state changes when a login pane finishes; recheck accounts then.
  let loginPanes = new Set();

  function watchSessions() {
    const sessions = agentsApi()?.sessions() || [],
      now = new Set(sessions.filter(s => s.mode === 'login' && s.running).map(s => s.paneId));
    const ended = [...loginPanes].filter(id => !now.has(id));
    if (ended.length) setTimeout(() => afterLogin(ended), 500);
    loginPanes = now;
    clearStale();
  }
  const hook = () => {
    if (agentsApi()?.onChange) {
      agentsApi().onChange(watchSessions);
      agentsApi().onChange(render);
    }
  };

  // The mount is created by the Settings page (22, loaded later); render as soon as it appears.
  if (!mountEl()) {
    const observer = new MutationObserver(() => {
      if (mountEl()) {
        observer.disconnect();
        render();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.TnaiAccounts = {
    list: () => data,
    refresh: force => refresh(true, !!force),
    activeFor: agentId => cli(agentId)?.active || '',
    setActive,
    label,
    add,
    remove,
    rename,
    switchPane,
    limitFor,
    clearLimit,
    isLimitText: text => !!limitMatch(String(text || '').replace(ANSI, ' ')),
    openSignIn,
    identities,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // 80: each account's plan limit gauges (gaugeSlot in cliCard, painted by 98)
  window.addEventListener('tnai:plan-limits', () => render());
  hook();
  reload();
})();
