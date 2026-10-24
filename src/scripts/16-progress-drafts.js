// Technically Not · 16-progress-drafts.js — Keeps the composer draft across crashes, closing, and
// reloading, one draft per thread (user 2026-10-22, mock
// docs/plans/design-concepts/thread-small-features.html: what you type stays with that thread).
// Editor drafts live in 09, terminal sessions in 10 + desktop/session-store.
//
// The open thread comes from 120's `tnai:thread-view` event. Switching threads keeps what was typed
// for the thread that was open and puts the new thread's own draft in the box. With no thread open
// (the New thread screen) the box keeps one draft of its own, under the old key.
// The thread list (119) shows "Draft:" and its first words on a thread that has one
// (`window.TnaiDrafts.of`, `tnai:draft-changed`).
// Test: node tools/thread-small-features-test.js
(() => {
  const input = document.getElementById('prompt');
  if (!input) return;

  // the box's own draft while no thread is open (the key the app used before drafts per thread)
  const KEY = 'tnai.draft.composer.v1';

  // one draft per thread: { paneId: text }
  const THREADS_KEY = 'tnai.draft.threads.v1';
  let timer = 0;
  let open = '';
  let drafts = {};

  try {
    drafts = JSON.parse(localStorage.getItem(THREADS_KEY) || '{}') || {};
  } catch {
    drafts = {};
  }

  const keep = () => {
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(drafts));
    } catch {}
  };

  // What the box holds now belongs to the open thread, or to the box itself.
  const save = () => {
    clearTimeout(timer);
    const text = input.value;
    if (!open) {
      try {
        text.trim() ? localStorage.setItem(KEY, text) : localStorage.removeItem(KEY);
      } catch {}
      return;
    }
    const had = drafts[open] || '';
    if (text.trim()) drafts[open] = text;
    else delete drafts[open];
    keep();

    // the thread list shows a draft only when it starts or ends, not on every key
    if (!had.trim() !== !text.trim() || had.slice(0, 40) !== text.slice(0, 40))
      window.dispatchEvent(new CustomEvent('tnai:draft-changed', { detail: { paneId: open } }));
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  };

  const fill = text => {
    if (input.value === text) return;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Restore only into an empty composer, so nothing the user is typing gets replaced.
  try {
    const draft = localStorage.getItem(KEY);
    if (draft && !input.value) fill(draft);
  } catch {}

  // Another thread opened: the box's words stay with the thread that was open, and the new
  // thread's own draft comes in (an empty box when it has none).
  window.addEventListener('tnai:thread-view', event => {
    const paneId = event.detail?.paneId || '';
    if (paneId === open) return;
    save();
    open = paneId;
    fill(open ? drafts[open] || '' : safeRead(KEY));
  });

  function safeRead(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  input.addEventListener('input', saveSoon);

  // Sending clears the composer, sometimes without an input event; re-check just after.
  document.addEventListener(
    'click',
    event => {
      if (event.target.closest?.('#send')) setTimeout(save, 60);
    },
    true
  );
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) setTimeout(save, 60);
  });
  window.addEventListener('beforeunload', save);

  // A thread that closed leaves no draft behind.
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const paneId = event.detail?.paneId || '';
    if (!paneId) return;

    // the open one closed: what is in the box now stays as the box's own draft
    if (paneId === open) open = '';
    if (!drafts[paneId]) return;
    delete drafts[paneId];
    keep();
  });

  window.TnaiDrafts = {
    // the draft of a thread that is not open now ('' for the open one: its draft is in the box)
    of: paneId => (paneId && paneId !== open ? drafts[paneId] || '' : ''),
  };
})();
