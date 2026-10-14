// Technically Not tools · desktop-check/tests/app-updates.js — Automatic updates: unconfigured by
// default (Check and the choices disabled, no notice), then against a local feed: offers 9.9.9
// build 99 (a bell notice with version and build, the bell count purple; turning "Notify me" off
// removes it; no top-bar pill), the offer dialog with notes and Later / Update now, downloads and
// verifies it with nobody signed in and no Authorization header sent, "is ready · Restart to
// update" and Settings › Updates. Also the GitHub notes-page, releases-page and build-number
// conventions. Never installs.
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
const U = window.TnaiUpdates,
  bellCount = () => document.querySelector('.tnai-bell .n-count');

// The update's bell row (opens the bell to read it, closes it again, which marks it read).
const bellRow = () => {
  const B = window.TnaiNextActions;
  B.openBell(true);
  const row = [...document.querySelectorAll('.tnai-bell-pop .tnai-nitem')].find(n =>
    /^Technically Not \d/.test(n.querySelector('.n-who b')?.textContent || '')
  );
  const t = row?.querySelector('.n-who b').textContent || '';
  B.openBell(false);
  return t;
};

// The same row's description and button, shown without expanding it (update notices are always
// open, no dialog).
const bellBody = () => {
  const B = window.TnaiNextActions;
  B.openBell(true);
  const row = [...document.querySelectorAll('.tnai-bell-pop .tnai-nitem')].find(n =>
    /^Technically Not \d/.test(n.querySelector('.n-who b')?.textContent || '')
  );
  const t =
    (row?.querySelector('.n-ask')?.textContent || '') +
    ' | ' +
    (row?.querySelector('.n-b')?.textContent || '');
  B.openBell(false);
  return t;
};
try {
  check(
    U && U.state().status === 'unconfigured',
    'no feed configured → "unconfigured" (' + U?.state().status + ')'
  );
  window.TnaiSettings.open('updates');
  await wait(200);
  const mount = document.getElementById('tnaiUpdatesMount');
  const pref = key => mount.querySelector('[data-update-pref="' + key + '"]');
  check(
    !!mount &&
      mount.querySelector('[data-update="check"]').disabled &&
      /not set up/.test(mount.textContent),
    'Settings › Updates: Check disabled with an explanation'
  );
  check(
    ['autoCheck', 'notify', 'autoDownload'].every(k => pref(k)?.disabled),
    'Settings › Updates: the three choices are shown, disabled while updates are not set up'
  );
  check(
    !!mount.querySelector('a[data-update="notices"]') &&
      typeof window.tnaiNative.openNotices === 'function',
    'Settings › Updates: quiet Open-source notices link (not clicked: it opens the text viewer)'
  );
  check(
    !document.querySelector('.tnai-update-pill') && !bellRow(),
    'no top-bar pill; no bell notice while nothing is offered'
  );

  await main('start');
  const offered = await until(() => U.state().status === 'available' && U.state());
  check(
    !!offered && offered.next === '9.9.9' && offered.nextBuild === 99,
    'update 9.9.9 build 99 offered, nothing downloaded yet: ' +
      JSON.stringify(U.state()).slice(0, 140)
  );
  await wait(50);
  check(
    bellCount().dataset.k === 'update' &&
      !bellCount().hidden &&
      getComputedStyle(bellCount()).backgroundColor !==
        getComputedStyle(document.querySelector('.tnai-bell')).color,
    'bell count purple (data-k=update) for an unread update'
  );
  let row = bellRow();
  check(row === 'Technically Not 9.9.9 (build 99) is available', 'bell notice: "' + row + '"');
  const body = bellBody();
  check(
    body === 'v' + offered.version + ' → v9.9.9 | Update',
    'bell notice shows only current → new and an Update button: "' + body + '"'
  );
  check(
    bellCount().hidden || bellCount().dataset.k !== 'update',
    'opening the bell marks it read; the purple count goes'
  );
  const skipped = await until(
    () => /Version 9\.9\.8/.test(U.state().notes || '') && U.state().notes
  );
  const from = await main('notesFrom');
  check(
    !!skipped &&
      from.asked === from.own &&
      /^Version 9\.9\.9\nFaster terminals/.test(skipped) &&
      /\n\nVersion 9\.9\.8\nSkipped release/.test(skipped) &&
      !/Ancient/.test(skipped),
    'What’s new lists every skipped version, newest first (feed asked from ' +
      from.asked +
      '): ' +
      JSON.stringify(U.state().notes).slice(0, 120)
  );
  check(
    U.state().notesUrl === 'https://example.invalid/tnai/releases/tag/v9.9.9',
    'What’s new link → ' + U.state().notesUrl
  );
  check(
    pref('notify').checked &&
      pref('autoCheck').checked &&
      !pref('autoDownload').checked &&
      !pref('notify').disabled,
    'choices: check + notify on, auto-download off by default'
  );

  pref('notify').click();
  await until(() => U.state().prefs?.notify === false);
  await wait(50);
  check(U.state().prefs?.notify === false && !bellRow(), '"Notify me" off → bell notice removed');
  check(
    /9\.9\.9 \(build 99\) is available/.test(mount.textContent),
    'Settings still shows the offer while notify is off'
  );
  pref('notify').click();
  await until(() => U.state().prefs?.notify === true);
  await wait(50);
  check(!!bellRow(), '"Notify me" on → bell notice back');
  check(
    /Update now/.test(
      mount.querySelector('[data-update="restart"]:not([hidden])')?.textContent || ''
    ) && !mount.querySelector('[data-update="notes"]').hidden,
    'Settings shows Update now + What’s new'
  );

  // The bell's Update waits while an agent is working (a restart would stop it), like a CLI update.
  const realSessions = window.TnaiAgents.sessions,
    realToast = window.toast;
  let said = '';
  window.TnaiAgents.sessions = () => [
    { paneId: 'x', agent: 'Codex', status: 'working', running: true },
  ];
  window.toast = m => {
    said = m;
  };
  await U.updateNow();
  await wait(100);
  window.TnaiAgents.sessions = realSessions;
  window.toast = realToast;
  check(
    U.state().status === 'available' && /1 agent is working\. Update when it finishes/.test(said),
    'bell Update waits while an agent works: "' + said + '"'
  );
  U.confirmRestart();
  await wait(100);
  let dialog = document.querySelector('.tnai-update-overlay .tnai-ws-close-modal');
  check(
    !!dialog &&
      /9\.9\.9 \(build 99\)/.test(dialog.textContent) &&
      /Faster terminals/.test(dialog.textContent) &&
      /Version 9\.9\.8/.test(dialog.textContent) &&
      dialog.querySelector('.tnai-ws-close-confirm').textContent === 'Update now',
    'offer dialog: version, build, release notes, Later / Update now'
  );

  // A release written mixed (9.9.8 in the feed: Fixed, New, Changed, Fixed) is shown kind by kind,
  // under its own version heading.
  {
    const lines = [...dialog.querySelectorAll('.tnai-update-notes .tnai-update-line')].map(l =>
        l.textContent.trim()
      ),
      head = lines.findIndex(t => /^Version 9\.9\.8/.test(t)),
      changes = lines.filter(t => /^(New|Changed|Fixed)/.test(t));
    check(
      changes.join(' | ') === 'New: alpha | Changed: charlie | Fixed: bravo | Fixed: delta' &&
        head >= 0 &&
        lines.indexOf('New: alpha') > head &&
        /^Version 9\.9\.9/.test(lines[0]),
      'a release written mixed is listed New, Changed, Fixed, and stays under its own version: ' +
        JSON.stringify(lines)
    );
  }

  // The dialog's link goes to the public repository's releases page, which the updater names in
  // its state; while no repository is set there is no link. It never goes to the website.
  {
    const links = [...dialog.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      page = U.state().releasesUrl || '';
    check(
      !links.some(href => /technicallynot\.ai/.test(href)) &&
        (page
          ? /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases$/.test(page) && links.includes(page)
          : links.length === 0),
      'offer dialog: its link is the releases page of the public repository (' +
        (page || 'none set, so no link') +
        '): ' +
        JSON.stringify(links)
    );
  }
  dialog.querySelector('.tnai-ws-close-cancel').click();
  await wait(50);
  check(
    !document.querySelector('.tnai-update-overlay') && U.state().status === 'available',
    '"Later" closes it; nothing downloaded'
  );

  await U.download();
  const ready = await until(() => U.state().status === 'ready' && U.state());
  check(
    !!ready && ready.next === '9.9.9',
    'downloaded and sha512-verified: ' + JSON.stringify(U.state()).slice(0, 120)
  );
  const asked = await main('installerAsked');
  check(
    asked.times > 0 && asked.headers.length === 0,
    'the installer was downloaded with nobody signed in, and no request for it carried an Authorization header: ' +
      JSON.stringify(asked)
  );
  await wait(50);
  row = bellRow();
  check(row === 'Technically Not 9.9.9 (build 99) is ready', 'bell notice: "' + row + '"');
  check(
    /9\.9\.9 \(build 99\) is downloaded/.test(mount.textContent) &&
      /Restart to update/.test(mount.querySelector('[data-update="restart"]').textContent),
    'Settings shows the ready version + Restart button'
  );
  U.confirmRestart();
  await wait(100);
  dialog = document.querySelector('.tnai-update-overlay .tnai-ws-close-modal');
  check(
    !!dialog && dialog.querySelector('.tnai-ws-close-confirm').textContent === 'Restart now',
    'restart dialog'
  );
  dialog.querySelector('.tnai-ws-close-cancel').click();
  await wait(50);
  check(!document.querySelector('.tnai-update-overlay'), '"Later" closes it; nothing installed');

  const h = await main('helpers');
  check(
    h.github === 'https://github.com/example-owner/tnai-releases/releases/tag/v0.3.14' &&
      h.plain === '' &&
      h.build === 19,
    'conventions: GitHub feed → release page, other feeds → none, "Technically Not 0.3.14 build 19" → 19'
  );
  const pages = await main('releasesPage');
  check(
    pages.ofRepo === 'https://github.com/example-owner/example-repo/releases' &&
      pages.ofNone === '' &&
      pages.feed === 'https://github.com/example-owner/example-repo/releases/latest/download/',
    'one repository name gives the releases page and the feed; no name gives neither: ' +
      JSON.stringify(pages)
  );
  const cache = await main('cleanup');
  check(true, 'download cache removed: ' + cache);
} catch (error) {
  check(false, 'threw: ' + error.message);
}
return { ok, log };
