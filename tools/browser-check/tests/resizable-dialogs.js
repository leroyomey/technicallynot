// Resizable dialogs (67): hover shows the grip, dragging it resizes the box and the main content
// grows with it. Phase 1 = shortcuts dialog as opened (before); phase 2 = resized (after). Run:
// .\tools\browser-check\check.ps1 -Test resizable-dialogs -Phases 1,2
(async () => {
  const { log, wait, until, q } = check;
  const ev = (type, el, x, y) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      })
    );

  async function resize(name, box, dx, dy) {
    const r0 = box.getBoundingClientRect();
    ev('pointerover', box, r0.left + r0.width / 2, r0.top + r0.height / 2);
    const rz = box.dataset.tnaiRz;
    const cx = rz.includes('w') ? r0.left + 4 : r0.right - 4,
      cy = rz.includes('n') ? r0.top + 4 : r0.bottom - 4;
    ev('pointermove', box, cx, cy);
    const hot = box.hasAttribute('data-tnai-rz-hot');
    ev('pointerdown', document.elementFromPoint(cx, cy) || box, cx, cy);
    const grow = box.querySelector('[data-tnai-grow]:not([data-tnai-grow-col])'),
      g0 = grow?.getBoundingClientRect();
    for (let s = 1; s <= 6; s++) {
      ev('pointermove', window.document.body, cx + (dx * s) / 6, cy + (dy * s) / 6);
      await wait(30);
    }
    ev('pointerup', document.body, cx + dx, cy + dy);
    await wait(80);
    const r1 = box.getBoundingClientRect(),
      g1 = grow?.getBoundingClientRect();
    const inside =
      r1.left >= 0 && r1.top >= 0 && r1.right <= innerWidth && r1.bottom <= innerHeight;
    log(
      name,
      '| grip',
      rz,
      'hot',
      hot,
      '| size',
      Math.round(r0.width) + 'x' + Math.round(r0.height),
      '→',
      Math.round(r1.width) + 'x' + Math.round(r1.height),
      '| grip followed pointer',
      Math.abs((rz.includes('w') ? r1.left : r1.right) - (cx + dx + (rz.includes('w') ? -4 : 4))) <
        3,
      '| content',
      grow
        ? (grow.className || grow.tagName) +
            ' ' +
            Math.round(g0.width) +
            'x' +
            Math.round(g0.height) +
            ' → ' +
            Math.round(g1.width) +
            'x' +
            Math.round(g1.height)
        : '(none)',
      '| inside window',
      inside
    );
    return { r0, r1, g0, g1 };
  }
  try {
    await wait(700);
    if (check.phase === '1') {
      TnaiShortcuts.open();
      await wait(300);
      const k = q('.tnai-keys'),
        r = k.getBoundingClientRect();
      ev('pointerover', k, r.left + 20, r.top + 20);
      k.setAttribute('data-tnai-resizing', '');

      /* shows the grip as while dragging (headless has no :hover) */ log(
        'shortcuts open',
        !!k,
        '| grip',
        k.dataset.tnaiRz
      );
      check.done();
      return;
    }

    // Palette: centered horizontally, top-anchored (tests the grip speed per axis); shrink then
    // check it scrolls.
    TnaiPalette.open();
    const pal = await until(() => q('.tnai-pal'));
    await wait(200);
    await resize('palette', pal, 120, 160);
    TnaiPalette.close();
    await wait(150);

    // Connection picker (06): placed by its own code, which must not fight the drag.
    TnaiConnectionPicker.open(() => {});
    const tl = await until(() => {
      const e = q('.terminal-launcher');
      return e && e.getClientRects().length && e;
    });
    await wait(250);
    await resize('connection picker', tl, 140, 120);
    document.querySelector('.terminal-launcher-close')?.click();
    await wait(150);

    // Shortcuts (32): shared dialog look, centered; grow, then a shrink that must scroll rather
    // than clip.
    TnaiShortcuts.open();
    const keys = await until(() => q('.tnai-keys'));
    await wait(250);
    const a = await resize('shortcuts', keys, 160, 140);
    const b = await resize('shortcuts shrink', keys, -260, -260);
    const g = q('.tnai-keys [data-tnai-grow]');
    log(
      'shrunk content scrolls:',
      !!g && g.scrollHeight > g.clientHeight + 2,
      '| header kept',
      Math.round(q('.tnai-keys-head').getBoundingClientRect().height)
    );
    await resize('shortcuts again', keys, 200, 300);
    log(
      'grew:',
      a.r1.width > a.r0.width + 100 && a.r1.height > a.r0.height + 100,
      '| content grew with it:',
      a.g1.height > a.g0.height + 80
    );
  } catch (e) {
    log('ERROR', e.message, e.stack);
  }
  check.done();
})();
