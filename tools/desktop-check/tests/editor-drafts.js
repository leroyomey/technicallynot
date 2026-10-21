/*
 * Technically Not tools · desktop-check/tests/editor-drafts.js — 09's file editor keeps unsaved
 * edits safe around a save (audit app-4 #2 and #3): text typed while a save is in flight keeps
 * its draft; closing the file during a save waits for the save instead of asking "Discard" about
 * text that is already being written; a draft too large for the store says so in the editor's
 * message line. On the seeded sample project's README.md; no agent, no prompt. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
  }
  return null;
};
const F = window.TnaiProjectFiles,
  FILE = 'README.md';
const row = p => document.querySelector('.repo-real-tree [data-real-path="' + p + '"]');
const area = () => document.querySelector('.repo-editor:not([hidden]) .repo-editor-text');
const message = () => document.querySelector('.repo-editor-message')?.textContent || '';
const dialog = () => document.querySelector('.bw-confirm-overlay .bw-cancel');
const type = text => {
  area().value += text;
  area().dispatchEvent(new Event('input', { bubbles: true }));
};
const saved = () => until(() => /Saved and verified/.test(message()), 10000);

try {
  // 09 confirmDiscard and the changed-on-disk question: a native dialog would hang the run
  window.confirm = () => true;
  check(!!(await until(() => row(FILE))), 'project folder restored');
  window.TnaiRoute('files');
  await wait(200);
  F.open(FILE);
  check(!!(await until(() => area() && /line two/.test(area().value))), 'README.md open');

  // #3: typed while the save runs → its draft stays
  type(' first');
  document.querySelector('.repo-editor-save').click();
  type(' typed-during-save');
  F.stash();
  check(F.hasDraft(FILE), 'the draft of the text typed during the save is written');
  check(!!(await saved()), 'the save finished');
  check(F.hasDraft(FILE), 'text typed during the save keeps its draft after the save');
  check(F.dirty(), 'and the box still shows it unsaved');

  // a clean save: its own draft goes
  document.querySelector('.repo-editor-save').click();
  await until(() => !F.dirty(), 10000);
  check(!F.hasDraft(FILE), 'a save with nothing typed after it drops the draft');

  // #3: close during a save → waits for the save, then no Discard question for saved text
  type(' second');
  document.querySelector('.repo-editor-save').click();
  document.querySelector('.repo-editor-close').click();
  await wait(0);
  check(!dialog(), 'closing during a save does not ask Discard about text being written');
  check(!!(await until(() => !area(), 10000)), 'the editor closes once the save is done');
  check(!dialog(), 'and no Discard question came after it');

  // #2: a full draft store says so
  F.open(FILE);
  await until(() => area() && /second/.test(area().value));

  // The app window's store takes far more than a browser's (20 MB went in), so the store is made
  // to refuse the drafts key the way a full one does, instead of filling it.
  const realSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (String(key).startsWith('tnai.editor-drafts.v1'))
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return realSetItem.call(this, key, value);
  };
  try {
    type(' more');
    F.stash();
  } finally {
    Storage.prototype.setItem = realSetItem;
  }
  check(
    /too large to keep as a draft/.test(message()),
    'a draft that does not fit says so: "' + message().slice(0, 80) + '"'
  );
  check(F.dirty(), 'the edit stays in the box, unsaved');
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
} finally {
  if (area()) {
    F.dropDraft(FILE);
  }
}
return { ok, log };
