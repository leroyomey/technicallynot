/*
 * Technically Not tools · desktop-check/tests/composer-picker.js — ＋ New agent is a plain toggle;
 * the Model pill's two-column menu (46): the installed CLIs on the left,
 * the highlighted CLI's models on the right, a search over every CLI's models on top; one click on
 * a model picks its CLI and that model; keyboard (↓ → Enter, Esc); the Model pill shows the short
 * name with the exact id in its tooltip; the menu fits the window at the current size and at
 * 1024×768. Uses the CLIs' own model lists (no agent is started, no prompt sent). Returns {ok,
 * log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(60);
  }
  return null;
};
const L = window.TnaiLiveTasks,
  P = window.TnaiLaunchPrefs;
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
const key = (el, k) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
try {
  window.TnaiRoute?.('overview');
  await wait(200);

  // the CLIs are detected (and their sign-ins read) a moment after start
  await until(() => (L.startOptions?.() || []).length >= 2, 30000);
  L.newAgent(false);
  await wait(50);

  // ＋ New agent is a plain toggle: no menu; the Model pill under the
  // composer opens the picker.
  const toggle = document.querySelector('.composebox .tnai-new-agent'),
    def = L.startChoice?.()?.agent || 'Claude Code';
  toggle.click();
  await wait(150);
  check(
    !document.querySelector('.tnai-pick-menu') &&
      L.newAgent() === def &&
      toggle.getAttribute('aria-pressed') === 'true',
    '＋ New agent turns on as the default CLI (' + def + ') and opens no menu'
  );

  // While New agent is on, the box carries a soft 3 px ring in the accent, as on every page but
  // the old Overview (which alone took the ring off, and is deleted; this check once said "no
  // ring" for that page). Off, and without the keyboard in it, the box has none. Read without
  // the keyboard, so the box's own focus glow (the mock's `.ask:focus-within`) is not mistaken
  // for it.
  const shadowOf = () => getComputedStyle(toggle.closest('.composebox')).boxShadow;
  document.getElementById('prompt').blur();
  await wait(300);
  const ringOn = shadowOf();
  toggle.click();
  await wait(300);
  const ringOff = shadowOf();
  toggle.click();
  await wait(300);
  check(
    / 0px 0px 0px 3px/.test(ringOn) && ringOff === 'none',
    'on Threads the box carries a soft 3 px accent ring while New agent is on, and none when it is off (on: ' +
      ringOn +
      ', off: ' +
      ringOff +
      ')'
  );
  document.getElementById('prompt').focus();
  await wait(300);
  console.log('TNAI_SHOT:composer-new-on');
  await wait(900);
  toggle.click();
  await wait(150);
  check(
    !document.querySelector('.tnai-pick-menu') &&
      !L.newAgent() &&
      toggle.getAttribute('aria-pressed') === 'false',
    'a second click turns it off'
  );

  // the picker's button
  const nb = document.querySelector('.composer .tnai-pick[data-pick=model] .tnai-pick-btn');
  await until(() => !nb.disabled, 25000);
  nb.click();
  await wait(250);
  let menu = document.querySelector('.tnai-pick-menu');
  if (!menu?.classList.contains('tnai-pick-two')) {
    log.push('skip: fewer than two usable CLIs here, the Model pill has no two-column menu');
  } else {
    const find = menu.querySelector('.tnai-pick-find input'),
      side = menu.querySelector('.tnai-pick-side');
    check(
      menu.classList.contains('tnai-pick-two') &&
        !!find &&
        !!side &&
        document.activeElement === find,
      'the menu has a search box (focused), a CLI list and a model column'
    );
    const rows = [...menu.querySelectorAll('.tnai-pick-opt')],
      agentOf = r => r.title.split(' · ')[0];
    const active = () => menu.querySelector('.tnai-pick-opt.active');
    const models = () => [...menu.querySelectorAll('.tnai-pick-mopt')];
    check(
      await until(() => models().length > 1),
      "model column lists the highlighted CLI's models: " +
        agentOf(active()) +
        ' (' +
        models().length +
        ' rows)'
    );
    check(
      models()[0].textContent.trim() === 'Default model' &&
        models().every(m => m.dataset.agent === agentOf(active())),
      'first row is Default model; every row belongs to that CLI'
    );
    check(
      models()
        .slice(1)
        .every(
          m => !/ · /.test(m.querySelector('b').textContent) && m.title.includes(m.dataset.model)
        ),
      'rows show the friendly name; the exact id is in the tooltip'
    );

    // The menu is placed a moment after it opens and again when its model column fills in, so wait
    // for the placement instead of measuring at once.
    const fits = () => {
      const m = menu.getBoundingClientRect(),
        b = nb.getBoundingClientRect();
      return m.bottom <= b.top + 1 && m.top >= 0 && m.left >= 0 && m.right <= innerWidth;
    };
    await until(fits, 3000);
    const mr = menu.getBoundingClientRect();
    check(
      fits(),
      'menu fits the window above the Model pill (' +
        Math.round(mr.width) +
        '×' +
        Math.round(mr.height) +
        ' in ' +
        innerWidth +
        '×' +
        innerHeight +
        ')'
    );
    check(
      side.getBoundingClientRect().left >
        menu.querySelector('.tnai-pick-list').getBoundingClientRect().right - 1,
      'two columns side by side'
    );
    console.log('TNAI_SHOT:composer-picker');
    await wait(400);

    // Keyboard: ↓ moves in the CLI list and the model column follows; → enters the models; ↓ Enter
    // picks CLI + model.
    const before = agentOf(active());
    key(find, 'ArrowDown');
    await wait(80);
    const second = active(),
      secondAgent = agentOf(second);
    check(
      rows.filter(r => r.getAttribute('aria-disabled') !== 'true').length < 2 ||
        second !== rows.find(r => agentOf(r) === before && r.classList.contains('active')),
      '↓ moves to the next CLI row: ' + secondAgent
    );
    check(
      await until(
        () => models().length > 0 && models().every(m => m.dataset.agent === secondAgent)
      ),
      'the model column follows the highlighted CLI'
    );
    await until(() => models().length > 1, 25000);
    if (models().length > 1) {
      key(find, 'ArrowRight');
      await wait(40);
      key(find, 'ArrowDown');
      await wait(40);
      const hot = menu.querySelector('.tnai-pick-mopt.active'),
        want = hot?.dataset.model;
      check(!!hot && !!want, '→ then ↓ highlights a model: ' + hot?.textContent.trim());
      key(find, 'Enter');
      await wait(150);
      check(
        !document.querySelector('.tnai-pick-menu') &&
          L.newAgent() === secondAgent &&
          P.for(secondAgent).model === want,
        'Enter starts New agent as ' + secondAgent + ' on ' + want
      );
      const pill = document.querySelector('.composer .tnai-pick[data-pick=model] .tnai-pick-btn');
      check(
        !/ · /.test(pill.querySelector('span').textContent) && pill.title.includes(want),
        'Model pill shows the short name ("' +
          pill.querySelector('span').textContent +
          '"), exact id in its tooltip'
      );
    } else log.push('skip: ' + secondAgent + ' lists no models here');

    // Search across every CLI, then a click picks that model's CLI too.
    L.newAgent(false);
    await wait(60);
    nb.click();
    await wait(250);
    menu = document.querySelector('.tnai-pick-menu');
    const find2 = menu.querySelector('.tnai-pick-find input');
    const anyModel = await until(() =>
      [...menu.querySelectorAll('.tnai-pick-mopt')].find(m => m.dataset.model)
    );
    const word = (anyModel?.querySelector('b').textContent || '').split(/\s+/)[0].toLowerCase();
    find2.value = word;
    find2.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    const hits = [...menu.querySelectorAll('.tnai-pick-mopt')];
    check(
      hits.length > 0 &&
        hits.every(
          h =>
            (h.querySelector('b').textContent + ' ' + h.dataset.model)
              .toLowerCase()
              .includes(word) && h.querySelector('small')
        ),
      'search "' + word + '" lists matching models with their CLI (' + hits.length + ')'
    );
    find2.value = 'zzzz-no-such-model';
    find2.dispatchEvent(new Event('input', { bubbles: true }));
    check(
      await until(
        () => /No model matches/.test(menu.querySelector('.tnai-pick-side').textContent),
        30000
      ),
      'no match says so (once every CLI\'s list is in; "Loading models…" until then)'
    );

    // Favorites: the star on a model row keeps it in a Favorites group on
    // top; the menu stays open, nothing is picked.
    find2.value = '';
    find2.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    const favRow = await until(() =>
      [...menu.querySelectorAll('.tnai-pick-mopt')].find(
        m => m.dataset.model && m.querySelector('.tnai-pick-fav')
      )
    );
    const favAgent = favRow?.dataset.agent,
      favModel = favRow?.dataset.model,
      favBefore = P.for(favAgent).model;
    const favHead = () =>
      [...menu.querySelectorAll('.tnai-pick-side h4')].find(h => h.textContent === 'Favorites');
    const stored = () => {
      try {
        return JSON.parse(localStorage.getItem('tnai.model-favorites.v1') || '{}')[favAgent] || [];
      } catch {
        return [];
      }
    };
    check(
      !favHead() && !menu.querySelector('.tnai-pick-mopt[data-model=""] .tnai-pick-fav'),
      'no Favorites group before anything is starred; "Default model" has no star'
    );
    favRow.querySelector('.tnai-pick-fav').click();
    await wait(150);
    const starred = favHead()?.nextElementSibling;
    check(
      !!document.querySelector('.tnai-pick-menu') &&
        starred?.dataset.model === favModel &&
        starred.querySelector('.tnai-pick-fav').getAttribute('aria-pressed') === 'true' &&
        [...menu.querySelectorAll('.tnai-pick-mopt')].filter(m => m.dataset.model === favModel)
          .length === 1 &&
        stored().includes(favModel) &&
        P.for(favAgent).model === favBefore,
      'starring ' +
        favModel +
        ' puts it first under Favorites, once, saved, menu still open, model unchanged'
    );
    starred?.querySelector('.tnai-pick-fav').click();
    await wait(150);
    check(
      !favHead() && !stored().includes(favModel) && !!document.querySelector('.tnai-pick-menu'),
      'the star again removes it from Favorites'
    );
    find2.value = word;
    find2.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    check(
      !!menu.querySelector('.tnai-pick-mopt .tnai-pick-fav') &&
        !!menu.querySelector('.tnai-pick-mopt small'),
      'search results carry the star next to their CLI'
    );
    const hit = menu.querySelector('.tnai-pick-mopt'),
      hitAgent = hit.dataset.agent,
      hitModel = hit.dataset.model;
    hit.click();
    await wait(150);
    check(
      !document.querySelector('.tnai-pick-menu') &&
        (hitAgent === def ? !L.newAgent() : L.newAgent() === hitAgent) &&
        P.for(hitAgent).model === hitModel,
      'a click on a result picks ' +
        hitAgent +
        ' on ' +
        hitModel +
        (hitAgent === def
          ? ' (its own CLI: only the model changes)'
          : ' and starts New agent as it')
    );

    // Esc closes and returns the focus to the button.
    L.newAgent(false);
    await wait(60);
    nb.click();
    await wait(250);
    key(document.querySelector('.tnai-pick-find input'), 'Escape');
    await wait(60);
    check(
      !document.querySelector('.tnai-pick-menu') && document.activeElement === nb && !L.newAgent(),
      'Esc closes it, focus back on the Model pill, nothing picked'
    );

    // OpenCode only: the last row of its model list is an action, "Add a
    // provider…". It is built like the rows around it (same box, padding and text start, by
    // measurement), is never a model (no star, not found, nothing saved), and opens the sign-in
    // that already exists (15 TnaiAccounts.openSignIn, stubbed here: no panel is started).
    const A = window.TnaiAccounts,
      realSignIn = A?.openSignIn,
      signIns = [];
    if (A)
      A.openSignIn = (...a) => {
        signIns.push(a);
      };
    try {
      const ADD = 'add-provider';
      const openOn = async name => {
        // the menu, with that CLI highlighted in the left column; null when it is not listed
        if (document.querySelector('.tnai-pick-menu')) {
          key(document.querySelector('.tnai-pick-find input'), 'Escape');
          await wait(60);
        }
        L.newAgent(false);
        await wait(60);
        nb.click();
        await wait(250);
        const m = document.querySelector('.tnai-pick-menu'),
          f = m.querySelector('.tnai-pick-find input'),
          act = () => m.querySelector('.tnai-pick-opt.active');
        const count = m.querySelectorAll('.tnai-pick-opt').length,
          mrows = () => [...m.querySelectorAll('.tnai-pick-mopt')],
          seen = [];
        for (let i = 0; i <= count; i++) {
          const a = agentOf(act());
          await until(() => mrows().length > 0 && mrows().every(r => r.dataset.agent === a), 25000);
          await until(() => mrows().length > 1, 25000);
          if (a === name) return { m, f, mrows, seen };
          if (seen.includes(a)) break;
          seen.push(a);
          if (name === 'OpenCode')
            check(
              !mrows().some(r => r.dataset.model === ADD),
              a + ' has no Add a provider row (' + mrows().length + ' rows)'
            );
          key(f, 'ArrowDown');
          await wait(120);
        }
        return null;
      };
      let oc = await openOn('OpenCode');
      if (!oc)
        log.push('skip: OpenCode is not a usable CLI here, its Add a provider row was not visited');
      else {
        const box = el => {
          const r = el.getBoundingClientRect(),
            s = getComputedStyle(el),
            b = el.querySelector('b').getBoundingClientRect();
          return {
            h: Math.round(r.height * 10) / 10,
            left: Math.round(r.left * 10) / 10,
            right: Math.round(r.right * 10) / 10,
            pad: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '),
            font: s.fontSize + ' ' + s.fontWeight,
            text: Math.round(b.left * 10) / 10,
            cls: el.className.replace(/\s*active/, ''),
          };
        };
        const measure = where => {
          const list = oc.mrows(),
            add = list.filter(r => r.dataset.model === ADD),
            row = add[0],
            prev = list[list.length - 2],
            prev2 = list[list.length - 3];
          check(
            add.length === 1 &&
              row === list[list.length - 1] &&
              row.querySelector('b').textContent === 'Add a provider…' &&
              !row.querySelector('.tnai-pick-fav') &&
              row.getAttribute('aria-selected') === 'false' &&
              row.dataset.agent === 'OpenCode',
            where +
              ': one Add a provider row, the last of ' +
              list.length +
              ' rows, no star, not selected'
          );
          if (!row || !prev?.dataset.model) return;
          const x = box(row),
            y = box(prev);
          check(
            JSON.stringify(x) === JSON.stringify(y),
            where +
              ': same box as the model row above it (height, left, right, padding, font, text start, classes): ' +
              JSON.stringify(x) +
              ' vs ' +
              JSON.stringify(y)
          );
          if (
            prev2?.dataset.model &&
            prev2.nextElementSibling === prev &&
            prev.nextElementSibling === row
          ) {
            const g1 =
                Math.round(
                  (row.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) * 10
                ) / 10,
              g0 =
                Math.round(
                  (prev.getBoundingClientRect().top - prev2.getBoundingClientRect().bottom) * 10
                ) / 10;
            check(
              g1 === g0,
              where +
                ': the gap above it equals the gap between the two rows before it (' +
                g1 +
                ' px vs ' +
                g0 +
                ' px)'
            );
          }
        };
        measure('short list');
        oc.mrows()
          .find(r => r.dataset.model === ADD)
          ?.scrollIntoView({ block: 'nearest' });
        await wait(120);
        console.log('TNAI_SHOT:composer-picker-add-provider');
        await wait(500);
        const more = oc.m.querySelector('.tnai-pick-more');
        if (more) {
          more.click();
          await wait(200);
          measure('All models');
        } else
          log.push(
            'note: OpenCode lists few models here, so there is no All models state to visit'
          );

        // The find box never lists it.
        for (const q of ['add', 'provider']) {
          oc.f.value = q;
          oc.f.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(150);
          check(
            !oc.mrows().some(r => r.dataset.model === ADD),
            'find "' + q + '" does not list it (' + oc.mrows().length + ' results)'
          );
        }
        oc.f.value = '';
        oc.f.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(150);

        // Keyboard: → into the models, ↓ to the last row, Enter. Nothing is picked or saved; the
        // sign-in entry point is called once.
        const saved = () =>
          JSON.stringify([
            P.for('OpenCode'),
            localStorage.getItem('tnai.model-favorites.v1'),
            L.newAgent(),
          ]);
        const before = saved();
        key(oc.f, 'ArrowRight');
        await wait(40);
        for (let i = 0; i < oc.mrows().length + 2; i++) {
          key(oc.f, 'ArrowDown');
          await wait(15);
        }
        check(
          oc.m.querySelector('.tnai-pick-mopt.active')?.dataset.model === ADD,
          'the arrow keys reach it like the rows above'
        );
        key(oc.f, 'Enter');
        await wait(150);
        check(
          signIns.length === 1 &&
            signIns[0][0] === 'OpenCode' &&
            signIns[0][1]?.accountId === '' &&
            !document.querySelector('.tnai-pick-menu') &&
            saved() === before,
          'Enter on it opens the OpenCode sign-in (stub called ' +
            signIns.length +
            '×: ' +
            JSON.stringify(signIns[0] || null) +
            '), closes the menu, picks and saves nothing'
        );
        oc = await openOn('OpenCode');
        oc?.mrows()
          .find(r => r.dataset.model === ADD)
          ?.click();
        await wait(150);
        check(
          signIns.length === 2 &&
            signIns[1][0] === 'OpenCode' &&
            !document.querySelector('.tnai-pick-menu') &&
            saved() === before,
          'a click on it does the same (stub called ' +
            signIns.length +
            '×), nothing picked or saved'
        );
      }
    } finally {
      if (A) A.openSignIn = realSignIn;
      if (document.querySelector('.tnai-pick-menu')) {
        key(document.querySelector('.tnai-pick-find input'), 'Escape');
        await wait(60);
      }
    }

    // A running OpenCode panel: the Effort control says what OpenCode really has, in its existing
    // hover text (no new element). The panel is a stand-in entry in the session list and the main
    // process's answer is put in place (P.effortSeen): no OpenCode is started.
    const G = window.TnaiAgents,
      TT = window.TnaiTurns,
      realSessions = G.sessions,
      realTurn = TT?.get,
      target0 = L.target?.();
    try {
      const em = (await window.tnaiNative.agents.models('OpenCode'))?.models.find(
        m => m.efforts?.length > 1
      );
      if (!em || !TT || !P.effortSeen)
        log.push(
          'skip: OpenCode lists no effort levels here (its link is not available, or the switch is off), the Effort truth cases were not visited'
        );
      else {
        const fake = {
          paneId: 'tnai-test-oc-effort',
          agent: 'OpenCode',
          name: 'Effort Test',
          running: true,
          mode: 'run',
          status: 'idle',
        };
        G.sessions = function () {
          return [...realSessions.apply(G, arguments), fake];
        };
        TT.get = function (id) {
          return id === fake.paneId
            ? { paneId: id, agent: 'OpenCode', model: em.id }
            : realTurn.apply(TT, arguments);
        };
        L.newAgent(false);
        L.setTarget(fake.paneId);
        await wait(300);
        const es = document.querySelector('.composer .tnai-pick[data-pick=effort] select'),
          lo = em.efforts[0],
          hi = em.efforts[em.efforts.length - 1];
        const boxes = () => document.querySelectorAll('.composer .tnai-pick').length,
          count0 = boxes();
        const see = async v => {
          P.effortSeen(fake.paneId, v);
          await wait(250);
          return { text: es.options[0]?.textContent || '', title: es.title, off: es.disabled };
        };
        let r = await see({ linked: true, model: em.id, want: hi, set: true, now: hi });
        check(
          r.text.toLowerCase().includes(hi) && !/could not|link to this/.test(r.title) && !r.off,
          'OpenCode panel, effort set: it shows the level OpenCode has saved (' +
            JSON.stringify(r.text) +
            ')'
        );
        r = await see({ linked: true, model: em.id, want: hi, set: false, now: lo });
        check(
          r.text.toLowerCase().includes(lo) &&
            !r.text.toLowerCase().includes(hi + '…') &&
            /could not be set in OpenCode/.test(r.title) &&
            r.title.toLowerCase().includes(lo),
          'stepping failed: it shows the level OpenCode really has (' +
            JSON.stringify(r.text) +
            ') and the hover text says so: ' +
            JSON.stringify(r.title)
        );
        r = await see({ linked: true, model: em.id, want: hi, set: false, now: '' });
        check(
          r.text === 'Effort…' &&
            /could not be set in OpenCode: it runs at the level OpenCode itself has/.test(r.title),
          'stepping failed with no saved level: no level is claimed (' +
            JSON.stringify(r.text) +
            ')'
        );
        r = await see({ linked: false });
        check(
          r.text === 'Effort…' && /link to this OpenCode thread is off/.test(r.title),
          'link off for this panel: no level is claimed and the hover text says why: ' +
            JSON.stringify(r.title)
        );
        check(boxes() === count0, 'no element was added for any of it (' + boxes() + ' pills)');
      }
    } finally {
      G.sessions = realSessions;
      if (TT && realTurn) TT.get = realTurn;
      L.setTarget(target0 || null);
      await wait(100);
    }

    // The Model pill opens the same menu: its own CLI highlighted; a
    // model of that CLI only changes the model, a model of another CLI starts New agent as that
    // CLI.
    const mp = document.querySelector('.composer .tnai-pick[data-pick=model] .tnai-pick-btn');
    const own = L.startChoice?.()?.agent || 'Claude Code';
    if (await until(() => !mp.disabled, 25000)) {
      mp.click();
      await wait(250);
      const pm = document.querySelector('.tnai-pick-menu'),
        pmodels = () => [...pm.querySelectorAll('.tnai-pick-mopt')];
      check(
        !!pm &&
          pm.classList.contains('tnai-pick-two') &&
          agentOf(pm.querySelector('.tnai-pick-opt.active')) === own,
        'Model pill opens the two-column menu on its own CLI: ' + own
      );
      const pr = pm.getBoundingClientRect();
      check(
        pr.left >= 0 && pr.top >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight,
        'it fits the window from the Model pill (' +
          Math.round(pr.width) +
          '×' +
          Math.round(pr.height) +
          ')'
      );
      const mine = await until(() =>
        pmodels().find(
          m =>
            m.dataset.model && m.dataset.agent === own && m.getAttribute('aria-selected') !== 'true'
        )
      );
      const mineId = mine?.dataset.model;
      mine?.click();

      // The pill's tooltip is read with the pill not focused. Closing the menu puts the focus on
      // the pill, and while a control has the keyboard focus the hover-tip script (83) holds its
      // title and shows it as its own tip, so `title` is empty then. Whether that happens depends
      // on the test window having the system's focus: with the window in the background this check
      // passed, with it in front (the night run of 2026-10-10) it failed, with the same code.
      await wait(150);
      mp.blur();
      const parts = () => [
        !!mine,
        !document.querySelector('.tnai-pick-menu'),
        !L.newAgent(),
        P.for(own).model === mineId,
        mp.title.includes(mineId),
      ];
      await until(() => parts().every(Boolean), 3000);
      check(
        parts().every(Boolean),
        'a model of its own CLI only changes the model (' +
          mineId +
          '), New agent stays off' +
          (parts().every(Boolean)
            ? ''
            : ' [row, closed, new agent off, saved, tooltip: ' + parts().join(', ') + ']')
      );
      mp.click();
      await wait(250);

      // Recent picks first: once this CLI has two, a Recent group leads
      // with the newest pick; each model listed once.
      const recent =
        JSON.parse(localStorage.getItem('tnai.launch-prefs.v1') || '{}')[own]?.recent || [];
      const shown = await until(() => {
        const l = [...document.querySelectorAll('.tnai-pick-menu .tnai-pick-mopt')];
        return l.length > 1 && l;
      });
      const heads = [...document.querySelectorAll('.tnai-pick-menu .tnai-pick-side h4')].map(
        h => h.textContent
      );
      if (recent.length > 1)
        check(
          recent[0] === mineId &&
            heads.includes('Recent') &&
            shown[1].dataset.model === mineId &&
            shown[2].dataset.model === recent[1] &&
            new Set(shown.map(m => m.dataset.model)).size === shown.length,
          'Recent leads the model column, newest first (' + recent.join(', ') + '), no model twice'
        );
      else check(!heads.includes('Recent'), 'no Recent group with fewer than two picks');
      const pm2 = document.querySelector('.tnai-pick-menu'),
        other = [...pm2.querySelectorAll('.tnai-pick-opt')].find(
          r => r.getAttribute('aria-disabled') !== 'true' && agentOf(r) !== own
        );
      if (other) {
        // Hovering another CLI changes nothing; a click on it shows its models and keeps the menu
        // open.
        other.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        await wait(250);
        check(
          agentOf(pm2.querySelector('.tnai-pick-opt.active')) === own &&
            [...pm2.querySelectorAll('.tnai-pick-mopt')].every(m => m.dataset.agent === own),
          'hovering another CLI row does not change the highlighted CLI or the model column'
        );
        other.click();
        await wait(80);
        check(
          !!document.querySelector('.tnai-pick-menu') &&
            other.classList.contains('active') &&
            !L.newAgent(),
          'a click on another CLI row highlights it and keeps the menu open, nothing picked yet'
        );
        const theirs = await until(
          () =>
            [...pm2.querySelectorAll('.tnai-pick-mopt')].find(
              m => m.dataset.model && m.dataset.agent === agentOf(other)
            ),
          25000
        );
        if (theirs) {
          const a = theirs.dataset.agent,
            id = theirs.dataset.model;
          theirs.click();
          await wait(150);
          check(
            !document.querySelector('.tnai-pick-menu') &&
              L.newAgent() === a &&
              P.for(a).model === id,
            'a model of another CLI starts New agent as ' + a + ' on ' + id
          );
        } else log.push('skip: ' + agentOf(other) + ' lists no models here');
        L.newAgent(false);
        await wait(60);
        mp.click();
        await wait(250);
      }
      key(document.querySelector('.tnai-pick-find input'), 'Escape');
      await wait(60);
      check(
        !document.querySelector('.tnai-pick-menu') && document.activeElement === mp,
        'Esc closes it, focus back on the Model pill'
      );
    } else log.push('skip: the Model pill is disabled here (no model list)');

    // Small window (1024×768): still two columns, fully inside the window.
    const size0 = [innerWidth, innerHeight];
    await main('setSize', 1024, 768);
    await wait(500);
    nb.click();
    await wait(300);
    const small = document.querySelector('.tnai-pick-menu'),
      sr = small?.getBoundingClientRect();
    await until(() => small?.querySelectorAll('.tnai-pick-mopt').length > 1);
    check(
      !!sr &&
        sr.left >= 0 &&
        sr.top >= 0 &&
        sr.right <= innerWidth &&
        sr.bottom <= innerHeight &&
        small.querySelector('.tnai-pick-side').getBoundingClientRect().left >
          small.querySelector('.tnai-pick-list').getBoundingClientRect().left + 100,
      'at ' +
        innerWidth +
        '×' +
        innerHeight +
        ' the menu fits and keeps two columns (' +
        Math.round(sr?.width) +
        '×' +
        Math.round(sr?.height) +
        ')'
    );
    console.log('TNAI_SHOT:composer-picker-1024');
    await wait(500);
    if (document.querySelector('.tnai-pick-menu')) {
      key(document.querySelector('.tnai-pick-find input'), 'Escape');
      await wait(60);
    }
    await main('setSize', size0[0], size0[1]);
    await wait(300);
  }
  L.newAgent(false);
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
