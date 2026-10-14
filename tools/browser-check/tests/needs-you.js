// Needs you (71): chip hidden at 0, count with items, pane label + pulse, held notice buttons,
// Cancel puts the text back. Run: .\tools\browser-check\check.ps1 -Test needs-you
(async () => {
  const { log, wait, until } = check;
  try {
    await wait(600);
    const A = window.__attention,
      N = window.TnaiNeedsYou,
      chip = document.querySelector('#activityToggle .tnai-needs-chip');
    log('api:', !!N, '| chip in the activity line:', !!chip, '| hidden at 0:', chip?.hidden);
    A.push({
      items: [
        {
          id: 'a',
          paneId: 'p1',
          kind: 'permission',
          detail: 'Bash: npm test',
          since: Date.now() - 5000,
        },
        {
          id: 'b',
          paneId: 'p2',
          kind: 'menu',
          detail: '1. Yes 2. No',
          since: Date.now(),
          inferred: true,
        },
      ],
      held: [],
    });
    await wait(100);
    log(
      'with 2 items: hidden',
      chip.hidden,
      '| text:',
      chip.textContent,
      '| title prefix:',
      document.title.startsWith('(2) ')
    );
    log(
      'has p1:',
      N.has('p1'),
      '| p3:',
      N.has('p3'),
      '| labels:',
      N.label('p1'),
      '/',
      N.label('p2')
    );
    const pane = document.createElement('div');
    pane.className = 'terminal-pane';
    pane.dataset.status = 'needs-you';
    pane.innerHTML =
      '<div class="terminal-pane-head"><span class="terminal-pane-state"><i></i><span>' +
      N.label('p1') +
      '</span></span></div>';
    pane.style.cssText =
      'position:fixed;left:240px;top:80px;width:420px;z-index:9999;background:#fff';
    document.body.append(pane);
    await wait(50);
    const dot = pane.querySelector('i'),
      cs = getComputedStyle(dot),
      after = getComputedStyle(dot, '::after');
    log(
      'pane dot:',
      cs.backgroundColor,
      '| ring:',
      after.animationName,
      '| label color:',
      getComputedStyle(pane.querySelector('span span')).color
    );
    const cd = getComputedStyle(chip.querySelector('.dot'), '::after');
    log('chip ring:', cd.animationName, '| chip bg:', getComputedStyle(chip).backgroundColor);
    await until(() => A.calls.some(c => c[0] === 'notify'), 4500);
    log('notified:', JSON.stringify(A.calls.filter(c => c[0] === 'notify')));
    N.held({
      paneId: 'p1',
      heldId: 'h1',
      reason: 'permission',
      detail: 'Bash',
      userText: 'fix the tests',
    });
    await wait(50);
    const card = document.querySelector('.tnai-perm.tnai-held');
    log(
      'held notice shown:',
      card && !card.hidden,
      '| text:',
      card?.querySelector('.tnai-perm-desc').textContent
    );
    log('buttons:', [...card.querySelectorAll('button')].map(b => b.textContent).join(' · '));
    console.log('TNAI_SHOT:needs-you');
    card.querySelector('button[data-act=cancel]').click();
    await wait(100);
    log(
      'after Cancel: hidden',
      card.hidden,
      '| composer:',
      document.getElementById('prompt').value,
      '| calls:',
      JSON.stringify(A.calls.filter(c => c[0] === 'cancel'))
    );
    N.notSubmitted('p2', 'it is still in the input');
    await wait(50);
    log(
      'unsent notice buttons:',
      [...card.querySelectorAll('button')].map(b => b.textContent).join(' · ')
    );
    card.querySelector('button[data-act=dismiss]').click();
    A.push({ items: [], held: [] });
    await wait(50);
    log(
      'back to 0: chip hidden',
      chip.hidden,
      '| title prefix gone:',
      !/^\(\d+\) /.test(document.title)
    );
  } catch (e) {
    log('ERROR', e.message, e.stack);
  }
  check.done();
})();
