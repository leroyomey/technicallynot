// Terminal panel drag (86): drag a header to reorder, Escape cancels, header buttons don't drag,
// order saved and restored after reload. Run: .\tools\browser-check\check.ps1 -Test terminal-drag
// -Phases 1,2 (the phase 1 screenshot is taken mid-drag)
(async () => {
  const { log, wait, until } = check;
  const grid = () =>
    document.querySelector('#terminalView .terminal-workspace-grid:not([hidden])') ||
    [...document.querySelectorAll('#terminalView .terminal-workspace-grid')].find(
      g => g.offsetParent
    );
  const names = () =>
    [...grid().querySelectorAll(':scope>.terminal-pane')].map(
      p => p.querySelector('.terminal-pane-title')?.textContent
    );
  const saved = () =>
    JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]')
      .map(p => p.name)
      .filter(n => names().includes(n));
  const center = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const fire = (el, type, x, y) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
        pointerType: 'mouse',
      })
    );
  const pane = n =>
    [...grid().querySelectorAll(':scope>.terminal-pane')].find(
      p => p.querySelector('.terminal-pane-title')?.textContent === n
    );

  async function dragTo(fromName, toName, { release = true, steps = 8 } = {}) {
    const head = pane(fromName).querySelector('.terminal-pane-head'),
      hr = head.getBoundingClientRect(),
      sx = hr.left + 40,
      sy = hr.top + hr.height / 2,
      to = center(pane(toName));
    fire(head, 'pointerdown', sx, sy);
    for (let i = 1; i <= steps; i++) {
      fire(head, 'pointermove', sx + ((to.x - sx) * i) / steps, sy + ((to.y - sy) * i) / steps);
      await wait(30);
    }
    if (release) {
      fire(head, 'pointerup', to.x, to.y);
      await wait(260);
    }
  }
  try {
    document.querySelector('.side-item[data-workspace="terminal"]')?.click();
    await wait(400);
    if (check.phase === '1') {
      for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta'])
        window.TnaiNewTerminalPane({ name: n, quiet: true });
      await until(() => ['Alpha', 'Bravo', 'Charlie', 'Delta'].every(pane), 3000);
      await wait(300);
      const start = names();
      log('start order:', start.join(','));
      await dragTo('Alpha', 'Charlie');
      const a = names();
      log(
        'Alpha dragged onto Charlie → after it:',
        a.indexOf('Alpha') === a.indexOf('Charlie') + 1,
        '|',
        a.join(',')
      );
      log(
        'lift cleared:',
        !document.querySelector('.tnai-panel-dragging,.tnai-panel-slot'),
        '| no inline transform:',
        !pane('Alpha').style.transform,
        '| cursor class off:',
        !document.documentElement.classList.contains('tnai-panel-drag')
      );
      log('saved order matches screen:', JSON.stringify(saved()) === JSON.stringify(names()));
      await dragTo('Delta', 'Bravo');
      const b = names();
      log(
        'Delta dragged back onto Bravo → before it:',
        b.indexOf('Delta') === b.indexOf('Bravo') - 1,
        '|',
        b.join(',')
      );

      // Escape mid-drag puts it back.
      const beforeEsc = names().join(',');
      await dragTo('Bravo', 'Alpha', { release: false });
      log(
        'mid-drag live reorder:',
        names().join(',') !== beforeEsc,
        '| slot shown:',
        !!grid().querySelector('.tnai-panel-slot')
      );
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(260);
      log(
        'Escape restores order:',
        names().join(',') === beforeEsc,
        '| saved unchanged:',
        saved().join(',') === beforeEsc
      );

      // A press on a header button never starts a drag.
      const btn = pane('Charlie').querySelector('.terminal-pane-head button'),
        br = btn.getBoundingClientRect(),
        o = names().join(',');
      fire(btn, 'pointerdown', br.left + 3, br.top + 3);
      const t = center(pane(names()[0]));
      fire(btn, 'pointermove', t.x, t.y);
      await wait(30);
      log(
        'button press does not drag:',
        !document.querySelector('.tnai-panel-dragging') && names().join(',') === o
      );
      fire(btn, 'pointerup', t.x, t.y);
      await wait(50);
      localStorage.setItem('tnai.drag-check.order', names().join(','));

      // Leave one drag in flight for the screenshot.
      await dragTo(names()[0], names()[3], { release: false, steps: 5 });
      const hp = document.querySelector('.tnai-panel-dragging');
      log('mid-drag screenshot: lifted =', !!hp);
    } else {
      await until(() => names().length >= 4, 4000);
      await wait(300);
      const want = localStorage.getItem('tnai.drag-check.order');
      log(
        'order after reload matches:',
        names().join(',') === want,
        '|',
        names().join(','),
        'vs',
        want
      );
    }
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
