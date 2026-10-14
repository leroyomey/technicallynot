/*
 * Technically Not · 62-snapshot-shortcut.js — Desktop only: the snapshot shortcut
 * (desktop/snapshot-service.js). Settings › Keyboard picks it (Change / Default; saved by the main
 * process, which holds it as a global shortcut). When it could not be registered (another app or
 * another Technically Not holds it), says so once in a quiet toast. window.TnaiSnapshot (state,
 * keys).
 */
(() => {
  const native = window.tnaiNative?.snapshot;
  if (!native) return;
  let state = null,
    told = false;
  const keys = () => (state?.accelerator || 'Ctrl+Shift+Alt+S').split('+');
  const apply = next => {
    state = next || state;
    if (state?.error && !told) {
      told = true;
      toast(state.error);
    }
    paint();
  };
  native
    .state()
    .then(apply)
    .catch(() => {});
  native.onState(apply);
  window.TnaiSnapshot = { state: () => state, keys };

  // KeyboardEvent.code → the key part of an Electron accelerator (only keys snapshot-service.js
  // accepts).
  const NAMED = {
    Space: 'Space',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    PrintScreen: 'PrintScreen',
    ScrollLock: 'Scrolllock',
    Pause: 'Pause',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  };
  const keyOf = code =>
    /^Key[A-Z]$/.test(code)
      ? code.slice(3)
      : /^Digit\d$/.test(code)
        ? code.slice(5)
        : /^Numpad\d$/.test(code)
          ? 'num' + code.slice(6)
          : /^F([1-9]|1\d|2[0-4])$/.test(code)
            ? code
            : NAMED[code] || null;
  const MODS = ['Control', 'Shift', 'Alt', 'Meta', 'OS'];
  const label = acc =>
    acc
      .split('+')
      .map(p => (p === 'Control' ? 'Ctrl' : p))
      .join('+');

  // ---- Settings › Keyboard: pick the snapshot key
  // ----------------------------------------------------------------
  let paint = () => {};

  function mountSetting() {
    const card = document.getElementById('tnaiShowShortcuts')?.closest('.set-card');
    if (!card || card.querySelector('#tnaiSnapshotKeyRow')) return;
    const row = document.createElement('div');
    row.className = 'set-row';
    row.id = 'tnaiSnapshotKeyRow';
    row.innerHTML =
      '<span class="set-text"><b>Snapshot key</b><small>Press <span class="tnai-snapshot-keys"></span> in any app while Technically Not runs, then drag a region of the screen; it is copied to the clipboard. Use Ctrl or Alt with a key, or an F key on its own.</small></span>' +
      '<span class="tnai-voice-key-actions"><button type="button" class="settings-keys-button" data-act="change">Change</button><button type="button" class="settings-keys-button" data-act="reset">Default</button></span>';
    card.append(row);
    const shown = row.querySelector('.tnai-snapshot-keys'),
      change = row.querySelector('[data-act=change]'),
      reset = row.querySelector('[data-act=reset]');
    paint = () => {
      shown.replaceChildren(
        ...keys().flatMap((p, i) => {
          const k = document.createElement('kbd');
          k.textContent = p;
          return i ? ['+', k] : [k];
        })
      );
      reset.disabled = !state || state.isDefault;
    };
    let picking = null,
      lastTaken = '';
    const stop = () => {
      if (picking) {
        window.removeEventListener('keydown', picking, true);
        window.removeEventListener('keyup', picking, true);
      }
      picking = null;
      lastTaken = '';
      change.textContent = 'Change';
      change.removeAttribute('aria-pressed');
    };
    const save = async acc => {
      const r = await native.setShortcut(acc).catch(error => ({ ok: false, error: error.message }));
      if (!r?.ok) {
        toast(r?.error || 'The snapshot key could not be changed.');
        return;
      }
      told = false;
      apply(r.state);
      toast('Snapshot key: ' + r.state.accelerator);
    };

    // A key another Technically Not shortcut uses asks once; pressing it again means "use it
    // anyway" (the global shortcut wins in every window).
    const taken = name =>
      name !== label(keys().join('+')) &&
      (window.TnaiShortcuts?.list() || []).some(s => s.keys === name && !/^Snapshot/.test(s.what));
    change.addEventListener('click', () => {
      if (picking) {
        stop();
        return;
      }
      change.textContent = 'Press a key or combination…';
      change.setAttribute('aria-pressed', 'true');
      picking = event => {
        const lone = event.code === 'PrintScreen'; // Windows sends Print Screen only on key up
        if (event.type === 'keyup' && !lone) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          stop();
          return;
        }

        // wait for the key that goes with them
        if (MODS.includes(event.key) || event.repeat) return;
        if (event.metaKey) {
          toast('The Windows key belongs to Windows. Pick another combination.');
          return;
        }
        const key = keyOf(event.code);
        if (!key) {
          toast('That key cannot be a snapshot shortcut. Pick another.');
          return;
        }
        const mods = [
          event.ctrlKey && 'Control',
          event.altKey && 'Alt',
          event.shiftKey && 'Shift',
        ].filter(Boolean);
        if (!mods.some(m => m !== 'Shift') && !/^(F\d+|PrintScreen|Pause|Scrolllock)$/.test(key)) {
          toast(
            'On its own ' +
              key +
              ' is used for typing in every app. Add Ctrl or Alt, or pick an F key.'
          );
          return;
        }
        const acc = [...mods, key].join('+'),
          name = label(acc);
        if (taken(name) && lastTaken !== name) {
          lastTaken = name;
          toast(
            name +
              ' is already a Technically Not shortcut. Press it again to use it for snapshots anyway, or pick another.'
          );
          return;
        }
        stop();
        save(acc);
      };
      window.addEventListener('keydown', picking, true);
      window.addEventListener('keyup', picking, true);
    });
    change.addEventListener('blur', () => {
      if (picking) stop();
    });
    reset.addEventListener('click', () => save(null));
    paint();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mountSetting);
  else mountSetting();
})();
