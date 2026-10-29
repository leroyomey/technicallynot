// Toast placement (01): Technically Not's black notifications sit in the top bar, left of the
// agents status, not over the page. Run: .\tools\browser-check\check.ps1 -Test toast-top
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    window.toast('Workspace 3 created · new terminals start with fresh context');
    await wait(300);
    const t = document.getElementById('toast').getBoundingClientRect(),
      top = document.querySelector('header.top').getBoundingClientRect(),
      st = document.querySelector('.top-right .status').getBoundingClientRect();
    const inside = t.top >= top.top && t.bottom <= top.bottom;
    const leftOf = t.right <= st.left;
    const opacity = getComputedStyle(document.getElementById('toast')).opacity;
    log('inside the top bar:', inside, '| left of the status:', leftOf, '| visible:', opacity);
    log(
      inside && leftOf && opacity === '1' ? 'PASS' : 'FAIL',
      'the note sits in the thread layout top bar, left of the status:',
      document.documentElement.classList.contains('tnt-on')
    );
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
