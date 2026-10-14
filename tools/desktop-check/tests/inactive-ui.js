// Technically Not tools · desktop-check/tests/inactive-ui.js — Controls without a working feature
// are marked inactive (12: aria-disabled, tabindex -1, disabled) however and whenever they reach
// the page: one of each selector kind added after load, in the page on screen and in a page not
// shown; a control moved, a control that stops matching (given back), a mark another script took
// off (put back), and the file rail's two controls that depend on the connection state (:has).
// Counts 12's whole-document passes: adding controls needs none, a connection or route change takes
// one. No agent CLI. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
  }
  return null;
};
const isMarked = el =>
  el.getAttribute('aria-disabled') === 'true' &&
  el.getAttribute('tabindex') === '-1' &&
  (!('disabled' in el) || el.tagName === 'DIV' || el.disabled === true);
const el = (tag, attrs = {}) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

// 12's whole-document pass is the only caller that queries the document for this selector list.
let fullPasses = 0;
const realQuery = document.querySelectorAll;
document.querySelectorAll = function (s) {
  if (typeof s === 'string' && s.includes('#openRuntimeLauncher') && s.includes('.terminal-route'))
    fullPasses++;
  return realQuery.call(this, s);
};
const made = [];
try {
  // The Threads page is the start page; its top bar is on screen on every page.
  window.TnaiThreads.open();
  await wait(600);
  const shownHost = document.querySelector('.top'),
    hiddenHost = document.querySelector('#skillsPage') || document.querySelector('#agentsPage');
  check(
    !!shownHost?.offsetParent && !!hiddenHost && !hiddenHost.offsetParent,
    'the top bar is on screen, ' + (hiddenHost?.id || 'no other page') + ' is not'
  );
  const sampleTree = document.querySelector('.repo-rail-tree:not(.repo-real-tree)'),
    detail = document.getElementById('repoFileDetail');
  check(
    !!sampleTree && !!detail,
    'the sample tree and the sample file detail exist (file rail, not shown)'
  );
  await wait(400);
  const before = fullPasses;

  // One control of each kind, added after load, in the page on screen and in a page that is not
  // shown.
  const kinds = host => {
    const box = el('div', {
      style: 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden',
    });
    made.push(box);
    const tree = el('div', { class: 'repo-rail-tree' }),
      inTree = el('button', { 'data-repo-path': 'x.js' }),
      folder = el('button', { 'data-repo-folder': 'src' });
    tree.append(inTree, folder);
    const list = {
      '.terminal-route': el('select', { class: 'terminal-route' }),
      '#agentRecipient': el('select', { id: 'agentRecipient' }),
      '.repo-rail-tree [data-repo-path]': inTree,
      '.repo-rail-tree [data-repo-folder]': folder,
      'a div (.terminal-route)': el('div', { class: 'terminal-route' }),
    };
    box.append(list['.terminal-route'], list['a div (.terminal-route)'], tree);
    host.append(box);
    return { box, list, tree };
  };
  const shown = kinds(shownHost),
    hidden = kinds(hiddenHost);
  hidden.box.append(hidden.list['#agentRecipient']);
  delete shown.list['#agentRecipient']; // an id: one in the document
  for (const [where, set] of [
    ['on screen', shown],
    ['in a page not shown', hidden],
  ]) {
    const t0 = performance.now();
    await until(() => Object.values(set.list).every(isMarked));
    const missed = Object.entries(set.list)
      .filter(([, n]) => !isMarked(n))
      .map(([k]) => k);
    check(
      !missed.length,
      Object.keys(set.list).length +
        ' kinds added ' +
        where +
        ' are all marked after ' +
        Math.round(performance.now() - t0) +
        ' ms' +
        (missed.length ? ' · missed: ' + missed.join(', ') : '')
    );
  }

  // Into containers that were already there: the sample tree and the sample file detail of the file
  // rail (never on screen), and a tree added a moment ago.
  const late = {
    'sample tree [data-repo-path]': el('button', { 'data-repo-path': 'late.js' }),
    '#repoFileDetail .button': el('button', { class: 'button' }),
    'row added later to the new tree': el('button', { 'data-repo-folder': 'late' }),
  };
  sampleTree?.append(late['sample tree [data-repo-path]']);
  detail?.append(late['#repoFileDetail .button']);
  shown.tree.append(late['row added later to the new tree']);
  made.push(...Object.values(late));
  await until(() => Object.values(late).every(isMarked));
  {
    const missed = Object.entries(late)
      .filter(([, n]) => !isMarked(n))
      .map(([k]) => k);
    check(
      !missed.length,
      'controls added into existing containers are marked' +
        (missed.length ? ' · missed: ' + missed.join(', ') : '')
    );
  }

  // Deep inside one added block, and written as HTML (how a page adds a row of controls).
  const html = el('div');
  html.innerHTML =
    '<div><p><span><select class="terminal-route"><option>Route</option></select></span></p></div>';
  made.push(html);
  hiddenHost.append(html);
  check(
    !!(await until(() => isMarked(html.querySelector('select')))),
    'a control deep inside added HTML is marked'
  );

  // #openRuntimeLauncher: taken out, its marks cleared, put back.
  const launcher = document.getElementById('openRuntimeLauncher');
  if (launcher) {
    check(isMarked(launcher), '#openRuntimeLauncher is marked at load');
    const parent = launcher.parentNode,
      next = launcher.nextSibling;
    launcher.remove();
    await wait(250);
    launcher.removeAttribute('aria-disabled');
    launcher.removeAttribute('tabindex');
    launcher.disabled = false;
    parent.insertBefore(launcher, next);
    check(
      !!(await until(() => isMarked(launcher))),
      '#openRuntimeLauncher taken out and put back is marked again'
    );
  } else check(false, '#openRuntimeLauncher not found');
  check(
    fullPasses === before,
    'none of this needed a whole-document pass (' + (fullPasses - before) + ')'
  );

  // A mark another script takes off comes back with the next change on the page; a control that
  // stops matching gets its own values back.
  const slot = shown.list['.terminal-route'];
  slot.disabled = false;
  slot.removeAttribute('aria-disabled');
  shown.box.append(el('i'));
  check(!!(await until(() => isMarked(slot))), 'a mark that was taken off is put back');
  const route = hidden.list['.terminal-route'];
  route.classList.remove('terminal-route');
  hidden.box.append(el('i'));
  check(
    !!(await until(
      () =>
        !route.hasAttribute('aria-disabled') &&
        !route.hasAttribute('tabindex') &&
        route.disabled === false
    )),
    'a control that stops matching gets its own values back (aria-disabled ' +
      route.getAttribute('aria-disabled') +
      ', tabindex ' +
      route.getAttribute('tabindex') +
      ', disabled ' +
      route.disabled +
      ')'
  );

  // A class added to a control that is already on the page is seen at the next whole-document pass:
  // a route change is one.
  route.classList.add('terminal-route');
  await wait(400);
  const classOnly = isMarked(route);
  const p1 = fullPasses;
  window.TnaiRoute('skills');
  await wait(100);
  check(
    !!(await until(() => isMarked(route))) && fullPasses > p1,
    'a route change runs a whole-document pass (' +
      (fullPasses - p1) +
      '), which marks a control that began to match by class alone (marked before it: ' +
      classOnly +
      ')'
  );
  window.TnaiThreads.open();
  await wait(400);

  // The file rail's refresh and filter depend on the connection state, read through :has():
  // changing the state elsewhere marks and frees them.
  const connect = document.querySelector('.repository-rail .repo-connect'),
    refresh = document.getElementById('repoRefresh'),
    search = document.getElementById('repoRailSearch');
  if (connect && refresh && search && connect.dataset.state === 'connected') {
    check(!isMarked(refresh) && !isMarked(search), 'connected: refresh and filter are not marked');
    const p2 = fullPasses;
    connect.dataset.state = 'reconnect';
    check(
      !!(await until(() => isMarked(refresh) && isMarked(search))) && fullPasses > p2,
      'state no longer connected: both are marked, by a whole-document pass (' +
        (fullPasses - p2) +
        ')'
    );
    connect.dataset.state = 'connected';
    check(
      !!(await until(
        () => !isMarked(refresh) && !isMarked(search) && !refresh.disabled && !search.disabled
      )),
      'connected again: both are given back'
    );
    const holder = connect.parentNode,
      after = connect.nextSibling;
    connect.remove();
    check(
      !!(await until(() => isMarked(refresh) && isMarked(search))),
      'the connection block taken out of the page: both are marked'
    );
    holder.insertBefore(connect, after);
    check(
      !!(await until(() => !isMarked(refresh) && !isMarked(search))),
      'put back: both are given back'
    );
  } else
    check(
      false,
      'file rail connection block not found or not connected (state ' + connect?.dataset.state + ')'
    );

  // An ordinary busy moment: 40 rows and texts change in 2 s, none of them a control.
  const busy = el('div', { style: 'position:absolute;width:0;height:0;overflow:hidden' });
  made.push(busy);
  shownHost.append(busy);
  const p3 = fullPasses;
  for (let i = 0; i < 40; i++) {
    busy.append(Object.assign(el('span'), { textContent: 'row ' + i }));
    if (i % 3 === 0) busy.firstChild.remove();
    await wait(50);
  }
  await wait(300);
  log.push(
    'info 40 page changes in 2 s: ' +
      (fullPasses - p3) +
      ' whole-document passes (before this change: one per 150 ms, about 13)'
  );
  check(fullPasses === p3, 'ordinary page changes take no whole-document pass');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
made.forEach(n => n.remove());
delete document.querySelectorAll;
return { ok, log };
