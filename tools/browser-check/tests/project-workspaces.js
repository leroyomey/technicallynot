// Per-project terminal workspaces (07): switching project shows that project's workspaces; its
// panes stay in the DOM (hidden), switching back restores tabs and the active one. Run:
// .\tools\browser-check\check.ps1 -Test project-workspaces
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const W = window.TnaiTerminalWorkspaces,
      tabs = () =>
        [...document.querySelectorAll('.terminal-workspace-tab')].map(
          t => t.querySelector('span').textContent
        ),
      go = root => {
        window.dispatchEvent(new CustomEvent('tnai:project-changed', { detail: { root } }));
        return wait(100);
      };
    log(
      'migrated to the open project (browser = ""):',
      W.list().every(w => w.project === ''),
      '| project():',
      JSON.stringify(W.project())
    );
    document.querySelector('.terminal-workspace-add:not(.terminal-pane-add)').click();
    await wait(100);
    const homeTabs = tabs().join(','),
      homeActive = W.activeId(),
      homePanes = W.panesFor('').length;
    log('home tabs:', homeTabs, '| panes:', homePanes);
    await go('C:/Work/Other/');
    log(
      'other project tabs:',
      tabs().join(','),
      '| one default:',
      W.list().length === 1 && W.list()[0].name === 'Workspace 1',
      '| key:',
      W.project(),
      '| home panes still in DOM:',
      W.panesFor('').every(p => p.isConnected),
      '| home panes hidden:',
      W.panesFor('').every(p => p.closest('.terminal-workspace-view').hidden),
      '| all list:',
      W.list({ all: true }).length
    );
    document.querySelector('.terminal-workspace-add:not(.terminal-pane-add)').click();
    await wait(100);
    log('other now has 2:', tabs().join(','));
    await go('');
    log(
      'back home restored:',
      tabs().join(',') === homeTabs,
      '| active restored:',
      W.activeId() === homeActive,
      '| panes:',
      W.panesFor('').length === homePanes
    );
    await go('c:\\work\\other');
    log('other restored (same key, other spelling):', tabs().length === 2);
    const saved = JSON.parse(localStorage.getItem('tnai.terminal-workspaces.v1'));
    log(
      'saved per project:',
      saved.workspaces.every(w => typeof w.project === 'string'),
      '| active map:',
      JSON.stringify(saved.active)
    );
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
