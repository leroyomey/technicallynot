/*
 * Technically Not tools · desktop-check/tests/cli-install.js — Usage & accounts: a CLI that is not
 * installed on this PC offers Install (the provider's own command, run in a PowerShell terminal
 * panel) and the provider's page; one that comes through npm offers Node.js first when npm is not
 * found. Presses nothing that installs: it reads the buttons, then presses Check again. Needs at
 * least one CLI that is not installed on this PC (else it says so and passes on the data alone).
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
    await wait(100);
  }
  return null;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
try {
  const info = await window.tnaiNative.agents.install();
  check(
    !!info?.tools && typeof info.node === 'boolean',
    'the bridge answers how each CLI is installed (Node.js found: ' + info?.node + ')'
  );
  check(
    typeof window.TnaiPowerShellLink?.run === 'function' || !window.tnaiPlatform.win,
    'the PowerShell link can run a command for a button'
  );
  window.TnaiSettings.open('usage');
  await wait(300);
  document.getElementById('settingsTab-accounts')?.click();
  const mount = await until(() => {
    const m = document.getElementById('tnaiAccountsMount');
    return m?.querySelector('.tnai-cli') && m.getBoundingClientRect().width > 0 ? m : null;
  });
  check(!!mount, 'Usage & accounts shows the tools');
  if (!mount) {
    const m = document.getElementById('tnaiAccountsMount');
    log.push(
      '     mount: ' +
        (m
          ? Math.round(m.getBoundingClientRect().width) +
            ' px wide, ' +
            m.querySelectorAll('.tnai-cli').length +
            ' tools, text "' +
            m.textContent.slice(0, 120) +
            '"'
          : 'not in the page')
    );
    return { ok, log };
  }
  const tiles =
    (await until(() => {
      const t = [...mount.querySelectorAll('.tnai-cli.missing')];
      return t.length &&
        t.every(x => x.querySelector('.tnai-acct-actions') || !info.tools[x.dataset.cli])
        ? t
        : null;
    }, 8000)) || [];
  log.push('     not installed here: ' + (tiles.map(t => t.dataset.cli).join(', ') || 'none'));
  for (const tile of tiles) {
    const id = tile.dataset.cli,
      how = info.tools[id],
      needNode = how?.needsNode && !info.node,
      cmd = needNode ? info.nodeCommand : how?.command;
    const button = tile.querySelector('button[data-acct="install"]'),
      link = tile.querySelector('a.link');
    check(
      !cmd ||
        (!!button &&
          button.title.endsWith(cmd) &&
          button.textContent === (needNode ? 'Install Node.js' : 'Install')),
      id + ': Install names the command it runs (' + (button?.textContent || 'no button') + ')'
    );
    check(
      !(needNode ? info.nodePage : how?.page) ||
        (link?.target === '_blank' && link.href.startsWith('https://')),
      id + ': the provider page link opens outside the app (' + (link?.textContent || 'none') + ')'
    );
    const box = tile.getBoundingClientRect(),
      inner = [...tile.querySelectorAll('button,a')].map(e => e.getBoundingClientRect());
    check(
      inner.every(
        r =>
          r.left >= box.left - 0.5 &&
          r.right <= box.right + 0.5 &&
          r.bottom <= box.bottom + 0.5 &&
          r.height >= 20
      ),
      id + ': the controls sit inside the tile'
    );
  }
  mount.querySelector('.ac-missing')?.scrollIntoView({ block: 'center' });
  await shot('cli-install');
  mount.querySelector('button[data-acct="refresh"]').click();
  check(
    !!(await until(() => mount.querySelector('.tnai-cli'), 8000)),
    'Check again redraws the tools'
  );
  await wait(1500);
  check(
    mount.querySelectorAll('.tnai-cli.missing').length === tiles.length,
    'after Check again the same tools are not installed (' + tiles.length + ')'
  );
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
