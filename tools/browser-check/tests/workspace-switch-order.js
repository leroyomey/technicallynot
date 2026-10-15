// Two project switches finishing out of order (07): the startup pass waits for the project list
// (answered late by the .head.js stand-in) while the user switches to another project. The newer
// switch must win. Run: .\tools\browser-check\check.ps1 -Test workspace-switch-order
(async () => {
  const { log, wait } = check;
  try {
    const W = window.TnaiTerminalWorkspaces;
    window.dispatchEvent(new CustomEvent('tnai:project-changed', { detail: { root: 'C:\\New' } }));
    await wait(100);
    log('switched first:', JSON.stringify(W.project()));

    // the startup pass's late answer has come in by now
    await wait(600);
    log(
      'newer switch still shown after the late startup answer:',
      W.project() === 'c:\\new',
      '| project():',
      JSON.stringify(W.project())
    );
  } catch (e) {
    log('TEST ERROR', e.message);
  }
  check.done();
})();
