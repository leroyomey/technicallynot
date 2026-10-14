// Technically Not tools · desktop-check/tests/composer-target.js — Composer (46): the prompt is a
// textarea that wraps and grows with its lines up to a cap, Shift+Enter adds a line without
// sending, the composer is narrower than the window; the Agent · Model · Effort dropdowns under the
// prompt (Auto, a running PowerShell pane, New agent per CLI; picking sets the target or next
// send's CLI; model/effort remembered for new agents). Never sends to an agent CLI (no usage).
// Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const G = window.TnaiAgents,
  L = window.TnaiLiveTasks;
try {
  window.TnaiRoute?.('overview');
  await wait(200);
  const p = document.getElementById('prompt');
  check(p.tagName === 'TEXTAREA', 'prompt is a textarea');
  const h1 = p.offsetHeight;
  p.focus();
  p.value = 'line one\nline two\nline three\nline four';
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  check(
    p.offsetHeight > h1 * 2.5,
    'prompt grows with its lines (' + h1 + ' → ' + p.offsetHeight + 'px)'
  );
  p.value = Array(40).fill('long line').join('\n');
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  check(
    p.offsetHeight > 60 &&
      p.offsetHeight <= Math.max(63, Math.min(126, innerHeight * 0.25)) + 1 &&
      p.scrollHeight > p.offsetHeight,
    'grows to ~6 lines / 25% of the window, then scrolls (' + p.offsetHeight + 'px)'
  );
  check(
    document.querySelector('.composer .composebox').classList.contains('tnai-prompt-long'),
    'long prompt reads as a top-aligned block'
  );
  p.value = 'wrap ' + 'word '.repeat(200);
  p.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  check(p.scrollWidth <= p.clientWidth + 1, 'long text wraps instead of running sideways');
  p.value = 'abc';
  p.setSelectionRange(3, 3);
  p.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
  );
  check(p.value === 'abc', 'Shift+Enter does not send');
  const box = document.querySelector('.composer .composebox').getBoundingClientRect();

  // On the Overview the composer is the center column's footer and takes that column's width
  // (08-overview-purple.css, max-width:none); on every other page 46's 920 px cap holds. The old
  // fixed 925 px failed once the center column grew past it (the Overview rail lost its Live
  // preview section).
  const center = document
    .querySelector('#pgOverview .pgo-center>footer.composer')
    ?.closest('.pgo-center')
    ?.getBoundingClientRect();
  const cap = center ? center.width + 1 : 925;
  check(
    box.width <= cap && box.width < innerWidth - 300,
    'composer box is narrower than the window (' +
      Math.round(box.width) +
      ' of ' +
      innerWidth +
      (center ? ', center column ' + Math.round(center.width) : ', cap 925') +
      ')'
  );
  console.log('TNAI_SHOT:composer-multiline');

  // Which agent Auto starts (11): Claude Code, or Codex when its plan is a clearly higher tier;
  // never Cursor; a remembered pick only chooses the Claude Code account; never blocked.
  await G.detect?.();
  await window.TnaiAccounts?.refresh?.();
  const opts = L.startOptions(),
    savedPick = L.startPick();
  log.push('info start options: ' + (opts.map(o => o.label).join(', ') || 'none'));
  if (!G.sessions().some(s => s.running)) {
    L.startPick('');
    const r0 = L.route(false);
    check(
      r0.kind === 'new',
      'no pick: starts the first signed-in agent (' + r0.kind + ' ' + r0.label + ')'
    );
    const claude = opts.filter(o => o.agent === 'Claude Code'),
      other = opts.find(o => o.agent !== 'Claude Code');
    if (claude.length > 1) {
      const k = claude[claude.length - 1];
      L.startPick(k.key);
      const r1 = L.route(false);
      check(
        r1.kind === 'new' && r1.label.includes(k.label),
        'picked Claude Code account → starts that one: ' + r1.label
      );
    }
    if (other && claude.length) {
      L.startPick(other.key);
      const r2 = L.route(false),
        auto = L.startChoice()?.agent;
      check(
        auto !== 'Cursor Agent' &&
          (auto === 'Claude Code' || auto === 'Codex') &&
          r2.label.includes(auto) &&
          !(other.agent === 'Cursor Agent' && r2.label.includes('Cursor')),
        'picked ' +
          other.agent +
          ' → Auto stays on ' +
          auto +
          ' (Codex only on a higher plan, never Cursor): ' +
          r2.label
      );
    }
    log.push('info Auto starts: ' + L.startChoice()?.label);

    // Plan tiers with sample plans (no real accounts touched): Codex only when its plan is clearly
    // higher; ties, unknown and Cursor stay on Claude Code.
    const A = window.TnaiAccounts,
      realList = A?.list,
      inst = id => G.info().find(x => x.id === id)?.installed;
    if (A && realList && inst('Claude Code') && inst('Codex')) {
      const fake = (c, x) => () =>
        [
          ['Claude Code', c],
          ['Codex', x],
          ['Cursor Agent', 'Ultra'],
        ].map(([agentId, plan]) => ({
          agentId,
          supported: true,
          accounts: [{ id: 'a', isDefault: true, status: { loggedIn: true, plan } }],
        }));
      L.startPick('');
      for (const [c, x, want] of [
        ['Pro', 'Pro', 'Codex'],
        ['Max', 'Pro', 'Claude Code'],
        ['Pro', 'Plus', 'Claude Code'],
        ['Free', 'Plus', 'Codex'],
        ['', 'Pro', 'Claude Code'],
        ['Max', '', 'Claude Code'],
      ]) {
        A.list = fake(c, x);
        check(
          L.startChoice()?.agent === want,
          'Claude ' +
            (c || 'unknown') +
            ' vs ChatGPT ' +
            (x || 'unknown') +
            ' → Auto starts ' +
            want +
            ' (got ' +
            L.startChoice()?.agent +
            ')'
        );
      }
      A.list = realList;
      L.startPick(savedPick);
    } else log.push('skip plan-tier check: Claude Code and Codex not both installed');
    const autoOpt = document.querySelector('.composer .tnai-pickers select option[value="auto"]');
    check(
      !autoOpt || /^Auto · Claude Code/.test(autoOpt.textContent),
      'Auto option names the CLI it starts: ' + (autoOpt?.textContent || 'no agent dropdown')
    );
    L.startPick(savedPick);
  } else log.push('skip start-pick route check: an agent is already running');

  const sh = await window.TnaiTest.open('Terminal');
  const shPane = sh?.paneId;
  await until(() => G.sessions().find(s => s.paneId === shPane && s.running));
  window.TnaiRoute?.('overview');
  await wait(200);
  const [agentSel, modelSel, effortSel] = document.querySelectorAll(
    '.composer .tnai-pickers select'
  );
  check(
    !!(agentSel && modelSel && effortSel),
    'Agent, Model and Effort dropdowns under the prompt'
  );
  const pb = modelSel?.nextElementSibling?.getBoundingClientRect(),
    boxNow = document.querySelector('.composer .composebox').getBoundingClientRect();
  check(pb && pb.top >= boxNow.bottom - 1, 'Model / Effort sit beneath the prompt box');
  check(
    !!agentSel.querySelector('option[value="auto"]') &&
      !!agentSel.querySelector('option[value="pane:' + shPane + '"]'),
    'Agent: Auto and the running PowerShell pane'
  );
  check(
    ['Claude Code', 'Codex', 'Cursor Agent'].every(id =>
      [...agentSel.querySelectorAll('optgroup[label="New agent"] option')].some(o =>
        o.textContent.includes(id)
      )
    ),
    'Agent: New Claude Code, Codex, Cursor Agent'
  );
  console.log('TNAI_SHOT:composer-pickers');

  // The app's own menu over the hidden select: button shows the choice, opens a listbox (checkmark
  // on the chosen row), keys move/close, focus returns.
  const agentBtn = agentSel.nextElementSibling;
  check(
    agentBtn?.classList.contains('tnai-pick-btn') &&
      !agentBtn.offsetParent &&
      // the pill shows the agent's name; the option also names its tool after a dot
      agentSel.options[agentSel.selectedIndex].textContent.startsWith(
        agentBtn.querySelector('span').textContent
      ),
    'Agent pill is hidden (the avatar row and ＋ New agent pick instead, 07) and still mirrors its choice: ' +
      agentBtn?.querySelector('span').textContent +
      ' | select: ' +
      agentSel.options[agentSel.selectedIndex]?.textContent +
      ' | shown: ' +
      !!agentBtn?.offsetParent
  );
  agentBtn.click();
  await wait(250);
  const pickMenu = document.querySelector('.tnai-pick-menu');
  check(
    !!pickMenu &&
      document.activeElement === pickMenu &&
      agentBtn.getAttribute('aria-expanded') === 'true',
    'click opens the menu and focuses it'
  );
  check(
    pickMenu?.querySelectorAll('.tnai-pick-opt').length === agentSel.options.length &&
      pickMenu.querySelector('.tnai-pick-opt[aria-selected=true]')?.title ===
        agentSel.options[agentSel.selectedIndex].textContent,
    'menu rows mirror the options, chosen one marked'
  );
  const mr = pickMenu?.getBoundingClientRect();
  check(
    mr && mr.top >= 0 && mr.bottom <= innerHeight && mr.right <= innerWidth,
    'menu opens inside the window'
  );
  console.log('TNAI_SHOT:composer-pick-menu');
  window.TnaiTheme?.set('dark');
  await wait(400);
  console.log('TNAI_SHOT:composer-pick-menu-dark');
  window.TnaiTheme?.set('light');
  await wait(200);
  pickMenu.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  await wait(50);
  check(
    !document.querySelector('.tnai-pick-menu') &&
      agentBtn.getAttribute('aria-expanded') === 'false',
    'Escape closes it'
  );
  agentBtn.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
  );
  await wait(50);
  const paneRow = [...document.querySelectorAll('.tnai-pick-menu .tnai-pick-opt')].findIndex(r =>
    r.title.includes(G.sessions().find(s => s.paneId === shPane)?.name || '\u0000')
  );
  check(paneRow > 0, 'ArrowDown on the pill opens the menu');
  if (paneRow > 0) {
    document.querySelectorAll('.tnai-pick-menu .tnai-pick-opt')[paneRow].click();
    await wait(100);
    check(
      L.target() === shPane && !document.querySelector('.tnai-pick-menu'),
      'clicking a row picks it (fires change)'
    );
  }
  agentSel.value = 'pane:' + shPane;
  agentSel.dispatchEvent(new Event('change'));
  await wait(100);
  check(L.target() === shPane, 'picking a running pane sets the target');
  L.paintRoute();
  check(
    /^Chosen → /.test(document.querySelector('.tnai-route-hint').textContent),
    'route hint says it was chosen'
  );
  agentSel.value = 'auto';
  agentSel.dispatchEvent(new Event('change'));
  await wait(100);
  check(L.target() === null && !L.newAgent(), 'Auto clears the target');
  const claudeNew = [...agentSel.options].find(o => o.value.startsWith('new:Claude Code|'));
  if (claudeNew) {
    agentSel.value = claudeNew.value;
    agentSel.dispatchEvent(new Event('change'));
    check(L.newAgent() === 'Claude Code', 'New Claude Code set for the next send');
    const saved = localStorage.getItem('tnai.launch-prefs.v1');
    await until(
      () => !modelSel.disabled && modelSel.querySelector('option[value="claude-opus-5-5"]')
    );
    const shortOpts = [...modelSel.options].filter(o => o.value && o.value !== 'all');
    check(
      shortOpts.length <= 8 &&
        !!modelSel.querySelector('option[value="all"]') &&
        !modelSel.querySelector('option[value="claude-opus-4-7"]'),
      'short model list (' + shortOpts.map(o => o.value).join(', ') + ') + All models…'
    );
    modelSel.value = 'all';
    modelSel.dispatchEvent(new Event('change'));
    modelSel.blur();
    check(
      !!modelSel.querySelector('option[value="claude-opus-4-7"]') &&
        !!modelSel.querySelector('optgroup[label="Opus"]') &&
        !!modelSel.querySelector('option[value="fewer"]'),
      'All models… shows the full grouped list'
    );
    modelSel.value = 'fewer';
    modelSel.dispatchEvent(new Event('change'));
    modelSel.value = 'claude-opus-5-5';
    modelSel.dispatchEvent(new Event('change'));
    effortSel.value = 'high';
    effortSel.dispatchEvent(new Event('change'));
    const lp = window.TnaiLaunchPrefs.for('Claude Code');
    check(
      lp.model === 'claude-opus-5-5' && lp.effort === 'high',
      'model/effort remembered for new Claude Code agents: ' + JSON.stringify(lp)
    );

    // Per-agent model: a fresh pane starts on the CLI's last pick, a `once` pick goes to the next
    // fresh pane only, a resumed pane without its own pick gets none.
    const A = window.TnaiLaunchPrefs,
      savedPanes = localStorage.getItem('tnai.agent-models.v1');
    check(
      A.start('test-pane-a', 'Claude Code', false)?.model === 'claude-opus-5-5',
      'fresh pane starts on the composer’s last pick'
    );
    check(
      A.pane('test-pane-a', 'Claude Code').effort === 'high',
      'fresh pane remembers the effort it starts on (shown under the composer): ' +
        A.pane('test-pane-a', 'Claude Code').effort
    );
    check(
      A.start('test-pane-b', 'Claude Code', true) === null,
      'resumed pane without its own pick: nothing forced'
    );
    A.once('Claude Code', { model: 'claude-sonnet-5' });
    const handed = A.start('test-pane-c', 'Claude Code', false)?.model,
      after = A.start('test-pane-d', 'Claude Code', false)?.model;
    check(
      handed === 'claude-sonnet-5' &&
        after === 'claude-opus-5-5' &&
        A.pane('test-pane-c', 'Claude Code').model === 'claude-sonnet-5' &&
        A.start('test-pane-c', 'Claude Code', true)?.model === 'claude-sonnet-5',
      'once pick: that pane keeps it (also on resume), the next pane is back to the last pick (' +
        handed +
        ', ' +
        after +
        ')'
    );
    if (savedPanes === null) localStorage.removeItem('tnai.agent-models.v1');
    else localStorage.setItem('tnai.agent-models.v1', savedPanes);
    if (saved === null) localStorage.removeItem('tnai.launch-prefs.v1');
    else localStorage.setItem('tnai.launch-prefs.v1', saved);
    L.newAgent(false);
  } else log.push('skip new Claude Code: not signed in here');

  // ＋ New agent (11) is a plain toggle. The Model pill opens 46's CLI
  // menu: installed CLIs only, signed-out ones grayed, the default (Auto's pick) marked; a pick
  // turns New agent on as that CLI.
  {
    L.newAgent(false);
    await wait(50);
    const toggle = document.querySelector('.composebox .tnai-new-agent'),
      installed = G.info()
        .filter(
          a => ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'].includes(a.id) && a.installed
        )
        .map(a => a.id);
    toggle.click();
    await wait(150);
    check(
      !document.querySelector('.tnai-pick-menu') &&
        L.newAgent() === (L.startChoice()?.agent || 'Claude Code') &&
        toggle.getAttribute('aria-pressed') === 'true',
      '＋ New agent turns on as the default CLI, no menu (' + L.newAgent() + ')'
    );
    toggle.click();
    await wait(100);
    check(
      !L.newAgent() && !document.querySelector('.tnai-pick-menu'),
      'a click while on turns it off'
    );
    const nb = document.querySelector('.composer .tnai-pick[data-pick=model] .tnai-pick-btn');
    nb.click();
    await wait(250);
    const nm = document.querySelector('.tnai-pick-menu.tnai-pick-two'),
      rows = [...(nm?.querySelectorAll('.tnai-pick-opt') || [])];
    if (nm) {
      check(
        rows.length >= 2 &&
          rows.every(r => installed.some(id => r.title.startsWith(id))) &&
          nb.getAttribute('aria-expanded') === 'true' &&
          !L.newAgent(),
        'the Model pill opens the CLI menu (' +
          rows.map(r => r.title).join(', ') +
          '), only installed CLIs, still off'
      );
      const def = L.startChoice()?.label;
      check(
        !def ||
          rows.find(r => r.getAttribute('aria-selected') === 'true')?.title === def + ' · default',
        'the default CLI is marked: ' + def
      );
      check(
        rows
          .filter(r => r.getAttribute('aria-disabled') === 'true')
          .every(r => / · not signed in$/.test(r.title)),
        'signed-out CLIs are grayed as not signed in'
      );
      const mr = nm.getBoundingClientRect(),
        br = nb.getBoundingClientRect();
      check(
        mr.bottom <= br.top + 1 && mr.top >= 0 && mr.right <= innerWidth,
        'menu opens above the Model pill, inside the window'
      );
      console.log('TNAI_SHOT:composer-new-agent-menu');
      const pickRow = rows.filter(r => r.getAttribute('aria-disabled') !== 'true').at(-1),
        want = pickRow?.title.split(' · ')[0];
      pickRow?.click();
      await wait(100);
      if (document.querySelector('.tnai-pick-menu')) {
        pickRow.click();
        await wait(100);
      } // the first click on another CLI's row only highlights it
      check(
        !document.querySelector('.tnai-pick-menu') &&
          L.newAgent() === want &&
          toggle.getAttribute('aria-pressed') === 'true',
        'picking a row starts New agent as ' + want
      );
      L.newAgent(false);
      await wait(50);
      nb.click();
      await wait(200);
      document
        .querySelector('.tnai-pick-menu')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
      await wait(50);
      check(
        !L.newAgent() &&
          !document.querySelector('.tnai-pick-menu') &&
          document.activeElement === nb,
        'Escape closes the menu without starting anything, focus back on the button'
      );
    } else {
      check(
        L.startOptions().length <= 1 && !!L.newAgent(),
        'one CLI choice here: New agent toggles on directly (' + L.newAgent() + ')'
      );
      log.push('info new-agent menu not shown: one choice (' + installed.join(', ') + ')');
    }
    L.newAgent(false);
  }
  p.value = '';
  p.dispatchEvent(new Event('input', { bubbles: true }));
  if (shPane) G.stop(shPane);
  await wait(300);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
