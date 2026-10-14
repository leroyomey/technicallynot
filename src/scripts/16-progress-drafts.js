// Technically Not · 16-progress-drafts.js — Keeps the composer draft across crashes, closing, and
// reloading (editor drafts live in 09, terminal sessions in 10 + desktop/session-store).
(() => {
  const input = document.getElementById('prompt');
  if (!input) return;
  const KEY = 'tnai.draft.composer.v1';
  let timer = 0;

  const save = () => {
    clearTimeout(timer);
    try {
      input.value.trim() ? localStorage.setItem(KEY, input.value) : localStorage.removeItem(KEY);
    } catch {}
  };
  const saveSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  };

  // Restore only into an empty composer, so nothing the user is typing gets replaced.
  try {
    const draft = localStorage.getItem(KEY);
    if (draft && !input.value) {
      input.value = draft;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch {}

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
})();
