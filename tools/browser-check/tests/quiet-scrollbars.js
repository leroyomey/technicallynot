// Quiet scrollbars (55): a user scroll lights only that box's bar and it hides again; programmatic
// scrolls stay quiet. Run: .\tools\browser-check\check.ps1 -Test quiet-scrollbars
(async () => {
  const { log, wait, q } = check;
  try {
    await wait(400);
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:40px;top:40px;width:240px;height:160px;overflow:auto;z-index:99;background:#fff';
    box.innerHTML = '<div style="height:900px;width:600px">tall</div>';
    document.body.append(box);
    const other = box.cloneNode(true);
    other.style.left = '300px';
    document.body.append(other);
    await wait(1200);
    box.scrollTop = 200;
    await wait(60);
    log('programmatic scroll quiet:', !box.classList.contains('tnai-scrolling'));
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    box.scrollTop = 300;
    await wait(60);
    log(
      'user scroll lights it:',
      box.classList.contains('tnai-scrolling'),
      '| neighbour stays quiet:',
      !other.classList.contains('tnai-scrolling')
    );
    console.log('TNAI_SHOT:quiet-scrollbars-on');
    await wait(1100);
    log('hides after stop:', !box.classList.contains('tnai-scrolling'));
    log('gutter width:', box.offsetWidth - box.clientWidth);
    box.remove();
    other.remove();
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
