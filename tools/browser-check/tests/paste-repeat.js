// Held Ctrl+V pastes once (32): the key's auto-repeat is cancelled app-wide; the first press is
// left alone. Run: .\tools\browser-check\check.ps1 -Test paste-repeat
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    const press = (repeat, extra = {}) => {
      const e = new KeyboardEvent('keydown', {
        key: 'v',
        ctrlKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      box.dispatchEvent(e);
      return e.defaultPrevented;
    };
    log('first Ctrl+V allowed:', press(false) === false);
    log('held Ctrl+V repeat blocked:', press(true) === true);
    log('held Ctrl+Shift+V repeat blocked:', press(true, { shiftKey: true }) === true);
    const other = new KeyboardEvent('keydown', {
      key: 'a',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    box.dispatchEvent(other);
    log('other held keys untouched:', other.defaultPrevented === false);
    box.remove();
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
