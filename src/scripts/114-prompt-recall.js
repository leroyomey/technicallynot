/*
 * Technically Not · 114-prompt-recall.js — Prompt recall and park in the composer.
 * Recall: Arrow Up in an empty composer
 * brings back the prompts sent from it, newest first; Arrow Down goes forward and, past the newest,
 * empties the box again. Text only, attachments are not kept. Any other key, a click or typing
 * makes the recalled text an ordinary draft. 11 says what was sent at the moment it clears the box
 * (`TnaiPromptRecall.sent`); the newest RECALL_MAX are kept in localStorage. Park: Ctrl+S (Cmd+S on
 * a Mac) takes the draft and its attachment chips out of the box; the same key in an empty box
 * brings the newest parked one back. The text is kept across restarts (localStorage); the chips are
 * held in memory (27 beginSend / restore), so they come back only until the window reloads. Nothing
 * here leaves the PC. No control of its own: two keys, and one line each in the shortcut list (32).
 */
(() => {
  const input = document.getElementById('prompt');
  if (!input) return;
  const RECALL_KEY = 'tnai.prompt-recall.v1',
    PARK_KEY = 'tnai.prompt-park.v1';
  const RECALL_MAX = 50,
    PARK_MAX = 5,
    // characters per kept prompt; a longer one is not kept (recall) or refused (park)
    TEXT_MAX = 20000;
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const read = key => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(v) ? v.filter(s => typeof s === 'string' && s) : [];
    } catch {
      return [];
    }
  };
  const write = (key, list) => {
    try {
      list.length ? localStorage.setItem(key, JSON.stringify(list)) : localStorage.removeItem(key);
    } catch {}
  };

  // A "[Pasted text #N]" token only means something while 27 holds its text, which it drops once
  // the token leaves the box: keep what it stood for.
  const whole = text => window.TnaiPastedText?.expand(text) ?? text;

  let ours = false,
    at = -1,
    // at: place in the sent list while recalling (-1 = not recalling); shown: the text recall last
    // put in the box
    shown = '';
  const setText = text => {
    ours = true;
    try {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      ours = false;
    } // 16 keeps the draft, 27 and 50 follow the text
    input.dispatchEvent(new Event('tnai:refit')); // 46 sizes the box to the text
    try {
      input.setSelectionRange(text.length, text.length);
    } catch {}
  };

  function sent(text, full) {
    at = -1;
    const t = String((full && full !== text ? full : text) || '').trim();
    if (!t || t.length > TEXT_MAX) return;
    const list = read(RECALL_KEY).filter(s => s !== t);
    list.push(t); // a prompt sent again moves to the newest place instead of showing twice
    write(RECALL_KEY, list.slice(-RECALL_MAX));
  }

  function recall(step) {
    const list = read(RECALL_KEY);

    // something else changed the box (voice, a restored draft): not ours to replace
    if (at >= 0 && input.value !== shown) at = -1;
    if (at < 0) {
      if (step > 0 || input.value || !list.length) return false;
      at = list.length;
    } // only Arrow Up in an empty box starts it
    at = Math.min(at + step, list.length);
    if (at < 0) {
      at = 0;
      return true;
    } // already at the oldest
    if (at >= list.length) {
      at = -1;
      shown = '';
      setText('');
      return true;
    } // past the newest: the empty box again
    shown = list[at];
    setText(shown);
    return true;
  }

  const parked = read(PARK_KEY).map(text => ({ text, snap: null })); // newest last
  const saveParked = () =>
    write(
      PARK_KEY,
      parked.map(p => p.text)
    );

  function park() {
    const files = window.TnaiAttachments,
      key = window.tnaiKeys ? window.tnaiKeys('Ctrl+S') : 'Ctrl+S';
    if (input.value.trim() || files?.count?.()) {
      const text = whole(input.value);
      if (text.length > TEXT_MAX) {
        say('This prompt is too long to park');
        return;
      }
      if (parked.length >= PARK_MAX) {
        say(
          PARK_MAX +
            ' prompts are parked already · bring one back first (' +
            key +
            ' in an empty box)'
        );
        return;
      }
      parked.push({ text, snap: files?.count?.() ? files.beginSend() : null });
      saveParked();
      at = -1;
      setText('');
      say('Prompt parked · ' + key + ' in an empty box brings it back');
    } else if (parked.length) {
      const p = parked.pop();
      saveParked();
      at = -1;
      setText(p.text);
      p.snap?.restore();
      say(
        parked.length
          ? 'Parked prompt is back · ' + parked.length + ' more parked'
          : 'Parked prompt is back'
      );
    } else say('Nothing is parked · ' + key + ' parks what is in the box');
  }

  input.addEventListener('keydown', event => {
    // a menu on the box (mentions, 50) took the key
    if (event.defaultPrevented || event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      park();
      return;
    }
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !mod &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (recall(event.key === 'ArrowUp' ? -1 : 1)) event.preventDefault();
      return;
    }

    // any other key: an ordinary draft from here
    if (at >= 0 && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) at = -1;
  });
  input.addEventListener('input', () => {
    if (!ours) at = -1;
  });
  input.addEventListener('mousedown', () => {
    at = -1;
  });

  window.TnaiPromptRecall = {
    sent,
    list: () => read(RECALL_KEY),
    parked: () => parked.map(p => p.text),
  };
})();
