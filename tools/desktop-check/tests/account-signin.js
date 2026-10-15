/*
 * Technically Not tools · desktop-check/tests/account-signin.js — The Technically Not account end
 * to end against the TEST-ONLY fake accounts server and fake Google in account-signin.main.js. The
 * app has no plan lock, so nothing is ever refused for a plan: signed out, with plan none or with
 * no valid pass a terminal panel starts and files, git, skills and pop-outs work. Google sign-in
 * (PKCE + loopback → /auth/exchange) → signed Pro pass kept, token/pass encrypted on disk, the
 * account menu holds only the account and Sign out; email + password (wrong password, authenticator
 * code); pass signed with another key → ignored; pass expired while offline → not current by
 * itself; clock that only moves forward (exp checked on the high-water mark, server Date ahead
 * raises it, a fresh pass recovers); the app sends its version and names an update when the server
 * asks for one; release flag ignores dev overrides; Sign in with GitHub (denied, linked by verified
 * email, no verified email, GitHub unreachable, no client ID); computers (device_id kept in
 * tnai-device.json across restart and sign-out, sent on every sign-in route; 4th computer → list in
 * the dialog, Cancel, expired ticket, Sign out and continue → /auth/device-replace → signed in).
 * PowerShell panels only (agent 'Terminal'), no agent CLI, no prompt, no real network. Returns {ok,
 * log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const A = window.TnaiAuth,
  pty = window.tnaiNative.pty;
const st = () => A.state();
const dialog = () => document.querySelector('.tnai-auth-overlay');
let n = 0;

// What a plan lock used to refuse, called straight through the bridge: files, git, skills, app
// info, update and account state, and a pop-out window. With no plan lock all of it answers.
const N = window.tnaiNative;
const capabilities = async () => {
  const [list, read, git, skills, info, upd, auth] = await Promise.all([
    N.fs.list(''),
    N.fs.read('README.md'),
    N.git.status(),
    N.skills.list(),
    N.info(),
    N.update.state(),
    N.auth.state(),
  ]);
  const pop = window.open('about:blank', 'tnai-panel-account-probe');
  const popped = !!pop;
  try {
    pop?.close();
  } catch {}
  return { list, read, git, skills, info, upd, auth, popped };
};
const allWork = g => g.list?.ok && g.read?.ok && g.git?.ok && g.skills?.ok && g.popped;
const tryStart = async () => {
  const id = 'account-signin-' + Date.now() + '-' + ++n;
  const r = await pty.start({ paneId: id, agent: 'Terminal', mode: 'run', cols: 80, rows: 24 });
  if (r?.ok) {
    await pty.stop(id).catch(() => {});
    await pty.forget(id).catch(() => {});
  }
  return r || {};
};

check(!!A && !!window.tnaiNative.auth, 'window.TnaiAuth and the native auth bridge exist');
await main('ready');
await A.ready();

// 1. Signed out: no plan lock anywhere, everything works.
check(
  st().available && !('lock' in st()) && !document.querySelector('.tnai-lock-overlay'),
  'signed out: the state has no lock and the page has no lock screen'
);
let r = await tryStart();
check(r.ok, 'signed out: a terminal panel starts');
let g = await capabilities();
check(
  allWork(g) && !!g.info?.version && g.auth?.ok && g.upd,
  'signed out: fs:list, fs:read, git:status, skills:list, a pop-out, app info, account and update state all answer'
);

// 2. The sign-in dialog.
A.open();
await wait(120);
check(
  !!dialog() &&
    !dialog().hidden &&
    /Continue with Google/.test(dialog().textContent) &&
    !!dialog().querySelector('input[name=email]') &&
    !!dialog().querySelector('input[name=password]'),
  'the dialog opens: Google + email and password'
);
const browsers = (await window.tnaiNative.auth.browsers())?.value || [];
check(
  browsers.length > 1
    ? !!(await until(
        () =>
          dialog()?.querySelectorAll('[data-auth-browser] option').length === browsers.length + 1
      ))
    : !dialog().querySelector('[data-auth-browser]'),
  'browser choice: ' +
    browsers.length +
    ' installed browsers listed (plus Default browser) only when there is a choice'
);
await shot('account-signin-dialog');

// 3. Sign in with Google → Pro pass kept; the account menu has no plan and no subscription.
await main('set', { plan: 'pro', key: 'good', expIn: 7 * 86400, online: true });
await main('googlePlan', {
  action: 'approve',
  user: { sub: 'g-ada-100', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace' },
});
const signing = A.signIn('google');
check(
  !!(await until(() => dialog()?.querySelector('[data-view=waiting]'))),
  'waiting-for-browser view shown'
);
check(!!dialog()?.querySelector('[data-auth-act=copy]'), 'waiting view offers Copy sign-in link');
let res = await signing;
check(
  res?.status === 'signed-in',
  'Google sign-in finished (' + JSON.stringify(res?.error || res?.status) + ')'
);
const authorize = new URL(
  (await main('browsed')).find(u => /\/google\/authorize/.test(u)) || 'http://x'
);
check(
  authorize.searchParams.get('code_challenge_method') === 'S256' &&
    /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(
      authorize.searchParams.get('redirect_uri') || ''
    ) &&
    (authorize.searchParams.get('nonce') || '').length >= 32,
  'Google: PKCE S256, nonce, 127.0.0.1 loopback redirect'
);
check(
  /close this tab/i.test((await until(() => main('lastBrowse')))?.text || ''),
  'browser got the “return to Technically Not” page'
);
check(
  !!(await until(() => st().plan?.plan === 'pro')) &&
    st().plan.status === 'active' &&
    st().plan.subscribed &&
    st().plan.current &&
    !('daysLeft' in st().plan),
  'plan pass: Pro, subscribed, no trial fields (' + JSON.stringify(st().plan) + ')'
);
check(st().user?.name === 'Ada Lovelace' && dialog().hidden, 'signed in as Ada, dialog closed');
check(!/apptok-|EdDSA/.test(JSON.stringify(st())), 'renderer state carries no token or pass');
let disk = await main('inspect');
check(disk.file && !disk.plain, 'account token + pass stored encrypted (safeStorage)');
document.querySelector('#tnaiUser [data-auth=menu]').click();
await wait(80);
const menu = document.querySelector('#tnaiUser .tnai-user-menu');
check(
  !!menu &&
    !menu.hidden &&
    !menu.querySelector('[data-plan]') &&
    !/Subscribe|subscription|Update card|Plan/.test(menu.textContent) &&
    /Sign out/.test(menu.textContent),
  'account menu: the account and Sign out, no plan line and no subscription buttons (' +
    menu?.textContent.replace(/\s+/g, ' ').trim() +
    ')'
);
await shot('account-signin-menu');
document.body.click();
await wait(50);

// 4. Plan none: nothing is refused.
await main('set', { plan: 'none' });
await A.check();
check(st().plan?.plan === 'none', 'plan none: the pass says so');
r = await tryStart();
g = await capabilities();
check(r.ok && allWork(g), 'plan none: a terminal panel starts and everything answers');
await main('set', { plan: 'pro' });

// 5. Sign out; email sign-in; a pass signed with another key is never trusted.
let out = await A.signOut();
check(out?.status === 'signed-out' && out.revoked && !st().signedIn, 'sign out: server told');
check(!(await main('inspect')).file, 'sign out: account file removed');
await main('set', { key: 'rogue', plan: 'pro' });
res = await A.signInEmail({ email: 'bob@example.com', password: 'wrong' });
check(
  res?.status === 'error' &&
    /don’t match/.test(res.error?.message || '') &&
    /don’t match/.test(dialog()?.textContent || ''),
  'wrong password: error shown in the dialog'
);
res = await A.signInEmail({ email: 'totp@example.com', password: 'right-password' });
check(
  res?.error?.code === 'totp-required' && !!dialog()?.querySelector('input[name=totp]'),
  'account with an authenticator: code field appears'
);
res = await A.signInEmail({
  email: 'totp@example.com',
  password: 'right-password',
  totp: '123456',
});
check(res?.status === 'signed-in' && st().signedIn, 'email + password + code: signed in');
check(
  !st().plan && /couldn’t verify/.test(st().problem),
  'pass signed with another key: ignored (' + st().problem + ')'
);
r = await tryStart();
check(r.ok, 'no valid pass: a terminal panel still starts');

// 6. A pass that expires while offline is no longer current, by itself (one expiry timer, no
// polling).
await main('set', { key: 'good', plan: 'pro', expIn: 3 });
await A.check();
check(st().plan?.current === true, 'short pass: current while valid');
await main('set', { online: false });
check(
  !!(await until(() => st().plan && st().plan.current === false, 9000)),
  'pass reached its exp: not current by itself'
);
await A.check();
check(/Offline/.test(st().problem), 'a check while offline says offline');
await main('restart');
await A.ready();
check(
  st().signedIn && st().plan?.current === false,
  'after a restart (read back from disk): still signed in, pass still not current'
);

// 7. A clock that only moves forward: the high-water mark (max of now, pass iat, server time) is
// kept encrypted with the pass.
await main('set', { online: true, expIn: 7 * 86400, plan: 'pro', key: 'good', skewMs: 0 });
await A.check();
let hw = await main('highWater');
check(
  st().plan?.current && Math.abs(hw - Date.now()) < 60e3,
  'back online with Pro: current, high-water mark ≈ now (' + (hw - Date.now()) + ' ms)'
);
await main('set', { expIn: 300 });
await wait(1100);
await A.check();
check(st().plan?.current, '5-minute pass: current');
await main('setHighWater', Date.now() + 9 * 60e3);
await A.ready();
check(
  st().plan?.current === false,
  'the high-water mark past the pass exp: the pass is not current, whatever the PC clock says'
);
await main('restart');
await A.ready();
check(st().plan?.current === false, 'after a restart: the high-water mark was read back from disk');
await main('set', { expIn: 7 * 86400 });
await wait(1100);
await A.check();
hw = await main('highWater');
check(
  st().plan?.current && Math.abs(hw - Date.now()) < 60e3,
  'reconnect: a fresh pass restarts the high-water mark from the server time, current again'
);
await main('set', { skewMs: 2 * 3600e3 });
await wait(1100);
await A.check();
hw = await main('highWater');
check(
  hw > Date.now() + 2 * 3600e3 - 60e3,
  'server time (Date header + pass iat) 2 h ahead of the PC: the high-water mark follows it'
);
await main('set', { skewMs: 0 });
await main('setHighWater', Date.now());
await A.ready();

// 7b. Server minimum app version (MIN_APP_VERSION): the account names an update as required;
// nothing is refused.
await main('set', { minVersion: '' });
await A.check();
const sentV = await main('lastVersion');
check(
  sentV.sent && sentV.sent === sentV.app,
  'the app sends its version (X-TNAI-Version ' + sentV.sent + ')'
);
await main('set', { minVersion: '99.0.0' });
await A.check();
check(
  /no longer supported/.test(st().problem),
  'server floor above this build: the account says an update is needed (' + st().problem + ')'
);
r = await tryStart();
check(r.ok, 'update required: a terminal panel still starts');
await main('set', { minVersion: '' });
await A.check();
check(!/no longer supported/.test(st().problem), 'floor lowered again: the message goes');

// 8. A release build ignores every developer override.
const rel = await main('releaseSnapshot');
check(
  !rel.testKey && !rel.insecureOk && rel.apiUrl === rel.pkgUrl && rel.off === (rel.pkgUrl === ''),
  'release flag (build-info.json) while not packaged: TNAI_ACCOUNTS_URL, TNAI_PASS_TEST_KEY and test endpoints ignored (' +
    JSON.stringify(rel) +
    ')'
);
await A.signOut();

// 9. Sign in with GitHub: denied, linked by a verified primary email, no verified email (own
// account + notice), GitHub unreachable, not configured.
await main('set', { plan: 'pro', key: 'good', expIn: 7 * 86400, online: true });
A.open();
await wait(80);
const ghBtn = () => dialog()?.querySelector('.tnai-auth-provider[data-provider=github]');
check(
  !!ghBtn() &&
    !ghBtn().disabled &&
    /Continue with GitHub/.test(ghBtn().textContent) &&
    getComputedStyle(ghBtn()).borderTopColor ===
      getComputedStyle(dialog().querySelector('[data-provider=google]')).borderTopColor,
  'dialog: Continue with GitHub, enabled, same button style as Google'
);
await shot('account-signin-github-button');
await main('githubPlan', { action: 'ignore' });
let gh = A.signIn('github');
check(
  !!(await until(() =>
    /Waiting for GitHub/.test(dialog()?.querySelector('[data-view=waiting]')?.textContent || '')
  )),
  'waiting view names GitHub'
);
A.cancel();
res = await gh;
check(
  res?.status === 'cancelled' && res.reason === 'cancelled' && !st().signedIn && !st().flow,
  'Cancel while waiting for GitHub: nothing changed'
);
await main('githubPlan', { action: 'deny' });
res = await A.signIn('github');
check(
  res?.status === 'cancelled' &&
    res.reason === 'denied' &&
    /GitHub sign-in was cancelled/.test(dialog()?.textContent || '') &&
    !st().signedIn,
  'GitHub denied: cancelled, nothing changed (' + JSON.stringify(res) + ')'
);
check(
  !!(await until(async () => /cancelled/i.test((await main('lastBrowse'))?.text || ''))),
  'denied: browser got the “sign-in cancelled” page'
);
await main('githubPlan', {
  action: 'approve',
  user: { id: 90210, login: 'bob-gh', name: 'Bob GitHub' },
  emails: [
    { email: 'bob@work.example', primary: false, verified: true },
    { email: 'bob@example.com', primary: true, verified: true },
  ],
});
res = await A.signIn('github');
check(
  res?.status === 'signed-in' &&
    st().signedIn &&
    st().user.email === 'bob@example.com' &&
    st().user.providers.join() === 'password,github',
  'GitHub approved: signed in, joined to the email account by the verified primary email (' +
    JSON.stringify(st().user) +
    ')'
);
const ghAuthorize = new URL(
  (await main('browsed')).filter(u => /\/github\/login\/oauth\/authorize/.test(u)).at(-1) ||
    'http://x'
);
check(
  ghAuthorize.searchParams.get('scope') === 'read:user user:email' &&
    ghAuthorize.searchParams.get('code_challenge_method') === 'S256' &&
    /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(
      ghAuthorize.searchParams.get('redirect_uri') || ''
    ) &&
    (ghAuthorize.searchParams.get('state') || '').length >= 32,
  'GitHub: scope read:user user:email, PKCE S256, state, loopback redirect'
);
const ghSent = (await main('githubBodies')).at(-1);
check(
  ghSent &&
    !ghSent.secret &&
    ghSent.verifier >= 43 &&
    ghSent.keys.join() ===
      'app_version,client,code,code_verifier,device_id,device_name,provider,redirect_uri',
  'app sent only code + verifier + redirect to /auth/exchange, never a secret or GitHub token (' +
    JSON.stringify(ghSent) +
    ')'
);
check(!(await main('inspect')).plain, 'GitHub sign-in: app token + pass stored encrypted');
await A.signOut();
await main('githubPlan', {
  action: 'approve',
  user: { id: 31337, login: 'nomail' },
  emails: [{ email: 'bob@example.com', primary: true, verified: false }],
});
res = await A.signIn('github');
check(
  res?.status === 'signed-in' &&
    st().user.providers.join() === 'github' &&
    st().user.id === 'u_gh_31337' &&
    /no verified primary email/.test(res.notice || ''),
  'GitHub without a verified email: own account, not linked, told why'
);
await A.signOut();
await main('set', { githubDown: true });
await main('githubPlan', { action: 'approve', user: { id: 1, login: 'x' }, emails: [] });
res = await A.signIn('github');
await main('set', { githubDown: false });
check(
  res?.status === 'error' &&
    /couldn’t reach GitHub/.test(res.error?.message || '') &&
    /couldn’t reach GitHub/.test(dialog()?.textContent || ''),
  'GitHub unreachable from the server: plain error in the dialog'
);
await main('githubClient', false);
await A.ready();
A.open();
await wait(80);
check(
  ghBtn()?.disabled &&
    /GitHub sign-in isn’t set up/.test(
      dialog().querySelector('[data-unavailable=github]')?.textContent || ''
    ) &&
    !dialog().querySelector('[data-provider=google]').disabled,
  'no GitHub client ID: GitHub button disabled with a note, Google still works'
);
await main('githubClient', true);
dialog().querySelector('[data-auth-act=close]')?.click();

// 10. Computers: one device_id per install (tnai-device.json, kept across restarts and sign-out) on
// every sign-in route; over the 3-computer limit the dialog lists the account's computers, and Sign
// out and continue → /auth/device-replace → signed in. An expired ticket goes back to the choices.
const devFile = await main('deviceFile');
check(
  devFile.file && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(devFile.id),
  'device_id made once, kept in tnai-device.json (' + devFile.id + ')'
);
await main('restart');
await A.ready();
check((await main('deviceFile')).id === devFile.id, 'device_id unchanged after a restart');
const now = Math.floor(Date.now() / 1000),
  cara = { email: 'cara@example.com', password: 'right-password' };
await main('seedDevices', cara.email, [
  { id: 'dev-old', name: 'OLD-DESKTOP · Windows', last_seen: now - 40 * 86400 },
  { id: 'dev-laptop', name: 'Laptop · Linux', last_seen: now - 2 * 86400 },
  { id: 'dev-work', name: 'WORK-PC · Windows', last_seen: now - 3 * 3600 },
]);
A.open();
await wait(80);
res = await A.signInEmail(cara);
let rows = [...(dialog()?.querySelectorAll('.tnai-auth-devices li') || [])];
check(
  res?.status === 'device-limit' && !st().signedIn && res.limit === 3,
  '4th computer: no session, the computer list comes back (' +
    JSON.stringify(res?.status || res?.error) +
    ')'
);
check(
  /This account is already signed in on 3 computers\. Sign out one to use it here:/.test(
    dialog()?.textContent || ''
  ) &&
    rows.length === 3 &&
    /OLD-DESKTOP/.test(rows[0].textContent) &&
    rows.every(
      li => /last used/.test(li.textContent) && /Sign out and continue/.test(li.textContent)
    ),
  'dialog lists the 3 computers (oldest first) with “last used” and Sign out and continue (' +
    rows.map(li => li.textContent.replace(/\s+/g, ' ').trim()).join(' | ') +
    ')'
);
check(
  document.activeElement === rows[0]?.querySelector('[data-auth-act=replace]') &&
    /OLD-DESKTOP/.test(document.activeElement.getAttribute('aria-label') || ''),
  'keyboard: focus on the first Sign out and continue, named by its computer'
);
check(
  !/dt-/.test(JSON.stringify(st()) + dialog().innerHTML),
  'the one-time ticket never reaches the renderer'
);
await shot('account-signin-device-limit');
dialog().querySelector('[data-auth-act=back]').click();
await wait(80);
check(
  !!dialog()?.querySelector('input[name=email]') &&
    !dialog().querySelector('.tnai-auth-devices') &&
    !dialog().hidden &&
    !st().signedIn,
  'Cancel: back to the sign-in choices'
);
r = await window.tnaiNative.auth.replaceDevice('dev-old');
check(!r.ok && r.error?.code === 'invalid-ticket', 'after Cancel the ticket is dropped');
res = await A.signInEmail(cara);
await main('expireTickets');
dialog().querySelector('[data-auth-act=replace][data-device=dev-old]').click();
check(
  !!(await until(
    () =>
      /That took too long\. Sign in again\./.test(dialog()?.textContent || '') &&
      dialog().querySelector('input[name=email]')
  )),
  'expired ticket: “That took too long. Sign in again.” and back to the choices'
);
check(
  !st().signedIn && (await main('devicesOf', cara.email)).length === 3,
  'expired ticket: nothing changed'
);
res = await A.signInEmail(cara);
check(res?.status === 'device-limit', 'signed in again: the list is back');
dialog().querySelector('[data-auth-act=replace][data-device=dev-laptop]').click();
check(
  !!(await until(() => st().signedIn && dialog().hidden)),
  'Sign out and continue: signed in, dialog closed'
);
let ids = (await main('devicesOf', cara.email)).map(d => d.id);
check(
  ids.length === 3 && ids.includes(devFile.id) && !ids.includes('dev-laptop'),
  'the picked computer was signed out and this one took its place (' + ids.join() + ')'
);
const rb = (await main('replaceBodies')).at(-1);
check(
  rb?.keys.join() === 'app_version,device_id,device_name,device_ticket,replace_device' &&
    rb.device_id === devFile.id &&
    rb.replace_device === 'dev-laptop',
  'device-replace sent the ticket, the picked computer and this device (' + JSON.stringify(rb) + ')'
);
check(
  !!(await until(() => st().plan?.plan === 'pro')) && !(await main('inspect')).plain,
  'after device-replace: plan fetched, token stored encrypted, like a normal sign-in'
);
await A.signOut();
check((await main('deviceFile')).id === devFile.id, 'sign out keeps tnai-device.json');
const sent = await main('signIns');
check(
  sent.length >= 7 &&
    sent.every(
      x =>
        x.device_id === devFile.id &&
        / · (Windows|Linux|macOS)$/.test(x.device_name || '') &&
        x.device_name.length <= 100
    ) &&
    ['POST /auth/exchange', 'POST /auth/login'].every(rt => sent.some(x => x.route === rt)),
  'every sign-in (Google, GitHub, email; before and after restarts and sign-outs) sent the same device_id + a readable device_name (' +
    sent.length +
    ' sign-ins, ' +
    JSON.stringify(sent[0]?.device_name) +
    ')'
);

// Google on an account with an authenticator app: code step, a wrong code keeps
// it, the right one or a recovery code signs in.
const totpGoogle = () =>
  main('googlePlan', {
    action: 'approve',
    user: { sub: 'g-totp-1', email: 'totp@example.com', email_verified: true, name: 'Tia Totp' },
  }); // one answer per plan
await totpGoogle();
const codeForm = () => dialog()?.querySelector('[data-auth-code]');
res = await A.signIn('google');
check(
  res?.status === 'totp-required' && !st().signedIn && !!codeForm(),
  'Google on a 2FA account: no session, the code step shows (' +
    JSON.stringify(res?.status || res?.error) +
    ')'
);
await shot('account-signin-totp-step');
codeForm().code.value = '000000';
codeForm().requestSubmit();
check(
  !!(await until(
    () =>
      codeForm() &&
      /isn’t right/.test(dialog().querySelector('.tnai-auth-status')?.textContent || '')
  )),
  'wrong code: stays on the code step with the error'
);
check(!st().signedIn, 'wrong code: still signed out');
codeForm().code.value = '123456';
codeForm().requestSubmit();
check(
  !!(await until(() => st().signedIn && dialog().hidden)),
  'right code: signed in, dialog closed'
);
const vb = (await main('totpBodies')).at(-1);
check(
  vb?.keys.join() === 'app_version,client,device_id,device_name,totp,totp_ticket',
  'verify sent the ticket, the code and the device (' + vb?.keys + ')'
);
await A.signOut();
await totpGoogle();
res = await A.signIn('google');
dialog().querySelector('[data-auth-act=back]').click();
check(!!(await until(() => !codeForm())), 'Cancel on the code step: back to the sign-in choices');
await totpGoogle();
res = await A.signIn('google');
codeForm().code.value = 'abcde-fghij';
codeForm().requestSubmit();
check(!!(await until(() => st().signedIn)), 'a recovery code signs in too');
await A.signOut();

// The run stayed quiet: every sign-in above made the app ask for the keyboard, and none of it
// reached Windows; the pop-outs of steps 1 and 4 were made hidden (quiet-window.js, set up in
// account-signin.main.js).
const quiet = await main('quiet');
check(
  quiet.asked.focus > 0 && !quiet.active && !quiet.focusable && !quiet.onMain,
  'quiet run: the app asked for the keyboard and no window took it or lay on the main monitor (' +
    JSON.stringify(quiet) +
    ')'
);
check(quiet.popouts === 'hidden', 'quiet run: pop-outs are made hidden (' + quiet.popouts + ')');
await main('close');
return { ok, log };
